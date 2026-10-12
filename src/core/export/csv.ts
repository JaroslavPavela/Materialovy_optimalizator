import {
  normalizeRotation,
  UNPLACED_REASON_LABEL,
  type NestingInput,
  type NestingResult,
  type UnplacedReason,
} from '../model.ts';

/** Hlavička výstupního CSV. */
export const RESULT_CSV_HEADER = [
  'tabule',
  'formát',
  'díl',
  'počet',
  'šířka',
  'výška',
  'rotace',
] as const;

const SEP = ';';
const CRLF = '\r\n';
const BOM = '﻿';

/** Číslo s desetinnou čárkou, nejvýš 3 desetinná místa, bez „-0". */
export function csvNumber(n: number): string {
  const s = n.toFixed(3).replace(/\.?0+$/, '');
  return (s === '-0' ? '0' : s).replace('.', ',');
}

/** Podíl 0–1 jako procenta s jedním desetinným místem („75,9 %"). */
export function csvPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1).replace('.', ',')} %`;
}

/**
 * Textové pole: v uvozovkách, obsahuje-li oddělovač, uvozovky nebo konec
 * řádku. Text začínající =, +, -, @ dostane apostrof, aby ho Excel
 * nevyhodnotil jako vzorec.
 */
export function csvText(text: string): string {
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[;"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const row = (cells: readonly string[]) => cells.join(SEP);

/**
 * Seznam umístěných dílů po tabulích (díly se stejným natočením sečtené),
 * pak prázdný řádek, souhrnný řádek a neumístěné díly s důvodem.
 * UTF-8 s BOM, středník, desetinná čárka, CRLF – otevře se v českém Excelu.
 */
export function writeResultCsv(input: NestingInput, result: NestingResult): string {
  const parts = new Map(input.parts.map((p) => [p.id, p]));
  const sheets = new Map(input.sheets.map((s) => [s.id, s]));
  const lines: string[] = [row(RESULT_CSV_HEADER)];

  result.layouts.forEach((layout, i) => {
    const sheet = sheets.get(layout.sheetId);
    if (!sheet) throw new RangeError(`Rozložení odkazuje na neznámou tabuli „${layout.sheetId}".`);
    // Pořadí dílů podle prvního výskytu na tabuli.
    const groups = new Map<string, { partId: string; rotation: number; count: number }>();
    for (const p of layout.placements) {
      const rotation = normalizeRotation(p.rotation);
      const key = `${p.partId}\u0000${rotation.toFixed(6)}`;
      const g = groups.get(key);
      if (g) g.count++;
      else groups.set(key, { partId: p.partId, rotation, count: 1 });
    }
    for (const g of groups.values()) {
      const part = parts.get(g.partId);
      if (!part) throw new RangeError(`Umístění odkazuje na neznámý díl „${g.partId}".`);
      lines.push(
        row([
          String(i + 1),
          csvText(sheet.name),
          csvText(part.name),
          String(g.count),
          csvNumber(part.width),
          csvNumber(part.height),
          csvNumber(g.rotation),
        ]),
      );
    }
  });

  const m = result.metrics;
  lines.push(
    '',
    row(['souhrn', 'tabulí', 'využití', 'umístěno', 'neumístěno', 'odpad', '']),
    row([
      '',
      String(result.layouts.length),
      csvPercent(m.utilization),
      String(m.placedCount),
      String(m.unplacedCount),
      csvPercent(m.waste),
      '',
    ]),
  );

  if (result.unplaced.length > 0) {
    const groups = new Map<string, { partId: string; reason: UnplacedReason; count: number }>();
    for (const u of result.unplaced) {
      const key = `${u.partId}\u0000${u.reason}`;
      const g = groups.get(key);
      if (g) g.count++;
      else groups.set(key, { partId: u.partId, reason: u.reason, count: 1 });
    }
    lines.push('', row(['neumístěno', 'důvod', 'díl', 'počet', 'šířka', 'výška', '']));
    for (const g of groups.values()) {
      const part = parts.get(g.partId);
      lines.push(
        row([
          '',
          csvText(UNPLACED_REASON_LABEL[g.reason]),
          csvText(part?.name ?? g.partId),
          String(g.count),
          part ? csvNumber(part.width) : '',
          part ? csvNumber(part.height) : '',
          '',
        ]),
      );
    }
  }
  return BOM + lines.join(CRLF) + CRLF;
}
