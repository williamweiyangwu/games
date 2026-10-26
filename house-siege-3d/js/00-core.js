/* ============================================================
   WHITE MAZE 5v5 — 3D tactical shooter
   Three.js r149 (local build)
   ------------------------------------------------------------
   The game is split into classic scripts that share one global
   lexical scope and are loaded in dependency order by index.html.
   This file must load first: it holds the tuning tables, the
   maths helpers and the audio synth every other module uses.

   00-core.js          tuning tables, helpers, audio
   10-render.js        renderer, scene, textures, materials
   20-world.js         map, maze generation, world build
   30-nav.js           navigation graph and path finding
   35-physics.js       ray casting, collision, movement
   40-actors.js        actors, bot meshes, teams, spawning
   45-combat.js        damage, kills, kill feed, reloads
   50-items.js         aid, ammo, stim, grenades, crossbow
   55-effects.js       tracers, sparks
   60-loot.js          chests and the inventory
   65-flags.js         flag raid objective
   70-ai.js            bot perception, goals, movement
   75-player.js        player controller, death camera
   80-viewmodel.js     first-person weapon models
   90-hud.js           match state, HUD, roster, minimap
   94-tutorial.js      tutorial objectives
   95-input.js         keyboard, mouse, pointer lock
   96-flow.js          start, end, pause, main loop
   98-menu.js          menu and how-to pages
   99-boot.js          bootstrap
   ============================================================ */
'use strict';

if (!window.THREE) {
  const el = document.getElementById('loading');
  if (el) el.innerHTML =
    '<div style="text-align:center;font:14px sans-serif;color:#fff">Could not load the 3D engine (lib/three.min.js).</div>';
  throw new Error('three.js failed to load');
}

/* ------------------------------------------------------------
   CONFIG
   ------------------------------------------------------------ */
const CFG = {
  mapHalf: 36,
  gravity: 26,
  player: { radius: 0.42, height: 1.8, eye: 1.62, walk: 5.0, sprint: 7.0, jump: 7.4, accel: 62, friction: 12 },
  matchTime: 300,          // 5 minutes
  respawnTime: 3,          // 3 seconds
  killLimit: 9999,
  flagLimit: 9999,
  chestRespawn: 26,
  botsPerTeam: 4,          // + the human = 5v5
  playerHp: 140,           // you are tougher than a bot
  slots: 5                 // hotbar slots: knife, pistol + three pickups
};

const DIFF = {
  easy:   { key:'easy',   label:'EASY',   hp:90,  dmg:0.42, react:0.90, err:0.115, range:18, speed:3.2, reload:3.2, burst:0.85, jumpiness:0.25 },
  normal: { key:'normal', label:'NORMAL', hp:100, dmg:0.62, react:0.58, err:0.078, range:26, speed:3.8, reload:2.6, burst:0.58, jumpiness:0.50 },
  hard:   { key:'hard',   label:'HARD',   hp:110, dmg:0.84, react:0.34, err:0.046, range:36, speed:4.4, reload:2.1, burst:0.36, jumpiness:0.75 },
  legend: { key:'legend', label:'LEGEND', hp:125, dmg:1.05, react:0.17, err:0.024, range:50, speed:4.9, reload:1.8, burst:0.20, jumpiness:1.0 }
};

/* ------------------------------------------------------------
   STAMINA
   ------------------------------------------------------------
   Sprinting and holding your breath behind the scope both come out of the
   same pool. Run it dry and you go into oxygen debt: sprint is locked out
   and your health bleeds away until you have recovered enough to breathe
   normally again. */
const STAM = {
  max: 100,
  sprintDrain: 22,      // per second, sprinting
  breathDrain: 26,      // per second, holding breath behind the scope
  regen: 16,            // per second, once the delay has passed
  regenDelay: 0.7,      // seconds of not exerting before regen starts
  recoverAt: 25,        // stamina needed to clear the exhausted state
  breathMin: 6,         // stamina needed to start holding your breath
  exhaustDrain: 3.2,    // HP per second while in oxygen debt
  swayMax: 1.35         // extra scope wobble at zero stamina
};


const WEAPONS = {
  knife:  { id:'knife',  name:'COMBAT KNIFE', melee:true, dmg:58, rate:0.40, range:2.5, tier:0 },
  pistol: { id:'pistol', name:'M9 PISTOL',    dmg:26, rate:0.20, mag:12, reserve:120, reload:1.35, spread:0.012, auto:false, range:90, tier:1, snd:'pistol' },
  smg:    { id:'smg',    name:'MP5 SMG',      dmg:17, rate:0.078, mag:30, reserve:210, reload:1.65, spread:0.030, auto:true,  range:70, tier:2, snd:'smg' },
  rifle:  { id:'rifle',  name:'AK-47 RIFLE',  dmg:31, rate:0.112, mag:30, reserve:180, reload:2.05, spread:0.018, auto:true,  range:120, tier:3, snd:'rifle' },
  shotgun:{ id:'shotgun',name:'SPAS-12',      dmg:12, pellets:8, rate:0.85, mag:6, reserve:42, reload:2.35, spread:0.070, auto:false, range:34, tier:2, snd:'shotgun' },
  sniper: { id:'sniper', name:'AWP SNIPER',   dmg:115, rate:1.30, mag:5, reserve:25, reload:2.85, spread:0.0015, auto:false, range:220, tier:3, snd:'sniper', scope:true },
  /* slow, short-ranged and lethal: two seconds of draw for one bolt */
  crossbow:{ id:'crossbow', name:'CROSSBOW',  dmg:105, rate:0.55, mag:3, reserve:12, reload:2.40, spread:0.004, auto:false, range:30, tier:3, snd:'bow',
             draw:2.0, boltSpeed:72, boltGravity:4.5, botOk:false }
};

/* Consumables and throwables share the hotbar with guns. An entry in
   actor.weapons is either { id, mag, res } (a gun) or { id, count } (an item);
   always look the id up through defOf() so both shapes work. */
const ITEMS = {
  aid:     { id:'aid',     name:'FIELD AID',    item:true, kind:'aid',  stack:3, heal:40 },
  grenade: { id:'grenade', name:'FRAG GRENADE', item:true, kind:'nade', stack:3, speed:17.5, fuse:2.4, radius:5.2, dmg:125 },
  ammo:    { id:'ammo',    name:'AMMO BOX',     item:true, kind:'ammo', stack:2 },
  stim:    { id:'stim',    name:'STIM SHOT',    item:true, kind:'stim', stack:2, dur:8, mul:1.34 }
};
const defOf = id => WEAPONS[id] || ITEMS[id] || null;

const CHEST_POOL = ['smg','rifle','shotgun','sniper','crossbow'];
/* weighted: aid and grenades show up most often */
const ITEM_POOL  = ['aid','aid','aid','grenade','grenade','ammo','stim'];

/* ------------------------------------------------------------
   SMALL UTILS
   ------------------------------------------------------------ */
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const now = () => performance.now() / 1000;
const $ = id => document.getElementById(id);

/* ------------------------------------------------------------
   AUDIO (tiny synth, no assets)
   ------------------------------------------------------------ */
const Snd = {
  ctx: null, master: null, noiseBuf: null, muted: false,
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.42;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 0.6;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
  },
  noise(dur, freq, q, vol, type) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const flt = this.ctx.createBiquadFilter(); flt.type = type || 'lowpass';
    flt.frequency.setValueAtTime(freq, t);
    flt.frequency.exponentialRampToValueAtTime(Math.max(80, freq * 0.25), t + dur);
    flt.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(flt); flt.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  },
  tone(f0, f1, dur, vol, type) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = type || 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  },
  shot(kind, vol) {
    vol = vol === undefined ? 1 : vol;
    if (kind === 'pistol')  { this.noise(0.11, 2600, 0.9, 0.5 * vol); this.tone(180, 60, 0.10, 0.28 * vol, 'square'); }
    else if (kind === 'rifle') { this.noise(0.16, 1900, 0.8, 0.62 * vol); this.tone(150, 45, 0.15, 0.34 * vol, 'sawtooth'); }
    else if (kind === 'smg') { this.noise(0.07, 3000, 1.0, 0.36 * vol); this.tone(220, 80, 0.06, 0.18 * vol, 'square'); }
    else if (kind === 'shotgun') { this.noise(0.30, 1300, 0.7, 0.75 * vol); this.tone(110, 35, 0.25, 0.4 * vol, 'sawtooth'); }
    else if (kind === 'sniper') { this.noise(0.42, 1500, 0.6, 0.85 * vol); this.tone(90, 28, 0.38, 0.45 * vol, 'sawtooth'); }
    else { this.noise(0.1, 2200, 1, 0.4 * vol); }
  },
  hit()    { this.tone(1500, 900, 0.05, 0.20, 'triangle'); },
  head()   { this.tone(2100, 1400, 0.09, 0.24, 'triangle'); },
  kill()   { this.tone(700, 1300, 0.10, 0.22, 'square'); },
  hurt()   { this.noise(0.18, 500, 0.6, 0.35); this.tone(140, 60, 0.2, 0.2, 'sine'); },
  empty()  { this.tone(300, 180, 0.05, 0.15, 'square'); },
  reload() { this.tone(420, 260, 0.06, 0.13, 'square'); setTimeout(() => this.tone(520, 320, 0.05, 0.12, 'square'), 120); },
  pickup() { this.tone(600, 1100, 0.14, 0.18, 'triangle'); },
  slash()  { this.noise(0.14, 1600, 1.4, 0.3, 'bandpass'); },
  chest()  { this.tone(320, 520, 0.16, 0.2, 'sine'); setTimeout(() => this.tone(520, 780, 0.18, 0.16, 'sine'), 90); },
  flag()   { this.tone(520, 780, 0.18, 0.2, 'triangle'); setTimeout(() => this.tone(780, 1040, 0.22, 0.18, 'triangle'), 110); },
  heal()   { this.tone(520, 880, 0.16, 0.16, 'sine'); setTimeout(() => this.tone(880, 1180, 0.2, 0.13, 'sine'), 120); },
  stim()   { this.tone(300, 900, 0.22, 0.16, 'sawtooth'); },
  bow()    { this.noise(0.09, 1400, 1.6, 0.4, 'bandpass'); this.tone(260, 90, 0.12, 0.2, 'triangle'); },
  draw()   { this.tone(180, 260, 0.3, 0.06, 'sine'); },
  throwNade() { this.noise(0.12, 900, 1.1, 0.24, 'bandpass'); },
  bounce() { this.tone(700, 420, 0.05, 0.09, 'square'); },
  boom()   { this.noise(0.55, 700, 0.5, 0.9); this.tone(90, 24, 0.5, 0.5, 'sawtooth'); }
};

