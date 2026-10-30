// 结构指纹：给任意 .rp / .rplib 打一份可比较的「格式画像」，用于 RP9 与 RP11 样本对比和回归留证。
// 只输出结构与类名统计，不输出文档正文——样本文件不随代码分发，报告里也不带原生文本。
//
// 用法: node rp-fingerprint.mjs <file.rp|file.rplib> [...]
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRecords, readManifest } from './rp-records.mjs';
import { parsePayload } from './parse-payload.mjs';
import { tryDetectFileVersion, versionLabel } from './version.mjs';

const histogram = items => Object.fromEntries([...items.entries()].sort(([a], [b]) => a.localeCompare(b, 'en')));

export function fingerprint(file, path = '(buffer)') {
  const version = tryDetectFileVersion(file);
  let manifest = null;
  let records = [];
  const problems = [];
  try {
    records = readRecords(file);
    manifest = readManifest(file);
  } catch (error) {
    problems.push(`记录流：${error.message}`);
  }
  const recordClasses = new Map();
  const objectClasses = new Map();
  let objects = 0, unparseable = 0;
  for (const record of records) {
    recordClasses.set(record.className, (recordClasses.get(record.className) ?? 0) + 1);
    if (!record.strings) continue;
    try {
      const graph = parsePayload(record);
      for (const object of graph.objects.values()) {
        objects++;
        objectClasses.set(object.className, (objectClasses.get(object.className) ?? 0) + 1);
      }
    } catch { unparseable++; }
  }
  return {
    file: basename(path),
    bytes: file.length,
    container: {
      magic: file.subarray(0, 2).toString('hex'),
      hasManifest: manifest !== null,
      dataStart: manifest?.dataStart ?? null,
      manifestRoots: manifest ? Object.keys(manifest.value.root?.children ?? {}).length : null,
    },
    version,
    label: version === null ? '未知版本' : versionLabel(version),
    records: { total: records.length, unparseable, classes: histogram(recordClasses) },
    objects: { total: objects, classes: histogram(objectClasses) },
    problems,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const paths = process.argv.slice(2);
  if (!paths.length) {
    console.error('Usage: node rp-fingerprint.mjs <file.rp|file.rplib> [...]');
    process.exit(1);
  }
  console.log(JSON.stringify(paths.map(path => fingerprint(readFileSync(resolve(path)), resolve(path))), null, 2));
}
