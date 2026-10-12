import type { Point } from '../../../src/core/geometry/types.ts';

/** Dvojice kód–hodnota DXF. */
export type G = readonly [number, string | number];

/** Entita jako dvojice kód–hodnota (vrstva DIL, pokud není zadána). */
export const ent = (type: string, ...groups: G[]): G[] =>
  groups.some((g) => g[0] === 8) ? [[0, type], ...groups] : [[0, type], [8, 'DIL'], ...groups];

/** Minimální DXF: hlavička s jednotkami, bloky a entity. */
export function dxf(opts: {
  insunits?: number | null;
  blocks?: { name: string; base?: Point; type?: number; entities: G[][] }[];
  /** Vrstvy: příznak 1 = zamrzlá, záporná barva = vypnutá. */
  layers?: { name: string; flags?: number; color?: number }[];
  entities: G[][];
}): string {
  const g: G[] = [
    [0, 'SECTION'],
    [2, 'HEADER'],
    [9, '$ACADVER'],
    [1, 'AC1015'],
  ];
  if (opts.insunits !== null) g.push([9, '$INSUNITS'], [70, opts.insunits ?? 4]);
  g.push([0, 'ENDSEC']);
  if (opts.layers) {
    g.push([0, 'SECTION'], [2, 'TABLES'], [0, 'TABLE'], [2, 'LAYER'], [70, opts.layers.length]);
    for (const l of opts.layers) {
      g.push([0, 'LAYER'], [2, l.name], [70, l.flags ?? 0], [62, l.color ?? 7], [6, 'CONTINUOUS']);
    }
    g.push([0, 'ENDTAB'], [0, 'ENDSEC']);
  }
  g.push([0, 'SECTION'], [2, 'BLOCKS']);
  for (const b of opts.blocks ?? []) {
    g.push(
      [0, 'BLOCK'],
      [8, '0'],
      [2, b.name],
      [70, b.type ?? 0],
      [10, b.base?.x ?? 0],
      [20, b.base?.y ?? 0],
      [30, 0],
      [3, b.name],
    );
    for (const e of b.entities) g.push(...e);
    g.push([0, 'ENDBLK'], [8, '0']);
  }
  g.push([0, 'ENDSEC'], [0, 'SECTION'], [2, 'ENTITIES']);
  for (const e of opts.entities) g.push(...e);
  g.push([0, 'ENDSEC'], [0, 'EOF']);
  return g.map(([c, v]) => `${c}\n${v}`).join('\n') + '\n';
}

export const line = (x1: number, y1: number, x2: number, y2: number, ...extra: G[]) =>
  ent('LINE', [10, x1], [20, y1], [30, 0], [11, x2], [21, y2], [31, 0], ...extra);
export const arc = (cx: number, cy: number, r: number, a0: number, a1: number, ...extra: G[]) =>
  ent('ARC', [10, cx], [20, cy], [30, 0], [40, r], [50, a0], [51, a1], ...extra);
export const circle = (cx: number, cy: number, r: number, ...extra: G[]) =>
  ent('CIRCLE', [10, cx], [20, cy], [30, 0], [40, r], ...extra);

/** Uzavřená LWPOLYLINE z bodů [x, y, bulge?]. */
export function lwpoly(
  points: readonly (readonly [number, number, number?])[],
  ...extra: G[]
): G[] {
  const g: G[] = [
    [90, points.length],
    [70, 1],
  ];
  for (const [x, y, b] of points) {
    g.push([10, x], [20, y]);
    if (b) g.push([42, b]);
  }
  return ent('LWPOLYLINE', ...extra, ...g);
}

/** Obdélník jako uzavřená LWPOLYLINE. */
export const rectPoly = (x: number, y: number, w: number, h: number, ...extra: G[]) =>
  lwpoly(
    [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ],
    ...extra,
  );
