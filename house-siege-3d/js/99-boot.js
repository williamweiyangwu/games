/* ============================================================
   99-boot.js
   Bootstrap
   ============================================================ */
'use strict';

/* ------------------------------------------------------------
   BOOT
   ------------------------------------------------------------ */
function boot() {
  const steps = [
    ['Booting engine…', 12],
    ['Building the arena…', 34],
    ['Placing weapon crates…', 56],
    ['Spawning operators…', 74],
    ['Warming up the bots…', 90],
    ['Ready.', 100]
  ];
  let i = 0;
  const tick = () => {
    if (i >= steps.length) {
      $('loading').classList.add('hide');
      /* Only reveal the menu if no match has started meanwhile. The progress
         chain runs on timers for about a second, so a deploy click (or an
         automated test) that lands inside that window used to get the menu
         painted straight back over a running match. */
      if (G.state === 'menu') $('menu').classList.add('show');
      setTimeout(() => $('loading').style.display = 'none', 600);
      return;
    }
    $('loadText').textContent = steps[i][0];
    $('loadFill').style.width = steps[i][1] + '%';
    i++;
    setTimeout(tick, 130 + Math.random() * 90);
  };

  initThree();
  initMaterials();
  buildWorld();
  buildViewModel();
  createFlags();
  G.flags.red.group.visible = false;
  G.flags.blue.group.visible = false;
  initInput();
  initMenu();
  scene.add(camera);
  clock = new THREE.Clock();
  G.clock = clock;
  tick();
  requestAnimationFrame(loop);
}

/* debug handle (used by the automated smoke test) */
window.__wh = {
  G, startGame, groundAt, resolveHorizontal, moveActor,
  NODES, findPath, nearestNode, planPath,
  get camera() { return camera; },
  get scene() { return scene; },
  get renderer() { return renderer; },
  /* test hooks for the item system */
  setFiring(v) { firing = v; },
  get firing() { return firing; },
  addItem(id, n) { for (let i = 0; i < (n || 1); i++) giveItem(G.player, id); },
  addWeapon(id) { giveWeapon(G.player, id); },
  useSlot() { tryFire(G.player); },
  throwGrenade() { return throwGrenade(G.player); },
  aimInfo() {
    const st = G.player.weapons[G.player.cur];
    return {
      id: st ? st.id : null,
      drawT: G.player.drawT,
      aimVisible: !!(G.aimLine && G.aimLine.visible),
      aimColor: G.aimLine ? '#' + G.aimLine.material.color.getHexString() : null,
      projectiles: G.projectiles.length,
      blasts: G.blasts.length
    };
  },
  teleport(x, y, z) {
    const p = G.player;
    p.pos.set(x, y, z); p.vel.set(0, 0, 0);
  },
  look(yaw, pitch) { G.player.yaw = yaw; G.player.pitch = pitch || 0; },
  simulate(seconds, step) {
    const d = step || 1 / 60;
    let t = 0;
    while (t < seconds) { update(d); t += d; }
    return { score: G.score, time: Math.round(G.timeLeft) };
  },
  hurt(n) { damage(G.player, n, null, false, 'TEST'); },
  fire() { tryFire(G.player); },
  killBot(name) {
    const b = G.bots.find(x => x.name === name);
    if (b) damage(b, 999, G.player, false, 'TEST');
  },
  /* kill the player, optionally crediting a named enemy (spectator test) */
  killPlayer(name) {
    const b = name ? G.bots.find(x => x.name === name && x.team !== G.player.team) : null;
    damage(G.player, 999, b || null, false, b ? 'TEST RIFLE' : 'TEST');
  },
  /* straight-line walk probe: reports the first moment the actor leaves the arena */
  walk(x, z, dx, dz, secs, jump) {
    const p = G.player;
    p.pos.set(x, groundAt(x, z, 6), z);   // feetY 6 so the deck is found too
    p.vel.set(0, 0, 0);
    p.alive = true; p.onGround = true;
    const dt = 1 / 60, n = Math.round((secs || 2) * 60);
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len, uz = dz / len;
    for (let i = 0; i < n; i++) {
      if (jump && i % 28 === 0) p.vel.y = CFG.player.jump;
      moveActor(p, ux, uz, false, false, dt);
      if ((Math.abs(p.pos.x) > 29.75 || Math.abs(p.pos.z) > 29.75) && p.pos.y < 4.15) {
        return { out: true, x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(2), t: +(i / 60).toFixed(2) };
      }
    }
    return { out: false, x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(2) };
  },
  /* can the actor reach (tx,tz) from (sx,sz) by walking straight at it? */
  reach(sx, sz, tx, tz) {
    const p = G.player;
    let x = sx, z = sz, best = 1e9;
    for (let attempt = 0; attempt < 3; attempt++) {
      const ang = Math.atan2(-(tx - x), -(tz - z));
      const r = this.walk(x, z, Math.sin(ang), Math.cos(ang), 2.2);
      x = r.x; z = r.z;
      best = Math.min(best, Math.hypot(x - tx, z - tz));
      if (best < 1.4) return { ok: true, dist: +best.toFixed(2) };
      if (r.out) return { ok: false, dist: +best.toFixed(2), escaped: true };
    }
    return { ok: false, dist: +best.toFixed(2) };
  }
};

boot();

