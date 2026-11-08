/* WHISTLE — actors: low-poly rigs + procedural animation */
window.REF = window.REF || {};

REF.Actors = (function () {
  var U = REF.U;

  var SKIN_TONES = ['#f0c9a4', '#e2b28c', '#c98d63', '#a76a41', '#7d4c2c', '#f6d6b8'];
  var HAIR_TONES = ['#1a1410', '#2a1c12', '#0f0f10', '#4a3520', '#7a5a2e', '#c9a35e'];

  function shirtTexture(shirt, shirt2) {
    var c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    var g = c.getContext('2d');
    g.fillStyle = shirt;
    g.fillRect(0, 0, 64, 64);
    if (shirt2) {
      g.fillStyle = shirt2;
      for (var i = 0; i < 4; i++) g.fillRect(i * 16 + 8, 0, 8, 64);
    }
    var tex = new THREE.CanvasTexture(c);
    try { tex.colorSpace = THREE.SRGBColorSpace; } catch (e) { }
    return tex;
  }

  function mat(color, rough) {
    return new THREE.MeshStandardMaterial({ color: color, roughness: rough === undefined ? 0.82 : rough, metalness: 0.03 });
  }

  function box(w, h, d, material) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.castShadow = true;
    m.receiveShadow = false;
    return m;
  }

  function create(opts) {
    opts = opts || {};
    var skinTone = opts.skin || U.pick(SKIN_TONES);
    var hairTone = opts.hair || U.pick(HAIR_TONES);

    var shirtCanvasMat = new THREE.MeshStandardMaterial({
      map: shirtTexture(opts.shirt || '#dddddd', opts.shirt2 || null),
      roughness: 0.85, metalness: 0.02
    });
    var shortsMat = mat(opts.shorts || '#111111');
    var socksMat = mat(opts.socks || opts.shorts || '#111111');
    var skinMat = mat(skinTone, 0.75);
    var hairMat = mat(hairTone, 0.9);
    var bootMat = mat('#0d0f13', 0.6);

    var root = new THREE.Group();
    var body = new THREE.Group();       /* vertical offset: jump / hop / fall */
    var pivot = new THREE.Group();      /* rotation offset: falling over */
    root.add(body);
    body.add(pivot);

    var hips = new THREE.Group();
    hips.position.y = 0.88;
    pivot.add(hips);

    /* torso */
    var torso = box(0.5, 0.6, 0.27, shirtCanvasMat);
    torso.position.y = 0.3;
    hips.add(torso);

    /* sleeves */
    var sleeveL = box(0.14, 0.14, 0.22, shirtCanvasMat);
    sleeveL.position.set(-0.28, 0.52, 0);
    hips.add(sleeveL);
    var sleeveR = sleeveL.clone();
    sleeveR.position.x = 0.28;
    hips.add(sleeveR);

    /* shorts */
    var shorts = box(0.46, 0.24, 0.28, shortsMat);
    shorts.position.y = -0.06;
    hips.add(shorts);

    /* head */
    var head = new THREE.Group();
    head.position.y = 0.66;
    hips.add(head);

    var skull = new THREE.Mesh(new THREE.SphereGeometry(0.135, 14, 12), skinMat);
    skull.position.y = 0.11;
    skull.scale.set(0.95, 1.05, 0.95);
    skull.castShadow = true;
    head.add(skull);

    var hair = new THREE.Mesh(new THREE.SphereGeometry(0.138, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat);
    hair.position.y = 0.125;
    hair.castShadow = true;
    head.add(hair);

    var neck = box(0.11, 0.08, 0.11, skinMat);
    neck.position.y = -0.02;
    head.add(neck);

    /* arms */
    function arm(side) {
      var g = new THREE.Group();
      g.position.set(side * 0.29, 0.5, 0);
      var upper = box(0.115, 0.42, 0.115, skinMat);
      upper.position.y = -0.21;
      g.add(upper);
      var fore = box(0.1, 0.24, 0.1, skinMat);
      fore.position.y = -0.5;
      g.add(fore);
      var hand = box(0.1, 0.1, 0.09, skinMat);
      hand.position.y = -0.64;
      g.add(hand);
      hips.add(g);
      return g;
    }
    var armL = arm(-1);
    var armR = arm(1);

    /* legs */
    function leg(side) {
      var g = new THREE.Group();
      g.position.set(side * 0.13, 0, 0);
      var thigh = box(0.155, 0.44, 0.16, shortsMat);
      thigh.position.y = -0.22;
      g.add(thigh);
      var shin = box(0.135, 0.4, 0.14, skinMat);
      shin.position.y = -0.62;
      g.add(shin);
      var sock = box(0.14, 0.16, 0.145, socksMat);
      sock.position.y = -0.74;
      g.add(sock);
      var boot = box(0.16, 0.09, 0.28, bootMat);
      boot.position.set(0, -0.84, 0.05);
      g.add(boot);
      hips.add(g);
      return g;
    }
    var legL = leg(-1);
    var legR = leg(1);

    var parts = {
      root: root, body: body, pivot: pivot, hips: hips, head: head,
      armL: armL, armR: armR, legL: legL, legR: legR,
      torso: torso, shorts: shorts, sleeveL: sleeveL, sleeveR: sleeveR,
      shirtMat: shirtCanvasMat, shortsMat: shortsMat, socksMat: socksMat
    };

    /* referee props */
    if (opts.ref) {
      var cardY = new THREE.Mesh(
        new THREE.PlaneGeometry(0.13, 0.18),
        new THREE.MeshBasicMaterial({ color: 0xffd23f, side: THREE.DoubleSide })
      );
      cardY.position.set(0, -0.66, 0.09);
      cardY.rotation.x = -0.2;
      cardY.visible = false;
      armR.add(cardY);

      var cardR = new THREE.Mesh(
        new THREE.PlaneGeometry(0.13, 0.18),
        new THREE.MeshBasicMaterial({ color: 0xff3b3b, side: THREE.DoubleSide })
      );
      cardR.position.set(0, -0.66, 0.09);
      cardR.rotation.x = -0.2;
      cardR.visible = false;
      armR.add(cardR);

      var whistleMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.05, 0.1),
        new THREE.MeshStandardMaterial({ color: 0xffc400, roughness: 0.4, metalness: 0.6 })
      );
      whistleMesh.position.set(0, -0.7, 0.02);
      whistleMesh.visible = false;
      armR.add(whistleMesh);

      parts.cardY = cardY;
      parts.cardR = cardR;
      parts.whistle = whistleMesh;
    }

    /* soft contact shadow */
    var shadowTex = (function () {
      var c = document.createElement('canvas');
      c.width = 64; c.height = 64;
      var g = c.getContext('2d');
      var grd = g.createRadialGradient(32, 32, 2, 32, 32, 30);
      grd.addColorStop(0, 'rgba(0,0,0,0.55)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();
    var blob = new THREE.Mesh(
      new THREE.PlaneGeometry(1.3, 1.3),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.55 })
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.015;
    root.add(blob);
    parts.blob = blob;

    var ch = {
      group: root,
      parts: parts,
      state: 'idle',
      phase: 0,
      animSpeed: 0,
      blink: 0
    };

    ch.paintShirt = function (shirt, shirt2) {
      if (parts.shirtMat.map) parts.shirtMat.map.dispose();
      parts.shirtMat.map = shirtTexture(shirt, shirt2);
      parts.shirtMat.needsUpdate = true;
    };

    ch.setKit = function (kit) {
      ch.paintShirt(kit.shirt, kit.shirt2 || null);
      parts.shortsMat.color.set(kit.shorts);
      parts.socksMat.color.set(kit.socks);
      parts.sleeveL.material = parts.shirtMat;
      parts.sleeveR.material = parts.shirtMat;
    };

    return ch;
  }

  /* ------------------------------------------------------------ animation */
  function dampTo(obj, axis, target, lambda, dt) {
    obj.rotation[axis] = U.damp(obj.rotation[axis], target, lambda, dt);
  }

  function animate(ch, dt, time) {
    var p = ch.parts;
    var spd = ch.animSpeed || 0;
    var amp = Math.min(1, spd / 6.2);
    ch.phase += dt * (3.2 + spd * 2.0);

    var tArmLx = 0, tArmRx = 0, tArmLz = 0.1, tArmRz = -0.1;
    var tLegLx = 0, tLegRx = 0, tHipsX = 0, tHipsY = 0.88;
    var tPivotX = 0, tPivotZ = 0, tHeadX = 0, tHeadY = 0;
    var lambda = 14;
    var rootY = 0;

    var state = ch.state;

    if (state === 'down') {
      tPivotX = -Math.PI / 2 * 0.96;
      rootY = 0.16;
      tArmLx = -0.5; tArmRx = -0.4; tArmLz = 0.5; tArmRz = -0.5;
      tLegLx = 0.15; tLegRx = -0.15;
      tHeadX = 0.25;
      lambda = 7;
    } else if (state === 'getup') {
      tPivotX = 0; rootY = 0;
      tArmLx = -0.9; tArmRx = -0.9;
      tHipsX = 0.4;
      lambda = 6;
    } else if (state === 'celebrate') {
      var bounce = Math.abs(Math.sin(time * 9));
      rootY = bounce * 0.22;
      tArmLx = -2.7; tArmRx = -2.7; tArmLz = 0.35; tArmRz = -0.35;
      tLegLx = Math.sin(time * 12) * 0.25; tLegRx = -Math.sin(time * 12) * 0.25;
      tHeadX = -0.25;
      lambda = 12;
    } else if (state === 'argue') {
      var wave = Math.sin(time * 11);
      tArmLx = -1.9 + wave * 0.45; tArmRx = -1.7 - wave * 0.4;
      tArmLz = 0.55; tArmRz = -0.55;
      tHeadY = Math.sin(time * 7) * 0.35;
      tHipsX = 0.1;
      lambda = 14;
    } else if (state === 'card') {
      tArmRx = -2.85; tArmRz = -0.25;
      tArmLx = -0.15; tArmLz = 0.15;
      tHeadX = -0.12;
      lambda = 16;
    } else if (state === 'whistle') {
      tArmRx = -2.05; tArmRz = -0.95;
      tArmLx = -0.1; tArmLz = 0.12;
      tHeadX = -0.08;
      lambda = 18;
    } else if (state === 'dive') {
      tPivotZ = ch.diveDir || 1.15;
      rootY = 0.45;
      tArmLx = -2.4; tArmRx = -2.4;
      tLegLx = 0.3; tLegRx = -0.3;
      lambda = 10;
    } else if (state === 'jump') {
      tLegLx = -0.62; tLegRx = 0.38;
      tArmLx = -1.55; tArmRx = -1.55; tArmLz = 0.38; tArmRz = -0.38;
      tHipsX = 0.16;
      lambda = 11;
    } else if (state === 'look') {
      tHeadY = ch.lookYaw || 0;
      tHeadX = -0.05;
      lambda = 8;
    } else {
      /* idle / run blend */
      if (amp > 0.03) {
        var s = Math.sin(ch.phase);
        tLegLx = s * 0.95 * amp;
        tLegRx = -s * 0.95 * amp;
        tArmLx = -s * 0.8 * amp;
        tArmRx = s * 0.8 * amp;
        tArmLz = 0.1 + amp * 0.06;
        tArmRz = -0.1 - amp * 0.06;
        tHipsY = 0.88 + Math.abs(Math.sin(ch.phase * 2)) * 0.045 * amp;
        tHipsX = 0.1 * amp;
        tPivotX = 0.05 * amp;
        lambda = 26;
      } else {
        var br = Math.sin(time * 1.9) * 0.5 + 0.5;
        tHipsY = 0.88 + br * 0.012;
        tArmLz = 0.11 + br * 0.02;
        tArmRz = -0.11 - br * 0.02;
        tHeadY = Math.sin(time * 0.7) * 0.12;
        lambda = 8;
      }
    }

    dampTo(p.armL, 'x', tArmLx, lambda, dt);
    dampTo(p.armR, 'x', tArmRx, lambda, dt);
    dampTo(p.armL, 'z', tArmLz, lambda, dt);
    dampTo(p.armR, 'z', tArmRz, lambda, dt);
    dampTo(p.legL, 'x', tLegLx, lambda, dt);
    dampTo(p.legR, 'x', tLegRx, lambda, dt);
    dampTo(p.hips, 'x', tHipsX, lambda, dt);
    p.hips.position.y = U.damp(p.hips.position.y, tHipsY, lambda, dt);
    dampTo(p.pivot, 'x', tPivotX, lambda, dt);
    dampTo(p.pivot, 'z', tPivotZ, lambda, dt);
    dampTo(p.head, 'x', tHeadX, lambda, dt);
    dampTo(p.head, 'y', tHeadY, lambda * 0.8, dt);

    ch.yCur = U.damp(ch.yCur || 0, rootY, 12, dt);
    p.body.position.y = ch.yCur + (ch.extraY || 0);

    if (p.blob) {
      var h = p.body.position.y;
      p.blob.position.y = 0.015 - h;
      p.blob.material.opacity = U.clamp(0.55 - h * 0.35, 0.08, 0.55);
      var sc = 1 + h * 0.3;
      p.blob.scale.set(sc, sc, 1);
    }
  }

  return { create: create, animate: animate, SKIN_TONES: SKIN_TONES, HAIR_TONES: HAIR_TONES };
})();
