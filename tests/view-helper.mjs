// The real CubeView from CubeRenderer.ets, sharing the CubeModel.ts module the tests import.
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const source = readFileSync(new URL('../entry/src/main/ets/render/CubeRenderer.ets', import.meta.url), 'utf8');
const modelImport = /(['"])\.\.\/model\/CubeModel\1/g;
if ([...source.matchAll(modelImport)].length !== 1) throw new Error('expected exactly one model import');
const modelUrl = new URL('../entry/src/main/ets/model/CubeModel.ts', import.meta.url).href;
const executable = stripTypeScriptTypes(source.replace(modelImport, JSON.stringify(modelUrl)), { mode: 'strip' });
export const { CubeView } = await import(`data:text/javascript;base64,${Buffer.from(executable).toString('base64')}`);

export function homeView() {
  return CubeView.fromAngles(0.62, -0.42);
}

/** Max entry difference between two views. */
export function viewDistance(a, b) {
  return Math.max(...a.m.map((value, i) => Math.abs(value - b.m[i])));
}
