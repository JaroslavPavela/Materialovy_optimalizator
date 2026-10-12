import { contourArea, contourBBox } from '../geometry/contour.ts';
import { EPS } from '../geometry/eps.ts';
import { translateContour } from '../geometry/transform.ts';
import type { Contour } from '../geometry/types.ts';
import type { Part, RotationMode } from '../model.ts';
import { buildContours, type ContourOptions, type ShapeRegion } from './contours.ts';
import { readDxf, type DxfReadOptions, type DxfUnits } from './dxf.ts';

/**
 * Režim importu: `single` = soubor je jeden díl (největší vnější obrys, uvnitř
 * otvory), `multi` = každý vnější obrys je samostatný díl.
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
function normalizeRegion(region: ShapeRegion) {
  const bb = contourBBox(region.outer);
  const move = (c: Contour) => translateContour(c, -bb.x, -bb.y);
  return {
    shape: { outer: move(region.outer), holes: region.holes.map(move) },
    width: bb.width,
    height: bb.height,
    // Pro pojmenování shora dolů a zleva doprava podle polohy ve výkresu.
    top: bb.y + bb.height,
    left: bb.x,
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
  const normalized = regions
    .map(normalizeRegion)
    .sort((a, b) => (Math.abs(b.top - a.top) > EPS ? b.top - a.top : a.left - b.left));
  const parts = normalized.map((n, i): Part => ({
    id: `${prefix}-${i + 1}`,
    name: normalized.length === 1 ? base : `${base}-${i + 1}`,
    width: n.width,
    height: n.height,
    quantity: 1,
    rotation: opts.rotation ?? 'ortho',
    shape: n.shape,
  }));
  return { parts, units: read.units, warnings, errors };
}
