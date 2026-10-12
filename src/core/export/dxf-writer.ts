import { strToU8, zipSync } from 'fflate';
import { pointsNear } from '../geometry/compare.ts';
import { bulgeToArc } from '../geometry/contour.ts';
import { ANGLE_EPS } from '../geometry/eps.ts';
import { pointsBBox } from '../geometry/polygon.ts';
import type { Contour, Point, Rect } from '../geometry/types.ts';
import type { NestingInput, NestingResult, Part, Sheet, SheetLayout } from '../model.ts';
import { placedContours, placePart } from '../placed.ts';

/** Vrstvy a jejich barvy (AutoCAD Color Index). */
export const DXF_LAYERS = {
  TABULE: 8,
  DILY: 7,
  OTVORY: 1,
  POPISKY: 3,
} as const;

export type DxfLayer = keyof typeof DXF_LAYERS;

export interface DxfOptions {
  /**
   * Zápis obrysů: `polyline` = uzavřená POLYLINE s bulge (oblouky přesně, obrys
   * jako jeden řetěz – výchozí), `lines-arcs` = jednotlivé LINE a ARC.
   * Plný kruh je v obou režimech CIRCLE.
   */
  readonly segments?: 'polyline' | 'lines-arcs';
  /** Popisky dílů na vrstvě POPISKY (výchozí ano). */
  readonly labels?: boolean;
}

export interface DxfFile {
  readonly name: string;
  readonly content: string;
}

const CRLF = '\r\n';

/** Číslo s tečkou, nejvýš 6 desetinných míst, bez exponentu a bez „-0". */
export function dxfNumber(n: number): string {
  if (!Number.isFinite(n)) throw new RangeError(`Neplatné číslo pro DXF: ${n}`);
  const s = n.toFixed(6).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

/**
 * Text pro R12: znaky mimo ASCII jako \U+XXXX (AutoCAD i CAM je přečtou bez
 * ohledu na kódovou stránku), řídicí znaky jako mezera.
 */
export function dxfText(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 32 || code === 127) out += ' ';
    else if (code < 127) out += ch;
    else if (code <= 0xffff) out += `\\U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
    else out += '?';
  }
  return out;
}

/** Normalizace úhlu do [0, 360) ve stupních. */
const normDeg = (deg: number) => {
  const r = ((deg % 360) + 360) % 360;
  return r >= 360 - ANGLE_EPS ? 0 : r;
};

class DxfBuilder {
  private readonly lines: string[] = [];

  pair(code: number, value: string | number): this {
    this.lines.push(String(code), typeof value === 'number' ? dxfNumber(value) : value);
    return this;
  }

  point(p: Point, base = 10): this {
    return this.pair(base, p.x)
      .pair(base + 10, p.y)
      .pair(base + 20, 0);
  }

  entity(type: string, layer: DxfLayer): this {
    return this.pair(0, type).pair(8, layer);
  }

  toString(): string {
    return this.lines.join(CRLF) + CRLF;
  }
}

/** Plný kruh zapsaný jako 2 vrcholy s bulge ±1 → střed a poloměr. */
function asCircle(contour: Contour): { center: Point; radius: number } | null {
  if (contour.length !== 2) return null;
  const [a, b] = contour as [Contour[0], Contour[0]];
  if (Math.abs(Math.abs(a.bulge) - 1) > 1e-9 || Math.abs(a.bulge - b.bulge) > 1e-9) return null;
  const radius = Math.hypot(b.x - a.x, b.y - a.y) / 2;
  if (radius <= 0) return null;
  return { center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, radius };
}

function writeContour(dxf: DxfBuilder, contour: Contour, layer: DxfLayer, opts: DxfOptions) {
  const circle = asCircle(contour);
  if (circle) {
    dxf.entity('CIRCLE', layer).point(circle.center).pair(40, circle.radius);
    return;
  }
  if (opts.segments === 'lines-arcs') {
    contour.forEach((v, i) => {
      const next = contour[(i + 1) % contour.length]!;
      const arc = bulgeToArc(v, next, v.bulge);
      if (!arc) {
        if (pointsNear(v, next)) return;
        dxf.entity('LINE', layer).point(v).point(next, 11);
        return;
      }
      // ARC v DXF běží vždy CCW od počátečního ke koncovému úhlu.
      const start = arc.sweep > 0 ? arc.startAngle : arc.startAngle + arc.sweep;
      dxf
        .entity('ARC', layer)
        .point(arc.center)
        .pair(40, arc.radius)
        .pair(50, normDeg(start))
        .pair(51, normDeg(start + Math.abs(arc.sweep)));
    });
    return;
  }
  dxf.entity('POLYLINE', layer).pair(66, 1).point({ x: 0, y: 0 }).pair(70, 1);
  contour.forEach((v, i) => {
    dxf.entity('VERTEX', layer).point(v);
    // Bulge jen u skutečného oblouku – stejný práh jako bulgeToArc (sagita).
    if (bulgeToArc(v, contour[(i + 1) % contour.length]!, v.bulge)) dxf.pair(42, v.bulge);
  });
  dxf.entity('SEQEND', layer);
}

function rectContour(r: Rect): Contour {
  return [
    { x: r.x, y: r.y, bulge: 0 },
    { x: r.x + r.width, y: r.y, bulge: 0 },
    { x: r.x + r.width, y: r.y + r.height, bulge: 0 },
    { x: r.x, y: r.y + r.height, bulge: 0 },
  ];
}

/**
 * Jedna tabule jako DXF R12 (AC1009) ASCII v mm. Obrys tabule a zakázané zóny
 * na vrstvě TABULE, vnější obrysy dílů na DILY, otvory na OTVORY, názvy dílů
 * na POPISKY. Neznámé ID dílu v rozložení vyhodí `RangeError`.
 */
export function writeSheetDxf(
  sheet: Sheet,
  layout: SheetLayout,
  parts: readonly Part[],
  opts: DxfOptions = {},
): string {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const placed = layout.placements.map((placement) => {
    const part = byId.get(placement.partId);
    if (!part) throw new RangeError(`Umístění odkazuje na neznámý díl „${placement.partId}".`);
    return { contours: placedContours(part, placement), label: placePart(part, placement) };
  });

  const sheetRect = { x: 0, y: 0, width: sheet.width, height: sheet.height };
  const ext = pointsBBox([
    { x: 0, y: 0 },
    { x: sheet.width, y: sheet.height },
    ...placed.flatMap((p) => [
      { x: p.label.bbox.x, y: p.label.bbox.y },
      { x: p.label.bbox.x + p.label.bbox.width, y: p.label.bbox.y + p.label.bbox.height },
    ]),
  ]);

  const dxf = new DxfBuilder();
  dxf
    .pair(0, 'SECTION')
    .pair(2, 'HEADER')
    .pair(9, '$ACADVER')
    .pair(1, 'AC1009')
    .pair(9, '$INSUNITS')
    .pair(70, '4')
    .pair(9, '$EXTMIN')
    .point({ x: ext.x, y: ext.y })
    .pair(9, '$EXTMAX')
    .point({ x: ext.x + ext.width, y: ext.y + ext.height })
    .pair(0, 'ENDSEC');

  const layers = Object.entries(DXF_LAYERS) as [DxfLayer, number][];
  dxf
    .pair(0, 'SECTION')
    .pair(2, 'TABLES')
    .pair(0, 'TABLE')
    .pair(2, 'LTYPE')
    .pair(70, '1')
    .pair(0, 'LTYPE')
    .pair(2, 'CONTINUOUS')
    .pair(70, '0')
    .pair(3, 'Solid line')
    .pair(72, '65')
    .pair(73, '0')
    .pair(40, 0)
    .pair(0, 'ENDTAB')
    .pair(0, 'TABLE')
    .pair(2, 'LAYER')
    .pair(70, String(layers.length));
  for (const [name, color] of layers) {
    dxf.pair(0, 'LAYER').pair(2, name).pair(70, '0').pair(62, String(color)).pair(6, 'CONTINUOUS');
  }
  dxf.pair(0, 'ENDTAB').pair(0, 'ENDSEC');

  dxf.pair(0, 'SECTION').pair(2, 'ENTITIES');
  writeContour(dxf, rectContour(sheetRect), 'TABULE', opts);
  for (const z of sheet.forbiddenZones) {
    writeContour(
      dxf,
      z.polygon.map((p) => ({ x: p.x, y: p.y, bulge: 0 })),
      'TABULE',
      opts,
    );
  }
  for (const p of placed) {
    writeContour(dxf, p.contours.outer, 'DILY', opts);
    for (const h of p.contours.holes) writeContour(dxf, h, 'OTVORY', opts);
  }
  if (opts.labels !== false) {
    for (const { label } of placed) {
      const { bbox, labelAt } = label;
      const height = Math.min(bbox.width, bbox.height) * 0.15;
      if (height <= 0) continue;
      // Zarovnání na střed (72 = 1) a doprostřed výšky (73 = 2) podle bodu 11/21.
      dxf
        .entity('TEXT', 'POPISKY')
        .point(labelAt)
        .pair(40, height)
        .pair(1, dxfText(label.part.name))
        .pair(72, '1')
        .pair(73, '2')
        .point(labelAt, 11);
    }
  }
  dxf.pair(0, 'ENDSEC').pair(0, 'EOF');
  return dxf.toString();
}

/** Název souboru: bezpečný název projektu + pořadí tabule doplněné nulami. */
export function sheetDxfFileName(project: string, index: number, count: number): string {
  const safe =
    project
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'plan';
  const digits = Math.max(2, String(count).length);
  return `${safe}-tabule-${String(index + 1).padStart(digits, '0')}.dxf`;
}

/** Všechny tabule výsledku – jeden DXF na tabuli. */
export function writeResultDxf(
  input: NestingInput,
  result: NestingResult,
  project: string,
  opts: DxfOptions = {},
): DxfFile[] {
  const sheets = new Map(input.sheets.map((s) => [s.id, s]));
  return result.layouts.map((layout, i) => {
    const sheet = sheets.get(layout.sheetId);
    if (!sheet) throw new RangeError(`Rozložení odkazuje na neznámou tabuli „${layout.sheetId}".`);
    return {
      name: sheetDxfFileName(project, i, result.layouts.length),
      content: writeSheetDxf(sheet, layout, input.parts, opts),
    };
  });
}

/** Soubory zabalené do ZIP (fflate). */
export function zipFiles(files: readonly DxfFile[], mtime?: Date): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) entries[f.name] = strToU8(f.content);
  return zipSync(entries, { level: 6, ...(mtime && { mtime }) });
}
