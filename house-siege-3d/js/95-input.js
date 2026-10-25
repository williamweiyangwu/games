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
    if (k === 'e') { if (G.nearChest) takeChest(G.nearChest, G.player); }
    if (k === 'q') { VM.adsOn = !VM.adsOn; Snd.tone(VM.adsOn ? 520 : 380, VM.adsOn ? 520 : 380, 0.04, 0.05, 'square'); }
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
      firing = true;
      const st = G.player.weapons[G.player.cur];
      const w = st ? defOf(st.id) : null;
      if (w && !w.auto) tryFire(G.player);
    }
    /* MIDDLE CLICK: cycle the bag — the number keys stay as they were */
    if (e.button === 1) {
      e.preventDefault();                 // otherwise the browser autoscrolls
      cycleWeapon();
    }
  });
  /* a middle click also fires auxclick after mouseup; swallow it too so no
     autoscroll drag can start while the pointer is locked */
  document.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); });
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

/* middle mouse button: step to the next occupied slot, wrapping around */
function cycleWeapon() {
  const p = G.player;
  if (!p || !p.alive || !p.weapons.length) return;
  for (let n = 1; n <= p.weapons.length; n++) {
    const j = (p.cur + n) % p.weapons.length;
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

