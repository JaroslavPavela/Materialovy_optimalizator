import Papa from 'papaparse';
import type { Part, RotationMode } from '../model.ts';

/** Chyba nebo varování importu; `row` = číslo řádku v souboru (1 = první řádek). */
export interface CsvIssue {
  readonly row: number;
  readonly column?: ColumnKey;
  readonly message: string;
}

export type CsvEncoding = 'utf-8' | 'utf-8-bom' | 'windows-1250' | 'utf-16le' | 'utf-16be';
export type CsvDelimiter = ';' | ',' | '\t';

export interface CsvImportResult {
  readonly parts: Part[];
  readonly errors: CsvIssue[];
  readonly warnings: CsvIssue[];
  readonly encoding: CsvEncoding;
  readonly delimiter: CsvDelimiter;
}

export interface CsvImportOptions {
  /** Předpona ID dílů; ID = `${idPrefix}-${řádek}`. Výchozí `csv`. */
  readonly idPrefix?: string;
}

export type ColumnKey = 'nazev' | 'sirka' | 'vyska' | 'pocet' | 'material' | 'tloustka' | 'rotace';

const REQUIRED: readonly ColumnKey[] = ['nazev', 'sirka', 'vyska', 'pocet'];
const HEADERLESS_ORDER: readonly ColumnKey[] = [
  'nazev',
  'sirka',
  'vyska',
  'pocet',
  'material',
  'tloustka',
  'rotace',
];

const COLUMN_LABEL: Readonly<Record<ColumnKey, string>> = {
  nazev: 'název',
  sirka: 'šířka',
  vyska: 'výška',
  pocet: 'počet',
  material: 'materiál',
  tloustka: 'tloušťka',
  rotace: 'rotace',
};

const HEADER_ALIASES: Readonly<Record<string, ColumnKey>> = {
  nazev: 'nazev',
  dil: 'nazev',
  popis: 'nazev',
  oznaceni: 'nazev',
  name: 'nazev',
  part: 'nazev',
  description: 'nazev',
  sirka: 'sirka',
  width: 'sirka',
  vyska: 'vyska',
  height: 'vyska',
  pocet: 'pocet',
  ks: 'pocet',
  kusu: 'pocet',
  mnozstvi: 'pocet',
  qty: 'pocet',
  quantity: 'pocet',
  count: 'pocet',
  pcs: 'pocet',
  material: 'material',
  tloustka: 'tloustka',
  tl: 'tloustka',
  thickness: 'tloustka',
  rotace: 'rotace',
  otaceni: 'rotace',
  natoceni: 'rotace',
  rotation: 'rotace',
};

const ROTATION_VALUES: Readonly<Record<string, RotationMode>> = {
  volne: 'free',
  volna: 'free',
  free: 'free',
  '90': 'ortho',
  ortho: 'ortho',
  '180': 'flip',
  flip: 'flip',
  zadna: 'locked',
  zadne: 'locked',
  ne: 'locked',
  '0': 'locked',
  locked: 'locked',
  none: 'locked',
};

const DEFAULT_ROTATION: RotationMode = 'ortho';
const LARGE_QUANTITY = 10_000;

/** Malá písmena bez diakritiky a bez okrajových mezer. */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

/** Název sloupce hlavičky → klíč; jednotky v závorkách a ne-alfanumerické znaky se ignorují. */
export function matchHeader(cell: string): ColumnKey | null {
  const key = fold(cell)
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/[^a-z0-9]/g, '');
  return HEADER_ALIASES[key] ?? null;
}

/** Dekóduje bajty souboru: BOM → UTF-8/UTF-16, jinak UTF-8, při chybě Windows-1250. */
export function decodeCsv(bytes: Uint8Array): { text: string; encoding: CsvEncoding } {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(b.subarray(3)), encoding: 'utf-8-bom' };
  }
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(b.subarray(2)), encoding: 'utf-16le' };
  }
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(b.subarray(2)), encoding: 'utf-16be' };
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(b), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1250').decode(b), encoding: 'windows-1250' };
  }
}

const CANDIDATES: readonly CsvDelimiter[] = [';', '\t', ','];

/**
 * Oddělovač z prvních (až 5) neprázdných řádků: kandidát se shodným počtem
 * sloupců > 1 na všech řádcích; při shodě více kandidátů ten s více sloupci,
 * pak v pořadí ; tab ,. Když žádný není konzistentní, ten s nejvíc sloupci.
 */
export function detectDelimiter(text: string): CsvDelimiter {
  const sample = text
    .split(/\r\n|\r|\n/)
    .filter((l) => l.trim() !== '')
    .slice(0, 5)
    .join('\n');
  let best: { d: CsvDelimiter; consistent: boolean; cols: number } | null = null;
  for (const d of CANDIDATES) {
    const rows = Papa.parse<string[]>(sample, { delimiter: d }).data;
    const counts = rows.map((r) => r.length);
    const cols = Math.min(...counts);
    const consistent = cols > 1 && counts.every((c) => c === counts[0]);
    const better =
      !best ||
      (consistent && !best.consistent) ||
      (consistent === best.consistent && cols > best.cols);
    if (better) best = { d, consistent, cols };
  }
  return best && best.cols > 1 ? best.d : ';';
}

/** Výsledek čtení čísla: hodnota, chybějící hodnota, nebo neplatný text. */
type NumberParse = { ok: true; value: number } | { ok: false; empty: boolean };

/** Číslo s desetinnou čárkou nebo tečkou a mezerami jako oddělovačem tisíců. */
export function parseNumber(raw: string): NumberParse {
  const t = raw.replace(/[\s\u00a0\u202f]/g, '');
  if (t === '') return { ok: false, empty: true };
  if (t.includes(',') && t.includes('.')) return { ok: false, empty: false };
  const normalized = t.replace(',', '.');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(normalized)) return { ok: false, empty: false };
  return { ok: true, value: Number(normalized) };
}

/** Začátky řádků v textu (indexy znaků), pro převod pozice na číslo řádku. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 10) starts.push(i + 1);
    else if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) i++;
      starts.push(i + 1);
    }
  }
  return starts;
}

function lineOf(starts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** Řádky CSV s číslem řádku v souboru, kde záznam začíná; prázdné řádky vynechány. */
function readRecords(text: string, delimiter: CsvDelimiter): { line: number; cells: string[] }[] {
  const starts = lineStarts(text);
  const records: { line: number; cells: string[] }[] = [];
  let cursor = 0;
  Papa.parse<string[]>(text, {
    delimiter,
    skipEmptyLines: false,
    step: (results) => {
      const start = cursor;
      cursor = results.meta.cursor;
      const cells = results.data;
      if (cells.every((c) => c.trim() === '')) return;
      // Papa vrací cursor za oddělovačem řádku; začátek záznamu = konec předchozího.
      let s = start;
      while (s < text.length && (text[s] === '\n' || text[s] === '\r')) s++;
      records.push({ line: lineOf(starts, s), cells });
    },
  });
  return records;
}

/**
 * Načte díly z CSV. Nikdy nevyhazuje výjimku kvůli datům: chybné řádky
 * přeskočí a nahlásí v `errors`, ostatní vrátí v `parts`.
 */
export function parsePartsCsv(
  data: Uint8Array | ArrayBuffer,
  options: CsvImportOptions = {},
): CsvImportResult {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const { text, encoding } = decodeCsv(bytes);
  const delimiter = detectDelimiter(text);
  const idPrefix = options.idPrefix ?? 'csv';
  const parts: Part[] = [];
  const errors: CsvIssue[] = [];
  const warnings: CsvIssue[] = [];
  const result = () => ({ parts, errors, warnings, encoding, delimiter });

  const records = readRecords(text, delimiter);
  const first = records[0];
  if (!first) {
    errors.push({ row: 1, message: 'Soubor neobsahuje žádné díly.' });
    return result();
  }

  // Mapování sloupců: z hlavičky, nebo pevné pořadí u souboru bez hlavičky.
  const columns = new Map<ColumnKey, number>();
  let dataRecords = records;
  const headerKeys = first.cells.map(matchHeader);
  // Hlavička = aspoň dva poznané sloupce, nebo jeden a za ním nejsou čísla
  // (soubor bez hlavičky, jehož první díl se jmenuje „Díl", „Popis"…).
  const known = headerKeys.filter((k) => k !== null).length;
  const numbersFollow =
    first.cells.length >= 4 && first.cells.slice(1, 4).every((c) => parseNumber(c).ok);
  if (known >= 2 || (known === 1 && !numbersFollow)) {
    dataRecords = records.slice(1);
    headerKeys.forEach((key, i) => {
      const cell = first.cells[i]!.trim();
      if (key === null) {
        if (cell !== '') {
          warnings.push({ row: first.line, message: `Neznámý sloupec „${cell}" se ignoruje.` });
        }
      } else if (columns.has(key)) {
        warnings.push({
          row: first.line,
          column: key,
          message: `Sloupec „${COLUMN_LABEL[key]}" je v hlavičce víckrát, použije se první.`,
        });
      } else {
        columns.set(key, i);
      }
    });
    const missing = REQUIRED.filter((k) => !columns.has(k));
    if (missing.length > 0) {
      const names = missing.map((k) => `„${COLUMN_LABEL[k]}"`).join(', ');
      errors.push({
        row: first.line,
        message: `V hlavičce chybí povinný sloupec ${names}.`,
      });
      return result();
    }
  } else {
    const numeric = [1, 2, 3].every((i) => {
      const cell = first.cells[i];
      return cell !== undefined && parseNumber(cell).ok;
    });
    if (!numeric) {
      errors.push({
        row: first.line,
        message:
          'Nerozpoznaná hlavička. Očekávají se sloupce název, šířka, výška, počet ' +
          '(nebo soubor bez hlavičky s čísly ve 2.–4. sloupci).',
      });
      return result();
    }
    HEADERLESS_ORDER.forEach((key, i) => columns.set(key, i));
  }

  for (const { line, cells } of dataRecords) {
    const rowErrors: CsvIssue[] = [];
    const cell = (key: ColumnKey) => {
      const i = columns.get(key);
      return i === undefined ? '' : (cells[i] ?? '').trim();
    };
    const fail = (column: ColumnKey, message: string) =>
      rowErrors.push({ row: line, column, message: `Řádek ${line}: ${message}` });

    const number = (key: ColumnKey, required: boolean): number | undefined => {
      const raw = cell(key);
      const parsed = parseNumber(raw);
      if (!parsed.ok) {
        if (parsed.empty) {
          if (required) fail(key, `chybí ${COLUMN_LABEL[key]}.`);
        } else {
          fail(key, `${COLUMN_LABEL[key]} „${raw}" není číslo.`);
        }
        return undefined;
      }
      if (!(parsed.value > 0)) {
        fail(key, `${COLUMN_LABEL[key]} musí být větší než 0 (je ${raw}).`);
        return undefined;
      }
      return parsed.value;
    };

    const name = cell('nazev');
    if (name === '') fail('nazev', 'chybí název.');
    const width = number('sirka', true);
    const height = number('vyska', true);
    const quantity = number('pocet', true);
    if (quantity !== undefined && !Number.isInteger(quantity)) {
      fail('pocet', `počet „${cell('pocet')}" není celé číslo.`);
    }
    const thickness = number('tloustka', false);
    const material = cell('material');

    let rotation = DEFAULT_ROTATION;
    const rawRotation = cell('rotace');
    if (rawRotation !== '') {
      const mode = ROTATION_VALUES[fold(rawRotation).replace(/\s|°/g, '')];
      if (mode) rotation = mode;
      else {
        fail('rotace', `rotace „${rawRotation}" není platná (povoleno: volne, 90, 180, zadna).`);
      }
    }

    if (rowErrors.length > 0 || width === undefined || height === undefined || !quantity) {
      errors.push(...rowErrors);
      continue;
    }
    if (quantity > LARGE_QUANTITY) {
      warnings.push({
        row: line,
        column: 'pocet',
        message: `Řádek ${line}: neobvykle velký počet kusů (${quantity}).`,
      });
    }
    parts.push({
      id: `${idPrefix}-${line}`,
      name,
      width,
      height,
      quantity,
      rotation,
      ...(material !== '' ? { material } : {}),
      ...(thickness !== undefined ? { thickness } : {}),
    });
  }

  if (parts.length === 0 && errors.length === 0) {
    errors.push({ row: first.line, message: 'Soubor neobsahuje žádné díly.' });
  }
  return result();
}
