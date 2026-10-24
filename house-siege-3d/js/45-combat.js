/* ============================================================
   45-combat.js
   Damage, kills, kill feed, reloads and hit markers
   ============================================================ */
'use strict';

/* ------------------------------------------------------------
   COMBAT
   ------------------------------------------------------------ */
function rayActors(ox, oy, oz, dx, dy, dz, maxD, shooter) {
  let best = null, bestT = maxD, head = false;
  const list = G.bots;
  for (let i = 0; i < list.length + 1; i++) {
    const a = i < list.length ? list[i] : G.player;
    if (!a || !a.alive || a === shooter) continue;
    if (a.team === shooter.team) continue;
    const box = {
      minX: a.pos.x - 0.38, maxX: a.pos.x + 0.38,
      minY: a.pos.y + 0.05, maxY: a.pos.y + 1.78,
      minZ: a.pos.z - 0.38, maxZ: a.pos.z + 0.38
    };
    const t = rayAABB(ox, oy, oz, dx, dy, dz, box);
    if (t >= 0 && t < bestT) {
      bestT = t; best = a;
      const hy = oy + dy * t;
      head = hy > a.pos.y + 1.42;
    }
  }
  return best ? { actor: best, dist: bestT, head } : null;
}

/* escape a string for innerHTML — bot names are generated, but be safe anyway */
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function damage(target, amount, attacker, head, weaponName) {
  if (!target.alive) return;
  target.hp -= amount;
  target.hitFlash = 0.12;
  target.lastHurtT = G.t;
  if (target.isPlayer) {
    $('dmgvig').classList.add('on');
    setTimeout(() => $('dmgvig').classList.remove('on'), 90);
    Snd.hurt();
  }
  if (attacker && attacker.isPlayer) {
    showHitmarker(head);
    /* Snd.head() existed but nothing ever called it, so every hit sounded the
       same whether you clipped a shoulder or split a helmet */
    if (head) Snd.head(); else Snd.hit();
  }
  if (target.hp <= 0) {
    killActor(target, attacker, head, weaponName);
  }
}

function killActor(victim, attacker, head, weaponName) {
  victim.alive = false;
  victim.hp = 0;
  victim.deaths++;
  victim.respawnT = CFG.respawnTime;
  victim.vel.set(0, 0, 0);
  if (victim.mesh) victim.mesh.visible = false;
  if (victim.np) victim.np.style.opacity = '0';

  // drop the flag
  if (victim.carrying) dropFlag(victim.carrying, victim.pos);

  if (attacker && attacker !== victim) {
    attacker.kills++;
    /* only a real match scores: flag mode counts captures, training counts
       nothing (its dummies respawn forever, so they used to inflate the
       scoreboard to double digits during a lesson) */
    if (G.mode === 'tdm') G.score[attacker.team]++;
    if (attacker.isPlayer) {
      Snd.kill();
      addFeed(attacker.name, victim.name, weaponName || '', head, true);
    } else if (victim.isPlayer) {
      addFeed(attacker.name, victim.name, weaponName || '', head, false);
    } else {
      addFeed(attacker.name, victim.name, weaponName || '', head, false);
    }
  } else {
    addFeed(victim.name, victim.name, 'SUICIDE', false, false);
  }

  if (victim.dummy && attacker && attacker.isPlayer && G.tutorial.active) G.tutorial.kills++;
  if (victim.isPlayer) {
    /* remember the opponent so the bystander camera can watch them */
    G.killer = (attacker && attacker !== victim) ? attacker : null;
    G.killerWeapon = weaponName || '';
    G.deathPos.copy(victim.pos);
    G.deathYaw = victim.yaw;
    SPEC.t = 0; SPEC.init = false; SPEC.spot = -1;
    if (VM.group) VM.group.visible = false;    // the gun leaves your hands
    $('respawn').classList.add('show');
    $('carryBanner').classList.remove('show');
    const kb = $('killBy');
    if (G.killer) {
      kb.innerHTML = 'KILLED BY <b>' + escHtml(G.killer.name) + '</b>' +
        (G.killerWeapon ? ' <span class="kb-w">' + escHtml(G.killerWeapon) + '</span>' : '');
    } else {
      kb.innerHTML = 'YOU DIED';
    }
    kb.classList.add('show');
  }
  checkRoundEnd();
}

function showHitmarker(head) {
  const hm = $('hitmarker');
  hm.style.color = head ? '#ffcf4d' : '#fff';
  hm.classList.remove('on');
  void hm.offsetWidth;
  hm.classList.add('on');
}

function addFeed(a, b, w, head, mine) {
  const el = document.createElement('div');
  el.className = 'fd' + (head ? ' hs' : '');
  /* teamOf('YOU') already resolves to G.team — hard-coding red painted the
     player's own name red even when they had picked BLUE. */
  const ca = teamOf(a) === 'red' ? 'r' : 'b';
  el.innerHTML = '<span class="' + ca + '">' + escHtml(a) + '</span>' +
    '<span class="w">' + (head ? 'HEADSHOT ' : '') + (w ? '[' + escHtml(w) + ']' : '') + '</span>' +
    '<span class="' + (teamOf(b) === 'red' ? 'r' : 'b') + '">' + escHtml(b) + '</span>';
  $('feed').appendChild(el);
  setTimeout(() => { el.style.transition = 'opacity .4s'; el.style.opacity = '0'; }, 4200);
  setTimeout(() => el.remove(), 4800);
  while ($('feed').children.length > 6) $('feed').firstChild.remove();
}
function teamOf(name) {
  if (name === 'YOU') return G.team;
  const b = G.bots.find(x => x.name === name);
  return b ? b.team : otherTeam(G.team);
}
function otherTeam(t) { return t === 'red' ? 'blue' : 'red'; }
function teamLabel(t) { return t === 'red' ? 'RED' : 'BLUE'; }

function muzzlePos(a, out) {
  const d = dirFromAngles(a.yaw, a.pitch, new V3());
  const right = new V3(-d.z, 0, d.x);
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0); else right.normalize();
  return (out || new V3()).copy(eyePos(a)).addScaledVector(d, 0.55).addScaledVector(right, 0.2).add(new V3(0, -0.12, 0));
}

function startReload(a) {
  const st = a.weapons[a.cur], w = defOf(st.id);
  if (!w || w.melee || w.item || a.reloadT > 0) return;
  if (st.mag >= w.mag || st.res <= 0) return;
  a.reloadT = (a.isPlayer ? w.reload : a.diff.reload);
  if (a.isPlayer) Snd.reload();
}

function finishReload(a) {
  const st = a.weapons[a.cur], w = defOf(st.id);
  if (!w || w.melee || w.item) return;
  const need = w.mag - st.mag;
  const take = Math.min(need, st.res);
  st.mag += take; st.res -= take;
}

