import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_NESTING_PARAMS, type Sheet } from '../../src/core/model.ts';
import { nest } from '../../src/core/nesting/nest.ts';
import { serializeProject } from '../../src/core/project.ts';
import {
  nextPartName,
  resetAppStore,
  setNestingClient,
  useAppStore,
} from '../../src/state/store.ts';
import { circle, dxf, line, rectPoly } from '../core/import/dxf-builder.ts';
import type { NestingClient } from '../../src/worker/client.ts';
import { createNestingService } from '../../src/worker/service.ts';

/** Klient bez workeru – počítá synchronně v testu. */
const syncClient: NestingClient = {
  nest: (input, onProgress) => {
    const outcome = nest(input);
    if (outcome.ok && onProgress)
      onProgress({ step: 1, totalSteps: 1, fraction: 1, best: outcome.result });
    return Promise.resolve(outcome);
  },
  stop: () => Promise.resolve(),
  importDrawing: (name, data, opts) => createNestingService().importDrawing(name, data, opts),
  abort: () => {},
  dispose: () => {},
};

const fixture = (name: string) => {
  const buf = readFileSync(new URL(`../fixtures/csv/${name}`, import.meta.url));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
};

const state = () => useAppStore.getState();

/** Testy nezávisí na výchozí tabuli a dílu aplikace (ty si uživatel může změnit). */
const TEST_SHEET: Sheet = {
  id: 'tabule-1',
  name: 'Test 2800 × 2070',
  width: 2800,
  height: 2070,
  stock: null,
  margin: 10,
  forbiddenZones: [],
};

/** Přidá díl 500 × 300 mm, 1 ks. */
const addPart = () => {
  state().addPart();
  const id = state().parts.at(-1)!.id;
  state().updatePart(id, { width: 500, height: 300, quantity: 1 });
};

beforeEach(() => {
  resetAppStore();
  setNestingClient(syncClient);
  state().loadProject({ parts: [], sheets: [TEST_SHEET], params: DEFAULT_NESTING_PARAMS });
});

describe('store', () => {
  it('import CSV nahradí díly a zapíše hlášení', async () => {
    await state().importCsv('utf8-bom.csv', fixture('utf8-bom.csv'));
    expect(state().parts.length).toBeGreaterThan(0);
    expect(state().importReports).toEqual([
      expect.objectContaining({
        fileName: 'utf8-bom.csv',
        kind: 'csv',
        partCount: state().parts.length,
      }),
    ]);
  });

  it('chybný CSV vrátí chyby s čísly řádků', async () => {
    await state().importCsv('chyby.csv', fixture('chyby.csv'));
    const errors = state().importReports[0]!.errors;
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/^Řádek \d+: /);
  });

  it('úprava dílu: undefined smaže volitelné pole', () => {
    addPart();
    const id = state().parts[0]!.id;
    state().updatePart(id, { material: 'DTD', thickness: 18 });
    expect(state().parts[0]).toMatchObject({ material: 'DTD', thickness: 18 });
    state().updatePart(id, { material: undefined, thickness: undefined });
    expect(state().parts[0]).not.toHaveProperty('material');
    expect(state().parts[0]).not.toHaveProperty('thickness');
  });

  it('nový díl je kopie posledního s dalším číslem v názvu', () => {
    state().addPart();
    expect(state().parts[0]!.name).toBe('Díl 1');
    const first = state().parts[0]!.id;
    state().updatePart(first, {
      name: 'Bok 9',
      width: 720,
      height: 560,
      quantity: 3,
      rotation: 'locked',
      material: 'DTD',
      thickness: 18,
    });
    state().addPart();
    const [a, b] = state().parts;
    expect(b).toEqual({ ...a, id: b!.id, name: 'Bok 10' });
    expect(b!.id).not.toBe(a!.id);

    // Úprava kopie nemění originál.
    state().updatePart(b!.id, { width: 100 });
    expect(state().parts[0]!.width).toBe(720);
  });

  it('kopie dílu z DXF převezme i tvar', async () => {
    const drawing = new TextEncoder().encode(
      dxf({ entities: [rectPoly(0, 0, 100, 50), circle(50, 25, 10)] }),
    ).buffer as ArrayBuffer;
    await state().importFiles([{ name: 'deska.dxf', data: drawing }]);
    expect(state().parts[0]!.shape).toBeDefined();
    state().addPart();
    const [a, b] = state().parts;
    expect(b!.shape).toEqual(a!.shape);
    expect(b!.name).toBe(a!.name);
  });

  it.each([
    ['Díl 1', 'Díl 2'],
    ['Bok 9', 'Bok 10'],
    ['A007', 'A008'],
    ['X-099', 'X-100'],
    ['Police', 'Police'],
    ['12', '13'],
    ['Díl 99999999999999999999', 'Díl 100000000000000000000'],
    ['', ''],
  ])('název kopie: %j → %j', (name, next) => {
    expect(nextPartName(name)).toBe(next);
  });

  it('hromadná úprava a odebrání mění jen díly s danými ID', () => {
    addPart();
    addPart();
    addPart();
    const [a, b, c] = state().parts.map((p) => p.id);
    state().updatePart(c!, { material: 'Plech' });
    state().updateParts([a!, c!], { rotation: 'locked', thickness: 2 });
    expect(state().parts.map((p) => p.rotation)).toEqual(['locked', 'ortho', 'locked']);
    expect(state().parts[1]).not.toHaveProperty('thickness');
    expect(state().parts[2]).toMatchObject({ material: 'Plech', thickness: 2 });
    state().updateParts([a!, b!, c!], { material: undefined });
    expect(state().parts.some((p) => 'material' in p)).toBe(false);
    state().removeParts([a!, c!, 'neexistuje']);
    expect(state().parts.map((p) => p.id)).toEqual([b]);
  });

  it('zakázaná zóna se přidá, upraví a odebere', () => {
    const sheetId = state().sheets[0]!.id;
    state().addZone(sheetId);
    const zone = state().sheets[0]!.forbiddenZones[0]!;
    expect(zone.polygon).toHaveLength(4);
    state().removeZone(sheetId, zone.id);
    expect(state().sheets[0]!.forbiddenZones).toEqual([]);
  });

  it('výpočet uloží výsledek i vstup, ze kterého vznikl', async () => {
    addPart();
    addPart();
    await state().calculate();
    const s = state();
    expect(s.status).toBe('done');
    expect(s.result?.metrics.utilization).toBeGreaterThan(0);
    expect(s.resultInput?.parts).toBe(s.parts);
    expect(s.result?.metrics.placedCount).toBe(2);
  });

  it('neplatné zadání skončí chybou s výčtem problémů', async () => {
    addPart();
    state().updateSheet(state().sheets[0]!.id, { margin: 5000 });
    await state().calculate();
    expect(state().status).toBe('error');
    expect(state().issues.length).toBeGreaterThan(0);
    expect(state().result).toBeNull();
  });

  it('aktivní tabule se po novém výpočtu omezí na počet tabulí', async () => {
    addPart();
    state().setActiveSheet(5);
    await state().calculate();
    expect(state().activeSheet).toBe(0);
  });

  it('náhled: přehled všech tabulí a otevření jedné tabule z přehledu', () => {
    expect(state().planView).toBe('single');
    state().setPlanView('all');
    expect(state().planView).toBe('all');
    state().openSheet(3);
    expect(state().planView).toBe('single');
    expect(state().activeSheet).toBe(3);
  });

  it('načtení projektu nahradí zadání a smaže výsledek', async () => {
    addPart();
    await state().calculate();
    const sheets = [{ ...state().sheets[0]!, id: 'jina', name: 'Jiná' }];
    state().loadProject({ parts: [], sheets, params: { ...DEFAULT_NESTING_PARAMS, spacing: 3 } });
    const s = state();
    expect(s.parts).toEqual([]);
    expect(s.sheets).toBe(sheets);
    expect(s.params.spacing).toBe(3);
    expect(s.result).toBeNull();
    expect(s.status).toBe('idle');
  });

  it('import JSON: platný projekt se načte, neplatný zadání nezmění', () => {
    addPart();
    const text = serializeProject(state(), new Date());
    state().newProject();
    expect(state().parts).toEqual([]);
    state().importProjectJson('p.json', text);
    expect(state().parts).toHaveLength(1);
    expect(state().projectReport).toEqual({ fileName: 'p.json', ok: true, messages: [] });

    state().importProjectJson('spatny.json', '{"format":"jiny"}');
    expect(state().parts).toHaveLength(1);
    expect(state().projectReport?.ok).toBe(false);
  });

  it('knihovna formátů: uložení, přepsání podle názvu, přidání do projektu a odebrání', () => {
    const sheetId = state().sheets[0]!.id;
    state().saveSheetToLibrary(sheetId);
    expect(state().sheetLibrary).toHaveLength(1);
    const libId = state().sheetLibrary[0]!.id;
    expect(libId).not.toBe(sheetId);

    state().updateSheet(sheetId, { margin: 25 });
    state().saveSheetToLibrary(sheetId);
    expect(state().sheetLibrary).toHaveLength(1);
    expect(state().sheetLibrary[0]).toMatchObject({ id: libId, margin: 25 });

    state().newProject();
    expect(state().sheetLibrary).toHaveLength(1);
    state().addSheetFromLibrary(libId);
    expect(state().sheets).toHaveLength(2);
    expect(state().sheets[1]).toMatchObject({ margin: 25 });
    expect(new Set(state().sheets.map((s) => s.id)).size).toBe(2);

    state().removeFromLibrary(libId);
    expect(state().sheetLibrary).toEqual([]);
  });

  it('hladiny: změna role znovu načte výkres, ruční úpravy zůstanou, role platí i pro další výkres', async () => {
    const enc = (t: string) => new TextEncoder().encode(t).buffer as ArrayBuffer;
    const plate = (x: number) =>
      enc(
        dxf({
          entities: [
            rectPoly(x, 0, 200, 100, [8, 'OBRYS']),
            line(x + 100, 0, x + 100, 100, [8, 'OHYB']),
          ],
        }),
      );
    await state().importFiles([{ name: 'deska.dxf', data: plate(0) }]);
    // Ohyb na hladině vnějšího obrysu je neuzavřená kontura – chyba, díl bez ohybu.
    expect(state().parts).toHaveLength(1);
    expect(state().parts[0]!.shape!.marks).toBeUndefined();
    expect(state().drawings).toHaveLength(1);
    expect(state().drawings[0]!.layers.map((l) => l.name)).toEqual(['OBRYS', 'OHYB']);
    expect(state().importReports[0]!.errors.length).toBeGreaterThan(0);

    await state().setLayerRole('OHYB', 'attach');
    expect(state().layerRoles.get('OHYB')).toBe('attach');
    expect(state().parts).toHaveLength(1);
    expect(state().parts[0]!.shape!.marks).toEqual([
      { layer: 'OHYB', segments: [{ a: { x: 100, y: 0 }, b: { x: 100, y: 100 }, bulge: 0 }] },
    ]);
    expect(state().importReports).toMatchObject([
      { fileName: 'deska.dxf', partCount: 1, errors: [] },
    ]);

    const id = state().parts[0]!.id;
    state().updatePart(id, { quantity: 4, material: 'Nerez' });
    await state().setLayerRole('OHYB', 'ignore');
    expect(state().parts).toHaveLength(1);
    expect(state().parts[0]).toMatchObject({ id, quantity: 4, material: 'Nerez' });
    expect(state().parts[0]!.shape!.marks).toBeUndefined();

    // Další výkres se načte rovnou se zapamatovanou rolí.
    await state().importFiles([{ name: 'druha.dxf', data: plate(500) }]);
    expect(state().parts).toHaveLength(2);
    expect(state().drawings).toHaveLength(2);

    // Výkres, jehož díly uživatel odebral, se znovu nenačte.
    state().removePart(id);
    await state().setLayerRole('OHYB', 'attach');
    expect(state().parts).toHaveLength(1);
    expect(state().parts[0]!.shape!.marks).toHaveLength(1);
    expect(state().importReports.map((r) => r.fileName)).toEqual(['druha.dxf']);

    // CSV seznam dílů nahradí – výkresy zmizí; stejně tak smazání dílů.
    await state().importCsv('utf8-bom.csv', fixture('utf8-bom.csv'));
    expect(state().drawings).toEqual([]);
    await state().importFiles([{ name: 'deska.dxf', data: plate(0) }]);
    state().clearParts();
    expect(state().drawings).toEqual([]);
  });

  it('hladiny: načtení projektu během nového načtení výkresu staré díly nevrátí; chyba workeru se nahlásí', async () => {
    const enc = (t: string) => new TextEncoder().encode(t).buffer as ArrayBuffer;
    const data = enc(dxf({ entities: [rectPoly(0, 0, 200, 100, [8, 'OBRYS'])] }));
    await state().importFiles([{ name: 'deska.dxf', data }]);
    expect(state().parts).toHaveLength(1);

    // Pomalý worker: nové načtení čeká, než ho test pustí.
    let release: () => void = () => {};
    let fail = false;
    setNestingClient({
      ...syncClient,
      importDrawing: (name, d, opts) =>
        new Promise((resolve, reject) => {
          release = () =>
            fail
              ? reject(new Error('worker spadl'))
              : resolve(createNestingService().importDrawing(name, d, opts));
        }),
    });
    const pending = state().setLayerRole('OBRYS', 'outer');
    state().loadProject({ parts: [], sheets: [TEST_SHEET], params: DEFAULT_NESTING_PARAMS });
    release();
    await pending;
    expect(state().parts).toEqual([]);
    expect(state().drawings).toEqual([]);

    setNestingClient(syncClient);
    await state().importFiles([{ name: 'deska.dxf', data }]);
    setNestingClient({
      ...syncClient,
      importDrawing: () => Promise.reject(new Error('worker spadl')),
    });
    fail = true;
    await state().setLayerRole('OBRYS', 'outer');
    expect(state().importReports).toEqual([
      expect.objectContaining({
        fileName: 'deska.dxf',
        errors: ['Nové načtení výkresu selhalo: worker spadl'],
      }),
    ]);
    expect(state().parts).toHaveLength(1);
  });

  it('hladiny: změna role během importu – import nepřepíše nové načtení a dávku načte s novou rolí', async () => {
    const enc = (t: string) => new TextEncoder().encode(t).buffer as ArrayBuffer;
    const plate = (x: number) =>
      enc(
        dxf({
          entities: [
            rectPoly(x, 0, 200, 100, [8, 'OBRYS']),
            line(x + 10, 50, x + 60, 50, [8, 'GRAVIR']),
          ],
        }),
      );
    await state().importFiles([{ name: 'a.dxf', data: plate(0) }]);
    // Pomalý import druhého výkresu; mezitím uživatel změní roli hladiny.
    let release: () => void = () => {};
    let slow = true;
    setNestingClient({
      ...syncClient,
      importDrawing: (name, d, opts) =>
        name === 'b.dxf' && slow
          ? new Promise((resolve) => {
              slow = false;
              release = () => resolve(createNestingService().importDrawing(name, d, opts));
            })
          : syncClient.importDrawing(name, d, opts),
    });
    const importing = state().importFiles([{ name: 'b.dxf', data: plate(500) }]);
    await state().setLayerRole('GRAVIR', 'attach');
    expect(state().parts).toHaveLength(1);
    expect(state().parts[0]!.shape!.marks).toHaveLength(1);
    release();
    await importing;
    expect(state().parts).toHaveLength(2);
    expect(state().drawings).toHaveLength(2);
    expect(state().parts.map((p) => p.shape!.marks?.length)).toEqual([1, 1]);
  });

  it('import DXF: díly se přidají, režim více dílů, dávka CSV + DXF, hlášení po souborech', async () => {
    const enc = (t: string) => new TextEncoder().encode(t).buffer as ArrayBuffer;
    const plate = enc(
      dxf({ entities: [rectPoly(0, 0, 200, 100), circle(50, 50, 10), rectPoly(300, 0, 40, 40)] }),
    );
    addPart();
    await state().importFiles([{ name: 'plech.DXF', data: plate }]);
    expect(state().parts).toHaveLength(2);
    const dxfPart = state().parts[1]!;
    expect(dxfPart).toMatchObject({ name: 'plech', width: 200, height: 100 });
    expect(dxfPart.shape!.holes).toHaveLength(1);
    expect(state().importReports[0]).toMatchObject({ kind: 'dxf', partCount: 1 });
    expect(state().importReports[0]!.warnings.join()).toMatch(/Mimo hlavní obrys/);

    state().setDxfMode('multi');
    await state().importFiles([
      { name: 'utf8-bom.csv', data: fixture('utf8-bom.csv') },
      { name: 'plech.dxf', data: plate },
    ]);
    const names = state().parts.map((p) => p.name);
    expect(names.slice(-2)).toEqual(['plech-1', 'plech-2']);
    expect(state().parts.filter((p) => p.shape)).toHaveLength(2);
    expect(state().importReports.map((r) => r.kind)).toEqual(['csv', 'dxf']);
    expect(new Set(state().parts.map((p) => p.id)).size).toBe(state().parts.length);
  });

  it('import DWG: díly se přidají, hlášení s druhem dwg', async () => {
    const buf = readFileSync(new URL('../fixtures/dwg/vice-dilu-ac1027.dwg', import.meta.url));
    const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    state().setDxfMode('multi');
    await state().importFiles([{ name: 'vice-dilu.DWG', data }]);
    expect(state().parts.map((p) => p.name)).toEqual([
      'vice-dilu-1',
      'vice-dilu-2',
      'vice-dilu-3',
      'vice-dilu-4',
    ]);
    expect(state().parts.every((p) => p.shape)).toBe(true);
    expect(state().importReports).toMatchObject([{ kind: 'dwg', partCount: 4, errors: [] }]);
  });

  it('výpočet s díly z DXF projde validací a umístí je', async () => {
    const enc = (t: string) => new TextEncoder().encode(t).buffer as ArrayBuffer;
    await state().importFiles([
      {
        name: 'd.dxf',
        data: enc(dxf({ entities: [rectPoly(5, 5, 300, 200), circle(100, 100, 30)] })),
      },
    ]);
    state().updatePart(state().parts[0]!.id, { quantity: 4 });
    await state().calculate();
    expect(state().status).toBe('done');
    expect(state().result?.metrics.placedCount).toBe(4);
  });

  it('zbytky z výsledku se uloží jako tabule a při dalším výpočtu se použijí přednostně', async () => {
    addPart();
    await state().calculate();
    expect(state().saveRemnants()).toBe(1);
    const remnant = state().sheets[1]!;
    expect(remnant).toMatchObject({ remnant: true, stock: 1, margin: 0 });
    await state().calculate();
    expect(state().result!.layouts[0]!.sheetId).toBe(remnant.id);
  });

  it('zbytky se pro jeden výsledek uloží jen jednou; použité zbytkové tabule ubydou ze skladu', async () => {
    addPart();
    await state().calculate();
    expect(state().saveRemnants()).toBe(1);
    expect(state().saveRemnants()).toBe(0);
    expect(state().sheets).toHaveLength(2);
    await state().calculate();
    // Druhý výpočet použil zbytek (sklad 1) – po uložení nových zbytků zmizí.
    const usedId = state().result!.layouts[0]!.sheetId;
    expect(state().sheets.find((s) => s.id === usedId)?.remnant).toBe(true);
    state().saveRemnants();
    expect(state().sheets.some((s) => s.id === usedId)).toBe(false);
  });
});
