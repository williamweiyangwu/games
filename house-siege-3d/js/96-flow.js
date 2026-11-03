/* ============================================================
   96-flow.js
   Starting, ending, pausing and the main loop
   ============================================================ */
'use strict';

/* ------------------------------------------------------------
   GAME FLOW
   ------------------------------------------------------------ */
function startGame(mode, mapId) {
  Snd.init();
  if (Snd.ctx && Snd.ctx.state === 'suspended') Snd.ctx.resume();
  const def = modeDef(mode);
  G.mode = def.id;
  G.mapId = mapDef(mapId || G.mapId || 'white').id;
  G.state = 'playing';
  G.timeLeft = def.clock;
  G.golden = false;
  G.score.red = 0; G.score.blue = 0;
  $('clock').classList.remove('gold');
  G.tutorial.active = false;
  $('tutTasks').classList.remove('show');
  $('end').classList.remove('show');
  $('pause').classList.remove('show');
  $('menu').classList.remove('show');
  $('feed').innerHTML = '';
  $('respawn').classList.remove('show');
  $('carryBanner').classList.remove('show');
  $('objBanner').classList.remove('show');
  const kb0 = $('killBy');
  if (kb0) kb0.classList.remove('show');
  G.killer = null; G.killerWeapon = '';
  SPEC.t = 0; SPEC.init = false; SPEC.spot = -1;
  $('scoreboard').innerHTML = '';
  $('nameplates').innerHTML = '';

  // clear actors — the bodies go with the group when the new team is built
  G.bots.length = 0;
  clearProjectiles();
  G.shake = 0;
  perfReset();

  /* the level has to be standing before anything is placed on it: spawns,
     crates and HQ positions all come out of the build */
  ensureWorld(G.mapId);

  createPlayer();
  if (def.id === 'tutorial') { ensureBotGroup(); spawnTutorialDummies(); }
  else createTeams();
  createChests();
  createFlags();
  for (const t of ['red', 'blue']) G.flags[t].group.visible = (def.id === 'flag');
  createHill();

  buildRoster();
  buildMapBase();

  $('modeName').textContent = def.id === 'tutorial' ? 'TRAINING' : def.name;
  $('mapName').textContent = mapDef(G.mapId).name;
  /* the hill meter belongs to one mode only */
  $('hillBar').classList.toggle('show', def.id === 'koth');
  /* paint the score strip now instead of waiting for the first HUD tick, so
     the previous match's numbers and label are never visible for a frame */
  const cap0 = def.scoreLabel;
  $('capRed').textContent = cap0;
  $('capBlue').textContent = cap0;
  $('scoreRed').textContent = '0';
  $('scoreBlue').textContent = '0';
  $('hud').classList.add('show');
  $('scoreboard').classList.remove('show');

  const sp0 = spawnPoint(G.team, 5);
  G.player.pos.copy(sp0);
  G.player.pos.y = groundAt(sp0.x, sp0.z, 1);
  G.player.vel.set(0, 0, 0);
  G.player.yaw = def.id === 'tutorial' ? -Math.PI / 2 : -Math.PI / 4;
  G.player.pitch = 0;
  G.player.hp = CFG.playerHp;
  G.player.lastHurtT = 0;
  VM.adsOn = false;

  if (def.id === 'tutorial') startTutorial();
  requestLock();
  banner(def.id === 'tutorial'
    ? 'FOLLOW THE <span class="hl">TRAINING OBJECTIVES</span> ON SCREEN'
    : def.objective.replace('{FOE}', teamLabel(otherTeam(G.team))), 4);
}

/* ------------------------------------------------------------
   LAST STAND
   ------------------------------------------------------------
   One round, one life each. No round counter, no intermission, no revive:
   the first team to lose everybody loses the match. If the clock runs out
   with both teams still standing, the normal golden point takes over. */
function updateSurvival() {
  if (G.mode !== 'survival' || G.state !== 'playing') return;
  let red = 0, blue = 0;
  for (const a of allActors()) if (a.alive) { if (a.team === 'red') red++; else blue++; }
  if (red > 0 && blue > 0) return;          // still a live round
  if (red === 0 && blue === 0) return;      // mutual wipe: nobody scores
  const winner = red > 0 ? 'red' : 'blue';
  G.score[winner] = 1;
  endMatch();
}

function spawnTutorialDummies() {  const h = G.hq[G.team], cs = MAP.cs;
  /* six targets spread around the HQ plaza, all inside the open corner so
     none of them hide behind a wall */
  const spots = [
    [h.x + cs, h.z - cs * 0.5],
    [h.x + cs, h.z + cs * 0.5],
    [h.x, h.z + cs],
    [h.x - cs, h.z + cs * 0.5],
    [h.x - cs * 0.5, h.z - cs],
    [h.x + cs * 0.5, h.z - cs]
  ];
  let i = 0;
  for (const s of spots) {
    const b = makeActor(otherTeam(G.team), 'DUMMY ' + (++i), false);
    b.diff = DIFF[G.diff];
    b.dummy = true;
    b.home = { x: s[0], z: s[1] };
    b.hp = b.maxHp = 100;
    b.pos.set(s[0], 0, s[1]);
    b.pos.y = groundAt(s[0], s[1], 1);
    b.yaw = Math.PI;
    b.weapons = [{ id: 'knife', mag: 0, res: 0 }, { id: 'pistol', mag: 12, res: 0 }];
    const m = buildBotMesh(b.team);
    b.parts = m; b.mesh = m.group;
    m.group.position.copy(b.pos);
    m.group.rotation.y = b.yaw;
    G._botGroup.add(m.group);
    const np = document.createElement('div');
    np.className = 'np ' + b.team;
    np.innerHTML = '<div class="np-name">' + b.name + '</div><div class="np-hp"><div class="np-fill"></div></div><div class="np-hpn">100</div>';
    $('nameplates').appendChild(np);
    b.np = np; b.npFill = np.querySelector('.np-fill'); b.npHp = np.querySelector('.np-hpn');
    G.bots.push(b);
  }
  buildRoster();
}

/* dummies come back a few seconds after you drop them, so the training
   objectives can always be finished */
function reviveDummy(b) {
  b.alive = true;
  b.hp = b.maxHp;
  b.vel.set(0, 0, 0);
  /* only real training dummies carry a home post; anything else falls back
     to a normal respawn so a dummy flag can never crash the update loop */
  if (!b.home) { respawnActor(b); return; }
  b.pos.set(b.home.x, groundAt(b.home.x, b.home.z, 1), b.home.z);
  if (b.mesh) { b.mesh.visible = true; b.mesh.position.copy(b.pos); }
  if (b.np) b.np.style.opacity = '1';
}

function quitToMenu() {
  /* leaving a match means leaving the room: the others must see us go, and
     the host must tear the room down so it stops showing in the lobby */
  if (NET.room) netLeave();
  if (typeof VOTE !== 'undefined' && VOTE.active) voteEnd();
  G.state = 'menu';
  document.exitPointerLock && document.exitPointerLock();
  $('hud').classList.remove('show');
  $('pause').classList.remove('show');
  $('end').classList.remove('show');
  $('menu').classList.add('show');
  $('respawn').classList.remove('show');
  hideScope();                       // the lens is part of the match HUD
  const kb1 = $('killBy');
  if (kb1) kb1.classList.remove('show');
  G.killer = null; G.killerWeapon = '';
  SPEC.t = 0; SPEC.init = false; SPEC.spot = -1;
  $('nameplates').innerHTML = '';
  $('scoreboard').classList.remove('show');
  $('clock').classList.remove('gold');
  if (G.flags) { G.flags.red.group.visible = false; G.flags.blue.group.visible = false; }
  for (const b of G.bots) if (b.mesh) b.mesh.visible = false;
  if (G.player) G.player.alive = false;
}

function pauseGame() {
  if (G.state !== 'playing') return;
  G.state = 'paused';
  firing = false;
  hideAimLine();
  hideScope();                       // the lens must not sit over the pause card
  $('pause').classList.add('show');
  $('pauseScore').textContent = 'RED ' + G.score.red + '  —  ' + G.score.blue + ' BLUE   ·   ' + $('clock').textContent;
  document.exitPointerLock && document.exitPointerLock();
}

function resumeGame() {
  if (G.state !== 'paused') return;
  G.state = 'playing';
  $('pause').classList.remove('show');
  requestLock();
}

/* ------------------------------------------------------------
   MAIN LOOP
   ------------------------------------------------------------ */
function update(dt) {
  G.t += dt;
  if (G.mode !== 'tutorial' && !G.golden) {
    G.timeLeft -= dt;
    if (G.timeLeft <= 0) {
      G.timeLeft = 0;
      /* level at full time -> golden point instead of a draw */
      if (G.score.red === G.score.blue) startGoldenPoint();
      else { endMatch(); return; }
    }
  }
  const p = G.player;
  const prevX = p.pos.x, prevZ = p.pos.z;
  updatePlayer(dt);
  if (G.tutorial.active) {
    G.tutorial.moved += Math.hypot(p.pos.x - prevX, p.pos.z - prevZ);
  }
  for (const b of G.bots) {
    if (!b.alive) {
      /* LAST STAND: the dead stay down until the round is decided */
      if (G.mode === 'survival' && !b.dummy) continue;
      b.respawnT -= dt;
      if (b.respawnT <= 0) {
        if (b.dummy) reviveDummy(b);
        else respawnActor(b);
      }
      continue;
    }
    updateBot(b, dt);
    // bot hit flash
    if (b.hitFlash > 0) {
      b.hitFlash -= dt;
    }
  }
  separateActors();
  updateProjectiles(dt);
  updateChests(dt);
  updateFlags(dt);
  updateHill(dt);
  updateSurvival();
  updateEffects(dt);
  if (G.netMode) netTick(dt);
  updateHUD(dt);
  if (firing && p.alive) {
    const st = p.weapons[p.cur];
    const w = st ? defOf(st.id) : null;
    if (w && w.auto) tryFire(p);
  }
}

let lastT = 0;
/* Quality ladder. Each rung is only taken when the measured frame rate says
   the previous one was not enough, and only downward inside a match: stepping
   back up resizes the canvas and oscillates around the threshold. */
function perfReset() {
  PERF.scale = 1;
  PERF.level = 0;
  PERF.frames = 0; PERF.time = 0; PERF.cooldown = 1.5; PERF.warm = 2.0;
  if (renderer) {
    renderer.shadowMap.enabled = true;
    perfApply();
  }
}

function adaptQuality(raw) {
  /* A hidden tab, a GC pause or the first frame after a load are not evidence
     about the machine: throw those samples away instead of averaging them in.
     `raw` is the true frame delta — the clamped step used for simulation would
     report 20 fps on a machine actually running at 3. The cut-off sits at 2 s,
     not at a single bad frame, so a genuinely drowning machine still counts. */
  if (!(raw > 0) || raw > 2.0) { PERF.frames = 0; PERF.time = 0; return; }
  /* Shaders compile and textures upload in the first seconds of a match. That
     spike says nothing about the hardware, and acting on it used to drop the
     shadows for the whole match on a machine that then ran at 60 fps. */
  if (PERF.warm > 0) { PERF.warm -= raw; PERF.frames = 0; PERF.time = 0; return; }
  PERF.frames++; PERF.time += raw;
  if (PERF.cooldown > 0) PERF.cooldown -= raw;
  if (PERF.time < 1.5) return;
  const fps = PERF.frames / PERF.time;
  PERF.fps = Math.round(fps);
  PERF.ms = Math.round(1000 / Math.max(1, fps) * 10) / 10;
  PERF.frames = 0; PERF.time = 0;
  if (PERF.cooldown > 0) return;

  /* rung 1: shadows are the single most expensive thing we own */
  if (fps < 40 && PERF.level === 0) {
    PERF.level = 1;
    renderer.shadowMap.enabled = false;
    PERF.cooldown = 2.0;
    return;
  }
  /* rung 2+: trade resolution for frame rate, 15% at a time */
  if (fps < 48 && PERF.scale > PERF.min) {
    PERF.scale = Math.max(PERF.min, Math.round((PERF.scale - 0.15) * 100) / 100);
    perfApply();
    PERF.cooldown = 2.0;
  }
}

/* F3 readout — the only way to tell "the game is slow" from "the mouse is
   jumping" from the outside. */
function updatePerfReadout() {
  if (!PERF.show) return;
  const f = $('perfFps'), m = $('perfMs'), r = $('perfRes');
  if (f) f.textContent = PERF.fps || '--';
  if (m) m.textContent = PERF.ms || '--';
  if (r) r.textContent = (PERF.base * PERF.scale).toFixed(2) + 'x' + (PERF.level ? ' · no shadows' : '');
}

function perfToggle(on) {
  PERF.show = on === undefined ? !PERF.show : !!on;
  const el = $('perf');
  if (el) el.classList.toggle('show', PERF.show);
  updatePerfReadout();
}

function loop(ts) {
  requestAnimationFrame(loop);
  const raw = (ts - lastT) / 1000 || 0.016;
  const dt = Math.min(0.05, raw);
  lastT = ts;
  adaptQuality(raw);
  /* raw, not the clamped step: on a 4 fps machine dt is pinned at 50 ms, and
     the prompt would take fourteen frames — three and a half seconds — to show
     up, exactly on the machines that most need it. */
  syncLockHint(raw);
  PERF.uiT = (PERF.uiT || 0) + dt;
  if (PERF.show && PERF.uiT > 0.25) { PERF.uiT = 0; updatePerfReadout(); }
  if (G.state === 'playing') {
    update(dt);
  } else if (G.state === 'paused' || G.state === 'ended') {
    updateEffects(dt * 0.3);
    camera.updateMatrixWorld();
    updateNameplates();
  }
  if (G.renderer) G.renderer.render(G.scene, G.camera);
  /* The vote runs on the end screen, where update() is not called. It counts
     in real seconds, not in the clamped physics step: at 60 fps the two are the
     same, but on a machine crawling at 2 fps a 25 s vote would take six minutes
     and the "deploying" countdown would never end. Capped at a second so a
     backgrounded tab does not skip the vote the instant it is focused. */
  if (typeof VOTE !== 'undefined' && VOTE.active) updateVote(Math.min(1, raw));
}

