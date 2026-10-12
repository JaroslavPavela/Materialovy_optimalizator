import { contourBBox, contourOrientation } from './geometry/contour.ts';
import { rectsNear } from './geometry/compare.ts';
import { ANGLE_EPS, AREA_EPS, EPS } from './geometry/eps.ts';
import { ringArea } from './geometry/polygon.ts';
import type { Contour, Rect, Ring } from './geometry/types.ts';

/**
 * Povolená natočení dílu:
 * - `free` – libovolné, v praxi po kroku `NestingParams.freeRotationStep`,
 * - `ortho` – 0/90/180/270°,
 * - `flip` – 0/180° (směr povrchu, např. kartáčovaný plech),
 * - `locked` – jen 0°.
 */
export type RotationMode = 'free' | 'ortho' | 'flip' | 'locked';

/**
 * Skutečný tvar dílu v lokálních souřadnicích dílu. Obalový obdélník
 * (včetně oblouků) je přesně [0, width] × [0, height] dílu.
 */
export interface PartShape {
  /** Vnější obrys, CCW. */
  readonly outer: Contour;
  /** Otvory, CW. */
  readonly holes: readonly Contour[];
}

/** Díl k vyrobení. */
export interface Part {
  readonly id: string;
  readonly name: string;
  /** Šířka obalového obdélníku v mm (osa X, natočení 0°). U tvaru z DXF odvozena z tvaru. */
  readonly width: number;
  /** Výška obalového obdélníku v mm (osa Y, natočení 0°). */
  readonly height: number;
  /** Počet kusů, celé číslo ≥ 1. */
  readonly quantity: number;
  readonly rotation: RotationMode;
  /** Materiál; chybí-li, díl jde na tabuli z libovolného materiálu (viz `sheetMatchesPart`). */
  readonly material?: string;
  /** Tloušťka v mm; chybí-li, libovolná. */
  readonly thickness?: number;
  /** Tvar z DXF; chybí-li, díl je obdélník `width × height`. */
  readonly shape?: PartShape;
}

/**
 * Oblast tabule, kam nesmí zasahovat žádný díl (např. upínky lisu).
 * Při výpočtu se nafoukne o rozestup/2 jako díl, takže skutečný díl
 * drží od zóny celý rozestup.
 */
export interface ForbiddenZone {
  readonly id: string;
  /**
   * Obrys v souřadnicích tabule (počátek v levém dolním rohu celé tabule).
   * Orientace libovolná – jádro si ji normalizuje.
   */
  readonly polygon: Ring;
}

/** Formát tabule (deska, plech) ve skladu. */
export interface Sheet {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /** Počet kusů skladem; `null` = neomezeno. */
  readonly stock: number | null;
  /** Nevyužitelný pruh po obvodu v mm. */
  readonly margin: number;
  readonly forbiddenZones: readonly ForbiddenZone[];
  readonly material?: string;
  readonly thickness?: number;
  /** Zbytek z dřívějšího výpočtu – použít přednostně. */
  readonly remnant?: boolean;
}

/** Režim nestingu: přes obalový obdélník (MaxRects), nebo tvarový (NFP). */
export type NestingMode = 'rect' | 'shape';

export interface NestingParams {
  /** Rozestup dílů v mm (průměr nástroje + rezerva). Díl se nafoukne o polovinu. */
  readonly spacing: number;
  readonly mode: NestingMode;
  /** Krok natočení pro `free` ve stupních, MIN_ROTATION_STEP ≤ krok ≤ 360. */
  readonly freeRotationStep: number;
  /** Časový limit optimalizátoru v ms. */
  readonly timeLimitMs: number;
  /** Semínko generátoru náhodných čísel – výpočet je pro stejné semínko deterministický. */
  readonly seed: number;
}

/** Nejmenší krok natočení – omezuje počet natočení (a velikost cache NFP) na 360. */
export const MIN_ROTATION_STEP = 1;

export const DEFAULT_NESTING_PARAMS: NestingParams = {
  spacing: 6,
  mode: 'rect',
  freeRotationStep: 90,
  timeLimitMs: 30_000,
  seed: 1,
};

export interface NestingInput {
  readonly parts: readonly Part[];
  readonly sheets: readonly Sheet[];
  readonly params: NestingParams;
}

/**
 * Umístění jedné instance dílu: bod dílu `p` v lokálních souřadnicích
 * (obalový obdélník při 0° je [0, width] × [0, height]) přejde do bodu
 * tabule `p' = R(rotation)·p + (x, y)` – otočení CCW kolem lokálního počátku,
 * pak posun. Nezávisí na tom, ze které geometrie (oblouky, aproximace,
 * nafouknutí) by se počítal obalový obdélník.
 *
 * Příklad: obdélník 100 × 40 otočený o 90° zabírá lokálně [−40, 0] × [0, 100];
 * aby jeho levý dolní roh byl v (10, 20), je (x, y) = (50, 20).
 * Viz `translationForCorner` v geometry/transform.ts.
 */
export interface Placement {
  readonly partId: string;
  /** Pořadí kusu dílu, 0 … quantity − 1. */
  readonly instance: number;
  readonly x: number;
  readonly y: number;
  /** Natočení ve stupních, v intervalu [0, 360). */
  readonly rotation: number;
}

/** Jedna použitá tabule ve výsledku. */
export interface SheetLayout {
  readonly sheetId: string;
  readonly placements: readonly Placement[];
}

/**
 * Proč instance dílu nebyla umístěna:
 * - `no-matching-sheet` – žádná tabule neodpovídá materiálem a tloušťkou,
 * - `too-large` – díl je větší než užitná plocha všech vhodných tabulí,
 * - `blocked` – rozměrově by se vešel, ale brání mu zakázané zóny,
 * - `out-of-sheets` – vhodné tabule došly (vyčerpaný sklad).
 */
export type UnplacedReason = 'no-matching-sheet' | 'too-large' | 'blocked' | 'out-of-sheets';

export const UNPLACED_REASON_LABEL: Readonly<Record<UnplacedReason, string>> = {
  'no-matching-sheet': 'žádná tabule z daného materiálu',
  'too-large': 'větší než tabule',
  blocked: 'nevejde se kvůli zakázaným zónám',
  'out-of-sheets': 'došly tabule',
};

export interface UnplacedPart {
  readonly partId: string;
  readonly instance: number;
  readonly reason: UnplacedReason;
}

export interface SheetMetrics {
  /** Plocha dílů na tabuli (s odečtenými otvory) v mm². */
  readonly partArea: number;
  /** Plocha tabule v mm². */
  readonly sheetArea: number;
  /** Využití 0–1 = partArea / sheetArea. */
  readonly utilization: number;
  /**
   * Největší volný osově rovnoběžný obdélník (zbytek) v souřadnicích tabule,
   * uvnitř užitné plochy, mimo nafouknuté díly a zakázané zóny; nebo `null`.
   */
  readonly remnant: Rect | null;
}

export interface NestingMetrics {
  /** Metriky po tabulích ve stejném pořadí jako `NestingResult.layouts`. */
  readonly sheets: readonly SheetMetrics[];
  /** Celkové využití 0–1 = Σ plocha dílů / Σ plocha použitých tabulí; 0 bez tabulí. */
  readonly utilization: number;
  /** Odpad 0–1 = 1 − využití. */
  readonly waste: number;
  readonly placedCount: number;
  readonly unplacedCount: number;
}

export interface NestingResult {
  readonly layouts: readonly SheetLayout[];
  readonly unplaced: readonly UnplacedPart[];
  readonly metrics: NestingMetrics;
}

/** Úhel ve stupních převedený do intervalu [0, 360). Pro NaN/±∞ vyhodí `RangeError`. */
export function normalizeRotation(deg: number): number {
  if (!Number.isFinite(deg)) throw new RangeError(`Neplatný úhel natočení: ${deg}.`);
  const r = ((deg % 360) + 360) % 360;
  return r >= 360 - ANGLE_EPS ? 0 : r;
}

export function isValidRotationStep(step: number): boolean {
  return step >= MIN_ROTATION_STEP && step <= 360;
}

/**
 * Natočení povolená pro tvarový režim, ve stupních vzestupně.
 * Pro `free` násobky `freeStep` menší než 360°.
 */
export function allowedRotations(mode: RotationMode, freeStep: number): number[] {
  switch (mode) {
    case 'locked':
      return [0];
    case 'flip':
      return [0, 180];
    case 'ortho':
      return [0, 90, 180, 270];
    case 'free': {
      if (!isValidRotationStep(freeStep)) {
        throw new RangeError(
          `Krok natočení musí být v intervalu [${MIN_ROTATION_STEP}, 360] °, je ${freeStep}.`,
        );
      }
      const result: number[] = [];
      for (let k = 0; k * freeStep < 360 - ANGLE_EPS; k++) result.push(k * freeStep);
      return result;
    }
  }
}

/**
 * Natočení pro obdélníkový režim: obalový obdélník se může jen otočit o 90°.
 * `flip` a `locked` znamenají „bez otočení o 90°".
 */
export function rectRotations(mode: RotationMode): number[] {
  return mode === 'free' || mode === 'ortho' ? [0, 90] : [0];
}

/** Je natočení `deg` pro díl s režimem `mode` povolené (v tvarovém režimu)? */
export function isRotationAllowed(mode: RotationMode, deg: number, freeStep: number): boolean {
  const r = normalizeRotation(deg);
  return allowedRotations(mode, freeStep).some(
    (a) => Math.abs(a - r) <= ANGLE_EPS || Math.abs(a - r) >= 360 - ANGLE_EPS,
  );
}

/**
 * Smí díl na tabuli? Materiál a tloušťka se porovnávají jen tehdy,
 * když jsou zadány u dílu i u tabule (chybějící = libovolný).
 * Materiál bez ohledu na velikost písmen a okrajové mezery.
 */
export function sheetMatchesPart(part: Part, sheet: Sheet): boolean {
  if (part.material !== undefined && sheet.material !== undefined) {
    if (part.material.trim().toLowerCase() !== sheet.material.trim().toLowerCase()) return false;
  }
  if (part.thickness !== undefined && sheet.thickness !== undefined) {
    if (Math.abs(part.thickness - sheet.thickness) > EPS) return false;
  }
  return true;
}

/** Celkový počet kusů všech dílů. */
export function totalInstances(parts: readonly Part[]): number {
  return parts.reduce((sum, p) => sum + p.quantity, 0);
}

/** Chyba vstupu pro nesting, `field` odkazuje na pole (např. `parts[2].width`). */
export interface InputIssue {
  readonly field: string;
  readonly message: string;
}

const isPositive = (v: number) => Number.isFinite(v) && v > 0;
const isNonNegative = (v: number) => Number.isFinite(v) && v >= 0;

/** Zkontroluje vstup nestingu. Vrací seznam chyb (česky); prázdný = vstup je v pořádku. */
export function validateNestingInput(input: NestingInput): InputIssue[] {
  const issues: InputIssue[] = [];
  const add = (field: string, message: string) => issues.push({ field, message });
  const { parts, sheets, params } = input;

  if (!isNonNegative(params.spacing)) add('params.spacing', 'Rozestup musí být nezáporné číslo.');
  if (!isValidRotationStep(params.freeRotationStep)) {
    add(
      'params.freeRotationStep',
      `Krok natočení musí být v intervalu ${MIN_ROTATION_STEP}–360 °.`,
    );
  }
  if (!isPositive(params.timeLimitMs)) add('params.timeLimitMs', 'Časový limit musí být kladný.');
  if (!Number.isInteger(params.seed)) add('params.seed', 'Semínko musí být celé číslo.');

  if (parts.length === 0) add('parts', 'Nejsou zadány žádné díly.');
  const partIds = new Set<string>();
  parts.forEach((p, i) => {
    const f = `parts[${i}]`;
    const label = p.name ? `Díl „${p.name}"` : `Díl ${i + 1}`;
    if (partIds.has(p.id)) add(`${f}.id`, `${label}: duplicitní ID „${p.id}".`);
    partIds.add(p.id);
    if (!isPositive(p.width)) add(`${f}.width`, `${label}: šířka musí být kladné číslo.`);
    if (!isPositive(p.height)) add(`${f}.height`, `${label}: výška musí být kladné číslo.`);
    if (!(Number.isInteger(p.quantity) && p.quantity >= 1)) {
      add(`${f}.quantity`, `${label}: počet musí být celé číslo ≥ 1.`);
    }
    if (p.thickness !== undefined && !isPositive(p.thickness)) {
      add(`${f}.thickness`, `${label}: tloušťka musí být kladné číslo.`);
    }
    if (p.shape) {
      for (const message of shapeIssues(p.shape, p.width, p.height)) {
        add(`${f}.shape`, `${label}: ${message}`);
      }
    }
  });

  if (sheets.length === 0) add('sheets', 'Není zadána žádná tabule.');
  const sheetIds = new Set<string>();
  sheets.forEach((s, i) => {
    const f = `sheets[${i}]`;
    const label = s.name ? `Tabule „${s.name}"` : `Tabule ${i + 1}`;
    if (sheetIds.has(s.id)) add(`${f}.id`, `${label}: duplicitní ID „${s.id}".`);
    sheetIds.add(s.id);
    if (!isPositive(s.width)) add(`${f}.width`, `${label}: šířka musí být kladné číslo.`);
    if (!isPositive(s.height)) add(`${f}.height`, `${label}: výška musí být kladné číslo.`);
    if (s.stock !== null && !(Number.isInteger(s.stock) && s.stock >= 0)) {
      add(`${f}.stock`, `${label}: počet skladem musí být celé číslo ≥ 0 nebo neomezeno.`);
    }
    if (!isNonNegative(s.margin)) {
      add(`${f}.margin`, `${label}: okraj musí být nezáporné číslo.`);
    } else if (isPositive(s.width) && isPositive(s.height)) {
      if (2 * s.margin >= Math.min(s.width, s.height) - EPS) {
        add(`${f}.margin`, `${label}: okraj nenechává žádnou užitnou plochu.`);
      }
    }
    s.forbiddenZones.forEach((z, j) => {
      const zf = `${f}.forbiddenZones[${j}]`;
      if (z.polygon.length < 3) {
        add(zf, `${label}: zakázaná zóna potřebuje aspoň 3 body.`);
      } else if (z.polygon.some((pt) => !Number.isFinite(pt.x) || !Number.isFinite(pt.y))) {
        add(zf, `${label}: zakázaná zóna má neplatné souřadnice.`);
      } else if (ringArea(z.polygon) <= AREA_EPS) {
        add(zf, `${label}: zakázaná zóna má nulovou plochu.`);
      }
    });
  });
  if (sheets.length > 0 && sheets.every((s) => s.stock === 0)) {
    add('sheets', 'Žádná tabule není skladem.');
  }

  return issues;
}

/** Problémy tvaru dílu (bez názvu dílu na začátku zprávy). */
function shapeIssues(shape: PartShape, width: number, height: number): string[] {
  const finite = (c: Contour) =>
    c.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.bulge));
  if (shape.outer.length < 2) return ['tvar nemá vnější obrys.'];
  if (!finite(shape.outer) || !shape.holes.every(finite)) {
    return ['tvar má neplatné souřadnice.'];
  }
  const issues: string[] = [];
  const outer = contourOrientation(shape.outer);
  if (outer === 'degenerate') return ['vnější obrys má nulovou plochu.'];
  if (outer !== 'ccw')
    issues.push('vnější obrys musí být orientován proti směru hodinových ručiček.');
  shape.holes.forEach((h, k) => {
    const o = h.length < 2 ? 'degenerate' : contourOrientation(h);
    if (o === 'degenerate') issues.push(`otvor ${k + 1} má nulovou plochu.`);
    else if (o !== 'cw')
      issues.push(`otvor ${k + 1} musí být orientován po směru hodinových ručiček.`);
  });
  if (isPositive(width) && isPositive(height)) {
    const bb = contourBBox(shape.outer);
    if (!rectsNear(bb, { x: 0, y: 0, width, height })) {
      issues.push('obalový obdélník tvaru neodpovídá rozměrům dílu.');
    }
  }
  return issues;
}
