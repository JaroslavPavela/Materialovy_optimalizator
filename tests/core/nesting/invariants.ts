import {
  differencePolygons,
  intersectPolygons,
  offsetPolygons,
  polygonsArea,
} from '../../../src/core/geometry/clipper.ts';
import { EPS } from '../../../src/core/geometry/eps.ts';
import { polygonBBox, rectToPolygon, ringBBox } from '../../../src/core/geometry/polygon.ts';
import { placePolygon } from '../../../src/core/geometry/transform.ts';
import type { Polygon, Rect } from '../../../src/core/geometry/types.ts';
import { partPolygon } from '../../../src/core/nesting/shapes.ts';
import {
  allowedRotations,
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

/** Skutečný tvar umístěného dílu (oblouky s odchylkou 0,001 mm), na tabuli. */
function placedShape(input: NestingInput, p: Placement) {
  const part = input.parts.find((x) => x.id === p.partId)!;
  const local = partPolygon(part, { arcTol: 0.001, simplifyTol: 0 });
  return placePolygon(local, p.rotation, p.x, p.y);
}

/** Tolerance plochy průniku – dotyk má plochu ≈ 0, vniknutí do hloubky d ≈ d². */
const AREA_TOL = 1e-6;

/**
 * Invarianty tvarového nestingu (nezávisle na NFP, přes Clipper):
 * 1. skutečné tvary nafouknuté o (s − EPS)/2 se nepřekrývají (rozestup ≥ s − EPS),
 * 2. tvar leží v tabuli zmenšené o okraj,
 * 3. tvar nafouknutý o s − EPS neprotíná zakázanou zónu,
 * 4. každý kus umístěn právě jednou, nebo nahlášen jako neumístěný,
 * 5. natočení povolené, sklad a materiál dodrženy.
 */
export function shapeInvariantViolations(
  input: NestingInput,
  result: { layouts: readonly SheetLayout[]; unplaced: readonly UnplacedPart[] },
): string[] {
  const v: string[] = [];
  const s = input.params.spacing;
  const seen = new Map<string, number>();
  const used = new Map<string, number>();
  // Offset i záporný (s = 0: tvary se zmenší o EPS/2, dotyk do hloubky EPS projde).
  // Přesné nafouknutí = zaoblené rohy (ostré by u špiček sahaly až o 2·d dál
  // a hlásily falešná porušení); tětivy s odchylkou ≤ 2,25·10⁻⁴ mm.
  const grow = (p: Polygon, d: number) => (d !== 0 ? offsetPolygons([p], d, 'round', 1e-4) : [p]);

  result.layouts.forEach((layout, li) => {
    const sheet = input.sheets.find((x) => x.id === layout.sheetId)!;
    used.set(sheet.id, (used.get(sheet.id) ?? 0) + 1);
    const inner = rectToPolygon({
      // Přesah do EPS je v toleranci.
      x: sheet.margin - EPS,
      y: sheet.margin - EPS,
      width: sheet.width - 2 * sheet.margin + 2 * EPS,
      height: sheet.height - 2 * sheet.margin + 2 * EPS,
    });
    const shapes = layout.placements.map((p) => {
      const part = input.parts.find((x) => x.id === p.partId)!;
      const k = `${p.partId}#${p.instance}`;
      seen.set(k, (seen.get(k) ?? 0) + 1);
      if (
        !allowedRotations(part.rotation, input.params.freeRotationStep).some(
          (r) => Math.abs(r - p.rotation) <= 1e-9,
        )
      ) {
        v.push(`tabule ${li}: ${k} má nepovolené natočení ${p.rotation}`);
      }
      if (!sheetMatchesPart(part, sheet)) v.push(`tabule ${li}: ${k} na tabuli jiného materiálu`);
      const shape = placedShape(input, p);
      const out = polygonsArea(differencePolygons([shape], [inner]));
      if (out > AREA_TOL) v.push(`tabule ${li}: ${k} přesahuje užitnou plochu o ${out} mm²`);
      for (const z of sheet.forbiddenZones) {
        const hit = polygonsArea(
          intersectPolygons(grow(shape, s - EPS), [{ outer: z.polygon, holes: [] }]),
        );
        if (hit > AREA_TOL) v.push(`tabule ${li}: ${k} zasahuje do zóny ${z.id} (${hit} mm²)`);
      }
      const grown = grow(shape, (s - EPS) / 2);
      return { k, grown, bbox: polygonBBox(grown[0] ?? shape) };
    });
    for (let i = 0; i < shapes.length; i++) {
      for (let j = i + 1; j < shapes.length; j++) {
        const a = shapes[i]!;
        const b = shapes[j]!;
        if (
          a.bbox.x > b.bbox.x + b.bbox.width ||
          b.bbox.x > a.bbox.x + a.bbox.width ||
          a.bbox.y > b.bbox.y + b.bbox.height ||
          b.bbox.y > a.bbox.y + a.bbox.height
        ) {
          continue;
        }
        const both = polygonsArea(intersectPolygons(a.grown, b.grown));
        if (both > AREA_TOL)
          v.push(`tabule ${li}: ${a.k} a ${b.k} jsou blíž než rozestup (${both} mm²)`);
      }
    }
  });
  for (const u of result.unplaced) {
    const k = `${u.partId}#${u.instance}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  for (const part of input.parts) {
    for (let i = 0; i < part.quantity; i++) {
      const n = seen.get(`${part.id}#${i}`) ?? 0;
      if (n !== 1) v.push(`kus ${part.id}#${i} je ve výsledku ${n}×`);
    }
  }
  if ([...seen.values()].reduce((a, b) => a + b, 0) !== totalInstances(input.parts)) {
    v.push('výsledek obsahuje neznámé kusy');
  }
  for (const sheet of input.sheets) {
    const n = used.get(sheet.id) ?? 0;
    if (sheet.stock !== null && n > sheet.stock)
      v.push(`formát ${sheet.id}: ${n} tabulí > sklad ${sheet.stock}`);
  }
  return v;
}
