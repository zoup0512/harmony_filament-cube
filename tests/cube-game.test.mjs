import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { Script } from 'node:vm';
import { CubeModel, CubeMove } from '../entry/src/main/ets/model/CubeModel.ts';
import { resourceManager } from './resource-helper.mjs';
import { TeachingChallenge, createTeachingChallenges } from './teaching-helper.mjs';

// Run with Node 24: node --test tests/cube-game.test.mjs
// Extract production members verbatim, not a second implementation of the game.
// The member-indent boundary is intentional (as in cube-touch.test.mjs): source
// layout changes must fail extraction rather than silently use fallback logic.
const pageUrl = new URL('../entry/src/main/ets/pages/Index.ets', import.meta.url);
const source = readFileSync(pageUrl, 'utf8');
const baseCanvasSource = source.match(/private cubeCanvas\(\) \{[\s\S]*?^  \}/m)[0];
const guidanceCanvasSource = source.match(/private guidanceCanvas\(\) \{[\s\S]*?^  \}/m)[0];
const names = [
  'startTimers', 'stopTimers', 'onForegroundChanged', 'draw', 'drawGuidance', 'clearGuidance', 'frame', 'animate',
  'resetSession', 'confirmReset', 'resetStepByStep', 'phaseLabel', 'chooseOrder', 'startGame', 'leavePage', 'doScramble',
  'faceMove', 'moveLabel', 'sameMove', 'requestMove', 'undo', 'showHint',
  'doLesson', 'updateLessonHint', 'invalidateGesture', 'finishSolve', 'toast',
  'loadData', 'saveSettings', 'setBeginnerGuides', 'guideTarget', 'resetGuide',
  'touch', 'layerGestureCurrent', 'setTouchOrigin', 'moveOrbit',
  'tr', 'setHint', 'onLanguageChanged', 'formatTime', 'bestTime', 'orderSolves',
  'openTeaching', 'startChallenge', 'retryChallenge', 'leaveChallenge', 'nextChallenge',
  'teachingStatus', 'teachingBest', 'finishTeaching', 'goHome', 'onBackPress', 'scramble', 'startLesson', 'showTeachingGoal'
];
const members = names.map(name => {
  const matches = [...source.matchAll(new RegExp(
    `^  (?:private )?(?:async )?${name}\\([^\\r\\n]*\\)[^\\r\\n]*\\{\\r?\\n[\\s\\S]*?^  \\}`, 'gm'))];
  assert.equal(matches.length, 1, `Index.ets must contain exactly one ${name} method`);
  return matches[0][0];
});
// Execute the plain callback bodies as well, so remount/resize/view tests use
// exactly the handlers attached by the production ArkUI builders.
for (const [name, parameters, pattern, callbackSource = source] of [
  ['canvasMounted', '', /\.onReady\(\(\) => \{([^\r\n]*)\}\)/, baseCanvasSource],
  ['canvasDisappeared', '', /\.onDisAppear\(\(\) => \{([^\r\n]*)\}\)/, baseCanvasSource],
  ['canvasResized', 'area: Area', /\.onAreaChange\(\(_old: Area, area: Area\) => \{\r?\n([\s\S]*?)^      \}\)/m, baseCanvasSource],
  ['guidanceMounted', '', /\.onReady\(\(\) => \{([^\r\n]*)\}\)/, guidanceCanvasSource],
  ['guidanceDisappeared', '', /\.onDisAppear\(\(\) => \{([^\r\n]*)\}\)/, guidanceCanvasSource],
  ['guidanceResized', 'area: Area', /\.onAreaChange\(\(_old: Area, area: Area\) => \{\r?\n([\s\S]*?)^      \}\)/m, guidanceCanvasSource],
  ['gameAppeared', '', /\.onAppear\(\(\) => (this\.gameScroller\.scrollTo\(\{ xOffset: 0, yOffset: 0 \}\))\)/],
  ['frontView', '', /\.onClick\(\(\) => \{ (this\.invalidateGesture\(\); this\.yaw = 0\.62;[^\r\n]*) \}\)/]
]) {
  const match = callbackSource.match(pattern);
  assert.ok(match, `${name} callback must be extractable`);
  members.push(`${name}(${parameters}): void {${match[1]}}`);
}
// Preserve real field defaults, stripping only ArkUI decorators; platform
// constructors below are inert mocks. Only guide tests opt into a ready canvas.
const fields = source.match(/^struct Index \{\r?\n([\s\S]*?)(?=^  aboutToAppear\()/m);
assert.ok(fields, 'Index.ets field declarations must be extractable');
const declarations = fields[1].replace(/@\w+(?:\([^\r\n)]*\))?\s*/g, '');
const storeSource = readFileSync(new URL('../entry/src/main/ets/storage/CubeStore.ets', import.meta.url), 'utf8');
const recordClasses = [...storeSource.matchAll(/^export class SolveRecord \{\r?\n[\s\S]*?^\}/gm)];
assert.equal(recordClasses.length, 1, 'use the real SolveRecord value object');
const teachingClasses = [...storeSource.matchAll(/^export class TeachingRecord \{\r?\n[\s\S]*?^\}/gm)];
assert.equal(teachingClasses.length, 1, 'use the real TeachingRecord value object');
const settingsClasses = [...storeSource.matchAll(/^export class CubeSettings \{\r?\n[\s\S]*?^\}/gm)];
assert.equal(settingsClasses.length, 1, 'use the real CubeSettings defaults');
const executable = stripTypeScriptTypes([
  recordClasses[0][0].replace(/^export /, ''),
  teachingClasses[0][0].replace(/^export /, ''),
  settingsClasses[0][0].replace(/^export /, ''),
  `class GameHarness {\n${declarations}\n${members.join('\n')}\n}`,
  'GameHarness;'
].join('\n'));
const script = new Script(executable, { filename: pageUrl.pathname });

const TouchType = Object.freeze({ Down: 0, Up: 1, Move: 2, Cancel: 3 });

function seededRandom() {
  let seed = 123456789;
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function harness(t, { order = 3, speed = 1, canvasReady = false, guideVisible = true, hit = true } = {}) {
  let now = 1_000_000;
  let nextTimer = 0;
  const timers = new Map();
  const calls = {
    draw: [], getSwipeGuide: [], drawGuide: [], drawBeginnerGuides: [],
    feedback: [], records: [], teachingRecords: [], pending: [], toasts: [], settings: [], dialogs: [], scroll: []
  };
  const guide = guideVisible ? { startX: 100, startY: 120, endX: 150, endY: 140 } : null;
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  class MockStore {
    records = [];
    teachingRecords = [];
    async load() {}
    async saveSettings(settings) {
      calls.settings.push(settings);
      this.settings = settings;
    }
    addRecord(record) {
      calls.records.push(record);
      // Controllable persistence, so tests observe both the pending UI and races.
      const deferred = Promise.withResolvers();
      calls.pending.push({
        resolve: () => { this.records.unshift(record); deferred.resolve(); },
        reject: () => deferred.reject(new Error('mock disk failure'))
      });
      return deferred.promise;
    }
    addTeachingRecord(record) {
      calls.teachingRecords.push(record);
      const deferred = Promise.withResolvers();
      calls.pending.push({
        resolve: () => { this.teachingRecords.push(record); deferred.resolve(); },
        reject: () => deferred.reject(new Error('mock teaching disk failure'))
      });
      return deferred.promise;
    }
  }
  const GameHarness = script.runInNewContext({
    CubeModel, CubeMove, TeachingChallenge, createTeachingChallenges,
    TouchType, Date: FakeDate, CubeStore: MockStore,
    CubeRenderer: class {
      draw(...args) { calls.draw.push(args); }
      getSwipeGuide(...args) { calls.getSwipeGuide.push(args); return guide; }
      drawGuide(...args) { calls.drawGuide.push(args); }
      drawBeginnerGuides(...args) { calls.drawBeginnerGuides.push(args); }
      hitTest() { return hit; }
      pickMove() { return null; }
    },
    CubeFeedback: class {
      play(...args) { calls.feedback.push(args); }
      async prepare() {}
    },
    CanvasRenderingContext2D: class {
      clears = [];
      clearRect(...args) { this.clears.push(args); }
    }, RenderingContextSettings: class {},
    Scroller: class { scrollTo(options) { calls.scroll.push({ ...options }); } },
    setInterval(callback, delay) {
      const id = nextTimer++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearInterval(id) { timers.delete(id); }
  });
  const resources = resourceManager();
  const state = new GameHarness();
  state.model = new CubeModel(order, seededRandom());
  state.order = order;
  state.speed = speed;
  state.getUIContext = () => ({
    getHostContext: () => ({ resourceManager: resources }),
    getPromptAction: () => ({ showToast: ({ message }) => calls.toasts.push(message) }),
    showAlertDialog: dialog => calls.dialogs.push(dialog)
  });
  state.startGame();
  state.canvasReady = canvasReady;
  state.guidanceReady = canvasReady;
  state.guidanceWidth = state.canvasWidth;
  state.guidanceHeight = state.canvasHeight;
  const clock = {
    now: () => now,
    // Wall time and interval callbacks are deliberately separate. No real sleeps,
    // global Date patches, browser, ArkUI, or timers can leak between tests.
    advance(ms) { assert.ok(ms >= 0); now += ms; },
    fire(id) { timers.get(id)?.callback(); },
    timers
  };
  t.after(() => {
    state.stopTimers();
    assert.equal(timers.size, 0);
    if (!canvasReady) {
      assert.equal(state.canvasReady, false);
      assert.equal(calls.draw.length, 0, 'draw must not access an unready Canvas');
      assert.equal(calls.getSwipeGuide.length, 0);
      assert.equal(calls.drawGuide.length, 0);
      assert.equal(calls.drawBeginnerGuides.length, 0);
    }
  });
  return { state, calls, clock, guide };
}

test('gesture instructions appear only on the first game entry in this app session', t => {
  const { state: s } = harness(t);
  assert.equal(s.hintKey, 'gesture_help');
  assert.match(s.hint, /跟随角块上的手势滑动/);
  assert.equal(s.gestureHelpSeen, true);
  s.resetSession();
  assert.equal(s.hint, '');
  assert.equal(s.gestureHelpSeen, true);
  s.leavePage();
  s.startGame();
  assert.equal(s.hint, '');
  assert.equal(s.hintKey, '');
});

test('a first accepted free-practice move dismisses initial gesture instructions without starting a timer', t => {
  const { state: s } = harness(t);
  s.requestMove(s.faceMove('R'));
  assert.equal(s.busy, true);
  assert.equal(s.hint, '');
  assert.equal(s.hintKey, '');
  assert.equal(s.assisted, false);
  assert.equal(s.phase, 'idle');
  assert.equal(s.startedAt, 0);
});

test('blocked moves do not dismiss initial gesture instructions', t => {
  const { state: s } = harness(t);
  for (const blocked of ['busy', 'background', 'other-page']) {
    s.busy = blocked === 'busy';
    s.foreground = blocked !== 'background';
    s.page = blocked === 'other-page' ? 'home' : 'game';
    s.requestMove(s.faceMove('R'));
    assert.equal(s.hintKey, 'gesture_help');
    assert.equal(s.activeMove, null);
  }
});

test('scramble, tutorial and teaching instructions replace initial help without repeating it', t => {
  const { state: s } = harness(t);
  s.doScramble();
  assert.equal(s.hintKey, 'scrambling_hint');
  s.resetSession();
  s.doLesson();
  assert.equal(s.hintKey, 'lesson_preparing');
  s.resetSession();
  s.loaded = true;
  s.page = 'teaching';
  s.startChallenge(0);
  assert.equal(s.hintKey, 'teaching_start_hint');
  s.leavePage();
  s.startGame();
  assert.equal(s.hint, '');
});

test('teaching goal details preserve the attempt and never count as solve assistance', t => {
  const h = harness(t);
  const { state: s, calls } = h;
  s.loaded = true;
  s.page = 'teaching';
  s.startChallenge(0);
  const position = snapshot(s.model);
  const session = s.sessionId;
  for (const phase of ['ready', 'playing', 'solved']) {
    s.phase = phase;
    s.showTeachingGoal();
    const dialog = calls.dialogs.at(-1);
    assert.ok(dialog.title.includes(s.tr(s.challenges[0].titleKey)));
    for (const text of [s.tr('teaching_goal_summary'), s.tr(s.challenges[0].tipKey),
      s.tr('teaching_start_hint'), s.tr('teaching_hint_note'),
      s.tr('teaching_level_details', s.order, s.challenges[0].referenceMoves)]) {
      assert.ok(dialog.message.includes(text));
    }
    assert.equal(dialog.primaryButton.value, s.tr('teaching_goal_close'));
    dialog.primaryButton.action();
    assert.equal(snapshot(s.model), position);
    assert.equal(s.sessionId, session);
    assert.equal(s.phase, phase);
    assert.equal(s.assisted, false);
    assert.equal(s.moves, 0);
    assert.equal(s.hintMove, null);
  }
});

test('teaching goal details ignore normal games, invalid levels and background requests', t => {
  const { state: s, calls } = harness(t);
  s.showTeachingGoal();
  assert.equal(calls.dialogs.length, 0);
  s.challengeIndex = 0;
  s.page = 'home';
  s.showTeachingGoal();
  s.page = 'game';
  s.foreground = false;
  s.showTeachingGoal();
  s.foreground = true;
  s.challengeIndex = s.challenges.length;
  s.showTeachingGoal();
  assert.equal(calls.dialogs.length, 0);
});

function snapshot(model) { return JSON.stringify(model.cubies); }

function completeMove(h, milliseconds = 220 / h.state.speed) {
  assert.equal(h.state.busy, true, 'test must have a real pending animation');
  h.clock.advance(milliseconds);
  h.state.frame();
}

function assertQuiet(h, moves = 0) {
  assert.equal(h.state.moves, moves);
  assert.equal(h.state.model.moveCount, moves);
  assert.equal(h.calls.records.length, 0);
  assert.equal(h.calls.feedback.length, 0);
}

// Reach ready through the real animation path, with a real one-turn-away cube.
// Never stub isSolved(), applyMove(), getSolution(), or finishSolve().
function oneMoveAway(h) {
  assert.equal(h.state.model.isSolved(), true, 'fixture starts from a real solved cube');
  const initial = snapshot(h.state.model);
  const previousRecords = h.calls.records.length;
  const previousFeedback = h.calls.feedback.length;
  const setup = h.state.faceMove('R');
  h.state.animate([setup], 'scramble');
  completeMove(h, 65 / h.state.speed);
  assert.equal(h.state.phase, 'ready');
  assert.equal(h.state.model.isSolved(), false);
  assert.notEqual(snapshot(h.state.model), initial);
  assert.equal(h.state.moves, 0);
  assert.equal(h.state.model.moveCount, 0);
  assert.equal(h.calls.records.length, previousRecords, 'setup never submits a record');
  assert.equal(h.calls.feedback.length, previousFeedback, 'setup never plays user feedback');
  return { inverse: setup.inverse(), initial };
}

function showTarget(h, kind) {
  if (kind === 'tutorial') {
    h.state.doLesson();
    for (let i = 0; i < 5; i++) completeMove(h, 65 / h.state.speed);
  } else {
    oneMoveAway(h);
    h.state.showHint();
  }
  return h.state.guideTarget();
}

function touch(h, type, x = 100, y = 100) {
  const point = { id: 1, x, y };
  h.state.touch({ type, touches: type === TouchType.Up ? [] : [point], changedTouches: [point] });
}

async function settle(h, index = 0, success = true) {
  assert.ok(h.calls.pending[index], 'a persistence request must actually exist');
  h.calls.pending[index][success ? 'resolve' : 'reject']();
  // Drain the production .then(...).catch(...) chain without real timers.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function enterTeaching(h, index = 0) {
  const s = h.state;
  s.leavePage();
  s.loaded = true;
  s.openTeaching();
  assert.equal(s.page, 'teaching');
  s.startChallenge(index);
  assert.equal(s.page, 'game');
  assert.equal(s.challengeIndex, index);
  return s.challenges[index];
}

function solveTeaching(h, solution = h.state.model.getSolution()) {
  assert.ok(solution.length > 0, 'solve a real unsolved position');
  for (const move of solution) {
    assert.equal(h.state.phase === 'ready' || h.state.phase === 'playing', true);
    h.state.requestMove(move);
    completeMove(h);
  }
  assert.equal(h.state.model.isSolved(), true);
  assert.equal(h.state.phase, 'solved');
}

function assertChallengeReady(h, index) {
  const s = h.state;
  const challenge = createTeachingChallenges()[index];
  const expected = new CubeModel(challenge.order);
  challenge.load(expected);
  assert.equal(s.page, 'game');
  assert.equal(s.challengeIndex, index);
  assert.equal(s.order, challenge.order);
  assert.equal(s.model.order, challenge.order);
  assert.equal(snapshot(s.model), snapshot(expected), 'load the exact fixed model position');
  assert.equal(s.model.isSolved(), false);
  assert.equal(s.model.undo(), null, 'setup is never a user step');
  assert.deepEqual(s.model.getSolution(), expected.getSolution(), 'setup retains history-based hints');
  for (const field of ['moves', 'elapsed', 'timeBase', 'startedAt', 'lessonIndex', 'lessonTotal']) {
    assert.equal(s[field], 0, field);
  }
  assert.equal(s.model.moveCount, 0);
  assert.equal(s.phase, 'ready');
  assert.equal(s.busy, false);
  assert.equal(s.activeMove, null);
  assert.equal(s.queue.length, 0);
  assert.equal(s.queueKind, '');
  assert.equal(s.lesson.length, 0, 'teaching is not the prescribed tutorial');
  assert.equal(s.assisted, false);
  assert.equal(s.hintMove, null);
  assert.equal(s.hintKey, 'teaching_start_hint');
  assert.equal(s.hint, s.tr('teaching_start_hint'));
  assert.equal(s.touching, false);
  assert.equal(s.pointerCount, 0);
  assert.equal(s.yaw, 0.62);
  assert.equal(s.pitch, -0.42);
  assert.equal(s.cubeZoom, 1.12);
}

for (const order of [2, 3, 4, 5]) {
  for (const speed of [0.5, 1, 2]) {
    test(`${order}x${order} reset reverses history one animated move at a time (${speed}x)`, t => {
      const h = harness(t, { order, speed, canvasReady: true });
      const { state: s, clock, calls } = h;
      s.doScramble();
      const setup = [s.activeMove, ...s.queue];
      while (s.busy) completeMove(h, 65 / speed);
      const expected = new CubeModel(order);
      for (const move of setup) expected.applyMove(move, false);
      const user = s.faceMove('U');
      s.requestMove(user);
      completeMove(h);
      expected.applyMove(user);
      s.requestMove(s.faceMove('F'));
      completeMove(h);
      s.undo();
      s.showHint();
      s.startTimers();
      clock.advance(1500);
      clock.fire(s.clockTimer);
      assert.ok(s.elapsed > 0);
      const solution = s.model.getSolution();
      const before = snapshot(s.model);
      const previousSession = s.sessionId;
      const feedbackCount = calls.feedback.length;
      s.confirmReset();
      assert.equal(snapshot(s.model), before, 'opening the dialog does not reset');
      calls.dialogs.at(-1).secondaryButton.action();
      assert.equal(snapshot(s.model), before, 'confirmation starts an animation, not an instant reset');
      assert.ok(s.sessionId > previousSession);
      assert.equal(s.phase, 'resetting');
      assert.equal(s.phaseLabel(), '正在复位');
      assert.equal(s.hintKey, 'resetting_hint');
      assert.equal(s.hintMove, null);
      assert.equal(s.assisted, true);
      assert.equal(s.elapsed, 0);
      assert.equal(s.moves, 0);
      assert.equal(s.queueKind, 'reset');
      assert.equal(s.queue.length + 1, solution.length);
      for (const [index, move] of solution.entries()) {
        const stepBefore = snapshot(s.model);
        const active = s.activeMove;
        s.requestMove(s.faceMove('R'));
        s.undo();
        s.showHint();
        s.resetStepByStep();
        s.confirmReset();
        assert.equal(s.activeMove, active, 'busy inputs cannot replace the reset queue');
        assert.equal(calls.dialogs.length, 1);
        clock.advance(220 / speed - 1);
        s.frame();
        assert.equal(snapshot(s.model), stepBefore, 'model commits only at the end of each turn');
        assert.equal(calls.draw.at(-1)[6], active);
        assert.ok(calls.draw.at(-1)[7] > 0 && calls.draw.at(-1)[7] < 1);
        clock.advance(1);
        s.frame();
        expected.applyMove(move, false);
        if (index < solution.length - 1) {
          assert.equal(snapshot(s.model), snapshot(expected));
          const committed = snapshot(s.model);
          s.frame();
          assert.equal(snapshot(s.model), committed, 'a repeated frame cannot double-commit');
        }
        assert.equal(s.busy, index < solution.length - 1);
        clock.fire(s.clockTimer);
        assert.equal(s.elapsed, 0, 'reset animations never run the challenge clock');
        assert.equal(s.moves, 0);
        assert.equal(calls.records.length, 0);
        assert.equal(calls.feedback.length, feedbackCount);
      }
      assert.equal(s.model.isSolved(), true);
      assert.equal(snapshot(s.model), snapshot(new CubeModel(order)));
      assert.equal(s.model.getSolution().length, 0);
      assert.equal(s.model.undo(), null);
      assert.equal(s.phase, 'idle');
      assert.equal(s.activeMove, null);
      assert.equal(s.queueKind, '');
      assert.equal(s.hint, '');
      assert.equal(s.assisted, false);
    });
  }
}

test('reset confirmation cancels cleanly and rejects busy, background and stale callbacks', t => {
  const h = harness(t);
  const { state: s, calls } = h;
  oneMoveAway(h);
  const before = snapshot(s.model);
  s.confirmReset();
  calls.dialogs.at(-1).primaryButton.action();
  assert.equal(snapshot(s.model), before);
  assert.equal(s.busy, false);
  s.confirmReset();
  const confirm = calls.dialogs.at(-1).secondaryButton.action;
  s.requestMove(s.faceMove('U'));
  const active = s.activeMove;
  confirm();
  assert.equal(s.activeMove, active);
  assert.equal(s.queueKind, 'user');
  completeMove(h);
  s.foreground = false;
  confirm();
  assert.equal(s.busy, false);
  s.foreground = true;
  s.resetSession();
  oneMoveAway(h);
  const newGame = snapshot(s.model);
  confirm();
  assert.equal(snapshot(s.model), newGame);
  assert.equal(s.busy, false);
  s.page = 'home';
  s.resetStepByStep();
  s.confirmReset();
  assert.equal(snapshot(s.model), newGame);
  assert.equal(calls.dialogs.length, 2);
});

test('reset of an already solved cube clears history without unnecessary animation', t => {
  const h = harness(t);
  const { state: s } = h;
  s.resetStepByStep();
  assert.equal(s.busy, false);
  for (let i = 0; i < 4; i++) {
    s.requestMove(s.faceMove('R'));
    completeMove(h);
  }
  assert.equal(s.model.isSolved(), true);
  assert.ok(s.model.getSolution().length > 0);
  s.resetStepByStep();
  assert.equal(s.busy, false);
  assert.equal(s.phase, 'idle');
  assert.equal(s.moves, 0);
  assert.equal(s.model.getSolution().length, 0);
});

test('reset pauses in background and resumes each move without duplicate commits', t => {
  const h = harness(t);
  const { state: s, clock } = h;
  oneMoveAway(h);
  s.resetStepByStep();
  clock.advance(100);
  s.frame();
  const before = snapshot(s.model);
  s.foreground = false;
  s.onForegroundChanged();
  clock.advance(10_000);
  s.frame();
  assert.equal(snapshot(s.model), before);
  s.foreground = true;
  s.onForegroundChanged();
  s.frame();
  assert.equal(snapshot(s.model), before);
  completeMove(h);
  assert.equal(s.model.isSolved(), true);
  assert.equal(s.phase, 'idle');
  assertQuiet(h);
});

test('leaving during reset cancels the remaining moves and clears tutorial state', t => {
  const h = harness(t);
  const { state: s, clock } = h;
  s.doLesson();
  while (s.busy) completeMove(h, 65);
  s.resetStepByStep();
  assert.equal(s.lesson.length, 0);
  assert.equal(s.lessonIndex, 0);
  assert.equal(s.lessonTotal, 0);
  completeMove(h);
  assert.equal(s.busy, true);
  s.leavePage();
  const after = snapshot(s.model);
  clock.advance(1000);
  s.frame();
  assert.equal(snapshot(s.model), after);
  assert.equal(s.model.isSolved(), true);
  assert.equal(s.page, 'home');
  assert.equal(s.busy, false);
  assert.equal(s.queue.length, 0);
  assertQuiet(h);
});

for (const speed of [0.5, 1, 2]) {
  test(`ready starts on first input; commit and count only at animation end (${speed}x)`, t => {
    const h = harness(t, { speed });
    oneMoveAway(h);
    const { state: s, clock, calls } = h;
    const before = snapshot(s.model);
    clock.advance(5000);
    assert.equal(s.elapsed, 0);
    assert.equal(s.startedAt, 0);
    const start = clock.now();
    s.requestMove(s.faceMove('U'));
    assert.equal(s.phase, 'playing');
    assert.equal(s.startedAt, start);
    assert.equal(s.busy, true);
    assert.equal(s.queueKind, 'user');
    assert.equal(s.hint, '');
    assert.equal(snapshot(s.model), before);
    assertQuiet(h);
    clock.advance(220 / speed - 1);
    s.frame();
    assert.equal(snapshot(s.model), before);
    assertQuiet(h);
    clock.advance(1);
    s.frame();
    assert.notEqual(snapshot(s.model), before);
    assert.equal(s.model.moveCount, 1);
    assert.equal(s.moves, 1);
    assert.equal(s.phase, 'playing');
    assert.equal(s.busy, false);
    assert.equal(s.activeMove, null);
    assert.equal(s.queueKind, '');
    assert.deepEqual(calls.feedback, [[true, true]]);
    const committed = snapshot(s.model);
    clock.advance(1000);
    s.frame();
    assert.equal(snapshot(s.model), committed, 'a stale frame cannot double-commit');
    assert.equal(s.moves, 1);
    assert.equal(calls.feedback.length, 1);
    s.requestMove(s.faceMove('F'));
    assert.equal(s.startedAt, start, 'later moves cannot restart the solve clock');
  });
}

for (const [order, count] of [[2, 11], [3, 25], [4, 45], [5, 65]]) {
  test(`${order}x${order}: real doScramble queues ${count} uncounted turns and then becomes ready`, t => {
    const h = harness(t, { order });
    const { state: s, clock } = h;
    const initial = snapshot(s.model);
    s.doScramble();
    const planned = [s.activeMove, ...s.queue];
    assert.equal(planned.length, count);
    assert.equal(snapshot(s.model), initial);
    const expected = new CubeModel(order);
    for (const [index, move] of planned.entries()) {
      const before = snapshot(s.model);
      clock.advance(64);
      s.frame();
      assert.equal(snapshot(s.model), before);
      clock.advance(1);
      s.frame();
      expected.applyMove(move, false);
      assert.equal(snapshot(s.model), snapshot(expected));
      assert.equal(s.busy, index < count - 1);
      assertQuiet(h);
    }
    assert.equal(s.phase, 'ready');
    assert.equal(s.model.isSolved(), false);
    assert.equal(s.model.undo(), null, 'scramble must not enter user undo history');
    assert.equal(s.elapsed, 0);
    assert.equal(s.startedAt, 0);
    assert.equal(s.activeMove, null);
    assert.equal(s.queue.length, 0);
    assert.match(s.hint, /第一手开始计时/);
  });

  test(`${order}x${order}: an actual inverse solves and saves exactly one real record`, async t => {
    const h = harness(t, { order });
    const { inverse, initial } = oneMoveAway(h);
    const { state: s, calls, clock } = h;
    clock.advance(8000); // Ready waiting time is excluded.
    s.requestMove(inverse);
    clock.advance(219);
    s.frame();
    assert.equal(s.model.isSolved(), false);
    assert.equal(calls.records.length, 0);
    clock.advance(1);
    s.frame();
    assert.equal(snapshot(s.model), initial);
    assert.equal(s.model.isSolved(), true);
    assert.equal(s.phase, 'solved');
    assert.equal(s.moves, 1);
    assert.equal(s.elapsed, 220);
    assert.equal(calls.records.length, 1);
    assert.deepEqual({ ...calls.records[0] }, { order, durationMs: 220, moves: 1, date: clock.now() });
    assert.match(s.hint, /正在保存/);
    assert.equal(s.records.length, 0);
    await settle(h);
    assert.equal(s.records.length, 1);
    assert.equal(s.records[0], calls.records[0]);
    assert.notEqual(s.records, s.store.records, 'UI receives a copy of the record list');
    assert.match(s.hint, /成绩已记录/);
    clock.advance(1000);
    s.frame();
    assert.equal(calls.records.length, 1);
    assert.equal(s.elapsed, 220);
  });
}

test('showHint marks the actual solve assisted and never writes a record', t => {
  const h = harness(t);
  const { inverse, initial } = oneMoveAway(h);
  const { state: s } = h;
  const before = snapshot(s.model);
  s.showHint();
  assert.equal(s.assisted, true);
  assert.match(s.hint, /还原建议：R'/);
  assert.match(s.hint, /不计入成绩/);
  assert.equal(snapshot(s.model), before);
  s.requestMove(inverse);
  completeMove(h);
  assert.equal(snapshot(s.model), initial);
  assert.equal(s.phase, 'solved');
  assert.equal(s.moves, 1);
  assert.equal(s.elapsed, 220);
  assert.match(s.hint, /不记录成绩/);
  assert.equal(h.calls.records.length, 0);
  assert.equal(s.records.length, 0);
});

test('tutorial rejects the wrong move, advances only after commits and never saves', t => {
  const h = harness(t);
  const { state: s, calls } = h;
  const initial = snapshot(s.model);
  s.doLesson();
  assert.equal(s.lessonTotal, 5);
  for (let i = 0; i < 5; i++) completeMove(h, 65);
  assert.equal(s.phase, 'tutorial');
  assert.equal(s.lessonIndex, 0);
  assert.equal(s.model.isSolved(), false);
  assertQuiet(h);
  const setup = snapshot(s.model);
  s.showHint();
  assert.equal(s.assisted, false);
  assert.equal(snapshot(s.model), setup);
  assert.equal(s.hintMove, null, 'tutorial hints use the lesson target, not history');
  const labels = ['D', "L'", 'F', "U'", "R'"];
  assert.deepEqual(Array.from(s.lesson, move => s.moveLabel(move)), labels);
  for (let i = 0; i < s.lessonTotal; i++) {
    const expected = s.lesson[i];
    const hint = s.hint;
    assert.ok(hint.startsWith(`第 ${i + 1} / ${s.lessonTotal} 步：`));
    assert.ok(hint.includes(`跟随小手完成 ${labels[i]}`));
    assert.match(hint, /按小手示范的方向滑动/);
    assert.doesNotMatch(hint, /轨迹|圆点/);
    assert.match(hint, /松手转层/);
    assert.match(hint, /看不到小手.*转动视角/);
    assert.doesNotMatch(hint, /箭头|按钮|高亮/);
    const before = snapshot(s.model);
    const wrongMoves = [
      expected.inverse(),
      new CubeMove(expected.axis, (expected.layer + 1) % s.order, expected.turns),
      new CubeMove(expected.axis === 'x' ? 'y' : 'x', expected.layer, expected.turns)
    ];
    for (const wrong of wrongMoves) {
      const toastCount = calls.toasts.length;
      s.requestMove(wrong);
      assert.equal(s.lessonIndex, i, 'wrong gesture must not advance the target step');
      assert.equal(s.phase, 'tutorial');
      assert.equal(s.busy, false);
      assert.equal(s.activeMove, null);
      assert.equal(s.queue.length, 0);
      assert.equal(snapshot(s.model), before);
      assert.equal(s.hint, hint);
      assert.equal(s.moves, 0);
      assert.equal(s.model.moveCount, 0);
      assert.equal(calls.records.length, 0);
      assert.equal(calls.feedback.length, i);
      assert.equal(calls.toasts.length, toastCount + 1);
      assert.match(calls.toasts.at(-1), /跟随小手滑动，松手完成当前教程步骤/);
    }
    s.requestMove(new CubeMove(expected.axis, expected.layer, expected.turns));
    assert.equal(s.lessonIndex, i);
    assert.equal(s.queueKind, 'lessonStep');
    completeMove(h, 219);
    assert.equal(s.lessonIndex, i);
    completeMove(h, 1);
    assert.equal(s.lessonIndex, i + 1);
    assert.equal(s.moves, 0);
    assert.equal(s.model.moveCount, 0);
    assert.equal(calls.records.length, 0);
  }
  assert.equal(snapshot(s.model), initial);
  assert.equal(s.model.isSolved(), true);
  assert.equal(s.phase, 'idle');
  assert.equal(s.elapsed, 0);
  assert.equal(s.startedAt, 0);
  assert.equal(calls.feedback.length, 5);
  assert.match(s.hint, /教程完成/);
});

test('beginner gesture guides default on; toggling redraws immediately and persists without changing the session', t => {
  const h = harness(t, { canvasReady: true });
  const { state: s, calls } = h;
  assert.equal(s.beginnerGuides, true);
  s.draw();
  assert.deepEqual(calls.drawBeginnerGuides, [[s.guidanceContext]]);
  assert.equal(calls.getSwipeGuide.length, 0, 'directions must not request a solution guide');
  const before = snapshot(s.model);
  s.setBeginnerGuides(false);
  assert.equal(s.beginnerGuides, false);
  assert.equal(calls.draw.length, 1, 'turning off clears only the transparent guidance layer');
  assert.equal(calls.drawBeginnerGuides.length, 1);
  assert.equal(calls.settings.at(-1).beginnerGuides, false);
  s.draw();
  assert.equal(calls.drawBeginnerGuides.length, 1, 'off stays hidden on subsequent frames');
  s.setBeginnerGuides(true);
  assert.equal(calls.drawBeginnerGuides.length, 2);
  assert.equal(calls.settings.at(-1).beginnerGuides, true);
  assert.equal(snapshot(s.model), before);
  assert.equal(s.phase, 'idle');
  assert.equal(s.assisted, false);
  assert.equal(s.startedAt, 0);
  assert.equal(s.elapsed, 0);
  assertQuiet(h);
});

for (const enabled of [false, true]) {
  test(`loadData restores beginnerGuides=${enabled} and saving other preferences retains it`, async t => {
    const h = harness(t, { canvasReady: true });
    const { state: s, calls } = h;
    s.store.settings = { defaultOrder: 4, speed: 1.5, sound: true, haptics: false, beginnerGuides: enabled };
    await s.loadData();
    assert.equal(s.loaded, true);
    assert.equal(s.storageWarning, '');
    assert.equal(s.beginnerGuides, enabled);
    assert.equal(calls.drawBeginnerGuides.length, enabled ? 1 : 0);
    s.speed = 2;
    s.saveSettings();
    assert.deepEqual({ ...calls.settings.at(-1) }, {
      defaultOrder: 4, speed: 2, sound: true, haptics: false, beginnerGuides: enabled
    });
  });
}

test('beginner gesture guides never draw while busy or outside the game', t => {
  const { state: s, calls } = harness(t, { canvasReady: true });
  for (const page of ['home', 'stats', 'settings', 'game']) {
    s.page = page;
    for (const busy of [false, true]) {
      if (page === 'game' && !busy) continue;
      s.busy = busy;
      s.draw();
    }
  }
  assert.equal(calls.drawBeginnerGuides.length, 0);
  assert.equal(calls.getSwipeGuide.length, 0);
  assert.equal(calls.drawGuide.length, 0);
  s.busy = false;
  s.draw();
  assert.equal(calls.drawBeginnerGuides.length, 1);
});

for (const kind of ['tutorial', 'history']) {
  for (const guideVisible of [true, false]) {
    test(`${kind} target takes priority even when its guide is ${guideVisible ? 'visible' : 'hidden'}`, t => {
      const { state: s, calls, guide } = harness(t, { canvasReady: true, guideVisible });
      s.hintMove = s.faceMove('R');
      if (kind === 'tutorial') {
        s.phase = 'tutorial';
        s.lesson = [s.faceMove('U')];
      }
      const target = kind === 'tutorial' ? s.lesson[0] : s.hintMove;
      for (const enabled of [true, false]) {
        s.beginnerGuides = enabled;
        s.draw();
        assert.equal(calls.getSwipeGuide.at(-1)[0], target);
        if (guideVisible) assert.deepEqual(calls.drawGuide.at(-1), [s.guidanceContext, guide, 0, s.phase !== 'tutorial']);
        else assert.equal(calls.drawGuide.length, 0);
        assert.equal(calls.drawBeginnerGuides.length, 0, 'never fall back to directions for a hidden target');
      }
      s.phase = 'idle';
      s.hintMove = null;
      s.beginnerGuides = true;
      s.draw();
      assert.equal(calls.drawBeginnerGuides.length, 1, 'directions return only after clearing the target');
    });
  }
}

for (const kind of ['tutorial', 'history']) {
  test(`${kind} hand loops in 1800ms using only the existing frame timer without mutating the solve`, t => {
    const h = harness(t, { canvasReady: true });
    const { state: s, calls, clock, guide } = h;
    const target = showTarget(h, kind);
    s.startTimers();
    s.speed = 2; // Hand timing is independent of turn animation speed.
    s.beginnerGuides = false; // Target guidance is independent of the corner-guide toggle.
    const before = snapshot(s.model);
    const draws = calls.draw.length;
    const corners = calls.drawBeginnerGuides.length;
    const phase = s.phase;
    assert.deepEqual(calls.drawGuide.at(-1), [s.guidanceContext, guide, 0, s.phase !== 'tutorial']);
    const samples = [[16, 16 / 1800], [272, 0.16], [1044, 0.74], [378, 0.95],
      [90, 0], [900, 0.5], [900, 0]];
    for (const [ms, progress] of samples) {
      clock.advance(ms);
      clock.fire(s.frameTimer);
      clock.fire(s.clockTimer);
      assert.deepEqual(calls.drawGuide.at(-1), [s.guidanceContext, guide, progress, kind !== 'tutorial']);
      assert.equal(calls.getSwipeGuide.at(-1)[0], target);
      assert.equal(calls.draw.at(-1)[6], null, 'guide progress must not animate a cube turn');
      assert.equal(calls.draw.at(-1)[8], s.cubeZoom);
    }
    assert.equal(calls.draw.length, draws, 'hint frames never repaint the base cube');
    assert.equal(calls.drawBeginnerGuides.length, corners);
    assert.deepEqual([...clock.timers.values()].map(timer => timer.delay), [16, 83]);
    assert.equal(snapshot(s.model), before);
    assert.equal(s.phase, phase);
    assert.equal(s.lessonIndex, 0);
    assert.equal(s.elapsed, 0);
    assert.equal(s.startedAt, 0);
    assert.equal(s.assisted, kind === 'history');
    assertQuiet(h);
  });

  test(`${kind} guidance stops in background and resumes from the beginning`, t => {
    const h = harness(t, { canvasReady: true });
    const { state: s, calls, clock, guide } = h;
    const target = showTarget(h, kind);
    s.startTimers();
    clock.advance(900);
    clock.fire(s.frameTimer);
    assert.equal(calls.drawGuide.at(-1)[2], 0.5);
    const draws = calls.draw.length;
    const guides = calls.drawGuide.length;
    const oldTimer = s.frameTimer;
    s.foreground = false;
    s.onForegroundChanged();
    assert.equal(clock.timers.size, 0);
    clock.advance(60_000);
    clock.fire(oldTimer);
    s.frame();
    assert.equal(calls.draw.length, draws);
    s.draw(); // A stray draw while backgrounded must not paint a target.
    assert.equal(calls.drawGuide.length, guides);
    s.foreground = true;
    s.onForegroundChanged();
    assert.deepEqual(calls.drawGuide.at(-1), [s.guidanceContext, guide, 0, s.phase !== 'tutorial']);
    assert.equal(calls.getSwipeGuide.at(-1)[0], target);
    assert.deepEqual([...clock.timers.values()].map(timer => timer.delay), [16, 83]);
    clock.advance(450);
    clock.fire(s.frameTimer);
    assert.equal(calls.drawGuide.at(-1)[2], 0.25);
  });

  for (const end of [TouchType.Up, TouchType.Cancel]) {
    test(`${kind} hand clears on Down, pauses through touch and restarts after ${end === TouchType.Up ? 'Up' : 'Cancel'}`, t => {
      const h = harness(t, { canvasReady: true });
      const { state: s, calls, clock, guide } = h;
      showTarget(h, kind);
      s.startTimers();
      clock.advance(900);
      clock.fire(s.frameTimer);
      assert.equal(calls.drawGuide.at(-1)[2], 0.5);
      const draws = calls.draw.length;
      const guides = calls.drawGuide.length;
      const lookups = calls.getSwipeGuide.length;
      const corners = calls.drawBeginnerGuides.length;
      touch(h, TouchType.Down);
      assert.equal(s.touching, true);
      assert.equal(calls.draw.length, draws, 'Down erases only the guidance layer');
      assert.equal(calls.drawGuide.length, guides);
      touch(h, TouchType.Move, 108, 100);
      for (let i = 0; i < 4; i++) {
        clock.advance(900);
        clock.fire(s.frameTimer);
      }
      assert.equal(calls.draw.length, draws, 'touch must not keep a target animation running');
      s.draw(); // External repaint must also suppress the hand, not just timer ticks.
      assert.equal(calls.drawGuide.length, guides);
      assert.equal(calls.getSwipeGuide.length, lookups);
      assert.equal(calls.drawBeginnerGuides.length, corners, 'do not fall back to corners during target touch');
      touch(h, end, 108, 100);
      assert.equal(s.touching, false);
      clock.fire(s.frameTimer);
      assert.deepEqual(calls.drawGuide.at(-1), [s.guidanceContext, guide, 0, s.phase !== 'tutorial']);
      clock.advance(450);
      clock.fire(s.frameTimer);
      assert.equal(calls.drawGuide.at(-1)[2], 0.25);
      assertQuiet(h);
    });
  }
}

for (const page of ['home', 'stats', 'settings']) {
  test(`${page} never loops or draws a retained target`, t => {
    const h = harness(t, { canvasReady: true });
    const { state: s, calls, clock } = h;
    showTarget(h, 'history');
    s.startTimers();
    const guides = calls.drawGuide.length;
    s.page = page;
    s.draw();
    const draws = calls.draw.length;
    for (let i = 0; i < 5; i++) {
      clock.advance(900);
      clock.fire(s.frameTimer);
    }
    assert.equal(calls.draw.length, draws);
    assert.equal(calls.drawGuide.length, guides);
    s.page = 'game';
    clock.fire(s.frameTimer);
    assert.equal(calls.drawGuide.at(-1)[2], 0);
  });
}

for (const enabled of [true, false]) {
  test(`ordinary game with corners ${enabled ? 'on' : 'off'} and no target never starts idle redraws`, t => {
    const h = harness(t, { canvasReady: true });
    const { state: s, calls, clock } = h;
    s.beginnerGuides = enabled;
    s.draw();
    s.startTimers();
    const draws = calls.draw.length;
    for (let i = 0; i < 5; i++) {
      clock.advance(900);
      clock.fire(s.frameTimer);
    }
    for (const end of [TouchType.Up, TouchType.Cancel]) {
      touch(h, TouchType.Down);
      touch(h, end);
      clock.fire(s.frameTimer);
    }
    assert.equal(calls.draw.length, draws, 'no-target touch release/cancel must not add redraws');
    assert.equal(calls.getSwipeGuide.length, 0);
    s.touching = true;
    s.draw();
    assert.equal(calls.drawBeginnerGuides.length, enabled ? 2 : 0,
      'ordinary corner guides retain their existing touch display policy');
  });
}

test('requesting the same visible history hint is idempotent; unrelated redraws keep progress', t => {
  const h = harness(t, { canvasReady: true });
  const { state: s, calls, clock, guide } = h;
  const target = showTarget(h, 'history');
  clock.advance(900);
  s.frame();
  assert.equal(calls.drawGuide.at(-1)[2], 0.5);
  const draws = calls.draw.length;
  const guidanceDraws = calls.drawGuide.length;
  const at = s.guideAt;
  for (let i = 0; i < 18; i++) s.showHint();
  assert.equal(s.sameMove(s.hintMove, target), true);
  assert.equal(s.hintMove, target, 'same-valued new solution objects do not replace the active hint');
  assert.equal(s.guideAt, at);
  assert.equal(calls.draw.length, draws, 'repeated hints never repaint the base cube');
  assert.equal(calls.drawGuide.length, guidanceDraws, 'visible repeated hints are entirely idempotent');
  assert.deepEqual(calls.drawGuide.at(-1), [s.guidanceContext, guide, 0.5, s.phase !== 'tutorial']);
  clock.advance(450);
  s.setBeginnerGuides(false);
  assert.equal(calls.drawGuide.at(-1)[2], 0.75, 'corner settings do not restart a target');
  assert.equal(s.assisted, true);
});

for (const [name, change] of [
  ['front view', s => s.frontView()],
  ['canvas width', s => { const area = { width: s.canvasWidth + 20, height: s.canvasHeight }; s.canvasResized(area); s.guidanceResized(area); }],
  ['canvas height', s => { const area = { width: s.canvasWidth, height: s.canvasHeight + 20 }; s.canvasResized(area); s.guidanceResized(area); }],
  ['canvas remount', s => s.canvasMounted()]
]) {
  test(`${name} callback restarts the current target without advancing the lesson`, t => {
    const h = harness(t, { canvasReady: true });
    const { state: s, calls, clock, guide } = h;
    const target = showTarget(h, 'tutorial');
    clock.advance(900);
    s.frame();
    assert.equal(calls.drawGuide.at(-1)[2], 0.5);
    change(s);
    assert.deepEqual(calls.drawGuide.at(-1), [s.guidanceContext, guide, 0, s.phase !== 'tutorial']);
    assert.equal(calls.getSwipeGuide.at(-1)[0], target);
    assert.equal(s.lessonIndex, 0);
    clock.advance(450);
    s.frame();
    assert.equal(calls.drawGuide.at(-1)[2], 0.25);
    assertQuiet(h);
  });
}

for (const [name, recover] of [
  ['front view', h => h.state.frontView()],
  ['canvas resize', h => { const area = { width: 360, height: 300 }; h.state.canvasResized(area); h.state.guidanceResized(area); }],
  ['canvas remount', h => h.state.canvasMounted()],
  ['new history hint', h => h.state.showHint()],
  ['model change', h => {
    h.state.requestMove(h.state.faceMove('U'));
    completeMove(h);
    h.state.showHint();
  }],
  ['orbit release', h => {
    touch(h, TouchType.Down);
    touch(h, TouchType.Move, 140, 120);
    touch(h, TouchType.Up, 140, 120);
    h.state.frame();
  }]
]) {
  test(`offscreen target stops empty redraws and can recover after ${name}`, t => {
    const h = harness(t, { canvasReady: true, guideVisible: false, hit: false });
    const { state: s, calls, clock } = h;
    showTarget(h, 'history');
    s.startTimers();
    const draws = calls.draw.length;
    const lookups = calls.getSwipeGuide.length;
    for (let i = 0; i < 5; i++) {
      clock.advance(900);
      clock.fire(s.frameTimer);
    }
    assert.equal(calls.draw.length, draws, 'offscreen targets do not keep repicking/repainting');
    assert.equal(calls.getSwipeGuide.length, lookups);
    assert.equal(calls.drawGuide.length, 0);
    const guide = { startX: 100, startY: 120, endX: 150, endY: 140 };
    s.renderer.getSwipeGuide = (...args) => { calls.getSwipeGuide.push(args); return guide; };
    recover(h);
    assert.deepEqual(calls.drawGuide.at(-1), [s.guidanceContext, guide, 0, s.phase !== 'tutorial']);
    clock.advance(450);
    clock.fire(s.frameTimer);
    assert.equal(calls.drawGuide.at(-1)[2], 0.25);
  });
}

test('invisible tutorial target is reconsidered after the next committed step', t => {
  const h = harness(t, { canvasReady: true, guideVisible: false });
  const { state: s, calls, clock } = h;
  showTarget(h, 'tutorial');
  const draws = calls.draw.length;
  clock.advance(900);
  s.frame();
  assert.equal(calls.draw.length, draws);
  const guide = { startX: 100, startY: 120, endX: 150, endY: 140 };
  s.renderer.getSwipeGuide = (...args) => { calls.getSwipeGuide.push(args); return guide; };
  s.requestMove(s.lesson[0]);
  completeMove(h);
  assert.equal(s.lessonIndex, 1);
  assert.equal(calls.getSwipeGuide.at(-1)[0], s.lesson[1]);
  assert.deepEqual(calls.drawGuide.at(-1), [s.guidanceContext, guide, 0, s.phase !== 'tutorial']);
});

test('unready canvas with a target does not animate or resolve guidance', t => {
  const h = harness(t);
  showTarget(h, 'history');
  h.state.startTimers();
  for (let i = 0; i < 5; i++) {
    h.clock.advance(900);
    h.clock.fire(h.state.frameTimer);
  }
  assert.equal(h.calls.draw.length, 0);
  assert.equal(h.calls.getSwipeGuide.length, 0);
});

test('beginner gesture guides and their toggle do not mark a timed solve assisted or restart its clock', async t => {
  const h = harness(t, { canvasReady: true });
  const { state: s, calls, clock } = h;
  const { inverse } = oneMoveAway(h);
  s.setBeginnerGuides(false);
  s.setBeginnerGuides(true);
  assert.equal(s.phase, 'ready');
  assert.equal(s.startedAt, 0);
  assert.equal(s.assisted, false);
  assert.ok(calls.drawBeginnerGuides.length > 0);
  s.requestMove(inverse);
  const start = s.startedAt;
  clock.advance(100);
  const guides = calls.drawBeginnerGuides.length;
  s.setBeginnerGuides(false);
  s.setBeginnerGuides(true);
  assert.equal(calls.drawBeginnerGuides.length, guides, 'toggling during animation must not draw gesture guides');
  assert.equal(s.startedAt, start);
  assert.equal(s.assisted, false);
  completeMove(h, 120);
  assert.equal(s.phase, 'solved');
  assert.equal(s.elapsed, 220);
  assert.equal(calls.records.length, 1);
  await settle(h);
});

test('each committed lesson step restarts the hand; setup, busy and completed states never loop a target', t => {
  const h = harness(t, { canvasReady: true });
  const { state: s, calls, guide, clock } = h;
  s.startTimers();
  s.doLesson();
  for (let i = 0; i < 4; i++) completeMove(h, 65);
  assert.equal(calls.getSwipeGuide.length, 0, 'setup animation has no target hand');
  assert.equal(calls.drawGuide.length, 0);
  completeMove(h, 65);
  for (let i = 0; i < s.lessonTotal; i++) {
    assert.equal(s.lessonIndex, i);
    assert.equal(calls.getSwipeGuide.at(-1)[0], s.lesson[i]);
    assert.deepEqual(calls.drawGuide.at(-1), [s.guidanceContext, guide, 0, s.phase !== 'tutorial']);
    clock.advance(900);
    clock.fire(s.frameTimer);
    assert.deepEqual(calls.drawGuide.at(-1), [s.guidanceContext, guide, 0.5, false]);
    const guides = calls.drawGuide.length;
    const lookups = calls.getSwipeGuide.length;
    s.requestMove(s.lesson[i]);
    s.draw();
    completeMove(h, 219);
    assert.equal(calls.drawGuide.length, guides, 'busy moves must not draw stale target hands');
    assert.equal(calls.getSwipeGuide.length, lookups);
    completeMove(h, 1);
    assert.equal(calls.drawGuide.length, guides + (i < s.lessonTotal - 1 ? 1 : 0));
  }
  assert.equal(s.phase, 'idle');
  const guides = calls.drawGuide.length;
  const draws = calls.draw.length;
  clock.advance(3600);
  clock.fire(s.frameTimer);
  assert.equal(calls.draw.length, draws, 'completed tutorial must stop frame redraws');
  s.draw();
  assert.equal(calls.drawGuide.length, guides, 'completed tutorial has no target hand');
  const draw = calls.draw.at(-1);
  assert.deepEqual(draw, [s.context2d, s.canvasWidth, s.canvasHeight, s.model, s.yaw, s.pitch, null, 0, s.cubeZoom]);
});

for (const followHint of [true, false]) {
  test(`history hand clears when turning ${followHint ? 'the suggested' : 'a different'} layer`, t => {
    const h = harness(t, { canvasReady: true });
    const { inverse } = oneMoveAway(h);
    const { state: s, calls, guide } = h;
    s.showHint();
    assert.equal(s.sameMove(s.hintMove, inverse), true);
    assert.equal(calls.getSwipeGuide.at(-1)[0], s.hintMove);
    assert.deepEqual(calls.drawGuide.at(-1), [s.guidanceContext, guide, 0, s.phase !== 'tutorial']);
    assert.match(s.hint, /跟随小手沿轨迹滑动，松手转层/);
    assert.equal(s.assisted, true);
    const guides = calls.drawGuide.length;
    const lookups = calls.getSwipeGuide.length;
    s.requestMove(followHint ? inverse : s.faceMove('U'));
    assert.equal(s.hintMove, null, 'accepted turn invalidates history hand immediately');
    assert.equal(s.hint, '');
    s.draw();
    completeMove(h);
    s.draw();
    assert.equal(calls.drawGuide.length, guides);
    assert.equal(calls.getSwipeGuide.length, lookups);
    assert.equal(calls.records.length, 0, 'clearing the hand must not clear assisted status');
    assert.equal(s.assisted, true);
  });
}

for (const action of ['undo', 'resetSession']) {
  test(`${action} clears history hint hand`, t => {
    const h = harness(t, { canvasReady: true });
    const { state: s, calls } = h;
    s.requestMove(s.faceMove('R'));
    completeMove(h);
    s.showHint();
    assert.notEqual(s.hintMove, null);
    assert.equal(calls.drawGuide.length, 1);
    s[action]();
    assert.equal(s.hintMove, null);
    assert.equal(s.hint, '');
    assert.equal(calls.drawGuide.length, 1);
    assert.equal(s.model.isSolved(), true);
  });
}

test('invisible targets and non-game pages never draw a guide', t => {
  const hidden = harness(t, { canvasReady: true, guideVisible: false });
  oneMoveAway(hidden);
  hidden.state.showHint();
  assert.equal(hidden.calls.getSwipeGuide.length, 1);
  assert.equal(hidden.calls.drawGuide.length, 0, 'null guide must not reach drawGuide');
  assert.match(hidden.state.hint, /看不到小手.*转动视角/);
  const h = harness(t, { canvasReady: true });
  oneMoveAway(h);
  h.state.showHint();
  for (const page of ['home', 'stats', 'settings']) {
    h.state.page = page;
    h.state.draw();
  }
  assert.equal(h.calls.getSwipeGuide.length, 1);
  assert.equal(h.calls.drawGuide.length, 1);
});

for (const kind of ['user', 'scramble', 'lessonSetup', 'lessonStep']) {
  test(`busy ${kind} animation rejects input and cannot be replaced`, t => {
    const h = harness(t);
    const { state: s } = h;
    const first = s.faceMove('R');
    const second = s.faceMove('U');
    s.animate([first, second], kind);
    const before = snapshot(s.model);
    const queue = s.queue;
    const started = s.animationAt;
    h.clock.advance(10);
    s.requestMove(s.faceMove('F'));
    s.animate([s.faceMove('B')], 'user');
    s.undo();
    s.showHint();
    assert.equal(s.activeMove, first);
    assert.equal(s.queue, queue);
    assert.equal(s.queue.length, 1);
    assert.equal(s.queue[0], second);
    assert.equal(s.queueKind, kind);
    assert.equal(s.animationAt, started);
    assert.equal(s.assisted, false);
    assert.equal(snapshot(s.model), before);
    assertQuiet(h);
  });
}

test('animate ignores empty input and owns its queue array', t => {
  const h = harness(t);
  const { state: s } = h;
  s.animate([], 'user');
  assert.equal(s.busy, false);
  assert.equal(s.activeMove, null);
  const first = s.faceMove('R');
  const second = s.faceMove('U');
  const input = [first, second];
  s.animate(input, 'user');
  input.length = 0;
  completeMove(h);
  assert.equal(s.activeMove, second);
  assert.equal(s.busy, true);
  assert.equal(s.moves, 1);
  completeMove(h);
  assert.equal(s.busy, false);
  assert.equal(s.moves, 2);
});

test('reset cancels an in-flight move and clears history, assistance, lesson and clock', t => {
  const h = harness(t);
  const { state: s } = h;
  oneMoveAway(h);
  s.showHint();
  s.requestMove(s.faceMove('U'));
  completeMove(h);
  s.lesson = [s.faceMove('F')];
  s.lessonIndex = 1;
  s.lessonTotal = 1;
  s.elapsed = 123;
  s.timeBase = 100;
  s.touching = true;
  s.requestMove(s.faceMove('B'));
  s.resetSession();
  assert.equal(snapshot(s.model), snapshot(new CubeModel(3)));
  for (const field of ['moves', 'elapsed', 'timeBase', 'startedAt', 'lessonIndex', 'lessonTotal']) {
    assert.equal(s[field], 0, field);
  }
  assert.equal(s.phase, 'idle');
  assert.equal(s.assisted, false);
  assert.equal(s.touching, false);
  assert.equal(s.busy, false);
  assert.equal(s.activeMove, null);
  assert.equal(s.queue.length, 0);
  assert.equal(s.lesson.length, 0);
  assert.equal(s.queueKind, '');
  assert.equal(s.hint, '');
  assert.equal(s.model.getSolution().length, 0);
  assert.equal(s.model.undo(), null);
  h.clock.advance(1000);
  s.frame();
  assert.equal(s.model.isSolved(), true);
  assert.equal(h.calls.records.length, 0);
  s.chooseOrder(5);
  assert.equal(s.model.order, 5);
  assert.equal(s.order, 5);
  s.leavePage();
  assert.equal(s.page, 'home');
});

test('background pauses timers and input; foreground resumes elapsed without background time', async t => {
  const h = harness(t);
  const { inverse } = oneMoveAway(h);
  const { state: s, clock, calls } = h;
  s.startTimers();
  const originalTimers = [s.frameTimer, s.clockTimer];
  assert.deepEqual([...clock.timers.values()].map(timer => timer.delay), [16, 83]);
  s.startTimers();
  assert.equal(clock.timers.size, 2, 'timer startup is idempotent');
  clock.advance(5000);
  clock.fire(s.clockTimer);
  assert.equal(s.elapsed, 0, 'ready is not timed');
  s.requestMove(inverse);
  clock.advance(100);
  clock.fire(s.frameTimer);
  clock.fire(s.clockTimer);
  assert.equal(s.elapsed, 100);
  assert.equal(s.moves, 0);
  s.touching = true;
  s.foreground = false;
  s.onForegroundChanged();
  assert.equal(s.timeBase, 100);
  assert.equal(s.elapsed, 100);
  assert.equal(s.touching, false);
  assert.equal(s.frameTimer, -1);
  assert.equal(s.clockTimer, -1);
  assert.equal(clock.timers.size, 0);
  clock.advance(60_000);
  for (const id of originalTimers) clock.fire(id);
  s.frame();
  assert.equal(s.elapsed, 100);
  assert.equal(s.moves, 0);
  assert.equal(s.activeMove, inverse);
  s.requestMove(s.faceMove('F'));
  assert.equal(s.activeMove, inverse);
  s.foreground = true;
  s.onForegroundChanged();
  assert.equal(clock.timers.size, 2);
  assert.equal(s.startedAt, clock.now());
  assert.equal(s.animationAt, clock.now());
  clock.advance(83);
  clock.fire(s.clockTimer);
  clock.fire(s.frameTimer);
  assert.equal(s.elapsed, 183);
  assert.equal(s.moves, 0);
  clock.advance(137);
  clock.fire(s.frameTimer);
  assert.equal(s.phase, 'solved');
  assert.equal(s.elapsed, 320, 'current implementation restarts the animation after resume');
  assert.equal(calls.records[0].durationMs, 320);
  await settle(h);
  clock.advance(1000);
  clock.fire(s.clockTimer);
  assert.equal(s.elapsed, 320, 'solved time is frozen');
});

test('background rejects a first move even when no animation is busy', t => {
  const h = harness(t);
  oneMoveAway(h);
  const { state: s } = h;
  const before = snapshot(s.model);
  s.foreground = false;
  s.onForegroundChanged();
  s.requestMove(s.faceMove('U'));
  assert.equal(s.phase, 'ready');
  assert.equal(s.startedAt, 0);
  assert.equal(s.busy, false);
  assert.equal(snapshot(s.model), before);
  assertQuiet(h);
});

test('free practice and continuing after solved never create another ranked solve', async t => {
  const h = harness(t);
  const { state: s, calls } = h;
  const move = s.faceMove('R');
  s.requestMove(move);
  completeMove(h);
  s.requestMove(move.inverse());
  completeMove(h);
  assert.equal(s.model.isSolved(), true);
  assert.equal(s.phase, 'idle');
  assert.equal(calls.records.length, 0);
  s.resetSession();
  const { inverse } = oneMoveAway(h);
  s.requestMove(inverse);
  completeMove(h);
  await settle(h);
  s.requestMove(move);
  assert.equal(s.phase, 'idle');
  assert.equal(s.elapsed, 0);
  assert.equal(s.timeBase, 0);
  completeMove(h);
  s.requestMove(move.inverse());
  completeMove(h);
  assert.equal(s.model.isSolved(), true);
  assert.equal(calls.records.length, 1);
});

for (const leave of [false, true]) {
  test(`save failure ${leave ? 'after leaving reports a toast' : 'while solved reports failure without unsolving'}`, async t => {
    const h = harness(t);
    const { inverse } = oneMoveAway(h);
    const { state: s } = h;
    s.requestMove(inverse);
    completeMove(h);
    if (leave) s.leavePage();
    await settle(h, 0, false);
    assert.equal(h.calls.records.length, 1);
    assert.equal(s.records.length, 0);
    if (leave) {
      assert.equal(s.phase, 'idle');
      assert.deepEqual(h.calls.toasts, ['上局成绩保存失败。']);
    } else {
      assert.equal(s.phase, 'solved');
      assert.equal(s.model.isSolved(), true);
      assert.equal(s.moves, 1);
      assert.match(s.hint, /保存失败/);
    }
  });
}

test('late successful save after reset updates records without overwriting the new hint', async t => {
  const h = harness(t);
  const { inverse } = oneMoveAway(h);
  const { state: s } = h;
  s.requestMove(inverse);
  completeMove(h);
  s.resetSession();
  oneMoveAway(h);
  const hint = s.hint;
  await settle(h);
  assert.equal(s.phase, 'ready');
  assert.equal(s.hint, hint);
  assert.equal(s.records.length, 1);
});

// Ordinary regression assertions, not skip/TODO/expected-failure wrappers:
// existing source defects stay visible until production is fixed separately.
test('REGRESSION: undo must not mutate the game while it is in the background', t => {
  const h = harness(t);
  oneMoveAway(h);
  const { state: s } = h;
  s.requestMove(s.faceMove('U'));
  completeMove(h);
  const before = snapshot(s.model);
  assert.equal(s.moves, 1);
  s.foreground = false;
  s.onForegroundChanged();
  s.undo();
  assert.equal(s.moves, 1, 'background undo must be rejected, just like requestMove');
  assert.equal(snapshot(s.model), before);
});

for (const success of [true, false]) {
  test(`REGRESSION: an old save ${success ? 'success' : 'failure'} must not replace a later assisted-solve hint`, async t => {
    const h = harness(t);
    const { state: s } = h;
    const first = oneMoveAway(h);
    s.requestMove(first.inverse);
    completeMove(h); // Keep the first session's save pending.
    s.resetSession();
    const second = oneMoveAway(h);
    s.showHint();
    s.requestMove(second.inverse);
    completeMove(h);
    assert.equal(s.phase, 'solved');
    assert.equal(s.assisted, true);
    assert.equal(h.calls.records.length, 1, 'only the first solve was submitted');
    const assistedHint = s.hint;
    assert.match(assistedHint, /不记录成绩/);
    await settle(h, 0, success);
    assert.equal(s.hint, assistedHint, 'save callbacks must belong to their originating session');
  });
}

test('teaching entry requires loaded foreground home and preserves the selected practice order', t => {
  const h = harness(t, { order: 5 });
  const { state: s } = h;
  s.leavePage();
  assert.equal(s.loaded, false, 'retain the production loading default');
  const session = s.sessionId;
  s.openTeaching();
  assert.equal(s.page, 'home');
  assert.equal(s.sessionId, session);
  s.loaded = true;
  s.foreground = false;
  s.openTeaching();
  assert.equal(s.page, 'home');
  s.foreground = true;
  for (const page of ['game', 'stats', 'settings', 'teaching']) {
    s.page = page;
    s.openTeaching();
    assert.equal(s.page, page);
    assert.equal(s.sessionId, session);
  }
  s.page = 'home';
  s.openTeaching();
  assert.equal(s.page, 'teaching');
  assert.equal(s.practiceOrder, 5);
  assert.equal(s.order, 5);
  assert.equal(s.challengeIndex, -1);
  assert.ok(s.sessionId > session);
  assert.equal(s.challenges.length, 8);
  for (const challenge of s.challenges) assert.ok(challenge instanceof TeachingChallenge);
  assert.equal(s.onBackPress(), true);
  assert.equal(s.page, 'home');
  assert.equal(s.order, 5);
  assert.equal(s.onBackPress(), false);
});

test('stale catalogue callbacks cannot enter teaching from home, ordinary practice or unrelated pages', t => {
  const h = harness(t, { order: 4 });
  const { state: s } = h;
  s.loaded = true;
  for (const page of ['home', 'game', 'stats', 'settings']) {
    s.page = page;
    const before = snapshot(s.model);
    const session = s.sessionId;
    s.startChallenge(0);
    assert.equal(s.page, page);
    assert.equal(s.challengeIndex, -1);
    assert.equal(s.order, 4);
    assert.equal(snapshot(s.model), before);
    assert.equal(s.sessionId, session);
  }
});

test('challenge entry rejects unloaded, background, busy and invalid requests without replacing a session', t => {
  const h = harness(t);
  enterTeaching(h, 1);
  const { state: s } = h;
  const before = snapshot(s.model);
  const session = s.sessionId;
  for (const index of [-1, 8, 0.5, NaN, Infinity, '0', null, undefined]) s.startChallenge(index);
  s.loaded = false;
  s.startChallenge(0);
  s.loaded = true;
  s.foreground = false;
  s.startChallenge(0);
  s.foreground = true;
  assert.equal(s.challengeIndex, 1);
  assert.equal(s.sessionId, session);
  assert.equal(snapshot(s.model), before);
  s.requestMove(s.faceMove('F'));
  const active = s.activeMove;
  s.startChallenge(0);
  assert.equal(s.challengeIndex, 1);
  assert.equal(s.activeMove, active);
  assert.equal(s.sessionId, session);
  assert.equal(snapshot(s.model), before);
  assert.equal(h.calls.teachingRecords.length, 0);
});

for (const [index, challenge] of createTeachingChallenges().entries()) {
  test(`teaching ${challenge.id} loads its fixed position ready with no animation, user steps or clock`, t => {
    const h = harness(t, { order: 5 });
    enterTeaching(h, index);
    assertChallengeReady(h, index);
    assert.equal(h.state.practiceOrder, 5);
    assert.equal(h.calls.scroll.length, 0, 'new game Scroll waits for its mount callback');
    h.state.gameAppeared();
    assert.deepEqual(h.calls.scroll, [{ xOffset: 0, yOffset: 0 }]);
    h.state.startTimers();
    h.clock.advance(30_000);
    h.clock.fire(h.state.clockTimer);
    h.clock.fire(h.state.frameTimer);
    assertChallengeReady(h, index);
    assertQuiet(h);
    assert.equal(h.calls.teachingRecords.length, 0);
    assert.equal(h.state.teachingStatus(challenge), h.state.tr('teaching_status_new'));
    assert.equal(h.state.teachingBest(challenge), '');
  });

  test(`teaching ${challenge.id} accepts unrelated free moves without advancing a prescribed lesson or passing`, t => {
    const h = harness(t);
    enterTeaching(h, index);
    const { state: s, clock, calls } = h;
    const before = snapshot(s.model);
    const wrong = s.faceMove('D');
    assert.equal(s.sameMove(wrong, s.model.getSolution()[0]), false);
    clock.advance(15_000);
    s.requestMove(wrong);
    assert.equal(s.busy, true);
    assert.equal(s.queueKind, 'user');
    assert.equal(s.phase, 'playing');
    assert.equal(s.startedAt, clock.now());
    assert.equal(snapshot(s.model), before);
    s.finishSolve();
    assert.equal(calls.teachingRecords.length, 0);
    completeMove(h);
    assert.notEqual(snapshot(s.model), before);
    assert.equal(s.model.isSolved(), false);
    assert.equal(s.moves, 1);
    assert.equal(s.model.moveCount, 1);
    assert.equal(s.lessonIndex, 0);
    assert.equal(s.lesson.length, 0);
    assert.equal(s.phase, 'playing');
    assert.equal(s.assisted, false);
    s.finishSolve();
    assert.equal(calls.teachingRecords.length, 0, 'being in playing is not sufficient to pass');
    assert.equal(calls.records.length, 0);
    assert.equal(calls.toasts.length, 0, 'free teaching moves are not rejected as wrong tutorial moves');
    assert.deepEqual(calls.feedback, [[true, true]]);
  });

  for (const speed of [0.5, 1, 2]) {
    test(`teaching ${challenge.id} passes only on the final committed real turn (${speed}x)`, async t => {
      const h = harness(t, { speed });
      enterTeaching(h, index);
      const { state: s, clock, calls } = h;
      const solution = s.model.getSolution();
      assert.equal(solution.length, challenge.referenceMoves);
      s.startTimers();
      clock.advance(9000);
      clock.fire(s.clockTimer);
      s.finishSolve();
      assert.equal(s.phase, 'ready');
      assert.equal(s.elapsed, 0);
      assert.equal(calls.teachingRecords.length, 0);
      const start = clock.now();
      for (const [step, move] of solution.entries()) {
        const before = snapshot(s.model);
        s.requestMove(move);
        assert.equal(s.startedAt, start);
        assert.equal(s.busy, true);
        assert.equal(s.moves, step);
        clock.advance(220 / speed - 1);
        s.frame();
        s.finishSolve();
        assert.equal(snapshot(s.model), before, 'no partial model commits');
        assert.equal(s.model.isSolved(), false);
        assert.equal(s.phase, 'playing');
        assert.equal(calls.teachingRecords.length, 0, 'no optimistic passing before final frame');
        clock.advance(1);
        s.frame();
        assert.equal(s.moves, step + 1);
        assert.equal(s.model.moveCount, step + 1);
        assert.equal(s.busy, false);
        assert.equal(s.activeMove, null);
        assert.equal(s.phase, step === solution.length - 1 ? 'solved' : 'playing');
        assert.equal(calls.records.length, 0, 'teaching never submits a normal solve');
      }
      assert.equal(s.model.isSolved(), true);
      assert.equal(snapshot(s.model), snapshot(new CubeModel(challenge.order)));
      assert.equal(s.elapsed, solution.length * 220 / speed);
      assert.equal(calls.feedback.length, solution.length);
      assert.equal(calls.teachingRecords.length, 1);
      const record = calls.teachingRecords[0];
      assert.equal(record.constructor.name, 'TeachingRecord');
      assert.deepEqual({ ...record }, {
        challengeId: challenge.id, durationMs: solution.length * 220 / speed,
        moves: solution.length, assisted: false, date: clock.now()
      });
      assert.equal(s.hintKey, 'teaching_saving');
      assert.equal(s.hint, s.tr('teaching_saving'));
      assert.equal(s.teachingRecords.length, 0, 'pending saves do not mark stored progress');
      assert.equal(s.teachingStatus(challenge), s.tr('teaching_status_new'));
      assert.equal(s.teachingBest(challenge), '');
      const passed = snapshot(s.model);
      for (let i = 0; i < 3; i++) {
        s.finishSolve();
        s.requestMove(s.faceMove('R'));
        s.undo();
        s.showHint();
        clock.advance(1000);
        s.frame();
        clock.fire(s.clockTimer);
      }
      assert.equal(snapshot(s.model), passed, 'passed teaching board is frozen');
      assert.equal(s.moves, solution.length);
      assert.equal(s.elapsed, solution.length * 220 / speed);
      assert.equal(s.phase, 'solved');
      assert.equal(s.busy, false);
      assert.equal(s.assisted, false);
      assert.equal(calls.feedback.length, solution.length);
      assert.equal(calls.teachingRecords.length, 1, 'finishSolve is idempotent');
      await settle(h);
      assert.equal(s.teachingRecords.length, 1);
      assert.equal(s.teachingRecords[0], record);
      assert.notEqual(s.teachingRecords, s.store.teachingRecords);
      assert.equal(s.teachingStatus(challenge), s.tr('teaching_status_solved'));
      assert.equal(s.teachingBest(challenge), s.tr('teaching_best', solution.length, s.formatTime(record.durationMs)));
      assert.equal(s.hintKey, 'teaching_saved');
      assert.equal(s.hint, s.tr('teaching_saved'));
      assert.equal(s.records.length, 0);
      assert.equal(s.bestTime(challenge.order), '—');
      assert.equal(s.orderSolves(challenge.order), 0);
    });
  }
}

test('teaching accepts three same turns instead of the reference inverse, based on real six-face state', async t => {
  const h = harness(t);
  const challenge = enterTeaching(h);
  const { state: s, calls } = h;
  const turn = challenge.setupMoves()[0];
  assert.equal(s.sameMove(turn, s.model.getSolution()[0]), false);
  solveTeaching(h, [turn, turn, turn]);
  assert.equal(s.moves, 3);
  assert.equal(s.assisted, false);
  assert.ok(s.model.getSolution().length > 0, 'an unreduced history is not the passing criterion');
  assert.equal(calls.teachingRecords.length, 1);
  assert.equal(calls.teachingRecords[0].moves, 3);
  assert.equal(calls.teachingRecords[0].assisted, false);
  assert.equal(calls.records.length, 0);
  await settle(h);
});

test('teaching hints mark guidance immediately and a real solve still saves teaching only', async t => {
  const h = harness(t, { canvasReady: true });
  const challenge = enterTeaching(h, 4);
  const { state: s, calls } = h;
  s.canvasMounted();
  const before = snapshot(s.model);
  s.showHint();
  assert.equal(s.assisted, true);
  assert.equal(s.phase, 'ready');
  assert.equal(s.startedAt, 0);
  assert.equal(s.elapsed, 0);
  assert.equal(snapshot(s.model), before);
  assert.equal(s.hintKey, 'teaching_history_hint');
  assert.equal(s.hint, s.tr('teaching_history_hint', s.moveLabel(s.hintMove)));
  assert.match(s.hint, /提示通关/);
  assert.doesNotMatch(s.hint, /不计入成绩|不记录成绩/);
  assert.equal(calls.getSwipeGuide.at(-1)[0], s.hintMove);
  solveTeaching(h);
  assert.equal(s.hintMove, null);
  assert.equal(s.assisted, true, 'clearing the hand must not clear assistance');
  assert.equal(calls.teachingRecords.length, 1);
  assert.equal(calls.teachingRecords[0].assisted, true);
  assert.equal(calls.records.length, 0);
  await settle(h);
  assert.equal(s.teachingStatus(challenge), s.tr('teaching_status_guided'));
  assert.equal(s.records.length, 0);
});

test('teaching entry, hints and completion leave existing normal statistics unchanged', async t => {
  const h = harness(t, { order: 4 });
  const { state: s, calls } = h;
  const { inverse } = oneMoveAway(h);
  s.requestMove(inverse);
  completeMove(h);
  await settle(h);
  const ranked = s.records[0];
  enterTeaching(h);
  s.showHint();
  solveTeaching(h);
  await settle(h, 1);
  assert.equal(s.records.length, 1);
  assert.equal(s.records[0], ranked);
  assert.equal(s.store.records[0], ranked);
  assert.equal(calls.records.length, 1);
  assert.equal(calls.teachingRecords.length, 1);
  assert.equal(s.orderSolves(4), 1);
  assert.equal(s.bestTime(4), '00:00.22');
  for (const order of [2, 3, 5]) {
    assert.equal(s.orderSolves(order), 0);
    assert.equal(s.bestTime(order), '—');
  }
});

test('retry reloads the exact baseline and clears timer, counters, hint, assistance, history and pending gesture', t => {
  const h = harness(t, { order: 5, canvasReady: true });
  enterTeaching(h, 2);
  const { state: s, clock, calls } = h;
  s.canvasMounted();
  s.requestMove(s.faceMove('D'));
  completeMove(h);
  clock.advance(800);
  s.foreground = false;
  s.onForegroundChanged();
  assert.equal(s.timeBase, 1020);
  clock.advance(50_000);
  s.foreground = true;
  s.onForegroundChanged();
  s.showHint();
  assert.equal(s.assisted, true);
  s.yaw = 1.3;
  s.pitch = 0.8;
  s.retryChallenge();
  const session = s.sessionId;
  const before = snapshot(s.model);
  assert.equal(calls.dialogs.length, 1);
  assert.equal(calls.dialogs[0].title, s.tr('teaching_retry_title'));
  assert.equal(calls.dialogs[0].message, s.tr('teaching_retry_message'));
  assert.equal(snapshot(s.model), before, 'opening retry does not mutate the challenge');
  touch(h, TouchType.Down);
  assert.equal(s.touching, true);
  calls.dialogs[0].secondaryButton.action();
  assert.ok(s.sessionId > session);
  assert.equal(s.canvasReady, true, 'same game page retains its ready canvas');
  assert.deepEqual(calls.scroll, [{ xOffset: 0, yOffset: 0 }], 'retry reveals the restored position and goal');
  assert.equal(s.practiceOrder, 5);
  assertChallengeReady(h, 2);
  assert.equal(s.model.redo(), null);
  assert.equal(s.downModel, null);
  touch(h, TouchType.Move, 180, 120);
  touch(h, TouchType.Up, 180, 120);
  clock.advance(10_000);
  clock.fire(s.clockTimer);
  s.frame();
  assertChallengeReady(h, 2);
  assert.equal(calls.teachingRecords.length, 0);
  assert.equal(calls.records.length, 0);
});

test('retry confirmation cancels and rejects busy, background and stale actions', t => {
  const h = harness(t);
  enterTeaching(h, 1);
  const { state: s, calls } = h;
  s.requestMove(s.faceMove('D'));
  completeMove(h);
  s.showHint();
  const before = snapshot(s.model);
  const session = s.sessionId;
  const hint = s.hint;
  s.retryChallenge();
  calls.dialogs[0].primaryButton.action();
  assert.equal(snapshot(s.model), before);
  assert.equal(s.sessionId, session);
  assert.equal(s.hint, hint);
  assert.equal(s.assisted, true);
  s.retryChallenge();
  const confirm = calls.dialogs[1].secondaryButton.action;
  s.requestMove(s.faceMove('F'));
  const active = s.activeMove;
  confirm();
  s.retryChallenge();
  assert.equal(s.activeMove, active);
  assert.equal(s.sessionId, session);
  assert.equal(calls.dialogs.length, 2);
  completeMove(h);
  const afterMove = snapshot(s.model);
  s.foreground = false;
  confirm();
  s.retryChallenge();
  assert.equal(snapshot(s.model), afterMove);
  assert.equal(s.sessionId, session);
  assert.equal(calls.dialogs.length, 2);
  s.foreground = true;
  s.startChallenge(3);
  confirm();
  assertChallengeReady(h, 3);
  s.leaveChallenge();
  const catalogueSession = s.sessionId;
  confirm();
  s.retryChallenge();
  assert.equal(s.page, 'teaching');
  assert.equal(s.sessionId, catalogueSession);
});

test('ready and solved retry do not ask to discard progress and preserve saved achievements', async t => {
  const h = harness(t);
  const challenge = enterTeaching(h);
  const { state: s, calls } = h;
  const initialSession = s.sessionId;
  s.retryChallenge();
  assertChallengeReady(h, 0);
  assert.ok(s.sessionId > initialSession);
  solveTeaching(h);
  await settle(h);
  const record = s.teachingRecords[0];
  s.retryChallenge();
  assertChallengeReady(h, 0);
  assert.equal(calls.dialogs.length, 0);
  assert.equal(s.teachingRecords[0], record);
  assert.equal(s.teachingStatus(challenge), s.tr('teaching_status_solved'));
});

for (const phase of ['ready', 'playing', 'solved']) {
  test(`legacy scramble, tutorial and automated reset are blocked in teaching ${phase}`, t => {
    const h = harness(t);
    enterTeaching(h);
    const { state: s, calls } = h;
    if (phase === 'playing') {
      s.requestMove(s.faceMove('D'));
      completeMove(h);
    } else if (phase === 'solved') solveTeaching(h);
    const before = snapshot(s.model);
    const session = s.sessionId;
    const hint = s.hint;
    const moves = s.moves;
    for (const action of ['scramble', 'doScramble', 'startLesson', 'doLesson', 'confirmReset', 'resetStepByStep']) {
      s[action]();
      assert.equal(snapshot(s.model), before, action);
      assert.equal(s.sessionId, session, action);
      assert.equal(s.challengeIndex, 0, action);
      assert.equal(s.phase, phase, action);
      assert.equal(s.hint, hint, action);
      assert.equal(s.moves, moves, action);
      assert.equal(s.busy, false, action);
      assert.equal(s.queue.length, 0, action);
      assert.equal(s.lesson.length, 0, action);
    }
    assert.equal(calls.dialogs.length, 0);
  });
}

test('next requires an actually passed challenge, ignores background input and returns the last level to catalogue', t => {
  const h = harness(t, { order: 5 });
  enterTeaching(h);
  const { state: s, clock, calls } = h;
  const session = s.sessionId;
  s.nextChallenge();
  assert.equal(s.sessionId, session);
  assertChallengeReady(h, 0);
  s.requestMove(s.model.getSolution()[0]);
  s.nextChallenge();
  assert.equal(s.challengeIndex, 0);
  assert.equal(s.busy, true);
  completeMove(h, 219);
  s.nextChallenge();
  assert.equal(s.challengeIndex, 0);
  completeMove(h, 1);
  s.foreground = false;
  s.nextChallenge();
  assert.equal(s.challengeIndex, 0);
  assert.equal(s.phase, 'solved');
  s.foreground = true;
  s.nextChallenge();
  assertChallengeReady(h, 1);
  assert.deepEqual(calls.scroll, [{ xOffset: 0, yOffset: 0 }], 'next reveals the new position and goal');
  assert.equal(s.practiceOrder, 5);
  s.startChallenge(s.challenges.length - 1);
  solveTeaching(h);
  assert.equal(calls.teachingRecords.length, 2);
  s.nextChallenge();
  assert.equal(s.page, 'teaching');
  assert.equal(s.challengeIndex, -1);
  assert.equal(s.order, 5);
  assert.equal(s.model.order, 5);
  assert.equal(s.model.isSolved(), true);
  assert.equal(s.cubeZoom, 1);
  const catalogueSession = s.sessionId;
  clock.advance(1000);
  s.nextChallenge();
  assert.equal(s.sessionId, catalogueSession);
  assert.equal(s.page, 'teaching');
});

for (const practiceOrder of [2, 3, 4, 5]) {
  test(`teaching back hierarchy restores ${practiceOrder}x${practiceOrder} and cancels in-flight turns only after confirmation`, t => {
    const h = harness(t, { order: practiceOrder });
    enterTeaching(h, 4);
    const { state: s, calls, clock } = h;
    s.requestMove(s.faceMove('D'));
    clock.advance(100);
    s.frame();
    const before = snapshot(s.model);
    const active = s.activeMove;
    const session = s.sessionId;
    assert.equal(s.onBackPress(), true);
    assert.equal(calls.dialogs[0].title, s.tr('teaching_leave_title'));
    assert.equal(calls.dialogs[0].message, s.tr('teaching_leave_message'));
    calls.dialogs[0].primaryButton.action();
    assert.equal(s.page, 'game');
    assert.equal(s.sessionId, session);
    assert.equal(s.activeMove, active);
    assert.equal(snapshot(s.model), before);
    assert.equal(s.onBackPress(), true);
    calls.dialogs[1].secondaryButton.action();
    assert.equal(s.page, 'teaching');
    assert.equal(s.order, practiceOrder);
    assert.equal(s.model.order, practiceOrder);
    assert.equal(s.challengeIndex, -1);
    assert.equal(s.phase, 'idle');
    assert.equal(s.busy, false);
    assert.equal(s.activeMove, null);
    assert.equal(s.queue.length, 0);
    assert.equal(s.moves, 0);
    assert.equal(s.startedAt, 0);
    assert.equal(s.elapsed, 0);
    assert.equal(s.canvasReady, false);
    const left = snapshot(s.model);
    clock.advance(1000);
    s.frame();
    assert.equal(snapshot(s.model), left, 'canceled animation cannot commit after departure');
    assert.equal(s.onBackPress(), true);
    assert.equal(s.page, 'home');
    assert.equal(s.order, practiceOrder);
    assert.equal(s.model.order, practiceOrder);
    assert.equal(s.onBackPress(), false);
    assert.equal(calls.dialogs.length, 2);
    assert.equal(calls.teachingRecords.length, 0);
    assert.equal(calls.records.length, 0);
  });
}

test('leave confirmation ignores background and stale callbacks without destroying a new challenge', t => {
  const h = harness(t);
  enterTeaching(h, 1);
  const { state: s, calls } = h;
  s.requestMove(s.faceMove('D'));
  completeMove(h);
  s.goHome();
  const confirm = calls.dialogs[0].secondaryButton.action;
  const before = snapshot(s.model);
  s.foreground = false;
  confirm();
  assert.equal(s.page, 'game');
  assert.equal(snapshot(s.model), before);
  s.foreground = true;
  s.startChallenge(2);
  confirm();
  assertChallengeReady(h, 2);
  s.goHome();
  assert.equal(s.page, 'teaching', 'ready challenge can leave without confirmation');
  confirm();
  assert.equal(s.page, 'teaching');
  assert.equal(calls.dialogs.length, 1);
});

for (const destination of ['retry', 'next', 'catalogue', 'home']) {
  test(`late teaching save success updates progress without replacing the ${destination} session or hint`, async t => {
    const h = harness(t, { order: 4 });
    const challenge = enterTeaching(h);
    const { state: s, calls } = h;
    solveTeaching(h);
    const oldSession = s.sessionId;
    if (destination === 'retry') s.retryChallenge();
    else if (destination === 'next') s.nextChallenge();
    else {
      s.goHome();
      if (destination === 'home') s.goHome();
    }
    const hint = s.hint;
    const hintKey = s.hintKey;
    const phase = s.phase;
    const page = s.page;
    const before = snapshot(s.model);
    assert.ok(s.sessionId > oldSession);
    await settle(h);
    assert.equal(s.teachingRecords.length, 1);
    assert.equal(s.teachingRecords[0], calls.teachingRecords[0]);
    assert.notEqual(s.teachingRecords, s.store.teachingRecords);
    assert.equal(s.teachingStatus(challenge), s.tr('teaching_status_solved'));
    assert.equal(s.hint, hint);
    assert.equal(s.hintKey, hintKey);
    assert.equal(s.phase, phase);
    assert.equal(s.page, page);
    assert.equal(snapshot(s.model), before);
    assert.equal(s.records.length, 0);
    assert.equal(calls.toasts.length, 0);
  });
}

for (const success of [true, false]) {
  test(`late teaching save ${success ? 'success' : 'failure'} cannot overwrite a newer solved guided attempt`, async t => {
    const h = harness(t);
    const first = enterTeaching(h);
    const { state: s, calls } = h;
    solveTeaching(h);
    s.nextChallenge();
    const second = s.challenges[1];
    s.showHint();
    solveTeaching(h);
    assert.equal(s.assisted, true);
    assert.equal(calls.pending.length, 2);
    const hint = s.hint;
    await settle(h, 0, success);
    assert.equal(s.hint, hint);
    assert.equal(s.hintKey, 'teaching_saving');
    assert.equal(s.phase, 'solved');
    assert.equal(s.challengeIndex, 1);
    assert.equal(s.teachingStatus(first), s.tr(success ? 'teaching_status_solved' : 'teaching_status_new'));
    assert.equal(s.teachingStatus(second), s.tr('teaching_status_new'));
    if (!success) assert.deepEqual(calls.toasts, [s.tr('teaching_previous_save_failed')]);
    await settle(h, 1);
    assert.equal(s.teachingStatus(second), s.tr('teaching_status_guided'));
    assert.equal(s.hintKey, 'teaching_saved');
    assert.equal(calls.records.length, 0);
  });
}

for (const leave of [false, true]) {
  test(`failed teaching save ${leave ? 'after leaving' : 'while passed'} never marks unsaved progress`, async t => {
    const h = harness(t);
    const challenge = enterTeaching(h);
    const { state: s, calls } = h;
    solveTeaching(h);
    const passed = snapshot(s.model);
    if (leave) s.goHome();
    const hint = s.hint;
    await settle(h, 0, false);
    assert.equal(s.teachingRecords.length, 0);
    assert.equal(s.store.teachingRecords.length, 0);
    assert.equal(s.teachingStatus(challenge), s.tr('teaching_status_new'));
    assert.equal(s.teachingBest(challenge), '');
    assert.equal(calls.teachingRecords.length, 1);
    assert.equal(calls.records.length, 0);
    if (leave) {
      assert.equal(s.page, 'teaching');
      assert.equal(s.hint, hint);
      assert.deepEqual(calls.toasts, [s.tr('teaching_previous_save_failed')]);
    } else {
      assert.equal(s.phase, 'solved');
      assert.equal(snapshot(s.model), passed);
      assert.equal(s.moves, 1);
      assert.equal(s.hintKey, 'teaching_save_failed');
      assert.equal(s.hint, s.tr('teaching_save_failed'));
      assert.match(s.hint, /本关已完成.*未能保存/);
      assert.equal(calls.toasts.length, 0);
    }
  });
}

test('loadData restores teaching progress separately from normal results and does not unlock a session', async t => {
  const h = harness(t);
  const challenge = enterTeaching(h);
  const { state: s } = h;
  solveTeaching(h);
  await settle(h);
  const record = s.teachingRecords[0];
  s.leavePage();
  s.teachingRecords = [];
  s.store.settings = { defaultOrder: 5, speed: 1, sound: true, haptics: true, beginnerGuides: true };
  await s.loadData();
  assert.equal(s.loaded, true);
  assert.equal(s.storageWarning, '');
  assert.equal(s.order, 5);
  assert.equal(s.page, 'home');
  assert.equal(s.challengeIndex, -1);
  assert.equal(s.teachingRecords[0], record);
  assert.notEqual(s.teachingRecords, s.store.teachingRecords);
  assert.equal(s.teachingStatus(challenge), s.tr('teaching_status_solved'));
  assert.equal(s.records.length, 0);
});

test('teaching pauses in background and resumes without background time or duplicate turn commits', async t => {
  const h = harness(t);
  enterTeaching(h);
  const { state: s, calls, clock } = h;
  const before = snapshot(s.model);
  s.startTimers();
  clock.advance(8000);
  clock.fire(s.clockTimer);
  assert.equal(s.elapsed, 0);
  s.requestMove(s.model.getSolution()[0]);
  const active = s.activeMove;
  clock.advance(100);
  clock.fire(s.frameTimer);
  clock.fire(s.clockTimer);
  assert.equal(s.elapsed, 100);
  touch(h, TouchType.Down);
  s.foreground = false;
  s.onForegroundChanged();
  assert.equal(s.touching, false);
  assert.equal(clock.timers.size, 0);
  assert.equal(s.timeBase, 100);
  clock.advance(60_000);
  s.frame();
  s.finishSolve();
  s.requestMove(s.faceMove('D'));
  s.undo();
  s.showHint();
  s.retryChallenge();
  assert.equal(s.activeMove, active);
  assert.equal(snapshot(s.model), before);
  assert.equal(s.elapsed, 100);
  assert.equal(s.moves, 0);
  assert.equal(calls.teachingRecords.length, 0);
  s.foreground = true;
  s.onForegroundChanged();
  assert.equal(clock.timers.size, 2);
  completeMove(h, 219);
  assert.equal(snapshot(s.model), before);
  assert.equal(calls.teachingRecords.length, 0);
  completeMove(h, 1);
  assert.equal(s.model.isSolved(), true);
  assert.equal(s.phase, 'solved');
  assert.equal(s.moves, 1);
  assert.equal(s.elapsed, 320, 'resume restarts the partial animation but excludes background time');
  assert.equal(calls.feedback.length, 1);
  assert.equal(calls.teachingRecords.length, 1);
  assert.equal(calls.teachingRecords[0].durationMs, 320);
  await settle(h);
  s.finishSolve();
  clock.advance(1000);
  clock.fire(s.clockTimer);
  s.frame();
  assert.equal(s.elapsed, 320);
  assert.equal(calls.teachingRecords.length, 1);
  assert.equal(calls.records.length, 0);
});

test('passed teaching board supports view inspection without layer moves or beginner turn guidance', async t => {
  const h = harness(t, { canvasReady: true });
  enterTeaching(h);
  const { state: s, calls } = h;
  s.canvasMounted();
  solveTeaching(h);
  await settle(h);
  const before = snapshot(s.model);
  const corners = calls.drawBeginnerGuides.length;
  const feedback = calls.feedback.length;
  s.draw();
  touch(h, TouchType.Down);
  assert.equal(s.orbiting, true, 'a passed cube hit begins view inspection, not a layer gesture');
  touch(h, TouchType.Move, 140, 120);
  touch(h, TouchType.Up, 160, 130);
  assert.ok(Math.abs(s.yaw - (0.62 - 60 * 0.009)) < 1e-12);
  assert.ok(Math.abs(s.pitch - (-0.42 - 30 * 0.009)) < 1e-12);
  assert.equal(snapshot(s.model), before);
  assert.equal(s.phase, 'solved');
  assert.equal(s.moves, 1);
  assert.equal(s.busy, false);
  assert.equal(calls.feedback.length, feedback);
  assert.equal(calls.drawBeginnerGuides.length, corners, 'never suggest turning layers after passing');
  assert.equal(calls.teachingRecords.length, 1);
});

for (const first of ['base', 'guidance']) {
  test(`layer readiness ${first}-first waits for both canvases and matching logical dimensions`, t => {
    const h = harness(t, { canvasReady: true });
    const { state: s, calls } = h;
    showTarget(h, 'history');
    s.canvasDisappeared();
    s.guidanceDisappeared();
    const draws = calls.draw.length;
    const hands = calls.drawGuide.length;
    s[first === 'base' ? 'canvasMounted' : 'guidanceMounted']();
    assert.equal(calls.drawGuide.length, hands, 'no guide before both layers are ready');
    s[first === 'base' ? 'guidanceMounted' : 'canvasMounted']();
    assert.equal(calls.draw.length, draws + 1, 'only mounting the base renders cube geometry');
    assert.equal(calls.drawGuide.length, hands + 1);
    assert.equal(calls.drawGuide.at(-1)[0], s.guidanceContext);
    assert.notEqual(s.context2d, s.guidanceContext);

    const area = { width: 380, height: 310 };
    const beforeResize = calls.drawGuide.length;
    if (first === 'base') s.canvasResized(area); else s.guidanceResized(area);
    assert.equal(calls.drawGuide.length, beforeResize, 'mismatched sizes cannot draw stale coordinates');
    if (first === 'base') s.guidanceResized(area); else s.canvasResized(area);
    assert.equal(calls.drawGuide.length, beforeResize + 1);
    assert.deepEqual(s.guidanceContext.clears.at(-1), [0, 0, area.width, area.height]);
    assert.deepEqual(calls.draw.at(-1).slice(1, 3), [area.width, area.height]);
    assert.ok(calls.draw.every(args => args[0] === s.context2d));
    assert.ok(calls.drawGuide.every(args => args[0] === s.guidanceContext));
    assert.ok(calls.drawBeginnerGuides.every(args => args[0] === s.guidanceContext));
  });
}

test('overlay cleanup on busy, background, unmount and no target never clears or redraws the base', t => {
  const h = harness(t, { canvasReady: true });
  const { state: s, calls } = h;
  showTarget(h, 'history');
  const draws = calls.draw.length;
  const hands = calls.drawGuide.length;
  const clears = s.guidanceContext.clears.length;
  s.animate([s.faceMove('U')], 'user');
  assert.equal(calls.draw.length, draws);
  assert.equal(calls.drawGuide.length, hands);
  assert.ok(s.guidanceContext.clears.length > clears, 'busy immediately erases old guidance');
  s.foreground = false;
  s.onForegroundChanged();
  s.guidanceDisappeared();
  assert.equal(s.guidanceReady, false);
  s.drawGuidance();
  assert.equal(calls.drawGuide.length, hands);
  assert.equal(calls.draw.length, draws);
  assert.equal(s.context2d.clears.length, 0, 'guidance never clears the base context');
  s.foreground = true;
  s.busy = false;
  s.activeMove = null;
  s.hintMove = null;
  s.beginnerGuides = false;
  s.guidanceMounted();
  assert.equal(calls.drawGuide.length, hands);
  assert.equal(calls.draw.length, draws);
  s.beginnerGuides = true;
  s.drawGuidance();
  assert.equal(calls.drawBeginnerGuides.at(-1)[0], s.guidanceContext);
});
