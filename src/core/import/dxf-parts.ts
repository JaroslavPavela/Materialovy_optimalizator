import { contourArea, contourBBox } from '../geometry/contour.ts';
import { EPS } from '../geometry/eps.ts';
import { translateContour } from '../geometry/transform.ts';
import type { Contour } from '../geometry/types.ts';
import type { Part, PartShape, RotationMode } from '../model.ts';
import { buildContours, type ContourOptions, type ShapeRegion } from './contours.ts';
import { readDxf, type DxfReadOptions, type DxfUnits } from './dxf.ts';
import { prepareShape, regionLabels, samePreparedShape, type PreparedShape } from './part-names.ts';

/**
 * Režim importu: `single` = soubor je jeden díl (největší vnější obrys, uvnitř
 * otvory), `multi` = každý vnější obrys je samostatný díl pojmenovaný podle
 * textu uvnitř (největší písmo); stejné díly se stejným textem se sečtou.
 */
export type DxfPartMode = 'single' | 'multi';

export interface DxfPartsOptions extends DxfReadOptions, ContourOptions {
  readonly mode?: DxfPartMode;
  /** Předpona ID dílů; ID = `${idPrefix}-${pořadí}`. */
  readonly idPrefix?: string;
  /** Natočení nových dílů (výchozí 0/90/180/270°). */
  readonly rotation?: RotationMode;
  /** Vrstvy, ze kterých se díly skládají; chybí-li, všechny. */
  readonly layer?: (name: string) => boolean;
}

export interface DxfPartsResult {
  readonly parts: Part[];
  readonly units: DxfUnits;
  readonly warnings: readonly string[];
  /** Neuzavřené kontury, nečitelný soubor… Díly z uzavřených kontur se vrátí i tak. */
  readonly errors: readonly string[];
}

/** Název souboru bez cesty a přípony. */
export function baseName(fileName: string): string {
  const name = fileName.split(/[\\/]/).pop() ?? fileName;
  return name.replace(/\.[^.]*$/, '') || name || 'díl';
}

/** Tvar posunutý tak, aby levý dolní roh obalového obdélníku byl v (0, 0). */
function normalizeRegion(region: ShapeRegion, label: string | null) {
  const bb = contourBBox(region.outer);
  const move = (c: Contour) => translateContour(c, -bb.x, -bb.y);
  return {
    shape: { outer: move(region.outer), holes: region.holes.map(move) },
    width: bb.width,
    height: bb.height,
    // Pro pojmenování shora dolů a zleva doprava podle polohy ve výkresu.
    top: bb.y + bb.height,
    left: bb.x,
    label,
  };
}

/** Díly z jednoho souboru DXF. */
export function partsFromDxf(
  fileName: string,
  data: string | ArrayBuffer | Uint8Array,
  opts: DxfPartsOptions = {},
): DxfPartsResult {
  const mode = opts.mode ?? 'single';
  const read = readDxf(data, opts);
  if (!read.ok)
    return { parts: [], units: read.units, warnings: read.warnings, errors: read.errors };
  const filter = opts.layer;
  const segments = filter ? read.segments.filter((s) => filter(s.layer)) : read.segments;
  const built = buildContours(segments, opts);
  const warnings = [...read.warnings, ...built.warnings];
  const errors = [...read.errors, ...built.errors];

  let regions = [...built.regions];
  if (regions.length === 0) {
    if (segments.length > 0) errors.push('Ve výkresu není žádná uzavřená kontura.');
    else if (read.segments.length > 0) errors.push('Ve vybraných vrstvách není žádná geometrie.');
    return { parts: [], units: read.units, warnings, errors };
  }
  if (mode === 'single') {
    const largest = regions.reduce((a, b) => (contourArea(b.outer) > contourArea(a.outer) ? b : a));
    const inner = regions.filter((r) => r !== largest && r.depth > largest.depth).length;
    const outside = regions.length - 1 - inner;
    if (inner > 0) {
      warnings.push(
        `Uvnitř otvorů dílu je ${inner} dalších kontur – ignorovány (pro více dílů v souboru zvolte režim „více dílů").`,
      );
    }
    if (outside > 0) {
      warnings.push(
        `Mimo hlavní obrys je ${outside} dalších kontur – ignorovány (pro více dílů v souboru zvolte režim „více dílů").`,
      );
    }
    regions = [largest];
  }

  const base = baseName(fileName);
  const prefix = opts.idPrefix ?? 'dxf';
  const labels = mode === 'multi' ? regionLabels(regions, read.texts) : regions.map(() => null);
  const normalized = regions
    .map((r, i) => normalizeRegion(r, labels[i]!))
    .sort((a, b) => (Math.abs(b.top - a.top) > EPS ? b.top - a.top : a.left - b.left));

  // Díly se stejným textem a tvarem se sloučí (počet = počet kopií).
  interface Group {
    readonly label: string | null;
    /** Pořadí dílu bez textu / pořadí tvaru se stejným textem (od 1). */
    readonly index: number;
    readonly shape: PartShape;
    readonly prepared: PreparedShape | null;
    readonly width: number;
    readonly height: number;
    count: number;
    name: string;
  }
  const groups: Group[] = [];
  const byLabel = new Map<string, Group[]>();
  normalized.forEach((n, i) => {
    const part = { shape: n.shape, width: n.width, height: n.height, count: 1, name: '' };
    if (n.label === null) {
      groups.push({ ...part, label: null, index: i + 1, prepared: null });
      return;
    }
    const prepared = prepareShape(n.shape);
    const same = byLabel.get(n.label) ?? [];
    const match = same.find((g) => samePreparedShape(g.prepared!, prepared));
    if (match) {
      match.count++;
      return;
    }
    const group = { ...part, label: n.label, index: same.length + 1, prepared };
    same.push(group);
    byLabel.set(n.label, same);
    groups.push(group);
  });

  // Názvy: text z výkresu beze změny; jiný tvar se stejným textem `text-2`,
  // díl bez textu `soubor-pořadí` (jediný díl jen `soubor`). Vygenerovaný
  // název, který už existuje (např. text „A-2"), dostane další volné číslo.
  const used = new Set<string>();
  for (const g of groups) {
    if (g.label !== null && g.index === 1) {
      g.name = g.label;
      used.add(g.name);
    }
  }
  for (const g of groups) {
    if (g.name) continue;
    const stem = g.label ?? base;
    if (g.label === null && normalized.length === 1 && !used.has(base)) {
      g.name = base;
    } else {
      let k = g.index;
      while (used.has(`${stem}-${k}`)) k++;
      g.name = `${stem}-${k}`;
    }
    used.add(g.name);
  }
  for (const [label, same] of byLabel) {
    if (same.length > 1) {
      warnings.push(
        `Díly s textem „${label}" mají různý tvar nebo natočení – ponechány zvlášť: ${same.map((g) => g.name).join(', ')}.`,
      );
    }
  }

  const parts = groups.map((g, i): Part => ({
    id: `${prefix}-${i + 1}`,
    name: g.name,
    width: g.width,
    height: g.height,
    quantity: g.count,
    rotation: opts.rotation ?? 'ortho',
    shape: g.shape,
  }));
  return { parts, units: read.units, warnings, errors };
}
