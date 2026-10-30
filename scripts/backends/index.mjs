import { generationCapabilities } from '../capabilities.mjs';
import rp9 from './rp9.mjs';
import rp11 from './rp11.mjs';
import { targetContext, PLAN_VERSION } from '../target-context.mjs';

const advanced = ['dynamicPanels', 'repeaters', 'masters', 'adaptiveViews'];
const basicActions = new Set(['link', 'set-text', 'show', 'hide', 'enable', 'disable', 'set-variable']);
export { generationCapabilities };
function unsupported(version, pointer, capability) {
  const diagnostic = { code: 'E_TARGET_CAPABILITY', pointer, capability, targetVersion: version, message: `RP${version} backend does not implement ${capability}` };
  throw Object.assign(new Error(diagnostic.message), { code: diagnostic.code, diagnostics: [diagnostic] });
}
export function getBackend(context) {
  const { targetVersion: version } = targetContext(context);
  return {
    ...({9: rp9, 11: rp11}[version]),
    capabilities: generationCapabilities[version],
    validatePlan(plan) {
      if (plan.formatVersion !== PLAN_VERSION || ![9, 11].includes(plan.targetVersion) || plan.delivery !== 'file')
        throw Object.assign(new Error('旧编译计划缺少目标版本，请重新编译。'), { code: 'E_PLAN_VERSION' });
      if (plan.targetVersion !== version) throw Object.assign(new Error('Plan target differs; recompile for the requested version'), { code: 'E_TARGET_MISMATCH' });
      if (version !== 11) return;
      const visit = (node, pointer = '') => {
        if (!node || typeof node !== 'object') return;
        for (const key of advanced) if (node[key]?.length) unsupported(version, `${pointer}/${key}`, key);
        for (const [key, value] of Object.entries(node)) {
          if (key === 'sourceSpec' || key === 'audit') continue;
          if (key === 'actions' && Array.isArray(value)) value.forEach((action, i) => {
            if (!basicActions.has(action.type)) unsupported(version, `${pointer}/actions/${i}`, action.type);
          });
          if (key === 'event' && !['click', 'OnClick', 'OnLoad', 'OnTextChange'].includes(value)) unsupported(version, `${pointer}/event`, value);
          if (typeof value === 'object') visit(value, `${pointer}/${key}`);
        }
      };
      visit(plan);
    },
  };
}
