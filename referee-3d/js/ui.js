/* WHISTLE — UI: menus, HUD, toolbox, dialogue, achievements */
window.REF = window.REF || {};

REF.UI = (function () {
  var U = REF.U;
  var D = REF.DATA;
  var el = {};
  var currentScreen = null;
  var promptText = '';
  var tickerItems = [];
  var lastScoreStr = '';
  var tool = null;
  var minimapCtx = null;
  var dialoguePlayer = null;

  function $(id) { return document.getElementById(id); }

  function h(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined) e.textContent = txt;
    return e;
  }

  function teamColor(id) {
    var t = D.TEAMS[id];
    return t ? t.shirt : '#888';
  }

  /* ------------------------------------------------------------- screens */
  function show(name) {
    var list = document.querySelectorAll('#screens .screen');
    for (var i = 0; i < list.length; i++) list[i].classList.remove('on');
    if (name) {
      var target = $('scr-' + name);
      if (target) target.classList.add('on');
    }
    currentScreen = name;
    $('hud').classList.toggle('on', !name || name === 'pause' || name === 'result');
    if (name) $('continuebar').classList.remove('on');
    if (name && REF.Pointer) REF.Pointer.unlock();
    if (REF.Pointer) REF.Pointer.refresh();
  }

  /* --------------------------------------------------------------- toasts */
  function toast(kicker, title, pts) {
    var box = $('toasts');
    var t = h('div', 'toast');
    t.appendChild(h('span', 't-kick', kicker));
    t.appendChild(h('span', 't-title', title));
    if (pts) t.appendChild(h('span', 't-pts', '+' + pts));
    box.appendChild(t);
    while (box.children.length > 4) box.removeChild(box.firstChild);
    requestAnimationFrame(function () { t.classList.add('in'); });
    setTimeout(function () {
      t.classList.remove('in');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 420);
    }, 3400);
  }

  function feed(text, kind) {
    var e = h('div', 'feed-item ' + (kind || ''));
    e.textContent = text;
    el.ticker.appendChild(e);
    requestAnimationFrame(function () { e.classList.add('in'); });
    setTimeout(function () {
      e.classList.remove('in');
      setTimeout(function () { if (e.parentNode) e.parentNode.removeChild(e); }, 400);
    }, 5200);
    while (el.ticker.children.length > 5) el.ticker.removeChild(el.ticker.firstChild);
  }

  /* --------------------------------------------------------------- menus */
  function buildMenu() {
    var pts = $('menu-points');
    var d = REF.Save.data;
    pts.textContent = d.points + ' PTS';
    $('menu-stats').textContent = d.stats.matches + ' matches · ' + (d.stats.yellows + d.stats.reds) + ' cards · ' + d.stats.whistles + ' whistles';
    var hsub = $('hist-sub');
    if (hsub) hsub.textContent = D.MATCHES.length + ' real classics';
    var sub = $('lt-sub');
    if (sub && REF.Tour) {
      var t = REF.Tour.state();
      if (!t) sub.textContent = 'Random draw · knockout';
      else if (t.done) sub.textContent = D.TEAMS[t.champ].name + ' won it';
      else sub.textContent = t.comp + ' · ' + REF.Tour.stageName(t.round);
    }
  }

  function buildMatchList() {
    var grid = $('match-grid');
    grid.innerHTML = '';
    D.MATCHES.forEach(function (m) {
      var card = h('button', 'mcard');
      card.type = 'button';
      var c0 = teamColor(m.home), c1 = teamColor(m.away);
      card.style.setProperty('--c0', c0);
      card.style.setProperty('--c1', c1);

      var top = h('div', 'mcard-top');
      top.appendChild(h('span', 'comp', m.comp));
      top.appendChild(h('span', 'year', String(m.year)));
      card.appendChild(top);

      var body = h('div', 'mcard-body');
      var row = h('div', 'mcard-teams');
      var t0 = h('div', 'mt');
      t0.appendChild(h('i', 'chip'));
      t0.appendChild(h('b', null, D.TEAMS[m.home].abbr));
      var t1 = h('div', 'mt');
      t1.appendChild(h('b', null, D.TEAMS[m.away].abbr));
      t1.appendChild(h('i', 'chip'));
      row.appendChild(t0);
      row.appendChild(h('span', 'vs', 'v'));
      row.appendChild(t1);
      body.appendChild(row);
      body.appendChild(h('div', 'mcard-score', m.score));
      card.appendChild(body);

      card.appendChild(h('div', 'mcard-note', m.note));
      var foot = h('div', 'mcard-foot');
      foot.appendChild(h('span', null, m.stage + ' · ' + m.venue));
      foot.appendChild(h('span', 'go', 'REFEREE →'));
      card.appendChild(foot);

      card.addEventListener('click', function () {
        REF.Audio.click();
        REF.Game.startMatch(m.id);
      });
      grid.appendChild(card);
    });
  }

  function buildSkins() {
    var grid = $('skin-grid');
    grid.innerHTML = '';
    var d = REF.Save.data;
    D.SKINS.forEach(function (s) {
      var owned = !!d.skins[s.id];
      var active = d.skin === s.id;
      var card = h('button', 'scard' + (owned ? '' : ' locked') + (active ? ' active' : ''));
      card.type = 'button';

      var prev = h('div', 'sprev');
      prev.style.background = s.shirt2
        ? 'repeating-linear-gradient(90deg,' + s.shirt + ' 0 12px,' + s.shirt2 + ' 12px 24px)'
        : s.shirt;
      var body = h('div', 'sbody');
      body.style.background = s.shorts;
      prev.appendChild(body);
      card.appendChild(prev);

      card.appendChild(h('div', 'sname', s.name));
      card.appendChild(h('div', 'sdesc', s.desc));

      var foot = h('div', 'sfoot');
      if (active) foot.appendChild(h('span', 'tag-active', 'EQUIPPED'));
      else if (owned) foot.appendChild(h('span', 'tag-owned', 'OWNED'));
      else foot.appendChild(h('span', 'tag-cost', s.cost + ' PTS'));
      card.appendChild(foot);

      card.addEventListener('click', function () {
        REF.Audio.click();
        if (owned) {
          REF.Save.setSkin(s.id);
          REF.Game.applySkin();
          buildSkins();
        } else if (REF.Save.data.points >= s.cost) {
          REF.Save.addPoints(-s.cost);
          REF.Save.unlockSkin(s.id);
          REF.Save.setSkin(s.id);
          REF.Game.applySkin();
          REF.Audio.chime();
          buildSkins();
          buildMenu();
          toast('UNLOCKED', s.name, 0);
        } else {
          toast('NOT ENOUGH POINTS', 'Need ' + (s.cost - REF.Save.data.points) + ' more', 0);
        }
      });
      grid.appendChild(card);
    });
    $('skin-points').textContent = d.points + ' PTS';
  }

  function buildAch() {
    var list = $('ach-list');
    list.innerHTML = '';
    var d = REF.Save.data;
    var got = 0;
    D.ACH.forEach(function (a) {
      var unlocked = !!d.ach[a.id];
      if (unlocked) got++;
      var row = h('div', 'arow' + (unlocked ? ' got' : ''));
      var ic = h('div', 'aic', unlocked ? '★' : '☆');
      row.appendChild(ic);
      var mid = h('div', 'amid');
      mid.appendChild(h('div', 'aname', a.name));
      mid.appendChild(h('div', 'adesc', a.desc));
      row.appendChild(mid);
      row.appendChild(h('div', 'apts', '+' + a.pts));
      list.appendChild(row);
    });
    $('ach-count').textContent = got + ' / ' + D.ACH.length;
    $('ach-points').textContent = d.points + ' PTS';
  }

  /* ---------------------------------------------------------- tournament */
  function teamChip(id) {
    var i = h('i', 'chip');
    var t = D.TEAMS[id];
    i.style.background = t.shirt;
    if (t.shirt2) {
      i.style.backgroundImage = 'repeating-linear-gradient(90deg,' + t.shirt + ' 0 4px,' + t.shirt2 + ' 4px 8px)';
    }
    return i;
  }

  function buildTour() {
    var body = $('tour-body');
    if (!body) return;
    body.innerHTML = '';
    var t = REF.Tour.state();
    if (!t) renderTourPicker(body);
    else renderBracket(body, t);
  }

  function renderTourPicker(body) {
    body.appendChild(h('p', 'tour-lead',
      'Pick a competition and the draw does the rest. You referee the first tie of every round — the other results come in on their own.'));
    var grid = h('div', 'tour-cards');
    D.TOURNAMENTS.forEach(function (c) {
      var card = h('button', 'tcard');
      card.type = 'button';
      card.appendChild(h('div', 'tcard-kick', 'NEW DRAW · ' + (c.size || 8) + ' TEAMS'));
      card.appendChild(h('h3', null, c.name));
      card.appendChild(h('p', null, c.blurb));
      var chips = h('div', 'tchips');
      c.pool.forEach(function (id) { chips.appendChild(teamChip(id)); });
      card.appendChild(chips);
      card.addEventListener('click', function () {
        REF.Audio.click();
        REF.Tour.start(c.id);
        buildTour();
      });
      grid.appendChild(card);
    });
    body.appendChild(grid);
  }

  function tieNode(tie) {
    var node = h('div', 'btie' + (tie.player ? ' you' : '') + (tie.done ? ' done' : ''));
    [['h', tie.h, tie.hs], ['a', tie.a, tie.as]].forEach(function (row) {
      var r = h('div', 'trow' + (tie.done && tie.winner === row[1] ? ' win' : ''));
      r.appendChild(teamChip(row[1]));
      r.appendChild(h('span', null, D.TEAMS[row[1]].abbr));
      if (row[2] !== null && row[2] !== undefined) r.appendChild(h('b', null, String(row[2])));
      node.appendChild(r);
    });
    if (tie.note) node.appendChild(h('div', 'tnote', tie.note));
    if (tie.player && !tie.done) node.appendChild(h('div', 'tyou', 'YOU REFEREE'));
    return node;
  }

  function renderBracket(body, t) {
    var head = h('div', 'tour-head');
    var left = h('div');
    left.appendChild(h('div', 'tour-comp', t.comp + ' · ' + t.year));
    left.appendChild(h('div', 'tour-status',
      t.done ? 'COMPLETE' : REF.Tour.stageName(t.round) + ' · ' + t.alive.length + ' teams left'));
    head.appendChild(left);
    if (t.champ) {
      var ch = h('div', 'tour-champ');
      ch.appendChild(h('span', 'tc-kick', 'CHAMPIONS'));
      ch.appendChild(teamChip(t.champ));
      ch.appendChild(h('b', null, D.TEAMS[t.champ].name));
      head.appendChild(ch);
    }
    body.appendChild(head);

    var grid = h('div', 'bracket');
    var cols = (t.names && t.names.length) || 3;
    grid.style.setProperty('--bcols', String(cols));
    for (var r = 0; r < cols; r++) {
      var col = h('div', 'bcol');
      col.appendChild(h('div', 'bcol-head', (t.names && t.names[r]) || D.ROUND_NAMES[r]));
      var list = h('div', 'blist');
      var ties = t.rounds[r];
      if (!ties) list.appendChild(h('div', 'btie empty', 'to be decided'));
      else ties.forEach(function (tie) { list.appendChild(tieNode(tie)); });
      col.appendChild(list);
      grid.appendChild(col);
    }
    body.appendChild(grid);

    var foot = h('div', 'tour-foot');
    if (!t.done) {
      var tie = REF.Tour.fixture();
      var btn = h('button', 'btn primary tour-go');
      btn.type = 'button';
      btn.innerHTML = '<b>Referee ' + D.TEAMS[tie.h].name + ' v ' + D.TEAMS[tie.a].name +
        '</b><em>' + REF.Tour.stageName(t.round) + ' · ' + t.venue + '</em>';
      btn.addEventListener('click', function () {
        REF.Audio.click();
        REF.Tour.play();
      });
      foot.appendChild(btn);
    } else {
      var again = h('button', 'btn primary tour-go');
      again.type = 'button';
      again.innerHTML = '<b>New tournament</b><em>Fresh draw</em>';
      again.addEventListener('click', function () {
        REF.Audio.click();
        REF.Tour.reset();
        buildTour();
      });
      foot.appendChild(again);
    }
    var abandon = h('button', 'btn tour-abandon');
    abandon.type = 'button';
    abandon.innerHTML = '<b>Abandon</b><em>Start over</em>';
    abandon.addEventListener('click', function () {
      REF.Audio.click();
      if (confirm('Abandon this tournament?')) {
        REF.Tour.reset();
        buildTour();
      }
    });
    foot.appendChild(abandon);
    body.appendChild(foot);
  }

  /* -------------------------------------------------------------- toolbox */
  function buildToolbox() {
    var box = $('toolbox');
    box.innerHTML = '';
    D.TOOLS.forEach(function (t) {
      var b = h('button', 'tool');
      b.type = 'button';
      b.dataset.tool = t.id;
      var glyph = h('span', 'tglyph', t.glyph);
      if (t.color) glyph.style.color = t.color;
      b.appendChild(glyph);
      b.appendChild(h('span', 'tname', t.name));
      b.appendChild(h('span', 'tkey', t.key));
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        REF.Audio.click();
        selectTool(t.id === tool ? null : t.id);
      });
      box.appendChild(b);
    });
  }

  function selectTool(id) {
    tool = id;
    var buttons = document.querySelectorAll('#toolbox .tool');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle('sel', buttons[i].dataset.tool === id);
    }
    document.body.classList.toggle('carding', id === 'yellow' || id === 'red');
    document.body.classList.toggle('talking', id === 'talk');
    document.body.classList.toggle('painting', id === 'paint');
    if (id === 'yellow' || id === 'red') {
      $('toolbox').classList.remove('on');
      setPrompt(id === 'yellow' ? 'Click a player to show the YELLOW card  ·  ESC to cancel' : 'Click a player to show the RED card  ·  ESC to cancel');
    } else if (id === 'talk') {
      $('toolbox').classList.remove('on');
      setPrompt('Click a player to talk  ·  ESC to cancel');
    } else if (id === 'paint') {
      $('toolbox').classList.remove('on');
      if (REF.Pointer) REF.Pointer.unlock();
      var stopped = REF.Game.match && REF.Game.match.frozen;
      setPrompt(stopped
        ? 'Click the pitch to spray the free-kick mark and the wall  ·  ESC to cancel'
        : 'Paint can — blow the whistle first, then mark the free kick');
    } else if (id === 'book') {
      openBook();
    } else {
      updatePromptNow();
    }
    if (REF.Pointer && (id === 'yellow' || id === 'red' || id === 'talk')) REF.Pointer.lock();
  }

  function openToolbox(open) {
    $('toolbox').classList.toggle('on', open);
    if (open && REF.Pointer) REF.Pointer.unlock();
    if (!open && (tool === 'yellow' || tool === 'red' || tool === 'talk')) selectTool(null);
    if (REF.Pointer) REF.Pointer.refresh();
  }

  function openBook() {
    var panel = $('book');
    var list = $('book-list');
    list.innerHTML = '';
    var ev = REF.Game.match ? REF.Game.match.events : [];
    if (!ev.length) list.appendChild(h('div', 'book-empty', 'Nothing yet. Get out there, referee.'));
    ev.slice().reverse().forEach(function (e) {
      var row = h('div', 'book-row ' + e.kind);
      row.appendChild(h('span', 'bmin', e.min + "'"));
      row.appendChild(h('span', 'btext', e.text));
      list.appendChild(row);
    });
    panel.classList.add('on');
    if (REF.Pointer) REF.Pointer.unlock();
  }

  /* ------------------------------------------------------------- dialogue */
  var RESPONSES = [
    { label: 'Calm down.', kind: 'calm' },
    { label: 'That is enough.', kind: 'warn' },
    { label: 'You are right. My mistake.', kind: 'sorry' },
    { label: 'Walk away.', kind: 'dismiss' }
  ];

  function talkTo(p) {
    if (!p || !p.active) return;
    dialoguePlayer = p;
    var mood = p.anger > 62 ? 'angry' : (p.yellow > 0 ? 'carded' : 'calm');
    if (p.downT > 0) mood = 'down';
    if (p.sentOff) mood = 'sentoff';

    var lines = D.DIALOGUE[mood] || D.DIALOGUE.calm;
    var line = U.pick(lines);

    $('dlg-name').textContent = p.name + '  ·  #' + p.number;
    $('dlg-team').textContent = REF.Game.match.teamName(p.team);
    $('dlg-team').style.color = REF.Game.match.teams[p.team].info.shirt;
    var moodTag = $('dlg-mood');
    moodTag.textContent = mood.toUpperCase();
    moodTag.className = 'mood ' + mood;

    var txt = $('dlg-text');
    txt.textContent = '';
    typewrite(txt, line);

    var box = $('dlg-actions');
    box.innerHTML = '';
    RESPONSES.forEach(function (r) {
      var b = h('button', 'dbtn', r.label);
      b.type = 'button';
      b.addEventListener('click', function () {
        REF.Audio.click();
        resolveTalk(p, r.kind);
      });
      box.appendChild(b);
    });

    $('dialogue').classList.add('on');
    REF.Game.paused = true;
    if (REF.Pointer) { REF.Pointer.unlock(); REF.Pointer.refresh(); }

    var key = p.team + ':' + p.idx;
    if (!REF.Save.data.talkedTo[key]) {
      REF.Save.data.talkedTo[key] = 1;
      REF.Save.save();
      var n = 0;
      for (var k in REF.Save.data.talkedTo) n++;
      if (n >= 5) REF.Save.ach('talk5');
    }
    REF.Save.stat('talks');
  }

  var typeTimer = null;
  function typewrite(node, text) {
    if (typeTimer) clearInterval(typeTimer);
    var i = 0;
    node.textContent = '';
    typeTimer = setInterval(function () {
      i += 2;
      node.textContent = text.slice(0, i);
      if (i >= text.length) { clearInterval(typeTimer); typeTimer = null; }
    }, 16);
  }

  function resolveTalk(p, kind) {
    var before = p.anger;
    var reply = '';
    if (kind === 'calm') {
      p.anger = Math.max(0, p.anger - 38);
      reply = U.pick(['Fair enough, ref.', 'Alright. Alright. We play.', 'Respect. I will keep my head.']);
      REF.Audio.chime();
    } else if (kind === 'warn') {
      p.anger = Math.min(100, p.anger + 14);
      reply = U.pick(['Do not lecture me.', 'You are not my coach.', 'Whatever you say.']);
    } else if (kind === 'sorry') {
      p.anger = Math.max(0, p.anger - 22);
      reply = U.pick(['At least you admit it.', 'Fine. We move.', 'Appreciated, ref.']);
    } else {
      p.anger = Math.max(0, p.anger - 6);
      reply = U.pick(['I am walking. I am walking.', 'Talking to yourself now?', 'Yeah. Yeah.']);
    }
    if (before > 60 && p.anger < 32) REF.Save.ach('calm');

    $('dlg-text').textContent = reply;
    var box = $('dlg-actions');
    box.innerHTML = '';
    var b = h('button', 'dbtn primary', 'Back to the match');
    b.type = 'button';
    b.addEventListener('click', closeDialogue);
    box.appendChild(b);
  }

  function closeDialogue() {
    if (typeTimer) { clearInterval(typeTimer); typeTimer = null; }
    $('dialogue').classList.remove('on');
    REF.Game.paused = false;
    dialoguePlayer = null;
    if (REF.Pointer) { REF.Pointer.lock(); REF.Pointer.refresh(); }
  }

  /* --------------------------------------------------------- continue bar */
  function showContinue() { $('continuebar').classList.add('on'); }
  function hideContinue() { $('continuebar').classList.remove('on'); }

  /* ------------------------------------------------------------ save panel */
  function saveStatus(txt, bad) {
    var n = $('save-status');
    n.textContent = txt || '';
    n.className = 'save-status' + (bad ? ' bad' : '');
  }

  function openSave() {
    REF.Audio.click();
    $('save-code').value = REF.Save.code();
    $('save-import').value = '';
    saveStatus(REF.Save.isEmpty()
      ? 'Nothing saved yet — play a match first.'
      : 'This code (or the file) is your career. Keep it outside the browser.');
    $('savebox').classList.add('on');
    if (REF.Pointer) REF.Pointer.unlock();
  }

  function closeSave() {
    $('savebox').classList.remove('on');
    if (REF.Pointer) REF.Pointer.refresh();
  }

  function downloadSave() {
    var blob = new Blob([JSON.stringify(REF.Save.data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'whistle-save.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 800);
    saveStatus('File downloaded — whistle-save.json');
  }

  function applySave(text) {
    var r = REF.Save.fromCode(text);
    if (!r.ok) { saveStatus(r.err, true); return false; }
    buildMenu();
    buildSkins();
    buildAch();
    if (REF.Game && REF.Game.applySkin) REF.Game.applySkin();
    $('save-code').value = REF.Save.code();
    $('save-import').value = '';
    saveStatus('Restored — ' + REF.Save.data.points + ' PTS and ' +
      REF.Save.data.history.length + ' matches are back.');
    toast('SAVE RESTORED', 'Your career is back', 0);
    return true;
  }

  /* -------------------------------------------------------------- card fx */
  function cardFX(type) {
    var box = $('cardfx');
    box.innerHTML = '';
    var card = h('div', 'bigcard ' + type);
    card.appendChild(h('span', null, type === 'yellow' ? 'YELLOW' : 'RED'));
    box.appendChild(card);
    box.classList.add('on');
    setTimeout(function () { box.classList.remove('on'); }, 1600);
  }

  /* ---------------------------------------------------------------- intro */
  function intro(match) {
    var m = match.data;
    $('intro-comp').textContent = m.comp + ' · ' + m.stage + ' · ' + m.year;
    $('intro-home').textContent = D.TEAMS[m.home].name;
    $('intro-away').textContent = D.TEAMS[m.away].name;
    $('intro-hc').style.background = D.TEAMS[m.home].shirt;
    $('intro-ac').style.background = D.TEAMS[m.away].shirt;
    $('intro-venue').textContent = m.venue;
    $('intro-reslabel').textContent = m.tournament ? 'Knockout tie' : 'Historic result';
    $('intro-score').textContent = m.tournament ? '—' : m.score;
    $('intro').classList.add('on');
    setTimeout(function () { $('intro').classList.remove('on'); }, 3000);
  }

  /* ------------------------------------------------------------------ HUD */
  function setPrompt(txt) {
    if (promptText === txt) return;
    promptText = txt;
    var node = $('prompt');
    node.textContent = txt || '';
    node.classList.toggle('on', !!txt);
  }

  var flashTimer = null;
  function flash(txt, ms) {
    setPrompt(txt);
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(function () {
      promptText = '';
      $('prompt').classList.remove('on');
      updatePromptNow();
    }, ms || 1900);
  }

  function updatePromptNow() {
    var m = REF.Game.match;
    if (!m) { setPrompt(''); return; }
    if (tool === 'yellow' || tool === 'red' || tool === 'talk') return;
    if (m.frozen) {
      if (tool === 'paint') { setPrompt('Click the pitch to spray the mark and the wall'); return; }
      if (m.wall) { setPrompt('Wall set — press ENTER to continue'); return; }
      if (m.pendingFoul || m.lastFoul) {
        setPrompt('FREE KICK — press 5 to paint the mark and wall  ·  ENTER to continue');
        return;
      }
      setPrompt('PLAY STOPPED — press ENTER to continue');
      return;
    }
    if (m.pendingFoul && m.pendingFoul.t > 0) { setPrompt('FOUL — blow the whistle  [LMB]'); return; }
    if (m.pendingOffside && m.pendingOffside.t > 0) { setPrompt('FLAG IS UP — blow the whistle  [LMB]'); return; }
    if (REF.Game.nearPlayer()) { setPrompt('Press T to talk to ' + REF.Game.nearPlayer().name); return; }
    setPrompt('');
  }

  function updateHUD(match, ref) {
    if (!match) return;
    var s = match.score[0] + ' – ' + match.score[1];
    if (s !== lastScoreStr) {
      lastScoreStr = s;
      $('sb-score').textContent = s;
      var sc = $('sb-score');
      sc.classList.remove('pop');
      void sc.offsetWidth;
      sc.classList.add('pop');
    }
    $('sb-clock').textContent = U.fmtClock(match.min) + (match.half === 2 ? '  2H' : '');
    var frozen = !!(match.frozen || match.freezeT > 0);
    $('sb-clock').classList.toggle('frozen', frozen);
    var ps = $('playstop');
    if (ps) ps.classList.toggle('on', frozen);
    var cb = $('continuebar');
    if (cb) cb.classList.toggle('on', frozen);
    $('sb-comp').textContent = match.data.comp + ' · ' + match.data.stage + ' · ' + match.data.year;

    $('sb-n0').textContent = match.teams[0].info.abbr;
    $('sb-n1').textContent = match.teams[1].info.abbr;
    $('sb-c0').style.background = match.teams[0].info.shirt;
    $('sb-c1').style.background = match.teams[1].info.shirt;

    var st = ref ? ref.stamina : 100;
    $('stamina-bar').style.width = Math.max(0, st) + '%';
    $('stamina-bar').classList.toggle('low', st < 30);

    drawMinimap(match, ref);
    updatePromptNow();
  }

  function drawMinimap(match, ref) {
    if (!minimapCtx) return;
    var c = minimapCtx;
    var w = 180, hgt = 120;
    c.clearRect(0, 0, w, hgt);
    var pad = 8;
    var sx = (w - pad * 2) / 105;
    var sz = (hgt - pad * 2) / 68;

    c.fillStyle = 'rgba(16,42,24,0.85)';
    c.fillRect(pad, pad, 105 * sx, 68 * sz);
    c.strokeStyle = 'rgba(255,255,255,0.35)';
    c.lineWidth = 1;
    c.strokeRect(pad, pad, 105 * sx, 68 * sz);
    c.beginPath();
    c.moveTo(pad + 52.5 * sx, pad);
    c.lineTo(pad + 52.5 * sx, pad + 68 * sz);
    c.stroke();
    c.beginPath();
    c.arc(pad + 52.5 * sx, pad + 34 * sz, 9.15 * sx, 0, Math.PI * 2);
    c.stroke();

    function px(x) { return pad + (x + 52.5) * sx; }
    function pz(z) { return pad + (z + 34) * sz; }

    for (var i = 0; i < match.players.length; i++) {
      var p = match.players[i];
      if (!p.active) continue;
      c.fillStyle = match.teams[p.team].info.shirt;
      c.beginPath();
      c.arc(px(p.pos.x), pz(p.pos.z), p.role === 'GK' ? 3.2 : 2.6, 0, Math.PI * 2);
      c.fill();
      if (p.yellow > 0) {
        c.fillStyle = '#ffd23f';
        c.fillRect(px(p.pos.x) - 1, pz(p.pos.z) - 5.5, 2, 3);
      }
    }

    var b = match.ball.pos;
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.arc(px(b.x), pz(b.z), 2.2, 0, Math.PI * 2);
    c.fill();

    if (ref) {
      c.fillStyle = '#ffd75e';
      c.beginPath();
      c.arc(px(ref.pos.x), pz(ref.pos.z), 3.4, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = 'rgba(255,215,94,0.8)';
      c.lineWidth = 1;
      c.beginPath();
      c.arc(px(ref.pos.x), pz(ref.pos.z), 5.5, 0, Math.PI * 2);
      c.stroke();
    }
  }

  /* ---------------------------------------------------------------- result */
  function showResult(match, pts) {
    $('res-score').textContent = match.score[0] + ' – ' + match.score[1];
    $('res-home').textContent = match.teams[0].info.name;
    $('res-away').textContent = match.teams[1].info.name;
    $('res-pts').textContent = '+' + pts + ' PTS';
    $('res-kicker').textContent = match.data.tournament
      ? match.data.stage.toUpperCase() + ' · FULL TIME'
      : 'FULL TIME';

    var note = $('res-note');
    if (match.data.tournament && match.tourOutcome) {
      var o = match.tourOutcome;
      note.textContent = o.done
        ? D.TEAMS[o.champion].name + ' lift the trophy'
        : D.TEAMS[o.advanced].name + ' go through';
      note.classList.add('on');
    } else {
      note.textContent = '';
      note.classList.remove('on');
    }

    var again = $('btn-result-again');
    if (match.data.tournament) {
      var t = REF.Tour.state();
      if (t && !t.done) {
        again.innerHTML = '<b>Next round</b><em>' + REF.Tour.stageName(t.round) + ' awaits</em>';
      } else {
        again.innerHTML = '<b>See the bracket</b><em>The trophy is decided</em>';
      }
    } else {
      again.innerHTML = '<b>Referee it again</b><em>Same fixture</em>';
    }

    $('res-stats').innerHTML = '';
    var rows = [
      ['Fouls called', match.stats.fouls],
      ['Offsides', match.stats.offsides],
      ['Yellow cards', match.stats.yellows],
      ['Red cards', match.stats.reds],
      ['Whistles', match.stats.whistles],
      ['Goals', match.stats.goals]
    ];
    rows.forEach(function (r) {
      var row = h('div', 'rrow');
      row.appendChild(h('span', null, r[0]));
      row.appendChild(h('b', null, String(r[1])));
      $('res-stats').appendChild(row);
    });
    show('result');
  }

  /* ----------------------------------------------------------------- init */
  function init() {
    el.ticker = $('ticker');
    minimapCtx = $('minimap').getContext('2d');

    buildMenu();
    buildMatchList();
    buildSkins();
    buildAch();
    buildToolbox();

    var menuBtns = document.querySelectorAll('#scr-menu [data-act]');
    for (var i = 0; i < menuBtns.length; i++) {
      menuBtns[i].addEventListener('click', function () {
        REF.Audio.resume();
        REF.Audio.click();
        var act = this.dataset.act;
        if (act === 'play') show('matches');
        else if (act === 'tutorial') REF.Game.startTutorial();
        else if (act === 'skins') { buildSkins(); show('skins'); }
        else if (act === 'ach') { buildAch(); show('ach'); }
      });
    }

    var backs = document.querySelectorAll('[data-back]');
    for (var b = 0; b < backs.length; b++) {
      backs[b].addEventListener('click', function () {
        REF.Audio.click();
        if (REF.Game.match && !REF.Game.match.ended) {
          REF.Game.paused = false;
          show(null);
        } else {
          show('menu');
          buildMenu();
        }
      });
    }

    $('btn-resume').addEventListener('click', function () { REF.Audio.click(); REF.Game.resume(); });
    $('btn-restart').addEventListener('click', function () { REF.Audio.click(); REF.Game.restart(); });
    $('btn-quit').addEventListener('click', function () { REF.Audio.click(); REF.Game.quit(); });
    $('btn-result-menu').addEventListener('click', function () { REF.Audio.click(); REF.Game.quit(); });
    $('btn-result-again').addEventListener('click', function () {
      REF.Audio.click();
      if (REF.Game.tourResult && REF.Tour) REF.Tour.continueFromResult();
      else REF.Game.restart();
    });
    $('btn-close-book').addEventListener('click', function () { REF.Audio.click(); $('book').classList.remove('on'); selectTool(null); });
    $('dlg-close').addEventListener('click', closeDialogue);
    $('toolbox-toggle').addEventListener('click', function (ev) {
      ev.stopPropagation();
      REF.Audio.click();
      openToolbox(!$('toolbox').classList.contains('on'));
    });

    var histBtn = $('btn-hist');
    if (histBtn) {
      histBtn.addEventListener('click', function () {
        REF.Audio.resume();
        REF.Audio.click();
        buildMatchList();
        show('matches');
      });
    }

    var tourBtn = $('btn-tour');
    if (tourBtn) {
      tourBtn.addEventListener('click', function () {
        REF.Audio.resume();
        REF.Audio.click();
        buildTour();
        show('tour');
      });
    }

    $('btn-continue').addEventListener('click', function () {
      REF.Audio.click();
      REF.Game.continuePlay();
    });

    var saveOpeners = [$('btn-save'), $('btn-save-pause')];
    for (var sb = 0; sb < saveOpeners.length; sb++) {
      if (saveOpeners[sb]) saveOpeners[sb].addEventListener('click', openSave);
    }
    $('btn-close-save').addEventListener('click', closeSave);
    $('btn-save-file').addEventListener('click', downloadSave);
    $('btn-save-copy').addEventListener('click', function () {
      var ta = $('save-code');
      ta.focus();
      ta.select();
      var done = false;
      try { done = document.execCommand('copy'); } catch (e) { done = false; }
      if (!done && navigator.clipboard) {
        navigator.clipboard.writeText(ta.value).then(function () {
          saveStatus('Code copied — keep it somewhere safe.');
        }, function () {
          saveStatus('Select the code and press Ctrl+C.', true);
        });
        return;
      }
      saveStatus(done ? 'Code copied — keep it somewhere safe.' : 'Select the code and press Ctrl+C.', !done);
    });
    $('btn-save-import').addEventListener('click', function () {
      REF.Audio.click();
      applySave($('save-import').value);
    });
    $('save-file-input').addEventListener('change', function () {
      var f = this.files && this.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () { applySave(String(reader.result || '')); };
      reader.readAsText(f);
    });
    $('savebox').addEventListener('click', function (e) {
      if (e.target === this) closeSave();
    });

    $('btn-reset').addEventListener('click', function () {
      if (confirm('Erase all progress — points, skins and achievements?')) {
        REF.Save.reset();
        buildMenu(); buildSkins(); buildAch();
        toast('SAVE WIPED', 'Fresh start', 0);
      }
    });

    show('menu');
  }

  return {
    init: init,
    show: show,
    toast: toast,
    feed: feed,
    intro: intro,
    talkTo: talkTo,
    closeDialogue: closeDialogue,
    cardFX: cardFX,
    openToolbox: openToolbox,
    selectTool: selectTool,
    openBook: openBook,
    updateHUD: updateHUD,
    showResult: showResult,
    buildMenu: buildMenu,
    buildSkins: buildSkins,
    buildAch: buildAch,
    buildMatchList: buildMatchList,
    buildTour: buildTour,
    setPrompt: setPrompt,
    flash: flash,
    showContinue: showContinue,
    hideContinue: hideContinue,
    openSave: openSave,
    currentScreen: function () { return currentScreen; },
    tool: function () { return tool; },
    closeBook: function () {
      $('book').classList.remove('on');
      if (REF.Pointer) REF.Pointer.lock();
    },
    isDialogueOpen: function () { return $('dialogue').classList.contains('on'); },
    hideIntro: function () { $('intro').classList.remove('on'); }
  };
})();
