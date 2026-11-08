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

  var SPEED = { GK: 6.0, DEF: 6.4, MID: 6.9, FWD: 7.3 };

  /* squared distance from a point to the segment a→b: used to catch a pass */
  function segDist2(px, pz, ax, az, bx, bz) {
    var dx = bx - ax, dz = bz - az;
    var l2 = dx * dx + dz * dz;
    var t = l2 > 0.000001 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    var qx = ax + dx * t, qz = az + dz * t;
    return (px - qx) * (px - qx) + (pz - qz) * (pz - qz);
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
    this.decideT = 0;
    this.pendingFoul = null;
    this.pendingOffside = null;
    this.freezeT = 0;
    this.freezeAction = null;
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
    this.setBall(0, BALL_R, 0);
    this.state = 'setpiece';
    this.stateT = 1.3;
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
    this.stateT = kind === 'penalty' ? 1.8 : (kind === 'free-kick' ? 1.3 : 0.9);
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
    var best = null, bd = 0.92 * 0.92;
    for (var i = 0; i < this.players.length; i++) {
      var p = this.players[i];
      if (!p.active || p.downT > 0 || p.noTouch > 0) continue;
      var d2 = segDist2(p.pos.x, p.pos.z, prev.x, prev.z, b.pos.x, b.pos.z);
      if (p.role === 'GK') d2 *= 0.7;
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
      var spd = Math.min(p.maxSpeed, d * 2.6);
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

    var tx = ownGoalX + dir * 0.9;
    var tz = U.clamp(b.z * 0.4, -3.1, 3.1);

    var towardGoal = (b.x - p.pos.x) * dir < 0;
    if (dBall < 18 && towardGoal) {
      tz = U.clamp(b.z * 0.85, -3.6, 3.6);
      if (dBall < 9) tx = ownGoalX + dir * Math.min(7, 1.5 + (9 - dBall) * 0.8);
    }
    if (dBall < 3.4 && this.owner && this.owner.team !== p.team) {
      tx = b.x; tz = b.z;
    }

    /* a shot on goal: work out where it crosses the line and get there */
    var vx = this.ball.vel.x, vz = this.ball.vel.z;
    if (vx * dir < -7 && Math.abs(vx) > 7) {
      var tt = (ownGoalX - b.x) / vx;
      if (tt > 0 && tt < 1.7) {
        var zAt = b.z + vz * tt;
        if (Math.abs(zAt) < 6.5) {
          tz = U.clamp(zAt, -3.5, 3.5);
          tx = ownGoalX + dir * 0.7;
          p.maxSpeed = 9.6;
        }
      }
    }
    p.target.set(U.clamp(tx, -52, 52), 0, tz);
    p.maxSpeed = dBall < 10 ? 8.6 : 6.0;
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
    var u = baseU + (bu - baseU) * 0.42;
    var z = base.z + (b.z - base.z) * 0.3;

    if (p.role === 'DEF') {
      u = U.clamp(u, -46, 16);
      z = U.clamp(z, -30, 30);
    } else if (p.role === 'MID') {
      u = U.clamp(u, -26, 36);
      z = U.clamp(z, -30, 30);
    } else {
      u = U.clamp(u, -8, 46);
    }

    if (weHave) {
      /* attacking shape: stretch the pitch, offer a lane */
      if (p.role === 'FWD') {
        p.runCd -= this.dt;
        if (p.runCd <= 0) {
          p.runCd = U.rand(2.4, 5.5);
          p.runT = U.chance(0.5) ? U.rand(1.2, 2.2) : 0;
        }
        if (p.runT > 0) {
          p.runT -= this.dt;
          var line = this.secondLastX(p.team, dir);
          /* sometimes he goes early and strays beyond the line */
          u = line + (U.chance(0.38) ? U.rand(1.3, 3.0) : U.rand(-1.6, 0.9));
          z = base.z + U.rand(-3, 3);
        } else {
          u = Math.max(bu + 9, baseU);
          z = base.z * 0.6 + (base.z >= 0 ? -6 : 6);
        }
      } else if (p.role === 'MID') {
        u = Math.max(bu - 5, baseU - 3);
        z = base.z * 0.55 + (base.z >= 0 ? 4 : -4);
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
      u = baseU + (bu - baseU) * (p.role === 'DEF' ? 0.32 : 0.5);
      z = base.z * 0.55 + b.z * 0.45;
      u = Math.min(u, bu + 1.5);
      u = U.clamp(u, -46, 22);
      z = U.clamp(z, -30, 30);
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
    var central = Math.abs(p.pos.z) < 20;

    /* shoot only from a real position */
    if (distGoal < 32 && central && nd > 0.85) {
      var sc = distGoal < 11 ? 0.7 : (distGoal < 19 ? 0.45 : 0.3);
      if (U.chance(sc)) { this.shoot(p, gx); return; }
    }

    var opt = this.bestPass(p, dir);
    if (opt) {
      var want = 0.03;
      if (nd < 1.2) want = 0.85;
      else if (nd < 2.4) want = 0.45;
      else if (nd < 4) want = 0.18;
      else if (opt.score > 24) want = 0.14;
      if (opt.mate && U.chance(want)) { this.pass(p, opt.mate); return; }

      /* every so often a forward's run is picked out too early */
      if (opt.offside && U.chance(0.4)) { this.pass(p, opt.offside); return; }
    }

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
      if (d < 4.5 || d > 40) continue;
      var forward = (m.pos.x - p.pos.x) * dir;
      var oppNear = 1e9;
      for (var j = 0; j < this.players.length; j++) {
        var o = this.players[j];
        if (!o.active || o.team === p.team) continue;
        var od = U.distXZ(o.pos, m.pos);
        if (od < oppNear) oppNear = od;
      }
      var score = forward * 0.7 + Math.min(oppNear, 10) * 2.4 - d * 0.18;
      if (forward < -2) score -= 6;
      if (oppNear < 2.2) score -= 12;
      if (m.role === 'FWD' && m.runT > 0 && forward > 3) score += 14;

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

    /* pick the side the keeper is not covering */
    var gk = this.keeperOf(1 - p.team);
    var tz;
    if (gk && Math.abs(gk.pos.z - b.z) < 2.4) tz = gk.pos.z > 0 ? -2.4 : 2.4;
    else tz = U.rand(-2.5, 2.5);
    var err = U.rand(-1, 1) * (0.3 + dist * 0.045);
    tz = U.clamp(tz + err, -3.4, 3.4);

    var dx = gx - b.pos.x;
    var dz = tz - b.pos.z;
    var len = Math.sqrt(dx * dx + dz * dz) || 1;
    var power = U.clamp(19 + dist * 0.75, 22, 33);
    var lift = U.clamp(0.5 + dist * 0.05, 0.9, 2.4);
    b.vel.set((dx / len) * power, lift, (dz / len) * power);
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
    var speed = U.clamp(len * 1.35, 11, 23);
    var t = len / speed;
    /* lead the receiver into his run */
    dx = mate.pos.x + mate.vel.x * t * 0.85 - b.pos.x;
    dz = mate.pos.z + mate.vel.z * t * 0.85 - b.pos.z;
    var l2 = Math.sqrt(dx * dx + dz * dz) || 1;
    b.vel.set((dx / l2) * speed, len > 20 ? 2.2 : 0.6, (dz / l2) * speed);
    p.kickCd = 0.6;
    p.noTouch = 0.45;
    this.owner = null;
    this.lastTouch = p;
    this.passTo = mate;
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
    if (defender.tackleCd > 0 || attacker.downT > 0 || defender.noTouch > 0) return;
    if (attacker.controlT > 0) return;
    if (U.distXZ(defender.pos, attacker.pos) > 1.25) return;
    defender.tackleCd = U.rand(1.4, 2.4);
    if (U.chance(0.55)) {
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
  /* a keeper gets a hand to anything he is standing in front of */
  Match.prototype.keeperSave = function () {
    var b = this.ball;
    var sp = b.vel.length();
    if (sp < 7) return false;
    var sign = b.pos.x > 0 ? 1 : -1;
    if (Math.abs(b.pos.x) < F.L / 2 - 3.4) return false;
    var defTeam = sign > 0 ? 1 : 0;
    var gk = this.keeperOf(defTeam);
    if (!gk || !gk.active || gk.downT > 0) return false;
    if (Math.abs(b.pos.z) > F.goalW / 2 + 2.4) return false;
    if (b.pos.y > F.goalH + 0.9) return false;

    var vx = b.vel.x;
    if (vx * sign <= 0) return false;
    var t = (sign * (F.L / 2) - b.pos.x) / vx;
    if (t < 0) return false;
    var zAt = b.pos.z + b.vel.z * t;
    if (Math.abs(zAt - gk.pos.z) > 1.05) return false;

    /* parried, not caught */
    var out = sign * (F.L / 2 - 0.55);
    b.pos.x = out;
    b.pos.z = U.clamp(zAt, -F.goalW / 2, F.goalW / 2);
    b.pos.y = Math.max(BALL_R, b.pos.y);
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
    if (this.freezeT > 0) return 'busy';

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

    /* the whistle stops the clock — nothing moves until the game restarts */
    this.freezeT = 1.15;
    this.freezeAction = null;

    if (this.pendingFoul && this.pendingFoul.t > 0) {
      var f = this.pendingFoul;
      this.freezeAction = function () {
        this.log('free-kick', 'Free kick to ' + this.teamName(1 - f.team));
        this.setPiece('free-kick', f.pos.clone(), 1 - f.team);
        this.lastFoul = f;
        this.emit('free-kick', f);
      };
      return 'foul';
    }
    if (this.pendingOffside && this.pendingOffside.t > 0) {
      var o = this.pendingOffside;
      this.freezeAction = function () {
        this.stats.offsides++;
        REF.Save.stat('offsides');
        REF.Save.ach('offside');
        this.log('offside-call', 'Offside called on ' + o.player.name);
        this.setPiece('free-kick', o.pos.clone(), 1 - o.player.team);
        this.emit('offside-called', o);
      };
      return 'offside';
    }
    this.emit('whistle', null);
    return 'none';
  };

  Match.prototype.afterFreeze = function () {
    var act = this.freezeAction;
    this.freezeAction = null;
    this.freezeT = 0;
    if (act) act.call(this);
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

    /* time stops for as long as the whistle is ringing */
    if (this.freezeT > 0) {
      this.freezeT -= dt;
      this.time += dt;
      for (var f = 0; f < this.players.length; f++) {
        var fp = this.players[f];
        fp.ch.animSpeed = 0;
        REF.Actors.animate(fp.ch, dt, this.time);
      }
      if (this.freezeT <= 0) this.afterFreeze();
      this.emit('tick', null);
      return;
    }

    this.time += dt;
    this.dt = dt;

    var ticking = this.state === 'play' || this.state === 'setpiece';
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
          if (U.distXZ(d.pos, carrier.pos) < 1.2) {
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
