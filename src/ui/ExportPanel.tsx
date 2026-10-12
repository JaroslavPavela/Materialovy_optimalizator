import {
  writeResultDxf,
  writeSheetDxf,
  zipFiles,
  sheetDxfFileName,
} from '../core/export/dxf-writer.ts';
import { useAppStore } from '../state/store.ts';
import { download } from './download.ts';

/** Výchozí název projektu v názvech exportovaných souborů. */
const PROJECT = 'narezovy-plan';
const DXF_TYPE = 'application/dxf';

/** Export plánu: DXF aktuální tabule, všechny tabule jako ZIP. */
export function ExportPanel() {
  const result = useAppStore((s) => s.result);
  const input = useAppStore((s) => s.resultInput);
  const active = useAppStore((s) => s.activeSheet);
  const running = useAppStore((s) => s.status === 'running');
  if (!result || !input || result.layouts.length === 0) return null;

  const count = result.layouts.length;
  const index = Math.min(active, count - 1);

  const exportSheet = () => {
    const layout = result.layouts[index]!;
    const sheet = input.sheets.find((s) => s.id === layout.sheetId);
    if (!sheet) return;
    download(
      sheetDxfFileName(PROJECT, index, count),
      writeSheetDxf(sheet, layout, input.parts),
      DXF_TYPE,
    );
  };

  const exportAll = () => {
    download(
      `${PROJECT}-dxf.zip`,
      zipFiles(writeResultDxf(input, result, PROJECT)),
      'application/zip',
    );
  };

  return (
    <section className="panel export">
      <h2>Export</h2>
      <div className="row">
        <button type="button" disabled={running} onClick={exportSheet}>
          DXF tabule {index + 1}
        </button>
        <button type="button" disabled={running} onClick={exportAll}>
          DXF všech tabulí (ZIP)
        </button>
      </div>
      <p className="muted hint">
        DXF R12 v mm: vrstvy TABULE, DILY, OTVORY, POPISKY. Oblouky zůstávají oblouky.
      </p>
    </section>
  );
}
