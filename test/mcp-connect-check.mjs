// Exercise the public stdio interface with the same calls an Agent makes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const entry = resolve(process.env.ZEE_MCP_ENTRY ?? join(root, 'bin', 'mcp.mjs'));
const serverRoot = dirname(dirname(entry));
const work = mkdtempSync(join(tmpdir(), 'zee-rp-mcp-connect-'));
const native = process.argv.includes('--native');
const versions = [9, 11];
const env = { ...process.env, AXURE_WRITE_ROOT: work };
delete env.AXURE_BLANK_TEMPLATE;
if (!native) {
  const invalid = join(work, 'invalid.rp');
  writeFileSync(invalid, 'This is not an Axure project.');
  for (const version of versions) env[`AXURE_BLANK_TEMPLATE_RP${version}`] = invalid;
}

const client = new Client({ name: 'zee-rp-connection-check', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entry],
  env,
  stderr: 'inherit',
});
async function call(name, args) {
  const reply = await client.callTool({ name, arguments: args }, undefined, { timeout: 120_000 });
  const value = reply.structuredContent ?? JSON.parse(reply.content[0].text);
  assert(!reply.isError && value.status !== 'failed', JSON.stringify(value));
  return value;
}
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const readProject = async path => JSON.parse((await call('rp_read', { args: [path, '--json'] })).stdout);

try {
  await client.connect(transport);
  assert.equal(client.getServerVersion().name, 'zee-rp');
  const { tools } = await client.listTools();
  for (const name of ['runtime_info', 'generate_prototype', 'rp_read', 'axure_open', 'edit_text', 'axure_save']) {
    assert(tools.some(tool => tool.name === name), `Missing MCP tool: ${name}`);
  }
  const runtime = await call('runtime_info', {});
  assert.deepEqual(runtime.host.nativeTargets, versions);
  assert.equal(runtime.host.capabilities[9].file.limits, null);
  assert(runtime.host.capabilities[11].file.limits.unsupportedPlanSections.includes('dynamicPanels'));
  assert(runtime.host.capabilities[11].file.limits.allowedActions.includes('set-text'));

  for (const targetVersion of versions) {
    const { template } = runtime.host.targets.find(target => target.targetVersion === targetVersion);
    assert.equal(template.status, native ? 'ready' : 'unavailable', JSON.stringify(template));
    if (!native) assert.match(template.message, /Axure/);
  }
  console.log('PASS MCP initialize, tools/list and RP9/RP11 template diagnostics');

  if (native) {
    const source = join(serverRoot, 'examples', 'rp-language', 'dual-target-basic.json');
    const sourceHash = hash(source);
    for (const targetVersion of versions) {
      const output = join(work, `original-rp${targetVersion}.rp`);
      const revised = join(work, `revised-rp${targetVersion}.rp`);
      const { targetVersion: generatedVersion } = await call('generate_prototype', { source, targetVersion, output });
      assert.equal(generatedVersion, targetVersion);
      const original = await readProject(output);
      assert.equal(original.version, targetVersion);
      assert(original.pages[0].widgets.some(widget => widget.text === 'Ready'));
      const before = hash(output);
      await call('axure_open', { path: output });
      const text = `Edited via MCP for RP${targetVersion}`;
      await call('edit_text', { target: { name: 'message', page: 'Home' }, text });
      await call('axure_save', { as: revised });
      const saved = await readProject(revised);
      assert.equal(saved.version, targetVersion);
      assert(saved.pages[0].widgets.some(widget => widget.text === text));
      assert.equal(hash(output), before);
      console.log(`PASS RP${targetVersion} generate, read, edit and save as over MCP`);
    }
    assert.equal(hash(source), sourceHash);
  }
} finally {
  await client.close();
  rmSync(work, { recursive: true, force: true });
}
