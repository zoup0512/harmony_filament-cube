// Run with Node 24: node --test tests/cube-renderer.test.mjs
// No DOM, package dependencies, source edits, or project-local generated files.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from 'node:module';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const temporary = await mkdtemp(join(tmpdir(), 'cube-renderer-test-'));
let CubeModel;
let CubeMove;
let CubeRenderer;
try {
  const modelSource = await readFile(new URL('../entry/src/main/ets/model/CubeModel.ts', import.meta.url), 'utf8');
  const rendererSource = await readFile(new URL('../entry/src/main/ets/render/CubeRenderer.ets', import.meta.url), 'utf8');
  const modelImport = /(['"])\.\.\/model\/CubeModel\1/g;
  assert.equal([...rendererSource.matchAll(modelImport)].length, 1, 'expected exactly one model import');
  const rewrittenRenderer = rendererSource.replace(modelImport, "'./CubeModel.mjs'");
  await writeFile(join(temporary, 'CubeModel.mjs'), stripTypeScriptTypes(modelSource, { mode: 'strip' }));
  await writeFile(join(temporary, 'CubeRenderer.mjs'), stripTypeScriptTypes(rewrittenRenderer, { mode: 'strip' }));
  ({ CubeModel, CubeMove } = await import(pathToFileURL(join(temporary, 'CubeModel.mjs')).href));
  ({ CubeRenderer } = await import(pathToFileURL(join(temporary, 'CubeRenderer.mjs')).href));
} catch (error) {
  await rm(temporary, { recursive: true, force: true });
  throw error;
}
after(async () => {
  await rm(temporary, { recursive: true, force: true });
});

const axes = ['x', 'y', 'z'];
const orders = [2, 3, 4, 5, 6, 7];
const width = 420;
const height = 500;
const yawAngles = [0, 0.62, -0.8, 1.57, 2.6, 3.14, -2.3];
const pitchAngles = [-1.3, -0.42, 0, 0.73, 1.5];

// The mock checks Canvas usage/finite coordinates, but does not rasterize pixels.
class CheckingCanvas {
  globalAlpha = 1;
  lineJoin = 'miter';
  fillStyle = '#000000';
  strokeStyle = '#000000';
  lineWidth = 1;
  stack = [];
  vertices = 0;
  fills = 0;
  clears = 0;

  save() {
    this.stack.push([this.globalAlpha, this.lineJoin, this.fillStyle, this.strokeStyle, this.lineWidth]);
  }
  restore() {
    assert.ok(this.stack.length > 0, 'unbalanced restore');
    [this.globalAlpha, this.lineJoin, this.fillStyle, this.strokeStyle, this.lineWidth] = this.stack.pop();
  }
  clearRect(...values) {
    assert.ok(values.every(Number.isFinite));
    this.clears++;
  }
  beginPath() { this.vertices = 0; }
  moveTo(x, y) {
    assert.ok(Number.isFinite(x) && Number.isFinite(y), 'non-finite Canvas coordinate');
    this.vertices++;
  }
  lineTo(x, y) { this.moveTo(x, y); }
  closePath() { assert.equal(this.vertices, 4, 'expected quadrilateral'); }
  fill() {
    assert.equal(this.vertices, 4);
    assert.ok(this.globalAlpha >= 0 && this.globalAlpha <= 1);
    assert.equal(typeof this.fillStyle, 'string');
    this.fills++;
  }
  stroke() {
    assert.equal(this.vertices, 4);
    assert.ok(this.lineWidth > 0 && Number.isFinite(this.lineWidth));
  }
}

function seededModel(order) {
  const model = new CubeModel(order);
  // Deterministic non-solved positions and normals; no Math.random/flaky seed.
  for (const move of [new CubeMove('x', 0, 1), new CubeMove('y', order - 1, -1),
    new CubeMove('z', Math.floor(order / 2), 1)]) {
    model.applyMove(move, false);
  }
  return model;
}

function snapshot(model) { return JSON.stringify(model); }
function rounded(value) { return Number(value.toFixed(6)); }
function vectorKey(point) { return [rounded(point.x), rounded(point.y), rounded(point.z)]; }
function polygonKey(points) {
  // A quarter turn can cyclically permute a face's corner order.
  return points.map(point => [rounded(point.x), rounded(point.y)].join(',')).sort();
}
function geometry(renderer) {
  // White-box geometry oracle: includes black interior faces and sticker normals,
  // but ignores original world normals / array order at exact depth ties.
  return renderer.faces.map(face => JSON.stringify([
    face.cubie.id, face.color, vectorKey(face.cameraCenter), vectorKey(face.cameraNormal),
    polygonKey(face.outline), polygonKey(face.sticker)
  ])).sort();
}

// Independent analytic gesture oracle: do not call renderer.rotate/toCamera/
// project/surfacePoint. Axis-cross-position gives positive right-hand velocity;
// differentiating perspective projection gives its signed screen tangent.
function camera(point, yaw, pitch) {
  const x = point[0] * Math.cos(yaw) - point[2] * Math.sin(yaw);
  const z = point[0] * Math.sin(yaw) + point[2] * Math.cos(yaw);
  return [x, point[1] * Math.cos(pitch) + z * Math.sin(pitch),
    -point[1] * Math.sin(pitch) + z * Math.cos(pitch)];
}
function gesture(face, order, axis, yaw, pitch) {
  const middle = (order - 1) / 2;
  const spacing = 2 / order;
  const point = axes.map(key => (face[key] - middle) * spacing + face.normal[key] * spacing * 0.474);
  const velocity = axis === 'x' ? [0, -point[2], point[1]] :
    axis === 'y' ? [point[2], 0, -point[0]] : [-point[1], point[0], 0];
  const p = camera(point, yaw, pitch);
  const v = camera(velocity, yaw, pitch);
  const denominator = 6 - p[2];
  const focal = Math.min(width, height) * 1.48;
  const tx = v[0] * denominator + p[0] * v[2];
  const ty = -(v[1] * denominator + p[1] * v[2]);
  const length = Math.hypot(tx, ty);
  return {
    x: width / 2 + focal * p[0] / denominator,
    y: height / 2 - focal * p[1] / denominator,
    dx: 30 * tx / length,
    dy: 30 * ty / length,
    length
  };
}

for (const order of orders) {
  test(`${order}x${order}: animation endpoints, clamping, finite drawing, and model immutability`, t => {
    const model = seededModel(order);
    const renderer = new CubeRenderer();
    const context = new CheckingCanvas();
    let frames = 0;
    for (const axis of axes) {
      for (let layer = 0; layer < order; layer++) {
        for (const turns of [-1, 1]) {
          const move = new CubeMove(axis, layer, turns);
          // Vary endpoint cameras as the deterministic move sequence progresses.
          const yaw = yawAngles[(layer + axes.indexOf(axis)) % yawAngles.length];
          const pitch = pitchAngles[(layer + (turns > 0 ? 1 : 0)) % pitchAngles.length];
          const before = snapshot(model);
          renderer.draw(context, width, height, model, yaw, pitch);
          const initial = geometry(renderer);
          let endpoint;
          for (const progress of [-1, 0, NaN, 0.25, 0.5, 0.75, 1, 2]) {
            renderer.draw(context, width, height, model, yaw, pitch, move, progress);
            assert.equal(snapshot(model), before, `draw mutated ${axis}/${layer}/${turns} at ${progress}`);
            assert.equal(context.stack.length, 0);
            assert.equal(renderer.pickMove(210, 250, 250, 250, model, yaw, pitch), null,
              'in-flight animation must not produce a new move');
            if (progress <= 0 || Number.isNaN(progress)) assert.deepEqual(geometry(renderer), initial);
            if (progress === 1) endpoint = geometry(renderer);
            if (progress === 2) assert.deepEqual(geometry(renderer), endpoint);
            for (let i = 1; i < renderer.faces.length; i++) {
              assert.ok(renderer.faces[i - 1].cameraCenter.z <= renderer.faces[i].cameraCenter.z,
                'global face depth order');
            }
            frames++;
          }
          model.applyMove(move, false);
          renderer.draw(context, width, height, model, yaw, pitch);
          assert.deepEqual(geometry(renderer), endpoint, `committed endpoint ${axis}/${layer}/${turns}`);
        }
      }
    }
    assert.ok(context.fills > 0 && context.clears > 0);
    t.diagnostic(`${frames} animation frames, every axis/layer/sign`);
  });

  test(`${order}x${order}: signed picking at 35 views uses current cubie layer coordinates`, t => {
    const model = seededModel(order);
    const before = snapshot(model);
    const renderer = new CubeRenderer();
    const context = new CheckingCanvas();
    const coverage = new Set();
    let picks = 0;
    for (const yaw of yawAngles) {
      for (const pitch of pitchAngles) {
        renderer.draw(context, width, height, model, yaw, pitch);
        assert.equal(renderer.hitTest(1, 1), false, 'background must not count as a face');
        for (const face of renderer.faces) {
          if (!face.color) continue;
          for (const axis of axes) {
            if (Math.abs(face.normal[axis]) > 0.5) continue;
            const swipe = gesture(face, order, axis, yaw, pitch);
            if (swipe.length < 0.0001) continue;
            // Skip covered geometry; only the topmost face receives a touch.
            if (renderer.faceAt(swipe.x, swipe.y) !== face) continue;
            assert.equal(renderer.hitTest(swipe.x, swipe.y), true);
            for (const sign of [-1, 1]) {
              const move = renderer.pickMove(swipe.x, swipe.y,
                swipe.x + sign * swipe.dx, swipe.y + sign * swipe.dy, model, yaw, pitch);
              const label = `${order} yaw=${yaw} pitch=${pitch} cubie=${face.cubie.id} ${axis}/${sign}`;
              assert.ok(move instanceof CubeMove, label);
              assert.equal(move.axis, axis, label);
              assert.equal(move.layer, face.cubie[axis], label);
              assert.equal(move.turns, sign, label);
              coverage.add(`${axis}/${move.layer}/${sign}`);
              picks++;
            }
          }
        }
      }
    }
    for (const axis of axes) for (let layer = 0; layer < order; layer++) for (const sign of [-1, 1]) {
      assert.ok(coverage.has(`${axis}/${layer}/${sign}`), `missing gesture coverage ${axis}/${layer}/${sign}`);
    }
    assert.equal(snapshot(model), before, 'drawing and picking must be read-only');
    t.diagnostic(`${picks} signed picks; all ${3 * order * 2} axis/layer/sign combinations covered`);
  });
}

test('public hit/pick guards, known front-face signs, and Canvas state restoration', () => {
  const model = new CubeModel(3);
  const renderer = new CubeRenderer();
  const context = new CheckingCanvas();
  assert.equal(renderer.hitTest(210, 250), false);
  assert.equal(renderer.pickMove(210, 250, 250, 250, model, 0, 0), null);
  context.globalAlpha = 0.37;
  context.fillStyle = '#abcdef';
  renderer.draw(context, width, height, model, 0, 0);
  assert.equal(context.globalAlpha, 0.37);
  assert.equal(context.fillStyle, '#abcdef');
  assert.equal(renderer.hitTest(210, 250), true);
  // Known independent signs: front right swipe => +Y; front up swipe => -X.
  for (const [endX, endY, axis, turns] of [[250, 250, 'y', 1], [170, 250, 'y', -1],
    [210, 210, 'x', -1], [210, 290, 'x', 1]]) {
    const move = renderer.pickMove(210, 250, endX, endY, model, 0, 0);
    assert.ok(move instanceof CubeMove);
    assert.deepEqual([move.axis, move.layer, move.turns], [axis, 1, turns]);
  }
  for (const [x, y] of [[-1, 250], [421, 250], [1, 1], [NaN, 250], [210, Infinity]]) {
    assert.equal(renderer.hitTest(x, y), false);
    assert.equal(renderer.pickMove(x, y, 250, 250, model, 0, 0), null);
  }
  assert.equal(renderer.pickMove(210, 250, 211, 250, model, 0, 0), null, 'short drag');
  assert.equal(renderer.pickMove(210, 250, NaN, 250, model, 0, 0), null, 'invalid endpoint');
  assert.equal(renderer.pickMove(210, 250, 250, 250, model, 0.1, 0), null, 'stale camera');
  assert.equal(renderer.pickMove(210, 250, 250, 250, new CubeModel(3), 0, 0), null, 'other model');
  model.applyMove(new CubeMove('x', 1, 1), false);
  assert.equal(renderer.pickMove(210, 250, 250, 250, model, 0, 0), null, 'moved hit cubie needs redraw');
  renderer.draw(context, 0, height, model, 0, 0);
  assert.equal(renderer.hitTest(210, 250), false, 'invalid size clears old hit geometry');
  renderer.draw(context, width, height, model, NaN, 0);
  assert.equal(renderer.hitTest(210, 250), false, 'invalid camera clears old hit geometry');
  assert.equal(context.stack.length, 0);
});
