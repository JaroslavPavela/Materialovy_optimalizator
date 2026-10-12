// Stop: autopilot podle PLAN.md.
// 1) Když se od poslední kontroly změnil kód, spustí typecheck a testy – při chybě pošle Claude opravovat.
// 2) Když v PLAN.md zbývají neodškrtnuté kroky a není BLOKOVÁNO, pošle Claude pokračovat dalším krokem.
// 3) Pojistka: po MAX_BLOCKS zablokováních bez nového commitu nechá Claude skončit a upozorní uživatele.
//
// Ruční pauza autopilota: vytvoř soubor .claude/state/pause (smazáním se autopilot znovu zapne).
import fs from 'node:fs';
import path from 'node:path';
import { readInput, projectDir, run, block, notify, tail } from './lib.mjs';

const MAX_BLOCKS = 5;
const TITLE = 'Claude Code – Materiálový optimalizátor';

const input = readInput();
const root = projectDir(input);

if (input.permission_mode === 'plan') process.exit(0);

const planPath = path.join(root, 'PLAN.md');
if (!fs.existsSync(planPath)) process.exit(0);

const stateDir = path.join(root, '.claude', 'state');
if (fs.existsSync(path.join(stateDir, 'pause'))) process.exit(0);

const statePath = path.join(stateDir, 'autopilot.json');
let state = { head: '', blocks: 0, verifiedStamp: 0 };
try {
  state = { ...state, ...JSON.parse(fs.readFileSync(statePath, 'utf8')) };
} catch {
  /* první běh */
}
const save = () => {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
};

const plan = fs.readFileSync(planPath, 'utf8');

const blocked = plan.match(/^BLOKOVÁNO:\s*ano\b(.*)$/im);
if (blocked) {
  notify(TITLE, `Stavba zastavena: ${blocked[1].replace(/^[\s–-]+/, '') || 'viz PLAN.md'}`);
  process.exit(0);
}

// Pojistka proti zacyklení – počítá zablokování od posledního nového commitu.
const head = run('git', ['rev-parse', 'HEAD'], root, 10_000);
const headId = head.ok ? head.output.trim() : '';
if (headId !== state.head) {
  state.head = headId;
  state.blocks = 0;
}
if (state.blocks >= MAX_BLOCKS) {
  state.blocks = 0;
  save();
  notify(TITLE, `Claude Code se zastavil – ${MAX_BLOCKS}× za sebou bez nového commitu. Zkontroluj PLAN.md.`);
  process.exit(0);
}

// 1) Kontrola kódu, pokud se od poslední úspěšné kontroly něco změnilo.
function newestMtime(dir) {
  let newest = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestMtime(p));
    else newest = Math.max(newest, fs.statSync(p).mtimeMs);
  }
  return newest;
}

const pkgPath = path.join(root, 'package.json');
if (fs.existsSync(pkgPath) && fs.existsSync(path.join(root, 'node_modules'))) {
  let scripts = {};
  try {
    scripts = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).scripts || {};
  } catch {
    /* rozbitý package.json zachytí typecheck/test */
  }
  const stamp = Math.max(
    newestMtime(path.join(root, 'src')),
    newestMtime(path.join(root, 'tests')),
    fs.statSync(pkgPath).mtimeMs,
  );
  if (stamp > state.verifiedStamp) {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    for (const script of ['typecheck', 'test']) {
      if (!scripts[script]) continue;
      const r = run(npm, ['run', script, '--silent'], root, 540_000);
      if (!r.ok) {
        state.blocks += 1;
        save();
        block(
          `Kontrola „npm run ${script}" neprošla. Oprav chyby v kódu (ne úpravou testů nebo vzorků), ` +
            `pak pokračuj podle PLAN.md.\n\n${tail(r.output)}`,
        );
      }
    }
    state.verifiedStamp = stamp;
  }
}

// 2) Další krok plánu.
const next = plan.match(/^\s*- \[ \] (.+)$/m);
if (next) {
  state.blocks += 1;
  save();
  block(
    `Plán ještě není dokončený. Další neodškrtnutý krok v PLAN.md: „${next[1].trim()}". ` +
      'Pokračuj podle pracovního postupu v CLAUDE.md (dokonči krok, ověř, odškrtni, aktualizuj Stav, commit). ' +
      'Pokud krok nejde splnit, nastav v PLAN.md „BLOKOVÁNO: ano – důvod" a skonči.',
  );
}

save();
notify(TITLE, 'Plán je dokončený – všechny kroky v PLAN.md jsou odškrtnuté.');
process.exit(0);
