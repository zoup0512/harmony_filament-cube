#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputs = join(root, 'entry/build/default/outputs/default');
const intermediate = join(root, 'entry/build/default/cache/default/default@CompileArkTS/esmodule/release/entry/src/main/ets');
const sdk = join(process.env.DEVECO_HOME || 'C:/Program Files/Huawei/DevEco Studio', 'sdk/default/openharmony');
const names = JSON.parse(readFileSync(join(outputs, 'symbol/release/entry-nameCache.json'), 'utf8'));
const plain = value => JSON.parse(JSON.stringify(value));
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const temporary = mkdtempSync(join(tmpdir(), 'cube-release-obfuscation-'));
let checks = 0;
function check(condition, message) {
  assert.ok(condition, message);
  checks++;
}
function renamed(file, original) {
  const name = names[`entry/src/main/ets/${file}`]?.IdentifierCache?.[`#${original}`];
  check(typeof name === 'string' && name !== original, `${original} must be renamed in the actual Release cache`);
  return name;
}
function unpack(hap, destination) {
  const quote = value => `'${value.replaceAll("'", "''")}'`;
  const command = `Add-Type -AssemblyName System.IO.Compression.FileSystem; ` +
    `[System.IO.Compression.ZipFile]::ExtractToDirectory(${quote(hap)}, ${quote(destination)})`;
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { stdio: 'pipe' });
}

try {
  const hap = join(outputs, 'entry-default-unsigned.hap');
  const unpacked = join(temporary, 'unsigned');
  unpack(hap, unpacked);
  const module = JSON.parse(readFileSync(join(unpacked, 'module.json'), 'utf8'));
  check(module.app.debug === false, 'HAP must be a non-debug Release');
  check(module.module.mainElement === 'EntryAbility', 'ability entry must remain stable');
  const pages = JSON.parse(readFileSync(join(unpacked, 'resources/base/profile/main_pages.json'), 'utf8'));
  assert.deepEqual(pages.src, ['pages/Index']);
  checks++;
  const abc = readFileSync(join(unpacked, 'ets/modules.abc'));
  const assembly = join(temporary, 'modules.pa');
  execFileSync(join(sdk, 'toolchains/ark_disasm.exe'), [join(unpacked, 'ets/modules.abc'), assembly], { stdio: 'pipe' });
  const disassembly = readFileSync(assembly, 'utf8');
  const exports = [...disassembly.matchAll(/ModuleTag: LOCAL_EXPORT, local_name: ([^,;]+), export_name: ([^;]+);/g)];
  const symbols = {};
  for (const [file, originals] of [
    ['model/CubeModel.ts', ['CubeModel', 'CubeMove']],
    ['render/CubeRenderer.ets', ['CubeRenderer']],
    ['storage/CubeStore.ets', ['CubeStore', 'CubeSettings', 'SolveRecord']],
    ['platform/CubeFeedback.ets', ['CubeFeedback']]
  ]) {
    for (const original of originals) {
      const name = renamed(file, original);
      check(exports.some(match => match[1] === name && match[2] === name), `${original}: renamed export must be in final ABC`);
      check(!exports.some(match => match[1] === original || match[2] === original), `${original}: original export must not remain`);
      symbols[original] = name;
    }
  }
  check(exports.some(match => match[1] === 'EntryAbility' && match[2] === 'default'), 'EntryAbility default export must remain');
  for (const field of ['defaultOrder', 'speed', 'sound', 'haptics', 'beginnerGuides', 'order', 'durationMs', 'moves', 'date', 'onForegroundChanged']) {
    check(disassembly.includes(`"${field}"`), `${field} must retain its runtime property name`);
  }
  const list = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `Get-ChildItem -LiteralPath '${unpacked.replaceAll("'", "''")}' -Recurse -File | ForEach-Object { $_.FullName }`], { encoding: 'utf8' });
  check(!/nameCache|sourceMaps?|obfuscation-rules|\.(?:ets|ts|map|p12|jks|keystore|key|pem|pfx)(?:\r?$)/im.test(list),
    'HAP must not contain source, maps, obfuscation rules, or signing key files');
  const signed = join(outputs, 'entry-default-signed.hap');
  let signedMatches = null;
  if (existsSync(signed)) {
    const signedDirectory = join(temporary, 'signed');
    unpack(signed, signedDirectory);
    signedMatches = digest(readFileSync(join(signedDirectory, 'ets/modules.abc'))) === digest(abc);
    check(signedMatches, 'signed HAP must contain the same obfuscated ABC as unsigned HAP');
  }

  const modelSource = readFileSync(join(intermediate, 'model/CubeModel.ts'), 'utf8');
  const modelUrl = moduleUrl(modelSource);
  const modelModule = await import(modelUrl);
  const CubeModel = modelModule[symbols.CubeModel];
  const CubeMove = modelModule[symbols.CubeMove];
  for (const order of [2, 3, 4, 5, 6, 7]) {
    for (const axis of ['x', 'y', 'z']) {
      for (let layer = 0; layer < order; layer++) {
        for (const turns of [-1, 1]) {
          const cube = new CubeModel(order);
          const snapshot = JSON.stringify(cube.cubies);
          const move = new CubeMove(axis, layer, turns);
          cube.applyMove(move);
          check(!cube.isSolved(), 'one layer turn must change solved state');
          cube.applyMove(move.inverse());
          check(cube.isSolved() && JSON.stringify(cube.cubies) === snapshot, 'inverse must restore exact state');
          for (let i = 0; i < 4; i++) cube.applyMove(move);
          check(cube.isSolved() && JSON.stringify(cube.cubies) === snapshot, 'four turns must restore exact state');
        }
      }
    }
    let seed = 123456789;
    const cube = new CubeModel(order, () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296));
    const snapshot = JSON.stringify(cube.cubies);
    for (const move of cube.createScramble(65)) cube.applyMove(move, false);
    for (const move of cube.getSolution()) cube.applyMove(move, false);
    check(cube.isSolved() && JSON.stringify(cube.cubies) === snapshot, 'history solution must restore a real scramble');
  }

  const rendererSource = readFileSync(join(intermediate, 'render/CubeRenderer.ts'), 'utf8');
  const rendererImports = [...rendererSource.matchAll(/"(@bundle:[^"\r\n]+\/model\/CubeModel)"/g)];
  check(rendererImports.length === 2, 'compiled renderer must use the actual model imports');
  const rendererModule = await import(moduleUrl(rendererSource.replaceAll(rendererImports[0][0], JSON.stringify(modelUrl))));
  const CubeRenderer = rendererModule[symbols.CubeRenderer];
  const context = new Proxy({}, { get: () => () => {} });
  let guides = 0;
  for (const order of [2, 3, 4, 5]) {
    for (const [width, height] of [[300, 260], [360, 320], [480, 380]]) {
      const cube = new CubeModel(order);
      const renderer = new CubeRenderer();
      renderer.draw(context, width, height, cube, 0.62, -0.42);
      for (const scale of [1, 1.5, 2, 2.75, 3.5]) {
        for (const [axis, layer, turns] of [['y', order - 1, -1], ['x', order - 1, -1], ['y', 0, 1],
          ['x', 0, -1], ['z', order - 1, -1], ['y', order - 1, 1], ['x', order - 1, 1]]) {
          const guide = renderer.getSwipeGuide(new CubeMove(axis, layer, turns));
          check(guide !== null, 'obfuscated renderer must produce a visible guide');
          const points = [guide.startX, guide.startY, guide.endX, guide.endY].map(value => Math.round(value * scale) / scale);
          const picked = renderer.pickMove(...points, cube, 0.62, -0.42);
          check(picked?.axis === axis && picked.layer === layer && picked.turns === turns,
            'pixel-quantized guide must select the original turn through obfuscated imports');
          guides++;
        }
      }
    }
  }

  const storageSource = readFileSync(join(intermediate, 'storage/CubeStore.ts'), 'utf8');
  check(storageSource.includes('import preferences from "@ohos:data.preferences";'), 'compiled preferences import must be recognized');
  const preferencesUrl = moduleUrl('export default { getPreferences(context, options) { return context.open(options); } };');
  const storageModule = await import(moduleUrl(storageSource.replace('"@ohos:data.preferences"', JSON.stringify(preferencesUrl))));
  const CubeStore = storageModule[symbols.CubeStore];
  const SolveRecord = storageModule[symbols.SolveRecord];
  for (const legacy of [true, false]) {
    const settings = { defaultOrder: 5, speed: 1.7, sound: true, haptics: false };
    if (!legacy) settings.beginnerGuides = false;
    const record = { order: 3, durationMs: 12345, moves: 42, date: 1000 };
    const data = new Map([['settings', JSON.stringify(settings)], ['records', JSON.stringify([record])]]);
    const context = { async open(options) {
      assert.deepEqual(options, { name: 'cube_store' });
      return { async get(key, fallback) { return data.get(key) ?? fallback; },
        async put(key, value) { data.set(key, value); }, async flush() {} };
    } };
    const store = new CubeStore();
    await store.load(context);
    const expected = { ...settings, beginnerGuides: legacy };
    assert.deepEqual(plain(store.settings), expected);
    assert.deepEqual(plain(store.records), [record]);
    await store.saveSettings(store.settings);
    assert.deepEqual(JSON.parse(data.get('settings')), expected);
    const next = new SolveRecord(4, 9876, 30, 2000);
    await store.addRecord(next);
    const reloaded = new CubeStore();
    await reloaded.load(context);
    assert.deepEqual(plain(reloaded.settings), expected);
    assert.deepEqual(plain(reloaded.records), [plain(next), record]);
    checks += 5;
  }
  console.log(JSON.stringify({ status: 'passed', checks, pixelQuantizedGuides: guides, symbols,
    abcBytes: abc.length, abcSha256: digest(abc), unsignedHapSha256: digest(readFileSync(hap)), signedMatches,
    scope: 'Final HAP metadata and bytecode plus execution of obfuscated intermediate TypeScript; Preferences and Canvas are mocked; no device commands.' }, null, 2));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
