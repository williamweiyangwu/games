/* ============================================================
   65-flags.js
   Flag raid objective state
   ============================================================ */
'use strict';

/* ------------------------------------------------------------
   FLAGS
   ------------------------------------------------------------ */
function buildFlag(team) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 2.9, 8), MAT.metal);
  pole.position.y = 1.45; pole.castShadow = true; g.add(pole);
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.6, 10, 5),
    new THREE.MeshStandardMaterial({ color: team === 'red' ? 0xa81818 : 0x1840a8, side: THREE.DoubleSide, roughness: 0.9 }));
  cloth.position.set(0.5, 2.45, 0); g.add(cloth);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), MAT.gold);
  cap.position.y = 2.95; g.add(cap);
  scene.add(g);
  return { group: g, cloth, baseY: 0 };
}

function createFlags() {
  for (const t of ['red', 'blue']) {
    if (G.flags && G.flags[t]) disposeTree(G.flags[t].group);
  }
  G.flags = { red: buildFlag('red'), blue: buildFlag('blue') };
  const rp = flagBasePos('red'), bp = flagBasePos('blue');
  G.flagState.red = { at: 'base', carrier: null, dropT: 0, pos: rp.clone() };
  G.flagState.blue = { at: 'base', carrier: null, dropT: 0, pos: bp.clone() };
  G.flags.red.group.position.copy(rp);
  G.flags.blue.group.position.copy(bp);
}

function flagBasePos(team) {
  const h = (G.hq && G.hq[team]) || { x: 0, z: team === 'red' ? 20 : -20 };
  return new V3(h.x, 0, h.z);
}

function dropFlag(team, pos) {
  /* online the host owns the flags; a guest's local drop would fight the
     state it is being sent */
  if (G.netMode && !NET.isHost) return;
  const fs = G.flagState[team];
  /* Read the player's carry state BEFORE the sweep below clears it — testing it
     afterwards was always false, so the "you have the flag" strip could be left
     hanging on screen. */
  const playerHadIt = G.player.carrying === team;
  fs.at = 'dropped';
  fs.carrier = null;
  fs.dropT = 20;
  fs.pos.set(pos.x, groundAt(pos.x, pos.z, pos.y + 0.5), pos.z);
  for (const a of allActors()) if (a.carrying === team) a.carrying = null;
  if (playerHadIt) $('carryBanner').classList.remove('show');
  if (G.netMode) netPublishObj();
}

function returnFlag(team) {
  if (G.netMode && !NET.isHost) return;
  const fs = G.flagState[team];
  fs.at = 'base'; fs.carrier = null; fs.dropT = 0;
  fs.pos.copy(flagBasePos(team));
  for (const a of allActors()) if (a.carrying === team) a.carrying = null;
  if (G.netMode) netPublishObj();
}

/* Guest view of the host's flags: the meshes follow the broadcast state, and
   a carried flag follows the live interpolated body so it does not stutter at
   the publish rate. */
function flagDraw() {
  if (!G.flags) return;
  for (const team of ['red', 'blue']) {
    const fs = G.flagState[team], fl = G.flags[team];
    if (!fs || !fl) continue;
    const c = fs.carrier;
    if (fs.at === 'carried' && c) {
      fl.group.position.set(c.pos.x, c.pos.y + 0.35, c.pos.z);
      fl.group.rotation.y += 0.03;
    } else {
      fl.group.position.copy(fs.pos);
      fl.group.rotation.y = 0;
    }
    fl.group.visible = true;
  }
}

function updateFlags(dt) {
  if (G.mode !== 'flag') return;
  /* Online the host judges the objective and every guest draws the result.
     A guest that simulated its own pickups would be playing a second, private
     match: its flags would move for reasons nobody else could see. */
  if (G.netMode && !NET.isHost) { flagDraw(); return; }
  for (const team of ['red', 'blue']) {
    const fs = G.flagState[team];
    const fl = G.flags[team];
    if (fs.at === 'carried') {
      const c = fs.carrier;
      /* a carrier who left the room leaves a stale body behind: the flag would
         follow a ghost for the rest of the match */
      const gone = c && c.isRemote && G.netMode && !NET.remotes.has(c.cid);
      if (!c || !c.alive || gone) { dropFlag(team, c ? c.pos : fs.pos); continue; }
      fs.pos.set(c.pos.x, c.pos.y, c.pos.z);
      fl.group.position.set(c.pos.x, c.pos.y + 0.35, c.pos.z);
      fl.group.rotation.y += dt * 2;
    } else if (fs.at === 'dropped') {
      fl.group.position.copy(fs.pos);
      fl.group.rotation.y = 0;
      fs.dropT -= dt;
      if (fs.dropT <= 0) { returnFlag(team); banner(team.toUpperCase() + ' FLAG RETURNED', 1.6); }
    } else {
      fl.group.position.copy(fs.pos);
      fl.group.rotation.y = 0;
    }
    fl.group.visible = G.mode === 'flag';
  }

  // pickups / captures / returns
  for (const a of objActors()) {
    if (!a.alive) continue;
    for (const team of ['red', 'blue']) {
      if (a.team === team) continue;
      const fs = G.flagState[team];
      if ((fs.at === 'base' || fs.at === 'dropped') && !a.carrying) {
        if (dist2(a.pos, fs.pos) < 1.9 && Math.abs(a.pos.y - fs.pos.y) < 2) {
          fs.at = 'carried'; fs.carrier = a; fs.dropT = 0;
          a.carrying = team;
          /* push it now: at four publishes a second a pickup could otherwise
             wait a quarter of a second to reach the player who made it */
          if (G.netMode) netPublishObj();
          if (a.isPlayer) { Snd.flag(); banner('YOU HAVE THE <span class="hl">' + team.toUpperCase() + ' FLAG</span> — RUN HOME', 3); $('carryBanner').classList.add('show'); }
          else if (a.team === G.player.team) banner('<span class="hl">' + a.name + '</span> grabbed the enemy flag', 1.8);
          else banner('THE ENEMY HAS YOUR FLAG', 2.2);
        }
      }
    }
    // capture (requires a short hold inside the HQ ring)
    if (a.carrying) {
      const ownBase = flagBasePos(a.team);
      const inHQ = dist2(a.pos, ownBase) < 3.8 && Math.abs(a.pos.y) < 2;
      if (inHQ && G.flagState[a.team].at === 'base') {
        a.capT = (a.capT || 0) + dt;
        if (a.isPlayer) {
          $('carryBanner').classList.add('show');
          $('carryBanner').textContent = 'CAPTURING — HOLD POSITION ' + Math.max(0, (2.4 - a.capT)).toFixed(1) + 's';
        }
        if (a.capT >= 2.4) {
          a.capT = 0;
          G.score[a.team]++;
          if (a.isPlayer) Ach.bump('captures');
          returnFlag(a.carrying);
          a.carrying = null;
          if (a.isPlayer) {
            Snd.flag();
            banner('<span class="hl">FLAG CAPTURED!</span>', 2.2);
            $('carryBanner').classList.remove('show');
          } else banner(a.team.toUpperCase() + ' TEAM SCORED', 2);
          /* the flag is already back on its stand, so this publishes the
             settled state along with the credit */
          if (G.netMode) netObjCapture(a);
          checkRoundEnd();
        }
      } else {
        a.capT = 0;
        if (a.isPlayer && inHQ && G.flagState[a.team].at !== 'base') {
          banner('YOUR FLAG IS AWAY — RETURN IT FIRST', 1.5);
        }
      }
    }
    // return own dropped flag by touching
    if (!a.carrying && G.flagState[a.team].at === 'dropped') {
      if (dist2(a.pos, G.flagState[a.team].pos) < 1.8) {
        returnFlag(a.team);
        if (a.isPlayer) banner('FLAG RETURNED', 1.2);
      }
    }
  }
}

