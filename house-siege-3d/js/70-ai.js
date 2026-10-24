/* ============================================================
   70-ai.js
   Bot perception, goals, path planning and movement
   ============================================================ */
'use strict';

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

/* Equip the best gun in the bag. Bots loot crates, but nothing ever changed
   `b.cur`, so they walked around with a rifle on their back and kept firing
   the pistol for the whole match. */
function botPickWeapon(b) {
  let best = 1, bestTier = -1;               // slot 1 is the pistol
  for (let i = 0; i < b.weapons.length; i++) {
    const st = b.weapons[i];
    const w = WEAPONS[st.id];
    if (!w || w.melee || w.item || w.botOk === false) continue;
    if (st.mag <= 0 && st.res <= 0) continue;  // dry: nothing to shoot with
    if (w.tier > bestTier) { bestTier = w.tier; best = i; }
  }
  if (best !== b.cur) { b.cur = best; b.reloadT = 0; b.drawT = 0; }
}

function botThink(b) {
  botPickWeapon(b);
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

    /* Carrying: head home — but ONLY if we can actually score there. A capture
       needs our own flag on its stand, so a carrier whose flag is in enemy hands
       would park on the base forever, unable to score, while the enemy carrier
       does exactly the same on theirs. That mutual stand-off froze whole
       matches. Go cut the enemy carrier down instead: the kill drops our flag,
       a team-mate returns it, and we are still holding theirs. */
    if (b.carrying) {
      if (mf.at === 'carried' && mf.carrier && mf.carrier.alive && mf.carrier !== b) {
        goal = mf.carrier.pos; kind = 'carryhunt';
      } else {
        goal = flagBasePos(b.team); kind = 'carry';
      }
    }
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
        if (!c.available || !c.content || c.content.item) continue;  // bots cannot use items
        const cw = WEAPONS[c.content.id];
        if (!cw || cw.botOk === false) continue;                     // nor the crossbow
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
    if (b.goalKind === 'attack' || b.goalKind === 'carry' || b.goalKind === 'carryhunt' ||
        b.goalKind === 'return' || b.goalKind === 'escort') {
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

  /* A bot standing ON its goal is invisible to the watchdog above, because that
     only fires when the goal is still far away. If the goal cannot be completed
     (a crate someone else emptied, a post that is no longer useful) it would
     stand there for the rest of the match, so force a fresh decision. */
  if (b.goalKind && !(visible && tgt && sameFloor)) {
    const gd = Math.hypot(b.pos.x - b.goalPos.x, b.pos.z - b.goalPos.z);
    if (gd < 2.2) {
      b.arriveT = (b.arriveT || 0) + dt;
      if (b.arriveT > 1.1) {
        b.arriveT = 0; b.think = 0; b.goalLock = 0; b.goalKind = ''; b.path = null; b.pathIdx = 0;
      }
    } else {
      b.arriveT = 0;
    }
  } else {
    b.arriveT = 0;
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
    const w = st ? defOf(st.id) : null;
    const dist = b.pos.distanceTo(tgt.pos);
    const facing = Math.abs(dyaw) < 0.22;
    if (w && facing && dist < (w.range || 30)) {
      if (st.mag > 0) {
        tryFire(b);
        // burst discipline: stop firing occasionally
        if (!w.auto && Math.random() < 0.02) b.reactT = d.react * 0.5;
      } else startReload(b);
    }
  }
  // reload when idle
  const st2 = b.weapons[b.cur];
  const w2 = st2 ? defOf(st2.id) : null;
  if (st2 && w2 && !w2.melee && !w2.item && st2.mag <= 0 && b.reloadT <= 0) startReload(b);

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

