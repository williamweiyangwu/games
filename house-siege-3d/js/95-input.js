/* ============================================================
   95-input.js
   Keyboard, mouse and pointer lock
   ============================================================ */
'use strict';

/* ------------------------------------------------------------
   INPUT
   ------------------------------------------------------------ */
let firing = false, hadLock = false;
const SENS_BASE = 0.0022;

function initInput() {
  window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (k === 'tab') e.preventDefault();
    keys[k] = true;

    if (k === 'escape') {
      if (G.state === 'playing') pauseGame();
      else if (G.state === 'paused') resumeGame();
      return;
    }
    if (G.state !== 'playing' || !G.player || !G.player.alive) return;

    if (k === 'r') startReload(G.player);
    if (k === 'e') { VM.adsOn = !VM.adsOn; Snd.tone(VM.adsOn ? 520 : 380, VM.adsOn ? 520 : 380, 0.04, 0.05, 'square'); }
    if (k === '1' || k === '2' || k === '3' || k === '4' || k === '5') selectSlot(parseInt(k, 10) - 1);
    if (k === ' ' && G.tutorial.active && G.player.onGround) G.tutorial.jumps++;
    if (k === 'tab') showScoreboard(true);
  });

  window.addEventListener('keyup', e => {
    keys[e.key.toLowerCase()] = false;
    if (e.key.toLowerCase() === 'tab') showScoreboard(false);
  });

  renderer.domElement.addEventListener('mousedown', e => {
    if (G.state !== 'playing') return;
    if (!document.pointerLockElement) requestLock();
    if (e.button === 0) {
      if (!G.player || !G.player.alive) return;
      /* LMB opens a crate when one is in reach — the genre standard.
         Firing still happens for guns, but not when standing on a chest. */
      if (G.nearChest) { takeChest(G.nearChest, G.player); return; }
      firing = true;
      const st = G.player.weapons[G.player.cur];
      const w = st ? defOf(st.id) : null;
      if (w && !w.auto) tryFire(G.player);
    }
  });

  /* ---- MOUSE WHEEL: cycle the bag ------------------------------------
     Bound to the WINDOW so the wheel works whether or not the pointer is
     locked. deltaY > 0 = scroll down = next slot; deltaY < 0 = previous.
     The sign guard means a single notch always advances exactly one slot. */
  window.addEventListener('wheel', e => {
    if (G.state !== 'playing') return;
    if (!G.player || !G.player.alive) return;
    e.preventDefault();
    if (e.deltaY > 0) cycleWeapon(1);
    else if (e.deltaY < 0) cycleWeapon(-1);
  }, { passive: false });

  /* ---- MIDDLE MOUSE BUTTON: cycle the bag -------------------------------
     Bound to the WINDOW, not the canvas: a middle click that lands on any
     element other than the canvas (or that a browser delivers while the
     pointer is locked) still has to change weapon. The number keys are
     untouched. `preventDefault` stops the browser starting an autoscroll. */
  let midDown = 0, midAux = 0;
  window.addEventListener('mousedown', e => {
    if (e.button !== 1) return;
    midDown++;
    e.preventDefault();
    if (G.state === 'playing') cycleWeapon(1);
  });
  /* A normal middle click fires mousedown AND auxclick, so counting both and
     only acting on the extra ones means a setup that reports the button as
     auxclick alone still cycles — and a normal click never cycles twice. */
  window.addEventListener('auxclick', e => {
    if (e.button !== 1) return;
    e.preventDefault();
    midAux++;
    if (midAux > midDown) { midAux = midDown; if (G.state === 'playing') cycleWeapon(1); }
  });
  window.addEventListener('mouseup', e => {
    if (e.button !== 0) return;
    /* releasing the trigger is what actually throws a grenade */
    if (firing && G.state === 'playing' && G.player && G.player.alive) {
      const st = G.player.weapons[G.player.cur];
      if (st && st.id === 'grenade') throwGrenade(G.player);
    }
    firing = false;
  });

  document.addEventListener('mousemove', e => {
    if (G.state !== 'playing' || !G.player) return;
    if (!G.player.alive) return;               // the bystander camera owns the view
    if (!document.pointerLockElement && !e.buttons) return;
    /* aiming slows the turn; a scoped sniper slows it much further so the
       lens can actually be held on a target at 3x zoom */
    const st = G.player.weapons[G.player.cur];
    const cw = st ? defOf(st.id) : null;
    const adsK = VM.ads || 0;
    const slow = cw && cw.scope ? 0.72 : 0.45;
    const s = SENS_BASE * G.sensitivity * (1 - slow * adsK);
    G.player.yaw -= (e.movementX || 0) * s;
    G.player.pitch = clamp(G.player.pitch - (e.movementY || 0) * s, -1.35, 1.35);
  });

  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement) { hadLock = true; }
    else if (hadLock && G.state === 'playing') { hadLock = false; pauseGame(); }
  });

  renderer.domElement.addEventListener('click', () => {
    if (G.state === 'playing' && !document.pointerLockElement) requestLock();
  });

  window.addEventListener('blur', () => { firing = false; VM.adsOn = false; for (const k in keys) keys[k] = false; });
  window.addEventListener('contextmenu', e => e.preventDefault());
}

function requestLock() {
  if (renderer.domElement.requestPointerLock) {
    try { renderer.domElement.requestPointerLock(); } catch (e) { /* drag fallback */ }
  }
}

/* ------------------------------------------------------------
   WEAPON SELECTION — number keys, or middle click to cycle
   ------------------------------------------------------------ */
function selectSlot(i) {
  const p = G.player;
  if (!p || !p.alive || !p.weapons[i]) return;
  if (p.cur === i) return;
  p.cur = i; p.reloadT = 0; p.drawT = 0;
  Snd.tone(700, 700, 0.03, 0.06, 'square');
}

/* middle mouse button or mouse wheel: step to the next occupied slot.
   `dir` is +1 (forward/down) or -1 (backward/up); defaults to +1. */
function cycleWeapon(dir) {
  const p = G.player;
  if (!p || !p.alive || !p.weapons.length) return;
  dir = dir || 1;
  const step = dir > 0 ? 1 : p.weapons.length - 1;
  for (let n = 1; n <= p.weapons.length; n++) {
    const j = (p.cur + step * n) % p.weapons.length;
    if (p.weapons[j]) { selectSlot(j); return; }
  }
}

function showScoreboard(on) {
  if (on && G.state === 'playing') {
    const rows = a => '<div class="sb-row"><span class="sb-n">' + (a.isPlayer ? 'YOU' : a.name) + '</span>' +
      '<span class="sb-k">' + a.kills + '</span><span class="sb-d">' + a.deaths + '</span>' +
      '<span class="sb-hp">' + (a.alive ? Math.ceil(a.hp) : '—') + '</span></div>';
    const head = '<div class="sb-row head"><span class="sb-n">OPERATOR</span><span class="sb-k">K</span><span class="sb-d">D</span><span class="sb-hp">HP</span></div>';
    /* the player must appear on whichever side they picked — the blue list
       used to be built from G.bots alone, so choosing BLUE made you vanish
       from your own scoreboard */
    const all = G.bots.concat([G.player]);
    const red = all.filter(a => a.team === 'red');
    const blue = all.filter(a => a.team === 'blue');
    $('scoreboard').innerHTML = '<div class="sb-title">' + (G.mode === 'flag' ? 'FLAG RAID' : 'TEAM DEATHMATCH') + ' · ' + DIFF[G.diff].label + '</div>' +
      '<div class="sb-team"><div class="sb-tname red">RED</div>' + head + red.map(rows).join('') + '</div>' +
      '<div class="sb-team"><div class="sb-tname blue">BLUE</div>' + head + blue.map(rows).join('') + '</div>';
    $('scoreboard').classList.add('show');
  } else {
    $('scoreboard').classList.remove('show');
  }
}

