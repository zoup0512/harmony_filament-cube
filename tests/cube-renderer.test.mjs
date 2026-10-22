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
let CubeSwipeGuide;
try {
  const modelSource = await readFile(new URL('../entry/src/main/ets/model/CubeModel.ts', import.meta.url), 'utf8');
  const rendererSource = await readFile(new URL('../entry/src/main/ets/render/CubeRenderer.ets', import.meta.url), 'utf8');
  const modelImport = /(['"])\.\.\/model\/CubeModel\1/g;
  assert.equal([...rendererSource.matchAll(modelImport)].length, 1, 'expected exactly one model import');
  const rewrittenRenderer = rendererSource.replace(modelImport, "'./CubeModel.mjs'");
  await writeFile(join(temporary, 'CubeModel.mjs'), stripTypeScriptTypes(modelSource, { mode: 'strip' }));
  await writeFile(join(temporary, 'CubeRenderer.mjs'), stripTypeScriptTypes(rewrittenRenderer, { mode: 'strip' }));
  ({ CubeModel, CubeMove } = await import(pathToFileURL(join(temporary, 'CubeModel.mjs')).href));
  ({ CubeRenderer, CubeSwipeGuide } = await import(pathToFileURL(join(temporary, 'CubeRenderer.mjs')).href));
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

// Independent Android gesture oracle: axis cross face normal, camera rotation,
// then screen XY projection. The former actual-rotation derivative was too strong:
// Android intentionally rejects near-collinear axes and follows face rows/columns,
// rather than position-dependent perspective velocities.
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
  const n = face.normal;
  const velocity = axis === 'x' ? [0, -n.z, n.y] :
    axis === 'y' ? [n.z, 0, -n.x] : [-n.y, n.x, 0];
  const p = camera(point, yaw, pitch);
  const v = camera(velocity, yaw, pitch);
  const denominator = 6 - p[2];
  const focal = Math.min(width, height) * 1.48;
  const tx = v[0];
  const ty = -v[1];
  const length = Math.hypot(tx, ty);
  return {
    x: width / 2 + focal * p[0] / denominator,
    y: height / 2 - focal * p[1] / denominator,
    dx: 30 * tx / length,
    dy: 30 * ty / length,
    length
  };
}

function envelopeHit(x, y, order, yaw, pitch) {
  // Independent slab ray/AABB oracle, inverse rotation by matrix transpose.
  const basis = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(p => camera(p, yaw, pitch));
  const inverse = p => basis.map(b => b.reduce((sum, value, i) => sum + value * p[i], 0));
  const origin = inverse([0, 0, 6]);
  const ray = inverse([(x - width / 2) / (Math.min(width, height) * 1.48),
    -(y - height / 2) / (Math.min(width, height) * 1.48), -1]);
  let near = -Infinity;
  let far = Infinity;
  let normal;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(ray[a]) < 1e-10) {
      if (Math.abs(origin[a]) > 1) return null;
      continue;
    }
    const t0 = (-1 - origin[a]) / ray[a];
    const t1 = (1 - origin[a]) / ray[a];
    if (Math.min(t0, t1) > near) {
      near = Math.min(t0, t1);
      normal = [0, 0, 0];
      normal[a] = ray[a] > 0 ? -1 : 1;
    }
    far = Math.min(far, Math.max(t0, t1));
  }
  if (near > far || near <= 0) return null;
  const point = origin.map((o, a) => o + near * ray[a]);
  return { normal, layer: point.map(p => Math.max(0, Math.min(order - 1, Math.floor((p + 1) * order / 2)))) };
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
            // The interaction envelope, not recessed plastic, decides the face.
            const hit = envelopeHit(swipe.x, swipe.y, order, yaw, pitch);
            if (!hit || axes.some((key, i) => hit.normal[i] !== face.normal[key] || hit.layer[i] !== face[key])) continue;
            assert.equal(renderer.hitTest(swipe.x, swipe.y), true);
            const otherAxis = axes.find(key => key !== axis && Math.abs(face.normal[key]) < 0.5);
            const other = gesture(face, order, otherAxis, yaw, pitch);
            const secondScore = other.length < 0.0001 ? 0 : Math.abs(swipe.dx * other.dx + swipe.dy * other.dy) / 900;
            for (const sign of [-1, 1]) {
              const move = renderer.pickMove(swipe.x, swipe.y,
                swipe.x + sign * swipe.dx, swipe.y + sign * swipe.dy, model, yaw, pitch);
              const label = `${order} yaw=${yaw} pitch=${pitch} cubie=${face.cubie.id} ${axis}/${sign}`;
              if (1 - secondScore < 0.15) {
                assert.equal(move, null, `ambiguous projected axes must reject: ${label}`);
                continue;
              }
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

function moveKey(move) { return `${move.axis}/${move.layer}/${move.turns}`; }
function screen(point, yaw, pitch) {
  const p = camera(point, yaw, pitch);
  const scale = Math.min(width, height) * 1.48 / (6 - p[2]);
  return { x: width / 2 + p[0] * scale, y: height / 2 - p[1] * scale };
}
function contains(polygon, x, y) {
  const crosses = polygon.map((a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    return (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
  });
  return crosses.every(c => c >= -1e-7) || crosses.every(c => c <= 1e-7);
}

for (const order of [2, 3, 4, 5]) {
  test(`${order}x${order}: every guide target is reachable at multiple views and round-trips through picking`, t => {
    const renderer = new CubeRenderer();
    const model = seededModel(order);
    const context = new CheckingCanvas();
    const before = snapshot(model);
    const coverage = new Map();
    let count = 0;
    let unavailable = 0;
    for (const yaw of yawAngles) for (const pitch of pitchAngles) {
      renderer.draw(context, width, height, model, yaw, pitch);
      for (const axis of axes) for (let layer = 0; layer < order; layer++) for (const turns of [-1, 1]) {
        const target = new CubeMove(axis, layer, turns);
        const guide = renderer.getSwipeGuide(target);
        if (guide === null) { unavailable++; continue; }
        assert.ok(guide instanceof CubeSwipeGuide);
        const { startX, startY, endX, endY } = guide;
        assert.ok([startX, startY, endX, endY].every(Number.isFinite));
        assert.ok(Math.abs(Math.hypot(endX - startX, endY - startY) - 55) < 1e-7);
        assert.ok(Math.min(startX, endX) >= 10 && Math.max(startX, endX) <= width - 10);
        assert.ok(Math.min(startY, endY) >= 10 && Math.max(startY, endY) <= height - 10);
        const hit = envelopeHit(startX, startY, order, yaw, pitch);
        assert.ok(hit);
        assert.equal(hit.layer[axes.indexOf(axis)], layer);
        const sticker = renderer.faces.find(face => face.sticker.length === 4 &&
          axes.every((key, i) => face.normal[key] === hit.normal[i] && face[key] === hit.layer[i]) &&
          contains(face.sticker, startX, startY));
        assert.ok(sticker, 'guide starts on an exposed sticker, not a seam or hidden face');
        const expected = gesture(sticker, order, axis, yaw, pitch);
        assert.ok(((endX - startX) * expected.dx + (endY - startY) * expected.dy) * turns > 0);
        const picked = renderer.pickMove(startX, startY, endX, endY, model, yaw, pitch);
        assert.ok(picked, `guide must pick ${moveKey(target)} at ${yaw}/${pitch}`);
        assert.equal(moveKey(picked), moveKey(target));
        assert.deepEqual(renderer.getSwipeGuide(target), guide, 'guide selection is deterministic');
        coverage.set(moveKey(target), (coverage.get(moveKey(target)) ?? 0) + 1);
        count++;
      }
    }
    for (const axis of axes) for (let layer = 0; layer < order; layer++) for (const turns of [-1, 1]) {
      const key = `${axis}/${layer}/${turns}`;
      assert.ok(coverage.get(key) >= 2, `${key} must be reachable from multiple views`);
    }
    assert.ok(unavailable > 0, 'edge-on or hidden targets return null instead of incorrect guidance');
    assert.equal(snapshot(model), before);
    t.diagnostic(`${count} validated guide arrows, ${unavailable} explicit rotate-view fallbacks`);
  });

  test(`${order}x${order}: seams and outer box edges hit with clamped layers`, () => {
    const renderer = new CubeRenderer();
    const model = new CubeModel(order);
    const context = new CheckingCanvas();
    renderer.draw(context, width, height, model, 0, 0);
    for (let seam = 1; seam < order; seam++) {
      for (const offset of [-0.004, 0, 0.004]) {
        const worldX = -1 + 2 * seam / order + offset;
        const p = screen([worldX, 0.17, 1], 0, 0);
        assert.equal(renderer.hitTest(p.x, p.y), true, 'real plastic gap belongs to cube');
        // At the front seam the point is not inside any outer front plastic quad.
        assert.equal(renderer.faces.some(face => face.normal.z === 1 && face.z === order - 1 &&
          contains(face.outline, p.x, p.y)), false);
        const move = renderer.pickMove(p.x, p.y, p.x, p.y + 55, model, 0, 0);
        assert.ok(move);
        assert.equal(move.axis, 'x');
        assert.equal(move.turns, 1);
        const oracle = envelopeHit(p.x, p.y, order, 0, 0);
        assert.equal(move.layer, oracle.layer[0]);
      }
    }
    for (const x of [-1, 1]) {
      const p = screen([x, 0, 1], 0, 0);
      const move = renderer.pickMove(p.x, p.y, p.x, p.y + 55, model, 0, 0);
      assert.ok(move);
      assert.equal(move.layer, x < 0 ? 0 : order - 1);
      const outside = screen([x * 1.001, 0, 1], 0, 0);
      assert.equal(renderer.hitTest(outside.x, outside.y), false);
    }
    // Seams on all six sides and oblique cameras use the nearest envelope face.
    let hits = 0;
    for (const yaw of yawAngles) for (const pitch of pitchAngles) {
      renderer.draw(context, width, height, model, yaw, pitch);
      for (let normalAxis = 0; normalAxis < 3; normalAxis++) for (const side of [-1, 1]) {
        for (let seam = 1; seam < order; seam++) {
          const world = [0.13, 0.13, 0.13];
          world[normalAxis] = side;
          world[(normalAxis + 1) % 3] = -1 + 2 * seam / order;
          const p = screen(world, yaw, pitch);
          const hit = envelopeHit(p.x, p.y, order, yaw, pitch);
          if (!hit || hit.normal[normalAxis] !== side) continue;
          assert.equal(renderer.hitTest(p.x, p.y), true);
          const actual = renderer.boxHit(p.x, p.y);
          assert.deepEqual(axes.map(key => actual.normal[key]), hit.normal);
          // Different inverse arithmetic can assign the exact seam to either
          // neighbor; both are valid, but neither may fall outside the cube.
          assert.ok(axes.every(key => Number.isInteger(actual[key]) && actual[key] >= 0 && actual[key] < order));
          hits++;
        }
      }
    }
    assert.ok(hits > 50);
  });
}

test('Android score and ambiguity gates reject diagonals, including two high-scoring axes', () => {
  const renderer = new CubeRenderer();
  const model = new CubeModel(3);
  const context = new CheckingCanvas();
  let lowScore = 0;
  let ambiguous = 0;
  let accepted = 0;
  for (const [yaw, pitch] of [[0, 0], [0.62, -0.42], [-0.8, 0.73], [0.8, 1.3]]) {
    renderer.draw(context, width, height, model, yaw, pitch);
    const hit = envelopeHit(210, 250, 3, yaw, pitch);
    const face = { x: hit.layer[0], y: hit.layer[1], z: hit.layer[2],
      normal: { x: hit.normal[0], y: hit.normal[1], z: hit.normal[2] } };
    for (let angle = 0; angle < 360; angle++) {
      const dx = Math.cos(angle * Math.PI / 180) * 55;
      const dy = Math.sin(angle * Math.PI / 180) * 55;
      const scores = axes.filter(axis => !face.normal[axis]).map(axis => {
        const tangent = gesture(face, 3, axis, yaw, pitch);
        const dot = (dx * tangent.dx + dy * tangent.dy) / (55 * 30);
        return { axis, score: Math.abs(dot), turns: dot >= 0 ? 1 : -1 };
      }).sort((a, b) => b.score - a.score);
      const [best, second] = scores;
      const move = renderer.pickMove(210, 250, 210 + dx, 250 + dy, model, yaw, pitch);
      if (best.score < 0.75 || best.score - second.score < 0.15) {
        assert.equal(move, null, `reject angle ${angle} at ${yaw}/${pitch}`);
        if (best.score < 0.75) lowScore++;
        else ambiguous++;
      } else {
        assert.ok(move);
        assert.deepEqual([move.axis, move.layer, move.turns], [best.axis, face[best.axis], best.turns]);
        accepted++;
      }
    }
  }
  assert.ok(lowScore > 0 && ambiguous > 0 && accepted > 0);
});

test('beginner arrows fit stickers and match reversible row/column gestures across views', () => {
  let checked = 0;
  for (const order of [2, 3, 4, 5]) {
    const model = seededModel(order);
    const before = snapshot(model);
    for (const [w, h] of [[280, 240], [420, 500]]) {
      for (const yaw of yawAngles) {
        for (const pitch of pitchAngles) {
          const renderer = new CubeRenderer();
          renderer.draw(new CheckingCanvas(), w, h, model, yaw, pitch);
          const guides = renderer.getBeginnerGuides();
          for (const guide of guides) {
            const { startX: x, startY: y } = guide;
            const dx = guide.endX - x;
            const dy = guide.endY - y;
            const radius = Math.hypot(dx, dy);
            assert.ok(radius >= 5.5 - 1e-9 && radius <= 12 + 1e-9);
            const hit = renderer.boxHit(x, y);
            assert.ok(hit);
            const face = renderer.faces.find(f => f.sticker.length === 4 &&
              axes.every(axis => f[axis] === hit[axis] && f.normal[axis] === hit.normal[axis]));
            assert.ok(face, 'marker must start on a visible sticker');
            for (let j = 0; j < 4; j++) {
              const a = face.sticker[j];
              const b = face.sticker[(j + 1) % 4];
              const clearance = Math.abs((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x)) /
                Math.hypot(b.x - a.x, b.y - a.y);
              assert.ok(clearance >= radius + 2 - 1e-7, 'shaft, heads and halo must fit inside sticker');
            }
            const forward = renderer.pickMove(x, y, x + dx / radius * 55, y + dy / radius * 55, model, yaw, pitch);
            const backward = renderer.pickMove(x, y, x - dx / radius * 55, y - dy / radius * 55, model, yaw, pitch);
            assert.ok(forward && backward, 'both displayed directions must accept a full swipe');
            assert.equal(forward.axis, backward.axis);
            assert.equal(forward.layer, hit[forward.axis]);
            assert.equal(backward.layer, forward.layer);
            assert.equal(forward.turns, -backward.turns);
            assert.equal(hit.normal[forward.axis], 0, 'arrows describe tangential row/column turns');
            checked++;
          }
          if (yaw === 0.62 && pitch === -0.42) {
            assert.ok(guides.length > 0, `default view must show beginner arrows for ${order}x${order}`);
          }
        }
      }
    }
    assert.equal(snapshot(model), before, 'guides must not affect puzzle state or history');
  }
  assert.ok(checked > 1000);
});

class GuideCanvas extends CheckingCanvas {
  arcs = [];
  strokes = [];
  arc(x, y, radius, start, end) {
    assert.ok([x, y, radius, start, end].every(Number.isFinite));
    this.arcs.push([x, y, radius]);
    this.vertices++;
  }
  fill() { assert.ok(this.vertices > 0); this.fills++; }
  stroke() {
    assert.ok(this.vertices > 0);
    assert.ok(this.lineWidth > 0 && Number.isFinite(this.lineWidth));
    this.strokes.push(this.strokeStyle);
  }
}

test('beginner overlay restores Canvas and hides stale, animated or unreadably small markers', () => {
  const renderer = new CubeRenderer();
  const model = new CubeModel(3);
  const context = new CheckingCanvas();
  const overlay = new GuideCanvas();
  const move = new CubeMove('x', 0, 1);
  assert.deepEqual(renderer.getBeginnerGuides(), []);
  renderer.draw(context, width, height, model, 0.62, -0.42);
  const guides = renderer.getBeginnerGuides();
  assert.ok(guides.length > 0);
  const before = geometry(renderer);
  overlay.globalAlpha = 0.3;
  overlay.strokeStyle = '#123456';
  renderer.drawBeginnerGuides(overlay);
  assert.equal(overlay.globalAlpha, 0.3);
  assert.equal(overlay.strokeStyle, '#123456');
  assert.equal(overlay.lineWidth, 1);
  assert.equal(overlay.stack.length, 0);
  assert.equal(overlay.clears, 0);
  assert.equal(overlay.strokes.length, guides.length * 2);
  assert.deepEqual(geometry(renderer), before);
  for (const progress of [0, 0.5, 1]) {
    renderer.draw(context, width, height, model, 0.62, -0.42, move, progress);
    assert.deepEqual(renderer.getBeginnerGuides(), []);
    renderer.drawBeginnerGuides(overlay);
    assert.equal(overlay.strokes.length, guides.length * 2);
  }
  renderer.draw(context, width, height, model, 0.62, -0.42);
  model.applyMove(move, false);
  assert.deepEqual(renderer.getBeginnerGuides(), []);
  renderer.draw(context, width, height, model, 0.62, -0.42);
  model.reset();
  assert.deepEqual(renderer.getBeginnerGuides(), []);
  renderer.draw(context, 24, 24, model, 0.62, -0.42);
  assert.deepEqual(renderer.getBeginnerGuides(), []);
  renderer.draw(context, 0, height, model, 0.62, -0.42);
  assert.deepEqual(renderer.getBeginnerGuides(), []);
});

test('guide cache lifetime, invalidation, logical units, overlay and Canvas restoration', () => {
  const renderer = new CubeRenderer();
  const model = new CubeModel(3);
  const move = new CubeMove('y', 1, 1);
  const context = new CheckingCanvas();
  const overlay = new GuideCanvas();
  assert.equal(renderer.getSwipeGuide(move), null, 'must draw first');
  for (const [w, h] of [[210, 250], [420, 500], [840, 1000]]) {
    renderer.draw(context, w, h, model, 0, 0);
    const guide = renderer.getSwipeGuide(move);
    assert.ok(guide);
    assert.ok(Math.abs(Math.hypot(guide.endX - guide.startX, guide.endY - guide.startY) - 55) < 1e-7,
      '55 logical units, independent of viewport size / device pixel ratio');
    const before = geometry(renderer);
    overlay.globalAlpha = 0.3;
    overlay.strokeStyle = '#123456';
    renderer.drawGuide(overlay, guide);
    assert.equal(overlay.globalAlpha, 0.3);
    assert.equal(overlay.strokeStyle, '#123456');
    assert.equal(overlay.stack.length, 0);
    assert.equal(overlay.clears, 0, 'overlay must not erase cube');
    assert.deepEqual(geometry(renderer), before);
    assert.deepEqual(overlay.arcs.at(-1), [guide.startX, guide.startY, 7]);
    assert.deepEqual(overlay.strokes.slice(-3), ['#FFFFFF', '#1677FF', '#FFFFFF']);
    assert.equal(moveKey(renderer.pickMove(guide.startX, guide.startY, guide.endX, guide.endY, model, 0, 0)), moveKey(move));
  }
  assert.equal(renderer.getSwipeGuide(new CubeMove('z', 1, 1)), null, 'normal axis is unreachable head-on');
  assert.equal(renderer.getSwipeGuide(new CubeMove('y', 3, 1)), null, 'out of range target');
  for (const progress of [0, 0.5, 1]) {
    renderer.draw(context, width, height, model, 0, 0, move, progress);
    assert.equal(renderer.getSwipeGuide(move), null, 'even animation endpoints wait for stable redraw');
    assert.equal(renderer.hitTest(210, 250), true, 'busy cube surface must stay hittable so UI can block it');
    assert.equal(renderer.hitTest(1, 1), false, 'busy background remains available for orbit');
    assert.equal(renderer.pickMove(210, 250, 265, 250, model, 0, 0), null);
  }
  renderer.draw(context, width, height, model, 0, 0);
  const guide = renderer.getSwipeGuide(move);
  // Mutate a different layer: a hit-local stale check alone would miss this.
  model.applyMove(new CubeMove('x', 0, 1), false);
  assert.equal(renderer.getSwipeGuide(move), null);
  assert.equal(renderer.hitTest(guide.startX, guide.startY), false);
  assert.equal(renderer.pickMove(guide.startX, guide.startY, guide.endX, guide.endY, model, 0, 0), null);
  const strokes = overlay.strokes.length;
  renderer.drawGuide(overlay, guide);
  assert.equal(overlay.strokes.length, strokes, 'stale scene must not draw guide');
  renderer.draw(context, width, height, model, 0, 0);
  assert.ok(renderer.getSwipeGuide(move));
  model.reset();
  assert.equal(renderer.getSwipeGuide(move), null, 'same-order reset replaces cubies');
  renderer.draw(context, width, height, model, 0, 0);
  model.reset(4);
  assert.equal(renderer.getSwipeGuide(move), null, 'order changed');
  renderer.draw(context, 0, height, model, 0, 0);
  assert.equal(renderer.getSwipeGuide(move), null, 'invalid draw clears guide cache');
});
