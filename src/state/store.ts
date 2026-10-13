import { create } from 'zustand';
import { parsePartsCsv } from '../core/import/csv.ts';
import type { DxfPartMode } from '../core/import/dxf-parts.ts';
import {
  DEFAULT_NESTING_PARAMS,
  type ForbiddenZone,
  type InputIssue,
  type NestingInput,
  type NestingParams,
  type NestingResult,
  type Part,
  type Sheet,
} from '../core/model.ts';
import type { NestOutcome, NestProgress } from '../core/nesting/nest.ts';
import { parseProject, type Project } from '../core/project.ts';
import { remnantSheets } from '../core/remnants.ts';
import { createNestingClient, NestingAbortedError, type NestingClient } from '../worker/client.ts';

/** Výsledek načtení jednoho souboru s díly (CSV nebo DXF). */
export interface ImportReport {
  readonly fileName: string;
  readonly kind: 'csv' | 'dxf';
  readonly partCount: number;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

/** Soubor k importu – obsah už načtený z disku. */
export interface ImportFile {
  readonly name: string;
  readonly data: ArrayBuffer;
}

/** Výsledek načtení projektu ze souboru JSON. */
export interface ProjectReport {
  readonly fileName: string;
  readonly ok: boolean;
  readonly messages: readonly string[];
}

export type Status = 'idle' | 'running' | 'done' | 'error';

export interface AppState {
  readonly parts: readonly Part[];
  readonly sheets: readonly Sheet[];
  readonly params: NestingParams;
  /** Hlášení posledního importu po souborech. */
  readonly importReports: readonly ImportReport[];
  /** Režim importu DXF: 1 soubor = 1 díl, nebo každý vnější obrys = díl. */
  readonly dxfMode: DxfPartMode;
  readonly projectReport: ProjectReport | null;
  /** Uložené formáty tabulí – sdílené mezi projekty. */
  readonly sheetLibrary: readonly Sheet[];
  readonly status: Status;
  readonly progress: {
    readonly step: number;
    readonly total: number;
    /** Hotová část 0–1. */
    readonly fraction: number;
  } | null;
  /** Výsledek a vstup, ze kterého vznikl (díly se mezitím mohou měnit). */
  readonly result: NestingResult | null;
  readonly resultInput: NestingInput | null;
  readonly stopped: boolean;
  readonly issues: readonly InputIssue[];
  readonly error: string | null;
  readonly activeSheet: number;
}

export interface AppActions {
  /**
   * Načte soubory s díly: CSV nahradí seznam dílů (další soubory dávky už
   * přidávají), DXF díly přidá. Podle přípony .dxf, jinak CSV.
   */
  importFiles(files: readonly ImportFile[]): Promise<void>;
  importCsv(fileName: string, data: ArrayBuffer): Promise<void>;
  setDxfMode(mode: DxfPartMode): void;
  /** Nahradí zadání projektem (z úložiště nebo souboru); běžící výpočet zruší. */
  loadProject(project: Project): void;
  /** Načte projekt z textu JSON; při chybě zadání nezmění. */
  importProjectJson(fileName: string, text: string): void;
  /** Prázdný projekt s výchozí tabulí; knihovna formátů zůstane. */
  newProject(): void;
  setSheetLibrary(sheets: readonly Sheet[]): void;
  /** Uloží kopii tabule do knihovny; formát se stejným názvem nahradí. */
  saveSheetToLibrary(sheetId: string): void;
  addSheetFromLibrary(libraryId: string): void;
  /**
   * Uloží zbytky z posledního výsledku jako nové tabule (sklad 1, přednostně
   * při dalším výpočtu). Vrátí počet přidaných tabulí.
   */
  saveRemnants(): number;
  removeFromLibrary(libraryId: string): void;
  addPart(): void;
  /** Změna polí dílu; `undefined` volitelné pole smaže (materiál, tloušťka). */
  updatePart(id: string, patch: Patch<Part>): void;
  removePart(id: string): void;
  /** Hromadná změna vlastností dílů s danými ID (ostatní díly se nemění). */
  updateParts(ids: readonly string[], patch: BulkPartPatch): void;
  removeParts(ids: readonly string[]): void;
  clearParts(): void;
  addSheet(): void;
  updateSheet(id: string, patch: Patch<Sheet>): void;
  removeSheet(id: string): void;
  addZone(sheetId: string): void;
  updateZone(sheetId: string, zoneId: string, zone: ForbiddenZone): void;
  removeZone(sheetId: string, zoneId: string): void;
  setParams(patch: Partial<NestingParams>): void;
  calculate(): Promise<void>;
  stop(): Promise<void>;
  setActiveSheet(index: number): void;
}

/** Částečná změna objektu; hodnota `undefined` pole odstraní. */
export type Patch<T> = { [K in Exclude<keyof T, 'id'>]?: T[K] | undefined };

/**
 * Vlastnosti, které jde nastavit více dílům najednou. Rozměry ne – u tvarů
 * z DXF plynou z obrysu a u obdélníků se hromadně nemění.
 */
export type BulkPartPatch = Patch<Pick<Part, 'quantity' | 'rotation' | 'material' | 'thickness'>>;

function applyPatch<T extends object>(obj: T, patch: Patch<T>): T {
  const out = { ...obj } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete out[k];
    else out[k] = v;
  }
  return out as T;
}

let counter = 0;
const newId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export const DEFAULT_SHEET: Sheet = {
  id: 'tabule-1',
  name: 'DTD 2800 × 2070',
  width: 2800,
  height: 2070,
  stock: null,
  margin: 10,
  forbiddenZones: [],
};

const initialState: AppState = {
  parts: [],
  sheets: [DEFAULT_SHEET],
  params: DEFAULT_NESTING_PARAMS,
  importReports: [],
  dxfMode: 'single',
  projectReport: null,
  sheetLibrary: [],
  status: 'idle',
  progress: null,
  result: null,
  resultInput: null,
  stopped: false,
  issues: [],
  error: null,
  activeSheet: 0,
};

/** Stav, který se při načtení jiného projektu vrátí na začátek. */
const projectReset = {
  importReports: [],
  projectReport: null,
  status: 'idle',
  progress: null,
  result: null,
  resultInput: null,
  stopped: false,
  issues: [],
  error: null,
  activeSheet: 0,
} satisfies Partial<AppState>;

let client: NestingClient | null = null;
/** Výsledek, ze kterého už byly zbytky uloženy. */
let remnantsSavedFor: NestingResult | null = null;
/** Klient workeru (vytvoří se při prvním výpočtu); v testech lze podstrčit vlastní. */
export function setNestingClient(c: NestingClient | null): void {
  client = c;
}
const getClient = () => (client ??= createNestingClient());

/** Zakázaná zóna jako obdélník (x, y, šířka, výška) v souřadnicích tabule. */
export function rectZone(id: string, x: number, y: number, w: number, h: number): ForbiddenZone {
  return {
    id,
    polygon: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
  };
}

export const useAppStore = create<AppState & AppActions>()((set, get) => ({
  ...initialState,

  loadProject(project) {
    if (get().status === 'running') client?.abort();
    set({
      ...projectReset,
      parts: project.parts,
      sheets: project.sheets,
      params: project.params,
    });
  },

  importProjectJson(fileName, text) {
    const r = parseProject(text);
    if (!r.ok) {
      set({ projectReport: { fileName, ok: false, messages: r.errors } });
      return;
    }
    get().loadProject(r.project);
    set({ projectReport: { fileName, ok: true, messages: r.warnings } });
  },

  newProject() {
    get().loadProject({ parts: [], sheets: [DEFAULT_SHEET], params: DEFAULT_NESTING_PARAMS });
  },

  setSheetLibrary(sheets) {
    set({ sheetLibrary: sheets });
  },

  saveSheetToLibrary(sheetId) {
    const sheet = get().sheets.find((s) => s.id === sheetId);
    if (!sheet) return;
    set((s) => {
      const same = s.sheetLibrary.findIndex((l) => l.name === sheet.name);
      const copy = { ...sheet, id: same >= 0 ? s.sheetLibrary[same]!.id : newId('format') };
      return {
        sheetLibrary:
          same >= 0
            ? s.sheetLibrary.map((l, i) => (i === same ? copy : l))
            : [...s.sheetLibrary, copy],
      };
    });
  },

  addSheetFromLibrary(libraryId) {
    const sheet = get().sheetLibrary.find((l) => l.id === libraryId);
    if (!sheet) return;
    set((s) => ({ sheets: [...s.sheets, { ...sheet, id: newId('tabule') }] }));
  },

  saveRemnants() {
    const { result, resultInput } = get();
    // Pro jeden výsledek jen jednou – jinak by se zbytky ve skladu zdvojily.
    if (!result || !resultInput || remnantsSavedFor === result) return 0;
    remnantsSavedFor = result;
    const added = remnantSheets(resultInput, result, () => newId('zbytek'));
    // Zbytkové tabule použité ve výsledku se spotřebovaly: odečíst ze skladu.
    const used = new Map<string, number>();
    for (const l of result.layouts) used.set(l.sheetId, (used.get(l.sheetId) ?? 0) + 1);
    set((s) => ({
      sheets: [
        ...s.sheets
          .map((sh) =>
            sh.remnant && sh.stock !== null && used.has(sh.id)
              ? { ...sh, stock: Math.max(0, sh.stock - used.get(sh.id)!) }
              : sh,
          )
          .filter((sh) => !(sh.remnant && sh.stock === 0)),
        ...added,
      ],
    }));
    return added.length;
  },

  removeFromLibrary(libraryId) {
    set((s) => ({ sheetLibrary: s.sheetLibrary.filter((l) => l.id !== libraryId) }));
  },

  async importFiles(files) {
    let parts = get().parts;
    let replaced = false;
    const reports: ImportReport[] = [];
    for (const f of files) {
      if (/\.dxf$/i.test(f.name)) {
        const r = await getClient().importDxf(f.name, f.data, {
          mode: get().dxfMode,
          idPrefix: newId('dxf'),
        });
        parts = [...parts, ...r.parts];
        reports.push({
          fileName: f.name,
          kind: 'dxf',
          partCount: r.parts.length,
          errors: r.errors,
          warnings: r.warnings,
        });
      } else {
        const r = parsePartsCsv(f.data, { idPrefix: newId('csv') });
        parts = replaced ? [...parts, ...r.parts] : r.parts;
        replaced = true;
        const withRow = (i: { row: number; message: string }) => `Řádek ${i.row}: ${i.message}`;
        reports.push({
          fileName: f.name,
          kind: 'csv',
          partCount: r.parts.length,
          errors: r.errors.map(withRow),
          warnings: r.warnings.map(withRow),
        });
      }
    }
    set({ parts, importReports: reports });
  },

  importCsv(fileName, data) {
    return get().importFiles([{ name: fileName, data }]);
  },

  setDxfMode(mode) {
    set({ dxfMode: mode });
  },

  addPart() {
    const n = get().parts.length + 1;
    set((s) => ({
      parts: [
        ...s.parts,
        {
          id: newId('dil'),
          name: `Díl ${n}`,
          width: 500,
          height: 300,
          quantity: 1,
          rotation: 'ortho',
        },
      ],
    }));
  },

  updatePart(id, patch) {
    set((s) => ({ parts: s.parts.map((p) => (p.id === id ? applyPatch(p, patch) : p)) }));
  },

  removePart(id) {
    set((s) => ({ parts: s.parts.filter((p) => p.id !== id) }));
  },

  updateParts(ids, patch) {
    const target = new Set(ids);
    set((s) => ({ parts: s.parts.map((p) => (target.has(p.id) ? applyPatch(p, patch) : p)) }));
  },

  removeParts(ids) {
    const target = new Set(ids);
    set((s) => ({ parts: s.parts.filter((p) => !target.has(p.id)) }));
  },

  clearParts() {
    set({ parts: [], importReports: [] });
  },

  addSheet() {
    set((s) => ({
      sheets: [...s.sheets, { ...DEFAULT_SHEET, id: newId('tabule'), name: 'Nová tabule' }],
    }));
  },

  updateSheet(id, patch) {
    set((s) => ({ sheets: s.sheets.map((sh) => (sh.id === id ? applyPatch(sh, patch) : sh)) }));
  },

  removeSheet(id) {
    set((s) => ({ sheets: s.sheets.filter((sh) => sh.id !== id) }));
  },

  addZone(sheetId) {
    set((s) => ({
      sheets: s.sheets.map((sh) =>
        sh.id === sheetId
          ? {
              ...sh,
              forbiddenZones: [...sh.forbiddenZones, rectZone(newId('zona'), 0, 0, 100, 100)],
            }
          : sh,
      ),
    }));
  },

  updateZone(sheetId, zoneId, zone) {
    set((s) => ({
      sheets: s.sheets.map((sh) =>
        sh.id === sheetId
          ? { ...sh, forbiddenZones: sh.forbiddenZones.map((z) => (z.id === zoneId ? zone : z)) }
          : sh,
      ),
    }));
  },

  removeZone(sheetId, zoneId) {
    set((s) => ({
      sheets: s.sheets.map((sh) =>
        sh.id === sheetId
          ? { ...sh, forbiddenZones: sh.forbiddenZones.filter((z) => z.id !== zoneId) }
          : sh,
      ),
    }));
  },

  setParams(patch) {
    set((s) => ({ params: { ...s.params, ...patch } }));
  },

  async calculate() {
    const { parts, sheets, params, status } = get();
    if (status === 'running') return;
    const input: NestingInput = { parts, sheets, params };
    set({ status: 'running', progress: null, issues: [], error: null, stopped: false });
    const onProgress = (p: NestProgress) =>
      set({
        progress: { step: p.step, total: p.totalSteps, fraction: p.fraction },
        result: p.best,
        resultInput: input,
      });
    let outcome: NestOutcome;
    try {
      outcome = await getClient().nest(input, onProgress);
    } catch (e) {
      if (e instanceof NestingAbortedError) {
        set({ status: 'idle', progress: null });
        return;
      }
      set({ status: 'error', error: e instanceof Error ? e.message : String(e), progress: null });
      return;
    }
    if (!outcome.ok) {
      set({
        status: 'error',
        issues: outcome.issues,
        progress: null,
        result: null,
        resultInput: null,
      });
      return;
    }
    set((s) => ({
      status: 'done',
      progress: null,
      result: outcome.result,
      resultInput: input,
      stopped: outcome.stopped,
      activeSheet: Math.min(s.activeSheet, Math.max(0, outcome.result.layouts.length - 1)),
    }));
  },

  async stop() {
    if (get().status !== 'running') return;
    await getClient().stop();
  },

  setActiveSheet(index) {
    set({ activeSheet: index });
  },
}));

/** Vrátí store do výchozího stavu (testy, nový projekt). */
export function resetAppStore(): void {
  client?.abort();
  useAppStore.setState(initialState);
}
