import { Dexie, type EntityTable } from 'dexie';
import type { Sheet } from '../core/model.ts';
import type { ProjectFile } from '../core/project.ts';

/**
 * Trvalé úložiště aplikace. Data se při čtení vždy ověří (`projectFromJson`,
 * `sheetFromJson`), proto rozhraní vrací `unknown` – úložiště mohlo zapsat
 * starší verze aplikace.
 */
export interface ProjectStorage {
  loadLastProject(): Promise<unknown>;
  saveLastProject(file: ProjectFile): Promise<void>;
  loadSheetLibrary(): Promise<unknown[]>;
  saveSheetLibrary(sheets: readonly Sheet[]): Promise<void>;
}

interface ProjectRow {
  readonly id: string;
  readonly file: unknown;
}

interface SheetFormatRow {
  readonly id: string;
  /** Pořadí v knihovně. */
  readonly order: number;
  readonly sheet: unknown;
}

const LAST_PROJECT = 'posledni';

class AppDb extends Dexie {
  projects!: EntityTable<ProjectRow, 'id'>;
  sheetFormats!: EntityTable<SheetFormatRow, 'id'>;

  constructor() {
    super('materialovy-optimalizator');
    this.version(1).stores({ projects: 'id', sheetFormats: 'id, order' });
  }
}

/** Úložiště v IndexedDB (Dexie). */
export function createDexieStorage(): ProjectStorage {
  const db = new AppDb();
  return {
    async loadLastProject() {
      return (await db.projects.get(LAST_PROJECT))?.file ?? null;
    },
    async saveLastProject(file) {
      await db.projects.put({ id: LAST_PROJECT, file });
    },
    async loadSheetLibrary() {
      const rows = await db.sheetFormats.orderBy('order').toArray();
      return rows.map((r) => r.sheet);
    },
    async saveSheetLibrary(sheets) {
      await db.transaction('rw', db.sheetFormats, async () => {
        await db.sheetFormats.clear();
        await db.sheetFormats.bulkPut(
          sheets.map((sheet, order) => ({ id: sheet.id, order, sheet })),
        );
      });
    },
  };
}
