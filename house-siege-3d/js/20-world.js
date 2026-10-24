/* ============================================================
   20-world.js
   Map data, maze generation, the build itself, facade and dressing
   ============================================================ */
'use strict';

/* ------------------------------------------------------------
   WORLD BUILDING
   ------------------------------------------------------------ */
function addBox(cx, cy, cz, w, h, d, mat, opt) {
  opt = opt || {};
  const geo = new THREE.BoxGeometry(w, h, d);
  if (mat && mat.map && !opt.noUV) boxUV(geo, w, h, d, opt.uvScale || 2.4);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(cx, cy, cz);
  m.castShadow = opt.shadow !== false;
  m.receiveShadow = opt.receive !== false;
  scene.add(m);
  if (!opt.noBase && h > 2.6 && Math.min(w, d) <= 0.55 && cy - h / 2 < 0.2 && h < 9) {
    const along = w > d ? 'x' : 'z';
    const bw = along === 'x' ? w : 0.07;
    const bd = along === 'x' ? 0.07 : d;
    const bxp = along === 'x' ? cx : cx + (Math.random() < 0.5 ? 1 : -1) * (w / 2 + 0.035);
    const bzp = along === 'x' ? cz + (Math.random() < 0.5 ? 1 : -1) * (d / 2 + 0.035) : cz;
    const bb = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.14, bd), MAT.base);
    bb.position.set(bxp, 0.11, bzp);
    bb.receiveShadow = true;
    scene.add(bb);
  }
  if (opt.collide !== false) {
    G.colliders.push({
      minX: cx - w / 2, maxX: cx + w / 2,
      minY: cy - h / 2, maxY: cy + h / 2,
      minZ: cz - d / 2, maxZ: cz + d / 2,
      name: opt.name || ''
    });
  }
  return m;
}

/* wall running along X at fixed z, with door gaps */
function wallX(z, x1, x2, y0, y1, gaps, t, mat) {
  t = t || 0.36; mat = mat || MAT.wall;
  const segs = splitSegments(x1, x2, gaps);
  for (const [a, b] of segs) {
    if (b - a < 0.02) continue;
    addBox((a + b) / 2, (y0 + y1) / 2, z, b - a, y1 - y0, t, mat);
  }
}
/* wall running along Z at fixed x */
function wallZ(x, z1, z2, y0, y1, gaps, t, mat) {
  t = t || 0.36; mat = mat || MAT.wall;
  const segs = splitSegments(z1, z2, gaps);
  for (const [a, b] of segs) {
    if (b - a < 0.02) continue;
    addBox(x, (y0 + y1) / 2, (a + b) / 2, t, y1 - y0, b - a, mat);
  }
}
function splitSegments(a, b, gaps) {
  if (!gaps || !gaps.length) return [[a, b]];
  const g = gaps.slice().sort((p, q) => p[0] - q[0]);
  const out = []; let cur = a;
  for (const [g0, g1] of g) {
    if (g0 > cur) out.push([cur, g0]);
    cur = Math.max(cur, g1);
  }
  if (cur < b) out.push([cur, b]);
  return out;
}

/* ------------------------------------------------------------
   WORLD — an enclosed white maze. Level 1 is the labyrinth,
   level 2 is a catwalk platform running right around the edge.
   ------------------------------------------------------------ */
const MAP = {
  B: 36,             // outer wall centreline
  outerT: 0.7,       // outer wall thickness
  platY: 4.2,        // catwalk deck height
  mazeHalf: 29.5,    // maze extends +-this
  N: 13,             // maze cells per side
  wallH: 3.0,        // maze wall height
  wallT: 0.42,       // maze wall thickness
  railH: 1.15        // catwalk railing height
};
MAP.cs = (MAP.mazeHalf * 2) / MAP.N;
MAP.g0 = -MAP.mazeHalf;

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function cellCenter(i, j) {
  return { x: MAP.g0 + (i + 0.5) * MAP.cs, z: MAP.g0 + (j + 0.5) * MAP.cs };
}

/* Perfect maze from a randomised depth-first search, then a share of the walls
   knocked back out so there are loops — a pure tree maze makes every fight a
   cornering, which is miserable in a shooter. */
function genMaze(N, rnd) {
  const cells = [];
  for (let j = 0; j < N; j++) {
    const row = [];
    for (let i = 0; i < N; i++) row.push({ N: true, E: true, S: true, W: true, vis: false, carve: false });
    cells.push(row);
  }
  const stack = [[0, 0]];
  cells[0][0].vis = true;
  while (stack.length) {
    const i = stack[stack.length - 1][0], j = stack[stack.length - 1][1];
    const nb = [];
    if (j > 0 && !cells[j - 1][i].vis) nb.push([i, j - 1, 'N', 'S']);
    if (i < N - 1 && !cells[j][i + 1].vis) nb.push([i + 1, j, 'E', 'W']);
    if (j < N - 1 && !cells[j + 1][i].vis) nb.push([i, j + 1, 'S', 'N']);
    if (i > 0 && !cells[j][i - 1].vis) nb.push([i - 1, j, 'W', 'E']);
    if (!nb.length) { stack.pop(); continue; }
    const p = nb[(rnd() * nb.length) | 0];
    cells[j][i][p[2]] = false;
    cells[p[1]][p[0]][p[3]] = false;
    cells[p[1]][p[0]].vis = true;
    stack.push([p[0], p[1]]);
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    if (i < N - 1 && cells[j][i].E && rnd() < 0.20) { cells[j][i].E = false; cells[j][i + 1].W = false; }
    if (j < N - 1 && cells[j][i].S && rnd() < 0.20) { cells[j][i].S = false; cells[j + 1][i].N = false; }
  }
  return cells;
}

function buildWorld() {
  const N = MAP.N, cs = MAP.cs, g0 = MAP.g0, MH = MAP.mazeHalf, PY = MAP.platY;
  const B = MAP.B, OT = MAP.outerT;
  const outer = B + OT / 2;                 // outer face of the perimeter
  const deckC = (MH + outer) / 2;           // catwalk centreline
  const deckW = outer - MH;                 // catwalk width

  /* --- ground --- */
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), MAT.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.06;          // sit under the maze slab, no z-fighting
  ground.receiveShadow = true;
  scene.add(ground);

  /* --- maze floor --- */
  addBox(0, -0.08, 0, MH * 2 + 0.5, 0.16, MH * 2 + 0.5, MAT.mazeFloor, { name: 'mazefloor' });

  /* --- maze layout --- */
  const cells = genMaze(N, mulberry32(20261018));
  G.maze = cells;

  const openCell = (i, j) => {
    if (i < 0 || j < 0 || i >= N || j >= N) return;
    const c = cells[j][i];
    c.carve = true;
    if (c.W && i > 0) { c.W = false; cells[j][i - 1].E = false; }
    if (c.E && i < N - 1) { c.E = false; cells[j][i + 1].W = false; }
    if (c.N && j > 0) { c.N = false; cells[j - 1][i].S = false; }
    if (c.S && j < N - 1) { c.S = false; cells[j + 1][i].N = false; }
  };

  /* a two-cell well in the middle of each side, where the stairs go up */
  const RW = cs * 0.46;          // stair half width
  const RUN = 9.0;               // stair run
  const well = (minX, maxX, minZ, maxZ) => {
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x0 = g0 + i * cs, x1 = x0 + cs, z0 = g0 + j * cs, z1 = z0 + cs;
      if (x1 > minX && x0 < maxX && z1 > minZ && z0 < maxZ) openCell(i, j);
    }
  };
  well(-RW, RW, MH - RUN, MH);
  well(-RW, RW, -MH, -MH + RUN);
  well(MH - RUN, MH, -RW, RW);
  well(-MH, -MH + RUN, -RW, RW);

  /* open corner plazas: 3x3 cells knocked out so each HQ has room to fight in.
     red takes the south-west corner, blue the north-east. */
  const plaza = (i0, j0) => {
    for (let j = j0; j < j0 + 3; j++) for (let i = i0; i < i0 + 3; i++) openCell(i, j);
  };
  plaza(0, N - 3);
  plaza(N - 3, 0);

  const ramps = [
    { axis: 'z', minX: -RW, maxX: RW, minZ: MH - RUN, maxZ: MH, yAtMinZ: 0, yAtMaxZ: PY },
    { axis: 'z', minX: -RW, maxX: RW, minZ: -MH, maxZ: -MH + RUN, yAtMinZ: PY, yAtMaxZ: 0 },
    { axis: 'x', minX: MH - RUN, maxX: MH, minZ: -RW, maxZ: RW, yAtMinX: 0, yAtMaxX: PY },
    { axis: 'x', minX: -MH, maxX: -MH + RUN, minZ: -RW, maxZ: RW, yAtMinX: PY, yAtMaxX: 0 }
  ];
  for (const r of ramps) G.ramps.push(r);

  /* The four stair ramps are solid bulkheads that swallow the two cells they run
     through. A perfect DFS maze is a tree, so those cells can be the ONLY link
     between regions — with them blocked, half the map (and a whole team's HQ)
     gets walled off. Carve extra gaps until every non-ramp cell is reachable. */
  {
    const inRampCell = (i, j) => {
      const c = cellCenter(i, j);
      return G.ramps.some(r => c.x > r.minX - 0.3 && c.x < r.maxX + 0.3 && c.z > r.minZ - 0.3 && c.z < r.maxZ + 0.3);
    };
    const passable = (i, j) => i >= 0 && j >= 0 && i < N && j < N && !inRampCell(i, j);
    for (let guard = 0; guard < 60; guard++) {
      const comp = new Int16Array(N * N).fill(-1);
      let nc = 0;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        if (!passable(i, j) || comp[j * N + i] >= 0) continue;
        const q = [[i, j]]; comp[j * N + i] = nc;
        while (q.length) {
          const [a, b] = q.shift();
          const c = cells[b][a];
          if (!c.W && passable(a - 1, b) && comp[b * N + a - 1] < 0) { comp[b * N + a - 1] = nc; q.push([a - 1, b]); }
          if (!c.E && passable(a + 1, b) && comp[b * N + a + 1] < 0) { comp[b * N + a + 1] = nc; q.push([a + 1, b]); }
          if (!c.N && passable(a, b - 1) && comp[(b - 1) * N + a] < 0) { comp[(b - 1) * N + a] = nc; q.push([a, b - 1]); }
          if (!c.S && passable(a, b + 1) && comp[(b + 1) * N + a] < 0) { comp[(b + 1) * N + a] = nc; q.push([a, b + 1]); }
        }
        nc++;
      }
      if (nc <= 1) break;
      let carved = false;
      for (let j = 0; j < N && !carved; j++) for (let i = 0; i < N && !carved; i++) {
        if (!passable(i, j)) continue;
        if (i < N - 1 && passable(i + 1, j) && comp[j * N + i] !== comp[j * N + i + 1]) {
          cells[j][i].E = false; cells[j][i + 1].W = false; carved = true;
        } else if (j < N - 1 && passable(i, j + 1) && comp[j * N + i] !== comp[(j + 1) * N + i]) {
          cells[j][i].S = false; cells[j + 1][i].N = false; carved = true;
        }
      }
      if (!carved) break;
    }
  }

  /* --- maze walls: collinear runs merged so the collider list stays small --- */
  for (let i = 1; i < N; i++) {
    let run = -1;
    for (let j = 0; j <= N; j++) {
      const has = j < N && cells[j][i].W;
      if (has && run < 0) run = j;
      if (!has && run >= 0) {
        addBox(g0 + i * cs, MAP.wallH / 2, g0 + (run + j) / 2 * cs,
          MAP.wallT, MAP.wallH, (j - run) * cs + MAP.wallT, MAT.mazeWall, { name: 'maze' });
        run = -1;
      }
    }
  }
  for (let j = 1; j < N; j++) {
    let run = -1;
    for (let i = 0; i <= N; i++) {
      const has = i < N && cells[j][i].N;
      if (has && run < 0) run = i;
      if (!has && run >= 0) {
        addBox(g0 + (run + i) / 2 * cs, MAP.wallH / 2, g0 + j * cs,
          (i - run) * cs + MAP.wallT, MAP.wallH, MAP.wallT, MAT.mazeWall, { name: 'maze' });
        run = -1;
      }
    }
  }

  /* --- catwalk: solid parapet block all round, deck on top --- */
  addBox(0, PY / 2, deckC, outer * 2, PY, deckW, MAT.mazeWall, { name: 'deckS' });
  addBox(0, PY / 2, -deckC, outer * 2, PY, deckW, MAT.mazeWall, { name: 'deckN' });
  addBox(deckC, PY / 2, 0, deckW, PY, MH * 2, MAT.mazeWall, { name: 'deckE' });
  addBox(-deckC, PY / 2, 0, deckW, PY, MH * 2, MAT.mazeWall, { name: 'deckW' });

  /* dark trim along the inner lip so the two levels read apart */
  const trim = (x, z, w, d) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.07, d), MAT.deckEdge);
    m.position.set(x, PY + 0.035, z); m.receiveShadow = true; scene.add(m);
  };
  trim(0, MH - 0.09, MH * 2, 0.18);
  trim(0, -MH + 0.09, MH * 2, 0.18);
  trim(MH - 0.09, 0, 0.18, MH * 2);
  trim(-MH + 0.09, 0, 0.18, MH * 2);

  /* metal deck plate on top of the white parapet */
  const plate = (x, z, w, d) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), MAT.deck);
    m.position.set(x, PY + 0.025, z); m.receiveShadow = true; scene.add(m);
  };
  plate(0, deckC, outer * 2 - 0.1, deckW - 0.1);
  plate(0, -deckC, outer * 2 - 0.1, deckW - 0.1);
  plate(deckC, 0, deckW - 0.1, MH * 2 - 0.1);
  plate(-deckC, 0, deckW - 0.1, MH * 2 - 0.1);

  /* --- outer wall above the deck: sealed, no way out ---
     runs corner to corner, not just across the maze, or you can walk
     straight off the deck corners onto the grass */
  const wallTop = 11.0;
  wallX(B, -outer, outer, PY, wallTop, [], OT, MAT.mazeWall);
  wallX(-B, -outer, outer, PY, wallTop, [], OT, MAT.mazeWall);
  wallZ(B, -outer, outer, PY, wallTop, [], OT, MAT.mazeWall);
  wallZ(-B, -outer, outer, PY, wallTop, [], OT, MAT.mazeWall);

  /* --- railings on the inner edge, open only where each stair arrives ---
     the gap is the ramp width plus a hair: any wider and you can stroll
     off the catwalk through the railing right beside the stairs */
  const gap = RW + 0.45;
  wallX(MH, -MH, MH, PY, PY + MAP.railH, [[-gap, gap]], 0.14, MAT.rail);
  wallX(-MH, -MH, MH, PY, PY + MAP.railH, [[-gap, gap]], 0.14, MAT.rail);
  wallZ(MH, -MH, MH, PY, PY + MAP.railH, [[-gap, gap]], 0.14, MAT.rail);
  wallZ(-MH, -MH, MH, PY, PY + MAP.railH, [[-gap, gap]], 0.14, MAT.rail);
  // posts
  for (const s of [-1, 1]) {
    for (let t = -26; t <= 26; t += 6.5) {
      if (Math.abs(t) < gap + 1.5) continue;
      addBox(t, PY + MAP.railH / 2, s * MH, 0.1, MAP.railH, 0.1, MAT.rail, { collide: false, shadow: false });
      addBox(s * MH, PY + MAP.railH / 2, t, 0.1, MAP.railH, 0.1, MAT.rail, { collide: false, shadow: false });
    }
  }

  /* --- stairs: solid boxes from the floor up. The smooth ramp in groundAt
     still does the lifting, so the 0.26 m rises are walked, not jumped —
     but the steps themselves are REAL: without colliders you could walk
     into the staircase from the side at ground level and clip straight
     through the white steps (and shoot through them). --- */
  const STEPS = 16;
  for (const r of ramps) {
    const along = r.axis === 'x' ? (r.maxX - r.minX) : (r.maxZ - r.minZ);
    const run = along / STEPS;
    for (let s = 0; s < STEPS; s++) {
      const t = (s + 0.5) / STEPS;
      if (r.axis === 'x') {
        const h = r.yAtMinX + (r.yAtMaxX - r.yAtMinX) * t;
        addBox(r.minX + (r.maxX - r.minX) * t, h / 2, 0, run + 0.02, Math.max(0.12, h), RW * 2,
          MAT.mazeWall, { noBase: true, name: 'step' });
      } else {
        const h = r.yAtMinZ + (r.yAtMaxZ - r.yAtMinZ) * t;
        addBox(0, h / 2, r.minZ + (r.maxZ - r.minZ) * t, RW * 2, Math.max(0.12, h), run + 0.02,
          MAT.mazeWall, { noBase: true, name: 'step' });
      }
    }
  }

  /* --- lighting --- */
  const fill = (x, y, z, i) => {
    const l = new THREE.PointLight(0xfff0d8, i, 30, 1.5);
    l.position.set(x, y, z);
    scene.add(l);
  };
  fill(0, PY + 2.4, 0, 0.45);
  fill(0, 3.0, MH - 4, 0.55);
  fill(0, 3.0, -MH + 4, 0.55);
  fill(MH - 4, 3.0, 0, 0.55);
  fill(-MH + 4, 3.0, 0, 0.55);

  /* --- team HQs: centred in the open corner plazas --- */
  const plazaCentre = (i0, j0) => cellCenter(i0 + 1, j0 + 1);
  G.hq = { red: plazaCentre(0, N - 3), blue: plazaCentre(N - 3, 0) };

  for (const t of ['red', 'blue']) {
    const h = G.hq[t];
    addBox(h.x, 0.055, h.z, 5.4, 0.11, 5.4, MAT.pad, { name: t + 'hq' });
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.9, 2.25, 40),
      new THREE.MeshBasicMaterial({ color: t === 'red' ? 0xff4a4a : 0x4d8dff, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(h.x, 0.14, h.z);
    scene.add(ring);
    G[t + 'Ring'] = ring;
  }

  /* --- spawn slots: the six cells nearest each HQ --- */
  G.spawns = { red: [], blue: [] };
  for (const t of ['red', 'blue']) {
    const h = G.hq[t];
    const all = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const c = cellCenter(i, j);
      all.push({ x: c.x, z: c.z, d: Math.hypot(c.x - h.x, c.z - h.z) });
    }
    all.sort((a, b) => a.d - b.d);
    G.spawns[t] = all.slice(0, 6).map(p => ({ x: p.x, z: p.z }));
  }

  /* --- weapon crates: open ground only, never tucked into a dead end ---
     one in each HQ plaza, the rest spread over maze junctions (cells with
     three or more openings), plus two up on the catwalk. */
  const junctions = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const c = cells[j][i];
    if (c.carve) continue;
    const openings = (c.W ? 0 : 1) + (c.E ? 0 : 1) + (c.N ? 0 : 1) + (c.S ? 0 : 1);
    if (openings >= 3) junctions.push(cellCenter(i, j));
  }
  const spots = [
    { x: G.hq.red.x + MAP.cs, z: G.hq.red.z + MAP.cs },      // red plaza, inner corner
    { x: G.hq.blue.x - MAP.cs, z: G.hq.blue.z - MAP.cs }     // blue plaza, inner corner
  ];
  while (spots.length < 6 && junctions.length) {
    let best = null, bd = -1;
    for (const d of junctions) {
      if (spots.indexOf(d) >= 0) continue;
      let md = 1e9;
      for (const s of spots) md = Math.min(md, Math.hypot(d.x - s.x, d.z - s.z));
      if (md > bd) { bd = md; best = d; }
    }
    if (!best) break;
    spots.push(best);
  }
  while (spots.length < 6) {
    const p = cellCenter(3 + spots.length * 2, 3 + spots.length * 2);
    spots.push(p);
  }
  spots.push({ x: -deckC, z: 11, y: PY });
  spots.push({ x: deckC, z: -11, y: PY });
  G.chestSpots = spots.map(s => [s.x, s.y || 0, s.z]);

  mergeStaticWorld();
  buildWaypoints();
}



/* ------------------------------------------------------------
   FACADE DETAIL (windows, plinth, cornice)
   ------------------------------------------------------------ */
/* ------------------------------------------------------------
   STATIC GEOMETRY MERGE
   Collapses the (large) static level into one mesh per material so the
   renderer issues a couple of dozen draw calls instead of a thousand.
   ------------------------------------------------------------ */
function mergeStaticWorld() {
  const byMat = new Map();
  const victims = [];
  scene.traverse(o => {
    if (!o.isMesh || o.userData.dyn) return;
    if (!o.geometry || !o.material || Array.isArray(o.material)) return;
    if (o.material.type === 'ShaderMaterial') return;
    if (o.geometry.attributes.position === undefined) return;
    victims.push(o);
  });

  for (const m of victims) {
    m.updateWorldMatrix(true, false);
    const src = m.geometry;
    const g = (src.index ? src.toNonIndexed() : src.clone());
    g.applyMatrix4(m.matrixWorld);
    const key = m.material.uuid;
    let rec = byMat.get(key);
    if (!rec) { rec = { mat: m.material, list: [], cast: false, recv: false }; byMat.set(key, rec); }
    rec.list.push(g);
    rec.cast = rec.cast || m.castShadow;
    rec.recv = rec.recv || m.receiveShadow;
  }

  for (const m of victims) {
    if (m.parent) m.parent.remove(m);
    if (m.geometry && !m.geometry.userData.keep) m.geometry.dispose();
  }

  for (const rec of byMat.values()) {
    let total = 0;
    for (const g of rec.list) total += g.attributes.position.count;
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const uv = new Float32Array(total * 2);
    let off = 0;
    for (const g of rec.list) {
      const n = g.attributes.position.count;
      pos.set(g.attributes.position.array, off * 3);
      if (g.attributes.normal) nor.set(g.attributes.normal.array, off * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, off * 2);
      off += n;
      g.dispose();
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, rec.mat);
    mesh.castShadow = rec.cast;
    mesh.receiveShadow = rec.recv;
    mesh.userData.dyn = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
  }
}

