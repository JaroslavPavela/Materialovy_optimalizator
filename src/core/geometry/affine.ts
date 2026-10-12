import { cosSinDeg } from './transform.ts';
import type { Point } from './types.ts';

/**
 * Afinní transformace v rovině: x' = a·x + c·y + e, y' = b·x + d·y + f.
 * Skládá transformace bloků (INSERT), OCS a převod jednotek při importu DXF.
 */
export interface Affine {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function translation(dx: number, dy: number): Affine {
  return { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy };
}

/** Otočení o `deg` stupňů CCW kolem počátku. */
export function rotation(deg: number): Affine {
  const [cos, sin] = cosSinDeg(deg);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

export function scaling(sx: number, sy: number = sx): Affine {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
}

/** Složení `m ∘ n`: nejdřív `n`, pak `m`. Víc argumentů = zprava doleva. */
export function compose(...ms: readonly Affine[]): Affine {
  return ms.reduce(
    (m, n) => ({
      a: m.a * n.a + m.c * n.b,
      b: m.b * n.a + m.d * n.b,
      c: m.a * n.c + m.c * n.d,
      d: m.b * n.c + m.d * n.d,
      e: m.a * n.e + m.c * n.f + m.e,
      f: m.b * n.e + m.d * n.f + m.f,
    }),
    IDENTITY,
  );
}

export function applyAffine(m: Affine, p: Point): Point {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

/** Determinant lineární části; záporný = zrcadlení (obrací orientaci obrysů). */
export function affineDeterminant(m: Affine): number {
  return m.a * m.d - m.b * m.c;
}

/** Největší zvětšení délky (největší singulární hodnota lineární části). */
export function maxScale(m: Affine): number {
  const s = m.a * m.a + m.b * m.b + m.c * m.c + m.d * m.d;
  const det = affineDeterminant(m);
  return Math.sqrt((s + Math.sqrt(Math.max(0, s * s - 4 * det * det))) / 2);
}

/**
 * Podobnost (otočení, stejnoměrné měřítko, případně zrcadlení): kružnice
 * zůstane kružnicí. Relativní tolerance `rel` vůči měřítku.
 */
export function isSimilarity(m: Affine, rel = 1e-9): boolean {
  const lx = Math.hypot(m.a, m.b);
  const ly = Math.hypot(m.c, m.d);
  const scale = Math.max(lx, ly);
  if (scale === 0) return false;
  return Math.abs(lx - ly) <= rel * scale && Math.abs(m.a * m.c + m.b * m.d) <= rel * scale * scale;
}
