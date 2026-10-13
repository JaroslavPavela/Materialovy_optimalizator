import { offsetPolygons, unionPolygons } from '../geometry/clipper.ts';
import { bulgeToArc, contourBBox, contourToRing } from '../geometry/contour.ts';
import { orientRing, rectToPolygon, ringArea, simplifyRingWithError } from '../geometry/polygon.ts';
import { rotatePolygon } from '../geometry/transform.ts';
import { EPS } from '../geometry/eps.ts';
import type { Contour, Polygon, Ring } from '../geometry/types.ts';
import { allowedRotations, type Part, type Sheet } from '../model.ts';
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

/** Tolerance zaoblení rohů u offsetu „round" (mm) a rezerva na ni. */
const ROUND_ARC_TOL = 0.05;
/** Clipper zaokrouhluje počet kroků oblouku: tětiva až ≈ 2,25 × tolerance dovnitř. */
const ROUND_MARGIN = 3 * ROUND_ARC_TOL;

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
export function inflatedPartPolygon(
  part: Part,
  spacing: number,
  opts: ShapeOptions = {},
  join: 'miter' | 'round' = 'miter',
): Polygon {
  const { polygon, error } = approxPartPolygon(part, opts);
  const delta = inflationDelta(spacing, error) + (join === 'round' ? ROUND_MARGIN : 0);
  const out =
    delta > 0 ? offsetPolygons([polygon], delta, join, ROUND_ARC_TOL) : unionPolygons([polygon]);
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

/** Nejvýš tolik vrcholů vnějšího obrysu pro NFP (Minkowski je kvadratický). */
export const MAX_NEST_VERTICES = 64;
/** Největší tolerance zjednodušení obrysu kvůli počtu vrcholů (mm). */
const MAX_SIMPLIFY = 0.2;

/** Zmenšení o EPS/2 pro ověření kandidátů placeru (zaoblené rohy = přesně). */
export function shrinkForCheck(polys: readonly Polygon[]): Polygon[] {
  return offsetPolygons(polys, -EPS / 2, 'round', EPS / 8);
}

/** Je obrys konvexní (žádný vrchol se neotáčí proti orientaci obrysu)? */
function isConvexRing(ring: Ring): boolean {
  const n = ring.length;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    const c = ring[(i + 2) % n]!;
    const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cr) <= 1e-12) continue;
    if (sign === 0) sign = Math.sign(cr);
    else if (Math.sign(cr) !== sign) return false;
  }
  return true;
}

/**
 * Omezí počet vrcholů vnějšího obrysu konzervativně: zjednoduší ho
 * (Ramer–Douglas–Peucker) s rostoucí tolerancí a nafoukne o skutečnou
 * odchylku s ostrými rohy – každý bod původní hranice leží do této
 * odchylky od zjednodušené, takže výsledek původní tvar vždy obsahuje.
 * Konvexní obrys se nemění (Minkowského součet je jeden kus bez ohledu na
 * počet vrcholů). Když limitu nedosáhne ani MAX_SIMPLIFY, použije se
 * zjednodušení jen tehdy, ubere-li aspoň čtvrtinu vrcholů (dlouhé oblouky
 * tvaru C: 311 → 184 vrcholů, placer 4× rychleji) – jinak by jen zvětšilo
 * rozestup.
 */
export function boundComplexity(poly: Polygon, maxVertices = MAX_NEST_VERTICES): Polygon {
  if (poly.outer.length <= maxVertices || isConvexRing(poly.outer)) return poly;
  // Tolerance nejvýš MAX_SIMPLIFY mm – raději víc vrcholů než vyplněné konkávy
  // (hřeben by jinak přerostl i svůj obalový obdélník).
  for (let tol = 0.025; ; tol *= 2) {
    const s = simplifyRingWithError(poly.outer, tol);
    if (s.ring.length > maxVertices) {
      if (tol < MAX_SIMPLIFY) continue;
      if (s.ring.length > 0.75 * poly.outer.length) return poly;
    }
    const grown = offsetPolygons([{ outer: s.ring, holes: poly.holes }], s.error);
    if (grown.length === 0) return poly;
    return grown.reduce((a, b) => (ringArea(b.outer) > ringArea(a.outer) ? b : a));
  }
}

/** Cache nafouknutých a otočených tvarů podle (díl, rozestup, natočení). */
export class ShapeCache {
  private readonly base = new Map<string, Polygon>();
  private readonly rotated = new Map<string, Polygon>();
  private readonly shrunkCache = new Map<string, Polygon>();
  private readonly spacing: number;
  private readonly opts: ShapeOptions;

  private readonly freeStep: number;

  /**
   * `freeStep` = krok volné rotace: díl, který se smí natočit mimo násobky
   * 90°, se nafoukne se zaoblenými rohy (ostrý roh by po natočení o 45°
   * trčel o s/2·√2), ostatní s ostrými rohy (obdélník přesně o s větší).
   */
  constructor(spacing: number, opts: ShapeOptions = {}, freeStep = 90) {
    this.spacing = spacing;
    this.opts = opts;
    this.freeStep = freeStep;
  }

  inflated(part: Part): Polygon {
    let p = this.base.get(part.id);
    if (!p) {
      const offAxis = allowedRotations(part.rotation, this.freeStep).some((r) => r % 90 !== 0);
      p = boundComplexity(
        inflatedPartPolygon(part, this.spacing, this.opts, offAxis ? 'round' : 'miter'),
      );
      this.base.set(part.id, p);
    }
    return p;
  }

  /** Nafouknutý díl otočený a zmenšený o EPS/2 (ověření kandidátů placeru). */
  shrunk(part: Part, rotation: number): Polygon {
    const key = `${part.id}\u0000${rotation}`;
    let p = this.shrunkCache.get(key);
    if (!p) {
      const s = shrinkForCheck([this.at(part, rotation)]);
      p =
        s.length > 0
          ? s.reduce((a, b) => (ringArea(b.outer) > ringArea(a.outer) ? b : a))
          : this.at(part, rotation);
      this.shrunkCache.set(key, p);
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
