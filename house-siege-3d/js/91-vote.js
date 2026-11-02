/* ============================================================
   91-vote.js
   End-of-match vote for the next mode and map
   ============================================================ */
'use strict';

/* ------------------------------------------------------------
   VOTE
   ------------------------------------------------------------
   When a match ends the next one is decided by the people in it. Everyone
   alive at the end gets a say: the human by clicking, each bot on a timer with
   its own preferences. The result is not a suggestion — the match starts with
   whatever won, so nobody has to sit through a menu to keep playing.

   Online the host owns the tally: guests publish a vote, the host folds it in
   with its own bots, and broadcasts the running total. */
const VOTE = {
  active: false,
  t: 0,
  dur: 25,
  votes: {},            // voterId -> { mode, map }
  voters: [],           // { id, name, team, isPlayer }
  plan: [],             // pending bot votes, sorted by time
  mode: '',             // the human's pick
  map: '',
  winner: null,
  done: false,
  hostTally: null       // online guest: the host's running total
};

function voteBegin(win) {
  VOTE.active = true;
  VOTE.done = false;
  VOTE.winner = null;
  VOTE.t = VOTE.dur;
  VOTE.votes = {};
  VOTE.plan = [];
  VOTE.mode = '';
  VOTE.map = '';
  VOTE.hostTally = null;

  /* who gets a vote: everybody still standing, which after a wipe is just the
     winners — but the losers' names are still on the scoreboard, so include
     the whole squad and let the dead vote too. It is a vote, not a prize. */
  VOTE.voters = [];
  VOTE.voters.push({ id: 'you', name: 'YOU', team: G.team, isPlayer: true });
  G.bots.forEach((b, i) => {
    if (b.dummy) return;
    VOTE.voters.push({ id: 'bot' + i, name: b.name, team: b.team, isPlayer: false });
  });

  /* each bot votes once for a mode and once for a map, spread across the
     window so the numbers move instead of appearing all at once. Online, only
     the host's squad votes — a guest's bots are its own private simulation and
     the host could not see them anyway. */
  if (!NET.room || NET.isHost) {
    G.bots.forEach((b, i) => {
      if (b.dummy) return;
      const id = 'bot' + i;
      VOTE.plan.push({ t: 1.2 + Math.random() * (VOTE.dur * 0.45), id, kind: 'mode', pick: botPick(b, 'mode') });
      VOTE.plan.push({ t: 2.0 + Math.random() * (VOTE.dur * 0.45), id, kind: 'map', pick: botPick(b, 'map') });
    });
    VOTE.plan.sort((a, b) => a.t - b.t);
  }

  $('voteKicker').textContent = win === 'DRAW' ? 'DRAW — VOTE THE NEXT MATCH' : win + ' WINS — VOTE THE NEXT MATCH';
  $('votePanel').classList.add('show');
  voteRender();
}

/* A bot's preference: it would rather not repeat what just happened, and it
   has one favourite in each list that it leans towards. Deterministic per bot
   name so the same squad does not reshuffle its tastes every round. */
function botPick(b, kind) {
  const list = kind === 'mode' ? MODE_ORDER : MAP_ORDER;
  const cur = kind === 'mode' ? G.mode : G.mapId;
  const seed = hashName(b.name + kind);
  const fav = list[seed % list.length];
  const weights = list.map(id => {
    let w = 1;
    if (id === fav) w += 1.6;
    if (id === cur) w *= 0.35;            // been there
    if (id === 'tutorial') w = 0;
    return w;
  });
  let total = 0;
  for (const w of weights) total += w;
  let r = (seed % 997) / 997 * total;
  for (let i = 0; i < list.length; i++) {
    r -= weights[i];
    if (r <= 0) return list[i];
  }
  return list[list.length - 1];
}

function hashName(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0);
}

function voteCast(id, kind, pick) {
  if (!VOTE.active || VOTE.done) return;
  const rec = VOTE.votes[id] || (VOTE.votes[id] = { mode: '', map: '' });
  rec[kind] = pick;
  if (id === 'you') {
    if (kind === 'mode') VOTE.mode = pick; else VOTE.map = pick;
    Snd.tone(560, 700, 0.05, 0.1, 'square');
    if (NET.room) netSendVote(kind, pick);
  }
  voteRender();
  voteCheckAll();
}

/* the human clicking a card */
function voteClick(kind, id) {
  if (!VOTE.active || VOTE.done) return;
  if (NET.room && !NET.isHost) {
    /* still allowed — the host counts it — but say so once */
    netToast('Vote sent to the host');
  }
  voteCast('you', kind, id);
}

function voteTally() {
  if (VOTE.hostTally) return VOTE.hostTally;
  const out = { mode: {}, map: {}, count: 0 };
  for (const id in VOTE.votes) {
    const v = VOTE.votes[id];
    if (v.mode) out.mode[v.mode] = (out.mode[v.mode] || 0) + 1;
    if (v.map) out.map[v.map] = (out.map[v.map] || 0) + 1;
    if (v.mode || v.map) out.count++;
  }
  return out;
}

function voteLeader(kind) {
  const t = voteTally()[kind] || {};
  let best = null, bv = -1;
  for (const id in t) if (t[id] > bv) { bv = t[id]; best = id; }
  return best;
}

function voteCheckAll() {
  /* online guests never resolve: the host does */
  if (NET.room && !NET.isHost) return;
  let pending = 0;
  for (const v of VOTE.voters) {
    const r = VOTE.votes[v.id];
    if (!r || !r.mode || !r.map) pending++;
  }
  /* every remote human counts as well, or the host would end the vote early
     while its guests were still deciding */
  if (NET.room && NET.isHost) {
    for (const cid of NET.peers.keys()) {
      const r = VOTE.votes[cid];
      if (!r || !r.mode || !r.map) pending++;
    }
  }
  if (pending === 0) voteResolve();
}

function updateVote(dt) {
  if (!VOTE.active) return;
  if (!VOTE.done) {
    /* fire the scheduled bot votes */
    while (VOTE.plan.length && VOTE.plan[0].t <= VOTE.dur - VOTE.t) {
      const p = VOTE.plan.shift();
      if (!VOTE.votes[p.id]) voteCast(p.id, p.kind, p.pick);
    }
    VOTE.t -= dt;
    if (VOTE.t <= 0) {
      VOTE.t = 0;
      /* a guest waits for the host's verdict rather than counting its own
         partial tally and starting a different match */
      if (!NET.room || NET.isHost) voteResolve();
    }
    voteClock();
  } else if (VOTE.t > 0) {
    VOTE.t -= dt;
    if (VOTE.t <= 0) voteLaunch();
  }
}

function voteClock() {
  const el = $('voteClock');
  if (el) el.textContent = Math.ceil(VOTE.t) + 's';
  const bar = $('voteBar');
  if (bar) bar.style.width = Math.max(0, Math.min(100, (VOTE.t / VOTE.dur) * 100)) + '%';
}

/* Show the "deploying to …" card and start the short countdown that ends in
   voteLaunch. Shared by the host (which decides) and by a guest receiving the
   host's decision — otherwise the guest jumps straight into the new match while
   the host is still sitting on its end screen for three seconds. */
function voteAnnounce(mode, map) {
  VOTE.done = true;
  VOTE.winner = { mode, map };
  VOTE.t = 3.2;
  $('voteKicker').textContent = 'NEXT MATCH';
  const el = $('voteResult');
  if (el) {
    el.innerHTML = 'DEPLOYING TO <b>' + modeDef(mode).name + '</b> ON <b>' + mapDef(map).name + '</b>';
    el.classList.add('show');
  }
  $('voteClock').textContent = '';
  voteRender();
}

function voteResolve() {
  if (VOTE.done) return;
  if (NET.room && !NET.isHost) return;      // the host owns the result
  const mode = voteLeader('mode') || G.mode;
  const map = voteLeader('map') || G.mapId;
  voteAnnounce(mode, map);
  Snd.tone(520, 900, 0.22, 0.18, 'triangle');
  if (NET.room && NET.isHost) netAnnounceNext(mode, map);
}

function voteLaunch() {
  if (!VOTE.active) return;
  const w = VOTE.winner || { mode: G.mode, map: G.mapId };
  voteEnd();
  startGame(w.mode, w.map);
}

function voteSkip() {
  if (!VOTE.active) return;
  if (NET.room && !NET.isHost) { netToast('The host decides when to deploy'); return; }
  if (!VOTE.done) voteResolve();
  else VOTE.t = 0;
}

function voteEnd() {
  VOTE.active = false;
  VOTE.done = false;
  VOTE.plan = [];
  $('votePanel').classList.remove('show');
  $('voteResult').classList.remove('show');
}

/* ------------------------------------------------------------
   RENDERING
   ------------------------------------------------------------ */
function voteRender() {
  if (!VOTE.active) return;
  const tally = voteTally();
  const cols = [
    { kind: 'mode', list: MODE_ORDER, def: modeDef, mine: VOTE.mode, el: 'voteModes' },
    { kind: 'map', list: MAP_ORDER, def: mapDef, mine: VOTE.map, el: 'voteMaps' }
  ];
  for (const col of cols) {
    const host = $(col.el);
    if (!host) continue;
    let html = '';
    for (const id of col.list) {
      const d = col.def(id);
      const n = (tally[col.kind] || {})[id] || 0;
      const on = col.mine === id ? ' on' : '';
      const win = VOTE.done && VOTE.winner && VOTE.winner[col.kind] === id ? ' won' : '';
      const sub = col.kind === 'mode' ? d.tag : d.time;
      html += '<div class="vote-card' + on + win + '" data-kind="' + col.kind + '" data-id="' + id + '">' +
        '<div class="vc-top"><span class="vc-name">' + d.name + '</span><span class="vc-n">' + n + '</span></div>' +
        '<div class="vc-sub">' + sub + '</div>' +
        '<div class="vc-bar"><i style="width:' + Math.min(100, n * 22) + '%"></i></div>' +
        '</div>';
    }
    host.innerHTML = html;
  }
  voteClock();
}

/* ------------------------------------------------------------
   WIRING
   ------------------------------------------------------------ */
function initVote() {
  const panel = $('votePanel');
  if (!panel) return;
  panel.addEventListener('click', e => {
    const card = e.target.closest('.vote-card');
    if (!card) return;
    voteClick(card.dataset.kind, card.dataset.id);
  });
  const skip = $('voteSkip');
  if (skip) skip.addEventListener('click', voteSkip);
}
