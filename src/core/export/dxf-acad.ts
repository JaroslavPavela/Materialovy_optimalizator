import {
  ACadVersion,
  Arc,
  CadDocument,
  Circle,
  Color,
  DxfWriter,
  DxfWriterConfiguration,
  Layer,
  Layout,
  Line,
  LwPolyline,
  LwPolylineVertex,
  MeasurementUnits,
  NotificationType,
  TextEntity,
  TextMirrorFlag,
  UnitsType,
  XY,
  XYZ,
  type Entity,
  type NotificationEventArgs,
} from '@node-projects/acad-ts';
import { pointsNear } from '../geometry/compare.ts';
import { bulgeToArc } from '../geometry/contour.ts';
import { ANGLE_EPS } from '../geometry/eps.ts';
import type { NestingInput, NestingResult, Part, Sheet, SheetLayout } from '../model.ts';
import { singleSheetGroups, type SheetGroup } from '../sheet-groups.ts';
import {
  asCircle,
  DXF_MIN_ARC_SAGITTA,
  LayerNames,
  MAX_MODERN_LAYER_NAME,
  modernLayerName,
  resultSheets,
  sheetDrawing,
  type DxfOptions,
  type SheetItem,
} from './dxf-writer.ts';
import type { ExportFile } from './files.ts';

// Zápis DXF 2000 a 2018 knihovnou acad-ts (port ACadSharp) – úplná struktura
// výkresu jako z AutoCADu (CLASSES, tabulky s identifikátory, bloky, OBJECTS).
// acad-ts vybírá zápis tabulek podle `constructor.name`, proto běží jen ve
// workeru (build s keepNames), stejně jako čtení DWG.

/** Verze DXF zapisované přes acad-ts. */
export type ModernDxfVersion = '2000' | '2018';

const ACAD_VERSION: Record<ModernDxfVersion, ACadVersion> = {
  '2000': ACadVersion.AC1015,
  '2018': ACadVersion.AC1032,
};

const DEG = Math.PI / 180;
const xyz = (p: { x: number; y: number }) => new XYZ(p.x, p.y, 0);

/** Úhel ve stupních do [0, 360). */
const normDeg = (deg: number) => {
  const r = ((deg % 360) + 360) % 360;
  return r >= 360 - ANGLE_EPS ? 0 : r;
};

/**
 * Text TEXT jako v R12 (`dxfText`): „%" jako „%%%" (jinak by „%%d" byl znak
 * stupně) a „\" jako \U+005C (jinak by „\U+0041" čtečka převedla na znak).
 */
const textValue = (text: string) => text.replace(/%/g, '%%%').replace(/\\/g, '\\U+005C');

/** Prvek výkresu jako entita acad-ts (null = nic k zápisu). */
function toEntity(item: SheetItem): Entity | null {
  if (item.kind === 'contour') {
    const circle = asCircle(item.contour);
    if (circle) return new Circle(xyz(circle.center), circle.radius);
    const lw = new LwPolyline(
      item.contour.map((v, i) => {
        const out = new LwPolylineVertex(new XY(v.x, v.y));
        // Bulge jen u skutečného oblouku – stejný práh jako R12.
        if (bulgeToArc(v, item.contour[(i + 1) % item.contour.length]!, v.bulge)) {
          out.bulge = v.bulge;
        }
        return out;
      }),
    );
    lw.isClosed = true;
    return lw;
  }
  if (item.kind === 'segment') {
    const { a, b, bulge } = item.segment;
    const sagitta = (Math.abs(bulge) * Math.hypot(b.x - a.x, b.y - a.y)) / 2;
    const arc = sagitta < DXF_MIN_ARC_SAGITTA ? null : bulgeToArc(a, b, bulge);
    if (!arc) return pointsNear(a, b) ? null : new Line(xyz(a), xyz(b));
    // ARC běží vždy CCW od počátečního ke koncovému úhlu, oba v [0, 360).
    const start = normDeg(arc.sweep > 0 ? arc.startAngle : arc.startAngle + arc.sweep);
    const end = normDeg(start + Math.abs(arc.sweep));
    return new Arc(xyz(arc.center), arc.radius, start * DEG, end * DEG);
  }
  const n = item.note;
  const t = new TextEntity(textValue(n.text));
  t.height = n.height;
  t.insertPoint = xyz(n.at);
  t.alignmentPoint = xyz(n.at);
  t.rotation = n.rotation * DEG;
  t.widthFactor = n.widthFactor;
  t.horizontalAlignment = n.halign;
  t.verticalAlignment = n.valign;
  if (n.backwards) t.mirror = TextMirrorFlag.Backward;
  return t;
}

/**
 * Text DXF 2000 (kódová stránka ANSI_1252): znaky mimo ASCII jako \U+XXXX –
 * tak je zapisuje AutoCAD a čtečky je převedou zpět (i v názvech vrstev).
 */
function asciiDxf(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 128) out += ch;
    else if (code <= 0xffff) out += `\\U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
    else out += '?';
  }
  return out;
}

/** Nejdelší název vrstvy, který acad-ts u DXF 2000 (AC1015) zapíše. */
const MAX_LAYER_NAME_2000 = 31;

/** Název vrstvy DXF 2000: jako 2018, nejvýš 31 znaků, znaky mimo BMP jako „_". */
const layerName2000 = (name: string) =>
  [...modernLayerName(name).replace(/[\u{10000}-\u{10ffff}]/gu, '_')]
    .slice(0, MAX_LAYER_NAME_2000)
    .join('')
    .trim() || '0';

/** Přiřazení vrstev pro DXF 2000+ (původní názvy hladin, viz `modernLayerName`). */
export const modernLayerNames = (parts: readonly Part[], version: ModernDxfVersion = '2018') =>
  version === '2000'
    ? new LayerNames(parts, layerName2000, MAX_LAYER_NAME_2000)
    : new LayerNames(parts, modernLayerName, MAX_MODERN_LAYER_NAME);

/**
 * Jedna tabule jako DXF 2000 (AC1015) nebo 2018 (AC1032) ASCII v mm – stejné
 * vrstvy a prvky jako R12 (`sheetDrawing`), obrysy jako uzavřené LWPOLYLINE
 * s bulge, vrstvy s původními názvy hladin. Verze 2018 je v UTF-8, verze
 * 2000 jen v ASCII (znaky mimo ASCII jako \U+XXXX).
 */
export function writeSheetDxfModern(
  sheet: Sheet,
  layout: SheetLayout,
  parts: readonly Part[],
  version: ModernDxfVersion,
  opts: DxfOptions = {},
  names: LayerNames = modernLayerNames(parts, version),
): string {
  const drawing = sheetDrawing(sheet, layout, parts, opts, names);
  const doc = new CadDocument(ACAD_VERSION[version], true);
  // Slovníky a rozvržení Model / Layout1 jako ve výkresu z AutoCADu.
  doc.updateCollections(true, true);
  const model = new Layout(Layout.modelLayoutName);
  model.associatedBlock = doc.modelSpace!;
  doc.layouts!.add(model);
  const paper = new Layout(Layout.paperLayoutName);
  paper.associatedBlock = doc.paperSpace!;
  doc.layouts!.add(paper);
  doc.header!.insUnits = UnitsType.Millimeters;
  doc.header!.measurementUnits = MeasurementUnits.Metric;
  const { extents: e } = drawing;
  doc.header!.modelSpaceExtMin = new XYZ(e.x, e.y, 0);
  doc.header!.modelSpaceExtMax = new XYZ(e.x + e.width, e.y + e.height, 0);
  const layers = new Map<string, Layer>();
  for (const [name, color] of drawing.layers) {
    const layer = new Layer(name);
    layer.color = new Color(color);
    doc.layers!.add(layer);
    layers.set(name, layer);
  }
  const layerOf = (name: string) => {
    let layer = layers.get(name) ?? doc.layers!.tryGetValue(name);
    if (!layer) {
      layer = new Layer(name);
      doc.layers!.add(layer);
      layers.set(name, layer);
    }
    return layer;
  };
  for (const item of drawing.items) {
    const entity = toEntity(item);
    if (!entity) continue;
    entity.layer = layerOf(item.layer);
    doc.entities!.add(entity);
  }
  const config = new DxfWriterConfiguration();
  // Přesnost jako R12 (souřadnice 6 míst, úhly a bulge víc) a bez exponentu.
  config.decimalPrecision = 9;
  config.addHeaderVariable('$EXTMIN');
  config.addHeaderVariable('$EXTMAX');
  // Položku, která neprojde kontrolou (např. název vrstvy), acad-ts jen ohlásí
  // a vynechá – export by tiše odkazoval na neexistující vrstvu.
  const problems: string[] = [];
  const notify = (_: unknown, e: NotificationEventArgs) => {
    if (
      e.notificationType === NotificationType.Warning ||
      e.notificationType === NotificationType.Error
    ) {
      problems.push(e.message);
    }
  };
  const out: string[] = [];
  DxfWriter.writeToStream({ write: (s: string) => out.push(s) }, doc, false, config, notify);
  if (problems.length > 0) throw new Error(`Zápis DXF ${version}: ${problems.join(' ')}`);
  const text = out.join('');
  return version === '2000' ? asciiDxf(text) : text;
}

/** Všechny tabule výsledku jako DXF 2000/2018 – jako `writeResultDxf`. */
export function writeResultDxfModern(
  input: NestingInput,
  result: NestingResult,
  project: string,
  version: ModernDxfVersion,
  opts: DxfOptions = {},
  groups: readonly SheetGroup[] = singleSheetGroups(result),
  only?: number,
): ExportFile[] {
  const names = modernLayerNames(input.parts, version);
  return resultSheets(input, result, project, groups, only).map((s) => ({
    name: s.name,
    content: writeSheetDxfModern(
      s.sheet,
      s.layout,
      input.parts,
      version,
      { remnant: s.remnant, ...opts },
      names,
    ),
  }));
}
