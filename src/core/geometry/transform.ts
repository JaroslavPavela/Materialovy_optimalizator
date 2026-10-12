import { ANGLE_EPS } from './eps.ts';
import type { Contour, Point, Polygon, Rect, Ring } from './types.ts';

/**
 * cos a sin úhlu ve stupních. Pro násobky 90° vrací přesné 0/±1,
 * aby otočení obdélníků nevnášelo šum plovoucí čárky.
 */
export function cosSinDeg(deg: number): readonly [number, number] {
  const r = ((deg % 360) + 360) % 360;
  const quarter = Math.round(r / 90);
  if (Math.abs(r - quarter * 90) <= ANGLE_EPS) {
    switch (quarter % 4) {
      case 0:
        return [1, 0];
      case 1:
        return [0, 1];
      case 2:
        return [-1, 0];
      default:
        return [0, -1];
    }
  }
  const rad = (r * Math.PI) / 180;
  return [Math.cos(rad), Math.sin(rad)];
}

/** Otočí bod o `deg` stupňů CCW kolem `center` (výchozí počátek). */
export function rotatePoint(p: Point, deg: number, center: Point = { x: 0, y: 0 }): Point {
  const [c, s] = cosSinDeg(deg);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return { x: center.x + dx * c - dy * s, y: center.y + dx * s + dy * c };
}

export function translatePoint(p: Point, dx: number, dy: number): Point {
  return { x: p.x + dx, y: p.y + dy };
}

export function rotateRing(ring: Ring, deg: number, center?: Point): Ring {
  return ring.map((p) => rotatePoint(p, deg, center));
}

export function translateRing(ring: Ring, dx: number, dy: number): Ring {
  return ring.map((p) => translatePoint(p, dx, dy));
}

/** Otočí polygon CCW; orientace obrysů se rotací nemění. */
export function rotatePolygon(polygon: Polygon, deg: number, center?: Point): Polygon {
  return {
    outer: rotateRing(polygon.outer, deg, center),
    holes: polygon.holes.map((h) => rotateRing(h, deg, center)),
  };
}

export function translatePolygon(polygon: Polygon, dx: number, dy: number): Polygon {
  return {
    outer: translateRing(polygon.outer, dx, dy),
    holes: polygon.holes.map((h) => translateRing(h, dx, dy)),
  };
}

/** Otočí obrys s oblouky; bulge se rotací ani posunem nemění. */
export function rotateContour(contour: Contour, deg: number, center?: Point): Contour {
  return contour.map((v) => ({ ...rotatePoint(v, deg, center), bulge: v.bulge }));
}

export function translateContour(contour: Contour, dx: number, dy: number): Contour {
  return contour.map((v) => ({ x: v.x + dx, y: v.y + dy, bulge: v.bulge }));
}

/**
 * Umístění podle `Placement`: otočí polygon o `rotation` stupňů CCW kolem
 * lokálního počátku dílu a posune o (x, y), tj. p' = R·p + (x, y).
 */
export function placePolygon(polygon: Polygon, rotation: number, x: number, y: number): Polygon {
  return translatePolygon(rotatePolygon(polygon, rotation), x, y);
}

/** Totéž jako `placePolygon` pro obrys s oblouky (export, náhled). */
export function placeContour(contour: Contour, rotation: number, x: number, y: number): Contour {
  return translateContour(rotateContour(contour, rotation), x, y);
}

/**
 * Posun (x, y) pro `Placement`, který dá levý dolní roh obalového obdélníku
 * do bodu `corner`. `rotatedBBox` = obalový obdélník dílu už otočeného
 * kolem lokálního počátku (bez posunu).
 */
export function translationForCorner(rotatedBBox: Rect, corner: Point): Point {
  return { x: corner.x - rotatedBBox.x, y: corner.y - rotatedBBox.y };
}
