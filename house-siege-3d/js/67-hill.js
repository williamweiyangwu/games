/* ============================================================
   67-hill.js
   King of the Hill: the capture zone, its anchors and its scoring
   ============================================================ */
'use strict';

/* ------------------------------------------------------------
   THE HILL
   ------------------------------------------------------------
   One zone, one holder. Stand in it, uncontested, and it banks to your team
   after HILL.need seconds; then it jumps to the next anchor so the match keeps
   moving instead of becoming a five-minute siege of one doorway.

   Scoring is deliberately not "1 point per second in the zone": with a 5v5 and
   respawns, a team that gets there first would run the clock out. Taking the
   hill and losing it is what should cost you. */
const HILL = {
  active: false,
  idx: 0,
  r: 4.6,
  need: 4.0,
  pos: new THREE.Vector3(),
  anchors: [],
  holder: '',            // '' none, 'red', 'blue', or 'contested'
  prog: { red: 0, blue: 0 },
  group: null,
  ring: null,
  beam: null,
  capT: 0
};

const HILL_COL = {
  '': 0xc9d4e2,
  red: 0xff5a5a,
  blue: 0x5a8dff,
  contested: 0xffc44d
};

function hillAnchors() {
  const MH = MAP.mazeHalf;
  const raw = [
    { x: 0, z: 0 },
    { x: 0, z: -MH * 0.58 },
    { x: MH * 0.58, z: 0 },
    { x: 0, z: MH * 0.58 },
    { x: -MH * 0.58, z: 0 }
  ];
  const out = [];
  for (const p of raw) {
    /* snap to a real navigation node so the zone is never inside a wall */
    const n = nearestNode(p.x, p.z, 0);
    if (!n) continue;
    if (out.some(q => Math.hypot(q.x - n.x, q.z - n.z) < 6)) continue;
    out.push({ x: n.x, z: n.z, y: n.y || 0 });
  }
  if (!out.length) out.push({ x: 0, z: 0, y: 0 });
  return out;
}

function createHill() {
  if (HILL.group) { disposeTree(HILL.group); HILL.group = null; }
  HILL.active = (G.mode === 'koth');
  HILL.idx = 0;
  HILL.holder = '';
  HILL.prog.red = 0; HILL.prog.blue = 0;
  HILL.capT = 0;
  HILL.anchors = hillAnchors();
  const a = HILL.anchors[0];
  HILL.pos.set(a.x, a.y, a.z);

  const g = new THREE.Group();
  g.userData.dyn = true;

  /* a soft column of light — visible over the maze walls from anywhere */
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(HILL.r * 0.92, HILL.r, 14, 28, 1, true),
    new THREE.MeshBasicMaterial({
      color: HILL_COL[''], transparent: true, opacity: 0.10,
      side: THREE.DoubleSide, depthWrite: false, fog: false
    })
  );
  beam.position.y = 7;
  g.add(beam);

  /* the floor disc is what actually reads at ground level */
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(HILL.r, 40),
    new THREE.MeshBasicMaterial({
      color: HILL_COL[''], transparent: true, opacity: 0.20,
      side: THREE.DoubleSide, depthWrite: false
    })
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.06;
  g.add(disc);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(HILL.r - 0.22, HILL.r, 48),
    new THREE.MeshBasicMaterial({
      color: HILL_COL[''], transparent: true, opacity: 0.85,
      side: THREE.DoubleSide, depthWrite: false
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.08;
  g.add(ring);

  g.position.copy(HILL.pos);
  g.visible = HILL.active;
  scene.add(g);
  HILL.group = g;
  HILL.ring = ring;
  HILL.beam = beam;
  HILL.disc = disc;
}

function hillMoveTo(idx) {
  if (!HILL.anchors.length) return;
  HILL.idx = ((idx % HILL.anchors.length) + HILL.anchors.length) % HILL.anchors.length;
  const a = HILL.anchors[HILL.idx];
  HILL.pos.set(a.x, a.y, a.z);
  if (HILL.group) HILL.group.position.copy(HILL.pos);
  HILL.prog.red = 0; HILL.prog.blue = 0;
  HILL.capT = 0;
}

function hillTint(col) {
  if (!HILL.group) return;
  HILL.ring.material.color.setHex(col);
  HILL.beam.material.color.setHex(col);
  HILL.disc.material.color.setHex(col);
}

/* who is standing in it right now */
function hillOccupancy() {
  let red = 0, blue = 0;
  for (const a of allActors()) {
    if (!a.alive) continue;
    if (Math.abs(a.pos.y - HILL.pos.y) > 3.2) continue;
    if (Math.hypot(a.pos.x - HILL.pos.x, a.pos.z - HILL.pos.z) > HILL.r) continue;
    if (a.team === 'red') red++; else blue++;
  }
  return { red, blue };
}

function updateHill(dt) {
  if (G.mode !== 'koth' || !HILL.active || G.state !== 'playing') return;
  const occ = hillOccupancy();
  const solo = occ.red > 0 && occ.blue === 0 ? 'red'
    : occ.blue > 0 && occ.red === 0 ? 'blue' : '';

  if (solo) {
    HILL.holder = solo;
    HILL.prog[solo] += dt;
    /* holding against a live enemy is worth more than standing in an empty
       zone, but not so much that a single lucky push ends the match */
    if (HILL.prog[solo] >= HILL.need) {
      HILL.prog[solo] = 0;
      G.score[solo]++;
      hillTint(HILL_COL[solo]);
      if (solo === G.player.team) {
        Snd.flag();
        banner('<span class="hl">HILL TAKEN</span> — ' + G.score[solo] + ' / ' + modeDef('koth').limit, 2.2);
      } else {
        Snd.tone(240, 160, 0.3, 0.18, 'sawtooth');
        banner(teamLabel(solo) + ' TEAM TOOK THE HILL', 2.2);
      }
      checkRoundEnd();
      if (G.state === 'playing') hillMoveTo(HILL.idx + 1);
    }
  } else {
    /* contested or empty: neither side makes progress, and the leader bleeds a
       little so a stalemate does not freeze the zone forever */
    if (occ.red > 0 && occ.blue > 0) HILL.holder = 'contested';
    else HILL.holder = '';
    HILL.prog.red = Math.max(0, HILL.prog.red - dt * 0.35);
    HILL.prog.blue = Math.max(0, HILL.prog.blue - dt * 0.35);
  }

  HILL.capT += dt;
  const col = HILL.holder ? HILL_COL[HILL.holder] : HILL_COL[''];
  hillTint(col);
  /* pulse the ring faster the closer it is to being taken */
  const lead = Math.max(HILL.prog.red, HILL.prog.blue) / HILL.need;
  if (HILL.ring) HILL.ring.material.opacity = 0.55 + 0.3 * Math.abs(Math.sin(HILL.capT * (2 + lead * 6)));
  if (HILL.beam) HILL.beam.material.opacity = 0.07 + 0.10 * lead;

  /* the HUD strip shows the hold progress of whoever is on it */
  hillHud(occ);
}

function hillHud(occ) {
  const el = $('hillBar');
  if (!el) return;
  if (G.mode !== 'koth') { el.classList.remove('show'); return; }
  el.classList.add('show');
  const mine = G.player ? G.player.team : 'red';
  const mineProg = HILL.prog[mine] / HILL.need;
  const theirs = HILL.prog[otherTeam(mine)] / HILL.need;
  const fill = $('hillFill');
  if (fill) {
    fill.style.width = Math.max(0, Math.min(100, mineProg * 100)) + '%';
    fill.style.background = HILL.holder === 'contested' ? '#ffc44d'
      : HILL.holder === mine ? '#7fe08a' : '#ff7a7a';
  }
  const txt = $('hillState');
  if (txt) {
    txt.textContent = HILL.holder === 'contested' ? 'CONTESTED'
      : HILL.holder === mine ? 'HOLDING'
        : HILL.holder ? 'ENEMY HOLDING'
          : 'ZONE EMPTY';
  }
  const foeBar = $('hillFoe');
  if (foeBar) foeBar.style.width = Math.max(0, Math.min(100, theirs * 100)) + '%';
}
