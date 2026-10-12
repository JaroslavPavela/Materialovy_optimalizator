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
    const shape = nest(shapeInput);
    const rect = nest({ ...shapeInput, params: { ...shapeInput.params, mode: 'rect' } });
    if (!shape.ok || !rect.ok) throw new Error('výpočet selhal');
    expect(rect.result.layouts).toHaveLength(2);
    expect(shape.result.layouts).toHaveLength(1);
    expect(shapeInvariantViolations(shapeInput, shape.result)).toEqual([]);
  });

  it('o krok víc než obdélníkový režim a nikdy horší výsledek', () => {
    const shapeMode = { ...input, params: { ...input.params, mode: 'shape' as const } };
    const steps = nestSteps(shapeMode);
    let n = 0;
    let next = steps.next();
    while (!next.done) {
      n++;
      expect(next.value.totalSteps).toBe(17);
      next = steps.next();
    }
    expect(n).toBe(17);
    const rect = nest(input);
    if (!next.value.ok || !rect.ok) throw new Error('výpočet selhal');
    expect(next.value.result.metrics.utilization).toBeGreaterThanOrEqual(
      rect.result.metrics.utilization - 1e-12,
    );
    expect(shapeInvariantViolations(shapeMode, next.value.result)).toEqual([]);
  });
});
