import { differencePolygons, polygonsArea, unionPolygons } from './geometry/clipper.ts';
import { contourBBox, contourOrientation, contourToRing } from './geometry/contour.ts';
import { rectsNear } from './geometry/compare.ts';
import { AREA_EPS, EPS } from './geometry/eps.ts';
import { ringSignedArea } from './geometry/polygon.ts';
import type { Contour, Ring } from './geometry/types.ts';
import {
  isValidRotationStep,
  MIN_ROTATION_STEP,
  type InputIssue,
  type NestingInput,
  type PartShape,
} from './model.ts';

// Validace vstupu je samostatný modul: používá Clipper a nemá se tahat
// do hlavního balíku UI (model.ts načítá i UI).

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
  const instances = parts.reduce((n, p) => n + (Number.isFinite(p.quantity) ? p.quantity : 0), 0);
  if (instances > MAX_TOTAL_INSTANCES) {
    add(
      'parts',
      `Celkem ${instances} kusů – nejvýš ${MAX_TOTAL_INSTANCES.toLocaleString('cs-CZ')} v jednom výpočtu.`,
    );
  }
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
      } else if (filledArea(z.polygon) <= AREA_EPS) {
        // Plocha sjednocení: osmička se stejnými laloky má orientovanou plochu 0,
        // ale zabírá plochu (nesmí se hlásit jako nulová).
        add(zf, `${label}: zakázaná zóna má nulovou plochu.`);
      }
    });
  });
  if (sheets.length > 0 && sheets.every((s) => s.stock === 0)) {
    add('sheets', 'Žádná tabule není skladem.');
  }

  return issues;
}

/** Nejvíc kusů v jednom výpočtu (víc by vyčerpalo paměť a čas workeru). */
export const MAX_TOTAL_INSTANCES = 100_000;

const perimeter = (r: Ring) =>
  r.reduce(
    (s, p, i) => s + Math.hypot(r[(i + 1) % r.length]!.x - p.x, r[(i + 1) % r.length]!.y - p.y),
    0,
  );

/** Plocha, kterou obrys skutečně zabírá (sjednocení s pravidlem nonzero). */
const filledArea = (r: Ring) => polygonsArea(unionPolygons([{ outer: r, holes: [] }]));

/** Samoprůnik: zabraná plocha se liší od |orientované plochy| (v toleranci EPS × obvod). */
const selfIntersects = (r: Ring) =>
  Math.abs(filledArea(r) - Math.abs(ringSignedArea(r))) > EPS * perimeter(r);

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
    // Tvar z projektu JSON neprošel kontrolou importu DXF (krok 4.2):
    // samoprůniky obrysů a otvory mimo obrys se ověří přes plochy.
    const outerRing = contourToRing(shape.outer, 0.01);
    if (selfIntersects(outerRing)) issues.push('vnější obrys protíná sám sebe.');
    shape.holes.forEach((h, k) => {
      if (h.length < 2) return;
      const ring = contourToRing(h, 0.01);
      if (selfIntersects(ring)) {
        issues.push(`otvor ${k + 1} protíná sám sebe.`);
      } else if (
        polygonsArea(
          differencePolygons([{ outer: ring, holes: [] }], [{ outer: outerRing, holes: [] }]),
        ) >
        EPS * perimeter(ring)
      ) {
        issues.push(`otvor ${k + 1} leží mimo díl.`);
      }
    });
    shape.holes.forEach((h, k) => {
      if (h.length < 2) return;
      const hb = contourBBox(h);
      if (
        hb.x < -EPS ||
        hb.y < -EPS ||
        hb.x + hb.width > width + EPS ||
        hb.y + hb.height > height + EPS
      ) {
        issues.push(`otvor ${k + 1} leží mimo díl.`);
      }
    });
  }
  return [...new Set(issues)];
}
