/* ============================================================
   80-viewmodel.js
   First-person weapon models and animation
   ============================================================ */
'use strict';

/* ------------------------------------------------------------
   VIEW MODEL (first person weapon)
   ------------------------------------------------------------ */
const VM = { group: null, models: {}, recoil: 0, recoilV: 0, kick: 0, cur: null, flash: null, ads: 0, adsTarget: 0, adsOn: false, sway: new THREE.Vector2(), holdBreath: false, breathK: 0 };

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

  /* ---------------- CROSSBOW ---------------- */
  mk('crossbow',
    { p: [0.2, -0.2, -0.46], r: [0.02, 0.1, 0.02] },
    { p: [0, -0.05, -0.42], r: [0, 0, 0] },
    grp => {
      const wood = new THREE.MeshStandardMaterial({ color: 0x6d4a26, roughness: 0.75, metalness: 0.05 });
      b(grp, 0.05, 0.055, 0.46, 0, 0, -0.16, wood);                 // stock
      b(grp, 0.058, 0.055, 0.13, 0, -0.012, 0.07, wood);            // butt
      b(grp, 0.034, 0.08, 0.055, 0, -0.072, -0.03, GM.dark, 0.22);  // grip
      b(grp, 0.42, 0.026, 0.05, 0, 0.032, -0.34, GM.steel);         // crossbar
      b(grp, 0.1, 0.022, 0.04, -0.235, 0.032, -0.36, GM.steel, 0, 0.35, 0);
      b(grp, 0.1, 0.022, 0.04, 0.235, 0.032, -0.36, GM.steel, 0, -0.35, 0);
      b(grp, 0.36, 0.005, 0.005, 0, 0.032, -0.29, GM.dark);         // string
      cyl(grp, 0.009, 0.009, 0.36, 0, 0.058, -0.26, GM.steel);      // bolt shaft
      b(grp, 0.014, 0.014, 0.06, 0, 0.058, -0.45, GM.brass);        // bolt head
      b(grp, 0.026, 0.022, 0.1, 0, 0.052, -0.06, GM.dark);          // rail
      rightHand(grp, 0.004, -0.075, 0.03, 0.24);
      leftHand(grp, -0.004, -0.02, -0.3);
    });

  /* ---------------- FIELD AID ---------------- */
  mk('aid',
    { p: [0.19, -0.21, -0.44], r: [0.05, 0.16, 0.03] },
    { p: [0, -0.06, -0.4], r: [0, 0, 0] },
    grp => {
      const white = new THREE.MeshStandardMaterial({ color: 0xeef2f4, roughness: 0.55, metalness: 0.05 });
      const red = new THREE.MeshStandardMaterial({ color: 0xc8352f, roughness: 0.6, metalness: 0.05 });
      b(grp, 0.24, 0.15, 0.16, 0, 0, 0, white);                     // case
      b(grp, 0.26, 0.028, 0.17, 0, 0.045, 0, GM.dark);              // lid seam
      b(grp, 0.13, 0.035, 0.02, 0, 0.005, -0.086, red);             // cross —
      b(grp, 0.035, 0.11, 0.02, 0, 0.005, -0.086, red);             // cross |
      b(grp, 0.07, 0.022, 0.05, 0, 0.092, 0.03, GM.dark);           // handle
      rightHand(grp, 0.1, -0.06, 0.06, 0.3);
      leftHand(grp, -0.1, -0.06, 0.06);
    });

  /* ---------------- FRAG GRENADE ---------------- */
  mk('grenade',
    { p: [0.2, -0.2, -0.44], r: [0.05, 0.12, 0.02] },
    { p: [0, -0.05, -0.4], r: [0, 0, 0] },
    grp => {
      const olive = new THREE.MeshStandardMaterial({ color: 0x3f5a3c, roughness: 0.65, metalness: 0.35 });
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 10), olive);
      ball.scale.set(1, 1.16, 1);
      grp.add(ball);
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.055, 8), GM.steel);
      neck.position.y = 0.115;
      grp.add(neck);
      b(grp, 0.048, 0.048, 0.02, 0.028, 0.145, 0, GM.dark);         // spoon
      b(grp, 0.075, 0.012, 0.012, 0, 0.03, 0, GM.steel);            // band
      rightHand(grp, 0.02, -0.03, 0.02, 0.2);
    });

  /* ---------------- AMMO BOX ---------------- */
  mk('ammo',
    { p: [0.19, -0.21, -0.44], r: [0.05, 0.15, 0.02] },
    { p: [0, -0.06, -0.4], r: [0, 0, 0] },
    grp => {
      const olive = new THREE.MeshStandardMaterial({ color: 0x4a5a3a, roughness: 0.8, metalness: 0.1 });
      b(grp, 0.24, 0.13, 0.15, 0, 0, 0, olive);
      b(grp, 0.25, 0.022, 0.16, 0, 0.05, 0, GM.brass);
      b(grp, 0.03, 0.09, 0.02, 0, -0.005, -0.078, GM.brass);
      rightHand(grp, 0.1, -0.05, 0.05, 0.3);
      leftHand(grp, -0.1, -0.05, 0.05);
    });

  /* ---------------- STIM SHOT ---------------- */
  mk('stim',
    { p: [0.19, -0.2, -0.42], r: [0.1, 0.2, -0.08] },
    { p: [0, -0.06, -0.38], r: [0, 0, 0] },
    grp => {
      const glass = new THREE.MeshStandardMaterial({ color: 0x9fe8c8, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.85 });
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.19, 10), glass);
      grp.add(tube);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.03, 10), GM.steel);
      cap.position.y = 0.11; grp.add(cap);
      const plunger = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.1, 8), GM.dark);
      plunger.position.y = 0.17; grp.add(plunger);
      const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.012, 10), GM.dark);
      flange.position.y = 0.222; grp.add(flange);
      const needle = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.001, 0.1, 6), GM.steel);
      needle.position.y = -0.145; grp.add(needle);
      rightHand(grp, 0.02, -0.02, 0.03, 0.2);
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

/* Drop the lens and give the plain crosshair back. Needed whenever the view
   stops being first person (death, pause, quit to menu): updateViewModel() is
   the only thing that draws the scope, so without this the overlay stays up
   over the bystander camera, the pause screen or the menu. */
function hideScope() {
  VM.adsOn = false;
  VM.holdBreath = false;
  VM.breathK = 0;
  VM.wasScoped = false;
  const sc = $('scope');
  if (sc) {
    sc.classList.remove('show');
    sc.style.removeProperty('--sx');
    sc.style.removeProperty('--sy');
  }
  const ch = $('crosshair');
  if (ch) ch.style.display = '';
}

function addRecoil(w) {
  VM.recoilV += 0.05 + (w.dmg / 900);
  G.player.pitch = clamp(G.player.pitch + 0.004 + Math.random() * 0.003, -1.35, 1.35);
  G.player.yaw += rand(-0.002, 0.002);
}

function swingKnife() {
  VM.kick = 1;
}

const MUZZLE = { knife: [0, 0.01, -0.36], pistol: [0, 0.035, -0.22], smg: [0, 0.025, -0.46], rifle: [0, 0.028, -0.6], shotgun: [0, 0.035, -0.68], sniper: [0, 0.03, -0.82], crossbow: [0, 0.058, -0.5] };
const ADS_FOV = { pistol: 58, smg: 55, rifle: 50, shotgun: 60, sniper: 21, knife: 74, crossbow: 50 };

function updateViewModel(dt, speed) {
  const p = G.player;
  const st = p.weapons[p.cur];
  if (!st) return;
  if (VM.cur !== st.id) setViewModel(st.id);
  const m = VM.models[st.id];
  if (!m) return;

  const w = defOf(st.id);
  if (!w) return;

  /* ADS blend — items and the crossbow have no aimed pose */
  VM.adsTarget = (VM.adsOn && !w.melee && !w.item && !w.draw) ? 1 : 0;
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

  /* the crossbow eases back into the shoulder as the draw builds */
  const drawK = (w.draw && p.drawT > 0) ? Math.min(1, p.drawT / w.draw) : 0;
  m.position.set(px - drawK * 0.02, py - drawK * 0.012, pz + drawK * 0.06);
  m.rotation.set(
    lerp(hip.r[0], ads.r[0], t) + VM.recoilV * 0.5 - VM.kick * 1.1 - reloadProg * 0.55 - drawK * 0.06,
    lerp(hip.r[1], ads.r[1], t) + VM.kick * 0.55,
    lerp(hip.r[2], ads.r[2], t) + VM.kick * 0.45
  );

  /* FOV / scope — only a weapon flagged `scope` (the sniper) gets the lens */
  const scoped = !!w.scope && VM.ads > 0.75;
  /* tutorial: count each time the lens actually comes up */
  if (scoped && !VM.wasScoped && G.tutorial.active) G.tutorial.scopes++;
  VM.wasScoped = scoped;
  const targetFov = 78 - (78 - (ADS_FOV[st.id] || 55)) * VM.ads;
  if (Math.abs(camera.fov - targetFov) > 0.15) {
    camera.fov = lerp(camera.fov, targetFov, Math.min(1, dt * 14));
    camera.updateProjectionMatrix();
  }
  const scopeEl = $('scope');
  if (scopeEl) {
    scopeEl.classList.toggle('show', scoped);
    /* scope breathing: the reticle drifts a couple of pixels while the lens is
       on a target. Cosmetic only — the shots still leave dead centre.
       Holding Q clamps down on the wobble (a held breath), and a tank that is
       nearly empty makes the aim visibly shakier. */
    const breathOk = VM.holdBreath && p.stamina > 0;
    VM.breathK = lerp(VM.breathK, scoped && breathOk ? 1 : 0, Math.min(1, dt * 9));
    if (scoped) {
      VM.scopeT = (VM.scopeT || 0) + dt;
      const t = VM.scopeT;
      const shaky = 1 + (1 - clamp(p.stamina / STAM.max, 0, 1)) * STAM.swayMax;
      const a = 2.4 * shaky * (1 - 0.92 * VM.breathK);
      scopeEl.style.setProperty('--sx', (Math.sin(t * 0.9) * a + Math.sin(t * 2.3) * a * 0.35).toFixed(2) + 'px');
      scopeEl.style.setProperty('--sy', (Math.cos(t * 0.7) * a * 0.8 + Math.sin(t * 1.9) * a * 0.3).toFixed(2) + 'px');
    } else {
      VM.scopeT = 0;
      VM.breathK = 0;
      scopeEl.style.removeProperty('--sx');
      scopeEl.style.removeProperty('--sy');
    }
  }
  /* the plain crosshair would sit on top of the reticle, so drop it in the lens */
  const chEl = $('crosshair');
  if (chEl) chEl.style.display = scoped ? 'none' : '';
  m.visible = !scoped;
  VM.flash.visible = VM.recoilV > 0.055 && !scoped && !w.item;
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

