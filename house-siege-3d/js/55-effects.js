/* ============================================================
   55-effects.js
   Tracers, sparks and the effect pool
   ============================================================ */
'use strict';

/* ------------------------------------------------------------
   EFFECTS
   ------------------------------------------------------------ */
function tracer(from, to, color) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
  const line = new THREE.Line(geo, mat);
  scene.add(line);
  G.tracers.push({ line, life: 0.06, max: 0.06 });
}

function spark(pos, color, n) {
  for (let i = 0; i < n; i++) {
    const g = new THREE.SphereGeometry(0.028, 4, 3);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true }));
    m.position.copy(pos);
    scene.add(m);
    G.particles.push({
      mesh: m, life: 0.35,
      vel: new V3(rand(-2.5, 2.5), rand(-1, 3), rand(-2.5, 2.5))
    });
  }
}

function updateEffects(dt) {
  for (let i = G.tracers.length - 1; i >= 0; i--) {
    const t = G.tracers[i];
    t.life -= dt;
    t.line.material.opacity = Math.max(0, t.life / t.max) * 0.9;
    if (t.life <= 0) { scene.remove(t.line); t.line.geometry.dispose(); t.line.material.dispose(); G.tracers.splice(i, 1); }
  }
  for (let i = G.particles.length - 1; i >= 0; i--) {
    const p = G.particles[i];
    p.life -= dt;
    p.vel.y -= 18 * dt;
    p.mesh.position.addScaledVector(p.vel, dt);
    p.mesh.material.opacity = Math.max(0, p.life / 0.35);
    p.mesh.scale.setScalar(Math.max(0.2, p.life / 0.35));
    if (p.life <= 0) { scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); G.particles.splice(i, 1); }
  }
  /* grenade detonations: red light flash, hot core, ground halo */
  for (let i = G.blasts.length - 1; i >= 0; i--) {
    const b = G.blasts[i];
    b.life -= dt;
    const k = 1 - Math.max(0, b.life) / b.max;      // 0 at the flash, 1 when gone
    const fade = Math.max(0, b.life / b.max);
    b.mesh.scale.setScalar(1 + k * 1.9);            // 0.34 m core -> ~1 m
    b.mesh.material.opacity = fade * fade * 0.92;
    if (b.light) b.light.intensity = Math.pow(fade, 1.7) * 11;
    if (b.halo) {
      b.halo.scale.setScalar(1 + k * 3.4);
      b.halo.material.opacity = fade * 0.7;
    }
    if (b.life <= 0) {
      scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose();
      if (b.light) scene.remove(b.light);
      if (b.halo) {
        scene.remove(b.halo);
        b.halo.geometry.dispose();
        b.halo.material.dispose();
      }
      G.blasts.splice(i, 1);
    }
  }
  if (G.shake > 0) G.shake = Math.max(0, G.shake - dt * 1.6);
}

