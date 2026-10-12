import ClipperLib from 'clipper-lib';
import { CLIPPER_SCALE } from './eps.ts';
import { orientRing, ringArea } from './polygon.ts';
import type { Point, Polygon, Ring } from './types.ts';

/**
 * Obal knihovny Clipper (celočíselné souřadnice): mm × CLIPPER_SCALE,
 * zaokrouhleno. Vstupy i výstupy jsou v mm; vnější obrysy CCW, otvory CW.
 */
export type IntPath = ClipperLib.Path;
export type IntPaths = ClipperLib.Paths;

export function toIntPath(ring: Ring): IntPath {
  return ring.map((p) => ({
    X: Math.round(p.x * CLIPPER_SCALE),
    Y: Math.round(p.y * CLIPPER_SCALE),
  }));
}

export function fromIntPath(path: IntPath): Ring {
  return path.map((p) => ({ x: p.X / CLIPPER_SCALE, y: p.Y / CLIPPER_SCALE }));
}

const polygonPaths = (polys: readonly Polygon[]): IntPaths =>
  polys.flatMap((p) => [
    toIntPath(orientRing(p.outer, 'ccw')),
    ...p.holes.map((h) => toIntPath(orientRing(h, 'cw'))),
  ]);

/** Strom výsledku Clipperu → polygony s otvory (orientace podle konvence). */
function treeToPolygons(tree: ClipperLib.PolyTree): Polygon[] {
  return ClipperLib.JS.PolyTreeToExPolygons(tree)
    .map((ex) => ({
      outer: orientRing(fromIntPath(ex.outer), 'ccw'),
      holes: ex.holes.map((h) => orientRing(fromIntPath(h), 'cw')),
    }))
    .filter((p) => p.outer.length >= 3 && ringArea(p.outer) > 0);
}

/**
 * Offset polygonů o `delta` mm (kladný = nafouknutí: vnější obrys roste,
 * otvory se zmenšují a případně zaniknou). Zaoblené rohy s odchylkou
 * oblouku nejvýš `arcTol` mm.
 */
export function offsetPolygons(
  polys: readonly Polygon[],
  delta: number,
  arcTol: number,
): Polygon[] {
  const co = new ClipperLib.ClipperOffset(2, Math.max(1, arcTol * CLIPPER_SCALE));
  co.AddPaths(polygonPaths(polys), ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const tree = new ClipperLib.PolyTree();
  co.Execute(tree, delta * CLIPPER_SCALE);
  return treeToPolygons(tree);
}

function boolean(
  type: ClipperLib.ClipType,
  subject: readonly Polygon[],
  clip: readonly Polygon[],
): Polygon[] {
  const c = new ClipperLib.Clipper();
  c.AddPaths(polygonPaths(subject), ClipperLib.PolyType.ptSubject, true);
  c.AddPaths(polygonPaths(clip), ClipperLib.PolyType.ptClip, true);
  const tree = new ClipperLib.PolyTree();
  c.Execute(type, tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return treeToPolygons(tree);
}

export const unionPolygons = (polys: readonly Polygon[]): Polygon[] =>
  boolean(ClipperLib.ClipType.ctUnion, polys, []);

export const differencePolygons = (
  subject: readonly Polygon[],
  clip: readonly Polygon[],
): Polygon[] => boolean(ClipperLib.ClipType.ctDifference, subject, clip);

export const intersectPolygons = (
  subject: readonly Polygon[],
  clip: readonly Polygon[],
): Polygon[] => boolean(ClipperLib.ClipType.ctIntersection, subject, clip);

/**
 * Minkowského součet obrysů A ⊕ B (vnější obrysy, otvory se ignorují).
 * Clipper vrací jen pás vzniklý tažením B po hranici A; celý součet je jeho
 * sjednocení s A posunutým o libovolný bod B (pro souvislé B pokryje vnitřek).
 * Zbylé otvory jsou skutečné dutiny (u nekonvexních tvarů).
 */
export function minkowskiSum(a: Ring, b: Ring): Polygon[] {
  const pa = toIntPath(orientRing(a, 'ccw'));
  const pb = toIntPath(orientRing(b, 'ccw'));
  const sweep = ClipperLib.Clipper.MinkowskiSum(pb, pa, true);
  const b0 = pb[0]!;
  const shifted = pa.map((p) => ({ X: p.X + b0.X, Y: p.Y + b0.Y }));
  const c = new ClipperLib.Clipper();
  c.AddPaths(sweep, ClipperLib.PolyType.ptSubject, true);
  c.AddPath(shifted, ClipperLib.PolyType.ptSubject, true);
  const tree = new ClipperLib.PolyTree();
  c.Execute(
    ClipperLib.ClipType.ctUnion,
    tree,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  );
  return treeToPolygons(tree);
}

/** Plocha polygonů s otvory v mm². */
export function polygonsArea(polys: readonly Polygon[]): number {
  return polys.reduce(
    (s, p) => s + ringArea(p.outer) - p.holes.reduce((h, r) => h + ringArea(r), 0),
    0,
  );
}

/** Bod uvnitř (1), na hranici (−1) nebo vně (0) obrysu – přesně v celých číslech. */
export function pointInIntRing(p: Point, ring: Ring): number {
  return ClipperLib.Clipper.PointInPolygon(
    { X: Math.round(p.x * CLIPPER_SCALE), Y: Math.round(p.y * CLIPPER_SCALE) },
    toIntPath(ring),
  );
}
