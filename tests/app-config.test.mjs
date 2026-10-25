import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const { app } = JSON.parse(read('AppScope/app.json5'));
const { module } = JSON.parse(read('entry/src/main/module.json5'));

test('builds an installable HarmonyOS phone app instead of an atomic service', () => {
  assert.equal(app.bundleType, 'app');
  assert.equal(module.type, 'entry');
  assert.equal(module.installationFree, false);
  assert.equal(module.deliveryWithInstall, true);
  assert.deepEqual(module.deviceTypes, ['phone']);
  assert.equal(Object.hasOwn(module, 'atomicService'), false);
});

test('preserves the app identity and exported portrait launcher', () => {
  assert.equal(app.bundleName, 'com.razor.filament.cube');
  assert.equal(module.mainElement, 'EntryAbility');
  const launcher = module.abilities.find(ability => ability.name === module.mainElement);
  assert.ok(launcher);
  assert.equal(launcher.srcEntry, './ets/entryability/EntryAbility.ets');
  assert.equal(launcher.exported, true);
  assert.equal(launcher.orientation, 'portrait');
  assert.ok(launcher.skills.some(skill =>
    skill.entities.includes('entity.system.home') && skill.actions.includes('ohos.want.action.home')));
  assert.deepEqual(JSON.parse(read('entry/src/main/resources/base/profile/main_pages.json')).src, ['pages/Index']);
});

test('phone conversion does not add permissions or capsule-only header spacing', () => {
  assert.deepEqual(module.requestPermissions, [{ name: 'ohos.permission.VIBRATE' }]);
  assert.doesNotMatch(read('entry/src/main/ets/pages/Index.ets'), /Blank\(\)\.width\(88\)/);
});

test('Chinese and English module descriptions identify the phone app', () => {
  for (const locale of ['base', 'en', 'en_US']) {
    const { string } = JSON.parse(read(`entry/src/main/resources/${locale}/element/string.json`));
    const description = string.find(entry => entry.name === 'module_desc')?.value;
    assert.ok(description);
    assert.doesNotMatch(description, /元服务|atomic service/i);
    assert.match(description, locale === 'base' ? /手机应用/ : /phone app/);
  }
});
