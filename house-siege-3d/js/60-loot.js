/* ============================================================
   60-loot.js
   Chests, loot rolls and the 5-slot inventory
   ============================================================ */
'use strict';

/* ------------------------------------------------------------
   CHESTS
   ------------------------------------------------------------ */
/* spots are chosen at world-build time (maze dead ends + the catwalk) */
function chestSpots() { return G.chestSpots || []; }

function buildChest(x, y, z) {
  const grp = new THREE.Group();
  grp.position.set(x, y, z);

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.52, 0.66), MAT.wood);
  body.position.y = 0.26; body.castShadow = true; body.receiveShadow = true; grp.add(body);

  const band1 = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.09, 0.7), MAT.gold);
  band1.position.set(0, 0.12, 0); grp.add(band1);
  const band2 = band1.clone(); band2.position.y = 0.42; grp.add(band2);

  const lidPivot = new THREE.Group();
  lidPivot.position.set(0, 0.52, -0.33);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.2, 0.68), MAT.woodDark);
  lid.position.set(0, 0.1, 0.33); lid.castShadow = true; lidPivot.add(lid);
  const lidBand = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.08, 0.72), MAT.gold);
  lidBand.position.set(0, 0.1, 0.33); lidPivot.add(lidBand);
  grp.add(lidPivot);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.028, 6, 24),
    new THREE.MeshBasicMaterial({ color: 0xffc44d, transparent: true, opacity: 0.9 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.95; grp.add(ring);

  /* beacon: a soft column of light so a crate is visible across the maze */
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xffb43a, transparent: true, opacity: 0.22,
    depthWrite: false, side: THREE.DoubleSide
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.5, 6.5, 10, 1, true), beamMat);
  beam.position.y = 3.4;
  grp.add(beam);

  /* a solid marker cube at the top of the beam, readable from the catwalk */
  const mark = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0),
    new THREE.MeshBasicMaterial({ color: 0xffd166 }));
  mark.position.y = 2.3;
  grp.add(mark);

  const glow = new THREE.PointLight(0xffb347, 1.1, 7);
  glow.position.y = 0.9; grp.add(glow);

  scene.add(grp);
  return {
    grp, lidPivot, ring, glow, beam, mark, beamMat,
    pos: new V3(x, y, z), content: null, label: '', available: true, respawnT: 0, openT: 0
  };
}

/* Every crate holds either a gun or a consumable. Rolled with a floor on the
   number of item crates so the map always offers healing somewhere. */
function rollChestContent() {
  const isItem = Math.random() < 0.5;
  return isItem ? { id: pick(ITEM_POOL), item: true } : { id: pick(CHEST_POOL), item: false };
}

function applyChestContent(c) {
  const def = defOf(c.content.id);
  const col = c.content.item ? 0x59e0c8 : 0xffb43a;
  if (c.ring) c.ring.material.color.setHex(col);
  if (c.mark) c.mark.material.color.setHex(col);
  if (c.beamMat) c.beamMat.color.setHex(col);
  if (c.glow) c.glow.color.setHex(col);
  c.label = def ? def.name : '';
}

function createChests() {
  /* free the previous match's crates: geometry, beams and their lights */
  for (const c of G.chests) {
    if (c.glow) scene.remove(c.glow);
    disposeTree(c.grp);
  }
  G.chests.length = 0;
  for (const s of chestSpots()) {
    const c = buildChest(s[0], s[1], s[2]);
    c.content = rollChestContent();
    G.chests.push(c);
  }
  /* guarantee a few item crates even on an unlucky roll */
  let need = 3 - G.chests.filter(c => c.content.item).length;
  for (const c of G.chests) {
    if (need <= 0) break;
    if (!c.content.item) { c.content = { id: pick(ITEM_POOL), item: true }; need--; }
  }
  for (const c of G.chests) applyChestContent(c);
}

function updateChests(dt) {
  const p = G.player;
  let near = null;
  for (const c of G.chests) {
    c.ring.rotation.z += dt * 1.6;
    if (!c.available) {
      c.respawnT -= dt;
      if (c.respawnT <= 0) {
        c.available = true;
        c.content = rollChestContent();
        applyChestContent(c);
        c.ring.visible = true; c.glow.visible = true;
      }
    }
    c.lidPivot.rotation.x = lerp(c.lidPivot.rotation.x, c.available ? 0 : -1.9, Math.min(1, dt * 8));
    c.ring.material.opacity = c.available ? 0.55 + Math.sin(now() * 3) * 0.3 : 0;
    c.ring.visible = c.available;
    c.glow.visible = c.available;

    /* beacon pulse */
    const pulse = 0.5 + 0.5 * Math.sin(now() * 2.2 + c.pos.x);
    c.beam.visible = c.available;
    c.mark.visible = c.available;
    c.beamMat.opacity = 0.10 + pulse * 0.09;
    c.mark.rotation.y += dt * 1.4;
    c.mark.position.y = 2.25 + Math.sin(now() * 1.8 + c.pos.z) * 0.09;

    if (c.available && p.alive) {
      const d = Math.hypot(p.pos.x - c.pos.x, p.pos.z - c.pos.z) + Math.abs(p.pos.y - c.pos.y) * 2;
      if (d < 2.3 && (!near || d < near.d)) near = { c, d };
    }
    /* bots loot crates too — guns when they still have a slot, consumables
       when the item is one they can actually use. They used to skip every item
       crate outright, so the whole consumable system was player-only. */
    if (c.available && c.content) {
      const isItem = !!c.content.item;
      const cw = isItem ? null : WEAPONS[c.content.id];
      const gunOk = !isItem && cw && cw.botOk !== false;
      if (isItem || gunOk) {
        for (const b of G.bots) {
          if (!b.alive || b.dummy) continue;
          const d = Math.hypot(b.pos.x - c.pos.x, b.pos.z - c.pos.z) + Math.abs(b.pos.y - c.pos.y) * 2;
          /* 2.2 m, not 1.6: a bot stops ~1.6 m short of a crate (the nav node
             it paths to sits that far out), so the tighter radius meant they
             stood beside a crate forever and never picked anything up */
          if (d >= 2.2) continue;
          if (isItem) {
            if (!botWantsItem(b, c.content.id)) continue;
          } else if (b.weapons.length >= CFG.slots) continue;
          takeChest(c, b);
          break;
        }
      }
    }
  }
  G.nearChest = near ? near.c : null;
  const promptEl = $('prompt');
  promptEl.classList.toggle('show', !!near && G.state === 'playing');
  if (near && G.state === 'playing') {
    const txt = '<b>E</b> TAKE ' + (near.c.label || 'CRATE');
    if (promptEl.dataset.txt !== txt) { promptEl.innerHTML = txt; promptEl.dataset.txt = txt; }
  }
}

function takeChest(c, a) {
  if (!c.available) return;
  const id = c.content ? c.content.id : c.weapon;
  const isItem = !!(c.content && c.content.item);
  const def = defOf(id);
  if (!def) return;

  const res = isItem ? giveItem(a, id) : giveWeapon(a, id);
  if (!res.added) {
    if (res.full && a.isPlayer) {
      banner('ALREADY CARRYING MAX <span class="hl">' + def.name + '</span>', 1.4);
      Snd.empty();
    }
    return;                         // leave the crate closed, it is not wasted
  }

  c.available = false;
  c.respawnT = CFG.chestRespawn;
  c.ring.visible = false;
  if (c.beam) c.beam.visible = false;
  if (c.mark) c.mark.visible = false;
  if (a.isPlayer) {
    Snd.chest(); Snd.pickup();
    if (G.tutorial.active) G.tutorial.chests++;
    let msg = 'PICKED UP <span class="hl">' + def.name + '</span>';
    if (res.dropped) {
      const d = defOf(res.dropped.id);
      if (d) msg += ' — DROPPED ' + d.name;
    }
    banner(msg, 1.8);
  }
}

/* --- inventory ---------------------------------------------------------
   Slots 1 and 2 are the knife and the pistol. Anything picked up goes into
   slots 3-5. When the bag is full the slot you are HOLDING is swapped out
   (the genre convention: you trade what is in your hands), and the banner
   names what you lost. */
function addSlot(a, st) {
  const MAX = CFG.slots;
  let dropped = null;
  if (a.weapons.length < MAX) a.weapons.push(st);
  else {
    let idx = (a.cur >= 2 && a.cur < a.weapons.length) ? a.cur : a.weapons.length - 1;
    dropped = a.weapons[idx];
    a.weapons[idx] = st;
  }
  if (a.isPlayer) {
    a.cur = a.weapons.indexOf(st);
    a.reloadT = 0; a.drawT = 0;
  }
  return dropped;
}

function giveWeapon(a, id) {
  const w = WEAPONS[id];
  if (!w) return { added: false, full: false, dropped: null };
  const ex = a.weapons.find(x => x.id === id);
  if (ex) {
    ex.res = Math.min(w.reserve, ex.res + Math.ceil(w.mag * 1.5));
    if (a.isPlayer) a.cur = a.weapons.indexOf(ex);
    return { added: true, full: false, dropped: null };
  }
  return { added: true, full: false, dropped: addSlot(a, { id, mag: w.mag, res: w.reserve }) };
}

function giveItem(a, id) {
  const it = ITEMS[id];
  if (!it) return { added: false, full: false, dropped: null };
  const ex = a.weapons.find(x => x.id === id);
  if (ex) {
    if (ex.count >= it.stack) return { added: false, full: true, dropped: null };
    ex.count++;
    if (a.isPlayer) a.cur = a.weapons.indexOf(ex);
    return { added: true, full: false, dropped: null };
  }
  return { added: true, full: false, dropped: addSlot(a, { id, count: 1 }) };
}

/* Drop a slot that has run out and fall back to the pistol. Works for bots too
   now that they use consumables — it used to return before fixing `cur` for
   non-players, which would leave a bot pointing past the end of its bag. */
function consumeSlot(a, idx) {
  const st = a.weapons[idx];
  if (!st) return;
  const wasHeld = a.cur === idx;
  a.weapons.splice(idx, 1);
  if (wasHeld) a.cur = Math.min(1, a.weapons.length - 1);   // back to the pistol
  else if (a.cur > idx) a.cur--;                            // keep the same weapon
  a.cur = clamp(a.cur, 0, a.weapons.length - 1);
  if (a.isPlayer) {
    a.reloadT = 0; a.drawT = 0;
    bagSig = '';                    // force the panel to redraw
  }
}

