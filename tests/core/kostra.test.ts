import { describe, expect, it } from 'vitest';
import * as model from '../../src/core/model.ts';

describe('kostra projektu', () => {
  it('modul jádra jde naimportovat', () => {
    expect(model).toBeTypeOf('object');
  });
});
