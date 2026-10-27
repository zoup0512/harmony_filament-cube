// Node 24: load the actual ArkTS-safe teaching module, not a test implementation.
// Resolve its extensionless import without changing production HarmonyOS sources.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const teachingURL = new URL('../entry/src/main/ets/model/CubeTeaching.ts', import.meta.url);
const modelURL = new URL('../entry/src/main/ets/model/CubeModel.ts', import.meta.url);
const source = await readFile(teachingURL, 'utf8');
const pattern = /(['"])\.\/CubeModel\1/g;
assert.equal([...source.matchAll(pattern)].length, 1, 'expected one real CubeModel import');
const rewritten = source.replace(pattern, JSON.stringify(modelURL.href));
const executable = stripTypeScriptTypes(rewritten, { mode: 'strip' });
const { TeachingChallenge, createTeachingChallenges } = await import(
  `data:text/javascript;base64,${Buffer.from(executable).toString('base64')}`
);

export { TeachingChallenge, createTeachingChallenges };
