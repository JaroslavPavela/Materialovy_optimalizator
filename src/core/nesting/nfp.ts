import {
  differencePolygons,
  minkowskiSum,
  offsetPolygons,
  unionPolygons,
} from '../geometry/clipper.ts';
import { EPS } from '../geometry/eps.ts';
import { ringBBox } from '../geometry/polygon.ts';
import { rotatePolygon, translatePolygon } from '../geometry/transform.ts';
import type { Point, Polygon, Rect, Ring } from '../geometry/types.ts';
import type { Part } from '../model.ts';
import type { ShapeCache } from './shapes.ts';

/**
 * Tolerance skládání (mm): NFP se zmenší a IFP zvětší o SLACK, aby díly
 * přesně na míru (mezera nulové šířky) nezmizely z přípustné oblasti.
 * Překryv / přesah: zmenšení (≤ SLACK·√2 v rozích) + přichycení do IFP
 * (≤ SLACK) + zaokrouhlení Clipperu – vše pod EPS.
 */
export const SLACK = EPS / 4;

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

/** Přesné meze IFP (bez SLACK): rozsah posunů x0…x1, y0…y1; `null` = nevejde se. */
export interface IfpBounds {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
}

export function ifpBounds(usable: Rect, b: Ring): IfpBounds | null {
  const bb = ringBBox(b);
  const x0 = usable.x - bb.x;
  const y0 = usable.y - bb.y;
  const x1 = usable.x + usable.width - (bb.x + bb.width);
  const y1 = usable.y + usable.height - (bb.y + bb.height);
  if (x1 < x0 - EPS || y1 < y0 - EPS) return null;
  // Díl širší než plocha o ≤ EPS: souměrně doprostřed (přesah ≤ EPS/2 na stranu).
  const [xa, xb] = x1 < x0 ? [(x0 + x1) / 2, (x0 + x1) / 2] : [x0, x1];
  const [ya, yb] = y1 < y0 ? [(y0 + y1) / 2, (y0 + y1) / 2] : [y0, y1];
  return { x0: xa, x1: xb, y0: ya, y1: yb };
}

/**
 * Inner-fit polygon obdélníkové užitné plochy: posuny t, při kterých B + t
 * leží celý v obdélníku `usable` (pro obdélník přesně – stačí obalový
 * obdélník B), rozšířený o SLACK: díl přesně na míru dá místo úsečky úzký
 * pruh, který booleovské operace neztratí. `null`, když se B nevejde.
 */
export function ifpRect(usable: Rect, b: Ring): Polygon | null {
  const f = ifpBounds(usable, b);
  if (!f) return null;
  const xa = f.x0 - SLACK;
  const xb = f.x1 + SLACK;
  const ya = f.y0 - SLACK;
  const yb = f.y1 + SLACK;
  return {
    outer: [
      { x: xa, y: ya },
      { x: xb, y: ya },
      { x: xb, y: yb },
      { x: xa, y: yb },
    ],
    holes: [],
  };
}

/** Umístěná překážka: tvar (díl nebo zóna) a jeho posun na tabuli. */
export interface Obstacle {
  readonly nfp: readonly Polygon[];
  readonly at: Point;
}

/** Přípustná oblast `region` bez NFP překážek (posunutých na jejich místo). */
export function subtractObstacles(
  region: readonly Polygon[],
  obstacles: readonly Obstacle[],
): Polygon[] {
  if (obstacles.length === 0 || region.length === 0) return [...region];
  const blocked = unionPolygons(
    obstacles.flatMap((o) => o.nfp.map((p) => translatePolygon(p, o.at.x, o.at.y))),
  );
  return differencePolygons(region, blocked);
}

/**
 * Přípustná oblast pro referenční bod B: IFP minus NFP všech překážek
 * (posunutých na jejich místo na tabuli). Prázdné pole = B se nevejde.
 */
export function feasibleRegion(ifp: Polygon, obstacles: readonly Obstacle[]): Polygon[] {
  return subtractObstacles([ifp], obstacles);
}

/** Úhel pro klíč cache: [0, 360), zaokrouhlený (90 a 90,0000000001 jsou totéž). */
const angleKey = (deg: number) => {
  const r = Math.round((((deg % 360) + 360) % 360) * 1e6) / 1e6;
  return r === 360 ? 0 : r;
};

/** Klíč z částí, které nemohou obsahovat oddělovač \u0000. */
const key = (...parts: readonly (string | number)[]) => parts.join('\u0000');

/**
 * NFP zmenšený o SLACK (přesná mezera mezi díly zůstane přípustná).
 * Zaoblené rohy: ostré rohy by vyduté vrcholy posunuly až o 2·SLACK.
 */
const slack = (polys: Polygon[]) => offsetPolygons(polys, -SLACK, 'round', SLACK / 4);

/**
 * Cache NFP. Díl–díl podle relativního natočení: NFP(A, rA, B, rB) =
 * rot(rA) · NFP(A, 0, B, rB − rA) (nafouknutý tvar je otočením tvaru
 * v natočení 0), takže stačí N² · R záznamů místo (N · R)². Zóny podle
 * (zóna, díl, natočení).
 */
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
    const rA = angleKey(rotA);
    const rel = angleKey(rotB - rotA);
    const base = this.memo(key('d', a.id, b.id, rel), () =>
      slack(nfp(this.shapes.at(a, 0).outer, this.shapes.at(b, rel).outer)),
    );
    return rA === 0 ? base : base.map((p) => rotatePolygon(p, rA));
  }

  /** NFP zakázané zóny (už nafouknuté, v souřadnicích tabule) pro díl B. */
  zone(zoneKey: string, zone: Polygon, b: Part, rotB: number): Polygon[] {
    return this.memo(key('z', zoneKey, b.id, angleKey(rotB)), () =>
      slack(nfp(zone.outer, this.shapes.at(b, rotB).outer)),
    );
  }

  private memo(k: string, make: () => Polygon[]): Polygon[] {
    const hit = this.cache.get(k);
    if (hit) {
      this.hits++;
      return hit;
    }
    this.misses++;
    const v = make();
    this.cache.set(k, v);
    return v;
  }
}
