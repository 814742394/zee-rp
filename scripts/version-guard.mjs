import { RP9_COMMAND_STATUS, commandCapability } from './capabilities.mjs';
// 版本能力检查：CLI、MCP 与直接脚本调用共用的唯一判定点。
//
// 三件事，按顺序做：
//   1. 给本次调用涉及的所有 Axure 文件判版本（复用 version.mjs 的文件头识别），遇到跨版本组合直接拒绝；
//   2. 查命令在该版本的支持等级（RP9 Core / RP9 未验证 / 拒绝），拒绝时抛错并写清「文件版本 + 功能 + 原因」；
//   3. 版本敏感素材（模板、.rplib）必须与目标文件同版本。
//
// 语义约定：blocked 才抛错；unverified 放行但把提示交给调用方（CLI 打 stderr，MCP 放进返回值），
// 让「未验证」永远可见，不会被读成「已验证」。
//
// 版本表示：本模块内部统一用 version.mjs 的数字版本（9 / 11），null 表示无法判定。
// 这与 rp-read 返回的 `version` 字段一致，避免两套表示在同一进程里并存。
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  DEFAULT_VERSION, detectFileVersion, tryDetectFileVersion, versionLabel, versionSpec,
  supportedVersions, runningVersions, resolveTargetVersion,
} from './version.mjs';
import { getCommand } from './registry.mjs';

const AXURE_EXTENSIONS = new Set(['.rp', '.rplib', '.rppkg']);
const FILE_KIND = { '.rp': 'project', '.rplib': 'library', '.rppkg': 'package' };

const RP9 = 9;
// null 表示「读不出可支持的版本」——不能当成 11 放行。
export const UNKNOWN = null;

/** 版本 → 人类可读标签；unknown 时给明确措辞，不要回落成 RP 11。 */
export function labelOf(version) {
  if (version === UNKNOWN) return '未知版本';
  return versionLabel(version);
}

// 命令在 RP9 上的支持等级。缺省 = unverified（放行 + 提示），只有写进 blocked 的才前置拒绝。
// core：RP9 Core 首期能力（结构 + 原生打开按 docs/rp9-capabilities.md 的证据等级）；
// unverified：脚本能跑，但没有任何 RP9 原生验收证据，禁止对外宣称可用。
export { RP9_COMMAND_STATUS };

// 动作级拒绝名单：动作类型是 RP9 不认识的类名，写进文件会让 RP9 拒绝打开整个工程。
// ix-actions.mjs 在 writer 层已单独拒绝一次，这里是写出任何文件之前的第二道。
export const RP9_BLOCKED_ACTIONS = {
  'apply-style': 'RP9 不认识 Axure:InteractionApplyStyleInfo 动作类，加载时直接报 Unrecognized Type 并拒绝打开整个文件',
};

// 命令级拒绝原因（命令名 → 原因），只对 RP9 生效。
const RP9_COMMAND_REASONS = {
  'axvg paste': 'axvg 的剪贴板内容在 RP9 画布上实测无法粘贴（2026-10-20 本机），确认可用前请改用离线写入命令',
};

// 需要「目标 .rp 与导入素材（.rplib / 模板）同版本」的命令。
const SAME_VERSION_REQUIRED = new Set([
  'clone-library-widget', 'clone-library-page-content', 'create-blank-project', 'create-blank-page',
]);

export function commandStatusFor(version, command) {
  return commandCapability(version, command).status;
}

// ---- 路径与版本收集 ----

function looksLikeAxurePath(token) {
  if (typeof token !== 'string' || token.startsWith('-') || token.length === 0 || token.startsWith('=')) return false;
  return AXURE_EXTENSIONS.has(extname(token).toLowerCase());
}

// 只对存在的文件读版本；输出位在写出前不存在，跳过即可（写入永远是新文件）。
// 大工程逐记录解压很贵，按「路径+大小+mtime」缓存，同一进程内多次检查不重复解压。
const versionCache = new Map();

function inspectPath(token, baseDir) {
  const absolute = resolve(baseDir, token);
  const kind = FILE_KIND[extname(token).toLowerCase()] ?? 'file';
  if (!existsSync(absolute)) return { path: token, absolute, exists: false, kind, version: UNKNOWN, label: labelOf(UNKNOWN) };
  const { size, mtimeMs } = statSync(absolute);
  const key = `${absolute}:${size}:${mtimeMs}`;
  let version = versionCache.get(key);
  if (version === undefined) {
    // 头部识别失败（不是容器 / 版本不受支持）一律记 UNKNOWN，交给上层决定是否拒绝。
    version = tryDetectFileVersion(readFileSync(absolute));
    if (version === null) version = UNKNOWN;
    versionCache.set(key, version);
  }
  return { path: token, absolute, exists: true, kind, version, label: labelOf(version) };
}

function collectFiles(args, baseDir) {
  const files = [];
  const seen = new Set();
  for (const token of args) {
    if (!looksLikeAxurePath(token)) continue;
    const absolute = resolve(baseDir, token);
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    files.push(inspectPath(token, baseDir));
  }
  return files;
}

export function versionOfPath(path) {
  if (!existsSync(path)) return UNKNOWN;
  try { return detectFileVersion(readFileSync(path)); } catch { return UNKNOWN; }
}

// axvg paste 没有 .rp 参数：目标就是当前运行的 Axure。优先级：环境变量 > 运行中的进程 > 已安装应用。
export function detectTargetAppVersion() {
  const env = process.env.AXURE_TARGET_VERSION;
  if (env) {
    const version = resolveTargetVersion(env);
    return { version, label: versionLabel(version), source: 'AXURE_TARGET_VERSION' };
  }
  if (process.platform === 'darwin') {
    const running = runningVersions();
    if (running.length === 1) return { version: running[0], label: versionLabel(running[0]), source: 'running process' };
    const installed = supportedVersions().filter(v => existsSync(versionSpec(v).appPath));
    if (installed.length === 1) return { version: installed[0], label: versionLabel(installed[0]), source: 'installed application' };
    if (running.length > 1) return { version: UNKNOWN, label: labelOf(UNKNOWN), source: 'running process (ambiguous)' };
  }
  return { version: UNKNOWN, label: labelOf(UNKNOWN), source: 'undetermined' };
}

// ---- 主检查 ----

function blocked(message, detail) {
  const error = new Error(`[版本拦截] ${message}`);
  error.versionBlocked = true;
  error.detail = detail;
  return error;
}

// 从 args 里挑出动作类型（add-interaction 的 --action <type>，以及 --json spec 里的 actions）。
function actionTypesOf(command, args, baseDir) {
  if (command !== 'add-interaction') return [];
  const types = [];
  for (let i = 0; i < args.length; i++) if (args[i] === '--action' && typeof args[i + 1] === 'string') types.push(args[i + 1]);
  const jsonAt = args.indexOf('--json');
  if (jsonAt >= 0 && typeof args[jsonAt + 1] === 'string') {
    const specPath = resolve(baseDir, args[jsonAt + 1]);
    if (existsSync(specPath)) {
      try {
        const spec = JSON.parse(readFileSync(specPath, 'utf8'));
        for (const interaction of spec.interactions ?? []) for (const action of interaction.actions ?? []) if (action?.type) types.push(action.type);
      } catch { /* JSON 交给脚本自己报错 */ }
    }
  }
  return types;
}

// entry: { command, args, baseDir? } → { version, label, status, files, warnings }
export function preflight({ command, args = [], baseDir = process.cwd() } = {}) {
  const entry = getCommand(command);
  const files = collectFiles(args, baseDir);
  const warnings = [];
  const projects = files.filter(file => file.kind === 'project' && file.exists);
  const libraries = files.filter(file => file.kind === 'library' && file.exists);

  // 目标版本：项目优先；只看项目。跨版本组合（源 RP9 + 目标 RP11 之类）一律拒绝。
  const versions = new Set(projects.map(file => file.version));
  if (versions.size > 1) {
    throw blocked(`同一次调用涉及多种版本的项目文件：${projects.map(f => `${f.path}=${f.label}`).join('、')}`, { files });
  }
  let version = versions.size === 1 ? [...versions][0] : UNKNOWN;
  const report = { version, label: labelOf(version), status: 'verified', files, warnings };

  // 逃生阀：文件本身读不出可支持版本时，允许用 AXURE_TARGET_VERSION 显式声明，但必须留下可见提示。
  if (version === UNKNOWN) {
    const declared = process.env.AXURE_TARGET_VERSION;
    if (declared) {
      version = resolveTargetVersion(declared);
      report.version = version;
      report.label = versionLabel(version);
      report.declared = true;
      warnings.push(`项目文件版本无法从文件头判定，已按 AXURE_TARGET_VERSION=${declared} 处理；该声明不是文件证据。`);
    }
  }
  if (!projects.length && command !== 'axvg paste') return report;

  if (version === UNKNOWN) {
    // 无法判定版本时不做版本敏感写入：这是「不要把未知格式当 RP 11」的落地点。
    if (entry?.output !== 'none' || SAME_VERSION_REQUIRED.has(command)) {
      throw blocked('无法判定项目文件版本，拒绝版本敏感写入（先确认文件由 Axure RP 9 或 11 保存，或显式提供可识别的样本）', { files });
    }
  }

  if (command === 'axvg paste') {
    const target = detectTargetAppVersion();
    report.target = target;
    report.version = target.version;
    report.label = target.label;
    const allowRp9 = process.env.AXURE_ALLOW_RP9_PASTE === '1';
    if (target.version === RP9 && !allowRp9) {
      throw blocked(pasteBlockedMessage(target), { target });
    }
    if (target.version === UNKNOWN) {
      throw blocked(pasteBlockedMessage(target), { target });
    }
    report.status = target.version === RP9 ? 'unverified' : 'verified';
    if (target.version === RP9) {
      warnings.push('「axvg paste」在 Axure RP 9 上未经验证，且本机曾实测粘贴不生效（2026-10-20）：已按 AXURE_ALLOW_RP9_PASTE=1 放行，请自行确认画布结果。');
    }
    return report;
  }

  // 动作级拒绝：RP9 不认识的交互动作类。
  if (version === RP9) {
    for (const type of actionTypesOf(command, args, baseDir)) {
      if (RP9_BLOCKED_ACTIONS[type]) {
        throw blocked(`Axure RP 9 项目不支持交互动作「${type}」：${RP9_BLOCKED_ACTIONS[type]}`, { command, action: type, files });
      }
    }
  }

  const status = commandStatusFor(version, command);
  report.status = status;
  if (status === 'blocked') {
    throw blocked(`Axure RP 9 项目不支持命令「${command}」：${RP9_COMMAND_REASONS[command] ?? '该功能依赖 RP9 不具备的记录或类名'}`, { command, files });
  }
  if (status === 'unverified') {
    warnings.push(`「${command}」在 ${labelOf(version)} 上未经验证（证据等级 unverified）：结构检查通过不代表 RP9 能打开、预览或再次编辑，验收前不要当作可用。`);
  }

  // 素材同版本：只接受同版本 .rplib / 模板。
  if (version === RP9 || SAME_VERSION_REQUIRED.has(command)) {
    for (const library of libraries) {
      if (!library.exists) continue;
      if (library.version === UNKNOWN) {
        if (version === RP9) throw blocked(`无法判定素材 ${library.path} 的 Axure 版本，RP9 只接受同版本（RP9）素材`, { library });
        warnings.push(`无法判定素材 ${library.path} 的版本；未校验与目标文件的版本一致性。`);
      } else if (version !== UNKNOWN && library.version !== version) {
        throw blocked(`素材版本不符：${library.path} 是 ${library.label}，目标项目是 ${report.label}；只接受同版本素材`, { library, version });
      }
    }
  }
  return report;
}

function pasteBlockedMessage(target) {
  const where = target.source === 'undetermined' ? '（未检测到运行中的 Axure）' : `（依据 ${target.source}）`;
  return `axvg paste 在 Axure RP 9 上未经验证${where}：本机 2026-10-20 实测粘贴后画布无内容。确认可用前请改用离线写入命令；如需强试，设置 AXURE_ALLOW_RP9_PASTE=1。`;
}

// 直接脚本调用入口：脚本在 main guard 里调用它，保证绕过 CLI/MCP 也执行同一套检查。
// 返回 warnings（调用方打印到 stderr），被拒绝时抛错并以退出码 1 结束。
export function preflightCli(command, argv, { baseDir } = {}) {
  const report = preflight({ command, args: argv, baseDir });
  for (const warning of report.warnings) console.error(`[版本提示] ${warning}`);
  return report;
}

export { RP9, DEFAULT_VERSION };
