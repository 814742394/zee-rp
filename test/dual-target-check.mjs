import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { targetContext, validateBaseline } from '../scripts/target-context.mjs';
import { getBackend } from '../scripts/backends/index.mjs';
import { generatePrototype, listMcpTools, validateInput } from '../scripts/mcp-tools.mjs';
import { readRp } from '../scripts/rp-read.mjs';
import { readRecords } from '../scripts/rp-records.mjs';
import { parsePayload, field } from '../scripts/parse-payload.mjs';
const work = mkdtempSync(join(tmpdir(), 'zee-dual-target-'));
const source = new URL('../examples/rp-language/dual-target-basic.json', import.meta.url);
const before = readFileSync(source);
assert.equal(targetContext().targetVersion, 9);
assert.equal(targetContext({ targetVersion: 11, sourceTarget: 9 }).targetVersion, 11);
assert.throws(() => targetContext({ targetVersion: 10 }), { code: 'E_TARGET_UNSUPPORTED' });
assert.throws(() => validateBaseline({ version: 1 }), { code: 'E_BASELINE_VERSION' });
assert.throws(() => getBackend({ targetVersion: 11 }).validatePlan({}), { code: 'E_PLAN_VERSION' });
const plan = { formatVersion: 2, targetVersion: 11, delivery: 'file', pages: [] };
assert.throws(() => getBackend({ targetVersion: 11 }).validatePlan({ ...plan, masters: [{}] }), { code: 'E_TARGET_CAPABILITY' });
assert.throws(() => getBackend({ targetVersion: 9 }).validatePlan(plan), { code: 'E_TARGET_MISMATCH' });
for (const name of ['generate_prototype', 'revise_prototype', 'generate_from_image']) {
  const schema = listMcpTools().find(t => t.name === name).inputSchema;
  assert.deepEqual(schema.properties.targetVersion.enum, [9, 11]);
}
const summaries = [], results = [];
for (const targetVersion of [9, 11]) {
  const template = process.env[`AXURE_BLANK_TEMPLATE_RP${targetVersion}`];
  assert.ok(template && existsSync(template), `Missing RP${targetVersion} template; not counted as passing`);
  const output = join(work, `basic-${targetVersion}.rp`);
  const result = generatePrototype({ source: source.pathname, targetVersion, template, output, compact: false });
  assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.equal(result.targetVersion, targetVersion);
  const bytes = readFileSync(output), rp = readRp(bytes);
  assert.equal(rp.version, targetVersion);
  assert.equal(rp.counts.pages, 2);
  assert.equal(rp.counts.globalVariables, 1);
  assert.ok(rp.pages.flatMap(p => p.widgets).some(w => w.type === 'TextBox'));
  assert.equal(rp.counts.actions, 8);
  assert.equal(rp.counts.danglingRefs, 0);
  assert.equal(rp.counts.problems, 0);
  let enableTypes = [], inputTypes = [];
  for (const record of readRecords(bytes)) {
    if (!record.strings) continue;
    for (const object of parsePayload(record).objects.values()) {
      if (object.className === 'Axure:DiagramObject:TextBox') inputTypes.push(field(object.body, 'Type').value);
      if (object.className === 'Axure:EnableDisableWidgetsInfo') enableTypes.push(field(object.body, 'enable').tag);
      if (targetVersion === 9 && object.className === 'Axure:InteractionCase') assert.equal(field(object.body, 'Disabled'), undefined);
    }
  }
  assert.deepEqual(inputTypes.sort(), [0, 1]);
  assert.deepEqual(enableTypes, [targetVersion === 9 ? 25 : 5, targetVersion === 9 ? 25 : 5]);
  const baseline = JSON.parse(readFileSync(`${output}.baseline.json`));
  assert.equal(validateBaseline(baseline, output).targetVersion, targetVersion);
  assert.throws(() => validateBaseline(baseline, output, targetVersion === 9 ? 11 : 9), { code: 'E_TARGET_MISMATCH' });
  const wrongOutput = join(work, `wrong-${targetVersion}.rp`);
  const wrong = generatePrototype({ source: source.pathname, targetVersion: targetVersion === 9 ? 11 : 9, template, output: wrongOutput });
  assert.equal(wrong.status, 'failed'); assert.equal(existsSync(wrongOutput), false);
  summaries.push(rp.pages.map(p => ({ name: p.name, widgets: p.widgets.map(w => ({ name:w.name,type:w.type,text:w.text,x:w.x,y:w.y,w:w.w,h:w.h })) })));
  results.push({ targetVersion, output, sha256: createHash('sha256').update(bytes).digest('hex'), counts:rp.counts,
    verification: { structure:true, nativeOpen:false, preview:false, saveReopen:false }, template });
}
assert.deepEqual(summaries[0], summaries[1]);
assert.deepEqual(readFileSync(source), before);
writeFileSync(join(work, 'evidence.json'), JSON.stringify({ results, nativeStatus:'pending', note:'Offline checks do not prove native compatibility' }, null, 2));
// Queue captures target + template; child worker must retain the requested version.
const { JobManager } = await import('../scripts/jobs.mjs');
const jobs = new JobManager();
const queued = jobs.startGeneration({ source: source.pathname, targetVersion: 11, output: join(work, 'async-11.rp') });
assert.equal(queued.targetVersion, 11);
const deadline = Date.now() + 30000;
while (!['completed', 'failed', 'cancelled'].includes(jobs.get(queued.id).status)) {
  assert.ok(Date.now() < deadline, 'Async generation timed out');
  await new Promise(resolve => setTimeout(resolve, 100));
}
assert.equal(jobs.get(queued.id).status, 'completed', JSON.stringify(jobs.get(queued.id)));
assert.equal(readRp(readFileSync(join(work, 'async-11.rp'))).version, 11);
await jobs.close();
console.log('PASS async target/template capture');
console.log(JSON.stringify({ status:'passed', evidence:join(work,'evidence.json'), nativeStatus:'pending' }));
