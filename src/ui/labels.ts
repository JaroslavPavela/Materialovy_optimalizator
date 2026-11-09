import type { ImportReport } from '../state/store.ts';
import type { RotationMode } from '../core/model.ts';

/** Popisky režimů natočení v UI (shodné s hodnotami ve sloupci CSV). */
export const ROTATION_LABEL: Readonly<Record<RotationMode, string>> = {
  free: 'volně',
  ortho: '90°',
  flip: '180°',
  locked: 'žádná',
};

/** Souhrn hlášení jednoho souboru: „načteno 3 dílů, 2 chyb, 1 varování." */
export function reportSummary(r: ImportReport): string {
  return (
    `${r.fileName}: načteno ${r.partCount} dílů` +
    (r.errors.length > 0 ? `, ${r.errors.length} chyb` : '') +
    (r.warnings.length > 0 ? `, ${r.warnings.length} varování` : '') +
    '.'
  );
}
