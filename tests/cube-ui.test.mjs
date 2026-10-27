import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { productionMember, resourceStrings } from './resource-helper.mjs';

// Source-level ArkUI regression checks, not a substitute for on-device UI tests.
const source = readFileSync(new URL('../entry/src/main/ets/pages/Index.ets', import.meta.url), 'utf8');
const base = resourceStrings();
const english = resourceStrings('en');
const member = name => productionMember(source, name);
const builders = [...source.matchAll(/^  @Builder\r?\n[\s\S]*?^  \}/gm)]
  .map(match => match[0]).join('\n');

function wired(block, key) {
  assert.ok(block.includes(`this.tr('${key}'`), `production UI must use ${key}`);
  assert.equal(typeof base[key], 'string', `base resource ${key} must exist`);
  assert.equal(typeof english[key], 'string', `English resource ${key} must exist`);
}
function buttonBlock(key) {
  const matches = member('gamePage').split(/(?=\bButton\()/)
    .filter(block => block.startsWith(`Button(this.tr('${key}'),`));
  assert.equal(matches.length, 1, `game page must retain one ${key} button`);
  wired(matches[0], key);
  return matches[0];
}

test('ArkUI does not restore face rows, twelve turn buttons, or button-based lesson instructions', () => {
  assert.ok(builders.length > 0, 'must inspect actual ArkUI builders');
  assert.doesNotMatch(source, /\b(?:faceRow|isLessonFace)\s*\(/);
  for (const copy of [source, ...Object.values(base), ...Object.values(english)]) {
    assert.doesNotMatch(copy, /转面控制|高亮按钮|点击[^\r\n。；]*按钮|按下[^\r\n。；]*按钮|highlighted button|tap (?:the )?face button/i);
  }
  // Face-name tables may remain in moveLabel, but never generate UI controls.
  assert.doesNotMatch(builders, /\b(?:firstFaces|secondFaces|faceMove|requestMove)\b/);
  assert.doesNotMatch(builders, /\bButton\(\s*(['"`])[UDLRFB](?:['′’])?\1\s*[,)]/);
  assert.doesNotMatch(builders, /\bButton\(\s*(?:face|move|label)\b/);
});

test('canvas stays gesture-driven; beginner, tutorial and history help describe hands and release', () => {
  const canvas = member('cubeCanvas');
  assert.match(canvas, /Canvas\(this\.context2d\)/);
  assert.match(canvas, /\.onTouch\(\(event: TouchEvent\) => this\.touch\(event\)\)/);
  assert.match(canvas, /accessibilityText\(this\.tr\('cube_accessibility', this\.order\)\)/);
  wired(canvas, 'cube_accessibility');
  assert.match(base.cube_accessibility, /滑动.*松手转动一层.*双指/);
  assert.match(english.cube_accessibility, /Swipe.*release to turn a layer.*two fingers/);
  const game = member('gamePage');
  wired(game, 'guided_help');
  wired(game, 'gesture_help');
  assert.match(base.gesture_help, /跟随角块上的手势滑动，松手转层/);
  assert.match(base.gesture_help, /中间方块也可滑动/);
  assert.match(base.gesture_help, /空白或双指转视角/);
  assert.match(english.gesture_help, /corners; release to turn.*\nMiddle pieces work too.*two fingers: rotate/);
  assert.equal(base.guided_help, '跟随小手滑动，松手转层\n空白或双指转视角');
  assert.match(english.guided_help, /Follow the hand; release to turn\.\n.*two fingers to rotate/);
  assert.match(game, /Text\(this\.guideTarget\(\) !== null \? this\.tr\('guided_help'\) :\s*this\.tr\('gesture_help'\)\)/);
  for (const [name, key] of [['updateLessonHint', 'lesson_step'], ['showHint', 'history_hint'], ['requestMove', 'lesson_follow']]) {
    assert.ok(member(name).includes(`this.${name === 'requestMove' ? 'tr' : 'setHint'}('${key}'`));
    assert.match(base[key], /小手.*滑动.*松手/);
    assert.match(english[key], /hand/);
    assert.match(english[key], /[Ss]wipe.*release/);
    if (name !== 'showHint') assert.doesNotMatch(base[key], /轨迹|圆点/);
    assert.doesNotMatch(base[key], /箭头|按钮|高亮|四角|角块/);
    assert.doesNotMatch(english[key], /arrow|button|highlight|corner/i);
  }
  for (const key of ['lesson_step', 'history_hint']) {
    assert.match(base[key], /看不到小手.*转动视角/);
    assert.match(english[key], /hand is hidden.*rotate the view|Rotate the view if the hand is hidden/);
  }
  assert.doesNotMatch(base.gesture_help + base.guided_help, /箭头/);
  assert.match(game, /Text\(this\.hint\)/);
});

for (const [key, label, handler] of [
  ['scramble', '打乱', 'scramble'], ['tutorial', '教程', 'startLesson'], ['reset', '复位', 'confirmReset'],
  ['undo', '↶ 撤销', 'undo'], ['history_help', '还原提示', 'showHint']
]) {
  test(`game retains the ${label} action and its handler`, () => {
    const block = buttonBlock(key);
    assert.equal(base[key], label);
    assert.ok(block.includes(`.onClick(() => this.${handler}())`));
    assert.match(block, /\.enabled\(!this\.busy/);
    if (handler === 'undo' || handler === 'showHint') {
      assert.match(block, /this\.phase !== 'tutorial'/);
      assert.match(block, /this\.phase !== 'solved'/);
    }
    if (handler === 'undo') assert.match(block, /this\.moves > 0/);
  });
}

test('game gesture toggle shares the help row with flexible text, not a canvas overlay', () => {
  const game = member('gamePage');
  const help = game.slice(game.indexOf('Text(this.guideTarget()'), game.indexOf('if (this.hint.length > 0)'));
  assert.match(help, /\.layoutWeight\(1\)/, 'help text must wrap in remaining narrow-screen width');
  assert.match(help, /Button\(this\.tr\('guides_button', this\.beginnerGuides \? this\.tr\('on'\) : this\.tr\('off'\)\)/);
  assert.match(help, /\.width\(70\)\.height\(44\)/, 'localized guide control retains a 44vp touch target');
  assert.match(help, /\.accessibilityText\(this\.tr\('guides_accessibility', this\.beginnerGuides \? this\.tr\('on'\) : this\.tr\('off'\)\)\)/);
  for (const key of ['guides_button', 'guides_accessibility', 'on', 'off', 'reset_view']) wired(help, key);
  assert.equal(base.guides_button, '手势 %1$s');
  assert.equal(english.guides_button, 'Guides %1$s');
  assert.equal(base.guides_accessibility, '新手手势提示，%1$s');
  assert.equal(english.guides_accessibility, 'Beginner gesture guides, %1$s');
  assert.deepEqual([base.on, base.off, english.on, english.off], ['开', '关', 'on', 'off']);
  assert.match(help, /\.onClick\(\(\) => this\.setBeginnerGuides\(!this\.beginnerGuides\)\)/);
  assert.equal((game.match(/this\.cubeStage\(\)/g) ?? []).length, 1);
  assert.doesNotMatch(member('cubeStage'), /beginnerGuides|Button\(|Toggle\(|\.onTouch\(/);
  assert.doesNotMatch(member('cubeCanvas'), /beginnerGuides|Button\(|Toggle\(/);
});

test('settings gesture switch shares the handler and explains corner-only hints without solve answers', () => {
  const settings = member('settingsPage');
  const start = settings.indexOf("Text(this.tr('beginner_guides'))");
  assert.ok(start >= 0);
  const control = settings.slice(start, settings.indexOf("Text(this.tr('turn_sound'))"));
  wired(control, 'beginner_guides');
  wired(control, 'beginner_guides_help');
  assert.match(base.beginner_guides_help, /跟随角块上的手势滑动，松手转层/);
  assert.match(base.beginner_guides_help, /仅在可视面四角显示小手与淡色滑动轨迹/);
  assert.match(base.beginner_guides_help, /中间方块也可滑动/);
  assert.match(base.beginner_guides_help, /不提供还原答案/);
  assert.match(english.beginner_guides_help, /corner gestures; release to turn/);
  assert.match(english.beginner_guides_help, /Hands and faint swipe paths appear only at visible corners/);
  assert.match(english.beginner_guides_help, /Middle pieces work too.*do not solve the cube/);
  assert.doesNotMatch(base.beginner_guides_help, /箭头/);
  assert.doesNotMatch(english.beginner_guides_help, /arrow/i);
  assert.match(control, /\.layoutWeight\(1\)/);
  assert.match(control, /Toggle\(\{ type: ToggleType\.Switch, isOn: this\.beginnerGuides \}\)/);
  assert.match(control, /\.accessibilityText\(this\.tr\('beginner_guides'\)\)/);
  assert.match(control, /\.onChange\(\(value: boolean\) => this\.setBeginnerGuides\(value\)\)/);
});

test('home shows the welcome tagline between branding and cube preview, not in settings', () => {
  const home = member('homePage');
  const tagline = "Text(this.tr('home_welcome'))";
  wired(home, 'home_welcome');
  wired(home, 'brand_name');
  assert.equal(base.home_welcome, '你的魔方，你的节奏。');
  assert.equal(english.home_welcome, 'Your cube. Your pace.');
  assert.equal(source.split(tagline).length - 1, 1, 'show the tagline only once');
  assert.ok(home.indexOf(tagline) > home.indexOf("Text(this.tr('brand_name'))"));
  assert.ok(home.indexOf(tagline) < home.indexOf('this.cubeStage()'));
  assert.doesNotMatch(member('settingsPage'), /home_welcome|你的魔方，你的节奏|MAKE IT YOURS/);
});

test('game retains view reset, canvas, time and move count', () => {
  const block = buttonBlock('reset_view');
  assert.equal(base.reset_view, '正视角');
  assert.match(block, /\.onClick\(/);
  assert.match(block, /this\.yaw = 0\.62/);
  assert.match(block, /this\.pitch = -0\.42/);
  assert.match(block, /this\.draw\(\)/);
  const game = member('gamePage');
  assert.match(game, /this\.cubeStage\(\)/);
  assert.match(game, /this\.backButton\(\)/);
  assert.match(game, /this\.formatTime\(this\.elapsed\)/);
  assert.match(game, /Text\(`\$\{this\.moves\}`\)/);
  wired(game, 'elapsed_time');
  wired(game, 'move_count');
  wired(game, 'cube_title');
});

test('advanced teaching naming is consistent across entry, header, descriptions and level titles', () => {
  assert.equal(base.teaching, '进阶教学');
  assert.equal(base.teaching_entry_title, base.teaching);
  assert.equal(base.teaching_title, '循序练习，掌握还原');
  assert.equal(base.teaching_description, '从指定局面出发，自由选择路线，完成六面复原。');
  assert.equal(base.teaching_cross_return_title, '十字还原');
  assert.equal(english.teaching, 'Advanced lessons');
  assert.equal(english.teaching_entry_title, english.teaching);
  assert.equal(english.teaching_title, 'Master the solve, step by step');
  assert.equal(english.teaching_description,
    'Start from a set position, choose your own route, and solve all six faces.');
  for (const copy of [...Object.values(base), ...Object.values(english)]) {
    assert.doesNotMatch(copy, /残局|endgame/i);
  }
});

test('teaching home entry is a single-line button matching the start action geometry', () => {
  const home = member('homePage');
  wired(home, 'teaching_entry_title');
  const entryEnd = home.indexOf('\n', home.indexOf('this.openTeaching()'));
  const entry = home.slice(home.lastIndexOf('Button({', home.indexOf("Text('→')")), entryEnd);
  assert.match(entry, /Text\(this\.tr\('teaching_entry_title'\)\)\.fontSize\(17\)\.fontWeight\(FontWeight\.Bold\)\.fontColor\(CubeTheme\.ink\)/);
  assert.match(entry, /Text\('→'\)/);
  assert.doesNotMatch(entry, /▦|↗|teaching_entry_description|Column\(/);
  assert.match(entry, /\.height\(56\)\.padding\(0\)\.borderRadius\(18\)\s*\.backgroundColor\(CubeTheme\.mint\)/);
  assert.match(entry, /\.enabled\(this\.loaded\)\s*\.accessibilityText\(this\.tr\('teaching_entry_title'\)\)\.onClick\(\(\) => this\.openTeaching\(\)\)/);
});

test('teaching home entry opens a resource-backed catalogue with stable IDs and persisted progress', () => {
  const home = member('homePage');
  assert.match(home, /\.enabled\(this\.loaded\)\s*\.accessibilityText\(this\.tr\('teaching_entry_title'\)\)\.onClick\(\(\) => this\.openTeaching\(\)\)/);
  assert.match(member('build'), /this\.page === 'teaching'\) \{\s*this\.teachingPage\(\)/);
  const catalogue = member('teachingPage');
  assert.match(catalogue, /this\.header\('teaching'\)/);
  assert.match(catalogue, /this\.sectionTitle\('teaching_kicker', 'teaching_title'\)/);
  for (const key of ['teaching_description', 'teaching_progress', 'teaching_rules', 'teaching_level_details']) wired(catalogue, key);
  assert.match(catalogue, /this\.tr\('teaching_progress', this\.teachingRecords\.length, this\.challenges\.length\)/);
  assert.match(catalogue, /ForEach\(this\.challenges, \(challenge: TeachingChallenge, index: number\) =>/);
  assert.match(catalogue, /this\.tr\(challenge\.titleKey\)/);
  assert.match(catalogue, /this\.tr\(challenge\.descriptionKey\)/);
  assert.match(catalogue, /this\.tr\('teaching_level_details', challenge\.order, challenge\.referenceMoves\)/);
  for (const level of [1, 2, 3]) {
    const key = `teaching_difficulty_${level}`;
    assert.ok(catalogue.includes(`'${key}'`));
    assert.ok(base[key]);
    assert.ok(english[key]);
  }
  assert.match(catalogue, /Text\(this\.teachingStatus\(challenge\)\)/);
  assert.match(catalogue, /Text\(this\.teachingBest\(challenge\)\)/);
  assert.match(catalogue, /\.enabled\(this\.loaded\)\.onClick\(\(\) => this\.startChallenge\(index\)\)/);
  assert.match(catalogue, /\(challenge: TeachingChallenge\) => challenge\.id/);
  assert.match(catalogue, /Text\(this\.storageWarning\)/);
});

test('teaching game shows the real goal and substitutes retry/back controls for legacy automation', () => {
  const game = member('gamePage');
  const goal = member('teachingGoal');
  wired(game, 'teaching_level');
  wired(goal, 'teaching_goal');
  assert.match(goal, /this\.tr\(this\.challenges\[this\.challengeIndex\]\.tipKey\)/);
  assert.match(goal, /this\.tr\('teaching_level_details', this\.order, this\.challenges\[this\.challengeIndex\]\.referenceMoves\)/);
  assert.match(game, /if \(this\.challengeIndex >= 0\) \{\s*this\.teachingGoal\(\)/);
  assert.match(game, /if \(this\.challengeIndex >= 0\) \{\s*this\.teachingControls\(\)\s*\} else \{/);
  const legacy = game.slice(game.indexOf('this.teachingControls()'), game.indexOf("Button(this.tr('undo')"));
  for (const key of ['scramble', 'tutorial', 'reset']) wired(legacy, key);
  const controls = member('teachingControls');
  assert.doesNotMatch(controls, /doScramble|scramble\(\)|startLesson|doLesson|confirmReset|resetStepByStep/);
  for (const key of ['teaching_retry', 'teaching_back', 'teaching_hint_note']) wired(controls, key);
  assert.match(controls, /if \(this\.phase === 'solved'\) \{[\s\S]*?this\.assisted \? 'teaching_passed_guided' : 'teaching_passed'/);
  assert.match(controls, /this\.challengeIndex === this\.challenges\.length - 1 \? 'teaching_back' : 'teaching_next'/);
  assert.match(controls, /\.enabled\(!this\.busy\)\.onClick\(\(\) => this\.nextChallenge\(\)\)/);
  assert.match(controls, /\.enabled\(!this\.busy\)\.onClick\(\(\) => this\.retryChallenge\(\)\)/);
  assert.match(controls, /\.onClick\(\(\) => this\.goHome\(\)\)/);
  assert.match(member('backButton'), /this\.challengeIndex >= 0 \? 'teaching_back' : 'return_home'/);
  assert.match(member('showHint'), /this\.setHint\('teaching_history_hint', this\.moveLabel\(solution\[0\]\)\)/);
  assert.doesNotMatch(member('statsPage'), /teachingRecords/);
});

test('teaching copy explains free routes, quarter-turn references, guidance and independent saves accurately', () => {
  assert.match(base.teaching_rules, /任何还原路线均可/);
  assert.match(base.teaching_rules, /90°.*不代表最少步数/);
  assert.match(base.teaching_rules, /不计入普通计时成绩/);
  assert.match(english.teaching_rules, /any route.*90° quarter turns, not a minimum.*saved separately/);
  assert.match(base.teaching_hint_note, /还原提示.*操作历史.*不保证最短解.*请求提示.*提示通关/);
  assert.match(english.teaching_hint_note, /Solve hints.*move history.*shortest solution.*Requesting a hint counts as assistance/);
  assert.match(base.teaching_history_hint, /小手.*滑动.*松手.*提示通关/);
  assert.match(english.teaching_history_hint, /hand.*swipe.*release.*solved with hints/);
  assert.match(base.teaching_save_failed, /本关已完成.*未能保存/);
  assert.match(english.teaching_save_failed, /Level complete, but.*could not be saved/);
});

test('game Scroll resets its position on mount and on same-page challenge changes', () => {
  const game = member('gamePage');
  assert.match(source, /private gameScroller: Scroller = new Scroller\(\)/);
  assert.match(game, /Scroll\(this\.gameScroller\)/);
  assert.match(game, /\.onAppear\(\(\) => this\.gameScroller\.scrollTo\(\{ xOffset: 0, yOffset: 0 \}\)\)/);
  assert.match(member('startChallenge'), /if \(mounted\) \{ this\.gameScroller\.scrollTo\(\{ xOffset: 0, yOffset: 0 \}\); \}/);
});
