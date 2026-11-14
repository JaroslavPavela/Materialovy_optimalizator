import { describe, expect, it } from 'vitest';
import { readDxf } from '../../../src/core/import/dxf.ts';
import { partsFromDxf } from '../../../src/core/import/dxf-parts.ts';
import type { LayerRole } from '../../../src/core/import/layers.ts';
import type { PartNote } from '../../../src/core/model.ts';
import { noteCorners, placeNote } from '../../../src/core/notes.ts';
import { dxf, ent, lwpoly, rectPoly, type G } from './dxf-builder.ts';

const roles = (r: Record<string, LayerRole>) => new Map(Object.entries(r));
const on = (layer: string): G => [8, layer];
/** TEXT: bod vložení, výška, text a další kódy. */
const text = (x: number, y: number, h: number, value: string, ...extra: G[]) =>
  ent('TEXT', ...extra, [10, x], [20, y], [30, 0], [40, h], [1, value]);

const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const expectNote = (n: PartNote | undefined, want: Partial<PartNote>) => {
  expect(n).toBeDefined();
  const { at, ...rest } = want;
  expect(n).toMatchObject(rest);
  if (at) expect(close(n!.at.x, at.x) && close(n!.at.y, at.y)).toBe(true);
};

describe('readDxf – řádky textu s polohou', () => {
  it('TEXT vlevo na účaří; zarovnání 72/73 z bodu 11; zarovnaný text na střed úsečky', () => {
    const r = readDxf(
      dxf({
        entities: [
          text(10, 20, 5, 'VLEVO', [50, 30], [41, 0.8]),
          text(0, 0, 4, 'STRED', [72, 1], [73, 2], [11, 50], [21, 60], [31, 0]),
          text(0, 0, 3, 'ROZTAZENY', [72, 3], [11, 100], [21, 0], [31, 0]),
        ],
      }),
    );
    const lines = r.texts.map((t) => t.lines[0]!);
    expect(lines[0]).toMatchObject({
      text: 'VLEVO',
      at: { x: 10, y: 20 },
      height: 5,
      halign: 0,
      valign: 0,
      backwards: false,
    });
    expect(close(lines[0]!.rotation, 30) && close(lines[0]!.widthFactor, 0.8)).toBe(true);
    expect(lines[1]).toMatchObject({ at: { x: 50, y: 60 }, halign: 1, valign: 2 });
    expect(lines[2]).toMatchObject({ at: { x: 50, y: 0 }, halign: 1, valign: 0 });
  });

  it('MTEXT: řádky zarovnané nahoru s roztečí, bod připojení uprostřed; formátování se pozná', () => {
    const r = readDxf(
      dxf({
        entities: [
          ent(
            'MTEXT',
            [10, 100],
            [20, 100],
            [30, 0],
            [40, 6],
            [71, 5],
            [1, 'PRVNI\\Pdruhy \\fArial|b1;tucne'],
          ),
        ],
      }),
    );
    const t = r.texts[0]!;
    expect(t.formatted).toBe(true);
    expect(t.lines.map((l) => [l.text, l.halign, l.valign])).toEqual([
      ['PRVNI', 1, 3],
      ['druhy tucne', 1, 3],
    ]);
    // Celková výška 6 + 6·5/3 = 16, horní okraj 8 nad bodem připojení.
    expect(close(t.lines[0]!.at.y, 108) && close(t.lines[1]!.at.y, 98)).toBe(true);
    const plain = readDxf(
      dxf({ entities: [ent('MTEXT', [10, 0], [20, 0], [30, 0], [40, 6], [1, 'A\\PB'])] }),
    );
    expect(plain.texts[0]!.formatted).toBe(false);
  });

  it('text v bloku: natočení, měřítko a zrcadlení bloku se promítne do řádku', () => {
    const block = { name: 'B', entities: [text(10, 0, 2, 'ZNACKA')] };
    const r = readDxf(
      dxf({
        blocks: [block],
        entities: [
          ent('INSERT', [2, 'B'], [10, 100], [20, 0], [30, 0], [41, 3], [42, 3], [50, 90]),
          ent('INSERT', [2, 'B'], [10, 0], [20, 0], [30, 0], [41, -1], [42, 1]),
        ],
      }),
    );
    const [rotated, mirrored] = r.texts.map((t) => t.lines[0]!);
    expect(close(rotated!.at.x, 100) && close(rotated!.at.y, 30)).toBe(true);
    expect(close(rotated!.rotation, 90) && close(rotated!.height, 6)).toBe(true);
    expect(close(rotated!.widthFactor, 1)).toBe(true);
    expect(mirrored!.backwards).toBe(true);
    expect(close(mirrored!.at.x, -10)).toBe(true);
  });
});

describe('partsFromDxf – textové poznámky', () => {
  // Deska 200 × 100 (OBRYS), poznámka uvnitř (POZN), poznámka přes hranu
  // (POZN), text na hladině obrysu (OBRYS).
  const drawing = dxf({
    entities: [
      rectPoly(1000, 0, 200, 100, on('OBRYS')),
      text(1020, 20, 5, 'S235 tl.3', on('POZN')),
      text(1190, 50, 5, 'PRES HRANU', on('POZN')),
      text(1020, 80, 4, 'OBRYS-TEXT', on('OBRYS')),
    ],
  });

  it('texty z hladiny „přidej k dílu" v obrysu se přenesou (posunuté s dílem), přes hranu ne', () => {
    const r = partsFromDxf('d.dxf', drawing, { layerRoles: roles({ POZN: 'attach' }) });
    expect(r.errors).toEqual([]);
    const notes = r.parts[0]!.shape!.notes!;
    expect(notes).toHaveLength(1);
    expectNote(notes[0], { layer: 'POZN', text: 'S235 tl.3', at: { x: 20, y: 20 }, height: 5 });
    expect(r.warnings).toContain('Na hladině „POZN" leží 1 text mimo obrysy dílů – nepřenesen.');
    expect(r.layers.find((l) => l.name === 'POZN')).toEqual({
      name: 'POZN',
      segments: 0,
      texts: 2,
    });
  });

  it('volba „texty i z hladin obrysů": přenese i text z hladiny OBRYS; ignorovaná hladina nikdy', () => {
    const all = partsFromDxf('d.dxf', drawing, {
      layerRoles: roles({ POZN: 'attach' }),
      notesFromAllLayers: true,
    });
    expect(all.parts[0]!.shape!.notes!.map((n) => n.text).sort()).toEqual([
      'OBRYS-TEXT',
      'S235 tl.3',
    ]);
    const ignored = partsFromDxf('d.dxf', drawing, {
      layerRoles: roles({ POZN: 'ignore' }),
      notesFromAllLayers: true,
    });
    expect(ignored.parts[0]!.shape!.notes!.map((n) => n.text)).toEqual(['OBRYS-TEXT']);
    const none = partsFromDxf('d.dxf', drawing);
    expect(none.parts[0]!.shape!.notes).toBeUndefined();
  });

  it('text, který díl pojmenoval, se přenese také (více dílů v souboru)', () => {
    const r = partsFromDxf(
      'd.dxf',
      dxf({
        entities: [rectPoly(0, 0, 100, 50, on('OBRYS')), text(20, 20, 8, 'A12', on('POPIS'))],
      }),
      { mode: 'multi', layerRoles: roles({ POPIS: 'attach' }) },
    );
    expect(r.parts[0]!.name).toBe('A12');
    expect(r.parts[0]!.shape!.notes!.map((n) => n.text)).toEqual(['A12']);
  });

  it('stejný text a tvar, ale jiná poznámka: neslučuje se; stejná poznámka ano', () => {
    const plate = (x: number, note: string) => [
      rectPoly(x, 0, 100, 50, on('OBRYS')),
      text(x + 30, 30, 8, 'A1', on('POPIS')),
      text(x + 5, 5, 3, note, on('POZN')),
    ];
    const names = (a: string, b: string) =>
      partsFromDxf('d.dxf', dxf({ entities: [...plate(0, a), ...plate(200, b)] }), {
        mode: 'multi',
        layerRoles: roles({ POZN: 'attach' }),
      }).parts.map((p) => [p.name, p.quantity]);
    expect(names('S235', 'S235')).toEqual([['A1', 2]]);
    expect(names('S235', 'S355')).toEqual([
      ['A1', 1],
      ['A1-2', 1],
    ]);
  });

  it('formátovaný MTEXT: varování o ztrátě formátování', () => {
    const r = partsFromDxf(
      'd.dxf',
      dxf({
        entities: [
          rectPoly(0, 0, 200, 100, on('OBRYS')),
          ent('MTEXT', [8, 'POZN'], [10, 20], [20, 80], [30, 0], [40, 5], [1, '{\\fArial;X}']),
        ],
      }),
      { layerRoles: roles({ POZN: 'attach' }) },
    );
    expect(r.parts[0]!.shape!.notes!.map((n) => n.text)).toEqual(['X']);
    expect(r.warnings).toContain(
      'Formátování víceřádkových textů (písmo, barvy, zlomky) se nepřenáší – texty jsou prosté řádky.',
    );
  });
});

describe('noteCorners a placeNote', () => {
  const note: PartNote = {
    layer: 'P',
    text: 'ABCD',
    at: { x: 10, y: 10 },
    height: 5,
    rotation: 0,
    widthFactor: 1,
    halign: 1,
    valign: 2,
    backwards: false,
  };

  it('obdélník podle zarovnání: šířka 0,6 × výška na znak', () => {
    expect(noteCorners(note)).toEqual([
      { x: 4, y: 7.5 },
      { x: 16, y: 7.5 },
      { x: 16, y: 12.5 },
      { x: 4, y: 12.5 },
    ]);
    const left = noteCorners({ ...note, halign: 0, valign: 0 });
    expect(left[0]).toEqual({ x: 10, y: 10 });
    expect(left[2]).toEqual({ x: 22, y: 15 });
  });

  it('umístění s dílem: bod se otočí a posune, natočení se přičte (modulo 360)', () => {
    const p = placeNote({ ...note, rotation: 300 }, 90, 100, 0);
    expect(close(p.at.x, 90) && close(p.at.y, 10)).toBe(true);
    expect(close(p.rotation, 30)).toBe(true);
  });
});

describe('textové poznámky – případy z revize', () => {
  /** Obalový obdélník poznámky (min/max rohů). */
  const box = (n: Omit<PartNote, 'layer'>) => {
    const c = noteCorners(n);
    const xs = c.map((p) => p.x);
    const ys = c.map((p) => p.y);
    return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)].map(
      (v) => Math.round(v * 1e6) / 1e6,
    );
  };
  const lineOf = (entities: G[][], blocks?: Parameters<typeof dxf>[0]['blocks']) =>
    readDxf(dxf({ entities, ...(blocks && { blocks }) })).texts[0]!.lines[0]!;

  it('zrcadlený text (normála −Z, blok se záporným měřítkem) leží na správném místě', () => {
    // TEXT „ABC" výšky 5 vlevo na účaří v OCS (−95, 10) s normálou −Z → WCS
    // x = 95, text běží doleva (pozpátku): obdélník [86, 95] × [10, 15].
    const ocs = lineOf([text(-95, 10, 5, 'ABC', [230, -1])]);
    expect(ocs.backwards).toBe(true);
    expect(box(ocs)).toEqual([86, 95, 10, 15]);
    const block = { name: 'B', entities: [text(5, 10, 5, 'ABC')] };
    const insert = (sx: number, sy: number) =>
      ent('INSERT', [2, 'B'], [10, 100], [20, 0], [30, 0], [41, sx], [42, sy]);
    // Zrcadlení podle Y: text od x = 95 doleva.
    expect(box(lineOf([insert(-1, 1)], [block]))).toEqual([86, 95, 10, 15]);
    // Zrcadlení podle X: vzhůru nohama, pod osou.
    expect(box(lineOf([insert(1, -1)], [block]))).toEqual([105, 114, -15, -10]);
    // Obě osy = otočení o 180°, ne pozpátku.
    const both = lineOf([insert(-1, -1)], [block]);
    expect(both.backwards).toBe(false);
    expect(box(both)).toEqual([86, 95, -15, -10]);
  });

  it('zrcadlený text se k dílu přiřadí (dřív skončil „mimo obrysy")', () => {
    const r = partsFromDxf(
      'd.dxf',
      dxf({
        entities: [
          rectPoly(0, 0, 100, 50, on('OBRYS')),
          text(-95, 10, 5, 'ABC', on('POZN'), [230, -1]),
        ],
      }),
      { layerRoles: roles({ POZN: 'attach' }) },
    );
    expect(r.warnings.join('\n')).not.toMatch(/mimo obrysy/);
    expect(r.parts[0]!.shape!.notes!.map((n) => n.text)).toEqual(['ABC']);
  });

  it('kopie s ručně posunutým popiskem se sloučí; liší-li se texty poznámek, ne', () => {
    const plate = (x: number, dx: number, note: string) => [
      rectPoly(x, 0, 100, 50, on('OBRYS')),
      text(x + 30 + dx, 30, 8, 'A1', on('POPIS')),
      text(x + 5 + dx, 5, 3, note, on('POZN')),
    ];
    const names = (b: string) =>
      partsFromDxf('d.dxf', dxf({ entities: [...plate(0, 0, 'S235'), ...plate(200, 1, b)] }), {
        mode: 'multi',
        layerRoles: roles({ POPIS: 'attach', POZN: 'attach' }),
      });
    const merged = names('S235');
    expect(merged.parts.map((p) => [p.name, p.quantity])).toEqual([['A1', 2]]);
    expect(merged.warnings.join('\n')).not.toMatch(/ponechány zvlášť/);
    const split = names('S355');
    expect(split.parts.map((p) => [p.name, p.quantity])).toEqual([
      ['A1', 1],
      ['A1-2', 1],
    ]);
    expect(split.warnings.join('\n')).toMatch(/poznámky/);
  });

  it('text přes zářez tvaru U se nepřiřadí, text v rameni ano', () => {
    const u = [
      [0, 0],
      [100, 0],
      [100, 100],
      [70, 100],
      [70, 20],
      [30, 20],
      [30, 100],
      [0, 100],
    ] as [number, number][];
    const r = partsFromDxf(
      'u.dxf',
      dxf({
        entities: [
          lwpoly(u, on('OBRYS')),
          text(10, 60, 5, 'PRES ZAREZ ABCDEFGHIJKLMNOPQRSTUV', on('POZN')),
          text(5, 5, 5, 'DOLE', on('POZN')),
        ],
      }),
      { layerRoles: roles({ POZN: 'attach' }) },
    );
    expect(r.parts[0]!.shape!.notes!.map((n) => n.text)).toEqual(['DOLE']);
    expect(r.warnings).toContain('Na hladině „POZN" leží 1 text mimo obrysy dílů – nepřenesen.');
  });

  it('MTEXT se zalomí podle šířky rámečku; pevná mezera \\~ není formátování', () => {
    const r = readDxf(
      dxf({
        entities: [
          ent(
            'MTEXT',
            [10, 0],
            [20, 50],
            [30, 0],
            [40, 5],
            [41, 45],
            [1, 'jedna dva tri ctyri pet\\~sest'],
          ),
        ],
      }),
    );
    const t = r.texts[0]!;
    // 45 / (0,6 × 5) = 15 znaků na řádek.
    expect(t.lines.map((l) => l.text)).toEqual(['jedna dva tri', 'ctyri pet sest']);
    expect(t.formatted).toBe(false);
  });

  it('popisky z vlastního exportu (POPISKY) se s volbou „texty z obrysů" nezdvojí', () => {
    const r = partsFromDxf(
      'd.dxf',
      dxf({
        entities: [
          rectPoly(0, 0, 100, 50, on('DILY')),
          text(20, 20, 8, 'A1', on('POPISKY')),
          text(5, 5, 3, 'S235', on('DILY')),
        ],
      }),
      { mode: 'multi', notesFromAllLayers: true },
    );
    expect(r.parts[0]!.name).toBe('A1');
    expect(r.parts[0]!.shape!.notes!.map((n) => n.text)).toEqual(['S235']);
    const explicit = partsFromDxf(
      'd.dxf',
      dxf({
        entities: [rectPoly(0, 0, 100, 50, on('DILY')), text(20, 20, 8, 'A1', on('POPISKY'))],
      }),
      { mode: 'multi', layerRoles: roles({ POPISKY: 'attach' }) },
    );
    expect(explicit.parts[0]!.shape!.notes!.map((n) => n.text)).toEqual(['A1']);
  });

  it('zarovnání dole: obdélník zahrnuje dotahy pod účařím', () => {
    const n: PartNote = {
      layer: 'P',
      text: 'gy',
      at: { x: 0, y: 0 },
      height: 10,
      rotation: 0,
      widthFactor: 1,
      halign: 0,
      valign: 1,
      backwards: false,
    };
    expect(box(n)).toEqual([0, 12, 0, 13]);
  });
});
