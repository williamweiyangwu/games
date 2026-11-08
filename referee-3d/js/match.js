/* WHISTLE — match simulation: ball, AI players, fouls, offside, goals */
window.REF = window.REF || {};

REF.Match = (function () {
  var U = REF.U;
  var F = REF.FIELD;
  var BALL_R = 0.11;
  var GRAV = 16;

  var FORMATION = [
    [-0.92, 0.00, 'GK'],
    [-0.62, -0.30, 'DEF'], [-0.68, -0.10, 'DEF'], [-0.68, 0.10, 'DEF'], [-0.62, 0.30, 'DEF'],
    [-0.24, -0.22, 'MID'], [-0.30, 0.00, 'MID'], [-0.24, 0.22, 'MID'],
    [0.30, -0.26, 'FWD'], [0.40, 0.00, 'FWD'], [0.30, 0.26, 'FWD']
  ];

  var SPEED = { GK: 5.6, DEF: 6.0, MID: 6.4, FWD: 6.9 };

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
    this.decideT = 0;
    this.pendingFoul = null;
    this.pendingOffside = null;
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

    for (var t = 0; t < 2; t++) {
      var info = this.teams[t].info;
      var dir = this.teams[t].dir;
      for (var i = 0; i < FORMATION.length; i++) {
        var f = FORMATION[i];
        var role = f[2];
        var hx = t === 0 ? f[0] * (F.L / 2) : -f[0] * (F.L / 2);
        var hz = t === 0 ? f[1] * (F.W / 2 - 4) : -f[1] * (F.W / 2 - 4);

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
          maxSpeed: SPEED[role] + U.rand(-0.2, 0.35),
          kickCd: 0,
          tackleCd: 0,
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
    }
  };

  Match.prototype.setBall = function (x, y, z) {
    this.ball.pos.set(x, y, z);
    this.ball.vel.set(0, 0, 0);
    this.owner = null;
  };

  Match.prototype.kickoff = function (team, silent) {
    this.resetPositions();
    this.setBall(0, BALL_R, 0);
    this.state = 'setpiece';
    this.stateT = 1.9;
    this.restart = { kind: 'kick-off', team: team, pos: new THREE.Vector3(0, 0, 0) };
    this.taker = this.pickTaker(team, new THREE.Vector3(0, 0, 0));
    if (this.taker) {
      this.taker.pos.set(-this.teams[team].dir * 0.75, 0, 0.35);
      this.taker.ch.group.position.copy(this.taker.pos);
    }
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
    this.stateT = kind === 'free-kick' || kind === 'penalty' ? 2.6 : 1.7;
    this.pendingFoul = null;
    this.pendingOffside = null;
    this.ball.vel.set(0, 0, 0);
    this.ball.pos.set(pos.x, BALL_R, pos.z);
    this.owner = null;
    this.lastTouch = null;
    this.restart = { kind: kind, team: team, pos: pos.clone() };
    this.taker = this.pickTaker(team, pos);
    if (this.taker) {
      var dir = this.teams[team].dir;
      var tx = pos.x - dir * 0.8;
      var tz = pos.z + 0.25;
      this.taker.pos.set(U.clamp(tx, -52, 52), 0, U.clamp(tz, -33, 33));
      this.taker.vel.set(0, 0, 0);
      this.taker.target.copy(this.taker.pos);
      this.taker.ch.group.position.copy(this.taker.pos);
    }
    this.emit('state', this.state);
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
  Match.prototype.updatePossession = function () {
    var b = this.ball;
    if (b.pos.y > 1.7) { this.owner = null; return; }
    var speed = b.vel.length();
    var best = null, bd = 1.15;
    for (var i = 0; i < this.players.length; i++) {
      var p = this.players[i];
      if (!p.active || p.downT > 0) continue;
      var d = U.distXZ(p.pos, b.pos);
      if (p.role === 'GK') d -= 0.15;
      if (d < bd) { bd = d; best = p; }
    }
    if (best && speed > 17 && best.role !== 'GK') best = null;
    if (best !== this.owner) {
      if (best) this.lastTouch = best;
    }
    this.owner = best;
    if (best) this.lastTouch = best;
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
      var spd = Math.min(p.maxSpeed, d * 2.6);
      if (p.role === 'GK' && d < 3) spd = Math.min(spd, 4.4);
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
        if (d2 < 0.5 && d2 > 0.0001) {
          var d = Math.sqrt(d2);
          var push = (0.72 - d) * 0.5;
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

  Match.prototype.nearestToBall = function (team) {    var best = null, bd = 1e9;
    for (var i = 0; i < this.players.length; i++) {
      var p = this.players[i];
      if (!p.active || p.team !== team || p.role === 'GK') continue;
      var d = U.distXZ(p.pos, this.ball.pos);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  };

  Match.prototype.gkAI = function (p, dt) {
    var dir = this.teams[p.team].dir;
    var ownGoalX = -dir * (F.L / 2);
    var b = this.ball.pos;
    var dBall = U.distXZ(p.pos, b);

    var tx = ownGoalX + dir * 1.7;
    var tz = U.clamp(b.z * 0.32, -3.1, 3.1);

    var towardGoal = (b.x - p.pos.x) * dir < 0;
    if (dBall < 18 && towardGoal) {
      tz = U.clamp(b.z * 0.85, -3.6, 3.6);
      if (dBall < 9) tx = ownGoalX + dir * Math.min(7, 1.5 + (9 - dBall) * 0.8);
    }
    if (dBall < 3.2 && this.owner && this.owner.team !== p.team) {
      tx = b.x; tz = b.z;
    }
    p.target.set(U.clamp(tx, -52, 52), 0, tz);
    p.maxSpeed = dBall < 10 ? 8.4 : 5.6;
  };

  Match.prototype.think = function (p, ownerTeam) {
    var dir = this.teams[p.team].dir;
    var b = this.ball.pos;
    var base = p.home;

    if (this.state !== 'play') {
      if (p === this.taker) { p.target.copy(p.pos); return; }
      p.target.copy(base);
      p.target.x += b.x * 0.18;
      return;
    }

    var tx = base.x + b.x * 0.26;
    var tz = base.z + b.z * 0.22;

    var nearest = this.nearestToBall(p.team);

    if (ownerTeam === p.team && this.owner && this.owner !== p) {
      tx += dir * 6;
      if (p.role === 'FWD') {
        tx += dir * 5;
        if (p.runCd === undefined) p.runCd = U.rand(2, 6);
        p.runCd -= 0.14;
        if (p.runCd <= 0) {
          p.runCd = U.rand(3, 7);
          p.runT = U.chance(0.6) ? 1.9 : 0;
        }
        if (p.runT > 0) {
          p.runT -= 0.14;
          var line = this.secondLastX(p.team, dir);
          tx = (line + U.rand(0.6, 4.5)) * dir;
        }
      }
    } else if (ownerTeam !== p.team && ownerTeam >= 0) {
      if (p === nearest) {
        tx = b.x + this.ball.vel.x * 0.22;
        tz = b.z + this.ball.vel.z * 0.22;
      } else if (p.role === 'DEF') {
        tx = base.x * 0.55 + b.x * 0.45;
        tz = base.z * 0.6 + b.z * 0.4;
      }
    } else {
      if (p === nearest) {
        tx = b.x + this.ball.vel.x * 0.25;
        tz = b.z + this.ball.vel.z * 0.25;
      }
    }

    p.target.set(U.clamp(tx, -50, 50), 0, U.clamp(tz, -31, 31));
  };

  Match.prototype.ownerAI = function (p, dt) {
    var dir = this.teams[p.team].dir;
    var b = this.ball.pos;
    var gx = dir * (F.L / 2);
    var distGoal = Math.sqrt((gx - b.x) * (gx - b.x) + b.z * b.z);

    var near = null, nd = 1e9;
    for (var i = 0; i < this.players.length; i++) {
      var o = this.players[i];
      if (!o.active || o.team === p.team) continue;
      var d = U.distXZ(o.pos, p.pos);
      if (d < nd) { nd = d; near = o; }
    }

    p.kickCd -= dt;
    p.tackleCd -= dt;

    if (p.kickCd > 0) {
      p.target.set(U.clamp(b.x + dir * 5, -50, 50), 0, U.clamp(b.z, -30, 30));
      return;
    }

    var shootRange = 23 + (p.role === 'FWD' ? 6 : 0);
    if (distGoal < shootRange && Math.abs(b.z) < 24 && U.chance(0.42)) {
      this.shoot(p, gx);
      return;
    }

    if (nd < 2.3 && U.chance(0.55)) {
      var mate = this.bestPass(p, dir);
      if (mate) { this.pass(p, mate); return; }
    }

    var dx = gx - p.pos.x;
    var dz = U.clamp(b.z, -9, 9) - p.pos.z;
    var len = Math.sqrt(dx * dx + dz * dz) || 1;
    dx /= len; dz /= len;
    if (near && nd < 3.4) {
      var ax = p.pos.x - near.pos.x, az = p.pos.z - near.pos.z;
      var al = Math.sqrt(ax * ax + az * az) || 1;
      dx += (ax / al) * 0.75;
      dz += (az / al) * 0.75;
    }
    p.target.set(U.clamp(p.pos.x + dx * 7, -50, 50), 0, U.clamp(p.pos.z + dz * 7, -30, 30));
  };

  Match.prototype.bestPass = function (p, dir) {
    var best = null, bestScore = -1e9;
    for (var i = 0; i < this.players.length; i++) {
      var m = this.players[i];
      if (!m.active || m.team !== p.team || m === p || m.role === 'GK') continue;
      var d = U.distXZ(m.pos, p.pos);
      if (d < 5 || d > 42) continue;
      var forward = (m.pos.x - p.pos.x) * dir;
      var oppNear = 1e9;
      for (var j = 0; j < this.players.length; j++) {
        var o = this.players[j];
        if (!o.active || o.team === p.team) continue;
        var od = U.distXZ(o.pos, m.pos);
        if (od < oppNear) oppNear = od;
      }
      var score = forward * 0.55 + oppNear * 2.4 - d * 0.12;
      if (this.wouldBeOffside(p, m)) score -= 25;
      if (score > bestScore) { bestScore = score; best = m; }
    }
    return best;
  };

  Match.prototype.shoot = function (p, gx) {
    var b = this.ball;
    var tz = U.rand(-2.9, 2.9);
    var dx = gx - b.pos.x;
    var dz = tz - b.pos.z;
    var len = Math.sqrt(dx * dx + dz * dz) || 1;
    var power = U.rand(25, 33);
    b.vel.set((dx / len) * power, U.rand(1.4, 3.6), (dz / len) * power);
    p.kickCd = 1.1;
    p.lastGoal = 0;
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
    var dx = mate.pos.x + mate.vel.x * 0.25 - b.pos.x;
    var dz = mate.pos.z + mate.vel.z * 0.25 - b.pos.z;
    var len = Math.sqrt(dx * dx + dz * dz) || 1;
    var speed = U.clamp(len * 1.35, 13, 26);
    b.vel.set((dx / len) * speed, len > 18 ? 2.4 : 0.9, (dz / len) * speed);
    p.kickCd = 0.75;
    this.owner = null;
    this.lastTouch = p;
    REF.Audio.kick(0.5);
    if (offside) this.flagOffside(mate);
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
    victim.downT = U.rand(1.8, 2.6);
    victim.state = 'down';
    victim.ch.state = 'down';
    victim.anger = Math.min(100, victim.anger + 34);
    victim.argueT = 2.2;
    offender.anger = Math.min(100, offender.anger + 8);
    offender.tackleCd = 2.2;

    var b = this.ball;
    b.vel.multiplyScalar(0.12);

    this.pendingFoul = {
      offender: offender,
      victim: victim,
      pos: victim.pos.clone(),
      team: offender.team,
      severity: severity || 'normal',
      t: 6.0
    };
    this.stats.fouls++;
    REF.Save.stat('fouls');
    REF.Audio.kick(0.9);
    this.log('foul', 'Foul by ' + offender.name + ' on ' + victim.name);
    this.emit('foul', this.pendingFoul);
  };

  Match.prototype.tryTackle = function (defender, attacker) {
    if (defender.tackleCd > 0 || attacker.downT > 0) return;
    if (U.distXZ(defender.pos, attacker.pos) > 1.35) return;
    defender.tackleCd = U.rand(1.1, 2.0);
    if (U.chance(0.6)) {
      this.owner = defender;
      this.ball.pos.x = defender.pos.x + Math.sin(defender.facing) * 0.4;
      this.ball.pos.z = defender.pos.z + Math.cos(defender.facing) * 0.4;
      this.ball.vel.set(0, 0, 0);
      this.lastTouch = defender;
      this.log('tackle', defender.name + ' wins it back');
    } else {
      this.commitFoul(defender, attacker, 'normal');
    }
  };

  /* ---------------------------------------------------------------- goals */
  Match.prototype.checkGoal = function () {
    var b = this.ball.pos;
    if (Math.abs(b.z) > F.goalW / 2) return false;
    if (b.y > F.goalH) return false;

    if (b.x > F.L / 2 + 0.12) { this.scoreGoal(0); return true; }
    if (b.x < -F.L / 2 - 0.12) { this.scoreGoal(1); return true; }
    return false;
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
    this.stateT = 6.2;
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
        var gx = goalSign * (halfL - 6);
        this.log('goal-kick', 'Goal kick — ' + this.teamName(defender));
        this.setPiece('goal-kick', new THREE.Vector3(gx, 0, U.rand(-6, 6)), defender);
      } else {
        var cx = goalSign * (halfL - 0.6);
        var cz = Math.sign(b.z || 1) * (halfW - 0.6);
        this.log('corner', 'Corner — ' + this.teamName(attacker));
        this.setPiece('corner', new THREE.Vector3(cx, 0, cz), attacker);
      }
    }
  };

  /* ------------------------------------------------------- referee inputs */
  Match.prototype.whistle = function () {
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

    if (this.pendingFoul && this.pendingFoul.t > 0) {
      var f = this.pendingFoul;
      this.log('free-kick', 'Free kick to ' + this.teamName(1 - f.team));
      this.setPiece('free-kick', f.pos.clone(), 1 - f.team);
      this.lastFoul = f;
      this.emit('free-kick', f);
      return 'foul';
    }
    if (this.pendingOffside && this.pendingOffside.t > 0) {
      var o = this.pendingOffside;
      this.stats.offsides++;
      REF.Save.stat('offsides');
      REF.Save.ach('offside');
      this.log('offside-call', 'Offside called on ' + o.player.name);
      this.setPiece('free-kick', o.pos.clone(), 1 - o.player.team);
      this.emit('offside-called', o);
      return 'offside';
    }
    this.emit('whistle', null);
    return 'none';
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

  /* ----------------------------------------------------------------- tick */
  Match.prototype.update = function (dt) {
    if (this.ended) return;
    this.time += dt;

    var ticking = this.state === 'play' || this.state === 'setpiece' || this.state === 'kickoff';
    if (ticking) this.min += dt * (1 / 1.35);

    if (this.state === 'setpiece') {
      this.stateT -= dt;
      if (this.stateT <= 0) { this.state = 'play'; this.emit('state', this.state); }
    } else if (this.state === 'goal') {
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
      this.stateT = 4.2;
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
    if (decide) this.decideT = U.rand(0.1, 0.18);

    var ownerTeam = this.owner ? this.owner.team : -1;

    for (var i = 0; i < this.players.length; i++) {
      var p = this.players[i];
      if (!p.active) continue;
      if (p.kickCd > 0) p.kickCd -= dt;
      if (p.tackleCd > 0) p.tackleCd -= dt;
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
      if (this.owner && this.owner.active) {
        for (var k = 0; k < this.players.length; k++) {
          var d = this.players[k];
          if (!d.active || d.team === this.owner.team) continue;
          if (U.distXZ(d.pos, this.owner.pos) < 1.3) this.tryTackle(d, this.owner);
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

      if (!this.checkGoal()) this.checkBounds();
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
