import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { nest } from '../../src/core/nesting/nest.ts';
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
});
