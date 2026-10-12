import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NESTING_PARAMS,
  allowedRotations,
  isRotationAllowed,
  normalizeRotation,
  rectRotations,
  totalInstances,
  validateNestingInput,
  type NestingInput,
  type Part,
  type RotationMode,
  type Sheet,
} from '../../src/core/model.ts';

const part = (over: Partial<Part> = {}): Part => ({
  id: 'p1',
  name: 'Bok',
  width: 600,
  height: 400,
  quantity: 2,
  rotation: 'ortho',
  ...over,
});

const sheet = (over: Partial<Sheet> = {}): Sheet => ({
  id: 's1',
  name: '2500 × 1250',
  width: 2500,
  height: 1250,
  stock: 10,
  margin: 10,
  forbiddenZones: [],
  ...over,
});

const input = (over: Partial<NestingInput> = {}): NestingInput => ({
  parts: [part()],
  sheets: [sheet()],
  params: DEFAULT_NESTING_PARAMS,
  ...over,
});

const modes: RotationMode[] = ['free', 'ortho', 'flip', 'locked'];

describe('normalizeRotation', () => {
  it.each([
    [0, 0],
    [90, 90],
    [360, 0],
    [450, 90],
    [-90, 270],
    [-360, 0],
    [720.5, 0.5],
  ])('%d° → %d°', (deg, expected) => {
    expect(normalizeRotation(deg)).toBeCloseTo(expected, 9);
  });

  it('vrací hodnotu v [0, 360) a zachovává úhel modulo 360', () => {
    fc.assert(
      fc.property(fc.double({ min: -1e6, max: 1e6, noNaN: true }), (deg) => {
        const r = normalizeRotation(deg);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThan(360);
        const diff = (((deg - r) % 360) + 360) % 360;
        expect(Math.min(diff, 360 - diff)).toBeLessThan(1e-6);
      }),
    );
  });
});

describe('allowedRotations', () => {
  it('pevné režimy', () => {
    expect(allowedRotations('locked', 90)).toEqual([0]);
    expect(allowedRotations('flip', 90)).toEqual([0, 180]);
    expect(allowedRotations('ortho', 45)).toEqual([0, 90, 180, 270]);
  });

  it('free po zadaném kroku', () => {
    expect(allowedRotations('free', 90)).toEqual([0, 90, 180, 270]);
    expect(allowedRotations('free', 45)).toEqual([0, 45, 90, 135, 180, 225, 270, 315]);
    expect(allowedRotations('free', 360)).toEqual([0]);
    expect(allowedRotations('free', 100)).toEqual([0, 100, 200, 300]);
  });

  it('free s neplatným krokem vyhodí chybu', () => {
    expect(() => allowedRotations('free', 0)).toThrow(RangeError);
    expect(() => allowedRotations('free', -90)).toThrow(RangeError);
    expect(() => allowedRotations('free', 361)).toThrow(RangeError);
    expect(() => allowedRotations('free', Number.NaN)).toThrow(RangeError);
  });

  it('free: vzestupně, začíná nulou, vše v [0, 360), krok dodržen', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.5, max: 360, noNaN: true }), (step) => {
        const rots = allowedRotations('free', step);
        expect(rots[0]).toBe(0);
        rots.forEach((r, i) => {
          expect(r).toBeGreaterThanOrEqual(0);
          expect(r).toBeLessThan(360);
          if (i > 0) expect(r - rots[i - 1]!).toBeCloseTo(step, 9);
        });
        expect(rots.length).toBe(Math.ceil(360 / step - 1e-9));
      }),
    );
  });
});

describe('rectRotations', () => {
  it('jen 0° a 90° pro free/ortho, jinak jen 0°', () => {
    expect(rectRotations('free')).toEqual([0, 90]);
    expect(rectRotations('ortho')).toEqual([0, 90]);
    expect(rectRotations('flip')).toEqual([0]);
    expect(rectRotations('locked')).toEqual([0]);
  });

  it('obdélníková natočení jsou povolená i v tvarovém režimu (krok 90°)', () => {
    for (const m of modes) {
      for (const r of rectRotations(m)) {
        expect(isRotationAllowed(m, r, 90)).toBe(true);
      }
    }
  });
});

describe('isRotationAllowed', () => {
  it('rozpozná povolené a zakázané úhly i mimo [0, 360)', () => {
    expect(isRotationAllowed('locked', 0, 90)).toBe(true);
    expect(isRotationAllowed('locked', 360, 90)).toBe(true);
    expect(isRotationAllowed('locked', 180, 90)).toBe(false);
    expect(isRotationAllowed('flip', -180, 90)).toBe(true);
    expect(isRotationAllowed('flip', 90, 90)).toBe(false);
    expect(isRotationAllowed('ortho', 270, 90)).toBe(true);
    expect(isRotationAllowed('ortho', 45, 90)).toBe(false);
    expect(isRotationAllowed('free', 45, 45)).toBe(true);
    expect(isRotationAllowed('free', 30, 45)).toBe(false);
  });

  it('toleruje šum v plovoucí čárce kolem 0°/360°', () => {
    expect(isRotationAllowed('locked', 360 - 1e-12, 90)).toBe(true);
    expect(isRotationAllowed('locked', 1e-12, 90)).toBe(true);
  });

  it('každý úhel z allowedRotations je povolený, i posunutý o násobek 360°', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...modes),
        fc.constantFrom(15, 30, 45, 90, 120, 180, 360),
        fc.integer({ min: -5, max: 5 }),
        (mode, step, turns) => {
          for (const r of allowedRotations(mode, step)) {
            expect(isRotationAllowed(mode, r + turns * 360, step)).toBe(true);
          }
        },
      ),
    );
  });
});

describe('totalInstances', () => {
  it('sečte počty kusů', () => {
    expect(totalInstances([])).toBe(0);
    expect(totalInstances([part({ quantity: 3 }), part({ id: 'p2', quantity: 4 })])).toBe(7);
  });
});

describe('validateNestingInput', () => {
  const fields = (i: NestingInput) => validateNestingInput(i).map((x) => x.field);

  it('platný vstup nemá chyby', () => {
    expect(validateNestingInput(input())).toEqual([]);
    expect(validateNestingInput(input({ sheets: [sheet({ stock: null })] }))).toEqual([]);
  });

  it('hlásí neplatné rozměry a počty dílu', () => {
    expect(fields(input({ parts: [part({ width: 0 })] }))).toEqual(['parts[0].width']);
    expect(fields(input({ parts: [part({ height: -5 })] }))).toEqual(['parts[0].height']);
    expect(fields(input({ parts: [part({ width: Number.NaN })] }))).toEqual(['parts[0].width']);
    expect(fields(input({ parts: [part({ quantity: 0 })] }))).toEqual(['parts[0].quantity']);
    expect(fields(input({ parts: [part({ quantity: 1.5 })] }))).toEqual(['parts[0].quantity']);
    expect(fields(input({ parts: [part({ thickness: 0 })] }))).toEqual(['parts[0].thickness']);
  });

  it('hlásí tvar bez vnějšího obrysu', () => {
    expect(fields(input({ parts: [part({ shape: { outer: [], holes: [] } })] }))).toEqual([
      'parts[0].shape',
    ]);
  });

  it('hlásí duplicitní ID dílů a tabulí', () => {
    expect(fields(input({ parts: [part(), part()] }))).toEqual(['parts[1].id']);
    expect(fields(input({ sheets: [sheet(), sheet()] }))).toEqual(['sheets[1].id']);
  });

  it('hlásí chybějící tabule a neplatné tabule', () => {
    expect(fields(input({ sheets: [] }))).toEqual(['sheets']);
    expect(fields(input({ sheets: [sheet({ width: 0 })] }))).toEqual(['sheets[0].width']);
    expect(fields(input({ sheets: [sheet({ stock: -1 })] }))).toEqual(['sheets[0].stock']);
    expect(fields(input({ sheets: [sheet({ stock: 0.5 })] }))).toEqual(['sheets[0].stock']);
    expect(fields(input({ sheets: [sheet({ margin: -1 })] }))).toEqual(['sheets[0].margin']);
    expect(fields(input({ sheets: [sheet({ margin: 625 })] }))).toEqual(['sheets[0].margin']);
  });

  it('hlásí neplatné zakázané zóny', () => {
    const zone = (polygon: { x: number; y: number }[]) =>
      sheet({ forbiddenZones: [{ id: 'z', polygon }] });
    expect(
      fields(
        input({
          sheets: [
            zone([
              { x: 0, y: 0 },
              { x: 1, y: 0 },
            ]),
          ],
        }),
      ),
    ).toEqual(['sheets[0].forbiddenZones[0]']);
    expect(
      fields(
        input({
          sheets: [
            zone([
              { x: 0, y: 0 },
              { x: Number.POSITIVE_INFINITY, y: 0 },
              { x: 0, y: 1 },
            ]),
          ],
        }),
      ),
    ).toEqual(['sheets[0].forbiddenZones[0]']);
  });

  it('hlásí neplatné parametry', () => {
    const p = DEFAULT_NESTING_PARAMS;
    expect(fields(input({ params: { ...p, spacing: -1 } }))).toEqual(['params.spacing']);
    expect(fields(input({ params: { ...p, freeRotationStep: 0 } }))).toEqual([
      'params.freeRotationStep',
    ]);
    expect(fields(input({ params: { ...p, timeLimitMs: 0 } }))).toEqual(['params.timeLimitMs']);
    expect(fields(input({ params: { ...p, seed: 0.5 } }))).toEqual(['params.seed']);
  });

  it('zprávy jsou česky a obsahují název', () => {
    const [issue] = validateNestingInput(input({ parts: [part({ width: 0 })] }));
    expect(issue?.message).toBe('Díl „Bok": šířka musí být kladné číslo.');
  });

  it('libovolný díl s kladnými rozměry a počtem projde', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.001, max: 1e5, noNaN: true }),
        fc.double({ min: 0.001, max: 1e5, noNaN: true }),
        fc.integer({ min: 1, max: 10_000 }),
        fc.constantFrom(...modes),
        (width, height, quantity, rotation) => {
          const issues = validateNestingInput(
            input({ parts: [part({ width, height, quantity, rotation })] }),
          );
          expect(issues).toEqual([]);
        },
      ),
    );
  });
});
