import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { productionMember, resourceStrings } from './resource-helper.mjs';

// Source-level ArkUI regression checks, not a substitute for on-device UI tests.
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const source = read('entry/src/main/ets/pages/Index.ets');
const resultSource = read('entry/src/main/ets/pages/SolveResultDialog.ets');
const themeSource = read('entry/src/main/ets/pages/CubeTheme.ets');
const stylesSource = read('entry/src/main/ets/pages/CubeStyles.ets');
const ability = read('entry/src/main/ets/entryability/EntryAbility.ets');
const components = Object.fromEntries(['CubeWidgets', 'StatsPage', 'TeachingPage', 'SettingsPage']
  .map(name => [name, read(`entry/src/main/ets/components/${name}.ets`)]));
const uiSources = { Index: source, SolveResultDialog: resultSource, ...components };
const resultMember = name => productionMember(resultSource, name);
const base = resourceStrings();
const english = resourceStrings('en');
const member = name => productionMember(source, name);
const builders = Object.values(uiSources)
  .flatMap(text => [...text.matchAll(/^  @Builder\r?\n[\s\S]*?^  \}/gm)].map(match => match[0])).join('\n');
const colors = locale => Object.fromEntries(JSON.parse(read(`entry/src/main/resources/${locale}/element/color.json`)).color
  .map(({ name, value }) => [name, value]));

function wired(block, key) {
  assert.ok(block.includes(`this.tr('${key}'`), `production UI must use ${key}`);
  assert.equal(typeof base[key], 'string', `base resource ${key} must exist`);
  assert.equal(typeof english[key], 'string', `English resource ${key} must exist`);
}
function buttonBlock(key, block = member('gameTools')) {
  const matches = block.split(/(?=\bButton\()/).filter(part => part.startsWith(`Button(this.tr('${key}'),`));
  assert.equal(matches.length, 1, `game tools must retain one ${key} button`);
  wired(matches[0], key);
  return matches[0];
}

test('ArkUI does not restore face rows, twelve turn buttons, or button-based lesson instructions', () => {
  assert.ok(builders.length > 0, 'must inspect actual ArkUI builders');
  assert.doesNotMatch(source, /\b(?:faceRow|isLessonFace)\s*\(/);
  for (const copy of [source, ...Object.values(base), ...Object.values(english)]) {
    assert.doesNotMatch(copy, /转面控制|高亮按钮|点击[^\r\n。；]*按钮|按下[^\r\n。；]*按钮|highlighted button|tap (?:the )?face button/i);
  }
  assert.doesNotMatch(builders, /\b(?:firstFaces|secondFaces|faceMove|requestMove)\b/);
  assert.doesNotMatch(builders, /\bButton\(\s*(['"`])[UDLRFB](?:['′’])?\1\s*[,)]/);
  assert.doesNotMatch(builders, /\bButton\(\s*(?:face|move|label)\b/);
});

test('guidance uses a separate non-interactive canvas layered exactly over the cube', () => {
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
    // Several stages exist (home preview, narrow and wide game); only the owner may release the context.
    assert.match(block, /\.onDisAppear\(\(\) => \{ if \(this\.(?:canvas|guidance)Owner === owner\)/);
    assert.match(block, /\.onReady\(\(\) => \{ this\.(?:canvas|guidance)Owner = owner;/);
  }
  assert.doesNotMatch(overlay, /\.onTouch\(|\.onClick\(|\.position\(|\.offset\(|\.padding\(/);
  assert.match(stage, /this\.cubeCanvas\(owner\)\s*this\.guidanceCanvas\(owner\)/);
  assert.match(stage, /\}\.width\('100%'\)\.height\('100%'\)/);
  assert.doesNotMatch(stage, /Button\(|Toggle\(|Text\(|\.onTouch\(/);
  assert.doesNotMatch(member('frame').split('if (this.activeMove')[0], /this\.draw\(/);
  assert.doesNotMatch(member('showHint'), /this\.draw\(/);
  const owners = [...source.matchAll(/this\.(?:cubeStage|gameStage)\('([^']+)'\)/g)].map(match => match[1]);
  assert.deepEqual(owners.sort(), ['game', 'game-wide', 'home']);
  assert.match(member('homePage'), /if \(this\.page === 'home'\) \{\s*this\.cubeStage\('home'\)/,
    'the home preview releases the shared 2D context while another page is pushed');
});

test('canvas stays gesture-driven; beginner, tutorial and history help describe hands and release', () => {
  const canvas = member('cubeCanvas');
  assert.match(canvas, /\.onTouch\(\(event: TouchEvent\) => this\.touch\(event\)\)/);
  assert.match(canvas, /accessibilityText\(this\.tr\('cube_accessibility', this\.order\)\)/);
  wired(canvas, 'cube_accessibility');
  assert.match(base.cube_accessibility, /滑动.*松手转动一层.*双指/);
  assert.match(english.cube_accessibility, /Swipe.*release to turn a layer.*two fingers/);
  assert.match(member('startGame'), /this\.setHint\('gesture_help'\)/);
  assert.match(base.gesture_help, /跟随角块上的手势滑动，松手转层/);
  assert.match(base.gesture_help, /中间方块也可滑动/);
  assert.match(base.gesture_help, /空白或双指转视角/);
  assert.match(english.gesture_help, /corners; release to turn.*\nMiddle pieces work too.*two fingers: rotate/);
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
});

test('hints overlay the cube stage without resizing it or intercepting cube touches', () => {
  const stage = member('gameStage');
  assert.match(stage, /this\.cubeStage\(owner\)/);
  assert.match(stage, /if \(this\.hint\.length > 0 && this\.hintKey !== 'teaching_start_hint'\) \{\s*Text\(this\.hint\)/);
  const hint = stage.slice(stage.indexOf('Text(this.hint)'), stage.indexOf("id('game-hint')"));
  assert.match(hint, /\.hitTestBehavior\(HitTestMode\.None\)/);
  assert.match(stage, /\.id\('game-hint'\)\s*\.transition\(TransitionEffect\.OPACITY/);
  assert.match(stage, /\}\.width\('100%'\)\.height\('100%'\)\.padding\(CubeSpace\.s\)\.hitTestBehavior\(HitTestMode\.Transparent\)/,
    'the overlay layer lets swipes reach the canvas');
  assert.doesNotMatch(member('gamePage'), /Text\(this\.hint\)/, 'hints never take space in the page layout');
});

test('view controls float over the stage: gesture-guides toggle and front view keep 44vp targets', () => {
  const stage = member('gameStage');
  const toggle = stage.slice(stage.indexOf("Text(this.tr('guides_label'))"), stage.indexOf("id('game-guides-toggle')"));
  for (const key of ['guides_label', 'guides_accessibility', 'on', 'off', 'reset_view']) wired(stage, key);
  assert.match(toggle, /\.height\(44\)/);
  assert.match(stage, /\.accessibilityText\(this\.tr\('guides_accessibility', this\.beginnerGuides \? this\.tr\('on'\) : this\.tr\('off'\)\)\)/);
  assert.match(stage, /\.onClick\(\(\) => this\.setBeginnerGuides\(!this\.beginnerGuides\)\)/);
  const front = stage.slice(stage.indexOf("Text(this.tr('reset_view'))"));
  assert.match(front, /\.height\(44\)/);
  assert.match(front, /\.id\('game-front-view'\)\.accessibilityText\(this\.tr\('reset_view'\)\)/);
  assert.match(front, /\.onClick\(\(\) => \{ this\.invalidateGesture\(\); this\.yaw = 0\.62; this\.pitch = -0\.42; this\.draw\(\); \}\)/);
  assert.equal(base.guides_label, '手势提示');
  assert.equal(english.guides_label, 'Gesture guides');
  assert.equal(base.reset_view, '正视角');
});

for (const [key, label, handler] of [
  ['scramble', '打乱', 'scramble'], ['reset', '复位', 'confirmReset'],
  ['undo', '撤销', 'undo'], ['history_help', '还原提示', 'showHint']
]) {
  test(`game tool row retains the ${label} action and its handler`, () => {
    const block = buttonBlock(key);
    assert.equal(base[key], label);
    assert.ok(block.includes(`.onClick(() => this.${handler}())`));
    assert.match(block, /\.enabled\(!this\.busy/);
    assert.match(block, /\.layoutWeight\(1\)/);
    assert.match(block, /\.attributeModifier\(CubeButtons\.(?:primary|tonal|quiet)\)/);
    assert.doesNotMatch(block, /\.height\(\d+\)/, 'heights are minimums so large fonts never clip labels');
    if (handler === 'undo' || handler === 'showHint') {
      assert.match(block, /this\.phase !== 'tutorial'/);
      assert.match(block, /this\.phase !== 'solved'/);
    }
    if (handler === 'undo') assert.match(block, /this\.moves > 0/);
  });
}

test('game page is a fixed layout: header, summary, flexible cube stage, then one tool row', () => {
  const game = member('gamePage');
  assert.doesNotMatch(game, /\bScroll\(/);
  const narrow = game.slice(game.indexOf('} else {'));
  const order = ['this.gameHeader()', 'this.gameSummary()', "this.gameStage('game')", 'this.gameTools()']
    .map(call => narrow.indexOf(call));
  assert.ok(order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1])), 'stage sits between summary and tools');
  assert.match(narrow, /this\.gameStage\('game'\)\s*\}\.width\('100%'\)\.layoutWeight\(1\)/);
  assert.match(game, /if \(this\.viewportWidth >= CubeLayout\.wideBreakpoint\) \{/, 'wide windows place controls beside the cube');
  assert.match(game, /this\.gameStage\('game-wide'\)\s*\}\.layoutWeight\(1\)\.height\('100%'\)/);
  const tools = member('gameTools');
  assert.equal((tools.match(/\bRow\(/g) ?? []).length, 1);
  assert.match(tools, /\}\.width\('100%'\)\.id\('game-tools'\)/);
  assert.doesNotMatch(source, /this\.tr\('tutorial'\)/, 'the tutorial starts from home, not the game tools');
  let previous = -1;
  for (const key of ['scramble', 'undo', 'history_help', 'reset']) {
    const at = tools.indexOf(`Button(this.tr('${key}'),`);
    assert.ok(at > previous, `${key} keeps its position`);
    previous = at;
  }
  assert.match(tools, /if \(this\.challengeIndex < 0\) \{\s*Button\(this\.tr\('reset'\)/, 'reset is not offered in lessons');
});

test('teaching levels swap scramble for retry, then next after a pass; the goal opens a sheet', () => {
  const tools = member('gameTools');
  assert.match(tools, /if \(this\.challengeIndex >= 0\) \{\s*if \(this\.phase === 'solved'\) \{\s*Button\(this\.tr\(this\.challengeIndex === this\.challenges\.length - 1 \? 'result_levels' : 'teaching_next'\)/);
  assert.match(tools, /\.enabled\(!this\.busy\)\.onClick\(\(\) => this\.nextChallenge\(\)\)/);
  assert.match(buttonBlock('teaching_retry'), /\.enabled\(!this\.busy\)\.onClick\(\(\) => this\.retryChallenge\(\)\)/);
  assert.match(tools, /\} else \{\s*Button\(this\.tr\('scramble'\)/);
  const header = member('gameHeader');
  assert.match(header, /if \(this\.challengeIndex >= 0\) \{\s*this\.teachingGoal\(\)/);
  wired(header, 'teaching_goal_summary');
  wired(header, 'teaching_level');
  assert.match(header, /\.maxLines\(1\)\.textOverflow\(\{ overflow: TextOverflow\.Ellipsis \}\)/);
  assert.match(header, /if \(this\.challengeIndex >= 0\) \{\s*BackButton\(\{ label: \$r\('app\.string\.result_levels'\), onBack: \(\) => this\.goHome\(\) \}\)/);
  assert.match(header, /\} else \{\s*BackButton\(\{ label: \$r\('app\.string\.return_home'\), onBack: \(\) => this\.goHome\(\) \}\)/);
  assert.match(components.CubeWidgets, /\.accessibilityText\(this\.label\)/);
  const goal = member('teachingGoal');
  wired(goal, 'teaching_goal_button');
  assert.match(goal, /\.height\(44\)/);
  assert.match(goal, /\.accessibilityText\(this\.tr\('teaching_goal_details'\)\)/);
  assert.match(goal, /\.onClick\(\(\) => this\.showTeachingGoal\(\)\)/);
  assert.match(member('showTeachingGoal'), /this\.goalVisible = true;/);
  assert.match(member('gamePage'), /\.bindSheet\(\$\$this\.goalVisible, this\.goalSheet\(\), \{/);
  const sheet = member('goalSheet');
  assert.match(sheet, /\bScroll\(\)/, 'long tips stay readable at large font sizes');
  for (const key of ['teaching_level', 'teaching_goal_summary', 'teaching_goal_tip', 'teaching_goal_reference',
    'teaching_level_details', 'teaching_start_hint', 'teaching_goal_rules', 'teaching_hint_note', 'teaching_goal_close']) {
    wired(sheet, key);
  }
  assert.match(sheet, /this\.tr\(this\.challenges\[this\.challengeIndex\]\.tipKey\)/);
  assert.match(sheet, /\.onClick\(\(\) => \{ this\.goalVisible = false; \}\)/);
  assert.equal(base.teaching_goal_button, '目标');
  assert.equal(english.teaching_goal_button, 'Goal');
});

test('game time and move summary uses the hero surface with legible captions', () => {
  const summary = member('gameSummary');
  assert.match(summary, /this\.formatTime\(this\.elapsed\)\)\.fontFamily\('monospace'\)\.fontSize\(26\)/);
  assert.match(summary, /Text\(`\$\{this\.moves\}`\)\.fontSize\(26\)/);
  assert.match(summary, /\.backgroundColor\(CubeTheme\.hero\)\.borderRadius\(20\)/);
  assert.equal((summary.match(/\.fontSize\(CubeFont\.caption\)/g) ?? []).length, 2);
  wired(summary, 'elapsed_time');
  wired(summary, 'move_count');
});

test('pages run on Navigation: home is the root, others are NavDestinations that route system back', () => {
  const build = member('build');
  assert.match(build, /Navigation\(this\.navStack\) \{\s*Column\(\) \{\s*this\.homePage\(\)/);
  assert.match(build, /\.navDestination\(this\.destination\)/);
  assert.match(build, /\.hideTitleBar\(true\)/);
  const destination = member('destination');
  assert.match(destination, /NavDestination\(\) \{/);
  assert.match(destination, /\.hideTitleBar\(true\)/);
  assert.match(destination, /\.onBackPressed\(\(\) => this\.onBackPress\(\)\)/);
  assert.match(destination, /if \(name === 'game'\) \{\s*this\.gamePage\(\)/);
  for (const page of ['TeachingPage', 'StatsPage', 'SettingsPage']) {
    assert.match(destination, new RegExp(`${page}\\(\\{[\\s\\S]*?onBack: \\(\\) => this\\.goHome\\(\\)`));
  }
  assert.match(source, /@State @Watch\('syncNav'\) private page: string = 'home';/);
  assert.match(source, /private navStack: NavPathStack = new NavPathStack\(\);/);
  assert.doesNotMatch(source, /Scroller|gameScroller/);
});

test('extracted pages receive data and callbacks, not the game model', () => {
  for (const [name, component] of Object.entries(components)) {
    assert.doesNotMatch(component, /CubeModel|CubeStore|CubeRenderer|requestMove|finishSolve/, name);
  }
  const destination = member('destination');
  assert.match(destination, /groups: this\.teachingGroups\(\)/);
  assert.match(destination, /onStart: \(index: number\) => this\.startChallenge\(index\)/);
  assert.match(destination, /rows: this\.statsRows\(\),\s*recent: this\.recentRows\(\),\s*trend: this\.trendBars\(\)/);
  assert.match(destination, /onClear: \(\) => this\.clearRecords\(\)/);
  assert.match(destination, /onGuides: \(value: boolean\) => this\.setBeginnerGuides\(value\)/);
  assert.match(destination, /onSpeed: \(value: number, commit: boolean\) => \{ this\.speed = value; if \(commit\) \{ this\.saveSettings\(\); \} \}/);
});

test('settings share one switch row and explain corner-only hints without solve answers', () => {
  const settings = components.SettingsPage;
  assert.match(settings, /struct SettingSwitchRow/);
  assert.equal((settings.match(/SettingSwitchRow\(\{/g) ?? []).length, 3);
  assert.match(settings, /SettingSwitchRow\(\{ title: \$r\('app\.string\.beginner_guides'\), help: \$r\('app\.string\.beginner_guides_help'\),\s*isOn: this\.beginnerGuides, onToggle: this\.onGuides \}\)/);
  assert.match(settings, /Toggle\(\{ type: ToggleType\.Switch, isOn: this\.isOn \}\)/);
  assert.match(settings, /OrderSelector\(\{ selected: this\.defaultOrder/);
  assert.match(base.beginner_guides_help, /四角显示小手/);
  assert.match(base.beginner_guides_help, /中间方块也可滑动/);
  assert.match(base.beginner_guides_help, /不提供还原答案/);
  assert.match(english.beginner_guides_help, /Hands and faint swipe paths appear only at visible corners/);
  assert.match(english.beginner_guides_help, /Middle pieces work too.*do not solve the cube/);
  assert.doesNotMatch(base.beginner_guides_help + english.beginner_guides_help, /箭头|arrow/i);
  assert.match(components.CubeWidgets, /struct PageHeader[\s\S]*?BackButton\(\{ label: this\.backLabel, onBack: this\.onBack \}\)/,
    'every secondary page uses the same 44vp back button');
});

test('home keeps branding, preview, order choice and entries without the welcome and subtitle block', () => {
  const home = member('homePage');
  const at = text => home.indexOf(text);
  wired(home, 'brand_name');
  assert.doesNotMatch(home, /home_welcome|home_subtitle|你的魔方，你的节奏|随时开始一场小小的脑力旅行/);
  const sequence = ["Text(this.tr('brand_name'))", "this.cubeStage('home')",
    'OrderSelector(', "id('home-start')", "id('home-teaching')", "this.homeTile('statistics', 'stats')",
    "this.homeTile('settings', 'settings')", "id('home-tutorial')"];
  sequence.reduce((previous, text) => { assert.ok(at(text) > previous, `${text} order`); return at(text); }, -1);
  const start = home.slice(home.lastIndexOf('Button(', at("id('home-start')")), at("id('home-start')"));
  assert.match(start, /SymbolGlyph\(\$r\('sys\.symbol\.arrow_right'\)\)/, 'arrows are icons, not text in translations');
  assert.match(home, /\.attributeModifier\(CubeButtons\.hero\)\.enabled\(this\.loaded\)\.id\('home-start'\)/);
  assert.match(home, /\.onClick\(\(\) => this\.startGame\(\)\)/);
  assert.match(home, /\.onClick\(\(\) => this\.openTeaching\(\)\)/);
  assert.match(home, /\.onClick\(\(\) => this\.startTutorial\(\)\)/);
  assert.match(home, /Progress\(\{ value: this\.teachingRecords\.length, total: this\.challenges\.length/);
  wired(home, 'teaching_progress');
  wired(home, 'home_tutorial_link');
  assert.match(member('homeTile'), /SymbolGlyph\(\$r\('sys\.symbol\.chevron_right'\)\)/);
  assert.doesNotMatch(source, /'↗'|'›'/);
  for (const strings of [base, english, resourceStrings('en-US')]) {
    for (const key of ['start_game', 'undo', 'teaching']) assert.doesNotMatch(strings[key], /[→↶↗›]/, key);
    assert.equal(strings.teaching_entry_title, undefined);
  }
});

test('advanced teaching naming is consistent across entry, header, descriptions and level titles', () => {
  assert.equal(base.teaching, '进阶教学');
  assert.equal(base.teaching_title, '循序练习，掌握还原');
  assert.equal(base.teaching_description, '从指定局面出发，自由选择路线，完成六面复原。');
  assert.equal(base.teaching_cross_return_title, '十字还原');
  assert.equal(english.teaching, 'Advanced lessons');
  assert.equal(english.teaching_title, 'Master the solve, step by step');
  for (const copy of [...Object.values(base), ...Object.values(english)]) assert.doesNotMatch(copy, /残局|endgame/i);
});

test('teaching catalogue groups levels by size, shows progress and collapses the rules', () => {
  const page = components.TeachingPage;
  assert.match(page, /PageHeader\(\{ title: \$r\('app\.string\.teaching'\)/);
  assert.match(page, /SectionTitle\(\{ kicker: \$r\('app\.string\.teaching_kicker'\), title: \$r\('app\.string\.teaching_title'\) \}\)/);
  assert.match(page, /Progress\(\{ value: this\.solved, total: Math\.max\(1, this\.total\), type: ProgressType\.Linear \}\)/);
  assert.match(page, /@State private rulesOpen: boolean = false;/);
  assert.match(page, /if \(this\.rulesOpen\) \{\s*Text\(\$r\('app\.string\.teaching_rules'\)\)/);
  assert.match(page, /animateTo\(\{ duration: 220, curve: Curve\.EaseOut \}/);
  assert.match(page, /Text\(\$r\('app\.string\.teaching_group', group\.order\)\)/);
  assert.match(page, /GridRow\(\{ columns: \{ xs: 1, sm: 2 \}/, 'wide windows show two level columns');
  assert.match(page, /\.enabled\(this\.loaded\)\.onClick\(\(\) => this\.onStart\(item\.index\)\)/);
  for (const kind of ['solved', 'guided']) assert.match(page, new RegExp(`kind === '${kind}'`));
  assert.match(page, /Text\(this\.storageWarning\)/);
  const groups = member('teachingGroups');
  for (const key of ['teaching_level_details', 'teaching_difficulty_1', 'teaching_difficulty_2', 'teaching_difficulty_3']) {
    assert.ok(groups.includes(`'${key}'`), key);
  }
  assert.match(groups, /this\.teachingStatus\(challenge\), this\.teachingKind\(challenge\), this\.teachingBest\(challenge\)/);
});

test('statistics group recent results in one card with a single best badge and a trend chart', () => {
  const page = components.StatsPage;
  assert.match(page, /SectionTitle\(\{ kicker: \$r\('app\.string\.personal_best'\)/);
  assert.equal(base.personal_best, '个人最佳', 'kickers are localized');
  assert.match(page, /if \(this\.trend\.length >= 2\) \{\s*this\.trendCard\(\)/);
  assert.match(page, /\$r\('app\.string\.stats_trend', this\.trend\.length, this\.trendOrder\)/);
  assert.match(page, /if \(row\.best\) \{/);
  assert.match(page, /if \(index < this\.recent\.length - 1\) \{\s*Divider\(\)/, 'recent results share one card');
  assert.match(page, /\.enabled\(this\.recent\.length > 0\)\.onClick\(\(\) => this\.onClear\(\)\)/);
  assert.match(page, /GridRow\(\{ columns: \{ xs: 1, sm: 2 \}/);
  assert.match(member('recentRows'), /best\.get\(record\.order\) === index/);
  assert.doesNotMatch(member('recentRows') + page, /formatTime\([^)]*\) === this\.bestTime/, 'never compare formatted times');
});

test('solve result stays a native centered modal over a per-session snapshot', () => {
  const model = read('entry/src/main/ets/model/SolveResult.ets');
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
  assert.match(show, /onPrimary: \(\) => this\.resultPrimary\(savedSession\),\s*onDone: \(\) => this\.closeSolveResult\(savedSession\)/);
  assert.match(show, /newBest: !teaching && !this\.assisted && this\.isNewBest\(this\.order, this\.elapsed\)/);
  assert.doesNotMatch(member('build') + member('gamePage'), /SolveResultDialog|resultVisible/);
  assert.doesNotMatch(resultSource, /CubeModel|CubeStore|requestMove|finishSolve|resetSession/);
  assert.doesNotMatch(member('showSolveResult'), /setTimeout|setInterval|await/);
});

test('result shows title, metadata, the hero time card, an optional note and two actions', () => {
  const build = resultMember('build');
  const ids = [...resultSource.matchAll(/\.id\('([^']+)'\)/g)].map(match => match[1]);
  assert.deepEqual(ids.toSorted(), ['dialog', 'title', 'time', 'moves', 'best', 'note', 'done', 'primary']
    .map(id => `solve-result-${id}`).toSorted());
  assert.match(build, /build\(\) \{\s*Scroll\(\) \{/);
  assert.match(build, /\.width\('calc\(100% - 40vp\)'\)/);
  assert.match(build, /maxWidth: 400, maxHeight: Math\.max\(120, this\.viewportHeight - 80\)/);
  assert.match(build, /\.backgroundColor\(CubeTheme\.surface\)\.borderRadius\(28\)/);
  assert.match(build, /\.padding\(18\)\.backgroundColor\(CubeTheme\.hero\)\.borderRadius\(20\)/);
  assert.match(build, /Text\(this\.formatTime\(this\.result\.durationMs\)\)\.fontFamily\('monospace'\)\.fontSize\(36\)/);
  assert.match(build, /\.minFontSize\(22\)\.maxFontSize\(36\)\.maxLines\(1\)/);
  assert.match(build, /if \(this\.newBest\) \{/);
  assert.match(build, /if \(this\.result\.challengeIndex >= 0 \|\| this\.result\.assisted\) \{/);
  assert.match(build, /Button\(\$r\('app\.string\.result_done'\)[\s\S]*?\.onClick\(\(\) => this\.onDone\(\)\)/);
  assert.match(build, /Button\(this\.primaryLabel[\s\S]*?\.onClick\(\(\) => this\.onPrimary\(\)\)/);
  assert.doesNotMatch(resultSource, /this\.controller\?*\.close\(\)/, 'the page owns closing so its state stays in sync');
});

test('colors come from light and dark resources; UI files never hardcode hex colors', () => {
  const light = colors('base');
  const dark = colors('dark');
  assert.deepEqual(Object.keys(dark).sort(), Object.keys(light).sort(), 'dark mode overrides every color');
  for (const [name, value] of Object.entries(light)) {
    assert.match(value, /^#(?:[0-9A-F]{6}|[0-9A-F]{8})$/, name);
  }
  for (const [, name] of themeSource.matchAll(/\$r\('app\.color\.([^']+)'\)/g)) assert.ok(light[name], name);
  for (const [name, text] of Object.entries({ ...uiSources, CubeStyles: stylesSource })) {
    assert.doesNotMatch(text, /['"]#[0-9A-Fa-f]{6,8}['"]/, `${name} uses CubeTheme tokens`);
  }
  assert.match(ability, /ConfigurationConstant\.ColorMode\.COLOR_MODE_DARK/);
  assert.match(ability, /this\.applySystemBars\(configuration\.colorMode/);
  assert.equal(ability.match(/'#0F1513'/g)?.length, 1);
  assert.equal(dark.cube_background, '#0F1513', 'dark system bars match the dark page background');
  assert.equal(light.cube_background, '#F6F7F2');
});

test('type scale keeps every label at 12fp or larger and shared styles use minimum heights', () => {
  for (const [name, text] of Object.entries(uiSources)) {
    for (const [, size] of text.matchAll(/\.fontSize\((\d+(?:\.\d+)?)\)/g)) {
      assert.ok(Number(size) >= 12, `${name}: fontSize(${size}) is below the 12fp minimum`);
    }
  }
  assert.match(themeSource, /static readonly caption: number = 12;/);
  assert.match(stylesSource, /\.labelStyle\(\{ maxLines: 2 \}\)\.constraintSize\(\{ minHeight: this\.minHeight \}\)/);
  assert.doesNotMatch(stylesSource, /\.height\(/);
});

test('shapes stay API 24 compatible: no Shape fill/stroke with resource colors', () => {
  for (const [name, text] of Object.entries(uiSources)) {
    assert.doesNotMatch(text, /\b(?:Circle|Rect|Ellipse|Path)\(\)/, `${name} draws shapes with containers instead`);
  }
});

test('interactive surfaces animate: press feedback, selection, hint fade and page transitions', () => {
  assert.match(stylesSource, /\.clickEffect\(\{ level: ClickEffectLevel\.LIGHT \}\)/);
  assert.match(components.CubeWidgets, /\.animation\(\{ duration: 180, curve: Curve\.EaseOut \}\)/);
  assert.match(member('gameStage'), /TransitionEffect\.OPACITY\.animation\(\{ duration: 200 \}\)/);
  assert.match(resultSource, /TransitionEffect\.scale\(/);
  assert.match(member('syncNav'), /pushPathByName\(target\[i\], null, true\)/);
});
