/* ============================================================
   98-menu.js
   Menu, how-to pages and UI wiring
   ============================================================ */
'use strict';

/* ------------------------------------------------------------
   MENU / UI WIRING
   ------------------------------------------------------------ */
const HT_PAGES = [
  {
    t: 'MISSION BRIEFING',
    /* a function, not a string: the side you deploy on is a menu choice, so
       hard-coding "you deploy with the RED team" was a lie half the time */
    h: () => {
      const mine = G.team, foe = otherTeam(mine);
      const corner = t => t === 'red' ? 'south-west' : 'north-east';
      const cls = t => t === 'red' ? 'r' : 'b';
      return `<h3>5 v 5 · Red Team vs Blue Team</h3>
    <p>You deploy with the <span class="${cls(mine)}">${teamLabel(mine)} TEAM</span> — four AI teammates and you — against five
    <span class="${cls(foe)}">${teamLabel(foe)}</span> operators. You pick your side on the main menu before you deploy, and you can change it there at any time.
    The arena is a sealed white maze. There is no exit: the walls go all the way round and up.</p>
    <h4>THE MAZE</h4>
    <p><b>Level 1</b> is a 13x13 labyrinth with wide corridors and plenty of loops — you can always back out of a dead end.
    <b>Level 2</b> is a catwalk platform that runs around the entire outer edge, 4.2 m above the maze floor.
    From up there you can see the whole labyrinth and shoot down into it — but you are also the most exposed target on the map.</p>
    <p>Four stairways lead up to the catwalk, one in the middle of each side. Each team owns a wide open corner plaza:
    red in the <b>south-west</b>, blue in the <b>north-east</b>. A plaza is that team's HQ, spawn and flag.</p>
    <p>You are on the <span class="${cls(mine)}">${teamLabel(mine)} TEAM</span>, so your HQ is the
    <b>${corner(mine)}</b> plaza and the enemy holds the <b>${corner(foe)}</b> one.</p>
    <h4>YOUR LOADOUT</h4>
    <p>You always start with a <span class="accent">knife</span> and a <span class="accent">pistol</span>.
    Everything else is found in crates. Pick your fights early — a pistol loses to a rifle at range.
    You have <span class="accent">140 HP</span> and <b>no regeneration</b>: a <span class="accent">FIELD AID</span>
    from a crate is the only way to get health back, so a fight you cannot win is a fight you should leave.</p>
    <h4>STAMINA</h4>
    <p>Sprinting and holding your breath behind the scope both come out of one <span class="accent">stamina</span> bar.
    It refills on its own after a short pause. Run it to <b>zero</b> and you are in oxygen debt: the sprint locks out
    and your <b>health starts bleeding away</b> until you have got your breath back — so do not sprint straight into a fight.</p>`;
    }
  },
  {
    t: 'CONTROLS',
    h: `<table>
      <tr><th>INPUT</th><th>ACTION</th></tr>
      <tr><td><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></td><td>Move</td></tr>
      <tr><td><kbd>MOUSE</kbd></td><td>Look / aim</td></tr>
      <tr><td><kbd>LEFT CLICK</kbd></td><td>Fire · use an item · <b>hold</b> to draw the crossbow or aim a grenade</td></tr>
      <tr><td><kbd>RIGHT CLICK</kbd></td><td>Open a crate when standing on one</td></tr>
      <tr><td><kbd>E</kbd></td><td>Aim down sights — tighter spread, slight zoom, slower turn. The <b>AWP</b> gets a full scope: mil-dot reticle, selectable <b>2× / 4× / 8×</b> magnification, very slow turn</td></tr>
      <tr><td><kbd>Q</kbd></td><td><b>Hold your breath</b> while scoped — costs stamina, steadies the wobble</td></tr>
      <tr><td><kbd>Z</kbd></td><td>Cycle the AWP magnification — <b>2× / 4× / 8×</b>. While scoped the mouse wheel does the same thing</td></tr>
      <tr><td><kbd>R</kbd></td><td>Reload</td></tr>
      <tr><td><kbd>SHIFT</kbd></td><td>Sprint (forward) — <b>drains stamina</b></td></tr>
      <tr><td><kbd>SPACE</kbd></td><td>Jump</td></tr>
      <tr><td><kbd>1</kbd>–<kbd>5</kbd></td><td>Select a bag slot</td></tr>
      <tr><td><kbd>MOUSE WHEEL</kbd></td><td>Roll up / down to cycle to the previous / next bag slot</td></tr>
      <tr><td><kbd>MIDDLE CLICK</kbd></td><td>Cycle to the next bag slot</td></tr>
      <tr><td><kbd>TAB</kbd></td><td>Scoreboard (kills / deaths / HP)</td></tr>
      <tr><td><kbd>ESC</kbd></td><td>Pause</td></tr>
      <tr><td><kbd>F3</kbd></td><td>Performance readout — frame rate, frame time and the current render scale</td></tr>
    </table>
    <p>The mouse is captured when you click the arena. Browsers refuse to hand it back for about a second after <kbd>ESC</kbd>, so if the view will not turn you will see <b>CLICK TO CAPTURE MOUSE</b> — click once and it is yours again. Your movement keys work the whole time.</p>
    <p>If the game feels heavy, watch <kbd>F3</kbd>: it shows what the frame rate actually is, and the resolution scale it has dropped to. The game lowers shadows and render resolution on its own when frames get long, so a slow laptop degrades instead of stuttering.</p>`
  },
  {
    t: 'WEAPONS & CRATES',
    h: `<h3>Seven weapons, two of them yours from the start</h3>
    <table>
      <tr><th>WEAPON</th><th>DMG</th><th>MAG</th><th>NOTES</th></tr>
      <tr><td>Combat Knife</td><td>58</td><td>—</td><td>Always equipped, silent, 2.5 m reach</td></tr>
      <tr><td>M9 Pistol</td><td>26</td><td>12</td><td>Starting sidearm, accurate, semi-auto</td></tr>
      <tr><td>MP5 SMG</td><td>17</td><td>30</td><td>Fast full-auto, great indoors</td></tr>
      <tr><td>AK-47 Rifle</td><td>31</td><td>30</td><td>Best all-rounder</td></tr>
      <tr><td>SPAS-12</td><td>12×8</td><td>6</td><td>Up to 96 damage when every pellet lands — drops an Easy bot outright, but not a Normal bot or a player</td></tr>
      <tr><td>AWP Sniper</td><td>115</td><td>5</td><td>One body shot drops an Easy, Normal or Hard bot; Legend (125 HP) survives one. Punishing reload. <b>E for the scope</b> — mil-dot reticle, <b>2× / 4× / 8×</b> magnification, finer aim the further you zoom. <b>Hold Q</b> to steady the wobble (costs stamina)</td></tr>
      <tr><td>Crossbow</td><td>105</td><td>3</td><td><b>2 s draw</b> per bolt, only 30 m of range — a duelling weapon</td></tr>
    </table>
    <h4>ITEMS — the teal crates</h4>
    <table>
      <tr><th>ITEM</th><th>USE</th></tr>
      <tr><td><b>Field Aid</b></td><td>Click to patch up <b>40 HP</b>. Nothing else heals you.</td></tr>
      <tr><td><b>Frag Grenade</b></td><td>Hold to aim: a gold arc shows where it lands, and it turns <b>red</b> when an enemy is caught in the blast. Release to throw.</td></tr>
      <tr><td><b>Ammo Box</b></td><td>Refills the reserve of every gun you carry.</td></tr>
      <tr><td><b>Stim Shot</b></td><td>+34% movement speed for 8 seconds.</td></tr>
    </table>
    <p>Grenades hurt <b>enemies and yourself</b> — never teammates — and a wall between you and the blast saves you.
    Their damage falls off with distance, so land one at someone's feet rather than at their silhouette.</p>
    <h4>CRATES</h4>
    <p>Eight wooden crates sit in open ground — one in each HQ plaza, four spread over maze junctions, two up on the catwalk. Every one throws a <span class="accent">column of light</span>
    into the air, shows a spinning marker, and is drawn as a diamond on the tactical map — you should never have to hunt for one.
    <b>Gold</b> crates hold a gun, <b>teal</b> crates hold an item; the prompt tells you what is inside before you take it.</p>
    <p>Walk up and <b>right-click</b> to take it. A used crate refills after ~26 seconds with something new, so camp it or beat the enemy to it.
    Your bag has <b>five slots</b>: knife, pistol and three pickups. When it is full, a new pickup replaces <b>whatever you are holding</b>
    (or the last slot, if you are on the knife or pistol) — so switch to the thing you are willing to lose before you loot.</p>
    <p><span class="accent">Headshots deal double damage</span> — the AWP drops anyone with a single headshot; the AK needs two, or three on a Legend.</p>`
  },
  {
    t: 'GAME MODES',
    h: `<h3><span class="r">TEAM DEATHMATCH</span> — 5:00</h3>
    <ul>
      <li>Every kill scores 1 point for your team.</li>
      <li>The team with the most kills when the clock hits 0:00 wins.</li>
      <li>Respawn after <b>3 seconds</b> at your base.</li>
    </ul>
    <h3><span class="b">FLAG RAID</span> — 5:00</h3>
    <ul>
      <li>Each team has a flag at its HQ: red in the <b>south-west</b> corner of the maze, blue in the <b>north-east</b>.</li>
      <li>Walk over the enemy flag to pick it up, then carry it back to your own HQ and <b>hold position for 2.4 s</b> to score — touching the pad is not enough.</li>
      <li>You can only score while <b>your own flag is at home</b> — if yours is stolen, hunt the carrier or touch your dropped flag to return it.</li>
      <li>Dropped flags return to base after 20 seconds.</li>
      <li>The team with the most captures when the clock hits 0:00 wins.</li>
      <li>Respawn after <b>3 seconds</b>. Carriers are marked on the HUD.</li>
    </ul>
    <h3><span class="g">KING OF THE HILL</span> — first to 90</h3>
    <ul>
      <li>One <b>circle in the middle of the map</b> — a lit column you can see over the walls. On a map with a platform, it is on top of it.</li>
      <li>Stand in it with <b>no enemy inside</b> and your score climbs <b>1 point per second</b>.</li>
      <li>Both teams inside = <span class="accent">contested</span>: nobody scores until one side is cleared out.</li>
      <li>First team to <b>90</b> wins; most time held at 0:00 otherwise.</li>
    </ul>
    <h3><span class="b">LAST STAND</span> — one round</h3>
    <ul>
      <li><b>One life each, no respawns.</b> Die and you stay down, watching, until the match is decided.</li>
      <li>Wipe the enemy team and the match is yours.</li>
      <li>If the clock runs out with both teams alive, the next kill wins it.</li>
    </ul>
    <h4>GOLDEN POINT</h4>
    <p>If the clock runs out with the scores <b>level</b>, the match does not end in a draw — it goes to
    <span class="accent">golden point</span>. The next score wins it outright: the next kill in Team Deathmatch,
    the next capture in Flag Raid, the next second held in King of the Hill. A suicide leaves both scores untouched,
    so the round simply plays on.</p>
    <h4>AFTER THE MATCH — THE VOTE</h4>
    <p>Every match ends on a <b>vote</b>, not a menu. Everyone in the room gets a say — you by clicking a mode
    and a map, every AI operator on a timer of its own. The counts update live, the timer runs
    <b>25 seconds</b>, and whatever won is what you play next. <b>DEPLOY NOW</b> skips the wait and starts the
    current leader immediately.</p>
    <h4>WHEN YOU GO DOWN</h4>
    <p>The camera stays in the arena: first over your own body, then it swings onto
    <span class="accent">whoever killed you</span> and follows them until you respawn —
    so you always learn who got you, and from where. In Last Stand there is no respawn to wait for, so the
    camera stays with the killer until the match resolves.</p>`
  },
  {
    t: 'THE MAPS',
    h: `<h3>Four arenas, all built from the same rules</h3>
    <p>Every map is generated from a seed, so the layout is fixed and fair rather than random each match.
    What changes is the size of the cells, how tall the walls are, how many loops are cut through them,
    and whether there is a catwalk over your head.</p>
    <table>
      <tr><th>MAP</th><th>SIZE</th><th>HEIGHT</th><th>WHAT IT PLAYS LIKE</th></tr>
      <tr><td><b>WHITE MAZE</b></td><td>13 × 13</td><td>Catwalk at 4.2 m</td><td>The original. Long sightlines from the deck, knife corners underneath.</td></tr>
      <tr><td><b>ASH GARDEN</b></td><td>15 × 15</td><td>Catwalk at 5.1 m</td><td>Wider cells, lower walls, far more loops. Fights break up fast.</td></tr>
      <tr><td><b>THE VAULT</b></td><td>11 × 11</td><td>Tall walls, no deck</td><td>Close quarters. Bring a shotgun or the knife.</td></tr>
      <tr><td><b>DEEP SECTORS</b></td><td>17 × 17</td><td>Central platform</td><td>The longest routes and the most places to be ambushed.</td></tr>
    </table>
    <h4>CATWALK OR PLINTH</h4>
    <p>White Maze and Ash Garden have a <b>catwalk ring</b> over the maze, reached by four stair ramps in the
    middle of each side. The Vault and Deep Sectors have no deck — instead a stepped <b>plinth</b> stands in an
    open plaza in the middle of the map, five tiers of 0.45 m that you walk up rather than jump. Either way there
    is high ground, and either way standing on it makes you the easiest target on the map.</p>
    <h4>THE ARENA WALL</h4>
    <p>Every map is sealed. The catwalk maps are enclosed by the parapet the deck sits on; the flat maps have a
    full-height <b>arena wall</b> with a dark cap and a band on the floor at its foot, so there is no walking off
    the edge and no guessing where the level ends. Each arena also has its own stone: white plaster, warm
    sandstone, cool steel and olive concrete.</p>
    <h4>WHAT CARRIES OVER</h4>
    <p>Your team, difficulty and loadout rules are the same on every map. Crates are placed on junctions and
    plazas, never in dead ends, so a crate is always reachable without turning your back on a corridor.</p>`
  },
  {
    t: 'AI DIFFICULTY',
    h: `<h3>Four levels — they change aim, reaction and aggression</h3>
    <table>
      <tr><th>LEVEL</th><th>REACTION</th><th>AIM ERROR</th><th>DAMAGE</th><th>RANGE</th></tr>
      <tr><td><b>EASY</b></td><td>0.90 s</td><td>Wide</td><td>42%</td><td>18 m</td></tr>
      <tr><td><b>NORMAL</b></td><td>0.58 s</td><td>Medium</td><td>62%</td><td>26 m</td></tr>
      <tr><td><b>HARD</b></td><td>0.34 s</td><td>Tight</td><td>84%</td><td>36 m</td></tr>
      <tr><td><b>LEGEND</b></td><td>0.17 s</td><td>Very tight</td><td>105%</td><td>50 m</td></tr>
    </table>
    <p>Reaction times are the base figure — a bot actually takes anywhere from 75% to 130% of it, so the same
    difficulty does not feel robotic. Damage is a share of the weapon's normal damage, so only <b>LEGEND</b> hits
    harder than you do.</p>
    <p>Higher levels also strafe more, reload faster and have more HP (Hard 110 / Legend 125).</p>
    <h4>TACTICS</h4>
    <ul>
      <li>Listen for the direction of gunfire and check your teammates' HP bars — a collapsing flank shows up there first.</li>
      <li>Bots need line of sight. Break it, reload, then re-peek.</li>
      <li>On Legend, never cross an open doorway without an escape route.</li>
      <li>Grab a rifle from a crate in the first 20 seconds. The pistol will not win a 1v1 at range.</li>
    </ul>`
  },
  {
    t: 'ONLINE & PROGRESS',
    h: `<h3>Online rooms</h3>
    <p><b>PLAY ONLINE</b> on the main menu opens the room browser. Rooms are relayed through a public MQTT
    broker over WebSockets — there is no game server, and nothing to sign up for.</p>
    <ul>
      <li><b>Hosting</b> — pick a mode, a map, a visibility, whether AI squads join, and how hard they are. You get a
      four-character <b>invite code</b> the moment the room opens.</li>
      <li><b>Every mode is playable online</b> — deathmatch, flag raid, king of the hill and last stand. The mode and
      map are chosen when the room is hosted; after that the end-of-match vote decides.</li>
      <li><b>Public</b> rooms appear in the room list for everyone connected, and can also be joined by code.</li>
      <li><b>Private</b> rooms never appear in the list. The invite code is the only way in.</li>
      <li><b>AI squads</b> — with AI on, your machine also simulates a bot squad that fights you and the other
      bots. With AI off the match is humans only. The host decides, and the setting reaches everyone in the room.</li>
      <li>Leaving, or the host closing the room, returns everyone to the menu.</li>
    </ul>
    <h4>Who judges the objective</h4>
    <p>Bots are simulated separately on every machine, so two computers can never agree about where a bot is
    standing. Objectives are therefore judged by the <b>host</b>, from the human players in the room, and broadcast:
    a flag is carried, dropped and captured on the host, the hill counts the seconds the host sees you standing in
    it, and a last-stand round ends when the host sees a team's humans go down. Every other machine draws that
    state. Bots still shoot at you — they just never score, which is how a kill already worked online.</p>
    <h4>What to expect from the netcode</h4>
    <p>Each player owns their own body: your position and health are yours, and a hit you land is sent to the
    person you hit. The host owns the scoreboard and the clock, so two machines can never disagree about the
    score. Other players are drawn by interpolating the last position they sent, which keeps them smooth even
    when a public broker is slow — a round trip of 100–700 ms is normal, so lead your shots at range.</p>
    <h4>Voting in a room</h4>
    <p>The end-of-match vote works online too, and <b>the host counts</b>. You pick a mode and a map, the host
    folds your vote in with its own squad's and sends the running total back, so everybody sees the same numbers.
    When the host's timer runs out it announces the winner and every machine deploys to it — you cannot start a
    different match by yourself, and <b>DEPLOY NOW</b> only works for the host.</p>
    <h4>Achievements</h4>
    <p>Twenty-two badges, from <b>First Blood</b> to <b>Full House</b>. Everything is saved on this device the
    moment you earn it, so closing the browser or shutting the machine down does not lose progress. The
    <b>ACHIEVEMENTS</b> screen shows lifetime kills, headshots, wins, captures, best streak and longest kill,
    plus how far you are from each locked badge.</p>
    <p>Kills are attributed to the weapon that actually did the damage, so a knife kill counts toward
    <b>Close Quarters</b> and a grenade toward <b>Demolition</b>. <b>Sharpshooter</b> needs the AWP at 8×.</p>`
  }
];
let htPage = 0;
function renderHowTo() {
  const page = HT_PAGES[htPage];
  /* some pages are built from live match state (which side you picked) */
  $('htBody').innerHTML = typeof page.h === 'function' ? page.h() : page.h;
  $('htDots').innerHTML = HT_PAGES.map((p, i) => '<i class="' + (i === htPage ? 'on' : '') + '"></i>').join('');
  $('htPrev').style.visibility = htPage === 0 ? 'hidden' : 'visible';
  $('htNext').textContent = htPage === HT_PAGES.length - 1 ? 'GOT IT' : 'NEXT →';
}

function showTeamDesc() {
  const el = $('teamDesc');
  if (!el) return;
  const mine = G.team, foe = otherTeam(mine);
  const corner = t => t === 'red' ? 'south-west' : 'north-east';
  el.innerHTML = 'You deploy with <b style="color:' + (mine === 'red' ? '#ff6b6b' : '#7fabff') + '">' +
    teamLabel(mine) + '</b> in the ' + corner(mine) + ' plaza, alongside four AI teammates. ' +
    'Five <b style="color:' + (foe === 'red' ? '#ff6b6b' : '#7fabff') + '">' + teamLabel(foe) +
    '</b> operators hold the ' + corner(foe) + ' plaza.';
}

function initMenu() {
  renderModeCards();
  renderMapCards();
  /* Delegation, not per-button listeners: both rows are re-rendered whenever a
     selection changes, which replaces the buttons and takes their listeners
     with them. Binding once on the container survives every re-render — this
     is what made the map picker work exactly one time. */
  const modeRow = $('modeGrid');
  if (modeRow) modeRow.addEventListener('click', e => {
    const el = e.target.closest('.mode-card');
    if (!el) return;
    if (el.dataset.mode === 'tutorial') startGame('tutorial');
    else startGame(el.dataset.mode, G.mapId);
  });
  const mapRow = $('mapRow');
  if (mapRow) mapRow.addEventListener('click', e => {
    const el = e.target.closest('.map-card');
    if (!el) return;
    if (G.mapId === el.dataset.map) return;
    G.mapId = el.dataset.map;
    renderMapCards();
    Snd.tone(520, 640, 0.04, 0.08, 'square');
  });
  document.querySelectorAll('#diffRow button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#diffRow button').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      G.diff = btn.dataset.diff;
      const d = DIFF[G.diff];
      const descs = {
        easy: 'Slow reactions and loose aim. Good for learning the map.',
        normal: 'Balanced bots. They miss sometimes and take about half a second to react.',
        hard: 'Fast reactions, tight aim and better positioning. They punish wide peeks.',
        legend: 'Near-instant reactions, 125 HP and 105% damage. Treat every corner as occupied.'
      };
      $('diffDesc').textContent = descs[G.diff];
    });
  });
  document.querySelectorAll('#teamRow button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#teamRow button').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      G.team = btn.dataset.team;
      localStorage.setItem('wh_team', G.team);
      showTeamDesc();
    });
  });
  const savedTeam = localStorage.getItem('wh_team');
  if (savedTeam === 'red' || savedTeam === 'blue') {
    G.team = savedTeam;
    document.querySelectorAll('#teamRow button').forEach(b =>
      b.classList.toggle('on', b.dataset.team === savedTeam));
  }
  showTeamDesc();
  $('btnHowTo').addEventListener('click', () => {
    htPage = 0; renderHowTo(); $('howto').classList.add('show');
  });
  $('htClose').addEventListener('click', () => $('howto').classList.remove('show'));
  $('btnAch').addEventListener('click', () => {
    Ach.renderPanel();
    $('achievements').classList.add('show');
  });
  $('btnAchClose').addEventListener('click', () => $('achievements').classList.remove('show'));
  $('htPrev').addEventListener('click', () => { if (htPage > 0) { htPage--; renderHowTo(); } });
  $('htNext').addEventListener('click', () => {
    if (htPage < HT_PAGES.length - 1) { htPage++; renderHowTo(); }
    else $('howto').classList.remove('show');
  });
  $('btnResume').addEventListener('click', resumeGame);
  $('btnRestart').addEventListener('click', () => {
    /* A restart only exists on one machine. In a room it would reset your world
       while everybody else kept playing the old match — and the host's score
       and objective would then overwrite yours on the next tick. */
    if (G.netMode && NET.room) {
      netToast('The room decides the next match — leave it to play alone');
      return;
    }
    startGame(G.mode, G.mapId);
  });
  $('btnQuit').addEventListener('click', quitToMenu);
  /* the end screen now leads with a vote, so "play again" means "deploy the
     result now" rather than silently skipping the vote */
  $('btnAgain').addEventListener('click', () => {
    if (typeof VOTE !== 'undefined' && VOTE.active) voteSkip();
    else startGame(G.mode, G.mapId);
  });
  $('btnMenu').addEventListener('click', quitToMenu);

  const sens = $('sens');
  const saved = parseFloat(localStorage.getItem('wh_sens') || '1');
  sens.value = saved; G.sensitivity = saved; $('sensVal').textContent = saved.toFixed(2);
  sens.addEventListener('input', () => {
    G.sensitivity = parseFloat(sens.value);
    $('sensVal').textContent = G.sensitivity.toFixed(2);
    localStorage.setItem('wh_sens', G.sensitivity);
  });

  // scoreboard element
  const sb = document.createElement('div');
  sb.id = 'scoreboard';
  $('hud').appendChild(sb);
}


/* ------------------------------------------------------------
   MENU CARDS
   ------------------------------------------------------------
   Built from the MODES / MAPS registries so adding a mode or a map is a data
   change in 00-core.js and nothing else. */
function renderModeCards() {
  const host = $('modeGrid');
  if (!host) return;
  let html = '';
  for (const id of MODE_ORDER) {
    const d = modeDef(id);
    html += '<div class="mode-card" data-mode="' + id + '">' +
      '<div class="mc-top"><span class="mc-tag ' + d.tagClass + '">' + d.tag +
      '</span><span class="mc-time">' + d.time + '</span></div>' +
      '<h3>' + d.title + '</h3>' +
      '<p>' + d.blurb + '</p>' +
      '<div class="mc-go">DEPLOY →</div></div>';
  }
  html += '<div class="mode-card tut" data-mode="tutorial">' +
    '<div class="mc-top"><span class="mc-tag gold">TRAINING</span><span class="mc-time">SAFE</span></div>' +
    '<h3>Tutorial</h3>' +
    '<p>Learn movement, sprinting and stamina, shooting, crates, weapon switching, ' +
    'the AWP scope and its breath hold — with live targets.</p>' +
    '<div class="mc-go">START →</div></div>';
  host.innerHTML = html;
}

function renderMapCards() {
  const host = $('mapRow');
  if (!host) return;
  let html = '';
  for (const id of MAP_ORDER) {
    const d = mapDef(id);
    const on = G.mapId === id ? ' on' : '';
    html += '<button class="map-card' + on + '" data-map="' + id + '">' +
      '<span class="mp-name">' + d.name + '</span>' +
      '<span class="mp-tag">' + d.tag + '</span>' +
      '<span class="mp-size">' + d.time + '</span></button>';
  }
  host.innerHTML = html;
  const desc = $('mapDesc');
  if (desc) desc.textContent = mapDef(G.mapId).blurb;
}
