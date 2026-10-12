import { computeMetrics } from '../metrics.ts';
import {
  validateNestingInput,
  type InputIssue,
  type NestingInput,
  type NestingResult,
} from '../model.ts';
import {
  compareRectResults,
  packRects,
  PART_ORDERS,
  RECT_HEURISTICS,
  type ComparableResult,
  type MaxRectsResult,
} from './maxrects.ts';
import { optimizeShapes, type GaOptions } from './optimizer.ts';
import { ShapeContext } from './placer.ts';

/** Průběh výpočtu po jednom kroku. */
export interface NestProgress {
  /** Počet dokončených kroků (1 … totalSteps). */
  readonly step: number;
  /** Plánovaný počet kroků (u tvarového režimu odhad – končí podle času). */
  readonly totalSteps: number;
  /** Hotová část výpočtu 0–1 (u tvarového režimu podle uplynulého času). */
  readonly fraction: number;
  /** Nejlepší dosavadní výsledek. */
  readonly best: NestingResult;
}

export type NestOutcome =
  | {
      readonly ok: true;
      readonly result: NestingResult;
      /** Výpočet byl zastaven dřív – `result` je nejlepší dosavadní. */
      readonly stopped: boolean;
    }
  | { readonly ok: false; readonly issues: readonly InputIssue[] };

/** Výsledek MaxRects → `NestingResult` s metrikami (volné obdélníky jen pro zbytky). */
export function rectResultToNesting(input: NestingInput, r: MaxRectsResult): NestingResult {
  return {
    layouts: r.layouts.map((l) => ({ sheetId: l.sheetId, placements: l.placements })),
    unplaced: r.unplaced,
    metrics: computeMetrics(input, r.layouts, r.unplaced.length),
  };
}

export interface NestOptions {
  /** Hodiny v ms (výchozí Date.now) – časový limit optimalizátoru. */
  readonly now?: () => number;
  /** Nastavení genetického algoritmu (testy: pevný počet generací). */
  readonly ga?: GaOptions;
}

/**
 * Výpočet po krocích: po každém kroku vydá průběh s nejlepším dosavadním
 * výsledkem; volající může mezi kroky přestat (`return()` generátoru)
 * a použít poslední `best`. Návratová hodnota = konečný výsledek.
 *
 * Režim `shape`: nejdřív všech 16 kombinací MaxRects (rychlý první výsledek),
 * pak genetický optimalizátor nad tvarovým placerem až do časového limitu
 * nebo do ustálení – tvarový režim nikdy nedopadne hůř než obalové obdélníky.
 */
export function* nestSteps(
  input: NestingInput,
  opts: NestOptions = {},
): Generator<NestProgress, NestOutcome, void> {
  const issues = validateNestingInput(input);
  if (issues.length > 0) return { ok: false, issues };

  const combos = PART_ORDERS.flatMap((order) =>
    RECT_HEURISTICS.map((heuristic) => ({ order, heuristic })),
  );
  const shape = input.params.mode === 'shape';
  const now = opts.now ?? (() => Date.now());
  const start = now();
  const limit = input.params.timeLimitMs;
  // Obdélníková část tvoří u tvarového režimu 10 % průběhu, zbytek je čas.
  const rectShare = shape ? 0.1 : 1;
  const totalSteps = combos.length + (shape ? 1 : 0);
  let best: ComparableResult | null = null;
  let bestResult: NestingResult | null = null;
  let step = 0;
  const consider = (r: ComparableResult, toResult: () => NestingResult) => {
    if (!best || compareRectResults(input, r, best) < 0) {
      best = r;
      bestResult = toResult();
    }
  };

  for (const { heuristic, order } of combos) {
    const r = packRects(input, heuristic, order);
    consider(r, () => rectResultToNesting(input, r));
    step++;
    yield { step, totalSteps, fraction: (rectShare * step) / combos.length, best: bestResult! };
  }

  if (shape) {
    const ga = optimizeShapes(new ShapeContext(input), opts.ga);
    for (;;) {
      const next = ga.next();
      if (next.done) break;
      const r = next.value.best;
      if (next.value.improved) {
        consider(r, () => ({
          layouts: r.layouts,
          unplaced: r.unplaced,
          metrics: computeMetrics(input, r.layouts, r.unplaced.length),
        }));
      }
      step++;
      const elapsed = now() - start;
      yield {
        step,
        totalSteps: Math.max(totalSteps, step + 1),
        fraction: Math.min(1, rectShare + (1 - rectShare) * (elapsed / limit)),
        best: bestResult!,
      };
      if (elapsed >= limit) {
        ga.return(r);
        break;
      }
    }
  }
  return { ok: true, result: bestResult!, stopped: false };
}

/** Celý výpočet najednou (synchronně). */
export function nest(input: NestingInput, opts: NestOptions = {}): NestOutcome {
  const steps = nestSteps(input, opts);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}
