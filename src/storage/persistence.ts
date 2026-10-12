import type { Sheet } from '../core/model.ts';
import { projectFromJson, sheetFromJson, toProjectFile } from '../core/project.ts';
import { useAppStore } from '../state/store.ts';
import type { ProjectStorage } from './db.ts';

/** Prodleva automatického uložení po poslední změně (ms). */
export const AUTOSAVE_DELAY_MS = 400;

export interface Persistence {
  /** Okamžitě zapíše čekající změny. */
  flush(): Promise<void>;
  /** Odhlásí sledování store (čekající změny zapíše). */
  dispose(): Promise<void>;
}

/**
 * Načte poslední projekt a knihovnu formátů do store a dál automaticky ukládá
 * jejich změny. Neplatná data v úložišti se přeskočí s varováním v konzoli.
 */
export async function initPersistence(
  storage: ProjectStorage,
  now: () => Date = () => new Date(),
): Promise<Persistence> {
  const store = useAppStore;
  const [lastProject, library] = await Promise.all([
    storage.loadLastProject(),
    storage.loadSheetLibrary(),
  ]);
  if (lastProject !== null && lastProject !== undefined) {
    const r = projectFromJson(lastProject);
    if (r.ok) store.getState().loadProject(r.project);
    else console.warn('Uložený projekt nelze načíst:', r.errors);
  }
  const sheets = library.map(sheetFromJson).filter((s): s is Sheet => s !== null);
  store.getState().setSheetLibrary(sheets);

  let timer: ReturnType<typeof setTimeout> | null = null;
  let projectDirty = false;
  let libraryDirty = false;
  let writing: Promise<void> = Promise.resolve();

  const write = () => {
    timer = null;
    const s = store.getState();
    const tasks: Promise<void>[] = [];
    if (projectDirty) {
      projectDirty = false;
      tasks.push(storage.saveLastProject(toProjectFile(s, now())));
    }
    if (libraryDirty) {
      libraryDirty = false;
      tasks.push(storage.saveSheetLibrary(s.sheetLibrary));
    }
    writing = writing
      .then(() => Promise.all(tasks))
      .then(
        () => undefined,
        (e: unknown) => console.warn('Uložení projektu selhalo:', e),
      );
    return writing;
  };

  const unsubscribe = store.subscribe((s, prev) => {
    if (s.parts !== prev.parts || s.sheets !== prev.sheets || s.params !== prev.params) {
      projectDirty = true;
    }
    if (s.sheetLibrary !== prev.sheetLibrary) libraryDirty = true;
    if ((projectDirty || libraryDirty) && timer === null) {
      timer = setTimeout(write, AUTOSAVE_DELAY_MS);
    }
  });

  const flush = () => {
    if (timer !== null) clearTimeout(timer);
    return write();
  };
  return {
    flush,
    async dispose() {
      unsubscribe();
      await flush();
    },
  };
}
