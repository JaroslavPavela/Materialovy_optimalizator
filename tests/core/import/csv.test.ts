import fs from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  decodeCsv,
  detectDelimiter,
  matchHeader,
  parseNumber,
  parsePartsCsv,
} from '../../../src/core/import/csv.ts';
import type { Part } from '../../../src/core/model.ts';

const fixture = (name: string) =>
  parsePartsCsv(fs.readFileSync(path.join(__dirname, '../../fixtures/csv', name)));

const messages = (issues: { message: string }[]) => issues.map((i) => i.message);
const enc = (text: string) => new TextEncoder().encode(text);

describe('fixtures', () => {
  it('český Excel: Windows-1250, středník, desetinná čárka, jednotky v hlavičce', () => {
    const r = fixture('excel-cz-strednik-1250.csv');
    expect(r.encoding).toBe('windows-1250');
    expect(r.delimiter).toBe(';');
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.parts).toEqual<Part[]>([
      {
        id: 'csv-2',
        name: 'Bok skříně',
        width: 720,
        height: 560,
        quantity: 4,
        rotation: 'flip',
        material: 'DTD dub',
        thickness: 18,
      },
      {
        id: 'csv-3',
        name: 'Police',
        width: 764.5,
        height: 520,
        quantity: 6,
        rotation: 'ortho',
        material: 'DTD dub',
        thickness: 18,
      },
      {
        id: 'csv-4',
        name: 'Záda',
        width: 1200,
        height: 800,
        quantity: 1,
        rotation: 'free',
        material: 'HDF',
        thickness: 3,
      },
      {
        id: 'csv-5',
        name: 'Dvířka',
        width: 715.5,
        height: 396.8,
        quantity: 2,
        rotation: 'locked',
        material: 'DTD dub',
        thickness: 18,
      },
    ]);
  });

  it('UTF-8 s BOM, prázdná rotace = výchozí 90', () => {
    const r = fixture('utf8-bom.csv');
    expect(r.encoding).toBe('utf-8-bom');
    expect(r.errors).toEqual([]);
    expect(r.parts.map((p) => [p.name, p.width, p.rotation])).toEqual([
      ['Čelo zásuvky', 596, 'ortho'],
      ['Dno zásuvky', 550.5, 'ortho'],
      ['Ďáblík – ozdoba', 120.25, 'free'],
    ]);
  });

  it('čárka jako oddělovač, desetinná tečka, uvozovky', () => {
    const r = fixture('carka-tecka.csv');
    expect(r.delimiter).toBe(',');
    expect(r.errors).toEqual([]);
    expect(r.parts.map((p) => [p.name, p.width, p.height, p.quantity, p.material])).toEqual([
      ['Police, horní', 764.5, 300, 2, 'DTD'],
      ['Bok', 720, 560, 4, 'DTD'],
      ['Krycí lišta "A"', 1200.75, 50.5, 8, undefined],
    ]);
  });

  it('tabulátor', () => {
    const r = fixture('tabulator.tsv');
    expect(r.delimiter).toBe('\t');
    expect(r.errors).toEqual([]);
    expect(r.parts.map((p) => [p.name, p.width, p.height, p.quantity])).toEqual([
      ['Deska A', 1000, 500, 2],
      ['Deska B', 250.5, 125, 12],
    ]);
  });

  it('bez hlavičky – pevné pořadí sloupců, prázdný řádek přeskočen', () => {
    const r = fixture('bez-hlavicky.csv');
    expect(r.errors).toEqual([]);
    expect(r.parts.map((p) => [p.id, p.name, p.width, p.height, p.quantity, p.material])).toEqual([
      ['csv-1', 'Díl 1', 400, 300, 5, 'Plech DC01'],
      ['csv-2', 'Díl 2', 250.5, 125, 2, 'Plech DC01'],
      ['csv-4', 'Díl 3', 100, 100, 20, undefined],
    ]);
  });

  it('chybné řádky: přeskočí je, nahlásí s číslem řádku jako v Excelu', () => {
    const r = fixture('chyby.csv');
    expect(messages(r.errors)).toEqual([
      'Řádek 3: šířka „12,a" není číslo.',
      'Řádek 5: výška musí být větší než 0 (je -5).',
      'Řádek 6: chybí počet.',
      'Řádek 7: chybí název.',
      'Řádek 8: počet „1,5" není celé číslo.',
      'Řádek 9: šířka musí být větší než 0 (je 0).',
      'Řádek 11: rotace „45" není platná (povoleno: volne, 90, 180, zadna).',
    ]);
    expect(r.errors.map((e) => [e.row, e.column])).toEqual([
      [3, 'sirka'],
      [5, 'vyska'],
      [6, 'pocet'],
      [7, 'nazev'],
      [8, 'pocet'],
      [9, 'sirka'],
      [11, 'rotace'],
    ]);
    expect(messages(r.warnings)).toEqual(['Řádek 12: neobvykle velký počet kusů (20000).']);
    expect(r.parts.map((p) => [p.id, p.name, p.quantity, p.rotation])).toEqual([
      ['csv-2', 'Dobrý díl', 2, 'ortho'],
      ['csv-12', 'Velký počet', 20000, 'ortho'],
      ['csv-13', 'Poslední dobrý', 3, 'locked'],
    ]);
  });

  it('anglická hlavička v jiném pořadí', () => {
    const r = fixture('anglicka-hlavicka.csv');
    expect(r.errors).toEqual([]);
    expect(r.parts).toEqual<Part[]>([
      {
        id: 'csv-2',
        name: 'Side panel',
        width: 720,
        height: 560,
        quantity: 2,
        rotation: 'flip',
        material: 'Oak',
        thickness: 18,
      },
      {
        id: 'csv-3',
        name: 'Shelf',
        width: 764.5,
        height: 520,
        quantity: 6,
        rotation: 'ortho',
        material: 'Oak',
        thickness: 18,
      },
      {
        id: 'csv-4',
        name: 'Back',
        width: 1200,
        height: 800,
        quantity: 1,
        rotation: 'free',
        material: 'HDF',
        thickness: 3,
      },
    ]);
  });

  it('Excel „Text v kódování Unicode" (UTF-16LE, tabulátor)', () => {
    const r = fixture('excel-unicode-utf16.txt');
    expect(r.encoding).toBe('utf-16le');
    expect(r.delimiter).toBe('\t');
    expect(r.parts.map((p) => [p.name, p.width, p.quantity])).toEqual([
      ['Žebro', 320.5, 14],
      ['Úchyt', 40, 28],
    ]);
  });

  it('víceřádkový název v uvozovkách nerozhodí čísla řádků', () => {
    const r = fixture('viceradkovy-nazev.csv');
    expect(r.parts.map((p) => [p.id, p.name])).toEqual([['csv-2', 'Deska\ns poznámkou']]);
    expect(messages(r.errors)).toEqual(['Řádek 4: šířka „x" není číslo.']);
  });

  it('chybějící povinný sloupec v hlavičce', () => {
    const r = fixture('chybi-sloupec.csv');
    expect(r.parts).toEqual([]);
    expect(r.errors).toEqual([{ row: 1, message: 'V hlavičce chybí povinný sloupec „výška".' }]);
  });

  it('velký soubor s 1000 díly', () => {
    const r = fixture('velky-1000-dilu.csv');
    expect(r.errors).toEqual([]);
    expect(r.parts).toHaveLength(1000);
    expect(new Set(r.parts.map((p) => p.id)).size).toBe(1000);
    expect(r.parts[0]!.name).toBe('Díl 1');
    expect(r.parts[999]!.id).toBe('csv-1001');
    for (const p of r.parts) {
      expect(p.width).toBeGreaterThan(0);
      expect(p.height).toBeGreaterThan(0);
      expect(Number.isInteger(p.quantity)).toBe(true);
    }
  });
});

describe('okrajové vstupy', () => {
  it('prázdný soubor a soubor jen s hlavičkou', () => {
    expect(messages(parsePartsCsv(new Uint8Array()).errors)).toEqual([
      'Soubor neobsahuje žádné díly.',
    ]);
    expect(messages(parsePartsCsv(enc('název;šířka;výška;počet\r\n')).errors)).toEqual([
      'Soubor neobsahuje žádné díly.',
    ]);
  });

  it('nerozpoznaná hlavička', () => {
    const r = parsePartsCsv(enc('foo;bar;baz\nA;B;C\n'));
    expect(r.parts).toEqual([]);
    expect(r.errors[0]?.message).toMatch(/^Nerozpoznaná hlavička/);
  });

  it('neznámý a zdvojený sloupec v hlavičce = varování', () => {
    const r = parsePartsCsv(enc('název;šířka;výška;počet;poznámka;Šířka\nA;10;20;1;x;99\n'));
    expect(r.errors).toEqual([]);
    expect(messages(r.warnings)).toEqual([
      'Neznámý sloupec „poznámka" se ignoruje.',
      'Sloupec „šířka" je v hlavičce víckrát, použije se první.',
    ]);
    expect(r.parts[0]?.width).toBe(10);
  });

  it('kratší řádek než hlavička = chybějící hodnoty', () => {
    const r = parsePartsCsv(enc('název;šířka;výška;počet\nA;10\n'));
    expect(messages(r.errors)).toEqual(['Řádek 2: chybí výška.', 'Řádek 2: chybí počet.']);
  });

  it('vlastní předpona ID', () => {
    const r = parsePartsCsv(enc('název;šířka;výška;počet\nA;10;20;1\n'), { idPrefix: 'soubor' });
    expect(r.parts[0]?.id).toBe('soubor-2');
  });

  it('přijme ArrayBuffer', () => {
    const r = parsePartsCsv(enc('název;šířka;výška;počet\nA;10;20;1\n').buffer);
    expect(r.parts).toHaveLength(1);
  });

  it('staré konce řádků CR (Mac)', () => {
    const r = parsePartsCsv(enc('název;šířka;výška;počet\rA;10;20;1\rB;x;20;1\r'));
    expect(r.parts).toHaveLength(1);
    expect(messages(r.errors)).toEqual(['Řádek 3: šířka „x" není číslo.']);
  });
});

describe('parseNumber', () => {
  it.each([
    ['12', 12],
    ['12,5', 12.5],
    ['12.5', 12.5],
    ['1 250,5', 1250.5],
    ['1 250', 1250],
    ['-5', -5],
    ['+3', 3],
    ['.5', 0.5],
    ['7,', 7],
  ])('„%s" → %s', (raw, value) => {
    expect(parseNumber(raw)).toEqual({ ok: true, value });
  });

  it.each(['12,a', '1,250.5', '1e3', '0x10', 'Infinity', 'NaN', '--1', '1,2,3', 'abc'])(
    '„%s" není číslo',
    (raw) => {
      expect(parseNumber(raw)).toEqual({ ok: false, empty: false });
    },
  );

  it('prázdná hodnota', () => {
    expect(parseNumber('')).toEqual({ ok: false, empty: true });
    expect(parseNumber('   ')).toEqual({ ok: false, empty: true });
  });

  it('property: číslo zapsané s čárkou i tečkou se přečte zpět', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1e7 }), fc.integer({ min: 0, max: 99 }), (a, b) => {
        const dot = `${a}.${String(b).padStart(2, '0')}`;
        const expected = Number(dot);
        expect(parseNumber(dot)).toEqual({ ok: true, value: expected });
        expect(parseNumber(dot.replace('.', ','))).toEqual({ ok: true, value: expected });
      }),
    );
  });
});

describe('matchHeader', () => {
  it.each([
    ['Šířka', 'sirka'],
    ['ŠÍŘKA (mm)', 'sirka'],
    ['  sirka ', 'sirka'],
    ['Výška [mm]', 'vyska'],
    ['Počet ks', null],
    ['ks', 'pocet'],
    ['Qty', 'pocet'],
    ['Tloušťka (mm)', 'tloustka'],
    ['Materiál', 'material'],
    ['Název dílu', null],
    ['Natočení', 'rotace'],
  ])('„%s" → %s', (cell, key) => {
    expect(matchHeader(cell)).toBe(key);
  });
});

describe('decodeCsv a detectDelimiter', () => {
  it('neplatné UTF-8 → Windows-1250', () => {
    // „Šířka" ve Windows-1250
    const r = decodeCsv(Uint8Array.of(0x8a, 0xed, 0xf8, 0x6b, 0x61));
    expect(r).toEqual({ text: 'Šířka', encoding: 'windows-1250' });
  });

  it('UTF-16BE s BOM', () => {
    expect(decodeCsv(Uint8Array.of(0xfe, 0xff, 0x00, 0x41, 0x01, 0x0d))).toEqual({
      text: 'Ač',
      encoding: 'utf-16be',
    });
  });

  it('středník má přednost před čárkou v desetinných číslech', () => {
    expect(detectDelimiter('a;1,5;2\nb;2,5;3\n')).toBe(';');
    expect(detectDelimiter('a,1.5,2\nb,2.5,3\n')).toBe(',');
    expect(detectDelimiter('a\t1,5\t2\n')).toBe('\t');
  });

  it('jediný sloupec → výchozí středník', () => {
    expect(detectDelimiter('abc\ndef\n')).toBe(';');
  });
});

describe('property: zápis → čtení', () => {
  const arbPartRow = fc.record({
    name: fc
      .string({ minLength: 1, maxLength: 20 })
      .filter((s) => s.trim() === s && s.trim() !== '' && !/[\r\n]/.test(s)),
    width: fc.integer({ min: 1, max: 400000 }).map((v) => v / 100),
    height: fc.integer({ min: 1, max: 400000 }).map((v) => v / 100),
    quantity: fc.integer({ min: 1, max: 10000 }),
    rotation: fc.constantFrom(
      ['volne', 'free'] as const,
      ['90', 'ortho'] as const,
      ['180', 'flip'] as const,
      ['zadna', 'locked'] as const,
    ),
  });

  const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;

  it('díly zapsané v libovolném formátu se přečtou beze ztráty', () => {
    fc.assert(
      fc.property(
        fc.array(arbPartRow, { minLength: 1, maxLength: 20 }),
        fc.constantFrom(';', ',', '\t'),
        fc.constantFrom('\r\n', '\n'),
        fc.boolean(),
        (rows, delimiter, eol, bom) => {
          const num = (v: number) => (delimiter === ',' ? String(v) : String(v).replace('.', ','));
          const text =
            ['název', 'šířka', 'výška', 'počet', 'rotace'].join(delimiter) +
            eol +
            rows
              .map((r) =>
                [quote(r.name), num(r.width), num(r.height), r.quantity, r.rotation[0]].join(
                  delimiter,
                ),
              )
              .join(eol) +
            eol;
          const bytes = enc(text);
          const data = bom ? Uint8Array.of(0xef, 0xbb, 0xbf, ...bytes) : bytes;
          const result = parsePartsCsv(data);
          expect(result.errors).toEqual([]);
          expect(result.delimiter).toBe(delimiter);
          expect(
            result.parts.map((p) => [p.name, p.width, p.height, p.quantity, p.rotation]),
          ).toEqual(rows.map((r) => [r.name, r.width, r.height, r.quantity, r.rotation[1]]));
        },
      ),
      { numRuns: 200 },
    );
  });
});
