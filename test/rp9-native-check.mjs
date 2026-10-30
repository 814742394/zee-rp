// RP9 原生验收：把文件交给 Axure RP 9 保存、关闭、重开，并核验保存后的文件仍是 RP9 格式。
// 与 rp9-core-check.mjs 的分工：那边只证明结构与差异，这里才证明「RP9 真的能打开并重存」。
//
// 前置条件（缺任何一项都算缺失前提，失败退出，不记为通过）：
//   · macOS + 已安装 /Applications/Axure RP 9.app
//   · AXURE_RP9_NATIVE_SOURCE 指向一个 RP9 .rp（推荐用 rp9-core-check 产出的交付文件）
//   · 终端/宿主进程被授予「辅助功能」与「自动化」权限（System Events 驱动菜单）
//   · swift 可用（/usr/bin/swift）
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobManager } from '../scripts/jobs.mjs';
import { detectEdition } from '../scripts/rp-version.mjs';
import { readRp } from '../scripts/rp-read.mjs';

const source = process.env.AXURE_RP9_NATIVE_SOURCE;
const app = '/Applications/Axure RP 9.app';
const problems = [];
if (process.platform !== 'darwin') problems.push('只在 macOS 上提供原生验收');
if (!existsSync(app)) problems.push(`未安装 ${app}`);
if (!source || !existsSync(source)) problems.push('AXURE_RP9_NATIVE_SOURCE 指向一个存在的 RP9 .rp');
if (!existsSync('/usr/bin/swift')) problems.push('缺少 /usr/bin/swift');

// 权限探测：把「缺权限」和「Axure 打不开文件」分开报告，否则验收结论会互相污染。
function osa(script) {
  const result = spawnSync('/usr/bin/osascript', ['-e', script], { encoding: 'utf8' });
  return { ok: result.status === 0, out: (result.stdout || '').trim(), err: (result.stderr || '').trim() };
}
if (!problems.length) {
  const appProbe = osa('tell application id "com.axure.AxureRP9" to get name');
  if (!appProbe.ok) problems.push(`无法与 Axure RP 9 通信（自动化权限）：${appProbe.err}`);
  const accessibility = osa('tell application "System Events" to get name of first process');
  if (!accessibility.ok) problems.push(`缺少 System Events 辅助功能权限（菜单保存/关闭需要）：${accessibility.err}`);
  const detected = detectEdition(readFileSync(source));
  if (detected.edition !== 'rp9') problems.push(`AXURE_RP9_NATIVE_SOURCE 是 ${detected.label}，不是 Axure RP 9 文件`);
}
if (problems.length) {
  console.error(`缺失前提（不计为通过）：\n - ${problems.join('\n - ')}`);
  console.error('授权位置：系统设置 → 隐私与安全性 → 辅助功能 / 自动化，给运行本工具的终端（或 WorkBuddy）勾选 Axure RP 9 与 System Events。');
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), 'zee-rp9-native-'));
const previousRoot = process.env.AXURE_WRITE_ROOT;
process.env.AXURE_WRITE_ROOT = work;
const manager = new JobManager();
const results = [];
const check = async (name, action) => {
  try { await action(); results.push({ name, passed: true }); console.log(`PASS  ${name}`); }
  catch (error) { results.push({ name, passed: false, detail: error.message }); console.log(`FAIL  ${name} — ${error.message}`); }
};
const before = readRp(readFileSync(source), { path: source });
try {
  let output = null;
  await check('Axure RP 9 打开 → 保存 → 关闭 → 重开（并核验启动的确是 RP9）', async () => {
    const job = await manager.startRoundtrip({ source, output: join(work, 'native.rp'), wait: true });
    assertJob(job);
    output = job.output;
  });
  await check('原生保存后文件仍是 Axure RP 9，且结构不回退', async () => {
    if (!output) throw new Error('前置步骤未产出文件');
    const bytes = readFileSync(output);
    const after = readRp(bytes, { path: output });
    const edition = detectEdition(bytes);
    if (edition.edition !== 'rp9') throw new Error(`保存后版本变成 ${edition.label}`);
    if (after.records.unparseable) throw new Error(`不可解析记录 ${after.records.unparseable}`);
    if (after.counts.problems > before.counts.problems) throw new Error(`结构问题从 ${before.counts.problems} 增加到 ${after.counts.problems}`);
    if (after.counts.pages !== before.counts.pages) throw new Error(`页面数从 ${before.counts.pages} 变成 ${after.counts.pages}`);
  });
} finally {
  await manager.close();
  if (previousRoot === undefined) delete process.env.AXURE_WRITE_ROOT; else process.env.AXURE_WRITE_ROOT = previousRoot;
  rmSync(work, { recursive: true, force: true });
}
function assertJob(job) {
  if (job.status !== 'completed') throw new Error(`job ${job.status}：${job.stderr.slice(-400)}`);
  const validation = job.validation ?? {};
  for (const key of ['structure', 'editionVerified', 'editionPreserved', 'guiSaved', 'closed', 'reopened'])
    if (validation[key] !== true) throw new Error(`未通过 ${key}（${JSON.stringify(validation)}）`);
}
const failed = results.filter(result => !result.passed).length;
console.log(JSON.stringify({ total: results.length, passed: results.length - failed, failed, source, edition: 'rp9', evidence: 'native Axure RP 9 open/save/close/reopen' }));
process.exitCode = failed ? 1 : 0;
