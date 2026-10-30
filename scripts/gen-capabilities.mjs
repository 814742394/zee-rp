import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { listCommands } from './registry.mjs';
import { assertWritable } from './engine.mjs';
import { generationCapabilities, commandCapability } from './capabilities.mjs';

export function generateCapabilities() {
  // LIB_SCRIPTS 未导出；用既有 dump 接口取数据，保持注册表逻辑和导出契约不变。
  const dump = spawnSync(process.execPath, [fileURLToPath(new URL('./registry.mjs', import.meta.url)), 'dump'], { encoding: 'utf8' });
  if (dump.status !== 0) throw new Error(dump.stderr || 'registry dump failed');
  const { libScripts } = JSON.parse(dump.stdout);
  const commands = listCommands();
  const esc = text => String(text).replaceAll('|', '\\|').replaceAll('\n', '<br>');
  const lines = [
    '# 命令注册表与离线回归', '',
    '> 本文件由 registry.mjs 自动生成，勿手编；改注册表后重跑 `node scripts/gen-capabilities.mjs -o <新文件.md>`。',
    '> 登记证据仅描述已有指定样本。实际能力边界以 [capabilities.md](capabilities.md) 和 [验证流程](verification.md) 为准。', '',
    '## 命令总览', '', '| 命令 | 脚本 | 用途 | 输出定位 | 证据层级 |', '| --- | --- | --- | --- | --- |'
  ];
  for (const c of commands) lines.push(`| ${esc(c.command)} | ${esc(c.script)} | ${esc(c.summary)} | ${esc(c.output)} | ${esc(c.evidence)} |`);
  lines.push('', '参数定位（原生 CLI 用法；统一入口使用同一参数顺序）：', '');
  for (const c of commands) lines.push(`- **${c.command}**：\`${c.usage}\``);
  lines.push('', '## 库脚本', '', '| 脚本 | 用途 | 证据层级 |', '| --- | --- | --- |');
  for (const l of libScripts) lines.push(`| ${esc(l.script)} | ${esc(l.summary)} | ${esc(l.evidence)} |`);
  lines.push('', '## 证据标签', '',
    '- `structure`：结构级登记，不能替代 Axure 加载或行为检查。',
    '- `loaded`：指定样本有加载记录。',
    '- `preview`：指定样本有预览记录；具体动作和参数范围见能力表。',
    '- `gui-roundtrip`：指定样本有原生保存、关闭、重开记录；不代表该命令全部组合已验证。',
    '- `channel-a`：Axvg 剪贴板静态路线的登记标签，build/selftest 是离线编码检查，paste 是原生粘贴入口；标签本身不证明任意元件或行为通过。',
    '- `internal`：内部库或研究工具，没有面向用户的能力承诺。', '',
    '## 目标版本能力', '',
    '本表只报告实现与已登记证据；生成文档不执行原生验收。', '',
    '| 目标 | 能力 | 支持方式 | 实现 | 结构 | 打开 | 预览 | 保存重开 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |'
  );
  for (const [version, features] of Object.entries(generationCapabilities))
    for (const [feature, capability] of Object.entries(features))
      lines.push(`| RP${version} | ${feature} | ${capability.support} | ${capability.implementation} | ${capability.evidence.structure} | ${capability.evidence.nativeOpen} | ${capability.evidence.preview} | ${capability.evidence.saveReopen} |`);
  lines.push('', '| 命令 | RP9 状态 | RP11 状态 |', '| --- | --- | --- |');
  for (const command of commands)
    lines.push(`| ${esc(command.command)} | ${commandCapability(9, command.command).status} | ${commandCapability(11, command.command).status} |`);
  lines.push('', '原生验收未完成时不得将 implemented 或 core 解释为宿主验证通过。', '');
  return lines.join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  if (process.argv.length !== 4 || process.argv[2] !== '-o') throw new Error('Usage: node scripts/gen-capabilities.mjs -o <new.md>');
  const output = process.argv[3];
  assertWritable(output);
  writeFileSync(output, generateCapabilities(), { flag: 'wx' });
  console.log(`已生成 ${output}`);
}
