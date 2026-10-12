// PostToolUse (Edit|Write): naformátuje změněný soubor Prettierem a opraví ESLintem.
// Zbylé chyby ESLintu vrátí Claudovi k opravě. Dokud nejsou nástroje nainstalované, nic nedělá.
import path from 'node:path';
import { readInput, projectDir, relToProject, run, localBin, block, tail } from './lib.mjs';

const input = readInput();
const root = projectDir(input);
const filePath = input?.tool_input?.file_path;
const rel = relToProject(root, filePath);
if (!rel) process.exit(0);

const skip = ['node_modules/', 'dist/', 'coverage/', '.claude/', 'tests/fixtures/', 'playwright-report/'];
if (skip.some((p) => rel.startsWith(p))) process.exit(0);

const ext = path.extname(rel).toLowerCase();
const prettierExt = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css', '.html', '.md', '.yml', '.yaml'];
const lintExt = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

const prettier = localBin(root, 'prettier');
if (prettier && prettierExt.includes(ext)) {
  run(prettier, ['--write', '--log-level', 'warn', rel], root, 30_000);
}

const eslint = localBin(root, 'eslint');
if (eslint && lintExt.includes(ext)) {
  const r = run(eslint, ['--fix', '--no-warn-ignored', rel], root, 45_000);
  if (!r.ok && r.status === 1) {
    block(`ESLint našel v ${rel} chyby, oprav je:\n${tail(r.output, 2500)}`);
  }
}

process.exit(0);
