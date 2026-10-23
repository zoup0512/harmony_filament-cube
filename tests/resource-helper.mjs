import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export function resourceStrings(locale = 'zh-CN') {
  const directory = /^en(?:[-_](?:US|GB))?$/i.test(locale) ? 'en' : 'base';
  return Object.fromEntries(JSON.parse(readFileSync(new URL(
    `../entry/src/main/resources/${directory}/element/string.json`, import.meta.url), 'utf8')).string
    .map(({ name, value }) => [name, value]));
}

// ResourceManager receives positional arguments, not sequential substitutions:
// repeated %1$d placeholders must read the same first argument every time.
export function formatResource(template, args = []) {
  assert.equal(typeof template, 'string', 'resource key must exist');
  return template.replace(/%(\d+)\$([sd])/g, (_token, position, kind) => {
    const value = args[Number(position) - 1];
    assert.notEqual(value, undefined, `missing resource argument ${position}`);
    if (kind === 'd') assert.ok(Number.isInteger(value), `%${position}$d requires an integer`);
    return String(value);
  });
}

export function resourceManager(locale = 'zh-CN') {
  return {
    locale,
    getStringByNameSync(name, ...args) {
      return formatResource(resourceStrings(this.locale)[name], args);
    }
  };
}

export function productionMember(source, name) {
  const matches = [...source.matchAll(new RegExp(
    `^  (?:private )?(?:async )?${name}\\([^\\r\\n]*\\)[^\\r\\n]*\\{\\r?\\n[\\s\\S]*?^  \\}`, 'gm'))];
  assert.equal(matches.length, 1, `exactly one real ${name} method must be extractable`);
  return matches[0][0];
}
