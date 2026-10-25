/* ============================================================
   75-player.js
   Player controller and the bystander death camera
   ============================================================ */
'use strict';

/* ------------------------------------------------------------
   PLAYER
   ------------------------------------------------------------ */
const keys = Object.create(null);

function createPlayer() {
  const p = makeActor(G.team, 'YOU', true);
  p.diff = DIFF[G.diff];
  finishSpawn(p, 5);              // slot 5: bots take 0-4
  p.hp = p.maxHp = CFG.playerHp;
  G.player = p;
  return p;
}

function updatePlayer(dt) {
  const p = G.player;
  if (!p.alive) {
    hideAimLine();
    p.respawnT -= dt;
    $('rsNum').textContent = Math.max(0, Math.ceil(p.respawnT));
    /* bystander camera: watch the opponent who killed you */
    SPEC.t += dt;
    updateSpectator(dt);
    if (p.respawnT <= 0) {
      respawnActor(p);
      $('respawn').classList.remove('show');
    }
    return;
  }
  if (p.reloadT > 0) {
    p.reloadT -= dt;
    if (p.reloadT <= 0) finishReload(p);
  }

  /* No passive regeneration: a FIELD AID is the only way back up. */

  /* stim boost */
  if (p.stimT > 0) {
    p.stimT -= dt;
    p.speedMul = ITEMS.stim.mul;
  } else if (p.speedMul !== 1) {
    p.speedMul = 1;
  }

  /* crossbow: hold the trigger, two seconds of draw, then the bolt flies */
  const curSt = p.weapons[p.cur];
  const curDef = curSt ? defOf(curSt.id) : null;
  if (curDef && curDef.draw) {
    if (firing && p.reloadT <= 0 && curSt.mag > 0) {
      if (p.drawT === 0) Snd.draw();
      p.drawT = Math.min(curDef.draw, p.drawT + dt);
      if (p.drawT >= curDef.draw) { p.drawT = 0; fireCrossbow(p); }
    } else if (p.drawT > 0) {
      p.drawT = Math.max(0, p.drawT - dt * 2.5);
    }
  } else if (p.drawT) {
    p.drawT = 0;
  }

  updateGrenadeAim(p);

  let wx = 0, wz = 0;
  if (keys['w'] || keys['arrowup']) wz -= 1;
  if (keys['s'] || keys['arrowdown']) wz += 1;
  if (keys['a'] || keys['arrowleft']) wx -= 1;
  if (keys['d'] || keys['arrowright']) wx += 1;
  const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
  // forward is (-sin, -cos); right is (cos, -sin)
  const fx = -sy, fz = -cy;
  const rx = cy, rz = -sy;
  const mx = fx * (-wz) + rx * wx;
  const mz = fz * (-wz) + rz * wx;

  const sprint = !!(keys['shift'] && wz < 0);
  moveActor(p, mx, mz, sprint, !!keys[' '], dt);

  // camera
  const speed = Math.hypot(p.vel.x, p.vel.z);
  p.bobT = (p.bobT || 0) + dt * (6 + speed * 1.1);
  const bob = p.onGround ? Math.sin(p.bobT) * Math.min(0.045, speed * 0.008) : 0;
  const sway = p.onGround ? Math.cos(p.bobT * 0.5) * Math.min(0.03, speed * 0.005) : 0;
  camera.position.set(p.pos.x, p.pos.y + CFG.player.eye + bob, p.pos.z);
  camera.rotation.set(p.pitch, p.yaw, sway * 0.4);
  if (G.shake > 0.001) {
    camera.position.x += rand(-1, 1) * G.shake * 0.24;
    camera.position.y += rand(-1, 1) * G.shake * 0.24;
    camera.position.z += rand(-1, 1) * G.shake * 0.24;
    camera.rotation.z += rand(-1, 1) * G.shake * 0.05;
  }
  /* easing out of the bystander camera: the death pose can be looking straight
     down, so rotating straight to level whipped the view 90 deg in one frame.
     Rotation only — you respawn at your own spawn, far from where you fell, so
     blending the POSITION too would fly the camera across the map. */
  if (p.viewBlend > 0) {
    p.viewBlend -= dt;
    const k = Math.max(0, p.viewBlend) / VIEW_BLEND;      // 1 -> 0
    camera.quaternion.slerp(_exitQuat, k);
  }

  // weapon switch keys handled in keydown
  updateViewModel(dt, speed);
}

/* bystander camera state: kept across the death so the view can be smoothed */
const SPEC = { pos: new V3(), look: new V3(), t: 0, init: false, spot: -1 };
const _specPrev = new V3();
/* the pose the camera is leaving when you respawn — blending out of the
   bystander view instead of snapping the pitch from -90 deg to 0 in one frame */
const _exitPos = new V3();
const _exitQuat = new THREE.Quaternion();
const VIEW_BLEND = 0.35;

/* ------------------------------------------------------------
   BYSTANDER CAMERA — after you die you keep watching
   ------------------------------------------------------------
   A short beat hovering over your own corpse (looking at whoever
   dropped you), then a chase view of that opponent so you can see
   exactly who killed you. If they die too, the camera lingers over
   their body instead. Every candidate spot is checked against the
   colliders, so the view never ends up inside a wall — not even the
   tall railing on the perimeter catwalk. */

/* ordered camera placements around a subject: classic over-the-shoulder,
   then higher (clears the catwalk railing), then closer, then the flanks */
function specSpots(subj, yaw) {
  const d = dirFromAngles(yaw, 0, new V3());
  const px = -d.z, pz = d.x;                     // perpendicular to the facing
  const y = subj.pos.y;
  return [
    new V3(subj.pos.x - d.x * 3.6, y + 2.8, subj.pos.z - d.z * 3.6),
    new V3(subj.pos.x - d.x * 3.6, y + 5.8, subj.pos.z - d.z * 3.6),
    new V3(subj.pos.x - d.x * 2.0, y + 2.2, subj.pos.z - d.z * 2.0),
    new V3(subj.pos.x + px * 3.2, y + 2.6, subj.pos.z + pz * 3.2),
    new V3(subj.pos.x - px * 3.2, y + 2.6, subj.pos.z - pz * 3.2),
    new V3(subj.pos.x + d.x * 3.0, y + 2.6, subj.pos.z + d.z * 3.0),
    new V3(subj.pos.x, y + 6.8, subj.pos.z)
  ];
}

function specWant(dt) {
  const k = G.killer;
  const spin = G.deathYaw + SPEC.t * 0.4;

  /* the kill beat, or a suicide with nobody to watch */
  if (SPEC.t < 1.2 || !k) {
    const r = 3.4;
    return {
      look: k ? new V3(k.pos.x, k.pos.y + 1.25, k.pos.z)
             : new V3(G.deathPos.x, G.deathPos.y + 1.1, G.deathPos.z),
      spots: [
        new V3(G.deathPos.x + Math.sin(spin) * r, G.deathPos.y + 2.5, G.deathPos.z + Math.cos(spin) * r),
        new V3(G.deathPos.x + Math.sin(spin) * r, G.deathPos.y + 4.4, G.deathPos.z + Math.cos(spin) * r),
        new V3(G.deathPos.x, G.deathPos.y + 5.5, G.deathPos.z)
      ]
    };
  }
  if (k.alive) {
    /* over-the-shoulder chase: behind the killer, above, aimed at their chest */
    return { look: new V3(k.pos.x, k.pos.y + 1.35, k.pos.z), spots: specSpots(k, k.yaw) };
  }
  /* the killer bought it too — linger over their body */
  const a = SPEC.t * 0.35;
  return {
    look: new V3(k.pos.x, k.pos.y + 0.9, k.pos.z),
    spots: [
      new V3(k.pos.x + Math.sin(a) * 2.8, k.pos.y + 2.2, k.pos.z + Math.cos(a) * 2.8),
      new V3(k.pos.x + Math.sin(a) * 2.8, k.pos.y + 4.2, k.pos.z + Math.cos(a) * 2.8),
      new V3(k.pos.x, k.pos.y + 5.2, k.pos.z)
    ]
  };
}

function updateSpectator(dt) {
  const want = specWant(dt);
  /* Keep the chosen placement sticky: if the spot we are already using is still
     in the open, stay there, so a spinning killer never makes the camera jump
     between the flanks. Only move on when it gets blocked. */
  if (SPEC.spot < 0 || SPEC.spot >= want.spots.length ||
      pointSolid(want.spots[SPEC.spot].x, want.spots[SPEC.spot].y, want.spots[SPEC.spot].z)) {
    SPEC.spot = -1;
    for (let i = 0; i < want.spots.length; i++) {
      const s = want.spots[i];
      if (!pointSolid(s.x, s.y, s.z)) { SPEC.spot = i; break; }
    }
  }
  let pos;
  if (SPEC.spot >= 0) {
    pos = want.spots[SPEC.spot];
  } else {
    /* the subject is buried in geometry — hover over where you fell instead
       (you were standing there, so it is clear) */
    pos = new V3(G.deathPos.x, G.deathPos.y + 1.9, G.deathPos.z);
    if (pointSolid(pos.x, pos.y, pos.z)) pos.set(G.deathPos.x, G.deathPos.y + 0.6, G.deathPos.z);
  }
  if (!SPEC.init) {
    /* Start where the player's own eyes were and glide from there. Copying the
       target pose straight in snapped the view ~44 deg down in a single frame. */
    SPEC.pos.copy(camera.position);
    const dir = camera.getWorldDirection(new V3());
    SPEC.look.copy(SPEC.pos).addScaledVector(dir, 6);
    SPEC.init = true;
  }
  /* ramp the glide in over the first quarter second: the camera eases out of the
     first-person pose instead of whipping straight to the killer */
  const ramp = Math.min(1, SPEC.t / 0.25);
  const s = (1 - Math.pow(0.002, dt)) * ramp;   // smooth, frame-rate independent
  _specPrev.copy(SPEC.pos);
  SPEC.pos.lerp(pos, s);
  SPEC.look.lerp(want.look, s);
  /* the straight line to the target can clip a corner, so never let the camera
     finish a frame inside geometry: walk it back toward the last clear spot */
  if (pointSolid(SPEC.pos.x, SPEC.pos.y, SPEC.pos.z)) {
    for (let i = 1; i <= 20; i++) {
      const f = 1 - i / 20;
      const px = _specPrev.x + (SPEC.pos.x - _specPrev.x) * f;
      const py = _specPrev.y + (SPEC.pos.y - _specPrev.y) * f;
      const pz = _specPrev.z + (SPEC.pos.z - _specPrev.z) * f;
      if (!pointSolid(px, py, pz)) { SPEC.pos.set(px, py, pz); break; }
      if (i === 20) SPEC.pos.copy(_specPrev);
    }
  }
  camera.position.copy(SPEC.pos);
  camera.lookAt(SPEC.look);
}

function respawnActor(a) {
  /* indexOf() is -1 for any actor that is not in G.bots (a training dummy, or
     anything already torn down); -1 % 5 is still -1 in JS, which used to index
     the spawn list out of bounds. */
  const slot = a.isPlayer ? 5 : Math.max(0, G.bots.indexOf(a)) % 5;
  finishSpawn(a, slot);
  if (a.mesh) { a.mesh.position.copy(a.pos); a.mesh.visible = true; }
  if (a.isPlayer) {
    $('carryBanner').classList.remove('show');
    G.player.yaw = 0; G.player.pitch = 0;
    /* leave the bystander camera behind — but blend out of it: the death pose
       can be looking straight down, so snapping to first person whipped the
       view 90 deg in one frame */
    _exitPos.copy(camera.position);
    _exitQuat.copy(camera.quaternion);
    a.viewBlend = VIEW_BLEND;
    G.killer = null; G.killerWeapon = '';
    SPEC.t = 0; SPEC.init = false; SPEC.spot = -1;
    if (VM.group) VM.group.visible = true;
    const kb = $('killBy');
    if (kb) kb.classList.remove('show');
  }
}

