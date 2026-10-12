// Společné funkce pro hooky Claude Code (Node, bez závislostí).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/** Načte JSON vstup hooku ze stdin. Při chybě vrátí prázdný objekt. */
export function readInput() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Kořen projektu: proměnná od Claude Code, jinak cwd z vstupu, jinak cwd procesu. */
export function projectDir(input = {}) {
  return path.resolve(process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());
}

/** Cesta relativně ke kořeni projektu s lomítky; null, pokud leží mimo projekt. */
export function relToProject(root, filePath) {
  if (!filePath) return null;
  const abs = path.resolve(root, filePath);
  const rel = path.relative(root, abs);
  if (rel === '' ) return '';
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

/** PreToolUse: zamítnutí s důvodem, který uvidí Claude. */
export function denyTool(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

/** Stop / PostToolUse: blokace s důvodem (Claude pokračuje / dostane zpětnou vazbu). */
export function block(reason) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  process.exit(0);
}

/** Spustí příkaz, vrátí { ok, output }. Na Windows přes shell kvůli .cmd shimům. */
export function run(cmd, args, cwd, timeoutMs = 300_000) {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    shell: process.platform === 'win32',
    env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
  });
  const output = `${r.stdout || ''}${r.stderr || ''}`;
  return { ok: r.status === 0 && !r.error, output, status: r.status };
}

/** Lokální binárka z node_modules/.bin, nebo null. */
export function localBin(root, name) {
  const base = path.join(root, 'node_modules', '.bin', name);
  const candidates = process.platform === 'win32' ? [`${base}.cmd`, base] : [base];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

/** Zkrátí dlouhý výstup na konec (tam bývají chyby). */
export function tail(text, max = 3000) {
  const t = (text || '').trim();
  return t.length > max ? `…\n${t.slice(-max)}` : t;
}

/** Systémové upozornění – Linux notify-send, Windows PowerShell, macOS osascript. Chyby ignoruje. */
export function notify(title, message) {
  try {
    if (process.platform === 'linux') {
      spawnSync('notify-send', ['-a', 'Claude Code', title, message], { timeout: 5000 });
    } else if (process.platform === 'win32') {
      const ps = `[void][System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms');` +
        `$n=New-Object System.Windows.Forms.NotifyIcon;$n.Icon=[System.Drawing.SystemIcons]::Information;` +
        `$n.Visible=$true;$n.ShowBalloonTip(8000,'${title.replace(/'/g, "''")}','${message.replace(/'/g, "''")}',` +
        `[System.Windows.Forms.ToolTipIcon]::Info);Start-Sleep -Seconds 8;$n.Dispose()`;
      spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], { timeout: 15000 });
    } else if (process.platform === 'darwin') {
      spawnSync('osascript', ['-e', `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`], { timeout: 5000 });
    }
  } catch {
    /* upozornění není kritické */
  }
}
