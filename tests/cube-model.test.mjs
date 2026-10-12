import test from 'node:test';
import assert from 'node:assert/strict';
import { CubeModel, CubeMove, Cubelet, Sticker, CubeColors } from '../entry/src/main/ets/model/CubeModel.ts';

const axes = ['x', 'y', 'z'];
const orders = [2, 3, 4, 5, 6, 7];

function snapshot(cube) {
  return JSON.stringify(cube.cubies);
}

function seededRandom(seed = 123456789) {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function execute(cube, moves, record = true) {
  for (const move of moves) {
    cube.applyMove(move, record);
  }
}

function checkInvariants(cube) {
  const positions = new Set();
  const ids = new Set();
  const colors = new Map();
  const last = cube.order - 1;
  let stickers = 0;
  for (const cubie of cube.cubies) {
    assert.ok(cubie instanceof Cubelet);
    ids.add(cubie.id);
    positions.add(`${cubie.x}:${cubie.y}:${cubie.z}`);
    for (const coordinate of [cubie.x, cubie.y, cubie.z]) {
      assert.ok(Number.isInteger(coordinate));
      assert.ok(coordinate >= 0 && coordinate < cube.order);
    }
    for (const sticker of cubie.stickers) {
      assert.ok(sticker instanceof Sticker);
      const normal = [sticker.nx, sticker.ny, sticker.nz];
      assert.equal(normal.reduce((sum, value) => sum + Math.abs(value), 0), 1);
      for (const value of normal) {
        assert.ok(Number.isInteger(value));
        assert.equal(Object.is(value, -0), false);
      }
      if (sticker.nx === 1) assert.equal(cubie.x, last);
      if (sticker.nx === -1) assert.equal(cubie.x, 0);
      if (sticker.ny === 1) assert.equal(cubie.y, last);
      if (sticker.ny === -1) assert.equal(cubie.y, 0);
      if (sticker.nz === 1) assert.equal(cubie.z, last);
      if (sticker.nz === -1) assert.equal(cubie.z, 0);
      assert.match(sticker.color, /^#[0-9A-F]{6}$/);
      colors.set(sticker.color, (colors.get(sticker.color) ?? 0) + 1);
      stickers++;
    }
  }
  assert.equal(cube.cubies.length, cube.order ** 3);
  assert.equal(positions.size, cube.order ** 3);
  assert.equal(ids.size, cube.order ** 3);
  assert.equal(stickers, 6 * cube.order ** 2);
  assert.equal(colors.size, 6);
  for (const count of colors.values()) assert.equal(count, cube.order ** 2);
}

for (const order of orders) {
  test(`${order}x${order}: initialized coordinates, colors, and solved state`, () => {
    const cube = new CubeModel(order);
    assert.equal(cube.order, order);
    assert.equal(cube.isSolved(), true);
    assert.equal(cube.moveCount, 0);
    assert.deepEqual(cube.getSolution(), []);
    assert.equal(cube.undo(), null);
    assert.equal(cube.redo(), null);
    checkInvariants(cube);
    const corner = cube.cubies.find(cubie => cubie.id === '0:0:0');
    assert.deepEqual(corner.stickers.map(sticker => sticker.color),
      [CubeColors.LEFT, CubeColors.DOWN, CubeColors.BACK]);
    assert.equal(corner.x - (order - 1) / 2, -(order - 1) / 2);
  });

  test(`${order}x${order}: every axis/layer/sign has order four and an exact inverse`, () => {
    for (const axis of axes) {
      for (let layer = 0; layer < order; layer++) {
        for (const turns of [-1, 1]) {
          const cube = new CubeModel(order);
          const initial = snapshot(cube);
          const move = new CubeMove(axis, layer, turns);
          cube.applyMove(move);
          assert.equal(cube.isSolved(), false);
          checkInvariants(cube);
          cube.applyMove(move.inverse());
          assert.equal(snapshot(cube), initial);
          assert.equal(cube.isSolved(), true);
          for (let i = 0; i < 4; i++) cube.applyMove(move);
          assert.equal(snapshot(cube), initial);
          assert.equal(cube.isSolved(), true);
        }
      }
    }
  });

  test(`${order}x${order}: whole-cube rotations remain solved regardless of colors`, () => {
    const cube = new CubeModel(order);
    const initial = snapshot(cube);
    for (const axis of axes) {
      for (const turns of [-1, 1]) {
        for (let layer = 0; layer < order; layer++) {
          cube.applyMove(new CubeMove(axis, layer, turns));
        }
        assert.equal(cube.isSolved(), true);
        checkInvariants(cube);
      }
    }
    assert.equal(snapshot(cube), initial);
    for (const axis of axes) {
      for (let layer = 0; layer < order; layer++) {
        cube.applyMove(new CubeMove(axis, layer, 1));
      }
      assert.equal(cube.isSolved(), true);
    }
    assert.notEqual(snapshot(cube), initial);
    execute(cube, cube.getSolution(), false);
    assert.equal(snapshot(cube), initial);
  });

  test(`${order}x${order}: reproducible legal scramble is pure and exactly retraceable`, () => {
    const cube = new CubeModel(order, seededRandom());
    const initial = snapshot(cube);
    const moves = cube.createScramble(150);
    assert.deepEqual(moves, new CubeModel(order, seededRandom()).createScramble(150));
    assert.equal(snapshot(cube), initial);
    assert.equal(cube.moveCount, 0);
    assert.deepEqual(cube.getSolution(), []);
    assert.equal(moves.length, 150);
    for (let i = 0; i < moves.length; i++) {
      const move = moves[i];
      assert.ok(move instanceof CubeMove);
      assert.ok(axes.includes(move.axis));
      assert.ok(move.layer >= 0 && move.layer < order);
      assert.ok(move.turns === 1 || move.turns === -1);
      if (i > 0) {
        const previous = moves[i - 1];
        assert.ok(move.axis !== previous.axis || move.layer !== previous.layer);
      }
      cube.applyMove(move, false);
      checkInvariants(cube);
    }
    assert.equal(cube.moveCount, 0);
    assert.equal(cube.undo(), null);
    assert.deepEqual(cube.getSolution(), moves.map(move => move.inverse()).reverse());
    const solution = cube.getSolution();
    execute(cube, solution, false);
    assert.equal(cube.isSolved(), true);
    assert.equal(snapshot(cube), initial);
    // Simplify only the returned solution, never the actual-turn log.
    assert.deepEqual(cube.getSolution(), []);
    assert.equal(cube.actualMoves.length, 300);
  });

  test(`${order}x${order}: repeatedly refreshed hints terminate with and without undo/redo`, () => {
    for (const record of [false, true]) {
      for (const withUndoRedo of [false, true]) {
        const cube = new CubeModel(order, seededRandom(900 + order));
        const initial = snapshot(cube);
        execute(cube, cube.createScramble(40), false);
        if (withUndoRedo) {
          execute(cube, cube.createScramble(8));
          assert.notEqual(cube.undo(), null);
          assert.notEqual(cube.undo(), null);
          assert.notEqual(cube.redo(), null);
          assert.notEqual(cube.redo(), null);
          assert.notEqual(cube.undo(), null);
        }
        assert.equal(cube.isSolved(), false);
        const budget = cube.getSolution().length;
        let steps = 0;
        while (!cube.isSolved()) {
          assert.ok(steps < budget, 'hint loop must finish within the initial solution length');
          const solution = cube.getSolution();
          const hint = solution[0];
          assert.ok(hint instanceof CubeMove);
          cube.applyMove(hint, record);
          steps++;
          assert.deepEqual(cube.getSolution(), solution.slice(1),
            'refreshing must remove exactly the executed hint, never suggest reversing it');
        }
        assert.equal(cube.isSolved(), true);
        // Face-uniformity can be reached before the exact reset orientation.
        // Following any remaining hints must also terminate at the exact state.
        while (cube.getSolution().length > 0) {
          assert.ok(steps < budget);
          const solution = cube.getSolution();
          cube.applyMove(solution[0], record);
          steps++;
          assert.deepEqual(cube.getSolution(), solution.slice(1));
        }
        assert.equal(steps, budget);
        assert.equal(snapshot(cube), initial);
        checkInvariants(cube);
      }
    }
  });

  test(`${order}x${order}: undo/redo restore exact states and retrace includes both`, () => {
    const cube = new CubeModel(order, seededRandom(100 + order));
    const initial = snapshot(cube);
    execute(cube, cube.createScramble(12), false);
    const baseline = snapshot(cube);
    const first = new CubeMove('x', 0, 1);
    const second = new CubeMove('y', order - 1, -1);
    cube.applyMove(first);
    const firstState = snapshot(cube);
    const firstSolution = cube.getSolution();
    cube.applyMove(second);
    const secondState = snapshot(cube);
    assert.equal(cube.moveCount, 2);
    assert.deepEqual(cube.undo(), second.inverse());
    assert.equal(snapshot(cube), firstState);
    assert.equal(cube.moveCount, 1);
    assert.deepEqual(cube.undo(), first.inverse());
    assert.equal(snapshot(cube), baseline);
    assert.equal(cube.moveCount, 0);
    assert.equal(cube.undo(), null);
    assert.deepEqual(cube.redo(), first);
    assert.equal(snapshot(cube), firstState);
    assert.deepEqual(cube.redo(), second);
    assert.equal(snapshot(cube), secondState);
    assert.equal(cube.redo(), null);
    assert.equal(cube.moveCount, 2);
    cube.undo();
    assert.equal(cube.actualMoves.length, 19);
    const solution = cube.getSolution();
    assert.deepEqual(solution, firstSolution);
    execute(cube, solution, false);
    assert.equal(snapshot(cube), initial);
    assert.equal(cube.isSolved(), true);
  });
}

test('solution cancels cascading inverse pairs without modifying state or any history', () => {
  const cube = new CubeModel(3);
  const a = new CubeMove('x', 0, 1);
  const b = new CubeMove('y', 1, -1);
  execute(cube, [a, b, b.inverse(), a.inverse()]);
  assert.equal(cube.moveCount, 4);
  assert.deepEqual(cube.getSolution(), []);
  assert.deepEqual(cube.undo(), a);
  const state = snapshot(cube);
  const actualLog = cube.actualMoves;
  const undoLog = cube.undoMoves;
  const redoLog = cube.redoMoves;
  const history = JSON.stringify([actualLog, undoLog, redoLog]);
  for (let i = 0; i < 3; i++) assert.deepEqual(cube.getSolution(), [a.inverse()]);
  assert.equal(snapshot(cube), state);
  assert.equal(cube.actualMoves, actualLog);
  assert.equal(cube.undoMoves, undoLog);
  assert.equal(cube.redoMoves, redoLog);
  assert.equal(JSON.stringify([actualLog, undoLog, redoLog]), history);
  assert.equal(cube.moveCount, 3);
  assert.deepEqual(cube.redo(), a.inverse());
  assert.deepEqual(cube.getSolution(), []);
  assert.equal(cube.actualMoves.length, 6);
});

test('solution does not cancel different axes, different layers, or equal signs', () => {
  const a = new CubeMove('x', 0, 1);
  const sequences = [
    [a, new CubeMove('y', 0, -1)],
    [a, new CubeMove('x', 1, -1)],
    [a, a],
    [a, new CubeMove('y', 0, 1), a.inverse()]
  ];
  for (const moves of sequences) {
    const cube = new CubeModel(3);
    execute(cube, moves);
    assert.deepEqual(cube.getSolution(), moves.map(move => move.inverse()).reverse());
  }
});

test('positive quarter turns match right-hand coordinates and sticker normals', () => {
  for (const axis of axes) {
    const cube = new CubeModel(3);
    const cubie = cube.cubies.find(item => item.id === '2:2:2');
    const move = new CubeMove(axis, 2, 1);
    const before = snapshot(cube);
    const references = new Map(cube.cubies.map(item => [item.id, item]));
    const unaffected = cube.cubies.filter(item => item[axis] !== 2).map(item => JSON.stringify(item));
    assert.equal(move.turns * Math.PI / 2, Math.PI / 2);
    assert.equal(snapshot(cube), before, 'pre-commit animation reads do not mutate core');
    cube.applyMove(move);
    for (const item of cube.cubies) assert.equal(item, references.get(item.id));
    assert.deepEqual(cube.cubies.filter(item => item[axis] !== 2).map(item => JSON.stringify(item)), unaffected);
    if (axis === 'x') {
      assert.deepEqual([cubie.x, cubie.y, cubie.z], [2, 0, 2]);
      const up = cubie.stickers.find(item => item.color === CubeColors.UP);
      assert.deepEqual([up.nx, up.ny, up.nz], [0, 0, 1]);
    } else if (axis === 'y') {
      assert.deepEqual([cubie.x, cubie.y, cubie.z], [2, 2, 0]);
      const front = cubie.stickers.find(item => item.color === CubeColors.FRONT);
      assert.deepEqual([front.nx, front.ny, front.nz], [1, 0, 0]);
    } else {
      assert.deepEqual([cubie.x, cubie.y, cubie.z], [0, 2, 2]);
      const right = cubie.stickers.find(item => item.color === CubeColors.RIGHT);
      assert.deepEqual([right.nx, right.ny, right.nz], [0, 1, 0]);
    }
  }
});

test('move labels document outer clockwise and zero-based inner notation', () => {
  assert.equal(new CubeMove('x', 0, 1).label(3), 'L');
  assert.equal(new CubeMove('x', 2, -1).label(3), 'R');
  assert.equal(new CubeMove('y', 0, 1).label(3), 'D');
  assert.equal(new CubeMove('y', 2, -1).label(3), 'U');
  assert.equal(new CubeMove('z', 0, 1).label(3), 'B');
  assert.equal(new CubeMove('z', 2, -1).label(3), 'F');
  assert.equal(new CubeMove('z', 2, 1).label(3), "F'");
  assert.equal(new CubeMove('x', 1, 1).label(3), 'X[1]');
  assert.equal(new CubeMove('y', 1, -1).label(3), "Y[1]'");
  assert.equal(new CubeMove('z', 5, 1).label(7), 'Z[5]');
  const move = new CubeMove('x', 1, 1);
  assert.deepEqual(move.inverse().inverse(), move);
  assert.notEqual(move.inverse().inverse(), move);
});

test('branching clears redo; unrecorded moves establish a new baseline', () => {
  const cube = new CubeModel(3);
  cube.applyMove(new CubeMove('x', 0, 1));
  cube.applyMove(new CubeMove('y', 0, 1));
  cube.undo();
  cube.applyMove(new CubeMove('z', 0, 1));
  assert.equal(cube.redo(), null);
  assert.equal(cube.moveCount, 2);
  cube.undo();
  cube.applyMove(new CubeMove('x', 1, 1), false);
  const baseline = snapshot(cube);
  assert.equal(cube.moveCount, 0);
  assert.equal(cube.redo(), null);
  assert.equal(cube.undo(), null);
  cube.applyMove(new CubeMove('z', 2, -1));
  cube.undo();
  assert.equal(snapshot(cube), baseline);
  execute(cube, cube.getSolution(), false);
  assert.equal(snapshot(cube), snapshot(new CubeModel(3)));
});

test('history never retains caller-owned or returned move objects', () => {
  const cube = new CubeModel(3);
  const initial = snapshot(cube);
  const move = new CubeMove('x', 0, 1);
  cube.applyMove(move);
  move.axis = 'z';
  move.layer = 2;
  move.turns = -1;
  const solution = cube.getSolution();
  solution[0].axis = 'y';
  solution.length = 0;
  assert.deepEqual(cube.getSolution(), [new CubeMove('x', 0, -1)]);
  const undone = cube.undo();
  assert.equal(snapshot(cube), initial);
  undone.turns = 1;
  const redone = cube.redo();
  redone.axis = 'y';
  cube.undo();
  assert.equal(snapshot(cube), initial);
});

test('reset clears all histories, restores exact state, and optionally changes order', () => {
  const cube = new CubeModel(3, seededRandom());
  execute(cube, cube.createScramble(10));
  cube.undo();
  cube.reset();
  assert.equal(cube.order, 3);
  assert.equal(snapshot(cube), snapshot(new CubeModel(3)));
  assert.equal(cube.moveCount, 0);
  assert.deepEqual(cube.getSolution(), []);
  assert.equal(cube.undo(), null);
  assert.equal(cube.redo(), null);
  for (const order of orders) {
    cube.reset(order);
    assert.equal(cube.order, order);
    assert.equal(snapshot(cube), snapshot(new CubeModel(order)));
    checkInvariants(cube);
  }
});

test('constant and edge random sources terminate and avoid repeating axis/layer', () => {
  for (const value of [0, 0.5, 1 - Number.EPSILON]) {
    let calls = 0;
    const cube = new CubeModel(7, () => { calls++; return value; });
    const moves = cube.createScramble(100);
    assert.equal(calls, 200);
    for (let i = 1; i < moves.length; i++) {
      assert.ok(moves[i].axis !== moves[i - 1].axis || moves[i].layer !== moves[i - 1].layer);
    }
  }
  let calls = 0;
  assert.deepEqual(new CubeModel(3, () => { calls++; return 0; }).createScramble(0), []);
  assert.equal(calls, 0);
});

test('invalid orders, axes, layers, turns and RNG values are rejected', () => {
  for (const order of [0, 1, 8, -1, 2.5, NaN, Infinity, '3', null]) {
    assert.throws(() => new CubeModel(order), RangeError);
  }
  for (const axis of ['', 'X', 'w', null, 0]) {
    assert.throws(() => new CubeMove(axis, 0, 1), RangeError);
  }
  for (const layer of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '0']) {
    assert.throws(() => new CubeMove('x', layer, 1), RangeError);
  }
  for (const turns of [0, 2, -2, 0.5, NaN, Infinity, '1']) {
    assert.throws(() => new CubeMove('x', 0, turns), RangeError);
  }
  for (const count of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '3']) {
    assert.throws(() => new CubeModel(3).createScramble(count), RangeError);
  }
  for (const value of [-0.01, 1, Infinity, NaN, '0.5']) {
    const cube = new CubeModel(3, () => value);
    assert.throws(() => cube.createScramble(1), RangeError);
    assert.equal(cube.moveCount, 0);
    assert.deepEqual(cube.getSolution(), []);
    assert.equal(cube.isSolved(), true);
  }
  assert.throws(() => new CubeModel(3, null), TypeError);
  assert.throws(() => new CubeMove('x', 3, 1).label(3), RangeError);
  assert.throws(() => new CubeMove('x', 0, 1).label(8), RangeError);
});

test('invalid operations are atomic and preserve pending redo', () => {
  const cube = new CubeModel(3);
  const first = new CubeMove('x', 0, 1);
  const second = new CubeMove('y', 1, -1);
  cube.applyMove(first);
  cube.applyMove(second);
  cube.undo();
  const state = snapshot(cube);
  const solution = cube.getSolution();
  assert.throws(() => cube.applyMove(new CubeMove('z', 3, 1)), RangeError);
  assert.throws(() => cube.applyMove(null), TypeError);
  assert.throws(() => cube.applyMove({ axis: 'x', layer: 0, turns: 1 }), TypeError);
  assert.throws(() => cube.applyMove(first, 0), TypeError);
  assert.throws(() => cube.reset(9), RangeError);
  const malformed = new CubeMove('x', 0, 1);
  malformed.turns = 2;
  assert.throws(() => cube.applyMove(malformed), RangeError);
  assert.equal(snapshot(cube), state);
  assert.equal(cube.order, 3);
  assert.equal(cube.moveCount, 1);
  assert.deepEqual(cube.getSolution(), solution);
  assert.deepEqual(cube.redo(), second);
});
