// Run with Node 24: node --test tests/intro-demo.test.mjs
// Checks the first-run gesture demo in IntroPage.ets against the real CubeModel/CubeRenderer.
// No DOM, package dependencies, source edits, or project-local generated files.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from 'node:module';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Script } from 'node:vm';

const temporary = await mkdtemp(join(tmpdir(), 'intro-demo-test-'));
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

const introSource = await readFile(new URL('../entry/src/main/ets/components/IntroPage.ets', import.meta.url), 'utf8');
const indexSource = await readFile(new URL('../entry/src/main/ets/pages/Index.ets', import.meta.url), 'utf8');

// ---------- Source extraction helpers (shared by later property and source-shape tests) ----------

/** Returns capture group 1 of a regex that must match exactly once in `source`. */
function extractOne(source, pattern, label) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const matches = [...source.matchAll(new RegExp(pattern.source, flags))];
  assert.equal(matches.length, 1, `expected exactly one ${label} in IntroPage.ets`);
  return matches[0][1] ?? matches[0][0];
}

/** Reads a `const NAME: number = <literal>;` module constant from IntroPage.ets. */
function numericConstant(name) {
  const text = extractOne(introSource, new RegExp(`const ${name}: number = (-?[\\d.]+);`), name);
  const value = Number(text);
  assert.ok(Number.isFinite(value), `${name} must be a finite number literal`);
  return value;
}

/**
 * Returns the text of a class member or top-level function that starts at `header` and ends at its
 * matching closing brace. Braces inside strings are not expected in IntroPage.ets.
 */
function blockFrom(source, header, label) {
  const start = source.indexOf(header);
  assert.ok(start >= 0, `missing ${label} in IntroPage.ets`);
  assert.equal(source.indexOf(header, start + 1), -1, `duplicate ${label} in IntroPage.ets`);
  const open = source.indexOf('{', start + header.length - 1);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  assert.fail(`unbalanced braces in ${label}`);
}

const DEMO_YAW = numericConstant('DEMO_YAW');
const DEMO_PITCH = numericConstant('DEMO_PITCH');

const demoBaseInitializer = extractOne(introSource,
  /private readonly demoBase: CubeMove\[\] = \[([^\]]*)\];/, 'demoBase initializer');
const demoBaseSpecs = [...demoBaseInitializer.matchAll(/new CubeMove\('([xyz])', (\d+), (-?1)\)/g)]
  .map(([, axis, layer, turns]) => ({ axis, layer: Number(layer), turns: Number(turns) }));
assert.ok(demoBaseSpecs.length > 0, 'demoBase must list at least one CubeMove');
assert.equal(demoBaseInitializer.split('new CubeMove(').length - 1, demoBaseSpecs.length,
  'every demoBase entry must be a literal new CubeMove(axis, layer, ±1)');

// demoStageHeight plus the DEMO_STAGE_* constants it reads, evaluated without `export`.
const stageConstants = [...introSource.matchAll(/^const DEMO_STAGE_\w+: number = [^;\r\n]+;$/gm)].map(m => m[0]);
const stageFunction = blockFrom(introSource, 'export function demoStageHeight(', 'demoStageHeight');
const demoStageHeight = new Script(stripTypeScriptTypes(
  [...stageConstants, stageFunction.replace(/^export /, ''), 'demoStageHeight;'].join('\n'),
  { mode: 'strip' })).runInNewContext({});

// The demoMove formula, mirrored in JS. The source-match test below keeps the two in sync.
const DEMO_MOVE_FORMULA = [
  'const base = this.demoBase[Math.floor(index / 2) % this.demoBase.length];',
  'return index % 2 === 0 ? base : base.inverse();'
];
const demoBase = demoBaseSpecs.map(({ axis, layer, turns }) => new CubeMove(axis, layer, turns));
function demoMove(index) {
  const base = demoBase[Math.floor(index / 2) % demoBase.length];
  return index % 2 === 0 ? base : base.inverse();
}

// ---------- Seeded property-test helpers ----------

/** mulberry32: small deterministic 32-bit PRNG returning floats in [0, 1). */
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randomInt(random, min, max) { return min + Math.floor(random() * (max - min + 1)); }

/**
 * Runs `check(input, iteration)` on `iterations` inputs from `generate(random)`. A failure is
 * rethrown with the seed, iteration and generated input so it can be reproduced.
 */
function forAll({ seed = 0x1D3E0, iterations = 100, generate, check }) {
  const random = mulberry32(seed);
  for (let i = 0; i < iterations; i++) {
    const input = generate(random);
    try {
      check(input, i);
    } catch (error) {
      const shown = JSON.stringify(input, (_k, v) => typeof v === 'number' && !Number.isFinite(v) ? String(v) : v);
      error.message = `${error.message}\n  seed=${seed} iteration=${i} input=${shown}`;
      throw error;
    }
  }
}

/** Minimal Canvas 2D stand-in; the renderer only needs these calls to build hit geometry. */
class NullCanvas {
  globalAlpha = 1; lineJoin = 'miter'; lineCap = 'butt';
  fillStyle = '#000000'; strokeStyle = '#000000'; lineWidth = 1;
  save() {} restore() {} clearRect() {} beginPath() {} moveTo() {} lineTo() {}
  closePath() {} fill() {} stroke() {} arc() {}
}

function moveKey(move) { return `${move.axis}/${move.layer}/${move.turns}`; }

// ---------- Tests ----------

test('IntroPage demo extraction: camera, demoBase, demoMove mirror and demoStageHeight', () => {
  assert.ok(Number.isFinite(DEMO_YAW) && Number.isFinite(DEMO_PITCH));
  assert.deepEqual(demoBaseSpecs, [{ axis: 'y', layer: 1, turns: 1 }, { axis: 'x', layer: 1, turns: 1 }]);
  const demoMoveBlock = blockFrom(introSource, 'private demoMove(index: number): CubeMove {', 'demoMove');
  for (const line of DEMO_MOVE_FORMULA) {
    assert.ok(demoMoveBlock.includes(line), `IntroPage demoMove must contain verbatim: ${line}`);
  }
  assert.deepEqual([0, 1, 2, 3, 4].map(i => moveKey(demoMove(i))), ['y/1/1', 'y/1/-1', 'x/1/1', 'x/1/-1', 'y/1/1']);
  assert.ok(demoMove(0) instanceof CubeMove);
  assert.equal(stageConstants.length, 4, 'DEMO_STAGE_MIN/MAX/DEFAULT/RATIO');
  assert.equal(typeof demoStageHeight, 'function');
  assert.equal(demoStageHeight(800), 320);
  assert.equal(demoStageHeight(Number.NaN), 300);
  // Harness smoke check: the real renderer answers a guide for the first demo move.
  const renderer = new CubeRenderer();
  renderer.draw(new NullCanvas(), 316, 300, new CubeModel(3), DEMO_YAW, DEMO_PITCH);
  assert.ok(renderer.getSwipeGuide(demoMove(0)) instanceof CubeSwipeGuide);
  assert.ok(indexSource.length > 0);
  // PRNG is deterministic per seed.
  const a = mulberry32(42); const b = mulberry32(42);
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
  forAll({ iterations: 10, generate: random => randomInt(random, 1, 6), check: n => assert.ok(n >= 1 && n <= 6) });
});

// ---------- Property tests ----------

/** Angle (deg) between the guide segment and the screen axis the move should follow. */
function pathAngle(guide, axis) {
  const dx = guide.endX - guide.startX;
  const dy = guide.endY - guide.startY;
  const fromHorizontal = Math.atan2(Math.abs(dy), Math.abs(dx)) * 180 / Math.PI;
  return axis === 'y' ? fromHorizontal : 90 - fromHorizontal;
}

// Feature: intro-gesture-polish, Property 1: Demo guides are front-face and axis-aligned
test('Property 1: demo swipes start on the front face of the turning layer and run straight', () => {
  const period = demoBase.length * 2;
  forAll({
    seed: 0xA11CE,
    iterations: 120,
    generate: random => ({ width: randomInt(random, 280, 480), height: randomInt(random, 220, 360) }),
    check: ({ width, height }) => {
      const model = new CubeModel(3);
      const renderer = new CubeRenderer();
      for (let i = 0; i < period; i++) {
        const move = demoMove(i);
        renderer.draw(new NullCanvas(), width, height, model, DEMO_YAW, DEMO_PITCH);
        const guide = renderer.getSwipeGuide(move);
        assert.ok(guide instanceof CubeSwipeGuide, `guide for ${moveKey(move)}`);
        const hit = renderer.boxHit(guide.startX, guide.startY);
        assert.ok(hit, `start of ${moveKey(move)} hits the cube`);
        assert.deepEqual([hit.normal.x, hit.normal.y, hit.normal.z], [0, 0, 1], `${moveKey(move)} starts on +z`);
        assert.equal(hit[move.axis], move.layer, `${moveKey(move)} starts on the turning layer`);
        const angle = pathAngle(guide, move.axis);
        assert.ok(angle <= 8, `${moveKey(move)} path is ${angle.toFixed(2)}° off axis`);
        model.applyMove(move, false);
      }
    }
  });
});

// Feature: intro-gesture-polish, Property 2: Demo_Sequence pairs return the model to solved
test('Property 2: every move/inverse pair returns the demo cube to solved', () => {
  const axes = new Set(Array.from({ length: demoBase.length * 2 }, (_v, i) => demoMove(i).axis));
  assert.ok(axes.has('x') && axes.has('y'), 'sequence has a row and a column swipe');
  forAll({
    seed: 0xB0B,
    iterations: 100,
    generate: random => randomInt(random, 1, 40),
    check: pairs => {
      const model = new CubeModel(3);
      for (let i = 0; i < pairs * 2; i++) model.applyMove(demoMove(i), false);
      assert.equal(model.isSolved(), true);
    }
  });
});

// Feature: intro-gesture-polish, Property 3: Stage height is clamped and monotone
test('Property 3: demoStageHeight is an integer in [220, 360] and never shrinks as the page grows', () => {
  for (const special of [Number.NaN, Infinity, -Infinity, 0, -0]) {
    assert.equal(demoStageHeight(special), 300);
  }
  forAll({
    seed: 0x5EED,
    iterations: 200,
    generate: random => {
      const a = random() < 0.3 ? randomInt(random, -1000, 3000) : -1000 + random() * 4000;
      const b = -1000 + random() * 4000;
      return [a, b];
    },
    check: ([a, b]) => {
      for (const h of [a, b]) {
        const value = demoStageHeight(h);
        assert.ok(Number.isInteger(value) && value >= 220 && value <= 360, `height ${value} for ${h}`);
      }
      const [low, high] = [a, b].filter(v => v > 0).sort((p, q) => p - q);
      if (high !== undefined) assert.ok(demoStageHeight(low) <= demoStageHeight(high));
    }
  });
});

// ---------- Source-shape checks ----------

const buildBlock = blockFrom(introSource, '  build() {', 'build');
const cardBlock = blockFrom(introSource, 'private gestureCard(', 'gestureCard');
const frameBlock = blockFrom(introSource, 'private demoFrame(): void {', 'demoFrame');

test('IntroPage camera is front-facing and separate from the game camera', () => {
  assert.ok(Math.abs(DEMO_YAW) >= 0.15 && Math.abs(DEMO_YAW) <= 0.35);
  assert.ok(DEMO_PITCH >= -0.35 && DEMO_PITCH <= -0.15);
  assert.equal(frameBlock.split('DEMO_YAW, DEMO_PITCH').length - 1, 2, 'both demo draws use the demo camera');
  assert.match(indexSource, /private yaw: number = 0\.62;/);
  assert.match(indexSource, /private pitch: number = -0\.42;/);
});

test('IntroPage demo loop shares one move and progress between the layer and the fingertip', () => {
  const rest = frameBlock.indexOf('this.demoModel, DEMO_YAW, DEMO_PITCH);');
  const guide = frameBlock.indexOf('this.demoGuide = this.demoRenderer.getSwipeGuide(this.demoMove(cycle));');
  assert.ok(rest >= 0 && guide > rest, 'guide is fetched after a rest frame');
  assert.match(frameBlock, /DEMO_YAW, DEMO_PITCH, move, progress\);\s*this\.drawTouch\(t, progress\);/);
  assert.match(introSource, /if \(guide === null\) \{ return; \}/);
});

test('IntroPage pins the start button in a bottom bar outside the scroll', () => {
  const scroll = buildBlock.indexOf('Scroll() {');
  const scrollEnd = buildBlock.indexOf('.layoutWeight(1).scrollBar(BarState.Off)');
  const start = buildBlock.indexOf(".id('intro-start')");
  assert.ok(scroll >= 0 && scrollEnd > scroll && start > scrollEnd, 'intro-start follows the Scroll');
  assert.match(introSource, /const CONTENT_MAX_WIDTH: number = 520;/);
  assert.equal(buildBlock.split('constraintSize({ maxWidth: CONTENT_MAX_WIDTH })').length - 1, 2);
  assert.match(buildBlock, /\.attributeModifier\(CubeButtons\.hero\)\.id\('intro-start'\)/);
  assert.match(buildBlock, /\.accessibilityText\(\$r\('app\.string\.intro_start'\)\)/);
  assert.match(buildBlock, /sys\.symbol\.arrow_right/);
  assert.match(buildBlock, /\.onClick\(\(\) => this\.onDone\(\)\)/);
});

test('IntroPage stage adapts its height and keeps the badge in the bottom-right corner', () => {
  assert.match(buildBlock, /Stack\(\{ alignContent: Alignment\.BottomEnd \}\)/);
  assert.match(buildBlock, /\.margin\(\{ right: CubeSpace\.s, bottom: CubeSpace\.s \}\)/);
  assert.match(buildBlock, /intro_demo_badge[\s\S]*?CubeTheme\.overlay[\s\S]*?HitTestMode\.None/);
  assert.match(buildBlock, /\.height\(this\.stageHeight\)/);
  assert.match(buildBlock, /demoStageHeight\(Number\(area\.height\)\)/);
  assert.match(buildBlock, /this\.demoGuideStale = true;/);
  assert.match(buildBlock, /CubeTheme\.stageStart, 0\], \[CubeTheme\.stageEnd, 1\]/);
  assert.match(buildBlock, /\.clip\(true\)/);
  assert.match(buildBlock, /intro_stage_accessibility/);
  assert.match(buildBlock, /\.id\('intro-demo-canvas'\)[\s\S]*?HitTestMode\.None[\s\S]*?accessibilityLevel\('no'\)/);
});

test('IntroPage layout keeps its order, uses cards and theme tokens only', () => {
  const order = ['brand_name', 'intro_title', 'intro-demo-canvas', 'intro_swipe_title', 'intro-start']
    .map(marker => buildBlock.indexOf(marker));
  assert.ok(order.every(i => i >= 0), 'all layout markers present');
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'brand, title, stage, cards, button');
  assert.match(cardBlock, /\.backgroundColor\(CubeTheme\.surface\)/);
  assert.match(cardBlock, /\.borderRadius\(CubeRadius\.\w+\)/);
  assert.match(cardBlock, /\.padding\(CubeSpace\.\w+\)/);
  assert.doesNotMatch(introSource, /gestureRow/);
  for (const block of [buildBlock, cardBlock]) {
    assert.doesNotMatch(block, /(fontSize|padding|margin|borderRadius|width|height)\(\s*\d/);
    assert.doesNotMatch(block, /(space|left|right|top|bottom): \d/);
    assert.doesNotMatch(block, /#[0-9A-Fa-f]{3,8}\b/);
    for (const [, argument] of block.matchAll(/fontSize\(([^)]*)\)/g)) assert.match(argument, /^CubeFont\.\w+$/);
  }
  const keys = new Set([...introSource.matchAll(/\$r\('app\.string\.(\w+)'\)/g)].map(m => m[1]));
  assert.deepEqual([...keys].sort(), ['brand_name', 'brand_tagline', 'intro_demo_badge', 'intro_orbit_desc',
    'intro_orbit_title', 'intro_stage_accessibility', 'intro_start', 'intro_subtitle', 'intro_swipe_desc',
    'intro_swipe_title', 'intro_title']);
});

test('IntroPage keeps its own demo model, onDone-only completion and timer lifecycle', () => {
  assert.match(introSource, /private demoModel: CubeModel = new CubeModel\(3\);/);
  assert.match(introSource, /private demoRenderer: CubeRenderer = new CubeRenderer\(\);/);
  assert.doesNotMatch(introSource, /AppStorage|CubeStore|PersistentStorage/);
  assert.match(blockFrom(introSource, 'aboutToAppear(): void {', 'aboutToAppear'), /setInterval/);
  assert.match(blockFrom(introSource, 'aboutToDisappear(): void {', 'aboutToDisappear'), /clearInterval/);
});
