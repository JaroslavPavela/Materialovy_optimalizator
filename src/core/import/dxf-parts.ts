import {
  approximateSegment,
  contourArea,
  contourBBox,
  contourToRing,
  segmentMidpoint,
} from '../geometry/contour.ts';
import { rectsNear } from '../geometry/compare.ts';
import { EPS } from '../geometry/eps.ts';
import { pointInRing, pointRingDistance, pointsBBox } from '../geometry/polygon.ts';
import { RectIndex } from '../geometry/rect-index.ts';
import { translateContour } from '../geometry/transform.ts';
import type { Contour, Point, Rect, Ring } from '../geometry/types.ts';
import type { Part, PartMarks, PartNote, PartShape, RotationMode, ShapeSegment } from '../model.ts';
import { noteCorners } from '../notes.ts';
import { plural } from '../plural.ts';
import { buildContours, JOIN_TOL, type ContourOptions, type ShapeRegion } from './contours.ts';
import {
  readDxf,
  type DxfReadOptions,
  type DxfSegment,
  type DxfText,
  type DxfUnits,
} from './dxf.ts';
import { drawingLayers, layerRole, type DrawingLayer, type LayerRoles } from './layers.ts';
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
  /** Role hladin (vnější/vnitřní obrys, přidat k dílu, ignorovat); chybějící = vnější obrys. */
  readonly layerRoles?: LayerRoles;
  /**
   * Texty s dílem přenést i z hladin obrysů (vnější a vnitřní obrys), ne jen
   * z hladin „přidej k dílu".
   */
  readonly notesFromAllLayers?: boolean;
}

export interface DxfPartsResult {
  readonly parts: Part[];
  /**
   * Poloha každého dílu ve výkresu ve stejném pořadí jako `parts`: obalové
   * obdélníky všech kopií (`x,y,š,v` na 0,01 mm) oddělené „|". Podle ní se díly
   * po novém načtení se změněnými rolemi hladin spárují s dřívějšími (název
   * se může změnit) – viz `originsMatch` v layers.ts.
   */
  readonly origins: readonly string[];
  /** Hladiny s geometrií ve výkresu (všechny, bez ohledu na role). */
  readonly layers: readonly DrawingLayer[];
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

/** Oblast s geometrií přidanou k dílu. */
interface MarkedRegion extends ShapeRegion {
  readonly marks: readonly PartMarks[];
  readonly notes: readonly PartNote[];
}

/**
 * Přiřadí texty (všechny řádky najednou) nejhlouběji vnořené oblasti, v jejímž
 * vnějším obrysu leží celý odhadnutý obdélník každého řádku (`noteCorners`,
 * tolerance 2 × joinTol; v otvoru ležet smí). Ostatní vrátí jako `outside`.
 */
function attachNotes(
  regions: readonly MarkedRegion[],
  texts: readonly DxfText[],
  joinTol: number,
): { regions: MarkedRegion[]; outside: Map<string, number> } {
  const outside = new Map<string, number>();
  if (texts.length === 0) return { regions: [...regions], outside };
  const tol = 2 * joinTol;
  const bboxes = regions.map((r) => contourBBox(r.outer));
  // Obrys se aproximuje jen u dílů, ke kterým se nějaký text blíží.
  const rings = new Map<number, Ring>();
  const ringOf = (i: number) => {
    let ring = rings.get(i);
    if (!ring) rings.set(i, (ring = contourToRing(regions[i]!.outer, joinTol)));
    return ring;
  };
  const notes = regions.map(() => [] as PartNote[]);
  const inBox = (p: Point, b: Rect) =>
    p.x >= b.x - tol &&
    p.y >= b.y - tol &&
    p.x <= b.x + b.width + tol &&
    p.y <= b.y + b.height + tol;
  /** Obdélník řádku (4 rohy) leží v obrysu a jeho hrany hranici nekříží (tvar U). */
  const boxInside = (corners: readonly Point[], i: number) => {
    if (!corners.every((p) => inBox(p, bboxes[i]!))) return false;
    const ring = ringOf(i);
    if (!corners.every((p) => pointInRing(p, ring) || pointRingDistance(p, ring) <= tol)) {
      return false;
    }
    return corners.every((p, k) => {
      const q = corners[(k + 1) % corners.length]!;
      return !ring.some((c, j) => crossesProperly(p, q, c, ring[(j + 1) % ring.length]!, tol));
    });
  };
  const index = new RectIndex(bboxes);
  for (const t of texts) {
    if (t.lines.length === 0) continue;
    const boxes = t.lines.map((l) => noteCorners(l));
    let best = -1;
    // Jen oblasti, do jejichž obalového obdélníku text zasahuje.
    for (const i of index.query(pointsBBox(boxes.flat()), tol)) {
      if (best >= 0 && regions[best]!.depth >= regions[i]!.depth) continue;
      if (boxes.every((c) => boxInside(c, i))) best = i;
    }
    if (best < 0) outside.set(t.layer, (outside.get(t.layer) ?? 0) + 1);
    else for (const l of t.lines) notes[best]!.push({ ...l, layer: t.layer });
  }
  return {
    regions: regions.map((r, i) => ({ ...r, notes: notes[i]! })),
    outside,
  };
}

/** Úsečky `a–b` a `c–d` se protínají uvnitř obou (dotyk ani překryv ne). */
function crossesProperly(a: Point, b: Point, c: Point, d: Point, tol: number): boolean {
  const side = (p: Point, q: Point, r: Point) => {
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    // Vzdálenost bodu r od přímky p–q se znaménkem.
    return len === 0 ? 0 : ((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)) / len;
  };
  const d1 = side(c, d, a);
  const d2 = side(c, d, b);
  const d3 = side(a, b, c);
  const d4 = side(a, b, d);
  return (
    ((d1 > tol && d2 < -tol) || (d1 < -tol && d2 > tol)) &&
    ((d3 > tol && d4 < -tol) || (d3 < -tol && d4 > tol))
  );
}

/** Oblast připravená pro test, zda v ní leží segment. */
interface RegionTest {
  readonly ring: Ring;
  readonly bbox: Rect;
}

/**
 * Leží segment v obrysu oblasti? Konce a střed uvnitř nebo na hranici
 * (do `tol`) a segment hranici nikde nepřekříží (úsečka přes zářez tvaru U).
 * V otvoru ležet smí.
 */
function segmentInside(s: DxfSegment, r: RegionTest, tol: number): boolean {
  const { ring, bbox } = r;
  const inside = (p: Point) =>
    p.x >= bbox.x - tol &&
    p.y >= bbox.y - tol &&
    p.x <= bbox.x + bbox.width + tol &&
    p.y <= bbox.y + bbox.height + tol &&
    (pointInRing(p, ring) || pointRingDistance(p, ring) <= tol);
  if (!inside(s.a) || !inside(s.b) || !inside(segmentMidpoint(s.a, s.b, s.bulge))) return false;
  const pts = [s.a, ...approximateSegment(s.a, s.b, s.bulge, tol / 2)];
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[i + 1]!;
    const lo = { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y) };
    const hi = { x: Math.max(p.x, q.x), y: Math.max(p.y, q.y) };
    for (let k = 0; k < ring.length; k++) {
      const c = ring[k]!;
      const d = ring[(k + 1) % ring.length]!;
      if (Math.max(c.x, d.x) < lo.x || Math.min(c.x, d.x) > hi.x) continue;
      if (Math.max(c.y, d.y) < lo.y || Math.min(c.y, d.y) > hi.y) continue;
      if (crossesProperly(p, q, c, d, tol)) return false;
    }
  }
  return true;
}

/**
 * Přiřadí segmenty hladin „přidej k dílu" nejhlouběji vnořené oblasti, jejíž
 * vnější obrys je obsahuje (`segmentInside`, tolerance 2 × joinTol). Ostatní
 * segmenty vrátí jako `outside` (počty po hladinách).
 */
function attachMarks(
  regions: readonly ShapeRegion[],
  segments: readonly DxfSegment[],
  joinTol: number,
): { regions: MarkedRegion[]; outside: Map<string, number> } {
  const tol = 2 * joinTol;
  const prepared = regions.map((r) => ({
    // Aproximace s odchylkou joinTol stačí na test s tolerancí 2 × joinTol.
    ring: contourToRing(r.outer, joinTol),
    bbox: contourBBox(r.outer),
    byLayer: new Map<string, ShapeSegment[]>(),
  }));
  const outside = new Map<string, number>();
  const index = new RectIndex(prepared.map((p) => p.bbox));
  for (const s of segments) {
    let best = -1;
    // Jen oblasti, do jejichž obalového obdélníku segment zasahuje.
    const reach = pointsBBox([s.a, s.b, segmentMidpoint(s.a, s.b, s.bulge)]);
    for (const i of index.query(reach, tol)) {
      if (best >= 0 && regions[best]!.depth >= regions[i]!.depth) continue;
      if (segmentInside(s, prepared[i]!, tol)) best = i;
    }
    if (best < 0) {
      outside.set(s.layer, (outside.get(s.layer) ?? 0) + 1);
      continue;
    }
    const byLayer = prepared[best]!.byLayer;
    const list = byLayer.get(s.layer);
    const seg = { a: s.a, b: s.b, bulge: s.bulge };
    if (list) list.push(seg);
    else byLayer.set(s.layer, [seg]);
  }
  return {
    regions: regions.map((r, i) => ({
      ...r,
      marks: [...prepared[i]!.byLayer].map(([layer, segs]) => ({ layer, segments: segs })),
      notes: [],
    })),
    outside,
  };
}

/** Tolerance shody přidané geometrie a otvorů při slučování stejných dílů (mm). */
const SAME_TOL = 0.05;

/**
 * Mají dva tvary (stejný obrys podle `samePreparedShape`, oba posunuté do
 * počátku) stejné hladiny obrysu a otvorů a stejnou přidanou geometrii na
 * stejných místech? Otvory se párují podle obalového obdélníku.
 */
function sameLayersAndMarks(a: PartShape, b: PartShape, label: string | null): boolean {
  if (a.layers?.outer !== b.layers?.outer) return false;
  const holes = (s: PartShape) =>
    s.holes.map((h, i) => ({ bbox: contourBBox(h), layer: s.layers?.holes[i] }));
  const free = holes(b);
  for (const h of holes(a)) {
    const k = free.findIndex((o) => o.layer === h.layer && rectsNear(o.bbox, h.bbox, SAME_TOL));
    if (k < 0) return false;
    free.splice(k, 1);
  }
  const flat = (s: PartShape) =>
    (s.marks ?? []).flatMap((m) => m.segments.map((g) => ({ ...g, layer: m.layer })));
  const ma = flat(a);
  const mb = flat(b);
  if (ma.length !== mb.length) return false;
  // Mřížka podle středu segmentu (buňka 1 mm, hledá se i v sousedních).
  const cell = (p: Point) => [Math.floor(p.x), Math.floor(p.y)] as const;
  const grid = new Map<string, (typeof mb)[number][]>();
  for (const g of mb) {
    const [cx, cy] = cell(segmentMidpoint(g.a, g.b, g.bulge));
    const key = `${cx},${cy}`;
    const list = grid.get(key);
    if (list) list.push(g);
    else grid.set(key, [g]);
  }
  const near = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y) <= SAME_TOL;
  const same = (g: (typeof ma)[number], o: (typeof mb)[number]) =>
    g.layer === o.layer &&
    ((near(g.a, o.a) && near(g.b, o.b) && Math.abs(g.bulge - o.bulge) <= 1e-6) ||
      (near(g.a, o.b) && near(g.b, o.a) && Math.abs(g.bulge + o.bulge) <= 1e-6));
  for (const g of ma) {
    const [cx, cy] = cell(segmentMidpoint(g.a, g.b, g.bulge));
    let found = false;
    for (let dx = -1; dx <= 1 && !found; dx++) {
      for (let dy = -1; dy <= 1 && !found; dy++) {
        const list = grid.get(`${cx + dx},${cy + dy}`);
        const k = list?.findIndex((o) => same(g, o)) ?? -1;
        if (k >= 0) {
          list!.splice(k, 1);
          found = true;
        }
      }
    }
    if (!found) return false;
  }
  return sameNoteTexts(a, b, label);
}

/**
 * Stejné poznámky = stejné texty na stejných hladinách; poloha se nepočítá
 * (ručně psané texty se mezi kopiemi vždy trochu liší, sloučený díl dostane
 * poznámky první kopie). Text, podle kterého se díl jmenuje, se vynechá.
 */
function sameNoteTexts(a: PartShape, b: PartShape, label: string | null): boolean {
  const keys = (s: PartShape) => {
    const list = (s.notes ?? []).map((n) => `${n.layer}\u0000${n.text}`);
    const named = (s.notes ?? []).findIndex((n) => n.text === label);
    if (named >= 0) list.splice(named, 1);
    return list.sort();
  };
  const ka = keys(a);
  const kb = keys(b);
  return ka.length === kb.length && ka.every((k, i) => k === kb[i]);
}

/** Klíč polohy oblasti ve výkresu (obalový obdélník na 0,01 mm). */
const originKey = (bb: Rect) =>
  [bb.x, bb.y, bb.width, bb.height].map((v) => (Math.round(v * 100) / 100).toFixed(2)).join(',');

/** Tvar posunutý tak, aby levý dolní roh obalového obdélníku byl v (0, 0). */
function normalizeRegion(region: MarkedRegion, label: string | null) {
  const bb = contourBBox(region.outer);
  const move = (c: Contour) => translateContour(c, -bb.x, -bb.y);
  const movePoint = (p: Point) => ({ x: p.x - bb.x, y: p.y - bb.y });
  const shape: PartShape = {
    outer: move(region.outer),
    holes: region.holes.map(move),
    layers: { outer: region.outerLayer, holes: region.holeLayers },
    ...(region.marks.length > 0 && {
      marks: region.marks.map((m) => ({
        layer: m.layer,
        segments: m.segments.map((s) => ({ a: movePoint(s.a), b: movePoint(s.b), bulge: s.bulge })),
      })),
    }),
    ...(region.notes.length > 0 && {
      notes: region.notes.map((n) => ({ ...n, at: movePoint(n.at) })),
    }),
  };
  return {
    shape,
    origin: originKey(bb),
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
  if (!read.ok) {
    return {
      parts: [],
      origins: [],
      layers: [],
      units: read.units,
      warnings: read.warnings,
      errors: read.errors,
    };
  }
  const layers = drawingLayers(read.segments, read.texts);
  const filter = opts.layer;
  const roles = opts.layerRoles;
  const usedLayer = (layer: string) =>
    (!filter || filter(layer)) && layerRole(roles, layer) !== 'ignore';
  const segments: DxfSegment[] = [];
  const attached: DxfSegment[] = [];
  for (const s of read.segments) {
    if (!usedLayer(s.layer)) continue;
    if (layerRole(roles, s.layer) === 'attach') attached.push(s);
    else segments.push(s);
  }
  const built = buildContours(segments, {
    ...opts,
    holeLayer: (layer) => layerRole(roles, layer) === 'inner',
  });
  const warnings = [...read.warnings, ...built.warnings];
  const errors = [...read.errors, ...built.errors];

  if (built.regions.length === 0) {
    if (built.outlines === 0 && built.ignoredHoles > 0) {
      errors.push(
        'Ve výkresu není žádný vnější obrys – všechny uzavřené kontury jsou na hladinách s rolí vnitřní obrys.',
      );
    } else if (segments.length > 0) errors.push('Ve výkresu není žádná uzavřená kontura.');
    else if (read.segments.length > 0) {
      errors.push('Ve vybraných hladinách není žádný obrys (vnější obrys).');
    }
    return { parts: [], origins: [], layers, units: read.units, warnings, errors };
  }
  let regions: readonly ShapeRegion[] = built.regions;
  if (mode === 'single') {
    const largest = regions.reduce((a, b) => (contourArea(b.outer) > contourArea(a.outer) ? b : a));
    // V otvoru hlavního dílu leží jen hlouběji vnořená oblast uvnitř jeho
    // obrysu (kontury se nekříží – rozhodne jeden vrchol); hlouběji vnořená
    // oblast jinde ve výkresu je mimo.
    const ring = contourToRing(largest.outer, opts.joinTol ?? JOIN_TOL);
    const inner = regions.filter(
      (r) => r !== largest && r.depth > largest.depth && pointInRing(r.outer[0]!, ring),
    ).length;
    const outside = regions.length - 1 - inner;
    const ignored = (n: number) =>
      `${n} ${plural(n, 'další kontura – ignorována', 'další kontury – ignorovány', 'dalších kontur – ignorovány')} (pro více dílů v souboru zvolte režim „více dílů").`;
    if (inner > 0) {
      warnings.push(`Uvnitř otvorů dílu ${plural(inner, 'je', 'jsou', 'je')} ${ignored(inner)}`);
    }
    if (outside > 0) {
      warnings.push(`Mimo hlavní obrys ${plural(outside, 'je', 'jsou', 'je')} ${ignored(outside)}`);
    }
    regions = [largest];
  }
  // Přidaná geometrie až po výběru dílů: co v režimu „1 soubor = 1 díl" leží
  // jen v ignorované kontuře, se nahlásí jako mimo obrysy.
  const joinTol = opts.joinTol ?? JOIN_TOL;
  const marked = attachMarks(regions, attached, joinTol);
  for (const [layer, n] of marked.outside) {
    warnings.push(
      `Na hladině „${layer}" (přidej k dílu) ${plural(n, 'leží 1 segment mimo obrysy dílů – ignorován', `leží ${n} segmenty mimo obrysy dílů – ignorovány`, `leží ${n} segmentů mimo obrysy dílů – ignorovány`)}.`,
    );
  }
  // Textové poznámky: z hladin „přidej k dílu", případně i z hladin obrysů.
  // Hladina POPISKY z vlastního exportu nese názvy dílů – jako poznámku ji
  // přenést jen výslovně (role „přidej k dílu"), jinak by se název zdvojil.
  const noteTexts = read.texts.filter((t) => {
    if (!usedLayer(t.layer)) return false;
    const role = layerRole(roles, t.layer);
    if (role === 'attach') return true;
    return opts.notesFromAllLayers === true && role !== 'ignore' && t.layer !== 'POPISKY';
  });
  const noted = attachNotes(marked.regions, noteTexts, joinTol);
  for (const [layer, n] of noted.outside) {
    warnings.push(
      `Na hladině „${layer}" ${plural(n, 'leží 1 text mimo obrysy dílů – nepřenesen', `leží ${n} texty mimo obrysy dílů – nepřeneseny`, `leží ${n} textů mimo obrysy dílů – nepřeneseny`)}.`,
    );
  }
  if (noteTexts.some((t) => t.formatted)) {
    warnings.push(
      'Formátování víceřádkových textů (písmo, barvy, zlomky) se nepřenáší – texty jsou prosté řádky.',
    );
  }

  const base = baseName(fileName);
  const prefix = opts.idPrefix ?? 'dxf';
  // Texty pro názvy dílů: filtr `layer` se na ně nevztahuje (popisky bývají
  // na vlastní vrstvě), hladina s rolí „ignoruj" ano.
  const texts = read.texts.filter((t) => layerRole(roles, t.layer) !== 'ignore');
  const labels = mode === 'multi' ? regionLabels(regions, texts) : regions.map(() => null);
  const normalized = noted.regions
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
    readonly origins: string[];
    count: number;
    name: string;
  }
  const groups: Group[] = [];
  const byLabel = new Map<string, Group[]>();
  normalized.forEach((n, i) => {
    const part = {
      shape: n.shape,
      width: n.width,
      height: n.height,
      origins: [n.origin],
      count: 1,
      name: '',
    };
    if (n.label === null) {
      groups.push({ ...part, label: null, index: i + 1, prepared: null });
      return;
    }
    const prepared = prepareShape(n.shape);
    const same = byLabel.get(n.label) ?? [];
    const match = same.find(
      (g) =>
        samePreparedShape(g.prepared!, prepared) && sameLayersAndMarks(g.shape, n.shape, n.label),
    );
    if (match) {
      match.count++;
      match.origins.push(n.origin);
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
        `Díly s textem „${label}" mají různý tvar nebo natočení (případně přidanou geometrii či poznámky) – ponechány zvlášť: ${same.map((g) => g.name).join(', ')}.`,
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
  return {
    parts,
    origins: groups.map((g) => g.origins.join('|')),
    layers,
    units: read.units,
    warnings,
    errors,
  };
}
