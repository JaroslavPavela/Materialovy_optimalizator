import { offsetPolygons, unionPolygons } from '../geometry/clipper.ts';
import { contourToRing } from '../geometry/contour.ts';
import { orientRing, rectToPolygon, ringArea, simplifyRing } from '../geometry/polygon.ts';
import { rotatePolygon } from '../geometry/transform.ts';
import type { Polygon } from '../geometry/types.ts';
import type { Part, Sheet } from '../model.ts';
import { partContours } from '../placed.ts';

/** Tětivová odchylka aproximace oblouků pro výpočet (mm). */
export const NEST_ARC_TOL = 0.05;
/** Odchylka zjednodušení obrysu pro výpočet (mm). */
export const NEST_SIMPLIFY_TOL = 0.02;
/** Tolerance zaoblení rohů při offsetu (Clipper ArcTolerance, mm). */
export const NEST_OFFSET_ARC_TOL = 0.01;
/**
 * Rezerva na zaoblené rohy offsetu: Clipper zaokrouhluje počet kroků na
 * oblouk, tětiva se proto může odchýlit až ≈ 2,25 × ArcTolerance dovnitř.
 */
const OFFSET_MARGIN = 3 * NEST_OFFSET_ARC_TOL;

export interface ShapeOptions {
  readonly arcTol?: number;
  readonly simplifyTol?: number;
}

/**
 * Tvar dílu pro výpočet v lokálních souřadnicích: oblouky aproximované
 * tětivami, obrysy zjednodušené. Export dál používá původní geometrii.
 */
export function partPolygon(part: Part, opts: ShapeOptions = {}): Polygon {
  const arcTol = opts.arcTol ?? NEST_ARC_TOL;
  const simplifyTol = opts.simplifyTol ?? NEST_SIMPLIFY_TOL;
  const { outer, holes } = partContours(part);
  const ring = (c: (typeof holes)[number]) => simplifyRing(contourToRing(c, arcTol), simplifyTol);
  return {
    outer: orientRing(ring(outer), 'ccw'),
    holes: holes.map((h) => orientRing(ring(h), 'cw')),
  };
}

/** O kolik se díl nafoukne: s/2 + odchylky aproximace, zjednodušení a offsetu. */
export function inflationDelta(spacing: number, opts: ShapeOptions = {}): number {
  return (
    spacing / 2 +
    (opts.arcTol ?? NEST_ARC_TOL) +
    (opts.simplifyTol ?? NEST_SIMPLIFY_TOL) +
    OFFSET_MARGIN
  );
}

/**
 * Díl nafouknutý pro nesting: o rozestup/2 a navíc o odchylky aproximace
 * a zjednodušení – tětiva vypouklého oblouku i zjednodušení mohou obrys
 * zmenšit, nafouknutý tvar proto skutečný díl vždy obsahuje s rezervou ≥ s/2.
 * Otvory se zmenšují (případně zaniknou); výsledek je jeden polygon.
 */
export function inflatedPartPolygon(part: Part, spacing: number, opts: ShapeOptions = {}): Polygon {
  const arcTol = opts.arcTol ?? NEST_ARC_TOL;
  const simplifyTol = opts.simplifyTol ?? NEST_SIMPLIFY_TOL;
  const base = partPolygon(part, opts);
  const out = offsetPolygons([base], inflationDelta(spacing, { arcTol, simplifyTol }), NEST_OFFSET_ARC_TOL);
  // Nafouknutí souvislého tvaru je souvislé; pro jistotu vezmeme největší kus.
  return out.reduce((a, b) => (ringArea(b.outer) > ringArea(a.outer) ? b : a));
}

/**
 * Užitná plocha tabule pro nafouknuté díly: tabule zmenšená o okraj
 * a zvětšená o rozestup/2 (nafouknutý díl smí přesahovat okraj o s/2).
 */
export function usableArea(sheet: Sheet, spacing: number): Polygon {
  const d = sheet.margin - spacing / 2;
  return rectToPolygon({
    x: d,
    y: d,
    width: sheet.width - 2 * d,
    height: sheet.height - 2 * d,
  });
}

/**
 * Zakázané zóny nafouknuté o rozestup/2 (díl od nich drží celý rozestup),
 * s rezervou na zaoblené rohy offsetu.
 */
export function inflatedZones(sheet: Sheet, spacing: number): Polygon[] {
  if (sheet.forbiddenZones.length === 0) return [];
  const zones = sheet.forbiddenZones.map((z) => ({
    outer: orientRing(z.polygon, 'ccw'),
    holes: [],
  }));
  return spacing > 0
    ? offsetPolygons(zones, spacing / 2 + OFFSET_MARGIN, NEST_OFFSET_ARC_TOL)
    : unionPolygons(zones);
}

/** Cache nafouknutých a otočených tvarů podle (díl, rozestup, natočení). */
export class ShapeCache {
  private readonly base = new Map<string, Polygon>();
  private readonly rotated = new Map<string, Polygon>();
  private readonly spacing: number;
  private readonly opts: ShapeOptions;

  constructor(spacing: number, opts: ShapeOptions = {}) {
    this.spacing = spacing;
    this.opts = opts;
  }

  inflated(part: Part): Polygon {
    let p = this.base.get(part.id);
    if (!p) {
      p = inflatedPartPolygon(part, this.spacing, this.opts);
      this.base.set(part.id, p);
    }
    return p;
  }

  /** Nafouknutý díl otočený o `rotation`° kolem lokálního počátku. */
  at(part: Part, rotation: number): Polygon {
    const key = `${part.id}:${rotation}`;
    let p = this.rotated.get(key);
    if (!p) {
      p = rotatePolygon(this.inflated(part), rotation);
      this.rotated.set(key, p);
    }
    return p;
  }
}
