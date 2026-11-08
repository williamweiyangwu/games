/* ============================================================
   91-vote.js
   End-of-match map vote
   ============================================================ */
'use strict';

/* ------------------------------------------------------------
   THE MAP VOTE
   ------------------------------------------------------------
   Only online. When a match ends in a room, the room picks the map for the
   next one from three candidates.

   The rules are deliberately narrow, because a vote that can change the mode
   turns a room into a different game every five minutes:

     * MAP ONLY. The mode is whatever the host chose when the room opened and
       it stays that way for as long as the room lives.
     * HUMANS ONLY. The AI squads are simulated on each machine and have no
       stake in the next match; letting them vote meant the player was
       outnumbered six to one by bots that were not even on their screen.
     * THREE CANDIDATES, picked by the host so every screen offers the same
       three.
     * A TIE IS ROLLED, not defaulted. Two maps level on votes is a coin flip
       between them, not "whatever came first in the array".

   Offline there is no vote at all: the result card counts you back to the
   lobby (see beginLobbyReturn in 96-flow.js). */
const VOTE = {
  active: false,
  t: 0,
  dur: 20,
  votes: {},            // voterId -> map id
  cands: [],            // the three maps on the card
  mine: '',             // the local human's pick
  winner: null,         // { mode, map }
  done: false,
  hostTally: null,      // guest: the host's running total
  mode: ''              // fixed for the life of the room
};

/* Start the vote. Returns false when there is nobody to vote — offline, or a
   guest that has not been told the room's mode yet. */
function voteBegin(win) {
  if (!NET.room) return false;
  VOTE.active = true;
  VOTE.done = false;
  VOTE.winner = null;
  VOTE.t = VOTE.dur;
  VOTE.votes = {};
  VOTE.mine = '';
  VOTE.hostTally = null;
  VOTE.mode = NET.room.mode || G.mode;

  /* The host draws the three cards and publishes them; a guest waits for that
     message rather than inventing its own three and voting for a map the host
     is not counting. Retained, so a guest that opens the card late still gets
     them. */
  VOTE.cands = [];
  if (NET.isHost) {
    VOTE.cands = votePickMaps();
    netPublishVoteDef(VOTE.cands);
  }

  $('voteKicker').textContent = win === 'DRAW'
    ? 'DRAW — VOTE THE NEXT MAP'
    : win + ' WINS — VOTE THE NEXT MAP';
  $('votePanel').classList.add('show');
  voteRender();
  return true;
}

/* Three maps, never the one we just played unless there is nothing else. The
   pool is shuffled so the same room does not see the same three every time. */
function votePickMaps() {
  const pool = MAP_ORDER.filter(id => id !== G.mapId);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
  }
  const out = pool.slice(0, 3);
  /* a tiny map list still has to fill three cards */
  for (const id of MAP_ORDER) {
    if (out.length >= 3) break;
    if (out.indexOf(id) < 0) out.push(id);
  }
  return out;
}

/* the host telling everyone which three are on the card */
function voteSetCands(list) {
  if (!Array.isArray(list) || !list.length) return;
  VOTE.cands = list.filter(id => !!MAPS[id]).slice(0, 3);
  if (VOTE.mine && VOTE.cands.indexOf(VOTE.mine) < 0) VOTE.mine = '';
  voteRender();
}

function voteCast(id, pick) {
  if (!VOTE.active || VOTE.done) return;
  if (VOTE.cands.length && VOTE.cands.indexOf(pick) < 0) return;
  VOTE.votes[id] = pick;
  if (id === 'you') {
    VOTE.mine = pick;
    Snd.tone(560, 700, 0.05, 0.1, 'square');
    netSendVote('map', pick);
  }
  voteRender();
  voteCheckAll();
}

/* the human clicking a card */
function voteClick(id) {
  if (!VOTE.active || VOTE.done) return;
  if (!VOTE.cands.length) { netToast('Waiting for the host'); return; }
  if (NET.room && !NET.isHost) netToast('Vote sent to the host');
  voteCast('you', id);
}

function voteTally() {
  if (VOTE.hostTally) return VOTE.hostTally;
  const out = { map: {}, count: 0 };
  for (const id in VOTE.votes) {
    const pick = VOTE.votes[id];
    if (!pick) continue;
    out.map[pick] = (out.map[pick] || 0) + 1;
    out.count++;
  }
  return out;
}

/* Nobody has to vote for the match to advance: with no votes at all every
   candidate is level on zero, which is a three-way tie and therefore a roll. */
function voteWinnerMap() {
  const t = voteTally().map || {};
  let best = -1, top = [];
  for (const id of VOTE.cands) {
    const n = t[id] || 0;
    if (n > best) { best = n; top = [id]; }
    else if (n === best) top.push(id);
  }
  if (!top.length) return VOTE.cands[0] || G.mapId;
  if (top.length === 1) return top[0];
  return top[Math.floor(Math.random() * top.length)];
}

/* the host resolves; a guest never does */
function voteCheckAll() {
  if (!VOTE.active || VOTE.done || !NET.isHost) return;
  let pending = 0;
  if (!VOTE.votes['you']) pending++;
  for (const cid of NET.peers.keys()) if (!VOTE.votes[cid]) pending++;
  if (pending === 0) voteResolve();
}

function updateVote(dt) {
  if (!VOTE.active) return;
  if (!VOTE.done) {
    /* The host repeats the candidate list while the vote runs. A guest whose
       own match ended a moment after that first message would otherwise sit on
       an empty card for the whole vote, waiting for a definition it had already
       missed. */
    if (NET.isHost && VOTE.cands.length) {
      VOTE.defT = (VOTE.defT || 0) + dt;
      if (VOTE.defT >= 2) { VOTE.defT = 0; netPublishVoteDef(VOTE.cands); }
    }
    VOTE.t -= dt;
    if (VOTE.t <= 0) {
      VOTE.t = 0;
      /* a guest waits for the host's verdict rather than counting its own
         partial tally and starting a different match */
      if (NET.isHost) voteResolve();
    }
    voteClock();
  } else if (VOTE.t > 0) {
    VOTE.t -= dt;
    if (VOTE.t <= 0) voteLaunch();
  }
}

function voteClock() {
  const el = $('voteClock');
  if (el) el.textContent = VOTE.done ? '' : Math.ceil(VOTE.t) + 's';
  const bar = $('voteBar');
  if (bar) bar.style.width = Math.max(0, Math.min(100, (VOTE.t / VOTE.dur) * 100)) + '%';
}

/* Show the "deploying to …" card and start the short countdown that ends in
   voteLaunch. Shared by the host (which decides) and by a guest receiving the
   host's decision — otherwise the guest jumps straight into the new match
   while the host is still sitting on its end screen. */
function voteAnnounce(mode, map) {
  VOTE.done = true;
  VOTE.winner = { mode: mode, map: map };
  VOTE.t = 3.2;
  $('voteKicker').textContent = 'NEXT MATCH';
  const el = $('voteResult');
  if (el) {
    el.innerHTML = 'DEPLOYING TO <b>' + mapDef(map).name + '</b> · ' +
      modeDef(mode).name;
    el.classList.add('show');
  }
  voteRender();
}

function voteResolve() {
  if (VOTE.done) return;
  if (!NET.isHost) return;                  // the host owns the result
  const mode = VOTE.mode || NET.room.mode || G.mode;
  const map = voteWinnerMap();
  voteAnnounce(mode, map);
  Snd.tone(520, 900, 0.22, 0.18, 'triangle');
  netAnnounceNext(mode, map);
}

function voteLaunch() {
  if (!VOTE.active) return;
  const w = VOTE.winner || { mode: VOTE.mode || G.mode, map: G.mapId };
  voteEnd();
  startGame(w.mode, w.map);
}

function voteSkip() {
  if (!VOTE.active) return;
  if (!NET.isHost) { netToast('The host decides when to deploy'); return; }
  if (!VOTE.done) voteResolve();
  else VOTE.t = 0;
}

function voteEnd() {
  VOTE.active = false;
  VOTE.done = false;
  VOTE.cands = [];
  const p = $('votePanel');
  if (p) p.classList.remove('show');
  const r = $('voteResult');
  if (r) r.classList.remove('show');
}

/* ------------------------------------------------------------
   RENDERING
   ------------------------------------------------------------ */
function voteRender() {
  if (!VOTE.active) return;
  const host = $('voteMaps');
  if (!host) return;
  const tally = voteTally().map || {};
  if (!VOTE.cands.length) {
    host.innerHTML = '<div class="vote-wait">WAITING FOR THE HOST…</div>';
    voteClock();
    return;
  }
  let html = '';
  for (const id of VOTE.cands) {
    const d = mapDef(id);
    const n = tally[id] || 0;
    const on = VOTE.mine === id ? ' on' : '';
    const win = VOTE.done && VOTE.winner && VOTE.winner.map === id ? ' won' : '';
    html += '<div class="vote-card' + on + win + '" data-id="' + id + '">' +
      '<div class="vc-top"><span class="vc-name">' + d.name + '</span><span class="vc-n">' + n + '</span></div>' +
      '<div class="vc-sub">' + d.time + '</div>' +
      '<div class="vc-bar"><i style="width:' + Math.min(100, n * 22) + '%"></i></div>' +
      '</div>';
  }
  host.innerHTML = html;
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
    voteClick(card.dataset.id);
  });
  const skip = $('voteSkip');
  if (skip) skip.addEventListener('click', voteSkip);
}
