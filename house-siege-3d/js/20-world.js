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

/* Every merged wall run of the current map, in world coordinates. The outdoor
   dressing pass plants its trees along these, which is what keeps every trunk
   inside the wall footprint — and therefore out of the player's reach, so no
   tree needs a collider or a navigation exclusion. */
const wallRuns = [];

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
    /* the skirting board that grounds an indoor wall. Outdoors it has to be
       the map's own stone, not pale plaster — a hedge with a white plastic
       base was the first thing you noticed in the grove. */
    const bb = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.14, bd), opt.baseMat || MAT.base);
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
  const style = p.style || 'plaster';
  const gs = p.ground || 'grass';
  const std = (map, rough, metal) => new THREE.MeshStandardMaterial({
    map, roughness: rough, metalness: metal || 0
  });

  /* The wall is whatever encloses the arena in that biome: plaster, a hedge,
     a rock ridge or a sandstone fin. Same collider, four very different
     surfaces. */
  let wallMap;
  if (style === 'hedge') wallMap = texLeaves(p.wall, p.wall2, 1);
  else if (style === 'rock') wallMap = texRock(p.wall, p.wall2, false, 1);
  else if (style === 'sandstone') wallMap = texRock(p.wall, p.wall2, true, 1);
  else wallMap = texPlaster(p.wall, p.wall2);

  /* Ground and maze floor share a generator but not a repeat: the plane is
     420 m across and the arena 59 m, and one repeat count would carpet one of
     them. */
  /* boxUV already scales UVs so one texture unit is 2.2 m on a box, so the
     arena floor asks for ONE repeat and gets 2.2 m tiles. The ground plane is a
     PlaneGeometry with 0..1 UVs and needs the repeat spelled out: 420 m at
     2.2 m a tile. Multiplying both was how the first pass ended up with a
     10 cm woven-fabric pattern across every floor. */
  let groundMat, floorMat;
  if (gs === 'grass') {
    groundMat = MAT.ground;
    floorMat = std(texTiles(p.floor, p.floor2, 6), p.floorRough === undefined ? 0.68 : p.floorRough, p.floorMetal);
  } else if (gs === 'forest') {
    groundMat = std(texForestFloor(p.ground, p.ground2, 190), 0.99);
    floorMat = std(texForestFloor(p.floor, p.floor2, 1), 0.94);
  } else if (gs === 'sand') {
    groundMat = std(texSand(p.ground, p.ground2, 190), 0.99);
    floorMat = std(texSand(p.floor, p.floor2, 1), 0.96);
  } else {
    groundMat = std(texPlaster(p.ground, p.ground2), 0.99);
    floorMat = std(texTiles(p.floor, p.floor2, 6), p.floorRough === undefined ? 0.68 : p.floorRough, p.floorMetal);
  }

  const set = {
    wall: std(wallMap, style === 'plaster' ? 0.94 : 0.96, p.wallMetal || 0.02),
    floor: floorMat,
    trim: new THREE.MeshStandardMaterial({ color: p.trim, roughness: 0.4, metalness: 0.55 }),
    ground: groundMat,
    accent: p.accent
  };

  if (style !== 'plaster') {
    /* the strip along the top of every wall: sunlit leaves on a hedge, moss on
       a ridge, bleached sandstone on a fin */
    set.cap = p.cap !== undefined
      ? new THREE.MeshStandardMaterial({ color: p.cap, roughness: 0.95, metalness: 0 })
      : set.trim;
    /* the walls are no longer plaster, so the trim cannot double as stone */
    set.trim = new THREE.MeshStandardMaterial({ color: p.trim, roughness: 0.86, metalness: 0.04 });
  } else {
    set.cap = set.trim;
  }

  if (p.dress) {
    const css = n => '#' + ('000000' + (n >>> 0).toString(16)).slice(-6);
    const leafA = css(p.leaf === undefined ? 0x4f7a35 : p.leaf);
    const leafB = css(p.leaf2 === undefined ? 0x6a9649 : p.leaf2);
    set.bark = std(texBark(p.bark || '#5b4632', p.bark2 || '#33261a', 1), 0.95);
    set.leaf = new THREE.MeshStandardMaterial({
      color: p.leaf === undefined ? 0x4f7a35 : p.leaf, roughness: 0.92, metalness: 0, flatShading: true
    });
    set.leaf2 = new THREE.MeshStandardMaterial({
      color: p.leaf2 === undefined ? 0x6a9649 : p.leaf2, roughness: 0.92, metalness: 0, flatShading: true
    });
    set.rock = new THREE.MeshStandardMaterial({
      color: p.rock || 0x8b9088, roughness: 0.95, metalness: 0, flatShading: true
    });
    /* A line of pale solid-colour boulders at every wall foot fused into a
       continuous light grey strip in the pine and canyon shots. Two fixes:
       the rock is cut from the SAME stone as the walls, and it is tinted down
       so a sunlit facet cannot blow out to cream. */
    if (style === 'rock' || style === 'sandstone') {
      set.rock = std(texRock(p.wall, p.wall2, style === 'sandstone', 1), 0.98);
      set.rock.color.setHex(0x9a8f84);
    }
    /* An undergrowth clump has to be made of leaves, not of a green
       twenty-sided die: the flat-shaded blob read as a mossy boulder. The
       hedge texture on a lumpy blob reads as a bush at every distance. */
    set.shrub = std(texLeaves(leafA, leafB, 1), 0.95);
    /* knocked back: the raw texture under a 1.0 sun came out mint */
    set.shrub.color.setHex(0xa9b79b);
    /* a second, darker shrub so a clump is not one flat tone */
    set.shrub2 = std(texLeaves(leafB, leafA, 1), 0.96);
    set.shrub2.color.setHex(0x8c9a80);
    /* the cactus gets its own colour: a saguaro is the one saturated green in
       the canyon, and borrowing the shrub's dry olive made it look dead */
    const cacA = css(p.cactus === undefined ? (p.leaf === undefined ? 0x4f7a35 : p.leaf) : p.cactus);
    const cacB = css(p.cactus2 === undefined ? (p.leaf2 === undefined ? 0x6a9649 : p.leaf2) : p.cactus2);
    set.cactus = std(texRibs(cacA, cacB, 2), 0.88);
  }

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
    /* A preset may name all three sky bands. Without that, an outdoor map got
       the indoor blue and the horizon read as a painted backdrop: the bands
       have to be set every time, not only when a map asks for them, or
       switching back to an indoor map leaves the previous sky behind. */
    const sky = preset.sky || null;
    u.botCol.value.setHex(sky && sky.bot !== undefined ? sky.bot : preset.fog);
    if (sky && sky.mid !== undefined) u.midCol.value.setHex(sky.mid);
    else u.midCol.value.setHex(preset.fog).lerp(new THREE.Color(0x9cc4e4), 0.5);
    u.topCol.value.setHex(sky && sky.top !== undefined ? sky.top : 0x2a6ba8);
  }
  if (G.sun) {
    G.sun.color.setHex(preset.light);
    G.sun.intensity = preset.sunI === undefined ? 1.02 : preset.sunI;
  }
  /* An open-sky map has no ceiling bouncing light back down, so the corridors
     went black under the canopies while the sky stayed bright. The fill has to
     come from the hemisphere light, and it has to be reset on every build or an
     indoor map inherits the forest's. */
  if (G.hemi) G.hemi.intensity = preset.hemiI === undefined ? 0.34 : preset.hemiI;

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
  wallRuns.length = 0;
  for (let i = 1; i < N; i++) {
    let run = -1;
    for (let j = 0; j <= N; j++) {
      const has = j < N && cells[j][i].W;
      if (has && run < 0) run = j;
      if (!has && run >= 0) {
        const len = (j - run) * cs + MAP.wallT;
        addBox(g0 + i * cs, MAP.wallH / 2, g0 + (run + j) / 2 * cs,
          MAP.wallT, MAP.wallH, len, W.wall, { name: 'maze', baseMat: W.trim });
        addBox(g0 + i * cs, MAP.wallH + capH / 2, g0 + (run + j) / 2 * cs,
          MAP.wallT + 0.05, capH, len, W.cap, { collide: false, shadow: false });
        wallRuns.push({ axis: 'z', at: g0 + i * cs, a: g0 + run * cs, b: g0 + j * cs });
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
          len, MAP.wallH, MAP.wallT, W.wall, { name: 'maze', baseMat: W.trim });
        addBox(g0 + (run + i) / 2 * cs, MAP.wallH + capH / 2, g0 + j * cs,
          len, capH, MAP.wallT + 0.05, W.cap, { collide: false, shadow: false });
        wallRuns.push({ axis: 'x', at: g0 + j * cs, a: g0 + run * cs, b: g0 + i * cs });
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
    /* A 0.52 m skirting board and a painted 1.1 m floor band are architecture:
       indoors they make the arena read as a room. At the foot of a hedge or a
       sandstone fin they read as a concrete kerb, so outdoor maps let the
       ground run straight into the wall and keep only the top cap. */
    const outdoor = !!preset.pal.style;
    for (const s of [-1, 1]) {
      addBox(0, capY, s * MH, E * 2, 0.32, PT + 0.08, W.cap, { collide: false, shadow: false });
      addBox(s * MH, capY, 0, PT + 0.08, 0.32, MH * 2, W.cap, { collide: false, shadow: false });
      if (!outdoor) {
        addBox(0, skirtY, s * MH, E * 2, 0.52, PT + 0.08, W.trim, { collide: false, shadow: false });
        addBox(s * MH, skirtY, 0, PT + 0.08, 0.52, MH * 2, W.trim, { collide: false, shadow: false });
        /* a band on the floor just inside the wall, so the edge is drawn */
        addBox(0, 0.02, s * (MH - 0.75), MH * 2 - 1.5, 0.04, 1.1, W.trim, { collide: false, shadow: false });
        addBox(s * (MH - 0.75), 0.02, 0, 1.1, 0.04, MH * 2 - 1.5, W.trim, { collide: false, shadow: false });
      }
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
    /* outdoors the tiers are rock and the lip is moss or sunlit stone; indoors
       it stays the pale plaster lip that makes the ziggurat read as steps */
    const lipMat = preset.pal.style ? W.cap : W.wall;
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
        addBox(0, y, s * (topHalf - t / 2), topHalf * 2, 0.11, t, lipMat, { collide: false, shadow: false });
        addBox(s * (topHalf - t / 2), y, 0, t, 0.11, topHalf * 2, lipMat, { collide: false, shadow: false });
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

  dressWorld(preset);

  mergeStaticWorld();
  buildWaypoints();
}



/* ------------------------------------------------------------
   OUTDOOR DRESSING
   ------------------------------------------------------------
   The three nature maps reuse the maze topology exactly — same cells, same
   colliders, same spawns — and change only what the walls are made of and what
   grows on them. That is deliberate: a second level generator would need its
   own navigation, its own spawn rules and its own balance pass, and the maze is
   already the part that plays well.

   Every prop is planted ON a wall centreline. The wall is 0.42 m thick and the
   player's capsule is stopped 0.61 m from that centreline, so a trunk of radius
   0.3 and a boulder of radius 0.5 are physically unreachable — nothing here
   needs a collider, and nothing here can trap a bot or block a corridor. Props
   are also the only thing that never touches a cell centre, which is where
   every navigation node lives.

   They are merged into the level by mergeStaticWorld, so a few hundred trees
   cost four draw calls, not four hundred.
   ------------------------------------------------------------ */
const DRESS = {
  grove: { tree: 6.2, treeH: [8.5, 11.5], pine: false, bush: 3.1, fern: 3.9, rock: 8.5, cactus: 0 },
  pine: { tree: 5.2, treeH: [9.0, 13.0], pine: true, bush: 4.4, fern: 4.6, rock: 7.0, cactus: 0 },
  canyon: { tree: 0, treeH: [0, 0], pine: false, bush: 5.4, fern: 0, rock: 5.6, cactus: 7.2 }
};

function addProp(geo, mat, x, y, z, o) {
  o = o || {};
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0);
  if (o.sx !== undefined) m.scale.set(o.sx, o.sy === undefined ? o.sx : o.sy, o.sz === undefined ? o.sx : o.sz);
  m.castShadow = o.shadow !== false;
  m.receiveShadow = true;
  addWorld(m);
  return m;
}

function dressWorld(preset) {
  const cfg = DRESS[preset.pal.dress];
  if (!cfg) return;
  const W = mapMats(MAP.id);
  const rnd = mulberry32((preset.seed ^ 0x9e3779b9) >>> 0);
  const stats = { trees: 0, cacti: 0, bushes: 0, ferns: 0, rocks: 0, anchors: [], colsBefore: G.colliders.length, colsAfter: 0 };
  G.decor = stats;

  /* Walk every merged wall run and plant along it. A short run gets a prop
     only some of the time, so a 1 m stub between two corners does not grow a
     full tree. */
  const along = (spacing, cb) => {
    for (const r of wallRuns) {
      const len = r.b - r.a;
      if (len < 0.9) continue;
      const whole = Math.floor(len / spacing);
      const count = whole + (rnd() < (len % spacing) / spacing ? 1 : 0);
      for (let k = 0; k < count; k++) {
        const t = clamp((k + 0.5 + (rnd() - 0.5) * 0.7) / count, 0.04, 0.96);
        cb(r.axis === 'z'
          ? { x: r.at, z: r.a + len * t }
          : { x: r.a + len * t, z: r.at }, r);
      }
    }
  };

  if (cfg.tree) {
    along(cfg.tree, p => {
      const h = cfg.treeH[0] + rnd() * (cfg.treeH[1] - cfg.treeH[0]);
      if (cfg.pine) pineTree(p.x, p.z, h, rnd, W); else broadleaf(p.x, p.z, h, rnd, W);
      stats.trees++; stats.anchors.push([p.x, p.z]);
    });
  }
  if (cfg.cactus) {
    along(cfg.cactus, p => {
      cactus(p.x, p.z, 4.6 + rnd() * 2.4, rnd, W);
      stats.cacti++; stats.anchors.push([p.x, p.z]);
    });
  }
  if (cfg.bush) {
    along(cfg.bush, p => { bush(p.x, p.z, 0.42 + rnd() * 0.3, rnd, W); stats.bushes++; });
  }
  if (cfg.fern) {
    along(cfg.fern, p => { fern(p.x, p.z, 0.55 + rnd() * 0.35, rnd, W); stats.ferns++; });
  }
  if (cfg.rock) {
    along(cfg.rock, p => { rock(p.x, p.z, 0.28 + rnd() * 0.22, rnd, W); stats.rocks++; stats.anchors.push([p.x, p.z]); });
  }

  /* A tree is scenery, not cover: if this ever moves, every prop placement
     above needs a collider and a navigation exclusion to go with it. */
  stats.colsAfter = G.colliders.length;
}

/* A crown built from several small blobs rather than one big one: a single
   icosahedron of radius 2 m is a twenty-sided crystal at head height, and the
   first pass looked like green quartz hanging over the corridors. Six clumps
   of ~1.3 m read as foliage and cost 120 triangles. */
function broadleaf(x, z, h, rnd, W) {
  const rad = 0.24 + h * 0.022;
  const trunkH = h * 0.62;
  addProp(new THREE.CylinderGeometry(rad * 0.62, rad, trunkH, 7, 1), W.bark,
    x, trunkH / 2, z, { ry: rnd() * 6.28, rx: (rnd() - 0.5) * 0.05 });
  const crownY = trunkH * 0.9;
  const spread = h * 0.17;
  const blobs = 5 + (rnd() * 2 | 0);
  for (let k = 0; k < blobs; k++) {
    const r = h * (0.1 + rnd() * 0.055);
    const a = (k / blobs) * 6.283 + rnd() * 0.9;
    const d = spread * (0.3 + rnd() * 0.85);
    addProp(new THREE.IcosahedronGeometry(r, 0), k % 2 ? W.leaf2 : W.leaf,
      x + Math.cos(a) * d, crownY + (rnd() - 0.35) * h * 0.11, z + Math.sin(a) * d,
      { ry: rnd() * 6.28, rz: (rnd() - 0.5) * 0.3, sx: 1, sy: 0.7 + rnd() * 0.22, sz: 1 });
  }
}

function pineTree(x, z, h, rnd, W) {
  const rad = 0.16 + h * 0.012;
  const trunkH = h * 0.5;
  addProp(new THREE.CylinderGeometry(rad * 0.6, rad, trunkH, 6), W.bark,
    x, trunkH / 2, z, { ry: rnd() * 6.28 });
  const tiers = 5;
  const r0 = h * 0.17 * (0.85 + rnd() * 0.3);
  let y = h * 0.26;
  for (let k = 0; k < tiers; k++) {
    const t = k / (tiers - 1);
    const r = r0 * (1 - t * 0.62);
    const ch = h * (0.22 - t * 0.06);
    addProp(new THREE.ConeGeometry(r, ch, 8), k % 2 ? W.leaf2 : W.leaf,
      x, y + ch * 0.4, z, { ry: rnd() * 6.28 });
    y += ch * 0.62;
  }
}

/* A saguaro: a ribbed column with a domed top and two arms that turn up. The
   first pass was a bare cylinder and read as a green pipe. */
function cactus(x, z, h, rnd, W) {
  const mat = W.cactus;
  const r = 0.24 + h * 0.016;
  const body = THREE.CapsuleGeometry
    ? new THREE.CapsuleGeometry(r, Math.max(0.4, h - r * 2), 3, 9)
    : new THREE.CylinderGeometry(r, r, h, 8);
  addProp(body, mat, x, h / 2, z, { ry: rnd() * 6.28 });
  const arms = 1 + (rnd() < 0.6 ? 1 : 0);
  for (let k = 0; k < arms; k++) {
    const s = k ? 1 : -1, y = h * (0.38 + rnd() * 0.16);
    const ar = r * 0.52, out = r + 0.2;
    /* out, then up: an arm that only sticks out sideways reads as a handle */
    addProp(new THREE.CylinderGeometry(ar, ar, out * 2, 7), mat,
      x + s * out, y, z, { rz: Math.PI / 2 });
    addProp(THREE.CapsuleGeometry
      ? new THREE.CapsuleGeometry(ar, 0.42, 2, 7)
      : new THREE.CylinderGeometry(ar, ar, 0.42, 7), mat,
      x + s * out * 2, y + 0.3, z, {});
  }
}

/* A shrub is a spray, not a lump. Three overlapping spheres — however lumpy —
   fuse into one solid object with a smooth silhouette, which is why the first
   pass read as a mossy boulder and, once the hedge texture was applied, as a
   green brain. What actually says "bush" is the ragged edge: a dozen small
   clumps at different heights, with gaps you can see the wall through. */
function bush(x, z, s, rnd, W) {
  const n = 9 + (rnd() * 4 | 0);
  for (let k = 0; k < n; k++) {
    const r = s * (0.22 + rnd() * 0.2);
    const a = rnd() * 6.283;
    const d = s * Math.sqrt(rnd()) * 0.9;
    /* taller in the middle, so it still has a mound shape */
    const lift = (1 - d / s) * s * 0.55;
    addProp(new THREE.IcosahedronGeometry(r, 1), k % 3 === 0 ? W.shrub2 : W.shrub,
      x + Math.cos(a) * d, r * 0.42 + lift * (0.4 + rnd() * 0.7), z + Math.sin(a) * d,
      { ry: rnd() * 6.28, rx: (rnd() - 0.5) * 0.7, rz: (rnd() - 0.5) * 0.7,
        sx: 1.2, sy: 0.85, sz: 1.2 });
  }
}

function fern(x, z, s, rnd, W) {
  const n = 5 + (rnd() * 3 | 0);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * 6.283 + rnd() * 0.5;
    addProp(new THREE.ConeGeometry(0.085, s * (0.9 + rnd() * 0.5), 4),
      k % 2 ? W.leaf2 : W.leaf,
      x + Math.cos(a) * s * 0.2, s * 0.42, z + Math.sin(a) * s * 0.2,
      { rx: Math.sin(a) * 0.55, rz: -Math.cos(a) * 0.55 });
  }
}

/* A boulder, not a spike. A 20-face icosahedron rotated freely on all three
   axes puts a vertex straight up and reads as a cream-coloured pyramid; real
   stones are low and rounded, so the rotation is almost all yaw and the body
   is squashed on Y. */
function rock(x, z, s, rnd, W) {
  addProp(new THREE.IcosahedronGeometry(s, 1), W.rock, x, s * 0.34, z,
    { rx: (rnd() - 0.5) * 0.35, ry: rnd() * 6.28, rz: (rnd() - 0.5) * 0.35,
      sx: 1.0 + rnd() * 0.2, sy: 0.5 + rnd() * 0.2, sz: 1.0 + rnd() * 0.2 });
}


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
  G.decor = null;
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
