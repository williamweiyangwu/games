/* ============================================================
   30-nav.js
   Navigation graph: nodes, edges, A* path finding
   ============================================================ */
'use strict';

const NODES = [];

/* A node carries its neighbours directly in `nb`; there is no separate edge
   list. The old `idx: NODES.length - 1` field was both unused and wrong (it was
   evaluated before the node was pushed, so every node claimed the previous
   node's index). */
function addNode(x, z, y) {
  const n = { x, z, y: y || 0, nb: [] };
  NODES.push(n);
  return n;
}

function buildWaypoints() {
  NODES.length = 0;
  const cells = G.maze, N = MAP.N, PY = MAP.platY, MH = MAP.mazeHalf;
  const D = (MH + MAP.B + MAP.outerT / 2) / 2;   // catwalk centreline

  /* A stair ramp is a solid 9 m diagonal bulkhead: it swallows the two cells it
     runs through, so those cells are NOT walkable floor. No nav nodes there —
     otherwise paths route bots straight into the staircase and they grind. */
  const inRamp = (x, z) => G.ramps.some(r =>
    x > r.minX - 0.3 && x < r.maxX + 0.3 && z > r.minZ - 0.3 && z < r.maxZ + 0.3);

  /* one node per maze cell, linked through the gaps that actually exist */
  const grid = [];
  for (let j = 0; j < N; j++) {
    const row = [];
    for (let i = 0; i < N; i++) {
      const c = cellCenter(i, j);
      row.push(inRamp(c.x, c.z) ? null : addNode(c.x, c.z, 0));
    }
    grid.push(row);
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    if (!grid[j][i]) continue;
    if (i < N - 1 && grid[j][i + 1] && !cells[j][i].E) link(grid[j][i], grid[j][i + 1]);
    if (j < N - 1 && grid[j + 1][i] && !cells[j][i].S) link(grid[j][i], grid[j + 1][i]);
  }

  /* catwalk ring */
  const xs = [];
  for (let x = -26; x <= 26.01; x += 6.5) xs.push(x);
  const S = xs.map(x => addNode(x, D, PY));
  const Nn = xs.map(x => addNode(x, -D, PY));
  const E = xs.map(x => addNode(D, x, PY));
  const W = xs.map(x => addNode(-D, x, PY));
  for (const arr of [S, Nn, E, W]) for (let k = 0; k + 1 < arr.length; k++) link(arr[k], arr[k + 1]);
  /* corners: the inner railings seal each corner, so route around them along the
     deck midline via a corner node. (The old code linked the wrong ends of two
     sides, creating 59 m "shortcuts" straight through the map — bots pathing on
     them walked into walls and ground there.) */
  const cSE = addNode(D, D, PY), cNE = addNode(D, -D, PY), cNW = addNode(-D, -D, PY), cSW = addNode(-D, D, PY);
  link(S[S.length - 1], cSE); link(cSE, E[E.length - 1]);
  link(E[0], cNE); link(cNE, Nn[Nn.length - 1]);
  link(Nn[0], cNW); link(cNW, W[W.length - 1]);
  link(W[0], cSW); link(cSW, S[0]);

  /* stairs: chain the four ramps to the floor and to the ring */
  const groundNodes = [];
  for (const row of grid) for (const n of row) if (n) groundNodes.push(n);
  const platNodes = S.concat(Nn, E, W, [cSE, cNE, cNW, cSW]);
  const nearestIn = (list, x, z) => {
    let best = null, bd = 1e9;
    for (const n of list) {
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  };

  for (const r of G.ramps) {
    let a, m, b;
    if (r.axis === 'x') {
      const zc = (r.minZ + r.maxZ) / 2;
      a = addNode(r.minX, zc, r.yAtMinX);
      m = addNode((r.minX + r.maxX) / 2, zc, (r.yAtMinX + r.yAtMaxX) / 2);
      b = addNode(r.maxX, zc, r.yAtMaxX);
    } else {
      const xc = (r.minX + r.maxX) / 2;
      a = addNode(xc, r.minZ, r.yAtMinZ);
      m = addNode(xc, (r.minZ + r.maxZ) / 2, (r.yAtMinZ + r.yAtMaxZ) / 2);
      b = addNode(xc, r.maxZ, r.yAtMaxZ);
    }
    link(a, m); link(m, b);
    const low = a.y < b.y ? a : b;
    const high = a.y < b.y ? b : a;
    const gN = nearestIn(groundNodes, low.x, low.z);
    const pN = nearestIn(platNodes, high.x, high.z);
    if (gN) link(low, gN);
    if (pN) link(high, pN);
  }

  G.rampsNode = null;
}


function link(a, b) {
  if (!a || !b || a === b) return;
  if (a.nb.indexOf(b) < 0) a.nb.push(b);
  if (b.nb.indexOf(a) < 0) b.nb.push(a);
}
function nearestNode(x, z, y) {
  if (!isFinite(x) || !isFinite(z)) return null;
  if (!isFinite(y)) y = 0;
  let best = null, bd = 1e9;
  for (const n of NODES) {
    const dy = Math.abs(n.y - y);
    let d = Math.hypot(n.x - x, n.z - z) + dy * 3;
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}
function findPath(from, to) {
  if (!from || !to) return [];
  if (from === to) return [to];
  const q = [from], prev = new Map([[from, null]]);
  while (q.length) {
    const n = q.shift();
    if (n === to) break;
    for (const m of n.nb) {
      if (!prev.has(m)) { prev.set(m, n); q.push(m); }
    }
  }
  if (!prev.has(to)) return [];
  const path = []; let c = to;
  while (c) { path.unshift(c); c = prev.get(c); }
  return path;
}

