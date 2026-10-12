// PreToolUse (Bash): blokuje nebezpečné nebo nevratné příkazy.
// Doplňuje pravidla "deny" v settings.json, která se dají obejít jinou formulací příkazu.
import path from 'node:path';
import { readInput, projectDir, relToProject, denyTool } from './lib.mjs';

const input = readInput();
const cmd = String(input?.tool_input?.command || '');
if (!cmd.trim()) process.exit(0);

const root = projectDir(input);
const cwd = path.resolve(input.cwd || root);

const rules = [
  [/\bsudo\b/, 'sudo není povoleno.'],
  [/\bgit\s+push\b[^\n;&|]*(\s--force\b|\s-f\b|\s--force-with-lease\b|\s\+\S)/, 'Vynucený push (force) není povolen.'],
  [/\bgit\s+push\b[^\n;&|]*\s--(delete|mirror)\b/, 'Mazání větví na GitHubu není povoleno.'],
  [/\bgit\s+reset\s+[^\n;&|]*--hard\b/, 'git reset --hard zahodí práci – není povoleno. Použij git revert nebo nový commit.'],
  [/\bgit\s+clean\b[^\n;&|]*\s-[a-zA-Z]*f/, 'git clean -f maže soubory – není povoleno.'],
  [/\bgit\s+checkout\s+(--\s+)?\.(\s|$)/, 'Zahození všech změn (git checkout .) není povoleno.'],
  [/\bgit\s+(remote\s+(set-url|remove|rm|add)|config\b)/, 'Změna konfigurace gitu a remote není povolena.'],
  [/\bgit\s+(rebase|filter-branch|filter-repo)\b/, 'Přepisování historie není povoleno.'],
  [/\bnpm\s+publish\b/, 'npm publish není povoleno.'],
  [/\b(curl|wget)\b[^\n]*\|\s*(sh|bash|zsh|node)\b/, 'Spouštění staženého skriptu není povoleno.'],
  [/\bchmod\s+-R\b/, 'Rekurzivní chmod není povolen.'],
];

for (const [re, msg] of rules) {
  if (re.test(cmd)) denyTool(`Příkaz zablokován: ${msg}`);
}

// Ochrana nastavení, hooků a existujících vzorků i před úpravou přes shell.
const mutating = /(>|\btee\b|\bsed\s+-i|\brm\b|\bmv\b|\bcp\b|\btruncate\b|\bperl\s+-i|\bchmod\b)/;
if (/\.claude\/(settings\.json|hooks)/.test(cmd) && mutating.test(cmd)) {
  denyTool('Nastavení a hooky projektu (.claude/settings.json, .claude/hooks/) mění jen uživatel.');
}
if (/tests\/fixtures/.test(cmd) && /(\bsed\s+-i|\brm\b|\bmv\b|\btruncate\b|\bperl\s+-i)/.test(cmd)) {
  denyTool('Existující testovací vzorky v tests/fixtures/ se nesmí měnit ani mazat.');
}

// rm: jen uvnitř projektu a nikdy samotný kořen.
for (const segment of cmd.split(/&&|\|\||;|\||\n/)) {
  const tokens = segment.trim().split(/\s+/);
  const i = tokens.indexOf('rm');
  if (i === -1) continue;
  const targets = tokens.slice(i + 1).filter((t) => t && !t.startsWith('-'));
  for (const t of targets) {
    const clean = t.replace(/^['"]|['"]$/g, '');
    if (clean.startsWith('~') || clean.includes('$') || clean === '*' || clean === '.' || clean === '..') {
      denyTool(`Příkaz zablokován: rm na „${clean}" není povoleno.`);
    }
    const rel = relToProject(root, path.resolve(cwd, clean));
    if (rel === null || rel === '' || rel === '.git' || rel.startsWith('.git/') || rel.startsWith('.claude')) {
      denyTool(`Příkaz zablokován: rm mimo projekt nebo na chráněnou cestu (${clean}).`);
    }
  }
}

process.exit(0);
