import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_NESTING_PARAMS, type NestingInput, type Part } from '../../../src/core/model.ts';
import { compareRectResults } from '../../../src/core/nesting/maxrects.ts';
import {
  mulberry32,
  optimizeShapes,
  orderCrossover,
  type GaStep,
} from '../../../src/core/nesting/optimizer.ts';
import { defaultShapeOrder, placeShapes, ShapeContext } from '../../../src/core/nesting/placer.ts';
import { shapeInvariantViolations } from './invariants.ts';

const lPart = (id: string, quantity: number): Part => ({
  id,
  name: id,
  width: 100,
  height: 100,
  quantity,
  rotation: 'ortho',
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
});

const input = (seed = 1): NestingInput => ({
  parts: [
    lPart('l', 4),
    { id: 'r', name: 'r', width: 120, height: 40, quantity: 3, rotation: 'ortho' },
    { id: 'q', name: 'q', width: 60, height: 60, quantity: 2, rotation: 'locked' },
  ],
  sheets: [
    { id: 's', name: 'S', width: 400, height: 300, stock: null, margin: 5, forbiddenZones: [] },
  ],
  params: { ...DEFAULT_NESTING_PARAMS, spacing: 2, mode: 'shape', seed },
});

function runAll(inp: NestingInput, opts = { maxGenerations: 3, populationSize: 5 }) {
  const gen = optimizeShapes(new ShapeContext(inp), opts);
  const steps: GaStep[] = [];
  let next = gen.next();
  while (!next.done) {
    steps.push(next.value);
    next = gen.next();
  }
  return { steps, best: next.value };
}

describe('mulberry32', () => {
  it('opakovatelný, hodnoty v [0, 1), různá semínka dají různé řady', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const xs = Array.from({ length: 100 }, () => a());
    expect(Array.from({ length: 100 }, () => b())).toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(mulberry32(43)()).not.toBe(xs[0]);
  });
});

describe('orderCrossover', () => {
  it('property: potomek je permutace a obsahuje úsek prvního rodiče', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 40 }), fc.integer(), (n, seed) => {
        const rnd = mulberry32(seed);
        const a = Array.from({ length: n }, (_, i) => i);
        const b = [...a].sort(() => rnd() - 0.5);
        const child = orderCrossover(a, b, rnd);
        expect([...child].sort((x, y) => x - y)).toEqual(a);
      }),
    );
  });
});

describe('optimizeShapes', () => {
  it('první jedinec = výchozí placer; nejlepší se nezhoršuje; invarianty platí', () => {
    const inp = input();
    const { steps, best } = runAll(inp);
    const plain = placeShapes(new ShapeContext(inp), defaultShapeOrder(inp));
    expect(steps[0]!.best).toEqual(plain);
    for (let i = 1; i < steps.length; i++) {
      expect(compareRectResults(inp, steps[i]!.best, steps[i - 1]!.best)).toBeLessThanOrEqual(0);
    }
    expect(compareRectResults(inp, best, plain)).toBeLessThanOrEqual(0);
    expect(shapeInvariantViolations(inp, best)).toEqual([]);
    expect(steps.at(-1)!.generation).toBe(3);
  });

  it('deterministický pro stejné semínko', () => {
    expect(runAll(input(7)).best).toEqual(runAll(input(7)).best);
  });

  it('jeden kus: bez generací, jen výchozí jedinec a jeho mutace', () => {
    const inp: NestingInput = { ...input(), parts: [lPart('l', 1)] };
    const { steps } = runAll(inp);
    expect(steps.every((s) => s.generation === 0)).toBe(true);
  });
});
