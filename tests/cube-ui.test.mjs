import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { productionMember, resourceStrings } from './resource-helper.mjs';

// Source-level ArkUI regression checks, not a substitute for on-device UI tests.
const source = readFileSync(new URL('../entry/src/main/ets/pages/Index.ets', import.meta.url), 'utf8');
const resultSource = readFileSync(new URL('../entry/src/main/ets/pages/SolveResultDialog.ets', import.meta.url), 'utf8');
const resultMember = name => productionMember(resultSource, name);
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
function toolsRow(id) {
  const game = member('gamePage');
  const end = game.indexOf(`}.width('100%').id('${id}')`);
  assert.ok(end >= 0, `${id} row must exist`);
  const start = game.lastIndexOf('\n        Row(', end);
  assert.ok(start >= 0, `${id} must identify a top-level tool row`);
  return game.slice(start, end);
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

test('guidance uses a separate non-interactive canvas without changing the cube stage layout', () => {
  const canvas = member('cubeCanvas');
  const overlay = member('guidanceCanvas');
  const stage = member('cubeStage');
  assert.match(canvas, /Canvas\(this\.context2d\)/);
  assert.match(canvas, /\.id\('cube-base-canvas'\)/);
  assert.match(overlay, /Canvas\(this\.guidanceContext\)/);
  assert.match(overlay, /\.id\('cube-guidance-canvas'\)/);
  assert.match(overlay, /\.hitTestBehavior\(HitTestMode\.None\)/);
  assert.match(overlay, /\.accessibilityLevel\('no'\)/);
  for (const block of [canvas, overlay]) {
    assert.match(block, /\.width\('100%'\)\s*\.height\('100%'\)/);
    assert.match(block, /\.onDisAppear\(/);
  }
  assert.doesNotMatch(overlay, /\.onTouch\(|\.onClick\(|\.position\(|\.offset\(|\.padding\(/);
  assert.match(stage, /this\.cubeCanvas\(\)\s*this\.guidanceCanvas\(\)/);
  assert.match(stage, /\}\.width\('100%'\)\.height\('100%'\)/);
  assert.doesNotMatch(member('frame').split('if (this.activeMove')[0], /this\.draw\(/);
  assert.doesNotMatch(member('showHint'), /this\.draw\(/);
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
  assert.match(member('startGame'), /this\.setHint\('gesture_help'\)/);
  assert.doesNotMatch(game, /this\.tr\('(?:guided_help|gesture_help)'\)/);
  assert.match(base.gesture_help, /跟随角块上的手势滑动，松手转层/);
  assert.match(base.gesture_help, /中间方块也可滑动/);
  assert.match(base.gesture_help, /空白或双指转视角/);
  assert.match(english.gesture_help, /corners; release to turn.*\nMiddle pieces work too.*two fingers: rotate/);
  assert.equal(base.guided_help, '跟随小手滑动，松手转层\n空白或双指转视角');
  assert.match(english.guided_help, /Follow the hand; release to turn\.\n.*two fingers to rotate/);
  assert.match(game, /if \(this\.hint\.length > 0 && this\.hintKey !== 'teaching_start_hint'\) \{\s*Text\(this\.hint\)/);
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

test('game gesture toggle shares the secondary tool row without permanent help text or a canvas overlay', () => {
  const game = member('gamePage');
  const help = toolsRow('game-secondary-tools');
  for (const key of ['tutorial', 'reset', 'reset_view']) wired(help, key);
  assert.doesNotMatch(help, /guided_help|gesture_help|this\.hint/);
  assert.match(help, /Text\(this\.tr\('guides_label'\)\)/);
  assert.match(help, /Toggle\(\{ type: ToggleType\.Switch, isOn: this\.beginnerGuides \}\)\.width\(44\)\.height\(28\)/);
  assert.match(help, /\.selectedColor\(CubeTheme\.green\)\.switchStyle\(\{ unselectedColor: CubeTheme\.line \}\)/);
  assert.match(help, /\.responseRegion\(\{ x: -10, y: -8, width: 64, height: 44 \}\)/,
    'compact switch retains a 44vp touch target without overlapping adjacent controls');
  assert.match(help, /\.width\(74\)\.constraintSize\(\{ minHeight: 52 \}\)\.padding\(\{ bottom: 8 \}\)/);
  assert.match(help, /Text\(this\.tr\('guides_label'\)\)[^\n]*\.maxLines\(2\)/);
  assert.doesNotMatch(help, /Button\(this\.tr\('guides_/);
  assert.match(help, /\.accessibilityText\(this\.tr\('guides_accessibility', this\.beginnerGuides \? this\.tr\('on'\) : this\.tr\('off'\)\)\)/);
  for (const key of ['guides_label', 'guides_accessibility', 'on', 'off', 'reset_view']) wired(help, key);
  assert.equal(base.guides_label, '手势提示');
  assert.equal(english.guides_label, 'Gesture guides');
  assert.equal(base.guides_accessibility, '新手手势提示，%1$s');
  assert.equal(english.guides_accessibility, 'Beginner gesture guides, %1$s');
  assert.deepEqual([base.on, base.off, english.on, english.off], ['开', '关', 'on', 'off']);
  assert.match(help, /\.onChange\(\(value: boolean\) => this\.setBeginnerGuides\(value\)\)/);
  assert.equal((game.match(/this\.cubeStage\(\)/g) ?? []).length, 1);
  assert.doesNotMatch(member('cubeStage'), /beginnerGuides|Button\(|Toggle\(|\.onTouch\(/);
  assert.doesNotMatch(member('cubeCanvas'), /beginnerGuides|Button\(|Toggle\(/);
});

test('game keeps exactly two tool rows with common actions directly below a larger cube', () => {
  const game = member('gamePage');
  const primary = toolsRow('game-primary-tools');
  const secondary = toolsRow('game-secondary-tools');
  const cube = game.indexOf('this.cubeStage()');
  assert.ok(cube < game.indexOf(primary) && game.indexOf(primary) < game.indexOf(secondary));
  assert.ok(game.indexOf(secondary) < game.indexOf("if (this.hint.length > 0 && this.hintKey !== 'teaching_start_hint')"));
  const cubeLayout = game.slice(cube, game.indexOf(primary));
  assert.doesNotMatch(cubeLayout, /Text\(|Button\(|Column\(|this\.hint/,
    'help content must not separate or resize the cube and its tool rows');
  assert.match(cubeLayout, /this\.viewportHeight - 310\)\)\)/);
  assert.equal((game.slice(game.indexOf(primary), game.indexOf("if (this.hint.length > 0 && this.hintKey !== 'teaching_start_hint')")).match(/\bRow\(/g) ?? []).length, 2);
  for (const [row, keys] of [[primary, ['scramble', 'undo', 'history_help']],
    [secondary, ['tutorial', 'reset', 'reset_view']]]) {
    let previous = -1;
    for (const key of keys) {
      const position = row.indexOf(`Button(this.tr('${key}'),`);
      assert.ok(position > previous, `${key} must keep its position in its tool row`);
      previous = position;
    }
  }
  for (const key of ['scramble', 'undo', 'history_help']) {
    const block = buttonBlock(key);
    assert.match(block, /\.layoutWeight\(1\)\.height\(48\)\.borderRadius\(14\)/);
    assert.match(block, /\.fontSize\(14\)\.fontWeight\(FontWeight\.Bold\)/);
    assert.doesNotMatch(block, /Color\.Transparent/);
  }
  assert.match(buttonBlock('undo'), /\.backgroundColor\(CubeTheme\.mint\)\.fontColor\(CubeTheme\.green\)/);
  assert.match(buttonBlock('history_help'), /\.backgroundColor\(CubeTheme\.mint\)\.fontColor\(CubeTheme\.green\)/);
});

test('practice and teaching share one viewport-based cube area without a teaching height deduction', () => {
  const game = member('gamePage');
  const layout = game.slice(game.indexOf('this.cubeStage()'), game.indexOf(toolsRow('game-primary-tools')));
  assert.match(layout, /\.width\('100%'\)\.height\(Math\.max\(240, Math\.min\(480,\s*this\.viewportHeight - 310\)\)\)/);
  assert.doesNotMatch(layout, /challengeIndex|this\.phase|this\.hint/);
  for (const entry of ['startGame', 'startChallenge']) {
    assert.match(member(entry), /this\.cubeZoom = 1\.12;/);
    assert.match(member(entry), /this\.yaw = 0\.62;/);
    assert.match(member(entry), /this\.pitch = -0\.42;/);
  }
  assert.match(game, /Scroll\(this\.gameScroller\)/);
  assert.match(game, /this\.teachingGoal\(\)/);
  assert.match(game, /this\.teachingControls\(\)/);
});

test('teaching goal stays in the compact header instead of adding a card above the cube', () => {
  const game = member('gamePage');
  const headerEnd = game.indexOf(".id('game-header')");
  assert.ok(headerEnd >= 0);
  const header = game.slice(0, headerEnd);
  const beforeCube = game.slice(headerEnd, game.indexOf('this.cubeStage()'));
  assert.match(header, /this\.teachingGoal\(\)/);
  wired(header, 'teaching_goal_summary');
  assert.match(header, /\.maxLines\(1\)\.textOverflow\(\{ overflow: TextOverflow\.Ellipsis \}\)/);
  assert.doesNotMatch(beforeCube, /teachingGoal|teaching_goal|teaching_level_details/);
  assert.doesNotMatch(member('teachingGoal'), /\b(?:Column|Text)\(|\.padding\(14\)/);
  assert.match(game, /this\.hintKey !== 'teaching_start_hint'/);
  for (const strings of [base, english, resourceStrings('en-US')]) {
    for (const key of ['teaching_goal_summary', 'teaching_goal_details', 'teaching_goal_close']) {
      assert.equal(typeof strings[key], 'string');
      assert.ok(strings[key].length > 0);
    }
  }
});

test('compact secondary buttons retain readable wrapping labels and at least 44vp touch targets', () => {
  for (const key of ['tutorial', 'reset', 'reset_view']) {
    const block = buttonBlock(key);
    assert.match(block, /\.layoutWeight\(1\)\.height\((?:44|48)\)/);
    assert.match(block, /\.padding\(\{ left: 4, right: 4 \}\)/);
    assert.match(block, /\.labelStyle\(\{ maxLines: 2 \}\)/);
  }
  assert.match(buttonBlock('history_help'), /\.labelStyle\(\{ maxLines: 2 \}\)/);
});

test('tutorial stays secondary while scramble and start challenge retain the primary accent', () => {
  assert.match(buttonBlock('tutorial'), /\.backgroundColor\(CubeTheme\.soft\)\.fontColor\(CubeTheme\.secondary\)/);
  assert.match(buttonBlock('scramble'), /\.backgroundColor\(CubeTheme\.accent\)\.fontColor\(CubeTheme\.ink\)/);
  assert.match(member('homePage'), /Button\(this\.tr\('start_game'\),[^\n]*\n\s*\.backgroundColor\(CubeTheme\.accent\)\.fontColor\(CubeTheme\.ink\)/);
});

test('game time and move summary stays compact without reducing label legibility', () => {
  const game = member('gamePage');
  const summary = game.slice(game.indexOf("Text(this.tr('elapsed_time'))"), game.indexOf('this.cubeStage()'));
  assert.match(summary, /this\.formatTime\(this\.elapsed\)\)\.fontFamily\('monospace'\)\.fontSize\(26\)/);
  assert.match(summary, /Text\(`\$\{this\.moves\}`\)\.fontSize\(26\)/);
  assert.match(summary, /\.padding\(\{ left: 18, right: 18, top: 10, bottom: 10 \}\)/);
  assert.match(summary, /\.backgroundColor\(CubeTheme\.ink\)\.borderRadius\(20\)/);
  assert.equal((summary.match(/\.fontSize\(11\)/g) ?? []).length, 2);
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
  assert.equal(base.teaching_entry_title, `${base.teaching}  →`);
  assert.equal(base.teaching_title, '循序练习，掌握还原');
  assert.equal(base.teaching_description, '从指定局面出发，自由选择路线，完成六面复原。');
  assert.equal(base.teaching_cross_return_title, '十字还原');
  assert.equal(english.teaching, 'Advanced lessons');
  assert.equal(english.teaching_entry_title, `${english.teaching}  →`);
  assert.equal(english.teaching_title, 'Master the solve, step by step');
  assert.equal(english.teaching_description,
    'Start from a set position, choose your own route, and solve all six faces.');
  for (const copy of [...Object.values(base), ...Object.values(english)]) {
    assert.doesNotMatch(copy, /残局|endgame/i);
  }
});

test('teaching home entry uses the same native label layout and style as the start action except background', () => {
  const home = member('homePage');
  function action(key) {
    const start = home.indexOf(`Button(this.tr('${key}'),`);
    assert.ok(start >= 0, `${key} must use a native text Button`);
    const end = home.indexOf('\n', home.indexOf('.onClick(', start));
    const block = home.slice(start, end);
    wired(block, key);
    assert.doesNotMatch(block, /Stack\(|Row\(|Column\(|Text\(|\.padding\(|\.align|\.position\(/);
    return block;
  }
  const start = action('start_game');
  const teaching = action('teaching_entry_title');
  assert.match(start, /\.backgroundColor\(CubeTheme\.accent\)/);
  assert.match(teaching, /\.backgroundColor\(CubeTheme\.mint\)/);
  assert.match(teaching, /\.width\('100%'\)\.height\(56\)/);
  assert.match(teaching, /\.fontColor\(CubeTheme\.ink\)\.fontSize\(17\)\.fontWeight\(FontWeight\.Bold\)/);
  assert.match(teaching, /\.borderRadius\(18\)\.enabled\(this\.loaded\)\.onClick\(\(\) => this\.openTeaching\(\)\)/);
  const normalize = block => block.replace(/'(?:start_game|teaching_entry_title)'/, "'action'")
    .replace(/CubeTheme\.(?:accent|mint)/, 'CubeTheme.background')
    .replace(/this\.(?:startGame|openTeaching)\(\)/, 'this.action()').trim();
  assert.equal(normalize(teaching), normalize(start), 'both actions must retain identical label and style structure');
  for (const strings of [base, english, resourceStrings('en-US')]) {
    assert.ok(strings.start_game.endsWith('  →'));
    assert.equal(strings.teaching_entry_title, `${strings.teaching}  →`);
  }
});

test('teaching home entry opens a resource-backed catalogue with stable IDs and persisted progress', () => {
  const home = member('homePage');
  assert.match(home, /Button\(this\.tr\('teaching_entry_title'\), \{ type: ButtonType\.Normal \}\)[\s\S]*?\.enabled\(this\.loaded\)\.onClick\(\(\) => this\.openTeaching\(\)\)/);
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
  wired(goal, 'teaching_goal_button');
  assert.match(goal, /Button\(this\.tr\('teaching_goal_button'\), \{ type: ButtonType\.Normal \}\)\.width\(52\)\.height\(44\)/);
  assert.match(goal, /\.labelStyle\(\{ maxLines: 1 \}\)/);
  assert.doesNotMatch(goal, /this\.tr\('teaching_goal'\)|maxLines: 2/);
  assert.equal(base.teaching_goal_button, '目标');
  for (const strings of [english, resourceStrings('en-US')]) {
    assert.equal(strings.teaching_goal_button, 'Goal');
  }
  assert.match(goal, /\.accessibilityText\(this\.tr\('teaching_goal_details'\)\)/);
  assert.match(goal, /\.onClick\(\(\) => this\.showTeachingGoal\(\)\)/);
  const details = member('showTeachingGoal');
  for (const key of ['teaching_goal_summary', 'teaching_level_details', 'teaching_start_hint', 'teaching_hint_note', 'teaching_goal_close']) wired(details, key);
  assert.match(details, /this\.getUIContext\(\)\.showAlertDialog\(/);
  assert.match(details, /this\.tr\(challenge\.tipKey\)/);
  assert.match(details, /this\.tr\('teaching_level_details', this\.order, challenge\.referenceMoves\)/);
  assert.match(game, /if \(this\.challengeIndex >= 0\) \{\s*this\.teachingGoal\(\)/);
  const primary = toolsRow('game-primary-tools');
  const secondary = toolsRow('game-secondary-tools');
  assert.match(primary, /if \(this\.challengeIndex >= 0\) \{\s*Button\(this\.tr\('teaching_retry'\)/);
  assert.match(primary, /\} else \{\s*Button\(this\.tr\('scramble'\)/);
  assert.match(secondary, /if \(this\.challengeIndex >= 0\) \{\s*Button\(this\.tr\('teaching_back'\)/);
  assert.match(secondary, /\} else \{\s*Button\(this\.tr\('tutorial'\)/);
  wired(secondary, 'reset');
  assert.match(buttonBlock('teaching_retry'), /\.enabled\(!this\.busy\)\.onClick\(\(\) => this\.retryChallenge\(\)\)/);
  assert.match(buttonBlock('teaching_back'), /\.onClick\(\(\) => this\.goHome\(\)\)/);
  const controls = member('teachingControls');
  assert.doesNotMatch(controls, /doScramble|scramble\(\)|startLesson|doLesson|confirmReset|resetStepByStep|retryChallenge|goHome/);
  assert.doesNotMatch(controls, /teaching_hint_note/);
  assert.match(game, /if \(this\.challengeIndex >= 0 && this\.phase === 'solved'\) \{\s*Column\(\) \{\s*this\.teachingControls\(\)/);
  assert.match(controls, /if \(this\.phase === 'solved'\) \{[\s\S]*?this\.assisted \? 'teaching_passed_guided' : 'teaching_passed'/);
  assert.match(controls, /this\.challengeIndex === this\.challenges\.length - 1 \? 'teaching_back' : 'teaching_next'/);
  assert.match(controls, /\.enabled\(!this\.busy\)\.onClick\(\(\) => this\.nextChallenge\(\)\)/);
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

test('solve result uses a native centered modal and an observed per-session snapshot, not a page overlay', () => {
  const model = readFileSync(new URL('../entry/src/main/ets/model/SolveResult.ets', import.meta.url), 'utf8');
  assert.match(model, /@Observed\s+export class SolveResult/);
  assert.match(source, /@State private solveResult: SolveResult = new SolveResult\(\)/);
  assert.match(resultSource, /@CustomDialog\s+export struct SolveResultDialog/);
  assert.match(resultSource, /@ObjectLink result: SolveResult/);
  const show = member('showSolveResult');
  assert.match(show, /new CustomDialogController\(\{/);
  assert.match(show, /builder: SolveResultDialog\(\{\s*result: this\.solveResult,/);
  assert.match(show, /alignment: DialogAlignment\.Center/);
  assert.match(show, /isModal: true/);
  assert.match(show, /autoCancel: true/);
  assert.match(show, /DismissReason\.PRESS_BACK \|\| action\.reason === DismissReason\.TOUCH_OUTSIDE/);
  assert.match(show, /this\.closeSolveResult\(savedSession\);\s*action\.dismiss\(\)/);
  assert.doesNotMatch(member('build') + member('gamePage'), /SolveResultDialog|resultVisible/,
    'the native controller owns the modal layer, not the game Scroll or page Stack');
  assert.doesNotMatch(resultSource, /CubeModel|CubeStore|requestMove|finishSolve|resetSession/);
});

test('result contains only a scrollable success title, size/level metadata and dark time/move card', () => {
  const build = resultMember('build');
  const ids = [...resultSource.matchAll(/\.id\('([^']+)'\)/g)].map(match => match[1]);
  assert.deepEqual(ids.toSorted(), ['dialog', 'title', 'time', 'moves'].map(id => `solve-result-${id}`).toSorted());
  assert.match(build, /build\(\) \{\s*Scroll\(\) \{/);
  assert.equal((build.match(/\bScroll\(/g) ?? []).length, 1);
  assert.match(build, /\.width\('calc\(100% - 40vp\)'\)/);
  assert.match(build, /maxWidth: 400, maxHeight: Math\.max\(120, this\.viewportHeight - 80\)/);
  assert.match(build, /\.backgroundColor\(CubeTheme\.surface\)\.borderRadius\(28\)/);
  assert.match(build, /\.padding\(18\)\.backgroundColor\(CubeTheme\.ink\)\.borderRadius\(20\)/);
  assert.match(build, /Text\(this\.result\.challengeIndex < 0 \? \$r\('app\.string\.result_solved'\) :\s*\(this\.result\.assisted \? \$r\('app\.string\.teaching_passed_guided'\) : \$r\('app\.string\.teaching_passed'\)\)\)/);
  assert.match(build, /\$r\('app\.string\.cube_title', this\.result\.order\)/);
  assert.match(build, /\$r\('app\.string\.teaching_level', this\.result\.challengeIndex \+ 1\)/);
  assert.match(build, /Text\(this\.formatTime\(this\.result\.durationMs\)\)\.fontFamily\('monospace'\)\.fontSize\(36\)/);
  assert.match(build, /\.minFontSize\(22\)\.maxFontSize\(36\)\.maxLines\(1\)/);
  assert.match(build, /Text\(`\$\{this\.result\.moves\}`\)/);
  assert.equal((build.match(/\bText\(/g) ?? []).length, 7, 'no additional labels or explanations');
  assert.doesNotMatch(resultSource, /\b(?:Button|SymbolGlyph|Circle)\(|\.shadow\(|onClose|onContinue|saveState|newRecord|saveMessage|statusText|teaching_completed_note/);
  assert.doesNotMatch(member('showSolveResult'), /setTimeout|setInterval|await/);
  assert.match(member('gamePage'), /if \(this\.challengeIndex >= 0 && this\.phase === 'solved'\) \{\s*Column\(\) \{\s*this\.teachingControls\(\)/,
    'existing teaching feedback remains on the page after dismissal');
});

test('game Scroll resets its position on mount and on same-page challenge changes', () => {
  const game = member('gamePage');
  assert.match(source, /private gameScroller: Scroller = new Scroller\(\)/);
  assert.match(game, /Scroll\(this\.gameScroller\)/);
  assert.match(game, /\.onAppear\(\(\) => this\.gameScroller\.scrollTo\(\{ xOffset: 0, yOffset: 0 \}\)\)/);
  assert.match(member('startChallenge'), /if \(mounted\) \{ this\.gameScroller\.scrollTo\(\{ xOffset: 0, yOffset: 0 \}\); \}/);
});
