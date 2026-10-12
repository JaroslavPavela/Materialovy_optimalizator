import type { RotationMode } from '../core/model.ts';

/** Popisky režimů natočení v UI (shodné s hodnotami ve sloupci CSV). */
export const ROTATION_LABEL: Readonly<Record<RotationMode, string>> = {
  free: 'volně',
  ortho: '90°',
  flip: '180°',
  locked: 'žádná',
};
