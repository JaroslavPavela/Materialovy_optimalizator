import { describe, expect, it } from 'vitest';
import { DEFAULT_NESTING_PARAMS, type NestingInput } from '../../../src/core/model.ts';
import { nestRects } from '../../../src/core/nesting/maxrects.ts';
import { nest, nestSteps, rectResultToNesting } from '../../../src/core/nesting/nest.ts';
import { rectInvariantViolations, shapeInvariantViolations } from './invariants.ts';

const input: NestingInput = {
  parts: [
    { id: 'a', name: 'A', width: 300, height: 200, quantity: 7, rotation: 'ortho' },
    { id: 'b', name: 'B', width: 450, height: 120, quantity: 5, rotation: 'locked' },
  ],
  sheets: [
    { id: 's', name: 'S', width: 1200, height: 800, stock: null, margin: 5, forbiddenZones: [] },
  ],
  params: { ...DEFAULT_NESTING_PARAMS, spacing: 4 },
};

describe('nestSteps', () => {
  it('hlásí 16 kroků a výsledek je stejný jako nestRects s metrikami', () => {
    const steps = nestSteps(input);
    const progress = [];
    let next = steps.next();
    while (!next.done) {
      progress.push(next.value);
      next = steps.next();
    }
    expect(progress.map((p) => p.step)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    expect(progress.every((p) => p.totalSteps === 16)).toBe(true);
    const outcome = next.value;
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.stopped).toBe(false);
    expect(outcome.result).toEqual(rectResultToNesting(input, nestRects(input)));
    expect(progress[15]!.best).toEqual(outcome.result);
    expect(rectInvariantViolations(input, outcome.result)).toEqual([]);
    expect(outcome.result.metrics.utilization).toBeGreaterThan(0);
  });

  it('nejlepší dosavadní výsledek se mezi kroky nezhoršuje (méně neumístěných, menší plocha)', () => {
    let prevSheets = Infinity;
    for (const p of { [Symbol.iterator]: () => nestSteps(input) }) {
      const used = p.best.layouts.length;
      expect(used).toBeLessThanOrEqual(prevSheets);
      prevSheets = used;
    }
  });

  it('neplatný vstup vrátí chyby bez výpočtu', () => {
    const bad = { ...input, sheets: [] };
    const steps = nestSteps(bad);
    const first = steps.next();
    expect(first.done).toBe(true);
    expect(first.value).toEqual({
      ok: false,
      issues: [{ field: 'sheets', message: 'Není zadána žádná tabule.' }],
    });
  });

  it('nest() = celý generátor', () => {
    const r = nest(input);
    expect(r.ok && r.result.metrics.placedCount).toBe(12);
  });
});

describe('tvarový režim', () => {
  const lPart = {
    id: 'l',
    name: 'L',
    width: 100,
    height: 100,
    quantity: 2,
    rotation: 'ortho' as const,
    shape: {
      outer: [
        { x: 0, y: 0, bulge: 0 },
        { x: 100, y: 0, bulge: 0 },
        { x: 100, y: 30, bulge: 0 },
        { x: 30, y: 30, bulge: 0 },
        { x: 30, y: 100, bulge: 0 },
        { x: 0, y: 100, bulge: 0 },
      ],
      holes: [],
    },
  };
  const shapeInput: NestingInput = {
    parts: [lPart],
    sheets: [
      { id: 's', name: 'S', width: 170, height: 150, stock: null, margin: 0, forbiddenZones: [] },
    ],
    params: { ...DEFAULT_NESTING_PARAMS, spacing: 0, mode: 'shape' },
  };

  it('zaklesnuté tvary L: tvarově 1 tabule, přes obalové obdélníky 2', () => {
    const shape = nest(shapeInput, { ga: { maxGenerations: 3, populationSize: 4 } });
    const rect = nest({ ...shapeInput, params: { ...shapeInput.params, mode: 'rect' } });
    if (!shape.ok || !rect.ok) throw new Error('výpočet selhal');
    expect(rect.result.layouts).toHaveLength(2);
    expect(shape.result.layouts).toHaveLength(1);
    expect(shapeInvariantViolations(shapeInput, shape.result)).toEqual([]);
  });

  it('obdélníky, pak optimalizátor; průběh roste do 1; nikdy horší než obdélníkový režim', () => {
    const shapeMode = { ...input, params: { ...input.params, mode: 'shape' as const } };
    const steps = nestSteps(shapeMode, { ga: { maxGenerations: 2, populationSize: 4 } });
    const fractions: number[] = [];
    let next = steps.next();
    while (!next.done) {
      fractions.push(next.value.fraction);
      next = steps.next();
    }
    // 16 kombinací MaxRects + 4 jedinci počáteční populace + 2 generace po 3 potomcích.
    expect(fractions).toHaveLength(16 + 4 + 2 * 3);
    expect(fractions.every((f, i) => f >= (fractions[i - 1] ?? 0) && f <= 1)).toBe(true);
    const rect = nest(input);
    if (!next.value.ok || !rect.ok) throw new Error('výpočet selhal');
    expect(next.value.result.metrics.utilization).toBeGreaterThanOrEqual(
      rect.result.metrics.utilization - 1e-12,
    );
    expect(shapeInvariantViolations(shapeMode, next.value.result)).toEqual([]);
  });

  it('časový limit ukončí optimalizátor', () => {
    let t = 0;
    const shapeMode = {
      ...input,
      params: { ...input.params, mode: 'shape' as const, timeLimitMs: 5 },
    };
    const steps = nestSteps(shapeMode, { now: () => (t += 1) });
    let n = 0;
    let next = steps.next();
    while (!next.done) {
      n++;
      next = steps.next();
    }
    expect(next.value.ok).toBe(true);
    expect(n).toBeLessThan(16 + 10);
  });
});
