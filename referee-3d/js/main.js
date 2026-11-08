/* WHISTLE — referee controller, camera, input, game loop */
window.REF = window.REF || {};

(function () {
  var U = REF.U;
  var D = REF.DATA;
  var keys = {};
  var dragging = false;
  var lastX = 0, lastY = 0;
  var raycaster = null;
  var pointerNDC = null;
  var clockLast = 0;

  /* ---------------------------------------------------------- the referee */
  REF.Ref = {
    ch: null,
    pos: new THREE.Vector3(0, 0, 12),
    vel: new THREE.Vector3(),
    facing: Math.PI,
    y: 0,
    vy: 0,
    onGround: true,
    stamina: 100,
    sprinting: false,
    state: 'idle',
    stateT: 0,
    staminaDelay: 0,
    stepPhase: 0,

    build: function (scene) {
      if (this.ch) scene.remove(this.ch.group);
      var skin = REF.Save.data.skin || 'classic';
      var kit = null;
      for (var i = 0; i < D.SKINS.length; i++) if (D.SKINS[i].id === skin) kit = D.SKINS[i];
      if (!kit) kit = D.SKINS[0];
      this.ch = REF.Actors.create({
        shirt: kit.shirt, shirt2: kit.shirt2, shorts: kit.shorts, socks: kit.socks,
        skin: '#e8bb96', hair: '#1a1410', ref: true
      });
      this.ch.group.position.copy(this.pos);
      this.ch.group.rotation.y = this.facing;
      scene.add(this.ch.group);
    },

    applySkin: function () {
      if (!this.ch) return;
      var skin = REF.Save.data.skin || 'classic';
      var kit = D.SKINS[0];
      for (var i = 0; i < D.SKINS.length; i++) if (D.SKINS[i].id === skin) kit = D.SKINS[i];
      this.ch.setKit(kit);
    },

    reset: function () {
      this.pos.set(0, 0, 14);
      this.vel.set(0, 0, 0);
      this.facing = Math.PI;
      this.y = 0; this.vy = 0; this.onGround = true;
      this.stamina = 100;
      this.state = 'idle';
      this.stateT = 0;
      if (this.ch) {
        this.ch.group.position.copy(this.pos);
        this.ch.group.rotation.y = this.facing;
        this.ch.parts.cardY.visible = false;
        this.ch.parts.cardR.visible = false;
        this.ch.parts.whistle.visible = false;
      }
    },

    update: function (dt) {
      if (this.stateT > 0) {
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.state = 'idle';
          if (this.ch) {
            this.ch.parts.cardY.visible = false;
            this.ch.parts.cardR.visible = false;
            this.ch.parts.whistle.visible = false;
          }
        }
      }

      var cam = REF.Game.cam;
      var fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
      var rx = -fz, rz = fx;

      var ix = 0, iz = 0;
      if (keys['w'] || keys['arrowup']) iz += 1;
      if (keys['s'] || keys['arrowdown']) iz -= 1;
      if (keys['d'] || keys['arrowright']) ix += 1;
      if (keys['a'] || keys['arrowleft']) ix -= 1;

      var mx = fx * iz + rx * ix;
      var mz = fz * iz + rz * ix;
      var mag = Math.sqrt(mx * mx + mz * mz);
      if (mag > 0.001) { mx /= mag; mz /= mag; }

      var wantSprint = (keys['shift'] === true) && mag > 0.1 && this.stamina > 1;
      this.sprinting = wantSprint;

      var baseSpeed = wantSprint ? 6.9 : 3.4;
      var accel = this.onGround ? 11 : 3;
      var tvx = mx * baseSpeed * (mag > 0 ? 1 : 0);
      var tvz = mz * baseSpeed * (mag > 0 ? 1 : 0);

      this.vel.x = U.damp(this.vel.x, tvx, accel, dt);
      this.vel.z = U.damp(this.vel.z, tvz, accel, dt);

      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;

      if (wantSprint) {
        this.stamina = Math.max(0, this.stamina - 17 * dt);
        this.staminaDelay = 0.9;
        REF.Game.tutMark('sprint');
      } else {
        if (this.staminaDelay > 0) this.staminaDelay -= dt;
        else this.stamina = Math.min(100, this.stamina + 13 * dt);
      }

      var speed = Math.sqrt(this.vel.x * this.vel.x + this.vel.z * this.vel.z);
      if (speed > 0.4) {
        this.facing = U.angleDamp(this.facing, Math.atan2(this.vel.x, this.vel.z), 11, dt);
        REF.Game.tutMove(speed * dt);
      }

      /* jump */
      if (!this.onGround) {
        this.vy -= 17 * dt;
        this.y += this.vy * dt;
        if (this.y <= 0) { this.y = 0; this.vy = 0; this.onGround = true; }
      }

      /* keep inside the stadium */
      this.pos.x = U.clamp(this.pos.x, -60, 60);
      this.pos.z = U.clamp(this.pos.z, -42, 42);

      /* bump into players */
      if (REF.Game.match) {
        var ps = REF.Game.match.players;
        for (var i = 0; i < ps.length; i++) {
          var p = ps[i];
          if (!p.active) continue;
          var dx = this.pos.x - p.pos.x;
          var dz = this.pos.z - p.pos.z;
          var d = Math.sqrt(dx * dx + dz * dz);
          if (d < 0.62 && d > 0.0001) {
            var push = (0.62 - d);
            this.pos.x += (dx / d) * push;
            this.pos.z += (dz / d) * push;
          }
        }
      }

      if (this.ch) {
        this.ch.group.position.set(this.pos.x, 0, this.pos.z);
        this.ch.group.rotation.y = this.facing;
        this.ch.animSpeed = speed;
        this.ch.extraY = this.y;
        if (this.stateT > 0) {
          this.ch.state = this.state;
          this.ch.animSpeed = Math.min(speed, 1.5);
        } else if (!this.onGround) {
          this.ch.state = 'jump';
        } else {
          this.ch.state = speed > 0.7 ? 'run' : 'idle';
        }
      }
    },

    jump: function () {
      if (this.onGround && !REF.Game.paused) {
        this.vy = 5.6;
        this.onGround = false;
        REF.Audio.kick(0.25);
        REF.Game.tutMark('jump');
      }
    },

    doWhistle: function () {
      if (REF.Game.paused || !REF.Game.match) return;
      this.state = 'whistle';
      this.stateT = 0.85;
      if (this.ch) this.ch.parts.whistle.visible = true;
      var res = REF.Game.match.whistle();
      REF.Save.ach('first_whistle');
      if (REF.Save.data.stats.whistles >= 50) REF.Save.ach('whistler');
      REF.Game.tutMark('whistle');
      if (res === 'foul') REF.UI.setPrompt('Foul given — free kick');
      return res;
    },

    doCard: function (player, type) {
      if (REF.Game.paused || !REF.Game.match) return;
      this.state = 'card';
      this.stateT = 1.5;
      if (this.ch) {
        this.ch.parts.cardY.visible = type === 'yellow';
        this.ch.parts.cardR.visible = type === 'red';
      }
      var res = REF.Game.match.showCard(player, type);
      REF.UI.cardFX(type);
      REF.Game.tutMark('card');
      return res;
    }
  };

  /* --------------------------------------------------------------- camera */
  REF.Game = {
    match: null,
    ballMesh: null,
    paused: false,
    cam: { yaw: 0, pitch: 0.34, dist: 9.5, dragT: 0 },
    tut: null,
    scene: null,

    startMatch: function (id, opts) {
      opts = opts || {};
      var data = null;
      for (var i = 0; i < D.MATCHES.length; i++) if (D.MATCHES[i].id === id) data = D.MATCHES[i];
      if (!data) data = D.MATCHES[0];
      this.launch(data, opts);
    },

    launch: function (data, opts) {
      opts = opts || {};
      if (this.match) {
        this.match.dispose();
        this.match = null;
      }
      this.paused = false;
      this.tut = opts.tutorial ? { i: 0, moved: 0, steps: [] } : null;
      this.match = new REF.Match(this.scene, data, { ball: this.ballMesh, tutorial: !!opts.tutorial });

      var self = this;
      this.match.on('event', function (e) {
        REF.UI.feed(e.text, e.kind);
        if (e.kind === 'foul') REF.Audio.kick(0.8);
      });
      this.match.on('card', function (c) {
        REF.UI.toast('CARD', (c.type === 'red' ? 'RED — ' : 'YELLOW — ') + c.player.name, 0);
      });
      this.match.on('goal', function (g) {
        REF.UI.toast('GOAL', g.scorer ? g.scorer.name : 'Goal', 0);
      });
      this.match.on('offside', function () {
        REF.UI.setPrompt('Assistant has the flag up — blow your whistle');
      });
      this.match.on('fulltime', function (res) {
        self.endMatch(res);
      });

      REF.Ref.reset();
      REF.UI.show(null);
      REF.UI.hideIntro();
      REF.UI.intro(this.match);
      REF.UI.setPrompt('');

      if (this.tut) this.renderTutorial();
      else document.getElementById('objectives').classList.remove('on');
    },

    applySkin: function () {
      REF.Ref.applySkin();
    },

    startTutorial: function () {
      var data = null;
      for (var i = 0; i < D.MATCHES.length; i++) if (D.MATCHES[i].id === 'f18') data = D.MATCHES[i];
      if (!data) data = D.MATCHES[0];
      this.launch(data, { tutorial: true });
    },

    resume: function () {
      this.paused = false;
      REF.UI.show(null);
    },

    restart: function () {
      if (!this.match) return;
      var data = this.match.data;
      var tutorial = !!this.match.tutorial;
      this.launch(data, { tutorial: tutorial });
    },

    quit: function () {
      if (this.match) {
        this.match.dispose();
        this.match = null;
      }
      this.paused = false;
      REF.UI.show('menu');
      REF.UI.buildMenu();
      document.getElementById('objectives').classList.remove('on');
      REF.UI.setPrompt('');
    },

    pause: function () {
      if (!this.match || this.match.ended) return;
      this.paused = true;
      REF.UI.show('pause');
    },

    endMatch: function (res) {
      var m = this.match;
      if (!m) return;
      var pts = 25 + m.stats.yellows * 4 + m.stats.reds * 8 + m.stats.offsides * 3 + m.stats.goals * 2;
      pts = Math.min(pts, 120);
      REF.Save.addPoints(pts);
      REF.Save.data.history.unshift({
        id: m.data.id, score: m.score.join('-'), date: Date.now()
      });
      REF.Save.data.history = REF.Save.data.history.slice(0, 20);
      REF.Save.save();
      REF.Audio.chime();
      REF.UI.showResult(m, pts);
      if (this.tut) this.finishTutorial();
    },

    talk: function (p) {
      if (!p) return;
      REF.UI.talkTo(p);
      this.tutMark('talk');
    },

    nearPlayer: function () {
      if (!this.match) return null;
      var best = null, bd = 6.5;
      for (var i = 0; i < this.match.players.length; i++) {
        var p = this.match.players[i];
        if (!p.active) continue;
        var d = U.distXZ(p.pos, REF.Ref.pos);
        if (d < bd) { bd = d; best = p; }
      }
      return best;
    },

    /* ---------------------------------------------------------- tutorial */
    renderTutorial: function () {
      var box = document.getElementById('objectives');
      var STEPS = [
        ['move', 'Move with W A S D'],
        ['sprint', 'Hold SHIFT to sprint'],
        ['jump', 'Press SPACE to jump'],
        ['whistle', 'Blow the whistle — LMB'],
        ['toolbox', 'Open the toolbox — E'],
        ['card', 'Pick a card, then click a player'],
        ['talk', 'Talk to a player — T']
      ];
      box.innerHTML = '';
      var head = document.createElement('div');
      head.className = 'obj-head';
      head.textContent = 'TUTORIAL';
      box.appendChild(head);
      var self = this;
      STEPS.forEach(function (s, i) {
        var row = document.createElement('div');
        row.className = 'obj-row' + (i < self.tut.i ? ' done' : (i === self.tut.i ? ' cur' : ''));
        row.dataset.step = s[0];
        var dot = document.createElement('i');
        dot.textContent = i < self.tut.i ? '✓' : String(i + 1);
        row.appendChild(dot);
        var t = document.createElement('span');
        t.textContent = s[1];
        row.appendChild(t);
        box.appendChild(row);
      });
      box.classList.add('on');
    },

    tutMark: function (id) {
      if (!this.tut) return;
      var order = ['move', 'sprint', 'jump', 'whistle', 'toolbox', 'card', 'talk'];
      if (order[this.tut.i] === id) {
        this.tut.i++;
        this.renderTutorial();
        REF.Audio.chime();
        if (this.tut.i >= order.length) this.finishTutorial();
      }
    },

    tutMove: function (dist) {
      if (!this.tut) return;
      if (this.tut.i === 0) {
        this.tut.moved += dist;
        if (this.tut.moved > 7) this.tutMark('move');
      }
    },

    finishTutorial: function () {
      if (!this.tut || this.tut.done) return;
      this.tut.done = true;
      REF.Save.data.tutorial.done = true;
      REF.Save.unlockSkin('retro');
      REF.Save.save();
      REF.Save.ach('tutorial');
      REF.UI.toast('TUTORIAL COMPLETE', 'Retro Red kit unlocked', 100);
      document.getElementById('objectives').classList.remove('on');
    }
  };

  /* ----------------------------------------------------------------- input */
  function keyName(e) {
    var k = e.key.toLowerCase();
    if (k === ' ') return 'space';
    if (k === 'escape') return 'escape';
    if (k === 'shift') return 'shift';
    return k;
  }

  function onKeyDown(e) {
    var k = keyName(e);
    if (['w', 'a', 's', 'd', 'space', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].indexOf(k) >= 0) {
      e.preventDefault();
    }
    keys[k] = true;

    if (k === 'escape') {
      if (REF.UI.isDialogueOpen()) { REF.UI.closeDialogue(); return; }
      if (document.getElementById('book').classList.contains('on')) { REF.UI.closeBook(); return; }
      if (REF.UI.tool()) { REF.UI.selectTool(null); return; }
      if (document.getElementById('toolbox').classList.contains('on')) { REF.UI.openToolbox(false); return; }
      if (REF.UI.currentScreen() === 'pause') { REF.Game.resume(); return; }
      if (!REF.UI.currentScreen()) { REF.Game.pause(); return; }
      if (REF.UI.currentScreen() === 'matches' || REF.UI.currentScreen() === 'skins' || REF.UI.currentScreen() === 'ach') {
        REF.UI.show('menu'); return;
      }
      return;
    }

    if (REF.UI.currentScreen() || REF.Game.paused) return;

    if (k === ' ') { REF.Ref.jump(); }
    else if (k === 'e') {
      var open = !document.getElementById('toolbox').classList.contains('on');
      REF.UI.openToolbox(open);
      if (open) { REF.Audio.click(); REF.Game.tutMark('toolbox'); }
    } else if (k === 't') {
      var p = REF.Game.nearPlayer();
      if (p) REF.Game.talk(p);
      else REF.UI.flash('No player close enough to talk to');
    } else if (k === '1') { REF.UI.selectTool('whistle'); REF.Ref.doWhistle(); }
    else if (k === '2') { REF.UI.selectTool('yellow'); REF.Game.tutMark('toolbox'); }
    else if (k === '3') { REF.UI.selectTool('red'); REF.Game.tutMark('toolbox'); }
    else if (k === '4') { REF.UI.selectTool('talk'); REF.Game.tutMark('toolbox'); }
    else if (k === '5') { REF.UI.selectTool('book'); REF.Game.tutMark('toolbox'); }
  }

  function onKeyUp(e) {
    keys[keyName(e)] = false;
  }

  function pickPlayer(clientX, clientY) {
    if (!REF.Game.match) return null;
    if (!raycaster) {
      raycaster = new THREE.Raycaster();
      pointerNDC = new THREE.Vector2();
    }
    pointerNDC.x = (clientX / window.innerWidth) * 2 - 1;
    pointerNDC.y = -(clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointerNDC, REF.Engine.camera);

    var groups = [];
    var list = REF.Game.match.players;
    for (var i = 0; i < list.length; i++) if (list[i].active) groups.push(list[i].ch.group);

    var hits = raycaster.intersectObjects(groups, true);
    if (hits.length) {
      var obj = hits[0].object;
      while (obj) {
        if (obj.userData && obj.userData.player) return obj.userData.player;
        obj = obj.parent;
      }
    }

    /* forgiving fallback: nearest player to the cursor in screen space */
    var cam = REF.Engine.camera;
    var best = null, bestD = 58;
    var v = new THREE.Vector3();
    for (var k = 0; k < list.length; k++) {
      var q = list[k];
      if (!q.active) continue;
      v.set(q.pos.x, 1.0, q.pos.z);
      var dist3 = v.distanceTo(cam.position);
      if (dist3 > 46) continue;
      v.project(cam);
      if (v.z > 1 || v.z < -1) continue;
      var sx = (v.x * 0.5 + 0.5) * window.innerWidth;
      var sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
      var dd = Math.sqrt((sx - clientX) * (sx - clientX) + (sy - clientY) * (sy - clientY));
      if (dd < bestD) { bestD = dd; best = q; }
    }
    return best;
  }

  function onPointerDown(e) {
    if (e.target !== REF.Engine.renderer.domElement) return;
    REF.Audio.resume();

    if (e.button === 2) {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      return;
    }
    if (e.button !== 0) return;
    if (REF.UI.currentScreen() || REF.Game.paused) return;

    var tool = REF.UI.tool();
    if (tool === 'yellow' || tool === 'red' || tool === 'talk') {
      var p = pickPlayer(e.clientX, e.clientY);
      if (!p) {
        REF.UI.flash('No player there — click directly on a player');
        return;
      }
      if (tool === 'talk') REF.Game.talk(p);
      else REF.Ref.doCard(p, tool);
      REF.UI.selectTool(null);
      return;
    }
    REF.Ref.doWhistle();
  }

  function onPointerMove(e) {
    if (!dragging) return;
    var dx = e.clientX - lastX;
    var dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    REF.Game.cam.yaw -= dx * 0.005;
    REF.Game.cam.pitch = U.clamp(REF.Game.cam.pitch + dy * 0.004, 0.05, 1.15);
    REF.Game.cam.dragT = 1.6;
  }

  function onPointerUp() { dragging = false; }

  function onWheel(e) {
    if (REF.UI.currentScreen()) return;
    e.preventDefault();
    REF.Game.cam.dist = U.clamp(REF.Game.cam.dist + e.deltaY * 0.012, 5, 20);
  }

  /* ------------------------------------------------------------- camera */
  function updateCamera(dt) {
    var cam = REF.Game.cam;
    var camera = REF.Engine.camera;

    if (!REF.Game.match) {
      var a = performance.now() * 0.00007;
      camera.position.set(Math.cos(a) * 78, 44, Math.sin(a) * 78);
      camera.lookAt(0, 0, 0);
      return;
    }

    if (cam.dragT > 0) cam.dragT -= dt;

    var moving = Math.abs(REF.Ref.vel.x) + Math.abs(REF.Ref.vel.z) > 1.2;
    if (moving && !dragging && cam.dragT <= 0) {
      cam.yaw = U.angleDamp(cam.yaw, REF.Ref.facing + Math.PI, 1.5, dt);
    }

    var cy = Math.cos(cam.pitch), sy = Math.sin(cam.pitch);
    var tx = REF.Ref.pos.x + Math.sin(cam.yaw) * cam.dist * cy;
    var tz = REF.Ref.pos.z + Math.cos(cam.yaw) * cam.dist * cy;
    var ty = cam.dist * sy + 1.6 + REF.Ref.y * 0.6;

    var k = 1 - Math.exp(-9 * dt);
    camera.position.x += (tx - camera.position.x) * k;
    camera.position.y += (ty - camera.position.y) * k;
    camera.position.z += (tz - camera.position.z) * k;
    if (camera.position.y < 0.7) camera.position.y = 0.7;

    var lookX = REF.Ref.pos.x - Math.sin(cam.yaw) * 2.2;
    var lookZ = REF.Ref.pos.z - Math.cos(cam.yaw) * 2.2;
    camera.lookAt(lookX, 1.35 + REF.Ref.y * 0.6, lookZ);
  }

  /* --------------------------------------------------------------- loop */
  function frame(now) {
    requestAnimationFrame(frame);
    var dt = (now - clockLast) / 1000;
    clockLast = now;
    if (!isFinite(dt) || dt <= 0) dt = 0.016;
    if (dt > 0.05) dt = 0.05;

    var t = now / 1000;

    if (!REF.Game.paused) {
      if (REF.Game.match && !REF.Game.match.ended) {
        REF.Game.match.update(dt);
        REF.Ref.update(dt);
      }
    }

    updateCamera(dt);

    if (REF.Ref.ch) REF.Actors.animate(REF.Ref.ch, dt, t);
    if (REF.Game.match) REF.UI.updateHUD(REF.Game.match, REF.Ref);

    REF.Engine.renderer.render(REF.Engine.scene, REF.Engine.camera);
  }

  /* --------------------------------------------------------------- boot */
  function boot() {
    if (!window.THREE) {
      document.getElementById('boot-error').classList.add('on');
      return;
    }

    REF.Save.load();
    REF.Engine.init();
    REF.Game.scene = REF.Engine.scene;

    var assets = REF.World.build(REF.Engine.scene);
    REF.Game.ballMesh = assets.ball;
    REF.Game.ballMesh.visible = false;

    REF.Ref.build(REF.Engine.scene);
    REF.Ref.reset();

    REF.UI.init();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', function () { keys = {}; dragging = false; });

    var dom = REF.Engine.renderer.domElement;
    dom.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    dom.addEventListener('wheel', onWheel, { passive: false });
    dom.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden && REF.Game.match && !REF.Game.match.ended) REF.Game.pause();
    });

    document.getElementById('boot').classList.add('done');

    clockLast = performance.now();
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(boot, 0);
  } else {
    window.addEventListener('DOMContentLoaded', boot);
  }
})();
