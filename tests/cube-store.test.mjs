// Node 24: node --test tests/cube-store.test.mjs
// Only built-ins; transform the real .ets in memory, never edit production source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { setImmediate as nextTurn } from 'node:timers/promises';

const dataURL = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const source = await readFile(new URL('../entry/src/main/ets/storage/CubeStore.ets', import.meta.url), 'utf8');
const kitMocks = {
  '@kit.ArkData': dataURL(`export const preferences = {
    getPreferences(context, options) { return context.open(options); }
  };`),
  '@kit.AbilityKit': dataURL('export const common = {};')
};
let rewritten = source;
for (const [specifier, replacement] of Object.entries(kitMocks)) {
  const pattern = new RegExp(`(['"])${specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\1`, 'g');
  assert.equal([...rewritten.matchAll(pattern)].length, 1, `expected one ${specifier} import`);
  rewritten = rewritten.replace(pattern, JSON.stringify(replacement));
}
const { CubeStore, CubeSettings, SolveRecord, default: DefaultStore } = await import(
  dataURL(stripTypeScriptTypes(rewritten, { mode: 'strip' }))
);

const defaults = { defaultOrder: 3, speed: 1, sound: false, haptics: true, beginnerGuides: true };
const settings = overrides => ({ ...defaults, ...overrides });
const record = overrides => ({ order: 3, durationMs: 1234.5, moves: 20, date: 100, ...overrides });
const plain = value => JSON.parse(JSON.stringify(value));
const state = store => plain({ settings: store.settings, records: store.records });

function deferred() {
  return Promise.withResolvers();
}

function createStorage(initial = {}) {
  // put stages data; flush commits it. A failed flush does NOT imply rollback.
  // Hooks propagate rejections unchanged: no mock-side catch or queue recovery.
  const staged = new Map(Object.entries(initial));
  const durable = new Map(staged);
  const calls = [];
  const hooks = {};
  const storage = {
    async get(key, fallback) {
      calls.push(['get', key, fallback]);
      await hooks.get?.(key, fallback);
      return staged.has(key) ? staged.get(key) : fallback;
    },
    async put(key, value) {
      calls.push(['put', key, value]);
      await hooks.put?.(key, value);
      staged.set(key, value);
    },
    async flush() {
      calls.push(['flush']);
      await hooks.flush?.();
      for (const [key, value] of staged) durable.set(key, value);
    }
  };
  const context = {
    async open(options) {
      calls.push(['open', options]);
      await hooks.open?.(options);
      return storage;
    }
  };
  return { context, calls, hooks, durable, staged };
}

async function loaded(initial = {}) {
  const mock = createStorage(initial);
  const store = new CubeStore();
  await store.load(mock.context);
  assert.deepEqual(mock.calls, [
    ['open', { name: 'cube_store' }], ['get', 'settings', ''], ['get', 'records', '']
  ], 'load must only read preferences, never write or flush');
  mock.calls.length = 0;
  return { store, ...mock };
}

function invalidObjects(base, fields) {
  const cases = [null, undefined, [], 'invalid', 123, true].map(value => [String(value), value]);
  for (const [field, values] of Object.entries(fields)) {
    const missing = { ...base };
    delete missing[field];
    cases.push([`missing ${field}`, missing]);
    for (const value of values) cases.push([`${field}=${String(value)}`, { ...base, [field]: value }]);
  }
  return cases;
}

const invalidOrders = [1, 6, 2.5, NaN, Infinity, -Infinity, '3', null, true];
const invalidSettings = invalidObjects(settings(), {
  defaultOrder: invalidOrders,
  speed: [0.49, 2.01, NaN, Infinity, -Infinity, '1', null, true],
  sound: [0, 1, 'false', null, undefined],
  haptics: [0, 1, 'true', null, undefined]
});
// Missing beginnerGuides is a supported legacy setting, not a validation error.
for (const value of [0, 1, 'false', 'true', null, [], {}]) {
  invalidSettings.push([`beginnerGuides=${String(value)}`, settings({ beginnerGuides: value })]);
}
const invalidRecords = invalidObjects(record(), {
  order: invalidOrders,
  durationMs: [-1, NaN, Infinity, -Infinity, '123', null, true],
  moves: [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '20', null, true],
  date: [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '100', null, true]
});

test('exports, independent defaults, record constructor, and empty preferences', async () => {
  assert.equal(DefaultStore, CubeStore);
  const first = new CubeStore();
  const second = new CubeStore();
  assert.deepEqual(plain(new CubeSettings()), defaults);
  assert.deepEqual(state(first), { settings: defaults, records: [] });
  assert.notEqual(first.settings, second.settings);
  assert.notEqual(first.records, second.records);
  assert.deepEqual(plain(new SolveRecord(2, 0, 0, 0)), record({ order: 2, durationMs: 0, moves: 0, date: 0 }));
  const before = Date.now();
  const automatic = new SolveRecord(3, 10, 1);
  assert.ok(automatic.date >= before && automatic.date <= Date.now());
  const mock = createStorage();
  await first.load(mock.context);
  assert.deepEqual(state(first), { settings: defaults, records: [] });
  assert.deepEqual(mock.calls, [
    ['open', { name: 'cube_store' }], ['get', 'settings', ''], ['get', 'records', '']
  ]);
});

test('valid stored JSON loads known fields into settings and record instances', async () => {
  const expectedSettings = settings({ defaultOrder: 5, speed: 2, sound: true, haptics: false });
  const expectedRecord = record({ order: 2, date: 0 });
  const { store, calls } = await loaded({
    settings: JSON.stringify({ ...expectedSettings, unknown: 'ignored' }),
    records: JSON.stringify([{ ...expectedRecord, unknown: 'ignored' }])
  });
  assert.deepEqual(state(store), { settings: expectedSettings, records: [expectedRecord] });
  assert.ok(store.settings instanceof CubeSettings);
  assert.ok(store.records[0] instanceof SolveRecord);
  assert.deepEqual(calls, [], 'loading must not rewrite preferences');
});

test('legacy settings enable beginner arrows without resetting existing preferences or rewriting storage', async () => {
  const legacy = { defaultOrder: 5, speed: 1.7, sound: true, haptics: false };
  const json = JSON.stringify(legacy);
  const { store, calls, durable } = await loaded({ settings: json });
  assert.deepEqual(plain(store.settings), { ...legacy, beginnerGuides: true });
  assert.deepEqual(calls, []);
  assert.equal(durable.get('settings'), json);
  await store.saveSettings(legacy);
  assert.deepEqual(JSON.parse(durable.get('settings')), { ...legacy, beginnerGuides: true });
});

for (const beginnerGuides of [false, true]) {
  test(`beginnerGuides=${beginnerGuides} survives save, snapshot, and a fresh load`, async () => {
    const { store, durable, context } = await loaded();
    const input = settings({ defaultOrder: 2, speed: 1.4, beginnerGuides });
    const expected = { ...input };
    const saving = store.saveSettings(input);
    input.beginnerGuides = !beginnerGuides;
    await saving;
    assert.deepEqual(plain(store.settings), expected);
    assert.deepEqual(JSON.parse(durable.get('settings')), expected);
    const reloaded = new CubeStore();
    await reloaded.load(context);
    assert.deepEqual(plain(reloaded.settings), expected);
    assert.equal(reloaded.settings.beginnerGuides, beginnerGuides);
  });
}

test('malformed JSON and non-string preferences recover each key independently', async () => {
  const goodSettings = settings({ defaultOrder: 4 });
  const goodRecords = [record()];
  for (const bad of ['', '{broken', '[', 'undefined', 7, false, null, {}, []]) {
    const { store: badSettings } = await loaded({ settings: bad, records: JSON.stringify(goodRecords) });
    assert.deepEqual(state(badSettings), { settings: defaults, records: goodRecords });
    const { store: badRecords } = await loaded({ settings: JSON.stringify(goodSettings), records: bad });
    assert.deepEqual(state(badRecords), { settings: goodSettings, records: [] });
  }
});

test('stored settings validate every field; records reject the entire invalid collection', async () => {
  for (const [label, value] of invalidSettings) {
    const { store } = await loaded({ settings: JSON.stringify(value) });
    assert.deepEqual(plain(store.settings), defaults, label);
  }
  for (const [label, value] of invalidRecords) {
    const { store } = await loaded({ records: JSON.stringify([record(), value]) });
    assert.deepEqual(store.records, [], label);
  }
  for (const value of [null, {}, record(), 12, true, 'not an array']) {
    const { store } = await loaded({ records: JSON.stringify(value) });
    assert.deepEqual(store.records, [], 'records root must be an array');
  }
});

test('invalid saveSettings/addRecord inputs reject without I/O or state changes', async () => {
  const { store, calls } = await loaded();
  const before = state(store);
  for (const [label, value] of invalidSettings) {
    await assert.rejects(store.saveSettings(value), /Invalid cube settings/, label);
    assert.deepEqual(state(store), before, label);
  }
  for (const [label, value] of invalidRecords) {
    await assert.rejects(store.addRecord(value), /Invalid solve record/, label);
    assert.deepEqual(state(store), before, label);
  }
  assert.deepEqual(calls, []);
  await store.addRecord(record());
  assert.deepEqual(plain(store.records), [record()], 'validation failures must not poison later writes');
});

test('validation accepts order/speed boundaries, zero values, and safe integer maxima', async () => {
  const { store, durable } = await loaded();
  for (const defaultOrder of [2, 3, 4, 5]) {
    for (const speed of [0.5, 1.25, 2]) {
      const value = settings({ defaultOrder, speed, sound: true, haptics: false });
      await store.saveSettings(value);
      assert.deepEqual(plain(store.settings), value);
      assert.deepEqual(JSON.parse(durable.get('settings')), value);
    }
  }
  const values = [
    record({ order: 2, durationMs: 0, moves: 0, date: 0 }),
    record({ order: 5, durationMs: 0.25, moves: Number.MAX_SAFE_INTEGER, date: Number.MAX_SAFE_INTEGER })
  ];
  for (const value of values) await store.addRecord(value);
  assert.deepEqual(plain(store.records), values.toReversed());
  assert.deepEqual(JSON.parse(durable.get('records')), values.toReversed());
});

test('queued load and writes wait for put and flush; caller inputs are snapshotted', { timeout: 5000 }, async t => {
  const mock = createStorage();
  const store = new CubeStore();
  const opened = deferred();
  const releaseOpen = deferred();
  const putEntered = deferred();
  const releasePut = deferred();
  const flushEntered = deferred();
  const releaseFlush = deferred();
  t.after(() => { releaseOpen.resolve(); releasePut.resolve(); releaseFlush.resolve(); });
  mock.hooks.open = async () => { opened.resolve(); await releaseOpen.promise; };
  let puts = 0;
  mock.hooks.put = async () => {
    if (++puts === 1) { putEntered.resolve(); await releasePut.promise; }
  };
  let flushes = 0;
  mock.hooks.flush = async () => {
    if (++flushes === 1) { flushEntered.resolve(); await releaseFlush.promise; }
  };
  const inputSettings = settings({ defaultOrder: 2, speed: 0.5 });
  const inputRecord = record({ date: 20 });
  const expectedSettings = { ...inputSettings };
  const expectedRecord = { ...inputRecord };
  const olderRecord = record({ date: 10 });
  const finalRecord = record({ date: 30 });
  // Attach a rejection observer to every returned promise immediately. No catch
  // that turns failures into success; Promise.all must reject if any write fails.
  const done = Promise.all([
    store.load(mock.context), store.saveSettings(inputSettings), store.addRecord(inputRecord),
    store.addRecord(olderRecord), store.clearRecords(), store.addRecord(finalRecord)
  ]);
  inputSettings.defaultOrder = 5;
  inputRecord.date = 999;
  await opened.promise;
  await nextTurn();
  assert.deepEqual(mock.calls, [['open', { name: 'cube_store' }]]);
  releaseOpen.resolve();
  await putEntered.promise;
  await nextTurn();
  assert.deepEqual(mock.calls.slice(3), [['put', 'settings', JSON.stringify(expectedSettings)]]);
  assert.deepEqual(state(store), { settings: defaults, records: [] });
  releasePut.resolve();
  await flushEntered.promise;
  await nextTurn();
  assert.equal(puts, 1, 'next write must wait for the previous flush');
  assert.deepEqual(state(store), { settings: defaults, records: [] }, 'publish only after flush succeeds');
  releaseFlush.resolve();
  await done;
  assert.deepEqual(mock.calls.slice(3), [
    ['put', 'settings', JSON.stringify(expectedSettings)], ['flush'],
    ['put', 'records', JSON.stringify([expectedRecord])], ['flush'],
    ['put', 'records', JSON.stringify([expectedRecord, olderRecord])], ['flush'],
    ['put', 'records', '[]'], ['flush'],
    ['put', 'records', JSON.stringify([finalRecord])], ['flush']
  ]);
  assert.deepEqual(state(store), { settings: expectedSettings, records: [finalRecord] });
  assert.deepEqual(JSON.parse(mock.durable.get('settings')), expectedSettings);
  assert.deepEqual(JSON.parse(mock.durable.get('records')), [finalRecord]);
});

for (const operation of ['saveSettings', 'addRecord', 'clearRecords']) {
  for (const failureStage of ['put', 'flush']) {
    test(`${operation}: ${failureStage} error reaches its caller while a queued write can continue`, { timeout: 5000 }, async t => {
      const initialSettings = settings({ defaultOrder: 4 });
      const initialRecord = record({ date: 50 });
      const { store, hooks, calls, durable } = await loaded({
        settings: JSON.stringify(initialSettings), records: JSON.stringify([initialRecord])
      });
      const before = state(store);
      const error = new Error(`${operation} ${failureStage} failed`);
      const recoveryEntered = deferred();
      const releaseRecovery = deferred();
      t.after(() => releaseRecovery.resolve());
      let attempts = 0;
      hooks[failureStage] = async () => {
        if (++attempts === 1) throw error;
        recoveryEntered.resolve();
        await releaseRecovery.promise;
      };
      const failedInput = operation === 'saveSettings' ? settings({ speed: 2 }) : record({ date: 200 });
      const failed = store[operation](failedInput);
      // Observe THIS call before scheduling recovery: a successful later call
      // must never hide a rejection or change which error the first caller sees.
      const rejected = assert.rejects(failed, actual => actual === error);
      const recoveredRecord = record({ date: 100 });
      const recoveredSettings = settings({ speed: 0.5 });
      const recovery = operation === 'saveSettings' ?
        store.saveSettings(recoveredSettings) : store.addRecord(recoveredRecord);
      const recoveryCheck = assert.doesNotReject(recovery);
      await rejected;
      await recoveryEntered.promise;
      assert.deepEqual(state(store), before, 'failed operation must not publish its proposed state');
      releaseRecovery.resolve();
      await recoveryCheck;
      const expected = operation === 'saveSettings' ?
        { settings: recoveredSettings, records: [initialRecord] } :
        { settings: initialSettings, records: [recoveredRecord, initialRecord] };
      assert.deepEqual(state(store), expected);
      assert.deepEqual(JSON.parse(durable.get('settings')), expected.settings);
      assert.deepEqual(JSON.parse(durable.get('records')), expected.records);
      assert.equal(calls.filter(([name]) => name === 'put').length, 2);
      assert.equal(calls.filter(([name]) => name === 'flush').length, failureStage === 'put' ? 1 : 2);
    });
  }
}

for (const failureStage of ['open', 'settings', 'records']) {
  test(`load propagates ${failureStage} I/O failure instead of treating it as corrupt JSON`, async () => {
    const { store, context, hooks } = await loaded({
      settings: JSON.stringify(settings({ defaultOrder: 2 })), records: JSON.stringify([record()])
    });
    const before = state(store);
    const error = new Error(`read ${failureStage} failed`);
    if (failureStage === 'open') hooks.open = async () => { throw error; };
    else hooks.get = async key => { if (key === failureStage) throw error; };
    await assert.rejects(store.load(context), actual => actual === error);
    assert.deepEqual(state(store), before);
    delete hooks.open;
    delete hooks.get;
    await store.load(context);
    await store.addRecord(record({ date: 200 }));
    assert.deepEqual(plain(store.records).map(value => value.date), [200, 100]);
  });
}

const manyRecords = Array.from({ length: 205 }, (_, index) => record({ date: (index * 73) % 205 }));
const newest200 = manyRecords.toSorted((a, b) => b.date - a.date).slice(0, 200);

test('load retains at most 200 records ordered newest first, not the first 200 stored', async () => {
  const { store, calls } = await loaded({ records: JSON.stringify(manyRecords) });
  assert.equal(store.records.length, 200);
  assert.deepEqual(plain(store.records), newest200);
  assert.deepEqual(calls, []);
});

test('concurrent additions retain exactly the newest 200 in memory and persisted JSON', async () => {
  const { store, calls, durable } = await loaded();
  await Promise.all(manyRecords.map(value => store.addRecord(value)));
  assert.deepEqual(plain(store.records), newest200);
  assert.deepEqual(JSON.parse(durable.get('records')), newest200);
  assert.equal(calls.length, manyRecords.length * 2);
  for (let index = 0; index < manyRecords.length; index++) {
    const [name, key, json] = calls[index * 2];
    assert.deepEqual([name, key], ['put', 'records']);
    assert.deepEqual(calls[index * 2 + 1], ['flush']);
    const expected = manyRecords.slice(0, index + 1).sort((a, b) => b.date - a.date).slice(0, 200);
    assert.deepEqual(JSON.parse(json), expected, `write ${index} must include all prior successful additions`);
  }
});

test('clearRecords persists an empty collection without changing settings and remains reusable', async () => {
  const savedSettings = settings({ defaultOrder: 5, speed: 1.5, sound: true });
  const { store, calls, durable, context } = await loaded({
    settings: JSON.stringify(savedSettings), records: JSON.stringify([record()])
  });
  const settingsReference = store.settings;
  const settingsJSON = durable.get('settings');
  await store.clearRecords();
  assert.deepEqual(calls, [['put', 'records', '[]'], ['flush']]);
  assert.equal(store.settings, settingsReference);
  assert.deepEqual(plain(store.settings), savedSettings);
  assert.equal(durable.get('settings'), settingsJSON);
  assert.equal(durable.get('records'), '[]');
  assert.deepEqual(store.records, []);
  const reloaded = new CubeStore();
  await reloaded.load(context);
  assert.deepEqual(state(reloaded), { settings: savedSettings, records: [] });
  await store.clearRecords();
  await store.addRecord(record({ date: 200 }));
  assert.deepEqual(plain(store.records), [record({ date: 200 })]);
});

test('all write APIs reject before load; loading afterward recovers the rejected queue', async () => {
  const store = new CubeStore();
  const mock = createStorage();
  // Check each caller, not merely the last queued promise.
  await Promise.all([
    assert.rejects(store.saveSettings(settings()), /CubeStore is not loaded/),
    assert.rejects(store.addRecord(record()), /CubeStore is not loaded/),
    assert.rejects(store.clearRecords(), /CubeStore is not loaded/)
  ]);
  assert.deepEqual(state(store), { settings: defaults, records: [] });
  assert.deepEqual(mock.calls, []);
  await store.load(mock.context);
  await store.saveSettings(settings({ defaultOrder: 2 }));
  await store.addRecord(record());
  await store.clearRecords();
  assert.deepEqual(state(store), { settings: settings({ defaultOrder: 2 }), records: [] });
});
