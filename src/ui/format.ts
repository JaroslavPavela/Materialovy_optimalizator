/** Číslo v českém formátu (desetinná čárka, mezera mezi tisíci). */
export function formatNumber(n: number, digits = 1): string {
  return n.toLocaleString('cs-CZ', { maximumFractionDigits: digits });
}

/** Podíl 0…1 jako procenta s jedním desetinným místem. */
export function formatPercent(ratio: number): string {
  return `${(ratio * 100).toLocaleString('cs-CZ', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} %`;
}

/** Plocha v mm² jako m². */
export function formatArea(mm2: number): string {
  return `${formatNumber(mm2 / 1e6, 2)} m²`;
}

/** Barva dílu podle jeho pořadí – zlatý úhel rozprostře odstíny rovnoměrně. */
export function partColor(index: number): string {
  return `hsl(${((index * 137.508) % 360).toFixed(1)} 65% 72%)`;
}
