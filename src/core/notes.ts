import { rotatePoint } from './geometry/transform.ts';
import type { Point } from './geometry/types.ts';
import type { PartNote } from './model.ts';

/** Průměrná šířka znaku jako podíl výšky písma (bez metrik skutečného písma). */
export const NOTE_CHAR_WIDTH = 0.6;

/** Dotahy (g, p, y) pod účařím jako podíl výšky velkých písmen. */
export const NOTE_DESCENT = 0.3;

/**
 * Odhadnutý obdélník textu (4 rohy) – šířka podle počtu znaků, výška od účaří
 * po výšku velkých písmen (u zarovnání dole včetně dotahů). Slouží
 * k rozhodnutí, ve kterém dílu text leží.
 */
export function noteCorners(n: Omit<PartNote, 'layer'>): Point[] {
  const w = [...n.text].length * NOTE_CHAR_WIDTH * n.height * n.widthFactor;
  const h = n.height;
  let x0 = n.halign === 0 ? 0 : n.halign === 1 ? -w / 2 : -w;
  if (n.backwards) x0 = -x0 - w;
  const y0 = n.valign === 2 ? -h / 2 : n.valign === 3 ? -h : 0;
  const y1 = n.valign === 1 ? (1 + NOTE_DESCENT) * h : y0 + h;
  return [
    { x: x0, y: y0 },
    { x: x0 + w, y: y0 },
    { x: x0 + w, y: y1 },
    { x: x0, y: y1 },
  ].map((p) => {
    const r = rotatePoint(p, n.rotation);
    return { x: r.x + n.at.x, y: r.y + n.at.y };
  });
}

/** Poznámka umístěná s dílem: p' = R·p + (x, y), natočení se přičte. */
export function placeNote(n: PartNote, rotation: number, x: number, y: number): PartNote {
  const r = rotatePoint(n.at, rotation);
  return {
    ...n,
    at: { x: r.x + x, y: r.y + y },
    rotation: (((n.rotation + rotation) % 360) + 360) % 360,
  };
}
