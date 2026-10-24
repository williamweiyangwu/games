/* ============================================================
   40-actors.js
   Actor records, bot meshes, team creation and spawning
   ============================================================ */
'use strict';

/* ------------------------------------------------------------
   ACTORS
   ------------------------------------------------------------ */
const BOT_NAMES = ['VIPER', 'GHOST', 'HAWK', 'REAPER', 'FALCON', 'BISHOP', 'ROOK', 'NOMAD', 'WRAITH', 'TITAN', 'ECHO', 'SABLE', 'ORION', 'KILO', 'DELTA'];

function eyePos(a, out) {
  return (out || new V3()).set(a.pos.x, a.pos.y + (a.isPlayer ? CFG.player.eye : 1.52), a.pos.z);
}
function dirFromAngles(yaw, pitch, out) {
  /* keep the direction finite and away from the exact poles: at |pitch| = PI/2
     the horizontal basis collapses and the spread maths would divide by zero */
  const p = isFinite(pitch) ? (pitch > 1.45 ? 1.45 : pitch < -1.45 ? -1.45 : pitch) : 0;
  const y = isFinite(yaw) ? yaw : 0;
  const cp = Math.cos(p);
  return (out || new V3()).set(-Math.sin(y) * cp, Math.sin(p), -Math.cos(y) * cp);
}
function allActors() { return G.bots.concat(G.player ? [G.player] : []); }

function buildBotMesh(team) {
  const g = new THREE.Group();
  const col = team === 'red' ? 0xa32b2b : 0x2a4a9e;
  const suit = new THREE.MeshStandardMaterial({ color: col, roughness: 0.84, metalness: 0.05 });
  const suitDark = new THREE.MeshStandardMaterial({ color: team === 'red' ? 0x6b1c1c : 0x1b2f66, roughness: 0.88, metalness: 0.04 });
  const gear = new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.82, metalness: 0.14 });
  const gearDark = new THREE.MeshStandardMaterial({ color: 0x24272c, roughness: 0.86, metalness: 0.1 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc08a63, roughness: 0.9 });
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x191b1f, roughness: 0.55, metalness: 0.6 });
  const visorMat = new THREE.MeshStandardMaterial({ color: 0x17222e, roughness: 0.1, metalness: 0.9 });

  const add = (parent, geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const bx = (parent, w, h, d, x, y, z, mat) => add(parent, new THREE.BoxGeometry(w, h, d), mat, x, y, z);

  /* ---- legs (pivot at the hip) ---- */
  const mkLeg = (side) => {
    const pv = new THREE.Group();
    pv.position.set(side * 0.115, 0.9, 0);
    bx(pv, 0.17, 0.46, 0.19, 0, -0.23, 0, suitDark);       // thigh
    bx(pv, 0.15, 0.4, 0.17, 0, -0.66, 0.005, suit);        // shin
    bx(pv, 0.19, 0.11, 0.29, 0, -0.85, -0.04, gearDark);   // boot
    bx(pv, 0.18, 0.07, 0.2, 0, -0.02, 0, gear);            // hip pad
    g.add(pv);
    return pv;
  };
  const legL = mkLeg(-1), legR = mkLeg(1);

  /* ---- torso ---- */
  bx(g, 0.42, 0.52, 0.25, 0, 1.2, 0, suit);                // chest
  bx(g, 0.44, 0.34, 0.29, 0, 1.26, 0, gear);               // plate carrier
  bx(g, 0.3, 0.09, 0.31, 0, 1.36, 0, suitDark);            // chest strap
  bx(g, 0.12, 0.1, 0.09, -0.1, 1.18, -0.17, gearDark);     // mag pouch
  bx(g, 0.12, 0.1, 0.09, 0.1, 1.18, -0.17, gearDark);
  bx(g, 0.38, 0.12, 0.27, 0, 0.95, 0, gearDark);           // belt
  bx(g, 0.26, 0.32, 0.14, 0, 1.22, 0.2, gear);             // backpack
  bx(g, 0.44, 0.1, 0.27, 0, 1.47, 0, suit);                // shoulder yoke

  /* ---- head ---- */
  bx(g, 0.11, 0.08, 0.11, 0, 1.53, 0, skin);               // neck
  add(g, new THREE.SphereGeometry(0.135, 12, 10), skin, 0, 1.64, 0);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.152, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), suit);
  helmet.position.set(0, 1.655, 0); helmet.castShadow = true; g.add(helmet);
  bx(g, 0.3, 0.026, 0.24, 0, 1.628, -0.02, suitDark);      // brim
  bx(g, 0.2, 0.045, 0.03, 0, 1.645, -0.135, visorMat);     // visor
  bx(g, 0.05, 0.09, 0.03, 0, 1.72, 0.09, suitDark);        // helmet mount

  /* ---- arms (pivot at the shoulder) ---- */
  const mkArm = (side) => {
    const pv = new THREE.Group();
    pv.position.set(side * 0.265, 1.42, 0);
    bx(pv, 0.125, 0.28, 0.145, 0, -0.15, 0, suit);         // upper arm
    bx(pv, 0.105, 0.26, 0.125, 0, -0.41, 0.015, suitDark); // forearm
    bx(pv, 0.11, 0.1, 0.13, 0, -0.58, 0.03, gearDark);     // glove
    g.add(pv);
    return pv;
  };
  const armL = mkArm(-1), armR = mkArm(1);
  armL.rotation.set(1.36, 0, 0.5);
  armR.rotation.set(1.18, 0, -0.22);

  /* ---- weapon in hand ---- */
  const gun = new THREE.Group();
  gun.position.set(0.1, 1.1, -0.34);
  bx(gun, 0.06, 0.09, 0.5, 0, 0, 0, gunMat);               // receiver
  add(gun, new THREE.CylinderGeometry(0.014, 0.014, 0.3, 8), gunMat, 0, 0.02, -0.36).rotation.x = Math.PI / 2;
  bx(gun, 0.04, 0.12, 0.06, 0, -0.09, 0.02, gunMat);       // magazine
  bx(gun, 0.045, 0.05, 0.15, 0, -0.01, 0.22, gunMat);      // stock
  g.add(gun);

  /* ---- team ring ---- */
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.5, 24),
    new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.45, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; g.add(ring);

  return { group: g, legL, legR, armL, armR, gun, ring };
}

function makeActor(team, name, isPlayer) {
  return {
    team, name, isPlayer: !!isPlayer,
    pos: new V3(0, 0, team === 'red' ? 33 : -33),
    vel: new V3(),
    yaw: team === 'red' ? 0 : Math.PI,
    pitch: 0,
    hp: 100, maxHp: 100,
    alive: true, respawnT: 0, onGround: true,
    radius: 0.42, height: 1.8, speedMul: 1,
    kills: 0, deaths: 0, shots: 0, hits: 0,
    weapons: [], cur: 0, reloadT: 0, lastShot: 0,
    carrying: null, mesh: null, parts: null,
    target: null, lastSeen: new V3(), lastSeenT: 0,
    think: 0, reactT: 0, path: null, pathIdx: 0, goalPos: new V3(1e9, 0, 0),
    goalKind: '', goalLock: 0, huntTarget: null, defendPost: null, postT: 0,
    strafe: 1, strafeT: 0, burstT: 0, aimYaw: 0, aimPitch: 0,
    stuckX: 0, stuckZ: 0, stuckWin: 0, stuckT: 0, stuckStage: 0, nudgeT: 0, nudgeAng: 0, hopT: 0,
    arriveT: 0,
    animT: 0, np: null, diff: DIFF.normal, role: 'attack', hitFlash: 0,
    drawT: 0, stimT: 0, itemT: -99
  };
}

function spawnPoint(team, i) {
  const list = (G.spawns && G.spawns[team]) || [];
  if (!list.length) return new V3(0, 0, team === 'red' ? 20 : -20);
  /* normalise into range so a negative or huge index can never miss the list */
  const k = ((Math.floor(i) % list.length) + list.length) % list.length;
  const s = list[k];
  return new V3(s.x, 0, s.z);
}

function ensureBotGroup() {
  G.bots.length = 0;
  disposeTree(G._botGroup);          // also frees the bodies left in the old group
  G._botGroup = new THREE.Group();
  scene.add(G._botGroup);
}

function createTeams() {
  ensureBotGroup();

  const names = BOT_NAMES.slice().sort(() => Math.random() - 0.5);
  let ni = 0;
  const mine = G.team, foe = otherTeam(mine);

  // your team: four AI teammates alongside you
  for (let i = 0; i < CFG.botsPerTeam; i++) {
    const b = makeActor(mine, names[ni++], false);
    b.diff = DIFF[G.diff];
    b.role = i < 3 ? 'attack' : 'defend';
    finishSpawn(b, i);
    G.bots.push(b);
  }
  // enemy team: five bots
  for (let i = 0; i < CFG.botsPerTeam + 1; i++) {
    const b = makeActor(foe, names[ni++ % names.length], false);
    b.diff = DIFF[G.diff];
    b.role = i < 3 ? 'attack' : 'defend';
    finishSpawn(b, i);
    G.bots.push(b);
  }

  for (const b of G.bots) {
    const m = buildBotMesh(b.team);
    b.parts = m;
    b.mesh = m.group;
    G._botGroup.add(m.group);
    // nameplate
    const np = document.createElement('div');
    np.className = 'np ' + b.team;
    np.innerHTML = '<div class="np-name">' + b.name + '</div>' +
      '<div class="np-hp"><div class="np-fill"></div></div>' +
      '<div class="np-hpn">100</div>';
    $('nameplates').appendChild(np);
    b.np = np;
    b.npFill = np.querySelector('.np-fill');
    b.npHp = np.querySelector('.np-hpn');
  }
}

/* Keep bodies from occupying the same space. Bots yield most of the overlap to
   the player, so walking into a teammate nudges them aside instead of clipping. */
function separateActors() {
  const list = allActors();
  const R = CFG.player.radius * 2;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (!b.alive) continue;
      if (Math.abs(a.pos.y - b.pos.y) > 1.7) continue;
      let dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      let d = Math.hypot(dx, dz);
      if (d >= R) continue;
      if (d < 1e-4) { dx = 1; dz = 0; d = 1; }
      const wa = a.isPlayer ? 0.3 : 1, wb = b.isPlayer ? 0.3 : 1;
      const share = (R - d) / (wa + wb);
      dx /= d; dz /= d;
      a.pos.x -= dx * share * wa; a.pos.z -= dz * share * wa;
      b.pos.x += dx * share * wb; b.pos.z += dz * share * wb;
      resolveHorizontal(a);
      resolveHorizontal(b);
    }
  }
}

function finishSpawn(a, slot) {
  a.hp = a.maxHp = (a.isPlayer ? CFG.playerHp : a.diff.hp);
  a.alive = true;
  a.respawnT = 0;
  a.vel.set(0, 0, 0);
  a.carrying = null;
  a.capT = 0;
  a.reloadT = 0;
  a.lastHurtT = 0;
  a.drawT = 0;
  a.stimT = 0;
  a.itemT = -99;
  a.speedMul = 1;
  a.weapons = [
    { id: 'knife', mag: 0, res: 0 },
    { id: 'pistol', mag: WEAPONS.pistol.mag, res: WEAPONS.pistol.reserve }
  ];
  a.cur = 1;
  const sp = spawnPoint(a.team, slot || 0);
  a.pos.copy(sp);
  a.pos.y = groundAt(sp.x, sp.z, 1.2);
  a.yaw = a.team === 'red' ? 0 : Math.PI;
  a.pitch = 0;
  // fresh navigation state: no stale stuck history or half-walked path
  a.path = null; a.pathIdx = 0; a.goalPos.set(1e9, 0, 0); a.goalKind = ''; a.goalLock = 0;
  a.defendPost = null; a.postT = 0; a.huntTarget = null;
  /* catwalk sweep: staggered so a whole team does not rush the deck at once */
  a.deckPost = null;
  a.deckT = 0;
  a.deckCd = 5 + Math.random() * 22;
  a.grenadeCd = 6 + Math.random() * 8;
  a.stuckX = a.pos.x; a.stuckZ = a.pos.z; a.stuckWin = 0; a.stuckT = 0; a.stuckStage = 0; a.nudgeT = 0; a.hopT = 0;
  a.arriveT = 0;
  a.bestGoalD = 1e9;
  if (a.mesh) { a.mesh.visible = true; a.mesh.position.copy(a.pos); }
  if (a.np) a.np.style.opacity = '1';
}

