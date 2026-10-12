import fc from 'fast-check';
import type { Point, Polygon, Ring } from '../../src/core/geometry/types.ts';

/** Bod v rozsahu typické tabule s rezervou, mm. */
export const arbPoint: fc.Arbitrary<Point> = fc.record({
  x: fc.double({ min: -5000, max: 5000, noNaN: true }),
  y: fc.double({ min: -5000, max: 5000, noNaN: true }),
});

/** Úhel ve stupních, včetně záporných a větších než 360°. */
export const arbAngle: fc.Arbitrary<number> = fc.double({ min: -720, max: 720, noNaN: true });

/**
 * Jednoduchý hvězdicový polygon (CCW) kolem středu: n ≥ 4 vrcholů na téměř
 * pravidelně rozložených úhlech (mezery < 180°), poloměry `rMin`–`rMax`.
 * Obsahuje kruh o poloměru ≥ 0,15·rMin kolem středu.
 */
export function arbStarRing(
  rMin = 10,
  rMax = 1000,
): fc.Arbitrary<{ ring: Ring; center: Point; rMin: number }> {
  return fc
    .record({
      center: arbPoint,
      n: fc.integer({ min: 4, max: 16 }),
      seedRadii: fc.array(fc.double({ min: 0, max: 1, noNaN: true }), {
        minLength: 16,
        maxLength: 16,
      }),
      jitter: fc.array(fc.double({ min: -0.4, max: 0.4, noNaN: true }), {
        minLength: 16,
        maxLength: 16,
      }),
    })
    .map(({ center, n, seedRadii, jitter }) => {
      const step = (2 * Math.PI) / n;
      const radii = seedRadii.slice(0, n).map((t) => rMin + t * (rMax - rMin));
      const ring = radii.map((r, k) => {
        const a = (k + jitter[k]!) * step;
        return { x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a) };
      });
      return { ring, center, rMin: Math.min(...radii) };
    });
}

/** Polygon (vnější CCW) volitelně se čtvercovým otvorem (CW) uvnitř. */
export const arbPolygon: fc.Arbitrary<Polygon> = fc
  .tuple(arbStarRing(), fc.boolean())
  .map(([{ ring, center, rMin }, withHole]) => {
    if (!withHole) return { outer: ring, holes: [] };
    const h = 0.1 * rMin;
    const hole: Ring = [
      { x: center.x - h, y: center.y - h },
      { x: center.x - h, y: center.y + h },
      { x: center.x + h, y: center.y + h },
      { x: center.x + h, y: center.y - h },
    ];
    return { outer: ring, holes: [hole] };
  });

/**
 * Okrajové tvary: tenký pás (poměr stran až 1:1000), obdélník s kolineárním
 * vrcholem uprostřed hrany a trojúhelník; vše CCW, souřadnice kolem `origin`.
 */
export const arbEdgePolygon: fc.Arbitrary<Polygon> = fc
  .record({
    origin: arbPoint,
    long: fc.double({ min: 1, max: 3000, noNaN: true }),
    ratio: fc.double({ min: 1, max: 1000, noNaN: true }),
    kind: fc.constantFrom('strip', 'collinear', 'triangle'),
  })
  .map(({ origin: o, long, ratio, kind }): Polygon => {
    const short = long / ratio;
    const p = (x: number, y: number) => ({ x: o.x + x, y: o.y + y });
    switch (kind) {
      case 'strip':
        return { outer: [p(0, 0), p(long, 0), p(long, short), p(0, short)], holes: [] };
      case 'collinear':
        return {
          outer: [p(0, 0), p(long / 2, 0), p(long, 0), p(long, short), p(0, short)],
          holes: [],
        };
      default:
        return { outer: [p(0, 0), p(long, 0), p(0, short)], holes: [] };
    }
  });

/** Polygony běžné i okrajové. */
export const arbAnyPolygon: fc.Arbitrary<Polygon> = fc.oneof(arbPolygon, arbEdgePolygon);

/** Relativní tolerance pro porovnání ploch a délek, které vznikly výpočtem. */
export function expectRelNear(actual: number, expected: number, rel = 1e-9): void {
  const tol = rel * Math.max(1, Math.abs(expected));
  if (!(Math.abs(actual - expected) <= tol)) {
    throw new Error(`Očekáváno ${expected} ± ${tol}, je ${actual}.`);
  }
}
