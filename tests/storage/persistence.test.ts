import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Sheet } from '../../src/core/model.ts';
import { PROJECT_FORMAT, type ProjectFile } from '../../src/core/project.ts';
import { resetAppStore, useAppStore } from '../../src/state/store.ts';
import type { ProjectStorage } from '../../src/storage/db.ts';
import { AUTOSAVE_DELAY_MS, initPersistence } from '../../src/storage/persistence.ts';

/** Úložiště v paměti; počítá zápisy. */
function memoryStorage(project: unknown = null, library: unknown[] = []) {
  const data = { project, library, projectWrites: 0, libraryWrites: 0 };
  const storage: ProjectStorage = {
    loadLastProject: () => Promise.resolve(data.project),
    saveLastProject: (file: ProjectFile) => {
      data.project = JSON.parse(JSON.stringify(file));
      data.projectWrites++;
      return Promise.resolve();
    },
    loadSheetLibrary: () => Promise.resolve(data.library),
    saveSheetLibrary: (sheets: readonly Sheet[]) => {
      data.library = JSON.parse(JSON.stringify(sheets));
      data.libraryWrites++;
      return Promise.resolve();
    },
  };
  return { storage, data };
}

const state = () => useAppStore.getState();

beforeEach(() => {
  resetAppStore();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('initPersistence', () => {
  it('změny se po prodlevě uloží jedním zápisem a projdou zpět do nového store', async () => {
    const { storage, data } = memoryStorage();
    const p = await initPersistence(storage, () => new Date('2026-10-12T00:00:00Z'));
    state().addPart();
    state().addPart();
    state().setParams({ spacing: 4 });
    expect(data.projectWrites).toBe(0);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(data.projectWrites).toBe(1);
    expect(data.project).toMatchObject({
      format: PROJECT_FORMAT,
      savedAt: '2026-10-12T00:00:00.000Z',
    });
    const parts = state().parts;
    await p.dispose();

    resetAppStore();
    const again = await initPersistence(storage);
    expect(state().parts).toEqual(parts);
    expect(state().params.spacing).toBe(4);
    await again.dispose();
  });

  it('knihovna se ukládá zvlášť a načte se zpět', async () => {
    const { storage, data } = memoryStorage();
    const p = await initPersistence(storage);
    state().saveSheetToLibrary(state().sheets[0]!.id);
    await p.flush();
    expect(data.libraryWrites).toBe(1);
    expect(data.projectWrites).toBe(0);
    const library = state().sheetLibrary;
    await p.dispose();

    resetAppStore();
    await (await initPersistence(storage)).dispose();
    expect(state().sheetLibrary).toEqual(library);
  });

  it('změna výsledku ani průběhu se neukládá', async () => {
    const { storage, data } = memoryStorage();
    const p = await initPersistence(storage);
    state().setActiveSheet(2);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
    expect(data.projectWrites).toBe(0);
    await p.dispose();
  });

  it('poškozená data v úložišti se přeskočí s varováním', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { storage } = memoryStorage({ format: 'nesmysl' }, [{ name: 'bez rozměrů' }]);
    const p = await initPersistence(storage);
    expect(warn).toHaveBeenCalledOnce();
    expect(state().sheets).toHaveLength(1);
    expect(state().sheetLibrary).toEqual([]);
    await p.dispose();
  });

  it('chyba zápisu nezastaví další ukládání', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { storage, data } = memoryStorage();
    let fail = true;
    const save = storage.saveLastProject;
    storage.saveLastProject = (f) => (fail ? Promise.reject(new Error('plno')) : save(f));
    const p = await initPersistence(storage);
    state().addPart();
    await p.flush();
    expect(warn).toHaveBeenCalledOnce();
    fail = false;
    state().addPart();
    await p.flush();
    expect(data.projectWrites).toBe(1);
    await p.dispose();
  });
});
