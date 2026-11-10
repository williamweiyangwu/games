/* WHISTLE — tournament: random draws, knockout bracket, saved between sessions */
window.REF = window.REF || {};

REF.Tour = (function () {
  var U = REF.U;
  var D = REF.DATA;

  function cfg(id) {
    for (var i = 0; i < D.TOURNAMENTS.length; i++) {
      if (D.TOURNAMENTS[i].id === id) return D.TOURNAMENTS[i];
    }
    return D.TOURNAMENTS[0];
  }

  function state() { return REF.Save.data.tournament; }

  function active() {
    var t = state();
    return !!t && !t.done;
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i];
      a[i] = a[j];
      a[j] = tmp;
    }
    return a;
  }

  /* the round names that fit a competition of this size: 8 teams start at the
     quarter-finals, 16 teams get a round of 16 first */
  function roundNames(size) {
    var n = Math.round(Math.log(size || 8) / Math.LN2);
    var all = D.ROUND_NAMES;
    return all.slice(Math.max(0, all.length - n));
  }

  function stageName(round) {
    var t = state();
    var names = (t && t.names) || roundNames(8);
    return names[round] || 'Final';
  }

  /* build the ties for the current round from the surviving teams */
  function makeRound(t) {
    var ties = [];
    for (var i = 0; i + 1 < t.alive.length; i += 2) {
      ties.push({
        h: t.alive[i],
        a: t.alive[i + 1],
        hs: null, as: null, note: '', winner: null,
        done: false,
        player: ties.length === 0
      });
    }
    t.rounds[t.round] = ties;
    t.focus = 0;
    t.venue = U.pick(cfg(t.id).venues);
    REF.Save.save();
    return ties;
  }

  function start(id) {
    var c = cfg(id);
    var size = c.size || 8;
    var t = {
      id: c.id,
      comp: c.comp,
      year: new Date().getFullYear(),
      size: size,
      names: roundNames(size),
      round: 0,
      alive: shuffle(c.pool).slice(0, size),
      rounds: [],
      focus: 0,
      champ: null,
      done: false,
      venue: U.pick(c.venues)
    };
    REF.Save.data.tournament = t;
    makeRound(t);
    REF.Save.save();
    return t;
  }

  function fixture() {
    var t = state();
    if (!t || t.done) return null;
    var ties = t.rounds[t.round];
    if (!ties) return null;
    return ties[t.focus];
  }

  function matchData() {
    var t = state();
    var tie = fixture();
    if (!t || !tie) return null;
    return {
      id: 'tour-' + t.id + '-' + t.round,
      comp: t.comp,
      year: t.year,
      stage: stageName(t.round),
      home: tie.h,
      away: tie.a,
      score: '—',
      venue: t.venue,
      note: t.comp + ' · ' + stageName(t.round),
      tournament: true
    };
  }

  function play() {
    var d = matchData();
    if (!d) return false;
    REF.Game.launch(d, {});
    return true;
  }

  function shootout() {
    var a = U.randInt(3, 5);
    var b = U.randInt(2, 4);
    if (b >= a) b = a - 1;
    if (b < 0) b = 0;
    return [a, b];
  }

  function settle(tie, hs, as) {
    tie.hs = hs;
    tie.as = as;
    tie.done = true;
    if (hs === as) {
      var p = shootout();
      tie.note = '(' + p[0] + '–' + p[1] + ' pens)';
      tie.winner = p[0] > p[1] ? tie.h : tie.a;
    } else {
      tie.winner = hs > as ? tie.h : tie.a;
    }
  }

  /* called when the player's match finishes */
  function record(match) {
    var t = state();
    if (!t) return null;
    var ties = t.rounds[t.round];
    if (!ties) return null;
    var tie = ties[t.focus];
    if (!tie) return null;

    settle(tie, match.score[0], match.score[1]);
    var mine = tie.winner;

    /* the rest of the round plays itself out */
    for (var i = 0; i < ties.length; i++) {
      if (!ties[i].done) settle(ties[i], U.randInt(0, 3), U.randInt(0, 3));
    }

    var next = [];
    for (var j = 0; j < ties.length; j++) next.push(ties[j].winner);
    t.alive = next;
    t.round++;

    if (next.length === 1) {
      t.champ = next[0];
      t.done = true;
      REF.Save.data.tourCups = (REF.Save.data.tourCups || 0) + 1;
    } else {
      makeRound(t);
    }
    REF.Save.save();
    return { champion: t.champ, done: t.done, advanced: mine };
  }

  function reset() {
    REF.Save.data.tournament = null;
    REF.Save.save();
  }

  /* the button on the full-time screen */
  function continueFromResult() {
    REF.Game.tourResult = false;
    var t = state();
    if (t && !t.done && play()) return;
    REF.Game.quit();
    REF.UI.show('tour');
    REF.UI.buildTour();
  }

  return {
    cfg: cfg,
    state: state,
    active: active,
    start: start,
    fixture: fixture,
    matchData: matchData,
    play: play,
    record: record,
    reset: reset,
    stageName: stageName,
    roundNames: roundNames,
    continueFromResult: continueFromResult
  };
})();
