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
  mode: 'tdm', diff: 'normal', team: 'red', state: 'menu',
  colliders: [], ramps: [], bots: [], chests: [], flags: null,
  player: null, tracers: [], particles: [], projectiles: [], blasts: [],
  shake: 0, aimLine: null, aimPts: null,
  timeLeft: CFG.matchTime, score: { red: 0, blue: 0 },
  sensitivity: 1, t: 0,
  /* death cam: who killed you, and where you fell */
  killer: null, killerWeapon: '', deathPos: new THREE.Vector3(0, 0, 0), deathYaw: 0,
  flagState: { red: { at:'base', carrier:null, dropT:0, pos:new THREE.Vector3(0,0,30) },
               blue:{ at:'base', carrier:null, dropT:0, pos:new THREE.Vector3(0,0,-30) } },
  tutorial: { active:false, tasks:[], step:0 }
};

let renderer, scene, camera, clock = null;
const V3 = THREE.Vector3;

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

