import { EPS } from '../../../src/core/geometry/eps.ts';
import { polygonBBox, rectToPolygon, ringBBox } from '../../../src/core/geometry/polygon.ts';
import { placePolygon } from '../../../src/core/geometry/transform.ts';
import type { Rect } from '../../../src/core/geometry/types.ts';
import {
  rectRotations,
  sheetMatchesPart,
  totalInstances,
  type NestingInput,
  type Part,
  type Placement,
  type Sheet,
  type SheetLayout,
  type UnplacedPart,
} from '../../../src/core/model.ts';

/**
 * Skutečný obalový obdélník umístěného dílu na tabuli – nezávisle na algoritmu,
 * přes obecnou transformaci p' = R·p + (x, y).
 */
export function placedRect(input: NestingInput, p: Placement): Rect {
  const part = input.parts.find((x) => x.id === p.partId);
  if (!part) throw new Error(`neznámý díl ${p.partId}`);
  const local = rectToPolygon({ x: 0, y: 0, width: part.width, height: part.height });
  return polygonBBox(placePolygon(local, p.rotation, p.x, p.y));
}

/** Mezera mezi obdélníky: ≥ 0, když se nepřekrývají (max. mezer v osách). */
function gap(a: Rect, b: Rect): number {
  const gx = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width));
  const gy = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height));
  return Math.max(gx, gy);
}

/**
 * Ověří invarianty výsledku obdélníkového nestingu a vrátí seznam porušení
 * (prázdný = v pořádku):
 * 1. žádný překryv, vzdálenost dílů ≥ rozestup − EPS,
 * 2. vše uvnitř tabule zmenšené o okraj,
 * 3. od zakázaných zón (jejich obalových obdélníků) ≥ rozestup − EPS,
 * 4. každý kus umístěn právě jednou, nebo nahlášen jako neumístěný,
 * 5. natočení povolené pro obdélníkový režim,
 * 6. počet tabulí formátu ≤ sklad, díl na tabuli z odpovídajícího materiálu,
 * 7. důvody neumístění odpovídají vstupu (viz `reasonViolations`).
 */
export function rectInvariantViolations(
  input: NestingInput,
  result: { layouts: readonly SheetLayout[]; unplaced: readonly UnplacedPart[] },
): string[] {
  const v: string[] = [];
  const s = input.params.spacing;
  const seen = new Map<string, number>();
  const mark = (partId: string, instance: number) => {
    const k = `${partId}#${instance}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  };
  const usedSheets = new Map<string, number>();

  result.layouts.forEach((layout, li) => {
    const sheet = input.sheets.find((x) => x.id === layout.sheetId);
    if (!sheet) {
      v.push(`tabule ${li}: neznámý formát ${layout.sheetId}`);
      return;
    }
    usedSheets.set(sheet.id, (usedSheets.get(sheet.id) ?? 0) + 1);
    if (layout.placements.length === 0) v.push(`tabule ${li}: prázdná tabule`);
    const unknown = layout.placements.filter((p) => !input.parts.some((x) => x.id === p.partId));
    if (unknown.length > 0) {
      v.push(`tabule ${li}: neznámé díly ${unknown.map((p) => p.partId).join(', ')}`);
      return;
    }
    const rects = layout.placements.map((p) => placedRect(input, p));
    layout.placements.forEach((p, i) => {
      mark(p.partId, p.instance);
      const part = input.parts.find((x) => x.id === p.partId)!;
      const r = rects[i]!;
      const label = `tabule ${li}, ${p.partId}#${p.instance}`;
      if (!rectRotations(part.rotation).some((a) => Math.abs(a - p.rotation) < 1e-9)) {
        v.push(`${label}: nepovolené natočení ${p.rotation}°`);
      }
      if (!sheetMatchesPart(part, sheet)) v.push(`${label}: nevhodný materiál tabule`);
      const m = sheet.margin;
      if (
        r.x < m - EPS ||
        r.y < m - EPS ||
        r.x + r.width > sheet.width - m + EPS ||
        r.y + r.height > sheet.height - m + EPS
      ) {
        v.push(`${label}: mimo užitnou plochu ${JSON.stringify(r)}`);
      }
      for (const z of sheet.forbiddenZones) {
        if (gap(r, ringBBox(z.polygon)) < s - EPS) v.push(`${label}: blízko zóny ${z.id}`);
      }
      for (let j = 0; j < i; j++) {
        const g = gap(r, rects[j]!);
        if (g < s - EPS) {
          const q = layout.placements[j]!;
          v.push(`${label}: mezera ${g} k ${q.partId}#${q.instance} < rozestup ${s}`);
        }
      }
    });
  });

  for (const u of result.unplaced) mark(u.partId, u.instance);
  for (const part of input.parts) {
    for (let i = 0; i < part.quantity; i++) {
      const n = seen.get(`${part.id}#${i}`) ?? 0;
      if (n !== 1) v.push(`${part.id}#${i}: vyskytuje se ${n}×`);
    }
  }
  const total =
    result.layouts.reduce((a, l) => a + l.placements.length, 0) + result.unplaced.length;
  if (total !== totalInstances(input.parts))
    v.push(`počet kusů ${total} ≠ ${totalInstances(input.parts)}`);

  v.push(...reasonViolations(input, result.unplaced));

  for (const sheet of input.sheets) {
    const used = usedSheets.get(sheet.id) ?? 0;
    if (sheet.stock !== null && used > sheet.stock) {
      v.push(`formát ${sheet.id}: použito ${used} > sklad ${sheet.stock}`);
    }
  }
  return v;
}

/** Vejde se díl (nafouknutý o s) rozměrově do užitné plochy tabule v povolené orientaci? */
export function fitsUsable(part: Part, sheet: Sheet, spacing: number): boolean {
  const uw = sheet.width - 2 * sheet.margin + spacing;
  const uh = sheet.height - 2 * sheet.margin + spacing;
  const w = part.width + spacing;
  const h = part.height + spacing;
  const tol = EPS;
  return rectRotations(part.rotation).some((r) =>
    r === 0 ? w <= uw + tol && h <= uh + tol : h <= uw + tol && w <= uh + tol,
  );
}

/**
 * Nezávislá kontrola důvodů neumístění:
 * - `no-matching-sheet` ⇔ žádná tabule neodpovídá materiálem/tloušťkou,
 * - `too-large` ⇒ díl se rozměrově nevejde na žádnou vhodnou tabuli se skladem,
 * - `blocked` ⇒ rozměrově by se vešel na některou vhodnou tabuli se skladem,
 * - kus, který se vejde na vhodnou tabuli s neomezeným skladem a bez zón,
 *   nesmí zůstat neumístěný.
 */
export function reasonViolations(input: NestingInput, unplaced: readonly UnplacedPart[]): string[] {
  const v: string[] = [];
  const s = input.params.spacing;
  for (const u of unplaced) {
    const part = input.parts.find((x) => x.id === u.partId);
    if (!part) {
      v.push(`neumístěný neznámý díl ${u.partId}`);
      continue;
    }
    const label = `${u.partId}#${u.instance} (${u.reason})`;
    const matching = input.sheets.filter((sh) => sheetMatchesPart(part, sh));
    const available = matching.filter((sh) => sh.stock !== 0);
    if ((u.reason === 'no-matching-sheet') !== (matching.length === 0)) {
      v.push(`${label}: důvod neodpovídá materiálu tabulí`);
    }
    if (u.reason === 'too-large' && available.some((sh) => fitsUsable(part, sh, s))) {
      v.push(`${label}: na některou tabuli se rozměrově vejde`);
    }
    if (u.reason === 'blocked' && !available.some((sh) => fitsUsable(part, sh, s))) {
      v.push(`${label}: rozměrově se nevejde nikam – mělo být too-large`);
    }
    const easy = available.some(
      (sh) => sh.stock === null && sh.forbiddenZones.length === 0 && fitsUsable(part, sh, s),
    );
    if (easy) v.push(`${label}: vejde se na tabuli s neomezeným skladem bez zón`);
  }
  return v;
}
