// Výkonový benchmark kroku 5.7 – samostatně: `npm run bench` (desítky sekund).
import { describe, expect, it } from 'vitest';
import { DEFAULT_NESTING_PARAMS, type NestingInput, type Part } from '../../src/core/model.ts';
import { compareRectResults } from '../../src/core/nesting/maxrects.ts';
import { nest, nestSteps } from '../../src/core/nesting/nest.ts';
import { shapeInvariantViolations } from '../core/nesting/invariants.ts';

/** 10 různých hvězdicových tvarů s oblouky, po 20 kusech = 200 dílů. */
function benchmarkInput(): NestingInput {
  const parts: Part[] = Array.from({ length: 10 }, (_, k) => {
    const n = 6 + (k % 4);
    const outer = Array.from({ length: n * 2 }, (_, i) => {
      const a = (Math.PI * i) / n;
      const r = (i % 2 ? 25 : 60) + k * 3;
      return { x: 80 + r * Math.cos(a), y: 80 + r * Math.sin(a), bulge: i % 3 === 0 ? 0.15 : 0 };
    });
    const xs = outer.map((p) => p.x);
    const ys = outer.map((p) => p.y);
    const mx = Math.min(...xs);
    const my = Math.min(...ys);
    return {
      id: `p${k}`,
      name: `Tvar ${k}`,
      width: Math.max(...xs) - mx,
      height: Math.max(...ys) - my,
      quantity: 20,
      rotation: 'ortho',
      shape: { outer: outer.map((p) => ({ ...p, x: p.x - mx, y: p.y - my })), holes: [] },
    };
  });
  return {
    parts,
    sheets: [
      {
        id: 's',
        name: 'Plech',
        width: 3000,
        height: 1500,
        stock: null,
        margin: 10,
        forbiddenZones: [],
      },
    ],
    params: { ...DEFAULT_NESTING_PARAMS, spacing: 6, mode: 'shape', timeLimitMs: 15_000 },
  };
}

describe('benchmark 200 dílů / 10 tvarů', () => {
  it('první výsledek do 5 s, tvarový výsledek ne horší než přes obalové obdélníky', () => {
    const input = benchmarkInput();
    const t0 = performance.now();
    const steps = nestSteps(input);
    let next = steps.next();
    const first = performance.now() - t0;
    expect(first).toBeLessThan(5000);
    while (!next.done) next = steps.next();
    const total = performance.now() - t0;
    if (!next.value.ok) throw new Error('výpočet selhal');
    const shape = next.value.result;
    const rect = nest({ ...input, params: { ...input.params, mode: 'rect' } });
    if (!rect.ok) throw new Error('výpočet selhal');
    expect(compareRectResults(input, shape, rect.result)).toBeLessThanOrEqual(0);
    expect(shapeInvariantViolations(input, shape)).toEqual([]);
    console.log(
      `první výsledek ${Math.round(first)} ms, celkem ${Math.round(total)} ms, ` +
        `využití tvarově ${(shape.metrics.utilization * 100).toFixed(1)} % ` +
        `(obdélníky ${(rect.result.metrics.utilization * 100).toFixed(1)} %), ` +
        `tabulí ${shape.layouts.length} / ${rect.result.layouts.length}`,
    );
  }, 180_000);
});
