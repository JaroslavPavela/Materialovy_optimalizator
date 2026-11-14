import type { ImportReport } from '../state/store.ts';
import type { RotationMode } from '../core/model.ts';
import { plural } from './format.ts';

/** Popisky režimů natočení v UI (shodné s hodnotami ve sloupci CSV). */
export const ROTATION_LABEL: Readonly<Record<RotationMode, string>> = {
  free: 'volně',
  ortho: '90°',
  flip: '180°',
  locked: 'žádná',
};

/** Souhrn hlášení jednoho souboru: „načteny 3 díly, 2 chyby, 1 varování." */
export function reportSummary(r: ImportReport): string {
  const n = r.partCount;
  const e = r.errors.length;
  return (
    `${r.fileName}: ${plural(n, 'načten', 'načteny', 'načteno')} ${n} ${plural(n, 'díl', 'díly', 'dílů')}` +
    (e > 0 ? `, ${e} ${plural(e, 'chyba', 'chyby', 'chyb')}` : '') +
    (r.warnings.length > 0 ? `, ${r.warnings.length} varování` : '') +
    '.'
  );
}
