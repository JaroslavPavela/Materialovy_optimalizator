import { EPS } from '../geometry/eps.ts';
import { intersectPolygons, polygonsArea, unionPolygons } from '../geometry/clipper.ts';
import { polygonBBox, ringBBox } from '../geometry/polygon.ts';
import { translatePolygon } from '../geometry/transform.ts';
import type { Point, Polygon, Rect } from '../geometry/types.ts';
import {
  allowedRotations,
  sheetMatchesPart,
  type NestingInput,
  type Part,
  type Placement,
  type Sheet,
  type SheetLayout,
  type UnplacedPart,
  type UnplacedReason,
} from '../model.ts';
import { usableRect } from './maxrects.ts';
import {
  feasibleRegion,
  ifpBounds,
  ifpRect,
  NfpCache,
  subtractObstacles,
  type Obstacle,
} from './nfp.ts';
import { inflatedZones, ShapeCache, shrinkForCheck } from './shapes.ts';

/** Kus dílu k umístění; `rotation` = preferované natočení (gen optimalizátoru). */
export interface ShapeItem {
  readonly part: Part;
  readonly instance: number;
  readonly rotation?: number;
}

export interface ShapeResult {
  readonly layouts: readonly SheetLayout[];
  readonly unplaced: readonly UnplacedPart[];
}

/** Sdílené výpočty pro jeden vstup: tvary, NFP a nafouknuté zóny tabulí. */
export class ShapeContext {
  readonly input: NestingInput;
  readonly shapes: ShapeCache;
  readonly nfps: NfpCache;
  /** Důvody neumístění podle dílu (`null` = vejde se na prázdnou tabuli). */
  readonly unplaceable = new Map<string, UnplacedReason | null>();
  private readonly zones = new Map<string, Polygon[]>();
  private readonly shrunkZones = new Map<
    string,
    { readonly poly: Polygon; readonly bbox: Rect }[]
  >();

  constructor(input: NestingInput) {
    this.input = input;
    this.shapes = new ShapeCache(input.params.spacing, {}, input.params.freeRotationStep);
    this.nfps = new NfpCache(this.shapes);
  }

  /** Zóny zmenšené o EPS/2 s obalem – pro ověření kandidátů (`ShapeSheet.fits`). */
  shrunkZonesOf(sheet: Sheet): { readonly poly: Polygon; readonly bbox: Rect }[] {
    let z = this.shrunkZones.get(sheet.id);
    if (!z) {
      z = shrinkForCheck(this.zonesOf(sheet)).map((poly) => ({ poly, bbox: polygonBBox(poly) }));
      this.shrunkZones.set(sheet.id, z);
    }
    return z;
  }

  zonesOf(sheet: Sheet): Polygon[] {
    let z = this.zones.get(sheet.id);
    if (!z) {
      z = inflatedZones(sheet, this.input.params.spacing);
      this.zones.set(sheet.id, z);
    }
    return z;
  }

  rotations(part: Part): number[] {
    return allowedRotations(part.rotation, this.input.params.freeRotationStep);
  }
}

interface Placed {
  readonly part: Part;
  readonly rotation: number;
  readonly at: Point;
  /** Tvar zmenšený o EPS/2 na místě (pro ověření kandidátů) a jeho obal. */
  readonly poly: Polygon;
  readonly bbox: Rect;
}

/** Kandidát umístění: poloha obalového obdélníku pro porovnání „dole, vlevo". */
export interface Candidate {
  readonly at: Point;
  readonly rotation: number;
  readonly bottom: number;
  readonly left: number;
}

/**
 * Plocha průniku zmenšených tvarů, která už je překryv (mm²). Legitimní
 * převis (≤ SLACK) po zmenšení o EPS/2 nezbude; pravoúhlý roh zanořený
 * o 2 µm má po zmenšení plochu průniku ~1e-6 mm², proto práh na úrovni
 * jednotky Clipperu na druhou (1e-4 mm)².
 */
const FIT_AREA_TOL = 1e-8;

/** Po kolika překážkách nejvýš předat řízení při aktualizaci přípustné oblasti. */
const OBSTACLE_BATCH = 16;

/** Je kandidát `a` níž (a při shodě víc vlevo) než `b`? */
const lower = (a: Candidate, b: Candidate) =>
  a.bottom < b.bottom - EPS || (a.bottom <= b.bottom + EPS && a.left < b.left - EPS);

/**
 * Jedna tabule při tvarovém skládání. Přípustná oblast se pro každou dvojici
 * (díl, natočení) drží průběžně: po umístění dílu se z ní odečte jen jeho NFP,
 * takže hledání nesjednocuje znovu NFP všech umístěných dílů.
 */
export class ShapeSheet {
  readonly sheet: Sheet;
  readonly placed: Placed[] = [];
  private readonly ctx: ShapeContext;
  private readonly regions = new Map<string, { region: Polygon[]; upto: number }>();
  /**
   * Počátek místních souřadnic = střed užitné plochy. Uvnitř se počítá
   * posunutě: clipper-lib nad 4745 mm (×1e4 > loRange) přejde na 128bitovou
   * aritmetiku a je 5–7× pomalejší – plech 6 m by se počítal zbytečně dlouho.
   */
  private readonly origin: Point;
  private readonly zonesLocal: Polygon[];
  private readonly shrunkZonesLocal: { readonly poly: Polygon; readonly bbox: Rect }[];

  constructor(ctx: ShapeContext, sheet: Sheet) {
    this.ctx = ctx;
    this.sheet = sheet;
    const u = usableRect(sheet, ctx.input.params.spacing);
    this.origin = { x: Math.round(u.x + u.width / 2), y: Math.round(u.y + u.height / 2) };
    const o = this.origin;
    this.zonesLocal = ctx.zonesOf(sheet).map((z) => translatePolygon(z, -o.x, -o.y));
    this.shrunkZonesLocal = ctx.shrunkZonesOf(sheet).map((z) => {
      const poly = translatePolygon(z.poly, -o.x, -o.y);
      return { poly, bbox: polygonBBox(poly) };
    });
  }

  private toLocal(c: Candidate): Candidate {
    const o = this.origin;
    return {
      ...c,
      at: { x: c.at.x - o.x, y: c.at.y - o.y },
      bottom: c.bottom - o.y,
      left: c.left - o.x,
    };
  }

  private toSheet(c: Candidate): Candidate {
    const o = this.origin;
    return {
      ...c,
      at: { x: c.at.x + o.x, y: c.at.y + o.y },
      bottom: c.bottom + o.y,
      left: c.left + o.x,
    };
  }

  /**
   * Nejnižší a nejlevější přípustná poloha dílu v jednom z natočení
   * (porovnává se obalový obdélník nafouknutého dílu); `null` = nevejde se.
   */
  find(part: Part, rotations: readonly number[]): Candidate | null {
    const steps = this.findSteps(part, rotations);
    for (;;) {
      const next = steps.next();
      if (next.done) return next.value;
    }
  }

  /**
   * Totéž jako `find` po krocích: předá řízení po každém natočení a po dávkách
   * překážek, aby šel výpočet ve workeru zastavit i u prvního kusu nového tvaru
   * (desítky nových NFP a odečtení stovek překážek). Mezi kroky se na
   * stejné tabuli nesmí volat `place` – kandidáti by nebyli ověřeni
   * přípustnou oblastí nového dílu (zachytila by je jen pojistka `fits`).
   */
  *findSteps(part: Part, rotations: readonly number[]): Generator<void, Candidate | null, void> {
    const { shapes, nfps, input } = this.ctx;
    const u = usableRect(this.sheet, input.params.spacing);
    const usable = { ...u, x: u.x - this.origin.x, y: u.y - this.origin.y };
    const zones = this.zonesLocal;
    const candidates: Candidate[] = [];
    for (const rotation of rotations) {
      const b = shapes.at(part, rotation).outer;
      const ifp = ifpRect(usable, b);
      const exact = ifpBounds(usable, b);
      if (!ifp || !exact) continue;
      const k = `${part.id}\u0000${rotation}`;
      let entry = this.regions.get(k);
      if (!entry) {
        const zoneObstacles: Obstacle[] = zones.map((z, i) => ({
          nfp: nfps.zone(`${this.sheet.id}:${i}`, z, part, rotation),
          at: { x: 0, y: 0 },
        }));
        entry = { region: feasibleRegion(ifp, zoneObstacles), upto: 0 };
        this.regions.set(k, entry);
      }
      if (entry.upto < this.placed.length) {
        // Po dávkách: stav (`upto`) je po každé dávce konzistentní, mezi
        // dávkami se předá řízení.
        while (entry.upto < this.placed.length) {
          const fresh = this.placed.slice(entry.upto, entry.upto + OBSTACLE_BATCH);
          // Díl v otvoru jiného dílu: po odečtení NFP (ten otvory pokrývá) se
          // přidají IFP otvorů. Dřív umístěné díly ani zóny v otvoru být nemohou
          // (díl s otvorem se umisťoval podle celého vnějšího obrysu).
          const withHoles = fresh.map((p) => ({
            p,
            holes: nfps.holes(p.part, p.rotation, part, rotation),
          }));
          if (withHoles.every((x) => x.holes.length === 0)) {
            entry.region = subtractObstacles(
              entry.region,
              fresh.map((p) => ({ nfp: nfps.parts(p.part, p.rotation, part, rotation), at: p.at })),
            );
          } else {
            for (const { p, holes } of withHoles) {
              entry.region = subtractObstacles(entry.region, [
                { nfp: nfps.parts(p.part, p.rotation, part, rotation), at: p.at },
              ]);
              if (holes.length > 0) {
                entry.region = unionPolygons([
                  ...entry.region,
                  ...holes.map((h) => translatePolygon(h, p.at.x, p.at.y)),
                ]);
              }
            }
          }
          entry.upto += fresh.length;
          yield;
        }
      }
      const region = entry.region;
      const bb = ringBBox(b);
      for (const poly of region) {
        for (const ring of [poly.outer, ...poly.holes]) {
          for (const v of ring) {
            // Zpět do přesného IFP: díl u kraje užitné plochy přesně na kraji
            // (posun ≤ SLACK v každé ose; s převisem do NFP ≤ SLACK celkem < EPS).
            const t = {
              x: Math.min(Math.max(v.x, exact.x0), exact.x1),
              y: Math.min(Math.max(v.y, exact.y0), exact.y1),
            };
            candidates.push({ at: t, rotation, bottom: t.y + bb.y, left: t.x + bb.x });
          }
        }
      }
      yield;
    }
    candidates.sort((a, b) => (lower(a, b) ? -1 : lower(b, a) ? 1 : 0));
    // Pojistka: kandidát se ověří skutečným průnikem nafouknutých tvarů –
    // numerický artefakt v NFP nesmí vést k dílu položenému přes jiný.
    for (const c of candidates) {
      if (this.fitsLocal(part, c)) return this.toSheet(c);
    }
    return null;
  }

  /**
   * Nepřekrývá se díl v poloze `c` s umístěnými díly ani se zónami? Měří se
   * hloubka, ne plocha: tvary zmenšené o EPS/2 se nesmí protínat (dotyk
   * i převis v toleranci skládání zmizí, skutečný překryv i v rohu zůstane).
   */
  fits(part: Part, c: Candidate): boolean {
    return this.fitsLocal(part, this.toLocal(c));
  }

  private fitsLocal(part: Part, c: Candidate): boolean {
    const b = translatePolygon(this.ctx.shapes.shrunk(part, c.rotation), c.at.x, c.at.y);
    const bb = polygonBBox(b);
    const hits = (o: { readonly poly: Polygon; readonly bbox: Rect }) =>
      !(
        o.bbox.x > bb.x + bb.width ||
        bb.x > o.bbox.x + o.bbox.width ||
        o.bbox.y > bb.y + bb.height ||
        bb.y > o.bbox.y + o.bbox.height
      ) && polygonsArea(intersectPolygons([b], [o.poly])) > FIT_AREA_TOL;
    return !this.placed.some(hits) && !this.shrunkZonesLocal.some(hits);
  }

  /** Umístí díl v poloze `c` (souřadnice tabule). */
  place(part: Part, c: Candidate): void {
    const l = this.toLocal(c);
    const poly = translatePolygon(this.ctx.shapes.shrunk(part, l.rotation), l.at.x, l.at.y);
    this.placed.push({ part, rotation: l.rotation, at: l.at, poly, bbox: polygonBBox(poly) });
  }
}

/** Natočení k vyzkoušení: preferované první, pak ostatní povolená. */
function rotationsFor(ctx: ShapeContext, item: ShapeItem): number[] {
  const all = ctx.rotations(item.part);
  if (item.rotation === undefined || !all.includes(item.rotation)) return all;
  return [item.rotation];
}

interface Fill {
  readonly sheet: ShapeSheet;
  readonly placements: Placement[];
  readonly placedArea: number;
  readonly remaining: ShapeItem[];
}

/** Naplní novou tabuli kusy v daném pořadí; co se nevejde, zůstane. */
function* fillSheet(
  ctx: ShapeContext,
  sheet: Sheet,
  items: readonly ShapeItem[],
): Generator<void, Fill, void> {
  const s = new ShapeSheet(ctx, sheet);
  const placements: Placement[] = [];
  const remaining: ShapeItem[] = [];
  let placedArea = 0;
  for (const item of items) {
    // Předat řízení u každého kusu – i u toho, který se nevejde.
    yield;
    if (!sheetMatchesPart(item.part, sheet)) {
      remaining.push(item);
      continue;
    }
    const preferred = rotationsFor(ctx, item);
    let c: Candidate | null = yield* s.findSteps(item.part, preferred);
    // Gen s jedním natočením: když se nevejde, zkusit ostatní povolená.
    if (!c && preferred.length < ctx.rotations(item.part).length) {
      c = yield* s.findSteps(item.part, ctx.rotations(item.part));
    }
    if (!c) {
      remaining.push(item);
      continue;
    }
    s.place(item.part, c);
    placements.push({
      partId: item.part.id,
      instance: item.instance,
      x: c.at.x,
      y: c.at.y,
      rotation: c.rotation,
    });
    placedArea += item.part.width * item.part.height;
  }
  return { sheet: s, placements, placedArea, remaining };
}

/** Proč se díl nevejde na žádnou prázdnou vhodnou tabuli; `null` = vejde se. */
export function shapeUnplaceableReason(ctx: ShapeContext, part: Part): UnplacedReason | null {
  const steps = unplaceableReasonSteps(ctx, part);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

/**
 * Totéž po krocích s cache v kontextu (důvod závisí jen na vstupu) – každé
 * vyhodnocení GA se ptá na všechny díly znovu.
 */
function* unplaceableReasonSteps(
  ctx: ShapeContext,
  part: Part,
): Generator<void, UnplacedReason | null, void> {
  const cached = ctx.unplaceable.get(part.id);
  if (cached !== undefined) return cached;
  const reason = yield* computeUnplaceableReason(ctx, part);
  ctx.unplaceable.set(part.id, reason);
  return reason;
}

function* computeUnplaceableReason(
  ctx: ShapeContext,
  part: Part,
): Generator<void, UnplacedReason | null, void> {
  const matchingAny = ctx.input.sheets.filter((s) => sheetMatchesPart(part, s));
  if (matchingAny.length === 0) return 'no-matching-sheet';
  const matching = matchingAny.filter((s) => s.stock !== 0);
  if (matching.length === 0) return 'out-of-sheets';
  const rotations = ctx.rotations(part);
  const spacing = ctx.input.params.spacing;
  const sizeOk = matching.filter((s) =>
    rotations.some((r) => ifpRect(usableRect(s, spacing), ctx.shapes.at(part, r).outer)),
  );
  if (sizeOk.length === 0) return 'too-large';
  for (const s of sizeOk) {
    if ((yield* new ShapeSheet(ctx, s).findSteps(part, rotations)) !== null) return null;
  }
  return 'blocked';
}

/**
 * Tvarové skládání kusů v daném pořadí (bottom-left přes NFP). Tabule se
 * plní postupně; formát další tabule se vybere jako v MaxRects (zbytky
 * přednostně, pak největší umístěná plocha, pak menší tabule).
 */
export function placeShapes(ctx: ShapeContext, items: readonly ShapeItem[]): ShapeResult {
  const steps = placeShapesSteps(ctx, items);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

/**
 * Totéž jako `placeShapes` po krocích: po každém kusu, natočení a dávce
 * překážek předá řízení (`yield`), aby šel výpočet ve workeru přerušit
 * i uprostřed skládání.
 */
export function* placeShapesSteps(
  ctx: ShapeContext,
  items: readonly ShapeItem[],
): Generator<void, ShapeResult, void> {
  const { sheets } = ctx.input;
  const unplaced: UnplacedPart[] = [];
  let remaining: ShapeItem[] = [];
  for (const item of items) {
    const reason = yield* unplaceableReasonSteps(ctx, item.part);
    if (reason) unplaced.push({ partId: item.part.id, instance: item.instance, reason });
    else remaining.push(item);
  }

  const stock = sheets.map((s) => s.stock);
  const layouts: SheetLayout[] = [];
  while (remaining.length > 0) {
    let best: { index: number; fill: Fill } | null = null;
    for (const [index, sheet] of sheets.entries()) {
      if (stock[index] === 0) continue;
      const fill: Fill = yield* fillSheet(ctx, sheet, remaining);
      if (fill.placements.length === 0) continue;
      if (!best) {
        best = { index, fill };
        continue;
      }
      const b: { index: number; fill: Fill } = best;
      const bs = sheets[b.index]!;
      const remnantFirst = Number(!!sheet.remnant) - Number(!!bs.remnant);
      const better =
        remnantFirst > 0 ||
        (remnantFirst === 0 &&
          (fill.placedArea > b.fill.placedArea + EPS ||
            (Math.abs(fill.placedArea - b.fill.placedArea) <= EPS &&
              sheet.width * sheet.height < bs.width * bs.height - EPS)));
      if (better) best = { index, fill };
    }
    if (!best) break;
    const chosen: { index: number; fill: Fill } = best;
    const s = stock[chosen.index];
    if (s !== null && s !== undefined) stock[chosen.index] = s - 1;
    layouts.push({ sheetId: sheets[chosen.index]!.id, placements: chosen.fill.placements });
    remaining = chosen.fill.remaining;
  }
  for (const item of remaining) {
    unplaced.push({ partId: item.part.id, instance: item.instance, reason: 'out-of-sheets' });
  }
  unplaced.sort((a, b) =>
    a.partId < b.partId ? -1 : a.partId > b.partId ? 1 : a.instance - b.instance,
  );
  return { layouts, unplaced };
}

/** Výchozí pořadí: kusy podle plochy dílu sestupně (stabilně podle zadání). */
export function defaultShapeOrder(input: NestingInput): ShapeItem[] {
  const items = input.parts.flatMap((part, partIndex) =>
    Array.from({ length: part.quantity }, (_, instance) => ({ part, partIndex, instance })),
  );
  items.sort(
    (a, b) =>
      b.part.width * b.part.height - a.part.width * a.part.height ||
      a.partIndex - b.partIndex ||
      a.instance - b.instance,
  );
  return items.map(({ part, instance }) => ({ part, instance }));
}
