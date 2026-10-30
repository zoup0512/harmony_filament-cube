import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import { formatResource, productionMember, resourceManager, resourceStrings } from './resource-helper.mjs';

const smokeUrl = new URL('../scripts/smoke.mjs', import.meta.url);
const smoke = readFileSync(smokeUrl, 'utf8');
const page = readFileSync(new URL('../entry/src/main/ets/pages/Index.ets', import.meta.url), 'utf8');
// Load the actual smoke setup/helpers, stopping before either entry point. No
// HDC, artifacts, real timers, installs, or global environment patches occur.
const start = smoke.indexOf('const ROOT =');
const end = smoke.indexOf("\nif (process.argv.includes('--check-gestures'))");
assert.ok(start >= 0 && end > start, 'smoke entry boundary must be explicit');
const repeatedHintCase = smoke.match(/  await runCase\('hint-repeat-stability', async \(\) => \{[\s\S]*?\n  \}\);/)?.[0];
assert.ok(repeatedHintCase, 'the actual repeated-hint case must remain available for regression tests');
function smokeHarness(locale) {
  return new Script(`${smoke.slice(start, end).replaceAll('import.meta.url', JSON.stringify(smokeUrl.href))}
    ({ lesson, observedText, resourcePattern, flatten, matches, isHome, isGame, button,
      enabledButton, moves, timer, orderSelected, leaveDialogReady, dialogAction, metric, gameCanvas, idleControls,
      runRepeatedHints: async hooks => {
        const { game, swipeFace, dump, tap, tapNode, capture, check } = hooks;
        const runCase = async (_name, run) => run();
        let latest;
        const waitFor = async (...args) => { latest = await hooks.waitFor(...args); return latest; };
        ${repeatedHintCase}
      },
      SMOKE_LOCALE, RESOURCE_LOCALE, summary, regex: pattern => new RegExp(pattern) });`).runInNewContext({
    readFileSync, resolve, dirname, join, fileURLToPath,
    process: { env: locale === undefined ? {} : { SMOKE_LOCALE: locale }, pid: 1 },
    execFileSync() { assert.fail('smoke unit tests must never access a device'); }
  });
}
const hintMembers = ['tr', 'setHint', 'updateLessonHint', 'onLanguageChanged'].map(name => productionMember(page, name));
const Hint = new Script(stripTypeScriptTypes(`class Hint {
  textCache = new Map(); textLanguage = ''; language = ''; hintKey = ''; hintArgs = [];
  hintMove = null; phase = 'tutorial'; storageWarning = '';
  ${hintMembers.join('\n')}
}; Hint;`)).runInNewContext({ hilog: { error() {} } });

function tutorial(locale) {
  const state = new Hint();
  state.lessonTotal = 5;
  state.resetGuide = () => {};
  state.moveLabel = move => move;
  state.getUIContext = () => ({ getHostContext: () => ({ resourceManager: resourceManager(locale) }) });
  return state;
}
function layout(api, children) {
  const tree = { attributes: { bounds: '[0,0][1000,1000]', type: 'Root', enabled: true }, children };
  return { tree, nodes: api.flatten(tree), viewport: { left: 0, top: 0, right: 1000, bottom: 1000 } };
}
const element = (text, type = 'Text', extra = {}, children = []) => ({
  attributes: { text, type, bounds: '[10,10][900,100]', enabled: true, ...extra }, children
});

test('device gestures target the base canvas, never the transparent guidance overlay', () => {
  const api = smokeHarness('zh-CN');
  const state = layout(api, [
    element('', 'Canvas', { id: 'cube-guidance-canvas' }),
    element('', 'Canvas', { id: 'cube-base-canvas' })
  ]);
  assert.equal(api.gameCanvas(state)?.a.id, 'cube-base-canvas');
  assert.equal(api.gameCanvas(layout(api, [element('', 'Canvas', { id: 'cube-guidance-canvas' })])), undefined);
});

test('device idle checks distinguish offscreen controls from disabled animation controls', () => {
  const api = smokeHarness('zh-CN');
  const controls = enabled => layout(api, [
    element('', 'Canvas', { id: 'cube-base-canvas' }),
    element('打乱', 'Button', { bounds: '[0,1100][400,1200]', enabled }),
    element('复位', 'Button', { bounds: '[400,1100][900,1200]', enabled })
  ]);
  assert.equal(api.idleControls(controls(true)), true, 'offscreen is not busy');
  assert.equal(api.idleControls(controls(false)), false, 'disabled controls still identify animation');
  assert.equal(api.enabledButton(controls(true), '复位'), false, 'offscreen buttons must not be tappable');
  const omitted = layout(api, [
    element('', 'Canvas', { id: 'cube-base-canvas' }),
    element('正视角', 'Button'),
    element(formatResource(resourceStrings().lesson_step, [1, 5, 'D']))
  ]);
  assert.equal(api.idleControls(omitted), true, 'UI Test may omit bottom controls after tutorial setup');
  omitted.nodes.pop();
  assert.equal(api.idleControls(omitted), false, 'view control alone cannot prove animation is finished');
});

test('device suite retains repeated-hint, overlay alignment and undo checks', () => {
  assert.match(smoke, /runCase\('hint-repeat-stability'/);
  assert.match(smoke, /i < 12/);
  assert.match(smoke, /independent guidance canvas exactly overlays the cube/);
  assert.match(smoke, /undo after repeated hints/);
});

test('repeated hints use the first visible hint layout but still reject movement, resizing and overlay drift', async () => {
  const api = smokeHarness('zh-CN');
  const initialBounds = '[54,578][1026,1862]';
  const hintedBounds = '[54,568][1026,1852]';
  async function run(finalBounds = hintedBounds, overlayBounds = finalBounds) {
    let hinted = false;
    let undone = false;
    let repeats = 0;
    const captures = [];
    const checks = [];
    const hintText = formatResource(resourceStrings().history_hint, ["U'"]);
    const dump = () => {
      const canvasBounds = !hinted ? initialBounds : repeats ? finalBounds : hintedBounds;
      const tree = { attributes: { bounds: '[0,0][1080,2406]', type: 'Root', enabled: true }, children: [
        element('', 'Canvas', { id: 'cube-base-canvas', bounds: canvasBounds }),
        element('', 'Canvas', { id: 'cube-guidance-canvas', bounds: repeats ? overlayBounds : canvasBounds }),
        element('', 'Column', {}, [element('用时'), element('00:00.00')]),
        element('', 'Column', {}, [element('步数'), element(undone ? '0' : '1')]),
        ...['打乱', '复位', '还原提示', '撤销'].map(text => element(text, 'Button')),
        ...(hinted && !undone ? [element(hintText)] : [])
      ] };
      return { tree, nodes: api.flatten(tree), viewport: { left: 0, top: 0, right: 1080, bottom: 2406 } };
    };
    await api.runRepeatedHints({
      game: async order => assert.equal(order, 3),
      swipeFace: async face => assert.equal(face, 'U'),
      dump,
      tap: async query => {
        if (String(query).includes('撤销')) undone = true;
        else { assert.equal(query, '还原提示'); hinted = true; }
      },
      tapNode: node => { assert.equal(node.text, '还原提示'); repeats++; },
      waitFor: async (description, predicate, _timeout, samples = 1) => {
        let state;
        for (let i = 0; i < samples; i++) {
          state = dump();
          assert.ok(predicate(state), description);
        }
        return state;
      },
      capture: async label => {
        const state = dump();
        captures.push({ label, bounds: api.gameCanvas(state).a.bounds });
        return state;
      },
      check: (condition, description) => { assert.ok(condition, description); checks.push(description); }
    });
    assert.equal(repeats, 12);
    assert.equal(undone, true);
    assert.deepEqual(captures[0], { label: 'repeat-hint-before', bounds: hintedBounds });
    assert.ok(checks.includes('repeated hints do not shift or resize the cube'));
    assert.ok(checks.includes('independent guidance canvas exactly overlays the cube'));
  }
  await run();
  await assert.rejects(run(initialBounds), /repeated hints do not shift or resize the cube/);
  await assert.rejects(run('[54,568][1026,1853]'), /repeated hints do not shift or resize the cube/);
  await assert.rejects(run(hintedBounds, initialBounds), /independent guidance canvas exactly overlays the cube/);
});

for (const locale of ['zh-CN', 'en', 'en-US', 'en-GB']) {
  const api = smokeHarness(locale);
  test(`device smoke parser accepts actual ${locale} tutorial instructions for every outer face`, () => {
    const state = tutorial(locale);
    for (const face of ['U', "U'", 'D', "D'", 'L', "L'", 'R', "R'", 'F', "F'", 'B', "B'"]) {
      for (let step = 0; step < 5; step++) {
        state.lessonIndex = step;
        state.lesson = Array(5).fill(face);
        state.updateLessonHint();
        const observed = layout(api, [
          element(formatResource(resourceStrings(locale).lesson_step, [1, 5, 'U']), 'Text', { visible: false }),
          element(state.hint)
        ]);
        // Exercise native language parsing, not just translated observation text.
        observed.nodes.at(-1).text = state.hint;
        const result = api.lesson(observed);
        assert.ok(result, 'actual UI copy must remain usable by device smoke tests');
        assert.equal(result.step, step + 1);
        assert.equal(result.total, 5);
        assert.equal(result.face, face);
        assert.equal(result.text, state.hint);
        const normalized = api.lesson(layout(api, [element(state.hint)]));
        assert.equal(normalized.face, face);
        assert.equal(normalized.step, step + 1);
      }
    }
  });
}

test('device smoke parser rejects unrelated, incomplete, malformed and invisible tutorial text in both languages', () => {
  const api = smokeHarness('en');
  for (const locale of ['zh-CN', 'en']) {
    const strings = resourceStrings(locale);
    const valid = formatResource(strings.lesson_step, [1, 5, 'U']);
    const malformed = [strings.lesson_preparing, strings.guided_help, '第 1 / 5 步：',
      'Step 1 / 5: Follow the hand to make U.', '第 1 / 5 步：跟随小手完成 X。沿轨迹滑动',
      valid.slice(0, -12), `prefix ${valid}`, `${valid} trailing text`,
      ...[[0, 5, 'U'], [6, 5, 'U'], [1, 0, 'U'], [1, 5, 'X'], [1, 5, 'UU'], [1, 5, 'R2'],
        [1, 5, "R''"]].map(args => formatResource(strings.lesson_step, args))];
    for (const text of malformed) {
      assert.equal(api.lesson(layout(api, [element(text)])), null, `must reject ${text}`);
    }
    assert.equal(api.lesson(layout(api, [element(valid, 'Text', { visible: false })])), null);
  }
  assert.equal(api.lesson(layout(api, [])), null);
});

test('smoke locale defaults to Chinese and English language tags select English fallback resources', () => {
  assert.equal(smokeHarness().SMOKE_LOCALE, 'zh-CN');
  assert.equal(smokeHarness().RESOURCE_LOCALE, 'base');
  for (const locale of ['en', 'en-US', 'en-GB']) {
    const api = smokeHarness(locale);
    assert.equal(api.RESOURCE_LOCALE, 'en');
    assert.equal(api.summary.locale, locale);
    assert.equal(api.observedText('Choose your challenge'), '选择你的挑战');
  }
  assert.throws(() => smokeHarness('fr-FR'), /SMOKE_LOCALE/);
});

test('resource mocks and observation patterns honor reordered and repeated positional arguments', () => {
  assert.equal(formatResource('%2$s / %1$d / %1$d', [4, 'R']), 'R / 4 / 4');
  assert.equal(resourceManager('en-GB').getStringByNameSync('cube_title', 4), '4 × 4 Cube');
  const api = smokeHarness('en');
  assert.ok(api.resourcePattern('%2$s / %1$d / %1$d').pattern.test('R / 4 / 4'));
  assert.equal(api.resourcePattern('%2$s / %1$d / %1$d').pattern.test('R / 4 / 5'), false);
  assert.equal(api.observedText('4 × 5 Cube'), '4 × 5 Cube', 'repeated order must agree');
  assert.equal(api.observedText('4 by 4, selected'), '4 阶，已选择');
  assert.equal(api.observedText('Gesture guides'), '手势提示');
  assert.equal(api.observedText('Beginner gesture guides, off'), '新手手势提示，关');
  const en = resourceStrings('en');
  assert.equal(api.observedText(formatResource(en.history_hint, ['X layer 2 +90°'])),
    formatResource(resourceStrings().history_hint, ['X 第 2 层 +90°']));
  assert.equal(api.observedText('Moves: 17 · 10/23 09:40'), '17 步 · 10/23 09:40');
  assert.equal(api.observedText('Untranslated unknown label'), 'Untranslated unknown label');
});

test('English observations preserve actual smoke home, game, metrics, order, dialog and accessibility selectors', () => {
  const api = smokeHarness('en-US');
  const strings = resourceStrings('en');
  const rawHome = element('', 'Column', {}, [element(strings.choose_challenge), element(strings.start_game, 'Button')]);
  assert.equal(api.isHome(layout(api, [rawHome])), true);
  const state = layout(api, [element('4 × 4 Cube'),
    element('', 'Column', {}, [element('Time'), element('00:12.34')]),
    element('', 'Column', {}, [element('Moves'), element('17')]),
    ...[2, 3, 4, 5].map(n => element(`${n}×${n}`, 'Button', { backgroundColor: n === 4 ? 'green' : 'white' })),
    element('', 'Button', { description: 'Solve hint' }),
    element('', 'Button', { originalText: 'Undo' })]);
  assert.equal(api.isGame(state, 4), true);
  assert.equal(api.moves(state), 17);
  assert.equal(api.timer(state), '00:12.34');
  assert.equal(api.orderSelected(state, 4), true);
  assert.equal(api.enabledButton(state, '还原提示'), true);
  assert.equal(api.enabledButton(state, api.regex('撤销')), true);
  assert.equal(state.nodes.find(n => n.rawText === '4 × 4 Cube').text, '4 × 4 魔方');
  assert.equal(state.tree.children[0].attributes.text, '4 × 4 Cube', 'raw artifact trees stay untouched');
  const dialog = element('', 'AlertDialog', {}, [element('Return home?'), element(strings.keep_playing), element('Home'),
    element(resourceStrings('en').leave_message)]);
  const dialogs = layout(api, [element('Home'), dialog]);
  assert.equal(api.leaveDialogReady(dialogs), true);
  assert.equal(api.dialogAction(dialogs, '返回首页？', '返回首页').rawText, 'Home');
  assert.equal(api.leaveDialogReady(layout(api, [element('Return home?'), element(strings.keep_playing), element('Home')])), false,
    'background labels must not substitute for a dialog');
});
