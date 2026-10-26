import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
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

test('uses the Chinese app name consistently while preserving the English brand', () => {
  assert.equal(app.label, '$string:app_name');
  const launcher = module.abilities.find(ability => ability.name === module.mainElement);
  assert.equal(launcher.label, '$string:EntryAbility_label');
  assert.equal(launcher.description, '$string:ability_desc');
  for (const locale of ['base', 'en', 'en_US']) {
    const expectedName = locale === 'base' ? '棱动魔方' : 'Cool Cube';
    const appStrings = JSON.parse(read(`AppScope/resources/${locale}/element/string.json`)).string;
    assert.equal(appStrings.find(entry => entry.name === 'app_name')?.value, expectedName);
    const entryStrings = JSON.parse(read(`entry/src/main/resources/${locale}/element/string.json`)).string;
    for (const key of ['ability_desc', 'EntryAbility_label', 'about_name', 'brand_name']) {
      const expected = key === 'brand_name' && locale !== 'base' ? 'COOL CUBE' : expectedName;
      assert.equal(entryStrings.find(entry => entry.name === key)?.value, expected, `${locale}: ${key}`);
    }
  }
});

test('debug signing is fixed in the repository for reuse across development machines', () => {
  const { app: build } = JSON.parse(read('build-profile.json5'));
  const product = name => build.products.find(entry => entry.name === name);
  assert.equal(product('default')?.signingConfig, 'default');
  assert.equal(product('release')?.signingConfig, 'release');
  const debug = build.signingConfigs.find(config => config.name === 'default');
  assert.equal(debug?.material.profile, 'keystore/debug/debug.p7b');
  for (const config of build.signingConfigs) {
    for (const key of ['certpath', 'profile', 'storeFile']) {
      const value = config.material[key];
      assert.match(value, /^keystore\//, `${config.name}: ${key} must be repository-relative`);
      assert.ok(existsSync(new URL(value, root)), `${config.name}: ${key} is missing`);
    }
  }
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
