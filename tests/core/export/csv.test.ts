import fc from 'fast-check';
import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';
import {
  csvNumber,
  csvPercent,
  csvText,
  RESULT_CSV_HEADER,
  writeResultCsv,
} from '../../../src/core/export/csv.ts';
import {
  DEFAULT_NESTING_PARAMS,
  type NestingInput,
  type NestingResult,
  type Part,
  type Sheet,
} from '../../../src/core/model.ts';
import { nest } from '../../../src/core/nesting/nest.ts';
import { arbRectParts } from '../arbitraries.ts';

/** Načte výstup zpět (bez BOM) jako pole řádků. */
function readBack(text: string): string[][] {
  expect(text.startsWith('﻿')).toBe(true);
  const r = Papa.parse<string[]>(text.slice(1), { delimiter: ';', newline: '\r\n' });
  expect(r.errors).toEqual([]);
  return r.data;
}

const sheet: Sheet = {
  id: 's',
  name: 'DTD 2800 × 2070; bílá',
  width: 2800,
  height: 2070,
  stock: null,
  margin: 10,
  forbiddenZones: [],
};
const parts: Part[] = [
  { id: 'a', name: 'Bok "L"', width: 720.5, height: 560, quantity: 3, rotation: 'ortho' },
  { id: 'b', name: '=SUM(A1)', width: 300, height: 120.25, quantity: 2, rotation: 'locked' },
  { id: 'c', name: 'Obr', width: 5000, height: 100, quantity: 1, rotation: 'locked' },
];
const input: NestingInput = { parts, sheets: [sheet], params: DEFAULT_NESTING_PARAMS };
const result: NestingResult = {
  layouts: [
    {
      sheetId: 's',
      placements: [
        { partId: 'a', instance: 0, x: 0, y: 0, rotation: 0 },
        { partId: 'b', instance: 0, x: 0, y: 600, rotation: 0 },
        { partId: 'a', instance: 1, x: 800, y: 0, rotation: 0 },
        { partId: 'a', instance: 2, x: 2000, y: 0, rotation: 90 },
      ],
    },
    { sheetId: 's', placements: [{ partId: 'b', instance: 1, x: 0, y: 0, rotation: 0 }] },
  ],
  unplaced: [{ partId: 'c', instance: 0, reason: 'too-large' }],
  metrics: {
    sheets: [],
    utilization: 0.7591,
    waste: 0.2409,
    placedCount: 5,
    unplacedCount: 1,
  },
};

describe('formát buněk', () => {
  it('čísla s desetinnou čárkou a procenta', () => {
    expect(csvNumber(720.5)).toBe('720,5');
    expect(csvNumber(2800)).toBe('2800');
    expect(csvNumber(-0.0001)).toBe('0');
    expect(csvNumber(1 / 3)).toBe('0,333');
    expect(csvPercent(0.7591)).toBe('75,9 %');
  });

  it('text: uvozovky jen když je potřeba, ochrana proti vzorcům', () => {
    expect(csvText('Bok')).toBe('Bok');
    expect(csvText('a;b')).toBe('"a;b"');
    expect(csvText('Bok "L"')).toBe('"Bok ""L"""');
    expect(csvText('řádek\nnový')).toBe('"řádek\nnový"');
    expect(csvText('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvText('-5')).toBe("'-5");
    expect(csvText('@x;y')).toBe('"\'@x;y"');
  });
});

describe('writeResultCsv', () => {
  const text = writeResultCsv(input, result);
  const rows = readBack(text);

  it('UTF-8 s BOM, CRLF, hlavička', () => {
    expect(text.split('\r\n').length).toBe(text.split('\n').length);
    expect(rows[0]).toEqual([...RESULT_CSV_HEADER]);
  });

  it('díly po tabulích, stejné natočení sečtené, pořadí podle prvního výskytu', () => {
    expect(rows.slice(1, 5)).toEqual([
      ['1', 'DTD 2800 × 2070; bílá', 'Bok "L"', '2', '720,5', '560', '0'],
      ['1', 'DTD 2800 × 2070; bílá', "'=SUM(A1)", '1', '300', '120,25', '0'],
      ['1', 'DTD 2800 × 2070; bílá', 'Bok "L"', '1', '720,5', '560', '90'],
      ['2', 'DTD 2800 × 2070; bílá', "'=SUM(A1)", '1', '300', '120,25', '0'],
    ]);
  });

  it('souhrnný řádek a neumístěné díly s důvodem', () => {
    expect(rows.slice(5)).toEqual([
      [''],
      ['souhrn', 'tabulí', 'využití', 'umístěno', 'neumístěno', 'odpad', ''],
      ['', '2', '75,9 %', '5', '1', '24,1 %', ''],
      [''],
      ['neumístěno', 'důvod', 'díl', 'počet', 'šířka', 'výška', ''],
      ['', 'větší než tabule', 'Obr', '1', '5000', '100', ''],
      [''],
    ]);
  });

  it('bez neumístěných dílů blok chybí', () => {
    const ok = writeResultCsv(input, { ...result, unplaced: [] });
    expect(ok).not.toContain('neumístěno;důvod');
  });

  it('neznámá tabule nebo díl je chyba', () => {
    expect(() => writeResultCsv({ ...input, sheets: [] }, result)).toThrow(RangeError);
    expect(() => writeResultCsv({ ...input, parts: [] }, result)).toThrow(RangeError);
  });

  it('property: součet počtů po tabulích odpovídá umístěným kusům', () => {
    fc.assert(
      fc.property(arbRectParts(), (ps) => {
        const inp: NestingInput = { parts: ps, sheets: [sheet], params: DEFAULT_NESTING_PARAMS };
        const outcome = nest(inp);
        if (!outcome.ok) return;
        const r = outcome.result;
        const data = readBack(writeResultCsv(inp, r));
        const body = data.slice(
          1,
          data.findIndex((d) => d.length === 1),
        );
        r.layouts.forEach((l, i) => {
          const sum = body
            .filter((d) => d[0] === String(i + 1))
            .reduce((s, d) => s + Number(d[3]), 0);
          expect(sum).toBe(l.placements.length);
        });
        expect(body.every((d) => d.length === RESULT_CSV_HEADER.length)).toBe(true);
      }),
      { numRuns: 40 },
    );
  });
});
