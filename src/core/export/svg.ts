import { bulgeToArc } from '../geometry/contour.ts';
import type { Contour, Rect, Ring } from '../geometry/types.ts';
import type { NestingInput, NestingResult, Part, Sheet, SheetLayout } from '../model.ts';
import { labelSize, placedContours, placePart, type PlacedPart } from '../placed.ts';
import { sheetFileName, type ExportFile } from './files.ts';

/** Barva dílu podle pořadí v zadání – zlatý úhel rozprostře odstíny rovnoměrně. */
export function partColor(index: number): string {
  return `hsl(${((index * 137.508) % 360).toFixed(1)} 65% 72%)`;
}

/** Barvy všech dílů podle ID – stejné v náhledu, SVG i tisku. */
export function partColors(parts: readonly Part[]): Map<string, string> {
  return new Map(parts.map((p, i) => [p.id, partColor(i)]));
}

/** Číslo pro SVG: nejvýš 3 desetinná místa (µm), bez exponentu a „-0". */
export function svgNumber(n: number): string {
  if (!Number.isFinite(n)) throw new RangeError(`Neplatné číslo pro SVG: ${n}`);
  const s = n.toFixed(3).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

export function xmlEscape(text: string): string {
  return (
    text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
      // Řídicí znaky XML 1.0 nepovoluje (soubor by nešel otevřít).
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
  );
}

/**
 * SVG cesta obrysu v souřadnicích modelu (osa Y nahoru – převrací ji až
 * transformace skupiny). Oblouky jako příkaz `A`: příznak sweep = 1 pro CCW
 * (kladný bulge), large-arc pro středový úhel nad 180°.
 */
export function contourPath(contour: Contour): string {
  const n = contour.length;
  if (n === 0) return '';
  const f = svgNumber;
  const first = contour[0]!;
  let d = `M${f(first.x)} ${f(first.y)}`;
  for (let i = 0; i < n; i++) {
    const v = contour[i]!;
    const next = contour[(i + 1) % n]!;
    const arc = bulgeToArc(v, next, v.bulge);
    if (arc) {
      const large = Math.abs(arc.sweep) > 180 ? 1 : 0;
      const sweep = arc.sweep > 0 ? 1 : 0;
      d += `A${f(arc.radius)} ${f(arc.radius)} 0 ${large} ${sweep} ${f(next.x)} ${f(next.y)}`;
    } else if (i < n - 1) {
      d += `L${f(next.x)} ${f(next.y)}`;
    }
  }
  return `${d}Z`;
}

/** SVG cesta lomeného obrysu (např. zakázané zóny). */
export function ringPath(ring: Ring): string {
  return contourPath(ring.map((p) => ({ x: p.x, y: p.y, bulge: 0 })));
}

/**
 * Velikost popisku v mm podle obalového obdélníku a délky názvu (bez ohledu
 * na tvar – pro umístěný díl použijte `labelSize` z placed.ts).
 */
export function labelFontSize(bbox: Rect, name: string): number {
  return Math.min(bbox.height * 0.4, (bbox.width / Math.max(3, name.length)) * 1.6);
}

export interface SheetSvgOptions {
  /** Popisky dílů (výchozí ano). */
  readonly labels?: boolean;
  /** Zbytek tabule k vyznačení. */
  readonly remnant?: Rect | null;
  /** Barvy dílů podle ID; chybí-li, podle pořadí v `parts`. */
  readonly colors?: ReadonlyMap<string, string>;
  /** Předpona ID prvků, když je na stránce víc SVG (tisk). */
  readonly idPrefix?: string;
}

/** Umístěný díl s SVG cestou skutečného obrysu (otvory, oblouky). */
export interface PlacedPartPath {
  readonly placed: PlacedPart;
  /** Vnější obrys a otvory v jedné cestě (vykreslit s fill-rule evenodd). */
  readonly path: string;
}

/** Umístěné díly s cestami obrysů; neznámé ID dílu vyhodí `RangeError`. */
export function placedPartPaths(parts: readonly Part[], layout: SheetLayout): PlacedPartPath[] {
  const byId = new Map(parts.map((p) => [p.id, p]));
  return layout.placements.map((placement) => {
    const part = byId.get(placement.partId);
    if (!part) throw new RangeError(`Umístění odkazuje na neznámý díl „${placement.partId}".`);
    const placed: PlacedPart = placePart(part, placement);
    const { outer, holes } = placedContours(part, placement);
    return { placed, path: [outer, ...holes].map(contourPath).join('') };
  });
}

/**
 * Jedna tabule jako samostatné SVG: rozměry v mm, počátek vlevo dole (osa Y
 * převrácená transformací skupiny, popisky mimo ni, aby nebyly zrcadlově).
 */
export function writeSheetSvg(
  sheet: Sheet,
  layout: SheetLayout,
  parts: readonly Part[],
  opts: SheetSvgOptions = {},
): string {
  const f = svgNumber;
  const W = sheet.width;
  const H = sheet.height;
  const stroke = Math.max(W, H) / 1500;
  const hatch = Math.max(W, H) / 120;
  const id = `${opts.idPrefix ?? ''}zona`;
  const colors = opts.colors ?? partColors(parts);
  const items = placedPartPaths(parts, layout);
  const out: string[] = [];

  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f(W)}mm" height="${f(H)}mm" viewBox="0 0 ${f(W)} ${f(H)}">`,
    `<title>${xmlEscape(sheet.name)}</title>`,
    `<defs><pattern id="${id}" patternUnits="userSpaceOnUse" width="${f(hatch)}" height="${f(hatch)}" patternTransform="rotate(45)">` +
      `<rect width="${f(hatch)}" height="${f(hatch)}" fill="#fde2e1"/>` +
      `<line x1="0" y1="0" x2="0" y2="${f(hatch)}" stroke="#d1242f" stroke-width="${f(stroke * 2)}"/></pattern></defs>`,
    `<g transform="matrix(1 0 0 -1 0 ${f(H)})" stroke-width="${f(stroke)}">`,
    `<rect x="0" y="0" width="${f(W)}" height="${f(H)}" fill="#ffffff" stroke="#57606a"/>`,
  );
  const m = sheet.margin;
  if (m > 0 && 2 * m < Math.min(W, H)) {
    out.push(
      `<rect x="${f(m)}" y="${f(m)}" width="${f(W - 2 * m)}" height="${f(H - 2 * m)}" fill="none" stroke="#8c959f" stroke-dasharray="${f(stroke * 6)} ${f(stroke * 4)}"/>`,
    );
  }
  for (const z of sheet.forbiddenZones) {
    out.push(`<path d="${ringPath(z.polygon)}" fill="url(#${id})" stroke="#d1242f"/>`);
  }
  const r = opts.remnant;
  if (r) {
    out.push(
      `<rect x="${f(r.x)}" y="${f(r.y)}" width="${f(r.width)}" height="${f(r.height)}" fill="#dafbe1" fill-opacity="0.6" stroke="#1a7f37" stroke-dasharray="${f(stroke * 8)} ${f(stroke * 4)}"/>`,
    );
  }
  for (const { placed, path } of items) {
    const fill = colors.get(placed.part.id) ?? '#cccccc';
    out.push(`<path d="${path}" fill="${fill}" fill-rule="evenodd" stroke="#24292f"/>`);
  }
  out.push('</g>');
  if (opts.labels !== false) {
    out.push(
      `<g font-family="sans-serif" text-anchor="middle" dominant-baseline="central" fill="#1f2328">`,
    );
    for (const { placed } of items) {
      const size = labelSize(placed);
      if (!(size > 0)) continue;
      out.push(
        `<text x="${f(placed.labelAt.x)}" y="${f(H - placed.labelAt.y)}" font-size="${f(size)}">${xmlEscape(placed.part.name)}</text>`,
      );
    }
    if (r) {
      const size = Math.min(r.height * 0.15, r.width / 12);
      if (size > 0) {
        const label = `zbytek ${Math.round(r.width)} × ${Math.round(r.height)}`;
        out.push(
          `<text x="${f(r.x + r.width / 2)}" y="${f(H - r.y - r.height / 2)}" font-size="${f(size)}" fill="#1a7f37">${label}</text>`,
        );
      }
    }
    out.push('</g>');
  }
  out.push('</svg>');
  return out.join('\n');
}

/** Všechny tabule výsledku jako SVG soubory (zbytky vyznačené). */
export function writeResultSvg(
  input: NestingInput,
  result: NestingResult,
  project: string,
): ExportFile[] {
  const sheets = new Map(input.sheets.map((s) => [s.id, s]));
  const colors = partColors(input.parts);
  return result.layouts.map((layout, i) => {
    const sheet = sheets.get(layout.sheetId);
    if (!sheet) throw new RangeError(`Rozložení odkazuje na neznámou tabuli „${layout.sheetId}".`);
    return {
      name: sheetFileName(project, i, result.layouts.length, 'svg'),
      content: `<?xml version="1.0" encoding="UTF-8"?>\n${writeSheetSvg(
        sheet,
        layout,
        input.parts,
        {
          colors,
          remnant: result.metrics.sheets[i]?.remnant ?? null,
        },
      )}\n`,
    };
  });
}
