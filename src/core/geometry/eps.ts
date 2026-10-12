/**
 * Tolerance pro porovnání délek a souřadnic v mm (1 µm).
 * Musí být řádově větší než kvantizace Clipperu (0,5 / CLIPPER_SCALE mm),
 * viz docs/rozhodnuti/001-tolerance-a-umisteni.md.
 */
export const EPS = 1e-3;

/** Tolerance pro plochy v mm² (EPS²). */
export const AREA_EPS = EPS * EPS;

/** Tolerance pro porovnání úhlů ve stupních. */
export const ANGLE_EPS = 1e-9;

/** Měřítko převodu mm → celá čísla pro Clipper (1 jednotka = 0,1 µm). */
export const CLIPPER_SCALE = 1e4;

/** Dvě čísla se liší nejvýš o `eps`. */
export function nearlyEqual(a: number, b: number, eps: number = EPS): boolean {
  return Math.abs(a - b) <= eps;
}
