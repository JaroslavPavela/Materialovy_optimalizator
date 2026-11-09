/**
 * Role hladiny výkresu při importu dílů:
 * - `outer` – vnější obrysy; otvory se v nich poznají podle vnoření (výchozí),
 * - `inner` – jen otvory (kontura mimo materiál dílu se ignoruje),
 * - `attach` – geometrie se přidá k dílu, ve kterém leží (gravírování, ohyby),
 * - `ignore` – hladina se nepoužije.
 */
export type LayerRole = 'outer' | 'inner' | 'attach' | 'ignore';

export const LAYER_ROLES: readonly LayerRole[] = ['outer', 'inner', 'attach', 'ignore'];

/** Role podle názvu hladiny; hladina, která v mapě chybí, má roli `outer`. */
export type LayerRoles = ReadonlyMap<string, LayerRole>;

export const DEFAULT_LAYER_ROLE: LayerRole = 'outer';

export function layerRole(roles: LayerRoles | undefined, layer: string): LayerRole {
  return roles?.get(layer) ?? DEFAULT_LAYER_ROLE;
}

export function isLayerRole(v: unknown): v is LayerRole {
  return typeof v === 'string' && (LAYER_ROLES as readonly string[]).includes(v);
}

/**
 * Role z dat neznámého původu (úložiště): seznam dvojic [hladina, role].
 * Neplatné položky se přeskočí.
 */
export function layerRolesFromJson(v: unknown): Map<string, LayerRole> {
  const out = new Map<string, LayerRole>();
  if (!Array.isArray(v)) return out;
  for (const item of v) {
    if (Array.isArray(item) && typeof item[0] === 'string' && isLayerRole(item[1])) {
      out.set(item[0], item[1]);
    }
  }
  return out;
}

/** Hladina s geometrií nebo texty ve výkresu. */
export interface DrawingLayer {
  readonly name: string;
  /** Počet segmentů (úseček a oblouků po rozložení entit). */
  readonly segments: number;
  /** Počet textů (TEXT, MTEXT). */
  readonly texts: number;
}

/** Hladiny se segmenty nebo texty, seřazené podle názvu. */
export function drawingLayers(
  segments: readonly { readonly layer: string }[],
  texts: readonly { readonly layer: string }[] = [],
): DrawingLayer[] {
  const count = new Map<string, { segments: number; texts: number }>();
  const at = (layer: string) => {
    let c = count.get(layer);
    if (!c) count.set(layer, (c = { segments: 0, texts: 0 }));
    return c;
  };
  for (const s of segments) at(s.layer).segments++;
  for (const t of texts) at(t.layer).texts++;
  return [...count]
    .map(([name, c]) => ({ name, ...c }))
    .sort((a, b) => a.name.localeCompare(b.name, 'cs'));
}

/**
 * Tolerance klíče polohy dílu = GAP_TOL + JOIN_TOL z contours.ts (o tolik se
 * může posunout vrchol při uzavření mezery). Tady jako číslo, aby UI nemuselo
 * načítat sestavení kontur s Clipperem; shodu hlídá test.
 */
export const ORIGIN_TOL = 0.11;

/**
 * Spárují se dva klíče polohy? Stačí jedna společná kopie; obalové obdélníky
 * se smí lišit o uzavřenou mezeru (`ORIGIN_TOL`) – vrchol se při ní
 * přichytí jinam podle toho, které hladiny se účastní.
 */
export function originsMatch(a: string, b: string): boolean {
  const tol = ORIGIN_TOL + 1e-9;
  const parse = (k: string) => k.split('|').map((r) => r.split(',').map(Number));
  const bs = parse(b);
  return parse(a).some((ra) =>
    bs.some((rb) => ra.length === rb.length && ra.every((v, i) => Math.abs(v - rb[i]!) <= tol)),
  );
}
