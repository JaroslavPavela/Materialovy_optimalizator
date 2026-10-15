import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { partsFromDxf } from '../../../src/core/import/dxf-parts.ts';
import { plainDxfText, readDxf } from '../../../src/core/import/dxf.ts';
import { sameShape } from '../../../src/core/import/part-names.ts';
import type { Contour } from '../../../src/core/geometry/types.ts';
import type { PartShape } from '../../../src/core/model.ts';
import { circle, dxf, ent, rectPoly, type G } from './dxf-builder.ts';

/** TEXT zarovnaný vlevo na účaří (bod 10). */
const text = (s: string, x: number, y: number, h: number, ...extra: G[]) =>
  ent('TEXT', [10, x], [20, y], [30, 0], [40, h], [1, s], ...extra);

/** TEXT se zarovnáním 72/73 k bodu 11. */
const alignedText = (s: string, x: number, y: number, h: number, ha: number, va: number) =>
  ent(
    'TEXT',
    [10, 0],
    [20, 0],
    [30, 0],
    [40, h],
    [1, s],
    [72, ha],
    [11, x],
    [21, y],
    [31, 0],
    [73, va],
  );

const mtext = (s: string, x: number, y: number, h: number, attach: number, ...extra: G[]) =>
  ent('MTEXT', [10, x], [20, y], [30, 0], [40, h], [71, attach], [1, s], ...extra);

const multi = (entities: G[][], extra: Parameters<typeof dxf>[0] = { entities: [] }) =>
  partsFromDxf('plech.dxf', dxf({ ...extra, entities }), { mode: 'multi', idPrefix: 'd' });

const close = (a: { x: number; y: number }, b: { x: number; y: number }, eps = 1e-9) =>
  Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;

describe('plainDxfText', () => {
  it('kódy MTEXT, speciální znaky a \\U+XXXX', () => {
    expect(plainDxfText('{\\fArial|b1;\\H2.5;A12}\\PDíl \\LB\\l', true)).toBe('A12 Díl B');
    expect(plainDxfText('50\\S1^2; mm \\\\ \\{x\\}', true)).toBe('50 1/2 mm \\ {x}');
    expect(plainDxfText('\\A1;\\C1;Kryt\\~L', true)).toBe('Kryt L');
    expect(plainDxfText('%%c20 %%d %%p0,1 %%uA%%u 100%%%', false)).toBe('Ø20 ° ±0,1 A 100%');
    expect(plainDxfText('P\\U+0159\\U+00EDruba', false)).toBe('Příruba');
    // V TEXT se kódy MTEXT neřeší (zpětné lomítko je obyčejný znak).
    expect(plainDxfText('A\\P', false)).toBe('A\\P');
    expect(plainDxfText('  {\\H3;}  ', true)).toBe('');
  });
});

describe('readDxf – texty', () => {
  it('TEXT: střed podle zarovnání, výška, vrstva', () => {
    const r = readDxf(
      dxf({
        entities: [
          text('AB', 10, 20, 5, [8, 'POPIS']),
          alignedText('X', 50, 60, 4, 1, 2), // na střed, uprostřed
          alignedText('Y', 70, 80, 4, 4, 0), // „middle" – bod 11 je střed
          text('Z', 0, 0, 10, [50, 90]),
        ],
      }),
    );
    expect(r.texts.map((t) => [t.text, t.height, t.layer])).toEqual([
      ['AB', 5, 'POPIS'],
      ['X', 4, 'DIL'],
      ['Y', 4, 'DIL'],
      ['Z', 10, 'DIL'],
    ]);
    // Šířka odhadem 0,6 · výška na znak: „AB" 6 mm → střed (13; 22,5).
    expect(close(r.texts[0]!.at, { x: 13, y: 22.5 })).toBe(true);
    expect(close(r.texts[1]!.at, { x: 50, y: 60 })).toBe(true);
    expect(close(r.texts[2]!.at, { x: 70, y: 80 })).toBe(true);
    // Otočeno o 90°: posun (3; 5) se otočí na (−5; 3).
    expect(close(r.texts[3]!.at, { x: -5, y: 3 })).toBe(true);
  });

  it('MTEXT: bod připojení, víc řádků, formátování', () => {
    const r = readDxf(
      dxf({
        entities: [
          mtext('{\\H2;A1}', 100, 100, 2, 5),
          mtext('AB\\PCD', 0, 10, 3, 1), // vlevo nahoře, 2 řádky
        ],
      }),
    );
    expect(r.texts.map((t) => t.text)).toEqual(['A1', 'AB CD']);
    expect(close(r.texts[0]!.at, { x: 100, y: 100 })).toBe(true);
    // Šířka 2 · 0,6 · 3 = 3,6; výška 3 + 3 · 5/3 = 8 → střed (1,8; 6).
    expect(close(r.texts[1]!.at, { x: 1.8, y: 6 })).toBe(true);
  });

  it('text v bloku: poloha i výška se transformují, jednotky na mm', () => {
    const r = readDxf(
      dxf({
        insunits: 5, // cm
        blocks: [{ name: 'B', entities: [alignedText('K', 1, 1, 1, 4, 0)] }],
        entities: [ent('INSERT', [2, 'B'], [10, 10], [20, 0], [30, 0], [41, 2], [42, 2])],
      }),
    );
    expect(r.texts).toHaveLength(1);
    // (10 + 2 · 1; 2 · 1) cm = (120; 20) mm, výška 2 · 1 cm = 20 mm.
    expect(close(r.texts[0]!.at, { x: 120, y: 20 }, 1e-9)).toBe(true);
    expect(r.texts[0]!.height).toBeCloseTo(20, 9);
  });

  it('text s normálou −Z se zrcadlí; skrytý text a prázdný text se vynechají', () => {
    const r = readDxf(
      dxf({
        layers: [{ name: 'SKRYTA', color: -7 }],
        entities: [
          ent(
            'TEXT',
            [10, 0],
            [20, 0],
            [30, 0],
            [40, 2],
            [1, 'M'],
            [72, 4],
            [11, 30],
            [21, 5],
            [31, 0],
            [210, 0],
            [220, 0],
            [230, -1],
          ),
          text('neviditelný', 0, 0, 2, [60, 1]),
          text('vypnutý', 0, 0, 2, [8, 'SKRYTA']),
          text('%%u', 0, 0, 2),
        ],
      }),
    );
    expect(r.texts.map((t) => t.text)).toEqual(['M']);
    expect(close(r.texts[0]!.at, { x: -30, y: 5 })).toBe(true);
  });
});

describe('partsFromDxf – názvy z textu (více dílů v souboru)', () => {
  it('stejný text a tvar = jeden díl s počtem kopií; díl bez textu podle souboru', () => {
    const r = multi([
      rectPoly(0, 0, 100, 50),
      text('A12', 10, 20, 8),
      rectPoly(200, 0, 100, 50),
      text('A12', 210, 20, 8),
      rectPoly(400, 0, 100, 50),
      text('A12', 450, 10, 5),
      rectPoly(0, 100, 30, 30),
      text('B7', 5, 110, 4),
      rectPoly(200, 100, 40, 40),
    ]);
    // Pořadí shora dolů: čtverec 40 (bez textu), čtverec 30, obdélníky.
    expect(r.parts.map((p) => [p.id, p.name, p.quantity])).toEqual([
      ['d-1', 'plech-1', 1],
      ['d-2', 'B7', 1],
      ['d-3', 'A12', 3],
    ]);
    expect(r.warnings).toEqual([expect.stringMatching(/TEXT \(4\)/)]);
  });

  it('víc textů v dílu: vyhraje největší písmo; text mimo díly se nepoužije', () => {
    const r = multi([
      rectPoly(0, 0, 200, 100),
      text('S235 t=3', 10, 10, 3),
      text('Konzola', 10, 50, 10),
      mtext('pozn.', 150, 80, 4, 5),
      text('Výkres 12', 300, 300, 20),
    ]);
    expect(r.parts.map((p) => p.name)).toEqual(['Konzola']);
  });

  it('text v otvoru patří dílu; díl vložený do otvoru má vlastní text', () => {
    const r = multi([
      rectPoly(0, 0, 300, 200),
      rectPoly(20, 20, 260, 160),
      text('Rám', 40, 40, 10), // v otvoru rámu, mimo vložený díl
      rectPoly(100, 60, 100, 80),
      alignedText('Vložka', 150, 100, 10, 4, 0),
    ]);
    expect(r.parts.map((p) => [p.name, p.shape!.holes.length])).toEqual([
      ['Rám', 1],
      ['Vložka', 0],
    ]);
  });

  it('stejný text, jiný tvar nebo natočení → zvlášť s pořadím a upozorněním', () => {
    const r = multi([
      rectPoly(0, 0, 100, 50),
      text('P1', 10, 10, 5),
      rectPoly(200, 0, 50, 100), // stejný díl otočený o 90°
      text('P1', 210, 10, 5),
      rectPoly(400, 0, 100, 50),
      circle(450, 25, 10), // s otvorem
      text('P1', 410, 10, 5),
      rectPoly(600, 0, 100, 50),
      text('P1', 610, 10, 5),
    ]);
    // Shora dolů: otočený díl (horní hrana 100) dostane název první.
    expect(r.parts.map((p) => [p.name, p.quantity, p.width])).toEqual([
      ['P1', 1, 50],
      ['P1-2', 2, 100],
      ['P1-3', 1, 100],
    ]);
    expect(r.parts[2]!.shape!.holes).toHaveLength(1);
    expect(r.warnings.join('\n')).toMatch(/„P1" mají různý tvar nebo natočení.*P1, P1-2, P1-3/);
  });

  it('režim 1 soubor = 1 díl text nepoužije', () => {
    const r = partsFromDxf(
      'kryt.dxf',
      dxf({ entities: [rectPoly(0, 0, 50, 50), text('X9', 5, 5, 5)] }),
    );
    expect(r.parts.map((p) => p.name)).toEqual(['kryt']);
  });

  it('bez textů zůstávají názvy podle souboru a pořadí', () => {
    const r = multi([rectPoly(0, 0, 10, 10), rectPoly(20, 0, 10, 10)]);
    expect(r.parts.map((p) => [p.name, p.quantity])).toEqual([
      ['plech-1', 1],
      ['plech-2', 1],
    ]);
  });
});

describe('regrese z revize', () => {
  it('text v materiálu má přednost před větším textem v otvoru (nedokreslená vložka)', () => {
    const r = multi([
      rectPoly(0, 0, 300, 200),
      rectPoly(20, 20, 260, 160),
      text('Rám', 2, 5, 10), // v materiálu rámu (pruh 20 mm)
      // Vložka bez jedné strany – nevznikne, její text by jinak převzal rám.
      ent(
        'LWPOLYLINE',
        [90, 4],
        [70, 0],
        [10, 100],
        [20, 60],
        [10, 200],
        [20, 60],
        [10, 200],
        [20, 140],
        [10, 100],
        [20, 140],
      ),
      text('Vložka', 120, 90, 12),
    ]);
    expect(r.parts.map((p) => p.name)).toEqual(['Rám']);
    expect(r.errors.join()).toMatch(/není uzavřená/);
  });

  it('zářez mezi vrcholy: díly se stejným textem se nesloučí', () => {
    const notched = ent(
      'LWPOLYLINE',
      [90, 7],
      [70, 1],
      ...[
        [0, 1000],
        [2000, 1000],
        [2000, 1005],
        [1050, 1005],
        [1000, 1000.04],
        [950, 1005],
        [0, 1005],
      ].flatMap(
        ([x, y]) =>
          [
            [10, x],
            [20, y],
          ] as G[],
      ),
    );
    const r = multi([
      rectPoly(0, 0, 2000, 5),
      text('S', 10, 1, 3),
      notched,
      text('S', 10, 1001, 3),
    ]);
    expect(r.parts.map((p) => [p.name, p.quantity])).toEqual([
      ['S', 1],
      ['S-2', 1],
    ]);
  });

  it('vygenerovaný název nekoliduje s textem z výkresu', () => {
    const r = multi([
      rectPoly(0, 200, 10, 10),
      text('A', 1, 201, 2),
      rectPoly(0, 100, 20, 10),
      text('A', 1, 101, 2),
      rectPoly(0, 0, 30, 10),
      text('A-2', 1, 1, 2),
    ]);
    expect(r.parts.map((p) => p.name)).toEqual(['A', 'A-3', 'A-2']);
  });

  it('stejná výška písma po zaokrouhlení měřítka bloku: vyhraje první text', () => {
    const r = multi(
      [
        rectPoly(0, 0, 100, 50),
        text('Konzola', 5, 30, 5),
        ent('INSERT', [2, 'T'], [10, 5], [20, 5], [30, 0], [41, 1.0000000001], [42, 1.0000000001]),
      ],
      { entities: [], blocks: [{ name: 'T', entities: [text('S235', 0, 0, 5)] }] },
    );
    expect(r.parts.map((p) => p.name)).toEqual(['Konzola']);
  });

  it('MTEXT s normálou −Z: osa Y textu míří opačně', () => {
    const r = readDxf(
      dxf({
        entities: [
          mtext('AB\\PCD', 0, 10, 3, 1, [11, 1], [21, 0], [31, 0], [210, 0], [220, 0], [230, -1]),
        ],
      }),
    );
    expect(close(r.texts[0]!.at, { x: 1.8, y: 14 })).toBe(true);
  });

  it('MTEXT: escapované \\\\P není nový řádek', () => {
    const r = readDxf(dxf({ entities: [mtext('C:\\\\Path', 0, 10, 3, 1)] }));
    expect(r.texts[0]!.text).toBe('C:\\Path');
    // Jeden řádek: střed 1,5 mm pod bodem připojení.
    expect(r.texts[0]!.at.y).toBeCloseTo(8.5, 9);
  });

  it('TEXT pozpátku (71 = 2) a šířkový faktor 41: střed uvnitř dílu', () => {
    const r = multi([
      rectPoly(0, 0, 40, 20),
      text('DLOUHYNAZEV', 38, 5, 6, [71, 2]),
      rectPoly(100, 0, 40, 20),
      text('UZKY', 101, 5, 6, [41, 0.4]),
    ]);
    expect(r.parts.map((p) => p.name)).toEqual(['DLOUHYNAZEV', 'UZKY']);
  });

  it('horní a dolní index, řídicí znaky ^J a %%nnn', () => {
    expect(plainDxfText('m\\S2^;', true)).toBe('m2');
    expect(plainDxfText('H\\S^2;O', true)).toBe('H2O');
    expect(plainDxfText('A^JB^IC', false)).toBe('A B C');
    expect(plainDxfText('%%065%%066', false)).toBe('AB');
  });
});

describe('sameShape', () => {
  const rect = (x: number, y: number, w: number, h: number, cw = false): Contour => {
    const pts = [
      { x, y, bulge: 0 },
      { x: x + w, y, bulge: 0 },
      { x: x + w, y: y + h, bulge: 0 },
      { x, y: y + h, bulge: 0 },
    ];
    return cw ? pts.reverse() : pts;
  };
  /** Obrys začínající jiným vrcholem a s rozdělenou první hranou. */
  const reshuffled = (c: Contour, k: number): Contour => {
    const r = [...c.slice(k % c.length), ...c.slice(0, k % c.length)];
    const [a, b] = [r[0]!, r[1]!];
    return [a, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, bulge: 0 }, ...r.slice(1)];
  };

  it('vlastnost: jiný počáteční vrchol, dělení hran a pořadí otvorů = stejný tvar; posun obrysu ne', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 20, max: 500, noNaN: true }),
        fc.double({ min: 20, max: 500, noNaN: true }),
        fc.integer({ min: 0, max: 3 }),
        fc.double({ min: 0.2, max: 5, noNaN: true }),
        (w, h, k, shift) => {
          const holes = [rect(2, 2, 5, 5, true), rect(w - 9, h - 9, 5, 5, true)];
          const a: PartShape = { outer: rect(0, 0, w, h), holes };
          const b: PartShape = {
            outer: reshuffled(a.outer, k),
            holes: [reshuffled(holes[1]!, k), holes[0]!],
          };
          expect(sameShape(a, b)).toBe(true);
          const moved: PartShape = {
            outer: a.outer,
            holes: [rect(2 + shift, 2, 5, 5, true), holes[1]!],
          };
          expect(sameShape(a, moved)).toBe(false);
          const bigger: PartShape = { outer: rect(0, 0, w + shift, h), holes };
          expect(sameShape(a, bigger)).toBe(false);
        },
      ),
    );
  });

  it('oblouk proti úsečkám v toleranci; jiný počet otvorů ne', () => {
    const arc: Contour = [
      { x: 0, y: 0, bulge: 0 },
      { x: 100, y: 0, bulge: 1 },
      { x: 100, y: 50, bulge: 0 },
      { x: 0, y: 50, bulge: 0 },
    ];
    // Půlkruh r = 25 jako 64 úseček (odchylka tětiv < 0,01 mm).
    const pts = Array.from({ length: 65 }, (_, i) => {
      const t = -Math.PI / 2 + (Math.PI * i) / 64;
      return { x: 100 + 25 * Math.cos(t), y: 25 + 25 * Math.sin(t), bulge: 0 };
    });
    const lines: Contour = [{ x: 0, y: 0, bulge: 0 }, ...pts, { x: 0, y: 50, bulge: 0 }];
    expect(sameShape({ outer: arc, holes: [] }, { outer: lines, holes: [] })).toBe(true);
    expect(
      sameShape({ outer: arc, holes: [] }, { outer: arc, holes: [rect(10, 10, 5, 5, true)] }),
    ).toBe(false);
  });
});
