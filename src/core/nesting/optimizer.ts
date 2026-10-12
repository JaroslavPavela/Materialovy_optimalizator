import type { NestingInput } from '../model.ts';
import { compareRectResults } from './maxrects.ts';
import {
  defaultShapeOrder,
  placeShapes,
  type ShapeContext,
  type ShapeItem,
  type ShapeResult,
} from './placer.ts';

/** Seedovaný generátor pseudonáhodných čísel (mulberry32) – výpočet je opakovatelný. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Jedinec: pořadí kusů (indexy do výchozího seznamu) a gen natočení každého
 * kusu – konkrétní povolené natočení, nebo `null` = placer vybere nejlepší.
 */
export interface Individual {
  readonly order: readonly number[];
  readonly rotation: readonly (number | null)[];
}

export interface GaOptions {
  readonly populationSize?: number;
  /** Pravděpodobnost mutace na gen. */
  readonly mutationRate?: number;
  /** Ukončit po tolika generacích bez zlepšení. */
  readonly stallGenerations?: number;
  /** Nejvýš tolik generací (pro testy a determinismus nezávislý na čase). */
  readonly maxGenerations?: number;
}

export interface GaStep {
  readonly evaluations: number;
  readonly generation: number;
  readonly best: ShapeResult;
  /** Zlepšil tento krok nejlepší výsledek? */
  readonly improved: boolean;
}

/** Order crossover (OX): úsek z prvního rodiče, zbytek v pořadí druhého. */
export function orderCrossover(
  a: readonly number[],
  b: readonly number[],
  rnd: () => number,
): number[] {
  const n = a.length;
  if (n < 2) return [...a];
  let i = Math.floor(rnd() * n);
  let j = Math.floor(rnd() * n);
  if (i > j) [i, j] = [j, i];
  const child: (number | undefined)[] = new Array<number | undefined>(n);
  const used = new Set<number>();
  for (let k = i; k <= j; k++) {
    child[k] = a[k]!;
    used.add(a[k]!);
  }
  let pos = (j + 1) % n;
  for (let k = 0; k < n; k++) {
    const g = b[(j + 1 + k) % n]!;
    if (used.has(g)) continue;
    child[pos] = g;
    used.add(g);
    pos = (pos + 1) % n;
  }
  return child as number[];
}

/**
 * Genetický optimalizátor nad pořadím a natočením kusů (inspirace SVGnest).
 * Vydá krok po každém vyhodnoceném jedinci; volající ho může kdykoli
 * zastavit (časový limit, uživatel). Výsledky se porovnávají stejně jako
 * v MaxRects (`compareRectResults`). Pro stejné semínko a stejný počet
 * kroků je deterministický.
 */
export function* optimizeShapes(
  ctx: ShapeContext,
  opts: GaOptions = {},
): Generator<GaStep, ShapeResult, void> {
  const input: NestingInput = ctx.input;
  const items: ShapeItem[] = defaultShapeOrder(input);
  const n = items.length;
  const popSize = Math.max(2, opts.populationSize ?? 12);
  const mutationRate = opts.mutationRate ?? 0.1;
  const stallLimit = opts.stallGenerations ?? 30;
  const maxGenerations = opts.maxGenerations ?? Infinity;
  const rnd = mulberry32(input.params.seed);
  const rotations = items.map((it) => ctx.rotations(it.part));

  const evaluate = (ind: Individual): ShapeResult =>
    placeShapes(
      ctx,
      ind.order.map((k, pos) => {
        const r = ind.rotation[pos];
        return r === null || r === undefined ? items[k]! : { ...items[k]!, rotation: r };
      }),
    );
  const better = (a: ShapeResult, b: ShapeResult) => compareRectResults(input, a, b) < 0;

  const randomRotation = (k: number): number | null => {
    const options = rotations[k]!;
    // „Vybrat nejlepší" je jedna z možností genu, stejně pravděpodobná jako každé natočení.
    const pick = Math.floor(rnd() * (options.length + 1));
    return pick === options.length ? null : options[pick]!;
  };
  const mutate = (ind: Individual): Individual => {
    const order = [...ind.order];
    const rotation = [...ind.rotation];
    for (let p = 0; p < n; p++) {
      if (rnd() < mutationRate && n > 1) {
        const q = p + 1 < n ? p + 1 : p - 1;
        [order[p], order[q]] = [order[q]!, order[p]!];
        [rotation[p], rotation[q]] = [rotation[q] ?? null, rotation[p] ?? null];
      }
      if (rnd() < mutationRate) rotation[p] = randomRotation(order[p]!);
    }
    return { order, rotation };
  };

  // Výchozí jedinec = placer v pořadí podle plochy s volbou nejlepšího natočení.
  const seed: Individual = {
    order: items.map((_, k) => k),
    rotation: items.map(() => null),
  };
  let population: { ind: Individual; result: ShapeResult }[] = [];
  let best: ShapeResult | null = null;
  let evaluations = 0;
  let generation = 0;

  const add = function* (ind: Individual) {
    const result = evaluate(ind);
    evaluations++;
    const improved = !best || better(result, best);
    if (improved) best = result;
    population.push({ ind, result });
    yield { evaluations, generation, best: best!, improved };
  };

  yield* add(seed);
  while (population.length < popSize) yield* add(mutate(seed));

  let stall = 0;
  while (stall < stallLimit && generation < maxGenerations && n > 1) {
    generation++;
    population.sort((a, b) => compareRectResults(input, a.result, b.result));
    const elite = population[0]!;
    const tournament = () => {
      const a = population[Math.floor(rnd() * population.length)]!;
      const b = population[Math.floor(rnd() * population.length)]!;
      return compareRectResults(input, a.result, b.result) <= 0 ? a : b;
    };
    population = [elite];
    const before = best;
    while (population.length < popSize) {
      const p1 = tournament().ind;
      const p2 = tournament().ind;
      const order = orderCrossover(p1.order, p2.order, rnd);
      // Natočení putuje s kusem: z rodiče, ze kterého kus v potomkovi pochází.
      const rotOf = (ind: Individual) => new Map(ind.order.map((k, pos) => [k, ind.rotation[pos]]));
      const r1 = rotOf(p1);
      const r2 = rotOf(p2);
      const rotation = order.map((k) => ((rnd() < 0.5 ? r1 : r2).get(k) ?? null) as number | null);
      yield* add(mutate({ order, rotation }));
    }
    stall = best !== before ? 0 : stall + 1;
  }
  return best!;
}
