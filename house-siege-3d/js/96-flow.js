/* ============================================================
   96-flow.js
   Starting, ending, pausing and the main loop
   ============================================================ */
'use strict';

/* ------------------------------------------------------------
   GAME FLOW
   ------------------------------------------------------------ */
function startGame(mode) {
  Snd.init();
  if (Snd.ctx && Snd.ctx.state === 'suspended') Snd.ctx.resume();
  G.mode = mode;
  G.state = 'playing';
  G.timeLeft = CFG.matchTime;
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

  createPlayer();
  if (mode === 'tutorial') { ensureBotGroup(); spawnTutorialDummies(); }
  else createTeams();
  createChests();
  createFlags();
  for (const t of ['red', 'blue']) G.flags[t].group.visible = (mode === 'flag');

  buildRoster();
  buildMapBase();

  $('modeName').textContent = mode === 'flag' ? 'FLAG RAID' : 'TEAM DEATHMATCH';
  /* paint the score strip now instead of waiting for the first HUD tick, so
     the previous match's numbers and label are never visible for a frame */
  const cap0 = mode === 'flag' ? 'CAPTURES' : 'KILLS';
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
  G.player.yaw = mode === 'tutorial' ? -Math.PI / 2 : -Math.PI / 4;
  G.player.pitch = 0;
  G.player.hp = CFG.playerHp;
  G.player.lastHurtT = 0;
  VM.adsOn = false;

  if (mode === 'tutorial') {
    $('modeName').textContent = 'TRAINING';
    startTutorial();
  }
  requestLock();
  banner(mode === 'flag' ? 'STEAL THE <span class="hl">ENEMY FLAG</span> AND RETURN IT TO YOUR HQ' :
    mode === 'tutorial' ? 'FOLLOW THE <span class="hl">TRAINING OBJECTIVES</span> ON SCREEN' :
      'ELIMINATE THE <span class="hl">' + teamLabel(otherTeam(G.team)) + ' TEAM</span> — MOST KILLS WINS', 4);
}

function spawnTutorialDummies() {
  const h = G.hq[G.team], cs = MAP.cs;
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
  updateEffects(dt);
  updateHUD(dt);
  if (firing && p.alive) {
    const st = p.weapons[p.cur];
    const w = st ? defOf(st.id) : null;
    if (w && w.auto) tryFire(p);
  }
}

let lastT = 0;
let qFrames = 0, qTime = 0, qLevel = 0;
function adaptQuality(dt) {
  qFrames++; qTime += dt;
  if (qTime < 2.2) return;
  const fps = qFrames / qTime;
  qFrames = 0; qTime = 0;
  if (fps < 38 && qLevel === 0) {
    qLevel = 1;
    renderer.shadowMap.enabled = false;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
    scene.traverse(o => { if (o.isMesh) o.castShadow = false; });
  } else if (fps < 26 && qLevel === 1) {
    qLevel = 2;
    renderer.setPixelRatio(0.75);
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
}

function loop(ts) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (ts - lastT) / 1000 || 0.016);
  lastT = ts;
  adaptQuality(dt);
  if (G.state === 'playing') {
    update(dt);
  } else if (G.state === 'paused' || G.state === 'ended') {
    updateEffects(dt * 0.3);
    camera.updateMatrixWorld();
    updateNameplates();
  }
  if (G.renderer) G.renderer.render(G.scene, G.camera);
}

