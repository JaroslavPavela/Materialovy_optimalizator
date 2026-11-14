import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { writeResultCsv } from '../core/export/csv.ts';
import { DXF_VERSIONS, type DxfVersion } from '../core/export/dxf-writer.ts';
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

const DXF_VERSION_LABELS: Record<DxfVersion, string> = {
  '2018': 'DXF 2018',
  '2000': 'DXF 2000',
  R12: 'DXF R12',
};

/** Export plánu: DXF a SVG aktuální tabule nebo všech (ZIP), CSV seznam dílů, tisk a PDF. */
export function ExportPanel() {
  const result = useAppStore((s) => s.result);
  const input = useAppStore((s) => s.resultInput);
  const grouped = useAppStore((s) => s.groupSheets);
  const { groups, active: index } = useSheetGroups();
  const running = useAppStore((s) => s.status === 'running');
  const dxfVersion = useAppStore((s) => s.dxfVersion);
  const setDxfVersion = useAppStore((s) => s.setDxfVersion);
  const exportFiles = useAppStore((s) => s.exportDxf);
  const [dxfBusy, setDxfBusy] = useState(false);
  const [dxfError, setDxfError] = useState<string | null>(null);
  const [paper, setPaper] = useState<PaperSize>('A4');
  const [printDate, setPrintDate] = useState<Date | null>(null);
  const printing = useRef(false);
  // Tisk z nabídky prohlížeče (Ctrl+P) i tam, kde `print()` neblokuje: tisková
  // podoba vznikne před tiskem a zmizí až po něm.
  useEffect(() => {
    const before = () => {
      printing.current = true;
      flushSync(() => setPrintDate(new Date()));
    };
    const after = () => {
      printing.current = false;
      setPrintDate(null);
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);
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

  /** DXF ve zvolené verzi – 2000 a 2018 se zapisují ve workeru (asynchronně). */
  const runDxf = async (all: boolean) => {
    setDxfBusy(true);
    setDxfError(null);
    try {
      const files = await exportFiles(PROJECT, groups, all ? undefined : index);
      // Během zápisu doběhl nový výpočet – soubor ze starého výsledku nestahovat.
      if (useAppStore.getState().result !== result) return;
      if (all) download(`${PROJECT}-dxf.zip`, zipFiles(files), ZIP_TYPE);
      else if (files[0]) download(files[0].name, files[0].content, DXF_TYPE);
    } catch (e) {
      setDxfError(e instanceof Error ? e.message : String(e));
    } finally {
      setDxfBusy(false);
    }
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
    // Tisk ještě běží (`print()` neblokuje) – podobu odebere až `afterprint`.
    if (!printing.current) setPrintDate(null);
  };

  return (
    <section className="panel export">
      <h2>Export</h2>
      <div className="row">
        <select
          aria-label="Verze DXF"
          value={dxfVersion}
          onChange={(e) => setDxfVersion(e.target.value as DxfVersion)}
        >
          {DXF_VERSIONS.map((v) => (
            <option key={v} value={v}>
              {DXF_VERSION_LABELS[v]}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={running || !sheet || dxfBusy}
          onClick={() => void runDxf(false)}
        >
          DXF {sheetLabel}
        </button>
        <button type="button" disabled={running || dxfBusy} onClick={() => void runDxf(true)}>
          DXF všech tabulí (ZIP)
        </button>
      </div>
      {dxfError && (
        <p className="errors" role="alert">
          Export DXF selhal: {dxfError}
        </p>
      )}
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
        DXF v mm: vrstvy TABULE, POPISKY a díly na hladinách z výkresu (díly z CSV na DILY a
        OTVORY); oblouky zůstávají oblouky. Verze 2018 a 2000 zachovají názvy hladin s diakritikou,
        R12 je pro starší CAM (názvy vrstev bez diakritiky). PDF vytvoříte tiskem do PDF.
        {repeated &&
          ' Stejné tabule se exportují jednou, počet opakování je v názvu souboru (např. -4x).'}
      </p>
      {printDate && (
        <PrintView input={input} result={result} groups={repeated} paper={paper} date={printDate} />
      )}
    </section>
  );
}
