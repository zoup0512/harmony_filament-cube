import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import { TeachingChallenge, createTeachingChallenges } from './teaching-helper.mjs';
import { formatResource, productionMember } from './resource-helper.mjs';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const source = read('entry/src/main/ets/pages/Index.ets');
const resultSource = read('entry/src/main/ets/pages/SolveResultDialog.ets');
const resultMethods = stripTypeScriptTypes(`class LocalizedResult {
  ${productionMember(resultSource, 'formatTime')}
}; LocalizedResult;`);
const ability = read('entry/src/main/ets/entryability/EntryAbility.ets');
const scopes = ['AppScope', 'entry/src/main'];
const locales = ['base', 'en', 'en_US'];
const tables = Object.fromEntries(scopes.map(scope => [scope, Object.fromEntries(locales.map(locale => {
  const entries = JSON.parse(read(`${scope}/resources/${locale}/element/string.json`)).string;
  return [locale, entries];
}))]));
const strings = Object.fromEntries(locales.map(locale => [locale,
  Object.fromEntries(tables['entry/src/main'][locale].map(entry => [entry.name, entry.value]))]));

function member(name) {
  const matches = [...source.matchAll(new RegExp(`^  private (?:async )?${name}\\([^\\r\\n]*\\)[^\\r\\n]*\\{\\r?\\n[\\s\\S]*?^  \\}`, 'gm'))];
  assert.equal(matches.length, 1, `one production ${name} method`);
  return matches[0][0];
}

const methods = ['tr', 'setHint', 'onLanguageChanged', 'updateLessonHint', 'moveLabel', 'faceMove', 'sameMove',
  'phaseLabel', 'orderDescription', 'toast', 'teachingStatus', 'teachingBest', 'formatTime'].map(member).join('\n');
const harnessSource = stripTypeScriptTypes(`class LocalizedPage {
  language = 'zh-CN'; textLanguage = ''; textCache = new Map(); hintKey = ''; hintArgs = [];
  hint = ''; storageWarning = ''; phase = 'idle'; busy = false; queueKind = ''; assisted = false;
  order = 5; lessonIndex = 0; lessonTotal = 1; lesson = []; hintMove = null;
  challengeIndex = -1; challenges = createTeachingChallenges(); teachingRecords = [];
  firstFaces = ['U', "U'", 'D', "D'", 'L', "L'"];
  secondFaces = ['R', "R'", 'F', "F'", 'B', "B'"];
  resetGuide() {}
${methods}
}; globalThis.LocalizedPage = LocalizedPage;`, { mode: 'strip' });

function harness(locale = 'zh-CN') {
  const calls = [];
  const errors = [];
  const context = { TeachingChallenge, createTeachingChallenges,
    hilog: { error: (...args) => errors.push(args) }, CubeMove: class {
    constructor(axis, layer, turns) { Object.assign(this, { axis, layer, turns }); }
  }};
  vm.runInNewContext(harnessSource, context);
  const page = new context.LocalizedPage();
  page.language = locale;
  page.getUIContext = () => ({ getHostContext: () => ({ resourceManager: {
    getStringByNameSync(name, ...args) {
      calls.push({ name, args, locale: page.language });
      const language = page.language.replaceAll('-', '_');
      const table = strings[language] ?? strings[language.split('_')[0]] ?? strings.base;
      assert.ok(Object.hasOwn(table, name), `missing string ${name}`);
      return table[name].replace(/%(\d+)\$([sd])/g, (_, position, type) => {
        const value = args[Number(position) - 1];
        assert.notEqual(value, undefined, `missing argument ${position} for ${name}`);
        if (type === 'd') assert.equal(typeof value, 'number');
        return String(value);
      });
    }
  }}), getPromptAction: () => ({ showToast() { throw new Error('no toast service'); } }) });
  return { page, calls, errors };
}

for (const scope of scopes) {
  test(`${scope} has complete unique Chinese and English resource keys`, () => {
    const baseKeys = tables[scope].base.map(entry => entry.name).sort();
    for (const locale of locales) {
      const entries = tables[scope][locale];
      const keys = entries.map(entry => entry.name).sort();
      assert.equal(new Set(keys).size, keys.length, `${locale}: duplicate keys`);
      assert.deepEqual(keys, baseKeys, `${locale}: keys must match base`);
      for (const entry of entries) {
        assert.equal(typeof entry.value, 'string');
        assert.ok(entry.value.trim(), `${locale}: empty ${entry.name}`);
        if (locale !== 'base') assert.doesNotMatch(entry.value, /[\u3400-\u9fff]/, `${locale}: untranslated ${entry.name}`);
      }
    }
    assert.deepEqual(tables[scope].en, tables[scope].en_US, 'US English and shared English currently use the same copy');
  });
}

test('visible copy uses practice terminology without changing internal resource names', () => {
  for (const scope of scopes) {
    for (const locale of locales) {
      for (const { name, value } of tables[scope][locale]) {
        assert.doesNotMatch(value, /游戏|遊戲|玩|电玩|手游|\b(?:games?|gaming|gameplay|gamers?|players?|play|playing)\b/i,
          `${scope}/${locale}: ${name}`);
      }
    }
  }
  assert.equal(strings.base.keep_playing, '继续练习');
  assert.equal(strings.en.keep_playing, 'Continue practice');
});

test('translations preserve positional argument types and repeated placeholders', () => {
  const signature = value => [...new Set(value.match(/%\d+\$[sd]/g) ?? [])].sort();
  for (const [key, value] of Object.entries(strings.base)) {
    for (const locale of ['en', 'en_US']) {
      assert.deepEqual(signature(strings[locale][key]), signature(value), `${locale}: ${key}`);
      assert.doesNotMatch(strings[locale][key].replace(/%\d+\$[sd]/g, ''), /%/);
    }
  }
});

test('page and ability labels are fully resource-backed without hardcoded Chinese', () => {
  assert.doesNotMatch(source, /[\u3400-\u9fff]/);
  const refs = [...source.matchAll(/this\.(?:tr|setHint)\('([^']+)'/g)].map(match => match[1]);
  assert.ok(refs.length > 100);
  for (const key of refs) assert.ok(Object.hasOwn(strings.base, key), `unknown resource ${key}`);
  assert.match(source, /accessibilityText\(this\.tr\('cube_accessibility', this\.order\)\)/);
  assert.match(source, /Text\(this\.tr\('about_name'\)\)/);
  assert.match(source, /Text\(this\.tr\('brand_name'\)\)/);
  assert.match(ability, /onConfigurationUpdate\(configuration: Configuration\)/);
  assert.match(ability, /AppStorage\.setOrCreate\('cubeLanguage', configuration\.language/);
  assert.match(source, /@StorageLink\('cubeLanguage'\) @Watch\('onLanguageChanged'\)/);
  // Builder parameters are cached; translated strings must be resolved inside them.
  assert.match(source, /private header\(titleKey: string, compactBack: boolean = false\)/);
  assert.match(source, /private sectionTitle\(kickerKey: string, titleKey: string\)/);
  assert.match(source, /Text\(this\.tr\(titleKey\)\)/);
  assert.doesNotMatch(source, /this\.(?:header|sectionTitle)\(this\.tr\(/);
});

test('independent result component resolves every resource in Chinese, shared English and US English', () => {
  assert.doesNotMatch(resultSource, /[\u3400-\u9fff]/);
  assert.doesNotMatch(resultSource, /\b(?:Text|Button)\(\s*['"][^'"]+['"]/,
    'visible result copy must not be a literal outside resources');
  const refs = new Set([...resultSource.matchAll(/\$r\('app\.string\.([^']+)'/g)].map(match => match[1]));
  assert.deepEqual([...refs].sort(), ['result_solved', 'teaching_passed', 'teaching_passed_guided',
    'cube_title', 'teaching_level', 'elapsed_time', 'move_count'].sort());
  assert.match(resultSource, /\$r\('app\.string\.cube_title', this\.result\.order\)/);
  assert.match(resultSource, /\$r\('app\.string\.teaching_level', this\.result\.challengeIndex \+ 1\)/);
  const args = { cube_title: [5], teaching_level: [8] };
  for (const locale of locales) {
    for (const key of refs) {
      const value = strings[locale][key];
      assert.equal(typeof value, 'string', `${locale}: missing result resource ${key}`);
      const formatted = formatResource(value, args[key] ?? []);
      assert.ok(formatted.trim());
      assert.doesNotMatch(formatted, /%\d+\$[sd]/, `${locale}: unresolved result argument ${key}`);
    }
    assert.deepEqual(Object.keys(strings[locale]).filter(key => key.startsWith('result_')), ['result_solved']);
  }
});

test('centered result titles use narrow punctuation without trailing whitespace', () => {
  for (const key of ['result_solved', 'teaching_passed', 'teaching_passed_guided']) {
    for (const locale of locales) {
      const title = strings[locale][key];
      assert.ok(title.endsWith('!'), `${locale}: ${key} must use a half-width exclamation mark`);
      assert.equal(title, title.trim(), `${locale}: ${key} must not include alignment whitespace`);
      assert.doesNotMatch(title, /！/);
    }
  }
});

test('result time formatter preserves the frozen duration without locale-specific placeholders', () => {
  const Result = vm.runInNewContext(resultMethods);
  const dialog = new Result();
  for (const [duration, expected] of [[0, '00:00.00'], [220, '00:00.22'], [61_239, '01:01.23']]) {
    assert.equal(dialog.formatTime(duration), expected);
  }
});

test('actual page formatter supports shared English, US English and GB English with complete arguments', () => {
  for (const locale of ['en', 'en-US', 'en-GB']) {
    const { page } = harness(locale);
    assert.equal(page.tr('order_label', 5), '5×5');
    assert.equal(page.tr('cube_title', 3), '3 × 3 Cube');
    assert.equal(page.tr('order_accessibility', 4, page.tr('selected_suffix')), '4 by 4, selected');
    assert.match(page.tr('cube_accessibility', 2), /^2 by 2 cube\./);
    assert.equal(page.tr('completed_count', 1), 'Completed: 1');
    assert.equal(page.tr('completed_count', 2), 'Completed: 2');
    assert.equal(page.tr('record_details', 1, '10/23 09:05'), 'Moves: 1 · 10/23 09:05');
    page.phase = 'playing';
    assert.equal(page.phaseLabel(), 'Timed challenge');
    page.assisted = true;
    assert.equal(page.phaseLabel(), 'Assisted practice');
    page.busy = true;
    page.queueKind = 'scramble';
    assert.equal(page.phaseLabel(), 'Scrambling');
    for (const order of [2, 3, 4, 5]) assert.doesNotMatch(page.orderDescription(order), /[\u3400-\u9fff]/);
  }
});

test('locale change invalidates cached captions and refreshes stored hints and warnings without resetting play', () => {
  const { page, calls } = harness();
  assert.equal(page.tr('scramble'), '打乱');
  assert.equal(page.tr('scramble'), '打乱');
  assert.equal(calls.length, 1, 'static captions use the production cache');
  page.phase = 'ready';
  page.setHint('scramble_ready');
  page.storageWarning = page.tr('storage_unavailable');
  page.language = 'en-GB';
  page.onLanguageChanged();
  assert.equal(page.tr('scramble'), 'Scramble');
  assert.equal(page.hint, strings.en.scramble_ready);
  assert.equal(page.storageWarning, strings.en.storage_unavailable);
  assert.equal(page.phase, 'ready');
  assert.equal(page.order, 5);
  page.language = 'zh-CN';
  page.onLanguageChanged();
  assert.equal(page.hint, strings.base.scramble_ready);
  page.setHint();
  page.language = 'en-US';
  page.onLanguageChanged();
  assert.equal(page.hint, '');
});

test('tutorial and history inner-layer labels are regenerated rather than retaining Chinese parameters', () => {
  const { page } = harness();
  const move = { axis: 'x', layer: 1, turns: 1 };
  page.lesson = [move];
  page.phase = 'tutorial';
  page.updateLessonHint();
  assert.match(page.hint, /X 第 2 层/);
  page.language = 'en-US';
  page.onLanguageChanged();
  assert.match(page.hint, /^Step 1 \/ 1: Follow the hand to make X layer 2 \+90°\./);
  assert.doesNotMatch(page.hint, /[\u3400-\u9fff]/);
  page.phase = 'playing';
  page.hintMove = move;
  page.language = 'zh-CN';
  page.setHint('history_hint', page.moveLabel(move));
  page.busy = true;
  page.language = 'en-GB';
  page.onLanguageChanged();
  assert.match(page.hint, /^Solve suggestion: X layer 2 \+90°\./);
  assert.doesNotMatch(page.hint, /[\u3400-\u9fff]/);
  assert.equal(page.busy, true);
  assert.equal(page.phase, 'playing');
});

test('teaching history hints regenerate inner-layer labels across locale changes without resetting assistance', () => {
  const { page } = harness();
  const move = { axis: 'x', layer: 1, turns: 1 };
  page.challengeIndex = 4;
  page.phase = 'playing';
  page.assisted = true;
  page.hintMove = move;
  page.setHint('teaching_history_hint', page.moveLabel(move));
  assert.match(page.hint, /X 第 2 层/);
  assert.match(page.hint, /提示通关/);
  for (const locale of ['en', 'en-US', 'en-GB']) {
    page.language = locale;
    page.onLanguageChanged();
    assert.match(page.hint, /^Solve reference: X layer 2 \+90°\./);
    assert.match(page.hint, /solved with hints/);
    assert.doesNotMatch(page.hint, /[\u3400-\u9fff]/);
    assert.equal(page.hintKey, 'teaching_history_hint');
    assert.equal(page.hintMove, move);
    assert.equal(page.challengeIndex, 4);
    assert.equal(page.phase, 'playing');
    assert.equal(page.assisted, true);
  }
  page.language = 'zh-CN';
  page.onLanguageChanged();
  assert.match(page.hint, /X 第 2 层/);
});

test('all real teaching metadata and dynamic difficulty keys exist in every locale', () => {
  const challenges = createTeachingChallenges();
  assert.equal(challenges.length, 8);
  const metadata = new Set();
  for (const challenge of challenges) {
    assert.ok(challenge instanceof TeachingChallenge);
    for (const key of [challenge.titleKey, challenge.descriptionKey, challenge.tipKey]) {
      assert.equal(metadata.has(key), false, `distinct teaching metadata: ${key}`);
      metadata.add(key);
      for (const locale of locales) {
        assert.equal(typeof strings[locale][key], 'string', `${locale}: ${key}`);
        assert.ok(strings[locale][key].trim(), `${locale}: ${key}`);
        assert.doesNotMatch(strings[locale][key], /%\d+\$[sd]/, 'metadata is formatted without arguments');
      }
    }
    for (const locale of locales) assert.ok(strings[locale][`teaching_difficulty_${challenge.difficulty}`]);
  }
  assert.equal(metadata.size, 24);
});

test('teaching progress, best and status captions use real formatter arguments and refresh language', () => {
  const { page } = harness('en-GB');
  const challenge = page.challenges[0];
  assert.equal(page.tr('teaching_level_details', 2, 1), '2×2 · Reference quarter turns: 1');
  assert.equal(page.tr('teaching_progress', 1, 8), '1/8 completed');
  assert.equal(page.teachingStatus(challenge), strings.en.teaching_status_new);
  assert.equal(page.teachingBest(challenge), '');
  page.teachingRecords = [{ challengeId: challenge.id, moves: 3, durationMs: 1234, assisted: true }];
  assert.equal(page.teachingStatus(challenge), strings.en.teaching_status_guided);
  assert.equal(page.teachingBest(challenge), 'Best · Moves: 3 · Time: 00:01.23');
  page.teachingRecords[0].assisted = false;
  assert.equal(page.teachingStatus(challenge), strings.en.teaching_status_solved);
  page.setHint('teaching_save_failed');
  page.language = 'zh-CN';
  page.onLanguageChanged();
  assert.equal(page.hint, strings.base.teaching_save_failed);
  assert.equal(page.teachingStatus(challenge), strings.base.teaching_status_solved);
  assert.equal(page.teachingBest(challenge), '最佳：3 步 · 00:01.23');
});

test('a transient tutorial message is not replaced by the step message on language changes', () => {
  const { page } = harness();
  page.phase = 'tutorial';
  page.setHint('lesson_follow');
  page.language = 'en-US';
  page.onLanguageChanged();
  assert.equal(page.hint, strings.en.lesson_follow);
});

test('toast fallback clears a previous semantic hint and resource failure cannot crash the page', () => {
  const { page, errors } = harness('en-US');
  page.setHint('scramble_ready');
  page.toast('Temporary notification');
  assert.equal(page.hintKey, '');
  assert.equal(page.hint, 'Temporary notification');
  page.language = 'zh-CN';
  page.onLanguageChanged();
  assert.equal(page.hint, 'Temporary notification');
  page.getUIContext = () => ({ getHostContext: () => ({ resourceManager: {
    getStringByNameSync() { throw new Error('unavailable'); }
  }}) });
  assert.equal(page.tr('settings'), '—');
  assert.equal(errors.length, 1);
});
