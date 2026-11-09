import { describe, expect, it } from 'vitest';
import type { Part } from '../../src/core/model.ts';
import {
  drawingInUse,
  mergeReimport,
  type ImportedPart,
  type LoadedDrawing,
  type PartMemory,
} from '../../src/state/drawings.ts';

const part = (id: string, name: string, extra: Partial<Part> = {}): Part => ({
  id,
  name,
  width: 100,
  height: 50,
  quantity: 1,
  rotation: 'ortho',
  ...extra,
});
/** Klíče polohy ve výkresu (obalový obdélník x,y,š,v). */
const A = '0.00,300.00,100.00,50.00';
const B = '0.00,200.00,120.00,50.00';
const C = '0.00,100.00,140.00,50.00';
const D = '0.00,0.00,160.00,50.00';
/** Díl importu s polohou ve výkresu. */
const at = (origin: string, p: Part): ImportedPart => ({ part: p, origin });
const drawing = (imported: ImportedPart[], memory: PartMemory = new Map()) => ({
  imported,
  memory,
});

describe('mergeReimport', () => {
  const csv = part('csv-1', 'Police');
  const previous = [
    at(A, part('a-1', 'v-1')),
    at(B, part('a-2', 'v-2')),
    at(C, part('a-3', 'v-3')),
  ];
  const [pa, pb, pc] = previous.map((p) => p.part) as [Part, Part, Part];

  it('párování podle polohy ve výkresu: nový tvar, zachované ID a ruční úpravy, pořadí na místě výkresu', () => {
    const parts = [pa, csv, { ...pb, name: 'Bok', quantity: 7, material: 'Nerez' }, pc];
    const fresh = [
      at(A, part('b-1', 'v-1', { width: 120 })),
      at(B, part('b-2', 'v-2', { width: 130, quantity: 2 })),
      at(C, part('b-3', 'v-3', { width: 140, rotation: 'free' })),
    ];
    const r = mergeReimport(parts, drawing(previous), fresh);
    expect(r.parts).toEqual([
      part('a-1', 'v-1', { width: 120 }),
      part('a-2', 'Bok', { width: 130, quantity: 7, material: 'Nerez' }),
      part('a-3', 'v-3', { width: 140, rotation: 'free' }),
      csv,
    ]);
    // Záznam importu: hodnoty z výkresu s ID v seznamu (pro příští porovnání).
    expect(r.imported).toEqual([
      at(A, part('a-1', 'v-1', { width: 120 })),
      at(B, part('a-2', 'v-2', { width: 130, quantity: 2 })),
      at(C, part('a-3', 'v-3', { width: 140, rotation: 'free' })),
    ]);
  });

  it('posunuté názvy (díl nahoře zmizel): úpravy zůstanou u dílu na stejném místě (revize)', () => {
    // Uživatel nastavil dílu v-2 (poloha B) počet 50; díl A zmizel a ostatní
    // se přečíslovaly – v-1 je teď díl na místě B.
    const parts = [pa, { ...pb, quantity: 50 }, pc];
    const fresh = [at(B, part('b-1', 'v-1', { width: 120 })), at(C, part('b-2', 'v-2'))];
    const r = mergeReimport(parts, drawing(previous), fresh);
    expect(r.parts.map((p) => [p.id, p.name, p.width, p.quantity])).toEqual([
      ['a-2', 'v-1', 120, 50],
      ['a-3', 'v-2', 100, 1],
    ]);
  });

  it('díl, který zmizí kvůli roli hladiny, se vrátí i s ručními úpravami', () => {
    const parts = [{ ...pa, quantity: 20 }, pb, pc];
    const gone = mergeReimport(parts, drawing(previous), [at(B, pb), at(C, pc)]);
    expect(gone.parts.map((p) => p.id)).toEqual(['a-2', 'a-3']);
    const back = mergeReimport(gone.parts, { imported: gone.imported, memory: gone.memory }, [
      at(A, part('c-1', 'v-1')),
      at(B, pb),
      at(C, pc),
    ]);
    expect(back.parts.map((p) => [p.id, p.quantity])).toEqual([
      ['c-1', 20],
      ['a-2', 1],
      ['a-3', 1],
    ]);
    expect(back.memory.size).toBe(0);
  });

  it('ručně smazaná tloušťka zůstane smazaná, neupravená se převezme z výkresu', () => {
    const prev = [
      at(A, part('a-1', 'A', { thickness: 2 })),
      at(B, part('a-2', 'B', { thickness: 2 })),
    ];
    const parts = [part('a-1', 'A'), prev[1]!.part];
    const r = mergeReimport(parts, drawing(prev), [
      at(A, part('b-1', 'A', { thickness: 3 })),
      at(B, part('b-2', 'B', { thickness: 3 })),
    ]);
    expect(r.parts[0]).not.toHaveProperty('thickness');
    expect(r.parts[1]!.thickness).toBe(3);
  });

  it('díl odebraný uživatelem se nevrátí ani později, nový díl se přidá', () => {
    const parts = [csv, pa, pc];
    const r = mergeReimport(parts, drawing(previous), [
      at(A, part('b-1', 'v-1')),
      at(B, part('b-2', 'v-2')),
      at(D, part('b-3', 'v-4')),
    ]);
    expect(r.parts.map((p) => [p.id, p.name])).toEqual([
      ['csv-1', 'Police'],
      ['a-1', 'v-1'],
      ['b-3', 'v-4'],
    ]);
    expect(r.imported.map((p) => p.part.id)).toEqual(['a-1', 'b-3']);
    const again = mergeReimport(r.parts, { imported: r.imported, memory: r.memory }, [
      at(B, part('c-2', 'v-2')),
    ]);
    expect(again.parts.map((p) => p.id)).toEqual(['csv-1']);
  });

  it('poloha se smí lišit o uzavřenou mezeru (0,1 mm), víc ne', () => {
    const parts = [{ ...pa, quantity: 9 }];
    const prev = [previous[0]!];
    const near = mergeReimport(parts, drawing(prev), [
      at('0.05,300.00,100.08,50.00', part('b-1', 'v-1')),
    ]);
    expect(near.parts.map((p) => [p.id, p.quantity])).toEqual([['a-1', 9]]);
    const far = mergeReimport(parts, drawing(prev), [
      at('0.50,300.00,100.00,50.00', part('b-1', 'v-1')),
    ]);
    expect(far.parts.map((p) => [p.id, p.quantity])).toEqual([['b-1', 1]]);
  });

  it('rozdělení sloučeného dílu: úpravy dostanou obě části, sloučení zpět je převezme', () => {
    const both = `${A}|${B}`;
    const merged = at(both, part('a-1', 'A1', { quantity: 2 }));
    const parts = [{ ...merged.part, material: 'Nerez' }];
    const split = mergeReimport(parts, drawing([merged]), [
      at(A, part('b-1', 'A1')),
      at(B, part('b-2', 'A1-2')),
    ]);
    expect(split.parts.map((p) => [p.id, p.name, p.material])).toEqual([
      ['a-1', 'A1', 'Nerez'],
      ['b-2', 'A1-2', 'Nerez'],
    ]);
    // Zmizí-li kopie, podle které se díl minule spároval, najde se podle druhé.
    const rest = mergeReimport(parts, drawing([merged]), [at(B, part('b-1', 'A1'))]);
    expect(rest.parts.map((p) => [p.id, p.material])).toEqual([['a-1', 'Nerez']]);
  });

  it('výkres, který minule nedal díly, přidá nové na konec', () => {
    const r = mergeReimport([csv], drawing([]), [at(A, part('b-1', 'A'))]);
    expect(r.parts.map((p) => p.id)).toEqual(['csv-1', 'b-1']);
  });
});

describe('drawingInUse', () => {
  const loaded = (imported: ImportedPart[]): LoadedDrawing => ({
    fileName: 'a.dxf',
    data: new ArrayBuffer(0),
    kind: 'dxf',
    mode: 'single',
    layers: [],
    imported,
    memory: new Map(),
  });

  it('výkres s díly v zadání ano, bez nich ne; výkres bez dílů vždy (role ho mohou opravit)', () => {
    expect(drawingInUse(loaded([at(A, part('a-1', 'A'))]), [part('a-1', 'A')])).toBe(true);
    expect(drawingInUse(loaded([at(A, part('a-1', 'A'))]), [part('x', 'A')])).toBe(false);
    expect(drawingInUse(loaded([]), [])).toBe(true);
  });
});
