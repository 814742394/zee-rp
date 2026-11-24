import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../', import.meta.url));
const [destination, option, ...extra] = process.argv.slice(2);
if (!destination || (option && option !== '--replace') || extra.length) {
  throw new Error('Usage: node tools/install-agent-skill.mjs <client skills directory>/zee-rp [--replace]');
}

const target = resolve(destination);
if (basename(target) !== 'zee-rp') throw new Error('The destination directory must be named zee-rp');
const parent = dirname(target);
mkdirSync(parent, { recursive: true });
const physicalTarget = join(realpathSync(parent), basename(target));
const physicalRepo = realpathSync(repository);
if (physicalTarget === physicalRepo || physicalTarget.startsWith(physicalRepo + sep)) {
  throw new Error('Choose a client skill directory outside the repository');
}
const existing = lstatSync(target, { throwIfNoEntry: false });
if (existing && option !== '--replace') throw new Error('Skill already exists. Use --replace to back up and replace it.');

const staging = mkdtempSync(join(dirname(parent), '.zee-rp-skill-'));
let backup;
try {
  const incoming = join(staging, 'incoming');
  mkdirSync(incoming);
  for (const entry of ['SKILL.md', 'README.md', 'README.en.md', 'README.zh-CN.md', 'references', 'docs', 'examples', 'assets']) {
    const source = join(repository, entry);
    if (existsSync(source)) cpSync(source, join(incoming, entry), { recursive: true });
  }
  if (existing) {
    const backupPath = join(staging, 'zee-rp');
    renameSync(target, backupPath);
    backup = backupPath;
  }
  try {
    renameSync(incoming, target);
  } catch (error) {
    if (backup) {
      renameSync(backup, target);
      backup = undefined;
    }
    throw error;
  }
  console.log(`Installed zee-rp skill at ${target}`);
  if (backup) console.log(`Previous skill backed up at ${backup}`);
} finally {
  if (!backup) rmSync(staging, { recursive: true, force: true });
}
