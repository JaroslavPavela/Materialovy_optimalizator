import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { writeSheetDxf } from '../../../src/core/export/dxf-writer.ts';
import { contourArea, contourOrientation } from '../../../src/core/geometry/contour.ts';
import type { Point } from '../../../src/core/geometry/types.ts';
import { buildContours, type SegmentLike } from '../../../src/core/import/contours.ts';
import { readDxf } from '../../../src/core/import/dxf.ts';
import type { Part, Sheet } from '../../../src/core/model.ts';

const L = (a: Point, b: Point, bulge = 0): SegmentLike => ({ a, b, bulge });

/** Obdélník jako 4 úsečky CCW. */
function rect(x: number, y: number, w: number, h: number): SegmentLike[] {
  const p = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
  return p.map((a, i) => L(a, p[(i + 1) % 4]!));
}

/** Kružnice jako dva půloblouky CCW. */
const circle = (cx: number, cy: number, r: number): SegmentLike[] => [
  L({ x: cx + r, y: cy }, { x: cx - r, y: cy }, 1),
  L({ x: cx - r, y: cy }, { x: cx + r, y: cy }, 1),
];

const reverse = (s: SegmentLike) => L(s.b, s.a, -s.bulge);

describe('buildContours', () => {
  it('čtverec z úseček v libovolném pořadí a směru → jedna oblast CCW', () => {
    const segs = rect(0, 0, 10, 10);
    const r = buildContours([segs[2]!, reverse(segs[0]!), segs[3]!, reverse(segs[1]!)]);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.regions).toHaveLength(1);
    const outer = r.regions[0]!.outer;
    expect(contourOrientation(outer)).toBe('ccw');
    expect(contourArea(outer)).toBeCloseTo(100, 9);
  });

  it('konce do 0,01 mm se spojí bez varování', () => {
    const segs = rect(0, 0, 10, 10);
    segs[1] = L({ x: 10.005, y: 0.004 }, segs[1]!.b);
    const r = buildContours(segs);
    expect(r.warnings).toEqual([]);
    expect(r.regions).toHaveLength(1);
  });

  it('mezera do 0,1 mm se uzavře s varováním, větší je chyba s pozicí', () => {
    const small = rect(0, 0, 10, 10);
    small[1] = L({ x: 10.05, y: 0 }, small[1]!.b);
    const r = buildContours(small);
    expect(r.regions).toHaveLength(1);
    expect(r.warnings).toEqual(['Mezera 0,050 mm u bodu (10,1; 0,0) byla automaticky uzavřena.']);

    const big = rect(0, 0, 120, 50);
    big[1] = L({ x: 120.8, y: 0 }, big[1]!.b);
    const e = buildContours(big);
    expect(e.regions).toEqual([]);
    expect(e.errors).toEqual([
      'Kontura není uzavřená, mezera 0,80 mm mezi body (120,0; 0,0) a (120,8; 0,0).',
    ]);
  });

  it('více mezer v jedné kontuře: spojí se řetězce mezi sebou', () => {
    const segs = rect(0, 0, 10, 10).map((s, i) =>
      i % 2 ? L({ x: s.a.x + 0.03, y: s.a.y }, s.b) : s,
    );
    const r = buildContours(segs);
    expect(r.errors).toEqual([]);
    expect(r.regions).toHaveLength(1);
    expect(r.warnings).toHaveLength(2);
  });

  it('duplicitní segmenty (i obrácené) se odstraní', () => {
    const segs = rect(0, 0, 10, 10);
    const r = buildContours([
      ...segs,
      reverse(segs[0]!),
      segs[2]!,
      ...circle(5, 5, 2),
      reverse(circle(5, 5, 2)[0]!),
    ]);
    expect(r.warnings).toEqual(['Odstraněno duplicitních segmentů: 3.']);
    expect(r.regions).toHaveLength(1);
    expect(r.regions[0]!.holes).toHaveLength(1);
  });

  it('otvor (kružnice) je CW, díl v otvoru je samostatná oblast', () => {
    const r = buildContours([
      ...rect(0, 0, 100, 100),
      ...circle(50, 50, 30),
      ...rect(40, 40, 20, 20),
      ...circle(50, 50, 5),
    ]);
    expect(r.regions.map((x) => [x.depth, x.holes.length])).toEqual([
      [0, 1],
      [2, 1],
    ]);
    const hole = r.regions[0]!.holes[0]!;
    expect(contourOrientation(hole)).toBe('cw');
    expect(hole.every((v) => v.bulge === -1)).toBe(true);
    expect(contourArea(hole)).toBeCloseTo(Math.PI * 900, 6);
  });

  it('dva čtverce dotýkající se rohem → dvě oblasti (rozdělení osmičky)', () => {
    const r = buildContours([...rect(0, 0, 10, 10), ...rect(10, 10, 10, 10)]);
    expect(r.errors).toEqual([]);
    expect(r.regions).toHaveLength(2);
    for (const x of r.regions) expect(contourArea(x.outer)).toBeCloseTo(100, 9);
  });

  it('otvor dotýkající se vrcholem hrany vnějšího obrysu zůstane otvorem', () => {
    const tri = [
      L({ x: 5, y: 0 }, { x: 7, y: 3 }),
      L({ x: 7, y: 3 }, { x: 3, y: 3 }),
      L({ x: 3, y: 3 }, { x: 5, y: 0 }),
    ];
    const r = buildContours([...rect(0, 0, 10, 10), ...tri]);
    expect(r.regions).toHaveLength(1);
    expect(r.regions[0]!.holes).toHaveLength(1);
  });

  it('čára visící z rohu obrysu obrys nerozbije (jen chyba pro čáru)', () => {
    const r = buildContours([
      L({ x: 0, y: 0 }, { x: -20, y: -20 }),
      ...rect(0, 0, 10, 10),
      L({ x: -20, y: -20 }, { x: -30, y: -20 }),
    ]);
    expect(r.regions).toHaveLength(1);
    expect(contourArea(r.regions[0]!.outer)).toBeCloseTo(100, 9);
    expect(r.errors).toHaveLength(1);
  });

  it('čára napříč obrysem mezi vrcholy se nahlásí jako chyba (ne tiše)', () => {
    const r = buildContours([...rect(0, 0, 10, 10), L({ x: 0, y: 0 }, { x: 10, y: 10 })]);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.regions).toEqual([]);
  });

  it('osamocená čára a čára nakreslená dvakrát jsou neuzavřené kontury', () => {
    const r = buildContours([
      ...rect(0, 0, 10, 10),
      L({ x: 20, y: 0 }, { x: 30, y: 0 }),
      L({ x: 30, y: 0 }, { x: 20, y: 0 }),
    ]);
    expect(r.regions).toHaveLength(1);
    expect(r.errors).toHaveLength(1);
    expect(r.warnings).toEqual(['Odstraněno duplicitních segmentů: 1.']);
  });

  it('property: zamíchané, obrácené a posunuté (< 0,004 mm) obdélníky → stejné oblasti', () => {
    const arbRect = fc.record({
      w: fc.double({ min: 1, max: 500, noNaN: true }),
      h: fc.double({ min: 1, max: 500, noNaN: true }),
    });
    fc.assert(
      fc.property(
        fc.array(arbRect, { minLength: 1, maxLength: 6 }),
        fc.array(fc.double({ min: -0.002, max: 0.002, noNaN: true }), {
          minLength: 48,
          maxLength: 48,
        }),
        fc.array(fc.boolean(), { minLength: 24, maxLength: 24 }),
        fc.integer({ min: 0, max: 1000 }),
        (rects, jitter, flips, seed) => {
          let segs = rects.flatMap((r, i) => rect(i * 600, 0, r.w, r.h));
          segs = segs.map((s, i) => {
            const j = (k: number) => jitter[(2 * i + k) % jitter.length]!;
            const moved = L({ x: s.a.x + j(0), y: s.a.y + j(1) }, s.b);
            return flips[i % flips.length] ? reverse(moved) : moved;
          });
          segs = segs
            .map((s, i) => ({ s, k: (i * 7919 + seed) % 1009 }))
            .sort((a, b) => a.k - b.k)
            .map((x) => x.s);
          const r = buildContours(segs);
          expect(r.errors).toEqual([]);
          expect(r.warnings).toEqual([]);
          expect(r.regions).toHaveLength(rects.length);
          const areas = r.regions.map((x) => contourArea(x.outer)).sort((a, b) => a - b);
          const want = rects.map((x) => x.w * x.h).sort((a, b) => a - b);
          areas.forEach((a, i) =>
            expect(Math.abs(a - want[i]!)).toBeLessThan(0.01 * (rects[0]!.w + 500)),
          );
          for (const x of r.regions) expect(contourOrientation(x.outer)).toBe('ccw');
        },
      ),
      { numRuns: 60 },
    );
  });

  it('výkon: 3000 nespojených čar a 1000 otvorů projde rychle, chyby jsou zkrácené', () => {
    const lines = Array.from({ length: 3000 }, (_, i) =>
      L({ x: i * 10, y: 0 }, { x: i * 10 + 5, y: 0 }),
    );
    const holes = Array.from({ length: 1000 }, (_, i) =>
      circle(20 + (i % 40) * 50, 20 + Math.floor(i / 40) * 50, 10),
    ).flat();
    const t = performance.now();
    const r = buildContours([...lines, ...rect(0, 0, 2000, 1300), ...holes]);
    expect(performance.now() - t).toBeLessThan(5000);
    expect(r.errors).toHaveLength(6);
    expect(r.errors[5]).toBe('Dalších chyb kontur: 2995.');
    expect(r.regions).toHaveLength(1);
    expect(r.regions[0]!.holes).toHaveLength(1000);
  });

  it('plán z vlastního DXF writeru → oblasti dílů s otvory', () => {
    const part: Part = {
      id: 'd',
      name: 'D',
      width: 110,
      height: 60,
      quantity: 1,
      rotation: 'free',
      shape: {
        outer: [
          { x: 0, y: 0, bulge: 0 },
          { x: 80, y: 0, bulge: 1 },
          { x: 80, y: 60, bulge: 0 },
          { x: 0, y: 60, bulge: 0 },
        ],
        holes: [
          [
            { x: 20, y: 30, bulge: -1 },
            { x: 40, y: 30, bulge: -1 },
          ],
        ],
      },
    };
    const sheet: Sheet = {
      id: 's',
      name: 'S',
      width: 500,
      height: 300,
      stock: null,
      margin: 0,
      forbiddenZones: [],
    };
    for (const segments of ['polyline', 'lines-arcs'] as const) {
      const text = writeSheetDxf(
        sheet,
        {
          sheetId: 's',
          placements: [
            { partId: 'd', instance: 0, x: 10, y: 10, rotation: 0 },
            { partId: 'd', instance: 1, x: 300, y: 50, rotation: 147 },
          ],
        },
        [part],
        { segments, labels: false },
      );
      const segs = readDxf(text).segments.filter((s) => s.layer !== 'TABULE');
      const r = buildContours(segs);
      expect(r.errors).toEqual([]);
      expect(r.regions).toHaveLength(2);
      for (const x of r.regions) {
        expect(x.holes).toHaveLength(1);
        expect(contourArea(x.outer)).toBeCloseTo(80 * 60 + (Math.PI * 900) / 2, 3);
      }
    }
  });
});

describe('revize 4.2: okrajové případy', () => {
  const sq = (x: number, y: number, w: number, h: number) => rect(x, y, w, h);
  const areas = (r: ReturnType<typeof buildContours>) => r.regions.map((x) => contourArea(x.outer));

  it('hustá lomená čára (kroky pod tolerancí spojení) tvar zachová', () => {
    const bottom = Array.from({ length: 2000 }, (_, i) =>
      L({ x: i * 0.005, y: 0 }, { x: (i + 1) * 0.005, y: 0 }),
    );
    const r = buildContours([...bottom, ...sq(0, 0, 10, 10).slice(1)]);
    expect(r.errors).toEqual([]);
    // Roh se smí přichytit k sousednímu uzlu nejvýš o toleranci spojení.
    expect(Math.abs(areas(r)[0]! - 100)).toBeLessThan(10 * 0.01);
    const n = 400;
    const half = Array.from({ length: n }, (_, i) => {
      const a0 = (Math.PI * i) / n;
      const a1 = (Math.PI * (i + 1)) / n;
      return L({ x: Math.cos(a0), y: Math.sin(a0) }, { x: Math.cos(a1), y: Math.sin(a1) });
    });
    const h = buildContours([...half, L({ x: -1, y: 0 }, { x: 1, y: 0 })]);
    expect(h.regions).toHaveLength(1);
    expect(Math.abs(areas(h)[0]! - Math.PI / 2)).toBeLessThan(0.01);
  });

  it('oblouk téměř přes celý kruh (359,99° i 359,9°) nezmizí', () => {
    for (const deg of [359.99, 359.9]) {
      const sweep = (deg * Math.PI) / 180;
      const a = { x: 50, y: 0 };
      const b = { x: 50 * Math.cos(sweep), y: 50 * Math.sin(sweep) };
      const r = buildContours([L(a, b, Math.tan(sweep / 4))]);
      expect(r.regions).toHaveLength(1);
      // Chybí jen úseč nad uzavřenou mezerou.
      expect(Math.abs(areas(r)[0]! - Math.PI * 2500)).toBeLessThan(0.002 * Math.PI * 2500);
    }
  });

  it('úhlopříčka přes obrys a dva díly se sdílenou hranou: chyba větvení, žádný chybný díl', () => {
    const diag = L({ x: 0, y: 0 }, { x: 10, y: 10 });
    for (const segs of [
      [...sq(0, 0, 10, 10), diag],
      [diag, ...sq(0, 0, 10, 10)],
    ]) {
      const r = buildContours(segs);
      expect(r.regions).toEqual([]);
      expect(r.errors[0]).toMatch(/Kontura se větví v bodě/);
    }
    const shared = buildContours([...sq(0, 0, 10, 10), ...sq(10, 0, 10, 10)]);
    expect(shared.regions).toEqual([]);
    expect(shared.errors[0]).toMatch(/větví/);
  });

  it('spojka mezi obrysem a otvorem: otvor zůstane, spojka je chyba', () => {
    const r = buildContours([
      ...sq(0, 0, 100, 100),
      ...sq(20, 20, 10, 10),
      L({ x: 0, y: 0 }, { x: 20, y: 20 }),
    ]);
    expect(r.regions).toHaveLength(1);
    expect(r.regions[0]!.holes).toHaveLength(1);
    expect(r.errors).toHaveLength(1);
  });

  it('mezera v rohu s visící čárou se uzavře; přesah v rohu nedá falešná hlášení', () => {
    const gap = sq(0, 0, 10, 10);
    gap[1] = L({ x: 10.05, y: 0 }, gap[1]!.b);
    const r = buildContours([...gap, L({ x: 10, y: 0 }, { x: 20, y: -5 })]);
    expect(r.regions).toHaveLength(1);
    expect(areas(r)[0]).toBeCloseTo(100, 1);
    expect(r.warnings[0]).toMatch(/Mezera 0,050 mm/);

    const over = sq(0, 0, 10, 10);
    over[0] = L({ x: 0, y: 0 }, { x: 10.05, y: 0 });
    const o = buildContours([...over, L({ x: 10.05, y: 0 }, { x: 10, y: 0 })]);
    expect(o.regions).toHaveLength(1);
    expect(o.warnings).toEqual([]);
  });

  it('samoprůnik (motýlek) a křížení kontur jsou chyba bez dílu', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 20, y: 10 },
      { x: 20, y: 0 },
      { x: 0, y: 4 },
    ];
    const bow = buildContours(pts.map((p, i) => L(p, pts[(i + 1) % 4]!)));
    expect(bow.regions).toEqual([]);
    expect(bow.errors[0]).toMatch(/protíná sama sebe u bodu/);
    const cross = buildContours([...sq(0, 0, 10, 10), ...sq(5, 5, 10, 10)]);
    expect(cross.regions).toEqual([]);
    expect(cross.errors.join()).toMatch(/Kontury se protínají/);
  });

  it('překrývající se kolineární čára (známé omezení) se nahlásí, ne tiše', () => {
    const r = buildContours([
      ...sq(0, 0, 10, 10),
      L({ x: 0, y: 0 }, { x: 5, y: 0 }),
      L({ x: 5, y: 0 }, { x: 10, y: 0 }),
    ]);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('duplicita oblouku na hranici zaokrouhlení bulge se pozná', () => {
    const c = circle(0, 0, 10);
    const r = buildContours([
      ...c,
      L(c[0]!.a, c[0]!.b, 1.0000004999),
      L(c[0]!.a, c[0]!.b, 1.0000005001),
    ]);
    expect(r.errors).toEqual([]);
    expect(r.regions).toHaveLength(1);
  });

  it('kosočtverec vepsaný do čtverce (vrcholy na hranici) je otvor', () => {
    const d = [
      { x: 5, y: 0 },
      { x: 10, y: 5 },
      { x: 5, y: 10 },
      { x: 0, y: 5 },
    ];
    const r = buildContours([...sq(0, 0, 10, 10), ...d.map((p, i) => L(p, d[(i + 1) % 4]!))]);
    expect(r.regions).toHaveLength(1);
    expect(r.regions[0]!.holes).toHaveLength(1);
  });

  it('otvor se společným vrcholem s vnějším obrysem (oba pořadí)', () => {
    const tri = [
      L({ x: 0, y: 0 }, { x: 2, y: 5 }),
      L({ x: 2, y: 5 }, { x: 5, y: 2 }),
      L({ x: 5, y: 2 }, { x: 0, y: 0 }),
    ];
    for (const segs of [
      [...sq(0, 0, 10, 10), ...tri],
      [...tri, ...sq(0, 0, 10, 10)],
    ]) {
      const r = buildContours(segs);
      expect(r.errors).toEqual([]);
      expect(r.regions).toHaveLength(1);
      expect(r.regions[0]!.holes).toHaveLength(1);
    }
  });
});
