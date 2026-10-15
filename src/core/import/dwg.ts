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
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  let unreadable = 0;
  const notify = (_sender: object, e: NotificationEventArgs) => {
    if (e.notificationType === NotificationType.Error) unreadable++;
  };
  try {
    const doc = DwgReader.readFromStream(buffer as ArrayBuffer, notify);
    const chunks: string[] = [];
    DxfWriter.writeToStream({ write: (s: string) => void chunks.push(s) }, doc, false);
    const warnings =
      unreadable > 0
        ? [
            `Část objektů výkresu DWG se nepodařilo přečíst (${unreadable}). Chybí-li díl, ${SAVE_AS_DXF}.`,
          ]
        : [];
    return { ok: true, text: chunks.join(''), warnings };
  } catch {
    return {
      ok: false,
      error: `Soubor DWG (${dwgVersionName(code)}) nelze přečíst – je poškozený nebo neúplný; ${SAVE_AS_DXF}.`,
    };
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
      units: { code: 4, name: 'mm', toMm: 1 },
      warnings: [],
      errors: [dxf.error],
    };
  }
  const r = partsFromDxf(fileName, dxf.text, opts);
  return { ...r, warnings: [...dxf.warnings, ...r.warnings] };
}
