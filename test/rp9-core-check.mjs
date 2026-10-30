// RP9 Core 验收：读取 → 文本改写 → 库元件克隆 → 新建空白页 → 新建空白工程 → 版本拦截。
// 只做离线结构与差异检查；「RP9 能打开、保存、重开」由 test/rp9-native-check.mjs 单独记录，
// 两者不能互相代替。
//
// 必需外部输入（都由用户提供，代码包不分发任何 Axure 文件）：
//   AXURE_RP9_SAMPLE       一个 Axure RP 9 工程（.rp）
//   AXURE_RP9_LIBRARY      Axure RP 9 的 Default.rplib（默认取本机安装路径）
//   AXURE_BLANK_TEMPLATE_RP9  RP9 单页空白工程；未设置时用 AXURE_RP9_BLANK_PAGE 指定的示例空白页派生
//   AXURE_RP9_BLANK_PAGE   示例工程里一个「无控件」的页名（用于派生空白模板）
//   AXURE_RP9_WIDGET_PAGE / AXURE_RP9_WIDGET_ID  文本改写目标（默认取示例工程第一个有控件的页与首个元件）
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AxureSession } from '../scripts/engine.mjs';
import { readRp } from '../scripts/rp-read.mjs';
import { tryDetectFileVersion } from '../scripts/version.mjs';
import { deriveBlankTemplate, designDocumentOrphans } from '../scripts/blank-template.mjs';
import { parsePayload, field } from '../scripts/parse-payload.mjs';
import { cloneLibraryWidget } from '../scripts/clone-library-widget.mjs';
import { createBlankPage } from '../scripts/create-blank-page.mjs';
import { createBlankProject } from '../scripts/create-blank-project.mjs';
import { setRecordWidgetText } from '../scripts/set-widget-text.mjs';
import { preflight } from '../scripts/version-guard.mjs';
import { readManifest, readRecords } from '../scripts/rp-records.mjs';

const sample = process.env.AXURE_RP9_SAMPLE;
const library = process.env.AXURE_RP9_LIBRARY
  || '/Applications/Axure RP 9.app/Contents/Resources/DefaultSettings/Libraries/Default.rplib';
const missing = [];
if (!sample || !existsSync(sample)) missing.push('AXURE_RP9_SAMPLE 指向一个存在的 RP9 工程');
if (!existsSync(library)) missing.push(`AXURE_RP9_LIBRARY 指向 RP9 的 Default.rplib（当前候选：${library}）`);
if (missing.length) {
  console.error(`缺失前提（不计为通过）：\n - ${missing.join('\n - ')}`);
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), 'zee-rp9-core-'));
const previousRoot = process.env.AXURE_WRITE_ROOT, previousTemplate = process.env.AXURE_BLANK_TEMPLATE_RP9;
process.env.AXURE_WRITE_ROOT = work;
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const sourceSha = sha(sample);
const original = readFileSync(sample);
const results = [];
const check = (name, action) => {
  try { action(); results.push({ name, passed: true }); console.log(`PASS  ${name}`); }
  catch (error) { results.push({ name, passed: false, detail: error.message }); console.log(`FAIL  ${name} — ${error.message}`); }
};

let blankTemplate = process.env.AXURE_BLANK_TEMPLATE_RP9;
try {
  // 1) 版本识别：只认文件内元数据
  check('示例工程识别为 Axure RP 9（带证据）', () => {
    const version = tryDetectFileVersion(original);
    assert.equal(version, 9, `文件头识别的版本是 ${version}，应为 9`);
    // 交叉验证：内容层证据（BreakingChanges 主版本）必须与文件头一致。
    const summary = readRp(original, { path: sample });
    assert.equal(summary.version, 9, `readRp 报告的版本是 ${summary.version}`);
  });

  // 2) 空白模板：优先用现成 RP9 模板，否则从同版本工程派生
  if (!blankTemplate) {
    const blankPage = process.env.AXURE_RP9_BLANK_PAGE;
    check('没有现成 RP9 模板时，可从同版本工程派生单页空白工程', () => {
      assert.ok(blankPage, '缺少 AXURE_BLANK_TEMPLATE_RP9 时必须提供 AXURE_RP9_BLANK_PAGE（示例工程里的空白页名）');
      blankTemplate = join(work, 'rp9-blank.rp');
      const derived = deriveBlankTemplate({ source: sample, page: blankPage, output: blankTemplate });
      assert.equal(derived.version, 9, `派生结果版本 ${derived.version}`);
      const derivedFile = readFileSync(blankTemplate);
      assert.equal(tryDetectFileVersion(derivedFile), 9);
      const derivedSummary = readRp(derivedFile, { path: blankTemplate });
      assert.equal(derivedSummary.counts.pages, 1, `派生结果应有 1 页，实际 ${derivedSummary.counts.pages}`);
      assert.equal(derivedSummary.counts.widgets, 0, `派生结果应无控件，实际 ${derivedSummary.counts.widgets}`);
    });
  }
  if (blankTemplate) process.env.AXURE_BLANK_TEMPLATE_RP9 = blankTemplate;

  const summary = readRp(original, { path: sample });
  const pageWithWidget = process.env.AXURE_RP9_WIDGET_PAGE
    || summary.pages.find(page => page.counts.widgets > 0)?.name;
  const widgetId = process.env.AXURE_RP9_WIDGET_ID
    ? Number(process.env.AXURE_RP9_WIDGET_ID)
    // 默认取第一个「有文本」的元件：没有文本块的图形（如纯矢量块）本来就不该是文本改写的目标。
    : summary.pages.find(page => page.name === pageWithWidget)?.widgets.find(widget => widget.text)?.id;
  // 克隆宿主页：优先空白页，没有就放在第一个有控件的页上（真实工程常常没有空白页）。
  const hostPage = process.env.AXURE_RP9_BLANK_PAGE
    || summary.pages.find(page => page.counts.widgets === 0)?.name
    || pageWithWidget;
  // 真实工程（如 MOM 样本）本身就有重名/悬空告警：验收标准是「不比源文件多」，不是「归零」。
  const baseline = { unparseable: summary.records.unparseable, danglingRefs: summary.counts.danglingRefs, problems: summary.counts.problems };
  const noRegress = after => {
    assert.equal(after.records.unparseable, 0, '输出有不可解析记录');
    assert.equal(after.counts.danglingRefs, baseline.danglingRefs, `悬空引用从 ${baseline.danglingRefs} 变成 ${after.counts.danglingRefs}`);
    assert.equal(after.counts.problems, baseline.problems, `结构问题从 ${baseline.problems} 变成 ${after.counts.problems}`);
  };

  // 3) 文本改写：只动目标记录，其余计数不变
  check('set-widget-text 在 RP9 上只改目标文本，页面/元件计数不变', () => {
    assert.ok(pageWithWidget && widgetId, '示例工程里没有可改写的元件，请设置 AXURE_RP9_WIDGET_PAGE / AXURE_RP9_WIDGET_ID');
    const output = join(work, 'text.rp');
    const record = summary.pages.find(page => page.name === pageWithWidget).record;
    const marker = `RA9-${process.pid}`;
    setRecordWidgetText(sample, output, record, widgetId, marker);
    const after = readRp(readFileSync(output), { path: output });
    assert.equal(after.counts.pages, summary.counts.pages);
    assert.equal(after.counts.widgets, summary.counts.widgets);
    noRegress(after);
    assert.equal(after.version, 9, '输出必须仍是 RP9 格式');
    const widget = after.pages.find(page => page.name === pageWithWidget).widgets.find(item => item.id === widgetId);
    assert.equal(widget.text, marker);
  });

  // 4) 库克隆：RP9 库 → RP9 工程
  check('clone-library-widget 从 RP9 库克隆元件到 RP9 页（同版本）', () => {
    assert.ok(hostPage, '示例工程里没有可用页面，请设置 AXURE_RP9_BLANK_PAGE');
    const output = join(work, 'clone.rp');
    const sourcePage = readRp(readFileSync(library), { path: library }).pages
      .find(page => page.widgets.length === 1 && !page.widgets[0].panel);
    assert.ok(sourcePage, 'RP9 元件库里没有「恰好一个控件」的库页');
    const result = cloneLibraryWidget(library, sample, output, {
      sourcePageName: sourcePage.name, targetPageName: hostPage, name: 'RP9_CLONE', x: 40, y: 40
    });

    const after = readRp(readFileSync(output), { path: output });
    assert.equal(after.counts.widgets, summary.counts.widgets + 1);
    noRegress(after);
    assert.equal(after.version, 9);
  });

  // 5) 新建空白页：模板与目标同版本
  check('create-blank-page 用 RP9 模板给 RP9 工程加页', () => {
    const output = join(work, 'page.rp');
    const result = createBlankPage(original, `RP9 新页 ${process.pid}`);
    writeFileSync(output, result.file, { flag: 'wx' });
    assert.equal(tryDetectFileVersion(result.file), 9, '加页后仍是 RP9 容器');
    const after = readRp(readFileSync(output), { path: output });
    assert.equal(after.counts.pages, summary.counts.pages + 1);
    noRegress(after);
    assert.equal(after.version, 9);
  });

  // 6) 新建空白工程：单页、零控件
  check('create-blank-project 生成 RP9 单页空白工程', () => {
    const output = join(work, 'project.rp');
    const result = createBlankProject(output, { version: 9 });
    assert.equal(result.version, 9, `生成的工程版本 ${result.version}`);
    const after = readRp(readFileSync(output), { path: output });
    assert.equal(after.counts.pages, 1);
    assert.equal(after.counts.widgets, 0);
    assert.equal(after.counts.panelStates, 0);
    assert.equal(after.counts.problems, 0);
  });

  // 6c) 模板自身自洽：RP9 按叶子包查 PackageInfo、并要求池中对象全部被引用，
  //     这两条缺一个都会让 RP9 报「This file may be corrupted」（2026-10-21 用户实测）。
  check('RP9 空白模板的 DesignDocument 自洽（无孤儿对象、PackageInfos 覆盖叶子包）', () => {
    assert.ok(blankTemplate, '需要 RP9 空白模板（AXURE_BLANK_TEMPLATE_RP9）');
    const templateFile = readFileSync(blankTemplate);
    const templateManifest = readManifest(templateFile);
    let leaves = 0;
    const countLeaves = node => {
      const children = Object.values(node.children ?? {});
      if (!children.length) { leaves++; return; }
      children.forEach(countLeaves);
    };
    countLeaves(templateManifest.value.root);
    const ddRecord = readRecords(templateFile, templateManifest).find(record => record.className === 'Axure:DesignDocument');
    const orphans = designDocumentOrphans(ddRecord);
    assert.equal(orphans.length, 0, `DD 池有孤儿对象：${orphans.map(obj => `#${obj.id} ${obj.className}`).join('、')}`);
    const doc = parsePayload(ddRecord);
    const ddRoot = doc.objects.get(doc.roots.find(node => node.tag === 0x0f)?.value);
    const infos = field(ddRoot.body, 'PackageInfos')?.items?.length ?? 0;
    assert.equal(infos, leaves, `manifest 叶子包 ${leaves} 个，PackageInfos ${infos} 项`);
  });

  // 6b) 模板派生自洽：新建出来的工程必须还能继续被写入。
  //     派生模板若把根节点部件（DesignDocument / <版本>.version）留在原工程的大偏移上，
  //     这些引用会越过文件尾部，RP9 读版本流拿到空内容，本仓库的 replaceRecord 也会因找不到引用而失败。
  check('从 RP9 模板新建的工程可以继续加页（manifest 引用自洽）', () => {
    const project = join(work, 'project-extend.rp');
    createBlankProject(project, { version: 9 });
    const grown = createBlankPage(readFileSync(project), `RP9 追加页 ${process.pid}`);
    const output = join(work, 'project-extend-2.rp');
    writeFileSync(output, grown.file, { flag: 'wx' });
    const file = readFileSync(output);
    const after = readRp(file, { path: output });
    assert.equal(after.counts.pages, 2, `追加后应有 2 页，实际 ${after.counts.pages}`);
    assert.equal(after.counts.problems, 0);
    assert.equal(after.version, 9);

    const manifest = readManifest(file);
    const refs = new Map();
    const walk = node => {
      for (const relative of Object.values(node.parts ?? {})) refs.set(relative, (refs.get(relative) ?? 0) + 1);
      for (const child of Object.values(node.children ?? {})) walk(child);
    };
    walk(manifest.value.root);
    const beyond = [...refs.keys()].filter(relative => manifest.dataStart + relative >= file.length);
    assert.equal(beyond.length, 0, `manifest 部件越界：${beyond.join(', ')}`);
    const unindexed = readRecords(file, manifest)
      .filter(record => refs.get(record.offset - 8 - manifest.dataStart) !== 1);
    assert.equal(unindexed.length, 0, `记录缺 manifest 引用：${unindexed.map(item => item.className).join('、')}`);
  });

  // 7) 版本拦截：这些都必须「生成输出前」失败
  check('RP9 + apply-style 在写出前被拒绝（CLI 路径）', () => {
    assert.throws(() => new AxureSession().run('add-interaction', [sample, join(work, 'apply.rp'), pageWithWidget ?? summary.pages[0].name,
      '--event', 'OnClick', '--action', 'apply-style', 'fill=#2F6BFF']), /版本拦截|apply-style/);
    assert.ok(!existsSync(join(work, 'apply.rp')), '被拒绝的调用不应留下输出文件');
  });

  check('RP9 + axvg paste 被拒绝', () => {
    process.env.AXURE_TARGET_VERSION = '9';
    delete process.env.AXURE_ALLOW_RP9_PASTE;
    assert.throws(() => preflight({ command: 'axvg paste', args: [] }), /版本拦截/);
    delete process.env.AXURE_TARGET_VERSION;
  });

  check('RP9 工程 + 无法判定版本的元件库被拒绝', () => {
    const fake = join(work, 'fake.rplib');
    writeFileSync(fake, 'not an axure library');
    assert.throws(() => preflight({ command: 'clone-library-widget', args: [fake, sample] }), /版本拦截|无法判定素材/);
  });

  check('无法判定版本的项目文件拒绝版本敏感写入', () => {
    const fake = join(work, 'fake.rp');
    writeFileSync(fake, 'not an axure project');
    assert.throws(() => preflight({ command: 'set-widget-text', args: [fake, join(work, 'x.rp')] }), /版本拦截/);
  });

  // 8) 源文件永不被改写
  check('全部步骤后源工程字节不变', () => {
    assert.equal(sha(sample), sourceSha);
  });
} finally {
  if (previousRoot === undefined) delete process.env.AXURE_WRITE_ROOT; else process.env.AXURE_WRITE_ROOT = previousRoot;
  if (previousTemplate === undefined) delete process.env.AXURE_BLANK_TEMPLATE_RP9; else process.env.AXURE_BLANK_TEMPLATE_RP9 = previousTemplate;
  rmSync(work, { recursive: true, force: true });
}
const failed = results.filter(result => !result.passed).length;
console.log(JSON.stringify({ total: results.length, passed: results.length - failed, failed, sample, library, evidence: 'offline structure and diff checks; native RP9 open/save/reopen is rp9-native-check' }));
process.exitCode = failed ? 1 : 0;
