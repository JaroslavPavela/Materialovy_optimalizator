import { EPS } from './eps.ts';
import type { Point, Polygon, Rect, Ring } from './types.ts';

/** Body se shodují v toleranci `eps` v každé souřadnici. */
export function pointsNear(a: Point, b: Point, eps: number = EPS): boolean {
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;
}

/** Obdélníky se shodují v toleranci `eps`. */
export function rectsNear(a: Rect, b: Rect, eps: number = EPS): boolean {
  return (
    Math.abs(a.x - b.x) <= eps &&
    Math.abs(a.y - b.y) <= eps &&
    Math.abs(a.width - b.width) <= eps &&
    Math.abs(a.height - b.height) <= eps
  );
}

/**
 * Obrysy se shodují v toleranci `eps`: stejný počet vrcholů, stejné pořadí,
 * povolen cyklický posun začátku (orientace musí sedět).
 */
export function ringsNear(a: Ring, b: Ring, eps: number = EPS): boolean {
  const n = a.length;
  if (n !== b.length) return false;
  if (n === 0) return true;
  for (let shift = 0; shift < n; shift++) {
    let ok = true;
    for (let i = 0; i < n && ok; i++) ok = pointsNear(a[i]!, b[(i + shift) % n]!, eps);
    if (ok) return true;
  }
  return false;
}

/** Polygony se shodují v toleranci `eps`; otvory musí být ve stejném pořadí. */
export function polygonsNear(a: Polygon, b: Polygon, eps: number = EPS): boolean {
  return (
    ringsNear(a.outer, b.outer, eps) &&
    a.holes.length === b.holes.length &&
    a.holes.every((h, i) => ringsNear(h, b.holes[i]!, eps))
  );
}
