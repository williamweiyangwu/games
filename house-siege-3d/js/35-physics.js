/* ============================================================
   35-physics.js
   Ray casting, ground probing, collision resolution and movement
   ============================================================ */
'use strict';

/* ------------------------------------------------------------
   RAYCASTING (AABB slab test)
   ------------------------------------------------------------ */
function rayAABB(ox, oy, oz, dx, dy, dz, b) {
  let tmin = 0, tmax = 1e9;
  // X
  if (Math.abs(dx) < 1e-9) { if (ox < b.minX || ox > b.maxX) return -1; }
  else {
    let t1 = (b.minX - ox) / dx, t2 = (b.maxX - ox) / dx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  // Y
  if (Math.abs(dy) < 1e-9) { if (oy < b.minY || oy > b.maxY) return -1; }
  else {
    let t1 = (b.minY - oy) / dy, t2 = (b.maxY - oy) / dy;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  // Z
  if (Math.abs(dz) < 1e-9) { if (oz < b.minZ || oz > b.maxZ) return -1; }
  else {
    let t1 = (b.minZ - oz) / dz, t2 = (b.maxZ - oz) / dz;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  return tmin;
}

function rayWorld(ox, oy, oz, dx, dy, dz, maxD) {
  let best = maxD, hit = false;
  for (const b of G.colliders) {
    const t = rayAABB(ox, oy, oz, dx, dy, dz, b);
    if (t >= 0 && t < best) { best = t; hit = true; }
  }
  return hit ? best : -1;
}

function losClear(x1, y1, z1, x2, y2, z2, pad) {
  const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
  const len = Math.hypot(dx, dy, dz);
  if (len < 0.001) return true;
  const nx = dx / len, ny = dy / len, nz = dz / len;
  const t = rayWorld(x1, y1, z1, nx, ny, nz, len);
  return t < 0 || t > len - (pad || 0);
}

/* ------------------------------------------------------------
   PHYSICS
   ------------------------------------------------------------ */
function groundAt(x, z, feetY) {
  let g = 0;
  const tol = 0.56;
  for (let i = 0; i < G.colliders.length; i++) {
    const b = G.colliders[i];
    if (b.maxY > feetY + tol) continue;
    if (x > b.minX - 0.14 && x < b.maxX + 0.14 && z > b.minZ - 0.14 && z < b.maxZ + 0.14) {
      if (b.maxY > g) g = b.maxY;
    }
  }
  for (let i = 0; i < G.ramps.length; i++) {
    const r = G.ramps[i];
    if (x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ) {
      let h;
      if (r.axis === 'x') {
        const t = (x - r.minX) / (r.maxX - r.minX);
        h = r.yAtMinX + (r.yAtMaxX - r.yAtMinX) * t;
      } else {
        const t = (z - r.minZ) / (r.maxZ - r.minZ);
        h = r.yAtMinZ + (r.yAtMaxZ - r.yAtMinZ) * t;
      }
      if (h <= feetY + tol && h > g) g = h;
    }
  }
  return g;
}

function resolveHorizontal(a) {
  const r = a.radius, feet = a.pos.y;
  /* Airborne actors collide as if their capsule still reached the surface they
     are falling towards. Without this you ghost straight through the maze
     walls on the way down after stepping off the catwalk. */
  const effFeet = a.onGround ? feet : Math.min(feet, groundAt(a.pos.x, a.pos.z, feet));
  for (let iter = 0; iter < 2; iter++) {
    for (let i = 0; i < G.colliders.length; i++) {
      const b = G.colliders[i];
      if (b.maxY <= effFeet + 0.5) continue;
      if (b.minY >= effFeet + a.height) continue;
      const cx = clamp(a.pos.x, b.minX, b.maxX);
      const cz = clamp(a.pos.z, b.minZ, b.maxZ);
      const dx = a.pos.x - cx, dz = a.pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          a.pos.x = cx + dx / d * r;
          a.pos.z = cz + dz / d * r;
        } else {
          const dl = a.pos.x - b.minX, dr = b.maxX - a.pos.x;
          const db = a.pos.z - b.minZ, df = b.maxZ - a.pos.z;
          const m = Math.min(dl, dr, db, df);
          if (m === dl) a.pos.x = b.minX - r;
          else if (m === dr) a.pos.x = b.maxX + r;
          else if (m === db) a.pos.z = b.minZ - r;
          else a.pos.z = b.maxZ + r;
        }
      }
    }
  }
}

function moveActor(a, wx, wz, sprint, wantJump, dt) {
  const maxSpeed = (sprint ? CFG.player.sprint : CFG.player.walk) * (a.speedMul || 1);
  const len = Math.hypot(wx, wz);
  if (len > 0.001) { wx /= len; wz /= len; }
  const tx = wx * maxSpeed, tz = wz * maxSpeed;
  const k = Math.min(1, (a.onGround ? 16 : 5) * dt);
  a.vel.x += (tx - a.vel.x) * k;
  a.vel.z += (tz - a.vel.z) * k;

  if (wantJump && a.onGround) { a.vel.y = CFG.player.jump; a.onGround = false; }
  a.vel.y -= CFG.gravity * dt;

  a.pos.x += a.vel.x * dt;
  a.pos.z += a.vel.z * dt;
  resolveHorizontal(a);

  a.pos.y += a.vel.y * dt;
  const g = groundAt(a.pos.x, a.pos.z, a.pos.y);
  if (a.pos.y <= g + 0.002) {
    a.pos.y = g; a.vel.y = 0; a.onGround = true;
  } else if (a.onGround && a.pos.y - g < 0.55 && a.vel.y <= 0) {
    a.pos.y = g; a.vel.y = 0;
  } else {
    a.onGround = false;
  }
  // hard floor
  if (a.pos.y < -6) { a.pos.set(0, 0, a.team === 'red' ? 33 : -33); a.vel.set(0, 0, 0); }
}

