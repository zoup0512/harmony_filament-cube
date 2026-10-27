#!/usr/bin/env node
// Run only after the rebuilt HAP is installed and no other UI driver is active.
// node D:/workspace/My/harmony/harmony_filament-cube/scripts/smoke.mjs
// HDC_TARGET defaults to 127.0.0.1:5633. No dependencies, install, or data clearing.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// This selects expected app resources; it does not change the device language.
// en, en-US and en-GB all use the app's English fallback resource directory.
const SMOKE_LOCALE = process.env.SMOKE_LOCALE || 'zh-CN';
const RESOURCE_LOCALE = /^en(?:[-_](?:US|GB))?$/i.test(SMOKE_LOCALE) ? 'en' : 'base';
if (RESOURCE_LOCALE === 'base' && !/^zh(?:[-_]CN)?$/i.test(SMOKE_LOCALE)) {
  throw new Error('SMOKE_LOCALE must be zh-CN, zh, en, en-US or en-GB');
}
const readStrings = directory => Object.fromEntries(JSON.parse(readFileSync(join(ROOT,
  'entry/src/main/resources', directory, 'element/string.json'), 'utf8')).string
  .map(({ name, value }) => [name, value]));
const BASE_STRINGS = readStrings('base');
const ENGLISH_STRINGS = readStrings('en');
const LOCALE_STRINGS = RESOURCE_LOCALE === 'en' ? ENGLISH_STRINGS : BASE_STRINGS;
// SMOKE_CASES=order-4,tutorial selects exact case names; unknown names fail before HDC.
// --check-gestures runs ONLY the real renderer/model checks, without HDC or artifacts.
const OUT = process.env.SMOKE_OUT ? resolve(process.env.SMOKE_OUT) : join(ROOT, 'verification', 'gestures');
const CASE_NAMES = ['order-2', 'order-4', 'order-5', 'order-3', 'tutorial', 'free-move-undo',
  'surface-swipe', 'scramble-timer-hint-back', 'gesture-guides-switch', 'statistics', 'settings-persistence'];
const SELECTED_CASES = process.env.SMOKE_CASES === undefined ? null :
  new Set(process.env.SMOKE_CASES.split(',').map(value => value.trim()).filter(Boolean));
if (SELECTED_CASES && (SELECTED_CASES.size === 0 || [...SELECTED_CASES].some(name => !CASE_NAMES.includes(name)))) {
  throw new Error(`SMOKE_CASES must contain comma-separated exact names: ${CASE_NAMES.join(', ')}`);
}
const HDC = 'C:/Program Files/Huawei/DevEco Studio/sdk/default/openharmony/toolchains/hdc.exe';
const TARGET = process.env.HDC_TARGET || '127.0.0.1:5633';
const BUNDLE = JSON.parse(readFileSync(join(ROOT, 'AppScope', 'app.json5'), 'utf8')).app.bundleName;
const REMOTE_JSON = '/data/local/tmp/razor-smoke.json';
const RUN_ID = `${Date.now()}-${process.pid}`;
const WAIT_MS = 15000;
const COMMAND_MS = 10000;
const MIN_COMMAND_MS = 2000;
const summary = {
  startedAt: new Date().toISOString(), target: TARGET, bundle: BUNDLE, locale: SMOKE_LOCALE,
  outputDirectory: OUT, status: 'running', results: [], artifacts: [], diagnostics: [], actions: [],
  policy: 'Never clear records or app data. Default order is restored to 3. Gesture guides may be toggled and are restored to their original value. Sound, haptics and speed are inspected, not changed.'
};
let latest;
let currentCase = 'startup';
let artifactNumber = 0;
let appStarted = false;

function saveSummary() {
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
}
function result(name, status, detail = {}) {
  const item = { case: currentCase, name, status, at: new Date().toISOString(), ...detail };
  summary.results.push(item);
  console.log(`[${status.toUpperCase()}] ${currentCase}: ${name}${detail.message ? ` — ${detail.message}` : ''}`);
  saveSummary();
  return item;
}
function check(condition, message, detail = {}) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}\n${JSON.stringify(detail)}`);
  result(message, 'pass', detail);
}
function hdc(args, timeout = COMMAND_MS) {
  let output;
  try {
    output = execFileSync(HDC, ['-t', TARGET, ...args.map(String)], {
      encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (error) {
    throw new Error(`hdc ${args.join(' ')} failed (${error.code || error.status || 'unknown'}): ${error.message}\n${error.stdout || ''}\n${error.stderr || ''}`);
  }
  // hdc can return exit code 0 even when the remote command failed.
  if (/\[Fail\]|\bfailed\b|\bfailure\b|\berror\s*[:=]|\berror:\b|not found|not connected|unknown command|invalid (?:argument|option)|usage:|permission denied|no such file/i.test(output)) {
    throw new Error(`hdc ${args.join(' ')} reported failure: ${output.trim()}`);
  }
  return output.trim();
}
const shell = (...args) => hdc(['shell', ...args]);
const normalize = value => String(value ?? '').replace(/[′’]/g, "'").replace(/\s+/g, ' ').trim();
function resourcePattern(template) {
  const positions = [];
  let pattern = '';
  let offset = 0;
  const literal = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const match of normalize(template).matchAll(/%(\d+)\$([sd])/g)) {
    pattern += literal(normalize(template).slice(offset, match.index));
    const position = Number(match[1]);
    const previous = positions.indexOf(position);
    if (previous >= 0) pattern += `\\${previous + 1}`;
    else {
      positions.push(position);
      pattern += match[2] === 'd' ? '(\\d+)' : '(.*?)';
    }
    offset = match.index + match[0].length;
  }
  pattern += literal(normalize(template).slice(offset));
  return { pattern: new RegExp(`^${pattern}$`), positions };
}
// Normalize only observed text, never query regexes or raw artifact trees. Full
// resource-template matches preserve every semantic assertion below in English.
// "Tutorial" is both the phase and action; use the action's canonical label.
const OBSERVED_RESOURCES = Object.entries(LOCALE_STRINGS)
  .filter(([key]) => key !== 'phase_tutorial')
  .map(([key, template]) => ({ key, ...resourcePattern(template),
    specificity: normalize(template).replace(/%\d+\$[sd]/g, '').length }))
  .sort((a, b) => b.specificity - a.specificity);
function observedText(value, depth = 0) {
  const text = normalize(value);
  if (RESOURCE_LOCALE === 'base' || depth > 3 || !text) return text;
  for (const { key, pattern, positions } of OBSERVED_RESOURCES) {
    const match = text.match(pattern);
    if (!match) continue;
    return normalize(BASE_STRINGS[key].replace(/%(\d+)\$[sd]/g, (_token, position) =>
      observedText(match[positions.indexOf(Number(position)) + 1], depth + 1)));
  }
  return text;
}
function bounds(value) {
  const numbers = String(value ?? '').match(/-?\d+(?:\.\d+)?/g)?.map(Number);
  if (!numbers || numbers.length !== 4) return null;
  const [left, top, right, bottom] = numbers;
  return right > left && bottom > top ? { left, top, right, bottom, width: right - left, height: bottom - top } : null;
}
function flatten(tree, parent = null, list = []) {
  if (!tree || typeof tree !== 'object') return list;
  const a = tree.attributes || {};
  const node = {
    a, parent, text: observedText(a.text), rawText: normalize(a.text), type: String(a.type || ''), bounds: bounds(a.bounds),
    enabled: a.enabled === true || a.enabled === 'true',
    visible: a.visible !== false && a.visible !== 'false', children: []
  };
  list.push(node);
  if (parent) parent.children.push(node);
  for (const child of tree.children || []) flatten(child, node, list);
  return list;
}
function usable(node, state = latest) {
  if (!node?.visible || !node.bounds || !state?.viewport) return false;
  const b = node.bounds;
  const v = state.viewport;
  const x = (b.left + b.right) / 2;
  const y = (b.top + b.bottom) / 2;
  if (x < v.left || x >= v.right || y < v.top || y >= v.bottom) return false;
  for (let p = node.parent; p; p = p.parent) {
    if (!p.visible) return false;
    if ((p.a.clip === 'true' || p.type === 'Scroll') && p.bounds &&
      (x < p.bounds.left || x >= p.bounds.right || y < p.bounds.top || y >= p.bounds.bottom)) return false;
  }
  return true;
}
function dump(timeout = COMMAND_MS) {
  const local = join(OUT, 'latest.json');
  rmSync(local, { force: true }); // Never accept a stale received layout.
  const deadline = Date.now() + timeout;
  hdc(['shell', 'uitest', 'dumpLayout', '-p', REMOTE_JSON], timeout);
  const receiveBudget = deadline - Date.now();
  if (receiveBudget < MIN_COMMAND_MS) {
    const error = new Error('Polling budget exhausted before file recv; keeping last complete layout');
    error.code = 'SMOKE_POLL_BUDGET';
    throw error;
  }
  hdc(['file', 'recv', REMOTE_JSON, local], receiveBudget);
  const tree = JSON.parse(readFileSync(local, 'utf8').replace(/^\uFEFF/, ''));
  const nodes = flatten(tree);
  const viewport = bounds(tree.attributes?.bounds);
  if (!viewport || nodes.length < 2) throw new Error('Invalid uitest layout: missing root bounds/children');
  latest = { tree, nodes, viewport, observedAt: new Date().toISOString() };
  return latest;
}
function matches(node, query) {
  const labels = [node.text, observedText(node.a.originalText), observedText(node.a.description)];
  return labels.some(label => query instanceof RegExp ? query.test(label) : label === normalize(query));
}
function find(state, query, type) {
  return state.nodes.find(n => (!type || n.type === type) && usable(n, state) && matches(n, query));
}
const has = (state, query) => Boolean(find(state, query));
const button = (state, query) => find(state, query, 'Button') || state.nodes.find(n =>
  n.type === 'Button' && usable(n, state) && descendants(n).some(child =>
    child !== n && child.type === 'Text' && usable(child, state) && matches(child, query)));
const enabledButton = (state, query) => button(state, query)?.enabled === true;
function alertDialog(state, title) {
  const dialogs = state.nodes.filter(n => n.type === 'AlertDialog' && usable(n, state) &&
    descendants(n).some(child => child.type === 'Text' && child.text === normalize(title) && usable(child, state)));
  return dialogs.length === 1 ? dialogs[0] : null;
}
function dialogAction(state, title, label) {
  const dialog = alertDialog(state, title);
  if (!dialog?.enabled) return null;
  // Exact text ONLY in this AlertDialog subtree. Never use global text or
  // description matching: the background header also says 返回首页.
  const nodes = descendants(dialog).filter(n => n.text === normalize(label) && n.enabled && usable(n, state));
  const texts = nodes.filter(n => n.type === 'Text');
  const candidates = texts.length ? texts : nodes.filter(n => n.type === 'Button');
  return candidates.length === 1 ? candidates[0] : null;
}
const leaveDialogReady = state => Boolean(dialogAction(state, '返回首页？', BASE_STRINGS.keep_playing) &&
  dialogAction(state, '返回首页？', '返回首页'));
async function tapDialog(title, label) {
  const state = await waitFor(`AlertDialog ${title}: ${label}`, s => Boolean(dialogAction(s, title, label)));
  tapNode(dialogAction(state, title, label), `AlertDialog ${title}: ${label}`);
}
const isHome = state => has(state, '选择你的挑战') && Boolean(button(state, /开始挑战/));
const isGame = (state, order) => has(state, new RegExp(`^${order}\\s*[×x]\\s*${order}\\s*魔方$`));
function diagnostic(state) {
  return state?.nodes.filter(n => usable(n, state) && n.text).map(n => ({
    text: n.text, type: n.type, enabled: n.enabled, bounds: n.a.bounds
  })).slice(0, 90) || [];
}
async function waitFor(description, predicate, timeout = WAIT_MS, stableSamples = 1) {
  const deadline = Date.now() + timeout;
  let consecutive = 0;
  let lastError = '';
  do {
    const remaining = deadline - Date.now();
    // Do not spawn a doomed command in the final <2s. The unmet predicate
    // still produces ASSERTION TIMEOUT below with the last complete layout.
    if (remaining < MIN_COMMAND_MS) break;
    let state;
    try {
      state = dump(Math.min(COMMAND_MS, remaining));
    } catch (error) {
      if (error.code === 'SMOKE_POLL_BUDGET') break;
      lastError = error.message;
      consecutive = 0;
      summary.diagnostics.push({ case: currentCase, operation: description, at: new Date().toISOString(), error: lastError });
      console.warn(`[RETRY] ${description}: ${lastError}`);
    }
    if (state) {
      // Predicate exceptions are real assertion/parser errors, not retryable transport failures.
      if (predicate(state)) {
        if (++consecutive >= stableSamples) return state;
      } else consecutive = 0;
    }
    if (Date.now() < deadline) await delay(Math.min(180, deadline - Date.now()));
  } while (Date.now() < deadline);
  throw new Error(`ASSERTION TIMEOUT (${timeout}ms): ${description}\nLast transport error: ${lastError || 'none'}\nObserved: ${JSON.stringify(diagnostic(latest))}`);
}
function tapNode(node, reason) {
  if (!usable(node) || !node.enabled) throw new Error(`ASSERTION FAILED: cannot tap disabled/offscreen ${reason}`);
  const b = node.bounds;
  const x = Math.round((b.left + b.right) / 2);
  const y = Math.round((b.top + b.bottom) / 2);
  summary.actions.push({ action: 'click', reason, text: node.text, type: node.type, bounds: node.a.bounds, x, y });
  shell('uitest', 'uiInput', 'click', x, y);
}
async function tap(query, description = String(query)) {
  const state = await waitFor(`enabled button ${description}`, s => enabledButton(s, query));
  tapNode(button(state, query), description);
}
// The icon-only back button carries no text; its stable id is the only dump-visible locator.
const backButton = state => state.nodes.find(n => n.a.id === 'back-button' && usable(n, state));
async function tapBack() {
  const state = await waitFor('enabled back button', s => backButton(s)?.enabled === true);
  tapNode(backButton(state), 'back button');
}
function swipe(node, start, end, reason) {
  if (!usable(node) || !node.enabled) throw new Error(`ASSERTION FAILED: swipe target unavailable: ${reason}`);
  const b = node.bounds;
  const point = ratio => [Math.round(b.left + b.width * ratio[0]), Math.round(b.top + b.height * ratio[1])];
  const [x1, y1] = point(start);
  const [x2, y2] = point(end);
  summary.actions.push({ action: 'swipe', reason, bounds: node.a.bounds, startRatio: start, endRatio: end, x1, y1, x2, y2 });
  // uitest's final swipe argument is velocity (pixels/second), not duration.
  shell('uitest', 'uiInput', 'swipe', x1, y1, x2, y2, 600);
}
async function reveal(description, predicate) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const state = dump();
    if (predicate(state)) return state;
    const scroll = state.nodes.find(n => n.type === 'Scroll' && usable(n, state) && n.enabled);
    if (!scroll || attempt === 4) break;
    swipe(scroll, [0.5, 0.82], [0.5, 0.30], `scroll to ${description}`);
  }
  return waitFor(description, predicate, 6000);
}
async function capture(label) {
  const stem = `${String(++artifactNumber).padStart(2, '0')}-${label.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const state = dump();
  const jsonPath = join(OUT, `${stem}.json`);
  const pngPath = join(OUT, `${stem}.png`);
  writeFileSync(jsonPath, JSON.stringify(state.tree, null, 2));
  rmSync(pngPath, { force: true });
  // screenCap can leave old trailing bytes when overwriting a shorter PNG.
  // Unique per capture AND run; retain the untouched remote original.
  const remotePng = `/data/local/tmp/razor-${RUN_ID}-${stem}.png`;
  shell('uitest', 'screenCap', '-p', remotePng);
  hdc(['file', 'recv', remotePng, pngPath]);
  const png = readFileSync(pngPath);
  if (png.length < 24 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error(`ASSERTION FAILED: screenCap did not produce PNG: ${pngPath}`);
  }
  let chunkOffset = 8;
  let complete = false;
  while (chunkOffset + 12 <= png.length) {
    const length = png.readUInt32BE(chunkOffset);
    const type = png.toString('ascii', chunkOffset + 4, chunkOffset + 8);
    const end = chunkOffset + 12 + length;
    if (end > png.length) break;
    if (type === 'IEND') {
      complete = length === 0 && end === png.length;
      break;
    }
    chunkOffset = end;
  }
  if (!complete) throw new Error(`ASSERTION FAILED: PNG truncated or has trailing bytes after IEND; original retained: ${pngPath} (remote ${remotePng})`);
  const size = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  if (size.width !== state.viewport.width || size.height !== state.viewport.height) {
    throw new Error(`ASSERTION FAILED: screenshot/layout coordinate spaces differ: ${JSON.stringify(size)} vs ${JSON.stringify(state.viewport)}`);
  }
  summary.artifacts.push({ case: currentCase, label, json: jsonPath, png: pngPath, remotePng, ...size });
  saveSummary();
  return state;
}
function descendants(node) {
  return node ? [node, ...node.children.flatMap(descendants)] : [];
}
function metric(state, label, pattern) {
  const labelNode = find(state, label, 'Text');
  const values = descendants(labelNode?.parent).filter(n => n.type === 'Text' && pattern.test(n.text));
  return values.length === 1 ? values[0].text : null;
}
const moves = state => {
  const value = metric(state, '步数', /^\d+$/);
  return value === null ? null : Number(value);
};
const timer = state => metric(state, '用时', /^\d+:\d{2}\.\d{2}$/);
function centiseconds(state) {
  const match = timer(state)?.match(/^(\d+):(\d{2})\.(\d{2})$/);
  return match ? Number(match[1]) * 6000 + Number(match[2]) * 100 + Number(match[3]) : null;
}
const gameCanvas = state => state.nodes.find(n => n.type === 'Canvas' && usable(n, state) && n.enabled);
// Action buttons are disabled while the renderer is animating; face buttons no longer exist.
const idleControls = state => Boolean(gameCanvas(state)) && enabledButton(state, '打乱') && enabledButton(state, '教程');
function assertTouchOnly(state) {
  // Inspect the entire dump, including offscreen/disabled descendants: hiding the old
  // controls below a scroll boundary is not removal of the twelve face buttons.
  const obsolete = state.nodes.filter(n =>
    (n.type === 'Button' && descendants(n).some(child =>
      [child.text, observedText(child.a.originalText), observedText(child.a.description)]
        .some(text => /^[UDLRFB]'?(?:\s*面转动)?$/.test(text)))) ||
    [n.text, observedText(n.a.originalText), observedText(n.a.description)].some(text => /转面控制|转面按钮/.test(text)));
  check(obsolete.length === 0, 'no twelve face buttons or obsolete face-control title/instructions', {
    obsolete: obsolete.map(n => ({ text: n.text, type: n.type, bounds: n.a.bounds }))
  });
  check(['打乱', '教程', '复位', /撤销/, BASE_STRINGS.history_help, '正视角'].every(label => button(state, label)),
    'retains scramble/tutorial/reset/undo/history/view controls');
}
function lesson(state) {
  for (const node of state.nodes.filter(n => usable(n, state))) {
    const text = node.text;
    for (const template of [BASE_STRINGS.lesson_step, ENGLISH_STRINGS.lesson_step]) {
      const { pattern, positions } = resourcePattern(template);
      const match = normalize(text).match(pattern);
      if (!match) continue;
      const argument = position => match[positions.indexOf(position) + 1];
      const step = Number(argument(1));
      const total = Number(argument(2));
      const face = argument(3);
      if (Number.isSafeInteger(step) && Number.isSafeInteger(total) && step > 0 &&
        total > 0 && step <= total && /^[UDLRFB]'?$/.test(face)) {
        return { step, total, face, text };
      }
    }
  }
  return null;
}

let geometryApi;
async function loadGeometry() {
  if (geometryApi) return geometryApi;
  const modelPath = join(ROOT, 'entry/src/main/ets/model/CubeModel.ts');
  const rendererPath = join(ROOT, 'entry/src/main/ets/render/CubeRenderer.ets');
  const moduleUrl = (source, path) => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source,
    { mode: 'strip', sourceUrl: pathToFileURL(path).href })).toString('base64')}`;
  const modelUrl = moduleUrl(readFileSync(modelPath, 'utf8'), modelPath);
  const rendererSource = readFileSync(rendererPath, 'utf8');
  if (!rendererSource.includes("'../model/CubeModel'")) throw new Error('Renderer model import changed; update the smoke loader explicitly.');
  const rendererUrl = moduleUrl(rendererSource.replaceAll("'../model/CubeModel'", JSON.stringify(modelUrl)), rendererPath);
  const { CubeModel, CubeMove } = await import(modelUrl);
  const { CubeRenderer } = await import(rendererUrl);
  if (typeof CubeRenderer.prototype.getSwipeGuide !== 'function') throw new Error('Actual CubeRenderer must implement getSwipeGuide(move).');
  geometryApi = { CubeModel, CubeMove, CubeRenderer };
  return geometryApi;
}
function drawGeometry(order, width, height, yaw = 0.62, pitch = -0.42) {
  const { CubeModel, CubeRenderer } = geometryApi;
  const model = new CubeModel(order);
  const renderer = new CubeRenderer();
  // Only drawing calls are mocked: projection, hit testing and gesture picking are real.
  const ctx = Object.fromEntries(['save', 'restore', 'clearRect', 'beginPath', 'moveTo', 'lineTo',
    'closePath', 'fill', 'stroke'].map(name => [name, () => {}]));
  renderer.draw(ctx, width, height, model, yaw, pitch);
  return { renderer, model, width, height, yaw, pitch };
}
function faceMove(face, order) {
  const spec = { U: ['y', order - 1, -1], D: ['y', 0, 1], L: ['x', 0, 1],
    R: ['x', order - 1, -1], F: ['z', order - 1, -1], B: ['z', 0, 1] }[face[0]];
  if (!spec || !/^[UDLRFB]'?$/.test(face)) throw new Error(`Invalid face ${face}`);
  const move = new geometryApi.CubeMove(spec[0], spec[1], spec[2] * (face.endsWith("'") ? -1 : 1));
  if (move.label(order) !== face) throw new Error(`Model face notation mismatch: ${face}`);
  return move;
}
function guidePixels(geometry, face, canvasBounds, scale) {
  const { renderer, model, width, height, yaw, pitch } = geometry;
  const move = faceMove(face, model.order);
  const guide = renderer.getSwipeGuide(move);
  if (!guide || !['startX', 'startY', 'endX', 'endY'].every(key => Number.isFinite(guide[key]))) {
    throw new Error(`ASSERTION FAILED: no finite swipe guide for ${model.order}×${model.order} ${face}`);
  }
  const x1 = Math.round(canvasBounds.left + guide.startX * scale);
  const y1 = Math.round(canvasBounds.top + guide.startY * scale);
  const x2 = Math.round(canvasBounds.left + guide.endX * scale);
  const y2 = Math.round(canvasBounds.top + guide.endY * scale);
  const logical = [(x1 - canvasBounds.left) / scale, (y1 - canvasBounds.top) / scale,
    (x2 - canvasBounds.left) / scale, (y2 - canvasBounds.top) / scale];
  if (![0, 2].every(i => logical[i] > 0 && logical[i] < width && logical[i + 1] > 0 && logical[i + 1] < height)) {
    throw new Error(`ASSERTION FAILED: ${face} guide leaves Canvas: ${JSON.stringify({ guide, logical, width, height })}`);
  }
  if (Math.hypot(logical[2] - logical[0], logical[3] - logical[1]) < 24) {
    throw new Error(`ASSERTION FAILED: pixel-quantized ${face} guide is below the 24vp touch threshold`);
  }
  const start = renderer.boxHit(logical[0], logical[1]);
  for (let sample = 0; sample <= 10; sample++) {
    const hit = renderer.boxHit(logical[0] + (logical[2] - logical[0]) * sample / 10,
      logical[1] + (logical[3] - logical[1]) * sample / 10);
    if (!start || !hit || ['x', 'y', 'z'].some(axis => hit.normal[axis] !== start.normal[axis]) ||
      hit[move.axis] !== move.layer) {
      throw new Error(`ASSERTION FAILED: pixel-quantized ${face} guide leaves its surface/layer at ${yaw}/${pitch}`);
    }
  }
  const picked = renderer.pickMove(...logical, model, yaw, pitch);
  if (!picked || picked.axis !== move.axis || picked.layer !== move.layer || picked.turns !== move.turns) {
    throw new Error(`ASSERTION FAILED: pixel-quantized ${face} guide picks wrong move: ${JSON.stringify({ move, picked, guide, logical })}`);
  }
  return { guide, move, logical, x1, y1, x2, y2 };
}
async function gestureGeometry(order) {
  await tap('正视角'); // Synchronize the real camera with the renderer oracle before every swipe.
  const state = await waitFor('Canvas and 44vp view button ready', s => isGame(s, order) && idleControls(s) && enabledButton(s, '正视角'));
  const canvas = gameCanvas(state);
  const scale = button(state, '正视角').bounds.height / 44;
  if (!Number.isFinite(scale) || scale < 0.5 || scale > 8) throw new Error(`Invalid measured px/vp: ${scale}`);
  const b = canvas.bounds;
  const geometry = drawGeometry(order, b.width / scale, b.height / scale);
  return { state, canvas, scale, geometry };
}
async function swipeFace(face, order = 3, reason = `surface ${face}`) {
  const { canvas, scale, geometry } = await gestureGeometry(order);
  const points = guidePixels(geometry, face, canvas.bounds, scale);
  // Never send a guide into a clipped part of Canvas or another control.
  for (const [x, y] of [[points.x1, points.y1], [points.x2, points.y2]]) {
    for (const b of [latest.viewport, ...descendantsClips(canvas)]) {
      if (x < b.left || x >= b.right || y < b.top || y >= b.bottom) throw new Error(`ASSERTION FAILED: clipped ${face} guide`);
    }
  }
  summary.actions.push({ action: 'surface-swipe', reason, order, face, bounds: canvas.a.bounds,
    pxPerVp: scale, scaleSource: '正视角 button height / 44vp', width: geometry.width, height: geometry.height, ...points });
  saveSummary();
  shell('uitest', 'uiInput', 'swipe', points.x1, points.y1, points.x2, points.y2, 600);
}
function descendantsClips(node) {
  const clips = [];
  for (let p = node.parent; p; p = p.parent) {
    if ((p.a.clip === 'true' || p.type === 'Scroll') && p.bounds) clips.push(p.bounds);
  }
  return clips;
}
async function assertUnchanged(description, predicate) {
  // Longer than a slow 440ms turn, and at least two independent dumps. A stale
  // first frame is not evidence that an incorrect gesture or orbit was ignored.
  const deadline = Date.now() + 1200;
  let samples = 0;
  do {
    const state = dump();
    if (!predicate(state)) throw new Error(`ASSERTION FAILED: ${description}\n${JSON.stringify(diagnostic(state))}`);
    samples++;
    if (Date.now() < deadline) await delay(160);
  } while (Date.now() < deadline || samples < 2);
  check(true, description, { samples });
}
async function checkGesturesOffline() {
  await loadGeometry();
  let checks = 0;
  // Include small scenes and fractional densities; use the same rounding and
  // pickMove guard as device injection. No generated copy of renderer geometry.
  for (const order of [2, 3, 4, 5]) {
    for (const [width, height] of [[300, 260], [360, 320], [480, 380]]) {
      for (const [yaw, pitch] of [[0.62, -0.42], [0, -1.3], [3.14, -0.42], [-0.8, 0.73], [1.57, 1.45]]) {
        const geometry = drawGeometry(order, width, height, yaw, pitch);
        for (const scale of [1, 1.5, 2, 2.75, 3.5]) {
          for (const face of ['U', 'R', 'D', "L'", 'F', "U'", "R'"]) {
            if (!geometry.renderer.getSwipeGuide(faceMove(face, order))) {
              if (yaw === 0.62 && pitch === -0.42) throw new Error(`Default view cannot guide ${face}`);
              continue;
            }
            guidePixels(geometry, face, { left: 41, top: 203 }, scale);
            checks++;
          }
        }
      }
    }
  }
  console.log(`Offline gesture checks passed: ${checks} real-renderer guides, including pixel quantization. No device commands sent.`);
}
function orderSelected(state, order) {
  const selected = button(state, `${order} 阶`);
  if (!selected) return false;
  if (selected.a.selected === 'true' || selected.a.checked === 'true') return true;
  const peers = [2, 3, 4, 5].map(n => button(state, `${n} 阶`));
  // ArkUI Button selected is always false here; compare actual highlight colors.
  const color = selected.a.backgroundColor;
  return Boolean(color) && peers.every(n => n && (n === selected || n.a.backgroundColor !== color)) &&
    new Set(peers.filter(n => n !== selected).map(n => n.a.backgroundColor)).size === 1;
}
async function restart() {
  shell('aa', 'force-stop', BUNDLE);
  shell('aa', 'start', '-b', BUNDLE, '-a', 'EntryAbility');
  appStarted = true;
  return waitFor('EntryAbility home loaded', s => isHome(s) && enabledButton(s, /开始挑战/), 25000, 2);
}
async function home() {
  const state = dump();
  if (isHome(state)) return;
  await tapBack();
  const next = await waitFor('home or leave confirmation', s => isHome(s) || leaveDialogReady(s));
  if (leaveDialogReady(next)) {
    await tapDialog('返回首页？', '返回首页');
    await waitFor('home after confirmation', isHome);
  }
}
async function game(order = 3) {
  await home();
  await tap(`${order} 阶`);
  await tap(/开始挑战/);
  const ready = await waitFor(`${order} × ${order} game ready`, s => isGame(s, order) && idleControls(s));
  assertTouchOnly(ready);
  return ready;
}
async function settings() {
  await home();
  await tap('偏好设置');
  return waitFor('settings default-order controls', s => has(s, '默认阶数') && enabledButton(s, '4 阶'));
}
async function runCase(name, fn) {
  if (SELECTED_CASES && !SELECTED_CASES.has(name)) return;
  currentCase = name;
  const started = Date.now();
  try {
    await fn();
    result('case complete', 'pass', { durationMs: Date.now() - started });
  } catch (error) {
    result('case failed', 'fail', { message: error.message, stack: error.stack, durationMs: Date.now() - started });
    console.error(error.stack);
    try { await capture(`FAIL-${name}`); }
    catch (captureError) { result('failure evidence capture', 'fail', { message: captureError.message }); }
    // Continue independent cases only after resetting volatile state, never app data.
    try { await restart(); result('recovery to home', 'pass'); }
    catch (recoveryError) {
      result('recovery to home', 'fail', { message: recoveryError.message });
      throw recoveryError;
    }
  }
}

async function main() {
  // Fail before any device command when the source API is missing or incompatible.
  await loadGeometry();
  summary.selectedCases = SELECTED_CASES ? [...SELECTED_CASES] : CASE_NAMES;
  await restart();
  check(isHome(latest), 'starts on home');
  await capture('home-initial');

  for (const order of [2, 4, 5, 3]) {
    await runCase(`order-${order}`, async () => {
      const state = await game(order);
      check(isGame(state, order), `start game displays ${order} × ${order}`);
      check(moves(state) === 0 && timer(state) === '00:00.00', 'new game has zero moves and time');
      await capture(`game-${order}`);
      await swipeFace('U', order, `${order}×${order} surface U`);
      const turned = await waitFor(`${order}×${order} surface turn counts exactly 1`, s => moves(s) === 1 && idleControls(s));
      check(timer(turned) === '00:00.00' && enabledButton(turned, /撤销/), `${order}×${order} surface U is counted and undoable without timer`);
      await capture(`game-${order}-surface-U`);
      await tap(/撤销/);
      const undone = await waitFor(`${order}×${order} undo restores zero`, s => moves(s) === 0 && idleControls(s));
      check(timer(undone) === '00:00.00' && !enabledButton(undone, /撤销/), `${order}×${order} undo consumes the only move`);
      await capture(`game-${order}-undo`);
      await home();
    });
  }

  await runCase('tutorial', async () => {
    await game(3);
    await tap('教程');
    const sequence = ['D', "L'", 'F', "U'", "R'"]; // Inverse of fixed setup R U F' L D'.
    await waitFor('tutorial setup completes at step 1/5 D', s => lesson(s)?.step === 1 && idleControls(s), 20000);
    await capture('tutorial-step-1');
    for (let index = 0; index < sequence.length; index++) {
      const expected = sequence[index];
      let state = await waitFor(`tutorial step ${index + 1}`, s => lesson(s)?.step === index + 1 && idleControls(s));
      const before = lesson(state);
      check(before.total === 5 && before.face === expected, `tutorial ${index + 1}/5 expects ${expected}`, { observed: before });
      assertTouchOnly(state);
      // Deliberately use a different layer/axis, not a removed button or an
      // arbitrary swipe that might miss the cube and merely rotate the camera.
      const wrongFace = expected[0] === 'U' ? 'R' : 'U';
      const beforeMoves = moves(state);
      check(beforeMoves === 0, `tutorial ${index + 1}/5 has no counted moves`);
      await swipeFace(wrongFace, 3, `wrong tutorial gesture ${wrongFace}, expected ${expected}`);
      await assertUnchanged(`wrong ${wrongFace} gesture does not advance tutorial step ${index + 1}`, s => {
        const after = lesson(s);
        return after?.step === before.step && after?.total === 5 && after?.face === expected &&
          moves(s) === beforeMoves && idleControls(s);
      });
      await capture(`tutorial-step-${index + 1}-wrong-${wrongFace}-ignored`);
      await swipeFace(expected, 3, `tutorial target-layer arrow ${expected}`);
      if (index < sequence.length - 1) {
        await waitFor(`tutorial advances exactly to ${index + 2}/5 ${sequence[index + 1]}`, s =>
          lesson(s)?.step === index + 2 && lesson(s)?.total === 5 && lesson(s)?.face === sequence[index + 1] && moves(s) === 0 && idleControls(s));
        await capture(`tutorial-step-${index + 2}`);
      } else {
        state = await waitFor('tutorial completed', s => has(s, /教程完成/) && idleControls(s));
        check(has(state, /教程完成/), 'five inverse moves show 教程完成');
        check(has(state, '自由练习') && moves(state) === 0, 'tutorial returns to free practice without counted moves');
        await capture('tutorial-complete');
      }
    }
  });

  await runCase('free-move-undo', async () => {
    await game(3);
    await swipeFace('U');
    let state = await waitFor('free U increments count to 1', s => moves(s) === 1 && idleControls(s));
    check(timer(state) === '00:00.00', 'free U counts 1 without starting timer');
    await capture('free-U-count-1');
    await tap(/撤销/);
    state = await waitFor('undo restores count 0', s => moves(s) === 0 && idleControls(s));
    check(moves(state) === 0, 'undo returns move count to 0');
    await capture('free-undo-count-0');
  });

  await runCase('surface-swipe', async () => {
    await game(3);
    await capture('surface-before');
    await swipeFace('U');
    const after = await waitFor('surface U counts exactly one move', s => moves(s) === 1 && idleControls(s));
    check(moves(after) === 1, 'renderer-validated surface U increments exactly once');
    await capture('surface-after');
    await tap(/撤销/);
    await waitFor('surface U undo restores zero', s => moves(s) === 0 && idleControls(s));
    const { canvas, geometry } = await gestureGeometry(3);
    const start = [0.06, 0.06];
    const end = [0.20, 0.06];
    check(Array.from({ length: 21 }, (_, i) => i / 20).every(t =>
      !geometry.renderer.hitTest((start[0] + (end[0] - start[0]) * t) * geometry.width,
        start[1] * geometry.height)), 'background drag path misses all cube surfaces');
    swipe(canvas, start, end, 'background-only camera orbit');
    await assertUnchanged('background orbit does not add moves or start timer', s =>
      moves(s) === 0 && timer(s) === '00:00.00' && !enabledButton(s, /撤销/) && idleControls(s));
    await capture('background-orbit-count-0');
    // Return to a known view and prove an orbit did not break surface interaction.
    await swipeFace('U');
    await waitFor('surface U still works after orbit/view reset', s => moves(s) === 1 && idleControls(s));
    await tap(/撤销/);
    await waitFor('post-orbit undo restores zero', s => moves(s) === 0 && idleControls(s));
    await capture('surface-after-orbit-undo');
  });

  await runCase('scramble-timer-hint-back', async () => {
    await game(3);
    await tap('打乱');
    let state = await waitFor('scramble animations complete; ready at zero', s =>
      has(s, '准备开始') && has(s, /已打乱/) && idleControls(s), 25000);
    check(timer(state) === '00:00.00' && moves(state) === 0, 'ready has zero timer and zero moves');
    await capture('scrambled-ready');
    state = await waitFor('ready stays zero until first turn', s =>
      has(s, '准备开始') && timer(s) === '00:00.00' && moves(s) === 0, 6000, 2);
    check(timer(state) === '00:00.00', 'ready timer remains stopped across dumps');
    await swipeFace('R', 3, 'first surface R after scramble');
    state = await waitFor('first R starts timer and counts exactly 1', s =>
      has(s, '计时挑战') && moves(s) === 1 && centiseconds(s) > 0 && idleControls(s));
    const firstTime = centiseconds(state);
    await waitFor('challenge timer continues advancing', s => centiseconds(s) > firstTime && moves(s) === 1);
    check(true, 'R starts running timer and move count 1');
    await capture('challenge-first-R');
    await tap(BASE_STRINGS.history_help);
    state = await waitFor('history reference and assisted practice', s =>
      has(s, resourcePattern(BASE_STRINGS.history_hint).pattern) && has(s, '辅助练习') && has(s, /不计入成绩/));
    check(has(state, '辅助练习'), 'history hint changes phase to 辅助练习 and excludes score');
    await capture('history-hint-assisted');
    await tapBack();
    state = await waitFor('leave confirmation dialog', leaveDialogReady);
    check(descendants(alertDialog(state, '返回首页？')).some(n => n.type === 'Text' &&
      n.text === '本局进度不会保存，已完成的成绩不受影响。' && usable(n, state)), 'return dialog preserves completed records');
    await capture('return-confirmation');
    await tapDialog('返回首页？', '返回首页');
    await waitFor('confirmed return home', isHome);
    check(true, 'leave dialog confirmation returns home');
  });

  await runCase('gesture-guides-switch', async () => {
    const gameToggle = state => state.nodes.find(n => /Toggle|Switch/.test(n.type) && usable(n, state) && n.enabled);
    const settingsToggle = state => {
      const label = find(state, BASE_STRINGS.beginner_guides, 'Text');
      return descendants(label?.parent?.parent).find(n => /Toggle|Switch/.test(n.type) && usable(n, state) && n.enabled);
    };
    const checked = toggle => {
      check(toggle?.a.checked === true || toggle?.a.checked === false ||
        toggle?.a.checked === 'true' || toggle?.a.checked === 'false', 'guide switch exposes a native checked state');
      return toggle.a.checked === true || toggle.a.checked === 'true';
    };
    const hasState = (toggle, value) => Boolean(toggle) && String(toggle.a.checked) === String(value);
    const initial = await game(3);
    const original = checked(gameToggle(initial));
    try {
      check(has(initial, BASE_STRINGS.guides_label), 'game labels the switch as gesture guides');
      await capture('guides-game-initial');
      tapNode(gameToggle(initial), 'toggle game gesture guides');
      let state = await waitFor('game guide switch changed', s => hasState(gameToggle(s), !original));
      check(moves(state) === 0 && timer(state) === '00:00.00', 'guide switch does not change moves or time');
      await capture('guides-game-toggled');
      await swipeFace('U');
      state = await waitFor('surface swipe works after guide toggle', s => moves(s) === 1 && idleControls(s));
      await tap(/撤销/);
      await waitFor('guide toggle does not prevent undo', s => moves(s) === 0 && idleControls(s));
      await settings();
      state = await reveal('settings guide switch', s => hasState(settingsToggle(s), !original));
      check(hasState(settingsToggle(state), !original), 'settings reflects the game guide switch');
      await capture('guides-settings-linked');
      await restart();
      await settings();
      state = await reveal('persisted guide switch', s => hasState(settingsToggle(s), !original));
      check(hasState(settingsToggle(state), !original), 'guide switch survives application restart');
      tapNode(settingsToggle(state), 'restore guide setting from settings');
      await waitFor('settings guide switch restored', s => hasState(settingsToggle(s), original));
      state = await game(3);
      check(hasState(gameToggle(state), original), 'game reflects the settings guide switch');
      await capture('guides-game-restored');
    } finally {
      await restart();
      await settings();
      const state = await reveal('guide switch cleanup', s => Boolean(settingsToggle(s)));
      if (checked(settingsToggle(state)) !== original) {
        tapNode(settingsToggle(state), 'restore original guide preference');
        await waitFor('original guide preference restored', s => hasState(settingsToggle(s), original));
      }
      await home();
    }
  });

  await runCase('statistics', async () => {
    await home();
    await tap('成绩统计');
    let state = await waitFor('statistics page', s => has(s, 'PERSONAL BEST') && has(s, /最近成绩/));
    check([2, 3, 4, 5].every(n => has(state, `${n} 阶`)), 'statistics includes every order');
    state = await reveal('empty state or real records', s => has(s, /还没有成绩/) || s.nodes.some(n => /\d+ 步 ·/.test(n.text)));
    if (has(state, /还没有成绩/)) {
      // The title can enter the viewport while the guidance below it stays clipped.
      state = await reveal('no-records guidance', s => has(s, /打乱魔方并完成还原/));
      check(has(state, /打乱魔方并完成还原/), 'no-records guidance is visible');
      check(button(state, '清空')?.enabled === false, 'clear disabled when no records exist');
      await capture('statistics-empty');
    } else {
      const records = state.nodes.filter(n => /\d+ 步 ·/.test(n.text)).map(n => n.text);
      check(records.length > 0, 'existing real records are visible', { visibleRecords: records });
      result('no-records state', 'skip', { message: 'Device already has real scores; empty state cannot be tested without deleting them. No clear action was sent.' });
      await capture('statistics-existing-records');
    }
    await home();
  });

  await runCase('settings-persistence', async () => {
    let state = await settings();
    check([2, 3, 4, 5].every(n => enabledButton(state, `${n} 阶`)), 'default order has 2/3/4/5 controls');
    state = await reveal('animation speed slider', s => has(s, '转动动画') && s.nodes.some(n => /Slider/.test(n.type) && usable(n, s)));
    check(has(state, /^\d\.\d×$/), 'current animation speed is displayed');
    check(has(state, /0\.5×/) && has(state, /2\.0×/), 'speed range labels are visible');
    await capture('settings-order-speed');
    for (const label of ['转动音效', '触感反馈']) {
      state = await reveal(`${label} toggle`, s => {
        const node = find(s, label, 'Text');
        return descendants(node?.parent?.parent).some(n => /Toggle|Switch/.test(n.type) && usable(n, s) && n.enabled);
      });
      const node = find(state, label, 'Text');
      const toggle = descendants(node?.parent?.parent).find(n => /Toggle|Switch/.test(n.type) && usable(n, state));
      check(Boolean(toggle?.enabled), `${label} toggle layout available (not modified)`, { checked: toggle?.a.checked, bounds: toggle?.a.bounds });
    }
    await capture('settings-feedback');
    // Reopen settings to reset its scroll offset before selecting the default.
    await settings();
    await tap('4 阶');
    await waitFor('default 4 highlighted', s => orderSelected(s, 4), WAIT_MS, 2);
    await capture('settings-default-4');
    await home();
    await capture('home-before-force-stop');
    await restart(); // Persistence, not just in-memory selection.
    await capture('home-after-restart-4');
    // Starting without tapping any order proves the persisted default, even if
    // the platform does not expose selected/backgroundColor accessibility data.
    await tap(/开始挑战/);
    state = await waitFor('persisted default opens 4 × 4', s => isGame(s, 4) && idleControls(s));
    check(isGame(state, 4), 'aa force-stop/start preserves default 4');
    await capture('persisted-game-4');
  });
}

if (process.argv.includes('--check-gestures')) {
  await checkGesturesOffline();
  process.exit(0);
}

mkdirSync(OUT, { recursive: true });
saveSummary();
try {
  await main();
} catch (error) {
  result('suite aborted', 'fail', { message: error.message, stack: error.stack });
  console.error(error.stack);
} finally {
  // Restore even after a failed case; cleanup failures are failures, not hidden.
  currentCase = 'cleanup';
  if (appStarted) {
    try {
      await restart();
      await settings();
      await tap('3 阶');
      await waitFor('restored default 3 highlighted', s => orderSelected(s, 3), WAIT_MS, 2);
      await capture('settings-restored-3');
      await home();
      await capture('home-restored-3');
      await restart();
      await tap(/开始挑战/);
      await waitFor('restored persisted default opens 3 × 3', s => isGame(s, 3) && idleControls(s));
      check(true, 'default 3 restoration survives restart');
      await home();
      await capture('home-final');
      check(isHome(latest), 'finished on home; no score-clear action performed');
    } catch (error) {
      result('restore default 3 / final home', 'fail', { message: error.message, stack: error.stack });
      console.error(error.stack);
      try { await restart(); await capture('cleanup-recovery-home'); }
      catch (recoveryError) { result('final home recovery', 'fail', { message: recoveryError.message }); }
    }
  } else {
    result('restore / final home', 'skip', { message: 'App could not be started; no settings were modified.' });
  }
  summary.finishedAt = new Date().toISOString();
  summary.counts = Object.fromEntries(['pass', 'fail', 'skip'].map(status => [status, summary.results.filter(r => r.status === status).length]));
  summary.status = summary.counts.fail ? 'failed' : summary.counts.skip ? 'passed-with-skips' : 'passed';
  saveSummary();
  console.log(`Smoke ${summary.status}: ${JSON.stringify(summary.counts)}\nSummary: ${join(OUT, 'summary.json')}`);
  process.exitCode = summary.counts.fail ? 1 : 0;
}
