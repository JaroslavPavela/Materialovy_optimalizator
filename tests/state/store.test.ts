import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_NESTING_PARAMS } from '../../src/core/model.ts';
import { nest } from '../../src/core/nesting/nest.ts';
import { serializeProject } from '../../src/core/project.ts';
import { resetAppStore, setNestingClient, useAppStore } from '../../src/state/store.ts';
import type { NestingClient } from '../../src/worker/client.ts';

/** Klient bez workeru – počítá synchronně v testu. */
const syncClient: NestingClient = {
  nest: (input, onProgress) => {
    const outcome = nest(input);
    if (outcome.ok && onProgress) onProgress({ step: 1, totalSteps: 1, best: outcome.result });
    return Promise.resolve(outcome);
  },
  stop: () => Promise.resolve(),
  abort: () => {},
  dispose: () => {},
};

const fixture = (name: string) => {
  const buf = readFileSync(new URL(`../fixtures/csv/${name}`, import.meta.url));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
};

const state = () => useAppStore.getState();

beforeEach(() => {
  resetAppStore();
  setNestingClient(syncClient);
});

describe('store', () => {
  it('import CSV nahradí díly a zapíše hlášení', () => {
    state().importCsv('utf8-bom.csv', fixture('utf8-bom.csv'));
    expect(state().parts.length).toBeGreaterThan(0);
    expect(state().importReport).toMatchObject({
      fileName: 'utf8-bom.csv',
      partCount: state().parts.length,
    });
  });

  it('chybný CSV vrátí chyby s čísly řádků', () => {
    state().importCsv('chyby.csv', fixture('chyby.csv'));
    expect(state().importReport?.errors.length).toBeGreaterThan(0);
  });

  it('úprava dílu: undefined smaže volitelné pole', () => {
    state().addPart();
    const id = state().parts[0]!.id;
    state().updatePart(id, { material: 'DTD', thickness: 18 });
    expect(state().parts[0]).toMatchObject({ material: 'DTD', thickness: 18 });
    state().updatePart(id, { material: undefined, thickness: undefined });
    expect(state().parts[0]).not.toHaveProperty('material');
    expect(state().parts[0]).not.toHaveProperty('thickness');
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
    state().addPart();
    state().addPart();
    await state().calculate();
    const s = state();
    expect(s.status).toBe('done');
    expect(s.result?.metrics.utilization).toBeGreaterThan(0);
    expect(s.resultInput?.parts).toBe(s.parts);
    expect(s.result?.metrics.placedCount).toBe(2);
  });

  it('neplatné zadání skončí chybou s výčtem problémů', async () => {
    state().addPart();
    state().updateSheet(state().sheets[0]!.id, { margin: 5000 });
    await state().calculate();
    expect(state().status).toBe('error');
    expect(state().issues.length).toBeGreaterThan(0);
    expect(state().result).toBeNull();
  });

  it('aktivní tabule se po novém výpočtu omezí na počet tabulí', async () => {
    state().addPart();
    state().setActiveSheet(5);
    await state().calculate();
    expect(state().activeSheet).toBe(0);
  });

  it('načtení projektu nahradí zadání a smaže výsledek', async () => {
    state().addPart();
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
    state().addPart();
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
});
