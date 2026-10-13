import { useState } from 'react';
import { flushSync } from 'react-dom';
import { writeResultCsv } from '../core/export/csv.ts';
import { writeResultDxf, writeSheetDxf } from '../core/export/dxf-writer.ts';
import { safeFileStem, sheetFileName, zipFiles } from '../core/export/files.ts';
import { partColors, writeResultSvg, writeSheetSvg } from '../core/export/svg.ts';
import { useAppStore } from '../state/store.ts';
import { download } from './download.ts';
import { PrintView, type PaperSize } from './PrintView.tsx';
import { useSheetGroups } from './useSheetGroups.ts';

/** Výchozí název projektu v názvech exportovaných souborů. */
const PROJECT = 'narezovy-plan';
const DXF_TYPE = 'application/dxf';
const SVG_TYPE = 'image/svg+xml';
const ZIP_TYPE = 'application/zip';
const CSV_TYPE = 'text/csv;charset=utf-8';

/** Export plánu: DXF a SVG aktuální tabule nebo všech (ZIP), CSV seznam dílů, tisk a PDF. */
export function ExportPanel() {
  const result = useAppStore((s) => s.result);
  const input = useAppStore((s) => s.resultInput);
  const grouped = useAppStore((s) => s.groupSheets);
  const { groups, active: index } = useSheetGroups();
  const running = useAppStore((s) => s.status === 'running');
  const [paper, setPaper] = useState<PaperSize>('A4');
  const [printDate, setPrintDate] = useState<Date | null>(null);
  if (!result || !input || result.layouts.length === 0) return null;

  // Číslování a soubory po skupinách; bez seskupení je každá tabule skupinou.
  const count = groups.length;
  const layoutIndex = groups[index]!.indices[0]!;
  const copies = groups[index]!.indices.length;
  const layout = result.layouts[layoutIndex]!;
  const sheet = input.sheets.find((s) => s.id === layout.sheetId);
  const remnant = result.metrics.sheets[layoutIndex]?.remnant ?? null;
  // Seskupený CSV a tisk jen tehdy, když se nějaká tabule opakuje.
  const repeated = grouped && count < result.layouts.length ? groups : undefined;
  const sheetLabel = `tabule ${index + 1}${copies > 1 ? ` (× ${copies})` : ''}`;

  const exportDxf = () => {
    if (!sheet) return;
    download(
      sheetFileName(PROJECT, index, count, 'dxf', copies),
      writeSheetDxf(sheet, layout, input.parts, { remnant }),
      DXF_TYPE,
    );
  };
  const exportSvg = () => {
    if (!sheet) return;
    const svg = writeSheetSvg(sheet, layout, input.parts, {
      colors: partColors(input.parts),
      remnant,
    });
    download(
      sheetFileName(PROJECT, index, count, 'svg', copies),
      `<?xml version="1.0" encoding="UTF-8"?>\n${svg}\n`,
      SVG_TYPE,
    );
  };
  const print = () => {
    // Tisková podoba se vykreslí synchronně, aby ji dialog tisku už viděl.
    flushSync(() => setPrintDate(new Date()));
    window.print();
    setPrintDate(null);
  };

  return (
    <section className="panel export">
      <h2>Export</h2>
      <div className="row">
        <button type="button" disabled={running || !sheet} onClick={exportDxf}>
          DXF {sheetLabel}
        </button>
        <button
          type="button"
          disabled={running}
          onClick={() =>
            download(
              `${PROJECT}-dxf.zip`,
              zipFiles(writeResultDxf(input, result, PROJECT, {}, groups)),
              ZIP_TYPE,
            )
          }
        >
          DXF všech tabulí (ZIP)
        </button>
      </div>
      <div className="row">
        <button type="button" disabled={running || !sheet} onClick={exportSvg}>
          SVG {sheetLabel}
        </button>
        <button
          type="button"
          disabled={running}
          onClick={() =>
            download(
              `${PROJECT}-svg.zip`,
              zipFiles(writeResultSvg(input, result, PROJECT, groups)),
              ZIP_TYPE,
            )
          }
        >
          SVG všech tabulí (ZIP)
        </button>
      </div>
      <div className="row">
        <button
          type="button"
          disabled={running}
          onClick={() =>
            download(
              `${safeFileStem(PROJECT)}-dily.csv`,
              writeResultCsv(input, result, repeated),
              CSV_TYPE,
            )
          }
        >
          CSV seznam dílů
        </button>
      </div>
      <div className="row">
        <select
          aria-label="Formát papíru"
          value={paper}
          onChange={(e) => setPaper(e.target.value as PaperSize)}
        >
          <option value="A4">A4 na šířku</option>
          <option value="A3">A3 na šířku</option>
        </select>
        <button type="button" disabled={running} onClick={print}>
          Tisk / PDF
        </button>
      </div>
      <p className="muted hint">
        DXF R12 v mm: vrstvy TABULE, DILY, OTVORY, POPISKY; oblouky zůstávají oblouky. PDF vytvoříte
        tiskem do PDF.
        {repeated &&
          ' Stejné tabule se exportují jednou, počet opakování je v názvu souboru (např. -4x).'}
      </p>
      {printDate && (
        <PrintView input={input} result={result} groups={repeated} paper={paper} date={printDate} />
      )}
    </section>
  );
}
