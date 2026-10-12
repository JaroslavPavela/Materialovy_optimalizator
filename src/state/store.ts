import { create } from 'zustand';
import { parsePartsCsv, type CsvIssue } from '../core/import/csv.ts';
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
import { createNestingClient, NestingAbortedError, type NestingClient } from '../worker/client.ts';

export interface ImportReport {
  readonly fileName: string;
  readonly partCount: number;
  readonly errors: readonly CsvIssue[];
  readonly warnings: readonly CsvIssue[];
}

export type Status = 'idle' | 'running' | 'done' | 'error';

export interface AppState {
  readonly parts: readonly Part[];
  readonly sheets: readonly Sheet[];
  readonly params: NestingParams;
  readonly importReport: ImportReport | null;
  readonly status: Status;
  readonly progress: { readonly step: number; readonly total: number } | null;
  /** Výsledek a vstup, ze kterého vznikl (díly se mezitím mohou měnit). */
  readonly result: NestingResult | null;
  readonly resultInput: NestingInput | null;
  readonly stopped: boolean;
  readonly issues: readonly InputIssue[];
  readonly error: string | null;
  readonly activeSheet: number;
}

export interface AppActions {
  importCsv(fileName: string, data: ArrayBuffer): void;
  addPart(): void;
  /** Změna polí dílu; `undefined` volitelné pole smaže (materiál, tloušťka). */
  updatePart(id: string, patch: Patch<Part>): void;
  removePart(id: string): void;
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
  importReport: null,
  status: 'idle',
  progress: null,
  result: null,
  resultInput: null,
  stopped: false,
  issues: [],
  error: null,
  activeSheet: 0,
};

let client: NestingClient | null = null;
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

  importCsv(fileName, data) {
    const r = parsePartsCsv(data, { idPrefix: newId('csv') });
    set({
      parts: r.parts,
      importReport: {
        fileName,
        partCount: r.parts.length,
        errors: r.errors,
        warnings: r.warnings,
      },
    });
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

  clearParts() {
    set({ parts: [], importReport: null });
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
        progress: { step: p.step, total: p.totalSteps },
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
  useAppStore.setState(initialState);
}
