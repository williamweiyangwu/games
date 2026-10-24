/* ============================================================
   50-items.js
   Field aid, ammo, stim, grenades, crossbow and projectiles
   ============================================================ */
'use strict';

/* ------------------------------------------------------------
   ITEMS, THROWABLES AND PROJECTILES
   ------------------------------------------------------------ */
function pointSolid(x, y, z) {
  for (let i = 0; i < G.colliders.length; i++) {
    const c = G.colliders[i];
    if (x > c.minX && x < c.maxX && y > c.minY && y < c.maxY && z > c.minZ && z < c.maxZ) return true;
  }
  return false;
}

/* --- FIELD AID: the only way to get health back --- */
function useAid(a) {
  const st = a.weapons[a.cur];
  if (!st || st.id !== 'aid' || st.count <= 0) return;
  if (a.hp >= a.maxHp - 0.01) {
    banner('HEALTH IS ALREADY FULL', 1.1);
    Snd.empty();
    return;
  }
  const before = a.hp;
  a.hp = Math.min(a.maxHp, a.hp + ITEMS.aid.heal);
  a.itemT = G.t;
  st.count--;
  Snd.heal();
  banner('+ ' + Math.round(a.hp - before) + ' HP', 0.9);
  if (st.count <= 0) consumeSlot(a, a.cur);
}

/* --- AMMO BOX: tops up every reserve you are carrying --- */
function useAmmo(a) {
  const st = a.weapons[a.cur];
  if (!st || st.id !== 'ammo' || st.count <= 0) return;
  let filled = 0;
  for (const s of a.weapons) {
    const w = WEAPONS[s.id];
    if (!w || w.melee) continue;
    if (s.res < w.reserve) { s.res = w.reserve; filled++; }
  }
  if (!filled) { banner('ALL RESERVES ALREADY FULL', 1.1); Snd.empty(); return; }
  st.count--;
  a.itemT = G.t;
  Snd.reload();
  banner('AMMO RESUPPLIED', 1.2);
  if (st.count <= 0) consumeSlot(a, a.cur);
}

/* --- STIM SHOT: a short burst of speed --- */
function useStim(a) {
  const st = a.weapons[a.cur];
  if (!st || st.id !== 'stim' || st.count <= 0) return;
  st.count--;
  a.itemT = G.t;
  a.stimT = ITEMS.stim.dur;
  Snd.stim();
  banner('STIM ACTIVE — FASTER FOR ' + ITEMS.stim.dur + 's', 1.4);
  if (st.count <= 0) consumeSlot(a, a.cur);
}

/* --- GRENADE -------------------------------------------------
   The arc is simulated with the same gravity and the same collider set the
   real grenade uses, so what you see is what you get. */
const NADE_STEPS = 90;
const NADE_DT = 0.045;

function grenadeDir(a, out) {
  /* same convention the camera uses (YXZ from yaw/pitch), so the preview and
     the real throw agree even before the camera matrix is refreshed */
  return dirFromAngles(a.yaw, a.pitch, out || new V3());
}
function grenadeOrigin(a, out) {
  /* Launch from arm's length, not from the eyeball: a grenade spawned half a
     metre from a 78deg camera fills a third of the screen for the first frames
     and reads as a giant ball hovering in front of you. Step it back if that
     spot is inside a wall, so a throw while hugging cover still works. */
  const o = out || new V3();
  const eye = eyePos(a, new V3());
  const dir = grenadeDir(a, new V3());
  let d = 1.05;
  o.copy(eye).addScaledVector(dir, d); o.y -= 0.14;
  while (d > 0.35 && pointSolid(o.x, o.y, o.z)) {
    d -= 0.2;
    o.copy(eye).addScaledVector(dir, d); o.y -= 0.14;
  }
  return o;
}
function grenadeVelocity(a, out) {
  const v = (out || new V3()).copy(grenadeDir(a, new V3())).multiplyScalar(ITEMS.grenade.speed);
  v.y += 1.2;                       // a little loft so a level aim still lobs
  return v;
}

function grenadeTrajectory(from, vel) {
  const pts = [from.clone()];
  const pos = from.clone(), v = vel.clone();
  let impact = from.clone();
  for (let i = 0; i < NADE_STEPS; i++) {
    v.y -= CFG.gravity * NADE_DT;
    const nx = pos.x + v.x * NADE_DT, ny = pos.y + v.y * NADE_DT, nz = pos.z + v.z * NADE_DT;
    if (pointSolid(nx, ny, nz)) { impact = pos.clone(); break; }
    pos.set(nx, ny, nz);
    const g = groundAt(pos.x, pos.z, pos.y + 0.4);
    if (pos.y <= g + 0.06) { pos.y = g + 0.06; pts.push(pos.clone()); impact = pos.clone(); break; }
    pts.push(pos.clone());
    impact = pos.clone();
  }
  return { pts, impact };
}

function ensureAimLine() {
  if (G.aimLine) return G.aimLine;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NADE_STEPS * 3 + 3), 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xffcc55, transparent: true, opacity: 0.95, depthTest: false });
  const line = new THREE.Line(geo, mat);
  line.frustumCulled = false;
  line.renderOrder = 998;
  line.visible = false;
  scene.add(line);
  G.aimLine = line;

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.58, 20),
    new THREE.MeshBasicMaterial({ color: 0xffcc55, transparent: true, opacity: 0.75, depthTest: false, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  ring.renderOrder = 999;
  scene.add(ring);
  G.aimMark = ring;
  return line;
}

function hideAimLine() {
  if (G.aimLine) G.aimLine.visible = false;
  if (G.aimMark) G.aimMark.visible = false;
}

/* True when the arc or its blast would catch an enemy. */
function arcThreatensEnemy(pts, impact, owner) {
  if (!owner) return false;
  const r = ITEMS.grenade.radius;
  for (const a of allActors()) {
    if (!a || !a.alive || a === owner || a.team === owner.team) continue;
    const chest = new V3(a.pos.x, a.pos.y + 0.9, a.pos.z);
    /* an enemy on the far side of a wall is not in the blast */
    if (Math.hypot(a.pos.x - impact.x, a.pos.z - impact.z) < r * 0.9 &&
        Math.abs(chest.y - impact.y) < r && hasBlastLine(impact, chest)) return true;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (Math.abs(p.y - chest.y) < 1.2 &&
          Math.hypot(p.x - a.pos.x, p.z - a.pos.z) < 1.1) return true;
    }
  }
  return false;
}

function updateGrenadeAim(p) {
  const st = p.weapons[p.cur];
  const want = firing && G.state === 'playing' && p.alive && st && st.id === 'grenade' && st.count > 0;
  if (!want) { hideAimLine(); return; }
  const line = ensureAimLine();
  const from = grenadeOrigin(p, new V3());
  const vel = grenadeVelocity(p, new V3());
  const { pts, impact } = grenadeTrajectory(from, vel);

  const pos = line.geometry.attributes.position;
  const arr = pos.array;
  const n = Math.min(pts.length, NADE_STEPS + 1);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = pts[i].x; arr[i * 3 + 1] = pts[i].y; arr[i * 3 + 2] = pts[i].z;
  }
  pos.needsUpdate = true;
  line.geometry.setDrawRange(0, n);
  line.geometry.computeBoundingSphere();

  const danger = arcThreatensEnemy(pts, impact, p);
  const col = danger ? 0xff3b28 : 0xffcc55;
  line.material.color.setHex(col);
  line.visible = true;

  const mark = G.aimMark;
  mark.material.color.setHex(col);
  mark.position.set(impact.x, impact.y + 0.03, impact.z);
  mark.visible = true;
}

function spawnProjectile(type, pos, vel, owner) {
  let mesh;
  if (type === 'nade') {
    /* a real frag body is ~11 cm tall — keep it that size so it reads as a
       grenade instead of a beach ball when it leaves your hand */
    mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0x3f5a3c, roughness: 0.65, metalness: 0.35, emissive: 0x0d1409 })
    );
    mesh.scale.set(1, 1.15, 1);
  } else {
    mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.024, 0.024, 0.52, 6),
      new THREE.MeshStandardMaterial({ color: 0x7a5c34, roughness: 0.55, metalness: 0.45 })
    );
    const d = vel.clone().normalize();
    mesh.quaternion.setFromUnitVectors(new V3(0, 1, 0), d);
  }
  mesh.position.copy(pos);
  scene.add(mesh);

  const pr = {
    type, pos: pos.clone(), vel: vel.clone(), mesh, owner,
    gravity: type === 'nade' ? CFG.gravity : WEAPONS.crossbow.boltGravity,
    life: type === 'nade' ? ITEMS.grenade.fuse + 0.1 : 2.5,
    fuse: type === 'nade' ? ITEMS.grenade.fuse : 0,
    travelled: 0, bounces: 0
  };
  G.projectiles.push(pr);
  return pr;
}

function throwGrenade(a) {
  const st = a.weapons[a.cur];
  if (!st || st.id !== 'grenade' || st.count <= 0) return false;
  st.count--;
  a.lastShot = G.t;
  spawnProjectile('nade', grenadeOrigin(a, new V3()), grenadeVelocity(a, new V3()), a);
  Snd.throwNade();
  hideAimLine();
  if (st.count <= 0) consumeSlot(a, a.cur);
  return true;
}

function fireCrossbow(p) {
  const st = p.weapons[p.cur];
  const w = WEAPONS.crossbow;
  if (!st || st.id !== 'crossbow' || st.mag <= 0 || p.reloadT > 0) return;
  st.mag--;
  p.lastShot = G.t;
  const from = eyePos(p, new V3());
  const d = dirFromAngles(p.yaw, p.pitch, new V3());
  /* a whisper of spread so it is not a laser */
  d.x += rand(-w.spread, w.spread); d.y += rand(-w.spread, w.spread); d.z += rand(-w.spread, w.spread);
  d.normalize();
  spawnProjectile('bolt', from.clone().addScaledVector(d, 0.55), d.multiplyScalar(w.boltSpeed), p);
  Snd.bow();
  VM.kick = 0.85;
  VM.recoilV += 0.035;
  p.pitch = clamp(p.pitch + 0.012, -1.35, 1.35);
  if (st.mag <= 0) startReload(p);
}

function hasBlastLine(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 0.001) return true;
  const t = rayWorld(from.x, from.y, from.z, dx / len, dy / len, dz / len, len);
  return t < 0 || t > len - 0.35;
}

function explodeGrenade(pos, owner) {
  const spec = ITEMS.grenade;
  Snd.boom();

  /* Detonation: a hard red light flash right where it went off, plus a small
     hot core that fades fast. No giant sphere — the light is what sells it. */
  const light = new THREE.PointLight(0xff2a12, 11, 18, 1.6);
  light.position.copy(pos);
  light.position.y += 0.25;
  scene.add(light);

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xff3a18, transparent: true, opacity: 0.92, depthWrite: false })
  );
  core.position.copy(pos);
  scene.add(core);

  /* a flat red halo hugging the ground, so the blast point reads at a glance */
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(0.3, 0.62, 24),
    new THREE.MeshBasicMaterial({ color: 0xff2a14, transparent: true, opacity: 0.75,
                                  side: THREE.DoubleSide, depthWrite: false })
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.set(pos.x, Math.min(pos.y, groundAt(pos.x, pos.z, 1) + 0.04), pos.z);
  scene.add(halo);

  G.blasts.push({ mesh: core, light, halo, life: 0.30, max: 0.30 });

  for (let i = 0; i < 22; i++) {
    const g = new THREE.SphereGeometry(0.045, 4, 3);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: i % 3 ? 0xff4a1e : 0xffa050, transparent: true }));
    m.position.copy(pos);
    scene.add(m);
    G.particles.push({
      mesh: m, life: 0.35,
      vel: new V3(rand(-7, 7), rand(0.5, 8), rand(-7, 7))
    });
  }

  /* damage falls off with distance; a wall between you and the blast saves you */
  for (const a of allActors()) {
    if (!a || !a.alive) continue;
    if (owner && a !== owner && a.team === owner.team) continue;
    const dx = a.pos.x - pos.x, dy = (a.pos.y + 0.9) - pos.y, dz = a.pos.z - pos.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > spec.radius) continue;
    if (!hasBlastLine(pos, new V3(a.pos.x, a.pos.y + 0.9, a.pos.z))) continue;
    let dmg = spec.dmg * (1 - d / spec.radius);
    if (a === owner) dmg *= 0.4;
    damage(a, dmg, owner === a ? null : owner, false, 'GRENADE');
  }

  if (G.player && G.player.alive) {
    const pd = Math.hypot(G.player.pos.x - pos.x, G.player.pos.y + 0.9 - pos.y, G.player.pos.z - pos.z);
    G.shake = Math.max(G.shake, clamp(1 - pd / 24, 0, 1) * 0.5);
  }
}

function bounceGrenade(pr) {
  const ax = Math.abs(pr.vel.x), ay = Math.abs(pr.vel.y), az = Math.abs(pr.vel.z);
  if (ax >= ay && ax >= az) pr.vel.x *= -0.42;
  else if (ay >= ax && ay >= az) pr.vel.y *= -0.42;
  else pr.vel.z *= -0.42;
  pr.vel.x *= 0.78; pr.vel.z *= 0.78;
  pr.bounces++;
  if (pr.bounces < 4) Snd.bounce();
}

function updateProjectiles(dt) {
  for (let i = G.projectiles.length - 1; i >= 0; i--) {
    const pr = G.projectiles[i];
    pr.life -= dt;
    if (pr.type === 'nade') pr.fuse -= dt;

    let dead = false, boom = false;
    const steps = pr.type === 'bolt' ? 4 : 2;
    const h = dt / steps;

    for (let s = 0; s < steps && !dead; s++) {
      const prev = pr.pos.clone();
      pr.vel.y -= pr.gravity * h;
      pr.pos.addScaledVector(pr.vel, h);
      pr.travelled += prev.distanceTo(pr.pos);

      /* actors */
      const dir = pr.pos.clone().sub(prev);
      const len = dir.length();
      if (len > 1e-4) {
        dir.divideScalar(len);
        const hit = rayActors(prev.x, prev.y, prev.z, dir.x, dir.y, dir.z, len + 0.12, pr.owner);
        if (hit) {
          if (pr.type === 'bolt') {
            const head = pr.pos.y > hit.actor.pos.y + 1.42;
            damage(hit.actor, WEAPONS.crossbow.dmg * (head ? 1.6 : 1), pr.owner, head, 'BOLT');
            spark(pr.pos, 0xffe0a0, 6);
            dead = true;
          } else { boom = true; dead = true; }
          break;
        }
      }

      /* walls */
      if (pointSolid(pr.pos.x, pr.pos.y, pr.pos.z)) {
        if (pr.type === 'bolt') { spark(pr.pos, 0xd8d2c0, 4); dead = true; break; }
        pr.pos.copy(prev);
        bounceGrenade(pr);
        break;
      }

      /* floor */
      const g = groundAt(pr.pos.x, pr.pos.z, pr.pos.y + 0.4);
      if (pr.pos.y <= g + 0.07) {
        if (pr.type === 'bolt') { spark(pr.pos, 0xd8d2c0, 3); dead = true; break; }
        pr.pos.y = g + 0.07;
        if (Math.abs(pr.vel.y) < 1.4) { pr.vel.y = 0; pr.vel.x *= 0.72; pr.vel.z *= 0.72; }
        else { pr.vel.y = Math.abs(pr.vel.y) * 0.36; pr.vel.x *= 0.74; pr.vel.z *= 0.74; }
        pr.bounces++;
        if (pr.bounces < 4) Snd.bounce();
        break;
      }

      if (pr.type === 'bolt' && pr.travelled > WEAPONS.crossbow.range) { dead = true; break; }
    }

    if (pr.type === 'nade') {
      if (pr.fuse <= 0) boom = true;
      if (boom) { explodeGrenade(pr.pos, pr.owner); dead = true; }
    }
    /* `else if`: a very large dt (a headless simulate() step, or a hitch) can
       drive fuse and life negative in the same frame, which used to detonate
       the same grenade twice — double damage and two flashes. */
    else if (pr.life <= 0) {
      dead = true;
    }

    /* the mesh used to be left at its spawn point: a grenade then hung in
       mid-air in front of the camera while the real one flew off and blew up
       somewhere else. Follow the physics every frame. */
    if (!dead) {
      pr.mesh.position.copy(pr.pos);
      if (pr.type === 'nade') {
        pr.spin = (pr.spin || 0) + dt * 8.5;          // tumble in flight
        pr.mesh.rotation.set(pr.spin * 0.8, pr.spin, pr.spin * 0.35);
      } else {
        const d = pr.vel.clone().normalize();
        pr.mesh.quaternion.setFromUnitVectors(new V3(0, 1, 0), d);
      }
    }

    if (dead) {
      scene.remove(pr.mesh);
      pr.mesh.geometry.dispose();
      pr.mesh.material.dispose();
      G.projectiles.splice(i, 1);
    }
  }
}

function clearProjectiles() {
  for (const pr of G.projectiles) {
    scene.remove(pr.mesh);
    pr.mesh.geometry.dispose();
    pr.mesh.material.dispose();
  }
  G.projectiles.length = 0;
  for (const b of G.blasts) {
    scene.remove(b.mesh);
    b.mesh.geometry.dispose();
    b.mesh.material.dispose();
    if (b.light) scene.remove(b.light);
    if (b.halo) {
      scene.remove(b.halo);
      b.halo.geometry.dispose();
      b.halo.material.dispose();
    }
  }
  G.blasts.length = 0;
  hideAimLine();
}

function tryFire(a) {
  if (!a.alive) return;                 // a corpse cannot shoot or patch up
  const st = a.weapons[a.cur];
  if (!st) return;
  const w = defOf(st.id);
  if (!w) return;
  const t = G.t;

  /* --- consumables: one click, one charge --- */
  if (w.item) {
    if (!a.isPlayer) return;
    /* items keep their own cooldown so a gunshot does not swallow the click */
    if (t - a.itemT < 0.35) return;
    if (w.kind === 'aid') { useAid(a); return; }
    if (w.kind === 'ammo') { useAmmo(a); return; }
    if (w.kind === 'stim') { useStim(a); return; }
    return;                       // grenade is thrown on mouse release
  }

  /* --- crossbow: the bolt leaves when the draw is complete, not on click --- */
  if (w.draw) {
    if (a.reloadT > 0) return;
    if (st.mag <= 0) { if (a.isPlayer) startReload(a); return; }
    return;
  }

  if (a.reloadT > 0 || t - a.lastShot < w.rate) return;

  if (w.melee) {
    a.lastShot = t;
    if (a.isPlayer) { Snd.slash(); swingKnife(); }
    const eye = eyePos(a);
    const d = a.isPlayer ? camera.getWorldDirection(new V3()) : dirFromAngles(a.yaw, a.pitch, new V3());
    for (const o of allActors()) {
      if (o === a || o.team === a.team || !o.alive) continue;
      const to = new V3(o.pos.x - eye.x, o.pos.y + 1 - eye.y, o.pos.z - eye.z);
      const dist = to.length();
      if (dist > w.range) continue;
      to.normalize();
      if (to.dot(d) > 0.55) damage(o, w.dmg * (a.isPlayer ? 1 : a.diff.dmg), a, false, 'KNIFE');
    }
    return;
  }

  if (st.mag <= 0) {
    if (a.isPlayer) { Snd.empty(); startReload(a); }
    else startReload(a);
    return;
  }

  a.lastShot = t;
  st.mag--;
  a.shots++;
  if (a.isPlayer) {
    Snd.shot(w.snd || 'pistol', 1);
    addRecoil(w);
  } else {
    const dd = camera.position.distanceTo(a.pos);
    if (dd < 55) Snd.shot(w.snd || 'pistol', clamp(1 - dd / 55, 0.12, 0.85));
  }

  const origin = eyePos(a, new V3());
  let baseDir;
  if (a.isPlayer) baseDir = camera.getWorldDirection(new V3());
  else baseDir = dirFromAngles(a.yaw, a.pitch, new V3());

  const pellets = w.pellets || 1;
  const spread = a.isPlayer ? w.spread * playerMoveSpread() * (1 - 0.62 * (VM.ads || 0)) : (w.spread + a.diff.err);
  const muzzle = muzzlePos(a, new V3());

  for (let p = 0; p < pellets; p++) {
    const dir = baseDir.clone();
    const ang = Math.random() * Math.PI * 2;
    const mag = Math.sqrt(Math.random()) * spread;
    const right = new V3(-dir.z, 0, dir.x);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0); else right.normalize();
    const up = new V3().crossVectors(right, dir);
    if (up.lengthSq() < 1e-6) up.set(0, 1, 0); else up.normalize();
    dir.addScaledVector(right, Math.cos(ang) * mag).addScaledVector(up, Math.sin(ang) * mag);
    if (dir.lengthSq() < 1e-6) dir.copy(baseDir); else dir.normalize();

    const wallT = rayWorld(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, w.range);
    const hit = rayActors(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, wallT < 0 ? w.range : wallT, a);
    let endP;
    if (hit) {
      endP = origin.clone().addScaledVector(dir, hit.dist);
      const dmg = w.dmg * (hit.head ? 2.0 : 1) * (a.isPlayer ? 1 : a.diff.dmg);
      damage(hit.actor, dmg, a, hit.head, w.name.replace(/^(M9|MP5|AK-47|SPAS-12|AWP)\s*/, ''));
      a.hits++;
      spark(endP, 0xff5a5a, 6);
    } else if (wallT > 0) {
      endP = origin.clone().addScaledVector(dir, wallT);
      spark(endP, 0xd8d2c0, 4);
    } else {
      endP = origin.clone().addScaledVector(dir, w.range);
    }
    tracer(muzzle, endP, a.isPlayer ? 0xfff0a8 : 0xff9a6a);
  }
}

function playerMoveSpread() {
  const sp = Math.hypot(G.player.vel.x, G.player.vel.z);
  return 1 + sp * 0.35 + (G.player.onGround ? 0 : 0.8);
}

