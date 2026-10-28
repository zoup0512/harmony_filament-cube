import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { CubeModel, CubeMove } from '../entry/src/main/ets/model/CubeModel.ts';
import { resourceManager } from './resource-helper.mjs';
import { TeachingChallenge, createTeachingChallenges } from './teaching-helper.mjs';

const resultSource = readFileSync(new URL('../entry/src/main/ets/model/SolveResult.ets', import.meta.url), 'utf8');
const { SolveResult } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(
  resultSource.replace(/^@Observed\r?\n/m, '')
)).toString('base64')}`);

const sourceUrl = new URL('../entry/src/main/ets/pages/Index.ets', import.meta.url);
const source = readFileSync(sourceUrl, 'utf8');
// Execute production methods AND field initializers, not a parallel state machine.
function member(name) {
  const matches = [...source.matchAll(new RegExp(
    `^  (?:private )?${name}\\([^\\r\\n]*\\)[^\\r\\n]*\\{\\r?\\n[\\s\\S]*?^  \\}`, 'gm'))];
  assert.equal(matches.length, 1, `exactly one real ${name} method must be extractable`);
  return matches[0][0];
}
const names = ['touch', 'invalidateGesture', 'layerGestureCurrent', 'setTouchOrigin',
  'moveOrbit', 'judgeScrollGesture', 'animate', 'resetSession', 'onForegroundChanged',
  'undo', 'aboutToDisappear', 'guideTarget', 'resetGuide', 'clearGuidance', 'tr', 'setHint', 'toast',
  'openTeaching', 'startChallenge', 'retryChallenge', 'leaveChallenge', 'nextChallenge', 'leavePage', 'goHome',
  'closeSolveResult'];
const fields = source.match(/^struct Index \{\r?\n([\s\S]*?)(?=^  aboutToAppear\()/m);
assert.ok(fields, 'production field defaults must be extractable');
const declarations = fields[1].replace(/@\w+(?:\([^\r\n)]*\))?\s*/g, '');
const executable = stripTypeScriptTypes(`class TouchHarness {\n${declarations}\n${names.map(member).join('\n')}\n}\nTouchHarness;`);
const TouchType = Object.freeze({ Down: 0, Up: 1, Move: 2, Cancel: 3 });
const GestureJudgeResult = Object.freeze({ CONTINUE: 0, REJECT: 1 });
const GestureControl = Object.freeze({ GestureType: { PAN_GESTURE: 2, TAP_GESTURE: 0 } });
const TouchHarness = runInNewContext(executable, {
  TouchType, GestureJudgeResult, GestureControl, CubeModel, SolveResult, TeachingChallenge, createTeachingChallenges,
  CubeRenderer: class {}, CubeStore: class {}, CubeFeedback: class {},
  CanvasRenderingContext2D: class {}, RenderingContextSettings: class {},
  Scroller: class { scrollTo() {} }
}, { filename: sourceUrl.pathname });

function point(id, x, y) {
  return { id, x, y, windowX: x + 400, windowY: y + 600, screenX: x + 800, screenY: y + 1000 };
}
function harness({ hit = true, busy = false, page = 'game', pickedMove = new CubeMove('x', 1, 1) } = {}) {
  const calls = { hitTest: [], pickMove: [], requestMove: [], draw: [], guidance: [], timers: [], release: [], dialogs: [] };
  const state = Object.assign(new TouchHarness(), {
    page, busy, moves: 7,
    getUIContext: () => ({
      getHostContext: () => ({ resourceManager: resourceManager() }),
      showAlertDialog: dialog => calls.dialogs.push(dialog)
    }),
    renderer: {
      hitTest(...args) { calls.hitTest.push(args); return hit; },
      pickMove(...args) { calls.pickMove.push(args); return pickedMove; }
    },
    // Leave busy unchanged so duplicate submissions cannot hide behind a mock.
    requestMove(...args) { calls.requestMove.push(args); },
    draw(...args) { calls.draw.push(args); },
    drawGuidance(...args) { calls.guidance.push(args); },
    startTimers() { calls.timers.push('start'); },
    stopTimers() { calls.timers.push('stop'); },
    feedback: { release() { calls.release.push(true); } }
  });
  for (let i = 0; i < 7; i++) state.model.applyMove(new CubeMove('x', 1, 1), true);
  return { state, calls, pickedMove,
    send(type, touches = [], changedTouches = []) { state.touch({ type, touches, changedTouches }); }
  };
}
function assertNoMove(h) {
  assert.equal(h.calls.pickMove.length, 0, 'must not resolve a layer');
  assert.equal(h.calls.requestMove.length, 0, 'must not submit a layer');
}
function assertReleased(h) {
  assert.equal(h.state.touching, false);
  assert.equal(h.state.pointerCount, 0);
  assert.equal(h.state.orbiting, false);
}
function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
}
function start(h, x = 100, y = 100) {
  const p = point(42, x, y);
  h.send(TouchType.Down, [p], [p]);
  return p;
}
function up(h, x = 160, y = 120) {
  const p = point(42, x, y);
  h.send(TouchType.Up, [{ ...p }], [p]);
}
function assertView(h, yaw = 0.62, pitch = -0.42) {
  near(h.state.yaw, yaw);
  near(h.state.pitch, pitch);
}

for (const inclusive of [true, false]) {
  test(`layer Up (${inclusive ? 'inclusive' : 'empty'} touches) filters changed IDs and commits once`, () => {
    const h = harness();
    start(h, 31, 47);
    h.send(TouchType.Move, [point(42, 59, 62)]);
    assert.equal(h.calls.pickMove.length, 0);
    assert.deepEqual(h.calls.hitTest, [[31, 47]]);
    const end = point(42, 91, 83);
    h.send(TouchType.Up, inclusive ? [{ ...end }] : [], [end]);
    assert.deepEqual(h.calls.pickMove, [[31, 47, 91, 83, h.state.model, 0.62, -0.42]]);
    assert.deepEqual(h.calls.requestMove, [[h.pickedMove]]);
    assertReleased(h);
    h.send(TouchType.Up, inclusive ? [{ ...end }] : [], [end]);
    assert.equal(h.calls.requestMove.length, 1);
    assert.equal(h.calls.draw.length, 0);
  });
}
for (const [dx, dy, commits] of [[0, 0, false], [23.99, 0, false], [0, -23.99, false],
  [16, 16, false], [24, 0, true], [0, -24, true], [18, 18, true]]) {
  test(`layer release threshold (${dx}, ${dy}) => ${commits}`, () => {
    const h = harness();
    start(h);
    up(h, 100 + dx, 100 + dy);
    assert.equal(h.calls.requestMove.length, Number(commits));
    assertView(h);
    assertReleased(h);
  });
}
test('renderer can reject an otherwise valid layer', () => {
  const h = harness({ pickedMove: null });
  start(h);
  up(h);
  assert.equal(h.calls.pickMove.length, 1);
  assert.equal(h.calls.requestMove.length, 0);
});
for (const [dx, dy] of [[60, 30], [-60, -30], [0, 30], [30, 0]]) {
  test(`orbit subtracts screen drag (${dx}, ${dy}) for inverse-camera rotations`, () => {
    const h = harness({ hit: false });
    start(h);
    h.send(TouchType.Move, [point(42, 100 + dx, 100 + dy)]);
    assertView(h, 0.62 - dx * 0.009, -0.42 - dy * 0.009);
    up(h, 100 + dx, 100 + dy);
    assertNoMove(h);
    assert.equal(h.calls.draw.length, 1);
    assert.equal(h.state.moves, 7);
    assert.equal(h.state.model.moveCount, 7);
    assertReleased(h);
  });
}
for (const [dy, pitch] of [[1000, -1.45], [-1000, 1.45]]) {
  test(`pitch clamps to ${pitch} and reverses immediately`, () => {
    const h = harness({ hit: false });
    start(h);
    h.send(TouchType.Move, [point(42, 100, 100 + dy)]);
    near(h.state.pitch, pitch);
    h.send(TouchType.Move, [point(42, 100, 100 + dy - Math.sign(dy) * 10)]);
    near(h.state.pitch, pitch + Math.sign(dy) * 0.09);
  });
}
for (const [dx, dy] of [[0, 0], [7.99, 0], [0, -8], [5, 5]]) {
  test(`orbit slop suppresses jitter (${dx}, ${dy}) through Up`, () => {
    const h = harness({ hit: false });
    start(h);
    h.send(TouchType.Move, [point(42, 100 + dx, 100 + dy)]);
    up(h, 100 + dx, 100 + dy);
    assertView(h);
    assert.equal(h.calls.draw.length, 0);
    assertNoMove(h);
  });
}
test('orbit slop accumulates from origin, then tracks small deltas', () => {
  const h = harness({ hit: false });
  start(h);
  for (const dx of [2, 4, 6, 8]) h.send(TouchType.Move, [point(42, 100 + dx, 100)]);
  assertView(h);
  h.send(TouchType.Move, [point(42, 109, 100)]);
  assertView(h, 0.62 - 9 * 0.009);
  h.send(TouchType.Move, [point(42, 110, 101)]);
  up(h, 112, 102);
  assertView(h, 0.62 - 12 * 0.009, -0.42 - 2 * 0.009);
  assert.equal(h.calls.draw.length, 3);
});
for (const inclusive of [true, false]) {
  test(`orbit Up applies final displacement with ${inclusive ? 'inclusive' : 'empty'} touches`, () => {
    const h = harness({ hit: false });
    start(h);
    const end = point(42, 130, 140);
    h.send(TouchType.Up, inclusive ? [{ ...end }] : [], [end]);
    assertView(h, 0.62 - 30 * 0.009, -0.42 - 40 * 0.009);
    assert.equal(h.calls.draw.length, 1);
    assertNoMove(h);
    assertReleased(h);
  });
}
for (const page of ['home', 'game']) {
  test(`${page} background can orbit while busy without synchronous redraw`, () => {
    const h = harness({ hit: false, busy: true, page });
    start(h);
    h.send(TouchType.Move, [point(42, 120, 130)]);
    up(h, 130, 140);
    assertView(h, 0.62 - 30 * 0.009, -0.42 - 40 * 0.009);
    assert.equal(h.calls.draw.length, 0);
    assertNoMove(h);
  });
}
test('home preview orbits even when the cube is hit', () => {
  const h = harness({ page: 'home' });
  start(h);
  up(h);
  assertView(h, 0.62 - 60 * 0.009, -0.42 - 20 * 0.009);
  assertNoMove(h);
});
test('busy cube Down is BLOCKED for the entire single-finger gesture', () => {
  const h = harness({ busy: true });
  start(h);
  assert.equal(h.state.blockedTouch, true);
  assert.equal(h.state.orbiting, false);
  h.send(TouchType.Move, [point(42, 140, 130)]);
  h.state.busy = false;
  h.send(TouchType.Move, [point(42, 180, 160)]);
  up(h, 200, 180);
  assertView(h);
  assertNoMove(h);
  assert.equal(h.calls.draw.length, 0);
  start(h);
  up(h);
  assert.equal(h.calls.requestMove.length, 1, 'fresh Down recovers');
});
test('busy observed mid-layer blocks it even if idle by release', () => {
  const h = harness();
  start(h);
  h.state.busy = true;
  h.send(TouchType.Move, [point(42, 140, 130)]);
  h.state.busy = false;
  up(h);
  assertNoMove(h);
  assertView(h);
});
for (const initialBusy of [true, false]) {
  for (const inclusive of [true, false]) {
    test(`multi-finger centroid 1->2->3->2->1 (${initialBusy ? 'blocked' : 'layer'}, ${inclusive ? 'inclusive' : 'remaining'} Up)`, () => {
      const h = harness({ busy: initialBusy });
      const a = start(h);
      const b = point(11, 200, 160);
      h.send(TouchType.Down, [a, b], [b]);
      assert.equal(h.state.orbiting, true);
      assert.equal(h.state.blockedTouch, false);
      const c = point(99, 600, 500);
      h.send(TouchType.Down, [a, b, c], [c]);
      assertView(h);
      const moved = [a, b, c].map(p => point(p.id, p.x + 30, p.y + 20));
      h.send(TouchType.Move, moved);
      const yaw = 0.62 - 30 * 0.009;
      const pitch = -0.42 - 20 * 0.009;
      assertView(h, yaw, pitch);
      h.send(TouchType.Up, inclusive ? moved.map(p => ({ ...p })) : moved.slice(0, 2), [{ ...moved[2] }]);
      near(h.state.lastX, (moved[0].x + moved[1].x) / 2);
      near(h.state.lastY, (moved[0].y + moved[1].y) / 2);
      assert.equal(h.state.pointerCount, 2);
      h.send(TouchType.Move, moved.slice(0, 2));
      assertView(h, yaw, pitch);
      h.send(TouchType.Up, inclusive ? moved.slice(0, 2) : [moved[1]], [{ ...moved[0] }]);
      assert.equal(h.state.pointerCount, 1);
      assert.equal(h.state.orbiting, true);
      h.send(TouchType.Move, [moved[1]]);
      assertView(h, yaw, pitch);
      const end = point(11, moved[1].x + 10, moved[1].y + 5);
      h.send(TouchType.Up, [], [end]);
      assertView(h, yaw - 10 * 0.009, pitch - 5 * 0.009);
      assertNoMove(h);
      assertReleased(h);
    });
  }
}
test('simultaneous two-finger Down and Up use centroids', () => {
  const h = harness({ busy: true });
  h.send(TouchType.Down, [point(1, 20, 30), point(2, 80, 90)]);
  h.send(TouchType.Up, [], [point(1, 40, 60), point(2, 100, 120)]);
  assertView(h, 0.62 - 20 * 0.009, -0.42 - 30 * 0.009);
  assertNoMove(h);
});
test('pointer count change first reported by Move rebases without a jump', () => {
  const h = harness();
  start(h);
  h.send(TouchType.Move, [point(42, 140, 130), point(2, 500, 600)]);
  assertView(h);
  assert.equal(h.state.orbiting, true);
  h.send(TouchType.Move, [point(2, 500, 600)]);
  assertView(h);
  h.send(TouchType.Up, [], [point(2, 520, 610)]);
  assertView(h, 0.62 - 20 * 0.009, -0.42 - 10 * 0.009);
  assertNoMove(h);
});
for (const hit of [true, false]) {
  for (const populated of [true, false]) {
    test(`Cancel (${hit ? 'layer' : 'orbit'}, ${populated ? 'populated' : 'empty'}) requires a fresh Down`, () => {
      const h = harness({ hit });
      start(h);
      const end = point(42, 180, 140);
      h.send(TouchType.Cancel, populated ? [end] : [], [end]);
      h.send(TouchType.Move, [end]);
      // An orphan partial Up must not re-arm orbit either.
      h.send(TouchType.Up, [end, point(2, 300, 400)], [end]);
      assertReleased(h);
      up(h);
      assertView(h);
      assertNoMove(h);
      start(h);
      up(h);
      assert.ok(hit ? h.calls.requestMove.length === 1 : h.state.yaw !== 0.62);
    });
  }
}
for (const kind of ['tutorial', 'history']) {
  test(`${kind} hand is erased only on first Down; partial Up keeps touch ownership until final release`, () => {
    const h = harness();
    const target = new CubeMove('x', 1, 1);
    if (kind === 'tutorial') {
      h.state.phase = 'tutorial';
      h.state.lesson = [target];
    } else {
      h.state.hintMove = target;
    }
    h.state.guideAt = 500;
    h.state.guideHidden = true;
    const first = start(h);
    assert.equal(h.calls.draw.length, 0, 'target touch must not repaint the cube');
    assert.equal(h.calls.guidance.length, 1, 'erase the target hand synchronously on first Down');
    assert.equal(h.state.guideAt, -1);
    assert.equal(h.state.guideHidden, false);
    const second = point(11, 200, 160);
    h.send(TouchType.Down, [first, second], [second]);
    assert.equal(h.calls.guidance.length, 1, 'additional fingers do not add target redraws');
    h.send(TouchType.Up, [first, second], [second]);
    assert.equal(h.state.touching, true, 'a remaining finger must keep target guidance paused');
    assert.equal(h.state.pointerCount, 1);
    h.send(TouchType.Up, [], [first]);
    assertReleased(h);
    assertNoMove(h);
    assert.equal(h.state.guideAt, -1, 'the next frame must start at the beginning');
    assert.equal(h.calls.guidance.length, 1, 'release leaves restoration to the existing frame timer');
  });
}

for (const [page, busy] of [['game', true], ['home', false], ['stats', false], ['settings', false]]) {
  test(`${page}, busy=${busy}: retained target does not trigger a touch-down repaint`, () => {
    const h = harness({ page, busy });
    h.state.hintMove = h.pickedMove;
    start(h);
    h.send(TouchType.Cancel);
    assert.equal(h.calls.draw.length, 0);
    assertNoMove(h);
  });
}

for (const end of [TouchType.Up, TouchType.Cancel]) {
  test(`no-target ${end === TouchType.Up ? 'Up' : 'Cancel'} resets guidance without adding repaint`, () => {
    const h = harness();
    h.state.guideAt = 500;
    h.state.guideHidden = true;
    const first = start(h);
    h.send(end, [], [first]);
    assert.equal(h.calls.draw.length, 0);
    assert.equal(h.state.guideAt, -1);
    assert.equal(h.state.guideHidden, false);
    assertReleased(h);
    assertNoMove(h);
  });
}

test('initial orphan Move/Up and empty Down cannot start a gesture', () => {
  const h = harness({ hit: false });
  h.send(TouchType.Down);
  h.send(TouchType.Move, [point(42, 150, 180)]);
  up(h);
  assertView(h);
  assertReleased(h);
});
for (const hit of [true, false]) {
  test(`background watcher invalidates ${hit ? 'layer' : 'orbit'} and foreground Move cannot reopen`, () => {
    const h = harness({ hit });
    start(h);
    h.state.foreground = false;
    h.state.onForegroundChanged();
    h.send(TouchType.Down, [point(42, 140, 150)]);
    h.state.foreground = true;
    h.state.onForegroundChanged();
    h.send(TouchType.Move, [point(42, 170, 180)]);
    up(h);
    assertView(h);
    assertNoMove(h);
    assertReleased(h);
  });
}
for (const [name, mutate] of [
  ['session', s => s.sessionId++], ['model identity', s => { s.model = new CubeModel(3); }],
  ['canvas width', s => s.canvasWidth++], ['canvas height', s => s.canvasHeight++],
  ['yaw', s => s.yaw += 0.1], ['pitch', s => s.pitch += 0.1],
  ['page', s => { s.page = 'home'; }], ['version', s => s.gestureVersion++]
]) {
  test(`Down snapshot rejects stale ${name} at Up`, () => {
    const h = harness();
    start(h);
    mutate(h.state);
    up(h);
    assertNoMove(h);
    assertReleased(h);
  });
}
for (const hit of [true, false]) {
  test(`visible result blocks ${hit ? 'layer picking' : 'orbit'} and stale release cannot leak through close`, () => {
    const h = harness({ hit });
    start(h);
    assert.equal(h.state.touching, true);
    // Only the native modal visibility boundary is injected here; game tests
    // drive real completion/opening, and all touch/close methods remain real.
    h.state.solveResult = new SolveResult(h.state.sessionId);
    h.state.resultVisible = true;
    let closed = 0;
    h.state.resultDialog = { close() { closed++; } };
    h.send(TouchType.Move, [point(42, 180, 140)]);
    up(h);
    start(h);
    up(h);
    assertReleased(h);
    assertNoMove(h);
    assertView(h);
    assert.equal(h.calls.draw.length, 0);
    h.state.closeSolveResult();
    assert.equal(closed, 1);
    h.send(TouchType.Move, [point(42, 190, 160)]);
    up(h);
    assertNoMove(h);
    assertView(h);
    start(h);
    up(h);
    if (hit) assert.equal(h.calls.requestMove.length, 1, 'fresh Down recovers layer input');
    else assert.notEqual(h.state.yaw, 0.62, 'fresh Down recovers view inspection');
  });
}

test('real reset invalidates pending layer and orphan Move', () => {
  const h = harness();
  start(h);
  h.state.resetSession();
  h.send(TouchType.Move, [point(42, 180, 130)]);
  up(h);
  assertNoMove(h);
  assertReleased(h);
});
test('real animate invalidates layer even when animation finishes before Up', () => {
  const h = harness();
  start(h);
  h.state.animate([h.pickedMove], 'user');
  h.state.busy = false;
  up(h);
  assertNoMove(h);
  assertView(h);
});
test('real animate keeps an ongoing orbit active', () => {
  const h = harness({ hit: false });
  start(h);
  h.state.animate([h.pickedMove], 'user');
  assert.equal(h.state.touching, true);
  up(h);
  assertView(h, 0.62 - 60 * 0.009, -0.42 - 20 * 0.009);
  assertNoMove(h);
});
test('real undo invalidates a pending layer after a model mutation', () => {
  const h = harness();
  h.state.model.applyMove(h.pickedMove, true);
  start(h);
  h.state.undo();
  up(h);
  assertNoMove(h);
});
test('disappearance clears touch ownership', () => {
  const h = harness();
  start(h);
  h.state.aboutToDisappear();
  h.send(TouchType.Move, [point(42, 190, 180)]);
  up(h);
  assertNoMove(h);
  assertReleased(h);
  assert.equal(h.calls.release.length, 1);
});
test('area, front view, and non-game navigation callbacks explicitly invalidate', () => {
  assert.match(source, /\.onAreaChange\(\(_old: Area, area: Area\) => \{\s*this\.invalidateGesture\(\);\s*this\.canvasWidth/);
  assert.match(source, /\.onClick\(\(\) => \{ this\.invalidateGesture\(\); this\.yaw = 0\.62; this\.pitch = -0\.42;/);
  for (const page of ['stats', 'settings']) {
    assert.ok(source.includes(`this.invalidateGesture(); this.canvasReady = false; this.page = '${page}';`));
  }
  assert.ok(!member('frame').includes('invalidateGesture'), 'animation frames must not cancel orbit');
});
for (const hit of [true, false]) {
  test(`Scroll Pan is rejected while Canvas owns ${hit ? 'layer/BLOCKED' : 'orbit'}, other recognizers continue`, () => {
    const h = harness({ hit, busy: true });
    const recognizer = (builtIn, type) => ({ isBuiltIn: () => builtIn, getType: () => type });
    const pan = recognizer(true, GestureControl.GestureType.PAN_GESTURE);
    assert.equal(h.state.judgeScrollGesture(pan), GestureJudgeResult.CONTINUE);
    start(h);
    assert.equal(h.state.judgeScrollGesture(pan), GestureJudgeResult.REJECT);
    assert.equal(h.state.judgeScrollGesture(recognizer(false, 2)), GestureJudgeResult.CONTINUE);
    assert.equal(h.state.judgeScrollGesture(recognizer(true, 0)), GestureJudgeResult.CONTINUE);
    h.send(TouchType.Cancel);
    assert.equal(h.state.judgeScrollGesture(pan), GestureJudgeResult.CONTINUE);
  });
}
test('both Canvas-hosting Scrolls install the pre-acceptance Pan judge', () => {
  for (const name of ['homePage', 'gamePage']) {
    assert.match(member(name), /\.onGestureRecognizerJudgeBegin\(\(_event: BaseGestureEvent, current: GestureRecognizer\) =>\s*this\.judgeScrollGesture\(current\)\)/);
  }
});

function startTeaching(h, index = 0) {
  h.state.leavePage();
  h.state.loaded = true;
  h.state.openTeaching();
  h.state.startChallenge(index);
  assert.equal(h.state.challengeIndex, index);
  assert.equal(h.state.phase, 'ready');
}

function passTouchFixture(h) {
  // Game tests cover real animation commits; here only the touch dispatch boundary
  // is isolated. Still use the real solved board rather than a stubbed isSolved().
  for (const move of h.state.model.getSolution()) h.state.model.applyMove(move);
  assert.equal(h.state.model.isSolved(), true);
  h.state.phase = 'solved';
}

test('opening teaching cancels the home preview orbit and requires a new Down', () => {
  const h = harness({ page: 'home' });
  h.state.loaded = true;
  start(h);
  assert.equal(h.state.orbiting, true);
  h.state.openTeaching();
  assert.equal(h.state.page, 'teaching');
  h.send(TouchType.Move, [point(42, 180, 150)]);
  up(h);
  assertReleased(h);
  assertNoMove(h);
  assertView(h);
});

for (const [name, change] of [
  ['another challenge', h => h.state.startChallenge(1)],
  ['retry', h => h.state.retryChallenge()],
  ['catalogue back', h => h.state.goHome()],
  ['direct home departure', h => h.state.leavePage()],
  ['background and resume', h => {
    h.state.foreground = false;
    h.state.onForegroundChanged();
    h.state.foreground = true;
    h.state.onForegroundChanged();
  }]
]) {
  test(`teaching ${name} invalidates a pending layer and stale Move/Up cannot turn the new board`, () => {
    const h = harness();
    startTeaching(h);
    start(h);
    assert.equal(h.state.touching, true);
    change(h);
    const after = JSON.stringify(h.state.model.cubies);
    h.send(TouchType.Move, [point(42, 180, 150)]);
    up(h);
    assertReleased(h);
    assertNoMove(h);
    assert.equal(JSON.stringify(h.state.model.cubies), after);
    assertView(h);
    if (h.state.page === 'game') {
      start(h);
      up(h);
      assert.equal(h.calls.requestMove.length, 1, 'a fresh gesture remains usable');
    }
  });
}

for (const destination of ['retry', 'leave']) {
  test(`confirmed teaching ${destination} cancels a layer held while its dialog is open`, () => {
    const h = harness();
    startTeaching(h, 1);
    h.state.model.applyMove(new CubeMove('z', 1, 1));
    h.state.phase = 'playing';
    if (destination === 'retry') h.state.retryChallenge();
    else h.state.goHome();
    assert.equal(h.calls.dialogs.length, 1);
    start(h);
    assert.equal(h.state.touching, true);
    h.calls.dialogs[0].secondaryButton.action();
    up(h);
    assertReleased(h);
    assertNoMove(h);
    assert.equal(h.state.page, destination === 'retry' ? 'game' : 'teaching');
  });
}

for (const inclusive of [true, false]) {
  test(`passed teaching cube hit orbits with ${inclusive ? 'inclusive' : 'empty'} Up and never resolves a layer`, () => {
    const h = harness();
    startTeaching(h);
    passTouchFixture(h);
    const before = JSON.stringify(h.state.model.cubies);
    const count = h.state.model.moveCount;
    start(h);
    assert.equal(h.state.orbiting, true);
    assert.equal(h.state.blockedTouch, false);
    h.send(TouchType.Move, [point(42, 130, 120)]);
    const end = point(42, 160, 140);
    h.send(TouchType.Up, inclusive ? [end] : [], [end]);
    assertNoMove(h);
    assertReleased(h);
    assertView(h, 0.62 - 60 * 0.009, -0.42 - 40 * 0.009);
    assert.equal(JSON.stringify(h.state.model.cubies), before);
    assert.equal(h.state.model.moveCount, count);
    assert.equal(h.state.phase, 'solved');
  });
}

test('next challenge cancels inspection of a passed board before accepting a fresh layer gesture', () => {
  const h = harness();
  startTeaching(h);
  passTouchFixture(h);
  start(h);
  assert.equal(h.state.orbiting, true);
  h.state.nextChallenge();
  assert.equal(h.state.challengeIndex, 1);
  assert.equal(h.state.phase, 'ready');
  up(h);
  assertReleased(h);
  assertNoMove(h);
  assertView(h);
  start(h);
  assert.equal(h.state.orbiting, false);
  up(h);
  assert.equal(h.calls.requestMove.length, 1);
});

test('teaching hint hand is suppressed during multi-finger touch and cancelled cleanly', () => {
  const h = harness();
  startTeaching(h, 2);
  h.state.hintMove = h.state.model.getSolution()[0];
  h.state.assisted = true;
  const draws = h.calls.draw.length;
  const a = start(h);
  assert.equal(h.calls.draw.length, draws);
  assert.equal(h.calls.guidance.length, 1);
  const b = point(11, 200, 160);
  h.send(TouchType.Down, [a, b], [b]);
  assert.equal(h.calls.draw.length, draws);
  assert.equal(h.calls.guidance.length, 1);
  h.send(TouchType.Up, [a, b], [b]);
  assert.equal(h.state.touching, true);
  h.send(TouchType.Cancel);
  up(h);
  assertReleased(h);
  assertNoMove(h);
  assert.equal(h.state.guideAt, -1);
  assert.equal(h.state.assisted, true);
});
