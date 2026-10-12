import { describe, expect, it } from 'vitest';
import { DEFAULT_NESTING_PARAMS, type NestingInput } from '../../../src/core/model.ts';
import { nestRects } from '../../../src/core/nesting/maxrects.ts';
import { nest, nestSteps, rectResultToNesting } from '../../../src/core/nesting/nest.ts';
import { rectInvariantViolations } from './invariants.ts';

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
