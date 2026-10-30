import { copyFileSync, readFileSync, constants, existsSync } from 'node:fs';
import { extname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRecords } from './rp-records.mjs';
import { readRp } from './rp-read.mjs';
import { parsePayload, field } from './parse-payload.mjs';

import { resolveBlankTemplate, inspectTemplate, TEMPLATE_CACHE_DIR } from './blank-template.mjs';
import { assertNotProtected } from './engine.mjs';
import { RP9, RP11 } from './rp-version.mjs';
import { preflightCli } from './version-guard.mjs';

const DEFAULT_NAMES = { [RP9]: 'axure-rp9-blank.rp', [RP11]: 'axure-rp11-blank.rp' };

// 没有输入工程可判版本，只能由「哪份模板存在」倒推；两边都在时保持旧的 RP11 默认，避免改变既有行为。
export function chooseEdition(explicit) {
  if (explicit) {
    if (![RP9, RP11].includes(explicit)) throw new Error(`--edition 只接受 rp9 或 rp11，收到 ${explicit}`);
    return explicit;
  }
  const specific = [RP9, RP11].filter(edition =>
    process.env[edition === RP9 ? 'AXURE_BLANK_TEMPLATE_RP9' : 'AXURE_BLANK_TEMPLATE_RP11']
    || existsSync(join(TEMPLATE_CACHE_DIR, DEFAULT_NAMES[edition])));
  if (specific.length === 1) return specific[0];
  // 没有任何版本专属模板时，按本机实际安装的 Axure 选：只装了 RP9 的机器不该被要求提供 RP11 模板。
  if (specific.length === 0 && process.platform === 'darwin') {
    const installed = [RP9, RP11].filter(edition => existsSync(`/Applications/${edition === RP9 ? 'Axure RP 9' : 'Axure RP 11'}.app`));
    if (installed.length === 1) return installed[0];
  }
  return RP11;
}

export function createBlankProject(outputPath, { edition = null } = {}) {
  const target = chooseEdition(edition);
  const TEMPLATE = resolveBlankTemplate(target);
  const output = resolve(outputPath);
  assertNotProtected(output);
  if (extname(output).toLowerCase() !== '.rp') throw new Error('Output path must end in .rp');

  const template = readFileSync(TEMPLATE);
  const inspected = inspectTemplate(TEMPLATE);
  const summary = inspected.summary;
  const records = readRecords(template);
  const page = records.find(record => record.index === summary.pages[0]?.record && record.className === 'Axure:Page');
  const graph = page && parsePayload(page);
  const pageObject = graph && [...graph.objects.values()].find(object => object.className === 'Axure:Page');
  const diagram = pageObject && graph.objects.get(field(pageObject.body, 'diagram')?.value);
  const objects = field(diagram?.body ?? {}, 'diagram-objects')?.items ?? [];

  if (summary.pages.length !== 1 || summary.counts.widgets !== 0 || summary.counts.panelStates !== 0 || objects.length !== 0) {
    throw new Error(`模板 ${TEMPLATE} 不再是单页空白工程（pages=${summary.pages.length} widgets=${summary.counts.widgets} panelStates=${summary.counts.panelStates} diagramObjects=${objects.length}）`);
  }
  copyFileSync(TEMPLATE, output, constants.COPYFILE_EXCL);
  return {
    output,
    template: TEMPLATE,
    edition: inspected.detected,
    page: summary.pages[0].name,
    pages: summary.counts.pages,
    widgets: summary.counts.widgets,
    panelStates: summary.counts.panelStates,
    bytes: template.length
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const editionAt = argv.indexOf('--edition');
  const edition = editionAt >= 0 ? argv[editionAt + 1] : null;
  const positional = argv.filter((arg, i) => !arg.startsWith('--') && !(editionAt >= 0 && i === editionAt + 1));
  const output = positional[0];
  if (!output) {
    console.error('Usage: node create-blank-project.mjs <output.rp> [--edition rp9|rp11]');
    console.error('  模板按 --edition → AXURE_BLANK_TEMPLATE_RP9/_RP11 → 本机缓存 axure-rp{9,11}-blank.rp 解析；版本不符即拒绝。');
    process.exit(1);
  }
  preflightCli('create-blank-project', argv);
  console.log(JSON.stringify(createBlankProject(output, { edition }), null, 2));
}
