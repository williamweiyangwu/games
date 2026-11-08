/* WHISTLE — core: utils, persistence, audio, renderer, stadium */
window.REF = window.REF || {};

/* ------------------------------------------------------------------ utils */
REF.U = {
  clamp: function (v, a, b) { return v < a ? a : (v > b ? b : v); },
  lerp: function (a, b, t) { return a + (b - a) * t; },
  damp: function (a, b, l, dt) { return a + (b - a) * (1 - Math.exp(-l * dt)); },
  rand: function (a, b) { return a + Math.random() * (b - a); },
  randInt: function (a, b) { return Math.floor(a + Math.random() * (b - a + 1)); },
  pick: function (arr) { return arr[Math.floor(Math.random() * arr.length)]; },
  chance: function (p) { return Math.random() < p; },
  distXZ: function (a, b) { var dx = a.x - b.x, dz = a.z - b.z; return Math.sqrt(dx * dx + dz * dz); },
  angleWrap: function (a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  },
  angleDamp: function (a, b, l, dt) {
    var d = REF.U.angleWrap(b - a);
    return a + d * (1 - Math.exp(-l * dt));
  },
  fmtClock: function (min) {
    var m = Math.floor(min);
    var s = Math.floor((min - m) * 60);
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  },
  lum: function (hex) {
    var c = hex.replace('#', '');
    var r = parseInt(c.substr(0, 2), 16) / 255;
    var g = parseInt(c.substr(2, 2), 16) / 255;
    var b = parseInt(c.substr(4, 2), 16) / 255;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
};

/* ------------------------------------------------------------- persistence */
REF.Save = (function () {
  var KEY = 'whistle_ref_save_v1';
  var mem = null; /* fallback when localStorage is unavailable (file:// in some browsers) */

  function defaults() {
    return {
      v: 1,
      points: 0,
      skins: { classic: true, volt: true },
      skin: 'classic',
      ach: {},
      stats: { matches: 0, whistles: 0, yellows: 0, reds: 0, goals: 0, talks: 0, offsides: 0, fouls: 0, seconds: 0 },
      talkedTo: {},
      tutorial: { done: false },
      history: [],
      tournament: null,
      tourCups: 0
    };
  }

  var api = {
    data: defaults(),

    load: function () {
      var raw = null;
      try { raw = window.localStorage.getItem(KEY); } catch (e) { raw = null; }
      if (!raw && mem) raw = mem;
      var d = defaults();
      if (raw) {
        try {
          var p = JSON.parse(raw);
          if (p && typeof p === 'object') {
            d.points = typeof p.points === 'number' ? p.points : 0;
            d.skin = p.skin || 'classic';
            if (p.skins) for (var k in p.skins) d.skins[k] = !!p.skins[k];
            if (p.ach) for (var a in p.ach) d.ach[a] = p.ach[a];
            if (p.stats) for (var s in p.stats) if (typeof p.stats[s] === 'number') d.stats[s] = p.stats[s];
            if (p.talkedTo) d.talkedTo = p.talkedTo;
            if (p.tutorial) d.tutorial = { done: !!p.tutorial.done };
            if (Array.isArray(p.history)) d.history = p.history.slice(0, 20);
            if (p.tournament && Array.isArray(p.tournament.rounds)) d.tournament = p.tournament;
            if (typeof p.tourCups === 'number') d.tourCups = p.tourCups;
          }
        } catch (e) { /* corrupted save, start clean */ }
      }
      if (!d.skins.classic) d.skins.classic = true;
      if (!d.skins.volt) d.skins.volt = true;
      if (!d.skins[d.skin]) d.skin = 'classic';
      api.data = d;
      return d;
    },

    save: function () {
      var raw = JSON.stringify(api.data);
      mem = raw;
      try { window.localStorage.setItem(KEY, raw); } catch (e) { /* ignore */ }
    },

    reset: function () {
      api.data = defaults();
      api.save();
    },

    addPoints: function (n) {
      api.data.points = Math.max(0, (api.data.points || 0) + n);
      api.save();
      return api.data.points;
    },

    stat: function (key, n) {
      var d = api.data;
      d.stats[key] = (d.stats[key] || 0) + (n === undefined ? 1 : n);
      api.save();
    },

    unlockSkin: function (id) {
      var d = api.data;
      if (d.skins[id]) return false;
      d.skins[id] = true;
      api.save();
      if (api.skinCount() >= 3) api.ach('collector');
      return true;
    },

    skinCount: function () {
      var n = 0, s = api.data.skins;
      for (var k in s) if (s[k]) n++;
      return n;
    },

    setSkin: function (id) {
      if (!api.data.skins[id]) return false;
      api.data.skin = id;
      api.save();
      return true;
    },

    ach: function (id) {
      var d = api.data;
      if (d.ach[id]) return false;
      var def = null;
      for (var i = 0; i < REF.DATA.ACH.length; i++) if (REF.DATA.ACH[i].id === id) def = REF.DATA.ACH[i];
      if (!def) return false;
      d.ach[id] = Date.now();
      d.points += def.pts;
      api.save();
      if (REF.UI && REF.UI.toast) REF.UI.toast('ACHIEVEMENT', def.name, def.pts);
      return true;
    },

    hasAch: function (id) { return !!api.data.ach[id]; }
  };

  return api;
})();

/* -------------------------------------------------------------------- audio */
REF.Audio = (function () {
  var ctx = null, master = null, noiseBuf = null, crowdGain = null, started = false;
  var enabled = true;

  function noiseBuffer() {
    if (noiseBuf || !ctx) return noiseBuf;
    var len = ctx.sampleRate * 2;
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    var last = 0;
    for (var i = 0; i < len; i++) {
      var w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.2;
    }
    noiseBuf = buf;
    return buf;
  }

  var api = {
    init: function () {
      if (ctx || !enabled) return;
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) { enabled = false; return; }
      try { ctx = new C(); } catch (e) { enabled = false; return; }
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);
    },

    resume: function () {
      api.init();
      if (ctx && ctx.state === 'suspended') ctx.resume();
    },

    crowdStart: function () {
      if (!ctx || started) return;
      started = true;
      var src = ctx.createBufferSource();
      src.buffer = noiseBuffer();
      src.loop = true;
      var lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      crowdGain = ctx.createGain();
      crowdGain.gain.value = 0.045;
      src.connect(lp); lp.connect(crowdGain); crowdGain.connect(master);
      src.start();
    },

    cheer: function (amount) {
      if (!ctx) return;
      api.crowdStart();
      if (!crowdGain) return;
      var t = ctx.currentTime;
      var peak = 0.16 + 0.22 * (amount || 1);
      crowdGain.gain.cancelScheduledValues(t);
      crowdGain.gain.setValueAtTime(crowdGain.gain.value, t);
      crowdGain.gain.linearRampToValueAtTime(peak, t + 0.35);
      crowdGain.gain.linearRampToValueAtTime(0.05, t + 3.4);
    },

    whistle: function () {
      api.init(); if (!ctx) return;
      var t = ctx.currentTime;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.32, t + 0.015);
      g.gain.setValueAtTime(0.32, t + 0.42);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.72);
      g.connect(master);

      var o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = 2380;
      var o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 2650;
      var lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 27;
      var lg = ctx.createGain(); lg.gain.value = 110;
      lfo.connect(lg); lg.connect(o1.frequency); lg.connect(o2.frequency);
      o1.connect(g); o2.connect(g);
      o1.start(t); o2.start(t); lfo.start(t);
      o1.stop(t + 0.8); o2.stop(t + 0.8); lfo.stop(t + 0.8);
    },

    card: function (red) {
      api.init(); if (!ctx) return;
      var t = ctx.currentTime;
      var o = ctx.createOscillator(); o.type = 'triangle';
      o.frequency.setValueAtTime(red ? 190 : 260, t);
      o.frequency.exponentialRampToValueAtTime(red ? 70 : 120, t + 0.22);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.22, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + 0.32);
    },

    kick: function (power) {
      api.init(); if (!ctx) return;
      var t = ctx.currentTime;
      var src = ctx.createBufferSource(); src.buffer = noiseBuffer();
      var bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
      bp.frequency.value = 320 + 500 * (power || 0.5); bp.Q.value = 1.2;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.06 + 0.12 * (power || 0.5), t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.14);
      src.connect(bp); bp.connect(g); g.connect(master);
      src.start(t); src.stop(t + 0.16);
    },

    click: function () {
      api.init(); if (!ctx) return;
      var t = ctx.currentTime;
      var o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 880;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.05, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + 0.07);
    },

    chime: function () {
      api.init(); if (!ctx) return;
      var t = ctx.currentTime;
      [523.25, 659.25, 783.99].forEach(function (f, i) {
        var o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        var g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t + i * 0.08);
        g.gain.exponentialRampToValueAtTime(0.12, t + i * 0.08 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0005, t + i * 0.08 + 0.5);
        o.connect(g); g.connect(master);
        o.start(t + i * 0.08); o.stop(t + i * 0.08 + 0.55);
      });
    }
  };
  return api;
})();

/* ------------------------------------------------------------------ engine */
REF.FIELD = { L: 105, W: 68, goalW: 7.32, goalH: 2.44, goalDepth: 2.2 };

REF.Engine = {
  renderer: null,
  scene: null,
  camera: null,
  sun: null,

  init: function () {
    var renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    try { renderer.outputColorSpace = THREE.SRGBColorSpace; } catch (e) { }
    try { renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; } catch (e) { }
    document.getElementById('stage').appendChild(renderer.domElement);

    var scene = new THREE.Scene();
    scene.background = new THREE.Color('#050a12');
    scene.fog = new THREE.Fog(0x050a12, 150, 340);

    var camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 900);
    camera.position.set(0, 18, 60);

    var hemi = new THREE.HemisphereLight(0x9fc4ff, 0x1d3320, 0.75);
    scene.add(hemi);

    var amb = new THREE.AmbientLight(0xffffff, 0.28);
    scene.add(amb);

    var sun = new THREE.DirectionalLight(0xfff4dc, 1.75);
    sun.position.set(48, 78, 34);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.left = -72;
    sun.shadow.camera.right = 72;
    sun.shadow.camera.top = 52;
    sun.shadow.camera.bottom = -52;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 240;
    sun.shadow.bias = -0.0012;
    sun.shadow.normalBias = 0.02;
    scene.add(sun);
    scene.add(sun.target);

    var fill = new THREE.DirectionalLight(0x9fc0ff, 0.42);
    fill.position.set(-50, 40, -30);
    scene.add(fill);

    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.sun = sun;

    var self = this;
    window.addEventListener('resize', function () { self.resize(); });
    return this;
  },

  resize: function () {
    if (!this.camera) return;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
};

/* --------------------------------------------------------------- stadium art */
REF.World = (function () {

  function pitchTexture() {
    var PPM = 18;
    var W = 113, H = 76;
    var c = document.createElement('canvas');
    c.width = Math.round(W * PPM);
    c.height = Math.round(H * PPM);
    var g = c.getContext('2d');

    g.fillStyle = '#1c6b33';
    g.fillRect(0, 0, c.width, c.height);

    var stripes = 18;
    for (var i = 0; i < stripes; i++) {
      g.fillStyle = i % 2 ? '#1a6230' : '#217038';
      g.fillRect(Math.floor(i * c.width / stripes), 0, Math.ceil(c.width / stripes) + 1, c.height);
    }

    var ox = (W - 105) / 2 * PPM, oy = (H - 68) / 2 * PPM;
    var X = function (m) { return ox + m * PPM; };
    var Z = function (m) { return oy + m * PPM; };

    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = Math.max(2, 0.12 * PPM);
    g.lineCap = 'butt';

    function rect(x, z, w, h) { g.strokeRect(X(x), Z(z), w * PPM, h * PPM); }
    function line(x1, z1, x2, z2) { g.beginPath(); g.moveTo(X(x1), Z(z1)); g.lineTo(X(x2), Z(z2)); g.stroke(); }
    function circle(x, z, r, fill) {
      g.beginPath(); g.arc(X(x), Z(z), r * PPM, 0, Math.PI * 2);
      if (fill) g.fill(); else g.stroke();
    }

    rect(0, 0, 105, 68);
    line(52.5, 0, 52.5, 68);
    circle(52.5, 34, 9.15);
    circle(52.5, 34, 0.22, true);

    /* penalty + goal areas both ends */
    rect(0, 34 - 20.16, 16.5, 40.32);
    rect(105 - 16.5, 34 - 20.16, 16.5, 40.32);
    rect(0, 34 - 9.16, 5.5, 18.32);
    rect(105 - 5.5, 34 - 9.16, 5.5, 18.32);

    /* penalty spots */
    circle(11, 34, 0.16, true);
    circle(94, 34, 0.16, true);

    /* arcs */
    g.beginPath(); g.arc(X(11), Z(34), 9.15 * PPM, -Math.PI / 2.6, Math.PI / 2.6); g.stroke();
    g.beginPath(); g.arc(X(94), Z(34), 9.15 * PPM, Math.PI - Math.PI / 2.6, Math.PI + Math.PI / 2.6); g.stroke();

    /* corner arcs */
    [[0, 0, 0, Math.PI / 2], [105, 0, Math.PI / 2, Math.PI],
    [105, 68, Math.PI, Math.PI * 1.5], [0, 68, Math.PI * 1.5, Math.PI * 2]].forEach(function (a) {
      g.beginPath(); g.arc(X(a[0]), Z(a[1]), 1 * PPM, a[2], a[3]); g.stroke();
    });

    var tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 8;
    try { tex.colorSpace = THREE.SRGBColorSpace; } catch (e) { }
    return tex;
  }

  function crowdTexture() {
    var c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    var g = c.getContext('2d');
    g.fillStyle = '#0b1220';
    g.fillRect(0, 0, 512, 128);
    var palette = ['#e8ecf5', '#d94b4b', '#4b6fd9', '#e8c04b', '#3fa86a', '#8e6fd9', '#e08a3f', '#c9d4e8', '#1b2436'];
    for (var row = 0; row < 10; row++) {
      for (var col = 0; col < 64; col++) {
        if (Math.random() < 0.08) continue;
        g.fillStyle = palette[Math.floor(Math.random() * palette.length)];
        g.globalAlpha = 0.5 + Math.random() * 0.5;
        g.fillRect(col * 8 + (row % 2) * 3 + Math.random() * 2, row * 12 + 4 + Math.random() * 2, 5, 6);
      }
    }
    g.globalAlpha = 1;
    var tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    try { tex.colorSpace = THREE.SRGBColorSpace; } catch (e) { }
    return tex;
  }

  function adTexture(text, bg, fg) {
    var c = document.createElement('canvas');
    c.width = 512; c.height = 64;
    var g = c.getContext('2d');
    g.fillStyle = bg;
    g.fillRect(0, 0, 512, 64);
    g.fillStyle = fg;
    g.font = 'bold 34px "Segoe UI", Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, 34);
    var tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    try { tex.colorSpace = THREE.SRGBColorSpace; } catch (e) { }
    return tex;
  }

  function netTexture() {
    var c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    var g = c.getContext('2d');
    g.clearRect(0, 0, 64, 64);
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineWidth = 1.4;
    for (var i = 0; i <= 64; i += 8) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 64); g.stroke();
      g.beginPath(); g.moveTo(0, i); g.lineTo(64, i); g.stroke();
    }
    var tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  function buildGoal(scene, sign) {
    var F = REF.FIELD;
    var g = new THREE.Group();
    var white = new THREE.MeshStandardMaterial({ color: 0xf4f7ff, roughness: 0.45, metalness: 0.1 });
    var postR = 0.065;
    var x = sign * (F.L / 2);

    [-1, 1].forEach(function (s) {
      var post = new THREE.Mesh(new THREE.CylinderGeometry(postR, postR, F.goalH, 10), white);
      post.position.set(x, F.goalH / 2, s * F.goalW / 2);
      post.castShadow = true;
      g.add(post);
    });

    var bar = new THREE.Mesh(new THREE.CylinderGeometry(postR, postR, F.goalW + postR * 2, 10), white);
    bar.rotation.x = Math.PI / 2;
    bar.position.set(x, F.goalH, 0);
    bar.castShadow = true;
    g.add(bar);

    var netMat = new THREE.MeshBasicMaterial({
      map: netTexture(), transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false
    });
    netMat.map.repeat.set(6, 3);

    var back = new THREE.Mesh(new THREE.PlaneGeometry(F.goalW, F.goalH), netMat);
    back.position.set(x + sign * F.goalDepth, F.goalH / 2, 0);
    back.rotation.y = Math.PI / 2;
    g.add(back);

    [-1, 1].forEach(function (s) {
      var side = new THREE.Mesh(new THREE.PlaneGeometry(F.goalDepth, F.goalH), netMat);
      side.position.set(x + sign * F.goalDepth / 2, F.goalH / 2, s * F.goalW / 2);
      g.add(side);
    });

    var top = new THREE.Mesh(new THREE.PlaneGeometry(F.goalDepth, F.goalW), netMat);
    top.rotation.x = Math.PI / 2;
    top.position.set(x + sign * F.goalDepth / 2, F.goalH, 0);
    g.add(top);

    scene.add(g);
    return g;
  }

  function buildStands(scene) {
    var tex = crowdTexture();
    var texLong = tex.clone();
    texLong.needsUpdate = true;
    texLong.wrapS = THREE.RepeatWrapping;
    texLong.wrapT = THREE.RepeatWrapping;
    texLong.repeat.set(14, 1);

    var texShort = tex.clone();
    texShort.needsUpdate = true;
    texShort.wrapS = THREE.RepeatWrapping;
    texShort.wrapT = THREE.RepeatWrapping;
    texShort.repeat.set(8, 1);

    var matLong = new THREE.MeshStandardMaterial({ map: texLong, roughness: 0.95, metalness: 0.05, color: 0xb9c6dd });
    var matShort = new THREE.MeshStandardMaterial({ map: texShort, roughness: 0.95, metalness: 0.05, color: 0xb9c6dd });
    var frame = new THREE.MeshStandardMaterial({ color: 0x101725, roughness: 0.9 });

    var rows = 6;
    for (var i = 0; i < rows; i++) {
      var h = 1.1 + i * 1.15;
      var dist = 40 + i * 4.6;

      var sideA = new THREE.Mesh(new THREE.BoxGeometry(120, h, 4.4), matLong);
      sideA.position.set(0, h / 2, -dist);
      sideA.receiveShadow = true;
      scene.add(sideA);

      var sideB = sideA.clone();
      sideB.position.z = dist;
      scene.add(sideB);

      var endA = new THREE.Mesh(new THREE.BoxGeometry(4.4, h, 72), matShort);
      endA.position.set(-(62 + i * 4.6), h / 2, 0);
      endA.receiveShadow = true;
      scene.add(endA);

      var endB = endA.clone();
      endB.position.x = 62 + i * 4.6;
      scene.add(endB);
    }

    /* roof ring */
    var roof = new THREE.Mesh(new THREE.BoxGeometry(150, 0.8, 150), frame);
    roof.position.set(0, 16.5, 0);
    roof.material = new THREE.MeshStandardMaterial({ color: 0x0a1018, roughness: 1, side: THREE.DoubleSide, transparent: true, opacity: 0.55 });
    scene.add(roof);

    /* ad boards */
    var ads = [
      ['WILLIAM\'S ARCADE', '#0e1420', '#ffd75e'],
      ['WHISTLE — REF SIM', '#101a12', '#8ef05a'],
      ['PLAY MORE GAMES', '#140f1c', '#c8b6ff'],
      ['FAIR PLAY', '#1a0f10', '#ff9d9d']
    ];
    for (var s = 0; s < 4; s++) {
      var a = ads[s];
      var tex2 = adTexture(a[0], a[1], a[2]);
      var m = new THREE.MeshBasicMaterial({ map: tex2 });
      m.map.repeat.set(6, 1);
      var board = new THREE.Mesh(new THREE.BoxGeometry(112, 1.15, 0.3), m);
      if (s < 2) {
        board.position.set(0, 0.6, s === 0 ? -37.2 : 37.2);
        if (s === 1) board.rotation.y = Math.PI;
      } else {
        board.position.set(s === 2 ? -56 : 56, 0.6, 0);
        board.rotation.y = Math.PI / 2;
        board.scale.x = 0.6;
      }
      scene.add(board);
    }
  }

  function buildFloodlights(scene) {
    var poleMat = new THREE.MeshStandardMaterial({ color: 0x1b2434, roughness: 0.7, metalness: 0.5 });
    var lampMat = new THREE.MeshStandardMaterial({
      color: 0xfff8e0, emissive: 0xfff3cc, emissiveIntensity: 1.5, roughness: 0.3
    });
    [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(function (p) {
      var g = new THREE.Group();
      var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 30, 8), poleMat);
      pole.position.y = 15;
      g.add(pole);
      var rig = new THREE.Mesh(new THREE.BoxGeometry(7.5, 3.2, 0.6), poleMat);
      rig.position.set(0, 30.4, 0);
      g.add(rig);
      for (var i = 0; i < 3; i++) {
        for (var j = 0; j < 2; j++) {
          var lamp = new THREE.Mesh(new THREE.BoxGeometry(2, 0.9, 0.2), lampMat);
          lamp.position.set(-2.4 + i * 2.4, 29.7 + j * 1.3, 0.4);
          g.add(lamp);
        }
      }
      g.position.set(p[0] * 66, 0, p[1] * 46);
      scene.add(g);
    });
  }

  function buildBall(scene) {
    var c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    var g = c.getContext('2d');
    g.fillStyle = '#f7f9ff';
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#14181f';
    var spots = [[32, 30], [96, 22], [160, 34], [224, 26], [64, 74], [128, 82], [196, 76], [16, 96], [240, 92]];
    spots.forEach(function (s) {
      g.beginPath();
      for (var i = 0; i < 5; i++) {
        var a = -Math.PI / 2 + i * Math.PI * 2 / 5;
        var px = s[0] + Math.cos(a) * 13, py = s[1] + Math.sin(a) * 13;
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.closePath(); g.fill();
    });
    var tex = new THREE.CanvasTexture(c);
    try { tex.colorSpace = THREE.SRGBColorSpace; } catch (e) { }

    var mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 20, 14),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.02 })
    );
    mesh.castShadow = true;
    scene.add(mesh);
    return mesh;
  }

  return {
    build: function (scene) {
      /* outfield */
      var surround = new THREE.Mesh(
        new THREE.PlaneGeometry(340, 340),
        new THREE.MeshStandardMaterial({ color: 0x0d1a12, roughness: 1 })
      );
      surround.rotation.x = -Math.PI / 2;
      surround.position.y = -0.02;
      surround.receiveShadow = true;
      scene.add(surround);

      /* pitch */
      var pitch = new THREE.Mesh(
        new THREE.PlaneGeometry(113, 76),
        new THREE.MeshStandardMaterial({ map: pitchTexture(), roughness: 0.95, metalness: 0 })
      );
      pitch.rotation.x = -Math.PI / 2;
      pitch.receiveShadow = true;
      scene.add(pitch);

      buildStands(scene);
      buildFloodlights(scene);
      buildGoal(scene, 1);
      buildGoal(scene, -1);

      /* corner flags */
      var flagMat = new THREE.MeshStandardMaterial({ color: 0xffd75e, side: THREE.DoubleSide, emissive: 0x553f00 });
      var poleMat = new THREE.MeshStandardMaterial({ color: 0xdddddd });
      [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(function (p) {
        var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.6, 6), poleMat);
        pole.position.set(p[0] * 52.5, 0.8, p[1] * 34);
        scene.add(pole);
        var flag = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.32), flagMat);
        flag.position.set(p[0] * 52.5 + 0.22, 1.45, p[1] * 34);
        scene.add(flag);
      });

      return { ball: buildBall(scene) };
    }
  };
})();
