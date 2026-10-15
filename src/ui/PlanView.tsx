import { useEffect, useId, useMemo, useRef, useState, type PointerEvent } from 'react';
import { partColors, placedPartPaths, ringPath } from '../core/export/svg.ts';
import { labelSize } from '../core/placed.ts';
import type { Part, Sheet, SheetLayout, SheetMetrics } from '../core/model.ts';
import { sheetNumbersText } from '../core/sheet-groups.ts';
import { useAppStore } from '../state/store.ts';
import { formatNumber, formatPercent } from './format.ts';
import { useSheetGroups } from './useSheetGroups.ts';

/** Výřez SVG v souřadnicích zobrazení (mm, osa Y dolů). */
interface View {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Bod v pixelech prvku → souřadnice výřezu (preserveAspectRatio xMidYMid meet). */
function clientToView(v: View, rect: DOMRect, cx: number, cy: number) {
  const scale = Math.max(v.w / rect.width, v.h / rect.height);
  return {
    x: v.x - (rect.width * scale - v.w) / 2 + (cx - rect.left) * scale,
    y: v.y - (rect.height * scale - v.h) / 2 + (cy - rect.top) * scale,
    scale,
  };
}

/** Přiblížení výřezu kolem bodu (x, y) faktorem `k` (> 1 = oddálení). */
function zoomAt(v: View, x: number, y: number, k: number, full: View): View {
  const w = Math.min(Math.max(v.w * k, full.w / 100), full.w * 4);
  const f = w / v.w;
  return { x: x - (x - v.x) * f, y: y - (y - v.y) * f, w, h: v.h * f };
}

interface SheetSvgProps {
  readonly sheet: Sheet;
  readonly layout: SheetLayout;
  readonly metrics: SheetMetrics | undefined;
  readonly parts: readonly Part[];
}

/** Celý výřez tabule s malým okrajem kolem (mm, osa Y dolů). */
function fullView(sheet: Sheet): View {
  const pad = Math.max(sheet.width, sheet.height) * 0.02;
  return { x: -pad, y: -pad, w: sheet.width + 2 * pad, h: sheet.height + 2 * pad };
}

/**
 * Obsah SVG tabule: tabule, okraj, zóny, zbytek, díly a popisky. Sdílí ho
 * náhled jedné tabule i přehled všech tabulí.
 */
function SheetDrawing({ sheet, layout, metrics, parts }: SheetSvgProps) {
  // Vzor šrafování má v dokumentu jedinečné ID – v přehledu je tabulí víc.
  const hatchId = `zone-hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const full = fullView(sheet);
  // Cesty jsou v souřadnicích jádra (Y nahoru); převrací je transformace skupiny.
  const placed = useMemo(() => placedPartPaths(parts, layout), [parts, layout]);
  const colorOf = useMemo(() => partColors(parts), [parts]);

  const H = sheet.height;
  const m = sheet.margin;
  const remnant = metrics?.remnant ?? null;
  // Popisky se vykreslují mimo převrácenou skupinu, aby text nebyl vzhůru nohama.
  const flipY = (y: number) => H - y;
  const hatch = full.w / 120;

  return (
    <>
      <defs>
        <pattern
          id={hatchId}
          patternUnits="userSpaceOnUse"
          width={hatch}
          height={hatch}
          patternTransform="rotate(45)"
        >
          <rect width={hatch} height={hatch} fill="#fde2e1" />
          <line x1="0" y1="0" x2="0" y2={hatch} stroke="#d1242f" strokeWidth={full.w / 400} />
        </pattern>
      </defs>
      <g transform={`matrix(1 0 0 -1 0 ${H})`}>
        <rect className="sheet" x={0} y={0} width={sheet.width} height={H} />
        {m > 0 && (
          <rect
            className="margin"
            x={m}
            y={m}
            width={Math.max(0, sheet.width - 2 * m)}
            height={Math.max(0, H - 2 * m)}
          />
        )}
        {sheet.forbiddenZones.map((z) => (
          <path key={z.id} className="zone" d={ringPath(z.polygon)} fill={`url(#${hatchId})`}>
            <title>Zakázaná zóna</title>
          </path>
        ))}
        {remnant && (
          <rect
            className="remnant"
            x={remnant.x}
            y={remnant.y}
            width={remnant.width}
            height={remnant.height}
          />
        )}
        {placed.map(({ placed: p, path }) => (
          <path
            key={`${p.part.id}-${p.placement.instance}`}
            className="part"
            d={path}
            fill={colorOf.get(p.part.id)}
          >
            <title>
              {`${p.part.name} – ${formatNumber(p.part.width)} × ${formatNumber(p.part.height)} mm, natočení ${formatNumber(p.placement.rotation)}°`}
            </title>
          </path>
        ))}
      </g>
      {placed.map(({ placed: p }) => (
        <text
          key={`${p.part.id}-${p.placement.instance}`}
          className="part-label"
          x={p.labelAt.x}
          y={flipY(p.labelAt.y)}
          fontSize={labelSize(p)}
        >
          {p.part.name}
        </text>
      ))}
      {remnant && (
        <text
          className="remnant-label"
          x={remnant.x + remnant.width / 2}
          y={flipY(remnant.y + remnant.height / 2)}
          fontSize={Math.min(remnant.height * 0.15, remnant.width / 12)}
        >
          zbytek {formatNumber(remnant.width, 0)} × {formatNumber(remnant.height, 0)}
        </text>
      )}
    </>
  );
}

/** Jedna tabule s přiblížením kolečkem a posunem tažením. */
function SheetSvg(props: SheetSvgProps) {
  const { sheet } = props;
  const svgRef = useRef<SVGSVGElement>(null);
  const full = useMemo(() => fullView(sheet), [sheet]);
  const [view, setView] = useState<View>(full);
  const drag = useRef<{ cx: number; cy: number; view: View; scale: number } | null>(null);

  // Kolečko myši: React registruje wheel jako pasivní, preventDefault vyžaduje vlastní posluchač.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      setView((v) => {
        const p = clientToView(v, rect, e.clientX, e.clientY);
        return zoomAt(v, p.x, p.y, Math.exp(e.deltaY * 0.0015), full);
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [full]);

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const { scale } = clientToView(view, rect, e.clientX, e.clientY);
    drag.current = { cx: e.clientX, cy: e.clientY, view, scale };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    setView({
      ...d.view,
      x: d.view.x - (e.clientX - d.cx) * d.scale,
      y: d.view.y - (e.clientY - d.cy) * d.scale,
    });
  };
  const endDrag = () => {
    drag.current = null;
  };
  const zoomCenter = (k: number) =>
    setView((v) => zoomAt(v, v.x + v.w / 2, v.y + v.h / 2, k, full));

  return (
    <div className="plan-canvas">
      <div className="zoom-controls">
        <button type="button" aria-label="Přiblížit" onClick={() => zoomCenter(1 / 1.4)}>
          +
        </button>
        <button type="button" aria-label="Oddálit" onClick={() => zoomCenter(1.4)}>
          −
        </button>
        <button type="button" onClick={() => setView(full)}>
          Celá tabule
        </button>
      </div>
      <svg
        ref={svgRef}
        role="img"
        aria-label={`Plán tabule ${sheet.name}`}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <SheetDrawing {...props} />
      </svg>
    </div>
  );
}

/** Tabule v přehledu: celá, bez přiblížení. */
function SheetThumb(props: SheetSvgProps & { readonly label: string }) {
  const v = fullView(props.sheet);
  return (
    <svg
      role="img"
      aria-label={props.label}
      viewBox={`${v.x} ${v.y} ${v.w} ${v.h}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <SheetDrawing {...props} />
    </svg>
  );
}

/** Kolik tabulí přehled vykreslí najednou (víc přidá tlačítko). */
const OVERVIEW_PAGE = 24;

/** Nad tento počet tabulí se místo záložek přepíná výběrem a šipkami. */
const MAX_TABS = 12;

/** Přehled všech tabulí (nebo skupin shodných tabulí); kliknutí tabuli otevře. */
function SheetOverview({
  cards,
}: {
  readonly cards: readonly {
    readonly key: string;
    readonly props: SheetSvgProps | null;
    readonly sheetId: string;
    readonly name: string;
    readonly detail: string;
    readonly copies: string;
    readonly numbers: string | undefined;
    readonly active: boolean;
    readonly open: () => void;
  }[];
}) {
  const [shown, setShown] = useState(OVERVIEW_PAGE);
  const rest = cards.length - shown;
  return (
    <>
      <ul className="sheet-overview" aria-label="Všechny tabule">
        {cards.slice(0, shown).map((c) => (
          <li key={c.key}>
            <button
              type="button"
              className={c.active ? 'sheet-card active' : 'sheet-card'}
              aria-label={`Otevřít tabuli ${c.name}`}
              title={c.numbers}
              onClick={c.open}
            >
              <span className="sheet-card-title">
                <span>
                  {c.name} <span className="muted">{c.detail}</span>
                </span>
                {c.copies && <strong className="copies">{c.copies}</strong>}
              </span>
              {c.props ? (
                <SheetThumb {...c.props} label={`Náhled tabule ${c.name}`} />
              ) : (
                <span className="errors">Tabule „{c.sheetId}" chybí v zadání.</span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {rest > 0 && (
        <button
          type="button"
          className="overview-more"
          onClick={() => setShown((n) => n + OVERVIEW_PAGE)}
        >
          Zobrazit dalších {Math.min(rest, OVERVIEW_PAGE)} (zbývá {rest})
        </button>
      )}
    </>
  );
}

/** Náhled plánu: jedna tabule (přepínání, přiblížení, posun) nebo přehled všech. */
export function PlanView() {
  const result = useAppStore((s) => s.result);
  const input = useAppStore((s) => s.resultInput);
  const setActive = useAppStore((s) => s.setActiveSheet);
  const grouped = useAppStore((s) => s.groupSheets);
  const setGrouped = useAppStore((s) => s.setGroupSheets);
  const planView = useAppStore((s) => s.planView);
  const setPlanView = useAppStore((s) => s.setPlanView);
  const openSheet = useAppStore((s) => s.openSheet);
  const { groups, active: index } = useSheetGroups();

  if (!result || !input) {
    return (
      <section className="panel plan empty">
        <p className="muted">Plán se zobrazí po výpočtu.</p>
      </section>
    );
  }
  if (result.layouts.length === 0) {
    return (
      <section className="panel plan empty">
        <p className="muted">Žádný díl se nepodařilo umístit.</p>
      </section>
    );
  }

  const count = groups.length;
  const multiple = result.layouts.length > 1;
  const overview = multiple && planView === 'all';
  const layoutIndex = groups[index]!.indices[0]!;
  const layout = result.layouts[layoutIndex]!;
  const sheetName = new Map(input.sheets.map((s) => [s.id, s.name]));
  const sheetById = new Map(input.sheets.map((s) => [s.id, s]));
  const sheet = sheetById.get(layout.sheetId);
  const select = (g: number) => setActive(groups[g]!.indices[0]!);
  const title = (g: number) => {
    const { indices } = groups[g]!;
    const l = result.layouts[indices[0]!]!;
    const u = result.metrics.sheets[indices[0]!]?.utilization ?? 0;
    return {
      name: `${g + 1}. ${sheetName.get(l.sheetId) ?? l.sheetId}`,
      detail: `(${l.placements.length} ks, ${formatPercent(u)})`,
      copies: indices.length > 1 ? `× ${indices.length}` : '',
      numbers: indices.length > 1 ? `tabule ${sheetNumbersText(indices)}` : undefined,
    };
  };

  return (
    <section className="panel plan">
      {multiple && (
        <div className="plan-toolbar">
          <div className="view-switch" role="group" aria-label="Zobrazení plánu">
            <button
              type="button"
              aria-pressed={!overview}
              className={overview ? '' : 'active'}
              onClick={() => setPlanView('single')}
            >
              Jedna tabule
            </button>
            <button
              type="button"
              aria-pressed={overview}
              className={overview ? 'active' : ''}
              onClick={() => setPlanView('all')}
            >
              Všechny tabule
            </button>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={grouped}
              onChange={(e) => setGrouped(e.target.checked)}
            />{' '}
            Seskupit stejné tabule
          </label>
          <span className="muted">
            {grouped && count < result.layouts.length
              ? `${result.layouts.length} tabulí, různých: ${count}`
              : `${result.layouts.length} tabulí`}
          </span>
        </div>
      )}
      {overview ? (
        <SheetOverview
          // Nový výsledek nebo seskupení začne přehled znovu od první stránky.
          key={`${result.layouts.length}-${grouped}`}
          cards={groups.map((group, g) => {
            const i = group.indices[0]!;
            const l = result.layouts[i]!;
            const s = sheetById.get(l.sheetId);
            const t = title(g);
            return {
              key: `${g}-${i}`,
              props: s
                ? { sheet: s, layout: l, metrics: result.metrics.sheets[i], parts: input.parts }
                : null,
              sheetId: l.sheetId,
              ...t,
              active: g === index,
              open: () => openSheet(i),
            };
          })}
        />
      ) : (
        <>
          {count <= MAX_TABS ? (
            <div className="sheet-tabs" role="tablist" aria-label="Tabule">
              {groups.map((_, g) => {
                const t = title(g);
                return (
                  <button
                    key={g}
                    type="button"
                    role="tab"
                    aria-selected={g === index}
                    className={g === index ? 'active' : ''}
                    title={t.numbers}
                    onClick={() => select(g)}
                  >
                    {t.name} <span className="muted">{t.detail}</span>
                    {t.copies && <strong className="copies"> {t.copies}</strong>}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="sheet-tabs">
              <button
                type="button"
                aria-label="Předchozí tabule"
                disabled={index === 0}
                onClick={() => select(index - 1)}
              >
                ‹
              </button>
              <select
                aria-label="Tabule"
                value={index}
                onChange={(e) => select(Number(e.target.value))}
              >
                {groups.map((_, g) => {
                  const t = title(g);
                  return (
                    <option key={g} value={g}>
                      {t.name} {t.detail} {t.copies}
                    </option>
                  );
                })}
              </select>
              <button
                type="button"
                aria-label="Další tabule"
                disabled={index === count - 1}
                onClick={() => select(index + 1)}
              >
                ›
              </button>
              <span className="muted">z {count}</span>
            </div>
          )}
          {groups[index]!.indices.length > 1 && (
            <p className="muted copies-note" role="status">
              Tato tabule se opakuje {groups[index]!.indices.length}× ({title(index).numbers}).
            </p>
          )}
          {sheet ? (
            <SheetSvg
              key={`${layoutIndex}-${sheet.id}`}
              sheet={sheet}
              layout={layout}
              metrics={result.metrics.sheets[layoutIndex]}
              parts={input.parts}
            />
          ) : (
            <p className="errors">Tabule „{layout.sheetId}" chybí v zadání.</p>
          )}
        </>
      )}
      <p className="muted hint">
        {overview
          ? 'Kliknutím na tabuli ji otevřete s přiblížením a posunem.'
          : 'Kolečko myši přibližuje, tažením se plán posouvá.'}
      </p>
    </section>
  );
}
