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
}

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
      for (;;) {
        const next = steps.next();
        if (next.done) return next.value;
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
  };
}
