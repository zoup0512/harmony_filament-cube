import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { Script } from 'node:vm';
import { CubeModel, CubeMove } from '../entry/src/main/ets/model/CubeModel.ts';

// Run with Node 24: node --test tests/cube-game.test.mjs
// Extract production members verbatim, not a second implementation of the game.
// The member-indent boundary is intentional (as in cube-touch.test.mjs): source
// layout changes must fail extraction rather than silently use fallback logic.
const pageUrl = new URL('../entry/src/main/ets/pages/Index.ets', import.meta.url);
const source = readFileSync(pageUrl, 'utf8');
const names = [
  'startTimers', 'stopTimers', 'onForegroundChanged', 'draw', 'frame', 'animate',
  'resetSession', 'chooseOrder', 'startGame', 'leavePage', 'doScramble',
  'faceMove', 'moveLabel', 'sameMove', 'requestMove', 'undo', 'showHint',
  'doLesson', 'updateLessonHint', 'invalidateGesture', 'finishSolve', 'toast'
];
const members = names.map(name => {
  const matches = [...source.matchAll(new RegExp(
    `^  private ${name}\\([^\\r\\n]*\\)[^\\r\\n]*\\{\\r?\\n[\\s\\S]*?^  \\}`, 'gm'))];
  assert.equal(matches.length, 1, `Index.ets must contain exactly one ${name} method`);
  return matches[0][0];
});
// Preserve real field defaults, stripping only ArkUI decorators; platform
// constructors below are inert mocks. Only guide tests opt into a ready canvas.
const fields = source.match(/^struct Index \{\r?\n([\s\S]*?)(?=^  aboutToAppear\()/m);
assert.ok(fields, 'Index.ets field declarations must be extractable');
const declarations = fields[1].replace(/@\w+(?:\([^\r\n)]*\))?\s*/g, '');
const storeSource = readFileSync(new URL('../entry/src/main/ets/storage/CubeStore.ets', import.meta.url), 'utf8');
const recordClasses = [...storeSource.matchAll(/^export class SolveRecord \{\r?\n[\s\S]*?^\}/gm)];
assert.equal(recordClasses.length, 1, 'use the real SolveRecord value object');
const executable = stripTypeScriptTypes([
  recordClasses[0][0].replace(/^export /, ''),
  `class GameHarness {\n${declarations}\n${members.join('\n')}\n}`,
  'GameHarness;'
].join('\n'));
const script = new Script(executable, { filename: pageUrl.pathname });

function seededRandom() {
  let seed = 123456789;
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function harness(t, { order = 3, speed = 1, canvasReady = false, guideVisible = true } = {}) {
  let now = 1_000_000;
  let nextTimer = 0;
  const timers = new Map();
  const calls = { draw: [], getSwipeGuide: [], drawGuide: [], feedback: [], records: [], pending: [], toasts: [] };
  const guide = guideVisible ? { startX: 100, startY: 120, endX: 150, endY: 140 } : null;
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  class MockStore {
    records = [];
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
  }
  const GameHarness = script.runInNewContext({
    CubeModel, CubeMove, Date: FakeDate, CubeStore: MockStore,
    CubeRenderer: class {
      draw(...args) { calls.draw.push(args); }
      getSwipeGuide(...args) { calls.getSwipeGuide.push(args); return guide; }
      drawGuide(...args) { calls.drawGuide.push(args); }
    },
    CubeFeedback: class { play(...args) { calls.feedback.push(args); } },
    CanvasRenderingContext2D: class {}, RenderingContextSettings: class {},
    setInterval(callback, delay) {
      const id = nextTimer++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearInterval(id) { timers.delete(id); }
  });
  const state = new GameHarness();
  state.model = new CubeModel(order, seededRandom());
  state.order = order;
  state.speed = speed;
  state.getUIContext = () => ({
    getPromptAction: () => ({ showToast: ({ message }) => calls.toasts.push(message) })
  });
  state.startGame();
  state.canvasReady = canvasReady;
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
    }
  });
  return { state, calls, clock, guide };
}

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

async function settle(h, index = 0, success = true) {
  assert.ok(h.calls.pending[index], 'a persistence request must actually exist');
  h.calls.pending[index][success ? 'resolve' : 'reject']();
  // Drain the production .then(...).catch(...) chain without real timers.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

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
    assert.deepEqual(calls.feedback, [[false, true]]);
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
  assert.match(s.hint, /历史回退参考：R'/);
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
    assert.ok(hint.includes(`沿箭头滑动完成 ${labels[i]}`));
    assert.match(hint, /从圆点滑向箭头/);
    assert.match(hint, /松手转层/);
    assert.match(hint, /看不到箭头.*转动视角/);
    assert.doesNotMatch(hint, /按钮|高亮/);
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
      assert.match(calls.toasts.at(-1), /从箭头圆点沿箭头滑动.*当前教程步骤/);
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

test('ready canvas draws the current lesson arrow and hides it throughout animation', t => {
  const h = harness(t, { canvasReady: true });
  const { state: s, calls, guide } = h;
  s.doLesson();
  for (let i = 0; i < 4; i++) completeMove(h, 65);
  assert.equal(calls.getSwipeGuide.length, 0, 'setup animation has no arrow');
  assert.equal(calls.drawGuide.length, 0);
  completeMove(h, 65);
  for (let i = 0; i < s.lessonTotal; i++) {
    assert.equal(s.lessonIndex, i);
    assert.equal(calls.getSwipeGuide.at(-1)[0], s.lesson[i]);
    assert.deepEqual(calls.drawGuide.at(-1), [s.context2d, guide]);
    const guides = calls.drawGuide.length;
    const lookups = calls.getSwipeGuide.length;
    s.requestMove(s.lesson[i]);
    s.draw();
    completeMove(h, 219);
    assert.equal(calls.drawGuide.length, guides, 'busy moves must not draw stale arrows');
    assert.equal(calls.getSwipeGuide.length, lookups);
    completeMove(h, 1);
    assert.equal(calls.drawGuide.length, guides + (i < s.lessonTotal - 1 ? 1 : 0));
  }
  assert.equal(s.phase, 'idle');
  const guides = calls.drawGuide.length;
  s.draw();
  assert.equal(calls.drawGuide.length, guides, 'completed tutorial has no arrow');
  assert.ok(calls.draw.length > 0);
  const draw = calls.draw.at(-1);
  assert.deepEqual(draw, [s.context2d, s.canvasWidth, s.canvasHeight, s.model, s.yaw, s.pitch, null, 0]);
});

for (const followHint of [true, false]) {
  test(`history arrow clears when turning ${followHint ? 'the suggested' : 'a different'} layer`, t => {
    const h = harness(t, { canvasReady: true });
    const { inverse } = oneMoveAway(h);
    const { state: s, calls, guide } = h;
    s.showHint();
    assert.equal(s.sameMove(s.hintMove, inverse), true);
    assert.equal(calls.getSwipeGuide.at(-1)[0], s.hintMove);
    assert.deepEqual(calls.drawGuide.at(-1), [s.context2d, guide]);
    assert.match(s.hint, /沿箭头滑动/);
    assert.equal(s.assisted, true);
    const guides = calls.drawGuide.length;
    const lookups = calls.getSwipeGuide.length;
    s.requestMove(followHint ? inverse : s.faceMove('U'));
    assert.equal(s.hintMove, null, 'accepted turn invalidates history arrow immediately');
    assert.equal(s.hint, '');
    s.draw();
    completeMove(h);
    s.draw();
    assert.equal(calls.drawGuide.length, guides);
    assert.equal(calls.getSwipeGuide.length, lookups);
    assert.equal(calls.records.length, 0, 'clearing the arrow must not clear assisted status');
    assert.equal(s.assisted, true);
  });
}

for (const action of ['undo', 'resetSession']) {
  test(`${action} clears history hint arrow`, t => {
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
  assert.match(hidden.state.hint, /看不到箭头.*转动视角/);
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
