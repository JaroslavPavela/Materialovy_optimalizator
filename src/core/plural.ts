/** Tvar slova podle počtu: 1 díl, 2–4 díly, jinak dílů. */
export function plural(n: number, one: string, few: string, many: string): string {
  return n === 1 ? one : n >= 2 && n <= 4 ? few : many;
}
