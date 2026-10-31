/* ============================================================
   93-achieve.js
   Achievements and the long-lived player profile
   ------------------------------------------------------------
   Everything here is persisted in localStorage under one key, so a
   player's totals and unlocks survive closing the tab, closing the
   browser and shutting the machine down. Nothing is stored in memory
   alone: every mutation writes straight back to disk.

   The profile is versioned. If the shape ever changes, `migrate()`
   fills in anything a newer build expects instead of throwing the old
   save away — losing a player's history to a schema tweak is not
   acceptable.
   ============================================================ */
'use strict';

const ACH_KEY = 'wh_profile_v1';
const ACH_VERSION = 1;

/* ------------------------------------------------------------
   ACHIEVEMENT DEFINITIONS
   ------------------------------------------------------------
   `prog(profile)` returns the player's current progress toward `goal`.
   Keeping progress as a number rather than a boolean means the menu can
   show "7 / 10" instead of a grey square, and means a single check()
   pass unlocks anything that was already satisfied. */
const ACH_DEFS = [
  { id: 'first_blood', name: 'First Blood', tier: 'bronze', goal: 1,
    desc: 'Eliminate your first opponent.',
    prog: p => p.kills },
  { id: 'marksman', name: 'Marksman', tier: 'bronze', goal: 10,
    desc: 'Eliminate 10 opponents.',
    prog: p => p.kills },
  { id: 'veteran', name: 'Veteran', tier: 'gold', goal: 100,
    desc: 'Eliminate 100 opponents.',
    prog: p => p.kills },
  { id: 'headhunter', name: 'Headhunter', tier: 'silver', goal: 10,
    desc: 'Land 10 headshot eliminations.',
    prog: p => p.headshots },
  { id: 'skullsplitter', name: 'Skull Splitter', tier: 'gold', goal: 50,
    desc: 'Land 50 headshot eliminations.',
    prog: p => p.headshots },
  { id: 'overwatch', name: 'Overwatch', tier: 'silver', goal: 60,
    desc: 'Eliminate someone from 60 m or further.',
    prog: p => p.longestShot, unit: 'm' },
  { id: 'cold_bore', name: 'Cold Bore', tier: 'silver', goal: 10,
    desc: 'Eliminate 10 opponents with the AWP.',
    prog: p => p.weaponKills.sniper || 0 },
  { id: 'close_quarters', name: 'Close Quarters', tier: 'bronze', goal: 1,
    desc: 'Eliminate someone with the combat knife.',
    prog: p => p.weaponKills.knife || 0 },
  { id: 'demolition', name: 'Demolition', tier: 'bronze', goal: 1,
    desc: 'Eliminate someone with a frag grenade.',
    prog: p => p.weaponKills.grenade || 0 },
  { id: 'full_house', name: 'Full House', tier: 'gold', goal: 8,
    desc: 'Eliminate someone with every weapon in the game.',
    prog: p => Object.keys(p.weaponKills).filter(k => p.weaponKills[k] > 0).length },
  { id: 'sharpshooter', name: 'Sharpshooter', tier: 'silver', goal: 1,
    desc: 'Eliminate someone while scoped at 8× magnification.',
    prog: p => p.zoomKills['8'] || 0 },
  { id: 'first_win', name: 'First Win', tier: 'bronze', goal: 1,
    desc: 'Win a match.',
    prog: p => p.wins },
  { id: 'champion', name: 'Champion', tier: 'gold', goal: 10,
    desc: 'Win 10 matches.',
    prog: p => p.wins },
  { id: 'flag_runner', name: 'Flag Runner', tier: 'bronze', goal: 1,
    desc: 'Capture the enemy flag.',
    prog: p => p.captures },
  { id: 'raider', name: 'Raider', tier: 'silver', goal: 10,
    desc: 'Capture the enemy flag 10 times.',
    prog: p => p.captures },
  { id: 'looter', name: 'Looter', tier: 'bronze', goal: 10,
    desc: 'Open 10 crates.',
    prog: p => p.chests },
  { id: 'pack_rat', name: 'Pack Rat', tier: 'silver', goal: 1,
    desc: 'Fill all five bag slots in one life.',
    prog: p => p.fullBags },
  { id: 'trained', name: 'Trained', tier: 'bronze', goal: 1,
    desc: 'Complete every training objective.',
    prog: p => p.tutorialDone },
  { id: 'iron_lung', name: 'Iron Lung', tier: 'silver', goal: 5,
    desc: 'Recover from oxygen debt 5 times without dying.',
    prog: p => p.oxygenSaves },
  { id: 'survivor', name: 'Survivor', tier: 'silver', goal: 5,
    desc: 'Eliminate 5 opponents without dying.',
    prog: p => p.bestStreak },
  { id: 'host', name: 'Host', tier: 'bronze', goal: 1,
    desc: 'Host an online room.',
    prog: p => p.roomsHosted },
  { id: 'networked', name: 'Networked', tier: 'silver', goal: 1,
    desc: 'Play an online match with another human.',
    prog: p => p.onlineMatches }
];

/* the weapons that can actually score a kill, for the Full House badge */
const ACH_WEAPON_IDS = ['knife', 'pistol', 'smg', 'rifle', 'shotgun', 'sniper', 'crossbow', 'grenade'];

function achBlankStats() {
  return {
    kills: 0, headshots: 0, deaths: 0,
    matches: 0, wins: 0, losses: 0, draws: 0,
    captures: 0, chests: 0, tutorialDone: 0, fullBags: 0,
    oxygenSaves: 0, streak: 0, bestStreak: 0, longestShot: 0,
    onlineMatches: 0, roomsHosted: 0,
    weaponKills: {}, zoomKills: {}
  };
}

function achBlankProfile() {
  return { v: ACH_VERSION, stats: achBlankStats(), unlocked: {}, seen: false };
}

/* ------------------------------------------------------------
   THE STORE
   ------------------------------------------------------------ */
const Ach = {
  data: achBlankProfile(),
  available: true,          // localStorage can be unavailable (private mode)
  _warned: false,

  /* read the save, tolerating a missing, corrupt or older document */
  load() {
    let raw = null;
    try {
      raw = localStorage.getItem(ACH_KEY);
    } catch (e) {
      this.available = false;
    }
    if (!raw) { this.data = achBlankProfile(); return this.data; }
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
    if (!parsed || typeof parsed !== 'object') { this.data = achBlankProfile(); return this.data; }
    this.data = this.migrate(parsed);
    return this.data;
  },

  /* Fill in anything a newer build needs. Unknown keys are preserved so a
     rollback to an older build does not destroy a newer save. */
  migrate(p) {
    const out = p;
    if (typeof out.v !== 'number') out.v = 0;
    if (!out.stats || typeof out.stats !== 'object') out.stats = achBlankStats();
    const blank = achBlankStats();
    for (const k in blank) {
      if (out.stats[k] === undefined || out.stats[k] === null) {
        out.stats[k] = (blank[k] && typeof blank[k] === 'object') ? {} : blank[k];
      }
    }
    if (typeof out.stats.weaponKills !== 'object' || !out.stats.weaponKills) out.stats.weaponKills = {};
    if (typeof out.stats.zoomKills !== 'object' || !out.stats.zoomKills) out.stats.zoomKills = {};
    if (!out.unlocked || typeof out.unlocked !== 'object') out.unlocked = {};
    /* a save written before a definition existed simply has it locked */
    for (const d of ACH_DEFS) {
      if (out.unlocked[d.id] === undefined) { /* leave locked */ }
    }
    out.v = ACH_VERSION;
    return out;
  },

  /* Write-through. Called after every mutation so a hard shutdown can never
     lose progress that was already earned. */
  save() {
    if (!this.available) return;
    try {
      localStorage.setItem(ACH_KEY, JSON.stringify(this.data));
    } catch (e) {
      /* quota or a locked-down profile: keep playing, just do not persist */
      this.available = false;
      if (!this._warned) {
        this._warned = true;
        console.warn('WHITE MAZE: progress cannot be saved in this browser.');
      }
    }
  },

  get s() { return this.data.stats; },

  /* counters */
  bump(key, n) {
    n = n === undefined ? 1 : n;
    if (typeof this.s[key] !== 'number') this.s[key] = 0;
    this.s[key] += n;
    this.save();
    this.check();
    return this.s[key];
  },
  /* running maximum — for "longest shot" style records */
  peak(key, v) {
    if (typeof this.s[key] !== 'number') this.s[key] = 0;
    if (v > this.s[key]) { this.s[key] = v; this.save(); this.check(); }
  },
  mark(key) {
    this.s[key] = 1;
    this.save();
    this.check();
  },
  resetStreak() {
    this.s.streak = 0;
    this.save();
  },

  /* ------------------------------------------------------------
     KILL ACCOUNTING
     ------------------------------------------------------------ */
  onPlayerKill(info) {
    const s = this.s;
    s.kills++;
    if (info.head) s.headshots++;
    if (info.weaponId) {
      s.weaponKills[info.weaponId] = (s.weaponKills[info.weaponId] || 0) + 1;
    }
    if (info.zoom && info.weaponId === 'sniper') {
      const k = String(info.zoom);
      s.zoomKills[k] = (s.zoomKills[k] || 0) + 1;
    }
    if (info.dist > s.longestShot) s.longestShot = Math.round(info.dist * 10) / 10;
    s.streak++;
    if (s.streak > s.bestStreak) s.bestStreak = s.streak;
    this.save();
    this.check();
  },

  /* ------------------------------------------------------------
     UNLOCK EVALUATION
     ------------------------------------------------------------ */
  check(quiet) {
    const unlocked = [];
    for (const d of ACH_DEFS) {
      if (this.data.unlocked[d.id]) continue;
      let v = 0;
      try { v = d.prog(this.s) || 0; } catch (e) { v = 0; }
      if (v >= d.goal) {
        this.data.unlocked[d.id] = Date.now();
        unlocked.push(d);
      }
    }
    if (unlocked.length) {
      this.save();
      if (!quiet) for (const d of unlocked) this.toast(d);
    }
    return unlocked;
  },

  unlockedCount() {
    return ACH_DEFS.filter(d => this.data.unlocked[d.id]).length;
  },
  totalCount() { return ACH_DEFS.length; },
  isUnlocked(id) { return !!this.data.unlocked[id]; },

  /* progress line for the menu */
  progressOf(d) {
    let v = 0;
    try { v = Math.min(d.goal, d.prog(this.s) || 0); } catch (e) { v = 0; }
    return { v: Math.round(v * 10) / 10, goal: d.goal };
  },

  /* ------------------------------------------------------------
     TOASTS
     ------------------------------------------------------------ */
  toast(d) {
    const host = $('achToasts');
    if (!host) return;
    const el = document.createElement('div');
    el.className = 'ach-toast ' + d.tier;
    el.innerHTML =
      '<div class="at-badge">★</div>' +
      '<div class="at-txt"><div class="at-kick">ACHIEVEMENT UNLOCKED</div>' +
      '<div class="at-name">' + escHtml(d.name) + '</div>' +
      '<div class="at-desc">' + escHtml(d.desc) + '</div></div>';
    host.appendChild(el);
    /* let the browser paint the hidden state before the transition starts */
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => {
      el.classList.remove('in');
      setTimeout(() => el.remove(), 500);
    }, 4200);
    Snd.tone(880, 1320, 0.14, 0.16, 'triangle');
    setTimeout(() => Snd.tone(1320, 1760, 0.18, 0.12, 'triangle'), 130);
  },

  /* ------------------------------------------------------------
     MENU PANEL
     ------------------------------------------------------------ */
  renderPanel() {
    const body = $('achBody');
    if (!body) return;
    const n = this.unlockedCount(), t = this.totalCount();
    const pct = Math.round(n / t * 100);
    const s = this.s;
    const acc = s.kills + s.deaths > 0 ? Math.round(s.kills / (s.kills + s.deaths) * 100) : 0;

    let head = '<div class="ach-top">' +
      '<div class="ach-score"><b>' + n + '</b><span>/ ' + t + ' unlocked</span></div>' +
      '<div class="ach-meter"><i style="width:' + pct + '%"></i></div>' +
      '<div class="ach-pct">' + pct + '%</div>' +
      '</div>';

    const stats =
      '<div class="ach-stats">' +
      '<div><b>' + s.kills + '</b><span>KILLS</span></div>' +
      '<div><b>' + s.headshots + '</b><span>HEADSHOTS</span></div>' +
      '<div><b>' + s.matches + '</b><span>MATCHES</span></div>' +
      '<div><b>' + s.wins + '</b><span>WINS</span></div>' +
      '<div><b>' + s.captures + '</b><span>CAPTURES</span></div>' +
      '<div><b>' + s.bestStreak + '</b><span>BEST STREAK</span></div>' +
      '<div><b>' + (s.longestShot ? Math.round(s.longestShot) + 'm' : '—') + '</b><span>LONGEST KILL</span></div>' +
      '<div><b>' + acc + '%</b><span>K/D</span></div>' +
      '</div>';

    const cards = ACH_DEFS.map(d => {
      const got = this.isUnlocked(d.id);
      const pr = this.progressOf(d);
      const w = Math.min(100, Math.round(pr.v / pr.goal * 100));
      const unit = d.unit || '';
      return '<div class="ach-card ' + d.tier + (got ? ' got' : '') + '">' +
        '<div class="ac-star">' + (got ? '★' : '☆') + '</div>' +
        '<div class="ac-main">' +
        '<div class="ac-name">' + escHtml(d.name) + '</div>' +
        '<div class="ac-desc">' + escHtml(d.desc) + '</div>' +
        (got
          ? '<div class="ac-bar done"><i style="width:100%"></i></div><div class="ac-num">UNLOCKED</div>'
          : '<div class="ac-bar"><i style="width:' + w + '%"></i></div>' +
            '<div class="ac-num">' + pr.v + ' / ' + pr.goal + unit + '</div>') +
        '</div></div>';
    }).join('');

    body.innerHTML = head + stats + '<div class="ach-grid">' + cards + '</div>';
  },

  /* Wipe everything. Only reachable from the panel, behind a confirm. */
  wipe() {
    this.data = achBlankProfile();
    this.save();
    this.renderPanel();
  }
};

/* ------------------------------------------------------------
   STARTUP
   ------------------------------------------------------------ */
function initAchievements() {
  Ach.load();
  /* a save that was already complete when the build changed should show its
     badges immediately rather than waiting for the next kill */
  Ach.check(true);
  const btn = $('btnAchWipe');
  if (btn) {
    btn.addEventListener('click', () => {
      if (confirm('Erase all achievements and lifetime stats? This cannot be undone.')) Ach.wipe();
    });
  }
}
