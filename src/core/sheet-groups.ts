import { EPS } from './geometry/eps.ts';
import type { Rect } from './geometry/types.ts';
import { normalizeRotation, type NestingResult, type Placement } from './model.ts';

/**
 * Skupina tabulí výsledku se shodným rozmístěním. `indices` jsou indexy
 * v `NestingResult.layouts` vzestupně; první je zástupce skupiny (jeho
 * rozložení a metriky se zobrazují a exportují).
 */
export interface SheetGroup {
  readonly indices: readonly number[];
}

/** Každá tabule samostatně (výpis všech tabulí). */
export function singleSheetGroups(result: NestingResult): SheetGroup[] {
  return result.layouts.map((_, i) => ({ indices: [i] }));
}

interface Normalized {
  readonly partId: string;
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
}

const bucket = (v: number) => Math.round(v / EPS);

/**
 * Umístění bez čísla kusu, seřazená podle dílu, natočení a polohy
 * zaokrouhlené na EPS. Hodnoty blízko hranice zaokrouhlení mohou dát jiné
 * pořadí – shoda pak neprojde (konzervativně: tabule zůstanou oddělené).
 */
function normalize(placements: readonly Placement[]): Normalized[] {
  return placements
    .map((p) => ({ partId: p.partId, x: p.x, y: p.y, rotation: normalizeRotation(p.rotation) }))
    .sort(
      (a, b) =>
        (a.partId < b.partId ? -1 : a.partId > b.partId ? 1 : 0) ||
        bucket(a.rotation) - bucket(b.rotation) ||
        bucket(a.x) - bucket(b.x) ||
        bucket(a.y) - bucket(b.y),
    );
}

/** Rozdíl úhlů ve stupních s ohledem na přechod 360° → 0°. */
function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, 360 - d);
}

function samePlacements(a: readonly Normalized[], b: readonly Normalized[]): boolean {
  return (
    a.length === b.length &&
    a.every((p, i) => {
      const q = b[i]!;
      return (
        p.partId === q.partId &&
        Math.abs(p.x - q.x) <= EPS &&
        Math.abs(p.y - q.y) <= EPS &&
        angleDiff(p.rotation, q.rotation) <= EPS
      );
    })
  );
}

function sameRemnant(a: Rect | null, b: Rect | null): boolean {
  if (!a || !b) return a === b;
  return (
    Math.abs(a.x - b.x) <= EPS &&
    Math.abs(a.y - b.y) <= EPS &&
    Math.abs(a.width - b.width) <= EPS &&
    Math.abs(a.height - b.height) <= EPS
  );
}

/**
 * Seskupí tabule se shodným rozmístěním: stejný formát tabule, stejné díly
 * na stejných místech (v toleranci EPS) se stejným natočením a stejný zbytek –
 * export skupiny je tak totožný s exportem kterékoli její tabule. Na čísle
 * kusu nezáleží. Skupiny jsou v pořadí prvního výskytu.
 */
export function groupIdenticalSheets(result: NestingResult): SheetGroup[] {
  const groups: { indices: number[]; norm: Normalized[] }[] = [];
  // Kandidáti podle formátu a počtu dílů; plné porovnání jen uvnitř.
  const byKey = new Map<string, (typeof groups)[number][]>();
  result.layouts.forEach((layout, i) => {
    const key = `${layout.sheetId}\u0000${layout.placements.length}`;
    const norm = normalize(layout.placements);
    const remnant = result.metrics.sheets[i]?.remnant ?? null;
    const candidates = byKey.get(key) ?? [];
    const match = candidates.find(
      (g) =>
        samePlacements(g.norm, norm) &&
        sameRemnant(result.metrics.sheets[g.indices[0]!]?.remnant ?? null, remnant),
    );
    if (match) {
      match.indices.push(i);
      return;
    }
    const group = { indices: [i], norm };
    groups.push(group);
    candidates.push(group);
    byKey.set(key, candidates);
  });
  return groups.map((g) => ({ indices: g.indices }));
}

/** Skupiny podle volby: seskupené shodné tabule, nebo každá zvlášť. */
export function sheetGroups(result: NestingResult, grouped: boolean): SheetGroup[] {
  return grouped ? groupIdenticalSheets(result) : singleSheetGroups(result);
}

/**
 * Čísla tabulí (od 1) jako úseky: indexy [0, 1, 2, 4] → „1–3, 5".
 */
export function sheetNumbersText(indices: readonly number[]): string {
  const parts: string[] = [];
  let start = 0;
  for (let i = 1; i <= indices.length; i++) {
    if (i < indices.length && indices[i] === indices[i - 1]! + 1) continue;
    const a = indices[start]! + 1;
    const b = indices[i - 1]! + 1;
    parts.push(a === b ? String(a) : `${a}–${b}`);
    start = i;
  }
  return parts.join(', ');
}
