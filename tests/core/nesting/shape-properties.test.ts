import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NESTING_PARAMS,
  validateNestingInput,
  type NestingInput,
  type Sheet,
} from '../../../src/core/model.ts';
import { optimizeShapes } from '../../../src/core/nesting/optimizer.ts';
import { defaultShapeOrder, placeShapes, ShapeContext } from '../../../src/core/nesting/placer.ts';
import { arbCombPart, arbForbiddenZones, arbFramePart, arbShapePart } from '../arbitraries.ts';
import { shapeInvariantViolations } from './invariants.ts';

/** Malá tabule, ať se díly tlačí a vzniká hodně dotyků. */
const arbSmallSheet: fc.Arbitrary<Sheet> = fc
  .record({
    width: fc.integer({ min: 150, max: 500 }),
    height: fc.integer({ min: 120, max: 350 }),
    margin: fc.constantFrom(0, 2, 10),
    stock: fc.constantFrom<number | null>(null, 1, 2),
  })
  .chain((s) =>
    arbForbiddenZones(s.width, s.height).map((forbiddenZones) => ({
      id: 's',
      name: 'S',
      ...s,
      forbiddenZones,
    })),
  );

const arbInput: fc.Arbitrary<NestingInput> = fc
  .record({
    parts: fc
      .integer({ min: 1, max: 4 })
      .chain((n) =>
        fc.tuple(
          ...Array.from({ length: n }, (_, i) =>
            fc.oneof(arbShapePart(`p${i}`), arbCombPart(`p${i}`), arbFramePart(`p${i}`)),
          ),
        ),
      ),
    sheet: arbSmallSheet,
    second: fc.option(arbSmallSheet, { nil: undefined }),
    spacing: fc.constantFrom(0, 1, 3.5, 8),
    freeRotationStep: fc.constantFrom(90, 45, 30),
    seed: fc.integer({ min: 0, max: 1000 }),
  })
  .map(({ parts, sheet, second, spacing, freeRotationStep, seed }) => ({
    parts,
    sheets: second ? [sheet, { ...second, id: 's2', name: 'S2' }] : [sheet],
    params: { ...DEFAULT_NESTING_PARAMS, spacing, freeRotationStep, seed, mode: 'shape' as const },
  }))
  .filter((input) => validateNestingInput(input).length === 0);

describe('property testy tvarového nestingu', () => {
  it('placer: průnik dílů < EPS, vše v užitné ploše a mimo zóny, rozestup ≥ s − EPS, každý kus jednou', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const r = placeShapes(new ShapeContext(input), defaultShapeOrder(input));
        expect(shapeInvariantViolations(input, r)).toEqual([]);
      }),
      { numRuns: 30 },
    );
  }, 120_000);

  it('optimalizátor: invarianty platí i pro výsledky s natočením a pořadím z genů', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const ga = optimizeShapes(new ShapeContext(input), {
          maxGenerations: 1,
          populationSize: 3,
        });
        let next = ga.next();
        while (!next.done) next = ga.next();
        expect(shapeInvariantViolations(input, next.value)).toEqual([]);
      }),
      { numRuns: 8 },
    );
  }, 120_000);
});
