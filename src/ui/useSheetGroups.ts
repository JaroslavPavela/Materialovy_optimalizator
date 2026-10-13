import { sheetGroups, type SheetGroup } from '../core/sheet-groups.ts';
import type { NestingResult } from '../core/model.ts';
import { useAppStore } from '../state/store.ts';

const cache = new WeakMap<NestingResult, { grouped: boolean; groups: SheetGroup[] }>();

/**
 * Skupiny tabulí aktuálního výsledku podle volby „seskupit stejné tabule"
 * a index skupiny, ve které je zobrazená tabule. Skupiny se pro jeden
 * výsledek počítají jen jednou (sdílí je náhled, souhrn i export).
 */
export function useSheetGroups(): { groups: SheetGroup[]; active: number } {
  const result = useAppStore((s) => s.result);
  const grouped = useAppStore((s) => s.groupSheets);
  const activeSheet = useAppStore((s) => s.activeSheet);
  if (!result) return { groups: [], active: 0 };
  let entry = cache.get(result);
  if (entry?.grouped !== grouped) {
    entry = { grouped, groups: sheetGroups(result, grouped) };
    cache.set(result, entry);
  }
  const { groups } = entry;
  const found = groups.findIndex((g) => g.indices.includes(activeSheet));
  return { groups, active: found >= 0 ? found : Math.max(0, groups.length - 1) };
}
