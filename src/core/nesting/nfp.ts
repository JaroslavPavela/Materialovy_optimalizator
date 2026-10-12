import { differencePolygons, minkowskiSum, unionPolygons } from '../geometry/clipper.ts';
import { EPS } from '../geometry/eps.ts';
import { ringBBox } from '../geometry/polygon.ts';
import { translatePolygon } from '../geometry/transform.ts';
import type { Point, Polygon, Rect, Ring } from '../geometry/types.ts';
import type { Part } from '../model.ts';
import type { ShapeCache } from './shapes.ts';

/**
 * No-fit polygon: množina posunů t, při kterých se B + t překrývá s pevným A
 * (A i B v lokálních souřadnicích, referenční bod B = jeho lokální počátek,
 * tj. přesně posun (x, y) z `Placement`). NFP = A ⊕ (−B). Hranice = dotyk
 * (přípustné), otvory výsledku = dutiny A, kam se B vejde.
 * Otvory A se neuvažují (díl v otvoru jiného dílu řeší fáze 6).
 */
export function nfp(a: Ring, b: Ring): Polygon[] {
  return minkowskiSum(
    a,
    b.map((p) => ({ x: -p.x, y: -p.y })),
  );
}

/**
 * Inner-fit polygon obdélníkové užitné plochy: posuny t, při kterých B + t
 * leží celý v obdélníku `usable`. Pro obdélník je přesný (stačí obalový
 * obdélník B). `null`, když se B nevejde.
 */
export function ifpRect(usable: Rect, b: Ring): Polygon | null {
  const bb = ringBBox(b);
  const x0 = usable.x - bb.x;
  const y0 = usable.y - bb.y;
  const x1 = usable.x + usable.width - (bb.x + bb.width);
  const y1 = usable.y + usable.height - (bb.y + bb.height);
  if (x1 < x0 - EPS || y1 < y0 - EPS) return null;
  // Díl přesně na míru: IFP degeneruje na úsečku/bod – rozšíříme o EPS,
  // aby ho booleovské operace neztratily (posun o EPS je pod tolerancí).
  const w = Math.max(x1 - x0, 0);
  const h = Math.max(y1 - y0, 0);
  const ex = w < EPS ? EPS / 2 : 0;
  const ey = h < EPS ? EPS / 2 : 0;
  return {
    outer: [
      { x: x0 - ex, y: y0 - ey },
      { x: x0 + w + ex, y: y0 - ey },
      { x: x0 + w + ex, y: y0 + h + ey },
      { x: x0 - ex, y: y0 + h + ey },
    ],
    holes: [],
  };
}

/** Umístěná překážka: tvar (díl nebo zóna) a jeho posun na tabuli. */
export interface Obstacle {
  readonly nfp: readonly Polygon[];
  readonly at: Point;
}

/**
 * Přípustná oblast pro referenční bod B: IFP minus NFP všech překážek
 * (posunutých na jejich místo na tabuli). Prázdné pole = B se nevejde.
 */
export function feasibleRegion(ifp: Polygon, obstacles: readonly Obstacle[]): Polygon[] {
  if (obstacles.length === 0) return [ifp];
  const blocked = unionPolygons(
    obstacles.flatMap((o) => o.nfp.map((p) => translatePolygon(p, o.at.x, o.at.y))),
  );
  return differencePolygons([ifp], blocked);
}

/** Cache NFP podle (díl A, natočení A, díl B, natočení B) a (zóna, díl B, natočení B). */
export class NfpCache {
  private readonly cache = new Map<string, Polygon[]>();
  private readonly shapes: ShapeCache;
  hits = 0;
  misses = 0;

  constructor(shapes: ShapeCache) {
    this.shapes = shapes;
  }

  /** NFP umístěného dílu A (natočeného o rotA) pro díl B natočený o rotB. */
  parts(a: Part, rotA: number, b: Part, rotB: number): Polygon[] {
    return this.memo(`${a.id}:${rotA}|${b.id}:${rotB}`, () =>
      nfp(this.shapes.at(a, rotA).outer, this.shapes.at(b, rotB).outer),
    );
  }

  /** NFP zakázané zóny (už nafouknuté, v souřadnicích tabule) pro díl B. */
  zone(key: string, zone: Polygon, b: Part, rotB: number): Polygon[] {
    return this.memo(`zona:${key}|${b.id}:${rotB}`, () =>
      nfp(zone.outer, this.shapes.at(b, rotB).outer),
    );
  }

  private memo(key: string, make: () => Polygon[]): Polygon[] {
    const hit = this.cache.get(key);
    if (hit) {
      this.hits++;
      return hit;
    }
    this.misses++;
    const v = make();
    this.cache.set(key, v);
    return v;
  }
}
