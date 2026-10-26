import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const icons = [
  { path: 'app_icon_1024.png', size: 1024 },
  { path: 'AppScope/resources/base/media/app_icon.png', size: 512 }
];
const readIcon = path => readFileSync(new URL(path, root));

function pngChunks(bytes) {
  assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const chunks = [];
  for (let offset = 8; offset < bytes.length;) {
    assert.ok(offset + 12 <= bytes.length, 'PNG chunk header is complete');
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    assert.ok(end <= bytes.length, 'PNG chunk data is complete');
    chunks.push({
      type: bytes.toString('ascii', offset + 4, offset + 8),
      data: bytes.subarray(offset + 8, end - 4)
    });
    offset = end;
  }
  return chunks;
}

for (const { path, size } of icons) {
  test(`${path} is a ${size}px RGB single-layer icon without transparency`, () => {
    const chunks = pngChunks(readIcon(path));
    assert.equal(chunks[0].type, 'IHDR');
    const header = chunks[0].data;
    assert.equal(header.readUInt32BE(0), size);
    assert.equal(header.readUInt32BE(4), size);
    assert.equal(header[8], 8, '8-bit color channels');
    assert.equal(header[9], 2, 'RGB without an alpha channel');
    assert.equal(chunks.some(chunk => chunk.type === 'tRNS'), false, 'no transparent color key');
    assert.ok(chunks.some(chunk => chunk.type === 'IDAT'));
    assert.equal(chunks.at(-1).type, 'IEND');
  });
}

test('the app and launcher reference the validated single-layer icon', () => {
  const readConfig = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
  const { app } = readConfig('AppScope/app.json5');
  const { module } = readConfig('entry/src/main/module.json5');
  const launcher = module.abilities.find(ability => ability.name === module.mainElement);
  assert.equal(app.icon, '$media:app_icon');
  assert.equal(launcher.icon, '$media:app_icon');
  assert.equal(launcher.startWindowIcon, '$media:app_icon');
});
