/* =========================================================
   BOX BOX: a daily to-do app styled like an F1 pit wall.
   Vanilla JS, no build step, no backend.
   Everything is saved in localStorage, so a refresh keeps
   your tasks, lap times and even a running timer.

   Vocabulary: a task is a "lap", split into 1 to 6 steps
   called "sectors". NEXT SECTOR cascades from one to the next.
   ========================================================= */

'use strict';


/* ---------- 1. Constants ---------- */

const STORAGE_KEY = 'boxbox.v1';
const FINISH_HOLD_MS = 2400;   // how long a finished lap stays on screen before the pit lane returns
const MAX_STEPS = 6;           // sectors per task
const HURRY_AT = 0.8;          // share of an estimate (each sector, and the whole task) that triggers the "hurry" radio

// The 2026 grid. `color` and `stripe` come from the reference palettes.
// `ui` is only set when the brand colour is too dark to read on the dark
// pit-wall background; it then replaces `color` as the app's accent.
const TEAMS = [
  { id: 'alpine',       name: 'Alpine',       color: '#0090FF', stripe: '#FF63B8' },
  { id: 'aston-martin', name: 'Aston Martin', color: '#00665E', stripe: '#CEDC00', ui: '#007D73' },
  { id: 'audi',         name: 'Audi',         color: '#F50537', stripe: '#8A8D8F' },
  { id: 'cadillac',     name: 'Cadillac',     color: '#000000', stripe: '#C9A227', ui: '#C0C0C0' },
  { id: 'ferrari',      name: 'Ferrari',      color: '#EF1A2D', stripe: '#FFF200' },
  { id: 'haas',         name: 'Haas',         color: '#E6002B', stripe: '#FFFFFF' },
  { id: 'mclaren',      name: 'McLaren',      color: '#FF8000', stripe: '#000000' },
  { id: 'mercedes',     name: 'Mercedes',     color: '#00A19B', stripe: '#C8CCCE' },
  { id: 'racing-bulls', name: 'Racing Bulls', color: '#1634CB', stripe: '#E8002D', ui: '#3D5CFF' },
  { id: 'red-bull',     name: 'Red Bull',     color: '#3671C6', stripe: '#E30118' },
  { id: 'williams',     name: 'Williams',     color: '#1A6598', stripe: '#E6EDEE', ui: '#499BCC' },
];

// Result line once a lap is finished, from the task's overall colour
const LAP_LABEL = { purple: 'Purple lap', green: 'Green lap', yellow: 'Yellow lap' };


/* ---------- 2. State + storage ---------- */

/*
  state = {
    profile: { nickname: 'RAYA', team: 'mclaren' } | null,
    settings: { muted: false, keepAwake: true },
    lastClip: { victory: 'victory-vettel-2010.mp3', ... },   // so a clip never plays twice in a row
    tasks: [{
      id, name,
      status: 'pending' | 'running' | 'done',
      steps: [{ name, estimateMin, elapsedMs, finishedAt, hurryCue }],   // 1 to 6 sectors
      currentStep,     // index of the sector on track
      startedAt,       // when the lap started (so the timer survives a refresh)
      stepStartedAt,   // when the current sector started
      elapsedMs,       // total lap time once done
      finishedAt,
      hurryCue, overtimeCue,   // true once that radio clip has played for this run
    }]
  }
*/
let state = loadState();

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.tasks)) {
      saved.tasks.forEach(upgradeTask);
      saved.settings ??= { muted: false };
      saved.settings.keepAwake ??= true;
      saved.lastClip ??= {};
      return saved;
    }
  } catch (err) {
    // Corrupted or blocked storage: start fresh
  }
  return { profile: null, settings: { muted: false, keepAwake: true }, lastClip: {}, tasks: [] };
}

// Tasks saved before sectors existed become single-sector tasks
function upgradeTask(task) {
  if (Array.isArray(task.steps)) return;
  const done = task.status === 'done';
  task.steps = [{
    name: task.name,
    estimateMin: task.estimateMin,
    elapsedMs: done ? task.elapsedMs : 0,
    finishedAt: done ? task.finishedAt : null,
  }];
  task.currentStep = 0;
  task.stepStartedAt = task.startedAt;
  delete task.estimateMin;
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    // Private mode or storage full: keep working in memory
  }
}


/* ---------- 3. Helpers ---------- */

const $ = (id) => document.getElementById(id);
const pad = (n, len = 2) => String(n).padStart(len, '0');
const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
const motionOK = () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// 754123 -> "12:34.123"
function formatLap(ms) {
  ms = Math.max(0, Math.floor(ms));
  return `${pad(Math.floor(ms / 60000))}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
}

// Signed lap time for a delta: "−03:12.400" / "+00:45.120"
function formatDelta(ms) {
  return (ms < 0 ? '−' : '+') + formatLap(Math.abs(ms));
}

// Longer totals for the stats: "24:13" or "1:04:05"
function formatDuration(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor(total / 60) % 60;
  const s = total % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// Black or white text, whichever reads better on a hex colour
function inkFor(hex) {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.25 ? '#000000' : '#ffffff';
}

const teamById = (id) => TEAMS.find((t) => t.id === id);
const runningTask = () => state.tasks.find((t) => t.status === 'running');

// Estimates: a sector has its own, a task's is the sum of its sectors
const stepMs = (step) => step.estimateMin * 60000;
const estimateMin = (task) => task.steps.reduce((sum, step) => sum + step.estimateMin, 0);
const estimateMs = (task) => estimateMin(task) * 60000;

// Actual time divided by estimated time. Lower is better.
const ratioOf = (task) => task.elapsedMs / estimateMs(task);
const stepRatio = (step) => step.elapsedMs / stepMs(step);

// Ratio as a whole percentage for display (never shows a misleading "0%")
const percentOf = (task) => Math.max(1, Math.round(ratioOf(task) * 100));


/* ---------- 4. Timing rules ---------- */

// Gives every finished item (a task or a sector) a colour:
//   purple = best ratio of the day (only one, ties go to whoever set it first)
//   green  = finished within its estimate
//   yellow = finished over its estimate
// Returns a Map from the item itself to its colour.
function colourByRatio(items, ratio) {
  const sorted = [...items].sort((a, b) => a.finishedAt - b.finishedAt);

  let best = null;
  for (const item of sorted) {
    if (!best || ratio(item) < ratio(best)) best = item;
  }

  const colours = new Map();
  for (const item of sorted) {
    colours.set(item, item === best ? 'purple' : ratio(item) <= 1 ? 'green' : 'yellow');
  }
  return colours;
}

// Overall colour of each finished task: total time vs total estimate
const taskColours = (tasks) => colourByRatio(tasks.filter((t) => t.status === 'done'), ratioOf);

// Colour of each finished sector vs its own estimate,
// including the sectors already completed by the task on track
const stepColours = (tasks) => colourByRatio(tasks.flatMap(finishedSteps), stepRatio);

function finishedSteps(task) {
  if (task.status === 'done') return task.steps;
  if (task.status === 'running') return task.steps.slice(0, task.currentStep);
  return [];
}

// 'done', 'current' or 'pending' for sector i of a task
function sectorState(task, i) {
  if (task.status === 'done' || (task.status === 'running' && i < task.currentStep)) return 'done';
  if (task.status === 'running' && i === task.currentStep) return 'current';
  return 'pending';
}

// Tower order, like a quali classification:
// finished tasks ranked by ratio, then the car on track, then tasks with no time yet
function towerOrder(tasks) {
  const done = tasks
    .filter((t) => t.status === 'done')
    .sort((a, b) => ratioOf(a) - ratioOf(b) || a.finishedAt - b.finishedAt);
  const running = tasks.filter((t) => t.status === 'running');
  const pending = tasks.filter((t) => t.status === 'pending'); // keeps the order they were added
  return [...done, ...running, ...pending];
}

function sessionFor(date) {
  const hour = date.getHours();
  if (hour < 12) return { tag: 'Q1', name: 'Morning session' };
  if (hour < 18) return { tag: 'Q2', name: 'Afternoon session' };
  return { tag: 'Q3', name: 'Evening session' };
}


/* ---------- 5. DOM references ---------- */

const el = {
  clock: $('clock'),
  sessionTag: $('sessionTag'),
  sessionName: $('sessionName'),
  driverName: $('driverName'),
  driverTeam: $('driverTeam'),
  settingsBtn: $('settingsBtn'),
  resetBtn: $('resetBtn'),

  towerList: $('towerList'),
  towerEmpty: $('towerEmpty'),
  doneCount: $('doneCount'),
  totalCount: $('totalCount'),
  addForm: $('addForm'),
  taskName: $('taskName'),
  stepList: $('stepList'),
  addStepBtn: $('addStepBtn'),
  addTotal: $('addTotal'),

  timerCard: $('timerCard'),
  tcPos: $('tcPos'),
  tcName: $('tcName'),
  tcStatusText: $('tcStatusText'),
  tcTime: $('tcTime'),
  tcStepTag: $('tcStepTag'),
  tcStepName: $('tcStepName'),
  tcStepTime: $('tcStepTime'),
  tcStepDelta: $('tcStepDelta'),
  tcStepDeltaValue: $('tcStepDeltaValue'),
  tcEst: $('tcEst'),
  tcDelta: $('tcDelta'),
  tcDeltaValue: $('tcDeltaValue'),
  tcSectors: $('tcSectors'),
  tcResult: $('tcResult'),
  nextBtn: $('nextBtn'),
  nextLabel: $('nextLabel'),
  abortBtn: $('abortBtn'),

  idleCard: $('idleCard'),
  lights: $('lights'),
  idleTitle: $('idleTitle'),
  idleSub: $('idleSub'),
  nextUp: $('nextUp'),
  nextName: $('nextName'),
  nextEst: $('nextEst'),
  nextStart: $('nextStart'),

  statDone: $('statDone'),
  statTime: $('statTime'),
  statBest: $('statBest'),
  statBestName: $('statBestName'),
  statPurple: $('statPurple'),
  statGreen: $('statGreen'),
  statYellow: $('statYellow'),

  setupDialog: $('setupDialog'),
  setupForm: $('setupForm'),
  setupTitle: $('setupTitle'),
  setupClose: $('setupClose'),
  setupSave: $('setupSave'),
  nickInput: $('nickInput'),
  nickCount: $('nickCount'),
  teamGrid: $('teamGrid'),
  npName: $('npName'),
  npTeam: $('npTeam'),

  resetDialog: $('resetDialog'),
  muteToggle: $('muteToggle'),
  awakeToggle: $('awakeToggle'),

  yellowFlag: $('yellowFlag'),
  yfTask: $('yfTask'),
  yfOver: $('yfOver'),
  radio: $('radio'),
  radioWho: $('radioWho'),
  radioWave: $('radioWave'),
  radioMsg: $('radioMsg'),
};


/* ---------- 6. Actions ---------- */

let finishHold = null; // { id, timeout } while a just-finished lap is still on screen

// steps: [{ name, estimateMin }]
function addTask(name, steps) {
  const task = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    name,
    status: 'pending',
    steps: steps.map((step) => ({ ...step, elapsedMs: 0, finishedAt: null, hurryCue: false })),
    currentStep: 0,
    startedAt: null,
    stepStartedAt: null,
    elapsedMs: 0,
    finishedAt: null,
  };
  state.tasks.push(task);
  saveState();
  render();
  rowEls.get(task.id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// START: the lap begins with the first sector
function startTask(id) {
  if (runningTask()) return; // one car on track at a time
  const task = state.tasks.find((t) => t.id === id);
  if (!task || task.status !== 'pending') return;

  clearFinishHold();
  const now = Date.now();
  task.status = 'running';
  task.startedAt = now;
  task.currentStep = 0;
  task.stepStartedAt = now;
  task.hurryCue = false;
  task.overtimeCue = false;
  task.steps.forEach((step) => { step.hurryCue = false; });
  saveState();
  render();
}

// NEXT SECTOR: closes the current sector and starts the next one.
// On the last sector the same button is FINISH and ends the lap.
function nextSector() {
  const task = runningTask();
  if (!task) return;

  const now = Date.now();
  const step = task.steps[task.currentStep];
  step.elapsedMs = now - task.stepStartedAt;
  step.finishedAt = now;

  if (task.currentStep === task.steps.length - 1) {
    finishLap(task, now);
    return;
  }

  task.currentStep++;
  task.stepStartedAt = now;
  saveState();
  render();
  flashSector(task.currentStep - 1);
}

function finishLap(task, now) {
  task.elapsedMs = now - task.startedAt;
  task.status = 'done';
  task.finishedAt = now;
  saveState();

  // Keep the finished lap on screen for a moment so its colours can flash
  clearFinishHold();
  finishHold = {
    id: task.id,
    timeout: setTimeout(() => { finishHold = null; renderStage(); }, FINISH_HOLD_MS),
  };

  render();
  flashRow(task.id);

  // Every task of the day is classified: victory radio, no message
  if (state.tasks.every((t) => t.status === 'done')) playRadio('victory', { withMessage: false });
}

// Sends the running task back to the garage, all sector times cleared
function abortTask() {
  const task = runningTask();
  if (!task) return;
  task.status = 'pending';
  task.startedAt = null;
  task.stepStartedAt = null;
  task.currentStep = 0;
  task.hurryCue = false;
  task.overtimeCue = false;
  task.steps.forEach((step) => { step.elapsedMs = 0; step.finishedAt = null; step.hurryCue = false; });
  saveState();
  render();
}

function deleteTask(id) {
  if (finishHold?.id === id) clearFinishHold();
  state.tasks = state.tasks.filter((t) => t.id !== id);
  saveState();
  render();
}

function resetDay() {
  clearFinishHold();
  state.tasks = [];
  saveState();
  render();
}

function clearFinishHold() {
  if (finishHold) clearTimeout(finishHold.timeout);
  finishHold = null;
}


/* ---------- 7. Rendering ---------- */

function render() {
  const colours = { tasks: taskColours(state.tasks), steps: stepColours(state.tasks) };
  renderTower(colours);
  renderStage(colours);
  renderStats(colours);
  raceControl();
  updateWakeLock();
}

// --- Timing tower ---

const rowEls = new Map(); // task id -> <li>, reused between renders so rows can slide around
let towerRendered = false;

function createRow() {
  const li = document.createElement('li');
  li.className = 'row';
  li.innerHTML = `
    <span class="row-pos"></span>
    <span class="row-bar" aria-hidden="true"></span>
    <span class="row-main">
      <span class="row-name"></span>
      <span class="row-sectors" aria-hidden="true"></span>
    </span>
    <span class="row-info"></span>
    <span class="row-actions">
      <button class="row-start" type="button" data-action="start">Start</button>
      <button class="row-del" type="button" data-action="delete" aria-label="Delete task">×</button>
    </span>`;
  // Drop the one-off animation classes once they've played
  li.addEventListener('animationend', (e) => {
    if (e.target !== li) return;
    li.classList.remove('enter', 'flash');
    li.style.animationDelay = '';
  });
  return li;
}

function updateRow(li, task, position, colours, someoneOnTrack) {
  li.dataset.id = task.id;
  li.dataset.status = task.status;
  li.dataset.sector = colours.tasks.get(task) || ''; // overall colour: total time vs total estimate
  li.querySelector('.row-pos').textContent = position;

  const name = li.querySelector('.row-name');
  name.textContent = task.name;
  name.title = task.name;

  // Mini-sector bars, one per step
  const bars = li.querySelector('.row-sectors');
  if (bars.childElementCount !== task.steps.length) bars.innerHTML = '<i></i>'.repeat(task.steps.length);
  task.steps.forEach((step, i) => {
    bars.children[i].dataset.state = sectorState(task, i);
    bars.children[i].dataset.sector = colours.steps.get(step) || '';
  });

  const info = li.querySelector('.row-info');
  if (task.status === 'done') {
    info.textContent = formatLap(task.elapsedMs);
    info.title = `Estimate ${estimateMin(task)} min · ${percentOf(task)}%`;
  } else if (task.status === 'pending') {
    info.innerHTML = `${estimateMin(task)}<small>min</small>`;
    info.title = task.steps.length > 1 ? `${task.steps.length} sectors` : 'Estimated time';
  } else {
    info.textContent = formatLap(Date.now() - task.startedAt).slice(0, -4); // live mm:ss, updated by tick()
    info.title = 'On track';
  }

  const start = li.querySelector('.row-start');
  start.disabled = someoneOnTrack;
  start.setAttribute('aria-label', `Start ${task.name}`);
}

function renderTower(colours) {
  const list = el.towerList;
  const order = towerOrder(state.tasks);
  const someoneOnTrack = Boolean(runningTask());
  const animate = towerRendered && motionOK();

  // FLIP, step 1 (First): remember where every row is now
  const before = new Map();
  if (animate) rowEls.forEach((li, id) => before.set(id, li.getBoundingClientRect().top));

  // Remove rows whose task is gone
  rowEls.forEach((li, id) => {
    if (!state.tasks.some((t) => t.id === id)) {
      li.remove();
      rowEls.delete(id);
    }
  });

  // Create or update each row and move it into its new place
  order.forEach((task, i) => {
    let li = rowEls.get(task.id);
    if (!li) {
      li = createRow();
      li.classList.add('enter');
      // On first load the rows cascade in one after another
      li.style.animationDelay = towerRendered ? '0ms' : `${i * 45}ms`;
      rowEls.set(task.id, li);
    }
    updateRow(li, task, i + 1, colours, someoneOnTrack);
    if (list.children[i] !== li) list.insertBefore(li, list.children[i] || null);
  });

  // FLIP, steps 2-4 (Last, Invert, Play): slide each row from its old spot to the new one
  if (animate) {
    rowEls.forEach((li, id) => {
      if (!before.has(id)) return;
      const dy = before.get(id) - li.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) return;
      li.animate(
        [{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }],
        { duration: 550, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
      );
    });
  }

  const doneCount = state.tasks.filter((t) => t.status === 'done').length;
  el.doneCount.textContent = doneCount;
  el.totalCount.textContent = state.tasks.length;
  el.towerEmpty.hidden = state.tasks.length > 0;
  el.resetBtn.disabled = state.tasks.length === 0;
  towerRendered = true;
}

// Re-trigger the colour flash on a tower row
function flashRow(id) {
  const li = rowEls.get(id);
  if (!li) return;
  li.classList.remove('flash');
  void li.offsetWidth; // force a reflow so the animation restarts
  li.classList.add('flash');
}

// --- Stage: lap timer or pit lane ---

function renderStage(colours = { tasks: taskColours(state.tasks), steps: stepColours(state.tasks) }) {
  const running = runningTask();
  const held = !running && finishHold
    ? state.tasks.find((t) => t.id === finishHold.id && t.status === 'done')
    : null;
  const task = running || held;

  el.timerCard.hidden = !task;
  el.idleCard.hidden = Boolean(task);
  if (!task) {
    renderIdle();
    document.title = 'Box Box';
    return;
  }

  const position = towerOrder(state.tasks).indexOf(task) + 1;
  el.tcPos.textContent = position;
  el.tcName.textContent = task.name;
  el.tcName.title = task.name;
  el.tcEst.textContent = formatLap(estimateMs(task));
  el.timerCard.dataset.state = running ? 'running' : 'finished';
  el.timerCard.dataset.steps = task.steps.length;
  el.tcStatusText.textContent = running ? 'On track' : 'Finished';
  renderSectorBars(task, colours.steps);

  if (running) {
    const step = task.steps[task.currentStep];
    const last = task.currentStep === task.steps.length - 1;
    el.tcStepTag.textContent = `S${task.currentStep + 1}/${task.steps.length}`;
    el.tcStepName.textContent = step.name;
    el.tcStepName.title = step.name;
    el.nextLabel.textContent = last ? 'Finish' : 'Next sector';
    el.timerCard.dataset.last = last;
    paintTimer(task, Date.now());
    startTicking();
  } else {
    const colour = colours.tasks.get(task);
    el.timerCard.dataset.sector = colour;
    paintTimer(task);
    el.tcResult.textContent = `${LAP_LABEL[colour]} · P${position} · ${percentOf(task)}% of estimate`;
  }
}

// The mini-sector bars under the lap timer, one per step
function renderSectorBars(task, stepColourMap) {
  const wrap = el.tcSectors;

  // Rebuild only when a different task comes on screen, so the pulse doesn't restart
  if (wrap.dataset.task !== task.id || wrap.childElementCount !== task.steps.length) {
    wrap.dataset.task = task.id;
    wrap.innerHTML = task.steps.map(() => `
      <div class="sector">
        <span class="sector-track"><span class="sector-fill"></span></span>
        <span class="sector-label"><b></b><span class="sector-time"></span></span>
      </div>`).join('');
  }

  task.steps.forEach((step, i) => {
    const bar = wrap.children[i];
    const sectorNow = sectorState(task, i);
    bar.dataset.state = sectorNow;
    bar.dataset.sector = stepColourMap.get(step) || '';
    bar.title = step.name;
    bar.querySelector('b').textContent = `S${i + 1}`;
    // Finished sectors show their time, the others their estimate
    bar.querySelector('.sector-time').textContent = sectorNow === 'done'
      ? formatLap(step.elapsedMs).slice(0, -2)
      : formatLap(stepMs(step)).slice(0, -4);
    if (sectorNow !== 'current') bar.querySelector('.sector-fill').style.transform = ''; // CSS fills done ones
  });
}

// Blinks a sector bar in its new colour right after NEXT SECTOR
function flashSector(i) {
  const bar = el.tcSectors.children[i];
  if (!bar) return;
  bar.classList.remove('just-done');
  void bar.offsetWidth;
  bar.classList.add('just-done');
  bar.addEventListener('animationend', () => bar.classList.remove('just-done'), { once: true });
}

// Draws everything that changes every frame: the lap time, the current
// sector's time, both deltas and the current sector's progress bar.
function paintTimer(task, now) {
  const running = task.status === 'running';
  const total = running ? now - task.startedAt : task.elapsedMs;
  renderDigits(el.tcTime, formatLap(total));
  paintDelta(el.tcDelta, el.tcDeltaValue, total - estimateMs(task));
  if (!running) return;

  const step = task.steps[task.currentStep];
  const stepElapsed = now - task.stepStartedAt;
  el.tcStepTime.textContent = formatLap(stepElapsed);
  paintDelta(el.tcStepDelta, el.tcStepDeltaValue, stepElapsed - stepMs(step));

  const fill = el.tcSectors.children[task.currentStep]?.querySelector('.sector-fill');
  if (fill) fill.style.transform = `scaleX(${clamp(stepElapsed / stepMs(step), 0, 1)})`;
}

// Delta pill: negative (green) while under the estimate, positive (red) once over
function paintDelta(pill, value, delta) {
  value.textContent = formatDelta(delta);
  const over = delta > 0;
  if (pill.classList.contains('is-over') !== over) pill.classList.toggle('is-over', over);
}

// Writes "mm:ss.mmm" into one <span> per character so changed digits can roll in
function renderDigits(container, text) {
  if (container.childElementCount !== text.length) {
    container.textContent = '';
    for (let i = 0; i < text.length; i++) container.appendChild(document.createElement('span'));
  }
  const msStart = text.length - 3; // the last three characters are milliseconds

  for (let i = 0; i < text.length; i++) {
    const span = container.children[i];
    if (span.textContent === text[i]) continue;
    span.textContent = text[i];
    span.className = 'digit' + (/[:.]/.test(text[i]) ? ' sep' : '') + (i >= msStart ? ' ms' : '');
    // Milliseconds change every frame, so only the slower digits get the roll-in
    if (i < msStart - 1 && motionOK()) {
      span.animate(
        [{ transform: 'translateY(-0.14em)', opacity: 0.2 }, { transform: 'translateY(0)', opacity: 1 }],
        { duration: 320, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
      );
    }
  }
}

function renderIdle() {
  const total = state.tasks.length;
  const pending = state.tasks.filter((t) => t.status === 'pending');
  const nick = state.profile?.nickname || 'driver';

  let lights, title, sub;
  if (!total) {
    lights = 'off';
    title = 'Grid is empty';
    sub = `Add your first task in the timing tower, ${nick}.`;
  } else if (pending.length) {
    lights = 'ready';
    title = 'Pit lane open';
    sub = `${pending.length} ${pending.length === 1 ? 'task' : 'tasks'} waiting in the garage. Ready when you are, ${nick}.`;
  } else {
    lights = 'done';
    title = 'Chequered flag';
    sub = `Every task is classified. Great session, ${nick}!`;
  }

  if (el.lights.dataset.state !== lights) el.lights.dataset.state = lights;
  el.idleTitle.textContent = title;
  el.idleSub.textContent = sub;

  const next = pending[0];
  el.nextUp.hidden = !next;
  if (next) {
    el.nextName.textContent = next.name;
    el.nextEst.textContent = `${estimateMin(next)} min` + (next.steps.length > 1 ? ` · ${next.steps.length} sectors` : '');
    el.nextStart.dataset.id = next.id;
  }
}

// --- Stats strip ---

function renderStats(colours) {
  const done = state.tasks.filter((t) => t.status === 'done');

  el.statDone.textContent = `${done.length}/${state.tasks.length}`;
  el.statTime.textContent = formatDuration(done.reduce((sum, t) => sum + t.elapsedMs, 0));

  const best = done.find((t) => colours.tasks.get(t) === 'purple');
  el.statBest.textContent = best ? `${percentOf(best)}%` : '—';
  el.statBestName.textContent = best ? best.name : '';

  // Sector colours count every finished step of the day
  const count = { purple: 0, green: 0, yellow: 0 };
  colours.steps.forEach((colour) => count[colour]++);
  el.statPurple.textContent = count.purple;
  el.statGreen.textContent = count.green;
  el.statYellow.textContent = count.yellow;
}


/* ---------- 8. Live timer loop ---------- */

let frameId = null;

// Runs every animation frame while a task is on track.
// Times always come from Date.now() minus a saved start, so they stay exact
// even if the tab sleeps or the page is reloaded.
function tick() {
  const task = runningTask();
  if (!task) {
    frameId = null;
    return;
  }

  const now = Date.now();
  paintTimer(task, now);

  const short = formatLap(now - task.startedAt).slice(0, -4); // mm:ss, without the milliseconds
  const info = rowEls.get(task.id)?.querySelector('.row-info');
  if (info && info.textContent !== short) {
    info.textContent = short;
    document.title = `${short} · ${task.name}`;
  }

  frameId = requestAnimationFrame(tick);
}

function startTicking() {
  if (frameId === null) frameId = requestAnimationFrame(tick);
}


/* ---------- 9. Session clock ---------- */

function tickClock() {
  const now = new Date();
  el.clock.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  const session = sessionFor(now);
  el.sessionTag.textContent = session.tag;
  el.sessionName.textContent = `${session.name} · ${now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`;

  raceControl();

  // Line the next update up with the start of the next second
  setTimeout(tickClock, 1000 - now.getMilliseconds());
}


/* ---------- 10. Race control: radio cues + yellow flag ---------- */

// Runs every second (from the clock, which keeps going in a background tab)
// and after every change. The yellow flag and the overtime radio use the
// task's TOTAL time; the hurry radio fires for the whole task and for each sector.
function raceControl() {
  const task = runningTask();
  const elapsed = task ? Date.now() - task.startedAt : 0;
  const progress = task ? elapsed / estimateMs(task) : 0;

  // Yellow flag: shown while the task on track is over its total estimate
  const overtime = progress > 1;
  el.yellowFlag.hidden = !overtime;
  document.body.classList.toggle('has-flag', overtime);
  if (overtime) {
    el.yfTask.textContent = task.name;
    el.yfOver.textContent = formatLap(elapsed - estimateMs(task)).slice(0, -4);
  }

  // Radio cues, each played once per run (the hurry one also once per sector).
  // If several were passed while the page was closed, only the most urgent plays.
  if (!task) return;
  const step = task.steps[task.currentStep];
  const stepReached = (Date.now() - task.stepStartedAt) / stepMs(step) >= HURRY_AT;
  const hurryTotal = progress >= HURRY_AT && !task.hurryCue;
  const hurrySector = stepReached && !step.hurryCue;

  if (overtime && !task.overtimeCue) {
    task.overtimeCue = task.hurryCue = true;
    if (stepReached) step.hurryCue = true;
    saveState();
    playRadio('overtime');
  } else if (hurryTotal || hurrySector) {
    // Another clip on air: wait until it's over, except a hurry clip already
    // playing, which covers this one too (one-sector tasks, or both at once)
    if (radioAudio && radioCategory !== 'hurry') return;
    if (hurryTotal) task.hurryCue = true;
    if (stepReached) step.hurryCue = true;
    saveState();
    if (!radioAudio) playRadio('hurry');
  }
}


/* ---------- 11. Team radio ---------- */

let radioAudio = null;    // the clip on air (or waiting for a click)
let radioCategory = null; // its category: hurry, overtime or victory
let radioTimer = null;    // hides a muted radio once the clip's length has passed

// Picks a clip of a category from audio-config.js at random,
// never the same one as last time when there's a choice
function pickClip(category) {
  const clips = AUDIO_CLIPS.filter((clip) => clip.category === category);
  const fresh = clips.filter((clip) => clip.file !== state.lastClip[category]);
  const pool = fresh.length ? fresh : clips;
  const clip = pool[Math.floor(Math.random() * pool.length)];
  if (clip) {
    state.lastClip[category] = clip.file;
    saveState();
  }
  return clip;
}

// Plays a clip and shows the radio overlay for exactly as long as it plays
function playRadio(category, { withMessage = true } = {}) {
  const clip = pickClip(category);
  if (!clip) return;

  stopRadio(); // a new message cuts off the previous one
  const audio = new Audio(`audio/${clip.file}`);
  radioCategory = category;
  const message = withMessage ? clip.label : '';
  audio.muted = state.settings.muted;
  radioAudio = audio;

  audio.addEventListener('playing', () => {
    if (radioAudio === audio) showRadio(message);
  });
  audio.addEventListener('ended', () => {
    if (radioAudio === audio) stopRadio();
  });
  audio.addEventListener('error', () => {
    console.warn(`Team radio: couldn't load audio/${clip.file}`);
    // No sound file: still show the radio message for a few seconds
    if (radioAudio !== audio) return;
    showRadio(message);
    radioTimer = setTimeout(stopRadio, 4000);
  });

  audio.play().catch((err) => {
    if (radioAudio !== audio || err.name !== 'NotAllowedError') return;
    // Edge and Chrome refuse to play any audio, even muted, until the page has been
    // clicked once since it opened, e.g. when the app is reopened while a task runs.
    if (state.settings.muted) showMutedRadio(audio, message);
    else holdRadio(audio, message);
  });
}

// Muted and blocked: no sound is wanted anyway, so show the radio for the clip's length
function showMutedRadio(audio, message) {
  showRadio(message);
  const hideLater = () => {
    if (radioAudio === audio) radioTimer = setTimeout(stopRadio, (audio.duration || 4) * 1000);
  };
  if (audio.readyState >= 1) hideLater(); // length already known
  else audio.addEventListener('loadedmetadata', hideLater, { once: true });
}

// Sound blocked: show the radio with a "click to listen" prompt and play the clip,
// with sound, on the first click or key press anywhere in the app
function holdRadio(audio, message) {
  showRadio(message, { waiting: true });
  const resume = () => {
    document.removeEventListener('pointerdown', resume, true);
    document.removeEventListener('keydown', resume, true);
    if (radioAudio === audio) audio.play().catch(() => stopRadio());
  };
  document.addEventListener('pointerdown', resume, true);
  document.addEventListener('keydown', resume, true);
}

function showRadio(message, { waiting = false } = {}) {
  el.radioWho.textContent = state.profile?.nickname || 'Driver';
  el.radioMsg.textContent = message ? `"${message}"` : '';
  el.radio.classList.toggle('no-msg', !message);
  el.radio.classList.toggle('waiting', waiting);
  el.radio.classList.add('show');
}

function stopRadio() {
  clearTimeout(radioTimer);
  if (radioAudio) radioAudio.pause();
  radioAudio = null;
  radioCategory = null;
  el.radio.classList.remove('show', 'waiting');
}

// Waveform bars for the overlay: taller in the middle, each with its own rhythm
function buildWaveform() {
  const bars = 28;
  for (let i = 0; i < bars; i++) {
    const bar = document.createElement('i');
    const envelope = Math.sin(((i + 0.5) / bars) * Math.PI); // 0 at the edges, 1 in the middle
    bar.style.setProperty('--h', (0.25 + 0.75 * envelope).toFixed(2));
    bar.style.animationDuration = `${(0.45 + Math.random() * 0.5).toFixed(2)}s`;
    bar.style.animationDelay = `-${Math.random().toFixed(2)}s`;
    el.radioWave.appendChild(bar);
  }
}


/* ---------- 12. Screen stays on while a task runs ---------- */

let wakeLock = null;          // the browser's screen wake lock, held while a task is on track
let wakeLockPending = false;  // a request is on its way

const keepAwakeWanted = () =>
  Boolean(runningTask()) && state.settings.keepAwake && document.visibilityState === 'visible';

// Keeps the screen from dimming or switching off while a task is on track, so the
// timer stays visible, and lets it sleep normally otherwise. Browsers drop the lock
// whenever the page is hidden, so this runs again when it becomes visible.
async function updateWakeLock() {
  if (!keepAwakeWanted()) {
    if (wakeLock) wakeLock.release();
    return;
  }
  if (wakeLock || wakeLockPending || !navigator.wakeLock) return;

  wakeLockPending = true;
  try {
    const lock = await navigator.wakeLock.request('screen');
    wakeLock = lock;
    lock.addEventListener('release', () => {
      if (wakeLock === lock) wakeLock = null;
      showWakeLock();
    });
    if (!keepAwakeWanted()) lock.release(); // the task ended while we were asking
  } catch (err) {
    // Refused (e.g. power saving, or the page was hidden meanwhile): the timer still works
  }
  wakeLockPending = false;
  showWakeLock();
}

// The small screen icon in the timer card shows when the lock is active
function showWakeLock() {
  document.body.classList.toggle('screen-awake', Boolean(wakeLock));
}


/* ---------- 13. Add-task form with sectors ---------- */

function addStepRow() {
  if (el.stepList.childElementCount >= MAX_STEPS) return null;
  const li = document.createElement('li');
  li.className = 'step-row';
  li.innerHTML = `
    <span class="step-tag"></span>
    <input class="step-name" type="text" maxlength="40" placeholder="Sector name (optional)">
    <label class="step-mins">
      <input type="number" min="1" max="600" step="1" inputmode="numeric" placeholder="25" required>
      <span>min</span>
    </label>
    <button class="step-del" type="button">×</button>`;
  el.stepList.appendChild(li);
  updateStepRows();
  return li;
}

// Renumbers S1…S6, refreshes the total and the + SECTOR button
function updateStepRows() {
  const rows = [...el.stepList.children];
  let total = 0;
  rows.forEach((row, i) => {
    row.querySelector('.step-tag').textContent = `S${i + 1}`;
    row.querySelector('.step-name').setAttribute('aria-label', `Sector ${i + 1} name`);
    row.querySelector('.step-mins input').setAttribute('aria-label', `Sector ${i + 1} minutes`);
    row.querySelector('.step-del').setAttribute('aria-label', `Remove sector ${i + 1}`);
    total += Math.round(Number(row.querySelector('.step-mins input').value)) || 0;
  });
  el.stepList.dataset.count = rows.length;
  el.addStepBtn.disabled = rows.length >= MAX_STEPS;
  el.addTotal.textContent = total;
}

function resetAddForm() {
  el.taskName.value = '';
  el.stepList.innerHTML = '';
  addStepRow();
}

function submitTask(event) {
  event.preventDefault();
  const name = el.taskName.value.trim();
  if (!name) return el.taskName.focus();

  const rows = [...el.stepList.children];
  const steps = rows.map((row, i) => ({
    // Unnamed sectors get a default: the task name if it's the only one, otherwise "Sector N"
    name: row.querySelector('.step-name').value.trim() || (rows.length === 1 ? name : `Sector ${i + 1}`),
    estimateMin: Math.round(Number(row.querySelector('.step-mins input').value)),
  }));
  const invalid = steps.findIndex((step) => !(step.estimateMin >= 1 && step.estimateMin <= 600));
  if (invalid !== -1) return rows[invalid].querySelector('.step-mins input').focus();

  addTask(name, steps);
  resetAddForm();
  el.taskName.focus();
}


/* ---------- 14. Settings: nickname, team, sound, screen ---------- */

let draftTeamId = null; // team picked in the dialog but not saved yet

// Paints the whole app in a team's colours
function applyAccent(team) {
  const accent = team.ui || team.color;
  const root = document.documentElement.style;
  root.setProperty('--accent', accent);
  root.setProperty('--accent-ink', inkFor(accent));
  root.setProperty('--accent-2', team.stripe);
}

// Applies the saved profile (also reverts a team that was only being previewed)
function applyProfile() {
  const team = teamById(state.profile?.team);
  if (team) applyAccent(team);
  el.driverName.textContent = state.profile?.nickname || 'DRIVER';
  el.driverTeam.textContent = team ? team.name : 'No team';
}

function buildTeamGrid() {
  for (const team of TEAMS) {
    const card = document.createElement('label');
    card.className = 'team-card';
    card.style.setProperty('--team', team.color);
    card.style.setProperty('--team-ink', inkFor(team.color));
    card.style.setProperty('--team-stripe', team.stripe);
    card.innerHTML = `
      <input type="radio" name="team" value="${team.id}">
      <span class="team-check" aria-hidden="true">✓</span>
      <span class="team-name">${team.name}</span>
      <span class="team-hex">${team.color}</span>`;
    el.teamGrid.appendChild(card);
  }
}

function openSetup() {
  const firstRun = !state.profile;
  el.setupTitle.textContent = firstRun ? 'Welcome to the paddock' : 'Driver settings';
  el.setupSave.textContent = firstRun ? 'Lights out' : 'Save changes';
  el.setupClose.hidden = firstRun;

  el.nickInput.value = state.profile?.nickname || '';
  el.muteToggle.checked = state.settings.muted;
  el.awakeToggle.checked = state.settings.keepAwake;
  draftTeamId = state.profile?.team || null;
  el.teamGrid.querySelectorAll('input').forEach((input) => {
    input.checked = input.value === draftTeamId;
  });

  updateSetupPreview();
  el.setupDialog.showModal();
  if (firstRun) el.nickInput.focus();
}

// Keeps the nameplate preview, character count and save button in sync
function updateSetupPreview() {
  const nick = el.nickInput.value.trim().toUpperCase();
  const team = teamById(draftTeamId);

  el.nickCount.textContent = `${el.nickInput.value.length}/12`;
  el.npName.textContent = nick || 'DRIVER';
  el.npTeam.textContent = team ? team.name : 'Pick a team';
  if (team) applyAccent(team);
  el.setupSave.disabled = !(nick && team);
}

function saveSetup(event) {
  event.preventDefault();
  const nickname = el.nickInput.value.trim().toUpperCase().slice(0, 12);
  if (!nickname || !draftTeamId) return;

  state.profile = { nickname, team: draftTeamId };
  state.settings.muted = el.muteToggle.checked;
  if (radioAudio) radioAudio.muted = state.settings.muted; // also applies to a clip that's playing now
  state.settings.keepAwake = el.awakeToggle.checked;
  saveState();
  el.setupDialog.close();
  render(); // the nickname shows up in the pit lane text, the screen setting applies
}


/* ---------- 15. Events ---------- */

el.addForm.addEventListener('submit', submitTask);
el.addStepBtn.addEventListener('click', () => addStepRow()?.querySelector('.step-name').focus());
el.stepList.addEventListener('input', updateStepRows); // keeps the total up to date
el.stepList.addEventListener('click', (event) => {
  const del = event.target.closest('.step-del');
  if (!del || el.stepList.childElementCount <= 1) return;
  del.closest('.step-row').remove();
  updateStepRows();
});

// One listener for every START / delete button in the tower
el.towerList.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const id = button.closest('.row').dataset.id;
  if (button.dataset.action === 'start') startTask(id);
  if (button.dataset.action === 'delete') deleteTask(id);
});

el.nextBtn.addEventListener('click', nextSector);
el.abortBtn.addEventListener('click', abortTask);
el.nextStart.addEventListener('click', () => startTask(el.nextStart.dataset.id));

el.settingsBtn.addEventListener('click', openSetup);
el.setupForm.addEventListener('submit', saveSetup);
el.setupClose.addEventListener('click', () => el.setupDialog.close());
el.nickInput.addEventListener('input', updateSetupPreview);
el.teamGrid.addEventListener('change', (event) => {
  draftTeamId = event.target.value;
  updateSetupPreview();
});

// First launch: the setup can't be skipped with Escape
el.setupDialog.addEventListener('cancel', (event) => {
  if (!state.profile) event.preventDefault();
});
el.setupDialog.addEventListener('close', () => {
  if (!state.profile) return el.setupDialog.showModal(); // browsers can force-close on a double Escape
  applyProfile();
});

el.resetBtn.addEventListener('click', () => {
  el.resetDialog.returnValue = '';
  el.resetDialog.showModal();
});
el.resetDialog.addEventListener('close', () => {
  if (el.resetDialog.returnValue === 'reset') resetDay();
});

// Hidden pages lose the screen wake lock: take it back when the app is visible again
document.addEventListener('visibilitychange', updateWakeLock);


/* ---------- 16. Start ---------- */

buildTeamGrid();
buildWaveform();
resetAddForm();
applyProfile();
render();
tickClock();
if (!state.profile) openSetup();

// Only animate team-colour changes after the first paint, so a reload doesn't fade in from red
window.addEventListener('load', () => document.documentElement.classList.add('is-ready'));
