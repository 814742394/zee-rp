import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNotProtected } from './engine.mjs';
import { readRecords, readManifest, encodeManifest, encodeRecord, replaceRecord } from './rp-records.mjs';
import { parsePayload, encodePayload, field, walkNodes } from './parse-payload.mjs';
import { readRp } from './rp-read.mjs';
import { DEFAULT_VERSION, detectFileVersion, tryDetectFileVersion, resolveTargetVersion, templateCandidates, versionLabel } from './version.mjs';

// 空白工程模板按目标版本解析。Axure 安装包只带教学工程，没有独立空白 .rp，
// 因此模板取自用户本机保存的空白件，不随代码分发。
//   版本 9  -> AXURE_BLANK_TEMPLATE_RP9  或 ~/Library/Application Support/zee-axure/templates/axure-rp9-blank.rp
//   版本 11 -> AXURE_BLANK_TEMPLATE_RP11 或 ~/Library/Application Support/zee-axure/templates/axure-rp11-blank.rp
// 旧变量 AXURE_BLANK_TEMPLATE 仍被接受，但会校验文件头版本是否等于目标版本，
// 避免把 RP 11 的空白 Page 导进 RP 9 工程（或反过来）。
export function resolveBlankTemplate(version = DEFAULT_VERSION, explicitTemplate) {
  const target = resolveTargetVersion(version);
  const candidates = explicitTemplate ? [{ path: explicitTemplate, from: 'template' }] : templateCandidates(target);
  if (!explicitTemplate && process.env.AXURE_BLANK_TEMPLATE) {
    candidates.unshift({ path: process.env.AXURE_BLANK_TEMPLATE, from: 'AXURE_BLANK_TEMPLATE' });
  }

  const tried = [];
  let versionMismatch = null;
  for (const c of candidates) {
    const path = resolve(c.path);
    assertNotProtected(path);
    const isExplicitEnv = c.from !== 'default' && c.from !== 'tmp-fallback';
    if (!existsSync(path)) {
      if (isExplicitEnv) throw new Error(`${c.from} 指定的空白模板不存在：${path}`);
      tried.push(`${c.from}: ${path}（不存在）`);
      continue;
    }
    let actual;
    try { actual = detectFileVersion(readFileSync(path)); }
    catch (e) {
      if (isExplicitEnv) throw new Error(`${c.from} 不是可识别的 Axure 容器（${path}）：${e.message}`);
      tried.push(`${c.from}: ${path}（不是可识别的 Axure 容器：${e.message}）`);
      continue;
    }
    if (actual !== target) {
      const detail = `${c.from} 指向 ${versionLabel(actual)} 模板，但目标版本是 ${versionLabel(target)}：${path}`;
      if (isExplicitEnv) {
        throw new Error(`${detail}\n请改用 ${target === 9 ? 'AXURE_BLANK_TEMPLATE_RP9' : 'AXURE_BLANK_TEMPLATE_RP11'}，或清掉 AXURE_BLANK_TEMPLATE。`);
      }
      versionMismatch = detail;
      tried.push(`${c.from}: ${path}（版本 ${actual} ≠ 目标 ${target}）`);
      continue;
    }
    return path;
  }

  const envName = target === 9 ? 'AXURE_BLANK_TEMPLATE_RP9' : 'AXURE_BLANK_TEMPLATE_RP11';
  const lines = [
    `缺少 ${versionLabel(target)} 的空白工程模板。`,
    `请用 ${versionLabel(target)} 新建单页空白工程并另存为新文件，再设置 ${envName} 指向它。代码包不包含 Axure .rp 模板。`,
    `已尝试：\n  ${tried.join('\n  ')}`,
  ];
  if (versionMismatch) lines.push(`版本不匹配：${versionMismatch}`);
  throw new Error(lines.join('\n'));
}

// ---- 从同版本工程派生单页空白工程 ----
// 只保留：DesignDocument（改为只登记目标页）、目标空白页、以及所有非 Page/PanelState/DocumentSettings
// 记录（生成器配置、BreakingChanges 等）。其余页面、面板状态、界面状态记录连同缩略图整段丢弃，
// 并按新的段位置重算 manifest 偏移——不留下残留字节。
// rewriteDocument=false 时跳过 DesignDocument 重写（诊断用：隔离「改写」与「裁剪」两个变量）。
export function rewriteDocumentToSinglePage(file, { pageName, pageNames = [] }) {
  const records = readRecords(file);
  const documentRecord = records.find(record => record.className === 'Axure:DesignDocument');
  if (!documentRecord) throw new Error('源工程缺少 Axure:DesignDocument 记录');
  const document = parsePayload(documentRecord);
  const strings = [...documentRecord.strings];
  const root = document.objects.get(document.roots.find(node => node.tag === 0x0f)?.value);
  if (!root) throw new Error('DesignDocument 根对象缺失');

  const infos = field(root.body, 'PackageInfos')?.items ?? [];
  const infoOf = item => document.objects.get(item.value);
  const guidOf = item => field(infoOf(item)?.body ?? {}, 'package-id')?.values?.[1];
  const nameOf = item => {
    const nameNode = field(infoOf(item)?.body ?? {}, 'package-name');
    return nameNode?.tag === 8 ? nameNode.text : undefined;
  };
  const targetInfo = infos.find(item => nameOf(item) === pageName);
  if (!targetInfo) throw new Error(`源工程的 PackageInfos 里没有页面「${pageName}」`);
  const targetGuidIndex = guidOf(targetInfo);

  const site = document.objects.get(field(root.body, 'sitemap')?.value);
  const nodeTable = field(site?.body ?? {}, 'node-table');
  const tree = document.objects.get(field(site?.body ?? {}, 'tree')?.value);
  if (!site || !nodeTable || !tree) throw new Error('源工程站点地图结构不完整');
  const targetEntry = nodeTable.entries.find(([, value]) => value.tag === 0x13 && value.values?.[1] === targetGuidIndex);
  if (!targetEntry) throw new Error(`站点地图里没有页面「${pageName}」的节点`);

  // PackageInfos 只删「页面类」条目，保留生成器配置（HTML/Word/CSV/Print）等信息：
  // manifest 的每个叶子包都要能被 PackageInfos 解析到，删掉配置类条目会让 RP9 报「文件已损坏」
  // （2026-10-21 用户实测 v1 变体）。非页面条目（名称不在页面清单里）原样保留。
  const isPageInfo = item => pageNames.includes(nameOf(item));
  field(root.body, 'PackageInfos').items = infos.filter(item => !isPageInfo(item) || item === targetInfo);
  nodeTable.entries = [targetEntry];
  field(tree.body, 'children').items = [{ tag: 3, value: targetEntry[0].value }];
  const masterMap = document.objects.get(field(root.body, 'mastermap')?.value);
  if (masterMap) {
    const masterTree = document.objects.get(field(masterMap.body, 'tree')?.value);
    if (masterTree) field(masterTree.body, 'children').items = [];
    const masterTable = field(masterMap.body, 'node-table');
    if (masterTable) masterTable.entries = [];
  }

  // 池子修剪：上面的列表删减会让被移除项的对象变成孤儿。RP9 要求池中每个对象都被引用
  // （健康文件里可达集 == 全集，2026-10-21 用户实测：只删列表项不删对象 → 「This file may be
  // corrupted」）。对象 id 是显式存储的（tag 9 自带 u32 id），删除不需要重编号。
  const reach = reachableObjectIds(document.roots, document.objects);
  const orphanCount = document.objects.size - reach.size;
  document.roots = document.roots.filter(node => node.tag !== 9 || reach.has(node.id));

  return replaceRecord(file, documentRecord, encodeRecord(documentRecord, strings, encodePayload(document.roots)));
}

// DesignDocument 对象池的可达性：健康文件里池中每个对象都必须能从根对象到达（ref 类 tag：
// 3/0x0f/0x11/0x12/0x14/0x16；0x13 值对里的两个 u32 是字符串/GUID 下标，不是对象引用）。
const DD_REF_TAGS = new Set([3, 0x0f, 0x11, 0x12, 0x14, 0x16]);
function reachableObjectIds(roots, objects) {
  const rootRefNode = roots.find(node => node.tag === 0x0f);
  if (!rootRefNode) throw new Error('DesignDocument 根引用缺失');
  const reach = new Set([rootRefNode.value]);
  let queue = [objects.get(rootRefNode.value)];
  while (queue.length) {
    const next = [];
    for (const obj of queue) {
      walkNodes([obj.body], node => {
        if (DD_REF_TAGS.has(node.tag) && objects.has(node.value) && !reach.has(node.value)) {
          reach.add(node.value);
          next.push(objects.get(node.value));
        }
      });
    }
    queue = next;
  }
  return reach;
}

// 供自检/测试用：返回 DesignDocument 池中的孤儿对象（不可达对象）。
export function designDocumentOrphans(record) {
  const doc = parsePayload(record);
  const reach = reachableObjectIds(doc.roots, doc.objects);
  return [...doc.objects.values()].filter(obj => !reach.has(obj.id));
}

export function deriveBlankTemplate({ source, page, output, rewriteDocument = true }) {
  if (!source || !page || !output) throw new Error('derive 需要 <source.rp> <blankPageName> <output.rp>');
  const sourcePath = resolve(source), outputPath = resolve(output);
  assertNotProtected(sourcePath);
  assertNotProtected(outputPath);
  if (!existsSync(sourcePath)) throw new Error(`源工程不存在：${sourcePath}`);
  if (existsSync(outputPath)) throw new Error(`输出已存在，派生空白模板不覆盖：${outputPath}`);

  const original = readFileSync(sourcePath);
  const sourceVersion = tryDetectFileVersion(original);
  if (sourceVersion === null) throw new Error('无法判定源工程版本（文件头不是可识别的 Axure 容器），拒绝派生');
  const summary = readRp(original, { path: sourcePath });
  const target = summary.pages.find(item => item.name === page);
  if (!target) throw new Error(`源工程里没有页面「${page}」；现有页面：${summary.pages.map(p => p.name).join('、')}`);
  if (target.counts.widgets !== 0) throw new Error(`页面「${page}」还有 ${target.counts.widgets} 个控件，不能作为空白页模板`);
  if (summary.counts.masters !== 0) throw new Error(`源工程含 ${summary.counts.masters} 个母版；派生只支持无母版工程，请在 ${versionLabel(sourceVersion)} 中直接另存一个空白工程`);

  // 1) DesignDocument 只留目标页（rewriteDocument=false 仅用于诊断二分：只裁剪记录、不改写文档）
  const stage1 = rewriteDocument
    ? rewriteDocumentToSinglePage(original, { pageName: page, pageNames: summary.pages.map(item => item.name) })
    : original;

  // 2) 保留集合：目标页 + 非 Page/PanelState/DocumentSettings 记录
  const records = readRecords(stage1);
  const manifest = readManifest(stage1);
  const keepRecord = record => (record.className === 'Axure:Page'
    ? record.index === target.record
    : !['Axure:PanelState', 'Axure:DocumentSettings'].includes(record.className));

  const recordStart = new Map(records.map(record => [record.offset - 8, record]));
  const flowRoot = manifest.value.root;

  // 3) 段表：记录段 + manifest 引用到的缩略图段，按起点排序后重排
  const owned = new Map(); // 绝对起点 → { keep }
  for (const child of Object.values(flowRoot.children ?? {})) {
    const record = recordStart.get(manifest.dataStart + (child.parts?.package ?? -1));
    const keep = record ? keepRecord(record) : true;
    for (const relative of Object.values(child.parts ?? {})) owned.set(manifest.dataStart + relative, { keep });
  }
  for (const [key, child] of Object.entries(flowRoot.children ?? {})) {
    const record = recordStart.get(manifest.dataStart + (child.parts?.package ?? -1));
    if (record && !keepRecord(record)) delete flowRoot.children[key];
  }

  const ordered = [...new Set([...recordStart.keys(), ...owned.keys()])].sort((a, b) => a - b);
  if (ordered[0] !== manifest.dataStart) throw new Error('记录流起点与 manifest dataStart 不一致，拒绝猜测布局');
  const segments = ordered.map((start, i) => {
    const end = i + 1 < ordered.length ? ordered[i + 1] : stage1.length;
    const record = recordStart.get(start);
    const keep = record ? keepRecord(record) : (owned.get(start)?.keep ?? true);
    return { start, end, keep };
  });
  const covered = segments.reduce((sum, segment) => sum + (segment.end - segment.start), 0);
  if (covered !== stage1.length - manifest.dataStart) throw new Error('记录流存在未覆盖字节，拒绝派生（布局不是纯段流）');

  const chunks = [];
  const newOffset = new Map();
  let cursor = 0;
  for (const segment of segments) {
    if (!segment.keep) continue;
    newOffset.set(segment.start, cursor);
    chunks.push(stage1.subarray(segment.start, segment.end));
    cursor += segment.end - segment.start;
  }
  // 4) 保留的段：递归重算所有 manifest 部件偏移。
  //    根节点自己也有部件（DesignDocument、<版本>.version），它们指向记录起点而不在 children 里，
  //    只遍历 children 会把它们留在原工程的大偏移上——偏移越过文件尾部后，RP9 读版本流会得到空内容
  //    并报 “Root element is missing”，同时本仓库的 replaceRecord 也找不到引用而拒绝后续写入。
  const remap = (node, where) => {
    for (const [kind, relative] of Object.entries(node.parts ?? {})) {
      const moved = newOffset.get(manifest.dataStart + relative);
      if (moved === undefined) throw new Error(`manifest 部件 ${where}/${kind}@${relative} 指向被丢弃的段，派生结果会损坏`);
      node.parts[kind] = moved;
    }
    for (const [key, child] of Object.entries(node.children ?? {})) remap(child, `${where}/${key}`);
  };
  remap(flowRoot, 'root');
  const body = Buffer.concat(chunks);
  const outputBuffer = Buffer.concat([encodeManifest(stage1, manifest.value), body]);
  writeFileSync(outputPath, outputBuffer, { flag: 'wx' });

  // 5) 自检：单页、无控件、结构三零
  const result = readRp(outputBuffer, { path: outputPath });
  if (result.pages.length !== 1 || result.counts.widgets !== 0 || result.records.unparseable || result.counts.problems) {
    throw new Error(`派生结果未通过自检：pages=${result.pages.length} widgets=${result.counts.widgets} unparseable=${result.records.unparseable} problems=${result.counts.problems}`);
  }
  // 6) 自检：manifest 与记录一一对应——每条记录恰被引用一次，且所有引用都落在文件内。
  //    只修 children 而漏掉根节点部件时，这里会立刻报错，不必等 RP9 打开才暴露。
  const written = readManifest(outputBuffer);
  const refCount = new Map();
  const collectRefs = node => {
    for (const relative of Object.values(node.parts ?? {})) refCount.set(relative, (refCount.get(relative) ?? 0) + 1);
    for (const child of Object.values(node.children ?? {})) collectRefs(child);
  };
  collectRefs(written.value.root);
  const dangling = [...refCount.keys()].filter(relative => written.dataStart + relative >= outputBuffer.length);
  if (dangling.length) {
    throw new Error(`派生结果有 ${dangling.length} 个 manifest 部件指向文件尾部之外（首个 @${dangling[0]} 超出正文 ${outputBuffer.length - written.dataStart} 字节）`);
  }
  const unindexed = readRecords(outputBuffer, written)
    .filter(record => refCount.get(record.offset - 8 - written.dataStart) !== 1);
  if (unindexed.length) {
    throw new Error(`派生结果有 ${unindexed.length} 条记录的 manifest 引用数不是 1：${unindexed.map(item => `#${item.index} ${item.className}`).join('、')}`);
  }
  // 7) 自检：DesignDocument 池不允许有孤儿对象（RP9 会报「This file may be corrupted」）
  if (rewriteDocument) {
    const ddRecord = readRecords(outputBuffer, written).find(record => record.className === 'Axure:DesignDocument');
    const orphans = designDocumentOrphans(ddRecord);
    if (orphans.length) {
      throw new Error(`派生结果 DesignDocument 池有 ${orphans.length} 个孤儿对象：${orphans.map(obj => `#${obj.id} ${obj.className}`).join('、')}`);
    }
    // 8) 自检：PackageInfos 必须覆盖 manifest 的每个叶子包（页面 + 生成器配置）。
    //    RP9 按叶子包查 PackageInfo，缺一个就报「文件已损坏」（2026-10-21 用户实测）。
    let leaves = 0;
    const countLeaves = node => {
      const children = Object.values(node.children ?? {});
      if (!children.length) { leaves++; return; }
      children.forEach(countLeaves);
    };
    countLeaves(written.value.root);
    const doc = parsePayload(ddRecord);
    const ddRoot = doc.objects.get(doc.roots.find(node => node.tag === 0x0f)?.value);
    const infos = field(ddRoot.body, 'PackageInfos')?.items?.length ?? 0;
    if (leaves !== infos) {
      throw new Error(`派生结果的 manifest 叶子包 ${leaves} 个，但 PackageInfos 只有 ${infos} 项——RP9 会判定文件损坏`);
    }
  }
  return {
    output: outputPath,
    source: sourcePath,
    version: result.version,
    label: versionLabel(result.version),
    page: result.pages[0].name,
    droppedPages: summary.pages.filter(item => item.name !== page).map(item => item.name),
    droppedRecords: records.length - result.records.total,
    bytes: outputBuffer.length,
    sourceBytes: original.length,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [sub, a, b, c] = process.argv.slice(2);
  if (sub !== 'derive' || !a || !b || !c) {
    console.error('Usage: node blank-template.mjs derive <source.rp> <blankPageName> <output.rp>');
    console.error('  从同版本工程派生单页空白工程（只保留目标空白页），供 AXURE_BLANK_TEMPLATE_RP9 / _RP11 使用。');
    process.exit(1);
  }
  if (!c.toLowerCase().endsWith('.rp')) throw new Error('输出必须以 .rp 结尾');
  console.log(JSON.stringify(deriveBlankTemplate({ source: a, page: b, output: c }), null, 2));
}
