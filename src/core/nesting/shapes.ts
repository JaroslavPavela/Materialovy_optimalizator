import { offsetPolygons, unionPolygons } from '../geometry/clipper.ts';
import { bulgeToArc, contourBBox, contourToRing } from '../geometry/contour.ts';
import { orientRing, rectToPolygon, ringArea, simplifyRingWithError } from '../geometry/polygon.ts';
import { rotatePolygon } from '../geometry/transform.ts';
import type { Contour, Polygon } from '../geometry/types.ts';
import type { Part, Sheet } from '../model.ts';
import { partContours } from '../placed.ts';

/** Tětivová odchylka aproximace oblouků pro výpočet (mm). */
export const NEST_ARC_TOL = 0.05;
/** Nejvyšší povolená odchylka zjednodušení obrysu pro výpočet (mm). */
export const NEST_SIMPLIFY_TOL = 0.02;

export interface ShapeOptions {
  readonly arcTol?: number;
  readonly simplifyTol?: number;
}

/** Tvar pro výpočet a o kolik se může dovnitř odchýlit od skutečného dílu. */
export interface ApproxPolygon {
  readonly polygon: Polygon;
  /** Největší odchylka obrysu dovnitř (tětivy oblouků + zjednodušení), mm. */
  readonly error: number;
}

const hasArcs = (c: Contour) =>
  c.some((v, i) => bulgeToArc(v, c[(i + 1) % c.length]!, v.bulge) !== null);

/**
 * Tvar dílu pro výpočet v lokálních souřadnicích: oblouky aproximované
 * tětivami, obrysy zjednodušené. Export dál používá původní geometrii.
 */
export function approxPartPolygon(part: Part, opts: ShapeOptions = {}): ApproxPolygon {
  const arcTol = opts.arcTol ?? NEST_ARC_TOL;
  const simplifyTol = opts.simplifyTol ?? NEST_SIMPLIFY_TOL;
  const { outer, holes } = partContours(part);
  let error = 0;
  const ring = (c: Contour) => {
    const s = simplifyRingWithError(contourToRing(c, arcTol), simplifyTol);
    // Tětiva se od oblouku odchýlí nejvýš o arcTol; zjednodušení přidá svou chybu.
    error = Math.max(error, (hasArcs(c) ? arcTol : 0) + s.error);
    return s.ring;
  };
  const polygon = {
    outer: orientRing(ring(outer), 'ccw'),
    holes: holes.map((h) => orientRing(ring(h), 'cw')),
  };
  return { polygon, error };
}

export function partPolygon(part: Part, opts: ShapeOptions = {}): Polygon {
  return approxPartPolygon(part, opts).polygon;
}

/** O kolik se díl nafoukne: s/2 + odchylka aproximace dovnitř. */
export function inflationDelta(spacing: number, approxError = 0): number {
  return spacing / 2 + approxError;
}

/**
 * Díl nafouknutý pro nesting: o rozestup/2 a o odchylku aproximace (tětiva
 * vypouklého oblouku i zjednodušení mohou obrys zmenšit). Offset s ostrými
 * rohy (miter) přesné nafouknutí vždy obsahuje; obdélník bez oblouků se
 * nafoukne přesně na (w + s) × (h + s). Otvory se zmenšují, případně zaniknou.
 */
export function inflatedPartPolygon(part: Part, spacing: number, opts: ShapeOptions = {}): Polygon {
  const { polygon, error } = approxPartPolygon(part, opts);
  const delta = inflationDelta(spacing, error);
  const out = delta > 0 ? offsetPolygons([polygon], delta) : unionPolygons([polygon]);
  if (out.length > 0) {
    return out.reduce((a, b) => (ringArea(b.outer) > ringArea(a.outer) ? b : a));
  }
  // Degenerovaný (mikroskopický) tvar: konzervativně jeho nafouknutý obalový obdélník.
  const bb = contourBBox(partContours(part).outer);
  return rectToPolygon({
    x: bb.x - delta,
    y: bb.y - delta,
    width: bb.width + 2 * delta,
    height: bb.height + 2 * delta,
  });
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
 * Zakázané zóny nafouknuté o rozestup/2 (díl od nich drží celý rozestup).
 * Nejdřív sjednocení (osmička nepřijde o lalok), pak offset s ostrými rohy.
 */
export function inflatedZones(sheet: Sheet, spacing: number): Polygon[] {
  if (sheet.forbiddenZones.length === 0) return [];
  const zones = unionPolygons(
    sheet.forbiddenZones.map((z) => ({ outer: orientRing(z.polygon, 'ccw'), holes: [] })),
  );
  return spacing > 0 ? offsetPolygons(zones, spacing / 2) : zones;
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
