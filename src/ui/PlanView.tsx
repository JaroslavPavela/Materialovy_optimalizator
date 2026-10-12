import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import type { Ring } from '../core/geometry/types.ts';
import type { Part, Sheet, SheetLayout, SheetMetrics } from '../core/model.ts';
import { placedParts } from '../core/placed.ts';
import { useAppStore } from '../state/store.ts';
import { formatNumber, formatPercent, partColor } from './format.ts';

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

/** SVG cesta polygonu; souřadnice jádra (Y nahoru) se převrátí transformací skupiny. */
function ringsPath(rings: readonly Ring[]): string {
  return rings.map((r) => `M${r.map((p) => `${p.x} ${p.y}`).join('L')}Z`).join('');
}

interface SheetSvgProps {
  readonly sheet: Sheet;
  readonly layout: SheetLayout;
  readonly metrics: SheetMetrics | undefined;
  readonly parts: readonly Part[];
}

function SheetSvg({ sheet, layout, metrics, parts }: SheetSvgProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const full = useMemo<View>(() => {
    const pad = Math.max(sheet.width, sheet.height) * 0.02;
    return { x: -pad, y: -pad, w: sheet.width + 2 * pad, h: sheet.height + 2 * pad };
  }, [sheet.width, sheet.height]);
  const [view, setView] = useState<View>(full);
  const drag = useRef<{ cx: number; cy: number; view: View; scale: number } | null>(null);

  const placed = useMemo(() => placedParts(parts, layout), [parts, layout]);
  const colorOf = useMemo(() => new Map(parts.map((p, i) => [p.id, partColor(i)])), [parts]);

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

  const H = sheet.height;
  const m = sheet.margin;
  const remnant = metrics?.remnant ?? null;
  // Popisky se vykreslují mimo převrácenou skupinu, aby text nebyl vzhůru nohama.
  const flipY = (y: number) => H - y;

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
        <defs>
          <pattern
            id="zone-hatch"
            patternUnits="userSpaceOnUse"
            width={full.w / 120}
            height={full.w / 120}
            patternTransform="rotate(45)"
          >
            <rect width={full.w / 120} height={full.w / 120} fill="#fde2e1" />
            <line
              x1="0"
              y1="0"
              x2="0"
              y2={full.w / 120}
              stroke="#d1242f"
              strokeWidth={full.w / 400}
            />
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
            <path key={z.id} className="zone" d={ringsPath([z.polygon])}>
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
          {placed.map((p) => (
            <path
              key={`${p.part.id}-${p.placement.instance}`}
              className="part"
              d={ringsPath([p.outline.outer, ...p.outline.holes])}
              fill={colorOf.get(p.part.id)}
            >
              <title>
                {`${p.part.name} – ${formatNumber(p.part.width)} × ${formatNumber(p.part.height)} mm, natočení ${formatNumber(p.placement.rotation)}°`}
              </title>
            </path>
          ))}
        </g>
        {placed.map((p) => {
          const size = Math.min(
            p.bbox.height * 0.4,
            (p.bbox.width / Math.max(3, p.part.name.length)) * 1.6,
          );
          return (
            <text
              key={`${p.part.id}-${p.placement.instance}`}
              className="part-label"
              x={p.labelAt.x}
              y={flipY(p.labelAt.y)}
              fontSize={size}
            >
              {p.part.name}
            </text>
          );
        })}
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
      </svg>
    </div>
  );
}

/** Nad tento počet tabulí se místo záložek přepíná výběrem a šipkami. */
const MAX_TABS = 12;

/** Náhled plánu: přepínání tabulí a SVG s přiblížením a posunem. */
export function PlanView() {
  const result = useAppStore((s) => s.result);
  const input = useAppStore((s) => s.resultInput);
  const active = useAppStore((s) => s.activeSheet);
  const setActive = useAppStore((s) => s.setActiveSheet);

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

  const count = result.layouts.length;
  const index = Math.min(active, count - 1);
  const layout = result.layouts[index]!;
  const sheetName = new Map(input.sheets.map((s) => [s.id, s.name]));
  const sheet = input.sheets.find((s) => s.id === layout.sheetId);
  const title = (i: number) => {
    const l = result.layouts[i]!;
    const u = result.metrics.sheets[i]?.utilization ?? 0;
    return {
      name: `${i + 1}. ${sheetName.get(l.sheetId) ?? l.sheetId}`,
      detail: `(${l.placements.length} ks, ${formatPercent(u)})`,
    };
  };

  return (
    <section className="panel plan">
      {count <= MAX_TABS ? (
        <div className="sheet-tabs" role="tablist" aria-label="Tabule">
          {result.layouts.map((_, i) => {
            const t = title(i);
            return (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={i === index}
                className={i === index ? 'active' : ''}
                onClick={() => setActive(i)}
              >
                {t.name} <span className="muted">{t.detail}</span>
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
            onClick={() => setActive(index - 1)}
          >
            ‹
          </button>
          <select
            aria-label="Tabule"
            value={index}
            onChange={(e) => setActive(Number(e.target.value))}
          >
            {result.layouts.map((_, i) => {
              const t = title(i);
              return (
                <option key={i} value={i}>
                  {t.name} {t.detail}
                </option>
              );
            })}
          </select>
          <button
            type="button"
            aria-label="Další tabule"
            disabled={index === count - 1}
            onClick={() => setActive(index + 1)}
          >
            ›
          </button>
          <span className="muted">z {count} tabulí</span>
        </div>
      )}
      {sheet ? (
        <SheetSvg
          key={`${index}-${sheet.id}`}
          sheet={sheet}
          layout={layout}
          metrics={result.metrics.sheets[index]}
          parts={input.parts}
        />
      ) : (
        <p className="errors">Tabule „{layout.sheetId}" chybí v zadání.</p>
      )}
      <p className="muted hint">Kolečko myši přibližuje, tažením se plán posouvá.</p>
    </section>
  );
}
