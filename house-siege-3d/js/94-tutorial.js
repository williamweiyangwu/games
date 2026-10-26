/* ============================================================
   94-tutorial.js
   Tutorial objectives
   ============================================================ */
'use strict';

/* ------------------------------------------------------------
   TUTORIAL
   ------------------------------------------------------------ */
const TUT_TASKS = [
  { id: 'move', text: 'Move with <b>W A S D</b> — cover 12 m' },
  { id: 'jump', text: 'Jump with <b>SPACE</b>' },
  { id: 'shoot', text: 'Aim with the mouse and <b>ELIMINATE</b> a practice dummy' },
  { id: 'chest', text: 'Walk to a crate and <b>RIGHT-CLICK</b> to take what is inside' },
  { id: 'more', text: 'Eliminate 2 more dummies with your new gun' }
];

function startTutorial() {
  G.tutorial.active = true;
  G.tutorial.moved = 0;
  G.tutorial.jumps = 0;
  G.tutorial.kills = 0;
  G.tutorial.chests = 0;
  G.tutorial.tasks = TUT_TASKS.map(t => ({ id: t.id, text: t.text, done: false }));
  $('tutTasks').classList.add('show');
  renderTutorialTasks();
}

function renderTutorialTasks() {
  const cur = G.tutorial.tasks.find(t => !t.done);
  $('ttList').innerHTML = G.tutorial.tasks.map(t =>
    '<div class="tk ' + (t.done ? 'done' : (t === cur ? 'cur' : '')) + '"><span class="bx">' + (t.done ? '✓' : '') + '</span><span>' + t.text + '</span></div>'
  ).join('');
}

function completeTask(id) {
  const t = G.tutorial.tasks.find(x => x.id === id);
  if (!t || t.done) return;
  t.done = true;
  Snd.pickup();
  renderTutorialTasks();
  if (G.tutorial.tasks.every(x => x.done)) {
    setTimeout(() => {
      banner('<span class="hl">TRAINING COMPLETE</span> — you are ready. Press ESC to return to the menu.', 6);
    }, 400);
  }
}

function updateTutorialTasks() {
  const T = G.tutorial;
  if (!T.tasks) return;
  if (T.moved > 12) completeTask('move');
  if (T.jumps > 0) completeTask('jump');
  if (T.kills >= 1) completeTask('shoot');
  if (T.chests >= 1) completeTask('chest');
  if (T.kills >= 3) completeTask('more');
}

