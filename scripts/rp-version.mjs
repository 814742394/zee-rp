// Axure 版本识别：只认文件内部可验证的元数据，不靠文件名、扩展名或安装路径。
//
// 证据来源（按可信度递减，均来自 RP9 9.0.0.3740 与既有 RP11 11.0.0.4137 样本实测）：
//   1. xml:BreakingChanges 的 <Version> 主版本号——Axure 自己在文件里写的「本文件由哪个大版本创建」，
//      RP9 工程与 RP9 元件库（.rplib）都带这条记录。
//   2. Axure:DesignDocument 根对象的 SavedEdition 字段——实测 RP9 = 2（rp9-source.rp / MOM 样本 /
//      RP9 Default.rplib 三者一致）。RP11 的取值未经本机样本确认，故它只作佐证，单独出现不升级为结论。
//
// 两条证据冲突、或两条都读不到时一律返回 unknown：调用方必须把 unknown 当作「不能做版本敏感写入」，
// 不能像以前那样默认按 RP11 放行。
import { readRecords } from './rp-records.mjs';
import { parsePayload, field } from './parse-payload.mjs';

export const RP9 = 'rp9';
export const RP11 = 'rp11';
export const UNKNOWN = 'unknown';

export const EDITION_LABELS = {
  [RP9]: 'Axure RP 9',
  [RP11]: 'Axure RP 11',
  [UNKNOWN]: '未知版本',
};

// SavedEdition 的已知取值；新增证据时只往这里加，不要在判断处散落魔法数字。
const SAVED_EDITION = new Map([[2, RP9]]);

// 与文件格式无关的「应用版本」标签，供 jobs/axvg 这类需要知道目标进程是谁的场景使用。
export const APP_INFO = {
  [RP9]: {
    bundleId: 'com.axure.AxureRP9',
    processName: 'Axure RP 9',
    windowPrefixes: ['Axure RP 9 - ', ''],
    libraryRoot: '/Applications/Axure RP 9.app/Contents/Resources/DefaultSettings/Libraries',
  },
  [RP11]: {
    bundleId: 'com.axure.AxureRP11',
    processName: 'Axure RP 11',
    windowPrefixes: ['Axure RP 11 - ', ''],
  },
};

const BREAKING_CHANGES_VERSION = /<Version>\s*([0-9]+)\.([0-9]+)(?:\.([0-9]+))?(?:\.([0-9]+))?\s*<\/Version>/;

function breakingChangesVersion(record) {
  if (!record?.raw) return null;
  const text = record.raw.toString('utf8', 0, Math.min(record.raw.length, 4096));
  const match = BREAKING_CHANGES_VERSION.exec(text);
  return match ? { major: Number(match[1]), version: `${match[1]}.${match[2]}${match[3] ? `.${match[3]}` : ''}${match[4] ? `.${match[4]}` : ''}` } : null;
}

function savedEditionOf(record) {
  const graph = parsePayload(record);
  const root = graph.objects.get(graph.roots.find(node => node.tag === 0x0f)?.value);
  const node = field(root?.body ?? {}, 'SavedEdition');
  return node ? { raw: node.value, tag: node.tag } : null;
}

const majorEdition = major => (major === 9 ? RP9 : major === 11 ? RP11 : null);

// 返回结构固定的识别结果；说明文本直接给用户看，因此写成「读到了什么」而不是「猜到了什么」。
// file 或已解出的 records 二选一：readRp 已经解过记录时传 records，避免 85MB 工程重复解压。
export function detectEdition(file, { records: prepared } = {}) {
  const result = {
    edition: UNKNOWN,
    label: EDITION_LABELS[UNKNOWN],
    major: null,
    version: null,
    savedEdition: null,
    breakingChanges: null,
    evidence: [],
    conflict: false,
  };
  let records = prepared;
  if (!records) {
    try { records = readRecords(file); }
    catch (error) {
      result.evidence.push(`不是可解析的 Axure 文件：${error.message}`);
      return result;
    }
  }
  const breaking = breakingChangesVersion(records.find(record => record.className === 'xml:BreakingChanges'));
  if (breaking) {
    result.breakingChanges = breaking.version;
    result.evidence.push(`xml:BreakingChanges Version=${breaking.version}`);
  }
  const document = records.find(record => record.className === 'Axure:DesignDocument');
  if (document) {
    try {
      const saved = savedEditionOf(document);
      if (saved) {
        result.savedEdition = saved.raw;
        result.evidence.push(`DesignDocument SavedEdition=${saved.raw}`);
      }
    } catch (error) {
      result.evidence.push(`DesignDocument 无法解析：${error.message}`);
    }
  }
  const fromMajor = breaking ? majorEdition(breaking.major) : null;
  const fromSaved = result.savedEdition === null ? null : SAVED_EDITION.get(result.savedEdition) ?? null;
  // 主版本号是权威证据；SavedEdition 只在没有主版本号时兜底，且必须与主版本号一致才认。
  if (fromMajor && fromSaved && fromMajor !== fromSaved) {
    result.conflict = true;
    result.evidence.push(`主版本 ${breaking.version} 与 SavedEdition=${result.savedEdition} 矛盾，按未知版本处理`);
    return result;
  }
  const edition = fromMajor ?? fromSaved;
  if (!edition) {
    result.evidence.push('缺少 BreakingChanges 主版本与 SavedEdition 证据，按未知版本处理');
    return result;
  }
  result.edition = edition;
  result.label = EDITION_LABELS[edition];
  result.major = breaking?.major ?? (edition === RP9 ? 9 : 11);
  result.version = breaking?.version ?? null;
  return result;
}

export const editionOfFile = file => detectEdition(file).edition;

// 供 CLI/MCP 返回的统一「文件版本」描述。
export const editionReport = detected => ({
  edition: detected.edition,
  label: detected.label,
  version: detected.version,
  savedEdition: detected.savedEdition,
  evidence: detected.evidence,
  ...(detected.conflict ? { conflict: true } : {}),
});
