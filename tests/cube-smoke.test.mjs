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
function smokeHarness(locale) {
  return new Script(`${smoke.slice(start, end).replaceAll('import.meta.url', JSON.stringify(smokeUrl.href))}
    ({ lesson, observedText, resourcePattern, flatten, matches, isHome, isGame, button,
      enabledButton, moves, timer, orderSelected, leaveDialogReady, dialogAction, metric,
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
  assert.equal(api.observedText('Guides on'), '手势 开');
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
    element('', 'Button', { description: 'History hint' }),
    element('', 'Button', { originalText: '↶ Undo' })]);
  assert.equal(api.isGame(state, 4), true);
  assert.equal(api.moves(state), 17);
  assert.equal(api.timer(state), '00:12.34');
  assert.equal(api.orderSelected(state, 4), true);
  assert.equal(api.enabledButton(state, '历史提示'), true);
  assert.equal(api.enabledButton(state, api.regex('撤销')), true);
  assert.equal(state.nodes.find(n => n.rawText === '4 × 4 Cube').text, '4 × 4 魔方');
  assert.equal(state.tree.children[0].attributes.text, '4 × 4 Cube', 'raw artifact trees stay untouched');
  const dialog = element('', 'AlertDialog', {}, [element('Return home?'), element('Keep playing'), element('Home'),
    element(resourceStrings('en').leave_message)]);
  const dialogs = layout(api, [element('Home'), dialog]);
  assert.equal(api.leaveDialogReady(dialogs), true);
  assert.equal(api.dialogAction(dialogs, '返回首页？', '返回首页').rawText, 'Home');
  assert.equal(api.leaveDialogReady(layout(api, [element('Return home?'), element('Keep playing'), element('Home')])), false,
    'background labels must not substitute for a dialog');
});
