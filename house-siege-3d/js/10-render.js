/* ============================================================
   10-render.js
   Renderer, scene, camera, procedural textures and materials
   ============================================================ */
'use strict';

/* ------------------------------------------------------------
   RENDERER / SCENE
   ------------------------------------------------------------ */
const G = {
  scene: null, camera: null, renderer: null, clock: null,
  mode: 'tdm', mapId: 'white', diff: 'normal', team: 'red', state: 'menu',
  /* online: netMode turns on remote-player sync, netAi decides whether this
     machine also simulates a bot squad */
  netMode: false, netAi: false,
  colliders: [], ramps: [], bots: [], chests: [], flags: null,
  player: null, tracers: [], particles: [], projectiles: [], blasts: [],
  shake: 0, aimLine: null, aimPts: null,
  timeLeft: CFG.matchTime, score: { red: 0, blue: 0 },
  /* sudden death after a level full-time score: the next kill (TDM) or the
     next capture (flag) decides the match */
  golden: false,
  sensitivity: 1, t: 0,
  /* death cam: who killed you, and where you fell */
  killer: null, killerWeapon: '', deathPos: new THREE.Vector3(0, 0, 0), deathYaw: 0,
  flagState: { red: { at:'base', carrier:null, dropT:0, pos:new THREE.Vector3(0,0,30) },
               blue:{ at:'base', carrier:null, dropT:0, pos:new THREE.Vector3(0,0,-30) } },
  tutorial: { active:false, tasks:[], step:0, moved:0, jumps:0, kills:0, chests:0,
              sprintT:0, wheels:0, scopes:0, breathT:0 }
};

let renderer, scene, camera, clock = null;
const V3 = THREE.Vector3;

/* ------------------------------------------------------------
   PERFORMANCE GOVERNOR
   A laptop panel at 150-200% Windows scaling gives devicePixelRatio 1.5-2,
   so "full resolution" here is four times the pixels of a 1080p window, with
   soft shadows on top. When that lands at 20 fps the mouse does not feel
   slow, it feels like the view snaps between angles, because each frame
   applies 50 ms worth of turn in one step.
   PERF.scale is the resolution multiplier the governor trades away: it only
   ever steps DOWN inside a match (stepping back up oscillates, and each step
   resizes the canvas), and it is reset to 1 when a new match starts.
   ------------------------------------------------------------ */
const PERF = {
  base: 1,        // min(devicePixelRatio, 1.5) — the most we will ever ask for
  scale: 1,       // 1 -> 0.55, the part the governor can take back
  min: 0.55,
  fps: 0, ms: 0,
  frames: 0, time: 0, cooldown: 0, warm: 0,
  level: 0,       // 0 full, 1 shadows off, 2 shadows off + minimum resolution
  show: false
};

function perfApply() {
  if (!renderer) return;
  const r = PERF.base * PERF.scale;
  renderer.setPixelRatio(Math.max(0.5, Math.round(r * 100) / 100));
  renderer.setSize(window.innerWidth, window.innerHeight);
}

/* Materials in MAT are shared by hundreds of meshes; a per-object material is
   owned by that object alone. Disposing a shared one would blank every wall
   that still uses it, so the helper below skips them. */
const SHARED_MATS = new Set();
function registerSharedMaterials() {
  for (const k in MAT) SHARED_MATS.add(MAT[k]);
}

/* Remove an object and everything under it, freeing the GPU buffers it owns.
   Called whenever a match rebuilds the props (crates, flags, bot bodies). */
function disposeTree(obj) {
  if (!obj) return;
  scene.remove(obj);
  obj.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    const m = o.material;
    if (!m) return;
    const list = Array.isArray(m) ? m : [m];
    for (const mm of list) {
      if (!mm || SHARED_MATS.has(mm)) continue;
      if (mm.map) mm.map.dispose();
      mm.dispose();
    }
  });
}

function initThree() {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  /* 1.5 rather than 2: above that the extra pixels are invisible at arm's
     length on a laptop and cost a quarter of the frame budget each step. */
  PERF.base = Math.min(window.devicePixelRatio || 1, 1.5);
  perfApply();
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
  G.hemi = hemi;

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
    perfApply();
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

/* ------------------------------------------------------------
   OUTDOOR SURFACES
   ------------------------------------------------------------
   The three nature maps do not share one green texture: a hedge wall, a pine
   ridge and a sandstone canyon have to be told apart at a glance from across
   the arena, which is the same reason the indoor palettes separate walls from
   floors.

   Two rules govern everything here, and both were learned the hard way:

   1. FEATURES ARE DRAWN AT WORLD SCALE. One UV unit is 2.2 m (boxUV), so a
      texture is a 2.2 m square of ground or wall. Anything smaller than about
      three pixels is invisible at fighting distance — an earlier pass drew
      1 cm speckles and the result was a flat varnished slab. Bedding planes,
      leaf clumps and pebbles are all 2-25 cm here.

   2. EVERYTHING WRAPS. These textures tile every 2.2 m, and a feature cut off
      at the canvas edge shows up as a hard line across the floor, which reads
      as a tiled bathroom rather than as ground. Blobs are drawn up to four
      times at the wrapped offsets so the tile has no visible seam.
   ------------------------------------------------------------ */
function wrapBlob(g, s, x, y, r, draw) {
  for (let ox = -1; ox <= 1; ox++) {
    for (let oy = -1; oy <= 1; oy++) {
      const px = x + ox * s, py = y + oy * s;
      if (px + r < 0 || px - r > s || py + r < 0 || py - r > s) continue;
      draw(px, py);
    }
  }
}

function texLeaves(base, dark, rep) {
  return makeTex(256, (g, s) => {
    /* the gaps between leaves are the shadow inside the hedge */
    g.fillStyle = dark; g.fillRect(0, 0, s, s);
    const cols = [base, '#6f8f45', '#7f9a4a', '#5c7a3c', '#435c2c', '#8fae5c'];
    for (let i = 0; i < 520; i++) {
      const x = Math.random() * s, y = Math.random() * s;
      const r = 3 + Math.random() * 9;
      const col = cols[i % cols.length];
      const a = 0.6 + Math.random() * 0.4;
      const rot = Math.random() * 3.14;
      wrapBlob(g, s, x, y, r, (px, py) => {
        g.globalAlpha = a; g.fillStyle = col;
        g.save();
        g.translate(px, py); g.rotate(rot);
        g.beginPath();
        if (g.ellipse) g.ellipse(0, 0, r, r * 0.5, 0, 0, 7);
        else g.arc(0, 0, r * 0.7, 0, 7);
        g.fill();
        g.restore();
      });
    }
    g.globalAlpha = 1;
    grain(g, s, 10, false);
  }, rep || 2, rep || 2);
}

function texBark(base, dark, rep) {
  return makeTex(128, (g, s) => {
    g.fillStyle = base; g.fillRect(0, 0, s, s);
    /* vertical plates, not brush strokes: bark reads by its edges */
    for (let i = 0; i < 120; i++) {
      g.strokeStyle = Math.random() < 0.55 ? dark : 'rgba(255,255,255,.13)';
      g.lineWidth = 0.8 + Math.random() * 2.6;
      const x = Math.random() * s;
      g.beginPath();
      g.moveTo(x, -2);
      g.bezierCurveTo(x + 9, s * 0.34, x - 9, s * 0.66, x + 3, s + 2);
      g.stroke();
    }
    for (let i = 0; i < 40; i++) {
      g.fillStyle = 'rgba(0,0,0,.22)';
      g.fillRect(Math.random() * s, Math.random() * s, 1.5 + Math.random() * 3, 6 + Math.random() * 22);
    }
    grain(g, s, 12, false);
  }, rep || 1, (rep || 1) * 3);
}

/* `strata` is the difference between a grey ridge and a sandstone canyon:
   bedding planes with a dark seam under each bed, not just noise. */
function texRock(base, dark, strata, rep) {
  return makeTex(256, (g, s) => {
    g.fillStyle = base; g.fillRect(0, 0, s, s);
    if (strata) {
      /* Beds of 20-50 cm. Two earlier passes both failed here, in opposite
         directions: the first drew a hard black line every 8 cm (varnished
         planks), the second drew full-width bands plus a random vertical
         joint inside each one — and a horizontal band with a vertical cut in
         it is exactly a brick. Both mistakes are structural, so the fix is
         structural too:

         - no vertical joints at all. Bedding planes are continuous; the only
           vertical marks on a cliff are cracks, and those are drawn later.
         - the boundary between beds WAVES. A dead-straight line across the
           whole tile is the tell of masonry, so each boundary is a low
           sine with its own phase and amplitude.
         - the wave closes on itself (one full period across the tile), and
           bed heights are normalised to sum to exactly `s`, so the tile
           still wraps in both axes. */
      const heights = [];
      let total = 0;
      while (total < s) {
        const h = 20 + Math.random() * 30;
        heights.push(h); total += h;
      }
      const k = s / total;
      let y = 0;
      const wave = (yy, ph, amp, t) => yy + Math.sin(ph + t * 6.2832) * amp;
      for (let i = 0; i < heights.length; i++) {
        const h = heights[i] * k;
        const ph = Math.random() * 6.2832;
        const amp = 1.5 + Math.random() * 3.5;
        const steps = 10;
        /* fill the bed, top boundary wavy, bottom boundary wavy the other way */
        g.beginPath();
        g.moveTo(0, wave(y, ph, amp, 0));
        for (let n = 1; n <= steps; n++) g.lineTo(n / steps * s, wave(y, ph, amp, n / steps));
        for (let n = steps; n >= 0; n--) g.lineTo(n / steps * s, wave(y + h, ph + 2.1, amp, n / steps));
        g.closePath();
        g.globalAlpha = 0.05 + Math.random() * 0.13;
        g.fillStyle = Math.random() < 0.5 ? dark : '#ffffff';
        g.fill();
        /* a thin shadow sits under the bed, not a black gap */
        g.globalAlpha = 0.10 + Math.random() * 0.10;
        g.strokeStyle = '#000';
        g.lineWidth = 1.2 + Math.random() * 1.4;
        g.beginPath();
        g.moveTo(0, wave(y, ph, amp, 0));
        for (let n = 1; n <= steps; n++) g.lineTo(n / steps * s, wave(y, ph, amp, n / steps));
        g.stroke();
        y += h;
      }
      /* cross-bedding: short diagonal sweeps, the one pattern sandstone has
         that brickwork never does. Very low alpha, they only read as sheen. */
      g.globalAlpha = 0.07;
      g.strokeStyle = '#fff';
      for (let i = 0; i < 26; i++) {
        const x0 = Math.random() * s, y0 = Math.random() * s;
        const a = -0.34 + (Math.random() - 0.5) * 0.18;
        const l = 30 + Math.random() * 70;
        g.lineWidth = 3 + Math.random() * 5;
        g.beginPath();
        g.moveTo(x0, y0);
        g.quadraticCurveTo(x0 + l * 0.5, y0 + Math.sin(a) * l * 0.5 + 3, x0 + l, y0 + Math.sin(a) * l);
        g.stroke();
      }
      g.globalAlpha = 1;
    }
    /* mottling. These started as sharp triangles, which at 10% alpha still
       read as angular graffiti on a flat wall; broad soft blobs do the job
       (breaking up the base colour) without drawing an edge the eye can
       follow. */
    for (let i = 0; i < 70; i++) {
      const x = Math.random() * s, y = Math.random() * s, r = 18 + Math.random() * 46;
      const light = Math.random() < 0.5;
      wrapBlob(g, s, x, y, r, (px, py) => {
        const grd = g.createRadialGradient(px, py, 0, px, py, r);
        grd.addColorStop(0, light ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.12)');
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd;
        g.beginPath(); g.arc(px, py, r, 0, 7); g.fill();
      });
    }
    /* cracks: they run in ONE direction with a slight wander, and stay short.
       Random walks in both axes drew star-shaped scribbles that looked like
       graffiti, and full-height cracks turned the wall back into panels. */
    for (let i = 0; i < 10; i++) {
      let x = Math.random() * s, y = Math.random() * s;
      const dir = Math.PI / 2 + (Math.random() - 0.5) * 0.5;
      g.beginPath(); g.moveTo(x, y);
      for (let n = 0; n < 4; n++) {
        const a = dir + (Math.random() - 0.5) * 0.4;
        const l = 9 + Math.random() * 14;
        x += Math.cos(a) * l; y += Math.sin(a) * l;
        g.lineTo(x, y);
      }
      g.strokeStyle = 'rgba(0,0,0,.16)'; g.lineWidth = 1.1; g.stroke();
      g.strokeStyle = 'rgba(255,255,255,.06)'; g.lineWidth = 0.6; g.stroke();
    }
    grain(g, s, 13, false);
  }, rep || 1, rep || 1);
}

/* leaf litter and bare earth under a canopy */
function texForestFloor(base, dark, rep) {
  return makeTex(512, (g, s) => {
    g.fillStyle = base; g.fillRect(0, 0, s, s);
    /* drifts of moss and bare soil, 20-50 cm across */
    for (let i = 0; i < 46; i++) {
      const x = Math.random() * s, y = Math.random() * s, r = 34 + Math.random() * 96;
      const light = Math.random() < 0.45;
      wrapBlob(g, s, x, y, r, (px, py) => {
        const grd = g.createRadialGradient(px, py, 0, px, py, r);
        grd.addColorStop(0, light ? 'rgba(140,160,90,.30)' : 'rgba(40,34,20,.30)');
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd;
        g.beginPath(); g.arc(px, py, r, 0, 7); g.fill();
      });
    }
    /* fallen leaves */
    for (let i = 0; i < 260; i++) {
      const x = Math.random() * s, y = Math.random() * s, r = 3 + Math.random() * 6;
      const col = ['#6f5730', '#5c6642', '#7a6236', '#414a2e'][i % 4];
      const rot = Math.random() * 3.14;
      wrapBlob(g, s, x, y, r, (px, py) => {
        g.globalAlpha = 0.45;
        g.fillStyle = col;
        g.save(); g.translate(px, py); g.rotate(rot);
        g.beginPath(); g.ellipse(0, 0, r, r * 0.45, 0, 0, 7); g.fill();
        g.restore();
      });
    }
    g.globalAlpha = 1;
    /* twigs */
    for (let i = 0; i < 220; i++) {
      g.strokeStyle = ['#6b5836', '#3c452c'][i % 2];
      g.lineWidth = 1 + Math.random();
      const x = Math.random() * s, y = Math.random() * s;
      const a = Math.random() * 6.28, l = 6 + Math.random() * 16;
      g.beginPath(); g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    }
    grain(g, s, 9, false);
  }, rep || 60, rep || 60);
}

/* wind-rippled dust */
function texSand(base, dark, rep) {
  return makeTex(512, (g, s) => {
    g.fillStyle = base; g.fillRect(0, 0, s, s);
    /* broad drifts */
    for (let i = 0; i < 24; i++) {
      const x = Math.random() * s, y = Math.random() * s, r = 70 + Math.random() * 130;
      const light = Math.random() < 0.5;
      wrapBlob(g, s, x, y, r, (px, py) => {
        const grd = g.createRadialGradient(px, py, 0, px, py, r);
        grd.addColorStop(0, light ? 'rgba(255,240,214,.20)' : 'rgba(96,58,32,.18)');
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd;
        g.beginPath(); g.arc(px, py, r, 0, 7); g.fill();
      });
    }
    /* Ripples. Drawn as one unbroken bezier across the whole tile they read
       as brushed wood — long parallel lines are a grain, not a ripple. Real
       wind ripples are made of short crests with gaps between them, and the
       crest line drifts, so each one is laid down as a run of dashes that
       wander together. */
    for (let i = 0; i < 26; i++) {
      const y0 = Math.random() * s;
      const amp = 5 + Math.random() * 9;
      const ph = Math.random() * 6.2832;
      const freq = 1 + Math.floor(Math.random() * 3);
      /* kept faint on purpose: at a shallow camera angle a long ripple is a
         grain line, and even broken into dashes these turn the floor into
         brushed wood if they carry any contrast */
      g.strokeStyle = Math.random() < 0.6 ? 'rgba(0,0,0,.045)' : 'rgba(255,255,255,.065)';
      g.lineWidth = 1 + Math.random() * 1.5;
      for (const oy of [-s, 0, s]) {
        /* walk left to right in dash lengths, leaving gaps at random */
        let x = Math.random() * 40;
        while (x < s) {
          const len = 18 + Math.random() * 32;
          g.beginPath();
          for (let n = 0; n <= 6; n++) {
            const t = (x + len * n / 6) / s;
            const yy = y0 + oy + Math.sin(ph + t * 6.2832 * freq) * amp;
            if (n === 0) g.moveTo(x + len * n / 6, yy); else g.lineTo(x + len * n / 6, yy);
          }
          g.stroke();
          x += len + 16 + Math.random() * 70;
        }
      }
    }
    /* grit. 520 specks at this contrast read as exposed aggregate — sand is a
       texture, not a gravel path, so there are fewer of them and they are
       closer to the base tone. */
    for (let i = 0; i < 300; i++) {
      const x = Math.random() * s, y = Math.random() * s, r = 0.7 + Math.random() * 2.2;
      g.fillStyle = Math.random() < 0.5 ? 'rgba(70,44,24,.16)' : 'rgba(255,238,210,.18)';
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    grain(g, s, 9, false);
  }, rep || 60, rep || 60);
}

/* cactus skin: the ribs are what make a green column read as a cactus */
function texRibs(base, dark, rep) {
  return makeTex(128, (g, s) => {
    g.fillStyle = base; g.fillRect(0, 0, s, s);
    const ribs = 8, w = s / ribs;
    for (let i = 0; i < ribs; i++) {
      const x = i * w;
      const grd = g.createLinearGradient(x, 0, x + w, 0);
      grd.addColorStop(0, 'rgba(0,0,0,.40)');
      grd.addColorStop(0.3, 'rgba(255,255,255,.12)');
      grd.addColorStop(0.72, 'rgba(0,0,0,.12)');
      grd.addColorStop(1, 'rgba(0,0,0,.40)');
      g.fillStyle = grd;
      g.fillRect(x, 0, w, s);
      for (let y = 0; y < s; y += 5) {
        g.fillStyle = 'rgba(232,232,196,.5)';
        g.fillRect(x + w * 0.44, y + Math.random() * 2, 1.1, 2);
      }
    }
    grain(g, s, 7, false);
  }, rep || 2, 1);
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
  MAT.ground   = new THREE.MeshStandardMaterial({ map: texGrass(), roughness: 0.99, metalness: 0 });
  MAT.rail     = new THREE.MeshStandardMaterial({ color: 0x565d66, roughness: 0.42, metalness: 0.6 });
  MAT.wood     = new THREE.MeshStandardMaterial({ map: texPlanks('#7d5230', '#4c2f19', 1), roughness: 0.8, metalness: 0.03 });
  MAT.woodDark = new THREE.MeshStandardMaterial({ color: 0x4a2f1c, roughness: 0.86, metalness: 0.03 });
  MAT.gold     = new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.3, metalness: 0.9 });
  MAT.metal    = new THREE.MeshStandardMaterial({ color: 0x3b4048, roughness: 0.42, metalness: 0.85 });
  MAT.base     = new THREE.MeshStandardMaterial({ color: 0xcfc9bd, roughness: 0.72, metalness: 0.04 });
  MAT.pad      = new THREE.MeshStandardMaterial({ color: 0x93918a, roughness: 0.93, metalness: 0.03, map: texTiles('#9c9a92', '#86847c', 4) });

  /* --- white maze --- */
  MAT.mazeWall = new THREE.MeshStandardMaterial({ map: texPlaster('#e7e4dc', '#c6c1b5'), roughness: 0.94, metalness: 0.02 });
  MAT.mazeFloor= new THREE.MeshStandardMaterial({ map: texTiles('#e6e4dd', '#c3c0b6', 6), roughness: 0.62, metalness: 0.05 });
  MAT.deck     = new THREE.MeshStandardMaterial({ map: texTiles('#b9bcc0', '#8f9296', 5), roughness: 0.5, metalness: 0.35 });
  MAT.deckEdge = new THREE.MeshStandardMaterial({ color: 0x6e7278, roughness: 0.42, metalness: 0.6 });

  registerSharedMaterials();
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

