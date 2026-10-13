import {
  differencePolygons,
  minkowskiSum as clipperMinkowskiSum,
  unionPolygons,
} from './clipper.ts';
import { EPS } from './eps.ts';
import { orientRing, ringBBox, ringSignedArea } from './polygon.ts';
import type { Point, Polygon, Ring } from './types.ts';

const cross = (o: Point, a: Point, b: Point) =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/**
 * Obrys bez duplicitních a kolineárních vrcholů (relativní tolerance vůči
 * délkám hran), CCW. Pro triangulaci – kolineární vrcholy by dávaly
 * degenerované trojúhelníky.
 */
export function cleanRing(ring: Ring): Point[] {
  let pts = [...orientRing(ring, 'ccw')];
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length && pts.length > 3; i++) {
      const prev = pts[(i - 1 + pts.length) % pts.length]!;
      const cur = pts[i]!;
      const next = pts[(i + 1) % pts.length]!;
      const l1 = Math.hypot(cur.x - prev.x, cur.y - prev.y);
      const l2 = Math.hypot(next.x - cur.x, next.y - cur.y);
      // Vzdálenost vrcholu od spojnice sousedů ~ |cross| / délka.
      if (l1 < 1e-9 || l2 < 1e-9 || Math.abs(cross(prev, cur, next)) <= 1e-12 * (l1 + l2) ** 2) {
        pts.splice(i, 1);
        changed = true;
        i--;
      }
    }
  }
  if (pts.length >= 3 && ringSignedArea(pts) < 0) pts = pts.reverse();
  return pts;
}

/** Leží bod p uvnitř trojúhelníku abc (CCW) nebo na jeho hraně? */
function inTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
  return cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
}

/** Triangulace odřezáváním uší (indexy vrcholů CCW); `null` = nepodařilo se. */
function triangulate(pts: readonly Point[]): number[][] | null {
  const idx = pts.map((_, i) => i);
  const tris: number[][] = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 10 * pts.length * pts.length) {
    let cut = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k - 1 + idx.length) % idx.length]!;
      const i1 = idx[k]!;
      const i2 = idx[(k + 1) % idx.length]!;
      const a = pts[i0]!;
      const b = pts[i1]!;
      const c = pts[i2]!;
      if (cross(a, b, c) <= 0) continue; // nekonvexní vrchol
      let ear = true;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        const p = pts[j]!;
        // Vrchol shodný s vrcholem ucha (dotyk) ucho nezakazuje.
        if ((p.x === a.x && p.y === a.y) || (p.x === c.x && p.y === c.y)) continue;
        if (inTriangle(p, a, b, c)) {
          ear = false;
          break;
        }
      }
      if (!ear) continue;
      tris.push([i0, i1, i2]);
      idx.splice(k, 1);
      cut = true;
      break;
    }
    if (!cut) return null;
  }
  if (idx.length !== 3) return null;
  tris.push([...idx]);
  return tris;
}

/** Je polygon (indexy, CCW) konvexní? */
function isConvex(pts: readonly Point[], poly: readonly number[]): boolean {
  const n = poly.length;
  for (let k = 0; k < n; k++) {
    const a = pts[poly[k]!]!;
    const b = pts[poly[(k + 1) % n]!]!;
    const c = pts[poly[(k + 2) % n]!]!;
    if (cross(a, b, c) < 0) return false;
  }
  return true;
}

/** Sloučí dva polygony (indexy) sdílející hranu u–v; `null` = nesdílejí ji. */
function mergeAlong(p: readonly number[], q: readonly number[]): number[] | null {
  for (let i = 0; i < p.length; i++) {
    const u = p[i]!;
    const v = p[(i + 1) % p.length]!;
    const j = q.indexOf(v);
    if (j < 0 || q[(j + 1) % q.length] !== u) continue;
    // p: … u v …, q: … v u … → p od v dokola k u, pak q od u dokola k v (bez u, v).
    const out: number[] = [];
    for (let k = 1; k <= p.length; k++) out.push(p[(i + k) % p.length]!);
    for (let k = 2; k < q.length; k++) out.push(q[(j + k) % q.length]!);
    return out;
  }
  return null;
}

/**
 * Konvexní rozklad jednoduchého polygonu: triangulace a slučování sousedních
 * částí, dokud zůstávají konvexní (Hertel–Mehlhorn). `null` = nepodařilo se.
 */
export function convexDecomposition(ring: Ring): Ring[] | null {
  const pts = cleanRing(ring);
  if (pts.length < 3) return null;
  if (
    isConvex(
      pts,
      pts.map((_, i) => i),
    )
  ) {
    return [pts];
  }
  const tris = triangulate(pts);
  if (!tris) return null;
  const pieces: (number[] | null)[] = tris;
  let merged = true;
  while (merged) {
    merged = false;
    for (let a = 0; a < pieces.length; a++) {
      if (!pieces[a]) continue;
      for (let b = a + 1; b < pieces.length; b++) {
        if (!pieces[b]) continue;
        const m = mergeAlong(pieces[a]!, pieces[b]!);
        if (m && isConvex(pts, m)) {
          pieces[a] = m;
          pieces[b] = null;
          merged = true;
        }
      }
    }
  }
  return pieces.filter((p): p is number[] => p !== null).map((p) => p.map((i) => pts[i]!));
}

/** Minkowského součet dvou konvexních polygonů (CCW) slitím hran podle úhlu. */
export function convexMinkowski(p: Ring, q: Ring): Ring {
  const start = (r: Ring) => {
    let best = 0;
    for (let i = 1; i < r.length; i++) {
      const a = r[i]!;
      const b = r[best]!;
      if (a.y < b.y || (a.y === b.y && a.x < b.x)) best = i;
    }
    return best;
  };
  const i0 = start(p);
  const j0 = start(q);
  const out: Point[] = [];
  let i = 0;
  let j = 0;
  const n = p.length;
  const m = q.length;
  while (i < n || j < m) {
    const pi = p[(i0 + i) % n]!;
    const qj = q[(j0 + j) % m]!;
    out.push({ x: pi.x + qj.x, y: pi.y + qj.y });
    const pe = { x: p[(i0 + i + 1) % n]!.x - pi.x, y: p[(i0 + i + 1) % n]!.y - pi.y };
    const qe = { x: q[(j0 + j + 1) % m]!.x - qj.x, y: q[(j0 + j + 1) % m]!.y - qj.y };
    const c = pe.x * qe.y - pe.y * qe.x;
    if (j >= m || (i < n && c > 0)) i++;
    else if (i >= n || c < 0) j++;
    else {
      i++;
      j++;
    }
  }
  return out;
}

/**
 * Minkowského součet A ⊕ B přes konvexní rozklad: ⋃ Aᵢ ⊕ Bⱼ (sjednocení
 * Clipperem). Řádově rychlejší než Clipper MinkowskiSum (ten sjednocuje
 * n·m čtyřúhelníků). Když rozklad selže, použije se Clipper.
 */
export function minkowskiSumFast(a: Ring, b: Ring): Polygon[] {
  const pa = convexDecomposition(a);
  const pb = convexDecomposition(b);
  if (!pa || !pb) return clipperMinkowskiSum(a, b);
  // Kaskádové sjednocení: nejdřív po řádcích (Aᵢ ⊕ všechna Bⱼ), pak binárním
  // stromem. Jedno sjednocení všech |A|·|B| silně se překrývajících kusů je
  // u tvarů s mnoha konkávními vrcholy (ozubení) řádově pomalejší.
  let level = pa.map((x) =>
    unionPolygons(pb.map((y) => ({ outer: convexMinkowski(x, y), holes: [] }))),
  );
  while (level.length > 1) {
    const next: Polygon[][] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(i + 1 < level.length ? unionPolygons([...level[i]!, ...level[i + 1]!]) : level[i]!);
    }
    level = next;
  }
  return level[0] ?? [];
}

/** Konvexní obal bodů (monotónní řetězec), CCW, bez kolineárních vrcholů. */
export function convexHull(points: readonly Point[]): Point[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const half = (list: readonly Point[]) => {
    const h: Point[] = [];
    for (const p of list) {
      while (h.length >= 2 && cross(h[h.length - 2]!, h[h.length - 1]!, p) <= 0) h.pop();
      h.push(p);
    }
    h.pop();
    return h;
  };
  return [...half(pts), ...half(pts.toReversed())];
}

/**
 * Inner-fit polygon otvoru H pro pohyblivý tvar B (referenční bod = počátek B):
 * posuny t, při kterých B + t leží celý v H. Spočítá se jako (H − b0) bez
 * „tažení" −B po hranici H (∂H ⊕ (−B) = sjednocení konvexních obalů
 * Bⱼ + p a Bⱼ + q pro každou hranu pq a konvexní část Bⱼ tvaru −B). Bod b0 B
 * uvnitř H a žádný průnik s hranicí ⇒ celé souvislé B uvnitř H.
 * `forbidden` upraví zakázanou oblast (např. tolerance skládání).
 * Prázdné pole = B se do otvoru nevejde (nebo rozklad selhal – konzervativně).
 */
export function holeInnerFit(
  hole: Ring,
  b: Ring,
  forbidden: (polys: Polygon[]) => Polygon[] = (p) => p,
): Polygon[] {
  if (hole.length < 3) return [];
  // B širší nebo vyšší než otvor se nevejde – bez výpočtu (booleovské operace
  // by jinak nechaly falešné pruhy šířky jednotek Clipperu).
  const hb = ringBBox(hole);
  const bb = ringBBox(b);
  if (bb.width > hb.width + EPS || bb.height > hb.height + EPS) return [];
  const neg = b.map((p) => ({ x: -p.x, y: -p.y }));
  const pieces = convexDecomposition(neg);
  if (!pieces) return [];
  const sweeps: Polygon[] = [];
  for (let i = 0; i < hole.length; i++) {
    const p = hole[i]!;
    const q = hole[(i + 1) % hole.length]!;
    for (const piece of pieces) {
      const hull = convexHull([
        ...piece.map((v) => ({ x: v.x + p.x, y: v.y + p.y })),
        ...piece.map((v) => ({ x: v.x + q.x, y: v.y + q.y })),
      ]);
      if (hull.length >= 3) sweeps.push({ outer: hull, holes: [] });
    }
  }
  const b0 = b[0]!;
  const start: Polygon = {
    outer: orientRing(
      hole.map((p) => ({ x: p.x - b0.x, y: p.y - b0.y })),
      'ccw',
    ),
    holes: [],
  };
  return differencePolygons([start], forbidden(unionPolygons(sweeps)));
}
