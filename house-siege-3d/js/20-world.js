/* ============================================================
   20-world.js
   Map data, maze generation, the build itself, facade and dressing
   ============================================================ */
'use strict';

/* ------------------------------------------------------------
   WORLD BUILDING
   ------------------------------------------------------------ */
/* Everything the level builder creates hangs off one group, so switching map
   is a single removal instead of a hunt through the scene graph. */
let WORLD = null;
function addWorld(o) { (WORLD || scene).add(o); return o; }

function addBox(cx, cy, cz, w, h, d, mat, opt) {
  opt = opt || {};
  const geo = new THREE.BoxGeometry(w, h, d);
  if (mat && mat.map && !opt.noUV) boxUV(geo, w, h, d, opt.uvScale || 2.4);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(cx, cy, cz);
  m.castShadow = opt.shadow !== false;
  m.receiveShadow = opt.receive !== false;
  addWorld(m);
  if (!opt.noBase && h > 2.6 && Math.min(w, d) <= 0.55 && cy - h / 2 < 0.2 && h < 9) {
    const along = w > d ? 'x' : 'z';
    const bw = along === 'x' ? w : 0.07;
    const bd = along === 'x' ? 0.07 : d;
    const bxp = along === 'x' ? cx : cx + (Math.random() < 0.5 ? 1 : -1) * (w / 2 + 0.035);
    const bzp = along === 'x' ? cz + (Math.random() < 0.5 ? 1 : -1) * (d / 2 + 0.035) : cz;
    const bb = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.14, bd), MAT.base);
    bb.position.set(bxp, 0.11, bzp);
    bb.receiveShadow = true;
    addWorld(bb);
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
/* The live map. Fields are copied in from a preset by applyMapPreset(), and
   every module reads this object rather than the preset — so switching map is
   a mutation plus a rebuild, not a reload. */
const MAP = {
  id: 'white',
  B: 36,             // outer wall centreline
  outerT: 0.7,       // outer wall thickness
  platY: 4.2,        // catwalk deck height
  mazeHalf: 29.5,    // maze extends +-this
  N: 13,             // maze cells per side
  wallH: 3.0,        // maze wall height
  wallT: 0.42,       // maze wall thickness
  railH: 1.15,       // catwalk railing height
  seed: 20261018,
  loops: 0.20,
  catwalk: true,
  plinth: false
};

function applyMapPreset(id) {
  const m = mapDef(id);
  MAP.id = m.id;
  MAP.N = m.N;
  MAP.wallH = m.wallH;
  MAP.platY = m.catwalk ? m.platY : 0;
  MAP.catwalk = !!m.catwalk;
  MAP.plinth = !!m.plinth;
  MAP.seed = m.seed;
  MAP.loops = m.loops;
  MAP.cs = (MAP.mazeHalf * 2) / MAP.N;
  MAP.g0 = -MAP.mazeHalf;
  return MAP;
}
applyMapPreset('white');

/* ------------------------------------------------------------
   MAP MATERIALS
   ------------------------------------------------------------
   Every map owns a palette. Sharing one white plaster set was the reason the
   new arenas read as the same map with different wall heights: pale walls on a
   pale floor have almost no contrast, so from above (and from across the
   arena) the maze dissolved into a sheet of paper. Floors are now distinctly
   darker than walls, which is what makes the layout legible at a glance.

   Built once per map and kept: disposeWorld() only frees geometry, and these
   materials are shared by every mesh the builder merges. */
const MAP_MATS = {};
function mapMats(id) {
  if (MAP_MATS[id]) return MAP_MATS[id];
  const p = mapDef(id).pal;
  const set = {
    wall: new THREE.MeshStandardMaterial({
      map: texPlaster(p.wall, p.wall2), roughness: 0.94,
      metalness: p.wallMetal || 0.02
    }),
    floor: new THREE.MeshStandardMaterial({
      map: texTiles(p.floor, p.floor2, 6),
      roughness: p.floorRough === undefined ? 0.68 : p.floorRough,
      metalness: p.floorMetal || 0.05
    }),
    trim: new THREE.MeshStandardMaterial({ color: p.trim, roughness: 0.4, metalness: 0.55 }),
    ground: p.ground === 'grass' ? MAT.ground
      : new THREE.MeshStandardMaterial({
        map: texPlaster(p.ground, p.ground2), roughness: 0.99, metalness: 0
      }),
    accent: p.accent
  };
  MAP_MATS[id] = set;
  return set;
}

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
function genMaze(N, rnd, loops) {
  const open = loops === undefined ? 0.20 : loops;
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
    if (i < N - 1 && cells[j][i].E && rnd() < open) { cells[j][i].E = false; cells[j][i + 1].W = false; }
    if (j < N - 1 && cells[j][i].S && rnd() < open) { cells[j][i].S = false; cells[j + 1][i].N = false; }
  }
  return cells;
}

function buildWorld() {
  const N = MAP.N, cs = MAP.cs, g0 = MAP.g0, MH = MAP.mazeHalf, PY = MAP.platY;
  const B = MAP.B, OT = MAP.outerT;
  const outer = B + OT / 2;                 // outer face of the perimeter
  const deckC = (MH + outer) / 2;           // catwalk centreline
  const deckW = outer - MH;                 // catwalk width
  const preset = mapDef(MAP.id);
  const W = mapMats(MAP.id);

  /* a fresh group per build; disposeWorld() removed the previous one */
  WORLD = new THREE.Group();
  WORLD.name = 'world:' + MAP.id;
  scene.add(WORLD);
  G.world = WORLD;

  /* atmosphere belongs to the map, not the engine */
  if (scene.fog) {
    scene.fog.color.setHex(preset.fog);
    scene.fog.near = preset.fogNear;
    scene.fog.far = preset.fogFar;
  }
  if (G.sky && G.sky.material && G.sky.material.uniforms) {
    const u = G.sky.material.uniforms;
    u.botCol.value.setHex(preset.fog);
    u.midCol.value.setHex(preset.fog).lerp(new THREE.Color(0x9cc4e4), 0.5);
  }
  if (G.sun) G.sun.color.setHex(preset.light);

  /* --- ground --- */
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), W.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.06;          // sit under the maze slab, no z-fighting
  ground.receiveShadow = true;
  addWorld(ground);

  /* --- maze floor --- */
  addBox(0, -0.08, 0, MH * 2 + 0.5, 0.16, MH * 2 + 0.5, W.floor, { name: 'mazefloor' });

  /* --- maze layout --- */
  const cells = genMaze(N, mulberry32(MAP.seed), MAP.loops);
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
  if (MAP.catwalk) {
    well(-RW, RW, MH - RUN, MH);
    well(-RW, RW, -MH, -MH + RUN);
    well(MH - RUN, MH, -RW, RW);
    well(-MH, -MH + RUN, -RW, RW);
  }
  /* open corner plazas: 3x3 cells knocked out so each HQ has room to fight in.
     red takes the south-west corner, blue the north-east. */
  const plaza = (i0, j0) => {
    for (let j = j0; j < j0 + 3; j++) for (let i = i0; i < i0 + 3; i++) openCell(i, j);
  };
  plaza(0, N - 3);
  plaza(N - 3, 0);

  /* The plinth needs its ground cleared BEFORE the walls are built. Calling
     openCell down in the plinth block would only edit the cell data — the wall
     meshes are already standing by then, and you get a 4 m slab of maze wall
     erupting out of the top tier. Half width has to be the same number the
     plinth block uses, so it is computed once here and reused there.

     The clearing is deliberately wider than the platform: at the old size the
     ziggurat filled its own hole and you had to squeeze around it in a 0.6 m
     gap between the bottom tier and the nearest maze wall. */
  const plinthBase = MAP.plinth ? Math.min(Math.max(cs * 1.35, 5.0), 6.6) : 0;
  if (MAP.plinth) {
    const pb = plinthBase + cs * 0.9;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const c = cellCenter(i, j);
      if (Math.abs(c.x) < pb && Math.abs(c.z) < pb) openCell(i, j);
    }
  }

  /* Only maps with a catwalk get the four stair ramps. A flat map has no deck
     to reach, and a ramp there would just be a 9 m solid bulkhead in the
     middle of the maze for no reason. */
  const ramps = [];
  if (MAP.catwalk) {
    ramps.push(
      { axis: 'z', minX: -RW, maxX: RW, minZ: MH - RUN, maxZ: MH, yAtMinZ: 0, yAtMaxZ: PY },
      { axis: 'z', minX: -RW, maxX: RW, minZ: -MH, maxZ: -MH + RUN, yAtMinZ: PY, yAtMaxZ: 0 },
      { axis: 'x', minX: MH - RUN, maxX: MH, minZ: -RW, maxZ: RW, yAtMinX: 0, yAtMaxX: PY },
      { axis: 'x', minX: -MH, maxX: -MH + RUN, minZ: -RW, maxZ: RW, yAtMinX: PY, yAtMaxX: 0 }
    );
  }
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

  /* --- maze walls: collinear runs merged so the collider list stays small.
     Each run gets a dark cap strip: it draws the layout from across the arena,
     gives every map a signature colour, and stops the pale walls dissolving
     into a pale floor when you look down a long corridor. --- */
  const capH = 0.09;
  for (let i = 1; i < N; i++) {
    let run = -1;
    for (let j = 0; j <= N; j++) {
      const has = j < N && cells[j][i].W;
      if (has && run < 0) run = j;
      if (!has && run >= 0) {
        const len = (j - run) * cs + MAP.wallT;
        addBox(g0 + i * cs, MAP.wallH / 2, g0 + (run + j) / 2 * cs,
          MAP.wallT, MAP.wallH, len, W.wall, { name: 'maze' });
        addBox(g0 + i * cs, MAP.wallH + capH / 2, g0 + (run + j) / 2 * cs,
          MAP.wallT + 0.05, capH, len, W.trim, { collide: false, shadow: false });
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
        const len = (i - run) * cs + MAP.wallT;
        addBox(g0 + (run + i) / 2 * cs, MAP.wallH / 2, g0 + j * cs,
          len, MAP.wallH, MAP.wallT, W.wall, { name: 'maze' });
        addBox(g0 + (run + i) / 2 * cs, MAP.wallH + capH / 2, g0 + j * cs,
          len, capH, MAP.wallT + 0.05, W.trim, { collide: false, shadow: false });
        run = -1;
      }
    }
  }

  /* --- perimeter: the catwalk maps are enclosed by their own parapet, but a
     flat map used to end at a bare slab edge — you could walk straight off the
     arena and onto the grass, and from above the level looked like a sheet of
     paper lying on a lawn. Every flat map now gets a real wall with a base
     skirt, a capped top and a floor band, so the arena reads as a room. --- */
  if (!MAP.catwalk) {
    const PH = MAP.wallH + 2.6, PT = 0.85;
    /* the wall wraps the arena exactly — spanning it to the old catwalk radius
       left four shelves sticking out past the corners, which read as a picture
       frame with the map lying inside it */
    const E = MH + PT / 2;
    wallX(MH, -E, E, 0, PH, [], PT, W.wall);
    wallX(-MH, -E, E, 0, PH, [], PT, W.wall);
    wallZ(MH, -MH, MH, 0, PH, [], PT, W.wall);
    wallZ(-MH, -MH, MH, 0, PH, [], PT, W.wall);

    const capY = PH - 0.16, skirtY = 0.26;
    for (const s of [-1, 1]) {
      addBox(0, capY, s * MH, E * 2, 0.32, PT + 0.08, W.trim, { collide: false, shadow: false });
      addBox(s * MH, capY, 0, PT + 0.08, 0.32, MH * 2, W.trim, { collide: false, shadow: false });
      addBox(0, skirtY, s * MH, E * 2, 0.52, PT + 0.08, W.trim, { collide: false, shadow: false });
      addBox(s * MH, skirtY, 0, PT + 0.08, 0.52, MH * 2, W.trim, { collide: false, shadow: false });
      /* a band on the floor just inside the wall, so the edge is drawn */
      addBox(0, 0.02, s * (MH - 0.75), MH * 2 - 1.5, 0.04, 1.1, W.trim, { collide: false, shadow: false });
      addBox(s * (MH - 0.75), 0.02, 0, 1.1, 0.04, MH * 2 - 1.5, W.trim, { collide: false, shadow: false });
    }
  }

  /* --- catwalk: solid parapet block all round, deck on top --- */
  if (MAP.catwalk) {
  addBox(0, PY / 2, deckC, outer * 2, PY, deckW, W.wall, { name: 'deckS' });
  addBox(0, PY / 2, -deckC, outer * 2, PY, deckW, W.wall, { name: 'deckN' });
  addBox(deckC, PY / 2, 0, deckW, PY, MH * 2, W.wall, { name: 'deckE' });
  addBox(-deckC, PY / 2, 0, deckW, PY, MH * 2, W.wall, { name: 'deckW' });

  /* dark trim along the inner lip so the two levels read apart */
  const trim = (x, z, w, d) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.07, d), W.trim);
    m.position.set(x, PY + 0.035, z); m.receiveShadow = true; addWorld(m);
  };
  trim(0, MH - 0.09, MH * 2, 0.18);
  trim(0, -MH + 0.09, MH * 2, 0.18);
  trim(MH - 0.09, 0, 0.18, MH * 2);
  trim(-MH + 0.09, 0, 0.18, MH * 2);

  /* metal deck plate on top of the white parapet */
  const plate = (x, z, w, d) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), MAT.deck);
    m.position.set(x, PY + 0.025, z); m.receiveShadow = true; addWorld(m);
  };
  plate(0, deckC, outer * 2 - 0.1, deckW - 0.1);
  plate(0, -deckC, outer * 2 - 0.1, deckW - 0.1);
  plate(deckC, 0, deckW - 0.1, MH * 2 - 0.1);
  plate(-deckC, 0, deckW - 0.1, MH * 2 - 0.1);

  /* --- outer wall above the deck: sealed, no way out ---
     runs corner to corner, not just across the maze, or you can walk
     straight off the deck corners onto the grass */
  const wallTop = 11.0;
  wallX(B, -outer, outer, PY, wallTop, [], OT, W.wall);
  wallX(-B, -outer, outer, PY, wallTop, [], OT, W.wall);
  wallZ(B, -outer, outer, PY, wallTop, [], OT, W.wall);
  wallZ(-B, -outer, outer, PY, wallTop, [], OT, W.wall);

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
          W.wall, { noBase: true, name: 'step' });
      } else {
        const h = r.yAtMinZ + (r.yAtMaxZ - r.yAtMinZ) * t;
        addBox(0, h / 2, r.minZ + (r.maxZ - r.minZ) * t, RW * 2, Math.max(0.12, h), run + 0.02,
          W.wall, { noBase: true, name: 'step' });
      }
    }
  }
  }   /* end catwalk block */

  /* --- plinth: the flat maps need somewhere to climb, or every fight is a
     corridor duel at the same height. A stepped platform in the middle of the
     map, built as a ziggurat of shallow tiers: each rise is 0.45 m, which is
     under the 0.5 m step-up the collision code allows, so it is walked rather
     than jumped.

     Dark stone body, pale lips: in one stone the six tiers read as a flat ramp
     from any distance, and from above the whole thing looked like a printed
     bullseye. The contrast is what makes it a structure. --- */
  if (MAP.plinth) {
    const base = plinthBase;                   // half width of the bottom tier
    const RISE = 0.45, TIERS = 5;
    let topHalf = base;
    for (let k = 0; k < TIERS; k++) {
      const h = RISE * (k + 1);
      topHalf = base * (1 - k * 0.07);
      addBox(0, h / 2, 0, topHalf * 2, h, topHalf * 2,
        W.trim, { noBase: true, name: 'plinth' });
      /* a pale lip along the top edge of every tier, so the steps read as
         steps and you can tell where the next one starts */
      const t = 0.18, y = h - 0.035;
      for (const s of [-1, 1]) {
        addBox(0, y, s * (topHalf - t / 2), topHalf * 2, 0.11, t, W.wall, { collide: false, shadow: false });
        addBox(s * (topHalf - t / 2), y, 0, t, 0.11, topHalf * 2, W.wall, { collide: false, shadow: false });
      }
    }
    const topY = RISE * TIERS;
    /* a pale deck on the summit, so it reads as a place to stand */
    addBox(0, topY + 0.03, 0, topHalf * 2 - 0.3, 0.06, topHalf * 2 - 0.3, W.floor,
      { collide: false, shadow: false });
    /* the ground under it was already cleared up with the plazas — see the
       plinthBase block before the wall runs */
    const cap = new THREE.Mesh(new THREE.RingGeometry(topHalf * 0.74, topHalf * 0.9, 40),
      new THREE.MeshBasicMaterial({ color: W.accent, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
    cap.rotation.x = -Math.PI / 2;
    cap.position.y = topY + 0.08;
    addWorld(cap);
    G.plinth = { r: topHalf, y: topY, base: base };
  } else {
    G.plinth = null;
  }

  /* --- lighting --- */
  const fill = (x, y, z, i) => {
    const l = new THREE.PointLight(preset.light, i, 30, 1.5);
    l.position.set(x, y, z);
    addWorld(l);
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
    addWorld(ring);
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
  /* two up on the deck — only where there is a deck to put them on */
  if (MAP.catwalk) {
    spots.push({ x: -deckC, z: 11, y: PY });
    spots.push({ x: deckC, z: -11, y: PY });
  } else {
    /* flat maps trade those for two more maze junctions, so the crate count
       stays the same whatever the map */
    for (const j of junctions) {
      if (spots.length >= 8) break;
      if (spots.indexOf(j) < 0) spots.push(j);
    }
  }
  /* Keep the middle of the map clear: it is the landmark every map is read
     from, and a crate's beam and diamond marker in front of it is unreadable.
     Backfill from the junctions so the count stays the same. */
  const clearOfCentre = s => Math.hypot(s.x, s.z) > 6.5;
  const kept = spots.filter(clearOfCentre);
  for (const j of junctions) {
    if (kept.length >= 8) break;
    if (!clearOfCentre(j)) continue;
    if (kept.some(k => Math.hypot(k.x - j.x, k.z - j.z) < 1)) continue;
    kept.push(j);
  }
  /* ...and never on a spawn slot. A chest is solid, so a crate sitting on the
     cell you deploy onto would drop you inside a box. Two metres of clearance
     is a body plus a chest; backfill from the junctions as before. */
  const slots = (G.spawns.red || []).concat(G.spawns.blue || []);
  const clearOfSpawns = p => slots.every(s => Math.hypot(p.x - s.x, p.z - s.z) > 2.6);
  const final = kept.filter(clearOfSpawns);
  for (const j of junctions) {
    if (final.length >= kept.length) break;
    if (!clearOfSpawns(j)) continue;
    if (final.some(k => Math.hypot(k.x - j.x, k.z - j.z) < 1)) continue;
    final.push(j);
  }
  G.chestSpots = final.map(s => [s.x, s.y || 0, s.z]);

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
  (WORLD || scene).traverse(o => {
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
    addWorld(mesh);
  }
}


/* ------------------------------------------------------------
   MAP SWITCHING
   ------------------------------------------------------------
   The level is procedurally built from a preset, so switching map means
   tearing the old group down and building the new one. Everything the
   builder writes into G is cleared here too — leaving a stale collider or
   spawn list behind is how you get bots walking into walls that are not
   there any more. */
function disposeWorld() {
  if (!WORLD) return;
  const geos = [];
  WORLD.traverse(o => { if (o.isMesh && o.geometry) geos.push(o.geometry); });
  scene.remove(WORLD);
  for (const g of geos) { try { g.dispose(); } catch (e) { /* already gone */ } }
  WORLD = null;
  G.world = null;
  G.colliders.length = 0;
  G.ramps.length = 0;
  G.maze = null;
  G.chestSpots = [];
  G.spawns = { red: [], blue: [] };
  G.hq = null;
  G.plinth = null;
  G.redRing = null;
  G.blueRing = null;
  NODES.length = 0;
}

/* Build the requested map only if it is not the one already standing. */
function ensureWorld(id) {
  const want = mapDef(id).id;
  if (MAP.id === want && WORLD) return false;
  disposeWorld();
  applyMapPreset(want);
  buildWorld();
  return true;
}
