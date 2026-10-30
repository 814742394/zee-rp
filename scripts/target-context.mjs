import { assertNotProtected } from './engine.mjs';
import { readFileSync } from 'node:fs';
import { detectFileVersion } from './version.mjs';

export const PLAN_VERSION = 2;
export function targetContext({ targetVersion, sourceTarget, file, template } = {}) {
  if (typeof file === 'string') assertNotProtected(file);
  if (template) assertNotProtected(template);
  const actual = file ? detectFileVersion(typeof file === 'string' ? readFileSync(file) : file) : null;
  const version = Number(targetVersion ?? actual ?? sourceTarget ?? 9);
  if (![9, 11].includes(version)) throw Object.assign(new Error(`Unsupported Axure target: ${version}`), { code: 'E_TARGET_UNSUPPORTED' });
  if (actual && actual !== version) throw Object.assign(new Error('Existing projects cannot change Axure version'), { code: 'E_TARGET_MISMATCH' });
  if (template && detectFileVersion(readFileSync(template)) !== version)
    throw Object.assign(new Error('Template version does not match target'), { code: 'E_TEMPLATE_VERSION' });
  return Object.freeze({ targetVersion: version, delivery: 'file', formatVersion: PLAN_VERSION, template });
}
export function validateBaseline(baseline, file, targetVersion) {
  if (baseline?.formatVersion !== PLAN_VERSION || ![9, 11].includes(baseline?.targetVersion) || baseline?.delivery !== 'file')
    throw Object.assign(new Error('旧基线缺少版本信息，请重新生成工程并建立基线。'), { code: 'E_BASELINE_VERSION' });
  targetContext({ file, targetVersion: baseline.targetVersion });
  if (targetVersion !== undefined && Number(targetVersion) !== baseline.targetVersion)
    throw Object.assign(new Error('Requested target differs from baseline'), { code: 'E_TARGET_MISMATCH' });
  return targetContext({ file, targetVersion: baseline.targetVersion });
}
