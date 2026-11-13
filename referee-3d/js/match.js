/* WHISTLE — match simulation: ball, AI players, fouls, offside, goals */
window.REF = window.REF || {};

REF.Match = (function () {
  var U = REF.U;
  var F = REF.FIELD;
  var BALL_R = 0.11;
  var GRAV = 16;

  /* x, z as fractions of half the pitch — z is spread right across the width
     so the side has real full-backs and wingers instead of a narrow clump */
  var FORMATION = [
    [-0.94, 0.00, 'GK'],
    [-0.58, -0.90, 'DEF'], [-0.70, -0.33, 'DEF'], [-0.70, 0.33, 'DEF'], [-0.58, 0.90, 'DEF'],
    [-0.18, -0.66, 'MID'], [-0.30, 0.00, 'MID'], [-0.18, 0.66, 'MID'],
    [0.34, -0.92, 'FWD'], [0.46, 0.00, 'FWD'], [0.34, 0.92, 'FWD']
  ];

  var SPEED = { GK: 6.0, DEF: 6.4, MID: 6.9, FWD: 7.3 };
  var BALL_DRAG = 1.35;      /* matches the ground friction in updateBall */

  /* squared distance from a point to the segment a→b: used to catch a pass */
  function segDist2(px, pz, ax, az, bx, bz) {
    var dx = bx - ax, dz = bz - az;
    var l2 = dx * dx + dz * dz;
    var t = l2 > 0.000001 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    var qx = ax + dx * t, qz = az + dz * t;
    return (px - qx) * (px - qx) + (pz - qz) * (pz - qz);
  }

  /* a spray-paint blob: soft white cloud with a few hard flecks */
  function sprayTexture() {
    var c = document.createElement('canvas');
    c.width = c.height = 128;
    var g = c.getContext('2d');
    var grd = g.createRadialGradient(64, 64, 4, 64, 64, 60);
    grd.addColorStop(0, 'rgba(255,255,255,0.95)');
    grd.addColorStop(0.55, 'rgba(245,250,255,0.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    for (var i = 0; i < 90; i++) {
      var a = Math.random() * Math.PI * 2;
      var r = 20 + Math.random() * 40;
      g.fillStyle = 'rgba(255,255,255,' + (0.25 + Math.random() * 0.5) + ')';
      g.beginPath();
      g.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 0.8 + Math.random() * 2.2, 0, Math.PI * 2);
      g.fill();
    }
    var t = new THREE.CanvasTexture(c);
    try { t.colorSpace = THREE.SRGBColorSpace; } catch (e) { }
    return t;
  }

  /* the dashed line the wall has to stand behind */
  function wallTexture() {
    var c = document.createElement('canvas');
    c.width = 256; c.height = 32;
    var g = c.getContext('2d');
    g.clearRect(0, 0, 256, 32);
    g.fillStyle = 'rgba(252,254,255,0.96)';
    /* fat dashes: at twenty metres a hairline just disappears into the grass */
    for (var x = 0; x < 256; x += 34) g.fillRect(x, 0, 22, 32);
    var t = new THREE.CanvasTexture(c);
    try { t.colorSpace = THREE.SRGBColorSpace; } catch (e) { }
    return t;
  }

  function Match(scene, data, opts) {
    opts = opts || {};
    this.scene = scene;
    this.data = data;
    this.opts = opts;
    this.tutorial = !!opts.tutorial;
    this.players = [];
    this.score = [0, 0];
    this.min = 0;
    this.half = 1;
    this.state = 'kickoff';
    this.stateT = 2.6;
    this.time = 0;
    this.dt = 1 / 60;
    this.passGuard = 0;
    this.passGuardTeam = -1;
    this.deadT = 0;
    this.decideT = 0;
    this.pendingFoul = null;
    this.pendingOffside = null;
    this.freezeT = 0;
    this.frozen = false;
    this.freezeAction = null;
    this.restart = null;
    /* a dead ball waiting for the referee's whistle */
    this.awaiting = null;
    /* a call the referee has to make before anything else can happen */
    this.decision = null;
    this.wallPlacing = false;
    this.lastGoalCall = null;
    this.lastFoul = null;
    this.wall = null;
    this.passTo = null;
    this.events = [];
    this.ended = false;
    this.owner = null;
    this.lastTouch = null;
    this.stats = { fouls: 0, offsides: 0, whistles: 0, yellows: 0, reds: 0, goals: 0 };
    this.handlers = {};
    this.build(opts.ball);
  }

  Match.prototype.on = function (name, fn) {
    (this.handlers[name] = this.handlers[name] || []).push(fn);
    return this;
  };

  Match.prototype.emit = function (name, payload) {
    var list = this.handlers[name];
    if (list) for (var i = 0; i < list.length; i++) list[i](payload);
  };

  /* ------------------------------------------------------------- build */
  Match.prototype.build = function (ballMesh) {
    var self = this;
    var homeInfo = REF.DATA.TEAMS[this.data.home];
    var awayInfo = REF.DATA.TEAMS[this.data.away];

    this.teams = [
      { id: this.data.home, info: homeInfo, dir: 1, score: 0 },
      { id: this.data.away, info: awayInfo, dir: -1, score: 0 }
    ];

    this.ball = {
      pos: ballMesh ? ballMesh.position : new THREE.Vector3(0, BALL_R, 0),
      vel: new THREE.Vector3(),
      mesh: ballMesh || null,
      lastShotBy: null
    };
    if (this.ball.mesh) {
      this.ball.mesh.visible = true;
      this.ball.mesh.position.set(0, BALL_R, 0);
    }

    /* ground marker so a lofted ball is easy to follow */
    this.ballRing = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.34, 22),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide })
    );
    this.ballRing.rotation.x = -Math.PI / 2;
    this.ballRing.position.y = 0.02;
    this.scene.add(this.ballRing);

    /* spray-paint marks: the free-kick spot and the wall line */
    this.paintGroup = new THREE.Group();
    this.paintGroup.visible = false;
    this.scene.add(this.paintGroup);

    this.spraySpot = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 1.5),
      new THREE.MeshBasicMaterial({ map: sprayTexture(), transparent: true, depthWrite: false })
    );
    this.spraySpot.rotation.x = -Math.PI / 2;
    this.spraySpot.position.y = 0.028;
    this.paintGroup.add(this.spraySpot);

    this.wallLine = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 0.55),
      new THREE.MeshBasicMaterial({ map: wallTexture(), transparent: true, depthWrite: false })
    );
    this.wallLine.position.y = 0.03;
    this.paintGroup.add(this.wallLine);

    for (var t = 0; t < 2; t++) {
      var info = this.teams[t].info;
      var dir = this.teams[t].dir;
      for (var i = 0; i < FORMATION.length; i++) {
        var f = FORMATION[i];
        var role = f[2];
        var hx = t === 0 ? f[0] * (F.L / 2) : -f[0] * (F.L / 2);
        var hz = t === 0 ? f[1] * (F.W / 2 - 3.5) : -f[1] * (F.W / 2 - 3.5);

        var shirt = info.shirt;
        var shirt2 = info.shirt2;
        if (role === 'GK') {
          shirt = t === 0 ? '#2fd18a' : '#f2d43e';
          shirt2 = null;
        }

        var ch = REF.Actors.create({
          shirt: shirt,
          shirt2: shirt2,
          shorts: info.shorts,
          socks: info.socks,
          skin: U.pick(REF.Actors.SKIN_TONES),
          hair: U.pick(REF.Actors.HAIR_TONES)
        });
        ch.group.position.set(hx, 0, hz);
        this.scene.add(ch.group);

        var p = {
          team: t,
          idx: i,
          name: info.squad[i] || ('Player ' + (i + 1)),
          number: i + 1,
          role: role,
          ch: ch,
          pos: new THREE.Vector3(hx, 0, hz),
          vel: new THREE.Vector3(),
          home: new THREE.Vector3(hx, 0, hz),
          target: new THREE.Vector3(hx, 0, hz),
          facing: t === 0 ? Math.PI / 2 : -Math.PI / 2,
          maxSpeed: SPEED[role] + U.rand(-0.15, 0.3),
          kickCd: 0,
          tackleCd: 0,
          noTouch: 0,
          aiT: U.rand(0, 0.3),
          controlT: 0,
          holdT: 0,
          runCd: U.rand(2, 6),
          runT: 0,
          mark: null,
          downT: 0,
          getupT: 0,
          anger: 0,
          yellow: 0,
          active: true,
          sentOff: false,
          walkOff: 0,
          argueT: 0,
          lastGoal: 0,
          state: 'idle'
        };
        ch.group.userData.player = p;
        ch.group.rotation.y = p.facing;
        this.players.push(p);
      }
    }

    this.resetPositions();
    this.kickoff(0, true);
  };

  Match.prototype.teamName = function (t) {
    return this.teams[t].info.name;
  };

  Match.prototype.activeOf = function (t) {
    var out = [];
    for (var i = 0; i < this.players.length; i++) {
      var p = this.players[i];
      if (p.team === t && p.active) out.push(p);
    }
    return out;
  };

  /* --------------------------------------------------------- positioning */
  Match.prototype.resetPositions = function () {
    for (var i = 0; i < this.players.length; i++) {
      var p = this.players[i];
      if (!p.active) continue;
      p.pos.copy(p.home);
      p.vel.set(0, 0, 0);
      p.target.copy(p.home);
      p.facing = p.team === 0 ? Math.PI / 2 : -Math.PI / 2;
      p.ch.group.position.copy(p.pos);
      p.ch.group.rotation.y = p.facing;
      p.ch.state = 'idle';
      p.ch.animSpeed = 0;
      p.state = 'idle';
      p.downT = 0;
      p.argueT = 0;
      p.holdT = 0;
      p.noTouch = 0;
      p.kickCd = 0;
      p.mark = null;
      p.runT = 0;
    }
    this.passTo = null;
  };

  Match.prototype.setBall = function (x, y, z) {
    this.ball.pos.set(x, y, z);
    this.ball.vel.set(0, 0, 0);
    this.owner = null;
  };

  Match.prototype.kickoff = function (team, silent) {
    this.resetPositions();
    this.clearPaint();
    this.setBall(0, BALL_R, 0);
    this.state = 'setpiece';
    this.stateT = 0;
    this.restart = { kind: 'kick-off', team: team, pos: new THREE.Vector3(0, 0, 0) };
    this.taker = this.pickTaker(team, new THREE.Vector3(0, 0, 0));
    if (this.taker) {
      this.taker.pos.set(-this.teams[team].dir * 0.75, 0, 0.35);
      this.taker.ch.group.position.copy(this.taker.pos);
    }
    /* nothing starts until the referee blows for it */
    this.awaiting = { kind: 'kick-off', team: team };
    if (!silent) this.log('kick-off', 'Kick-off — ' + this.teamName(team));
    this.emit('state', this.state);
  };

  Match.prototype.pickTaker = function (team, pos) {
    var best = null, bd = 1e9;
    for (var i = 0; i < this.players.length; i++) {
      var p = this.players[i];
      if (!p.active || p.team !== team || p.role === 'GK') continue;
      var d = U.distXZ(p.pos, pos);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  };

  Match.prototype.setPiece = function (kind, pos, team) {
    this.state = 'setpiece';
    this.stateT = 0;
    this.pendingFoul = null;
    this.pendingOffside = null;
    this.ball.vel.set(0, 0, 0);
    this.ball.pos.set(pos.x, BALL_R, pos.z);
    this.owner = null;
    this.lastTouch = null;
    this.restart = { kind: kind, team: team, pos: pos.clone() };

    /* marks only live as long as the free kick they were sprayed for */
    this.clearPaint();

    /* a goal kick is the keeper's; everything else goes to the nearest man */
    this.taker = kind === 'goal-kick' ? this.keeperOf(team) : this.pickTaker(team, pos);
    if (this.taker) {
      var dir = this.teams[team].dir;
      var tx = pos.x - dir * 0.9;
      var tz = pos.z + 0.25;
      this.taker.pos.set(U.clamp(tx, -52, 52), 0, U.clamp(tz, -33, 33));
      this.taker.vel.set(0, 0, 0);
      this.taker.target.copy(this.taker.pos);
      this.taker.ch.group.position.copy(this.taker.pos);
    }
    /* the ball sits there until the referee whistles it back into play */
    this.awaiting = { kind: kind, team: team };
    this.emit('state', this.state);
  };

  /* the referee's whistle: the dead ball is live again */
  Match.prototype.startRestart = function () {
    if (!this.awaiting) return false;
    /* a free kick with no wall placed yet gets the standard one, so the
       restart can never be held up by an unplaced wall */
    if (this.wallPlacing && this.restart && this.restart.kind === 'free-kick') this.autoWall();
    this.wallPlacing = false;
    this.awaiting = null;
    this.state = 'play';
    this.emit('state', this.state);
    this.takeRestart();
    return true;
  };

  Match.prototype.clearPaint = function () {
    if (this.paintGroup) this.paintGroup.visible = false;
    this.wall = null;
    for (var i = 0; i < this.players.length; i++) {
      this.players[i].wallT = 0;
      this.players[i].wallPos = null;
    }
  };

  /* the closest team-mate to pass to from a dead ball */
  Match.prototype.nearestMate = function (p, maxD) {
    var best = null, bd = maxD || 20;
    for (var i = 0; i < this.players.length; i++) {
      var m = this.players[i];
      if (!m.active || m.team !== p.team || m === p || m.role === 'GK') continue;
      var d = U.distXZ(m.pos, p.pos);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  };

  /* a corner whipped into the six-yard box */
  Match.prototype.autoCross = function (taker, team) {
    var b = this.ball;
    var dir = this.teams[team].dir;
    var tx = dir * (F.L / 2 - 8.5);
    var tz = U.rand(-3.5, 3.5);
    var dx = tx - b.pos.x, dz = tz - b.pos.z;
    var len = Math.sqrt(dx * dx + dz * dz) || 1;
    var speed = U.clamp(BALL_DRAG * len + 12, 16, 30);
    b.vel.set((dx / len) * speed, 6.4, (dz / len) * speed);
    taker.kickCd = 0.8;
    taker.noTouch = 0.4;
    this.owner = null;
    this.lastTouch = taker;
    this.passTo = null;
    REF.Audio.kick(0.7);
  };

  /* a throw-in, flat and to feet */
  Match.prototype.throwTo = function (taker, mate) {
    var b = this.ball;
    var dx = mate.pos.x - b.pos.x, dz = mate.pos.z - b.pos.z;
    var len = Math.sqrt(dx * dx + dz * dz) || 1;
    var speed = U.clamp(BALL_DRAG * len + 6, 8, 18);
    b.vel.set((dx / len) * speed, 3.0, (dz / len) * speed);
    taker.kickCd = 0.7;
    taker.noTouch = 0.4;
    this.owner = null;
    this.lastTouch = taker;
    this.passTo = mate;
    REF.Audio.kick(0.35);
  };

  /* the set-piece timer has run out: somebody actually plays the ball */
  Match.prototype.takeRestart = function () {
    var r = this.restart;
    if (!r) return;
    this.restart = null;

    var taker = this.taker;
    if (!taker || !taker.active) taker = this.pickTaker(r.team, this.ball.pos);
    if (!taker) return;

    var dir = this.teams[r.team].dir;

    if (r.kind === 'kick-off') {
      var km = this.nearestMate(taker, 22);
      if (km) this.pass(taker, km);
      else this.clear(taker, dir);
    } else if (r.kind === 'goal-kick') {
      this.gkDistribute(taker, dir);
    } else if (r.kind === 'corner') {
      this.autoCross(taker, r.team);
    } else if (r.kind === 'throw-in') {
      var mate = this.nearestMate(taker, 22);
      if (mate) this.throwTo(taker, mate);
      else this.clear(taker, dir);
    } else if (r.kind === 'free-kick') {
      var gx = dir * (F.L / 2);
      var dg = Math.sqrt((gx - this.ball.pos.x) * (gx - this.ball.pos.x) + this.ball.pos.z * this.ball.pos.z);
      if (dg < 30 && Math.abs(this.ball.pos.z) < 20) {
        this.shoot(taker, gx);
        this.log('free-kick', 'Free kick — ' + taker.name + ' has a go');
      } else {
        var opt = this.bestPass(taker, dir);
        if (opt && opt.mate) this.pass(taker, opt.mate);
        else this.clear(taker, dir);
        }
    } else if (r.kind === 'penalty') {
      this.shoot(taker, dir * (F.L / 2));
      this.log('penalty', 'Penalty — ' + taker.name);
    }

    this.clearPaint();
    this.taker = null;
  };

  /* the paint can, step one: spray the free-kick spot */
  Match.prototype.paintFreeKick = function (pt) {
    var f = this.pendingFoul || this.lastFoul;
    var team = f ? 1 - f.team : (this.restart ? this.restart.team : 0);
    var dir = this.teams[team].dir;

    var x = U.clamp(pt.x, -F.L / 2 + 1.2, F.L / 2 - 1.2);
    var z = U.clamp(pt.z, -F.W / 2 + 1.2, F.W / 2 - 1.2);

    this.ball.pos.set(x, BALL_R, z);
    this.ball.vel.set(0, 0, 0);
    this.owner = null;
    this.passTo = null;

    if (this.paintGroup) {
      this.paintGroup.visible = true;
      this.spraySpot.position.set(x, 0.028, z);
      this.wallLine.visible = false;
    }

    /* this spot is the free kick now; the wall is the referee's next click */
    this.restart = { kind: 'free-kick', team: team, pos: new THREE.Vector3(x, 0, z) };
    this.state = 'setpiece';
    this.awaiting = { kind: 'free-kick', team: team };
    this.wall = null;
    this.wallPlacing = true;
    for (var c = 0; c < this.players.length; c++) {
      this.players[c].wallT = 0;
      this.players[c].wallPos = null;
    }

    var gx = dir * (F.L / 2);
    var ux = gx - x, uz = 0 - z;
    var ul = Math.sqrt(ux * ux + uz * uz) || 1;
    ux /= ul; uz /= ul;

    this.taker = this.pickTaker(team, this.ball.pos);
    if (this.taker) {
      this.taker.pos.set(U.clamp(x - ux * 1.15, -52, 52), 0, U.clamp(z - uz * 1.15, -33, 33));
      this.taker.vel.set(0, 0, 0);
      this.taker.target.copy(this.taker.pos);
      this.taker.ch.group.position.copy(this.taker.pos);
    }
    this.pendingFoul = null;
    this.pendingOffside = null;
    this.freezeAction = null;
    this.log('free-kick', 'Free kick marked for ' + this.teamName(team) + ' — set the wall');
    return { x: x, z: z, men: 0 };
  };

  /* step two: the referee decides where the wall stands. The distance is
     fixed by law at 9.15 m; the angle is entirely his call. */
  Match.prototype.placeWall = function (pt) {
    if (!this.restart || this.restart.kind !== 'free-kick') return null;
    var b = this.ball.pos;
    var dx = pt.x - b.x, dz = pt.z - b.z;
    var len = Math.sqrt(dx * dx + dz * dz);
    var ux, uz;
    if (len < 2.5) {
      /* clicked almost on the ball: fall back to the line to goal */
      var d0 = this.teams[this.restart.team].dir;
      ux = d0; uz = 0;
    } else {
      ux = dx / len; uz = dz / len;
    }

    var wx = U.clamp(b.x + ux * 9.15, -F.L / 2 + 0.8, F.L / 2 - 0.8);
    var wz = U.clamp(b.z + uz * 9.15, -F.W / 2 + 0.8, F.W / 2 - 0.8);
    var px = -uz, pz = ux;

    this.wall = { x: wx, z: wz, px: px, pz: pz, team: 1 - this.restart.team };

    if (this.paintGroup) this.paintGroup.visible = true;
    if (this.wallLine) {
      this.wallLine.visible = true;
      this.wallLine.position.set(wx, 0.03, wz);
      this.wallLine.rotation.set(-Math.PI / 2, 0, Math.atan2(-pz, px));
      this.wallLine.scale.set(5.4, 1, 1);
    }

    /* the four nearest defenders form it */
    var defs = [];
    for (var i = 0; i < this.players.length; i++) {
      var p = this.players[i];
      if (!p.active || p.team === this.restart.team || p.role === 'GK') continue;
      defs.push(p);
    }
    var wv = new THREE.Vector3(wx, 0, wz);
    defs.sort(function (a, b2) { return U.distXZ(a.pos, wv) - U.distXZ(b2.pos, wv); });
    var n = Math.min(4, defs.length);
    for (var k = 0; k < n; k++) {
      var d = defs[k];
      var off = (k - (n - 1) / 2) * 1.35;
      d.wallT = 1e9;
      d.wallPos = new THREE.Vector3(
        U.clamp(wx + px * off, -51, 51), 0, U.clamp(wz + pz * off, -32, 32));
      d.target.copy(d.wallPos);
      d.vel.set(0, 0, 0);
    }

    this.wallPlacing = false;
    this.log('wall', 'Wall set — ' + n + ' men, 9.15 m from the ball');
    return { x: wx, z: wz, men: n, wall: this.wall };
  };

  /* the standard wall: straight down the line to goal */
  Match.prototype.autoWall = function () {
    if (!this.restart) return null;
    var d = this.teams[this.restart.team].dir;
    return this.placeWall(new THREE.Vector3(this.ball.pos.x + d * 9.15, 0, this.ball.pos.z));
  };

  /* ---------------------------------------------------------------- log */
  Match.prototype.log = function (kind, text) {
    var e = { min: Math.floor(this.min), kind: kind, text: text };
    this.events.push(e);
    if (this.events.length > 200) this.events.shift();
    this.emit('event', e);
    return e;
  };

  /* ------------------------------------------------------------- physics */
  Match.prototype.updateBall = function (dt) {
    var b = this.ball;
    this.ballPrev = { x: b.pos.x, z: b.pos.z };
    if (this.owner && this.owner.active) {
      var p = this.owner;
      var fx = Math.sin(p.facing), fz = Math.cos(p.facing);
      var tx = p.pos.x + fx * 0.52;
      var tz = p.pos.z + fz * 0.52;
      b.pos.x = U.lerp(b.pos.x, tx, 1 - Math.exp(-22 * dt));
      b.pos.z = U.lerp(b.pos.z, tz, 1 - Math.exp(-22 * dt));
      b.pos.y = BALL_R;
      b.vel.set(p.vel.x, 0, p.vel.z);
      b.lastShotBy = null;
    } else {
      b.vel.y -= GRAV * dt;
      b.pos.x += b.vel.x * dt;
      b.pos.y += b.vel.y * dt;
      b.pos.z += b.vel.z * dt;

      if (b.pos.y <= BALL_R) {
        b.pos.y = BALL_R;
        if (b.vel.y < 0) {
          b.vel.y = -b.vel.y * 0.5;
          if (Math.abs(b.vel.y) < 1.1) b.vel.y = 0;
        }
        var f = Math.exp(-1.35 * dt);
        b.vel.x *= f;
        b.vel.z *= f;
      } else {
        var air = Math.exp(-0.06 * dt);
        b.vel.x *= air;
        b.vel.z *= air;
      }

      var sp = b.vel.length();
      if (sp > 46) b.vel.multiplyScalar(46 / sp);
    }

    if (b.mesh) {
      b.mesh.position.copy(b.pos);
      var v = b.vel;
      var spd = Math.sqrt(v.x * v.x + v.z * v.z);
      if (spd > 0.05) {
        var axis = new THREE.Vector3(-v.z, 0, v.x).normalize();
        b.mesh.rotateOnWorldAxis(axis, (spd * dt) / BALL_R * 0.6);
      }
    }

    if (this.ballRing) {
      this.ballRing.position.set(b.pos.x, 0.02, b.pos.z);
      var h = b.pos.y - BALL_R;
      this.ballRing.material.opacity = U.clamp((h - 0.45) * 0.6, 0, 0.42);
      var sc = 1 + h * 0.14;
      this.ballRing.scale.set(sc, sc, 1);
    }
  };

  /* --------------------------------------------------------- possession */
  Match.prototype.updatePossession = function (dt) {
    var b = this.ball;
    var speed = b.vel.length();
    if (b.pos.y > 1.8) { this.owner = null; return; }

    var prev = this.ballPrev || { x: b.pos.x, z: b.pos.z };

    /* keep the ball with the man who has it — you lose it in a tackle, not
       because someone happened to drift half a metre closer */
    var cur = this.owner;
    if (cur && cur.active && cur.downT <= 0 && cur.noTouch <= 0) {
      var dc = U.distXZ(cur.pos, b.pos);
      if (dc < (cur.role === 'GK' ? 1.6 : 1.15) && (speed < 26 || cur.role === 'GK')) {
        if (cur.controlT > 0) cur.controlT -= dt;
        this.lastTouch = cur;
        return;
      }
    }

    /* a player takes the ball if it passes within reach of him this frame */
    if (this.passGuard > 0) this.passGuard -= dt;
    var best = null, bd = 0.95 * 0.95;
    for (var i = 0; i < this.players.length; i++) {
      var p = this.players[i];
      if (!p.active || p.downT > 0 || p.noTouch > 0) continue;
      /* the ball is not stolen off the boot the instant it is played */
      if (this.passGuard > 0 && p.team !== this.passGuardTeam) continue;
      var d2 = segDist2(p.pos.x, p.pos.z, prev.x, prev.z, b.pos.x, b.pos.z);
      if (p.role === 'GK') d2 *= 0.7;
      /* the man it was played to reads it a fraction earlier than anyone else */
      if (p === this.passTo) d2 *= 0.45;
      if (d2 < bd) { bd = d2; best = p; }
    }
    if (best && speed > 30 && best.role !== 'GK') best = null;
    if (best) {
      best.controlT = 0.34;
      best.aiT = Math.max(best.aiT, 0.42);
      this.lastTouch = best;
      if (this.passTo === best) this.passTo = null;
    }
    this.owner = best;
  };

  /* ------------------------------------------------------------ movement */
  Match.prototype.movePlayer = function (p, dt) {
    if (!p.active) return;

    if (p.downT > 0) {
      p.downT -= dt;
      p.state = 'down';
      p.ch.state = 'down';
      p.ch.animSpeed = 0;
      p.vel.multiplyScalar(Math.exp(-8 * dt));
      if (p.downT <= 0) {
        p.state = 'getup';
        p.getupT = 0.55;
        p.ch.state = 'getup';
      }
      p.ch.group.position.copy(p.pos);
      return;
    }
    if (p.getupT > 0) {
      p.getupT -= dt;
      p.ch.state = 'getup';
      p.ch.animSpeed = 0;
      if (p.getupT <= 0) { p.state = 'idle'; p.ch.state = 'idle'; }
      return;
    }

    var dx = p.target.x - p.pos.x;
    var dz = p.target.z - p.pos.z;
    var d = Math.sqrt(dx * dx + dz * dz);

    var wantX = 0, wantZ = 0;
    if (d > 0.28) {
      /* a man sent to the wall jogs there — the referee is waiting on him */
      var cap = p.wallT > 0 ? Math.max(p.maxSpeed, 8.2) : p.maxSpeed;
      var spd = Math.min(cap, d * 2.6);
      if (p.role === 'GK' && d < 2) spd = Math.min(spd, 6.5);
      wantX = (dx / d) * spd;
      wantZ = (dz / d) * spd;
    }

    var accel = 7.5;
    p.vel.x = U.damp(p.vel.x, wantX, accel, dt);
    p.vel.z = U.damp(p.vel.z, wantZ, accel, dt);

    p.pos.x += p.vel.x * dt;
    p.pos.z += p.vel.z * dt;

    var lim = F.L / 2 + 2.5;
    var limz = F.W / 2 + 1.5;
    if (p.pos.x > lim) { p.pos.x = lim; p.vel.x = 0; }
    if (p.pos.x < -lim) { p.pos.x = -lim; p.vel.x = 0; }
    if (p.pos.z > limz) { p.pos.z = limz; p.vel.z = 0; }
    if (p.pos.z < -limz) { p.pos.z = -limz; p.vel.z = 0; }

    var speed = Math.sqrt(p.vel.x * p.vel.x + p.vel.z * p.vel.z);
    if (speed > 0.6) {
      p.facing = U.angleDamp(p.facing, Math.atan2(p.vel.x, p.vel.z), 9, dt);
    }

    p.ch.group.position.set(p.pos.x, 0, p.pos.z);
    p.ch.group.rotation.y = p.facing;
    p.ch.animSpeed = speed;

    if (p.argueT > 0) {
      p.argueT -= dt;
      p.ch.state = 'argue';
    } else if (p.state !== 'celebrate') {
      p.ch.state = speed > 0.8 ? 'run' : 'idle';
    }
  };

  Match.prototype.separate = function () {
    var n = this.players.length;
    for (var i = 0; i < n; i++) {
      var a = this.players[i];
      if (!a.active) continue;
      for (var j = i + 1; j < n; j++) {
        var b = this.players[j];
        if (!b.active) continue;
        var dx = b.pos.x - a.pos.x;
        var dz = b.pos.z - a.pos.z;
        var d2 = dx * dx + dz * dz;
        /* team-mates keep their distance, which is what makes the shape look
           spread out. An opponent may come right up to you — hold them off at
           1.9 m and nobody can ever tackle, so there are no fouls all game. */
        var min = a.team === b.team ? 1.9 : 0.62;
        if (d2 < min * min && d2 > 0.0001) {
          var d = Math.sqrt(d2);
          var push = (min - d) * 0.34;
          var nx = dx / d, nz = dz / d;
          a.pos.x -= nx * push; a.pos.z -= nz * push;
          b.pos.x += nx * push; b.pos.z += nz * push;
          a.ch.group.position.copy(a.pos);
          b.ch.group.position.copy(b.pos);
        }
      }
    }
  };

  /* ------------------------------------------------------------------ AI */
  /* x-distance of the second-last defender, measured in the attacking direction */
  Match.prototype.secondLastX = function (team, dir) {
    var arr = [];
    for (var i = 0; i < this.players.length; i++) {
      var o = this.players[i];
      if (!o.active || o.team === team) continue;
      arr.push(o.pos.x * dir);
    }
    arr.sort(function (a, b) { return b - a; });
    if (!arr.length) return 30;
    return arr.length > 1 ? arr[1] : arr[0];
  };

  /* the second-last defender, measured towards the goal being attacked:
     anything beyond this line is offside. Cached for the frame. */
  Match.prototype.defLine = function (team, attDir) {
    if (this._lineT !== this.time) { this._lineT = this.time; this._lineCache = {}; }
    var key = team + '|' + attDir;
    if (this._lineCache[key] !== undefined) return this._lineCache[key];
    var arr = [];
    for (var i = 0; i < this.players.length; i++) {
      var o = this.players[i];
      if (!o.active || o.team !== team) continue;
      arr.push(o.pos.x * attDir);
    }
    arr.sort(function (a, b) { return b - a; });
    var v = arr.length > 1 ? arr[1] : (arr.length ? arr[0] : -F.L / 2);
    this._lineCache[key] = v;
    return v;
  };

  Match.prototype.nearestToBall = function (team) {
    var best = null, bd = 1e9;
    for (var i = 0; i < this.players.length; i++) {
      var p = this.players[i];
      if (!p.active || p.team !== team || p.role === 'GK') continue;
      var d = U.distXZ(p.pos, this.ball.pos);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  };

  Match.prototype.keeperOf = function (team) {
    for (var i = 0; i < this.players.length; i++) {
      var p = this.players[i];
      if (p.team === team && p.role === 'GK' && p.active) return p;
    }
    return null;
  };

  /* where a player has to run to meet a moving ball */
  Match.prototype.intercept = function (p) {
    var b = this.ball;
    var bx = b.pos.x, bz = b.pos.z;
    var vx = b.vel.x, vz = b.vel.z;
    if (Math.abs(vx) + Math.abs(vz) < 1.2) return { x: bx, z: bz };

    /* walk the ball forward with the same friction it really has, and stop at
       the first moment the player can get there */
    for (var t = 0; t <= 2.4; t += 0.12) {
      if (t > 0) {
        var f = Math.exp(-1.35 * 0.12);
        vx *= f; vz *= f;
        bx += vx * 0.12;
        bz += vz * 0.12;
        if (bx > 54) bx = 54; else if (bx < -54) bx = -54;
        if (bz > 35) bz = 35; else if (bz < -35) bz = -35;
      }
      var d = Math.sqrt((bx - p.pos.x) * (bx - p.pos.x) + (bz - p.pos.z) * (bz - p.pos.z));
      if (d <= p.maxSpeed * t + 1.0) return { x: bx, z: bz };
    }
    return { x: bx, z: bz };
  };

  /* man-marking assignments, recomputed a few times a second */
  Match.prototype.assignMarks = function (team) {
    var dir = this.teams[team].dir;
    var ownGoal = -dir * (F.L / 2);
    var defs = [], opps = [];
    for (var i = 0; i < this.players.length; i++) {
      var p = this.players[i];
      if (!p.active) continue;
      if (p.team === team) {
        if (p.role === 'DEF') { p.mark = null; defs.push(p); }
      } else opps.push(p);
    }
    if (!defs.length) return;
    opps.sort(function (a, b) {
      return Math.abs(a.pos.x - ownGoal) - Math.abs(b.pos.x - ownGoal);
    });
    for (var o = 0; o < opps.length; o++) {
      var best = null, bd = 22;
      for (var k = 0; k < defs.length; k++) {
        if (defs[k].mark) continue;
        var d = U.distXZ(defs[k].pos, opps[o].pos);
        if (d < bd) { bd = d; best = defs[k]; }
      }
      if (best) best.mark = opps[o];
    }
  };

  Match.prototype.gkAI = function (p, dt) {
    var dir = this.teams[p.team].dir;
    var ownGoalX = -dir * (F.L / 2);
    var b = this.ball.pos;
    var dBall = U.distXZ(p.pos, b);

    /* with the ball in his gloves, the keeper looks to start an attack */
    if (this.owner === p) {
      p.holdT += dt;
      p.target.set(ownGoalX + dir * 2.4, 0, U.clamp(p.pos.z, -3, 3));
      if (p.holdT > 0.85) { p.holdT = 0; this.gkDistribute(p, dir); }
      return;
    }
    p.holdT = 0;

    var tx = ownGoalX + dir * 0.85;
    var tz = U.clamp(b.z * 0.55, -3.2, 3.2);
    var speed = 6.0;

    var towardGoal = (b.x - p.pos.x) * dir < 0;
    if (towardGoal) {
      /* narrow the angle as the ball comes closer */
      tz = U.clamp(b.z * 0.9, -3.5, 3.5);
      if (dBall < 20) {
        tx = ownGoalX + dir * (0.85 + U.clamp((20 - dBall) * 0.35, 0, 4.5));
        speed = 8.4;
      }
    }
    if (dBall < 3.2 && this.owner && this.owner.team !== p.team) {
      tx = b.x; tz = b.z; speed = 9.4;
    }

    /* a shot on goal: work out where it crosses the line and get across */
    var vx = this.ball.vel.x, vz = this.ball.vel.z;
    if (vx * dir < -8) {
      var tt = (ownGoalX - b.x) / vx;
      if (tt > 0 && tt < 1.6) {
        var zAt = b.z + vz * tt;
        if (Math.abs(zAt) < 8) {
          tz = U.clamp(zAt, -3.8, 3.8);
          tx = ownGoalX + dir * 0.6;
          speed = 10.4;
        }
      }
    }
    p.target.set(U.clamp(tx, -52, 52), 0, tz);
    p.maxSpeed = speed;
  };

  Match.prototype.gkDistribute = function (p, dir) {
    var mate = null, best = -1e9;
    for (var i = 0; i < this.players.length; i++) {
      var m = this.players[i];
      if (!m.active || m.team !== p.team || m === p) continue;
      var d = U.distXZ(m.pos, p.pos);
      if (d < 12) continue;
      var forward = (m.pos.x - p.pos.x) * dir;
      var oppNear = 1e9;
      for (var j = 0; j < this.players.length; j++) {
        var o = this.players[j];
        if (!o.active || o.team === p.team) continue;
        var od = U.distXZ(o.pos, m.pos);
        if (od < oppNear) oppNear = od;
      }
      var s = forward * 0.6 + Math.min(oppNear, 10) * 2.6 - d * 0.1;
      if (s > best) { best = s; mate = m; }
    }
    if (!mate) return;
    var b = this.ball;
    var dx = mate.pos.x + mate.vel.x * 0.6 - b.pos.x;
    var dz = mate.pos.z + mate.vel.z * 0.6 - b.pos.z;
    var len = Math.sqrt(dx * dx + dz * dz) || 1;
    var speed = U.clamp(len * 1.1, 16, 26);
    b.vel.set((dx / len) * speed, 4.2, (dz / len) * speed);
    p.kickCd = 0.8;
    p.noTouch = 0.5;
    this.owner = null;
    this.lastTouch = p;
    REF.Audio.kick(0.8);
  };

  /* --------------------------------------------------------- off the ball */
  /* where a player stands for a corner: attackers crowd the six-yard box,
     defenders pick up a man and stay goal-side of him */
  Match.prototype.cornerTarget = function (p) {
    var r = this.restart;
    var atk = r.team;
    var dir = this.teams[atk].dir;
    var gx = dir * (F.L / 2);
    var side = r.pos.z >= 0 ? 1 : -1;

    if (p.team === atk) {
      var i = p.idx;
      var tx = gx - dir * (3.0 + (i % 3) * 2.6);
      var tz = (i % 2 ? 1 : -1) * (1.8 + (i % 4) * 1.9) * side;
      p.target.set(U.clamp(tx, -50, 50), 0, U.clamp(tz, -31, 31));
      return;
    }

    var near = null, nd = 1e9;
    for (var k = 0; k < this.players.length; k++) {
      var o = this.players[k];
      if (!o.active || o.team !== atk || o.role === 'GK') continue;
      var d = Math.abs(o.pos.z - p.pos.z) + Math.abs(o.pos.x - p.pos.x) * 0.35;
      if (d < nd) { nd = d; near = o; }
    }
    if (near) p.target.set(U.clamp(near.pos.x + dir * 0.9, -50, 50), 0, U.clamp(near.pos.z, -31, 31));
    else p.target.copy(p.home);
  };

  Match.prototype.think = function (p, ownerTeam) {
    var dir = this.teams[p.team].dir;
    var b = this.ball.pos;
    var base = p.home;

    /* a wall stays exactly where the paint can told it to stand */
    if (p.wallT > 0 && p.wallPos) {
      p.target.copy(p.wallPos);
      return;
    }

    if (this.state !== 'play') {
      if (p === this.taker) { p.target.copy(p.pos); return; }
      if (this.state === 'setpiece' && this.restart) {
        if (this.restart.kind === 'corner') { this.cornerTarget(p); return; }
        if (this.restart.kind === 'goal-kick') {
          p.target.set(U.clamp(base.x * 0.55 + b.x * 0.45, -50, 50), 0, U.clamp(base.z, -31, 31));
          return;
        }
      }
      p.target.copy(base);
      p.target.x += b.x * 0.18;
      return;
    }

    var nearest = this.nearestToBall(p.team);
    var weHave = ownerTeam === p.team;
    var loose = ownerTeam < 0;

    /* the man on the ball chases it, and so does the man it was played to */
    if (!weHave && (p === nearest || this.passTo === p)) {
      var ip = this.intercept(p);
      p.target.set(U.clamp(ip.x, -50, 50), 0, U.clamp(ip.z, -31, 31));
      return;
    }

    var bu = b.x * dir;
    var baseU = base.x * dir;
    var halfW = F.W / 2 - 6;
    var u, z;

    if (weHave) {
      /* --------------------------------------------------- attacking shape
         the whole side pushes up with the ball: full-backs to the halfway
         line, one holder behind it, two shuttlers beyond, wide forwards
         hugging the touchline so there is a pass on. */
      if (p.role === 'DEF') {
        if (p.idx === 2 || p.idx === 3) {
          u = U.clamp(bu - 17, -36, 4);
          z = base.z * 0.95;
        } else {
          u = U.clamp(bu - 4, -12, 28);
          z = base.z * 1.05;
        }
      } else if (p.role === 'MID') {
        if (p.idx === 6) {
          u = U.clamp(bu - 9, -22, 26);
          z = base.z * 0.55;
        } else {
          u = U.clamp(bu + 8, -10, 38);
          z = base.z * 1.0;
        }
      } else if (p.idx === 9) {
        /* the centre-forward drops in as the pivot */
        var pl = this.secondLastX(p.team, dir);
        u = U.clamp(Math.min(bu + 9, pl - 1.2), 2, 44);
        z = base.z * 0.4;
      } else {
        /* wide forwards hold the line, then go in behind */
        p.runCd -= this.dt;
        if (p.runCd <= 0) {
          p.runCd = U.rand(2.2, 4.6);
          p.runT = U.chance(0.55) ? U.rand(0.9, 1.9) : 0;
        }
        var wl = this.secondLastX(p.team, dir);
        if (p.runT > 0) {
          p.runT -= this.dt;
          u = wl + (U.chance(0.4) ? U.rand(1.2, 3.0) : U.rand(-1.6, 0.8));
        } else {
          u = Math.max(bu + 11, wl - 7);
        }
        z = base.z > 0 ? halfW : -halfW;
      }
    } else if (!loose) {
      /* defending: mark up, squeeze the space */
      if (p.role === 'DEF' && p.mark && p.mark.active) {
        var ownGoal = -dir * (F.L / 2);
        var mx = p.mark.pos.x + (ownGoal - p.mark.pos.x) * 0.16;
        var mz = p.mark.pos.z + (0 - p.mark.pos.z) * 0.08;
        /* hold the back line while the ball is still behind it — chasing a
           runner in behind is what gets a defender caught out; once the ball
           is played through, pick the man up again */
        var attDir = -dir;
        var line = this.defLine(p.team, attDir);
        if (b.x * attDir < line && mx * attDir > line + 0.7) mx = (line + 0.7) * attDir;
        p.target.set(U.clamp(mx, -50, 50), 0, U.clamp(mz, -31, 31));
        return;
      }
      if (p.role === 'DEF') {
        u = U.clamp(bu - 6, -42, 16);
        z = base.z;
      } else if (p.role === 'MID') {
        u = U.clamp(bu - 4, -34, 28);
        z = base.z * 0.85 + b.z * 0.15;
      } else {
        /* the forwards stay high, ready to break */
        u = U.clamp(bu + 7, -14, 30);
        z = base.z * 0.9;
      }
    } else {
      /* loose ball: everyone shifts towards it, keeping some shape */
      u = baseU + (bu - baseU) * 0.35;
      z = base.z + (b.z - base.z) * 0.25;
      if (p.role === 'DEF') u = U.clamp(u, -46, 14);
    }

    p.target.set(U.clamp(u * dir, -50, 50), 0, U.clamp(z, -31, 31));
  };

  /* ------------------------------------------------------------- on the ball */
  Match.prototype.ownerAI = function (p, dt) {
    var dir = this.teams[p.team].dir;
    var b = this.ball.pos;
    var gx = dir * (F.L / 2);
    var distGoal = Math.sqrt((gx - p.pos.x) * (gx - p.pos.x) + b.z * b.z);

    var near = null, nd = 1e9;
    for (var i = 0; i < this.players.length; i++) {
      var o = this.players[i];
      if (!o.active || o.team === p.team) continue;
      var d = U.distXZ(o.pos, p.pos);
      if (d < nd) { nd = d; near = o; }
    }

    p.kickCd -= dt;
    p.aiT -= dt;

    if (p.kickCd <= 0 && p.aiT <= 0) {
      p.aiT = U.rand(0.18, 0.3);
      this.onBallDecision(p, dir, gx, distGoal, nd);
      if (p.kickCd > 0) return;
    }

    /* carry it forward, going round the man in front */
    var dx = gx - p.pos.x;
    var dz = U.clamp(b.z * 0.5, -10, 10) - p.pos.z;
    var len = Math.sqrt(dx * dx + dz * dz) || 1;
    dx /= len; dz /= len;

    if (near && nd < 6) {
      var ax = p.pos.x - near.pos.x;
      var az = p.pos.z - near.pos.z;
      var al = Math.sqrt(ax * ax + az * az) || 1;
      var w = (6 - nd) / 6;
      dx += (ax / al) * w * 0.75;
      dz += (az / al) * w * 0.75;
      dz += (p.pos.z >= near.pos.z ? 1 : -1) * w * 0.5;
      var l2 = Math.sqrt(dx * dx + dz * dz) || 1;
      dx /= l2; dz /= l2;
    }

    var spd = p.maxSpeed * (nd < 1.5 ? 0.85 : 1);
    p.target.set(
      U.clamp(p.pos.x + dx * spd * 0.6, -50, 50), 0,
      U.clamp(p.pos.z + dz * spd * 0.6, -30, 30)
    );
  };

  Match.prototype.onBallDecision = function (p, dir, gx, distGoal, nd) {
    var central = Math.abs(p.pos.z) < 26;

    /* shoot from a real position — and never turn down the box */
    if (distGoal < 34 && central && nd > 0.9) {
      var sc = distGoal < 12 ? 0.95
        : (distGoal < 20 ? 0.8 : (distGoal < 27 ? 0.55 : 0.3));
      if (U.chance(sc)) { this.shoot(p, gx); return; }
    }

    var opt = this.bestPass(p, dir);
    if (opt && opt.mate) {
      /* football is a passing game: look for the ball forward most of the time */
      var want = 0.34;
      if (nd < 1.6) want = 0.94;
      else if (nd < 3) want = 0.62;
      else if (nd < 6) want = 0.44;
      if (opt.score < -6) want *= 0.45;        /* nothing on at all */
      if (opt.mate.role === 'FWD' && opt.score > 20) want = Math.max(want, 0.6);
      if (U.chance(want)) { this.pass(p, opt.mate); return; }
    }

    /* every so often a forward's run is picked out too early */
    if (opt && opt.offside && U.chance(0.38)) { this.pass(p, opt.offside); return; }

    /* trapped at the back — get rid of it */
    if (nd < 2 && p.pos.x * dir < -28) this.clear(p, dir);
  };

  Match.prototype.bestPass = function (p, dir) {
    var best = null, bestScore = -1e9;
    var off = null, offScore = -1e9;
    for (var i = 0; i < this.players.length; i++) {
      var m = this.players[i];
      if (!m.active || m.team !== p.team || m === p || m.role === 'GK') continue;
      var d = U.distXZ(m.pos, p.pos);
      if (d < 5 || d > 45) continue;

      var forward = (m.pos.x - p.pos.x) * dir;

      /* how much room has the receiver got, and is the lane clear? */
      var oppNear = 1e9;
      for (var j = 0; j < this.players.length; j++) {
        var o = this.players[j];
        if (!o.active || o.team === p.team) continue;
        var od = U.distXZ(o.pos, m.pos);
        if (od < oppNear) oppNear = od;
      }
      var lane = 0;
      for (var k = 0; k < this.players.length; k++) {
        var q = this.players[k];
        if (!q.active || q.team === p.team) continue;
        if (segDist2(q.pos.x, q.pos.z, p.pos.x, p.pos.z, m.pos.x, m.pos.z) < 5.76) lane++;
      }

      var score = forward * 1.15 + Math.min(oppNear, 12) * 2.6 - d * 0.34 - lane * 11;
      if (forward < -4) score -= 8;
      if (oppNear < 2.4) score -= 10;
      if (m.role === 'FWD' && m.runT > 0 && forward > 3) score += 12;

      if (this.wouldBeOffside(p, m)) {
        if (score > offScore) { offScore = score; off = m; }
        continue;
      }
      if (score > bestScore) { bestScore = score; best = m; }
    }
    if (!best && !off) return null;
    return { mate: best, score: bestScore, offside: off };
  };

  Match.prototype.shoot = function (p, gx) {
    var b = this.ball;
    var dist = Math.sqrt((gx - b.pos.x) * (gx - b.pos.x) + b.pos.z * b.pos.z);

    /* pick a corner — the one the keeper is not standing in */
    var gk = this.keeperOf(1 - p.team);
    var aimZ;
    if (gk) {
      var away = gk.pos.z >= 0 ? -1 : 1;
      aimZ = away * U.rand(2.4, 3.3);
      if (U.chance(0.2)) aimZ = -away * U.rand(2.3, 3.0);
    } else {
      aimZ = U.rand(-3.1, 3.1);
    }
    /* no striker is a machine: the further out, the wider the spread */
    var err = U.rand(-1, 1) * (0.5 + dist * 0.052);
    aimZ = U.clamp(aimZ + err, -5.2, 5.2);

    var dx = gx - b.pos.x;
    var dz = aimZ - b.pos.z;
    var len = Math.sqrt(dx * dx + dz * dz) || 1;
    /* enough power to still be travelling when it reaches the goal */
    var power = U.clamp(BALL_DRAG * len + 20, 24, 44);

    /* time to the line with the real friction, then the lift that puts the
       ball at a chosen height when it gets there */
    var frac = 1 - BALL_DRAG * len / power;
    var t = frac > 0.06 ? Math.log(1 / frac) / BALL_DRAG : 0.6;
    t = U.clamp(t, 0.12, 1.2);
    var wantY = U.rand(0.35, 1.95);
    var vy = (wantY - b.pos.y + 0.5 * GRAV * t * t) / t;

    b.vel.set((dx / len) * power, U.clamp(vy, -0.4, 8.4), (dz / len) * power);
    p.kickCd = 1.2;
    p.noTouch = 0.5;
    this.owner = null;
    b.lastShotBy = p;
    this.lastTouch = p;
    REF.Audio.kick(1);
    this.log('shot', p.name + ' lets fly!');
    this.emit('shot', p);
  };

  Match.prototype.pass = function (p, mate) {
    var b = this.ball;
    var offside = this.wouldBeOffside(p, mate);
    var dx = mate.pos.x - b.pos.x;
    var dz = mate.pos.z - b.pos.z;
    var len = Math.sqrt(dx * dx + dz * dz) || 1;

    /* lead the receiver: work out where he will be when the ball gets there,
       and weight the pass so it arrives at his feet rather than past him */
    var ax = mate.pos.x, az = mate.pos.z, t = 0.6, speed = 20;
    for (var it = 0; it < 4; it++) {
      var lx = ax - b.pos.x, lz = az - b.pos.z;
      var L = Math.sqrt(lx * lx + lz * lz) || 1;
      var arrive = 4.5 + L * 0.08;
      speed = U.clamp(BALL_DRAG * L + arrive, 11, 36);
      t = Math.log(speed / arrive) / BALL_DRAG;
      ax = mate.pos.x + mate.vel.x * t;
      az = mate.pos.z + mate.vel.z * t;
    }
    dx = ax - b.pos.x;
    dz = az - b.pos.z;
    var l2 = Math.sqrt(dx * dx + dz * dz) || 1;
    b.vel.set((dx / l2) * speed, len > 20 ? 2.2 : 0.6, (dz / l2) * speed);
    p.kickCd = 0.6;
    p.noTouch = 0.45;
    this.owner = null;
    this.lastTouch = p;
    this.passTo = mate;
    this.passGuard = 0.16;
    this.passGuardTeam = p.team;
    REF.Audio.kick(0.5);
    if (offside) this.flagOffside(mate);
  };

  Match.prototype.clear = function (p, dir) {
    var b = this.ball;
    var z = U.rand(-18, 18);
    var dx = dir * 34;
    var dz = z - b.pos.z;
    var len = Math.sqrt(dx * dx + dz * dz) || 1;
    b.vel.set((dx / len) * 30, 5.5, (dz / len) * 30);
    p.kickCd = 0.7;
    p.noTouch = 0.4;
    this.owner = null;
    this.lastTouch = p;
    REF.Audio.kick(0.9);
    this.log('clearance', p.name + ' hacks it clear');
  };

  /* -------------------------------------------------------------- offside */
  Match.prototype.wouldBeOffside = function (from, mate) {
    var dir = this.teams[mate.team].dir;
    var b = this.ball.pos;
    if (mate.pos.x * dir <= 0) return false;
    if (mate.pos.x * dir <= b.x * dir) return false;
    var defendersAhead = 0;
    for (var i = 0; i < this.players.length; i++) {
      var o = this.players[i];
      if (!o.active || o.team === mate.team) continue;
      if (o.pos.x * dir > mate.pos.x * dir) defendersAhead++;
    }
    return defendersAhead < 2;
  };

  Match.prototype.flagOffside = function (mate) {
    if (this.pendingOffside) return;
    this.pendingOffside = {
      player: mate,
      pos: mate.pos.clone(),
      t: 5.0
    };
    this.log('offside', 'Assistant raises the flag — ' + mate.name + ' offside!');
    this.emit('offside', mate);
  };

  /* ----------------------------------------------------------------- foul */
  Match.prototype.commitFoul = function (offender, victim, severity) {
    if (victim.downT > 0) return;
    if (this.decision || this.frozen) return;
    victim.downT = U.rand(1.8, 2.6);
    victim.state = 'down';
    victim.ch.state = 'down';
    victim.anger = Math.min(100, victim.anger + 34);
    victim.argueT = 2.2;
    offender.anger = Math.min(100, offender.anger + 8);
    offender.tackleCd = 2.2;

    var b = this.ball;
    b.vel.multiplyScalar(0.12);

    var f = {
      offender: offender,
      victim: victim,
      pos: victim.pos.clone(),
      team: offender.team,
      severity: severity || 'normal',
      t: 6.0,
      min: this.min
    };
    this.pendingFoul = f;
    this.lastFoul = f;
    this.stats.fouls++;
    REF.Save.stat('fouls');
    REF.Audio.kick(0.9);
    this.log('foul', 'Foul by ' + offender.name + ' on ' + victim.name);
    this.askFoul(f);
    this.emit('foul', f);
  };

  /* where the foul happened, in words the referee can act on */
  Match.prototype.foulText = function (f) {
    var att = 1 - f.team;
    var dir = this.teams[att].dir;
    var gx = dir * (F.L / 2);
    var dg = Math.sqrt((gx - f.pos.x) * (gx - f.pos.x) + f.pos.z * f.pos.z);
    var inBox = Math.abs(gx - f.pos.x) < 16.5 && Math.abs(f.pos.z) < 20.16;
    var where = inBox ? 'inside the penalty area'
      : (dg > 60 ? 'deep in his own half'
        : (dg > 38 ? 'in midfield' : 'about ' + Math.round(dg) + ' m from goal'));
    var side = Math.abs(f.pos.z) < 8 ? 'central' : (f.pos.z > 0 ? 'right of centre' : 'left of centre');
    var verb = f.severity === 'hard' ? 'clatters through'
      : (f.severity === 'soft' ? 'clips' : 'takes out');
    var txt = f.offender.name + ' ' + verb + ' ' + f.victim.name + ' ' + where + ', ' + side + '.';
    if (inBox) txt += ' The foul is in the box — the penalty spot is in play.';
    return txt;
  };

  Match.prototype.askFoul = function (f) {
    var self = this;
    this.decision = {
      kind: 'foul',
      kicker: 'FOUL  ·  ' + Math.floor(this.min) + "'",
      title: 'How do you deal with it?',
      text: this.foulText(f),
      options: [
        { id: 'ignore', label: 'Play on', sub: 'No foul', tone: 'ghost' },
        { id: 'warn', label: 'Have a word', sub: 'No card', tone: 'warn' },
        { id: 'yellow', label: 'Yellow card', sub: 'Book him', tone: 'yellow' },
        { id: 'red', label: 'Red card', sub: 'Send him off', tone: 'red' }
      ],
      apply: function (id) { self.applyFoul(f, id); }
    };
    this.emit('decision', this.decision);
  };

  Match.prototype.applyFoul = function (f, id) {
    if (id === 'ignore') {
      this.log('play-on', 'Play on — ' + f.offender.name + ' gets away with it');
      this.pendingFoul = null;
      this.ball.vel.set(U.rand(-3, 3), 1.2, U.rand(-3, 3));
      this.frozen = false;
      this.emit('resumed', null);
      return;
    }

    if (id === 'warn') {
      this.log('warn', f.offender.name + ' is warned — no card');
      f.offender.anger = Math.max(0, f.offender.anger - 8);
      f.victim.anger = Math.max(0, f.victim.anger - 18);
    } else if (id === 'yellow') {
      this.showCard(f.offender, 'yellow');
    } else if (id === 'red') {
      this.showCard(f.offender, 'red');
    }

    var att = 1 - f.team;
    var dir = this.teams[att].dir;
    var gx = dir * (F.L / 2);
    var inBox = Math.abs(gx - f.pos.x) < 16.5 && Math.abs(f.pos.z) < 20.16;
    if (inBox) {
      this.setPiece('penalty', new THREE.Vector3(gx - dir * 11, 0, 0), att);
      this.log('penalty', 'Penalty to ' + this.teamName(att));
    } else {
      this.setPiece('free-kick', f.pos.clone(), att);
      this.log('free-kick', 'Free kick to ' + this.teamName(att) + ' — blow to restart');
    }
  };

  /* every decision the referee makes comes back through here */
  Match.prototype.resolve = function (id) {
    var d = this.decision;
    if (!d) return false;
    var ok = false;
    for (var i = 0; i < d.options.length; i++) if (d.options[i].id === id) ok = true;
    if (!ok) return false;
    this.decision = null;
    if (d.apply) d.apply.call(this, id);
    this.emit('decision', null);
    return true;
  };

  Match.prototype.tryTackle = function (defender, attacker) {
    if (defender.tackleCd > 0 || attacker.downT > 0 || defender.noTouch > 0) return;
    if (attacker.controlT > 0) return;
    if (U.distXZ(defender.pos, attacker.pos) > 1.7) return;
    defender.tackleCd = U.rand(1.1, 2.0);
    if (U.chance(0.5)) {
      this.owner = defender;
      defender.controlT = 0.25;
      this.ball.pos.x = defender.pos.x + Math.sin(defender.facing) * 0.4;
      this.ball.pos.z = defender.pos.z + Math.cos(defender.facing) * 0.4;
      this.ball.vel.set(0, 0, 0);
      this.lastTouch = defender;
      this.log('tackle', defender.name + ' wins it back');
    } else if (U.chance(0.5)) {
      this.commitFoul(defender, attacker, 'normal');
    } else {
      /* shoulder to shoulder — the ball squirts away */
      this.owner = null;
      attacker.noTouch = 0.3;
      this.ball.vel.set(U.rand(-4.5, 4.5), 1.6, U.rand(-4.5, 4.5));
      this.lastTouch = defender;
    }
  };

  /* ---------------------------------------------------------------- goals */
  /* a keeper gets a hand to anything he can get across to in time */
  Match.prototype.keeperSave = function () {
    var b = this.ball;
    var sp = b.vel.length();
    if (sp < 6) return false;
    var sign = b.pos.x > 0 ? 1 : -1;
    if (Math.abs(b.pos.x) < F.L / 2 - 6.5) return false;
    var defTeam = sign > 0 ? 1 : 0;
    var gk = this.keeperOf(defTeam);
    if (!gk || !gk.active || gk.downT > 0) return false;
    if (b.pos.y > F.goalH + 1.0) return false;

    var vx = b.vel.x;
    if (vx * sign <= 0) return false;
    var t = (sign * (F.L / 2) - b.pos.x) / vx;
    if (t < 0 || t > 1.2) return false;

    var zAt = b.pos.z + b.vel.z * t;
    var yAt = b.pos.y + b.vel.y * t - 0.5 * GRAV * t * t;
    if (Math.abs(zAt) > F.goalW / 2 + 0.9) return false;   /* going wide */
    if (yAt > F.goalH + 0.35) return false;                 /* over the bar */

    /* the dive: how far across can he get before it arrives? */
    var reach = 0.95 + Math.min(1.75, t * 5.0);
    if (yAt > 1.5) reach *= 0.82;            /* high shots are harder */
    if (sp > 36) reach *= 0.9;
    var gap = Math.abs(zAt - gk.pos.z);
    if (gap > reach) return false;

    /* parried, not caught */
    var out = sign * (F.L / 2 - 0.55);
    b.pos.x = out;
    b.pos.z = U.clamp(zAt, -F.goalW / 2, F.goalW / 2);
    b.pos.y = Math.max(BALL_R, Math.min(b.pos.y, 2.1));
    b.vel.set(-sign * U.rand(5, 11), U.rand(2.5, 5), U.rand(-7, 7));
    gk.ch.state = 'dive';
    gk.diveDir = b.pos.z > gk.pos.z ? -1.2 : 1.2;
    gk.diveT = 0.75;
    gk.noTouch = 0.15;
    this.lastTouch = gk;
    this.ball.lastShotBy = null;
    REF.Audio.kick(0.85);
    this.log('save', 'Save by ' + gk.name + '!');
    this.emit('save', gk);
    return true;
  };

  Match.prototype.checkGoal = function () {
    var b = this.ball.pos;
    if (Math.abs(b.z) > F.goalW / 2) return false;
    if (b.y > F.goalH) return false;

    var team = null;
    if (b.x > F.L / 2 + 0.12) team = 0;
    else if (b.x < -F.L / 2 - 0.12) team = 1;
    if (team === null) return false;

    this.askGoal(team);
    return true;
  };

  /* the ball is in the net — but only the referee can give it */
  Match.prototype.askGoal = function (team) {
    var self = this;
    var scorer = this.lastTouch && this.lastTouch.team === team ? this.lastTouch : this.ball.lastShotBy;
    this.ball.vel.set(0, 0, 0);
    var sc = this.score.slice();
    sc[team]++;
    var line = this.teamName(0) + ' ' + sc[0] + '-' + sc[1] + ' ' + this.teamName(1);
    this.lastGoalCall = { team: team, scorer: scorer, min: this.min, confirmed: null };

    this.decision = {
      kind: 'goal',
      kicker: 'GOAL DECISION  ·  ' + Math.floor(this.min) + "'",
      title: 'Is it a goal?',
      text: (scorer ? scorer.name : 'The ball') + ' puts it in for ' + this.teamName(team) +
        '. Give it and the score reads ' + line + '.',
      options: [
        { id: 'goal', label: 'Goal', sub: 'Point to the centre spot', tone: 'ok' },
        { id: 'no-goal', label: 'No goal', sub: 'Rule it out', tone: 'no' }
      ],
      apply: function (id) {
        self.lastGoalCall.confirmed = id === 'goal';
        if (id === 'goal') {
          self.scoreGoal(team);
        } else {
          self.log('no-goal', 'No goal — ' + (scorer ? scorer.name : 'the goal') + ' is ruled out');
          var gx = (team === 0 ? 1 : -1) * (F.L / 2 - 5);
          self.setPiece('goal-kick', new THREE.Vector3(gx, 0, U.rand(-4.5, 4.5)), 1 - team);
        }
      }
    };
    this.emit('decision', this.decision);
  };

  Match.prototype.scoreGoal = function (team) {
    var scorer = this.lastTouch && this.lastTouch.team === team ? this.lastTouch : this.ball.lastShotBy;
    this.score[team]++;
    this.teams[team].score = this.score[team];
    this.stats.goals++;
    REF.Save.stat('goals');
    REF.Save.ach('goal');

    var name = scorer ? scorer.name : 'Someone';
    this.log('goal', 'GOAL! ' + name + ' — ' + this.teamName(0) + ' ' + this.score[0] + '-' + this.score[1] + ' ' + this.teamName(1));
    this.state = 'goal';
    this.stateT = 4.0;
    this.goalTeam = team;
    this.owner = null;

    for (var i = 0; i < this.players.length; i++) {
      var p = this.players[i];
      if (!p.active) continue;
      if (p.team === team) {
        p.ch.state = 'celebrate';
        p.state = 'celebrate';
        p.argueT = 0;
        if (scorer) { p.target.copy(scorer.pos); p.target.x += U.rand(-6, 6); }
      } else {
        p.ch.state = 'idle';
        p.state = 'idle';
        p.argueT = 0;
        p.anger = Math.min(100, p.anger + 6);
      }
    }
    if (scorer) {
      scorer.state = 'celebrate';
      scorer.ch.state = 'celebrate';
      scorer.anger = Math.max(0, scorer.anger - 25);
      scorer.lastGoal = this.time;
    }
    REF.Audio.cheer(1);
    this.emit('goal', { team: team, scorer: scorer });
  };

  Match.prototype.checkBounds = function () {
    var b = this.ball.pos;
    var halfL = F.L / 2, halfW = F.W / 2;

    if (Math.abs(b.z) > halfW + 0.15) {
      var z = Math.sign(b.z) * (halfW - 0.35);
      var x = U.clamp(b.x, -halfL + 2, halfL - 2);
      var team = this.lastTouch ? 1 - this.lastTouch.team : 0;
      this.log('throw-in', 'Throw-in — ' + this.teamName(team));
      this.setPiece('throw-in', new THREE.Vector3(x, 0, z), team);
      return;
    }

    if (Math.abs(b.x) > halfL + 0.15) {
      var goalSign = Math.sign(b.x);
      var attacker = this.teams[0].dir === goalSign ? 0 : 1;
      var defender = 1 - attacker;
      var last = this.lastTouch ? this.lastTouch.team : defender;
      if (last === attacker) {
        /* the keeper restarts from inside his six-yard box */
        var gx = goalSign * (halfL - 5);
        this.log('goal-kick', 'Goal kick — ' + this.teamName(defender));
        this.setPiece('goal-kick', new THREE.Vector3(gx, 0, U.rand(-4.5, 4.5)), defender);
      } else {
        /* the corner taker stands right on the arc */
        var cx = goalSign * (halfL - 0.35);
        var cz = Math.sign(b.z || 1) * (halfW - 0.35);
        this.log('corner', 'Corner — ' + this.teamName(attacker));
        this.setPiece('corner', new THREE.Vector3(cx, 0, cz), attacker);
      }
    }
  };

  /* ------------------------------------------------------- referee inputs */
  Match.prototype.whistle = function () {
    if (this.frozen || this.awaiting || this.decision) return 'busy';

    this.stats.whistles++;
    REF.Save.stat('whistles');
    REF.Audio.whistle();

    var r = REF.Ref ? REF.Ref.pos : null;
    for (var i = 0; i < this.players.length; i++) {
      var p = this.players[i];
      if (!p.active || !r) continue;
      if (U.distXZ(p.pos, r) < 16 && p.downT <= 0) {
        p.ch.state = 'look';
        p.lookYaw = U.angleWrap(Math.atan2(r.x - p.pos.x, r.z - p.pos.z) - p.facing);
        p.lookT = 1.4;
      }
    }

    /* the flag is up: the whistle calls the offside, and the free kick is
       set straight away — the referee whistles again to restart */
    if (this.pendingOffside && this.pendingOffside.t > 0) {
      var o = this.pendingOffside;
      this.pendingOffside = null;
      this.stats.offsides++;
      REF.Save.stat('offsides');
      REF.Save.ach('offside');
      this.log('offside-call', 'Offside called on ' + o.player.name);
      this.setPiece('free-kick', o.pos.clone(), 1 - o.player.team);
      this.emit('offside-called', o);
      return 'offside';
    }

    /* the whistle stops the match dead — the clock and every player wait for
       the referee to press Continue */
    this.frozen = true;
    this.freezeT = 0;
    this.freezeAction = null;
    this.emit('whistle', null);
    return 'none';
  };

  /* Continue: hand the match back to the players. Whatever the whistle
     interrupted (a free kick, an offside) is set up first. */
  Match.prototype.continuePlay = function () {
    if (!this.frozen || this.decision || this.awaiting) return false;
    var act = this.freezeAction;
    this.freezeAction = null;
    this.frozen = false;
    this.freezeT = 0;
    if (act) act.call(this);
    this.emit('resumed', null);
    return true;
  };

  Match.prototype.afterFreeze = function () { return this.continuePlay(); };

  /* ------------------------------------------------------------------ VAR */
  Match.prototype.varReview = function () {
    if (this.decision) return { ok: false, msg: 'Make the call on the pitch first' };
    var g = this.lastGoalCall;
    if (!g || g.confirmed === null) return { ok: false, msg: 'VAR: no goal decision to review' };
    if (this.min - g.min > 10) return { ok: false, msg: 'VAR: that was too long ago to review' };
    var self = this;
    this.frozen = true;
    this.decision = {
      kind: 'var',
      kicker: 'VAR REVIEW  ·  ' + Math.floor(g.min) + "'",
      title: 'Was that a goal?',
      text: 'The monitor replays the ' + Math.floor(g.min) + "' incident. You " +
        (g.confirmed ? 'awarded the goal' : 'ruled it out') + '. Confirm it or turn it over.',
      options: [
        { id: 'confirm', label: 'Confirm', sub: 'The call stands', tone: 'ok' },
        { id: 'overturn', label: 'Overturn', sub: 'Change the decision', tone: 'no' }
      ],
      apply: function (id) {
        if (id === 'confirm') {
          self.frozen = false;
          self.emit('resumed', null);
          return;
        }
        if (g.confirmed) {
          /* take the goal back off the board */
          self.score[g.team] = Math.max(0, self.score[g.team] - 1);
          self.teams[g.team].score = self.score[g.team];
          self.stats.goals = Math.max(0, self.stats.goals - 1);
          g.confirmed = false;
          self.frozen = false;
          self.log('var', 'VAR overturns it — the goal is chalked off');
          var gx = (g.team === 0 ? 1 : -1) * (F.L / 2 - 5);
          self.setPiece('goal-kick', new THREE.Vector3(gx, 0, U.rand(-4.5, 4.5)), 1 - g.team);
        } else {
          g.confirmed = true;
          self.frozen = false;
          self.log('var', 'VAR overturns it — the goal stands');
          self.scoreGoal(g.team);
        }
      }
    };
    this.emit('decision', this.decision);
    return { ok: true };
  };

  Match.prototype.showCard = function (p, type) {
    if (!p || !p.active) return null;

    if (type === 'yellow') {
      p.yellow++;
      this.stats.yellows++;
      REF.Save.stat('yellows');
      REF.Save.ach('first_yellow');
      REF.Audio.card(false);
      if (p.yellow >= 2) {
        this.log('card', 'Second yellow — ' + p.name + ' is sent off!');
        REF.Save.ach('second_yellow');
        this.sendOff(p, true);
        this.emit('card', { player: p, type: 'yellow', second: true });
        return 'second-yellow';
      }
      p.anger = Math.min(100, p.anger + 42);
      p.argueT = 4;
      if (REF.Ref) p.target.set(REF.Ref.pos.x + U.rand(-1.2, 1.2), 0, REF.Ref.pos.z + U.rand(-1.2, 1.2));
      this.log('card', 'Yellow card — ' + p.name);
      this.emit('card', { player: p, type: 'yellow', second: false });
      return 'yellow';
    }

    if (type === 'red') {
      REF.Save.ach('first_red');
      REF.Audio.card(true);
      this.log('card', 'RED CARD — ' + p.name + ' is off!');
      this.sendOff(p, false);
      this.emit('card', { player: p, type: 'red', second: false });
      return 'red';
    }
    return null;
  };

  Match.prototype.sendOff = function (p, secondYellow) {
    p.sentOff = true;
    p.active = false;
    p.yellow = secondYellow ? p.yellow : 0;
    p.state = 'walkoff';
    p.walkOff = 0;
    p.ch.state = 'argue';
    this.stats.reds++;
    REF.Save.stat('reds');
    p.anger = 100;
    this.owner = null;

    var teamMates = this.activeOf(p.team);
    for (var i = 0; i < teamMates.length; i++) {
      var m = teamMates[i];
      m.anger = Math.min(100, m.anger + 16);
      if (U.distXZ(m.pos, p.pos) < 12 && U.chance(0.55)) {
        m.argueT = U.rand(3, 6);
        m.target.copy(REF.Ref ? REF.Ref.pos : p.pos);
      }
    }
    this.emit('sendoff', p);
  };

  Match.prototype.cardCount = function (p) {
    return p.yellow;
  };

  /* a decision is open: nobody moves, nothing happens */
  Match.prototype.holdStill = function (dt) {
    this.dt = dt;
    for (var i = 0; i < this.players.length; i++) {
      var p = this.players[i];
      p.vel.set(0, 0, 0);
      p.ch.animSpeed = 0;
      if (p.downT > 0) p.ch.state = 'down';
    }
    this.emit('tick', null);
  };

  /* a dead ball: everyone walks to his position and waits for the whistle */
  Match.prototype.awaitUpdate = function (dt) {
    this.dt = dt;
    this.decideT -= dt;
    var decide = this.decideT <= 0;
    if (decide) {
      this.decideT = U.rand(0.1, 0.18);
      this.assignMarks(0);
      this.assignMarks(1);
    }

    for (var i = 0; i < this.players.length; i++) {
      var p = this.players[i];
      if (!p.active) continue;
      if (p.downT > 0) {
        p.downT -= dt;
        p.ch.state = 'down';
        p.ch.animSpeed = 0;
        if (p.downT <= 0) { p.state = 'idle'; p.ch.state = 'idle'; }
        continue;
      }
      if (p.kickCd > 0) p.kickCd -= dt;
      if (p.tackleCd > 0) p.tackleCd -= dt;
      if (p.lookT > 0) p.lookT -= dt;

      if (p === this.taker) {
        p.target.copy(p.pos);
      } else if (p.role === 'GK') {
        this.gkAI(p, dt);
      } else if (decide) {
        this.think(p, -1);
      }
      this.movePlayer(p, dt);
    }

    this.separate();
    for (var a = 0; a < this.players.length; a++) {
      REF.Actors.animate(this.players[a].ch, dt, this.time);
    }
    this.emit('tick', null);
  };

  /* ----------------------------------------------------------------- tick */
  Match.prototype.update = function (dt) {
    if (this.ended) return;

    /* a call has to be made before anybody moves */
    if (this.decision) { this.holdStill(dt); return; }

    /* a dead ball: the players take up their positions and wait for the
       referee's whistle. No clock, no ball, no possession. */
    if (this.awaiting) {
      this.time += dt;
      this.awaitUpdate(dt);
      return;
    }

    /* the whistle stops the match completely: no clock, no movement, no
       animation — nothing happens until Continue. The one exception is a wall
       that has just been painted: those four still walk onto their line, so
       you can see what you marked before you restart the game. */
    if (this.frozen) {
      for (var f = 0; f < this.players.length; f++) {
        var fp = this.players[f];
        if (fp.wallT > 0 && fp.wallPos) {
          fp.target.copy(fp.wallPos);
          this.movePlayer(fp, dt);
          fp.facing = Math.atan2(this.ball.pos.x - fp.pos.x, this.ball.pos.z - fp.pos.z);
          fp.ch.group.rotation.y = fp.facing;
        } else {
          fp.ch.animSpeed = 0;
        }
      }
      this.emit('tick', null);
      return;
    }

    this.time += dt;
    this.dt = dt;

    var ticking = this.state === 'play' || this.state === 'setpiece';
    if (ticking) this.min += dt * (1 / 1.35);

    if (this.state === 'goal') {
      this.stateT -= dt;
      if (this.stateT <= 0) {
        this.state = 'play';
        this.kickoff(1 - this.goalTeam, true);
      }
    } else if (this.state === 'halftime') {
      this.stateT -= dt;
      if (this.stateT <= 0) {
        this.half = 2;
        this.state = 'play';
        this.kickoff(1, true);
      }
    }

    if (this.half === 1 && this.min >= 45 && this.state !== 'halftime' && this.state !== 'goal') {
      this.state = 'halftime';
      this.stateT = 3.0;
      this.log('half-time', 'Half time — ' + this.score[0] + '-' + this.score[1]);
      this.emit('halftime', null);
      REF.Audio.whistle();
    }

    if (this.min >= 90 && !this.ended) {
      this.finish();
      return;
    }

    if (this.pendingFoul) {
      this.pendingFoul.t -= dt;
      if (this.pendingFoul.t <= 0) this.pendingFoul = null;
    }
    if (this.pendingOffside) {
      this.pendingOffside.t -= dt;
      if (this.pendingOffside.t <= 0) this.pendingOffside = null;
    }

    this.decideT -= dt;
    var decide = this.decideT <= 0;
    if (decide) {
      this.decideT = U.rand(0.1, 0.18);
      this.assignMarks(0);
      this.assignMarks(1);
    }

    var ownerTeam = this.owner ? this.owner.team : -1;

    for (var i = 0; i < this.players.length; i++) {
      var p = this.players[i];
      if (!p.active) continue;
      if (p.kickCd > 0) p.kickCd -= dt;
      if (p.tackleCd > 0) p.tackleCd -= dt;
      if (p.noTouch > 0) p.noTouch -= dt;
      if (p.lookT > 0) p.lookT -= dt;
      if (p.anger > 0) p.anger = Math.max(0, p.anger - dt * 0.85);

      if (p.ch.state === 'look' && p.lookT <= 0) p.ch.state = 'idle';

      if (this.state === 'goal') {
        if (p.team === this.goalTeam && p.ch.state !== 'celebrate') p.ch.state = 'celebrate';
        this.movePlayer(p, dt);
        continue;
      }

      if (p.role === 'GK') this.gkAI(p, dt);
      else if (this.state === 'play' && this.owner === p) this.ownerAI(p, dt);
      else if (decide) this.think(p, ownerTeam);

      this.movePlayer(p, dt);
    }

    this.separate();

    /* sent-off players trudge off the pitch */
    for (var w = 0; w < this.players.length; w++) {
      var off = this.players[w];
      if (off.active || !off.sentOff || !off.ch.group.visible) continue;
      off.walkOff += dt;
      var sz = off.pos.z >= 0 ? 1 : -1;
      off.pos.z += sz * 4.4 * dt;
      off.ch.group.position.copy(off.pos);
      off.ch.group.rotation.y = sz > 0 ? 0 : Math.PI;
      off.ch.animSpeed = 4.4;
      off.ch.state = off.walkOff > 3 ? 'argue' : 'run';
      if (off.walkOff > 8 || Math.abs(off.pos.z) > 37) off.ch.group.visible = false;
    }

    if (this.state === 'play') {
      this.updatePossession();
      this.updateBall(dt);

      /* tackles */
      var carrier = this.owner;
      if (carrier && carrier.active) {
        for (var k = 0; k < this.players.length; k++) {
          var d = this.players[k];
          if (!d.active || d.team === carrier.team) continue;
          if (U.distXZ(d.pos, carrier.pos) < 1.7) {
            this.tryTackle(d, carrier);
            if (this.owner !== carrier) break;
          }
        }
      }

      /* ball vs players (deflections + keeper saves) */
      for (var m = 0; m < this.players.length; m++) {
        var q = this.players[m];
        if (!q.active || q === this.owner) continue;
        var rad = q.role === 'GK' ? 0.85 : 0.5;
        var dx = this.ball.pos.x - q.pos.x;
        var dz = this.ball.pos.z - q.pos.z;
        var dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < rad && this.ball.pos.y < 1.9) {
          var nx = dist > 0.01 ? dx / dist : 1;
          var nz = dist > 0.01 ? dz / dist : 0;
          var spd = this.ball.vel.length();
          this.ball.pos.x = q.pos.x + nx * rad;
          this.ball.pos.z = q.pos.z + nz * rad;
          if (q.role === 'GK' && spd > 9) {
            this.ball.vel.set(nx * spd * 0.35, U.rand(1, 3), nz * spd * 0.35);
            q.ch.state = 'dive';
            q.diveDir = nz > 0 ? -1.1 : 1.1;
            q.diveT = 0.7;
            REF.Audio.kick(0.8);
            this.log('save', 'Save by ' + q.name + '!');
            this.lastTouch = q;
            this.ball.lastShotBy = null;
          } else {
            this.ball.vel.set(nx * Math.max(4, spd * 0.4), Math.max(0.8, spd * 0.2), nz * Math.max(4, spd * 0.4));
            this.lastTouch = q;
          }
        }
      }
      if (this.ball.pos.y < 0.02) this.ball.pos.y = BALL_R;

      /* referee deflection */
      if (REF.Ref && REF.Ref.pos) {
        var rx = this.ball.pos.x - REF.Ref.pos.x;
        var rz = this.ball.pos.z - REF.Ref.pos.z;
        var rd = Math.sqrt(rx * rx + rz * rz);
        if (rd < 0.45 && this.ball.pos.y < 1.9 && this.ball.vel.length() > 4) {
          var rnx = rd > 0.01 ? rx / rd : 1;
          var rnz = rd > 0.01 ? rz / rd : 0;
          this.ball.pos.x = REF.Ref.pos.x + rnx * 0.45;
          this.ball.pos.z = REF.Ref.pos.z + rnz * 0.45;
          this.ball.vel.set(rnx * 7, 1.6, rnz * 7);
          this.lastTouch = null;
          this.log('ref', 'Off the referee!');
        }
      }

      if (!this.keeperSave()) {
        if (!this.checkGoal()) this.checkBounds();
      }

      /* safety net: a ball nobody can reach would stall the match for ever */
      if (this.state === 'play' && !this.owner) {
        this.deadT += dt;
        if (this.deadT > 7) {
          this.deadT = 0;
          var np = null, nd2 = 1e9;
          for (var di = 0; di < this.players.length; di++) {
            var pp = this.players[di];
            if (!pp.active || pp.downT > 0) continue;
            var dd = U.distXZ(pp.pos, this.ball.pos);
            if (dd < nd2) { nd2 = dd; np = pp; }
          }
          if (np) {
            this.ball.pos.set(np.pos.x, BALL_R, np.pos.z);
            this.ball.vel.set(0, 0, 0);
            np.noTouch = 0;
            np.controlT = 0.2;
            this.owner = np;
            this.lastTouch = np;
            this.log('drop-ball', 'Ball back in play — ' + np.name);
          }
        }
      } else {
        this.deadT = 0;
      }
    } else if (this.state === 'goal') {
      this.updateBall(dt);
    }

    /* dive timer */
    for (var z = 0; z < this.players.length; z++) {
      var g = this.players[z];
      if (g.diveT > 0) {
        g.diveT -= dt;
        if (g.diveT <= 0) g.ch.state = 'idle';
      }
    }

    /* animations */
    for (var a = 0; a < this.players.length; a++) {
      REF.Actors.animate(this.players[a].ch, dt, this.time);
    }

    this.emit('tick', null);
  };

  Match.prototype.finish = function () {
    this.ended = true;
    this.state = 'ended';
    REF.Audio.whistle();
    REF.Audio.cheer(0.8);
    this.log('full-time', 'Full time — ' + this.teamName(0) + ' ' + this.score[0] + '-' + this.score[1] + ' ' + this.teamName(1));
    REF.Save.stat('matches');
    REF.Save.ach('full90');
    this.emit('fulltime', { score: this.score.slice() });
  };

  Match.prototype.dispose = function () {
    for (var i = 0; i < this.players.length; i++) {
      var p = this.players[i];
      this.scene.remove(p.ch.group);
      p.ch.group.traverse(function (o) {
        if (o.geometry) o.geometry.dispose();
        if (o.material && o.material.dispose) {
          if (o.material.map) o.material.map.dispose();
          o.material.dispose();
        }
      });
    }
    this.players.length = 0;
    if (this.ball.mesh) this.ball.mesh.visible = false;
    if (this.ballRing) {
      this.scene.remove(this.ballRing);
      this.ballRing.geometry.dispose();
      this.ballRing.material.dispose();
      this.ballRing = null;
    }
    this.handlers = {};
  };

  return Match;
})();
