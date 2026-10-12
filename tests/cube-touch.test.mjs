import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const sourceUrl = new URL('../entry/src/main/ets/pages/Index.ets', import.meta.url);
const source = readFileSync(sourceUrl, 'utf8');
// Keep the real method verbatim. Its closing brace has the class-member indent;
// nested blocks are more deeply indented. Fail rather than use a fallback copy.
const methods = [...source.matchAll(/^  private touch\(event:\s*TouchEvent\):\s*void\s*\{\r?\n[\s\S]*?^  \}/gm)];
assert.equal(methods.length, 1, 'Index.ets must contain exactly one private touch method');
const executable = stripTypeScriptTypes(`class TouchHarness {\n${methods[0][0]}\n}\nTouchHarness;`);
const TouchType = Object.freeze({ Down: 0, Up: 1, Move: 2, Cancel: 3 });
const TouchHarness = runInNewContext(executable, { TouchType }, { filename: sourceUrl.pathname });

function point(id, x, y) {
  // Deliberately distinct from local vp coordinates to catch coordinate mixing.
  return { id, x, y, windowX: x + 400, windowY: y + 600, screenX: x + 800, screenY: y + 1000 };
}

function harness({ hit = true, busy = false, pickedMove = { axis: 'x', layer: 1, turns: 1 } } = {}) {
  const calls = { hitTest: [], pickMove: [], requestMove: [], draw: [] };
  const state = Object.assign(new TouchHarness(), {
    page: 'game', busy, foreground: true, moves: 7,
    model: { moveCount: 7 }, yaw: 0.62, pitch: -0.42,
    startX: 0, startY: 0, lastX: 0, lastY: 0,
    touching: false, orbiting: false, pointerCount: 0,
    renderer: {
      hitTest(...args) { calls.hitTest.push(args); return hit; },
      pickMove(...args) { calls.pickMove.push(args); return pickedMove; }
    },
    // Do not set busy here: a duplicate submission must not be masked by the mock.
    requestMove(...args) { calls.requestMove.push(args); },
    draw(...args) { calls.draw.push(args); }
  });
  return {
    state, calls, pickedMove,
    send(type, touches, changedTouches = []) { state.touch({ type, touches, changedTouches }); }
  };
}

function assertNoMove(h) {
  assert.equal(h.calls.pickMove.length, 0, 'must not try to select a layer move');
  assert.equal(h.calls.requestMove.length, 0, 'must not submit a layer move');
  assert.equal(h.state.moves, 7, 'displayed step count must stay unchanged');
  assert.equal(h.state.model.moveCount, 7, 'model step count must stay unchanged');
}

function assertReleased(h) {
  assert.equal(h.state.touching, false);
  assert.equal(h.state.pointerCount, 0);
}

function assertNear(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-12, `expected ${actual} to equal ${expected}`);
}

for (const retainsReleasedPoint of [true, false]) {
  test(`Up with ${retainsReleasedPoint ? 'released point still in touches' : 'empty touches'} submits exactly once`, () => {
    const h = harness();
    const start = point(42, 100, 120);
    const end = point(42, 150, 130);
    h.send(TouchType.Down, [start], [start]);
    h.send(TouchType.Move, [point(42, 130, 125)]);
    assert.equal(h.calls.requestMove.length, 0);
    const touches = retainsReleasedPoint ? [{ ...end }] : [];
    // Different objects with the same ID: exclusion must use ID, not identity.
    h.send(TouchType.Up, touches, [{ ...end }]);
    assert.equal(h.calls.pickMove.length, 1);
    assert.deepEqual(h.calls.requestMove, [[h.pickedMove]]);
    assertReleased(h);
    h.send(TouchType.Up, touches, [{ ...end }]);
    assert.equal(h.calls.pickMove.length, 1);
    assert.equal(h.calls.requestMove.length, 1);
  });
}

test('Down/Move/Up passes local coordinates and the current model/view to renderer', () => {
  const h = harness();
  const start = point(9, 31, 47);
  const middle = point(9, 59, 62);
  const end = point(9, 91, 83);
  h.send(TouchType.Down, [start], [start]);
  assert.deepEqual(h.calls.hitTest, [[31, 47]]);
  assert.equal(h.state.startX, 31);
  assert.equal(h.state.startY, 47);
  h.send(TouchType.Move, [middle], [middle]);
  assert.equal(h.state.lastX, 59);
  assert.equal(h.state.lastY, 62);
  assert.equal(h.calls.pickMove.length, 0);
  assert.equal(h.calls.requestMove.length, 0);
  h.send(TouchType.Up, [{ ...end }], [end]);
  assert.deepEqual(h.calls.pickMove, [[31, 47, 91, 83, h.state.model, 0.62, -0.42]]);
  assert.deepEqual(h.calls.requestMove, [[h.pickedMove]]);
  assert.equal(h.calls.draw.length, 0);
  assertReleased(h);
});

for (const retainsReleasedPoint of [true, false]) {
  test(`lifting one of two fingers keeps orbiting (${retainsReleasedPoint ? 'inclusive' : 'remaining-only'} Up.touches)`, () => {
    const h = harness();
    const first = point(73, 100, 100);
    const second = point(11, 200, 160);
    h.send(TouchType.Down, [first], [first]);
    h.send(TouchType.Down, [first, second], [second]);
    assert.equal(h.state.orbiting, true);
    assert.equal(h.state.pointerCount, 2);
    const lifted = point(73, 140, 120);
    const survivor = point(11, 240, 180);
    h.send(TouchType.Move, [lifted, survivor]);
    assertNear(h.state.yaw, 0.62 + 40 * 0.009);
    assertNear(h.state.pitch, -0.42 + 20 * 0.009);
    const beforeLift = { yaw: h.state.yaw, pitch: h.state.pitch, draws: h.calls.draw.length };
    h.send(TouchType.Up, retainsReleasedPoint ? [{ ...lifted }, survivor] : [survivor], [{ ...lifted }]);
    assert.equal(h.state.touching, true);
    assert.equal(h.state.orbiting, true);
    assert.equal(h.state.pointerCount, 1);
    assert.equal(h.state.lastX, survivor.x);
    assert.equal(h.state.lastY, survivor.y);
    assert.equal(h.state.yaw, beforeLift.yaw, 'lifting must not jump the view');
    assert.equal(h.state.pitch, beforeLift.pitch);
    assert.equal(h.calls.draw.length, beforeLift.draws);
    assertNoMove(h);
    const end = point(11, 250, 185);
    h.send(TouchType.Move, [end]);
    assertNear(h.state.yaw, beforeLift.yaw + 10 * 0.009);
    assertNear(h.state.pitch, beforeLift.pitch + 5 * 0.009);
    assert.equal(h.calls.draw.length, beforeLift.draws + 1);
    h.send(TouchType.Up, [{ ...end }], [end]);
    assertNoMove(h);
    assertReleased(h);
  });
}

for (const retainsPoint of [true, false]) {
  test(`Cancel with ${retainsPoint ? 'populated' : 'empty'} touches never submits, including a later Up`, () => {
    const h = harness();
    const start = point(5, 100, 100);
    const end = point(5, 180, 140);
    h.send(TouchType.Down, [start], [start]);
    h.send(TouchType.Move, [end]);
    h.send(TouchType.Cancel, retainsPoint ? [end] : [], [end]);
    assertNoMove(h);
    assertReleased(h);
    h.send(TouchType.Up, [end], [{ ...end }]);
    assertNoMove(h);
    assertReleased(h);
  });
}

for (const [dx, dy] of [[0, 0], [23.99, 0], [0, -23.99], [16, 16]]) {
  test(`drag (${dx}, ${dy}) below 24vp does not submit`, () => {
    const h = harness();
    const start = point(1, 100, 100);
    const end = point(1, 100 + dx, 100 + dy);
    h.send(TouchType.Down, [start], [start]);
    h.send(TouchType.Move, [end]);
    h.send(TouchType.Up, [end], [{ ...end }]);
    assertNoMove(h);
    assertReleased(h);
  });
}

test('drag at exactly 24vp submits a layer move', () => {
  const h = harness();
  const start = point(1, 100, 100);
  const end = point(1, 124, 100);
  h.send(TouchType.Down, [start], [start]);
  h.send(TouchType.Move, [end]);
  h.send(TouchType.Up, [], [end]);
  assert.equal(h.calls.pickMove.length, 1);
  assert.deepEqual(h.calls.requestMove, [[h.pickedMove]]);
  assertReleased(h);
});

test('background drag rotates the view and redraws without submitting or counting a step', () => {
  const h = harness({ hit: false });
  const start = point(2, 10, 15);
  const end = point(2, 70, 45);
  h.send(TouchType.Down, [start], [start]);
  assert.deepEqual(h.calls.hitTest, [[10, 15]]);
  assert.equal(h.state.orbiting, true);
  h.send(TouchType.Move, [end]);
  assertNear(h.state.yaw, 0.62 + 60 * 0.009);
  assertNear(h.state.pitch, -0.42 + 30 * 0.009);
  assert.equal(h.calls.draw.length, 1);
  h.send(TouchType.Up, [end], [{ ...end }]);
  assertNoMove(h);
  assertReleased(h);
});

for (const busyFromDown of [true, false]) {
  test(`busy ${busyFromDown ? 'from Down' : 'only at Up'} prevents submission`, () => {
    const h = harness({ busy: busyFromDown });
    const start = point(3, 100, 100);
    const end = point(3, 170, 140);
    h.send(TouchType.Down, [start], [start]);
    assert.equal(h.state.orbiting, busyFromDown);
    h.send(TouchType.Move, [end]);
    h.state.busy = true;
    h.send(TouchType.Up, [end], [{ ...end }]);
    assertNoMove(h);
    assert.equal(h.calls.draw.length, 0);
    assertReleased(h);
  });
}

test('renderer returning no layer move does not submit', () => {
  const h = harness({ pickedMove: null });
  const start = point(4, 100, 100);
  const end = point(4, 150, 140);
  h.send(TouchType.Down, [start], [start]);
  h.send(TouchType.Move, [end]);
  h.send(TouchType.Up, [end], [{ ...end }]);
  assert.equal(h.calls.pickMove.length, 1);
  assert.equal(h.calls.requestMove.length, 0);
  assert.equal(h.state.moves, 7);
  assert.equal(h.state.model.moveCount, 7);
  assertReleased(h);
});
