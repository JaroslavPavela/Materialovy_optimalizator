import DxfParser from 'dxf-parser';
import {
  affineDeterminant,
  applyAffine,
  compose,
  IDENTITY,
  isSimilarity,
  maxScale,
  rotation,
  scaling,
  translation,
  type Affine,
} from '../geometry/affine.ts';
import { approximateSegment } from '../geometry/contour.ts';
import { EPS } from '../geometry/eps.ts';
import type { Point } from '../geometry/types.ts';

/**
 * Úsečka (`bulge` = 0) nebo kruhový oblouk z `a` do `b` v mm, ve světových
 * souřadnicích výkresu. `bulge` = tan(θ/4), kladný = CCW (jako LWPOLYLINE).
 */
export interface DxfSegment {
  readonly a: Point;
  readonly b: Point;
  readonly bulge: number;
  readonly layer: string;
}

export interface DxfUnits {
  /** Hodnota $INSUNITS (0 = neuvedeno). */
  readonly code: number;
  readonly name: string;
  /** Násobek pro převod na mm. */
  readonly toMm: number;
}

export interface DxfReadResult {
  /** `false` = soubor nejde přečíst (viz `errors`), segmenty jsou prázdné. */
  readonly ok: boolean;
  readonly segments: readonly DxfSegment[];
  readonly units: DxfUnits;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}

export interface DxfReadOptions {
  /** Chordální tolerance aproximace elips a splajnů v mm (výchozí 0,01). */
  readonly curveTolerance?: number;
}

export const DEFAULT_CURVE_TOLERANCE = 0.01;

/** Nejhlubší vnoření bloků (ochrana proti cyklům). */
const MAX_BLOCK_DEPTH = 8;

/** $INSUNITS → název a převod na mm. */
const UNITS: Readonly<Record<number, readonly [string, number]>> = {
  1: ['palce', 25.4],
  2: ['stopy', 304.8],
  4: ['mm', 1],
  5: ['cm', 10],
  6: ['m', 1000],
  8: ['mikropalce', 25.4e-6],
  9: ['mily', 0.0254],
  10: ['yardy', 914.4],
  13: ['mikrometry', 1e-3],
  14: ['dm', 100],
};

/** Entity bez geometrie dílu – tiše se přeskočí a jen se spočítají. */
const IGNORED = new Set([
  'TEXT',
  'MTEXT',
  'DIMENSION',
  'HATCH',
  'POINT',
  'LEADER',
  'MLEADER',
  'MULTILEADER',
  'ATTDEF',
  'ATTRIB',
  'SOLID',
  '3DFACE',
  'IMAGE',
  'WIPEOUT',
  'VIEWPORT',
  'TOLERANCE',
  'ACAD_TABLE',
  'XLINE',
  'RAY',
  'OLE2FRAME',
  'SHAPE',
  'TRACE',
]);

/** Typy, které dxf-parser umí bez vlastní obsluhy (VERTEX a SEQEND patří k POLYLINE). */
const PARSER_TYPES = [
  '3DFACE',
  'ARC',
  'ATTDEF',
  'CIRCLE',
  'DIMENSION',
  'ELLIPSE',
  'INSERT',
  'LINE',
  'LWPOLYLINE',
  'MTEXT',
  'POINT',
  'POLYLINE',
  'SOLID',
  'SPLINE',
  'TEXT',
];
const STRUCTURE = new Set(['BLOCK', 'ENDBLK', 'ENDSEC', 'VERTEX', 'SEQEND', 'EOF']);

/** Nejvíc segmentů z jednoho výkresu – ochrana před zahlcením paměti. */
export const MAX_SEGMENTS = 2_000_000;
/** Nejvíc instancí jednoho pole vložení (INSERT se sloupci × řádky). */
const MAX_ARRAY = 100_000;
/** Rozsah chordální tolerance (mm) – menší by dal miliony bodů. */
const MIN_CURVE_TOL = 1e-4;
const MAX_CURVE_TOL = 10;
/** Normála se bere jako ±Z, liší-li se x, y nejvýš o tento relativní podíl. */
const NORMAL_EPS = 1e-6;

// ---------------------------------------------------------------------------
// Vlastní obsluha entit pro dxf-parser: CIRCLE a ELLIPSE bez ní ztratí směr
// extruze (zrcadlené kružnice z rozvinů), SPLINE váhy (kód 41), POLYLINE bez
// SEQEND parser zacyklí a entity bez obsluhy by parser hlásil do konzole.

interface Group {
  readonly code: number;
  readonly value: unknown;
}

interface Scanner {
  next(): Group;
  isEOF(): boolean;
  /** Poslední přečtená skupina (po `readGroups` ta s kódem 0). */
  readonly lastReadGroup: Group;
}

/** Načte skupiny entity až po další skupinu s kódem 0 (ta zůstane přečtená). */
function readGroups(scanner: Scanner): Group[] {
  const groups: Group[] = [];
  let g = scanner.next();
  while (!scanner.isEOF() && g.code !== 0) {
    groups.push(g);
    g = scanner.next();
  }
  return groups;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Body ze skupin `base` (x), `base+10` (y) v pořadí výskytu. */
function pointsOf(groups: readonly Group[], base: number): Point[] {
  const out: { x: number; y: number }[] = [];
  for (const g of groups) {
    if (g.code === base) out.push({ x: num(g.value), y: 0 });
    else if (g.code === base + 10 && out.length > 0) out[out.length - 1]!.y = num(g.value);
  }
  return out;
}

const valuesOf = (groups: readonly Group[], code: number) =>
  groups.filter((g) => g.code === code).map((g) => num(g.value));

function commonProps(groups: readonly Group[]) {
  const layer = groups.find((g) => g.code === 8)?.value;
  return {
    layer: typeof layer === 'string' ? layer : '0',
    inPaperSpace: groups.some((g) => g.code === 67 && g.value !== 0),
    visible: !groups.some((g) => g.code === 60 && g.value === 1),
    extrusionZ: groups.find((g) => g.code === 230)?.value,
    extrusionX: groups.find((g) => g.code === 210)?.value,
    extrusionY: groups.find((g) => g.code === 220)?.value,
  };
}

function groupHandler(name: string, build: (groups: Group[]) => object) {
  return class {
    readonly ForEntityName = name;
    parseEntity(scanner: Scanner, curr: Group) {
      const groups = readGroups(scanner);
      return { type: curr.value, ...commonProps(groups), ...build(groups) };
    }
  };
}

const CircleHandler = groupHandler('CIRCLE', (g) => ({
  center: pointsOf(g, 10)[0],
  radius: valuesOf(g, 40)[0],
}));

const EllipseHandler = groupHandler('ELLIPSE', (g) => ({
  center: pointsOf(g, 10)[0],
  majorAxisEndPoint: pointsOf(g, 11)[0],
  axisRatio: valuesOf(g, 40)[0],
  startParam: valuesOf(g, 41)[0],
  endParam: valuesOf(g, 42)[0],
}));

const SplineHandler = groupHandler('SPLINE', (g) => ({
  controlPoints: pointsOf(g, 10),
  fitPoints: pointsOf(g, 11),
  knots: valuesOf(g, 40),
  weights: valuesOf(g, 41),
  degree: valuesOf(g, 71)[0],
  flags: valuesOf(g, 70)[0] ?? 0,
}));

/**
 * POLYLINE s vrcholy až po SEQEND. Obsluha dxf-parseru se zacyklí, chybí-li
 * SEQEND (za posledním VERTEX rovnou další entita) – tady polyline ukončí
 * jakákoli jiná entita.
 */
class PolylineHandler {
  readonly ForEntityName = 'POLYLINE';
  parseEntity(scanner: Scanner, curr: Group) {
    const groups = readGroups(scanner);
    const flags = valuesOf(groups, 70)[0] ?? 0;
    const vertices: object[] = [];
    while (!scanner.isEOF() && scanner.lastReadGroup.value === 'VERTEX') {
      const v = readGroups(scanner);
      const p = pointsOf(v, 10)[0];
      if (!p) continue;
      vertices.push({
        ...p,
        bulge: valuesOf(v, 42)[0] ?? 0,
        splineControlPoint: ((valuesOf(v, 70)[0] ?? 0) & 16) !== 0,
      });
    }
    if (!scanner.isEOF() && scanner.lastReadGroup.value === 'SEQEND') readGroups(scanner);
    return {
      type: curr.value,
      ...commonProps(groups),
      shape: (flags & 1) !== 0,
      is3dPolyline: (flags & 8) !== 0,
      is3dPolygonMesh: (flags & 16) !== 0,
      isPolyfaceMesh: (flags & 64) !== 0,
      vertices,
    };
  }
}

const ignoredHandlers = [...IGNORED]
  .filter((t) => !['TEXT', 'MTEXT', 'DIMENSION', 'POINT', 'ATTDEF', 'SOLID', '3DFACE'].includes(t))
  .map((t) => groupHandler(t, () => ({})));

function createParser(): DxfParser {
  const parser = new DxfParser();
  type HandlerClass = Parameters<DxfParser['registerEntityHandler']>[0];
  for (const h of [
    CircleHandler,
    EllipseHandler,
    SplineHandler,
    PolylineHandler,
    ...ignoredHandlers,
  ]) {
    parser.registerEntityHandler(h as unknown as HandlerClass);
  }
  return parser;
}

// ---------------------------------------------------------------------------
// Převod entit na segmenty.

/** Volné typy entit z parseru – pole čteme opatrně, výkresy bývají neúplné. */
type Entity = Record<string, unknown> & { readonly type: string };
interface Block {
  readonly entities?: Entity[];
  readonly position?: Point;
  /** Příznaky bloku (4 = externí reference). */
  readonly type?: number;
}

const isPoint = (p: unknown): p is Point =>
  typeof p === 'object' &&
  p !== null &&
  Number.isFinite((p as Point).x) &&
  Number.isFinite((p as Point).y);

const finite = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/** Bod ve tvaru {x, y, z} z parseru (210/220/230 u některých entit). */
function extrusionOf(e: Entity): { x: number; y: number; z: number } {
  const p = e.extrusionDirection as { x?: number; y?: number; z?: number } | undefined;
  if (p) return { x: finite(p.x, 0), y: finite(p.y, 0), z: finite(p.z, 1) };
  return {
    x: finite(e.extrusionDirectionX ?? e.extrusionX, 0),
    y: finite(e.extrusionDirectionY ?? e.extrusionY, 0),
    z: finite(e.extrusionDirectionZ ?? e.extrusionZ, 1),
  };
}

/**
 * OCS → WCS pro rovinné entity. Podporujeme normálu ±Z (algoritmus
 * libovolné osy dá pro (0, 0, −1) zrcadlení osy X); jiná normála = `null`
 * (průmět entity z natočené roviny do XY by nebyl skutečný tvar dílu).
 */
function ocsMatrix(e: Entity): Affine | null {
  const n = extrusionOf(e);
  const len = Math.hypot(n.x, n.y, n.z);
  if (len === 0) return IDENTITY;
  if (Math.abs(n.x / len) > NORMAL_EPS || Math.abs(n.y / len) > NORMAL_EPS) return null;
  return n.z < 0 ? scaling(-1, 1) : IDENTITY;
}

/** Bulge oblouku se středovým úhlem `sweep` (rad, kladný = CCW). */
const bulgeOf = (sweep: number) => Math.tan(sweep / 4);

class Collector {
  readonly segments: DxfSegment[] = [];
  readonly warnings: string[] = [];
  readonly ignored = new Map<string, number>();
  readonly unsupported = new Map<string, number>();
  hidden = 0;
  /** Překročen MAX_SEGMENTS – další segmenty se zahazují. */
  overflow = false;
  private readonly warned = new Set<string>();

  private readonly tol: number;

  constructor(tol: number) {
    this.tol = tol;
  }

  warnOnce(message: string) {
    if (this.warned.has(message)) return;
    this.warned.add(message);
    this.warnings.push(message);
  }

  count(map: Map<string, number>, type: string) {
    map.set(type, (map.get(type) ?? 0) + 1);
  }

  /** Tolerance v místních souřadnicích entity, aby po transformaci platila `tol`. */
  localTol(m: Affine) {
    const s = maxScale(m);
    return s > 0 ? this.tol / s : this.tol;
  }

  /** Segment v místních souřadnicích → transformovaný do mm. */
  segment(a: Point, b: Point, bulge: number, m: Affine, layer: string) {
    if (bulge !== 0 && !isSimilarity(m)) {
      // Nestejnoměrné měřítko bloku: z oblouku je elipsa – aproximace úsečkami.
      let prev = a;
      for (const p of approximateSegment(a, b, bulge, this.localTol(m))) {
        this.segment(prev, p, 0, m, layer);
        prev = p;
      }
      return;
    }
    if (this.overflow) return;
    const A = applyAffine(m, a);
    const B = applyAffine(m, b);
    if (Math.hypot(B.x - A.x, B.y - A.y) <= 1e-9) return;
    if (this.segments.length >= MAX_SEGMENTS) {
      this.overflow = true;
      return;
    }
    this.segments.push({ a: A, b: B, bulge: affineDeterminant(m) < 0 ? -bulge : bulge, layer });
  }

  /** Lomená čára (body už aproximované) jako úsečky. */
  polyline(points: readonly Point[], closed: boolean, m: Affine, layer: string) {
    for (let i = 0; i + 1 < points.length; i++)
      this.segment(points[i]!, points[i + 1]!, 0, m, layer);
    if (closed && points.length > 2) this.segment(points.at(-1)!, points[0]!, 0, m, layer);
  }
}

/** Vzdálenost bodu od úsečky. */
function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Body křivky f(t) na [t0, t1]: `initial` stejných dílů, každý se dělí, dokud
 * se body ve ¼, ½ a ¾ parametru odchylují od tětivy o víc než `tol`/2. Samotný
 * střed nestačí – u esovité kubiky se inflexí vynuluje. Vrací i oba konce.
 */
export function approximateCurve(
  f: (t: number) => Point,
  t0: number,
  t1: number,
  tol: number,
  initial = 8,
): Point[] {
  const pts: Point[] = [f(t0)];
  const refine = (ta: number, pa: Point, tb: number, pb: Point, depth: number) => {
    const tm = (ta + tb) / 2;
    const pm = f(tm);
    const dev = Math.max(
      distToSegment(pm, pa, pb),
      distToSegment(f((ta + tm) / 2), pa, pb),
      distToSegment(f((tm + tb) / 2), pa, pb),
    );
    // Polovina tolerance: kontrolní body nepokryjí celý úsek, rezerva drží skutečnou odchylku pod tol.
    if (depth < 20 && dev > tol / 2) {
      refine(ta, pa, tm, pm, depth + 1);
      refine(tm, pm, tb, pb, depth + 1);
    } else {
      pts.push(pb);
    }
  };
  let ta = t0;
  let pa = pts[0]!;
  for (let i = 1; i <= initial; i++) {
    const tb = i === initial ? t1 : t0 + ((t1 - t0) * i) / initial;
    const pb = f(tb);
    refine(ta, pa, tb, pb, 0);
    ta = tb;
    pa = pb;
  }
  return pts;
}

/**
 * Bod NURBS křivky stupně `p` (de Boorův algoritmus v homogenních
 * souřadnicích). `knots` má délku n + p + 1, n = počet řídicích bodů.
 */
export function nurbsPoint(
  p: number,
  knots: readonly number[],
  ctrl: readonly Point[],
  weights: readonly number[] | null,
  t: number,
): Point {
  const n = ctrl.length;
  let k = p;
  while (k < n - 1 && knots[k + 1]! <= t) k++;
  const d = Array.from({ length: p + 1 }, (_, j) => {
    const c = ctrl[j + k - p]!;
    const w = weights ? weights[j + k - p]! : 1;
    return { x: c.x * w, y: c.y * w, w };
  });
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const lo = knots[j + k - p]!;
      const hi = knots[j + 1 + k - r]!;
      const alpha = hi - lo > 0 ? (t - lo) / (hi - lo) : 0;
      const a = d[j - 1]!;
      const b = d[j]!;
      d[j] = {
        x: (1 - alpha) * a.x + alpha * b.x,
        y: (1 - alpha) * a.y + alpha * b.y,
        w: (1 - alpha) * a.w + alpha * b.w,
      };
    }
  }
  const r = d[p]!;
  return { x: r.x / r.w, y: r.y / r.w };
}

interface Context {
  readonly blocks: Readonly<Record<string, Block>>;
  readonly out: Collector;
  /** Vrstvy vypnuté nebo zamrzlé – jejich entity se nečtou. */
  readonly hiddenLayers: ReadonlySet<string>;
}

function addArc(e: Entity, m: Affine, out: Collector, full: boolean) {
  const layer = String(e.layer ?? '0');
  const radius = finite(e.radius, 0);
  if (!isPoint(e.center) || !(radius > 0)) {
    out.warnOnce(`${e.type} s nulovým nebo neplatným poloměrem byl přeskočen.`);
    return;
  }
  const c = e.center;
  if (full) {
    // Kružnice = dva půloblouky CCW.
    const p0 = { x: c.x + radius, y: c.y };
    const p1 = { x: c.x - radius, y: c.y };
    out.segment(p0, p1, 1, m, layer);
    out.segment(p1, p0, 1, m, layer);
    return;
  }
  // dxf-parser vrací úhly ARC v radiánech. Modulo (ne smyčka) i pro obří hodnoty.
  const TAU = 2 * Math.PI;
  const start = finite(e.startAngle, 0) % TAU;
  const sweep = (((finite(e.endAngle, 0) - finite(e.startAngle, 0)) % TAU) + TAU) % TAU;
  // Stejný počátek a konec = plný kruh; mezera do EPS také (jinak by oblouk zmizel).
  if (sweep * radius <= 1e-9 || (TAU - sweep) * radius <= EPS) {
    addArc(e, m, out, true);
    return;
  }
  const at = (ang: number) => ({
    x: c.x + radius * Math.cos(ang),
    y: c.y + radius * Math.sin(ang),
  });
  out.segment(at(start), at(start + sweep), bulgeOf(sweep), m, layer);
}

function addPolyline(e: Entity, m: Affine, out: Collector) {
  const layer = String(e.layer ?? '0');
  if (e.isPolyfaceMesh || e.is3dPolygonMesh) {
    out.count(out.unsupported, 'POLYLINE (síť)');
    return;
  }
  type V = { x?: number; y?: number; bulge?: number; splineControlPoint?: boolean };
  const raw = (Array.isArray(e.vertices) ? (e.vertices as V[]) : []).filter(
    (v) => !v.splineControlPoint && Number.isFinite(v.x) && Number.isFinite(v.y),
  );
  const verts = raw.map((v) => ({ x: v.x!, y: v.y!, bulge: finite(v.bulge, 0) }));
  if (verts.length < 2) return;
  const closed = e.shape === true;
  const n = verts.length;
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const v = verts[i]!;
    const w = verts[(i + 1) % n]!;
    out.segment(v, w, v.bulge, m, layer);
  }
}

function addEllipse(e: Entity, m: Affine, out: Collector) {
  const layer = String(e.layer ?? '0');
  const ratio = finite(e.axisRatio, 0);
  if (!isPoint(e.center) || !isPoint(e.majorAxisEndPoint) || !(ratio > 0)) {
    out.warnOnce('ELLIPSE s neplatnými parametry byla přeskočena.');
    return;
  }
  const c = e.center;
  const M = e.majorAxisEndPoint;
  // Vedlejší osa = poměr · (N × M); pro N = (0, 0, ±1) je to ±(−My, Mx).
  const nz = extrusionOf(e).z < 0 ? -1 : 1;
  const minor = { x: -nz * ratio * M.y, y: nz * ratio * M.x };
  const TAU = 2 * Math.PI;
  const major = Math.hypot(M.x, M.y);
  let t0 = finite(e.startParam, 0) % TAU;
  const span = (((finite(e.endParam, TAU) - finite(e.startParam, 0)) % TAU) + TAU) % TAU;
  let t1 = t0 + span;
  const full = span * major <= 1e-9 || (TAU - span) * major <= EPS;
  if (full) {
    t0 = 0;
    t1 = 2 * Math.PI;
  }
  const f = (t: number) => ({
    x: c.x + M.x * Math.cos(t) + minor.x * Math.sin(t),
    y: c.y + M.y * Math.cos(t) + minor.y * Math.sin(t),
  });
  const pts = approximateCurve(f, t0, t1, out.localTol(m), 16);
  if (full) pts.pop();
  out.polyline(pts, full, m, layer);
}

function addSpline(e: Entity, m: Affine, out: Collector) {
  const layer = String(e.layer ?? '0');
  const ctrl = (e.controlPoints as Point[] | undefined) ?? [];
  const knots = (e.knots as number[] | undefined) ?? [];
  const fit = (e.fitPoints as Point[] | undefined) ?? [];
  const p = Math.round(finite(e.degree, 3));
  const closed = (finite(e.flags, 0) & 1) !== 0;
  const n = ctrl.length;
  if (n >= 2 && p >= 1 && knots.length === n + p + 1) {
    const w = e.weights as number[] | undefined;
    const weights = w && w.length === n && w.every((x) => x > 0) ? w : null;
    if (!weights && (finite(e.flags, 0) & 4) !== 0) {
      out.warnOnce('Racionální SPLINE nemá platné váhy – vyhodnocen jako neracionální.');
    }
    const pts: Point[] = [];
    // Každý nenulový úsek uzlového vektoru zvlášť (spojitost se v uzlech může lámat).
    for (let k = p; k < n; k++) {
      const a = knots[k]!;
      const b = knots[k + 1]!;
      if (!(b > a)) continue;
      const span = approximateCurve(
        (t) => nurbsPoint(p, knots, ctrl, weights, t),
        a,
        b,
        out.localTol(m),
        4,
      );
      pts.push(...(pts.length > 0 ? span.slice(1) : span));
    }
    if (pts.length >= 2) {
      out.polyline(pts, false, m, layer);
      return;
    }
  }
  if (fit.length >= 2) {
    out.warnOnce('SPLINE bez platných řídicích bodů – použity body proložení (fit points).');
    out.polyline(fit, closed, m, layer);
    return;
  }
  out.warnOnce('SPLINE s neplatnými daty byl přeskočen.');
}

/**
 * Projde entity s transformací `m`. `inherited` = vrstva nadřazeného INSERT:
 * entity bloku na vrstvě „0" ji přebírají (jako v AutoCADu).
 */
function walk(
  entities: readonly Entity[],
  m: Affine,
  ctx: Context,
  stack: readonly string[],
  inherited: string | null,
) {
  const { out } = ctx;
  for (const raw of entities) {
    if (out.overflow) return;
    if (raw.inPaperSpace === true) continue;
    const type = String(raw.type);
    if (IGNORED.has(type)) {
      out.count(out.ignored, type);
      continue;
    }
    const own = String(raw.layer ?? '0');
    const layer = own === '0' && inherited !== null ? inherited : own;
    if (raw.visible === false || ctx.hiddenLayers.has(layer)) {
      out.hidden++;
      continue;
    }
    const e: Entity = layer === raw.layer ? raw : { ...raw, layer };
    // Souřadnice rovinných entit jsou v OCS; ELLIPSE a SPLINE jsou ve WCS,
    // ale i u nich musí normála mířit v ose Z, jinak průmět není tvar dílu.
    const ocs = type === 'LINE' || e.is3dPolyline === true ? IDENTITY : ocsMatrix(e);
    if (!ocs) {
      out.warnOnce(`${type} leží v rovině mimo XY (natočená normála) – přeskočeno.`);
      continue;
    }
    const planar = ['ARC', 'CIRCLE', 'LWPOLYLINE', 'POLYLINE', 'INSERT'].includes(type);
    const mo = planar ? compose(m, ocs) : m;
    switch (type) {
      case 'LINE': {
        const v = e.vertices as Point[] | undefined;
        if (v && isPoint(v[0]) && isPoint(v[1])) out.segment(v[0], v[1], 0, m, layer);
        break;
      }
      case 'ARC':
        addArc(e, mo, out, false);
        break;
      case 'CIRCLE':
        addArc(e, mo, out, true);
        break;
      case 'LWPOLYLINE':
      case 'POLYLINE':
        addPolyline(e, mo, out);
        break;
      case 'ELLIPSE':
        addEllipse(e, m, out);
        break;
      case 'SPLINE':
        addSpline(e, m, out);
        break;
      case 'INSERT':
        addInsert(e, mo, ctx, stack, layer);
        break;
      default:
        out.count(out.unsupported, type);
    }
  }
}

function addInsert(e: Entity, m: Affine, ctx: Context, stack: readonly string[], layer: string) {
  const name = String(e.name ?? '');
  const block = ctx.blocks[name];
  if (!block) {
    ctx.out.warnOnce(`Blok „${name}" ve výkresu chybí – vložení přeskočeno.`);
    return;
  }
  if ((finite(block.type, 0) & 4) !== 0) {
    ctx.out.warnOnce(`Blok „${name}" je externí reference (XREF) – její obsah se nenačte.`);
    return;
  }
  if (stack.includes(name) || stack.length >= MAX_BLOCK_DEPTH) {
    ctx.out.warnOnce(`Blok „${name}" je vnořen příliš hluboko nebo sám do sebe – přeskočen.`);
    return;
  }
  const pos = isPoint(e.position) ? e.position : { x: 0, y: 0 };
  const base = isPoint(block.position) ? block.position : { x: 0, y: 0 };
  const sx = finite(e.xScale, 1);
  const sy = finite(e.yScale, 1);
  const rot = finite(e.rotation, 0);
  const cols = Math.max(1, Math.round(finite(e.columnCount, 1)));
  const rows = Math.max(1, Math.round(finite(e.rowCount, 1)));
  const dc = finite(e.columnSpacing, 0);
  const dr = finite(e.rowSpacing, 0);
  if (cols * rows > MAX_ARRAY) {
    ctx.out.warnOnce(
      `Pole vložení bloku „${name}" má ${cols} × ${rows} kopií (víc než ${MAX_ARRAY}) – přeskočeno.`,
    );
    return;
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Pole: posun ve směru otočeného bloku, před měřítkem.
      const t = compose(
        m,
        translation(pos.x, pos.y),
        rotation(rot),
        translation(c * dc, r * dr),
        scaling(sx, sy),
        translation(-base.x, -base.y),
      );
      walk(block.entities ?? [], t, ctx, [...stack, name], layer);
    }
  }
}

/** Text DXF z bajtů: UTF-8 (AutoCAD 2007+), jinak Windows-1250. */
function decode(data: string | ArrayBuffer | Uint8Array): string {
  if (typeof data === 'string') return data;
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1250').decode(bytes);
  }
}

/** Typy entit, které parser přeskočí bez obsluhy (dxf-parser je nehlásí). */
function unhandledTypes(text: string): Map<string, number> {
  const known = new Set([...PARSER_TYPES, ...IGNORED, 'CIRCLE', 'ELLIPSE', 'SPLINE']);
  const lines = text.split(/\r\n|\r|\n/);
  const counts = new Map<string, number>();
  let section = '';
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = lines[i]!.trim();
    const value = lines[i + 1]!.trim();
    if (code === '0' && value === 'SECTION') {
      section = lines[i + 3]?.trim() ?? '';
      i += 2;
      continue;
    }
    if (code !== '0' || (section !== 'ENTITIES' && section !== 'BLOCKS')) continue;
    if (STRUCTURE.has(value) || known.has(value)) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

const formatList = (map: ReadonlyMap<string, number>) =>
  [...map].map(([t, n]) => `${t} (${n})`).join(', ');

/**
 * Přečte DXF a převede geometrii na segmenty v mm (WCS). Rozvine bloky
 * (INSERT včetně polí), převede OCS, elipsy a splajny aproximuje úsečkami.
 * Texty, kóty, šrafy apod. přeskočí (hlásí ve varování).
 */
export function readDxf(
  data: string | ArrayBuffer | Uint8Array,
  opts: DxfReadOptions = {},
): DxfReadResult {
  const mm: DxfUnits = { code: 4, name: 'mm', toMm: 1 };
  const text = decode(data);
  if (text.startsWith('AutoCAD Binary DXF')) {
    return fail(mm, 'Binární DXF není podporované – uložte výkres jako ASCII DXF.');
  }
  let dxf: ReturnType<DxfParser['parseSync']>;
  try {
    dxf = createParser().parseSync(text);
  } catch (e) {
    return fail(mm, `Soubor DXF nelze přečíst: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!dxf) return fail(mm, 'Soubor DXF nelze přečíst.');

  const warnings: string[] = [];
  const code = Number(dxf.header?.$INSUNITS ?? 0);
  let units: DxfUnits;
  const known = UNITS[code];
  if (known) {
    units = { code, name: known[0], toMm: known[1] };
  } else if (code === 0 || !Number.isFinite(code)) {
    units = { code: 0, name: 'mm', toMm: 1 };
    warnings.push('Výkres nemá uvedené jednotky ($INSUNITS) – předpokládám milimetry.');
  } else {
    units = { code, name: 'mm', toMm: 1 };
    warnings.push(`Nepodporované jednotky výkresu ($INSUNITS = ${code}) – předpokládám milimetry.`);
  }

  const tol = opts.curveTolerance;
  const out = new Collector(
    typeof tol === 'number' && Number.isFinite(tol)
      ? Math.min(MAX_CURVE_TOL, Math.max(MIN_CURVE_TOL, tol))
      : DEFAULT_CURVE_TOLERANCE,
  );
  const blocks = (dxf.blocks ?? {}) as unknown as Record<string, Block>;
  const layers = (dxf.tables?.layer?.layers ?? {}) as Record<
    string,
    { frozen?: boolean; visible?: boolean }
  >;
  const hiddenLayers = new Set(
    Object.entries(layers)
      .filter(([, l]) => l.frozen === true || l.visible === false)
      .map(([name]) => name),
  );
  walk(
    (dxf.entities ?? []) as unknown as Entity[],
    scaling(units.toMm),
    { blocks, out, hiddenLayers },
    [],
    null,
  );

  if (out.overflow) {
    return fail(
      units,
      `Výkres je příliš rozsáhlý (víc než ${MAX_SEGMENTS.toLocaleString('cs-CZ')} segmentů) – import přerušen.`,
    );
  }
  warnings.push(...out.warnings);
  if (out.hidden > 0) {
    warnings.push(
      `Přeskočeny skryté entity (neviditelné nebo na vypnuté či zamrzlé vrstvě): ${out.hidden}.`,
    );
  }
  const unknown = unhandledTypes(text);
  if (unknown.size > 0) {
    warnings.push(
      `Nepodporované entity přeskočeny – rozložte je v CADu na čáry a oblouky: ${formatList(unknown)}.`,
    );
  }
  if (out.ignored.size > 0)
    warnings.push(`Přeskočeny entity bez geometrie dílu: ${formatList(out.ignored)}.`);
  if (out.unsupported.size > 0)
    warnings.push(`Nepodporované entity přeskočeny: ${formatList(out.unsupported)}.`);
  const errors = out.segments.length === 0 ? ['Výkres neobsahuje žádnou geometrii dílu.'] : [];
  return { ok: true, segments: out.segments, units, warnings, errors };
}

function fail(units: DxfUnits, message: string): DxfReadResult {
  return { ok: false, segments: [], units, warnings: [], errors: [message] };
}
