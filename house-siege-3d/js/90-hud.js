/* ============================================================
   90-hud.js
   Match state, HUD, roster, minimap and bag
   ============================================================ */
'use strict';

/* ------------------------------------------------------------
   MATCH STATE
   ------------------------------------------------------------ */
function checkRoundEnd() {
  if (G.state !== 'playing') return;
  const limit = G.mode === 'flag' ? CFG.flagLimit : CFG.killLimit;
  if (G.score.red >= limit || G.score.blue >= limit) endMatch();
}

function endMatch() {
  if (G.state === 'ended') return;
  G.state = 'ended';
  document.exitPointerLock && document.exitPointerLock();
  const red = G.score.red, blue = G.score.blue;
  const win = red > blue ? 'RED' : blue > red ? 'BLUE' : 'DRAW';
  $('endKicker').textContent = G.mode === 'flag' ? 'FLAG RAID COMPLETE' : 'DEATHMATCH COMPLETE';
  $('endTitle').textContent = win === 'DRAW' ? 'DRAW' : win + ' TEAM WINS';
  $('endTitle').style.color = win === 'RED' ? '#ff6b6b' : win === 'BLUE' ? '#7fabff' : '#fff';
  $('endScore').textContent = red + '  —  ' + blue;
  const p = G.player;
  const acc = p.shots ? Math.round(p.hits / p.shots * 100) : 0;
  $('endStats').innerHTML =
    '<div class="es"><b>' + p.kills + '</b><span>KILLS</span></div>' +
    '<div class="es"><b>' + p.deaths + '</b><span>DEATHS</span></div>' +
    '<div class="es"><b>' + acc + '%</b><span>ACCURACY</span></div>' +
    '<div class="es"><b>' + (G.mode === 'flag' ? G.score[G.player.team] : p.kills) + '</b><span>' + (G.mode === 'flag' ? 'CAPTURES' : 'SCORE') + '</span></div>';
  $('end').classList.add('show');
  $('hud').classList.remove('show');
  $('nameplates').innerHTML = '';
  for (const b of G.bots) b.np = null;
  Snd.tone(win === 'DRAW' ? 400 : 300, win === 'DRAW' ? 400 : 600, 0.5, 0.2, 'triangle');
}


/* ------------------------------------------------------------
   HUD
   ------------------------------------------------------------ */
let bannerT = 0;
/* true while the objective strip is pinned to a standing condition (the enemy
   is carrying your flag) rather than to a timed message */
let bannerPin = false;
function banner(html, secs) {
  const el = $('objBanner');
  el.innerHTML = html;
  el.classList.add('show');
  bannerPin = false;                 // a real message always wins the strip
  bannerT = secs || 2;
}

const rosterRows = { red: [], blue: [] };
function buildRoster() {
  $('rosterRed').innerHTML = '';
  $('rosterBlue').innerHTML = '';
  rosterRows.red = [];
  rosterRows.blue = [];
  const all = G.bots.concat([G.player]);
  for (const team of ['red', 'blue']) {
    const list = all.filter(a => a.team === team);
    for (const a of list) {
      const row = document.createElement('div');
      row.className = 'rr' + (a.isPlayer ? ' me' : '');
      row.innerHTML = '<span class="rr-name">' + (a.isPlayer ? 'YOU' : a.name) + '</span>' +
        '<span class="rr-bar"><span class="rr-fill"></span></span>' +
        '<span class="rr-hp">100</span>';
      (team === 'red' ? $('rosterRed') : $('rosterBlue')).appendChild(row);
      rosterRows[team].push({ a, row, fill: row.querySelector('.rr-fill'), hp: row.querySelector('.rr-hp') });
    }
  }
}

let rosterT = 0;
function updateRoster(dt) {
  rosterT -= dt;
  if (rosterT > 0) return;
  rosterT = 0.1;
  let ra = 0, ba = 0;
  for (const team of ['red', 'blue']) {
    for (const r of rosterRows[team]) {
      const a = r.a;
      const pct = Math.max(0, a.hp / a.maxHp * 100);
      r.fill.style.width = pct + '%';
      r.hp.textContent = a.alive ? Math.ceil(a.hp) : '—';
      r.row.classList.toggle('dead', !a.alive);
      if (a.alive) { if (team === 'red') ra++; else ba++; }
    }
  }
  $('redAlive').textContent = ra + '/' + rosterRows.red.length;
  $('blueAlive').textContent = ba + '/' + rosterRows.blue.length;
}

function updateNameplates() {
  const w = window.innerWidth, h = window.innerHeight;
  const camPos = camera.position;
  for (const b of G.bots) {
    if (!b.np) continue;
    if (!b.alive) { b.np.style.display = 'none'; continue; }
    const d = camPos.distanceTo(b.mesh.position);
    let show = d < 62;
    if (show && b.team !== G.player.team) {
      show = losClear(camPos.x, camPos.y, camPos.z, b.pos.x, b.pos.y + 1.2, b.pos.z, 0.2);
    }
    if (!show) { b.np.style.display = 'none'; continue; }
    const v = new V3(b.pos.x, b.pos.y + 2.0, b.pos.z).project(camera);
    if (v.z > 1 || v.z < -1 || Math.abs(v.x) > 0.98 || Math.abs(v.y) > 0.97) {
      b.np.style.display = 'none'; continue;
    }
    b.np.style.display = 'block';
    const x = (v.x * 0.5 + 0.5) * w;
    const y = (-v.y * 0.5 + 0.5) * h;
    b.np.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) translate(-50%,-100%)';
    const pct = Math.max(0, b.hp / b.maxHp * 100);
    b.npFill.style.width = pct + '%';
    b.npHp.textContent = Math.ceil(b.hp);
    b.np.style.opacity = clamp(1.15 - d / 62, 0.25, 1);
  }
}

/* ---------- minimap ---------- */
let mapBase = null;
function buildMapBase() {
  const c = document.createElement('canvas');
  c.width = c.height = 176;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(10,14,20,0.9)';
  g.fillRect(0, 0, 176, 176);
  const S = 176 / 80, cx = 88, cy = 88;

  /* outer envelope */
  g.strokeStyle = 'rgba(150,170,200,0.55)';
  g.lineWidth = 2;
  g.strokeRect(cx - MAP.B * S, cy - MAP.B * S, MAP.B * 2 * S, MAP.B * 2 * S);

  /* catwalk band */
  g.fillStyle = 'rgba(120,145,180,0.18)';
  const o = MAP.B + MAP.outerT / 2, m = MAP.mazeHalf;
  g.fillRect(cx - o * S, cy - o * S, o * 2 * S, (o - m) * S);
  g.fillRect(cx - o * S, cy + m * S, o * 2 * S, (o - m) * S);
  g.fillRect(cx - o * S, cy - m * S, (o - m) * S, m * 2 * S);
  g.fillRect(cx + m * S, cy - m * S, (o - m) * S, m * 2 * S);

  /* maze walls */
  g.fillStyle = 'rgba(228,232,240,0.62)';
  for (const b of G.colliders) {
    const hgt = b.maxY - b.minY;
    if (hgt < 1.6) continue;
    if (b.maxX - b.minX > 40 || b.maxZ - b.minZ > 40) continue;
    g.fillRect(cx + b.minX * S, cy + b.minZ * S, (b.maxX - b.minX) * S, (b.maxZ - b.minZ) * S);
  }

  /* team bases */
  if (G.hq) {
    for (const t of ['red', 'blue']) {
      const h = G.hq[t];
      g.strokeStyle = t === 'red' ? 'rgba(255,74,74,0.9)' : 'rgba(77,141,255,0.9)';
      g.lineWidth = 1.5;
      g.strokeRect(cx + h.x * S - 4, cy + h.z * S - 4, 8, 8);
    }
  }
  mapBase = c;
}

function drawMinimap() {
  const cv = $('minimap');
  const g = cv.getContext('2d');
  g.clearRect(0, 0, 176, 176);
  if (mapBase) g.drawImage(mapBase, 0, 0);
  const S = 176 / 80, cx = 88, cy = 88;
  const p = G.player;

  /* weapon crates — always shown, that is the whole point of the beacon */
  for (const c of G.chests) {
    if (!c.available) continue;
    const x = cx + c.pos.x * S, y = cy + c.pos.z * S;
    const r = 2.6 + Math.sin(now() * 3 + c.pos.x) * 0.7;
    g.beginPath();
    g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y);
    g.closePath();
    g.fillStyle = (c.content && c.content.item) ? '#59e0c8' : '#ffd166';
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 0.8; g.stroke();
  }

  // flags
  if (G.mode === 'flag' && G.flags) {
    for (const t of ['red', 'blue']) {
      const f = G.flags[t].group.position;
      g.fillStyle = t === 'red' ? '#ff5252' : '#5b93ff';
      g.fillRect(cx + f.x * S - 3, cy + f.z * S - 3, 6, 6);
    }
  }
  // enemies
  for (const b of G.bots) {
    if (!b.alive) continue;
    const visible = losClear(p.pos.x, p.pos.y + 1.5, p.pos.z, b.pos.x, b.pos.y + 1.2, b.pos.z, 0.2);
    if (b.team === p.team) {
      g.fillStyle = '#ff6b6b';
    } else {
      if (!visible) continue;
      g.fillStyle = '#5b93ff';
    }
    g.beginPath();
    g.arc(cx + b.pos.x * S, cy + b.pos.z * S, 2.6, 0, 7);
    g.fill();
  }
  // player arrow
  g.save();
  g.translate(cx + p.pos.x * S, cy + p.pos.z * S);
  g.rotate(-p.yaw);
  g.fillStyle = '#ffd166';
  g.beginPath();
  g.moveTo(0, -6); g.lineTo(4.2, 5); g.lineTo(0, 2.5); g.lineTo(-4.2, 5);
  g.closePath(); g.fill();
  g.restore();
}




/* ---------- main hud ---------- */
function updateHUD(dt) {
  const p = G.player;
  const t = Math.max(0, G.timeLeft);
  const mm = Math.floor(t / 60), ss = Math.floor(t % 60);
  $('clock').textContent = G.mode === 'tutorial' ? '∞' : (mm + ':' + (ss < 10 ? '0' : '') + ss);
  $('clock').classList.toggle('low', t < 30 && G.mode !== 'tutorial');
  $('scoreRed').textContent = G.score.red;
  $('scoreBlue').textContent = G.score.blue;
  const capLabel = G.mode === 'flag' ? 'CAPTURES' : 'KILLS';
  $('capRed').textContent = capLabel;
  $('capBlue').textContent = capLabel;

  // health
  const hpPct = Math.max(0, p.hp / p.maxHp * 100);
  const fill = $('hpFill');
  fill.style.width = hpPct + '%';
  fill.className = 'hp-fill' + (hpPct < 30 ? ' low' : hpPct < 60 ? ' mid' : '');
  $('hpNum').textContent = Math.max(0, Math.ceil(p.hp));

  // weapon
  const st = p.weapons[p.cur];
  const w = st ? defOf(st.id) : null;
  if (st && w) {
    $('gName').textContent = w.name;
    if (w.item) {
      $('gMag').textContent = '×' + st.count;
      $('gRes').textContent = '';
      $('gMag').parentElement.classList.remove('empty');
      const hints = {
        aid: 'LMB — PATCH UP 40 HP',
        grenade: 'HOLD LMB TO AIM · RELEASE TO THROW',
        ammo: 'LMB — REFILL RESERVES',
        stim: 'LMB — SPEED BOOST'
      };
      $('gHint').textContent = hints[w.kind] || 'LMB TO USE';
      $('gHint').classList.toggle('warn', w.kind === 'aid' && p.hp < p.maxHp * 0.5);
    } else if (w.melee) {
      $('gMag').textContent = '∞'; $('gRes').textContent = '';
      $('gHint').textContent = 'MELEE';
      $('gHint').classList.remove('warn');
    } else {
      $('gMag').textContent = st.mag;
      $('gRes').textContent = st.res;
      $('gMag').parentElement.classList.toggle('empty', st.mag === 0);
      if (w.draw && p.drawT > 0) {
        $('gHint').textContent = 'DRAWING ' + Math.round(p.drawT / w.draw * 100) + '%';
      } else {
        $('gHint').textContent = p.reloadT > 0 ? 'RELOADING…' : (st.mag === 0 ? 'PRESS R TO RELOAD' : (st.mag / w.mag < 0.3 ? 'LOW AMMO — R' : 'R RELOAD'));
      }
      $('gHint').classList.toggle('warn', st.mag === 0 || p.reloadT > 0);
    }
    const names = p.weapons.map((x, i) => {
      const d = defOf(x.id);
      const nm = d ? d.name.split(' ')[0] : x.id;
      return (i + 1) + ' ' + (d && d.item ? nm + '×' + x.count : nm);
    });
    $('vSub').textContent = names.join('   ');
  }

  // crosshair spread
  const sp = Math.hypot(p.vel.x, p.vel.z);
  const cdef = st ? defOf(st.id) : null;
  const spread = 4 + sp * 1.6 + (cdef && cdef.spread ? cdef.spread * 320 : 0);
  const ch = $('crosshair');
  ch.style.width = ch.style.height = (34 + spread) + 'px';
  ch.querySelector('.t').style.top = '0px';
  ch.querySelector('.b').style.bottom = '0px';
  ch.querySelector('.l').style.left = '0px';
  ch.querySelector('.r').style.right = '0px';

  // crossbow draw bar
  const chargeWrap = $('chargeWrap');
  if (chargeWrap) {
    if (cdef && cdef.draw && p.drawT > 0) {
      const pct = Math.min(100, p.drawT / cdef.draw * 100);
      $('chargeFill').style.width = pct + '%';
      $('chargeLabel').textContent = pct >= 99.5 ? 'LOOSE!' : 'DRAWING ' + Math.round(pct) + '%';
      chargeWrap.classList.add('show');
    } else {
      chargeWrap.classList.remove('show');
    }
  }

  updateRoster(dt);
  camera.updateMatrixWorld();
  updateNameplates();
  drawMinimap();
  updateBag();

  if (bannerT > 0) {
    bannerT -= dt;
    if (bannerT <= 0) $('objBanner').classList.remove('show');
  }

  /* Flag status strip. The old version just re-added .show every frame while
     the enemy carried your flag, without ever writing new text or clearing it
     again — so the strip stayed on screen for the rest of the match showing
     whatever message happened to be last. Now it is a proper pin: shown only
     when no timed message is up, and released the moment the flag comes home. */
  if (G.mode === 'flag' && G.flagState) {
    const mf = G.flagState[p.team];
    const el = $('objBanner');
    const enemyHasOurs = mf.at === 'carried' && mf.carrier && mf.carrier !== p;
    if (enemyHasOurs) {
      if (!bannerPin && bannerT <= 0) {
        el.innerHTML = '<span class="hl">YOUR FLAG IS TAKEN</span> — STOP THE CARRIER';
        el.classList.add('show');
        bannerPin = true;
      }
    } else if (bannerPin) {
      bannerPin = false;
      el.classList.remove('show');
    }
  } else if (bannerPin) {
    bannerPin = false;
    $('objBanner').classList.remove('show');
  }

  if (G.tutorial.active) updateTutorialTasks();
}

/* ------------------------------------------------------------
   BAG — everything you are carrying
   ------------------------------------------------------------ */
let bagSig = '';
function updateBag() {
  const p = G.player;
  if (!p || !p.weapons) return;
  let sig = '';
  let html = '';
  p.weapons.forEach((st, i) => {
    const w = defOf(st.id);
    if (!w) return;
    let ammo;
    if (w.melee) ammo = '∞';
    else if (w.item) ammo = '×' + st.count;
    else ammo = st.mag + '<i>/</i>' + st.res;
    sig += st.id + ':' + (st.mag || 0) + ':' + (st.res || 0) + ':' + (st.count || 0) + ':' + p.cur;
    html += '<div class="bag-row' + (i === p.cur ? ' cur' : '') + (w.item ? ' item' : '') + '">' +
      '<span class="bag-slot">' + (i + 1) + '</span>' +
      '<span class="bag-name">' + w.name + '</span>' +
      '<span class="bag-ammo">' + ammo + '</span></div>';
  });
  for (let i = p.weapons.length; i < CFG.slots; i++) {
    html += '<div class="bag-row empty"><span class="bag-slot">' + (i + 1) + '</span>' +
      '<span class="bag-name">— EMPTY —</span><span class="bag-ammo"></span></div>';
  }
  if (sig !== bagSig) { bagSig = sig; $('bagList').innerHTML = html; }
}

