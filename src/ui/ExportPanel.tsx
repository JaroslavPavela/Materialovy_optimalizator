import { useState } from 'react';
import { flushSync } from 'react-dom';
import { writeResultCsv } from '../core/export/csv.ts';
import { writeResultDxf, writeSheetDxf } from '../core/export/dxf-writer.ts';
import { safeFileStem, sheetFileName, zipFiles } from '../core/export/files.ts';
import { partColors, writeResultSvg, writeSheetSvg } from '../core/export/svg.ts';
import { useAppStore } from '../state/store.ts';
import { download } from './download.ts';
import { PrintView, type PaperSize } from './PrintView.tsx';

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
  const active = useAppStore((s) => s.activeSheet);
  const running = useAppStore((s) => s.status === 'running');
  const [paper, setPaper] = useState<PaperSize>('A4');
  const [printDate, setPrintDate] = useState<Date | null>(null);
  if (!result || !input || result.layouts.length === 0) return null;

  const count = result.layouts.length;
  const index = Math.min(active, count - 1);
  const layout = result.layouts[index]!;
  const sheet = input.sheets.find((s) => s.id === layout.sheetId);

  const exportDxf = () => {
    if (!sheet) return;
    download(
      sheetFileName(PROJECT, index, count, 'dxf'),
      writeSheetDxf(sheet, layout, input.parts, {
        remnant: result.metrics.sheets[index]?.remnant ?? null,
      }),
      DXF_TYPE,
    );
  };
  const exportSvg = () => {
    if (!sheet) return;
    const svg = writeSheetSvg(sheet, layout, input.parts, {
      colors: partColors(input.parts),
      remnant: result.metrics.sheets[index]?.remnant ?? null,
    });
    download(
      sheetFileName(PROJECT, index, count, 'svg'),
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
          DXF tabule {index + 1}
        </button>
        <button
          type="button"
          disabled={running}
          onClick={() =>
            download(
              `${PROJECT}-dxf.zip`,
              zipFiles(writeResultDxf(input, result, PROJECT)),
              ZIP_TYPE,
            )
          }
        >
          DXF všech tabulí (ZIP)
        </button>
      </div>
      <div className="row">
        <button type="button" disabled={running || !sheet} onClick={exportSvg}>
          SVG tabule {index + 1}
        </button>
        <button
          type="button"
          disabled={running}
          onClick={() =>
            download(
              `${PROJECT}-svg.zip`,
              zipFiles(writeResultSvg(input, result, PROJECT)),
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
            download(`${safeFileStem(PROJECT)}-dily.csv`, writeResultCsv(input, result), CSV_TYPE)
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
      </p>
      {printDate && <PrintView input={input} result={result} paper={paper} date={printDate} />}
    </section>
  );
}
