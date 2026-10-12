import {
  contourBBox,
  contourSignedArea,
  contourToRing,
  orientContour,
} from '../geometry/contour.ts';
import { pointInRing, pointRingDistance } from '../geometry/polygon.ts';
import type { Contour, ContourVertex, Point, Rect, Ring } from '../geometry/types.ts';

/** Segment ze čtení DXF (úsečka nebo oblouk s bulge). */
export interface SegmentLike {
  readonly a: Point;
  readonly b: Point;
  readonly bulge: number;
}

export interface ContourOptions {
  /** Koncové body blíž než tato vzdálenost (mm) se spojí. */
  readonly joinTol?: number;
  /** Mezery do této velikosti (mm) se uzavřou automaticky s varováním. */
  readonly gapTol?: number;
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
}

export interface ContourBuildResult {
  readonly regions: readonly ShapeRegion[];
  readonly warnings: readonly string[];
  /** Neuzavřené kontury – díl z nich nevznikne. */
  readonly errors: readonly string[];
}

/** Hlášení o místě: „(120,0; 35,5)". */
const fmt = (n: number, digits = 1) =>
  n
    .toFixed(digits)
    .replace('.', ',')
    .replace(/^-0(,0+)?$/, '0$1');
const at = (p: Point) => `(${fmt(p.x)}; ${fmt(p.y)})`;

/** Kolik konkrétních hlášení vypsat, než se zbytek jen sečte. */
const MAX_REPORTS = 5;

function report(list: string[], items: readonly string[], summary: (rest: number) => string) {
  list.push(...items.slice(0, MAX_REPORTS));
  if (items.length > MAX_REPORTS) list.push(summary(items.length - MAX_REPORTS));
}

/** Shlukování koncových bodů v toleranci přes mřížku (union–find). */
function clusterPoints(points: readonly Point[], tol: number): { node: number[]; pos: Point[] } {
  const parent = points.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const cell = (v: number) => Math.floor(v / tol);
  const grid = new Map<string, number[]>();
  points.forEach((p, i) => {
    const cx = cell(p.x);
    const cy = cell(p.y);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (Math.hypot(points[j]!.x - p.x, points[j]!.y - p.y) <= tol) parent[find(i)] = find(j);
        }
      }
    }
    const key = `${cx},${cy}`;
    const list = grid.get(key);
    if (list) list.push(i);
    else grid.set(key, [i]);
  });
  // Uzel = průměr bodů shluku.
  const index = new Map<number, number>();
  const sum: { x: number; y: number; n: number }[] = [];
  const node = points.map((p, i) => {
    const r = find(i);
    let k = index.get(r);
    if (k === undefined) {
      k = sum.length;
      index.set(r, k);
      sum.push({ x: 0, y: 0, n: 0 });
    }
    const s = sum[k]!;
    s.x += p.x;
    s.y += p.y;
    s.n++;
    return k;
  });
  return { node, pos: sum.map((s) => ({ x: s.x / s.n, y: s.y / s.n })) };
}

interface Edge {
  readonly from: number;
  readonly to: number;
  readonly bulge: number;
}

/** Hrana orientovaná ve směru průchodu. */
interface Step {
  readonly from: number;
  readonly to: number;
  readonly bulge: number;
}

function orient(e: Edge, from: number): Step {
  return from === e.from ? e : { from: e.to, to: e.from, bulge: -e.bulge };
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
 * odstraní duplicity, uzavře drobné mezery, rozpozná vnější obrysy a otvory
 * podle vnoření a sjednotí orientaci (vnější CCW, otvory CW).
 */
export function buildContours(
  segments: readonly SegmentLike[],
  opts: ContourOptions = {},
): ContourBuildResult {
  const joinTol = opts.joinTol ?? JOIN_TOL;
  const gapTol = opts.gapTol ?? GAP_TOL;
  const warnings: string[] = [];
  const errors: string[] = [];

  // 1. Uzly a hrany bez duplicit a bez hran nulové délky.
  const { node, pos } = clusterPoints(
    segments.flatMap((s) => [s.a, s.b]),
    joinTol,
  );
  const edges: Edge[] = [];
  const keys = new Set<string>();
  let duplicates = 0;
  segments.forEach((s, i) => {
    const from = node[2 * i]!;
    const to = node[2 * i + 1]!;
    if (from === to) return;
    const [lo, hi, b] = from < to ? [from, to, s.bulge] : [to, from, -s.bulge];
    const key = `${lo},${hi},${b.toFixed(6)}`;
    if (keys.has(key)) {
      duplicates++;
      return;
    }
    keys.add(key);
    edges.push({ from, to, bulge: s.bulge });
  });
  if (duplicates > 0) warnings.push(`Odstraněno duplicitních segmentů: ${duplicates}.`);

  // 2. Řetězce. Hrany, které nemůžou ležet na cyklu (visící čáry, např. osa
  //    dotýkající se obrysu), se nejdřív postupně oříznou od uzlů stupně 1 –
  //    jinak by průchod z obrysu odbočil do nich a obrys by se rozpadl.
  const adj: number[][] = pos.map(() => []);
  edges.forEach((e, i) => {
    adj[e.from]!.push(i);
    adj[e.to]!.push(i);
  });
  const degree = adj.map((l) => l.length);
  const pruned = new Uint8Array(edges.length);
  const queue = degree.flatMap((d, n) => (d === 1 ? [n] : []));
  while (queue.length > 0) {
    const n = queue.pop()!;
    if (degree[n] !== 1) continue;
    const e = adj[n]!.find((i) => !pruned[i]);
    if (e === undefined) continue;
    pruned[e] = 1;
    const other = edges[e]!.from === n ? edges[e]!.to : edges[e]!.from;
    degree[n]!--;
    degree[other]!--;
    if (degree[other] === 1) queue.push(other);
  }

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
  const chains: Step[][] = [];
  // V každé množině hran nejdřív od uzlů lichého stupně (otevřené řetězce), pak cykly.
  const walkAll = (inSet: (i: number) => boolean) => {
    const free = (n: number) => adj[n]!.some((i) => !used[i] && inSet(i));
    adj.forEach((list, n) => {
      if (list.filter(inSet).length % 2 === 1) while (free(n)) chains.push(walk(n, inSet));
    });
    adj.forEach((_, n) => {
      while (free(n)) chains.push(walk(n, inSet));
    });
  };
  walkAll((i) => pruned[i] === 1);
  walkAll((i) => pruned[i] === 0);

  const closed: Step[][] = [];
  let open: Step[][] = [];
  for (const c of chains) {
    if (c.length > 0 && c[0]!.from === c.at(-1)!.to) closed.push(...splitAtRepeats(c));
    else if (c.length > 0) open.push(c);
  }

  // 3. Drobné mezery: dvojice volných konců do gapTol (mřížka), od nejbližších;
  //    konec smí být spojen jen jednou.
  const endPos = (c: number, e: number) => {
    const ch = open[c]!;
    return pos[e === 0 ? ch[0]!.from : ch.at(-1)!.to]!;
  };
  const pairs: { p: number; q: number; d: number }[] = [];
  const endGrid = new Map<string, number[]>();
  const gcell = (v: number) => Math.floor(v / gapTol);
  for (let k = 0; k < open.length * 2; k++) {
    const pt = endPos(k >> 1, k & 1);
    const cx = gcell(pt.x);
    const cy = gcell(pt.y);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const m of endGrid.get(`${cx + dx},${cy + dy}`) ?? []) {
          const q = endPos(m >> 1, m & 1);
          const d = Math.hypot(pt.x - q.x, pt.y - q.y);
          if (d <= gapTol) pairs.push({ p: m, q: k, d });
        }
      }
    }
    const key = `${cx},${cy}`;
    const list = endGrid.get(key);
    if (list) list.push(k);
    else endGrid.set(key, [k]);
  }
  pairs.sort((x, y) => x.d - y.d);
  const link = new Map<number, number>();
  const gaps: string[] = [];
  for (const { p, q, d } of pairs) {
    if (link.has(p) || link.has(q)) continue;
    link.set(p, q);
    link.set(q, p);
    gaps.push(
      `Mezera ${fmt(d, 3)} mm u bodu ${at(endPos(p >> 1, p & 1))} byla automaticky uzavřena.`,
    );
  }
  // Průchod přes spojené konce: řetěz vstoupí koncem `e`, vystoupí druhým.
  const rev = (c: readonly Step[]) =>
    c.toReversed().map((st) => ({ from: st.to, to: st.from, bulge: -st.bulge }));
  const visited = new Uint8Array(open.length);
  const stillOpen: Step[][] = [];
  const follow = (startEnd: number) => {
    const steps: Step[] = [];
    let k: number | undefined = startEnd;
    while (k !== undefined && !visited[k >> 1]) {
      visited[k >> 1] = 1;
      const ch = open[k >> 1]!;
      steps.push(...((k & 1) === 0 ? ch : rev(ch)));
      k = link.get(k ^ 1);
    }
    return steps;
  };
  // Nejdřív řetězy s volným koncem (zůstanou otevřené), pak smyčky.
  for (let k = 0; k < open.length * 2; k++) {
    if (!visited[k >> 1] && !link.has(k)) stillOpen.push(follow(k));
  }
  for (let c = 0; c < open.length; c++) {
    if (!visited[c]) closed.push(follow(c * 2));
  }
  open = stillOpen;
  report(warnings, gaps, (n) => `Automaticky uzavřeno dalších ${n} mezer.`);

  report(
    errors,
    open.map((c) => {
      const p = pos[c[0]!.from]!;
      const q = pos[c.at(-1)!.to]!;
      const gap = Math.hypot(p.x - q.x, p.y - q.y);
      return `Kontura není uzavřená, mezera ${fmt(gap, 2)} mm mezi body ${at(p)} a ${at(q)}.`;
    }),
    (n) => `Neuzavřených kontur je ještě ${n}.`,
  );

  // 4. Kontury: vrcholy z uzlů (konec řetězce se tím přichytí na začátek).
  let degenerate = 0;
  const contours: { c: Contour; area: number; ring: Ring; bbox: Rect }[] = [];
  for (const steps of closed) {
    const c: ContourVertex[] = steps.map((s) => ({ ...pos[s.from]!, bulge: s.bulge }));
    const area = Math.abs(contourSignedArea(c));
    if (c.length < 2 || area <= joinTol * joinTol) {
      degenerate++;
      continue;
    }
    contours.push({ c, area, ring: contourToRing(c, joinTol), bbox: contourBBox(c) });
  }
  if (degenerate > 0) warnings.push(`Přeskočeno kontur s nulovou plochou: ${degenerate}.`);

  // 5. Vnoření: rodič = nejmenší kontura, která konturu obsahuje.
  contours.sort((x, y) => y.area - x.area);
  const parent = contours.map(() => -1);
  const contains = (outer: (typeof contours)[number], inner: (typeof contours)[number]) => {
    const o = outer.bbox;
    const i = inner.bbox;
    if (i.x < o.x - joinTol || i.y < o.y - joinTol) return false;
    if (i.x + i.width > o.x + o.width + joinTol || i.y + i.height > o.y + o.height + joinTol) {
      return false;
    }
    // Rozhoduje bod vnitřní kontury, který neleží na hranici vnější.
    for (const p of inner.ring) {
      if (pointRingDistance(p, outer.ring) > joinTol) return pointInRing(p, outer.ring);
    }
    return false;
  };
  for (let i = 0; i < contours.length; i++) {
    for (let j = i - 1; j >= 0; j--) {
      if (contours[j]!.area > contours[i]!.area && contains(contours[j]!, contours[i]!)) {
        parent[i] = j;
        break;
      }
    }
  }
  const depth: number[] = [];
  contours.forEach((_, i) => {
    depth[i] = parent[i]! < 0 ? 0 : depth[parent[i]!]! + 1;
  });

  const regionOf = new Map<number, { outer: Contour; holes: Contour[]; depth: number }>();
  const regions: { outer: Contour; holes: Contour[]; depth: number }[] = [];
  contours.forEach((k, i) => {
    if (depth[i]! % 2 === 0) {
      const r = { outer: orientContour(k.c, 'ccw'), holes: [], depth: depth[i]! };
      regionOf.set(i, r);
      regions.push(r);
    } else {
      regionOf.get(parent[i]!)!.holes.push(orientContour(k.c, 'cw'));
    }
  });
  return { regions, warnings, errors };
}
