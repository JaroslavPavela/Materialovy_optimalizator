import fc from 'fast-check';
import { approximateSegment, contourBBox } from '../../src/core/geometry/contour.ts';
import type { Point, Polygon, Ring } from '../../src/core/geometry/types.ts';
import type { ForbiddenZone, Part, RotationMode, Sheet } from '../../src/core/model.ts';

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

/** Obdélníkový díl: 1–2000 mm (celá i desetinná čísla), počet 1–20, libovolná rotace. */
export const arbRectPart = (id: string): fc.Arbitrary<Part> =>
  fc.record({
    id: fc.constant(id),
    name: fc.constant(`Díl ${id}`),
    width: fc.oneof(
      fc.integer({ min: 1, max: 2000 }),
      fc.double({ min: 1, max: 2000, noNaN: true }),
    ),
    height: fc.oneof(
      fc.integer({ min: 1, max: 2000 }),
      fc.double({ min: 1, max: 2000, noNaN: true }),
    ),
    quantity: fc.integer({ min: 1, max: 20 }),
    rotation: fc.constantFrom<RotationMode>('free', 'ortho', 'flip', 'locked'),
  });

/** 1–`max` různých obdélníkových dílů s ID p0, p1, … */
export const arbRectParts = (max = 6): fc.Arbitrary<Part[]> =>
  fc
    .integer({ min: 1, max })
    .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => arbRectPart(`p${i}`))));

/** 0–3 obdélníkové zakázané zóny uvnitř tabule w × h. */
export const arbForbiddenZones = (w: number, h: number): fc.Arbitrary<ForbiddenZone[]> =>
  fc
    .array(
      fc
        .record({
          x: fc.double({ min: 0, max: 0.9, noNaN: true }),
          y: fc.double({ min: 0, max: 0.9, noNaN: true }),
          zw: fc.double({ min: 0.01, max: 0.3, noNaN: true }),
          zh: fc.double({ min: 0.01, max: 0.3, noNaN: true }),
        })
        .map(({ x, y, zw, zh }) => {
          const x0 = x * w;
          const y0 = y * h;
          const x1 = Math.min(w, x0 + zw * w);
          const y1 = Math.min(h, y0 + zh * h);
          return [
            { x: x0, y: y0 },
            { x: x1, y: y0 },
            { x: x1, y: y1 },
            { x: x0, y: y1 },
          ];
        }),
      { maxLength: 3 },
    )
    .map((polys) => polys.map((polygon, i) => ({ id: `z${i}`, polygon })));

/** Tabule 500–4000 × 500–2000 mm, okraj 0–20, sklad 1–5 nebo neomezeno, se zónami. */
export const arbSheet = (id: string): fc.Arbitrary<Sheet> =>
  fc
    .record({
      width: fc.integer({ min: 500, max: 4000 }),
      height: fc.integer({ min: 500, max: 2000 }),
      margin: fc.oneof(fc.constant(0), fc.double({ min: 0, max: 20, noNaN: true })),
      stock: fc.oneof(fc.constant(null), fc.integer({ min: 1, max: 5 })),
    })
    .chain(({ width, height, margin, stock }) =>
      arbForbiddenZones(width, height).map((forbiddenZones): Sheet => ({
        id,
        name: `${width} × ${height}`,
        width,
        height,
        margin,
        stock,
        forbiddenZones,
      })),
    );

/** Rozestup 0–10 mm. */
export const arbSpacing: fc.Arbitrary<number> = fc.oneof(
  fc.constant(0),
  fc.double({ min: 0, max: 10, noNaN: true }),
);

const MATERIALS = ['DTD', 'MDF', undefined] as const;

/** Zóna v okrajové variantě: mimo tabuli, přes celou tabuli, nebo trojúhelník u rohu. */
const arbEdgeZone = (w: number, h: number): fc.Arbitrary<ForbiddenZone> =>
  fc
    .constantFrom('outside', 'whole', 'triangle')
    .map((kind): Ring => {
      switch (kind) {
        case 'outside':
          return [
            { x: w + 50, y: -100 },
            { x: w + 300, y: -100 },
            { x: w + 300, y: h / 2 },
            { x: w + 50, y: h / 2 },
          ];
        case 'whole':
          return [
            { x: -10, y: -10 },
            { x: w + 10, y: -10 },
            { x: w + 10, y: h + 10 },
            { x: -10, y: h + 10 },
          ];
        default:
          return [
            { x: 0, y: 0 },
            { x: w / 4, y: 0 },
            { x: 0, y: h / 4 },
          ];
      }
    })
    .map((polygon) => ({ id: 'edge', polygon }));

/**
 * Okrajové vstupy nestingu: materiály a tloušťky, formát se skladem 0,
 * zbytek, zóny mimo tabuli / přes celou tabuli / nepravoúhlé a díly přesně
 * na míru užitné plochy (± zlomek EPS).
 */
export const arbEdgeNestingInput = (
  spacingArb: fc.Arbitrary<number>,
): fc.Arbitrary<{ parts: Part[]; sheets: Sheet[]; spacing: number }> =>
  fc
    .record({
      spacing: spacingArb,
      w: fc.integer({ min: 300, max: 2500 }),
      h: fc.integer({ min: 300, max: 1500 }),
      margin: fc.constantFrom(0, 10, 2.5),
      material: fc.constantFrom(...MATERIALS),
      thickness: fc.constantFrom(18, undefined),
      stock: fc.constantFrom<number | null>(null, 1, 2),
      zone: fc.option(fc.constant(true), { nil: undefined }),
      emptyFormat: fc.boolean(),
      remnant: fc.boolean(),
    })
    .chain((c) => {
      const zones = c.zone ? arbEdgeZone(c.w, c.h).map((z) => [z]) : fc.constant([]);
      const usableW = c.w - 2 * c.margin + c.spacing;
      const usableH = c.h - 2 * c.margin + c.spacing;
      const exact = fc
        .record({
          kx: fc.integer({ min: 1, max: 4 }),
          ky: fc.integer({ min: 1, max: 4 }),
          jitter: fc.constantFrom(-0.4, 0, 0.4, 1.2),
          quantity: fc.integer({ min: 1, max: 20 }),
          rotation: fc.constantFrom<RotationMode>('free', 'ortho', 'locked'),
          material: fc.constantFrom(...MATERIALS),
        })
        .map(({ kx, ky, jitter, quantity, rotation, material }) => ({
          width: usableW / kx - c.spacing + jitter * 1e-3,
          height: usableH / ky - c.spacing + jitter * 1e-3,
          quantity,
          rotation,
          material,
        }))
        .filter((p) => p.width > 0.01 && p.height > 0.01);
      return fc
        .record({
          zones,
          parts: fc.array(exact, { minLength: 1, maxLength: 4 }),
        })
        .map(({ zones: forbiddenZones, parts }) => {
          const sheets: Sheet[] = [
            {
              id: 'hlavni',
              name: 'hlavní',
              width: c.w,
              height: c.h,
              margin: c.margin,
              stock: c.stock,
              forbiddenZones,
              ...(c.material !== undefined ? { material: c.material } : {}),
              ...(c.thickness !== undefined ? { thickness: c.thickness } : {}),
            },
          ];
          if (c.emptyFormat) {
            sheets.push({
              id: 'prazdny',
              name: 'prázdný sklad',
              width: 4000,
              height: 2000,
              margin: 0,
              stock: 0,
              forbiddenZones: [],
            });
          }
          if (c.remnant) {
            sheets.push({
              id: 'zbytek',
              name: 'zbytek',
              width: Math.round(c.w / 2),
              height: Math.round(c.h / 2),
              margin: 0,
              stock: 1,
              remnant: true,
              forbiddenZones: [],
            });
          }
          return {
            spacing: c.spacing,
            sheets,
            parts: parts.map((p, i): Part => ({
              id: `e${i}`,
              name: `Okraj ${i}`,
              width: p.width,
              height: p.height,
              quantity: p.quantity,
              rotation: p.rotation,
              ...(p.material !== undefined ? { material: p.material } : {}),
            })),
          };
        });
    });

/** Protíná uzavřená lomená čára sama sebe? (vlastní průniky hran, ne dotyky) */
export function ringSelfIntersects(pts: readonly Point[]): boolean {
  const n = pts.length;
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = pts[j]!;
      const d = pts[(j + 1) % n]!;
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return true;
    }
  }
  return false;
}

/**
 * Tvarový díl: hvězdicový obrys (poloměr 8–60 mm) s malými oblouky
 * (|bulge| ≤ 0,2), volitelně kruhový otvor uprostřed, posunutý tak, aby
 * obalový obdélník začínal v (0, 0). Samoprotínající se tvary vyřazeny.
 */
export const arbShapePart = (id: string): fc.Arbitrary<Part> =>
  fc
    .record({
      star: arbStarRing(8, 60),
      bulges: fc.array(fc.double({ min: -0.2, max: 0.2, noNaN: true }), {
        minLength: 16,
        maxLength: 16,
      }),
      hole: fc.boolean(),
      quantity: fc.integer({ min: 1, max: 4 }),
      rotation: fc.constantFrom<RotationMode>('free', 'ortho', 'flip', 'locked'),
    })
    .map(({ star, bulges, hole, quantity, rotation }) => {
      const outer = star.ring.map((p, i) => ({ x: p.x, y: p.y, bulge: bulges[i]! }));
      const r = star.rMin * 0.1;
      const holes = hole
        ? [
            [
              { x: star.center.x - r, y: star.center.y, bulge: -1 },
              { x: star.center.x + r, y: star.center.y, bulge: -1 },
            ],
          ]
        : [];
      const bb = contourBBox(outer);
      const move = (c: { x: number; y: number; bulge: number }[]) =>
        c.map((v) => ({ ...v, x: v.x - bb.x, y: v.y - bb.y }));
      return {
        id,
        name: `Tvar ${id}`,
        width: bb.width,
        height: bb.height,
        quantity,
        rotation,
        shape: { outer: move(outer), holes: holes.map(move) },
      };
    })
    .filter((p) => {
      const c = p.shape!.outer;
      const dense = c.flatMap((v, i) => [
        v,
        ...approximateSegment(v, c[(i + 1) % c.length]!, v.bulge, 0.05),
      ]);
      return !ringSelfIntersects(dense);
    });
