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
      /* a room we were in before a drop gets rejoined */
      if (NET._wantRoom) {
        const code = NET._wantRoom;
        NET._wantRoom = null;
        netJoin(code, true);
      }
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
      '<div class="nr-meta">' + (r.mode === 'flag' ? 'FLAG RAID' : 'DEATHMATCH') + ' · ' + ai + '</div></div>' +
      '<div class="nr-players">' + (r.n || 1) + '</div>' +
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
    mode: cfg.mode, diff: cfg.diff, ai: cfg.ai ? 1 : 0,
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

  const giveUp = () => {
    if (NET._pendingJoin !== code) return;
    NET._pendingJoin = null;
    clearTimeout(t1); clearTimeout(t2);
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
  setTimeout(giveUp, 7000);
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
  G.diff = cfg.diff || 'normal';
  Ach.bump('onlineMatches');
  startGame(cfg.mode || 'tdm');
  netShowChip(true);
  netUpdateChip();
  netToast('Joined room ' + cfg.code + (cfg.ai ? ' · AI ' + (DIFF[cfg.diff] ? DIFF[cfg.diff].label : cfg.diff) : ' · no AI'));
  /* announce ourselves so the others can spawn a body for us */
  netPub(netTopic('room/' + cfg.code + '/ev'), {
    k: 'join', cid: NET.cid, name: NET.name, team: G.team
  });
  netSendState(true);
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
      netToast('The host closed the room.');
      netLeave(true);
      if (G.state === 'playing' || G.state === 'paused') quitToMenu();
      return;
    }
    /* a late joiner picks the room up here */
    if (NET._pendingJoin === m.code) { netAdoptRoom(m); return; }
    /* the host changed a setting mid-match */
    if (m.host !== NET.cid) {
      if (G.netAi !== !!m.ai || G.diff !== m.diff) {
        G.netAi = !!m.ai;
        G.diff = m.diff;
        netToast('Host set AI ' + (m.ai ? 'ON · ' + (DIFF[m.diff] ? DIFF[m.diff].label : m.diff) : 'OFF'));
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
  peer.lastSeen = netNow();

  if (!st.alive) {
    const a = NET.remotes.get(cid);
    if (a) { a.alive = false; if (a.mesh) a.mesh.visible = false; }
    return;
  }
  if (!NET.remotes.has(cid)) netSpawnRemote(cid, st);
  const a = NET.remotes.get(cid);
  a.tx = st.x; a.ty = st.y; a.tz = st.z;
  a.tyaw = st.yaw; a.tPitch = st.pitch || 0;
  a.hp = st.hp; a.alive = true;
  a.wid = st.w;
  if (!a.mesh.visible) a.mesh.visible = true;
}

function netEvent(ev) {
  if (!ev || !ev.k) return;

  /* somebody is trying to join: resend the room config and our own state so
     they do not have to rely on retained delivery alone */
  if (ev.k === 'who') {
    if (NET.isHost && NET.room && NET.room.code === ev.code) {
      netPub(netTopic('room/' + NET.room.code + '/cfg'), NET.room, { retain: true });
      netPublishScore(true);
      netSendState(true);
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
    if (NET.isHost) netPublishScore(true);
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
    w: held ? held.id : '',
    zoom: currentZoom()
  }, { retain: true });
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
    if (NET.scoreT >= 0.25) { NET.scoreT = 0; netPublishScore(); }
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

  const hostOpts = () => ({
    mode: 'tdm',
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
