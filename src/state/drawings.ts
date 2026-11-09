import type { DxfPartMode } from '../core/import/dxf-parts.ts';
import { originsMatch, type DrawingLayer } from '../core/import/layers.ts';
import type { Part } from '../core/model.ts';

/** Díl z posledního importu výkresu a jeho poloha ve výkresu (klíč spárování). */
export interface ImportedPart {
  /** Díl tak, jak ho vrátil import (s ID v seznamu dílů). */
  readonly part: Part;
  readonly origin: string;
}

/** Pole dílu, která uživatel může v tabulce změnit a která nové načtení nepřepíše. */
const EDITABLE = ['name', 'quantity', 'rotation', 'material', 'thickness'] as const;
type Editable = (typeof EDITABLE)[number];

/** Ruční úpravy dílu: změněná pole (hodnota `undefined` = pole smazané). */
export type PartEdits = { readonly [K in Editable]?: Part[K] | undefined };

/**
 * Co si výkres pamatuje o dílech, které v posledním importu nejsou: díl
 * odebraný uživatelem (`removed`) se nevrátí, díl, který zmizel kvůli roli
 * hladiny, se po návratu obnoví i s ručními úpravami.
 */
export type PartMemory = ReadonlyMap<string, PartEdits | 'removed'>;

/**
 * Načtený výkres DXF/DWG, který zůstává v paměti, aby se po změně rolí hladin
 * dal načíst znovu bez nového nahrání souboru. Neukládá se do projektu.
 */
export interface LoadedDrawing {
  readonly fileName: string;
  readonly data: ArrayBuffer;
  readonly kind: 'dxf' | 'dwg';
  /** Režim, ve kterém byl výkres načten (při novém načtení se nemění). */
  readonly mode: DxfPartMode;
  readonly layers: readonly DrawingLayer[];
  /** Díly posledního importu – podle nich se poznají ruční úpravy. */
  readonly imported: readonly ImportedPart[];
  readonly memory: PartMemory;
}

/** Je výkres ještě v zadání? Výkres bez dílů zůstává (role hladin ho mohou opravit). */
export function drawingInUse(drawing: LoadedDrawing, parts: readonly Part[]): boolean {
  if (drawing.imported.length === 0) return true;
  const ids = new Set(drawing.imported.map((p) => p.part.id));
  return parts.some((p) => ids.has(p.id));
}

/** Pole, ve kterých se díl v seznamu liší od importu. */
function editsOf(current: Part, before: Part): PartEdits {
  const out: Record<string, unknown> = {};
  for (const k of EDITABLE) if (current[k] !== before[k]) out[k] = current[k];
  return out as PartEdits;
}

function applyEdits(part: Part, edits: PartEdits): Part {
  const out: Record<string, unknown> = { ...part };
  for (const k of EDITABLE) {
    if (!Object.hasOwn(edits, k)) continue;
    const v = edits[k];
    if (v === undefined) delete out[k];
    else out[k] = v;
  }
  return out as unknown as Part;
}

/**
 * Nahradí díly výkresu v seznamu `parts` novým načtením `fresh`. Díly se
 * párují podle polohy ve výkresu (`originsMatch` – společná kopie, tolerance
 * uzavřené mezery), ne podle názvu:
 * - spárovaný díl převezme nový tvar a rozměry, ale zachová ID a ručně
 *   změněná pole (název, počet, natočení, materiál, tloušťku); rozdělí-li se
 *   sloučený díl, dostanou úpravy všechny části (další s novým ID),
 * - díl, který uživatel ze seznamu odebral, se nevrátí,
 * - díl, který zmizel kvůli roli hladiny, se zapamatuje i s úpravami,
 * - nový díl se přidá.
 * Díly jsou na místě prvního dílu výkresu, jinak na konci.
 */
export function mergeReimport(
  parts: readonly Part[],
  drawing: Pick<LoadedDrawing, 'imported' | 'memory'>,
  fresh: readonly ImportedPart[],
): { parts: Part[]; imported: ImportedPart[]; memory: PartMemory } {
  const memory = new Map(drawing.memory);
  const byId = new Map(drawing.imported.map((p) => [p.part.id, p]));
  const present = parts.flatMap((p) => {
    const before = byId.get(p.id);
    return before ? [{ origin: before.origin, current: p, before: before.part, used: false }] : [];
  });
  for (const { origin } of drawing.imported) {
    if (!present.some((p) => p.origin === origin)) memory.set(origin, 'removed');
  }
  const remembered = (origin: string) => {
    for (const [key, value] of memory) if (originsMatch(key, origin)) return { key, value };
    return null;
  };

  const merged: Part[] = [];
  const imported: ImportedPart[] = [];
  for (const f of fresh) {
    const matches = present.filter((p) => originsMatch(p.origin, f.origin));
    const match = matches.find((p) => !p.used) ?? matches[0];
    if (match) {
      const id = match.used ? f.part.id : match.current.id;
      match.used = true;
      merged.push(applyEdits({ ...f.part, id }, editsOf(match.current, match.before)));
      imported.push({ part: { ...f.part, id }, origin: f.origin });
      continue;
    }
    const memo = remembered(f.origin);
    if (memo?.value === 'removed') continue;
    if (memo) memory.delete(memo.key);
    merged.push(memo ? applyEdits(f.part, memo.value) : f.part);
    imported.push(f);
  }
  // Díly v seznamu, které nové načtení nevrátilo: zapamatovat úpravy.
  for (const p of present) {
    if (!p.used) memory.set(p.origin, editsOf(p.current, p.before));
  }

  const inDrawing = (p: Part) => byId.has(p.id);
  const first = parts.findIndex(inDrawing);
  const rest = parts.filter((p) => !inDrawing(p));
  const at = first < 0 ? rest.length : parts.slice(0, first).filter((p) => !inDrawing(p)).length;
  return { parts: [...rest.slice(0, at), ...merged, ...rest.slice(at)], imported, memory };
}
