import { polygonBBox, rectToPolygon } from './geometry/polygon.ts';
import { placeContour, placePolygon } from './geometry/transform.ts';
import type { Contour, Point, Polygon, Rect } from './geometry/types.ts';
import type { Part, PartShape, Placement, SheetLayout } from './model.ts';

/** Umístěný díl připravený k vykreslení nebo exportu, v souřadnicích tabule. */
export interface PlacedPart {
  readonly part: Part;
  readonly placement: Placement;
  /** Obrys dílu na tabuli (zatím obalový obdélník; skutečný tvar doplní krok 4.5). */
  readonly outline: Polygon;
  readonly bbox: Rect;
  /** Bod pro popisek – střed obalového obdélníku. */
  readonly labelAt: Point;
}

/** Obrys jednoho umístěného dílu: p' = R·p + (x, y). */
export function placePart(part: Part, placement: Placement): PlacedPart {
  const local = rectToPolygon({ x: 0, y: 0, width: part.width, height: part.height });
  const outline = placePolygon(local, placement.rotation, placement.x, placement.y);
  const bbox = polygonBBox(outline);
  return {
    part,
    placement,
    outline,
    bbox,
    labelAt: { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 },
  };
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
