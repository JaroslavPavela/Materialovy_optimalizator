import fc from 'fast-check';
import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';
import { GROUPED_CSV_HEADER, writeResultCsv } from '../../src/core/export/csv.ts';
import { writeResultDxf } from '../../src/core/export/dxf-writer.ts';
import { sheetFileName } from '../../src/core/export/files.ts';
import { writeResultSvg } from '../../src/core/export/svg.ts';
import { EPS } from '../../src/core/geometry/eps.ts';
import {
  DEFAULT_NESTING_PARAMS,
  type NestingInput,
  type NestingResult,
  type Placement,
  type SheetLayout,
  type SheetMetrics,
} from '../../src/core/model.ts';
import { nest } from '../../src/core/nesting/nest.ts';
import {
  groupIdenticalSheets,
  sheetGroups,
  sheetNumbersText,
  singleSheetGroups,
} from '../../src/core/sheet-groups.ts';
import { arbRectParts } from './arbitraries.ts';

const metric: SheetMetrics = { partArea: 1, sheetArea: 1, utilization: 1, remnant: null };

/** Výsledek z ručně zadaných rozložení (metriky jen kvůli zbytku). */
function resultOf(layouts: SheetLayout[], remnants?: SheetMetrics['remnant'][]): NestingResult {
  return {
    layouts,
    unplaced: [],
    metrics: {
      sheets: layouts.map((_, i) => ({ ...metric, remnant: remnants?.[i] ?? null })),
      utilization: 1,
      waste: 0,
      placedCount: layouts.reduce((n, l) => n + l.placements.length, 0),
      unplacedCount: 0,
    },
  };
}

const pl = (partId: string, instance: number, x: number, y: number, rotation = 0): Placement => ({
  partId,
  instance,
  x,
  y,
  rotation,
});

const indices = (r: NestingResult) => groupIdenticalSheets(r).map((g) => g.indices);

describe('groupIdenticalSheets', () => {
  it('seskupí tabule se stejnými díly na stejných místech bez ohledu na číslo kusu a pořadí', () => {
    const r = resultOf([
      { sheetId: 's', placements: [pl('a', 0, 0, 0), pl('b', 0, 100, 0)] },
      { sheetId: 's', placements: [pl('b', 1, 100, 0), pl('a', 1, 0, 0)] },
      { sheetId: 's', placements: [pl('a', 2, 0, 0)] },
      { sheetId: 's', placements: [pl('a', 3, 0, 0), pl('b', 2, 100, 0)] },
    ]);
    expect(indices(r)).toEqual([[0, 1, 3], [2]]);
  });

  it('rozliší formát tabule, polohu nad EPS, natočení a díl', () => {
    const base = [pl('a', 0, 0, 0, 90)];
    const r = resultOf([
      { sheetId: 's', placements: base },
      { sheetId: 't', placements: base },
      { sheetId: 's', placements: [pl('a', 1, 3 * EPS, 0, 90)] },
      { sheetId: 's', placements: [pl('a', 1, 0, 0, 0)] },
      { sheetId: 's', placements: [pl('b', 0, 0, 0, 90)] },
    ]);
    expect(indices(r)).toEqual([[0], [1], [2], [3], [4]]);
  });

  it('polohu a natočení porovnává v toleranci (i přes 360° → 0°)', () => {
    const r = resultOf([
      { sheetId: 's', placements: [pl('a', 0, 10, 20, 0)] },
      { sheetId: 's', placements: [pl('a', 1, 10 + EPS / 10, 20 - EPS / 10, 360 - 1e-9)] },
    ]);
    expect(indices(r)).toEqual([[0, 1]]);
  });

  it('tabule s jiným zbytkem neseskupí (export by se lišil)', () => {
    const layout = { sheetId: 's', placements: [pl('a', 0, 0, 0)] };
    const rem = { x: 100, y: 0, width: 50, height: 50 };
    expect(indices(resultOf([layout, layout], [rem, null]))).toEqual([[0], [1]]);
    expect(indices(resultOf([layout, layout], [rem, { ...rem }]))).toEqual([[0, 1]]);
  });

  it('prázdný výsledek dá prázdné skupiny', () => {
    expect(groupIdenticalSheets(resultOf([]))).toEqual([]);
  });

  it('opakované tabule ze skutečného výpočtu dají jednu skupinu', () => {
    const input: NestingInput = {
      parts: [
        { id: 'p', name: 'Čtverec', width: 500, height: 500, quantity: 40, rotation: 'ortho' },
      ],
      sheets: [
        {
          id: 's',
          name: 'Deska',
          width: 1000,
          height: 1000,
          stock: null,
          margin: 0,
          forbiddenZones: [],
        },
      ],
      params: { ...DEFAULT_NESTING_PARAMS, spacing: 0 },
    };
    const outcome = nest(input);
    if (!outcome.ok) throw new Error('výpočet selhal');
    const r = outcome.result;
    expect(r.layouts).toHaveLength(10);
    const groups = groupIdenticalSheets(r);
    expect(groups.map((g) => g.indices)).toEqual([[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]]);

    // Exporty: jeden soubor na skupinu, počet opakování v názvu.
    expect(writeResultDxf(input, r, 'plan', {}, groups).map((f) => f.name)).toEqual([
      'plan-tabule-01-10x.dxf',
    ]);
    expect(writeResultSvg(input, r, 'plan', groups).map((f) => f.name)).toEqual([
      'plan-tabule-01-10x.svg',
    ]);
    // Bez skupin beze změny – soubor na tabuli.
    expect(writeResultDxf(input, r, 'plan')).toHaveLength(10);

    const rows = Papa.parse<string[]>(writeResultCsv(input, r, groups).slice(1), {
      delimiter: ';',
      newline: '\r\n',
    }).data;
    expect(rows[0]).toEqual([...GROUPED_CSV_HEADER]);
    expect(rows[1]).toEqual(['1', '10', 'Deska', 'Čtverec', '4', '40', '500', '500', '0']);
    const summary = rows.findIndex((row) => row[0] === 'souhrn');
    expect(rows[summary]).toContain('různých tabulí');
    expect(rows[summary + 1]!.slice(0, 2)).toEqual(['', '10']);
    expect(rows[summary + 1]![6]).toBe('1');
  });

  it('skupiny rozdělí tabule beze zbytku a členové skupiny mají stejné rozmístění', () => {
    fc.assert(
      fc.property(arbRectParts(), fc.integer({ min: 1, max: 5 }), (ps, mult) => {
        const input: NestingInput = {
          // Více kusů → víc tabulí, aby se opakování objevilo.
          parts: ps.map((p) => ({ ...p, quantity: p.quantity * mult })),
          sheets: [
            {
              id: 's',
              name: 'S',
              width: 1200,
              height: 800,
              stock: null,
              margin: 5,
              forbiddenZones: [],
            },
          ],
          params: DEFAULT_NESTING_PARAMS,
        };
        const outcome = nest(input);
        if (!outcome.ok) return;
        const r = outcome.result;
        const groups = groupIdenticalSheets(r);
        const all = groups.flatMap((g) => g.indices).sort((a, b) => a - b);
        expect(all).toEqual(r.layouts.map((_, i) => i));
        for (const { indices: ix } of groups) {
          expect(ix).toEqual([...ix].sort((a, b) => a - b));
          const key = (i: number) =>
            r.layouts[i]!.placements.map(
              (p) => `${p.partId}@${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.rotation)}`,
            )
              .sort()
              .join('|');
          for (const i of ix) {
            expect(r.layouts[i]!.sheetId).toBe(r.layouts[ix[0]!]!.sheetId);
            expect(key(i)).toBe(key(ix[0]!));
          }
        }
        // Celkový počet kusů v seskupeném CSV = počet umístěných.
        const rows = Papa.parse<string[]>(writeResultCsv(input, r, groups).slice(1), {
          delimiter: ';',
          newline: '\r\n',
        }).data;
        const end = rows.findIndex((row) => row.length === 1);
        const total = rows.slice(1, end).reduce((n, row) => n + Number(row[5]), 0);
        expect(total).toBe(r.metrics.placedCount);
      }),
      { numRuns: 40 },
    );
  });
});

describe('sheetGroups, singleSheetGroups', () => {
  it('bez seskupení je každá tabule samostatně', () => {
    const layout = { sheetId: 's', placements: [pl('a', 0, 0, 0)] };
    const r = resultOf([layout, layout]);
    expect(singleSheetGroups(r)).toEqual([{ indices: [0] }, { indices: [1] }]);
    expect(sheetGroups(r, false)).toEqual(singleSheetGroups(r));
    expect(sheetGroups(r, true)).toEqual([{ indices: [0, 1] }]);
  });
});

describe('sheetNumbersText', () => {
  it('čísla tabulí jako úseky', () => {
    expect(sheetNumbersText([0])).toBe('1');
    expect(sheetNumbersText([0, 1, 2, 4])).toBe('1–3, 5');
    expect(sheetNumbersText([1, 3, 4])).toBe('2, 4–5');
    expect(sheetNumbersText([])).toBe('');
  });
});

describe('sheetFileName s opakováním', () => {
  it('přidá počet jen při opakování', () => {
    expect(sheetFileName('plán', 0, 3, 'dxf', 1)).toBe('plan-tabule-01.dxf');
    expect(sheetFileName('plán', 2, 3, 'dxf', 4)).toBe('plan-tabule-03-4x.dxf');
  });
});
