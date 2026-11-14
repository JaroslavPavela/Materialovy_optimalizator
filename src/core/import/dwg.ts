import {
  DwgReader,
  DxfWriter,
  NotificationType,
  type NotificationEventArgs,
} from '@node-projects/acad-ts';
import { partsFromDxf, type DxfPartsOptions, type DxfPartsResult } from './dxf-parts.ts';
import { DWG_SUPPORTED, dwgVersionCode, dwgVersionName } from './dwg-format.ts';

export type DwgToDxfResult =
  | { readonly ok: true; readonly text: string; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly error: string };

const SAVE_AS_DXF = 'uložte výkres v CADu jako DXF';

/** Strop přidaných prvků polí při čtení DWG: základ + na bajt souboru. */
const PUSH_BASE = 1_000_000;
const PUSH_PER_BYTE = 2;

/**
 * Spustí `run` se stropem počtu `Array.prototype.push`. Čtečka DWG u poškozené
 * hlavičky (nesmyslný posun stránky) plní pole v nekonečné smyčce, dokud
 * vláknu nedojde paměť – a tu chybu zachytit nejde. Správný výkres má přidání
 * řádově setiny bajtů souboru. Běží synchronně; po návratu je `push` původní.
 */
function withPushLimit<T>(limit: number, run: () => T): T {
  const proto = Array.prototype as { push: (...items: unknown[]) => number };
  const original = proto.push;
  let count = 0;
  proto.push = function (this: unknown[], ...items: unknown[]) {
    if (++count > limit) throw new Error('DWG: překročen strop velikosti dat');
    return original.apply(this, items);
  };
  try {
    return run();
  } finally {
    proto.push = original;
  }
}

/**
 * DWG R13–R2000 (AC1012–AC1015) má v hlavičce od bajtu 0x15 počet sekcí
 * a pro každou číslo (1 bajt), posun a délku (2 × int32 LE). U useknutého
 * souboru míří sekce za jeho konec a čtečka se na něm zacyklí – bez přidávání
 * do polí, takže strop `withPushLimit` nezabere. Novější verze mají stránky
 * s kontrolou a useknutí skončí chybou samo.
 */
function sectionsInFile(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 0x19) return false;
  const count = view.getInt32(0x15, true);
  if (count < 1 || count > 64 || 0x19 + count * 9 > bytes.length) return false;
  for (let i = 0; i < count; i++) {
    const at = 0x19 + i * 9;
    const seeker = view.getInt32(at + 1, true);
    const size = view.getInt32(at + 5, true);
    if (seeker < 0 || size < 0 || seeker + size > bytes.length) return false;
  }
  return true;
}

const LOCATOR_VERSIONS = new Set(['AC1012', 'AC1014', 'AC1015']);

/**
 * Převede DWG na ASCII DXF (acad-ts). Geometrii pak čte stejná cesta jako
 * DXF (`readDxf`) – jednotky, bloky, oblouky, splajny i hlášení jsou společné.
 */
export function dwgToDxf(data: ArrayBuffer | Uint8Array): DwgToDxfResult {
  const code = dwgVersionCode(data);
  if (!code) return { ok: false, error: 'Soubor není výkres DWG.' };
  if (!DWG_SUPPORTED[code]) {
    return {
      ok: false,
      error: `DWG verze ${dwgVersionName(code)} (${code}) se nečte – ${SAVE_AS_DXF} nebo jako DWG 2000 a novější.`,
    };
  }
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const unreadableError = `Soubor DWG (${dwgVersionName(code)}) nelze přečíst – je poškozený nebo neúplný; ${SAVE_AS_DXF}.`;
  if (LOCATOR_VERSIONS.has(code) && !sectionsInFile(bytes)) {
    return { ok: false, error: unreadableError };
  }
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  let unreadable = 0;
  const notify = (_sender: object, e: NotificationEventArgs) => {
    if (e.notificationType === NotificationType.Error) unreadable++;
  };
  try {
    const chunks: string[] = [];
    withPushLimit(PUSH_BASE + PUSH_PER_BYTE * bytes.length, () => {
      const doc = DwgReader.readFromStream(buffer as ArrayBuffer, notify);
      DxfWriter.writeToStream({ write: (s: string) => void chunks.push(s) }, doc, false);
    });
    const warnings =
      unreadable > 0
        ? [
            `Část objektů výkresu DWG se nepodařilo přečíst (${unreadable}). Chybí-li díl, ${SAVE_AS_DXF}.`,
          ]
        : [];
    return { ok: true, text: chunks.join(''), warnings };
  } catch {
    return { ok: false, error: unreadableError };
  }
}

/** Díly z jednoho souboru DWG – převod na DXF a dál jako `partsFromDxf`. */
export function partsFromDwg(
  fileName: string,
  data: ArrayBuffer | Uint8Array,
  opts: DxfPartsOptions = {},
): DxfPartsResult {
  const dxf = dwgToDxf(data);
  if (!dxf.ok) {
    return {
      parts: [],
      origins: [],
      layers: [],
      units: { code: 4, name: 'mm', toMm: 1 },
      warnings: [],
      errors: [dxf.error],
    };
  }
  const r = partsFromDxf(fileName, dxf.text, opts);
  return { ...r, warnings: [...dxf.warnings, ...r.warnings] };
}
