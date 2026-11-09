import { contourBBox, contourToRing, orientContour, segmentMidpoint } from '../geometry/contour.ts';
import {
  differencePolygons,
  intersectPolygons,
  polygonsArea,
  unionPolygons,
} from '../geometry/clipper.ts';
import { AREA_EPS } from '../geometry/eps.ts';
import { pointInRing, pointRingDistance, ringSignedArea } from '../geometry/polygon.ts';
import type { Contour, ContourVertex, Point, Polygon, Rect, Ring } from '../geometry/types.ts';

/** Segment ze čtení DXF (úsečka nebo oblouk s bulge). */
export interface SegmentLike {
  readonly a: Point;
  readonly b: Point;
  readonly bulge: number;
  /** Hladina výkresu; chybí-li, „0". */
  readonly layer?: string;
}

export interface ContourOptions {
  /** Koncové body blíž než tato vzdálenost (mm) se spojí. */
  readonly joinTol?: number;
  /** Mezery do této velikosti (mm) se uzavřou automaticky s varováním. */
  readonly gapTol?: number;
  /**
   * Hladiny, jejichž kontury smí být jen otvory (role „vnitřní obrys").
   * Taková kontura mimo materiál dílu se ignoruje s varováním.
   */
  readonly holeLayer?: (layer: string) => boolean;
}

export const JOIN_TOL = 0.01;
export const GAP_TOL = 0.1;

/**
 * Oblast tvaru: vnější obrys (CCW) a jeho otvory (CW). `depth` = hloubka
 * vnoření vnějšího obrysu (0 = nejvyšší úroveň, 2 = díl v otvoru jiného…).
 */
export interface ShapeRegion {
  readonly outer: Contour;
  readonly holes: readonly Contour[];
  readonly depth: number;
  /** Hladina vnějšího obrysu (u kontury z více hladin ta s nejvíc segmenty). */
  readonly outerLayer: string;
  /** Hladiny otvorů ve stejném pořadí jako `holes`. */
  readonly holeLayers: readonly string[];
}

export interface ContourBuildResult {
  readonly regions: readonly ShapeRegion[];
  /** Kontury z hladin „vnitřní obrys", které neležely v materiálu žádného dílu. */
  readonly ignoredHoles: number;
  /** Vnějších obrysů před vyřazením chybných dílů. */
  readonly outlines: number;
  readonly warnings: readonly string[];
  /** Neuzavřené, větvené nebo protínající se kontury – díl z nich nevznikne. */
  readonly errors: readonly string[];
}

/** Hlášení o místě: „(120,0; 35,5)". */
const fmt = (n: number, digits = 1) =>
  n
    .toFixed(digits)
    .replace('.', ',')
    .replace(/^-(0(,0+)?)$/, '$1');
const at = (p: Point) => `(${fmt(p.x)}; ${fmt(p.y)})`;
const dist = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);

/** Kolik konkrétních hlášení vypsat, než se zbytek jen sečte. */
const MAX_REPORTS = 5;

function report(list: string[], items: readonly string[], summary: (rest: number) => string) {
  list.push(...items.slice(0, MAX_REPORTS));
  if (items.length > MAX_REPORTS) list.push(summary(items.length - MAX_REPORTS));
}

/**
 * Oblouk nad 180° s krátkou tětivou (téměř plný) se rozdělí na dvě poloviny –
 * jako jediná hrana by se jeho konce slily a oblouk by zkolaboval do bodu.
 * Ostatní oblouky zůstanou celé, aby se jejich duplicity daly porovnat.
 */
function splitLargeArc(s: SegmentLike, maxChord: number): SegmentLike[] {
  if (Math.abs(s.bulge) <= 1 || dist(s.a, s.b) > maxChord) return [s];
  const m = segmentMidpoint(s.a, s.b, s.bulge);
  const half = Math.tan(Math.atan(s.bulge) / 2);
  const layer = s.layer ?? '0';
  return [
    { a: s.a, b: m, bulge: half, layer },
    { a: m, b: s.b, bulge: half, layer },
  ];
}

/**
 * Uzly: bod se připojí k nejbližšímu existujícímu „lídrovi" do vzdálenosti
 * `tol`, jinak se sám stane lídrem. Posun bodu je tak omezen na `tol`
 * (řetězové shlukování by hustou lomenou čáru slilo do jednoho bodu).
 */
function leaderNodes(points: readonly Point[], tol: number): { node: number[]; pos: Point[] } {
  const pos: Point[] = [];
  const grid = new Map<string, number[]>();
  const cell = (v: number) => Math.floor(v / tol);
  const node = points.map((p) => {
    const cx = cell(p.x);
    const cy = cell(p.y);
    let best = -1;
    let bestD = tol;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const k of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          const d = dist(pos[k]!, p);
          if (d <= bestD) {
            best = k;
            bestD = d;
          }
        }
      }
    }
    if (best >= 0) return best;
    pos.push(p);
    const key = `${cx},${cy}`;
    const list = grid.get(key);
    if (list) list.push(pos.length - 1);
    else grid.set(key, [pos.length - 1]);
    return pos.length - 1;
  });
  return { node, pos };
}

interface Edge {
  readonly from: number;
  readonly to: number;
  readonly bulge: number;
  readonly layer: string;
}

/** Hrana orientovaná ve směru průchodu. */
type Step = Edge;

function orient(e: Edge, from: number): Step {
  return from === e.from ? e : { from: e.to, to: e.from, bulge: -e.bulge, layer: e.layer };
}

/** Hladina kontury: ta, ze které je nejvíc segmentů (při shodě dřívější). */
function majorityLayer(steps: readonly Step[]): string {
  const count = new Map<string, number>();
  let best = steps[0]?.layer ?? '0';
  for (const s of steps) {
    const n = (count.get(s.layer) ?? 0) + 1;
    count.set(s.layer, n);
    if (n > count.get(best)!) best = s.layer;
  }
  return best;
}

/**
 * Hrany bez smyček a bez duplicit. Duplicita = stejné uzly a oblouk, jehož
 * výška se liší nejvýš o `tol` (i obráceně zadaný segment).
 */
function dedupeEdges(raw: readonly Edge[], pos: readonly Point[], tol: number) {
  const edges: Edge[] = [];
  const byPair = new Map<string, number[]>();
  let duplicates = 0;
  for (const e of raw) {
    if (e.from === e.to) continue;
    const [lo, hi, b] = e.from < e.to ? [e.from, e.to, e.bulge] : [e.to, e.from, -e.bulge];
    const key = `${lo},${hi}`;
    const chord = dist(pos[lo]!, pos[hi]!);
    const same = byPair.get(key) ?? [];
    if (same.some((ob) => (Math.abs(ob - b) * chord) / 2 <= tol)) {
      duplicates++;
      continue;
    }
    same.push(b);
    byPair.set(key, same);
    edges.push(e);
  }
  return { edges, duplicates };
}

/** Mosty grafu (hrany, které neleží na žádném cyklu) – Tarjan, iterativně. */
function findBridges(nodeCount: number, edges: readonly Edge[], adj: readonly number[][]) {
  const disc = new Int32Array(nodeCount).fill(-1);
  const low = new Int32Array(nodeCount);
  const bridge = new Uint8Array(edges.length);
  let time = 0;
  for (let s = 0; s < nodeCount; s++) {
    if (disc[s] !== -1 || adj[s]!.length === 0) continue;
    disc[s] = low[s] = time++;
    const stack: { v: number; pe: number; i: number }[] = [{ v: s, pe: -1, i: 0 }];
    while (stack.length > 0) {
      const top = stack.at(-1)!;
      const list = adj[top.v]!;
      if (top.i < list.length) {
        const e = list[top.i++]!;
        if (e === top.pe) continue;
        const w = edges[e]!.from === top.v ? edges[e]!.to : edges[e]!.from;
        if (disc[w] === -1) {
          disc[w] = low[w] = time++;
          stack.push({ v: w, pe: e, i: 0 });
        } else {
          low[top.v] = Math.min(low[top.v]!, disc[w]!);
        }
      } else {
        stack.pop();
        const parent = stack.at(-1);
        if (parent) {
          low[parent.v] = Math.min(low[parent.v]!, low[top.v]!);
          if (low[top.v]! > disc[parent.v]!) bridge[top.pe] = 1;
        }
      }
    }
  }
  return bridge;
}

/** Rozdělí uzavřený řetěz, který prochází některým uzlem víckrát (osmička). */
function splitAtRepeats(steps: readonly Step[]): Step[][] {
  const out: Step[][] = [];
  const stack: Step[] = [];
  const seen = new Map<number, number>();
  for (const s of steps) {
    seen.set(s.from, stack.length);
    stack.push(s);
    const start = seen.get(s.to);
    if (start !== undefined) {
      const loop = stack.splice(start);
      for (const l of loop) seen.delete(l.from);
      out.push(loop);
    }
  }
  if (stack.length > 0) out.push(stack);
  return out;
}

/**
 * Sestaví uzavřené kontury ze segmentů: spojí koncové body v toleranci,
 * odstraní duplicity, uzavře drobné mezery, oddělí čáry mimo obrysy, odmítne
 * větvené a protínající se kontury, rozpozná vnější obrysy a otvory podle
 * vnoření a sjednotí orientaci (vnější CCW, otvory CW).
 */
export function buildContours(
  segments: readonly SegmentLike[],
  opts: ContourOptions = {},
): ContourBuildResult {
  const joinTol = opts.joinTol ?? JOIN_TOL;
  const gapTol = opts.gapTol ?? GAP_TOL;
  const warnings: string[] = [];
  const errors: string[] = [];

  // 1. Uzly a hrany bez duplicit.
  const segs = segments.flatMap((s) => splitLargeArc(s, 2 * gapTol));
  const { node, pos } = leaderNodes(
    segs.flatMap((s) => [s.a, s.b]),
    joinTol,
  );
  const rawEdges: Edge[] = segs.map((s, i) => ({
    from: node[2 * i]!,
    to: node[2 * i + 1]!,
    bulge: s.bulge,
    layer: s.layer ?? '0',
  }));
  let { edges, duplicates } = dedupeEdges(rawEdges, pos, joinTol);

  // 2. Drobné mezery: volný konec (stupeň 1) se slije s uzlem do gapTol – nejdřív
  //    s jiným volným koncem, pak i s uzlem obrysu (roh, ze kterého visí čára).
  //    Uzly spojené přímo hranou (krátká čára, přesah v rohu) se neslévají.
  const degree = new Int32Array(pos.length);
  const pairs = new Set<string>();
  for (const e of edges) {
    degree[e.from]!++;
    degree[e.to]!++;
    pairs.add(e.from < e.to ? `${e.from},${e.to}` : `${e.to},${e.from}`);
  }
  const candidates: { p: number; q: number; d: number; rank: number }[] = [];
  const nodeGrid = new Map<string, number[]>();
  const gcell = (v: number) => Math.floor(v / gapTol);
  pos.forEach((p, n) => {
    if (degree[n] === 0) return;
    const key = `${gcell(p.x)},${gcell(p.y)}`;
    const list = nodeGrid.get(key);
    if (list) list.push(n);
    else nodeGrid.set(key, [n]);
  });
  for (let n = 0; n < pos.length; n++) {
    if (degree[n] !== 1) continue;
    const p = pos[n]!;
    const cx = gcell(p.x);
    const cy = gcell(p.y);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const m of nodeGrid.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (m === n || (degree[m] === 1 && m < n)) continue;
          const d = dist(pos[m]!, p);
          if (d <= gapTol && !pairs.has(m < n ? `${m},${n}` : `${n},${m}`)) {
            candidates.push({ p: m, q: n, d, rank: degree[m] === 1 ? 0 : 1 });
          }
        }
      }
    }
  }
  candidates.sort((x, y) => x.rank - y.rank || x.d - y.d);
  const target = [...pos.keys()];
  const merged = new Uint8Array(pos.length);
  const gaps: string[] = [];
  for (const { p, q, d } of candidates) {
    if (merged[p] || merged[q]) continue;
    merged[p] = merged[q] = 1;
    target[q] = p;
    gaps.push(`Mezera ${fmt(d, 3)} mm u bodu ${at(pos[p]!)} byla automaticky uzavřena.`);
  }
  report(warnings, gaps, (n) => `Automaticky uzavřeno dalších ${n} mezer.`);
  if (gaps.length > 0) {
    const again = dedupeEdges(
      edges.map((e) => ({ ...e, from: target[e.from]!, to: target[e.to]! })),
      pos,
      joinTol,
    );
    edges = again.edges;
    duplicates += again.duplicates;
  }
  if (duplicates > 0) warnings.push(`Odstraněno duplicitních segmentů: ${duplicates}.`);

  // 3. Mosty (čáry mimo cykly: visící, spojky mezi obrysy) – ty kontury netvoří.
  const adj: number[][] = pos.map(() => []);
  edges.forEach((e, i) => {
    adj[e.from]!.push(i);
    adj[e.to]!.push(i);
  });
  const bridge = findBridges(pos.length, edges, adj);
  const used = new Uint8Array(edges.length);
  const walk = (start: number, inSet: (i: number) => boolean): Step[] => {
    const steps: Step[] = [];
    let cur = start;
    for (;;) {
      const next = adj[cur]!.find((i) => !used[i] && inSet(i));
      if (next === undefined) return steps;
      used[next] = 1;
      const step = orient(edges[next]!, cur);
      steps.push(step);
      cur = step.to;
      if (cur === start) return steps;
    }
  };
  const isBridge = (i: number) => bridge[i] === 1;
  const openChains: Step[][] = [];
  const freeIn = (n: number, inSet: (i: number) => boolean) =>
    adj[n]!.some((i) => !used[i] && inSet(i));
  adj.forEach((list, n) => {
    if (list.filter(isBridge).length % 2 === 1)
      while (freeIn(n, isBridge)) openChains.push(walk(n, isBridge));
  });
  adj.forEach((_, n) => {
    while (freeIn(n, isBridge)) openChains.push(walk(n, isBridge));
  });
  // Body chybné geometrie: díl, v jehož materiálu leží, se vynechá (chyběl by
  // mu např. nedokreslený otvor). Čára mezi dvěma uzavřenými obrysy díl nezničí.
  // Bod na hranici obrysu (do 2 × joinTol) se nepočítá.
  const errorPoints: Point[] = [];
  const onCycle = (n: number) => adj[n]!.some((i) => !bridge[i]);
  const openErrors = openChains.map((c) => {
    const p = pos[c[0]!.from]!;
    const q = pos[c.at(-1)!.to]!;
    if (onCycle(c[0]!.from) && onCycle(c.at(-1)!.to)) {
      return `Čára mimo uzavřené obrysy mezi body ${at(p)} a ${at(q)} – ignorována.`;
    }
    // Volný konec uvnitř materiálu = nedokreslená kontura (např. otvor).
    // Čára s konci na hranici obrysu (ohyb, osa přes díl) díl nevyřadí.
    if (!onCycle(c[0]!.from)) errorPoints.push(p);
    if (!onCycle(c.at(-1)!.to)) errorPoints.push(q);
    return `Kontura není uzavřená, mezera ${fmt(dist(p, q), 2)} mm mezi body ${at(p)} a ${at(q)}.`;
  });

  // 4. Komponenty zbylých hran. Uzel lichého stupně = větvení (čára uvnitř
  //    obrysu, sdílená hrana dvou dílů) – obrys nejde jednoznačně určit.
  const comp = [...pos.keys()];
  const find = (i: number): number => {
    while (comp[i] !== i) {
      comp[i] = comp[comp[i]!]!;
      i = comp[i]!;
    }
    return i;
  };
  const cycleDegree = new Int32Array(pos.length);
  edges.forEach((e, i) => {
    if (bridge[i]) return;
    cycleDegree[e.from]!++;
    cycleDegree[e.to]!++;
    comp[find(e.from)] = find(e.to);
  });
  const branched = new Map<number, number>();
  for (let n = 0; n < pos.length; n++) {
    if (cycleDegree[n]! % 2 === 1 && !branched.has(find(n))) branched.set(find(n), n);
  }
  for (let n = 0; n < pos.length; n++) {
    if (cycleDegree[n]! > 0 && branched.has(find(n))) errorPoints.push(pos[n]!);
  }
  const branchErrors = [...branched.values()].map(
    (n) =>
      `Kontura se větví v bodě ${at(pos[n]!)} – uvnitř obrysu je nejspíš další čára (ohyb, osa) nebo dva díly sdílejí hranu; odstraňte ji nebo vyberte jen vrstvu s obrysy.`,
  );
  const inCycles = (i: number) => !bridge[i] && !branched.has(find(edges[i]!.from));
  const closed: Step[][] = [];
  adj.forEach((_, n) => {
    while (freeIn(n, inCycles)) closed.push(...splitAtRepeats(walk(n, inCycles)));
  });

  // 5. Kontury: vrcholy z uzlů. Samoprůnik = plocha sjednocení (nonzero) se
  //    liší od |orientované plochy| (osmička má orientovanou plochu i 0).
  const minArea = Math.max(joinTol * joinTol, AREA_EPS);
  const ringTol = joinTol / 4;
  let degenerate = 0;
  const crossErrors: string[] = [];
  const contours: Shape[] = [];
  for (const steps of closed) {
    const c: ContourVertex[] = steps.map((s) => ({ ...pos[s.from]!, bulge: s.bulge }));
    if (c.length < 2) {
      degenerate++;
      continue;
    }
    const ring = contourToRing(c, ringTol);
    const signed = Math.abs(ringSignedArea(ring));
    const filled = polygonsArea(unionPolygons([{ outer: ring, holes: [] }]));
    if (Math.abs(filled - signed) > areaTol(ring)) {
      crossErrors.push(`Kontura protíná sama sebe u bodu ${at(c[0]!)}.`);
      errorPoints.push(...c);
      continue;
    }
    if (signed <= minArea) {
      degenerate++;
      continue;
    }
    contours.push({ c, area: signed, ring, bbox: contourBBox(c), layer: majorityLayer(steps) });
  }
  if (degenerate > 0) warnings.push(`Přeskočeno kontur s nulovou plochou: ${degenerate}.`);

  // 6. Vnoření: rodič = nejmenší kontura, která konturu obsahuje. Rozhodují
  //    vrcholy a středy segmentů vnitřní kontury, které neleží na hranici vnější.
  //    Křížení a přesahy odhalí až kontrola ploch v kroku 7.
  contours.sort((x, y) => y.area - x.area);
  const samples = contours.map((k) =>
    k.c.flatMap((v, i) => [v, segmentMidpoint(v, k.c[(i + 1) % k.c.length]!, v.bulge)]),
  );
  const contains = (o: number, i: number) => {
    if (!bboxInside(contours[i]!.bbox, contours[o]!.bbox, joinTol)) return false;
    const ring = contours[o]!.ring;
    for (const p of samples[i]!) {
      if (pointRingDistance(p, ring) > 2 * joinTol) return pointInRing(p, ring);
    }
    return false;
  };
  const parent = contours.map(() => -1);
  for (let i = 0; i < contours.length; i++) {
    for (let j = i - 1; j >= 0; j--) {
      if (contours[j]!.area > contours[i]!.area && contains(j, i)) {
        parent[i] = j;
        break;
      }
    }
  }
  // Kontura z hladiny „vnitřní obrys" musí být otvor (lichá hloubka); jinak
  // se vynechá a její potomci se vnoří o úroveň výš. Rodiče předcházejí
  // potomkům (řazení podle plochy), takže stačí jeden průchod.
  const holeLayer = opts.holeLayer;
  const dropped = new Uint8Array(contours.length);
  const depth: number[] = [];
  contours.forEach((k, i) => {
    let p = parent[i]!;
    while (p >= 0 && dropped[p]) p = parent[p]!;
    parent[i] = p;
    depth[i] = p < 0 ? 0 : depth[p]! + 1;
    if (holeLayer?.(k.layer) && depth[i]! % 2 === 0) dropped[i] = 1;
  });
  const regionOf = new Map<number, Draft>();
  const drafts: Draft[] = [];
  contours.forEach((k, i) => {
    if (dropped[i]) return;
    if (depth[i]! % 2 === 0) {
      const r: Draft = { outer: k, holes: [], depth: depth[i]!, broken: null };
      regionOf.set(i, r);
      drafts.push(r);
    } else {
      regionOf.get(parent[i]!)!.holes.push(k);
    }
  });

  // 7. Kontrola ploch (Clipper): otvor celý uvnitř obrysu, otvory se
  //    nepřekrývají, materiál různých dílů se nepřekrývá (shodný obrys
  //    nakreslený dvakrát se sloučí), v materiálu dílu neleží chybná geometrie.
  /** Materiál dílu; otvory jen ty, které zasahují do obdélníku `box`. */
  const materialNear = (d: Draft, box: Rect): Polygon => ({
    outer: d.outer.ring,
    holes: d.holes.filter((h) => bboxesOverlap(h.bbox, box)).map((h) => h.ring),
  });
  for (const d of drafts) {
    for (const h of d.holes) {
      const out = polygonsArea(
        differencePolygons([{ outer: h.ring, holes: [] }], [{ outer: d.outer.ring, holes: [] }]),
      );
      if (out > areaTol(h.ring)) d.broken ??= `otvor u bodu ${at(h.c[0]!)} přesahuje vnější obrys`;
    }
    forOverlappingPairs(d.holes, (a, b) => {
      const both = polygonsArea(
        intersectPolygons([{ outer: a.ring, holes: [] }], [{ outer: b.ring, holes: [] }]),
      );
      if (both > areaTol(a.ring) + areaTol(b.ring))
        d.broken ??= `otvory u bodu ${at(a.c[0]!)} se překrývají`;
    });
  }
  // Vynechaný vnitřní obrys, který zasahuje do materiálu dílu (kříží jeho
  // obrys), je chybně nakreslený otvor – díl se vyřadí, aby nevznikl bez něj.
  const orphanHoles: string[] = [];
  contours.forEach((k, i) => {
    if (!dropped[i]) return;
    const ring = { outer: k.ring, holes: [] };
    // Levně: díl, jehož vrcholy leží zřetelně uvnitř kontury a do jehož
    // obalového obdélníku nezasahuje žádný vrchol kontury (rámeček výkresu
    // kolem dílů), hranici nekříží.
    const surely = (d: Draft) =>
      bboxInside(d.outer.bbox, k.bbox, 0) &&
      d.outer.ring.every((p) => pointInRing(p, k.ring) && pointRingDistance(p, k.ring) > joinTol) &&
      !k.ring.some((p) => bboxInside({ ...p, width: 0, height: 0 }, d.outer.bbox, joinTol));
    const hit = drafts.find((d) => {
      if (!bboxesOverlap(d.outer.bbox, k.bbox) || surely(d)) return false;
      const tol = areaTol(k.ring) + areaTol(d.outer.ring);
      // Díl celý uvnitř kontury (např. rámeček kolem dílu) hranici nekříží.
      const whole = polygonsArea(intersectPolygons([{ outer: d.outer.ring, holes: [] }], [ring]));
      if (whole >= d.outer.area - tol) return false;
      return polygonsArea(intersectPolygons([materialNear(d, k.bbox)], [ring])) > tol;
    });
    if (hit) hit.broken ??= `otvor u bodu ${at(k.c[0]!)} přesahuje vnější obrys`;
    else {
      orphanHoles.push(
        `Kontura u bodu ${at(k.c[0]!)} na hladině „${k.layer}" (vnitřní obrys) neleží v materiálu žádného dílu – ignorována.`,
      );
    }
  });
  report(warnings, orphanHoles, (n) => `Dalších ignorovaných vnitřních obrysů: ${n}.`);
  const duplicateOutlines = new Set<Draft>();
  forOverlappingPairs(
    drafts.map((d) => ({ ...d.outer, d })),
    (a, b) => {
      if (duplicateOutlines.has(a.d) || duplicateOutlines.has(b.d)) return;
      const tol = areaTol(a.ring) + areaTol(b.ring);
      // Nejdřív levně samotné vnější obrysy, otvory jen ty v dosahu druhého dílu.
      const outers = polygonsArea(
        intersectPolygons([{ outer: a.ring, holes: [] }], [{ outer: b.ring, holes: [] }]),
      );
      if (outers <= tol) return;
      const both = polygonsArea(
        intersectPolygons([materialNear(a.d, b.bbox)], [materialNear(b.d, a.bbox)]),
      );
      if (both <= tol) return;
      const same =
        Math.abs(a.area - b.area) <= tol &&
        a.d.holes.length === b.d.holes.length &&
        both >= Math.min(a.area, b.area) - tol;
      if (same) {
        duplicateOutlines.add(b.d);
        warnings.push(`Obrys u bodu ${at(b.c[0]!)} je nakreslený dvakrát – použit jednou.`);
      } else {
        a.d.broken ??= `obrys se překrývá s jiným u bodu ${at(b.c[0]!)}`;
        b.d.broken ??= `obrys se překrývá s jiným u bodu ${at(a.c[0]!)}`;
      }
    },
  );
  for (const d of drafts) {
    if (d.broken) continue;
    const bad = errorPoints.find(
      (p) =>
        bboxInside({ x: p.x, y: p.y, width: 0, height: 0 }, d.outer.bbox, 0) &&
        pointInRing(p, d.outer.ring) &&
        pointRingDistance(p, d.outer.ring) > 2 * joinTol &&
        d.holes.every((h) => !pointInRing(p, h.ring) && pointRingDistance(p, h.ring) > 2 * joinTol),
    );
    if (bad) d.broken = `uvnitř je chybná kontura u bodu ${at(bad)}`;
  }
  const brokenErrors = drafts
    .filter((d) => d.broken)
    .map((d) => `Díl u bodu ${at(d.outer.c[0]!)} vynechán: ${d.broken}.`);

  report(
    errors,
    [...openErrors, ...branchErrors, ...crossErrors, ...brokenErrors],
    (n) => `Dalších chyb kontur: ${n}.`,
  );
  const regions = drafts
    .filter((d) => !d.broken && !duplicateOutlines.has(d))
    .map((d) => ({
      outer: orientContour(d.outer.c, 'ccw'),
      holes: d.holes.map((h) => orientContour(h.c, 'cw')),
      depth: d.depth,
      outerLayer: d.outer.layer,
      holeLayers: d.holes.map((h) => h.layer),
    }));
  return {
    regions,
    ignoredHoles: dropped.reduce((n, v) => n + v, 0),
    outlines: drafts.length,
    warnings,
    errors,
  };
}

/** Uzavřená kontura s aproximací pro výpočty. */
interface Shape {
  readonly c: Contour;
  readonly area: number;
  readonly ring: Ring;
  readonly bbox: Rect;
  readonly layer: string;
}

/** Rozpracovaná oblast; `broken` = důvod vyřazení. */
interface Draft {
  readonly outer: Shape;
  readonly holes: Shape[];
  readonly depth: number;
  broken: string | null;
}

/** Tolerance plochy pro porovnání aproximovaných obrysů: JOIN_TOL × obvod. */
function areaTol(ring: Ring): number {
  let perimeter = 0;
  for (let i = 0; i < ring.length; i++) perimeter += dist(ring[i]!, ring[(i + 1) % ring.length]!);
  return JOIN_TOL * perimeter;
}

function bboxesOverlap(a: Rect, b: Rect): boolean {
  return !(
    b.x > a.x + a.width ||
    a.x > b.x + b.width ||
    b.y > a.y + a.height ||
    a.y > b.y + b.height
  );
}

function bboxInside(inner: Rect, outer: Rect, tol: number): boolean {
  return (
    inner.x >= outer.x - tol &&
    inner.y >= outer.y - tol &&
    inner.x + inner.width <= outer.x + outer.width + tol &&
    inner.y + inner.height <= outer.y + outer.height + tol
  );
}

/** Dvojice s překrývajícími se obalovými obdélníky (zametání podle x). */
function forOverlappingPairs<T extends { readonly bbox: Rect }>(
  items: readonly T[],
  visit: (a: T, b: T) => void,
): void {
  const sorted = [...items].sort((a, b) => a.bbox.x - b.bbox.x);
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j]!;
      if (b.bbox.x > a.bbox.x + a.bbox.width) break;
      if (b.bbox.y > a.bbox.y + a.bbox.height || a.bbox.y > b.bbox.y + b.bbox.height) continue;
      visit(a, b);
    }
  }
}
