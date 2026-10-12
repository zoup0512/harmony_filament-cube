import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../entry/src/main/ets/platform/CubeFeedback.ets', import.meta.url), 'utf8');
const executable = stripTypeScriptTypes(source
  .replace(/^import .* from '@kit\.[^']+';\r?\n/gm, '')
  .replace('export class CubeFeedback', 'class CubeFeedback')
  .replace('export default CubeFeedback;', 'globalThis.CubeFeedback = CubeFeedback;'));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function drain() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

function harness(options = {}) {
  const events = [];
  const listeners = new Map();
  const timers = new Map();
  let nextTimer = 1;
  const calls = { create: 0, fd: 0, prepare: 0, play: 0, release: 0, close: 0, vibrate: 0, volume: 0 };
  function fail(stage) {
    if (options.throwAt === stage) throw new Error(stage);
    if (options.rejectAt === stage) return Promise.reject(new Error(stage));
    return undefined;
  }
  const player = {
    state: 'idle',
    on(event, callback) { listeners.set(event, callback); },
    off(event) { listeners.delete(event); },
    emit(state) {
      this.state = state;
      listeners.get('stateChange')?.(state);
    },
    error() { listeners.get('error')?.(new Error('audio')); },
    set fdSrc(value) {
      fail('fdSrc');
      assert.equal(value.fd, 42);
      events.push('source');
      this.emit('initialized');
    },
    prepare() {
      calls.prepare++;
      const failure = fail('prepare');
      if (failure) return failure;
      if (!options.stallPrepare) this.emit('prepared');
      return Promise.resolve();
    },
    setVolume(volume) {
      calls.volume++;
      assert.equal(volume, 0.25);
      fail('volume');
    },
    play() {
      calls.play++;
      const failure = fail('play');
      return failure ?? Promise.resolve();
    },
    release() {
      calls.release++;
      events.push('release:start');
      const failure = fail('release');
      if (failure) return failure;
      return (options.releaseGate?.promise ?? Promise.resolve()).then(() => {
        events.push('release:end');
        this.emit('released');
      });
    }
  };
  const context = {
    resourceManager: {
      getRawFd(name) {
        calls.fd++;
        assert.equal(name, 'turn.wav');
        const failure = fail('getRawFd');
        return failure ?? options.fdGate?.promise ?? Promise.resolve({ fd: 42, offset: 0, length: 3572 });
      },
      closeRawFd(name) {
        calls.close++;
        assert.equal(name, 'turn.wav');
        events.push('close');
        return fail('close') ?? Promise.resolve();
      }
    }
  };
  const sandbox = {
    media: {
      createAVPlayer() {
        calls.create++;
        return fail('create') ?? options.createGate?.promise ?? Promise.resolve(player);
      }
    },
    vibrator: {
      startVibration(effect, usage) {
        calls.vibrate++;
        assert.equal(effect.type, 'time');
        assert.equal(effect.duration, 12);
        assert.equal(usage.usage, 'touch');
        return fail('vibrate') ?? Promise.resolve();
      }
    },
    setTimeout(callback, delay) {
      assert.equal(delay, 3000);
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) { timers.delete(id); }
  };
  runInNewContext(executable, sandbox);
  return {
    feedback: new sandbox.CubeFeedback(), context, player, calls, events, timers, listeners,
    timeout() {
      const callbacks = [...timers.values()];
      timers.clear();
      for (const callback of callbacks) callback();
    }
  };
}

for (const mode of ['throwAt', 'rejectAt']) {
  for (const stage of ['create', 'getRawFd', 'prepare', 'play']) {
    test(`${mode} ${stage}: audio failure preserves vibration and settles preparation`, async () => {
      const h = harness({ [mode]: stage });
      await h.feedback.prepare(h.context);
      if (stage === 'play') h.feedback.play(true, false);
      await drain();
      const previousPlays = h.calls.play;
      h.feedback.play(true, true);
      await drain();
      assert.equal(h.calls.vibrate, 1);
      assert.equal(h.calls.play, previousPlays);
      assert.equal(h.timers.size, 0);
      assert.equal(h.calls.release, stage === 'create' ? 0 : 1);
      assert.equal(h.calls.close, ['prepare', 'play'].includes(stage) ? 1 : 0);
      await h.feedback.prepare(h.context);
      assert.equal(h.calls.create, 1);
      h.feedback.release();
      h.feedback.play(true, true);
      assert.equal(h.calls.vibrate, 1);
    });
  }
}

for (const signal of ['error', 'state']) {
  test(`${signal} audio event preserves vibration`, async () => {
    const h = harness();
    await h.feedback.prepare(h.context);
    if (signal === 'error') h.player.error();
    else h.player.emit('error');
    await drain();
    h.feedback.play(true, true);
    assert.equal(h.calls.vibrate, 1);
    assert.equal(h.calls.play, 0);
    assert.equal(h.calls.release, 1);
    assert.equal(h.calls.close, 1);
  });
}

test('preload is shared; playback never queues, including the state-transition gap', async () => {
  const h = harness();
  await Promise.all([h.feedback.prepare(h.context), h.feedback.prepare(h.context)]);
  assert.equal(h.calls.create, 1);
  assert.equal(h.calls.prepare, 1);
  assert.equal(h.calls.volume, 1);
  assert.equal(h.timers.size, 0);
  h.feedback.play(false, false);
  assert.equal(h.calls.play, 0);
  h.feedback.play(true, true);
  h.feedback.play(true, true);
  await drain();
  h.feedback.play(true, false);
  assert.equal(h.calls.play, 1);
  h.player.emit('playing');
  h.feedback.play(true, false);
  h.player.emit('completed');
  await drain();
  assert.equal(h.calls.play, 1);
  h.feedback.play(true, false);
  assert.equal(h.calls.play, 2);
  assert.equal(h.calls.vibrate, 2);
  h.feedback.release();
  h.feedback.release();
  await drain();
  assert.deepEqual(h.events.slice(-3), ['release:start', 'release:end', 'close']);
  assert.equal(h.calls.release, 1);
  assert.equal(h.listeners.size, 0);
});

for (const action of ['release', 'timeout']) {
  test(`${action} during pending player creation releases late player`, async () => {
    const gate = deferred();
    const h = harness({ createGate: gate });
    const ready = h.feedback.prepare(h.context);
    if (action === 'release') h.feedback.release();
    else h.timeout();
    await ready;
    assert.equal(h.timers.size, 0);
    gate.resolve(h.player);
    await drain();
    assert.equal(h.calls.release, 1);
    assert.equal(h.calls.fd, 0);
    assert.equal(h.calls.prepare, 0);
    h.feedback.play(true, true);
    assert.equal(h.calls.vibrate, action === 'release' ? 0 : 1);
  });

  test(`${action} during pending fd closes late fd after player release`, async () => {
    const fdGate = deferred();
    const releaseGate = deferred();
    const h = harness({ fdGate, releaseGate });
    const ready = h.feedback.prepare(h.context);
    await drain();
    assert.equal(h.calls.fd, 1);
    if (action === 'release') h.feedback.release();
    else h.timeout();
    await ready;
    await drain();
    assert.equal(h.calls.release, 1);
    fdGate.resolve({ fd: 42, offset: 0, length: 3572 });
    await drain();
    assert.equal(h.calls.close, 0);
    releaseGate.resolve();
    await drain();
    assert.equal(h.calls.close, 1);
    assert.equal(h.calls.prepare, 0);
    assert.deepEqual(h.events, ['release:start', 'release:end', 'close']);
    h.feedback.release();
    await drain();
    assert.equal(h.calls.release, 1);
    assert.equal(h.calls.close, 1);
  });
}

test('prepare timeout settles callers, cancels timer, cleans audio and ignores late state events', async () => {
  const h = harness({ stallPrepare: true });
  const ready = h.feedback.prepare(h.context);
  await drain();
  assert.equal(h.calls.prepare, 1);
  assert.equal(h.timers.size, 1);
  const lateState = h.listeners.get('stateChange');
  h.timeout();
  await ready;
  lateState('prepared');
  await drain();
  assert.equal(h.calls.volume, 0);
  assert.equal(h.calls.release, 1);
  assert.equal(h.calls.close, 1);
  assert.equal(h.timers.size, 0);
  h.feedback.play(true, true);
  assert.equal(h.calls.play, 0);
  assert.equal(h.calls.vibrate, 1);
});

for (const mode of ['throwAt', 'rejectAt']) {
  test(`${mode} vibration failure does not block audio`, async () => {
    const h = harness({ [mode]: 'vibrate' });
    await h.feedback.prepare(h.context);
    h.feedback.play(true, true);
    await drain();
    assert.equal(h.calls.play, 1);
    h.feedback.release();
    await drain();
  });

  for (const stage of ['release', 'close']) {
    test(`${mode} ${stage}: cleanup errors remain contained`, async () => {
      const h = harness({ [mode]: stage });
      await h.feedback.prepare(h.context);
      h.feedback.release();
      await drain();
      assert.equal(h.calls.release, 1);
      assert.equal(h.calls.close, 1);
      assert.equal(h.timers.size, 0);
    });
  }
}
