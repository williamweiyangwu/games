/* ============================================================
   WHITE HOUSE 5v5 — 3D tactical shooter
   Three.js r149 (local build)
   ============================================================ */
(function () {
'use strict';

if (!window.THREE) {
  document.getElementById('loading').innerHTML =
    '<div style="text-align:center;font:14px sans-serif;color:#fff">Could not load the 3D engine (lib/three.min.js).</div>';
  return;
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
  regenDelay: 4.5,         // seconds without damage before health regenerates
  regenRate: 18            // hp per second
};

const DIFF = {
  easy:   { key:'easy',   label:'EASY',   hp:90,  dmg:0.42, react:0.90, err:0.115, range:18, speed:3.2, reload:3.2, burst:0.85, jumpiness:0.25 },
  normal: { key:'normal', label:'NORMAL', hp:100, dmg:0.62, react:0.58, err:0.078, range:26, speed:3.8, reload:2.6, burst:0.58, jumpiness:0.50 },
  hard:   { key:'hard',   label:'HARD',   hp:110, dmg:0.84, react:0.34, err:0.046, range:36, speed:4.4, reload:2.1, burst:0.36, jumpiness:0.75 },
  legend: { key:'legend', label:'LEGEND', hp:125, dmg:1.05, react:0.17, err:0.024, range:50, speed:4.9, reload:1.8, burst:0.20, jumpiness:1.0 }
};

const WEAPONS = {
  knife:  { id:'knife',  name:'COMBAT KNIFE', melee:true, dmg:58, rate:0.40, range:2.5, tier:0 },
  pistol: { id:'pistol', name:'M9 PISTOL',    dmg:26, rate:0.20, mag:12, reserve:120, reload:1.35, spread:0.012, auto:false, range:90, tier:1, snd:'pistol' },
  smg:    { id:'smg',    name:'MP5 SMG',      dmg:17, rate:0.078, mag:30, reserve:210, reload:1.65, spread:0.030, auto:true,  range:70, tier:2, snd:'smg' },
  rifle:  { id:'rifle',  name:'AK-47 RIFLE',  dmg:31, rate:0.112, mag:30, reserve:180, reload:2.05, spread:0.018, auto:true,  range:120, tier:3, snd:'rifle' },
  shotgun:{ id:'shotgun',name:'SPAS-12',      dmg:12, pellets:8, rate:0.85, mag:6, reserve:42, reload:2.35, spread:0.070, auto:false, range:34, tier:2, snd:'shotgun' },
  sniper: { id:'sniper', name:'AWP SNIPER',   dmg:115, rate:1.30, mag:5, reserve:25, reload:2.85, spread:0.0015, auto:false, range:220, tier:3, snd:'sniper', scope:true }
};
const CHEST_POOL = ['smg','rifle','shotgun','sniper'];

/* ------------------------------------------------------------
   SMALL UTILS
   ------------------------------------------------------------ */
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
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
  flag()   { this.tone(520, 780, 0.18, 0.2, 'triangle'); setTimeout(() => this.tone(780, 1040, 0.22, 0.18, 'triangle'), 110); }
};

/* ------------------------------------------------------------
   RENDERER / SCENE
   ------------------------------------------------------------ */
const G = {
  scene: null, camera: null, renderer: null, clock: null,
  mode: 'tdm', diff: 'normal', team: 'red', state: 'menu',
  colliders: [], ramps: [], bots: [], chests: [], flags: null,
  player: null, effects: [], tracers: [], particles: [],
  timeLeft: CFG.matchTime, score: { red: 0, blue: 0 },
  sensitivity: 1, started: false, lastHud: 0, t: 0,
  flagState: { red: { at:'base', carrier:null, dropT:0, pos:new THREE.Vector3(0,0,30) },
               blue:{ at:'base', carrier:null, dropT:0, pos:new THREE.Vector3(0,0,-30) } },
  tutorial: { active:false, tasks:[], step:0 }
};

let renderer, scene, camera, clock = null;
const V3 = THREE.Vector3;

function initThree() {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.68;
  document.body.insertBefore(renderer.domElement, document.body.firstChild);
  renderer.domElement.id = 'view';

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xc6d6e4, 90, 235);

  camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.06, 500);
  camera.rotation.order = 'YXZ';

  G.renderer = renderer; G.scene = scene; G.camera = camera;

  /* ---- sky dome ---- */
  const SUN_DIR = new THREE.Vector3(-0.44, 0.82, 0.44).normalize();
  const skyGeo = new THREE.SphereGeometry(340, 32, 20);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      topCol: { value: new THREE.Color(0x2a6ba8) },
      midCol: { value: new THREE.Color(0x9cc4e4) },
      botCol: { value: new THREE.Color(0xe4ecf0) },
      sunDir: { value: SUN_DIR.clone() }
    },
    vertexShader:
      'varying vec3 vDir;\n' +
      'void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader:
      'uniform vec3 topCol; uniform vec3 midCol; uniform vec3 botCol; uniform vec3 sunDir; varying vec3 vDir;\n' +
      'void main(){\n' +
      '  vec3 d = normalize(vDir);\n' +
      '  float h = clamp(d.y, -1.0, 1.0);\n' +
      '  vec3 col = mix(botCol, midCol, smoothstep(-0.04, 0.30, h));\n' +
      '  col = mix(col, topCol, smoothstep(0.18, 0.85, h));\n' +
      '  float sd = max(dot(d, normalize(sunDir)), 0.0);\n' +
      '  col += vec3(1.0, 0.86, 0.62) * pow(sd, 220.0) * 1.6;\n' +
      '  col += vec3(1.0, 0.88, 0.70) * pow(sd, 6.0) * 0.14;\n' +
      '  gl_FragColor = vec4(col, 1.0);\n' +
      '}'
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.frustumCulled = false;
  scene.add(sky);
  G.sky = sky;

  /* ---- lighting ---- */
  const hemi = new THREE.HemisphereLight(0xbcd7f0, 0x4b4a36, 0.34);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff2da, 1.02);
  sun.position.copy(SUN_DIR).multiplyScalar(90);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1536, 1536);
  const sc = sun.shadow.camera;
  sc.left = -48; sc.right = 48; sc.top = 48; sc.bottom = -48; sc.near = 20; sc.far = 210;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
  scene.add(sun.target);
  G.sun = sun;

  scene.add(new THREE.AmbientLight(0xdfe9f5, 0.07));

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

/* ------------------------------------------------------------
   TEXTURES + MATERIALS
   ------------------------------------------------------------ */
function makeTex(size, draw, repX, repY) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repX || repY) t.repeat.set(repX || 1, repY || 1);
  t.anisotropy = 8;
  if (THREE.sRGBEncoding !== undefined) t.encoding = THREE.sRGBEncoding;
  return t;
}

/* fine grain overlay used by most surfaces */
function grain(g, s, amount, dark) {
  const img = g.getImageData(0, 0, s, s), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    d[i] = clamp(d[i] + n, 0, 255);
    d[i + 1] = clamp(d[i + 1] + n, 0, 255);
    d[i + 2] = clamp(d[i + 2] + n, 0, 255);
  }
  g.putImageData(img, 0, 0);
  if (dark) {
    g.globalAlpha = 0.05;
    for (let i = 0; i < 60; i++) {
      g.fillStyle = Math.random() < 0.5 ? '#000' : '#fff';
      const r = Math.random() * s * 0.28;
      g.beginPath(); g.arc(Math.random() * s, Math.random() * s, r, 0, 7); g.fill();
    }
    g.globalAlpha = 1;
  }
}

function texPlaster(base, streak) {
  return makeTex(256, (g, s) => {
    g.fillStyle = base; g.fillRect(0, 0, s, s);
    grain(g, s, 9, false);
    g.globalAlpha = 0.04;
    for (let i = 0; i < 26; i++) {
      g.strokeStyle = streak || '#b9b4a8';
      g.lineWidth = Math.random() * 1.6;
      g.beginPath();
      const x = Math.random() * s;
      g.moveTo(x, 0); g.lineTo(x + (Math.random() - 0.5) * 12, s);
      g.stroke();
    }
    g.globalAlpha = 1;
  });
}

function texPlanks(base, dark, rep) {
  return makeTex(512, (g, s) => {
    g.fillStyle = base; g.fillRect(0, 0, s, s);
    const rows = 8, hh = s / rows;
    for (let r = 0; r < rows; r++) {
      const y = r * hh;
      const shade = 0.86 + Math.random() * 0.24;
      g.fillStyle = base;
      g.globalAlpha = 1;
      g.save();
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = 'rgba(' + (Math.random() < 0.5 ? '255,255,255' : '0,0,0') + ',' + (Math.random() * 0.09).toFixed(3) + ')';
      g.fillRect(0, y, s, hh);
      g.restore();
      // grain
      for (let i = 0; i < 26; i++) {
        g.strokeStyle = 'rgba(0,0,0,' + (0.02 + Math.random() * 0.07).toFixed(3) + ')';
        g.lineWidth = 0.6 + Math.random() * 1.2;
        g.beginPath();
        const yy = y + Math.random() * hh;
        g.moveTo(0, yy);
        g.bezierCurveTo(s * 0.3, yy + (Math.random() - 0.5) * 5, s * 0.65, yy + (Math.random() - 0.5) * 5, s, yy);
        g.stroke();
      }
      // plank seam
      g.strokeStyle = dark; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(0, y); g.lineTo(s, y); g.stroke();
      // staggered end joints
      const jx = ((r * 137) % 4) * (s / 4) + s / 8;
      g.beginPath(); g.moveTo(jx, y); g.lineTo(jx, y + hh); g.stroke();
      void shade;
    }
    grain(g, s, 10, false);
  }, rep || 1, rep || 1);
}

function texTiles(base, grout, n) {
  return makeTex(512, (g, s) => {
    g.fillStyle = grout; g.fillRect(0, 0, s, s);
    const step = s / n;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const v = 0.94 + Math.random() * 0.1;
        const col = new THREE.Color(base).multiplyScalar(v);
        g.fillStyle = '#' + col.getHexString();
        g.fillRect(x * step + 2, y * step + 2, step - 4, step - 4);
      }
    }
    grain(g, s, 8, true);
  });
}

function texGrass() {
  return makeTex(512, (g, s) => {
    g.fillStyle = '#54683c'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 2600; i++) {
      const c = ['#6a8549', '#546c3c', '#758f52', '#4d6338', '#7f9a5b'][i % 5];
      g.strokeStyle = c;
      g.globalAlpha = 0.35 + Math.random() * 0.45;
      g.lineWidth = 1 + Math.random();
      const x = Math.random() * s, y = Math.random() * s;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 4, y - 2 - Math.random() * 5); g.stroke();
    }
    g.globalAlpha = 1;
    for (let i = 0; i < 40; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,.06)' : 'rgba(255,255,255,.05)';
      g.beginPath(); g.arc(Math.random() * s, Math.random() * s, 20 + Math.random() * 60, 0, 7); g.fill();
    }
  }, 100, 100);
}

function texBrick() {
  return makeTex(256, (g, s) => {
    g.fillStyle = '#8d8477'; g.fillRect(0, 0, s, s);
    const bh = s / 8, bw = s / 4;
    for (let r = 0; r < 8; r++) {
      for (let c = -1; c < 5; c++) {
        const off = (r % 2) * bw / 2;
        const x = c * bw + off, y = r * bh;
        const v = 0.82 + Math.random() * 0.3;
        const col = new THREE.Color(0x9d5f4a).multiplyScalar(v);
        g.fillStyle = '#' + col.getHexString();
        g.fillRect(x + 1.5, y + 1.5, bw - 3, bh - 3);
      }
    }
    grain(g, s, 12, false);
  });
}

function texSlate() {
  return makeTex(256, (g, s) => {
    g.fillStyle = '#3d4147'; g.fillRect(0, 0, s, s);
    const n = 6, st = s / n;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const v = 0.85 + Math.random() * 0.3;
        const col = new THREE.Color(0x4a5058).multiplyScalar(v);
        g.fillStyle = '#' + col.getHexString();
        g.fillRect(x * st + 1, y * st + 1, st - 2, st - 2);
      }
    }
    grain(g, s, 10, false);
  });
}

function texRug(a, b) {
  return makeTex(256, (g, s) => {
    g.fillStyle = a; g.fillRect(0, 0, s, s);
    g.strokeStyle = b; g.globalAlpha = 0.85; g.lineWidth = 3;
    g.strokeRect(12, 12, s - 24, s - 24);
    g.lineWidth = 1.5;
    g.strokeRect(22, 22, s - 44, s - 44);
    g.globalAlpha = 1;
    g.fillStyle = b;
    for (let i = 0; i < 9; i++) {
      g.beginPath();
      g.arc(s / 2, s / 2, 16 + i * 9, 0, 7);
      g.globalAlpha = i % 2 ? 0.18 : 0.4;
      g.fill();
    }
    g.globalAlpha = 1;
    grain(g, s, 14, false);
  });
}

function texCrate() {
  return makeTex(256, (g, s) => {
    g.fillStyle = '#8b6b42'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 5; i++) {
      g.fillStyle = i % 2 ? 'rgba(0,0,0,.10)' : 'rgba(255,255,255,.06)';
      g.fillRect(0, i * s / 5, s, s / 5 - 2);
    }
    g.strokeStyle = '#5d4526'; g.lineWidth = 10;
    g.strokeRect(5, 5, s - 10, s - 10);
    g.lineWidth = 8;
    g.beginPath(); g.moveTo(10, 10); g.lineTo(s - 10, s - 10); g.stroke();
    g.beginPath(); g.moveTo(s - 10, 10); g.lineTo(10, s - 10); g.stroke();
    grain(g, s, 16, true);
  });
}

function texSiding() {
  return makeTex(256, (g, s) => {
    g.fillStyle = '#f4f2ea'; g.fillRect(0, 0, s, s);
    const rows = 10, hh = s / rows;
    for (let r = 0; r < rows; r++) {
      const y = r * hh;
      const grd = g.createLinearGradient(0, y, 0, y + hh);
      grd.addColorStop(0, 'rgba(255,255,255,0.55)');
      grd.addColorStop(0.75, 'rgba(255,255,255,0.0)');
      grd.addColorStop(1, 'rgba(120,118,108,0.22)');
      g.fillStyle = grd;
      g.fillRect(0, y, s, hh);
      g.fillStyle = 'rgba(120,118,108,0.22)';
      g.fillRect(0, y + hh - 1.5, s, 1.5);
    }
    grain(g, s, 5, false);
  });
}

const MAT = {};
function initMaterials() {
  MAT.wall     = new THREE.MeshStandardMaterial({ map: texSiding(), color: 0xe9e7de, roughness: 0.9, metalness: 0.02 });
  MAT.wallIn   = new THREE.MeshStandardMaterial({ map: texPlaster('#dcd6c8', '#b3ab9b'), roughness: 0.94, metalness: 0.02 });
  MAT.floor    = new THREE.MeshStandardMaterial({ map: texPlanks('#9c6f45', '#6b4a2b'), roughness: 0.72, metalness: 0.04 });
  MAT.floor2   = new THREE.MeshStandardMaterial({ map: texPlanks('#8a6240', '#5d3f24'), roughness: 0.74, metalness: 0.04 });
  MAT.tile     = new THREE.MeshStandardMaterial({ map: texTiles('#d9d4c8', '#a9a49a', 4), roughness: 0.55, metalness: 0.06 });
  MAT.ground   = new THREE.MeshStandardMaterial({ map: texGrass(), roughness: 0.99, metalness: 0 });
  MAT.rail     = new THREE.MeshStandardMaterial({ color: 0x565d66, roughness: 0.42, metalness: 0.6 });
  MAT.wood     = new THREE.MeshStandardMaterial({ map: texPlanks('#7d5230', '#4c2f19', 1), roughness: 0.8, metalness: 0.03 });
  MAT.woodDark = new THREE.MeshStandardMaterial({ color: 0x4a2f1c, roughness: 0.86, metalness: 0.03 });
  MAT.gold     = new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.3, metalness: 0.9 });
  MAT.metal    = new THREE.MeshStandardMaterial({ color: 0x3b4048, roughness: 0.42, metalness: 0.85 });
  MAT.crate    = new THREE.MeshStandardMaterial({ map: texCrate(), roughness: 0.88, metalness: 0.04 });
  MAT.red      = new THREE.MeshStandardMaterial({ color: 0xb32424, roughness: 0.7, metalness: 0.1 });
  MAT.blue     = new THREE.MeshStandardMaterial({ color: 0x2450b3, roughness: 0.7, metalness: 0.1 });
  MAT.glass    = new THREE.MeshStandardMaterial({ color: 0xa9c9e4, roughness: 0.1, metalness: 0.5, transparent: true, opacity: 0.4 });
  MAT.trim     = new THREE.MeshStandardMaterial({ color: 0xf6f5f0, roughness: 0.68, metalness: 0.04 });
  MAT.glassWin = new THREE.MeshStandardMaterial({ color: 0x27384a, roughness: 0.08, metalness: 0.85 });
  MAT.plinth   = new THREE.MeshStandardMaterial({ color: 0xa8a49b, roughness: 0.92, metalness: 0.03 });
  MAT.roof     = new THREE.MeshStandardMaterial({ map: texSlate(), roughness: 0.9, metalness: 0.06 });
  MAT.brick    = new THREE.MeshStandardMaterial({ map: texBrick(), roughness: 0.95, metalness: 0.02 });
  MAT.fabric   = new THREE.MeshStandardMaterial({ color: 0x8d8b7e, roughness: 0.97, metalness: 0 });
  MAT.fabricR  = new THREE.MeshStandardMaterial({ color: 0x8a3b34, roughness: 0.97, metalness: 0 });
  MAT.rugRed   = new THREE.MeshStandardMaterial({ map: texRug('#6d3230', '#b99a63'), roughness: 0.98, metalness: 0 });
  MAT.rugBlue  = new THREE.MeshStandardMaterial({ map: texRug('#3a4657', '#93a0ae'), roughness: 0.98, metalness: 0 });
  MAT.leaf     = new THREE.MeshStandardMaterial({ color: 0x3f6b32, roughness: 0.92, metalness: 0 });
  MAT.leafDark = new THREE.MeshStandardMaterial({ color: 0x2f5227, roughness: 0.94, metalness: 0 });
  MAT.bark     = new THREE.MeshStandardMaterial({ color: 0x4a3728, roughness: 0.96, metalness: 0 });
  MAT.terracotta = new THREE.MeshStandardMaterial({ color: 0xa9613c, roughness: 0.9, metalness: 0.02 });
  MAT.paper    = new THREE.MeshStandardMaterial({ color: 0xe8e2d0, roughness: 0.95, metalness: 0 });
  MAT.base     = new THREE.MeshStandardMaterial({ color: 0xcfc9bd, roughness: 0.72, metalness: 0.04 });
  MAT.shutter  = new THREE.MeshStandardMaterial({ color: 0x4c5a55, roughness: 0.78, metalness: 0.06 });
  MAT.concrete = new THREE.MeshStandardMaterial({ color: 0x8e8b83, roughness: 0.95, metalness: 0.02, map: texTiles('#9b978e', '#7d7a71', 3) });
  MAT.pad      = new THREE.MeshStandardMaterial({ color: 0x93918a, roughness: 0.93, metalness: 0.03, map: texTiles('#9c9a92', '#86847c', 4) });

  /* --- white maze --- */
  MAT.mazeWall = new THREE.MeshStandardMaterial({ map: texPlaster('#e7e4dc', '#c6c1b5'), roughness: 0.94, metalness: 0.02 });
  MAT.mazeCap  = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.04 });
  MAT.mazeFloor= new THREE.MeshStandardMaterial({ map: texTiles('#e6e4dd', '#c3c0b6', 6), roughness: 0.62, metalness: 0.05 });
  MAT.deck     = new THREE.MeshStandardMaterial({ map: texTiles('#b9bcc0', '#8f9296', 5), roughness: 0.5, metalness: 0.35 });
  MAT.deckEdge = new THREE.MeshStandardMaterial({ color: 0x6e7278, roughness: 0.42, metalness: 0.6 });
}

/* rescale box UVs so textures keep a constant texel density */
function boxUV(geo, w, h, d, scale) {
  const uv = geo.attributes.uv;
  const s = scale || 2.2;
  const spans = [
    [d, h], [d, h],   // +X, -X
    [w, d], [w, d],   // +Y, -Y
    [w, h], [w, h]    // +Z, -Z
  ];
  for (let f = 0; f < 6; f++) {
    const su = spans[f][0] / s, sv = spans[f][1] / s;
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i;
      uv.setXY(idx, uv.getX(idx) * su, uv.getY(idx) * sv);
    }
  }
  uv.needsUpdate = true;
}

/* ------------------------------------------------------------
   WORLD BUILDING
   ------------------------------------------------------------ */
function addBox(cx, cy, cz, w, h, d, mat, opt) {
  opt = opt || {};
  const geo = new THREE.BoxGeometry(w, h, d);
  if (mat && mat.map && !opt.noUV) boxUV(geo, w, h, d, opt.uvScale || 2.4);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(cx, cy, cz);
  m.castShadow = opt.shadow !== false;
  m.receiveShadow = opt.receive !== false;
  scene.add(m);
  if (!opt.noBase && h > 2.6 && Math.min(w, d) <= 0.55 && cy - h / 2 < 0.2 && h < 9) {
    const along = w > d ? 'x' : 'z';
    const bw = along === 'x' ? w : 0.07;
    const bd = along === 'x' ? 0.07 : d;
    const bxp = along === 'x' ? cx : cx + (Math.random() < 0.5 ? 1 : -1) * (w / 2 + 0.035);
    const bzp = along === 'x' ? cz + (Math.random() < 0.5 ? 1 : -1) * (d / 2 + 0.035) : cz;
    const bb = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.14, bd), MAT.base);
    bb.position.set(bxp, 0.11, bzp);
    bb.receiveShadow = true;
    scene.add(bb);
  }
  if (opt.collide !== false) {
    G.colliders.push({
      minX: cx - w / 2, maxX: cx + w / 2,
      minY: cy - h / 2, maxY: cy + h / 2,
      minZ: cz - d / 2, maxZ: cz + d / 2,
      name: opt.name || ''
    });
  }
  return m;
}

/* wall running along X at fixed z, with door gaps */
function wallX(z, x1, x2, y0, y1, gaps, t, mat) {
  t = t || 0.36; mat = mat || MAT.wall;
  const segs = splitSegments(x1, x2, gaps);
  for (const [a, b] of segs) {
    if (b - a < 0.02) continue;
    addBox((a + b) / 2, (y0 + y1) / 2, z, b - a, y1 - y0, t, mat);
  }
}
/* wall running along Z at fixed x */
function wallZ(x, z1, z2, y0, y1, gaps, t, mat) {
  t = t || 0.36; mat = mat || MAT.wall;
  const segs = splitSegments(z1, z2, gaps);
  for (const [a, b] of segs) {
    if (b - a < 0.02) continue;
    addBox(x, (y0 + y1) / 2, (a + b) / 2, t, y1 - y0, b - a, mat);
  }
}
function splitSegments(a, b, gaps) {
  if (!gaps || !gaps.length) return [[a, b]];
  const g = gaps.slice().sort((p, q) => p[0] - q[0]);
  const out = []; let cur = a;
  for (const [g0, g1] of g) {
    if (g0 > cur) out.push([cur, g0]);
    cur = Math.max(cur, g1);
  }
  if (cur < b) out.push([cur, b]);
  return out;
}

/* ------------------------------------------------------------
   WORLD — an enclosed white maze. Level 1 is the labyrinth,
   level 2 is a catwalk platform running right around the edge.
   ------------------------------------------------------------ */
const MAP = {
  B: 36,             // outer wall centreline
  outerT: 0.7,       // outer wall thickness
  platY: 4.2,        // catwalk deck height
  mazeHalf: 29.5,    // maze extends +-this
  N: 13,             // maze cells per side
  wallH: 3.0,        // maze wall height
  wallT: 0.42,       // maze wall thickness
  railH: 1.15        // catwalk railing height
};
MAP.cs = (MAP.mazeHalf * 2) / MAP.N;
MAP.g0 = -MAP.mazeHalf;

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function cellCenter(i, j) {
  return { x: MAP.g0 + (i + 0.5) * MAP.cs, z: MAP.g0 + (j + 0.5) * MAP.cs };
}

/* Perfect maze from a randomised depth-first search, then a share of the walls
   knocked back out so there are loops — a pure tree maze makes every fight a
   cornering, which is miserable in a shooter. */
function genMaze(N, rnd) {
  const cells = [];
  for (let j = 0; j < N; j++) {
    const row = [];
    for (let i = 0; i < N; i++) row.push({ N: true, E: true, S: true, W: true, vis: false, carve: false });
    cells.push(row);
  }
  const stack = [[0, 0]];
  cells[0][0].vis = true;
  while (stack.length) {
    const i = stack[stack.length - 1][0], j = stack[stack.length - 1][1];
    const nb = [];
    if (j > 0 && !cells[j - 1][i].vis) nb.push([i, j - 1, 'N', 'S']);
    if (i < N - 1 && !cells[j][i + 1].vis) nb.push([i + 1, j, 'E', 'W']);
    if (j < N - 1 && !cells[j + 1][i].vis) nb.push([i, j + 1, 'S', 'N']);
    if (i > 0 && !cells[j][i - 1].vis) nb.push([i - 1, j, 'W', 'E']);
    if (!nb.length) { stack.pop(); continue; }
    const p = nb[(rnd() * nb.length) | 0];
    cells[j][i][p[2]] = false;
    cells[p[1]][p[0]][p[3]] = false;
    cells[p[1]][p[0]].vis = true;
    stack.push([p[0], p[1]]);
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    if (i < N - 1 && cells[j][i].E && rnd() < 0.20) { cells[j][i].E = false; cells[j][i + 1].W = false; }
    if (j < N - 1 && cells[j][i].S && rnd() < 0.20) { cells[j][i].S = false; cells[j + 1][i].N = false; }
  }
  return cells;
}

function buildWorld() {
  const N = MAP.N, cs = MAP.cs, g0 = MAP.g0, MH = MAP.mazeHalf, PY = MAP.platY;
  const B = MAP.B, OT = MAP.outerT;
  const outer = B + OT / 2;                 // outer face of the perimeter
  const deckC = (MH + outer) / 2;           // catwalk centreline
  const deckW = outer - MH;                 // catwalk width

  /* --- ground --- */
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), MAT.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.06;          // sit under the maze slab, no z-fighting
  ground.receiveShadow = true;
  scene.add(ground);

  /* --- maze floor --- */
  addBox(0, -0.08, 0, MH * 2 + 0.5, 0.16, MH * 2 + 0.5, MAT.mazeFloor, { name: 'mazefloor' });

  /* --- maze layout --- */
  const cells = genMaze(N, mulberry32(20261018));
  G.maze = cells;

  const openCell = (i, j) => {
    if (i < 0 || j < 0 || i >= N || j >= N) return;
    const c = cells[j][i];
    c.carve = true;
    if (c.W && i > 0) { c.W = false; cells[j][i - 1].E = false; }
    if (c.E && i < N - 1) { c.E = false; cells[j][i + 1].W = false; }
    if (c.N && j > 0) { c.N = false; cells[j - 1][i].S = false; }
    if (c.S && j < N - 1) { c.S = false; cells[j + 1][i].N = false; }
  };

  /* a two-cell well in the middle of each side, where the stairs go up */
  const RW = cs * 0.46;          // stair half width
  const RUN = 9.0;               // stair run
  const well = (minX, maxX, minZ, maxZ) => {
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x0 = g0 + i * cs, x1 = x0 + cs, z0 = g0 + j * cs, z1 = z0 + cs;
      if (x1 > minX && x0 < maxX && z1 > minZ && z0 < maxZ) openCell(i, j);
    }
  };
  well(-RW, RW, MH - RUN, MH);
  well(-RW, RW, -MH, -MH + RUN);
  well(MH - RUN, MH, -RW, RW);
  well(-MH, -MH + RUN, -RW, RW);

  /* open corner plazas: 3x3 cells knocked out so each HQ has room to fight in.
     red takes the south-west corner, blue the north-east. */
  const plaza = (i0, j0) => {
    for (let j = j0; j < j0 + 3; j++) for (let i = i0; i < i0 + 3; i++) openCell(i, j);
  };
  plaza(0, N - 3);
  plaza(N - 3, 0);

  const ramps = [
    { axis: 'z', minX: -RW, maxX: RW, minZ: MH - RUN, maxZ: MH, yAtMinZ: 0, yAtMaxZ: PY },
    { axis: 'z', minX: -RW, maxX: RW, minZ: -MH, maxZ: -MH + RUN, yAtMinZ: PY, yAtMaxZ: 0 },
    { axis: 'x', minX: MH - RUN, maxX: MH, minZ: -RW, maxZ: RW, yAtMinX: 0, yAtMaxX: PY },
    { axis: 'x', minX: -MH, maxX: -MH + RUN, minZ: -RW, maxZ: RW, yAtMinX: PY, yAtMaxX: 0 }
  ];
  for (const r of ramps) G.ramps.push(r);

  /* The four stair ramps are solid bulkheads that swallow the two cells they run
     through. A perfect DFS maze is a tree, so those cells can be the ONLY link
     between regions — with them blocked, half the map (and a whole team's HQ)
     gets walled off. Carve extra gaps until every non-ramp cell is reachable. */
  {
    const inRampCell = (i, j) => {
      const c = cellCenter(i, j);
      return G.ramps.some(r => c.x > r.minX - 0.3 && c.x < r.maxX + 0.3 && c.z > r.minZ - 0.3 && c.z < r.maxZ + 0.3);
    };
    const passable = (i, j) => i >= 0 && j >= 0 && i < N && j < N && !inRampCell(i, j);
    for (let guard = 0; guard < 60; guard++) {
      const comp = new Int16Array(N * N).fill(-1);
      let nc = 0;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        if (!passable(i, j) || comp[j * N + i] >= 0) continue;
        const q = [[i, j]]; comp[j * N + i] = nc;
        while (q.length) {
          const [a, b] = q.shift();
          const c = cells[b][a];
          if (!c.W && passable(a - 1, b) && comp[b * N + a - 1] < 0) { comp[b * N + a - 1] = nc; q.push([a - 1, b]); }
          if (!c.E && passable(a + 1, b) && comp[b * N + a + 1] < 0) { comp[b * N + a + 1] = nc; q.push([a + 1, b]); }
          if (!c.N && passable(a, b - 1) && comp[(b - 1) * N + a] < 0) { comp[(b - 1) * N + a] = nc; q.push([a, b - 1]); }
          if (!c.S && passable(a, b + 1) && comp[(b + 1) * N + a] < 0) { comp[(b + 1) * N + a] = nc; q.push([a, b + 1]); }
        }
        nc++;
      }
      if (nc <= 1) break;
      let carved = false;
      for (let j = 0; j < N && !carved; j++) for (let i = 0; i < N && !carved; i++) {
        if (!passable(i, j)) continue;
        if (i < N - 1 && passable(i + 1, j) && comp[j * N + i] !== comp[j * N + i + 1]) {
          cells[j][i].E = false; cells[j][i + 1].W = false; carved = true;
        } else if (j < N - 1 && passable(i, j + 1) && comp[j * N + i] !== comp[(j + 1) * N + i]) {
          cells[j][i].S = false; cells[j + 1][i].N = false; carved = true;
        }
      }
      if (!carved) break;
    }
  }

  /* --- maze walls: collinear runs merged so the collider list stays small --- */
  for (let i = 1; i < N; i++) {
    let run = -1;
    for (let j = 0; j <= N; j++) {
      const has = j < N && cells[j][i].W;
      if (has && run < 0) run = j;
      if (!has && run >= 0) {
        addBox(g0 + i * cs, MAP.wallH / 2, g0 + (run + j) / 2 * cs,
          MAP.wallT, MAP.wallH, (j - run) * cs + MAP.wallT, MAT.mazeWall, { name: 'maze' });
        run = -1;
      }
    }
  }
  for (let j = 1; j < N; j++) {
    let run = -1;
    for (let i = 0; i <= N; i++) {
      const has = i < N && cells[j][i].N;
      if (has && run < 0) run = i;
      if (!has && run >= 0) {
        addBox(g0 + (run + i) / 2 * cs, MAP.wallH / 2, g0 + j * cs,
          (i - run) * cs + MAP.wallT, MAP.wallH, MAP.wallT, MAT.mazeWall, { name: 'maze' });
        run = -1;
      }
    }
  }

  /* --- catwalk: solid parapet block all round, deck on top --- */
  addBox(0, PY / 2, deckC, outer * 2, PY, deckW, MAT.mazeWall, { name: 'deckS' });
  addBox(0, PY / 2, -deckC, outer * 2, PY, deckW, MAT.mazeWall, { name: 'deckN' });
  addBox(deckC, PY / 2, 0, deckW, PY, MH * 2, MAT.mazeWall, { name: 'deckE' });
  addBox(-deckC, PY / 2, 0, deckW, PY, MH * 2, MAT.mazeWall, { name: 'deckW' });

  /* dark trim along the inner lip so the two levels read apart */
  const trim = (x, z, w, d) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.07, d), MAT.deckEdge);
    m.position.set(x, PY + 0.035, z); m.receiveShadow = true; scene.add(m);
  };
  trim(0, MH - 0.09, MH * 2, 0.18);
  trim(0, -MH + 0.09, MH * 2, 0.18);
  trim(MH - 0.09, 0, 0.18, MH * 2);
  trim(-MH + 0.09, 0, 0.18, MH * 2);

  /* metal deck plate on top of the white parapet */
  const plate = (x, z, w, d) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), MAT.deck);
    m.position.set(x, PY + 0.025, z); m.receiveShadow = true; scene.add(m);
  };
  plate(0, deckC, outer * 2 - 0.1, deckW - 0.1);
  plate(0, -deckC, outer * 2 - 0.1, deckW - 0.1);
  plate(deckC, 0, deckW - 0.1, MH * 2 - 0.1);
  plate(-deckC, 0, deckW - 0.1, MH * 2 - 0.1);

  /* --- outer wall above the deck: sealed, no way out ---
     runs corner to corner, not just across the maze, or you can walk
     straight off the deck corners onto the grass */
  const wallTop = 11.0;
  wallX(B, -outer, outer, PY, wallTop, [], OT, MAT.mazeWall);
  wallX(-B, -outer, outer, PY, wallTop, [], OT, MAT.mazeWall);
  wallZ(B, -outer, outer, PY, wallTop, [], OT, MAT.mazeWall);
  wallZ(-B, -outer, outer, PY, wallTop, [], OT, MAT.mazeWall);

  /* --- railings on the inner edge, open only where each stair arrives ---
     the gap is the ramp width plus a hair: any wider and you can stroll
     off the catwalk through the railing right beside the stairs */
  const gap = RW + 0.45;
  wallX(MH, -MH, MH, PY, PY + MAP.railH, [[-gap, gap]], 0.14, MAT.rail);
  wallX(-MH, -MH, MH, PY, PY + MAP.railH, [[-gap, gap]], 0.14, MAT.rail);
  wallZ(MH, -MH, MH, PY, PY + MAP.railH, [[-gap, gap]], 0.14, MAT.rail);
  wallZ(-MH, -MH, MH, PY, PY + MAP.railH, [[-gap, gap]], 0.14, MAT.rail);
  // posts
  for (const s of [-1, 1]) {
    for (let t = -26; t <= 26; t += 6.5) {
      if (Math.abs(t) < gap + 1.5) continue;
      addBox(t, PY + MAP.railH / 2, s * MH, 0.1, MAP.railH, 0.1, MAT.rail, { collide: false, shadow: false });
      addBox(s * MH, PY + MAP.railH / 2, t, 0.1, MAP.railH, 0.1, MAT.rail, { collide: false, shadow: false });
    }
  }

  /* --- stairs: solid boxes from the floor up. The smooth ramp in groundAt
     still does the lifting, so the 0.26 m rises are walked, not jumped —
     but the steps themselves are REAL: without colliders you could walk
     into the staircase from the side at ground level and clip straight
     through the white steps (and shoot through them). --- */
  const STEPS = 16;
  for (const r of ramps) {
    const along = r.axis === 'x' ? (r.maxX - r.minX) : (r.maxZ - r.minZ);
    const run = along / STEPS;
    for (let s = 0; s < STEPS; s++) {
      const t = (s + 0.5) / STEPS;
      if (r.axis === 'x') {
        const h = r.yAtMinX + (r.yAtMaxX - r.yAtMinX) * t;
        addBox(r.minX + (r.maxX - r.minX) * t, h / 2, 0, run + 0.02, Math.max(0.12, h), RW * 2,
          MAT.mazeWall, { noBase: true, name: 'step' });
      } else {
        const h = r.yAtMinZ + (r.yAtMaxZ - r.yAtMinZ) * t;
        addBox(0, h / 2, r.minZ + (r.maxZ - r.minZ) * t, RW * 2, Math.max(0.12, h), run + 0.02,
          MAT.mazeWall, { noBase: true, name: 'step' });
      }
    }
  }

  /* --- lighting --- */
  const fill = (x, y, z, i) => {
    const l = new THREE.PointLight(0xfff0d8, i, 30, 1.5);
    l.position.set(x, y, z);
    scene.add(l);
  };
  fill(0, PY + 2.4, 0, 0.45);
  fill(0, 3.0, MH - 4, 0.55);
  fill(0, 3.0, -MH + 4, 0.55);
  fill(MH - 4, 3.0, 0, 0.55);
  fill(-MH + 4, 3.0, 0, 0.55);

  /* --- team HQs: centred in the open corner plazas --- */
  const plazaCentre = (i0, j0) => cellCenter(i0 + 1, j0 + 1);
  G.hq = { red: plazaCentre(0, N - 3), blue: plazaCentre(N - 3, 0) };

  for (const t of ['red', 'blue']) {
    const h = G.hq[t];
    addBox(h.x, 0.055, h.z, 5.4, 0.11, 5.4, MAT.pad, { name: t + 'hq' });
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.9, 2.25, 40),
      new THREE.MeshBasicMaterial({ color: t === 'red' ? 0xff4a4a : 0x4d8dff, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(h.x, 0.14, h.z);
    scene.add(ring);
    G[t + 'Ring'] = ring;
  }

  /* --- spawn slots: the six cells nearest each HQ --- */
  G.spawns = { red: [], blue: [] };
  for (const t of ['red', 'blue']) {
    const h = G.hq[t];
    const all = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const c = cellCenter(i, j);
      all.push({ x: c.x, z: c.z, d: Math.hypot(c.x - h.x, c.z - h.z) });
    }
    all.sort((a, b) => a.d - b.d);
    G.spawns[t] = all.slice(0, 6).map(p => ({ x: p.x, z: p.z }));
  }

  /* --- weapon crates: open ground only, never tucked into a dead end ---
     one in each HQ plaza, the rest spread over maze junctions (cells with
     three or more openings), plus two up on the catwalk. */
  const junctions = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const c = cells[j][i];
    if (c.carve) continue;
    const openings = (c.W ? 0 : 1) + (c.E ? 0 : 1) + (c.N ? 0 : 1) + (c.S ? 0 : 1);
    if (openings >= 3) junctions.push(cellCenter(i, j));
  }
  const spots = [
    { x: G.hq.red.x + MAP.cs, z: G.hq.red.z + MAP.cs },      // red plaza, inner corner
    { x: G.hq.blue.x - MAP.cs, z: G.hq.blue.z - MAP.cs }     // blue plaza, inner corner
  ];
  while (spots.length < 6 && junctions.length) {
    let best = null, bd = -1;
    for (const d of junctions) {
      if (spots.indexOf(d) >= 0) continue;
      let md = 1e9;
      for (const s of spots) md = Math.min(md, Math.hypot(d.x - s.x, d.z - s.z));
      if (md > bd) { bd = md; best = d; }
    }
    if (!best) break;
    spots.push(best);
  }
  while (spots.length < 6) {
    const p = cellCenter(3 + spots.length * 2, 3 + spots.length * 2);
    spots.push(p);
  }
  spots.push({ x: -deckC, z: 11, y: PY });
  spots.push({ x: deckC, z: -11, y: PY });
  G.chestSpots = spots.map(s => [s.x, s.y || 0, s.z]);

  mergeStaticWorld();
  buildWaypoints();
}



/* ------------------------------------------------------------
   FACADE DETAIL (windows, plinth, cornice)
   ------------------------------------------------------------ */
function winZ(z, x, y, w, h, shut) {
  const s = z > 0 ? 1 : -1;
  addBox(x, y, z + s * 0.03, w + 0.26, h + 0.26, 0.08, MAT.trim, { collide: false, shadow: false });
  addBox(x, y, z + s * 0.07, w, h, 0.05, MAT.glassWin, { collide: false, shadow: false });
  addBox(x, y, z + s * 0.10, 0.05, h, 0.02, MAT.trim, { collide: false, shadow: false });
  addBox(x, y, z + s * 0.10, w, 0.05, 0.02, MAT.trim, { collide: false, shadow: false });
  addBox(x, y - h / 2 - 0.12, z + s * 0.10, w + 0.42, 0.1, 0.28, MAT.trim, { collide: false, shadow: false });
  addBox(x, y + h / 2 + 0.18, z + s * 0.06, w + 0.4, 0.14, 0.14, MAT.trim, { collide: false, shadow: false });
  if (shut) {
    for (const d of [-1, 1]) {
      const sx = x + d * (w / 2 + 0.34);
      addBox(sx, y, z + s * 0.05, w * 0.44, h * 1.02, 0.05, MAT.shutter, { collide: false, shadow: false });
      for (let i = 0; i < 5; i++) {
        addBox(sx, y - h * 0.4 + i * h * 0.2, z + s * 0.08, w * 0.34, 0.035, 0.02, MAT.trim, { collide: false, shadow: false });
      }
    }
  }
}
function winX(x, z, y, w, h, shut) {
  const s = x > 0 ? 1 : -1;
  addBox(x + s * 0.03, y, z, 0.08, h + 0.26, w + 0.26, MAT.trim, { collide: false, shadow: false });
  addBox(x + s * 0.07, y, z, 0.05, h, w, MAT.glassWin, { collide: false, shadow: false });
  addBox(x + s * 0.10, y, z, 0.02, h, 0.05, MAT.trim, { collide: false, shadow: false });
  addBox(x + s * 0.10, y, z, 0.02, 0.05, w, MAT.trim, { collide: false, shadow: false });
  addBox(x + s * 0.10, y - h / 2 - 0.12, z, 0.28, 0.1, w + 0.42, MAT.trim, { collide: false, shadow: false });
  addBox(x + s * 0.06, y + h / 2 + 0.18, z, 0.14, 0.14, w + 0.4, MAT.trim, { collide: false, shadow: false });
  if (shut) {
    for (const d of [-1, 1]) {
      const sz = z + d * (w / 2 + 0.34);
      addBox(x + s * 0.05, y, sz, 0.05, h * 1.02, w * 0.44, MAT.shutter, { collide: false, shadow: false });
      for (let i = 0; i < 5; i++) {
        addBox(x + s * 0.08, y - h * 0.4 + i * h * 0.2, sz, 0.02, 0.035, w * 0.34, MAT.trim, { collide: false, shadow: false });
      }
    }
  }
}

function addFacade() {
  // plinth
  addBox(0, 0.26, 12.06, 33.4, 0.52, 0.66, MAT.plinth, { collide: false });
  addBox(0, 0.26, -12.06, 33.4, 0.52, 0.66, MAT.plinth, { collide: false });
  addBox(16.06, 0.26, 0, 0.66, 0.52, 24.6, MAT.plinth, { collide: false });
  addBox(-16.06, 0.26, 0, 0.66, 0.52, 24.6, MAT.plinth, { collide: false });
  // floor line cornice + roof cornice
  addBox(0, 4.02, 12.06, 33.5, 0.3, 0.78, MAT.trim, { collide: false });
  addBox(0, 4.02, -12.06, 33.5, 0.3, 0.78, MAT.trim, { collide: false });
  addBox(16.06, 4.02, 0, 0.78, 0.3, 24.7, MAT.trim, { collide: false });
  addBox(-16.06, 4.02, 0, 0.78, 0.3, 24.7, MAT.trim, { collide: false });
  addBox(0, 7.98, 12.1, 33.8, 0.34, 0.86, MAT.trim, { collide: false });
  addBox(0, 7.98, -12.1, 33.8, 0.34, 0.86, MAT.trim, { collide: false });
  addBox(16.1, 7.98, 0, 0.86, 0.34, 24.9, MAT.trim, { collide: false });
  addBox(-16.1, 7.98, 0, 0.86, 0.34, 24.9, MAT.trim, { collide: false });

  // ground floor windows
  for (const x of [-13, -9, 9, 13]) winZ(12.24, x, 1.95, 1.5, 1.35, true);
  for (const x of [-13, -9, 5, 9, 13]) winZ(-12.24, x, 1.95, 1.5, 1.35, true);
  for (const z of [-8, 6, 9]) winX(-16.24, z, 1.95, 1.5, 1.35, true);
  for (const z of [-9, -5, 10]) winX(16.24, z, 1.95, 1.5, 1.35, true);

  // first floor windows
  for (const x of [-12, -8, 8, 12]) winZ(12.24, x, 5.95, 1.5, 1.35, true);
  for (const x of [-12, -8, 5, 9, 13]) winZ(-12.24, x, 5.95, 1.5, 1.35, true);
  for (const z of [-9, 0, 8]) winX(-16.24, z, 5.95, 1.5, 1.35, true);
  for (const z of [-8, 0, 8]) winX(16.24, z, 5.95, 1.5, 1.35, true);

  // main entrance: portico + steps + door frame
  addBox(0, 1.3, 12.5, 5.4, 0.16, 2.4, MAT.plinth, { collide: false });
  addBox(0, 0.55, 13.7, 5.4, 0.14, 0.7, MAT.plinth, { collide: false });
  addBox(0, 0.2, 14.4, 5.4, 0.14, 0.7, MAT.plinth, { collide: false });
  for (const sx of [-2.5, 2.5]) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.22, 3.6, 12), MAT.trim);
    col.position.set(sx, 1.9, 13.5); col.castShadow = true; col.receiveShadow = true; scene.add(col);
    addBox(sx, 0.1, 13.5, 0.62, 0.2, 0.62, MAT.plinth, { collide: false });
  }
  addBox(0, 3.78, 13.5, 5.6, 0.26, 2.6, MAT.trim, { collide: false });
  addBox(0, 1.55, 12.1, 2.5, 3.1, 0.16, MAT.trim, { collide: false, shadow: false });
  // door slabs — swung open inward
  for (const d of [-1, 1]) {
    const hinge = new THREE.Group();
    hinge.position.set(d * 1.55, 0, 11.86);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.82, 0.09), MAT.woodDark);
    slab.position.set(-d * 0.75, 1.42, 0);
    slab.castShadow = true; slab.receiveShadow = true;
    hinge.add(slab);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), MAT.gold);
    knob.position.set(-d * 1.36, 1.38, 0.08);
    hinge.add(knob);
    hinge.rotation.y = -d * 1.75;
    scene.add(hinge);
  }
  // lanterns beside the door
  for (const lx of [-2.0, 2.0]) {
    addBox(lx, 2.6, 12.16, 0.22, 0.42, 0.22, MAT.metal, { collide: false, shadow: false });
    addBox(lx, 2.6, 12.16, 0.13, 0.3, 0.13, new THREE.MeshBasicMaterial({ color: 0xffe3a8 }), { collide: false, shadow: false });
  }
  // chimney
  addBox(-10.5, 9.3, -5, 1.9, 2.4, 1.9, MAT.brick, { collide: false });
  addBox(-10.5, 10.55, -5, 2.2, 0.26, 2.2, MAT.plinth, { collide: false });
  addBox(-10.5, 10.75, -5, 1.2, 0.18, 1.2, MAT.metal, { collide: false });
}


/* ------------------------------------------------------------
   STATIC GEOMETRY MERGE
   Collapses the (large) static level into one mesh per material so the
   renderer issues a couple of dozen draw calls instead of a thousand.
   ------------------------------------------------------------ */
function mergeStaticWorld() {
  const byMat = new Map();
  const victims = [];
  scene.traverse(o => {
    if (!o.isMesh || o.userData.dyn) return;
    if (!o.geometry || !o.material || Array.isArray(o.material)) return;
    if (o.material.type === 'ShaderMaterial') return;
    if (o.geometry.attributes.position === undefined) return;
    victims.push(o);
  });

  for (const m of victims) {
    m.updateWorldMatrix(true, false);
    const src = m.geometry;
    const g = (src.index ? src.toNonIndexed() : src.clone());
    g.applyMatrix4(m.matrixWorld);
    const key = m.material.uuid;
    let rec = byMat.get(key);
    if (!rec) { rec = { mat: m.material, list: [], cast: false, recv: false }; byMat.set(key, rec); }
    rec.list.push(g);
    rec.cast = rec.cast || m.castShadow;
    rec.recv = rec.recv || m.receiveShadow;
  }

  for (const m of victims) {
    if (m.parent) m.parent.remove(m);
    if (m.geometry && !m.geometry.userData.keep) m.geometry.dispose();
  }

  for (const rec of byMat.values()) {
    let total = 0;
    for (const g of rec.list) total += g.attributes.position.count;
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const uv = new Float32Array(total * 2);
    let off = 0;
    for (const g of rec.list) {
      const n = g.attributes.position.count;
      pos.set(g.attributes.position.array, off * 3);
      if (g.attributes.normal) nor.set(g.attributes.normal.array, off * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, off * 2);
      off += n;
      g.dispose();
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, rec.mat);
    mesh.castShadow = rec.cast;
    mesh.receiveShadow = rec.recv;
    mesh.userData.dyn = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
  }
}

/* ------------------------------------------------------------
   INTERIOR / EXTERIOR DRESSING
   ------------------------------------------------------------ */
const BOOK_MATS = (function () {
  const out = [];
  for (let i = 0; i < 9; i++) {
    out.push(new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(i / 9, 0.4, 0.4), roughness: 0.9, metalness: 0.02
    }));
  }
  return out;
})();

function rug(x, z, w, d, mat) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.052, z);
  m.receiveShadow = true;
  scene.add(m);
  return m;
}
function rugUp(x, z, w, d, mat) {
  const m = rug(x, z, w, d, mat);
  m.position.y = 4.14;
  return m;
}

function chair(x, z, facing) {
  const seatH = 0.46;
  addBox(x, seatH, z, 0.46, 0.08, 0.46, MAT.woodDark);
  for (const [dx, dz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) {
    addBox(x + dx, seatH / 2, z + dz, 0.06, seatH, 0.06, MAT.woodDark, { shadow: false });
  }
  const bz = z + (facing === 'n' ? 0.21 : facing === 's' ? -0.21 : 0);
  const bx = x + (facing === 'e' ? -0.21 : facing === 'w' ? 0.21 : 0);
  addBox(bx, seatH + 0.34, bz, facing === 'e' || facing === 'w' ? 0.07 : 0.44, 0.6, facing === 'e' || facing === 'w' ? 0.44 : 0.07, MAT.woodDark);
}

function table(x, z, w, d) {
  addBox(x, 0.76, z, w, 0.1, d, MAT.wood);
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    addBox(x + dx * (w / 2 - 0.16), 0.38, z + dz * (d / 2 - 0.16), 0.11, 0.76, 0.11, MAT.woodDark, { shadow: false });
  }
}

function sofa(x, z, facing, mat) {
  addBox(x, 0.3, z, 2.2, 0.32, 0.86, mat);
  addBox(x, 0.62, z + 0.32, 2.2, 0.62, 0.22, mat);
  addBox(x - 1.02, 0.55, z, 0.16, 0.5, 0.86, mat);
  addBox(x + 1.02, 0.55, z, 0.16, 0.5, 0.86, mat);
  addBox(x, 0.5, z - 0.02, 1.9, 0.16, 0.6, MAT.fabric);
  void facing;
}

function shelf(x, z, w, h, d, rot) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rot || 0;
  const back = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), MAT.woodDark);
  back.position.set(0, h / 2, -d / 2 + 0.03); back.castShadow = true; g.add(back);
  for (const sx of [-w / 2 + 0.04, w / 2 - 0.04]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.07, h, d), MAT.woodDark);
    side.position.set(sx, h / 2, 0); side.castShadow = true; g.add(side);
  }
  for (let i = 0; i < 4; i++) {
    const sh = new THREE.Mesh(new THREE.BoxGeometry(w - 0.06, 0.05, d - 0.04), MAT.woodDark);
    sh.position.set(0, 0.22 + i * (h - 0.3) / 3, 0); sh.castShadow = true; g.add(sh);
    for (let b = 0; b < 5; b++) {
      if (Math.random() < 0.25) continue;
      const bw = 0.05 + Math.random() * 0.05;
      const bh = 0.16 + Math.random() * 0.12;
      const bk = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.16), BOOK_MATS[(Math.random() * BOOK_MATS.length) | 0]);
      bk.position.set(-w / 2 + 0.14 + b * (w - 0.24) / 5, 0.24 + i * (h - 0.3) / 3 + bh / 2, 0.02);
      g.add(bk);
    }
  }
  scene.add(g);
  G.colliders.push({ minX: x - w / 2, maxX: x + w / 2, minY: 0, maxY: h, minZ: z - d / 2, maxZ: z + d / 2, name: '' });
}

function painting(x, y, z, axis, w, h, hue) {
  const frame = new THREE.Mesh(new THREE.BoxGeometry(axis === 'z' ? w + 0.12 : 0.06, h + 0.12, axis === 'z' ? 0.06 : w + 0.12), MAT.gold);
  frame.position.set(x, y, z); scene.add(frame);
  const canvasMat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(hue, 0.32, 0.42), roughness: 0.95 });
  const art = new THREE.Mesh(new THREE.BoxGeometry(axis === 'z' ? w : 0.03, h, axis === 'z' ? 0.03 : w), canvasMat);
  art.position.set(x + (axis === 'z' ? 0 : (x > 0 ? -0.04 : 0.04)), y, z + (axis === 'z' ? (z > 0 ? -0.04 : 0.04) : 0));
  scene.add(art);
}

function plant(x, z, scale) {
  const s = scale || 1;
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.24 * s, 0.18 * s, 0.4 * s, 10), MAT.terracotta);
  pot.position.set(x, 0.2 * s, z); pot.castShadow = true; pot.receiveShadow = true; scene.add(pot);
  for (let i = 0; i < 5; i++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.26 * s, 7, 5), i % 2 ? MAT.leaf : MAT.leafDark);
    leaf.position.set(x + rand(-0.18, 0.18) * s, 0.62 * s + i * 0.14 * s, z + rand(-0.18, 0.18) * s);
    leaf.scale.set(1, 0.62, 1);
    leaf.castShadow = true; scene.add(leaf);
  }
}

function tree(x, z, s) {
  s = s || 1;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * s, 0.24 * s, 3.4 * s, 8), MAT.bark);
  trunk.position.set(x, 1.7 * s, z); trunk.castShadow = true; trunk.receiveShadow = true; scene.add(trunk);
  for (let i = 0; i < 4; i++) {
    const r = (1.5 - i * 0.22) * s;
    const blob = new THREE.Mesh(new THREE.SphereGeometry(r, 9, 7), i % 2 ? MAT.leaf : MAT.leafDark);
    blob.position.set(x + rand(-0.5, 0.5) * s, (3.2 + i * 0.75) * s, z + rand(-0.5, 0.5) * s);
    blob.scale.y = 0.82;
    blob.castShadow = true; scene.add(blob);
  }
  G.colliders.push({ minX: x - 0.3 * s, maxX: x + 0.3 * s, minY: 0, maxY: 3 * s, minZ: z - 0.3 * s, maxZ: z + 0.3 * s, name: '' });
}

function hedge(x, z, w, d, h) {
  addBox(x, h / 2, z, w, h, d, MAT.leafDark);
}

function addInteriorDetail() {
  /* --- ground floor: dining room (south-west) --- */
  rug(-11.5, 7.3, 6.4, 4.6, MAT.rugRed);
  table(-11.6, 7.3, 2.8, 1.3);
  chair(-11.6, 6.0, 'n'); chair(-11.6, 8.6, 's');
  chair(-13.0, 7.3, 'w'); chair(-10.2, 7.3, 'e');
  // sideboard + wall art
  addBox(-15.4, 0.5, 7.3, 0.6, 1.0, 3.2, MAT.woodDark);
  painting(-15.9, 2.5, 7.3, 'x', 1.7, 1.1, 0.08);
  plant(-15.0, 11.2, 1.1);
  // candles on table
  for (const cx of [-12.4, -10.8]) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 6), MAT.paper);
    c.position.set(cx, 0.96, 7.3); scene.add(c);
  }

  /* --- ground floor: kitchen (north-west) --- */
  addBox(-15.4, 0.45, -8, 0.7, 0.9, 7.4, MAT.woodDark);
  addBox(-15.4, 0.93, -8, 0.8, 0.07, 7.5, MAT.tile, { collide: false });
  addBox(-13.2, 0.45, -11.2, 4.0, 0.9, 0.7, MAT.woodDark);
  addBox(-13.2, 0.93, -11.2, 4.1, 0.07, 0.8, MAT.tile, { collide: false });
  // island
  addBox(-11.4, 0.45, -7.4, 2.2, 0.9, 1.1, MAT.woodDark);
  addBox(-11.4, 0.93, -7.4, 2.3, 0.07, 1.2, MAT.tile, { collide: false });
  plant(-15.0, -11.0, 0.8);

  /* --- ground floor: lounge (south-east) --- */
  rug(11, 9.6, 6.2, 4.2, MAT.rugBlue);
  sofa(11, 11.1, 's', MAT.fabricR);
  addBox(11, 0.42, 9.0, 1.6, 0.12, 0.9, MAT.wood);
  addBox(11, 0.2, 9.0, 1.2, 0.4, 0.5, MAT.woodDark, { shadow: false });
  chair(13.4, 9.6, 'w');
  painting(15.9, 2.4, 9.6, 'x', 1.5, 1.0, 0.55);
  plant(15.0, 6.6, 1.0);

  /* --- ground floor: main hall --- */
  rug(-1.0, 0.6, 5.0, 5.0, MAT.rugRed);
  shelf(-4.4, 1.2, 2.4, 2.1, 0.5, 0);
  painting(-15.9, 2.3, 0.5, 'x', 1.4, 1.0, 0.62);
  painting(15.9, 2.3, -3.0, 'x', 1.4, 1.0, 0.28);
  plant(-14.9, 2.6, 1.0);
  plant(14.9, 4.6, 1.0);
  // chandelier
  const ch = new THREE.Group();
  ch.position.set(1.0, 3.35, 1.5);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.05, 6, 18), MAT.gold);
  ring.rotation.x = Math.PI / 2; ch.add(ring);
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), new THREE.MeshBasicMaterial({ color: 0xfff1c8 }));
    bulb.position.set(Math.cos(a) * 0.55, 0.1, Math.sin(a) * 0.55);
    ch.add(bulb);
  }
  scene.add(ch);

  /* --- upstairs: bedroom (north-west) --- */
  rugUp(-10.5, 7.2, 4.4, 3.4, MAT.rugBlue);
  addBox(-11.0, 4.38, 8.6, 2.1, 0.42, 1.6, MAT.woodDark);      // bed base
  addBox(-11.0, 4.66, 8.6, 2.02, 0.2, 1.52, MAT.paper, { collide: false });
  addBox(-11.0, 4.78, 8.1, 2.02, 0.1, 0.9, MAT.fabricR, { collide: false }); // blanket
  addBox(-11.0, 4.86, 9.24, 1.9, 0.24, 0.4, MAT.trim, { collide: false }); // pillows
  addBox(-11.0, 5.05, 7.85, 2.1, 1.1, 0.12, MAT.woodDark);     // headboard
  addBox(-13.9, 4.5, 7.2, 0.55, 0.75, 1.0, MAT.woodDark);      // nightstand
  shelf(-15.3, 5.0, 2.2, 2.0, 0.45, Math.PI / 2);
  painting(-9.0, 6.2, 12.1, 'z', 1.5, 1.0, 0.1);
  plant(-15.0, 10.8, 0.9);

  /* --- upstairs: study (north-east) --- */
  rugUp(-8.0, -2.0, 4.0, 3.2, MAT.rugRed);
  addBox(-9.6, 4.55, -2.0, 2.2, 0.1, 1.0, MAT.wood);           // desk
  addBox(-9.6, 4.25, -2.0, 0.2, 0.5, 0.8, MAT.woodDark, { shadow: false });
  chair(-9.6, -0.8, 'n');
  shelf(-15.3, -8.0, 2.4, 2.2, 0.45, Math.PI / 2);
  painting(-4.2, 6.2, -9.0, 'z', 1.4, 1.0, 0.45);

  /* --- upstairs: landing --- */
  rugUp(1.5, 6.0, 3.6, 3.0, MAT.rugBlue);
  addBox(1.5, 4.42, 6.0, 1.8, 0.45, 0.9, MAT.fabric);
  plant(4.6, 10.8, 0.9);
}

function addOutdoorDetail() {
  // gravel path from the porch to the south gate
  addBox(0, 0.03, 18, 5.0, 0.06, 12, MAT.concrete, { collide: false, receive: true });
  addBox(0, 0.03, -18, 5.0, 0.06, 12, MAT.concrete, { collide: false, receive: true });
  // hedges framing the courtyard
  hedge(-22, 12, 1.2, 16, 1.3);
  hedge(22, 12, 1.2, 16, 1.3);
  hedge(-22, -12, 1.2, 16, 1.3);
  hedge(22, -12, 1.2, 16, 1.3);
  // trees
  const trees = [[-31, 12, 1.15], [-31, -12, 1.0], [31, 12, 1.05], [31, -12, 1.15],
                 [-19, 22, 0.95], [19, 22, 1.0], [-19, -22, 1.0], [19, -22, 0.95],
                 [-33, 24, 1.1], [33, -24, 1.1], [-33, -24, 1.0], [33, 24, 1.0]];
  for (const t of trees) tree(t[0], t[1], t[2]);
  // planters near the bases
  for (const p of [[-8, 32], [8, 32], [-8, -32], [8, -32]]) plant(p[0], p[1], 1.2);
  // courtyard benches
  for (const b of [[-19, 4, Math.PI / 2], [19, -4, Math.PI / 2]]) {
    const g = new THREE.Group();
    g.position.set(b[0], 0, b[1]);
    g.rotation.y = b[2];
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.1, 0.5), MAT.wood);
    seat.position.y = 0.45; seat.castShadow = true; g.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.4, 0.09), MAT.wood);
    back.position.set(0, 0.68, -0.2); back.castShadow = true; g.add(back);
    for (const sx of [-0.8, 0.8]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.45, 0.45), MAT.woodDark);
      leg.position.set(sx, 0.22, 0); leg.castShadow = true; g.add(leg);
    }
    scene.add(g);
  }
}
const NODES = [];
const EDGES = [];

function node(x, z, y) { return { x, z, y: y || 0, idx: NODES.length - 1, nb: [] }; }
function addNode(x, z, y) { const n = node(x, z, y); NODES.push(n); return n; }

function buildWaypoints() {
  NODES.length = 0;
  const cells = G.maze, N = MAP.N, PY = MAP.platY, MH = MAP.mazeHalf;
  const D = (MH + MAP.B + MAP.outerT / 2) / 2;   // catwalk centreline

  /* A stair ramp is a solid 9 m diagonal bulkhead: it swallows the two cells it
     runs through, so those cells are NOT walkable floor. No nav nodes there —
     otherwise paths route bots straight into the staircase and they grind. */
  const inRamp = (x, z) => G.ramps.some(r =>
    x > r.minX - 0.3 && x < r.maxX + 0.3 && z > r.minZ - 0.3 && z < r.maxZ + 0.3);

  /* one node per maze cell, linked through the gaps that actually exist */
  const grid = [];
  for (let j = 0; j < N; j++) {
    const row = [];
    for (let i = 0; i < N; i++) {
      const c = cellCenter(i, j);
      row.push(inRamp(c.x, c.z) ? null : addNode(c.x, c.z, 0));
    }
    grid.push(row);
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    if (!grid[j][i]) continue;
    if (i < N - 1 && grid[j][i + 1] && !cells[j][i].E) link(grid[j][i], grid[j][i + 1]);
    if (j < N - 1 && grid[j + 1][i] && !cells[j][i].S) link(grid[j][i], grid[j + 1][i]);
  }

  /* catwalk ring */
  const xs = [];
  for (let x = -26; x <= 26.01; x += 6.5) xs.push(x);
  const S = xs.map(x => addNode(x, D, PY));
  const Nn = xs.map(x => addNode(x, -D, PY));
  const E = xs.map(x => addNode(D, x, PY));
  const W = xs.map(x => addNode(-D, x, PY));
  for (const arr of [S, Nn, E, W]) for (let k = 0; k + 1 < arr.length; k++) link(arr[k], arr[k + 1]);
  /* corners: the inner railings seal each corner, so route around them along the
     deck midline via a corner node. (The old code linked the wrong ends of two
     sides, creating 59 m "shortcuts" straight through the map — bots pathing on
     them walked into walls and ground there.) */
  const cSE = addNode(D, D, PY), cNE = addNode(D, -D, PY), cNW = addNode(-D, -D, PY), cSW = addNode(-D, D, PY);
  link(S[S.length - 1], cSE); link(cSE, E[E.length - 1]);
  link(E[0], cNE); link(cNE, Nn[Nn.length - 1]);
  link(Nn[0], cNW); link(cNW, W[W.length - 1]);
  link(W[0], cSW); link(cSW, S[0]);

  /* stairs: chain the four ramps to the floor and to the ring */
  const groundNodes = [];
  for (const row of grid) for (const n of row) if (n) groundNodes.push(n);
  const platNodes = S.concat(Nn, E, W, [cSE, cNE, cNW, cSW]);
  const nearestIn = (list, x, z) => {
    let best = null, bd = 1e9;
    for (const n of list) {
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  };

  for (const r of G.ramps) {
    let a, m, b;
    if (r.axis === 'x') {
      const zc = (r.minZ + r.maxZ) / 2;
      a = addNode(r.minX, zc, r.yAtMinX);
      m = addNode((r.minX + r.maxX) / 2, zc, (r.yAtMinX + r.yAtMaxX) / 2);
      b = addNode(r.maxX, zc, r.yAtMaxX);
    } else {
      const xc = (r.minX + r.maxX) / 2;
      a = addNode(xc, r.minZ, r.yAtMinZ);
      m = addNode(xc, (r.minZ + r.maxZ) / 2, (r.yAtMinZ + r.yAtMaxZ) / 2);
      b = addNode(xc, r.maxZ, r.yAtMaxZ);
    }
    link(a, m); link(m, b);
    const low = a.y < b.y ? a : b;
    const high = a.y < b.y ? b : a;
    const gN = nearestIn(groundNodes, low.x, low.z);
    const pN = nearestIn(platNodes, high.x, high.z);
    if (gN) link(low, gN);
    if (pN) link(high, pN);
  }

  G.rampsNode = null;
}


function link(a, b) {
  if (!a || !b || a === b) return;
  if (a.nb.indexOf(b) < 0) a.nb.push(b);
  if (b.nb.indexOf(a) < 0) b.nb.push(a);
}
function linkAny(a, list, maxD) {
  const cand = list.filter(n => Math.hypot(n.x - a.x, n.z - a.z) < maxD);
  cand.sort((p, q) => Math.hypot(p.x - a.x, p.z - a.z) - Math.hypot(q.x - a.x, q.z - a.z));
  for (let i = 0; i < Math.min(3, cand.length); i++) link(a, cand[i]);
}
function connectLevel(list, isUpper) {
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d > 16) continue;
      if (isUpper && d > 13) continue;
      if (losClear(a.x, a.y + 1.5, a.z, b.x, b.y + 1.5, b.z, 0.3)) link(a, b);
    }
  }
}
function nearestNode(x, z, y) {
  if (!isFinite(x) || !isFinite(z)) return null;
  if (!isFinite(y)) y = 0;
  let best = null, bd = 1e9;
  for (const n of NODES) {
    const dy = Math.abs(n.y - y);
    let d = Math.hypot(n.x - x, n.z - z) + dy * 3;
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}
function findPath(from, to) {
  if (!from || !to) return [];
  if (from === to) return [to];
  const q = [from], prev = new Map([[from, null]]);
  while (q.length) {
    const n = q.shift();
    if (n === to) break;
    for (const m of n.nb) {
      if (!prev.has(m)) { prev.set(m, n); q.push(m); }
    }
  }
  if (!prev.has(to)) return [];
  const path = []; let c = to;
  while (c) { path.unshift(c); c = prev.get(c); }
  return path;
}

/* ------------------------------------------------------------
   RAYCASTING (AABB slab test)
   ------------------------------------------------------------ */
function rayAABB(ox, oy, oz, dx, dy, dz, b) {
  let tmin = 0, tmax = 1e9;
  // X
  if (Math.abs(dx) < 1e-9) { if (ox < b.minX || ox > b.maxX) return -1; }
  else {
    let t1 = (b.minX - ox) / dx, t2 = (b.maxX - ox) / dx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  // Y
  if (Math.abs(dy) < 1e-9) { if (oy < b.minY || oy > b.maxY) return -1; }
  else {
    let t1 = (b.minY - oy) / dy, t2 = (b.maxY - oy) / dy;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  // Z
  if (Math.abs(dz) < 1e-9) { if (oz < b.minZ || oz > b.maxZ) return -1; }
  else {
    let t1 = (b.minZ - oz) / dz, t2 = (b.maxZ - oz) / dz;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  return tmin;
}

function rayWorld(ox, oy, oz, dx, dy, dz, maxD) {
  let best = maxD, hit = false;
  for (const b of G.colliders) {
    const t = rayAABB(ox, oy, oz, dx, dy, dz, b);
    if (t >= 0 && t < best) { best = t; hit = true; }
  }
  return hit ? best : -1;
}

function losClear(x1, y1, z1, x2, y2, z2, pad) {
  const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
  const len = Math.hypot(dx, dy, dz);
  if (len < 0.001) return true;
  const nx = dx / len, ny = dy / len, nz = dz / len;
  const t = rayWorld(x1, y1, z1, nx, ny, nz, len);
  return t < 0 || t > len - (pad || 0);
}

/* ------------------------------------------------------------
   PHYSICS
   ------------------------------------------------------------ */
function groundAt(x, z, feetY) {
  let g = 0;
  const tol = 0.56;
  for (let i = 0; i < G.colliders.length; i++) {
    const b = G.colliders[i];
    if (b.maxY > feetY + tol) continue;
    if (x > b.minX - 0.14 && x < b.maxX + 0.14 && z > b.minZ - 0.14 && z < b.maxZ + 0.14) {
      if (b.maxY > g) g = b.maxY;
    }
  }
  for (let i = 0; i < G.ramps.length; i++) {
    const r = G.ramps[i];
    if (x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ) {
      let h;
      if (r.axis === 'x') {
        const t = (x - r.minX) / (r.maxX - r.minX);
        h = r.yAtMinX + (r.yAtMaxX - r.yAtMinX) * t;
      } else {
        const t = (z - r.minZ) / (r.maxZ - r.minZ);
        h = r.yAtMinZ + (r.yAtMaxZ - r.yAtMinZ) * t;
      }
      if (h <= feetY + tol && h > g) g = h;
    }
  }
  return g;
}

function resolveHorizontal(a) {
  const r = a.radius, feet = a.pos.y;
  /* Airborne actors collide as if their capsule still reached the surface they
     are falling towards. Without this you ghost straight through the maze
     walls on the way down after stepping off the catwalk. */
  const effFeet = a.onGround ? feet : Math.min(feet, groundAt(a.pos.x, a.pos.z, feet));
  for (let iter = 0; iter < 2; iter++) {
    for (let i = 0; i < G.colliders.length; i++) {
      const b = G.colliders[i];
      if (b.maxY <= effFeet + 0.5) continue;
      if (b.minY >= effFeet + a.height) continue;
      const cx = clamp(a.pos.x, b.minX, b.maxX);
      const cz = clamp(a.pos.z, b.minZ, b.maxZ);
      const dx = a.pos.x - cx, dz = a.pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          a.pos.x = cx + dx / d * r;
          a.pos.z = cz + dz / d * r;
        } else {
          const dl = a.pos.x - b.minX, dr = b.maxX - a.pos.x;
          const db = a.pos.z - b.minZ, df = b.maxZ - a.pos.z;
          const m = Math.min(dl, dr, db, df);
          if (m === dl) a.pos.x = b.minX - r;
          else if (m === dr) a.pos.x = b.maxX + r;
          else if (m === db) a.pos.z = b.minZ - r;
          else a.pos.z = b.maxZ + r;
        }
      }
    }
  }
}

function moveActor(a, wx, wz, sprint, wantJump, dt) {
  const maxSpeed = (sprint ? CFG.player.sprint : CFG.player.walk) * (a.speedMul || 1);
  const len = Math.hypot(wx, wz);
  if (len > 0.001) { wx /= len; wz /= len; }
  const tx = wx * maxSpeed, tz = wz * maxSpeed;
  const k = Math.min(1, (a.onGround ? 16 : 5) * dt);
  a.vel.x += (tx - a.vel.x) * k;
  a.vel.z += (tz - a.vel.z) * k;

  if (wantJump && a.onGround) { a.vel.y = CFG.player.jump; a.onGround = false; }
  a.vel.y -= CFG.gravity * dt;

  a.pos.x += a.vel.x * dt;
  a.pos.z += a.vel.z * dt;
  resolveHorizontal(a);

  a.pos.y += a.vel.y * dt;
  const g = groundAt(a.pos.x, a.pos.z, a.pos.y);
  if (a.pos.y <= g + 0.002) {
    a.pos.y = g; a.vel.y = 0; a.onGround = true;
  } else if (a.onGround && a.pos.y - g < 0.55 && a.vel.y <= 0) {
    a.pos.y = g; a.vel.y = 0;
  } else {
    a.onGround = false;
  }
  // hard floor
  if (a.pos.y < -6) { a.pos.set(0, 0, a.team === 'red' ? 33 : -33); a.vel.set(0, 0, 0); }
}

/* ------------------------------------------------------------
   ACTORS
   ------------------------------------------------------------ */
const BOT_NAMES = ['VIPER', 'GHOST', 'HAWK', 'REAPER', 'FALCON', 'BISHOP', 'ROOK', 'NOMAD', 'WRAITH', 'TITAN', 'ECHO', 'SABLE', 'ORION', 'KILO', 'DELTA'];

function eyePos(a, out) {
  return (out || new V3()).set(a.pos.x, a.pos.y + (a.isPlayer ? CFG.player.eye : 1.52), a.pos.z);
}
function dirFromAngles(yaw, pitch, out) {
  /* keep the direction finite and away from the exact poles: at |pitch| = PI/2
     the horizontal basis collapses and the spread maths would divide by zero */
  const p = isFinite(pitch) ? (pitch > 1.45 ? 1.45 : pitch < -1.45 ? -1.45 : pitch) : 0;
  const y = isFinite(yaw) ? yaw : 0;
  const cp = Math.cos(p);
  return (out || new V3()).set(-Math.sin(y) * cp, Math.sin(p), -Math.cos(y) * cp);
}
function allActors() { return G.bots.concat(G.player ? [G.player] : []); }

function buildBotMesh(team) {
  const g = new THREE.Group();
  const col = team === 'red' ? 0xa32b2b : 0x2a4a9e;
  const suit = new THREE.MeshStandardMaterial({ color: col, roughness: 0.84, metalness: 0.05 });
  const suitDark = new THREE.MeshStandardMaterial({ color: team === 'red' ? 0x6b1c1c : 0x1b2f66, roughness: 0.88, metalness: 0.04 });
  const gear = new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.82, metalness: 0.14 });
  const gearDark = new THREE.MeshStandardMaterial({ color: 0x24272c, roughness: 0.86, metalness: 0.1 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc08a63, roughness: 0.9 });
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x191b1f, roughness: 0.55, metalness: 0.6 });
  const visorMat = new THREE.MeshStandardMaterial({ color: 0x17222e, roughness: 0.1, metalness: 0.9 });

  const add = (parent, geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const bx = (parent, w, h, d, x, y, z, mat) => add(parent, new THREE.BoxGeometry(w, h, d), mat, x, y, z);

  /* ---- legs (pivot at the hip) ---- */
  const mkLeg = (side) => {
    const pv = new THREE.Group();
    pv.position.set(side * 0.115, 0.9, 0);
    bx(pv, 0.17, 0.46, 0.19, 0, -0.23, 0, suitDark);       // thigh
    bx(pv, 0.15, 0.4, 0.17, 0, -0.66, 0.005, suit);        // shin
    bx(pv, 0.19, 0.11, 0.29, 0, -0.85, -0.04, gearDark);   // boot
    bx(pv, 0.18, 0.07, 0.2, 0, -0.02, 0, gear);            // hip pad
    g.add(pv);
    return pv;
  };
  const legL = mkLeg(-1), legR = mkLeg(1);

  /* ---- torso ---- */
  bx(g, 0.42, 0.52, 0.25, 0, 1.2, 0, suit);                // chest
  bx(g, 0.44, 0.34, 0.29, 0, 1.26, 0, gear);               // plate carrier
  bx(g, 0.3, 0.09, 0.31, 0, 1.36, 0, suitDark);            // chest strap
  bx(g, 0.12, 0.1, 0.09, -0.1, 1.18, -0.17, gearDark);     // mag pouch
  bx(g, 0.12, 0.1, 0.09, 0.1, 1.18, -0.17, gearDark);
  bx(g, 0.38, 0.12, 0.27, 0, 0.95, 0, gearDark);           // belt
  bx(g, 0.26, 0.32, 0.14, 0, 1.22, 0.2, gear);             // backpack
  bx(g, 0.44, 0.1, 0.27, 0, 1.47, 0, suit);                // shoulder yoke

  /* ---- head ---- */
  bx(g, 0.11, 0.08, 0.11, 0, 1.53, 0, skin);               // neck
  add(g, new THREE.SphereGeometry(0.135, 12, 10), skin, 0, 1.64, 0);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.152, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), suit);
  helmet.position.set(0, 1.655, 0); helmet.castShadow = true; g.add(helmet);
  bx(g, 0.3, 0.026, 0.24, 0, 1.628, -0.02, suitDark);      // brim
  bx(g, 0.2, 0.045, 0.03, 0, 1.645, -0.135, visorMat);     // visor
  bx(g, 0.05, 0.09, 0.03, 0, 1.72, 0.09, suitDark);        // helmet mount

  /* ---- arms (pivot at the shoulder) ---- */
  const mkArm = (side) => {
    const pv = new THREE.Group();
    pv.position.set(side * 0.265, 1.42, 0);
    bx(pv, 0.125, 0.28, 0.145, 0, -0.15, 0, suit);         // upper arm
    bx(pv, 0.105, 0.26, 0.125, 0, -0.41, 0.015, suitDark); // forearm
    bx(pv, 0.11, 0.1, 0.13, 0, -0.58, 0.03, gearDark);     // glove
    g.add(pv);
    return pv;
  };
  const armL = mkArm(-1), armR = mkArm(1);
  armL.rotation.set(1.36, 0, 0.5);
  armR.rotation.set(1.18, 0, -0.22);

  /* ---- weapon in hand ---- */
  const gun = new THREE.Group();
  gun.position.set(0.1, 1.1, -0.34);
  bx(gun, 0.06, 0.09, 0.5, 0, 0, 0, gunMat);               // receiver
  add(gun, new THREE.CylinderGeometry(0.014, 0.014, 0.3, 8), gunMat, 0, 0.02, -0.36).rotation.x = Math.PI / 2;
  bx(gun, 0.04, 0.12, 0.06, 0, -0.09, 0.02, gunMat);       // magazine
  bx(gun, 0.045, 0.05, 0.15, 0, -0.01, 0.22, gunMat);      // stock
  g.add(gun);

  /* ---- team ring ---- */
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.5, 24),
    new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.45, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; g.add(ring);

  return { group: g, legL, legR, armL, armR, gun, ring };
}

function makeActor(team, name, isPlayer) {
  return {
    team, name, isPlayer: !!isPlayer,
    pos: new V3(0, 0, team === 'red' ? 33 : -33),
    vel: new V3(),
    yaw: team === 'red' ? 0 : Math.PI,
    pitch: 0,
    hp: 100, maxHp: 100,
    alive: true, respawnT: 0, onGround: true,
    radius: 0.42, height: 1.8, speedMul: 1,
    kills: 0, deaths: 0, shots: 0, hits: 0,
    weapons: [], cur: 0, reloadT: 0, lastShot: 0,
    carrying: null, mesh: null, parts: null,
    target: null, lastSeen: new V3(), lastSeenT: 0,
    think: 0, reactT: 0, path: null, pathIdx: 0, goalPos: new V3(1e9, 0, 0),
    goalKind: '', goalLock: 0, huntTarget: null, defendPost: null, postT: 0,
    strafe: 1, strafeT: 0, burstT: 0, aimYaw: 0, aimPitch: 0,
    stuckX: 0, stuckZ: 0, stuckWin: 0, stuckT: 0, stuckStage: 0, nudgeT: 0, nudgeAng: 0, hopT: 0,
    animT: 0, np: null, diff: DIFF.normal, role: 'attack', hitFlash: 0
  };
}

function spawnPoint(team, i) {
  const list = (G.spawns && G.spawns[team]) || [];
  const s = list.length ? list[i % list.length] : { x: 0, z: team === 'red' ? 20 : -20 };
  return new V3(s.x, 0, s.z);
}

function ensureBotGroup() {
  G.bots.length = 0;
  if (G._botGroup) scene.remove(G._botGroup);
  G._botGroup = new THREE.Group();
  scene.add(G._botGroup);
}

function createTeams() {
  ensureBotGroup();

  const names = BOT_NAMES.slice().sort(() => Math.random() - 0.5);
  let ni = 0;
  const mine = G.team, foe = otherTeam(mine);

  // your team: four AI teammates alongside you
  for (let i = 0; i < CFG.botsPerTeam; i++) {
    const b = makeActor(mine, names[ni++], false);
    b.diff = DIFF[G.diff];
    b.role = i < 3 ? 'attack' : 'defend';
    finishSpawn(b, i);
    G.bots.push(b);
  }
  // enemy team: five bots
  for (let i = 0; i < CFG.botsPerTeam + 1; i++) {
    const b = makeActor(foe, names[ni++ % names.length], false);
    b.diff = DIFF[G.diff];
    b.role = i < 3 ? 'attack' : 'defend';
    finishSpawn(b, i);
    G.bots.push(b);
  }

  for (const b of G.bots) {
    const m = buildBotMesh(b.team);
    b.parts = m;
    b.mesh = m.group;
    G._botGroup.add(m.group);
    // nameplate
    const np = document.createElement('div');
    np.className = 'np ' + b.team;
    np.innerHTML = '<div class="np-name">' + b.name + '</div>' +
      '<div class="np-hp"><div class="np-fill"></div></div>' +
      '<div class="np-hpn">100</div>';
    $('nameplates').appendChild(np);
    b.np = np;
    b.npFill = np.querySelector('.np-fill');
    b.npHp = np.querySelector('.np-hpn');
  }
}

function finishSpawn(a, slot) {
  a.hp = a.maxHp = (a.isPlayer ? CFG.playerHp : a.diff.hp);
  a.alive = true;
  a.respawnT = 0;
  a.vel.set(0, 0, 0);
  a.carrying = null;
  a.capT = 0;
  a.reloadT = 0;
  a.lastHurtT = 0;
  a.weapons = [
    { id: 'knife', mag: 0, res: 0 },
    { id: 'pistol', mag: WEAPONS.pistol.mag, res: WEAPONS.pistol.reserve }
  ];
  a.cur = 1;
  const sp = spawnPoint(a.team, slot || 0);
  a.pos.copy(sp);
  a.pos.y = groundAt(sp.x, sp.z, 1.2);
  a.yaw = a.team === 'red' ? 0 : Math.PI;
  a.pitch = 0;
  // fresh navigation state: no stale stuck history or half-walked path
  a.path = null; a.pathIdx = 0; a.goalPos.set(1e9, 0, 0); a.goalKind = ''; a.goalLock = 0;
  a.defendPost = null; a.postT = 0; a.huntTarget = null;
  a.stuckX = a.pos.x; a.stuckZ = a.pos.z; a.stuckWin = 0; a.stuckT = 0; a.stuckStage = 0; a.nudgeT = 0; a.hopT = 0;
  if (a.mesh) { a.mesh.visible = true; a.mesh.position.copy(a.pos); }
  if (a.np) a.np.style.opacity = '1';
}

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
    Snd.hit();
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
    if (G.mode !== 'flag') G.score[attacker.team]++;   // flag mode scores captures only
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
    $('respawn').classList.add('show');
    $('carryBanner').classList.remove('show');
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
  const ca = a === 'YOU' ? 'r' : (teamOf(a) === 'red' ? 'r' : 'b');
  el.innerHTML = '<span class="' + ca + '">' + a + '</span>' +
    '<span class="w">' + (head ? 'HEADSHOT ' : '') + (w ? '[' + w + ']' : '') + '</span>' +
    '<span class="' + (teamOf(b) === 'red' ? 'r' : 'b') + '">' + b + '</span>';
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
  const st = a.weapons[a.cur], w = WEAPONS[st.id];
  if (!w || w.melee || a.reloadT > 0) return;
  if (st.mag >= w.mag || st.res <= 0) return;
  a.reloadT = (a.isPlayer ? w.reload : a.diff.reload);
  if (a.isPlayer) Snd.reload();
}

function finishReload(a) {
  const st = a.weapons[a.cur], w = WEAPONS[st.id];
  if (!w || w.melee) return;
  const need = w.mag - st.mag;
  const take = Math.min(need, st.res);
  st.mag += take; st.res -= take;
}

function tryFire(a) {
  const st = a.weapons[a.cur];
  if (!st) return;
  const w = WEAPONS[st.id];
  const t = G.t;
  if (a.reloadT > 0 || t - a.lastShot < w.rate) return;

  if (w.melee) {
    a.lastShot = t;
    if (a.isPlayer) { Snd.slash(); swingKnife(); }
    const eye = eyePos(a);
    const d = a.isPlayer ? camera.getWorldDirection(new V3()) : dirFromAngles(a.yaw, a.pitch, new V3());
    for (const o of allActors()) {
      if (o === a || o.team === a.team || !o.alive) continue;
      const to = new V3(o.pos.x - eye.x, o.pos.y + 1 - eye.y, o.pos.z - eye.z);
      const dist = to.length();
      if (dist > w.range) continue;
      to.normalize();
      if (to.dot(d) > 0.55) damage(o, w.dmg * (a.isPlayer ? 1 : a.diff.dmg), a, false, 'KNIFE');
    }
    return;
  }

  if (st.mag <= 0) {
    if (a.isPlayer) { Snd.empty(); startReload(a); }
    else startReload(a);
    return;
  }

  a.lastShot = t;
  st.mag--;
  a.shots++;
  if (a.isPlayer) {
    Snd.shot(w.snd || 'pistol', 1);
    addRecoil(w);
  } else {
    const dd = camera.position.distanceTo(a.pos);
    if (dd < 55) Snd.shot(w.snd || 'pistol', clamp(1 - dd / 55, 0.12, 0.85));
  }

  const origin = eyePos(a, new V3());
  let baseDir;
  if (a.isPlayer) baseDir = camera.getWorldDirection(new V3());
  else baseDir = dirFromAngles(a.yaw, a.pitch, new V3());

  const pellets = w.pellets || 1;
  const spread = a.isPlayer ? w.spread * playerMoveSpread() * (1 - 0.62 * (VM.ads || 0)) : (w.spread + a.diff.err);
  const muzzle = muzzlePos(a, new V3());

  for (let p = 0; p < pellets; p++) {
    const dir = baseDir.clone();
    const ang = Math.random() * Math.PI * 2;
    const mag = Math.sqrt(Math.random()) * spread;
    const right = new V3(-dir.z, 0, dir.x);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0); else right.normalize();
    const up = new V3().crossVectors(right, dir);
    if (up.lengthSq() < 1e-6) up.set(0, 1, 0); else up.normalize();
    dir.addScaledVector(right, Math.cos(ang) * mag).addScaledVector(up, Math.sin(ang) * mag);
    if (dir.lengthSq() < 1e-6) dir.copy(baseDir); else dir.normalize();

    const wallT = rayWorld(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, w.range);
    const hit = rayActors(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, wallT < 0 ? w.range : wallT, a);
    let endP;
    if (hit) {
      endP = origin.clone().addScaledVector(dir, hit.dist);
      const dmg = w.dmg * (hit.head ? 2.0 : 1) * (a.isPlayer ? 1 : a.diff.dmg);
      damage(hit.actor, dmg, a, hit.head, w.name.replace(/^(M9|MP5|AK-47|SPAS-12|AWP)\s*/, ''));
      a.hits++;
      spark(endP, 0xff5a5a, 6);
    } else if (wallT > 0) {
      endP = origin.clone().addScaledVector(dir, wallT);
      spark(endP, 0xd8d2c0, 4);
    } else {
      endP = origin.clone().addScaledVector(dir, w.range);
    }
    tracer(muzzle, endP, a.isPlayer ? 0xfff0a8 : 0xff9a6a);
  }
}

function playerMoveSpread() {
  const sp = Math.hypot(G.player.vel.x, G.player.vel.z);
  return 1 + sp * 0.35 + (G.player.onGround ? 0 : 0.8);
}

/* ------------------------------------------------------------
   EFFECTS
   ------------------------------------------------------------ */
function tracer(from, to, color) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
  const line = new THREE.Line(geo, mat);
  scene.add(line);
  G.tracers.push({ line, life: 0.06, max: 0.06 });
}

function spark(pos, color, n) {
  for (let i = 0; i < n; i++) {
    const g = new THREE.SphereGeometry(0.028, 4, 3);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true }));
    m.position.copy(pos);
    scene.add(m);
    G.particles.push({
      mesh: m, life: 0.35,
      vel: new V3(rand(-2.5, 2.5), rand(-1, 3), rand(-2.5, 2.5))
    });
  }
}

function updateEffects(dt) {
  for (let i = G.tracers.length - 1; i >= 0; i--) {
    const t = G.tracers[i];
    t.life -= dt;
    t.line.material.opacity = Math.max(0, t.life / t.max) * 0.9;
    if (t.life <= 0) { scene.remove(t.line); t.line.geometry.dispose(); t.line.material.dispose(); G.tracers.splice(i, 1); }
  }
  for (let i = G.particles.length - 1; i >= 0; i--) {
    const p = G.particles[i];
    p.life -= dt;
    p.vel.y -= 18 * dt;
    p.mesh.position.addScaledVector(p.vel, dt);
    p.mesh.material.opacity = Math.max(0, p.life / 0.35);
    p.mesh.scale.setScalar(Math.max(0.2, p.life / 0.35));
    if (p.life <= 0) { scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); G.particles.splice(i, 1); }
  }
}

/* ------------------------------------------------------------
   CHESTS
   ------------------------------------------------------------ */
/* spots are chosen at world-build time (maze dead ends + the catwalk) */
function chestSpots() { return G.chestSpots || []; }

function buildChest(x, y, z) {
  const grp = new THREE.Group();
  grp.position.set(x, y, z);

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.52, 0.66), MAT.wood);
  body.position.y = 0.26; body.castShadow = true; body.receiveShadow = true; grp.add(body);

  const band1 = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.09, 0.7), MAT.gold);
  band1.position.set(0, 0.12, 0); grp.add(band1);
  const band2 = band1.clone(); band2.position.y = 0.42; grp.add(band2);

  const lidPivot = new THREE.Group();
  lidPivot.position.set(0, 0.52, -0.33);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.2, 0.68), MAT.woodDark);
  lid.position.set(0, 0.1, 0.33); lid.castShadow = true; lidPivot.add(lid);
  const lidBand = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.08, 0.72), MAT.gold);
  lidBand.position.set(0, 0.1, 0.33); lidPivot.add(lidBand);
  grp.add(lidPivot);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.028, 6, 24),
    new THREE.MeshBasicMaterial({ color: 0xffc44d, transparent: true, opacity: 0.9 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.95; grp.add(ring);

  /* beacon: a soft column of light so a crate is visible across the maze */
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xffb43a, transparent: true, opacity: 0.22,
    depthWrite: false, side: THREE.DoubleSide
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.5, 6.5, 10, 1, true), beamMat);
  beam.position.y = 3.4;
  grp.add(beam);

  /* a solid marker cube at the top of the beam, readable from the catwalk */
  const mark = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0),
    new THREE.MeshBasicMaterial({ color: 0xffd166 }));
  mark.position.y = 2.3;
  grp.add(mark);

  const glow = new THREE.PointLight(0xffb347, 1.1, 7);
  glow.position.y = 0.9; grp.add(glow);

  scene.add(grp);
  return {
    grp, lidPivot, ring, glow, beam, mark, beamMat,
    pos: new V3(x, y, z), weapon: null, available: true, respawnT: 0, openT: 0
  };
}

function createChests() {
  if (G._chestGroup) scene.remove(G._chestGroup);
  for (const c of G.chests) scene.remove(c.grp);
  G.chests.length = 0;
  for (const s of chestSpots()) {
    const c = buildChest(s[0], s[1], s[2]);
    c.weapon = pick(CHEST_POOL);
    G.chests.push(c);
  }
}

/* Keep bodies from occupying the same space. Bots yield most of the overlap to
   the player, so walking into a teammate nudges them aside instead of clipping. */
function separateActors() {
  const list = allActors();
  const R = CFG.player.radius * 2;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (!b.alive) continue;
      if (Math.abs(a.pos.y - b.pos.y) > 1.7) continue;
      let dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      let d = Math.hypot(dx, dz);
      if (d >= R) continue;
      if (d < 1e-4) { dx = 1; dz = 0; d = 1; }
      const wa = a.isPlayer ? 0.3 : 1, wb = b.isPlayer ? 0.3 : 1;
      const share = (R - d) / (wa + wb);
      dx /= d; dz /= d;
      a.pos.x -= dx * share * wa; a.pos.z -= dz * share * wa;
      b.pos.x += dx * share * wb; b.pos.z += dz * share * wb;
      resolveHorizontal(a);
      resolveHorizontal(b);
    }
  }
}

function updateChests(dt) {
  const p = G.player;
  let near = null;
  for (const c of G.chests) {
    c.ring.rotation.z += dt * 1.6;
    if (!c.available) {
      c.respawnT -= dt;
      if (c.respawnT <= 0) {
        c.available = true;
        c.weapon = pick(CHEST_POOL);
        c.ring.visible = true; c.glow.visible = true;
      }
    }
    c.lidPivot.rotation.x = lerp(c.lidPivot.rotation.x, c.available ? 0 : -1.9, Math.min(1, dt * 8));
    c.ring.material.opacity = c.available ? 0.55 + Math.sin(now() * 3) * 0.3 : 0;
    c.ring.visible = c.available;
    c.glow.visible = c.available;

    /* beacon pulse */
    const pulse = 0.5 + 0.5 * Math.sin(now() * 2.2 + c.pos.x);
    c.beam.visible = c.available;
    c.mark.visible = c.available;
    c.beamMat.opacity = 0.10 + pulse * 0.09;
    c.mark.rotation.y += dt * 1.4;
    c.mark.position.y = 2.25 + Math.sin(now() * 1.8 + c.pos.z) * 0.09;

    if (c.available && p.alive) {
      const d = Math.hypot(p.pos.x - c.pos.x, p.pos.z - c.pos.z) + Math.abs(p.pos.y - c.pos.y) * 2;
      if (d < 2.3 && (!near || d < near.d)) near = { c, d };
    }
    // bots grab weapons on their own
    if (c.available) {
      for (const b of G.bots) {
        if (!b.alive || b.dummy) continue;
        const d = Math.hypot(b.pos.x - c.pos.x, b.pos.z - c.pos.z) + Math.abs(b.pos.y - c.pos.y) * 2;
        if (d < 1.6 && b.weapons.length < 4) {
          takeChest(c, b);
          break;
        }
      }
    }
  }
  G.nearChest = near ? near.c : null;
  $('prompt').classList.toggle('show', !!near && G.state === 'playing');
}

function takeChest(c, a) {
  if (!c.available) return;
  const id = c.weapon;
  giveWeapon(a, id);
  c.available = false;
  c.respawnT = CFG.chestRespawn;
  c.ring.visible = false;
  if (c.beam) c.beam.visible = false;
  if (c.mark) c.mark.visible = false;
  if (a.isPlayer) {
    Snd.chest(); Snd.pickup();
    if (G.tutorial.active) G.tutorial.chests++;
    banner('PICKED UP <span class="hl">' + WEAPONS[id].name + '</span>', 1.6);
  }
}

function giveWeapon(a, id) {
  const w = WEAPONS[id];
  const ex = a.weapons.find(x => x.id === id);
  if (ex) { ex.res = Math.min(w.reserve, ex.res + Math.ceil(w.mag * 1.5)); if (a.isPlayer) a.cur = a.weapons.indexOf(ex); return; }
  const st = { id, mag: w.mag, res: w.reserve };
  if (a.weapons.length < 4) a.weapons.push(st);
  else a.weapons[a.cur >= 2 ? a.cur : 2] = st;
  if (a.isPlayer) a.cur = a.weapons.indexOf(st);
}

/* ------------------------------------------------------------
   FLAGS
   ------------------------------------------------------------ */
function buildFlag(team) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 2.9, 8), MAT.metal);
  pole.position.y = 1.45; pole.castShadow = true; g.add(pole);
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.6, 10, 5),
    new THREE.MeshStandardMaterial({ color: team === 'red' ? 0xa81818 : 0x1840a8, side: THREE.DoubleSide, roughness: 0.9 }));
  cloth.position.set(0.5, 2.45, 0); g.add(cloth);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), MAT.gold);
  cap.position.y = 2.95; g.add(cap);
  scene.add(g);
  return { group: g, cloth, baseY: 0 };
}

function createFlags() {
  for (const t of ['red', 'blue']) {
    if (G.flags && G.flags[t]) scene.remove(G.flags[t].group);
  }
  G.flags = { red: buildFlag('red'), blue: buildFlag('blue') };
  const rp = flagBasePos('red'), bp = flagBasePos('blue');
  G.flagState.red = { at: 'base', carrier: null, dropT: 0, pos: rp.clone() };
  G.flagState.blue = { at: 'base', carrier: null, dropT: 0, pos: bp.clone() };
  G.flags.red.group.position.copy(rp);
  G.flags.blue.group.position.copy(bp);
}

function flagBasePos(team) {
  const h = (G.hq && G.hq[team]) || { x: 0, z: team === 'red' ? 20 : -20 };
  return new V3(h.x, 0, h.z);
}

function dropFlag(team, pos) {
  const fs = G.flagState[team];
  fs.at = 'dropped';
  fs.carrier = null;
  fs.dropT = 20;
  fs.pos.set(pos.x, groundAt(pos.x, pos.z, pos.y + 0.5), pos.z);
  for (const a of allActors()) if (a.carrying === team) a.carrying = null;
  if (G.player.carrying === team) $('carryBanner').classList.remove('show');
}

function returnFlag(team) {
  const fs = G.flagState[team];
  fs.at = 'base'; fs.carrier = null; fs.dropT = 0;
  fs.pos.copy(flagBasePos(team));
  for (const a of allActors()) if (a.carrying === team) a.carrying = null;
}

function updateFlags(dt) {
  if (G.mode !== 'flag') return;
  for (const team of ['red', 'blue']) {
    const fs = G.flagState[team];
    const fl = G.flags[team];
    if (fs.at === 'carried') {
      const c = fs.carrier;
      if (!c || !c.alive) { dropFlag(team, c ? c.pos : fs.pos); continue; }
      fs.pos.set(c.pos.x, c.pos.y, c.pos.z);
      fl.group.position.set(c.pos.x, c.pos.y + 0.35, c.pos.z);
      fl.group.rotation.y += dt * 2;
    } else if (fs.at === 'dropped') {
      fl.group.position.copy(fs.pos);
      fl.group.rotation.y = 0;
      fs.dropT -= dt;
      if (fs.dropT <= 0) { returnFlag(team); banner(team.toUpperCase() + ' FLAG RETURNED', 1.6); }
    } else {
      fl.group.position.copy(fs.pos);
      fl.group.rotation.y = 0;
    }
    fl.group.visible = G.mode === 'flag';
  }

  // pickups / captures / returns
  for (const a of allActors()) {
    if (!a.alive) continue;
    for (const team of ['red', 'blue']) {
      if (a.team === team) continue;
      const fs = G.flagState[team];
      if ((fs.at === 'base' || fs.at === 'dropped') && !a.carrying) {
        if (dist2(a.pos, fs.pos) < 1.9 && Math.abs(a.pos.y - fs.pos.y) < 2) {
          fs.at = 'carried'; fs.carrier = a; fs.dropT = 0;
          a.carrying = team;
          if (a.isPlayer) { Snd.flag(); banner('YOU HAVE THE <span class="hl">' + team.toUpperCase() + ' FLAG</span> — RUN HOME', 3); $('carryBanner').classList.add('show'); }
          else if (a.team === G.player.team) banner('<span class="hl">' + a.name + '</span> grabbed the enemy flag', 1.8);
          else banner('THE ENEMY HAS YOUR FLAG', 2.2);
        }
      }
    }
    // capture (requires a short hold inside the HQ ring)
    if (a.carrying) {
      const ownBase = flagBasePos(a.team);
      const inHQ = dist2(a.pos, ownBase) < 3.8 && Math.abs(a.pos.y) < 2;
      if (inHQ && G.flagState[a.team].at === 'base') {
        a.capT = (a.capT || 0) + dt;
        if (a.isPlayer) {
          $('carryBanner').classList.add('show');
          $('carryBanner').textContent = 'CAPTURING — HOLD POSITION ' + Math.max(0, (2.4 - a.capT)).toFixed(1) + 's';
        }
        if (a.capT >= 2.4) {
          a.capT = 0;
          G.score[a.team]++;
          returnFlag(a.carrying);
          a.carrying = null;
          if (a.isPlayer) {
            Snd.flag();
            banner('<span class="hl">FLAG CAPTURED!</span>', 2.2);
            $('carryBanner').classList.remove('show');
          } else banner(a.team.toUpperCase() + ' TEAM SCORED', 2);
          checkRoundEnd();
        }
      } else {
        a.capT = 0;
        if (a.isPlayer && inHQ && G.flagState[a.team].at !== 'base') {
          banner('YOUR FLAG IS AWAY — RETURN IT FIRST', 1.5);
        }
      }
    }
    // return own dropped flag by touching
    if (!a.carrying && G.flagState[a.team].at === 'dropped') {
      if (dist2(a.pos, G.flagState[a.team].pos) < 1.8) {
        returnFlag(a.team);
        if (a.isPlayer) banner('FLAG RETURNED', 1.2);
      }
    }
  }
}

/* ------------------------------------------------------------
   BOT AI
   ------------------------------------------------------------ */
function botCanSee(b, e) {
  if (!e.alive) return false;
  const eye = b.pos.y + 1.52, ty = e.pos.y + 1.2;
  const d = Math.hypot(e.pos.x - b.pos.x, e.pos.z - b.pos.z);
  if (d > b.diff.range) return false;
  return losClear(b.pos.x, eye, b.pos.z, e.pos.x, ty, e.pos.z, 0.25);
}

function botThink(b) {
  const d = b.diff;
  let best = null, bestD = 1e9;
  for (const e of allActors()) {
    if (e === b || e.team === b.team || !e.alive) continue;
    if (botCanSee(b, e)) {
      const dd = b.pos.distanceTo(e.pos);
      if (dd < bestD) { bestD = dd; best = e; }
    }
  }
  if (best) {
    if (!b.target || b.target !== best) b.reactT = d.react * rand(0.75, 1.3);
    b.target = best;
    b.lastSeen.copy(best.pos);
    b.lastSeenT = G.t;
  } else if (b.target && G.t - b.lastSeenT > 2.2) {
    b.target = null;
  }

  /* choose destination — then COMMIT to it for a couple of seconds.
     Re-rolling the goal every think tick made bots jitter in place,
     bouncing between opposing destinations without going anywhere. */
  let goal = null, kind = '';
  const p = G.player;

  if (G.mode === 'flag') {
    const enemyFlagTeam = b.team === 'red' ? 'blue' : 'red';
    const ef = G.flagState[enemyFlagTeam];
    const mf = G.flagState[b.team];
    let escortCarrier = null;
    if (!b.carrying && b.role === 'attack') {
      for (const a of allActors()) {
        if (a && a !== b && a.alive && a.team === b.team && a.carrying === enemyFlagTeam) { escortCarrier = a; break; }
      }
    }

    if (b.carrying) { goal = flagBasePos(b.team); kind = 'carry'; }
    else if (mf.at === 'carried' && mf.carrier) { goal = mf.carrier.pos; kind = 'hunt'; }
    else if (mf.at === 'dropped') { goal = mf.pos; kind = 'return'; }
    else if (ef.at === 'dropped') { goal = ef.pos; kind = 'grab'; }
    else if (escortCarrier) {
      // a team-mate has the enemy flag: run interference for them
      goal = escortCarrier.pos; kind = 'escort';
    }
    else if (ef.at === 'base' && b.role === 'attack') { goal = ef.pos; kind = 'attack'; }
    else {
      // hold a post near own base (snapped to a walkable node — never aim into a wall).
      // The post is chosen ONCE per commitment. It used to be re-rolled to a fresh
      // random spot on every think tick, so `moved > 3.5` was always true, the bot
      // replanned ~4x a second and ping-ponged between two random posts forever.
      kind = 'defend';
      const arrived = b.defendPost &&
        Math.hypot(b.pos.x - b.defendPost.x, b.pos.z - b.defendPost.z) < 3.2;
      if (!b.defendPost || (arrived && b.postT <= 0)) {
        const dn = nearestNode(rand(-9, 9), flagBasePos(b.team).z * 0.62, 0);
        b.defendPost = dn ? new V3(dn.x, 0, dn.z) : new V3(0, 0, 0);
        b.postT = 3.5 + Math.random() * 3.5;
      }
      goal = b.defendPost;
    }
  } else {
    // TDM: hunt the enemy, grab a better gun early
    if (b.weapons.length < 3) {
      let bc = null, bcd = 1e9;
      for (const c of G.chests) {
        if (!c.available) continue;
        const dd = b.pos.distanceTo(c.pos);
        if (dd < bcd) { bcd = dd; bc = c; }
      }
      if (bc && bcd < 34 && (!b.target || bestD > 16)) { goal = bc.pos; kind = 'chest'; }
    }
    if (!goal) {
      kind = 'enemy';
      if (b.target) goal = b.target.pos;
      else {
        // stick with the current hunt unless someone else is clearly closer
        let near = null, nd = 1e9;
        for (const e of allActors()) {
          if (e.team === b.team || !e.alive) continue;
          const dd = b.pos.distanceTo(e.pos);
          if (dd < nd) { nd = dd; near = e; }
        }
        if (b.huntTarget && b.huntTarget.alive && b.huntTarget.team !== b.team &&
            b.pos.distanceTo(b.huntTarget.pos) < nd + 5) near = b.huntTarget;
        else b.huntTarget = near;
        goal = near ? near.pos : new V3(0, 0, 0);
      }
    }
  }

  if (goal) {
    const far = Math.hypot(b.pos.x - b.goalPos.x, b.pos.z - b.goalPos.z);
    const moved = Math.hypot(goal.x - b.goalPos.x, goal.z - b.goalPos.z);
    const exhausted = far > 2.5 && (!b.path || b.pathIdx >= b.path.length);
    if (b.goalLock <= 0 || moved > 3.5 || far < 2.0 || exhausted || kind !== b.goalKind) {
      b.goalPos.copy(goal);
      b.goalKind = kind;
      b.goalLock = 1.8 + Math.random() * 1.4;
      planPath(b, goal);
    }
  }
}

function planPath(b, goal) {
  const from = nearestNode(b.pos.x, b.pos.z, b.pos.y);
  const to = nearestNode(goal.x, goal.z, goal.y);
  b.path = findPath(from, to);
  b.pathIdx = 0;
  if (b.path.length > 1) {
    /* Resume from where we actually ARE on the path, not from path[0].
       Every replan used to restart at the node nearest the bot — usually one
       it had already walked past — so the bot about-turned, shuffled back to
       that node, advanced, got replanned, about-turned again... ping-ponging
       between two nodes forever. Project the bot onto the polyline and start
       at the node it is heading toward. */
    let bi = 0, bd = 1e9, bt = 0;
    for (let k = 0; k + 1 < b.path.length; k++) {
      const n = b.path[k], m = b.path[k + 1];
      const ex = m.x - n.x, ez = m.z - n.z;
      const l2 = ex * ex + ez * ez;
      if (l2 < 1e-6) continue;
      let tp = ((b.pos.x - n.x) * ex + (b.pos.z - n.z) * ez) / l2;
      tp = tp < 0 ? 0 : tp > 1 ? 1 : tp;
      const d = Math.hypot(b.pos.x - (n.x + ex * tp), b.pos.z - (n.z + ez * tp));
      if (d < bd) { bd = d; bi = k; bt = tp; }
    }
    /* Already on (or nearly on) that leg of the path -> carry on to the node
       AHEAD, even if we are only a little way along it. Turning back to a node
       we have already passed is what made bots shuttle between two nodes. */
    b.pathIdx = (bt > 0.02 && bd < 1.5) ? bi + 1 : bi;
  } else if (!b.path.length && from && from.nb.length) {
    // goal unreachable from here — step to a neighbour instead of grinding into a wall
    b.path = [from.nb[(Math.random() * from.nb.length) | 0]];
    b.pathIdx = 0;
  }
}

function updateBot(b, dt) {
  if (!b.alive) return;
  if (b.dummy) {
    // training dummy: no AI
    return;
  }
  /* safety net: if anything ever pushes a non-finite value into a bot (a NaN
     angle, a bad normalisation, a corrupt goal) it would otherwise be frozen
     for the rest of the match. Re-seat it on a clean spawn instead. */
  if (!isFinite(b.pos.x) || !isFinite(b.pos.y) || !isFinite(b.pos.z) ||
      !isFinite(b.yaw) || !isFinite(b.pitch) || !isFinite(b.vel.x) || !isFinite(b.vel.z)) {
    const slot = (Math.random() * 6) | 0;
    finishSpawn(b, slot);
    return;
  }
  b.think -= dt;
  if (b.think <= 0) { b.think = 0.18 + Math.random() * 0.16; botThink(b); }
  if (b.goalLock > 0) b.goalLock -= dt;
  if (b.postT > 0) b.postT -= dt;
  if (b.reactT > 0) b.reactT -= dt;
  if (b.reloadT > 0) { b.reloadT -= dt; if (b.reloadT <= 0) finishReload(b); }

  const d = b.diff;
  const eye = b.pos.y + 1.52;
  const tgt = b.target;
  let wx = 0, wz = 0, sprint = false;
  let visible = false;

  if (tgt && tgt.alive && botCanSee(b, tgt)) visible = true;
  else if (tgt && !tgt.alive) b.target = null;

  const sameFloor = tgt ? Math.abs(tgt.pos.y - b.pos.y) < 1.6 : true;

  if (visible && tgt && sameFloor) {
    const dx = tgt.pos.x - b.pos.x, dz = tgt.pos.z - b.pos.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    const nx = dx / dist, nz = dz / dist;
    // keep mid range, strafe
    b.strafeT -= dt;
    if (b.strafeT <= 0) { b.strafeT = rand(0.5, 1.6); b.strafe = Math.random() < 0.5 ? -1 : 1; }
    let fwd = 0;
    if (dist > 13) fwd = 1;
    else if (dist < 5) fwd = -0.8;
    else fwd = 0.15;
    const side = d.jumpiness * 0.7;
    wx = nx * fwd + (-nz) * b.strafe * side;
    wz = nz * fwd + (nx) * b.strafe * side;
    sprint = dist > 18;
    /* Keep the route ticking over while fighting. The path index used to be
       advanced only by the pure-navigation branch, so a bot that spent a while
       shooting froze at path[0] and then walked back to a stale waypoint. */
    if (b.path && b.pathIdx < b.path.length) {
      const n = b.path[b.pathIdx];
      if (Math.hypot(n.x - b.pos.x, n.z - b.pos.z) < 1.6) b.pathIdx++;
    }
    /* Objective push: when the flag is the job (grab it, or carry it home),
       keep advancing along the ROUTE even while trading fire — steering at the
       flag in a straight line just grinds into the maze walls. Holding
       mid-range short of the flag is why no flag was ever captured. */
    if (b.goalKind === 'attack' || b.goalKind === 'carry' || b.goalKind === 'return' || b.goalKind === 'escort') {
      let tx = b.goalPos.x, tz = b.goalPos.z;
      if (b.path && b.pathIdx < b.path.length) { tx = b.path[b.pathIdx].x; tz = b.path[b.pathIdx].z; }
      const gx = tx - b.pos.x, gz = tz - b.pos.z;
      const gl = Math.hypot(gx, gz) || 1;
      wx = wx * 0.35 + (gx / gl) * 0.65;
      wz = wz * 0.35 + (gz / gl) * 0.65;
      sprint = true;
    }
  } else {
    // path following
    if (b.path && b.pathIdx < b.path.length) {
      const n = b.path[b.pathIdx];
      const dx = n.x - b.pos.x, dz = n.z - b.pos.z;
      const dd = Math.hypot(dx, dz);
      if (dd < 1.3) b.pathIdx++;
      else { wx = dx / dd; wz = dz / dd; sprint = dd > 6; }
    } else if (b.goalPos) {
      const dx = b.goalPos.x - b.pos.x, dz = b.goalPos.z - b.pos.z;
      const dd = Math.hypot(dx, dz);
      if (dd > 1.5) { wx = dx / dd; wz = dz / dd; }
    }
  }

  /* avoid crowding — slide AROUND a teammate.
     The old version blended 70% raw separation into the movement vector. Two
     bots doing that to each other reach an equilibrium where each cancels the
     other's travel and both stall on the spot. Instead: strip only the part of
     our intent that walks into a neighbour, and step aside if we are heading
     straight at one. Navigation always wins. */
  let cx = 0, cz = 0;
  for (const o of G.bots) {
    if (o === b || !o.alive) continue;
    const dx = b.pos.x - o.pos.x, dz = b.pos.z - o.pos.z;
    const dd = Math.hypot(dx, dz);
    if (dd < 1.25 && dd > 0.01) { cx += dx / dd; cz += dz / dd; }
  }
  if (cx || cz) {
    const cl = Math.hypot(cx, cz);
    const sx = cx / cl, sz = cz / cl;
    const toward = wx * sx + wz * sz;          // >0 : our heading points at them
    if (toward > 0.15) {
      wx -= sx * toward; wz -= sz * toward;    // drop the colliding component
      const wl = Math.hypot(wx, wz);
      /* A weak residual is worse than none: the bot creeps at a fraction of
         walking speed, never trips the stuck watchdog (its intent stays under
         the threshold) and looks like it is grinding into a wall. Commit to a
         full-speed sidestep instead. */
      if (wl < 0.55) {
        const side = (Math.random() < 0.5 ? -1 : 1);
        wx = -sz * side; wz = sx * side;
      } else {
        wx = wx / wl; wz = wz / wl;
      }
    }
  }

  /* ---- wall-stuck recovery: a bot must never grind against a wall ----
     Signal = how far the bot actually GOT over the last second, not how far it
     flailed. A bot shuffling back and forth between two nodes moves plenty yet
     goes nowhere, and that is exactly the "hitting the walls and doing nothing"
     the player sees. Only while navigating — in a firefight the goal is a moving
     enemy, so "not getting closer" is normal fighting, not a stuck bot. */
  const goalD = Math.hypot(b.pos.x - b.goalPos.x, b.pos.z - b.goalPos.z);
  if (!(visible && tgt && sameFloor)) {
    b.stuckWin += dt;
    if (b.stuckWin >= 1.0) {
      const moved = Math.hypot(b.pos.x - b.stuckX, b.pos.z - b.stuckZ);
      /* "Did it get anywhere?" is the only signal that matters. The old gate on
         intent missed the worst case of all: a bot whose wish vector had been
         whittled down to a crawl, which is immobile in every practical sense. */
      if (moved < 0.6 && goalD > 2.5) {
        b.stuckT += b.stuckWin;
        if (b.stuckT >= 1.5) {
          // badly stuck: abandon the goal, hop, and strike out for a node that at
          // least points the way we were already heading
          b.stuckT = 0; b.stuckStage = 0;
          const gx = b.goalPos.x - b.pos.x, gz = b.goalPos.z - b.pos.z;
          const gl = Math.hypot(gx, gz) || 1;
          const near = NODES.filter(n =>
            Math.hypot(n.x - b.pos.x, n.z - b.pos.z) < 16 && Math.abs(n.y - b.pos.y) < 2.5);
          let n = null, bs = -1e9;
          for (const c of near) {
            const dx = c.x - b.pos.x, dz = c.z - b.pos.z;
            const dd = Math.hypot(dx, dz) || 1;
            const dot = (dx / dd) * (gx / gl) + (dz / dd) * (gz / gl);
            const s = dot * 3 - dd * 0.12 + Math.random() * 1.5;
            if (s > bs) { bs = s; n = c; }
          }
          if (!n) n = NODES[(Math.random() * NODES.length) | 0];
          if (n) { b.goalPos.set(n.x, 0, n.z); planPath(b, b.goalPos); }
          b.nudgeT = 1.0; b.nudgeAng = Math.random() * Math.PI * 2; b.hopT = 0.35;
        } else if (b.stuckT >= 0.5 && b.stuckStage < 2) {
          // gentle recovery: repath and sidestep around the obstacle
          b.stuckStage++;
          b.think = 0;
          b.nudgeT = 0.5; b.nudgeAng = b.stuckStage === 1 ? -Math.PI / 2 : Math.PI / 2; b.hopT = 0.25;
          if (b.goalPos) planPath(b, b.goalPos);
        }
      } else {
        b.stuckT = 0; b.stuckStage = 0;
      }
      b.stuckX = b.pos.x; b.stuckZ = b.pos.z;
      b.stuckWin = 0;
    }
  } else {
    b.stuckX = b.pos.x; b.stuckZ = b.pos.z; b.stuckWin = 0; b.stuckT = 0; b.stuckStage = 0;
  }
  if (b.nudgeT > 0) {
    b.nudgeT -= dt;
    const c = Math.cos(b.nudgeAng), s = Math.sin(b.nudgeAng);
    const nx = wx * c - wz * s, nz = wx * s + wz * c;
    wx = nx; wz = nz;
  }
  let wantJump = false;
  if (b.hopT > 0) { b.hopT -= dt; wantJump = true; }

  moveActor(b, wx, wz, sprint, wantJump, dt);

  /* aim */
  let desiredYaw = b.yaw, desiredPitch = 0;
  if (tgt && tgt.alive) {
    const tx = tgt.pos.x, ty = tgt.pos.y + (visible ? 1.15 : 1.0), tz = tgt.pos.z;
    const dx = tx - b.pos.x, dy = ty - eye, dz = tz - b.pos.z;
    desiredYaw = Math.atan2(-dx, -dz);
    const flat = Math.hypot(dx, dz);
    desiredPitch = flat > 0.05 ? clamp(Math.atan2(dy, flat), -1.35, 1.35) : 0;
  } else if (b.path && b.pathIdx < b.path.length) {
    const n = b.path[b.pathIdx];
    desiredYaw = Math.atan2(-(n.x - b.pos.x), -(n.z - b.pos.z));
    desiredPitch = 0;
  }
  const turnSpeed = 4.5 + d.jumpiness * 6;
  let dyaw = desiredYaw - b.yaw;
  while (dyaw > Math.PI) dyaw -= Math.PI * 2;
  while (dyaw < -Math.PI) dyaw += Math.PI * 2;
  b.yaw += dyaw * Math.min(1, turnSpeed * dt);
  b.pitch = lerp(b.pitch, desiredPitch, Math.min(1, turnSpeed * dt));

  /* shooting */
  if (visible && tgt && b.reactT <= 0 && sameFloor) {
    const st = b.weapons[b.cur];
    const w = WEAPONS[st.id];
    const dist = b.pos.distanceTo(tgt.pos);
    const facing = Math.abs(dyaw) < 0.22;
    if (facing && dist < (w.range || 30)) {
      if (st.mag > 0) {
        tryFire(b);
        // burst discipline: stop firing occasionally
        if (!w.auto && Math.random() < 0.02) b.reactT = d.react * 0.5;
      } else startReload(b);
    }
  }
  // reload when idle
  const st = b.weapons[b.cur];
  if (st && !WEAPONS[st.id].melee && st.mag <= 0 && b.reloadT <= 0) startReload(b);

  /* bots upgrade guns from chests they walk over (handled in updateChests) */

  /* animation */
  const sp = Math.hypot(b.vel.x, b.vel.z);
  b.animT += dt * (4 + sp * 1.6);
  if (b.mesh) {
    b.mesh.position.set(b.pos.x, b.pos.y, b.pos.z);
    b.mesh.rotation.y = b.yaw;
    const sw = Math.sin(b.animT) * Math.min(0.55, sp * 0.13);
    b.parts.legL.rotation.x = sw;
    b.parts.legR.rotation.x = -sw;
    b.parts.armL.rotation.x = 1.36 - sw * 0.06;
    b.parts.armR.rotation.x = 1.18 + sw * 0.05;
    b.parts.ring.visible = b.team === G.player.team;
  }
}

/* ------------------------------------------------------------
   PLAYER
   ------------------------------------------------------------ */
const keys = Object.create(null);

function createPlayer() {
  const p = makeActor(G.team, 'YOU', true);
  p.diff = DIFF[G.diff];
  finishSpawn(p, 5);              // slot 5: bots take 0-4
  p.hp = p.maxHp = CFG.playerHp;
  G.player = p;
  return p;
}

function updatePlayer(dt) {
  const p = G.player;
  if (!p.alive) {
    p.respawnT -= dt;
    $('rsNum').textContent = Math.max(0, Math.ceil(p.respawnT));
    if (p.respawnT <= 0) {
      respawnActor(p);
      $('respawn').classList.remove('show');
    }
    return;
  }
  if (p.reloadT > 0) {
    p.reloadT -= dt;
    if (p.reloadT <= 0) finishReload(p);
  }

  /* out-of-combat regeneration — the maze punishes you enough already */
  if (G.t - (p.lastHurtT || 0) > CFG.regenDelay && p.hp < p.maxHp) {
    p.hp = Math.min(p.maxHp, p.hp + CFG.regenRate * dt);
  }

  let wx = 0, wz = 0;
  if (keys['w'] || keys['arrowup']) wz -= 1;
  if (keys['s'] || keys['arrowdown']) wz += 1;
  if (keys['a'] || keys['arrowleft']) wx -= 1;
  if (keys['d'] || keys['arrowright']) wx += 1;
  const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
  // forward is (-sin, -cos); right is (cos, -sin)
  const fx = -sy, fz = -cy;
  const rx = cy, rz = -sy;
  const mx = fx * (-wz) + rx * wx;
  const mz = fz * (-wz) + rz * wx;

  const sprint = !!(keys['shift'] && wz < 0);
  moveActor(p, mx, mz, sprint, !!keys[' '], dt);

  // camera
  const speed = Math.hypot(p.vel.x, p.vel.z);
  p.bobT = (p.bobT || 0) + dt * (6 + speed * 1.1);
  const bob = p.onGround ? Math.sin(p.bobT) * Math.min(0.045, speed * 0.008) : 0;
  const sway = p.onGround ? Math.cos(p.bobT * 0.5) * Math.min(0.03, speed * 0.005) : 0;
  camera.position.set(p.pos.x, p.pos.y + CFG.player.eye + bob, p.pos.z);
  camera.rotation.set(p.pitch, p.yaw, sway * 0.4);

  // weapon switch keys handled in keydown
  updateViewModel(dt, speed);
}

function respawnActor(a) {
  const slot = a.isPlayer ? 5 : (G.bots.indexOf(a) % 5);
  finishSpawn(a, slot);
  if (a.mesh) { a.mesh.position.copy(a.pos); a.mesh.visible = true; }
  if (a.isPlayer) {
    $('carryBanner').classList.remove('show');
    G.player.yaw = 0; G.player.pitch = 0;
  }
}

/* ------------------------------------------------------------
   VIEW MODEL (first person weapon)
   ------------------------------------------------------------ */
const VM = { group: null, models: {}, recoil: 0, recoilV: 0, kick: 0, cur: null, flash: null, ads: 0, adsTarget: 0, adsOn: false, sway: new THREE.Vector2() };

const GM = {};
function gunMats() {
  GM.steel  = new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.42, metalness: 0.8 });
  GM.dark   = new THREE.MeshStandardMaterial({ color: 0x1b1e23, roughness: 0.62, metalness: 0.55 });
  GM.poly   = new THREE.MeshStandardMaterial({ color: 0x24272c, roughness: 0.82, metalness: 0.08 });
  GM.wood   = new THREE.MeshStandardMaterial({ color: 0x7a4a26, roughness: 0.78, metalness: 0.04 });
  GM.tan    = new THREE.MeshStandardMaterial({ color: 0x8c7a5c, roughness: 0.8, metalness: 0.05 });
  GM.glove  = new THREE.MeshStandardMaterial({ color: 0x22252a, roughness: 0.9, metalness: 0.05 });
  GM.sleeve = new THREE.MeshStandardMaterial({ color: 0x3b4032, roughness: 0.94, metalness: 0.02 });
  GM.skin   = new THREE.MeshStandardMaterial({ color: 0xb9855e, roughness: 0.86, metalness: 0.02 });
  GM.glass  = new THREE.MeshStandardMaterial({ color: 0x2a4a66, roughness: 0.06, metalness: 0.9 });
  GM.brass  = new THREE.MeshStandardMaterial({ color: 0xc79a44, roughness: 0.35, metalness: 0.9 });
}

/* helper: box in a group */
function b(parent, w, h, d, x, y, z, mat, rx, ry, rz) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
  parent.add(m);
  return m;
}
function cyl(parent, r1, r2, len, x, y, z, mat, seg) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, seg || 10), mat);
  m.position.set(x, y, z);
  m.rotation.x = Math.PI / 2;
  parent.add(m);
  return m;
}

/* right hand wrapped around a pistol grip */
function rightHand(grp, x, y, z, rot) {
  const h = new THREE.Group();
  h.position.set(x, y, z);
  h.rotation.set(rot || 0.18, 0, 0);
  b(h, 0.058, 0.076, 0.072, 0, 0, 0, GM.glove);            // palm around the grip
  b(h, 0.042, 0.038, 0.05, -0.026, 0.045, -0.022, GM.glove); // thumb
  b(h, 0.055, 0.055, 0.13, 0.012, -0.1, 0.05, GM.sleeve, 1.05); // forearm
  grp.add(h);
  return h;
}
/* left hand supporting a foregrip */
function leftHand(grp, x, y, z) {
  const h = new THREE.Group();
  h.position.set(x, y, z);
  b(h, 0.07, 0.056, 0.085, 0, 0, 0, GM.glove);
  b(h, 0.05, 0.04, 0.045, 0.028, 0.028, 0.008, GM.glove);
  b(h, 0.058, 0.056, 0.17, -0.026, -0.08, 0.085, GM.sleeve, 0.95, 0.3);
  grp.add(h);
  return h;
}

function buildViewModel() {
  gunMats();
  const g = new THREE.Group();
  camera.add(g);
  VM.group = g;

  /* The view model shares the world camera, whose 78deg FOV makes anything
     this close look enormous. Shrink each model in place (position is NOT
     scaled by the group's own scale) so it reads like a real FPS weapon. */
  const VM_S = 0.62;

  const mk = (id, hip, ads, build) => {
    const grp = new THREE.Group();
    build(grp);
    grp.scale.setScalar(VM_S);
    grp.visible = false;
    g.add(grp);
    grp.userData.hip = hip;
    grp.userData.ads = ads;
    VM.models[id] = grp;
  };

  /* ---------------- KNIFE ---------------- */
  mk('knife',
    { p: [0.22, -0.205, -0.45], r: [0.05, 0.10, -0.25] },
    { p: [0.185, -0.19, -0.43], r: [0.02, 0.10, -0.2] },
    grp => {
      b(grp, 0.026, 0.04, 0.12, 0, 0, 0.02, GM.poly);
      b(grp, 0.03, 0.05, 0.015, 0, 0, -0.05, GM.steel);
      b(grp, 0.055, 0.075, 0.1, 0, -0.005, 0.09, GM.poly, 0.1);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.042, 0.26), GM.steel);
      blade.position.set(0, 0.012, -0.18);
      blade.rotation.x = -0.02;
      grp.add(blade);
      const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.001, 0.021, 0.07, 4), GM.steel);
      tip.position.set(0, 0.012, -0.34);
      tip.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
      grp.add(tip);
      rightHand(grp, 0, -0.03, 0.09, 0.1);
    });

  /* ---------------- PISTOL (M9) ---------------- */
  mk('pistol',
    { p: [0.205, -0.185, -0.45], r: [0.03, 0.16, 0.01] },
    { p: [0, -0.043, -0.42], r: [0, 0, 0] },
    grp => {
      b(grp, 0.05, 0.056, 0.2, 0, 0.038, -0.09, GM.steel);        // slide
      b(grp, 0.03, 0.012, 0.09, 0, 0.068, -0.075, GM.dark);       // top rib
      b(grp, 0.042, 0.026, 0.18, 0, 0.006, -0.085, GM.poly);      // frame
      cyl(grp, 0.011, 0.011, 0.05, 0, 0.038, -0.2, GM.dark);      // muzzle
      b(grp, 0.04, 0.13, 0.058, 0, -0.078, 0.018, GM.poly, 0.22); // grip
      b(grp, 0.036, 0.012, 0.06, 0, -0.02, -0.03, GM.dark);       // trigger guard
      b(grp, 0.006, 0.012, 0.012, 0, 0.07, -0.175, GM.dark);      // front sight
      b(grp, 0.024, 0.012, 0.012, 0, 0.07, 0.0, GM.dark);         // rear sight
      b(grp, 0.008, 0.03, 0.06, 0.026, 0.02, -0.06, GM.dark);     // slide serrations
      /* hand: palm behind the grip, fingers wrapping the front */
      const h = new THREE.Group();
      h.position.set(0.004, -0.08, 0.062);
      b(h, 0.05, 0.082, 0.042, 0, 0, 0, GM.glove);                 // palm
      b(h, 0.044, 0.019, 0.05, 0, 0.028, -0.036, GM.glove);        // fingers
      b(h, 0.044, 0.019, 0.05, 0, 0.002, -0.038, GM.glove);
      b(h, 0.044, 0.019, 0.05, 0, -0.024, -0.038, GM.glove);
      b(h, 0.038, 0.048, 0.042, -0.024, 0.03, -0.018, GM.glove);   // thumb
      b(h, 0.046, 0.05, 0.05, 0.002, -0.05, 0.03, GM.sleeve, 0.5); // wrist
      b(h, 0.05, 0.05, 0.1, 0.006, -0.09, 0.085, GM.sleeve, 1.05); // sleeve
      grp.add(h);
    });

  /* ---------------- SMG (MP5) ---------------- */
  mk('smg',
    { p: [0.215, -0.20, -0.46], r: [0.03, 0.14, 0.01] },
    { p: [0, -0.034, -0.43], r: [0, 0, 0] },
    grp => {
      b(grp, 0.052, 0.075, 0.3, 0, 0.01, -0.12, GM.poly);         // receiver
      cyl(grp, 0.013, 0.013, 0.2, 0, 0.025, -0.35, GM.dark);      // barrel shroud
      b(grp, 0.048, 0.05, 0.16, 0, 0.005, -0.32, GM.poly);        // handguard
      b(grp, 0.038, 0.16, 0.055, 0, -0.095, -0.09, GM.poly, -0.14); // magazine
      b(grp, 0.04, 0.1, 0.05, 0, -0.07, 0.05, GM.poly, 0.24);     // grip
      b(grp, 0.05, 0.055, 0.2, 0, 0.012, 0.12, GM.dark);          // stock
      b(grp, 0.012, 0.05, 0.22, 0.028, 0.03, 0.12, GM.dark);      // stock rail
      b(grp, 0.008, 0.016, 0.012, 0, 0.055, -0.38, GM.dark);      // front sight
      b(grp, 0.03, 0.02, 0.02, 0, 0.055, 0.02, GM.dark);          // rear sight
      b(grp, 0.03, 0.03, 0.14, 0, 0.06, -0.14, GM.dark);          // top rail
      rightHand(grp, 0.005, -0.075, 0.05, 0.24);
      leftHand(grp, -0.005, -0.03, -0.3);
    });

  /* ---------------- RIFLE (AK) ---------------- */
  mk('rifle',
    { p: [0.215, -0.205, -0.47], r: [0.03, 0.12, 0.01] },
    { p: [0, -0.045, -0.43], r: [0, 0, 0] },
    grp => {
      b(grp, 0.055, 0.08, 0.34, 0, 0.01, -0.1, GM.dark);          // receiver
      cyl(grp, 0.014, 0.014, 0.34, 0, 0.028, -0.42, GM.steel);    // barrel
      b(grp, 0.05, 0.06, 0.2, 0, 0.008, -0.33, GM.wood);          // handguard
      b(grp, 0.022, 0.03, 0.24, 0, 0.055, -0.3, GM.dark);         // gas tube
      b(grp, 0.045, 0.17, 0.075, 0, -0.105, -0.08, GM.dark, -0.28); // magazine
      b(grp, 0.038, 0.1, 0.05, 0, -0.075, 0.06, GM.wood, 0.3);    // pistol grip
      b(grp, 0.048, 0.07, 0.17, 0, -0.005, 0.15, GM.wood);        // stock
      b(grp, 0.01, 0.045, 0.012, 0, 0.075, -0.55, GM.dark);       // front post
      b(grp, 0.035, 0.022, 0.02, 0, 0.072, -0.16, GM.dark);       // rear sight
      b(grp, 0.02, 0.03, 0.05, 0.03, 0.045, -0.02, GM.steel);     // charging handle
      rightHand(grp, 0.005, -0.08, 0.06, 0.26);
      leftHand(grp, -0.005, -0.02, -0.31);
    });

  /* ---------------- SHOTGUN (SPAS) ---------------- */
  mk('shotgun',
    { p: [0.215, -0.21, -0.47], r: [0.03, 0.12, 0.01] },
    { p: [0, -0.036, -0.43], r: [0, 0, 0] },
    grp => {
      b(grp, 0.058, 0.085, 0.3, 0, 0.01, -0.1, GM.dark);          // receiver
      cyl(grp, 0.021, 0.021, 0.46, 0, 0.035, -0.44, GM.steel);    // barrel
      cyl(grp, 0.018, 0.018, 0.4, 0, -0.015, -0.41, GM.dark);     // tube
      b(grp, 0.05, 0.055, 0.16, 0, -0.012, -0.34, GM.wood);       // pump
      b(grp, 0.048, 0.075, 0.17, 0, 0.005, 0.14, GM.wood);        // stock
      b(grp, 0.038, 0.09, 0.05, 0, -0.07, 0.05, GM.wood, 0.28);   // grip
      b(grp, 0.01, 0.02, 0.012, 0, 0.058, -0.62, GM.dark);        // bead
      rightHand(grp, 0.005, -0.075, 0.05, 0.26);
      leftHand(grp, -0.005, -0.025, -0.33);
    });

  /* ---------------- SNIPER (AWP) ---------------- */
  mk('sniper',
    { p: [0.215, -0.21, -0.47], r: [0.03, 0.12, 0.01] },
    { p: [0, -0.053, -0.43], r: [0, 0, 0] },
    grp => {
      b(grp, 0.055, 0.075, 0.38, 0, 0.01, -0.12, GM.poly);        // body
      cyl(grp, 0.014, 0.014, 0.52, 0, 0.03, -0.55, GM.steel);     // barrel
      b(grp, 0.045, 0.06, 0.18, 0, -0.005, -0.36, GM.poly);       // forend
      cyl(grp, 0.032, 0.032, 0.24, 0, 0.085, -0.14, GM.dark);     // scope body
      cyl(grp, 0.042, 0.042, 0.05, 0, 0.085, -0.27, GM.dark);     // objective
      cyl(grp, 0.026, 0.026, 0.04, 0, 0.085, -0.005, GM.dark);    // eyepiece
      b(grp, 0.02, 0.04, 0.03, 0, 0.05, -0.06, GM.dark);          // ring front
      b(grp, 0.02, 0.04, 0.03, 0, 0.05, -0.22, GM.dark);          // ring rear
      b(grp, 0.035, 0.09, 0.06, 0, -0.075, 0.04, GM.poly, 0.28);  // grip
      b(grp, 0.048, 0.085, 0.18, 0, 0.0, 0.15, GM.tan);           // stock
      b(grp, 0.03, 0.04, 0.12, 0.02, 0.02, 0.02, GM.dark);        // bolt
      b(grp, 0.012, 0.012, 0.09, 0.055, 0.02, 0.03, GM.steel, 0, 0, 0.6);
      b(grp, 0.03, 0.16, 0.05, 0, -0.1, -0.06, GM.dark, -0.1);    // magazine
      rightHand(grp, 0.005, -0.08, 0.04, 0.26);
      leftHand(grp, -0.005, -0.02, -0.34);
    });

  /* muzzle flash */
  const flashMat = new THREE.MeshBasicMaterial({ color: 0xffd97a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  VM.flash = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 5), flashMat);
  VM.flash.visible = false;
  g.add(VM.flash);
  VM.flash2 = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ map: flashTex(), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  VM.flash2.visible = false;
  g.add(VM.flash2);

  G.vm = VM;
}

function flashTex() {
  return makeTex(64, (g, s) => {
    g.clearRect(0, 0, s, s);
    const cx = s / 2, cy = s / 2;
    const grd = g.createRadialGradient(cx, cy, 2, cx, cy, s / 2);
    grd.addColorStop(0, 'rgba(255,255,235,1)');
    grd.addColorStop(0.3, 'rgba(255,205,110,0.9)');
    grd.addColorStop(0.7, 'rgba(255,140,40,0.25)');
    grd.addColorStop(1, 'rgba(255,120,20,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(cx, cy, s / 2, 0, 7); g.fill();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2, l = s * (0.3 + Math.random() * 0.2);
      g.strokeStyle = 'rgba(255,230,160,0.7)';
      g.lineWidth = 2 + Math.random() * 2;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l);
      g.stroke();
    }
  });
}

function setViewModel(id) {
  if (!VM.models[id]) return;
  for (const k in VM.models) VM.models[k].visible = false;
  VM.models[id].visible = true;
  VM.cur = id;
}

function addRecoil(w) {
  VM.recoilV += 0.05 + (w.dmg / 900);
  G.player.pitch = clamp(G.player.pitch + 0.004 + Math.random() * 0.003, -1.4, 1.4);
  G.player.yaw += rand(-0.002, 0.002);
}

function swingKnife() {
  VM.kick = 1;
}

const MUZZLE = { knife: [0, 0.01, -0.36], pistol: [0, 0.035, -0.22], smg: [0, 0.025, -0.46], rifle: [0, 0.028, -0.6], shotgun: [0, 0.035, -0.68], sniper: [0, 0.03, -0.82] };
const ADS_FOV = { pistol: 58, smg: 55, rifle: 50, shotgun: 60, sniper: 24, knife: 74 };

function updateViewModel(dt, speed) {
  const p = G.player;
  const st = p.weapons[p.cur];
  if (!st) return;
  if (VM.cur !== st.id) setViewModel(st.id);
  const m = VM.models[st.id];
  if (!m) return;

  const w = WEAPONS[st.id];

  /* ADS blend */
  VM.adsTarget = (VM.adsOn && !w.melee) ? 1 : 0;
  VM.ads = lerp(VM.ads, VM.adsTarget, Math.min(1, dt * 12));

  /* recoil / kick */
  VM.recoilV *= 0.86;
  VM.kick = Math.max(0, VM.kick - dt * 4.5);

  const hip = m.userData.hip, ads = m.userData.ads;
  const bobAmt = p.onGround ? 1 : 0.3;
  const bobX = Math.sin(p.bobT || 0) * Math.min(0.014, speed * 0.0026) * bobAmt;
  const bobY = Math.abs(Math.cos(p.bobT || 0)) * Math.min(0.012, speed * 0.0022) * bobAmt;
  const reloadProg = p.reloadT > 0 ? Math.min(1, p.reloadT * 1.6) : 0;
  const t = VM.ads;

  const px = lerp(hip.p[0] + bobX, ads.p[0], t);
  const py = lerp(hip.p[1] + bobY, ads.p[1], t) - reloadProg * 0.14;
  const pz = lerp(hip.p[2], ads.p[2], t) + VM.recoilV * 0.5;

  m.position.set(px, py, pz);
  m.rotation.set(
    lerp(hip.r[0], ads.r[0], t) + VM.recoilV * 0.5 - VM.kick * 1.1 - reloadProg * 0.55,
    lerp(hip.r[1], ads.r[1], t) + VM.kick * 0.55,
    lerp(hip.r[2], ads.r[2], t) + VM.kick * 0.45
  );

  /* FOV / scope */
  const sniperScoped = st.id === 'sniper' && VM.ads > 0.75;
  const targetFov = 78 - (78 - (ADS_FOV[st.id] || 55)) * VM.ads;
  if (Math.abs(camera.fov - targetFov) > 0.15) {
    camera.fov = lerp(camera.fov, targetFov, Math.min(1, dt * 14));
    camera.updateProjectionMatrix();
  }
  const scopeEl = $('scope');
  if (scopeEl) scopeEl.classList.toggle('show', sniperScoped);
  m.visible = !sniperScoped;
  VM.flash.visible = VM.recoilV > 0.055 && !sniperScoped;
  VM.flash2.visible = VM.flash.visible;

  if (VM.flash.visible) {
    const mz = MUZZLE[st.id] || [0, 0, -0.5];
    m.updateWorldMatrix(true, false);
    const wp = m.localToWorld(new V3(mz[0], mz[1], mz[2]));
    VM.group.worldToLocal(wp);
    VM.flash.position.copy(wp);
    VM.flash2.position.copy(wp);
    VM.flash.scale.setScalar(0.8 + Math.random() * 0.9);
    VM.flash2.scale.setScalar(0.8 + Math.random() * 0.7);
    VM.flash2.rotation.z = Math.random() * 6.28;
    VM.flash.material.opacity = clamp(VM.recoilV * 4, 0, 0.95);
    VM.flash2.material.opacity = clamp(VM.recoilV * 3.4, 0, 0.9);
  }
}

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
function banner(html, secs) {
  const el = $('objBanner');
  el.innerHTML = html;
  el.classList.add('show');
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
    g.fillStyle = '#ffd166';
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
  if (st) {
    const w = WEAPONS[st.id];
    $('gName').textContent = w.name;
    if (w.melee) {
      $('gMag').textContent = '∞'; $('gRes').textContent = '';
      $('gHint').textContent = 'MELEE';
      $('gHint').classList.remove('warn');
    } else {
      $('gMag').textContent = st.mag;
      $('gRes').textContent = st.res;
      $('gMag').parentElement.classList.toggle('empty', st.mag === 0);
      $('gHint').textContent = p.reloadT > 0 ? 'RELOADING…' : (st.mag === 0 ? 'PRESS R TO RELOAD' : (st.mag / w.mag < 0.3 ? 'LOW AMMO — R' : 'R RELOAD'));
      $('gHint').classList.toggle('warn', st.mag === 0 || p.reloadT > 0);
    }
    const names = p.weapons.map((x, i) => (i + 1) + ' ' + WEAPONS[x.id].name.split(' ')[0]);
    $('vSub').textContent = names.join('   ');
  }

  // crosshair spread
  const sp = Math.hypot(p.vel.x, p.vel.z);
  const spread = 4 + sp * 1.6 + (st && !WEAPONS[st.id].melee ? WEAPONS[st.id].spread * 320 : 0);
  const ch = $('crosshair');
  ch.style.width = ch.style.height = (34 + spread) + 'px';
  ch.querySelector('.t').style.top = '0px';
  ch.querySelector('.b').style.bottom = '0px';
  ch.querySelector('.l').style.left = '0px';
  ch.querySelector('.r').style.right = '0px';

  updateRoster(dt);
  camera.updateMatrixWorld();
  updateNameplates();
  drawMinimap();
  updateBag();

  if (bannerT > 0) {
    bannerT -= dt;
    if (bannerT <= 0) $('objBanner').classList.remove('show');
  }

  // flag mode status line
  if (G.mode === 'flag' && G.flagState) {
    const mf = G.flagState[p.team];
    if (mf.at === 'carried' && mf.carrier && mf.carrier !== p) $('objBanner').classList.add('show');
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
    const w = WEAPONS[st.id];
    const ammo = w.melee ? '∞' : (st.mag + '<i>/</i>' + st.res);
    sig += st.id + ':' + st.mag + ':' + st.res + ':' + p.cur;
    html += '<div class="bag-row' + (i === p.cur ? ' cur' : '') + '">' +
      '<span class="bag-slot">' + (i + 1) + '</span>' +
      '<span class="bag-name">' + w.name + '</span>' +
      '<span class="bag-ammo">' + ammo + '</span></div>';
  });
  for (let i = p.weapons.length; i < 4; i++) {
    html += '<div class="bag-row empty"><span class="bag-slot">' + (i + 1) + '</span>' +
      '<span class="bag-name">— EMPTY —</span><span class="bag-ammo"></span></div>';
  }
  if (sig !== bagSig) { bagSig = sig; $('bagList').innerHTML = html; }
}

/* ------------------------------------------------------------
   TUTORIAL
   ------------------------------------------------------------ */
const TUT_TASKS = [
  { id: 'move', text: 'Move with <b>W A S D</b> — cover 12 m' },
  { id: 'jump', text: 'Jump with <b>SPACE</b>' },
  { id: 'shoot', text: 'Aim with the mouse and <b>ELIMINATE</b> a practice dummy' },
  { id: 'chest', text: 'Walk to a crate and press <b>E</b> to take a weapon' },
  { id: 'more', text: 'Eliminate 2 more dummies with your new gun' }
];

function startTutorial() {
  G.tutorial.active = true;
  G.tutorial.moved = 0;
  G.tutorial.jumps = 0;
  G.tutorial.kills = 0;
  G.tutorial.chests = 0;
  G.tutorial.tasks = TUT_TASKS.map(t => ({ id: t.id, text: t.text, done: false }));
  $('tutTasks').classList.add('show');
  renderTutorialTasks();
}

function renderTutorialTasks() {
  const cur = G.tutorial.tasks.find(t => !t.done);
  $('ttList').innerHTML = G.tutorial.tasks.map(t =>
    '<div class="tk ' + (t.done ? 'done' : (t === cur ? 'cur' : '')) + '"><span class="bx">' + (t.done ? '✓' : '') + '</span><span>' + t.text + '</span></div>'
  ).join('');
}

function completeTask(id) {
  const t = G.tutorial.tasks.find(x => x.id === id);
  if (!t || t.done) return;
  t.done = true;
  Snd.pickup();
  renderTutorialTasks();
  if (G.tutorial.tasks.every(x => x.done)) {
    setTimeout(() => {
      banner('<span class="hl">TRAINING COMPLETE</span> — you are ready. Press ESC to return to the menu.', 6);
    }, 400);
  }
}

function updateTutorialTasks() {
  const T = G.tutorial;
  if (!T.tasks) return;
  if (T.moved > 12) completeTask('move');
  if (T.jumps > 0) completeTask('jump');
  if (T.kills >= 1) completeTask('shoot');
  if (T.chests >= 1) completeTask('chest');
  if (T.kills >= 3) completeTask('more');
}

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
    if (k === '1' || k === '2' || k === '3' || k === '4') {
      const i = parseInt(k) - 1;
      if (G.player.weapons[i]) { G.player.cur = i; G.player.reloadT = 0; Snd.tone(700, 700, 0.03, 0.06, 'square'); }
    }
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
      firing = true;
      const st = G.player.weapons[G.player.cur];
      if (st && !WEAPONS[st.id].auto) tryFire(G.player);
    }
  });
  window.addEventListener('mouseup', e => {
    if (e.button === 0) firing = false;
  });

  document.addEventListener('mousemove', e => {
    if (G.state !== 'playing' || !G.player) return;
    if (!document.pointerLockElement && !e.buttons) return;
    const s = SENS_BASE * G.sensitivity * (1 - 0.45 * (VM.ads || 0));
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

function showScoreboard(on) {
  if (on && G.state === 'playing') {
    const rows = a => '<div class="sb-row"><span class="sb-n">' + (a.isPlayer ? 'YOU' : a.name) + '</span>' +
      '<span class="sb-k">' + a.kills + '</span><span class="sb-d">' + a.deaths + '</span>' +
      '<span class="sb-hp">' + (a.alive ? Math.ceil(a.hp) : '—') + '</span></div>';
    const head = '<div class="sb-row head"><span class="sb-n">OPERATOR</span><span class="sb-k">K</span><span class="sb-d">D</span><span class="sb-hp">HP</span></div>';
    const red = G.bots.concat([G.player]).filter(a => a.team === 'red');
    const blue = G.bots.filter(a => a.team === 'blue');
    $('scoreboard').innerHTML = '<div class="sb-title">' + (G.mode === 'flag' ? 'FLAG RAID' : 'TEAM DEATHMATCH') + ' · ' + DIFF[G.diff].label + '</div>' +
      '<div class="sb-team"><div class="sb-tname red">RED</div>' + head + red.map(rows).join('') + '</div>' +
      '<div class="sb-team"><div class="sb-tname blue">BLUE</div>' + head + blue.map(rows).join('') + '</div>';
    $('scoreboard').classList.add('show');
  } else {
    $('scoreboard').classList.remove('show');
  }
}

/* ------------------------------------------------------------
   GAME FLOW
   ------------------------------------------------------------ */
function startGame(mode) {
  Snd.init();
  if (Snd.ctx && Snd.ctx.state === 'suspended') Snd.ctx.resume();
  G.mode = mode;
  G.state = 'playing';
  G.timeLeft = CFG.matchTime;
  G.score.red = 0; G.score.blue = 0;
  G.tutorial.active = false;
  $('tutTasks').classList.remove('show');
  $('end').classList.remove('show');
  $('pause').classList.remove('show');
  $('menu').classList.remove('show');
  $('feed').innerHTML = '';
  $('respawn').classList.remove('show');
  $('carryBanner').classList.remove('show');
  $('objBanner').classList.remove('show');
  $('scoreboard').innerHTML = '';
  $('nameplates').innerHTML = '';

  // clear actors
  for (const b of G.bots) if (b.mesh) G._botGroup.remove(b.mesh);
  G.bots.length = 0;

  createPlayer();
  if (mode === 'tutorial') { ensureBotGroup(); spawnTutorialDummies(); }
  else createTeams();
  createChests();
  createFlags();
  for (const t of ['red', 'blue']) G.flags[t].group.visible = (mode === 'flag');

  buildRoster();
  buildMapBase();

  $('modeName').textContent = mode === 'flag' ? 'FLAG RAID' : 'TEAM DEATHMATCH';
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
  $('nameplates').innerHTML = '';
  $('scoreboard').classList.remove('show');
  if (G.flags) { G.flags.red.group.visible = false; G.flags.blue.group.visible = false; }
  for (const b of G.bots) if (b.mesh) b.mesh.visible = false;
  if (G.player) G.player.alive = false;
}

function pauseGame() {
  if (G.state !== 'playing') return;
  G.state = 'paused';
  firing = false;
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
  if (G.mode !== 'tutorial') {
    G.timeLeft -= dt;
    if (G.timeLeft <= 0) { G.timeLeft = 0; endMatch(); return; }
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
  updateChests(dt);
  updateFlags(dt);
  updateEffects(dt);
  updateHUD(dt);
  if (firing && p.alive) {
    const st = p.weapons[p.cur];
    if (st && WEAPONS[st.id].auto) tryFire(p);
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

/* ------------------------------------------------------------
   MENU / UI WIRING
   ------------------------------------------------------------ */
const HT_PAGES = [
  {
    t: 'MISSION BRIEFING',
    h: `<h3>5 v 5 · Red Team vs Blue Team</h3>
    <p>You deploy with the <span class="r">RED TEAM</span> — four AI teammates and you — against five <span class="b">BLUE</span> operators.
    The arena is a sealed white maze. There is no exit: the walls go all the way round and up.</p>
    <h4>THE MAZE</h4>
    <p><b>Level 1</b> is a 13x13 labyrinth with wide corridors and plenty of loops — you can always back out of a dead end.
    <b>Level 2</b> is a catwalk platform that runs around the entire outer edge, 4.2 m above the maze floor.
    From up there you can see the whole labyrinth and shoot down into it — but you are also the most exposed target on the map.</p>
    <p>Four stairways lead up to the catwalk, one in the middle of each side. Each team owns a wide open corner plaza:
    red in the <b>south-west</b>, blue in the <b>north-east</b>. Those plazas are your HQ, your spawn and your flag.</p>
    <h4>YOUR LOADOUT</h4>
    <p>You always start with a <span class="accent">knife</span> and a <span class="accent">pistol</span>.
    Everything else is found in crates. Pick your fights early — a pistol loses to a rifle at range.
    You have <span class="accent">140 HP</span> and regenerate out of combat, so disengaging is a real option.</p>`
  },
  {
    t: 'CONTROLS',
    h: `<table>
      <tr><th>INPUT</th><th>ACTION</th></tr>
      <tr><td><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></td><td>Move</td></tr>
      <tr><td><kbd>MOUSE</kbd></td><td>Look / aim</td></tr>
      <tr><td><kbd>LEFT CLICK</kbd></td><td>Fire (hold for automatic weapons)</td></tr>
      <tr><td><kbd>Q</kbd></td><td>Aim down sights — tighter spread, zoom, slower turn (toggle)</td></tr>
      <tr><td><kbd>R</kbd></td><td>Reload</td></tr>
      <tr><td><kbd>E</kbd></td><td>Open a weapon crate</td></tr>
      <tr><td><kbd>SHIFT</kbd></td><td>Sprint (forward)</td></tr>
      <tr><td><kbd>SPACE</kbd></td><td>Jump</td></tr>
      <tr><td><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd></td><td>Select weapon slot</td></tr>
      <tr><td><kbd>TAB</kbd></td><td>Scoreboard (kills / deaths / HP)</td></tr>
      <tr><td><kbd>ESC</kbd></td><td>Pause</td></tr>
    </table>
    <p>The mouse is captured when you click the arena. If your browser blocks it, just keep the pointer over the game window — aiming still works.</p>`
  },
  {
    t: 'WEAPONS & CRATES',
    h: `<h3>Six weapons, two of them yours from the start</h3>
    <table>
      <tr><th>WEAPON</th><th>DMG</th><th>MAG</th><th>NOTES</th></tr>
      <tr><td>Combat Knife</td><td>58</td><td>—</td><td>Always equipped, silent, 2.5 m reach</td></tr>
      <tr><td>M9 Pistol</td><td>26</td><td>12</td><td>Starting sidearm, accurate, semi-auto</td></tr>
      <tr><td>MP5 SMG</td><td>17</td><td>30</td><td>Fast full-auto, great indoors</td></tr>
      <tr><td>AK-47 Rifle</td><td>31</td><td>30</td><td>Best all-rounder</td></tr>
      <tr><td>SPAS-12</td><td>12×8</td><td>6</td><td>One-shot at close range</td></tr>
      <tr><td>AWP Sniper</td><td>115</td><td>5</td><td>Body-shot kill, punishing reload</td></tr>
    </table>
    <h4>CRATES</h4>
    <p>Eight wooden crates sit in open ground — one in each HQ plaza, four spread over maze junctions, two up on the catwalk. Every one throws a <span class="accent">column of gold light</span>
    into the air, shows a spinning gold marker, and is drawn as a gold diamond on the tactical map — you should never have to hunt for one.
    Walk up and press <kbd>E</kbd> to take the weapon inside. A used crate refills after ~26 seconds with a random gun, so camp it or beat the enemy to it.</p>
    <p><span class="accent">Headshots deal double damage</span> — the AK and AWP kill in one headshot.</p>`
  },
  {
    t: 'GAME MODES',
    h: `<h3><span class="r">TEAM DEATHMATCH</span> — 5:00</h3>
    <ul>
      <li>Every kill scores 1 point for your team.</li>
      <li>The team with the most kills when the clock hits 0:00 wins.</li>
      <li>Respawn after <b>3 seconds</b> at your base.</li>
    </ul>
    <h3><span class="b">FLAG RAID</span> — 5:00</h3>
    <ul>
      <li>Each team has a flag at its HQ: red in the <b>south-west</b> corner of the maze, blue in the <b>north-east</b>.</li>
      <li>Walk over the enemy flag to pick it up, then carry it back to your own HQ to score.</li>
      <li>You can only score while <b>your own flag is at home</b> — if yours is stolen, hunt the carrier or touch your dropped flag to return it.</li>
      <li>Dropped flags return to base after 20 seconds.</li>
      <li>The team with the most captures when the clock hits 0:00 wins.</li>
      <li>Respawn after <b>3 seconds</b>. Carriers are marked on the HUD.</li>
    </ul>`
  },
  {
    t: 'AI DIFFICULTY',
    h: `<h3>Four levels — they change aim, reaction and aggression</h3>
    <table>
      <tr><th>LEVEL</th><th>REACTION</th><th>AIM ERROR</th><th>DAMAGE</th><th>RANGE</th></tr>
      <tr><td><b>EASY</b></td><td>0.62 s</td><td>Wide</td><td>55%</td><td>24 m</td></tr>
      <tr><td><b>NORMAL</b></td><td>0.38 s</td><td>Medium</td><td>85%</td><td>32 m</td></tr>
      <tr><td><b>HARD</b></td><td>0.21 s</td><td>Tight</td><td>105%</td><td>42 m</td></tr>
      <tr><td><b>LEGEND</b></td><td>0.11 s</td><td>Very tight</td><td>125%</td><td>56 m</td></tr>
    </table>
    <p>Higher levels also strafe more, reload faster, have more HP (Hard 110 / Legend 125) and push the objective harder.</p>
    <h4>TACTICS</h4>
    <ul>
      <li>Listen for the direction of gunfire and check your teammates' HP bars — a collapsing flank shows up there first.</li>
      <li>Bots need line of sight. Break it, reload, then re-peek.</li>
      <li>On Legend, never cross an open doorway without an escape route.</li>
      <li>Grab a rifle from a crate in the first 20 seconds. The pistol will not win a 1v1 at range.</li>
    </ul>`
  }
];
let htPage = 0;
function renderHowTo() {
  $('htBody').innerHTML = HT_PAGES[htPage].h;
  $('htDots').innerHTML = HT_PAGES.map((p, i) => '<i class="' + (i === htPage ? 'on' : '') + '"></i>').join('');
  $('htPrev').style.visibility = htPage === 0 ? 'hidden' : 'visible';
  $('htNext').textContent = htPage === HT_PAGES.length - 1 ? 'GOT IT' : 'NEXT →';
}

function showTeamDesc() {
  const el = $('teamDesc');
  if (!el) return;
  const mine = G.team, foe = otherTeam(mine);
  const corner = t => t === 'red' ? 'south-west' : 'north-east';
  el.innerHTML = 'You deploy with <b style="color:' + (mine === 'red' ? '#ff6b6b' : '#7fabff') + '">' +
    teamLabel(mine) + '</b> in the ' + corner(mine) + ' plaza, alongside four AI teammates. ' +
    'Five <b style="color:' + (foe === 'red' ? '#ff6b6b' : '#7fabff') + '">' + teamLabel(foe) +
    '</b> operators hold the ' + corner(foe) + ' plaza.';
}

function initMenu() {
  document.querySelectorAll('.mode-card').forEach(el => {
    el.addEventListener('click', () => startGame(el.dataset.mode));
  });
  document.querySelectorAll('#diffRow button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#diffRow button').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      G.diff = btn.dataset.diff;
      const d = DIFF[G.diff];
      const descs = {
        easy: 'Slow reactions and loose aim. Good for learning the map.',
        normal: 'Balanced bots. They miss sometimes and react in a third of a second.',
        hard: 'Fast reactions, tight aim and better positioning. They punish wide peeks.',
        legend: 'Near-instant reactions, 125 HP and 125% damage. Treat every corner as occupied.'
      };
      $('diffDesc').textContent = descs[G.diff];
    });
  });
  document.querySelectorAll('#teamRow button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#teamRow button').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      G.team = btn.dataset.team;
      localStorage.setItem('wh_team', G.team);
      showTeamDesc();
    });
  });
  const savedTeam = localStorage.getItem('wh_team');
  if (savedTeam === 'red' || savedTeam === 'blue') {
    G.team = savedTeam;
    document.querySelectorAll('#teamRow button').forEach(b =>
      b.classList.toggle('on', b.dataset.team === savedTeam));
  }
  showTeamDesc();
  $('btnHowTo').addEventListener('click', () => {
    htPage = 0; renderHowTo(); $('howto').classList.add('show');
  });
  $('htClose').addEventListener('click', () => $('howto').classList.remove('show'));
  $('htPrev').addEventListener('click', () => { if (htPage > 0) { htPage--; renderHowTo(); } });
  $('htNext').addEventListener('click', () => {
    if (htPage < HT_PAGES.length - 1) { htPage++; renderHowTo(); }
    else $('howto').classList.remove('show');
  });
  $('btnResume').addEventListener('click', resumeGame);
  $('btnRestart').addEventListener('click', () => startGame(G.mode));
  $('btnQuit').addEventListener('click', quitToMenu);
  $('btnAgain').addEventListener('click', () => startGame(G.mode));
  $('btnMenu').addEventListener('click', quitToMenu);

  const sens = $('sens');
  const saved = parseFloat(localStorage.getItem('wh_sens') || '1');
  sens.value = saved; G.sensitivity = saved; $('sensVal').textContent = saved.toFixed(2);
  sens.addEventListener('input', () => {
    G.sensitivity = parseFloat(sens.value);
    $('sensVal').textContent = G.sensitivity.toFixed(2);
    localStorage.setItem('wh_sens', G.sensitivity);
  });

  // scoreboard element
  const sb = document.createElement('div');
  sb.id = 'scoreboard';
  $('hud').appendChild(sb);
}

/* ------------------------------------------------------------
   BOOT
   ------------------------------------------------------------ */
function boot() {
  const steps = [
    ['Booting engine…', 12],
    ['Building the arena…', 34],
    ['Placing weapon crates…', 56],
    ['Spawning operators…', 74],
    ['Warming up the bots…', 90],
    ['Ready.', 100]
  ];
  let i = 0;
  const tick = () => {
    if (i >= steps.length) {
      $('loading').classList.add('hide');
      $('menu').classList.add('show');
      setTimeout(() => $('loading').style.display = 'none', 600);
      return;
    }
    $('loadText').textContent = steps[i][0];
    $('loadFill').style.width = steps[i][1] + '%';
    i++;
    setTimeout(tick, 130 + Math.random() * 90);
  };

  initThree();
  initMaterials();
  buildWorld();
  buildViewModel();
  createFlags();
  G.flags.red.group.visible = false;
  G.flags.blue.group.visible = false;
  initInput();
  initMenu();
  scene.add(camera);
  clock = new THREE.Clock();
  G.clock = clock;
  tick();
  requestAnimationFrame(loop);
}

/* debug handle (used by the automated smoke test) */
window.__wh = {
  G, startGame, groundAt, resolveHorizontal, moveActor,
  NODES, findPath, nearestNode, planPath,
  get camera() { return camera; },
  get scene() { return scene; },
  get renderer() { return renderer; },
  teleport(x, y, z) {
    const p = G.player;
    p.pos.set(x, y, z); p.vel.set(0, 0, 0);
  },
  look(yaw, pitch) { G.player.yaw = yaw; G.player.pitch = pitch || 0; },
  simulate(seconds, step) {
    const d = step || 1 / 60;
    let t = 0;
    while (t < seconds) { update(d); t += d; }
    return { score: G.score, time: Math.round(G.timeLeft) };
  },
  hurt(n) { damage(G.player, n, null, false, 'TEST'); },
  fire() { tryFire(G.player); },
  killBot(name) {
    const b = G.bots.find(x => x.name === name);
    if (b) damage(b, 999, G.player, false, 'TEST');
  },
  /* straight-line walk probe: reports the first moment the actor leaves the arena */
  walk(x, z, dx, dz, secs, jump) {
    const p = G.player;
    p.pos.set(x, groundAt(x, z, 6), z);   // feetY 6 so the deck is found too
    p.vel.set(0, 0, 0);
    p.alive = true; p.onGround = true;
    const dt = 1 / 60, n = Math.round((secs || 2) * 60);
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len, uz = dz / len;
    for (let i = 0; i < n; i++) {
      if (jump && i % 28 === 0) p.vel.y = CFG.player.jump;
      moveActor(p, ux, uz, false, false, dt);
      if ((Math.abs(p.pos.x) > 29.75 || Math.abs(p.pos.z) > 29.75) && p.pos.y < 4.15) {
        return { out: true, x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(2), t: +(i / 60).toFixed(2) };
      }
    }
    return { out: false, x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(2) };
  },
  /* can the actor reach (tx,tz) from (sx,sz) by walking straight at it? */
  reach(sx, sz, tx, tz) {
    const p = G.player;
    let x = sx, z = sz, best = 1e9;
    for (let attempt = 0; attempt < 3; attempt++) {
      const ang = Math.atan2(-(tx - x), -(tz - z));
      const r = this.walk(x, z, Math.sin(ang), Math.cos(ang), 2.2);
      x = r.x; z = r.z;
      best = Math.min(best, Math.hypot(x - tx, z - tz));
      if (best < 1.4) return { ok: true, dist: +best.toFixed(2) };
      if (r.out) return { ok: false, dist: +best.toFixed(2), escaped: true };
    }
    return { ok: false, dist: +best.toFixed(2) };
  }
};

boot();

})();

