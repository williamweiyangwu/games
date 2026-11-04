/* ============================================================
   67-hill.js
   King of the Hill: one zone, one rule
   ============================================================ */
'use strict';

/* ------------------------------------------------------------
   THE HILL
   ------------------------------------------------------------
   One circle in the middle of the map. Stand in it with no enemy in it and
   your team's score goes up one point per second. Nothing else: no capture
   timer, no zone that jumps around, no hidden progress bars. Whoever holds
   the circle for 90 seconds first wins.

   It sits on top of the plinth when the map has one, which makes the middle
   of the map the high ground and the fight for it obvious. */
const HILL = {
  active: false,
  r: 4.6,
  pos: new THREE.Vector3(),
  holder: '',            // '' none, 'red', 'blue', or 'contested'
  acc: { red: 0, blue: 0 },
  group: null,
  ring: null,
  beam: null,
  disc: null,
  capT: 0
};

const HILL_COL = {
  '': 0xc9d4e2,
  red: 0xff5a5a,
  blue: 0x5a8dff,
  contested: 0xffc44d
};

function createHill() {
  if (HILL.group) { disposeTree(HILL.group); HILL.group = null; }
  HILL.active = (G.mode === 'koth');
  HILL.holder = '';
  HILL.acc.red = 0; HILL.acc.blue = 0;
  HILL.capT = 0;

  if (G.plinth) {
    HILL.pos.set(0, G.plinth.y, 0);
    HILL.r = Math.min(4.6, G.plinth.r * 0.86);
  } else {
    /* no plinth: snap to the walkable node nearest the middle, so the circle
       is never half inside a wall. It is kept inside one cell — at 4.6 m it
       swallowed the walls around it and you could hold the hill from the far
       side of a wall. */
    const n = nearestNode(0, 0, 0);
    HILL.pos.set(n ? n.x : 0, n ? (n.y || 0) : 0, n ? n.z : 0);
    HILL.r = 3.2;
  }

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

function hillTint(col) {
  if (!HILL.group) return;
  HILL.ring.material.color.setHex(col);
  HILL.beam.material.color.setHex(col);
  HILL.disc.material.color.setHex(col);
}

/* who is standing in it right now */
function hillOccupancy() {
  let red = 0, blue = 0;
  for (const a of objActors()) {
    if (!a.alive) continue;
    if (Math.abs(a.pos.y - HILL.pos.y) > 3.2) continue;
    if (Math.hypot(a.pos.x - HILL.pos.x, a.pos.z - HILL.pos.z) > HILL.r) continue;
    if (a.team === 'red') red++; else blue++;
  }
  return { red, blue };
}

/* the ring, the beam and the pulse — pure presentation, so a guest can run it
   against the host's holder without touching the score */
function hillPaint(dt) {
  HILL.capT += dt;
  const col = HILL.holder ? HILL_COL[HILL.holder] : HILL_COL[''];
  hillTint(col);
  if (HILL.ring) HILL.ring.material.opacity = 0.55 + 0.3 * Math.abs(Math.sin(HILL.capT * 2.4));
  /* The beam exists so you can find the hill from across the map. Standing in
     it, all it does is wash the screen yellow and show its own open top as a
     bright diamond against the sky, so it fades out when you are inside. */
  if (HILL.beam) {
    const p = G.player;
    const inside = p && Math.hypot(p.pos.x - HILL.pos.x, p.pos.z - HILL.pos.z) < HILL.r + 1;
    HILL.beam.material.opacity = inside ? 0.012 : (HILL.holder ? 0.16 : 0.09);
  }
}

function updateHill(dt) {
  if (G.mode !== 'koth' || !HILL.active || G.state !== 'playing') return;

  /* Online the host holds the circle and the score; a guest draws the state it
     is sent (netApplyObj) and must not count its own seconds. */
  if (G.netMode && !NET.isHost) { hillPaint(dt); hillHud(); return; }

  const occ = hillOccupancy();
  const solo = occ.red > 0 && occ.blue === 0 ? 'red'
    : occ.blue > 0 && occ.red === 0 ? 'blue' : '';
  const was = HILL.holder;
  HILL.holder = solo || (occ.red > 0 && occ.blue > 0 ? 'contested' : '');

  if (solo) {
    HILL.acc[solo] += dt;
    /* the score strip is the feedback, so it just counts up */
    G.score.red = Math.floor(HILL.acc.red);
    G.score.blue = Math.floor(HILL.acc.blue);
    if (HILL.holder !== was && G.player && solo === G.player.team) {
      Snd.tone(560, 760, 0.16, 0.12, 'triangle');
      banner('<span class="hl">YOU HOLD THE HILL</span> — KEEP THEM OFF IT', 2.0);
    }
    checkRoundEnd();
    if (G.state !== 'playing') return;
  }

  hillPaint(dt);
  hillHud(occ);
}

function hillHud(occ) {
  const el = $('hillBar');
  if (!el) return;
  if (G.mode !== 'koth') { el.classList.remove('show'); return; }
  el.classList.add('show');

  const limit = modeDef('koth').limit;
  const mine = G.player ? G.player.team : 'red';
  const holder = HILL.holder;
  const lead = (holder === 'red' || holder === 'blue')
    ? HILL.acc[holder] : Math.max(HILL.acc.red, HILL.acc.blue);

  const fill = $('hillFill');
  if (fill) {
    fill.style.width = Math.max(0, Math.min(100, lead / limit * 100)) + '%';
    fill.style.background = holder === 'contested' ? '#ffc44d'
      : holder === mine ? '#7fe08a' : holder ? '#ff7a7a' : '#9fb0c4';
  }
  const txt = $('hillState');
  if (txt) {
    txt.textContent = holder === 'contested' ? 'CONTESTED'
      : holder === mine ? 'YOU HOLD'
        : holder ? teamLabel(holder) + ' HOLDS'
          : 'ZONE EMPTY';
  }
  const sc = $('hillScore');
  if (sc) sc.textContent = Math.floor(HILL.acc.red) + ' — ' + Math.floor(HILL.acc.blue);
}
