import { createPortal } from 'react-dom';
import { partColors, writeSheetSvg } from '../core/export/svg.ts';
import { UNPLACED_REASON_LABEL, type NestingInput, type NestingResult } from '../core/model.ts';
import { formatArea, formatNumber, formatPercent } from './format.ts';

export type PaperSize = 'A4' | 'A3';

interface Props {
  readonly input: NestingInput;
  readonly result: NestingResult;
  readonly paper: PaperSize;
  readonly date: Date;
}

/**
 * Tisková podoba plánu: souhrnná strana a jedna strana na tabuli (plán,
 * formát, využití, legenda). Vkládá se do <body> mimo aplikaci; tiskové CSS
 * skryje aplikaci a ukáže jen tento obsah.
 */
export function PrintView({ input, result, paper, date }: Props) {
  const colors = partColors(input.parts);
  const parts = new Map(input.parts.map((p) => [p.id, p]));
  const sheets = new Map(input.sheets.map((s) => [s.id, s]));
  const m = result.metrics;
  const count = result.layouts.length;
  const dateText = date.toLocaleDateString('cs-CZ');

  const unplaced = new Map<string, number>();
  for (const u of result.unplaced) {
    const key = `${parts.get(u.partId)?.name ?? u.partId} (${UNPLACED_REASON_LABEL[u.reason]})`;
    unplaced.set(key, (unplaced.get(key) ?? 0) + 1);
  }

  return createPortal(
    <div className="print-root">
      <style>{`@page { size: ${paper} landscape; margin: 10mm; }`}</style>
      <section className="print-page">
        <h1>Nářezový plán</h1>
        <p>
          {dateText} · tabulí: {count} · využití {formatPercent(m.utilization)} · odpad{' '}
          {formatPercent(m.waste)} · umístěno {m.placedCount} / {m.placedCount + m.unplacedCount} ks
          · rozestup {formatNumber(input.params.spacing)} mm
        </p>
        <table className="print-table">
          <thead>
            <tr>
              <th>Tabule</th>
              <th>Formát</th>
              <th>Rozměr (mm)</th>
              <th>Dílů</th>
              <th>Plocha dílů</th>
              <th>Využití</th>
            </tr>
          </thead>
          <tbody>
            {result.layouts.map((l, i) => {
              const sheet = sheets.get(l.sheetId);
              const sm = m.sheets[i];
              return (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>{sheet?.name ?? l.sheetId}</td>
                  <td>{sheet && `${formatNumber(sheet.width)} × ${formatNumber(sheet.height)}`}</td>
                  <td>{l.placements.length}</td>
                  <td>{sm && formatArea(sm.partArea)}</td>
                  <td>{sm && formatPercent(sm.utilization)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {unplaced.size > 0 && (
          <>
            <h2>Neumístěné díly</h2>
            <ul>
              {[...unplaced].map(([name, n]) => (
                <li key={name}>
                  {name}: {n} ks
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      {result.layouts.map((layout, i) => {
        const sheet = sheets.get(layout.sheetId);
        if (!sheet) return null;
        const legend = new Map<string, number>();
        for (const p of layout.placements) legend.set(p.partId, (legend.get(p.partId) ?? 0) + 1);
        const svg = writeSheetSvg(sheet, layout, input.parts, {
          colors,
          remnant: m.sheets[i]?.remnant ?? null,
          idPrefix: `tisk-${i}-`,
        });
        return (
          <section key={i} className="print-page">
            <header className="print-header">
              <strong>
                Tabule {i + 1} / {count}: {sheet.name}
              </strong>
              <span>
                {formatNumber(sheet.width)} × {formatNumber(sheet.height)} mm · využití{' '}
                {formatPercent(m.sheets[i]?.utilization ?? 0)} · {dateText}
              </span>
            </header>
            {/* SVG je z jádra; texty v něm jsou escapované (xmlEscape). */}
            <div className="print-plan" dangerouslySetInnerHTML={{ __html: svg }} />
            <ul className="print-legend">
              {[...legend].map(([id, n]) => {
                const part = parts.get(id);
                return (
                  <li key={id}>
                    <span className="swatch" style={{ background: colors.get(id) }} />
                    {part?.name ?? id} – {part && formatNumber(part.width, 2)} ×{' '}
                    {part && formatNumber(part.height, 2)} mm: {n} ks
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>,
    document.body,
  );
}
