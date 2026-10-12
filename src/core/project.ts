import type { Contour, Point } from './geometry/types.ts';
import {
  DEFAULT_NESTING_PARAMS,
  type ForbiddenZone,
  type NestingMode,
  type NestingParams,
  type Part,
  type PartShape,
  type RotationMode,
  type Sheet,
} from './model.ts';

/** Zadání projektu – vše, co uživatel vyplnil (výsledek se dopočítá). */
export interface Project {
  readonly parts: readonly Part[];
  readonly sheets: readonly Sheet[];
  readonly params: NestingParams;
}

/** Identifikace souboru projektu – odliší ho od jiného JSON. */
export const PROJECT_FORMAT = 'materialovy-optimalizator/projekt';
export const PROJECT_VERSION = 1;

/** Projekt v podobě pro JSON soubor a úložiště. */
export interface ProjectFile extends Project {
  readonly format: typeof PROJECT_FORMAT;
  readonly version: number;
  /** Čas uložení, ISO 8601. */
  readonly savedAt: string;
}

export type ProjectReadResult =
  | { readonly ok: true; readonly project: Project; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly errors: readonly string[] };

export function toProjectFile(project: Project, savedAt: Date): ProjectFile {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    savedAt: savedAt.toISOString(),
    parts: project.parts,
    sheets: project.sheets,
    params: project.params,
  };
}

/** Projekt jako text JSON (odsazený, čitelný). */
export function serializeProject(project: Project, savedAt: Date): string {
  return `${JSON.stringify(toProjectFile(project, savedAt), null, 2)}\n`;
}

/** Načte projekt z textu JSON. */
export function parseProject(text: string): ProjectReadResult {
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return { ok: false, errors: ['Soubor není platný JSON.'] };
  }
  return projectFromJson(value);
}

const ROTATIONS: readonly RotationMode[] = ['free', 'ortho', 'flip', 'locked'];
const MODES: readonly NestingMode[] = ['rect', 'shape'];

type Obj = Readonly<Record<string, unknown>>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Čtení s hlášením chyb: kontroluje jen strukturu a typy. Hodnoty (kladné
 * rozměry apod.) ověří `validateNestingInput` před výpočtem, aby šel načíst
 * i rozpracovaný projekt.
 */
class Reader {
  readonly errors: string[] = [];
  readonly warnings: string[] = [];

  fail(where: string, message: string): null {
    this.errors.push(`${where}: ${message}`);
    return null;
  }

  num(o: Obj, key: string, where: string, label: string): number | null {
    const v = o[key];
    return isNum(v) ? v : this.fail(where, `${label} musí být číslo.`);
  }

  optNum(o: Obj, key: string, where: string, label: string): number | undefined | null {
    if (o[key] === undefined || o[key] === null) return undefined;
    return this.num(o, key, where, label);
  }

  str(o: Obj, key: string, where: string, label: string): string | null {
    const v = o[key];
    return typeof v === 'string' ? v : this.fail(where, `${label} musí být text.`);
  }

  optStr(o: Obj, key: string, where: string, label: string): string | undefined | null {
    if (o[key] === undefined || o[key] === null || o[key] === '') return undefined;
    return this.str(o, key, where, label);
  }

  points(v: unknown, where: string): Point[] | null {
    if (!Array.isArray(v)) return this.fail(where, 'obrys musí být seznam bodů.');
    const out: Point[] = [];
    for (const p of v) {
      if (!isObj(p) || !isNum(p.x) || !isNum(p.y)) {
        return this.fail(where, 'bod obrysu musí mít číselné x a y.');
      }
      out.push({ x: p.x, y: p.y });
    }
    return out;
  }

  contour(v: unknown, where: string): Contour | null {
    if (!Array.isArray(v)) return this.fail(where, 'obrys musí být seznam vrcholů.');
    const out: { x: number; y: number; bulge: number }[] = [];
    for (const p of v) {
      if (!isObj(p) || !isNum(p.x) || !isNum(p.y) || !(p.bulge === undefined || isNum(p.bulge))) {
        return this.fail(where, 'vrchol obrysu musí mít číselné x, y a bulge.');
      }
      out.push({ x: p.x, y: p.y, bulge: p.bulge ?? 0 });
    }
    return out;
  }

  shape(v: unknown, where: string): PartShape | undefined | null {
    if (v === undefined || v === null) return undefined;
    if (!isObj(v) || !Array.isArray(v.holes)) {
      return this.fail(where, 'tvar musí mít vnější obrys a seznam otvorů.');
    }
    const outer = this.contour(v.outer, where);
    const holes = v.holes.map((h) => this.contour(h, where));
    if (!outer || holes.some((h) => h === null)) return null;
    return { outer, holes: holes as Contour[] };
  }

  part(v: unknown, i: number): Part | null {
    const where = `Díl ${i + 1}`;
    if (!isObj(v)) return this.fail(where, 'musí být objekt.');
    const before = this.errors.length;
    const id = this.str(v, 'id', where, 'ID');
    const name = this.str(v, 'name', where, 'název');
    const width = this.num(v, 'width', where, 'šířka');
    const height = this.num(v, 'height', where, 'výška');
    const quantity = this.num(v, 'quantity', where, 'počet');
    const rotation = ROTATIONS.includes(v.rotation as RotationMode)
      ? (v.rotation as RotationMode)
      : this.fail(where, `neznámá rotace „${String(v.rotation)}".`);
    const material = this.optStr(v, 'material', where, 'materiál');
    const thickness = this.optNum(v, 'thickness', where, 'tloušťka');
    const shape = this.shape(v.shape, where);
    if (this.errors.length > before) return null;
    return {
      id: id!,
      name: name!,
      width: width!,
      height: height!,
      quantity: quantity!,
      rotation: rotation!,
      ...(material !== undefined && { material: material! }),
      ...(thickness !== undefined && { thickness: thickness! }),
      ...(shape !== undefined && { shape: shape! }),
    };
  }

  zone(v: unknown, where: string): ForbiddenZone | null {
    if (!isObj(v)) return this.fail(where, 'zakázaná zóna musí být objekt.');
    const id = this.str(v, 'id', where, 'ID zóny');
    const polygon = this.points(v.polygon, where);
    if (id === null || polygon === null) return null;
    return { id, polygon };
  }

  sheet(v: unknown, where: string): Sheet | null {
    if (!isObj(v)) return this.fail(where, 'musí být objekt.');
    const before = this.errors.length;
    const id = this.str(v, 'id', where, 'ID');
    const name = this.str(v, 'name', where, 'název');
    const width = this.num(v, 'width', where, 'šířka');
    const height = this.num(v, 'height', where, 'výška');
    const stock = v.stock === null ? null : this.num(v, 'stock', where, 'počet skladem');
    const margin = this.num(v, 'margin', where, 'okraj');
    const material = this.optStr(v, 'material', where, 'materiál');
    const thickness = this.optNum(v, 'thickness', where, 'tloušťka');
    let zones: (ForbiddenZone | null)[] = [];
    if (v.forbiddenZones !== undefined) {
      if (!Array.isArray(v.forbiddenZones)) {
        this.fail(where, 'zakázané zóny musí být seznam.');
      } else {
        zones = v.forbiddenZones.map((z) => this.zone(z, where));
      }
    }
    if (v.remnant !== undefined && typeof v.remnant !== 'boolean') {
      this.fail(where, 'příznak zbytku musí být ano/ne.');
    }
    if (this.errors.length > before) return null;
    return {
      id: id!,
      name: name!,
      width: width!,
      height: height!,
      stock,
      margin: margin!,
      forbiddenZones: zones as ForbiddenZone[],
      ...(material !== undefined && { material: material! }),
      ...(thickness !== undefined && { thickness: thickness! }),
      ...(v.remnant === true && { remnant: true }),
    };
  }

  params(v: unknown): NestingParams {
    if (v === undefined) {
      this.warnings.push('Projekt neobsahuje parametry výpočtu – použity výchozí.');
      return DEFAULT_NESTING_PARAMS;
    }
    const where = 'Parametry';
    if (!isObj(v)) {
      this.fail(where, 'musí být objekt.');
      return DEFAULT_NESTING_PARAMS;
    }
    const out: Record<string, unknown> = { ...DEFAULT_NESTING_PARAMS };
    const missing: string[] = [];
    for (const key of ['spacing', 'freeRotationStep', 'timeLimitMs', 'seed'] as const) {
      if (v[key] === undefined) missing.push(key);
      else if (isNum(v[key])) out[key] = v[key];
      else this.fail(where, `${key} musí být číslo.`);
    }
    if (v.mode === undefined) missing.push('mode');
    else if (MODES.includes(v.mode as NestingMode)) out.mode = v.mode;
    else this.fail(where, `neznámý režim „${String(v.mode)}".`);
    if (missing.length > 0) {
      this.warnings.push(`Chybějící parametry nahrazeny výchozími: ${missing.join(', ')}.`);
    }
    return out as unknown as NestingParams;
  }
}

/** Načte sheet z hodnoty JSON (např. z knihovny formátů); `null` = neplatný. */
export function sheetFromJson(value: unknown): Sheet | null {
  return new Reader().sheet(value, 'Tabule');
}

/** Ověří strukturu projektu z JSON (souboru nebo úložiště). */
export function projectFromJson(value: unknown): ProjectReadResult {
  if (!isObj(value) || value.format !== PROJECT_FORMAT) {
    return { ok: false, errors: ['Soubor není projekt Materiálového optimalizátoru.'] };
  }
  if (!isNum(value.version) || value.version > PROJECT_VERSION) {
    return {
      ok: false,
      errors: [
        `Nepodporovaná verze projektu ${String(value.version)} (podporována ≤ ${PROJECT_VERSION}).`,
      ],
    };
  }
  const r = new Reader();
  if (!Array.isArray(value.parts)) r.fail('Projekt', 'chybí seznam dílů.');
  if (!Array.isArray(value.sheets)) r.fail('Projekt', 'chybí seznam tabulí.');
  const parts = Array.isArray(value.parts) ? value.parts.map((p, i) => r.part(p, i)) : [];
  const sheets = Array.isArray(value.sheets)
    ? value.sheets.map((s, i) => r.sheet(s, `Tabule ${i + 1}`))
    : [];
  const params = r.params(value.params);
  if (r.errors.length > 0) return { ok: false, errors: r.errors };
  return {
    ok: true,
    project: { parts: parts as Part[], sheets: sheets as Sheet[], params },
    warnings: r.warnings,
  };
}
