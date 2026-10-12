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
  type MaxRectsResult,
} from './maxrects.ts';

/** Průběh výpočtu po jednom kroku. */
export interface NestProgress {
  /** Počet dokončených kroků (1 … totalSteps). */
  readonly step: number;
  readonly totalSteps: number;
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

/**
 * Výpočet po krocích: po každém kroku vydá průběh s nejlepším dosavadním
 * výsledkem; volající může mezi kroky přestat (`return()` generátoru)
 * a použít poslední `best`. Návratová hodnota = konečný výsledek.
 *
 * Režim `shape` zatím používá obalové obdélníky (tvarový nesting – fáze 5).
 */
export function* nestSteps(input: NestingInput): Generator<NestProgress, NestOutcome, void> {
  const issues = validateNestingInput(input);
  if (issues.length > 0) return { ok: false, issues };

  const combos = PART_ORDERS.flatMap((order) =>
    RECT_HEURISTICS.map((heuristic) => ({ order, heuristic })),
  );
  let best: MaxRectsResult | null = null;
  let bestResult: NestingResult | null = null;
  for (let i = 0; i < combos.length; i++) {
    const { heuristic, order } = combos[i]!;
    const r = packRects(input, heuristic, order);
    if (!best || compareRectResults(input, r, best) < 0) {
      best = r;
      bestResult = rectResultToNesting(input, r);
    }
    yield { step: i + 1, totalSteps: combos.length, best: bestResult! };
  }
  return { ok: true, result: bestResult!, stopped: false };
}

/** Celý výpočet najednou (synchronně). */
export function nest(input: NestingInput): NestOutcome {
  const steps = nestSteps(input);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}
