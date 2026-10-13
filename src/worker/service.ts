import {
  partsFromDxf,
  type DxfPartsOptions,
  type DxfPartsResult,
} from '../core/import/dxf-parts.ts';
import type { NestingInput, NestingResult } from '../core/model.ts';
import { nestSteps, type NestOutcome, type NestProgress } from '../core/nesting/nest.ts';

/** Nejkratší rozestup mezi hlášeními průběhu (~4× za sekundu). */
export const PROGRESS_INTERVAL_MS = 250;

export type ProgressCallback = (progress: NestProgress) => void;

/** Služba výpočtu, kterou worker vystaví přes Comlink. */
export interface NestingService {
  /**
   * Spustí výpočet. Průběh hlásí nejvýš jednou za PROGRESS_INTERVAL_MS
   * (první a poslední krok vždy). Nový výpočet zastaví předchozí.
   */
  nest(input: NestingInput, onProgress?: ProgressCallback): Promise<NestOutcome>;
  /** Zastaví běžící výpočet; ten skončí s nejlepším dosavadním výsledkem. */
  stop(): void;
  /**
   * Díly z DXF (čtení, sestavení kontur) – ve workeru, aby velký výkres
   * neblokoval UI a dxf-parser s Clipperem nebyly v hlavním balíku.
   */
  importDxf(fileName: string, data: ArrayBuffer, opts: DxfImportOptions): DxfPartsResult;
}

/** Volby importu DXF přenositelné do workeru (bez funkcí). */
export type DxfImportOptions = Pick<DxfPartsOptions, 'mode' | 'idPrefix' | 'rotation'>;

/** Předá řízení smyčce událostí, aby worker stihl přijmout `stop()`. */
const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export function createNestingService(
  yieldControl: () => Promise<void> = macrotask,
  now: () => number = () => Date.now(),
): NestingService {
  let currentJob = 0;
  let stopRequested = 0;

  return {
    async nest(input, onProgress) {
      const job = ++currentJob;
      const steps = nestSteps(input);
      let best: NestingResult;
      let lastReport = -Infinity;
      let lastStep = 0;
      for (;;) {
        const next = steps.next();
        if (next.done) {
          // Tvarový režim končí podle času/ustálení – poslední krok nemusel být
          // nahlášen; závěrečný průběh 100 % s konečným výsledkem.
          if (onProgress && next.value.ok && lastStep > 0) {
            onProgress({
              step: lastStep,
              totalSteps: lastStep,
              fraction: 1,
              best: next.value.result,
            });
          }
          return next.value;
        }
        lastStep = next.value.step;
        best = next.value.best;
        const first = next.value.step === 1;
        const last = next.value.step === next.value.totalSteps;
        if (onProgress && (first || last || now() - lastReport >= PROGRESS_INTERVAL_MS)) {
          lastReport = now();
          onProgress(next.value);
        }
        await yieldControl();
        if (stopRequested >= job || currentJob !== job) {
          steps.return({ ok: true, result: best, stopped: true });
          return { ok: true, result: best, stopped: true };
        }
      }
    },
    stop() {
      stopRequested = currentJob;
    },
    importDxf(fileName, data, opts) {
      return partsFromDxf(fileName, data, opts);
    },
  };
}
