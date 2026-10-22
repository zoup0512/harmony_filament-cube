import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Source-level ArkUI regression checks, not a substitute for on-device UI tests.
const source = readFileSync(new URL('../entry/src/main/ets/pages/Index.ets', import.meta.url), 'utf8');

function member(name) {
  const matches = [...source.matchAll(new RegExp(
    `^  private ${name}\\([^\\r\\n]*\\)[^\\r\\n]*\\{\\r?\\n[\\s\\S]*?^  \\}`, 'gm'))];
  assert.equal(matches.length, 1, `Index.ets must contain exactly one ${name} member`);
  return matches[0][0];
}

const builders = [...source.matchAll(/^  @Builder\r?\n[\s\S]*?^  \}/gm)]
  .map(match => match[0]).join('\n');

function buttonBlock(label) {
  const matches = member('gamePage').split(/(?=\bButton\()/)
    .filter(block => block.startsWith(`Button('${label}',`));
  assert.equal(matches.length, 1, `game page must retain one ${label} button`);
  return matches[0];
}

test('ArkUI does not restore face rows, twelve turn buttons, or button-based lesson instructions', () => {
  assert.ok(builders.length > 0, 'must inspect actual ArkUI builders');
  assert.doesNotMatch(source, /\b(?:faceRow|isLessonFace)\s*\(/);
  assert.doesNotMatch(source, /转面控制|高亮按钮|点击[^\r\n。；]*按钮|按下[^\r\n。；]*按钮/);
  // Face-name tables may remain in moveLabel, but never generate UI controls.
  assert.doesNotMatch(builders, /\b(?:firstFaces|secondFaces|faceMove|requestMove)\b/);
  assert.doesNotMatch(builders, /\bButton\(\s*(['"`])[UDLRFB](?:['′’])?\1\s*[,)]/);
  assert.doesNotMatch(builders, /\bButton\(\s*(?:face|move|label)\b/);
});

test('canvas remains gesture-driven and tutorial/help text explains arrows instead of buttons', () => {
  const canvas = member('cubeCanvas');
  assert.match(canvas, /Canvas\(this\.context2d\)/);
  assert.match(canvas, /\.onTouch\(\(event: TouchEvent\) => this\.touch\(event\)\)/);
  assert.match(canvas, /accessibilityText\([^\r\n]*滑动[^\r\n]*松手转动一层[^\r\n]*双指/);
  assert.match(member('gamePage'), /箭头示意沿行\/列滑动，松手转层（非点击）/);
  assert.match(member('gamePage'), /空白或双指转视角/);
  for (const name of ['updateLessonHint', 'showHint', 'requestMove']) {
    const method = member(name);
    assert.match(method, /沿箭头滑动/);
    assert.doesNotMatch(method, /按钮|高亮/);
  }
  assert.match(member('updateLessonHint'), /从圆点滑向箭头/);
  assert.match(member('gamePage'), /Text\(this\.hint\)/);
});

for (const [label, handler] of [
  ['打乱', 'scramble'], ['教程', 'startLesson'], ['复位', 'confirmReset'],
  ['↶ 撤销', 'undo'], ['历史提示', 'showHint']
]) {
  test(`game retains the ${label} action and its handler`, () => {
    const block = buttonBlock(label);
    assert.ok(block.includes(`.onClick(() => this.${handler}())`));
    if (label !== '复位') assert.match(block, /\.enabled\(!this\.busy/);
    if (handler === 'undo' || handler === 'showHint') {
      assert.match(block, /this\.phase !== 'tutorial'/);
      assert.match(block, /this\.phase !== 'solved'/);
    }
    if (handler === 'undo') assert.match(block, /this\.moves > 0/);
  });
}

test('game direction toggle shares the help row with flexible text, not a canvas overlay', () => {
  const game = member('gamePage');
  const help = game.slice(game.indexOf("Text('箭头示意"), game.indexOf('if (this.hint.length > 0)'));
  assert.match(help, /\.layoutWeight\(1\)/, 'help text must wrap in remaining narrow-screen width');
  assert.match(help, /Button\(`箭头 \$\{this\.beginnerGuides \? '开' : '关'\}`/);
  assert.match(help, /\.width\(58\)\.height\(44\)/, 'compact controls retain a 44vp touch target');
  assert.match(help, /\.accessibilityText\(`新手方向箭头/);
  assert.match(help, /\.onClick\(\(\) => this\.setBeginnerGuides\(!this\.beginnerGuides\)\)/);
  assert.match(help, /Button\('正视角'/);
  assert.equal((game.match(/this\.cubeStage\(\)/g) ?? []).length, 1);
  assert.doesNotMatch(member('cubeStage'), /beginnerGuides|Button\(|Toggle\(|\.onTouch\(/);
  assert.doesNotMatch(member('cubeCanvas'), /beginnerGuides|Button\(|Toggle\(/);
});

test('settings direction switch uses the same handler and explains directions are not solve answers', () => {
  const settings = member('settingsPage');
  const start = settings.indexOf("Text('新手方向箭头')");
  assert.ok(start >= 0);
  const control = settings.slice(start, settings.indexOf("Text('转动音效')"));
  assert.match(control, /沿行\/列滑动，松手转层；非点击/);
  assert.match(control, /不提供还原答案/);
  assert.match(control, /\.layoutWeight\(1\)/);
  assert.match(control, /Toggle\(\{ type: ToggleType\.Switch, isOn: this\.beginnerGuides \}\)/);
  assert.match(control, /\.accessibilityText\('新手方向箭头'\)/);
  assert.match(control, /\.onChange\(\(value: boolean\) => this\.setBeginnerGuides\(value\)\)/);
});

test('game retains view reset, canvas, time and move count', () => {
  const block = buttonBlock('正视角');
  assert.match(block, /\.onClick\(/);
  assert.match(block, /this\.yaw = 0\.62/);
  assert.match(block, /this\.pitch = -0\.42/);
  assert.match(block, /this\.draw\(\)/);
  const game = member('gamePage');
  assert.match(game, /this\.cubeStage\(\)/);
  assert.match(game, /this\.backButton\(\)/);
  assert.match(game, /this\.formatTime\(this\.elapsed\)/);
  assert.match(game, /Text\(`\$\{this\.moves\}`\)/);
});
