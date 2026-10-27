// Node 24: node --test tests/cube-teaching.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { CubeModel, CubeMove, CubeColors } from '../entry/src/main/ets/model/CubeModel.ts';
import { TeachingChallenge, createTeachingChallenges } from './teaching-helper.mjs';

const expected = [
  ['first-turn', 2, 'teaching_first_turn', 1, 'R'],
  ['corner-pair', 2, 'teaching_corner_pair', 1, 'R U'],
  ['corner-loop', 2, 'teaching_corner_loop', 2, "R U R' U'"],
  ['last-layer', 3, 'teaching_last_layer', 1, 'U'],
  ['right-slot', 3, 'teaching_right_slot', 2, "R U R'"],
  ['cross-return', 3, 'teaching_cross_return', 2, "F R U R' U' F'"],
  ['corner-orient', 3, 'teaching_corner_orient', 3, "R U R' U R U U R'"],
  ['edge-cycle', 3, 'teaching_edge_cycle', 3, "R U' R U R U R U' R' U' R R"]
];
const snapshot = cube => JSON.stringify(cube.cubies);
const labels = (moves, order) => moves.map(move => move.label(order)).join(' ');
const execute = (cube, moves, record = true) => {
  for (const move of moves) cube.applyMove(move, record);
};
const inverse = moves => moves.toReversed().map(move => move.inverse());
const noRandom = () => { throw new Error('Teaching setup must not use a random scramble'); };

function checkLegalState(cube) {
  const positions = new Set();
  const ids = new Set();
  const colors = new Map();
  for (const cubie of cube.cubies) {
    positions.add(`${cubie.x}:${cubie.y}:${cubie.z}`);
    ids.add(cubie.id);
    for (const coordinate of [cubie.x, cubie.y, cubie.z]) {
      assert.ok(Number.isInteger(coordinate) && coordinate >= 0 && coordinate < cube.order);
    }
    for (const sticker of cubie.stickers) {
      assert.equal(Math.abs(sticker.nx) + Math.abs(sticker.ny) + Math.abs(sticker.nz), 1);
      for (const [normal, coordinate] of [[sticker.nx, cubie.x], [sticker.ny, cubie.y], [sticker.nz, cubie.z]]) {
        assert.ok(Number.isInteger(normal));
        if (normal !== 0) assert.equal(coordinate, normal === 1 ? cube.order - 1 : 0);
      }
      colors.set(sticker.color, (colors.get(sticker.color) ?? 0) + 1);
    }
  }
  assert.equal(positions.size, cube.order ** 3);
  assert.equal(ids.size, cube.order ** 3);
  assert.equal(colors.size, 6);
  for (const count of colors.values()) assert.equal(count, cube.order ** 2);
}

test('catalogue has exactly the eight agreed levels, keys, difficulty, and quarter-turn setups', () => {
  const challenges = createTeachingChallenges();
  assert.equal(challenges.length, 8);
  assert.equal(new Set(challenges.map(challenge => challenge.id)).size, 8);
  const states = new Set();
  for (const [index, [id, order, key, difficulty, notation]] of expected.entries()) {
    const challenge = challenges[index];
    assert.ok(challenge instanceof TeachingChallenge);
    assert.deepEqual({
      id: challenge.id, order: challenge.order, titleKey: challenge.titleKey,
      descriptionKey: challenge.descriptionKey, tipKey: challenge.tipKey,
      difficulty: challenge.difficulty, referenceMoves: challenge.referenceMoves
    }, {
      id, order, titleKey: `${key}_title`, descriptionKey: `${key}_description`,
      tipKey: `${key}_tip`, difficulty, referenceMoves: notation.split(' ').length
    });
    assert.equal(labels(challenge.setupMoves(), order), notation);
    const cube = new CubeModel(3, noRandom);
    challenge.load(cube);
    states.add(`${cube.order}:${snapshot(cube)}`);
  }
  assert.equal(states.size, 8, 'no two teaching baselines may be duplicates');
});

for (const [index, [id, order, , , notation]] of expected.entries()) {
  test(`${id}: legal, deterministic, non-solved baseline has no user count or undo/redo`, () => {
    const challenge = createTeachingChallenges()[index];
    const cube = new CubeModel(5, noRandom);
    execute(cube, [new CubeMove('x', 0, 1), new CubeMove('y', 4, -1)]);
    cube.undo();
    challenge.load(cube);
    assert.equal(cube.order, order);
    assert.equal(cube.isSolved(), false);
    assert.equal(cube.moveCount, 0);
    assert.equal(cube.undo(), null);
    assert.equal(cube.redo(), null);
    checkLegalState(cube);

    const expectedCube = new CubeModel(order, noRandom);
    for (const token of notation.split(' ')) {
      const axis = { R: 'x', U: 'y', F: 'z' }[token[0]];
      expectedCube.applyMove(new CubeMove(axis, order - 1, token.endsWith("'") ? 1 : -1), false);
    }
    assert.equal(snapshot(cube), snapshot(expectedCube));
    const reloaded = new CubeModel(7, noRandom);
    createTeachingChallenges()[index].load(reloaded);
    assert.equal(snapshot(cube), snapshot(reloaded));
    assert.deepEqual(cube.getSolution(), inverse(challenge.setupMoves()));
  });

  test(`${id}: inverse setup and refreshed hints solve without counting setup turns`, () => {
    const challenge = createTeachingChallenges()[index];
    for (const record of [true, false]) {
      const cube = new CubeModel(3, noRandom);
      challenge.load(cube);
      const solution = inverse(challenge.setupMoves());
      for (const [step, move] of solution.entries()) {
        assert.deepEqual(cube.getSolution()[0], move);
        cube.applyMove(move, record);
        assert.equal(cube.getSolution().length, solution.length - step - 1);
      }
      assert.equal(cube.isSolved(), true);
      assert.equal(snapshot(cube), snapshot(new CubeModel(order)));
      assert.equal(cube.moveCount, record ? challenge.referenceMoves : 0);
    }
  });

  test(`${id}: model accepts arbitrary legal play and alternative non-retrace solutions`, () => {
    const challenge = createTeachingChallenges()[index];
    const cube = new CubeModel(order, noRandom);
    challenge.load(cube);
    // Arbitrary user detours remain legal; solving is based on the model, not a script cursor.
    execute(cube, [new CubeMove('z', 0, 1), new CubeMove('x', 0, -1), new CubeMove('y', 0, 1)]);
    checkLegalState(cube);
    execute(cube, cube.getSolution());
    assert.equal(cube.isSolved(), true);

    challenge.load(cube);
    // Three opposite turns equal one turn, but are not the catalogue's inverse sequence.
    const alternate = inverse(challenge.setupMoves()).flatMap(move =>
      [move.inverse(), move.inverse(), move.inverse()]);
    execute(cube, alternate);
    assert.equal(cube.isSolved(), true);
    assert.equal(snapshot(cube), snapshot(new CubeModel(order)));
    assert.equal(cube.moveCount, challenge.referenceMoves * 3);
    assert.ok(cube.getSolution().length > 0, 'face-uniformity wins, even with a nonempty retrace');

    // A rotated solved cube is also a valid completion; matching cubie IDs is not required.
    for (let layer = 0; layer < order; layer++) cube.applyMove(new CubeMove('y', layer, 1));
    assert.equal(cube.isSolved(), true);
    assert.notEqual(snapshot(cube), snapshot(new CubeModel(order)));
  });

  test(`${id}: wrong move plus undo and replay load restore the exact challenge baseline`, () => {
    const challenge = createTeachingChallenges()[index];
    const cube = new CubeModel(order, noRandom);
    challenge.load(cube);
    const baseline = snapshot(cube);
    const hints = cube.getSolution();
    const wrong = new CubeMove('z', 0, 1);
    cube.applyMove(wrong);
    assert.notEqual(snapshot(cube), baseline);
    assert.equal(cube.moveCount, 1);
    assert.deepEqual(cube.undo(), wrong.inverse());
    assert.equal(snapshot(cube), baseline);
    assert.equal(cube.moveCount, 0);
    assert.equal(cube.undo(), null);
    assert.deepEqual(cube.getSolution(), hints);
    assert.deepEqual(cube.redo(), wrong);
    challenge.load(cube);
    assert.equal(snapshot(cube), baseline);
    assert.equal(cube.moveCount, 0);
    assert.equal(cube.undo(), null);
    assert.equal(cube.redo(), null);
    assert.deepEqual(cube.getSolution(), hints);
    execute(cube, cube.getSolution());
    challenge.load(cube);
    assert.equal(snapshot(cube), baseline, 'replay after completion starts the exact same puzzle');
    cube.reset(7);
    challenge.load(cube);
    assert.equal(snapshot(cube), baseline, 'switching cube orders does not alter the challenge');
  });
}

test('setupMoves and catalogues return fresh moves and do not expose the stored setup', () => {
  const first = createTeachingChallenges();
  const second = createTeachingChallenges();
  assert.notEqual(first, second);
  for (const [index, challenge] of first.entries()) {
    assert.notEqual(challenge, second[index]);
    const a = challenge.setupMoves();
    const b = challenge.setupMoves();
    assert.deepEqual(a, b);
    assert.notEqual(a, b);
    for (const [moveIndex, move] of a.entries()) {
      assert.ok(move instanceof CubeMove);
      assert.notEqual(move, b[moveIndex]);
    }
    a[0].axis = 'z';
    a[0].turns *= -1;
    a.pop();
    assert.deepEqual(challenge.setupMoves(), b);
    const cube = new CubeModel(3);
    challenge.load(cube);
    const other = new CubeModel(3);
    second[index].load(other);
    assert.equal(snapshot(cube), snapshot(other));
  }
  const move = new CubeMove('x', 1, -1);
  const input = [move];
  const custom = new TeachingChallenge('test', 2, 'teaching_test', 1, input);
  move.turns = 1;
  input.length = 0;
  assert.equal(custom.referenceMoves, 1);
  assert.equal(labels(custom.setupMoves(), 2), 'R');
});

test('constructor rejects unsupported orders, invalid difficulty, and out-of-range setup moves', () => {
  for (const order of [1, 4, 2.5, NaN, '2']) {
    assert.throws(() => new TeachingChallenge('test', order, 'test', 1, []), RangeError);
  }
  for (const difficulty of [0, 4, 1.5, NaN, Infinity, '1']) {
    assert.throws(() => new TeachingChallenge('test', 2, 'test', difficulty, []), RangeError);
  }
  assert.throws(() => new TeachingChallenge('test', 2, 'test', 1, [new CubeMove('x', 2, -1)]), RangeError);
});

for (const id of ['cross-return', 'corner-orient', 'edge-cycle']) {
  test(`${id}: bottom two layers are unchanged and last-layer pattern matches its teaching purpose`, () => {
    const cube = new CubeModel(3);
    const solved = new Map(cube.cubies.map(cubie => [cubie.id, JSON.stringify(cubie)]));
    const lower = cube.cubies.filter(cubie => cubie.y < 2).map(cubie => cubie.id);
    createTeachingChallenges().find(challenge => challenge.id === id).load(cube);
    for (const cubie of cube.cubies.filter(cubie => lower.includes(cubie.id))) {
      assert.equal(JSON.stringify(cubie), solved.get(cubie.id), `${cubie.id}: lower-layer identity/orientation`);
    }
    const edges = cube.cubies.filter(cubie => cubie.y === 2 && cubie.stickers.length === 2);
    const corners = cube.cubies.filter(cubie => cubie.y === 2 && cubie.stickers.length === 3);
    const up = cubie => cubie.stickers.some(sticker => sticker.color === CubeColors.UP && sticker.ny === 1);
    if (id === 'cross-return') {
      assert.deepEqual(edges.filter(up).map(cubie => [cubie.x, cubie.z]), [[0, 1], [1, 0]],
        'two adjacent up-facing edges form an L; the starting state is not a completed cross');
      assert.equal(edges.filter(cubie => !up(cubie)).length, 2);
    } else if (id === 'corner-orient') {
      assert.equal(edges.filter(up).length, 4, 'cross remains oriented');
      assert.equal(corners.filter(up).length, 1, 'Sune-type pattern has three misoriented top corners');
      assert.ok(edges.some(cubie => `${cubie.x}:${cubie.y}:${cubie.z}` !== cubie.id),
        'Sune also permutes top pieces; do not describe it as twisting corners in place');
    } else {
      assert.equal(edges.filter(up).length, 4);
      for (const corner of corners) assert.equal(JSON.stringify(corner), solved.get(corner.id));
      const changed = cube.cubies.filter(cubie => JSON.stringify(cubie) !== solved.get(cubie.id));
      assert.equal(changed.length, 3, 'only three top edges change');
      assert.ok(changed.every(cubie => cubie.y === 2 && cubie.stickers.length === 2));
      const destinations = new Map(changed.map(cubie => [cubie.id, `${cubie.x}:${cubie.y}:${cubie.z}`]));
      const start = changed[0].id;
      assert.notEqual(destinations.get(start), start);
      assert.notEqual(destinations.get(destinations.get(start)), start);
      assert.equal(destinations.get(destinations.get(destinations.get(start))), start, 'a single three-edge cycle');
    }
  });
}
