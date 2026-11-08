/* ============================================================
   97-net.js
   Online play over MQTT (WebSockets)
   ------------------------------------------------------------
   Transport: a public MQTT broker. Every room is a topic subtree, so the
   broker does the fan-out and we never need a game server.

     whitemaze/v1/rooms/<CODE>          retained room advert (public list)
     whitemaze/v1/room/<CODE>/cfg       retained room config, host-owned
     whitemaze/v1/room/<CODE>/p/<cid>   retained per-player state
     whitemaze/v1/room/<CODE>/ev        events: hits, kills, joins
     whitemaze/v1/room/<CODE>/score     retained score, host-owned
     whitemaze/v1/room/<CODE>/ping/<cid> self-echo for latency

   Authority model, chosen for what MQTT can actually do well:
   - Each client owns its own body. It publishes position at 12 Hz and is
     the only one allowed to change its own HP.
   - A shooter does hit detection locally, tells the victim, and is the one
     who declares a kill — so the kill feed and the credit are immediate.
   - The host owns the score and the match clock and broadcasts both, so
     two clients can never disagree about the scoreboard.
   - Bots are simulated locally on each machine. They fight you and each
     other, not the other humans; keeping them out of the network avoids
     every client disagreeing about where a bot is standing.

   Latency on a public broker is roughly 100-700 ms, so remote bodies are
   interpolated rather than snapped: each one chases its last received
   state instead of teleporting to it.
   ============================================================ */
'use strict';

const NET_NS = 'whitemaze/v1';
const NET_DEFAULT_BROKER = 'wss://broker.emqx.io:8084/mqtt';
const NET_HZ = 12;              // player state publishes per second
const NET_PEER_TTL = 9000;      // drop a peer after this long of silence
const NET_ROOM_TTL = 60000;     // hide a lobby room this long after its last update
const NET_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  // no I/O/0/1

const NET = {
  client: null,
  connected: false,
  status: 'offline',        // offline | connecting | online | error
  err: '',
  cid: '',
  name: '',
  broker: '',
  room: null,               // { code, mode, diff, ai, pub, host }
  isHost: false,
  peers: new Map(),         // cid -> { cid, name, team, lastSeen, hp, alive }
  remotes: new Map(),       // cid -> remote actor
  remoteList: [],           // same actors, as an array for hot loops
  rooms: new Map(),         // code -> advert
  sendT: 0, scoreT: 0, pingT: 0, rtt: 0, pingSent: 0,
  lastHit: {},              // cid -> info about the hit we just sent them
  hostLeftT: 0,
  _pendingJoin: null,
  _wantRoom: null
};

/* ------------------------------------------------------------
   SMALL HELPERS
   ------------------------------------------------------------ */
function netId(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += NET_CODE_ALPHABET[Math.floor(Math.random() * NET_CODE_ALPHABET.length)];
  return s;
}
function netNow() { return performance.now(); }
function netTopic(rest) { return NET_NS + '/' + rest; }

/* every remote body, cheaply, for the combat loops */
function remoteActors() { return NET.remoteList; }

function netPub(topic, obj, opts) {
  if (!NET.client || !NET.connected) return;
  const o = opts || {};
  try {
    NET.client.publish(topic, JSON.stringify(obj), { qos: 0, retain: !!o.retain });
  } catch (e) { /* a dropped publish is not worth tearing the session down */ }
}

/* ------------------------------------------------------------
   CONNECTION
   ------------------------------------------------------------ */
function netSetStatus(s, msg) {
  NET.status = s;
  NET.err = msg || '';
  const el = $('netStatus');
  if (el) {
    el.className = 'net-status ' + s;
    el.textContent = s === 'online' ? 'ONLINE'
      : s === 'connecting' ? 'CONNECTING…'
        : s === 'error' ? 'CONNECTION FAILED' : 'OFFLINE';
    if (msg) el.title = msg;
  }
  const dot = $('netChipDot');
  if (dot) dot.className = 'nc-dot ' + (s === 'online' ? 'ok' : s === 'connecting' ? 'wait' : 'bad');
}

function netLoadPrefs() {
  try {
    NET.broker = localStorage.getItem('wh_broker') || NET_DEFAULT_BROKER;
    NET.name = localStorage.getItem('wh_callsign') || '';
  } catch (e) {
    NET.broker = NET_DEFAULT_BROKER;
    NET.name = '';
  }
  if (!NET.name) NET.name = 'OPERATOR-' + netId(2);
  NET.cid = 'c' + netId(10).toLowerCase();
  const nb = $('netBroker'); if (nb) nb.value = NET.broker;
  const nn = $('netName'); if (nn) nn.value = NET.name;
}

/* Connect if not already connected. Resolves true when the broker is up. */
function netConnect() {
  if (NET.connected) return Promise.resolve(true);
  if (!window.mqtt) {
    netSetStatus('error', 'the MQTT library did not load');
    return Promise.resolve(false);
  }
  netSetStatus('connecting');

  /* a previous half-dead client must not linger */
  if (NET.client) { try { NET.client.end(true); } catch (e) { /* ignore */ } }

  return new Promise(resolve => {
    let settled = false;
    const finish = ok => { if (!settled) { settled = true; resolve(ok); } };

    let client;
    try {
      client = window.mqtt.connect(NET.broker, {
        clientId: 'wm_' + NET.cid,
        clean: true,
        protocolVersion: 4,
        connectTimeout: 9000,
        reconnectPeriod: 0,          // we reconnect deliberately, not silently
        keepalive: 30
      });
    } catch (e) {
      netSetStatus('error', String(e));
      finish(false);
      return;
    }

    NET.client = client;

    client.on('connect', () => {
      NET.connected = true;
      netSetStatus('online');
      netSubscribeLobby();
      /* A room we were in before a drop gets rejoined. NET.room survives the
         drop but its SUBSCRIPTION does not — netJoin would bail out on "already
         in this room" and leave us connected but deaf, hearing nothing the host
         published. So re-subscribe here and ask the host to say hello again. */
      const code = (NET.room && NET.room.code) || NET._wantRoom;
      NET._wantRoom = null;
      if (code && NET.room && NET.room.code === code) {
        netSubscribe(netTopic('room/' + code + '/#'));
        netPub(netTopic('room/' + code + '/ev'), { k: 'who', cid: NET.cid, code: code });
        if (G.player && G.state === 'playing') netSendState(true);
      } else if (code) {
        netJoin(code, true);
      }
      /* and anything we tried to send while the socket was down */
      netFlushPendingVote();
      finish(true);
    });

    client.on('error', e => {
      NET.err = String(e && e.message || e);
      if (!NET.connected) { netSetStatus('error', NET.err); finish(false); }
    });

    client.on('close', () => {
      if (NET.connected) {
        NET.connected = false;
        if (NET.room) NET._wantRoom = NET.room.code;
        netSetStatus('offline', 'connection lost');
        netShowChip(false);
        /* A public broker drops idle sockets all the time, and a laptop that
           sleeps comes back with a dead one. The client is configured not to
           reconnect on its own, so without this the session was simply over:
           the room still looked joined and every message after it vanished. */
        if (NET._wantRoom) netScheduleReconnect();
      }
    });

    client.on('message', (topic, payload) => netOnMessage(topic, payload));

    setTimeout(() => { if (!NET.connected) { netSetStatus('error', 'timed out'); finish(false); } }, 11000);
  });
}

function netSubscribe(topic) {
  if (!NET.client || !NET.connected) return;
  try { NET.client.subscribe(topic, { qos: 0 }); } catch (e) { /* ignore */ }
}

/* Deliberate reconnect with a short backoff. The MQTT client is opened with
   reconnectPeriod: 0 so a dead socket is never retried behind the game's back,
   which means the retry has to live here. Backs off to 15 s and stops as soon
   as the connection is back; the connect handler rejoins the room itself. */
function netScheduleReconnect() {
  if (NET._retryT || NET.connected) return;
  const n = NET._retryN = (NET._retryN || 0) + 1;
  const delay = Math.min(15000, 1200 * Math.pow(1.6, Math.min(n, 6)));
  netSetStatus('offline', 'reconnecting…');
  NET._retryT = setTimeout(() => {
    NET._retryT = 0;
    if (NET.connected) return;
    netConnect().then(ok => {
      if (ok) NET._retryN = 0;
      else netScheduleReconnect();
    });
  }, delay);
}

function netSubscribeLobby() {
  netSubscribe(netTopic('rooms/#'));
}

/* ------------------------------------------------------------
   LOBBY
   ------------------------------------------------------------ */
function netRenderLobby() {
  const host = $('netRooms');
  if (!host) return;
  const now = Date.now();
  for (const [code, r] of [...NET.rooms]) {
    if (now - r.ts > NET_ROOM_TTL) NET.rooms.delete(code);
  }
  const list = [...NET.rooms.values()].sort((a, b) => b.ts - a.ts);
  const cnt = $('netRoomCount');
  if (cnt) cnt.textContent = list.length ? '(' + list.length + ')' : '';

  if (!list.length) {
    host.innerHTML = '<div class="net-empty">' + (NET.connected
      ? 'No public rooms right now. Host one, or ask for an invite code.'
      : 'Not connected to the broker yet.') + '</div>';
    return;
  }
  host.innerHTML = list.map(r => {
    const diff = (DIFF[r.diff] ? DIFF[r.diff].label : r.diff || 'NORMAL');
    const ai = r.ai ? 'AI ' + diff : 'NO AI';
    return '<div class="net-room" data-code="' + escHtml(r.code) + '">' +
      '<div class="nr-code">' + escHtml(r.code) + '</div>' +
      '<div class="nr-main"><div class="nr-host">' + escHtml(r.hostName || 'HOST') + '</div>' +
      '<div class="nr-meta">' + escHtml(modeDef(r.mode).name) + ' · ' +
        escHtml(mapDef(r.map).name) + ' · ' + ai + '</div></div>' +
      '<div class="nr-players" title="operators in this room">' + (r.n || 1) + ' IN</div>' +
      '<div class="nr-go">JOIN →</div>' +
      '</div>';
  }).join('');

  host.querySelectorAll('.net-room').forEach(el => {
    el.addEventListener('click', () => netJoin(el.dataset.code));
  });
}

/* ------------------------------------------------------------
   HOSTING
   ------------------------------------------------------------ */
function netHost(opts) {
  if (!NET.connected) { netConnect().then(ok => { if (ok) netHost(opts); }); return; }
  if (NET.room) netLeave(true);

  const code = netId(4);
  const cfg = {
    code,
    host: NET.cid,
    hostName: NET.name,
    mode: opts.mode || 'tdm',
    map: opts.map || G.mapId || 'white',
    diff: opts.diff || 'normal',
    ai: !!opts.ai,
    pub: !!opts.pub,
    ts: Date.now()
  };
  NET.room = cfg;
  NET.isHost = true;
  NET.peers.clear();

  netSubscribe(netTopic('room/' + code + '/#'));
  /* retained, so anyone who joins later reads the config immediately */
  netPub(netTopic('room/' + code + '/cfg'), cfg, { retain: true });
  netPub(netTopic('room/' + code + '/score'), { red: 0, blue: 0, t: CFG.matchTime, ts: Date.now() }, { retain: true });
  if (cfg.pub) netPub(netTopic('rooms/' + code), netAdvert(cfg, 1), { retain: true });

  Ach.bump('roomsHosted');
  netStartMatch(cfg);
}

function netAdvert(cfg, n) {
  return {
    code: cfg.code, host: cfg.host, hostName: cfg.hostName,
    mode: cfg.mode, map: cfg.map, diff: cfg.diff, ai: cfg.ai ? 1 : 0,
    /* the lobby filter drops anything not marked public, so this has to be
       carried on the advert itself and not only on the room config */
    pub: !!cfg.pub,
    n: n || 1, ts: Date.now()
  };
}

/* ------------------------------------------------------------
   JOINING
   ------------------------------------------------------------ */
function netJoin(code, quiet) {
  code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  if (code.length !== 4) { netToast('Invite codes are four characters.'); return; }
  if (!NET.connected) { netConnect().then(ok => { if (ok) netJoin(code, quiet); }); return; }
  if (NET.room && NET.room.code === code) return;
  if (NET.room) netLeave(true);

  NET._pendingJoin = code;
  netSubscribe(netTopic('room/' + code + '/#'));

  /* Retained delivery is the fast path: the broker replays the host's config
     the moment we subscribe. It is not guaranteed though — a public broker
     can be slow, and a retained message can be missing after a reconnect —
     so ask the host to resend it and keep waiting for either answer. */
  const ping = () => {
    if (NET._pendingJoin !== code) return;
    netPub(netTopic('room/' + code + '/ev'), { k: 'who', cid: NET.cid, code });
  };
  ping();
  const t1 = setTimeout(ping, 700);
  const t2 = setTimeout(ping, 1800);
  /* On a public broker a subscribe that lands before the socket finished its
     handshake is silently dropped, and then the invite code looks dead. Ask
     again — re-subscribing is cheap and idempotent — before giving up. */
  const t3 = setTimeout(() => {
    if (NET._pendingJoin !== code) return;
    netSubscribe(netTopic('room/' + code + '/#'));
    ping();
  }, 3800);

  const giveUp = () => {
    if (NET._pendingJoin !== code) return;
    NET._pendingJoin = null;
    clearTimeout(t1); clearTimeout(t2); clearTimeout(t3);
    const adv = NET.rooms.get(code);
    if (adv) {
      netAdoptRoom({
        code, host: adv.host, hostName: adv.hostName, mode: adv.mode,
        diff: adv.diff, ai: !!adv.ai, pub: !!adv.pub, ts: adv.ts
      });
      return;
    }
    netToast('No room with code ' + code + '. It may have closed.');
  };
  setTimeout(giveUp, 11000);
}

/* the config arrived: become a member of this room */
function netAdoptRoom(cfg) {
  if (NET._pendingJoin) NET._pendingJoin = null;
  /* a duplicate config (a retained replay, or the host answering a second
     "who") must not tear down a match that is already running */
  if (NET.room && NET.room.code === cfg.code && G.player) return;
  NET.room = cfg;
  NET.isHost = cfg.host === NET.cid;
  netStartMatch(cfg);
}

function netStartMatch(cfg) {
  G.netMode = true;
  G.netAi = !!cfg.ai;
  /* a room config is somebody else's JSON: an unknown difficulty would leave
     DIFF[G.diff] undefined and crash the first spawn, so resolve it here */
  G.diff = DIFF[cfg.diff] ? cfg.diff : 'normal';
  Ach.bump('onlineMatches');
  startGame(cfg.mode || 'tdm', cfg.map || 'white');
  netShowChip(true);
  netUpdateChip();
  netToast('Joined room ' + cfg.code + ' · ' + modeDef(cfg.mode).name +
    ' on ' + mapDef(cfg.map).name +
    (cfg.ai ? ' · AI ' + (DIFF[cfg.diff] ? DIFF[cfg.diff].label : cfg.diff) : ' · no AI'));
  /* announce ourselves so the others can spawn a body for us */
  netPub(netTopic('room/' + cfg.code + '/ev'), {
    k: 'join', cid: NET.cid, name: NET.name, team: G.team
  });
  netSendState(true);
  /* a vote cast while the socket was down goes out the moment we are back */
  netFlushPendingVote();
}

/* ------------------------------------------------------------
   LEAVING
   ------------------------------------------------------------ */
function netLeave(quiet) {
  const r = NET.room;
  if (r) {
    netPub(netTopic('room/' + r.code + '/ev'), { k: 'left', cid: NET.cid, name: NET.name });
    if (NET.isHost) {
      /* clear the retained slots so the room stops existing for everyone */
      netPub(netTopic('room/' + r.code + '/cfg'), { closed: true, code: r.code, ts: Date.now() }, { retain: true });
      netPub(netTopic('room/' + r.code + '/score'), { closed: true, ts: Date.now() }, { retain: true });
      if (r.pub) netPub(netTopic('rooms/' + r.code), { closed: true, code: r.code, ts: Date.now() }, { retain: true });
      NET.rooms.delete(r.code);
    }
    if (NET.client && NET.connected) {
      try { NET.client.unsubscribe(netTopic('room/' + r.code + '/#')); } catch (e) { /* ignore */ }
    }
  }
  netClearRemotes();
  NET.room = null;
  NET.isHost = false;
  NET.peers.clear();
  NET._wantRoom = null;
  /* an in-flight join belongs to the room we just walked out of */
  NET._pendingJoin = null;
  G.netMode = false;
  G.netAi = false;
  netShowChip(false);
  if (!quiet) netRenderLobby();
}

function netClearRemotes() {
  for (const a of NET.remoteList) {
    if (a.np && a.np.parentNode) a.np.parentNode.removeChild(a.np);
    if (a.mesh && a.mesh.parent) a.mesh.parent.remove(a.mesh);
    if (a.parts) disposeTree(a.mesh);
  }
  NET.remotes.clear();
  NET.remoteList.length = 0;
}

/* ------------------------------------------------------------
   SURVIVING A MATCH RESTART
   ------------------------------------------------------------
   startGame() builds a fresh bot group and clears #nameplates, which is right
   for the bots (they are rebuilt from scratch) but wrong for the humans on the
   wire: their bodies live in the same group and their plates in the same
   container. Without this, the first end-of-match vote made every other player
   invisible for the rest of the session — you could still be shot by them,
   because hit detection reads their position, not their mesh.

   Detach before the group is disposed so the geometry and materials are not
   freed underneath a body that is still in use, then re-home afterwards. */
function netDetachRemotes() {
  for (const a of NET.remoteList) {
    if (a.mesh && a.mesh.parent) a.mesh.parent.remove(a.mesh);
  }
}

function netRehomeRemotes() {
  if (!G.netMode || !NET.remoteList.length) return;
  const plates = $('nameplates');
  for (const a of NET.remoteList) {
    if (a.mesh && G._botGroup && a.mesh.parent !== G._botGroup) G._botGroup.add(a.mesh);
    if (a.np && plates && a.np.parentNode !== plates) plates.appendChild(a.np);
  }
}

/* ------------------------------------------------------------
   INBOUND
   ------------------------------------------------------------ */
function netOnMessage(topic, payload) {
  let m;
  try { m = JSON.parse(payload.toString()); } catch (e) { return; }
  if (!m || typeof m !== 'object') return;

  /* ---- lobby adverts ---- */
  if (topic.startsWith(netTopic('rooms/'))) {
    const code = topic.slice(netTopic('rooms/').length);
    if (code.indexOf('/') >= 0) return;
    if (m.closed) { NET.rooms.delete(code); netRenderLobby(); return; }
    if (m.host === NET.cid && !NET.isHost) return;   // our own stale advert
    if (!m.pub) return;
    NET.rooms.set(code, m);
    netRenderLobby();
    return;
  }

  /* Which room are we listening to? Our current one — or, while a join is in
     flight, the one we are trying to join. Requiring NET.room here used to
     drop the very config that would have created it, so a join could only
     ever succeed through the slow lobby fallback (and never at all for a
     private room, which is not advertised). */
  const code = NET.room ? NET.room.code : NET._pendingJoin;
  if (!code) return;
  const base = netTopic('room/' + code + '/');
  if (!topic.startsWith(base)) return;
  const rest = topic.slice(base.length);

  if (rest === 'cfg') {
    if (m.closed) {
      /* "closed" is published retained, so it outlives the room. A guest that
         has already moved to a different room — or is in the middle of joining
         one — must not be kicked out by the death notice of the room it left.
         Only the room we are actually standing in can close on us. */
      const live = (NET.room && NET.room.code) || NET._pendingJoin || '';
      if (live && m.code && m.code !== live) return;
      netToast('The host closed the room.');
      netLeave(true);
      if (G.state === 'playing' || G.state === 'paused') quitToMenu();
      return;
    }
    /* a late joiner picks the room up here */
    if (NET._pendingJoin === m.code) { netAdoptRoom(m); return; }
    /* the host changed a setting mid-match */
    if (m.host !== NET.cid) {
      if (NET.room) { NET.room.mode = m.mode; NET.room.map = m.map; }
      if (G.netAi !== !!m.ai || G.diff !== m.diff) {
        G.netAi = !!m.ai;
        G.diff = DIFF[m.diff] ? m.diff : 'normal';
        netToast('Host set AI ' + (m.ai ? 'ON · ' + (DIFF[G.diff] ? DIFF[G.diff].label : G.diff) : 'OFF'));
      }
    }
    return;
  }

  if (rest === 'score') {
    if (m.closed) return;
    if (NET.isHost) return;                       // we wrote it
    if (typeof m.red === 'number' && typeof m.blue === 'number') {
      G.score.red = m.red;
      G.score.blue = m.blue;
    }
    /* follow the host's clock so nobody ends the match early */
    if (typeof m.t === 'number' && Math.abs(G.timeLeft - m.t) > 1.5) G.timeLeft = m.t;
    /* The host decides when a match is over, and its verdict only reaches us
       as a score. Without this check a guest kept playing a round the host had
       already finished — which is every mode whose limit is small: a flag
       capture in golden point, the last stand. */
    checkRoundEnd();
    return;
  }

  if (rest === 'obj') {
    if (NET.isHost) return;                       // we wrote it
    netApplyObj(m);
    return;
  }

  if (rest.startsWith('p/')) {
    /* bodies only matter once we are actually in the match */
    if (!NET.room) return;
    const cid = rest.slice(2);
    if (cid === NET.cid) return;
    netPeerState(cid, m);
    return;
  }

  if (rest.startsWith('ping/')) {
    const cid = rest.slice(5);
    if (cid === NET.cid && m.t) NET.rtt = Math.max(0, Math.round(netNow() - m.t));
    return;
  }

  if (rest === 'vote/def') {
    /* the host's three candidates — a guest draws exactly what it is counting */
    if (NET.isHost) return;
    if (VOTE.active) voteSetCands(m.maps || []);
    return;
  }

  if (rest.startsWith('vote/')) {
    /* only the host counts; a guest ignores other guests' picks and waits for
       the tally instead, so the two can never disagree */
    if (!NET.isHost) return;
    const cid = rest.slice(5);
    if (cid === NET.cid) return;
    netHostVote(cid, m.k, m.v);
    return;
  }

  if (rest === 'tally') {
    if (NET.isHost) return;
    VOTE.hostTally = { map: m.map || {}, count: m.n || 0 };
    if (VOTE.active) voteRender();
    return;
  }

  if (rest === 'ev') { netEvent(m); return; }
}

function netPeerState(cid, st) {
  let peer = NET.peers.get(cid);
  if (!peer) {
    peer = { cid, name: st.name || 'OPERATOR', team: st.team || 'blue', lastSeen: 0, hp: st.hp, alive: st.alive };
    NET.peers.set(cid, peer);
  }
  peer.name = st.name || peer.name;
  peer.team = st.team || peer.team;
  peer.hp = st.hp;
  peer.alive = st.alive;
  /* the scoreboard is the one place a player's own record is read by everyone
     else, so it has to travel with the body — it used to show 0/0 for every
     other human in the room */
  if (typeof st.k === 'number') peer.kills = st.k;
  if (typeof st.d === 'number') peer.deaths = st.d;
  peer.lastSeen = netNow();

  if (!st.alive) {
    const a = NET.remotes.get(cid);
    if (a) {
      a.alive = false;
      if (a.mesh) a.mesh.visible = false;
      if (typeof st.k === 'number') a.kills = st.k;
      if (typeof st.d === 'number') a.deaths = st.d;
    }
    return;
  }
  if (!NET.remotes.has(cid)) netSpawnRemote(cid, st);
  const a = NET.remotes.get(cid);
  a.tx = st.x; a.ty = st.y; a.tz = st.z;
  a.tyaw = st.yaw; a.tPitch = st.pitch || 0;
  a.hp = st.hp; a.alive = true;
  if (typeof st.k === 'number') a.kills = st.k;
  if (typeof st.d === 'number') a.deaths = st.d;
  a.wid = st.w;
  if (!a.mesh.visible) a.mesh.visible = true;
}

function netEvent(ev) {
  if (!ev || !ev.k) return;

  /* the host has finished counting: everybody deploys to the same match */
  if (ev.k === 'next') {
    if (NET.isHost) return;
    const mode = ev.mode || G.mode, map = ev.map || G.mapId;
    netToast('Next match: ' + modeDef(mode).name + ' on ' + mapDef(map).name);
    /* the host's decision is final, but it arrives while the host still has a
       three-second "deploying" countdown to run — show the same card and the
       same countdown here, so both players enter the match together instead of
       the guest standing in a level the host has not loaded yet */
    if (VOTE.active && !VOTE.done) voteAnnounce(mode, map);
    else { voteEnd(); startGame(mode, map); }
    return;
  }

  /* somebody is trying to join: resend the room config and our own state so
     they do not have to rely on retained delivery alone */
  if (ev.k === 'who') {
    if (NET.isHost && NET.room && NET.room.code === ev.code) {
      netPub(netTopic('room/' + NET.room.code + '/cfg'), NET.room, { retain: true });
      netPublishScore(true);
      netPublishObj();
      netSendState(true);
    }
    return;
  }

  if (ev.k === 'cap') {
    if (ev.by === NET.cid) {
      Snd.flag();
      banner('<span class="hl">FLAG CAPTURED!</span>', 2.2);
      Ach.bump('captures');
    } else if (G.player && ev.team === G.player.team) {
      banner('YOUR TEAM SCORED', 2);
    } else {
      banner(teamLabel(ev.team) + ' TEAM SCORED', 2);
    }
    return;
  }

  if (ev.k === 'hit') {
    if (ev.to !== NET.cid) return;               // not for us
    netTakeHit(ev);
    return;
  }

  if (ev.k === 'kill') {
    netOnKill(ev);
    return;
  }

  if (ev.k === 'join') {
    if (ev.cid === NET.cid) return;
    netToast(ev.name + ' joined');
    /* the joiner needs our state right away rather than at the next tick */
    netSendState(true);
    if (NET.isHost) { netPublishScore(true); netPublishObj(); }
    return;
  }

  if (ev.k === 'left') {
    if (ev.cid === NET.cid) return;
    netDropRemote(ev.cid);
    netToast(ev.name + ' left');
    return;
  }
}

/* ------------------------------------------------------------
   REMOTE BODIES
   ------------------------------------------------------------ */
function netSpawnRemote(cid, st) {
  const a = {
    isRemote: true, cid,
    name: st.name || 'OPERATOR',
    team: st.team || 'blue',
    pos: new V3(st.x, st.y, st.z),
    vel: new V3(),
    yaw: st.yaw || 0, pitch: st.pitch || 0,
    hp: st.hp, maxHp: CFG.playerHp,
    alive: true, isPlayer: false,
    weapons: [], cur: 0, kills: 0, deaths: 0, shots: 0, hits: 0,
    radius: 0.42, height: 1.8, carrying: null, hitFlash: 0,
    mesh: null, parts: null, np: null, npFill: null, npHp: null,
    tx: st.x, ty: st.y, tz: st.z, tyaw: st.yaw || 0, tPitch: st.pitch || 0,
    animT: 0, wid: st.w || 'pistol'
  };

  const m = buildBotMesh(a.team);
  a.parts = m; a.mesh = m.group;
  a.mesh.position.copy(a.pos);
  if (G._botGroup) G._botGroup.add(a.mesh);

  const np = document.createElement('div');
  np.className = 'np ' + a.team;
  np.innerHTML = '<div class="np-name">' + escHtml(a.name) + '</div>' +
    '<div class="np-hp"><div class="np-fill"></div></div>' +
    '<div class="np-hpn">100</div>';
  const host = $('nameplates');
  if (host) host.appendChild(np);
  a.np = np;
  a.npFill = np.querySelector('.np-fill');
  a.npHp = np.querySelector('.np-hpn');

  NET.remotes.set(cid, a);
  NET.remoteList.push(a);
}

function netDropRemote(cid) {
  const a = NET.remotes.get(cid);
  if (!a) return;
  /* somebody who leaves mid-run drops what they were carrying, otherwise the
     flag stays glued to a body that no longer exists */
  if (a.carrying && NET.isHost && G.flagState) dropFlag(a.carrying, a.pos);
  if (a.np && a.np.parentNode) a.np.parentNode.removeChild(a.np);
  if (a.mesh) disposeTree(a.mesh);
  NET.remotes.delete(cid);
  const i = NET.remoteList.indexOf(a);
  if (i >= 0) NET.remoteList.splice(i, 1);
  NET.peers.delete(cid);
}

/* Interpolate every remote body toward its last received state. Snapping
   would look like teleporting at public-broker latency, so each body eases
   toward the target and only hard-corrects when it falls far behind. */
function netUpdateRemotes(dt) {
  const now = netNow();
  for (const a of NET.remoteList) {
    const peer = NET.peers.get(a.cid);
    if (peer && now - peer.lastSeen > NET_PEER_TTL) {
      netDropRemote(a.cid);
      continue;
    }
    if (!a.alive) { if (a.mesh) a.mesh.visible = false; continue; }

    const dx = a.tx - a.pos.x, dz = a.tz - a.pos.z;
    const far = Math.hypot(dx, dz) > 6;
    const k = far ? 1 : Math.min(1, dt * 9);
    a.pos.x = lerp(a.pos.x, a.tx, k);
    a.pos.y = lerp(a.pos.y, a.ty, k);
    a.pos.z = lerp(a.pos.z, a.tz, k);

    /* shortest-arc yaw */
    let dy = a.tyaw - a.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    a.yaw += dy * Math.min(1, dt * 10);
    a.pitch = lerp(a.pitch, a.tPitch, Math.min(1, dt * 10));

    a.animT += dt;
    if (a.mesh) {
      a.mesh.position.copy(a.pos);
      a.mesh.rotation.y = a.yaw;
      a.mesh.visible = true;
      /* a simple walk cycle so remote players do not glide */
      const moving = Math.hypot(dx, dz) > 0.02;
      const sw = moving ? Math.sin(a.animT * 9) * 0.5 : 0;
      if (a.parts) {
        if (a.parts.legL) a.parts.legL.rotation.x = sw;
        if (a.parts.legR) a.parts.legR.rotation.x = -sw;
      }
    }
    if (a.hitFlash > 0) a.hitFlash -= dt;
  }
}

/* ------------------------------------------------------------
   HIT DETECTION / DAMAGE
   ------------------------------------------------------------ */
/* Called from damage() when the local shooter hits a remote body. The victim
   applies the damage itself, so their HP is never second-guessed here — but
   we keep a local estimate so the kill can be declared immediately. */
function netHitRemote(target, amount, head, weaponName) {
  if (!NET.room || !NET.connected) return;
  const p = G.player;
  const held = p.weapons[p.cur];
  let wid = held ? held.id : '';
  if (/GRENADE/i.test(weaponName || '')) wid = 'grenade';

  const dist = Math.hypot(target.pos.x - p.pos.x, target.pos.y - p.pos.y, target.pos.z - p.pos.z);
  const zoom = (wid === 'sniper' && VM.ads > 0.75) ? currentZoom() : 0;

  netPub(netTopic('room/' + NET.room.code + '/ev'), {
    k: 'hit', to: target.cid, dmg: Math.round(amount * 10) / 10,
    head: !!head, wid, zoom, dist: Math.round(dist * 10) / 10,
    from: NET.cid, fromName: NET.name
  });

  /* local estimate: enough to show a hit marker and to decide the kill */
  target.hp -= amount;
  target.hitFlash = 0.12;
  showHitmarker(head);
  if (head) Snd.head(); else Snd.hit();

  if (target.hp <= 0) {
    target.alive = false;
    if (target.mesh) target.mesh.visible = false;
    netDeclareKill(target, { wid, head, dist, zoom });
  }
}

/* the shooter owns the kill, so credit, feed and achievements land instantly */
function netDeclareKill(target, info) {
  netPub(netTopic('room/' + NET.room.code + '/ev'), {
    k: 'kill', by: NET.cid, byName: NET.name,
    victim: target.cid, victimName: target.name,
    wid: info.wid, head: !!info.head
  });
  G.player.kills++;
  Snd.kill();
  addFeed(NET.name, target.name, info.wid || '', !!info.head, true);
  Ach.onPlayerKill({
    head: !!info.head, weaponId: info.wid,
    zoom: info.wid === 'sniper' ? info.zoom : 0,
    dist: info.dist
  });
  if (NET.isHost && G.mode === 'tdm') G.score[G.player.team]++;
}

/* we were shot by another human */
function netTakeHit(ev) {
  const p = G.player;
  if (!p || !p.alive) return;
  /* a stand-in attacker so the kill card can name who did it */
  const foe = {
    isPlayer: false, isRemote: true, name: ev.fromName || 'OPERATOR',
    team: otherTeam(p.team), kills: 0, deaths: 0, weapons: [], cur: 0,
    pos: new V3(p.pos.x, p.pos.y, p.pos.z)
  };
  damage(p, ev.dmg, foe, !!ev.head, ev.wid || '');
}

/* somebody else scored; keep the feed and (on the host) the score in step */
function netOnKill(ev) {
  if (ev.by === NET.cid) return;              // already handled locally
  addFeed(ev.byName, ev.victimName, ev.wid || '', !!ev.head, false);
  if (NET.isHost && G.mode === 'tdm') {
    const killer = NET.peers.get(ev.by);
    const team = killer ? killer.team : otherTeam(G.player.team);
    G.score[team]++;
    netPublishScore(true);
    checkRoundEnd();
  }
}

/* ------------------------------------------------------------
   OUTBOUND STATE
   ------------------------------------------------------------ */
function netSendState(force) {
  if (!NET.room || !NET.connected) return;
  const p = G.player;
  if (!p) return;
  const held = p.weapons[p.cur];
  netPub(netTopic('room/' + NET.room.code + '/p/' + NET.cid), {
    cid: NET.cid, name: NET.name, team: p.team,
    x: Math.round(p.pos.x * 100) / 100,
    y: Math.round(p.pos.y * 100) / 100,
    z: Math.round(p.pos.z * 100) / 100,
    yaw: Math.round(p.yaw * 1000) / 1000,
    pitch: Math.round(p.pitch * 1000) / 1000,
    hp: Math.max(0, Math.round(p.hp)),
    alive: p.alive ? 1 : 0,
    k: p.kills, d: p.deaths,
    w: held ? held.id : '',
    zoom: currentZoom()
  }, { retain: true });
}

/* ------------------------------------------------------------
   OBJECTIVE SYNC
   ------------------------------------------------------------
   Bots are simulated separately on every machine, so two clients can never
   agree about where a flag is lying or who is carrying it. The
   objective is therefore judged by the host alone, from the humans in the
   room, and broadcast: the host's world is the only one that counts and every
   guest draws it. Bots still fight — they just never score, which is exactly
   how a kill already works online. */

function netCidOf(a) {
  if (!a) return '';
  return a.isPlayer ? NET.cid : (a.cid || '');
}

function netCarrierActor(cid) {
  if (!cid) return null;
  if (cid === NET.cid) return G.player || null;
  return NET.remotes.get(cid) || null;
}

function netPublishObj() {
  if (!NET.isHost || !NET.room || !NET.connected) return;
  if (G.mode !== 'flag') return;
  const m = { m: G.mode, ts: Date.now() };
  if (!G.flagState) return;
  m.f = {};
  for (const team of ['red', 'blue']) {
    const fs = G.flagState[team];
    m.f[team] = {
      at: fs.at,
      c: netCidOf(fs.carrier),
      x: Math.round(fs.pos.x * 100) / 100,
      y: Math.round(fs.pos.y * 100) / 100,
      z: Math.round(fs.pos.z * 100) / 100,
      d: Math.round((fs.dropT || 0) * 10) / 10
    };
  }
  netPub(netTopic('room/' + NET.room.code + '/obj'), m, { retain: true });
}

/* a human on the host captured: credit the machine that did it */
function netObjCapture(a) {
  if (!NET.isHost || !NET.room || !NET.connected) return;
  const cid = a && !a.isPlayer ? netCidOf(a) : '';
  if (cid) netPub(netTopic('room/' + NET.room.code + '/ev'), { k: 'cap', by: cid, team: a.team });
  netPublishObj();
}

function netApplyObj(m) {
  if (!m || m.m !== G.mode || !G.player) return;
  if (G.mode !== 'flag') return;
  if (!m.f || !G.flagState) return;
  const before = G.player.carrying;
  for (const team of ['red', 'blue']) {
    const s = m.f[team];
    if (!s) continue;
    const fs = G.flagState[team];
    fs.at = s.at;
    fs.dropT = s.d || 0;
    fs.pos.set(s.x, s.y, s.z);
    fs.carrier = s.at === 'carried' ? netCarrierActor(s.c) : null;
  }
  /* mirror the carriers onto the bodies we can see */
  G.player.carrying = null;
  for (const a of NET.remoteList) a.carrying = null;
  for (const team of ['red', 'blue']) {
    const c = G.flagState[team].carrier;
    if (c) c.carrying = team;
  }
  const now = G.player.carrying;
  if (now && !before) {
    Snd.flag();
    banner('YOU HAVE THE <span class="hl">' + now.toUpperCase() + ' FLAG</span> — RUN HOME', 3);
    $('carryBanner').classList.add('show');
  } else if (!now && before) {
    $('carryBanner').classList.remove('show');
  }
}

function netPublishScore(force) {
  if (!NET.isHost || !NET.room || !NET.connected) return;
  netPub(netTopic('room/' + NET.room.code + '/score'), {
    red: G.score.red, blue: G.score.blue,
    t: Math.max(0, Math.round(G.timeLeft * 10) / 10),
    ts: Date.now()
  }, { retain: true });
  /* keep the lobby advert's player count honest */
  if (NET.room.pub) {
    netPub(netTopic('rooms/' + NET.room.code),
      netAdvert(NET.room, NET.peers.size + 1), { retain: true });
  }
}

/* ------------------------------------------------------------
   PER-FRAME
   ------------------------------------------------------------ */
function netTick(dt) {
  if (!NET.room) return;

  NET.sendT += dt;
  if (NET.sendT >= 1 / NET_HZ) {
    NET.sendT = 0;
    netSendState();
  }

  NET.pingT += dt;
  if (NET.pingT >= 3) {
    NET.pingT = 0;
    netPub(netTopic('room/' + NET.room.code + '/ping/' + NET.cid), { t: netNow() });
  }

  if (NET.isHost) {
    NET.scoreT += dt;
    if (NET.scoreT >= 0.25) {
      NET.scoreT = 0;
      netPublishScore();
      /* flag state rides along: small, retained, and the only way a
         guest can know what the objective is doing on the host's machine */
      netPublishObj();
    }
  }

  netUpdateRemotes(dt);
  netUpdateChip();
}

/* ------------------------------------------------------------
   CHIP
   ------------------------------------------------------------ */
function netShowChip(on) {
  const el = $('netChip');
  if (el) el.classList.toggle('show', !!on);
}

function netUpdateChip() {
  const code = $('netChipCode');
  const info = $('netChipInfo');
  if (code && NET.room) code.textContent = NET.room.code;
  if (info) {
    const n = NET.peers.size + 1;
    const lat = NET.rtt ? ' · ' + NET.rtt + 'ms' : '';
    info.textContent = n + (n === 1 ? ' PLAYER' : ' PLAYERS') + lat + (NET.isHost ? ' · HOST' : '');
  }
}

/* ------------------------------------------------------------
   SMALL TOAST
   ------------------------------------------------------------ */
let netToastT = 0;
function netToast(msg) {
  const el = $('netToast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(netToastT);
  netToastT = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ------------------------------------------------------------
   UI WIRING
   ------------------------------------------------------------ */
function initNet() {
  netLoadPrefs();
  netSetStatus('offline');

  /* The mode and map rows are generated from the same registries the menu and
     the vote screen use, so a new mode or map shows up here for free. The mode
     row used to be a single hard-coded DEATHMATCH button, which is why online
     play looked like it only had one mode. */
  const buildSeg = (id, ids, label, attr, sel) => {
    const row = $(id);
    if (!row) return;
    const pick = ids.indexOf(sel) >= 0 ? sel : ids[0];
    row.innerHTML = ids.map(k =>
      '<button data-' + attr + '="' + k + '"' + (k === pick ? ' class="on"' : '') + '>' +
      label(k) + '</button>').join('');
  };
  buildSeg('netMode', MODE_ORDER, id => modeDef(id).short, 'mode', 'tdm');
  buildSeg('netMap', MAP_ORDER, id => mapDef(id).name.replace(/^THE /, ''), 'map', G.mapId);

  const hostOpts = () => ({
    mode: (document.querySelector('#netMode button.on') || {}).dataset?.mode || 'tdm',
    map: (document.querySelector('#netMap button.on') || {}).dataset?.map || G.mapId || 'white',
    diff: (document.querySelector('#netDiff button.on') || {}).dataset?.diff || 'normal',
    ai: (document.querySelector('#netAi button.on') || {}).dataset?.ai !== 'off',
    pub: (document.querySelector('#netVis button.on') || {}).dataset?.vis !== 'private'
  });

  /* segmented control helper */
  const seg = (id, onPick) => {
    const row = $(id);
    if (!row) return;
    row.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => {
        row.querySelectorAll('button').forEach(x => x.classList.remove('on'));
        b.classList.add('on');
        if (onPick) onPick(b);
      });
    });
  };
  seg('netVis');
  seg('netMode');
  seg('netMap');
  seg('netAi', b => {
    const off = b.dataset.ai === 'off';
    const r = $('netDiffRow');
    if (r) r.classList.toggle('muted', off);
  });
  seg('netDiff');

  const openBtn = $('btnOnline');
  if (openBtn) openBtn.addEventListener('click', () => {
    $('online').classList.add('show');
    netRenderLobby();
    netConnect().then(ok => { if (ok) netRenderLobby(); });
  });
  const closeBtn = $('btnNetClose');
  if (closeBtn) closeBtn.addEventListener('click', () => $('online').classList.remove('show'));

  const hostBtn = $('btnHost');
  if (hostBtn) hostBtn.addEventListener('click', () => {
    const nameEl = $('netName');
    if (nameEl && nameEl.value.trim()) {
      NET.name = nameEl.value.trim().slice(0, 14);
      try { localStorage.setItem('wh_callsign', NET.name); } catch (e) { /* ignore */ }
    }
    $('online').classList.remove('show');
    netHost(hostOpts());
  });

  const joinBtn = $('btnJoin');
  if (joinBtn) joinBtn.addEventListener('click', () => {
    const codeEl = $('netCode');
    const code = codeEl ? codeEl.value : '';
    const nameEl = $('netName');
    if (nameEl && nameEl.value.trim()) {
      NET.name = nameEl.value.trim().slice(0, 14);
      try { localStorage.setItem('wh_callsign', NET.name); } catch (e) { /* ignore */ }
    }
    $('online').classList.remove('show');
    netJoin(code);
  });
  const codeEl = $('netCode');
  if (codeEl) {
    codeEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' && joinBtn) joinBtn.click();
      e.stopPropagation();
    });
  }

  /* lobby adverts expire; repaint so dead rooms disappear */
  setInterval(() => { if (NET.rooms.size) netRenderLobby(); }, 8000);

  /* leaving the page should tell the room, not just vanish */
  window.addEventListener('beforeunload', () => {
    if (NET.room) {
      netPub(netTopic('room/' + NET.room.code + '/ev'), { k: 'left', cid: NET.cid, name: NET.name });
    }
  });
}

/* ------------------------------------------------------------
   VOTING OVER THE WIRE
   ------------------------------------------------------------
   The host counts. A guest publishes its own pick on its own retained topic;
   the host folds it in with its local bots and republishes the running total,
   which every guest renders. The host is the only one that starts the match,
   and it announces the winner so nobody has to guess. */
function netPublishVoteDef(list) {
  if (!NET.isHost || !NET.room) return;
  netPub(netTopic('room/' + NET.room.code + '/vote/def'), { maps: list }, { retain: true });
}

function netSendVote(kind, pick) {
  if (!NET.room) return;
  /* Remember the pick even if the socket is down: a dropped connection during
     the vote is exactly when a guest would otherwise lose their say silently. */
  const q = (NET._pendingVotes || []).filter(v => !(v.code === NET.room.code && v.kind === kind));
  q.push({ kind: kind, pick: pick, code: NET.room.code });
  NET._pendingVotes = q;
  if (!NET.connected) {
    netToast('Vote saved — it goes out when the connection is back');
    return;
  }
  netFlushPendingVote();
}

function netFlushPendingVote() {
  const q = NET._pendingVotes;
  if (!q || !q.length || !NET.room || !NET.connected) return;
  const code = NET.room.code, keep = [];
  for (const p of q) {
    if (p.code !== code) { keep.push(p); continue; }
    netPub(netTopic('room/' + code + '/vote/' + NET.cid),
      { k: p.kind, v: p.pick, n: NET.name }, { retain: true });
  }
  NET._pendingVotes = keep;
}

function netHostVote(cid, kind, pick) {
  if (!NET.isHost || !VOTE.active) return;
  if (kind !== 'map') return;                     // the mode is not up for vote
  /* a pick outside the host's three is not counted: a guest that drew a
     different set (a stale retained card, say) must not be able to smuggle a
     map onto the ballot */
  if (VOTE.cands.length && VOTE.cands.indexOf(pick) < 0) return;
  VOTE.votes[cid] = pick;
  voteRender();
  netPublishTally();
  voteCheckAll();
}

function netPublishTally() {
  if (!NET.isHost || !NET.room) return;
  const t = voteTally();
  netPub(netTopic('room/' + NET.room.code + '/tally'),
    { map: t.map, n: t.count }, { retain: true });
}

function netAnnounceNext(mode, map) {
  if (!NET.isHost || !NET.room) return;
  /* the mode is whatever the room opened with; only the map can change */
  NET.room.mode = NET.room.mode || mode;
  NET.room.map = map;
  netPub(netTopic('room/' + NET.room.code + '/ev'), { k: 'next', mode: mode, map: map });
  netPub(netTopic('room/' + NET.room.code + '/cfg'), NET.room, { retain: true });
}
