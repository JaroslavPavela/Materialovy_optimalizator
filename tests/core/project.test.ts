import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_NESTING_PARAMS, type Part, type Sheet } from '../../src/core/model.ts';
import {
  parseProject,
  PROJECT_FORMAT,
  projectFromJson,
  serializeProject,
  sheetFromJson,
  type Project,
} from '../../src/core/project.ts';
import { arbRectParts, arbSheet } from './arbitraries.ts';

const savedAt = new Date('2026-10-12T10:00:00Z');

const shaped: Part = {
  id: 'kruh',
  name: 'Příruba',
  width: 100,
  height: 100,
  quantity: 2,
  rotation: 'free',
  material: 'S235',
  thickness: 3,
  shape: {
    outer: [
      { x: 0, y: 50, bulge: 1 },
      { x: 100, y: 50, bulge: 1 },
    ],
    holes: [
      [
        { x: 40, y: 50, bulge: -1 },
        { x: 60, y: 50, bulge: -1 },
      ],
    ],
  },
};

const sheet: Sheet = {
  id: 's1',
  name: 'Plech 3000 × 1500',
  width: 3000,
  height: 1500,
  stock: null,
  margin: 10,
  material: 'S235',
  forbiddenZones: [
    {
      id: 'z1',
      polygon: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 80 },
      ],
    },
  ],
  remnant: true,
};

const project: Project = { parts: [shaped], sheets: [sheet], params: DEFAULT_NESTING_PARAMS };

const file = (patch: Record<string, unknown>) =>
  JSON.stringify({ ...JSON.parse(serializeProject(project, savedAt)), ...patch });

const errorsOf = (text: string) => {
  const r = parseProject(text);
  expect(r.ok).toBe(false);
  return r.ok ? [] : r.errors;
};

describe('serializeProject / parseProject', () => {
  it('zápis a čtení zachová díly s tvarem, tabule se zónami i parametry', () => {
    const text = serializeProject(project, savedAt);
    expect(JSON.parse(text)).toMatchObject({
      format: PROJECT_FORMAT,
      version: 1,
      savedAt: '2026-10-12T10:00:00.000Z',
    });
    expect(parseProject(text)).toEqual({ ok: true, project, warnings: [] });
  });

  it('property: zápis → čtení je identita pro obdélníkové díly a libovolné tabule', () => {
    fc.assert(
      fc.property(
        arbRectParts(),
        fc
          .array(fc.nat(5), { minLength: 1, maxLength: 3 })
          .chain((ids) => fc.tuple(...ids.map((_, i) => arbSheet(`s${i}`)))),
        fc.record({
          spacing: fc.double({ min: 0, max: 50, noNaN: true }),
          freeRotationStep: fc.integer({ min: 1, max: 360 }),
        }),
        (parts, sheets, p) => {
          const pr: Project = { parts, sheets, params: { ...DEFAULT_NESTING_PARAMS, ...p } };
          const r = parseProject(serializeProject(pr, savedAt));
          expect(r).toEqual({ ok: true, project: pr, warnings: [] });
        },
      ),
    );
  });

  it('BOM na začátku souboru nevadí', () => {
    expect(parseProject(`\uFEFF${serializeProject(project, savedAt)}`).ok).toBe(true);
  });

  it('neplatný JSON a cizí JSON se odmítnou', () => {
    expect(errorsOf('{nejde')).toEqual(['Soubor není platný JSON.']);
    expect(errorsOf('[1, 2]')[0]).toMatch(/není projekt/);
    expect(errorsOf(file({ format: 'jiny' }))[0]).toMatch(/není projekt/);
  });

  it('novější verze se odmítne', () => {
    expect(errorsOf(file({ version: 2 }))[0]).toMatch(/Nepodporovaná verze/);
  });

  it('chyby dílů a tabulí uvádí pořadí a pole', () => {
    const errors = errorsOf(
      file({
        parts: [
          { ...shaped, width: '100' },
          { ...shaped, rotation: 'sikmo' },
        ],
        sheets: [{ ...sheet, stock: 'hodně', forbiddenZones: [{ id: 'z', polygon: [{ x: 1 }] }] }],
      }),
    );
    expect(errors).toEqual([
      'Díl 1: šířka musí být číslo.',
      'Díl 2: neznámá rotace „sikmo".',
      'Tabule 1: počet skladem musí být číslo.',
      'Tabule 1: bod obrysu musí mít číselné x a y.',
    ]);
  });

  it('chybějící seznamy dílů a tabulí jsou chyba', () => {
    expect(errorsOf(file({ parts: undefined, sheets: 5 }))).toEqual([
      'Projekt: chybí seznam dílů.',
      'Projekt: chybí seznam tabulí.',
    ]);
  });

  it('chybějící parametry se doplní výchozími s varováním', () => {
    const r = parseProject(file({ params: { spacing: 4 } }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.project.params).toEqual({ ...DEFAULT_NESTING_PARAMS, spacing: 4 });
    expect(r.warnings[0]).toMatch(/freeRotationStep/);
    const none = parseProject(file({ params: undefined }));
    expect(none.ok && none.warnings).toEqual([
      'Projekt neobsahuje parametry výpočtu – použity výchozí.',
    ]);
  });

  it('neplatné parametry jsou chyba', () => {
    expect(errorsOf(file({ params: { ...DEFAULT_NESTING_PARAMS, mode: 'x', seed: '1' } }))).toEqual(
      ['Parametry: seed musí být číslo.', 'Parametry: neznámý režim „x".'],
    );
  });

  it('hodnoty mimo rozsah se načtou – ověří je až výpočet', () => {
    const r = projectFromJson(JSON.parse(file({ parts: [{ ...shaped, width: -5, quantity: 0 }] })));
    expect(r.ok).toBe(true);
  });

  it('prázdný materiál a null tloušťka znamenají „libovolný"', () => {
    const r = projectFromJson(
      JSON.parse(file({ parts: [{ ...shaped, material: '', thickness: null }] })),
    );
    expect(r.ok && r.project.parts[0]).not.toHaveProperty('material');
    expect(r.ok && r.project.parts[0]).not.toHaveProperty('thickness');
  });

  it('vrchol bez bulge je úsečka', () => {
    const outer = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    const r = projectFromJson(
      JSON.parse(file({ parts: [{ ...shaped, shape: { outer, holes: [] } }] })),
    );
    expect(r.ok && r.project.parts[0]!.shape!.outer.every((v) => v.bulge === 0)).toBe(true);
  });
});

describe('sheetFromJson', () => {
  it('platná tabule projde, neplatná vrátí null', () => {
    expect(sheetFromJson(JSON.parse(JSON.stringify(sheet)))).toEqual(sheet);
    expect(sheetFromJson({ ...sheet, width: null })).toBeNull();
    expect(sheetFromJson('tabule')).toBeNull();
  });
});
