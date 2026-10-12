// PreToolUse (Edit|Write): chrání soubory, které Claude Code nesmí měnit.
import fs from 'node:fs';
import path from 'node:path';
import { readInput, projectDir, relToProject, denyTool } from './lib.mjs';

const input = readInput();
const root = projectDir(input);
const filePath = input?.tool_input?.file_path;
if (!filePath) process.exit(0);

const rel = relToProject(root, filePath);

if (rel === null) {
  denyTool(`Zápis mimo projekt není povolen (${filePath}). Pracuj jen uvnitř složky projektu.`);
}

const name = path.posix.basename(rel);

if (name === '.env' || name.startsWith('.env.')) {
  denyTool(`Soubor ${rel} je chráněný (tajné údaje).`);
}

if (rel === '.claude/settings.json' || rel.startsWith('.claude/hooks/')) {
  denyTool(
    `${rel} je chráněný – nastavení a hooky projektu mění jen uživatel. ` +
      'Pokud je změna nutná, zapiš návrh do sekce „Odchylky" v PLAN.md a pokračuj.',
  );
}

if (rel.startsWith('tests/fixtures/')) {
  const abs = path.resolve(root, rel);
  if (fs.existsSync(abs)) {
    denyTool(
      `Existující testovací vzorek ${rel} se nesmí měnit. Nové vzorky přidávat smíš. ` +
        'Neprocházející test oprav v kódu, ne úpravou vstupních dat.',
    );
  }
}

process.exit(0);
