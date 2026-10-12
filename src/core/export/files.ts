import { strToU8, zipSync } from 'fflate';

/** Exportovaný textový soubor. */
export interface ExportFile {
  readonly name: string;
  readonly content: string;
}

/** Název projektu použitelný v názvu souboru (bez diakritiky a mezer). */
export function safeFileStem(project: string): string {
  return (
    project
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'plan'
  );
}

/** `<projekt>-tabule-01.<ext>`; číslo doplněné nulami podle počtu tabulí. */
export function sheetFileName(project: string, index: number, count: number, ext: string): string {
  const digits = Math.max(2, String(count).length);
  return `${safeFileStem(project)}-tabule-${String(index + 1).padStart(digits, '0')}.${ext}`;
}

/** Soubory zabalené do ZIP (fflate). */
export function zipFiles(files: readonly ExportFile[], mtime?: Date): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) entries[f.name] = strToU8(f.content);
  return zipSync(entries, { level: 6, ...(mtime && { mtime }) });
}
