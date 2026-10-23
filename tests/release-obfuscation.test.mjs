import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const profileUrl = new URL('../entry/build-profile.json5', import.meta.url);
const profile = JSON.parse(readFileSync(profileUrl, 'utf8'));
const release = profile.buildOptionSet.filter(option => option.name === 'release');
const rules = readFileSync(new URL('../entry/obfuscation-rules.txt', import.meta.url), 'utf8')
  .split(/\r?\n/).map(line => line.replace(/#.*/, '').trim()).filter(Boolean);
const flags = rules.filter(line => line.startsWith('-'));

function valuesFor(flag) {
  const start = rules.indexOf(flag);
  if (start < 0) return [];
  const end = rules.findIndex((line, index) => index > start && line.startsWith('-'));
  return rules.slice(start + 1, end < 0 ? undefined : end);
}

test('Release enables the checked-in obfuscation rules without changing Debug', () => {
  assert.equal(release.length, 1);
  assert.deepEqual(release[0].arkOptions.obfuscation.ruleOptions, {
    enable: true,
    files: ['./obfuscation-rules.txt']
  });
  for (const file of release[0].arkOptions.obfuscation.ruleOptions.files) {
    assert.ok(readFileSync(new URL(file, profileUrl), 'utf8').trim());
  }
  assert.equal(profile.buildOption?.arkOptions?.obfuscation, undefined);
  assert.ok(profile.buildOptionSet.filter(option => option.name !== 'release')
    .every(option => option.arkOptions?.obfuscation === undefined));
});

test('Release renames top-level and exported identifiers, not persisted properties or routes', () => {
  assert.deepEqual(flags, [
    '-enable-toplevel-obfuscation',
    '-enable-export-obfuscation',
    '-keep-global-name'
  ]);
});

test('only the ability and page entry names are explicitly reserved', () => {
  assert.deepEqual(valuesFor('-keep-global-name'), ['EntryAbility', 'Index']);
  const module = JSON.parse(readFileSync(new URL('../entry/src/main/module.json5', import.meta.url), 'utf8')).module;
  assert.equal(module.mainElement, 'EntryAbility');
  assert.ok(module.abilities.some(ability => ability.name === 'EntryAbility' &&
    ability.srcEntry.endsWith('/EntryAbility.ets')));
  const pages = JSON.parse(readFileSync(new URL('../entry/src/main/resources/base/profile/main_pages.json', import.meta.url), 'utf8'));
  assert.deepEqual(pages.src, ['pages/Index']);
});
