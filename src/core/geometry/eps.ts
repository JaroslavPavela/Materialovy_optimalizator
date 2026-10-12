/** Tolerance pro porovnání délek a souřadnic v mm. */
export const EPS = 1e-6;

/** Tolerance pro porovnání úhlů ve stupních. */
export const ANGLE_EPS = 1e-9;

/** Dvě čísla se liší nejvýš o `eps`. */
export function nearlyEqual(a: number, b: number, eps: number = EPS): boolean {
  return Math.abs(a - b) <= eps;
}
