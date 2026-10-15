/**
 * Rozpoznání DWG podle hlavičky – bez knihovny pro čtení DWG, aby se ta
 * načítala jen u souborů, které DWG opravdu jsou.
 */

/** Verze DWG, které umí přečíst acad-ts (kód hlavičky → verze AutoCADu). */
export const DWG_SUPPORTED: Readonly<Record<string, string>> = {
  AC1014: 'R14',
  AC1015: '2000',
  AC1018: '2004',
  AC1021: '2007',
  AC1024: '2010',
  AC1027: '2013',
  AC1032: '2018',
};

/** Starší verze, které se nečtou (kód hlavičky → verze AutoCADu). */
const DWG_OLD: Readonly<Record<string, string>> = {
  AC1012: 'R13',
  AC1009: 'R11/R12',
  AC1006: 'R10',
  AC1004: 'R9',
  AC1003: '2.6',
  AC1002: '2.5',
  'AC2.10': '2.10',
  'AC1.50': '2.0',
  'AC1.40': '1.40',
};

const toBytes = (data: ArrayBuffer | Uint8Array) =>
  data instanceof Uint8Array ? data : new Uint8Array(data);

/**
 * Kód verze z hlavičky DWG (např. `AC1032`), nebo `null`, není-li soubor DWG.
 * Textové DXF začíná skupinovým kódem (číslem), binární „AutoCAD Binary DXF".
 */
export function dwgVersionCode(data: string | ArrayBuffer | Uint8Array): string | null {
  if (typeof data === 'string') return null;
  const head = String.fromCharCode(...toBytes(data).subarray(0, 6));
  return /^AC(\d{4}|[12]\.\d{2})$/.test(head) ? head : null;
}

/** Název verze AutoCADu pro hlášení (`AutoCAD 2018`, `AutoCAD R14`…). */
export function dwgVersionName(code: string): string {
  const v = DWG_SUPPORTED[code] ?? DWG_OLD[code];
  return v ? `AutoCAD ${v}` : code;
}
