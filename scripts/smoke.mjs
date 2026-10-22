#!/usr/bin/env node
// Run only after the rebuilt HAP is installed and no other UI driver is active.
// node D:/workspace/My/harmony/harmony_filament-cube/scripts/smoke.mjs
// HDC_TARGET defaults to 127.0.0.1:5633. No dependencies, install, or data clearing.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.SMOKE_OUT ? resolve(process.env.SMOKE_OUT) : join(ROOT, 'verification', 'ui');
const HDC = 'C:/Program Files/Huawei/DevEco Studio/sdk/default/openharmony/toolchains/hdc.exe';
const TARGET = process.env.HDC_TARGET || '127.0.0.1:5633';
const BUNDLE = 'com.razor.cube.atomic';
const REMOTE_JSON = '/data/local/tmp/razor-smoke.json';
const RUN_ID = `${Date.now()}-${process.pid}`;
const WAIT_MS = 15000;
const COMMAND_MS = 10000;
const MIN_COMMAND_MS = 2000;
const summary = {
  startedAt: new Date().toISOString(), target: TARGET, bundle: BUNDLE,
  outputDirectory: OUT, status: 'running', results: [], artifacts: [], diagnostics: [], actions: [],
  policy: 'Never clear records or app data. Only default order is changed, then restored to 3. Sound, haptics and speed are inspected, not changed.'
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
    a, parent, text: normalize(a.text), type: String(a.type || ''), bounds: bounds(a.bounds),
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
  const labels = [node.text, normalize(node.a.originalText), normalize(node.a.description)];
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
const leaveDialogReady = state => Boolean(dialogAction(state, '返回首页？', '继续玩') &&
  dialogAction(state, '返回首页？', '返回首页'));
async function tapDialog(title, label) {
  const state = await waitFor(`AlertDialog ${title}: ${label}`, s => Boolean(dialogAction(s, title, label)));
  tapNode(dialogAction(state, title, label), `AlertDialog ${title}: ${label}`);
}
const isHome = state => has(state, '选择你的挑战') && Boolean(button(state, /开始游戏/));
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
const faceQuery = face => new RegExp(`^${face.replace("'", "['′’]")}(?: 面转动)?$`);
const idleControls = state => enabledButton(state, faceQuery('U')) && enabledButton(state, '打乱');
function lesson(state) {
  const text = state.nodes.map(n => n.text).find(t => /第\s*\d+\s*\/\s*\d+\s*步/.test(t));
  const match = text?.match(/第\s*(\d+)\s*\/\s*(\d+)\s*步[：:]\s*点击\s*([UDLRFB]'?)/);
  return match ? { step: Number(match[1]), total: Number(match[2]), face: match[3], text } : null;
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
  return waitFor('EntryAbility home loaded', s => isHome(s) && enabledButton(s, /开始游戏/), 25000, 2);
}
async function home() {
  const state = dump();
  if (isHome(state)) return;
  await tap(/^(‹|返回首页)$/);
  const next = await waitFor('home or leave confirmation', s => isHome(s) || leaveDialogReady(s));
  if (leaveDialogReady(next)) {
    await tapDialog('返回首页？', '返回首页');
    await waitFor('home after confirmation', isHome);
  }
}
async function game(order = 3) {
  await home();
  await tap(`${order} 阶`);
  await tap(/开始游戏/);
  return waitFor(`${order} × ${order} game ready`, s => isGame(s, order) && idleControls(s));
}
async function settings() {
  await home();
  await tap('偏好设置');
  return waitFor('settings default-order controls', s => has(s, '默认阶数') && enabledButton(s, '4 阶'));
}
async function runCase(name, fn) {
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
  await restart();
  check(isHome(latest), 'starts on home');
  await capture('home-initial');

  for (const order of [2, 4, 5, 3]) {
    await runCase(`order-${order}`, async () => {
      const state = await game(order);
      check(isGame(state, order), `start game displays ${order} × ${order}`);
      check(moves(state) === 0 && timer(state) === '00:00.00', 'new game has zero moves and time');
      await capture(`game-${order}`);
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
      const active = button(state, faceQuery(expected));
      const wrongFace = expected === 'U' ? 'B' : 'U';
      const wrong = button(state, faceQuery(wrongFace));
      check(Boolean(active && wrong && active.a.backgroundColor && active.a.backgroundColor !== wrong.a.backgroundColor),
        `tutorial ${index + 1}/5 expected button is highlighted`);
      const beforeMoves = moves(state);
      await tap(faceQuery(wrongFace), `wrong tutorial face ${wrongFace}`);
      // Observe repeatedly for longer than the slowest 440ms single move. Do not
      // accept a single stale dump as proof that the wrong action was ignored.
      const observationDeadline = Date.now() + 1200;
      let samples = 0;
      do {
        state = dump();
        const after = lesson(state);
        if (after?.step !== before.step || after?.face !== before.face || moves(state) !== beforeMoves || !idleControls(state)) {
          throw new Error(`ASSERTION FAILED: wrong ${wrongFace} advanced/changed tutorial ${before.step}: ${JSON.stringify({ after, moves: moves(state) })}`);
        }
        samples++;
        if (Date.now() < observationDeadline) await delay(160);
      } while (Date.now() < observationDeadline || samples < 2);
      check(true, `wrong button does not advance tutorial step ${index + 1}`, { samples });
      await tap(faceQuery(expected), `tutorial face ${expected}`);
      if (index < sequence.length - 1) {
        await waitFor(`tutorial advances to ${index + 2}/5`, s => lesson(s)?.step === index + 2 && idleControls(s));
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
    await tap(faceQuery('U'));
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
    await tap('正视角');
    await capture('surface-before');
    const state = dump();
    const canvas = state.nodes.find(n => n.type === 'Canvas' && usable(n, state));
    check(Boolean(canvas), 'Canvas has visible dump bounds');
    const before = moves(state);
    check(before === 0, 'swipe starts from zero moves');
    // Home reference: green front face is left of cube center, below the white
    // top. These are Canvas-local ratios, NEVER coordinates of the thumbnail.
    // Use a horizontal tangent gesture; do not assert which layer/direction wins.
    swipe(canvas, [0.38, 0.56], [0.60, 0.59], 'green front sticker horizontal swipe');
    const after = await waitFor('surface swipe increases move count', s => moves(s) !== null && moves(s) > before && idleControls(s), 10000);
    check(moves(after) > before, 'surface swipe increments moves', { before, after: moves(after), direction: 'observed only; not asserted' });
    await capture('surface-after');
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
    await tap(faceQuery('R'));
    state = await waitFor('first R starts timer and counts exactly 1', s =>
      has(s, '计时挑战') && moves(s) === 1 && centiseconds(s) > 0 && idleControls(s));
    const firstTime = centiseconds(state);
    await waitFor('challenge timer continues advancing', s => centiseconds(s) > firstTime && moves(s) === 1);
    check(true, 'R starts running timer and move count 1');
    await capture('challenge-first-R');
    await tap('历史提示');
    state = await waitFor('history reference and assisted practice', s =>
      has(s, /历史回退参考/) && has(s, '辅助练习') && has(s, /不计入成绩/));
    check(has(state, '辅助练习'), 'history hint changes phase to 辅助练习 and excludes score');
    await capture('history-hint-assisted');
    await tap(/^(‹|返回首页)$/);
    state = await waitFor('leave confirmation dialog', leaveDialogReady);
    check(descendants(alertDialog(state, '返回首页？')).some(n => n.type === 'Text' &&
      n.text === '本局进度不会保存，已完成的成绩不受影响。' && usable(n, state)), 'return dialog preserves completed records');
    await capture('return-confirmation');
    await tapDialog('返回首页？', '返回首页');
    await waitFor('confirmed return home', isHome);
    check(true, 'leave dialog confirmation returns home');
  });

  await runCase('statistics', async () => {
    await home();
    await tap('成绩统计');
    let state = await waitFor('statistics page', s => has(s, 'PERSONAL BEST') && has(s, /最近成绩/));
    check([2, 3, 4, 5].every(n => has(state, `${n} 阶`)), 'statistics includes every order');
    state = await reveal('empty state or real records', s => has(s, /还没有成绩/) || s.nodes.some(n => /\d+ 步 ·/.test(n.text)));
    if (has(state, /还没有成绩/)) {
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
    await tap(/开始游戏/);
    state = await waitFor('persisted default opens 4 × 4', s => isGame(s, 4) && idleControls(s));
    check(isGame(state, 4), 'aa force-stop/start preserves default 4');
    await capture('persisted-game-4');
  });
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
      await tap(/开始游戏/);
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
