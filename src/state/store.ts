import { create } from 'zustand';
import { parsePartsCsv } from '../core/import/csv.ts';
import type { DxfPartMode, DxfPartsResult } from '../core/import/dxf-parts.ts';
import type { LayerRole, LayerRoles } from '../core/import/layers.ts';
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
import { drawingInUse, mergeReimport, type ImportedPart, type LoadedDrawing } from './drawings.ts';

/** Výsledek načtení jednoho souboru s díly (CSV, DXF nebo DWG). */
export interface ImportReport {
  readonly fileName: string;
  readonly kind: 'csv' | 'dxf' | 'dwg';
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
  /** Režim importu DXF/DWG: 1 soubor = 1 díl, nebo každý vnější obrys = díl. */
  readonly dxfMode: DxfPartMode;
  /** Výkresy, ze kterých jsou díly v zadání – pro nové načtení po změně rolí hladin. */
  readonly drawings: readonly LoadedDrawing[];
  /** Role hladin podle názvu (pamatují se); chybějící hladina = vnější obrys. */
  readonly layerRoles: LayerRoles;
  /** Texty s dílem přenášet i z hladin obrysů (pamatuje se). */
  readonly notesFromAllLayers: boolean;
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
  /** Index zobrazené tabule v `result.layouts`. */
  readonly activeSheet: number;
  /** Shodné tabule výsledku zobrazit a exportovat jednou s počtem opakování. */
  readonly groupSheets: boolean;
  /** Náhled plánu: jedna tabule s přiblížením, nebo přehled všech tabulí. */
  readonly planView: PlanViewMode;
}

export type PlanViewMode = 'single' | 'all';

export interface AppActions {
  /**
   * Načte soubory s díly: CSV nahradí seznam dílů (další soubory dávky už
   * přidávají), DXF a DWG díly přidá. Podle přípony .dxf/.dwg, jinak CSV.
   */
  importFiles(files: readonly ImportFile[]): Promise<void>;
  importCsv(fileName: string, data: ArrayBuffer): Promise<void>;
  setDxfMode(mode: DxfPartMode): void;
  /** Nastaví roli hladiny a znovu načte díly ze všech výkresů v zadání. */
  setLayerRole(layer: string, role: LayerRole): Promise<void>;
  /** Role hladin z úložiště (bez nového načtení výkresů). */
  setLayerRoles(roles: LayerRoles): void;
  /** Přenášet texty i z hladin obrysů; znovu načte výkresy (`reload` = false: jen nastavit). */
  setNotesFromAllLayers(value: boolean, reload?: boolean): Promise<void>;
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
  setGroupSheets(grouped: boolean): void;
  setPlanView(mode: PlanViewMode): void;
  /** Otevře tabuli `index` v náhledu jedné tabule. */
  openSheet(index: number): void;
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

/**
 * Název kopie dílu: číslo na konci názvu se zvýší o 1 a zachová počet číslic
 * („Bok 9“ → „Bok 10“, „A007“ → „A008“). Bez čísla na konci zůstane název stejný.
 */
export function nextPartName(name: string): string {
  const m = /^(.*?)(\d+)$/.exec(name);
  if (!m) return name;
  const digits = m[2]!;
  return m[1]! + (BigInt(digits) + 1n).toString().padStart(digits.length, '0');
}

export const DEFAULT_SHEET: Sheet = {
  id: 'tabule-1',
  name: 'Tabule 3000 × 1500',
  width: 3000,
  height: 1500,
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
  drawings: [],
  layerRoles: new Map(),
  notesFromAllLayers: false,
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
  groupSheets: true,
  planView: 'single',
};

/** Stav, který se při načtení jiného projektu vrátí na začátek. */
const projectReset = {
  importReports: [],
  drawings: [],
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

/** Pořadí nového načtení výkresů – starší, pomalejší načtení se zahodí. */
let reimportRun = 0;

/** Díly z výsledku importu spolu s polohou ve výkresu. */
const importedParts = (r: DxfPartsResult): ImportedPart[] =>
  r.parts.map((part, i) => ({ part, origin: r.origins[i] ?? part.id }));

function drawingReport(fileName: string, kind: 'dxf' | 'dwg', r: DxfPartsResult): ImportReport {
  return {
    fileName,
    kind,
    partCount: r.parts.length,
    errors: r.errors,
    warnings: r.warnings,
  };
}

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

/**
 * Znovu načte výkresy v zadání s rolemi hladin `roles` a sloučí je s aktuálním
 * seznamem dílů (`mergeReimport`). Starší, pomalejší načtení se zahodí.
 */
async function reimportDrawings(
  get: () => AppState,
  set: (partial: Partial<AppState>) => void,
  roles: LayerRoles,
): Promise<void> {
  const run = ++reimportRun;
  const targets = get().drawings.filter((d) => drawingInUse(d, get().parts));
  const results: DxfPartsResult[] = [];
  try {
    for (const d of targets) {
      results.push(
        await getClient().importDrawing(d.fileName, d.data, {
          mode: d.mode,
          idPrefix: newId(d.kind),
          layerRoles: roles,
          notesFromAllLayers: get().notesFromAllLayers,
        }),
      );
    }
  } catch (e) {
    if (run !== reimportRun) return;
    const message = e instanceof Error ? e.message : String(e);
    set({
      importReports: targets.map((d) => ({
        fileName: d.fileName,
        kind: d.kind,
        partCount: 0,
        errors: [`Nové načtení výkresu selhalo: ${message}`],
        warnings: [],
      })),
    });
    return;
  }
  if (run !== reimportRun) return;
  // Mezitím se mohly změnit díly i výkresy (načten projekt, smazány díly,
  // přidán výkres): sloučit s aktuálním stavem a jen výkresy, které v něm
  // ještě jsou.
  const current = get().drawings;
  let parts = get().parts;
  const updated = new Map<LoadedDrawing, LoadedDrawing>();
  const reports: ImportReport[] = [];
  targets.forEach((d, i) => {
    if (!current.includes(d)) return;
    const r = results[i]!;
    const merged = mergeReimport(parts, d, importedParts(r));
    parts = merged.parts;
    updated.set(d, { ...d, layers: r.layers, imported: merged.imported, memory: merged.memory });
    reports.push(drawingReport(d.fileName, d.kind, r));
  });
  set({
    parts,
    drawings: current
      .filter((d) => updated.has(d) || drawingInUse(d, parts))
      .map((d) => updated.get(d) ?? d),
    importReports: reports,
  });
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
    // Všechny soubory dávky se stejnými rolemi hladin a volbou textů.
    const roles = get().layerRoles;
    const notesFromAllLayers = get().notesFromAllLayers;
    /** Díly z prvního CSV dávky – nahradí seznam dílů. */
    let replacement: Part[] | null = null;
    const addedParts: Part[] = [];
    let addedDrawings: LoadedDrawing[] = [];
    const reports: ImportReport[] = [];
    for (const f of files) {
      const drawing = /\.(dxf|dwg)$/i.exec(f.name)?.[1]?.toLowerCase() as 'dxf' | 'dwg' | undefined;
      if (drawing) {
        const mode = get().dxfMode;
        const r = await getClient().importDrawing(f.name, f.data, {
          mode,
          idPrefix: newId(drawing),
          layerRoles: roles,
          notesFromAllLayers,
        });
        addedParts.push(...r.parts);
        addedDrawings.push({
          fileName: f.name,
          data: f.data,
          kind: drawing,
          mode,
          layers: r.layers,
          imported: importedParts(r),
          memory: new Map(),
        });
        reports.push(drawingReport(f.name, drawing, r));
      } else {
        const r = parsePartsCsv(f.data, { idPrefix: newId('csv') });
        if (replacement === null) {
          replacement = r.parts;
          addedParts.length = 0;
          addedDrawings = [];
        } else {
          addedParts.push(...r.parts);
        }
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
    // Během importu se mohlo cokoli změnit (nové načtení po změně role):
    // přidat k aktuálnímu stavu, ne k tomu před importem.
    const replace = replacement;
    set((s) =>
      replace
        ? { parts: [...replace, ...addedParts], drawings: addedDrawings, importReports: reports }
        : {
            parts: [...s.parts, ...addedParts],
            drawings: [...s.drawings, ...addedDrawings],
            importReports: reports,
          },
    );
    // Role nebo volba textů se během importu změnily – načíst znovu.
    if (get().layerRoles !== roles || get().notesFromAllLayers !== notesFromAllLayers) {
      await reimportDrawings(get, set, get().layerRoles);
    }
  },

  async setLayerRole(layer, role) {
    const roles = new Map(get().layerRoles);
    roles.set(layer, role);
    set({ layerRoles: roles });
    await reimportDrawings(get, set, roles);
  },

  setLayerRoles(roles) {
    set({ layerRoles: roles });
  },

  async setNotesFromAllLayers(value, reload = true) {
    if (get().notesFromAllLayers === value) return;
    set({ notesFromAllLayers: value });
    if (reload) await reimportDrawings(get, set, get().layerRoles);
  },

  importCsv(fileName, data) {
    return get().importFiles([{ name: fileName, data }]);
  },

  setDxfMode(mode) {
    set({ dxfMode: mode });
  },

  addPart() {
    set((s) => {
      // Nový díl je kopie posledního (včetně tvaru z DXF) s dalším číslem v názvu.
      const last = s.parts.at(-1);
      const part: Part = last
        ? { ...last, id: newId('dil'), name: nextPartName(last.name) }
        : {
            id: newId('dil'),
            name: 'Díl 1',
            width: 1750,
            height: 550,
            quantity: 5,
            rotation: 'ortho',
          };
      return { parts: [...s.parts, part] };
    });
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
    set({ parts: [], importReports: [], drawings: [] });
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

  setGroupSheets(grouped) {
    set({ groupSheets: grouped });
  },

  setPlanView(mode) {
    set({ planView: mode });
  },

  openSheet(index) {
    set({ activeSheet: index, planView: 'single' });
  },
}));

/** Vrátí store do výchozího stavu (testy, nový projekt). */
export function resetAppStore(): void {
  client?.abort();
  useAppStore.setState(initialState);
}
