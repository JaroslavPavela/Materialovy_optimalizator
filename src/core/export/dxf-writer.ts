import { pointsNear } from '../geometry/compare.ts';
import { bulgeToArc } from '../geometry/contour.ts';
import { ANGLE_EPS, EPS } from '../geometry/eps.ts';
import { pointsBBox } from '../geometry/polygon.ts';
import type { Contour, Point, Rect } from '../geometry/types.ts';
import type {
  NestingInput,
  NestingResult,
  Part,
  PartNote,
  Sheet,
  SheetLayout,
  ShapeSegment,
} from '../model.ts';
import { labelSize, placedContours, placePart } from '../placed.ts';
import { singleSheetGroups, type SheetGroup } from '../sheet-groups.ts';
import { sheetFileName, type ExportFile } from './files.ts';

/** Vrstvy a jejich barvy (AutoCAD Color Index). */
export const DXF_LAYERS = {
  TABULE: 8,
  DILY: 7,
  OTVORY: 1,
  POPISKY: 3,
  ZBYTEK: 5,
} as const;

export type DxfLayer = keyof typeof DXF_LAYERS;

/** Barvy vrstev převzatých z výkresu podle role: obrys, otvor, přidaná geometrie. */
const DRAWING_LAYER_COLORS = { outer: 7, hole: 1, mark: 2 } as const;

/** Nejdelší název vrstvy v R12. */
const MAX_LAYER_NAME = 31;

/**
 * Název hladiny výkresu jako vrstva R12: velká písmena bez diakritiky,
 * znaky mimo A–Z, 0–9, $, -, _ jako „_", nejvýš 31 znaků. Prázdný název = „0".
 */
export function dxfLayerName(name: string): string {
  const ascii = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9$_-]/g, '_')
    .slice(0, MAX_LAYER_NAME);
  return ascii || '0';
}

type LayerKind = keyof typeof DRAWING_LAYER_COLORS;

/** Hladiny bez vlastního významu, které se v exportu převádí podle role. */
const GENERIC_LAYERS = new Set(['0', 'DILY', 'OTVORY']);

/**
 * Přiřazení názvů vrstev hladinám výkresu. Počítá se ze všech dílů zadání
 * (ne z jedné tabule), takže táž hladina má stejnou vrstvu ve všech souborech
 * exportu. Různé hladiny, které by po převodu splynuly (např. „Díra" a „DIRA"),
 * nebo hladina pojmenovaná jako vrstva exportu dostanou příponu _2, _3…
 * Hladiny 0, DILY a OTVORY (prostý výkres, díly z dřívějšího exportu) se
 * převádí podle role: vnější obrys na DILY, otvor na OTVORY, přidaná
 * geometrie na 0 – CAM tak dostane obrysy a otvory oddělené jako u CSV.
 */
class LayerNames {
  private readonly byName = new Map<string, string>();
  private readonly taken = new Set<string>(['0', ...Object.keys(DXF_LAYERS)]);
  readonly colors = new Map<string, number>();

  constructor(parts: readonly Part[]) {
    for (const p of parts) {
      const shape = p.shape;
      if (!shape?.layers) continue;
      this.add(shape.layers.outer, 'outer');
      for (const h of shape.layers.holes) this.add(h, 'hole');
      for (const m of shape.marks ?? []) this.add(m.layer, 'mark');
      for (const n of shape.notes ?? []) this.add(n.layer, 'mark');
    }
  }

  private static generic(name: string, kind: LayerKind): string | null {
    if (!GENERIC_LAYERS.has(dxfLayerName(name))) return null;
    return kind === 'outer' ? 'DILY' : kind === 'hole' ? 'OTVORY' : '0';
  }

  private add(name: string, kind: LayerKind) {
    if (LayerNames.generic(name, kind) !== null || this.byName.has(name)) return;
    const base = dxfLayerName(name);
    let out = base;
    for (let k = 2; this.taken.has(out); k++) {
      const suffix = `_${k}`;
      out = base.slice(0, MAX_LAYER_NAME - suffix.length) + suffix;
    }
    this.taken.add(out);
    this.byName.set(name, out);
    this.colors.set(out, DRAWING_LAYER_COLORS[kind]);
  }

  get(name: string, kind: LayerKind): string {
    return LayerNames.generic(name, kind) ?? this.byName.get(name) ?? dxfLayerName(name);
  }
}

export interface DxfOptions {
  /**
   * Zápis obrysů: `polyline` = uzavřená POLYLINE s bulge (oblouky přesně, obrys
   * jako jeden řetěz – výchozí), `lines-arcs` = jednotlivé LINE a ARC.
   * Plný kruh je v obou režimech CIRCLE.
   */
  readonly segments?: 'polyline' | 'lines-arcs';
  /** Popisky dílů na vrstvě POPISKY (výchozí ano). */
  readonly labels?: boolean;
  /**
   * Obrys zbytku tabule (vrstva ZBYTEK) – aby ho CAM mohl vyříznout jako
   * samostatný kus do skladu. Chybí-li, zbytek se nezapisuje.
   */
  readonly remnant?: Rect | null;
}

const CRLF = '\r\n';

/**
 * Přesnost zápisu: souřadnice a délky v mm na 6 desetinných míst; úhly ARC
 * a bulge přesněji, protože jejich chyba se násobí poloměrem / tětivou.
 */
const ANGLE_DIGITS = 12;
const BULGE_DIGITS = 9;

/**
 * Segment s výškou oblouku pod touto hodnotou se v režimu `lines-arcs` zapíše
 * jako LINE (odchylka < EPS). Téměř rovný oblouk má obří poloměr a zaokrouhlení
 * jeho úhlů by posunulo koncové body mimo navazující segmenty.
 */
export const DXF_MIN_ARC_SAGITTA = EPS;

/** Nejdelší řetězec v R12. */
const MAX_STRING = 255;

/** Číslo s tečkou, nejvýš `digits` desetinných míst, bez exponentu a bez „-0". */
export function dxfNumber(n: number, digits = 6): string {
  if (!Number.isFinite(n)) throw new RangeError(`Neplatné číslo pro DXF: ${n}`);
  const s = n.toFixed(digits).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

/**
 * Text pro R12: znaky mimo ASCII jako \U+XXXX (AutoCAD i CAM je přečtou bez
 * ohledu na kódovou stránku), řídicí znaky jako mezera. Zkrácen na 255 znaků
 * (limit řetězce R12) bez rozdělení escape sekvence.
 */
export function dxfText(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    let piece: string;
    if (code < 32 || code === 127) piece = ' ';
    // „%%" zahajuje řídicí kód TEXT (%%u, %%d…), „\U+" znak Unicode – zapsat doslova.
    else if (ch === '%') piece = '%%%';
    else if (ch === '\\') piece = '\\U+005C';
    else if (code < 127) piece = ch;
    else if (code <= 0xffff) piece = `\\U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
    else piece = '?';
    if (out.length + piece.length > MAX_STRING) break;
    out += piece;
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

  pair(code: number, value: string | number, digits?: number): this {
    this.lines.push(String(code), typeof value === 'number' ? dxfNumber(value, digits) : value);
    return this;
  }

  point(p: Point, base = 10): this {
    return this.pair(base, p.x)
      .pair(base + 10, p.y)
      .pair(base + 20, 0);
  }

  entity(type: string, layer: string): this {
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

/** Jeden segment jako LINE, nebo ARC (téměř rovný oblouk jako LINE). */
function writeSegment(dxf: DxfBuilder, s: ShapeSegment, layer: string) {
  const { a, b, bulge } = s;
  const sagitta = (Math.abs(bulge) * Math.hypot(b.x - a.x, b.y - a.y)) / 2;
  const arc = sagitta < DXF_MIN_ARC_SAGITTA ? null : bulgeToArc(a, b, bulge);
  if (!arc) {
    if (pointsNear(a, b)) return;
    dxf.entity('LINE', layer).point(a).point(b, 11);
    return;
  }
  // ARC v DXF běží vždy CCW od počátečního ke koncovému úhlu.
  const start = arc.sweep > 0 ? arc.startAngle : arc.startAngle + arc.sweep;
  dxf
    .entity('ARC', layer)
    .point(arc.center)
    .pair(40, arc.radius)
    .pair(50, normDeg(start), ANGLE_DIGITS)
    .pair(51, normDeg(start + Math.abs(arc.sweep)), ANGLE_DIGITS);
}

/**
 * Textová poznámka jako TEXT: výška, natočení, šířkový faktor (41), pozpátku
 * (71 = 2) a zarovnání 72/73 s bodem 11 (u zarovnání vlevo na účaří jen bod 10).
 */
function writeNote(dxf: DxfBuilder, n: PartNote, layer: string) {
  if (!n.text || !(n.height > 0)) return;
  dxf.entity('TEXT', layer).point(n.at).pair(40, n.height).pair(1, dxfText(n.text));
  if (Math.abs(n.rotation) > ANGLE_EPS) dxf.pair(50, normDeg(n.rotation), ANGLE_DIGITS);
  if (Math.abs(n.widthFactor - 1) > 1e-9) dxf.pair(41, n.widthFactor);
  if (n.backwards) dxf.pair(71, '2');
  if (n.halign !== 0 || n.valign !== 0) {
    dxf.pair(72, String(n.halign)).pair(73, String(n.valign)).point(n.at, 11);
  }
}

function writeContour(dxf: DxfBuilder, contour: Contour, layer: string, opts: DxfOptions) {
  const circle = asCircle(contour);
  if (circle) {
    dxf.entity('CIRCLE', layer).point(circle.center).pair(40, circle.radius);
    return;
  }
  if (opts.segments === 'lines-arcs') {
    contour.forEach((v, i) => {
      writeSegment(dxf, { a: v, b: contour[(i + 1) % contour.length]!, bulge: v.bulge }, layer);
    });
    return;
  }
  dxf.entity('POLYLINE', layer).pair(66, 1).point({ x: 0, y: 0 }).pair(70, 1);
  contour.forEach((v, i) => {
    dxf.entity('VERTEX', layer).point(v);
    // Bulge jen u skutečného oblouku – stejný práh jako bulgeToArc (sagita).
    if (bulgeToArc(v, contour[(i + 1) % contour.length]!, v.bulge)) {
      dxf.pair(42, v.bulge, BULGE_DIGITS);
    }
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
 * na vrstvě TABULE, názvy dílů na POPISKY. Obrysy, otvory a přidaná geometrie
 * dílů z výkresu na vrstvách podle původních hladin (`dxfLayerName`), ostatní
 * díly na DILY a OTVORY. Neznámé ID dílu v rozložení vyhodí `RangeError`.
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
    ...sheet.forbiddenZones.flatMap((z) => z.polygon),
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

  // Vrstvy z hladin výkresu; v tabulce jen ty, které tabule používá.
  const names = new LayerNames(parts);
  const partLayers = placed.map(({ contours: c }) => ({
    outer: c.layers ? names.get(c.layers.outer, 'outer') : 'DILY',
    holes: c.holes.map((_, k) => {
      const layer = c.layers?.holes[k];
      return layer === undefined ? 'OTVORY' : names.get(layer, 'hole');
    }),
    marks: (c.marks ?? []).map((m) => names.get(m.layer, 'mark')),
    notes: (c.notes ?? []).map((n) => names.get(n.layer, 'mark')),
  }));
  const used = new Set(partLayers.flatMap((l) => [l.outer, ...l.holes, ...l.marks, ...l.notes]));
  const layers: [string, number][] = [
    ...(Object.entries(DXF_LAYERS) as [DxfLayer, number][]),
    ...[...names.colors].filter(([n]) => used.has(n)),
  ];
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
    .pair(2, 'STYLE')
    .pair(70, '1')
    .pair(0, 'STYLE')
    .pair(2, 'STANDARD')
    .pair(70, '0')
    .pair(40, 0)
    .pair(41, 1)
    .pair(50, 0)
    .pair(71, '0')
    .pair(42, 2.5)
    .pair(3, 'txt')
    .pair(4, '')
    .pair(0, 'ENDTAB')
    .pair(0, 'TABLE')
    .pair(2, 'LAYER')
    .pair(70, String(layers.length + 1));
  // Vrstva 0 existuje v každém výkresu; některé starší čtečky ji vyžadují.
  for (const [name, color] of [['0', 7], ...layers] as const) {
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
  if (opts.remnant) writeContour(dxf, rectContour(opts.remnant), 'ZBYTEK', opts);
  placed.forEach(({ contours: c }, i) => {
    const layer = partLayers[i]!;
    writeContour(dxf, c.outer, layer.outer, opts);
    c.holes.forEach((h, k) => writeContour(dxf, h, layer.holes[k]!, opts));
    (c.marks ?? []).forEach((m, k) => {
      for (const s of m.segments) writeSegment(dxf, s, layer.marks[k]!);
    });
    (c.notes ?? []).forEach((n, k) => writeNote(dxf, n, layer.notes[k]!));
  });
  if (opts.labels !== false) {
    for (const { label } of placed) {
      const { labelAt } = label;
      // Výška velkých písmen ≈ 0,7 × velikost písma (stejná velikost jako SVG a náhled).
      const height = 0.7 * labelSize(label);
      if (!(height > 0)) continue;
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

/**
 * Všechny tabule výsledku – jeden DXF na tabuli, nebo na skupinu shodných
 * tabulí (`groups`, viz sheet-groups.ts; název souboru pak nese počet, např. `-4x`).
 */
export function writeResultDxf(
  input: NestingInput,
  result: NestingResult,
  project: string,
  opts: DxfOptions = {},
  groups: readonly SheetGroup[] = singleSheetGroups(result),
): ExportFile[] {
  const sheets = new Map(input.sheets.map((s) => [s.id, s]));
  return groups.map((group, g) => {
    const i = group.indices[0]!;
    const layout = result.layouts[i]!;
    const sheet = sheets.get(layout.sheetId);
    if (!sheet) throw new RangeError(`Rozložení odkazuje na neznámou tabuli „${layout.sheetId}".`);
    return {
      name: sheetFileName(project, g, groups.length, 'dxf', group.indices.length),
      content: writeSheetDxf(sheet, layout, input.parts, {
        remnant: result.metrics.sheets[i]?.remnant ?? null,
        ...opts,
      }),
    };
  });
}
