import { contourToRing } from './geometry/contour.ts';
import { pointInRing, pointRingDistance, polygonBBox, rectToPolygon } from './geometry/polygon.ts';
import { placeContour, placePolygon, rotatePoint } from './geometry/transform.ts';
import type { Contour, Point, Polygon, Rect, Ring } from './geometry/types.ts';
import type { Part, PartShape, Placement, SheetLayout } from './model.ts';

/** Umístěný díl připravený k vykreslení nebo exportu, v souřadnicích tabule. */
export interface PlacedPart {
  readonly part: Part;
  readonly placement: Placement;
  /** Obalový obdélník dílu (obdélníku [0, š] × [0, v]) po umístění. */
  readonly outline: Polygon;
  readonly bbox: Rect;
  /** Bod pro popisek – uvnitř materiálu, co nejdál od hran a otvorů. */
  readonly labelAt: Point;
  /** Vzdálenost bodu popisku od nejbližší hrany (mm) – omezuje velikost písma. */
  readonly labelClearance: number;
}

/** Obrys jednoho umístěného dílu: p' = R·p + (x, y). */
export function placePart(part: Part, placement: Placement): PlacedPart {
  const local = rectToPolygon({ x: 0, y: 0, width: part.width, height: part.height });
  const outline = placePolygon(local, placement.rotation, placement.x, placement.y);
  const bbox = polygonBBox(outline);
  const spot = labelSpot(part);
  const r = rotatePoint(spot, placement.rotation);
  return {
    part,
    placement,
    outline,
    bbox,
    labelAt: { x: r.x + placement.x, y: r.y + placement.y },
    labelClearance: spot.clearance,
  };
}

const spots = new WeakMap<Part, { x: number; y: number; clearance: number }>();

/**
 * Bod pro popisek v lokálních souřadnicích dílu: uvnitř materiálu (mimo
 * otvory) s největší vzdáleností od hranice – mřížka přes obalový obdélník
 * a dvakrát zjemněná kolem nejlepšího bodu. U rámu s dílem v otvoru tak
 * popisky nesplývají a u tvaru L leží na materiálu.
 */
export function labelSpot(part: Part): { x: number; y: number; clearance: number } {
  const hit = spots.get(part);
  if (hit) return hit;
  const { outer, holes } = partContours(part);
  const tol = Math.max(0.01, Math.min(part.width, part.height) / 200);
  const rings = [contourToRing(outer, tol), ...holes.map((h) => contourToRing(h, tol))];
  const [outerRing, ...holeRings] = rings as [Ring, ...Ring[]];
  const score = (p: Point) =>
    pointInRing(p, outerRing) && !holeRings.some((h) => pointInRing(p, h))
      ? Math.min(...rings.map((r) => pointRingDistance(p, r)))
      : -1;
  let best = {
    x: part.width / 2,
    y: part.height / 2,
    clearance: score({ x: part.width / 2, y: part.height / 2 }),
  };
  let cx = part.width / 2;
  let cy = part.height / 2;
  let w = part.width;
  let h = part.height;
  const N = 16;
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        const p = { x: cx - w / 2 + (w * i) / N, y: cy - h / 2 + (h * j) / N };
        const d = score(p);
        if (d > best.clearance) best = { ...p, clearance: d };
      }
    }
    cx = best.x;
    cy = best.y;
    w = (2 * w) / N;
    h = (2 * h) / N;
  }
  const out = { x: best.x, y: best.y, clearance: Math.max(0, best.clearance) };
  spots.set(part, out);
  return out;
}

/** Velikost písma popisku (mm): podle délky názvu a prostoru kolem bodu popisku. */
export function labelSize(p: PlacedPart): number {
  const byName = Math.min(
    p.bbox.height * 0.4,
    (p.bbox.width / Math.max(3, p.part.name.length)) * 1.6,
  );
  return Math.max(0, Math.min(byName, 1.6 * p.labelClearance));
}

/** Všechny díly jedné tabule; neznámé ID dílu vyhodí `RangeError`. */
export function placedParts(parts: readonly Part[], layout: SheetLayout): PlacedPart[] {
  const byId = new Map(parts.map((p) => [p.id, p]));
  return layout.placements.map((placement) => {
    const part = byId.get(placement.partId);
    if (!part) throw new RangeError(`Umístění odkazuje na neznámý díl „${placement.partId}".`);
    return placePart(part, placement);
  });
}

/** Obrysy dílu v lokálních souřadnicích: tvar z DXF, jinak obdélník (CCW, bez otvorů). */
export function partContours(part: Part): PartShape {
  if (part.shape) return part.shape;
  const outer: Contour = [
    { x: 0, y: 0, bulge: 0 },
    { x: part.width, y: 0, bulge: 0 },
    { x: part.width, y: part.height, bulge: 0 },
    { x: 0, y: part.height, bulge: 0 },
  ];
  return { outer, holes: [] };
}

/**
 * Obrysy umístěného dílu v souřadnicích tabule s původními oblouky (export).
 * Rotace zachovává orientaci, takže bulge zůstává beze změny.
 */
export function placedContours(part: Part, placement: Placement): PartShape {
  const { outer, holes } = partContours(part);
  const { rotation, x, y } = placement;
  return {
    outer: placeContour(outer, rotation, x, y),
    holes: holes.map((h) => placeContour(h, rotation, x, y)),
  };
}
