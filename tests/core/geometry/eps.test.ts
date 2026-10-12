import { describe, expect, it } from 'vitest';
import { EPS, nearlyEqual } from '../../../src/core/geometry/eps.ts';

describe('nearlyEqual', () => {
  it('porovnává s tolerancí EPS', () => {
    expect(nearlyEqual(1, 1 + EPS / 2)).toBe(true);
    expect(nearlyEqual(1, 1 + EPS * 2)).toBe(false);
    expect(nearlyEqual(0.1 + 0.2, 0.3)).toBe(true);
  });

  it('přijme vlastní toleranci', () => {
    expect(nearlyEqual(1, 1.05, 0.1)).toBe(true);
    expect(nearlyEqual(1, 1.2, 0.1)).toBe(false);
  });
});
