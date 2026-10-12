import { useRef, useState } from 'react';
import type { DxfPartMode } from '../core/import/dxf-parts.ts';
import { useAppStore } from '../state/store.ts';

const DXF_MODES: readonly { value: DxfPartMode; label: string }[] = [
  { value: 'single', label: '1 soubor = 1 díl' },
  { value: 'multi', label: 'více dílů v souboru' },
];

/** Nahrání dílů z CSV nebo DXF – přetažením nebo výběrem, i víc souborů najednou. */
export function FileDrop() {
  const importFiles = useAppStore((s) => s.importFiles);
  const reports = useAppStore((s) => s.importReports);
  const dxfMode = useAppStore((s) => s.dxfMode);
  const setDxfMode = useAppStore((s) => s.setDxfMode);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const files = await Promise.all(
      [...list].map(async (f) => ({ name: f.name, data: await f.arrayBuffer() })),
    );
    importFiles(files);
  };

  return (
    <section className="panel">
      <h2>Díly z CSV nebo DXF</h2>
      <div
        className={`drop ${over ? 'over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void load(e.dataTransfer.files);
        }}
      >
        <p>Přetáhněte sem soubory CSV nebo DXF, nebo</p>
        <button type="button" onClick={() => input.current?.click()}>
          Vybrat soubory…
        </button>
        <input
          ref={input}
          type="file"
          multiple
          accept=".csv,.tsv,.txt,.dxf,text/csv"
          aria-label="Soubory s díly"
          hidden
          onChange={(e) => {
            void load(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      <fieldset className="dxf-mode">
        <legend>DXF</legend>
        {DXF_MODES.map((m) => (
          <label key={m.value}>
            <input
              type="radio"
              name="dxf-mode"
              value={m.value}
              checked={dxfMode === m.value}
              onChange={() => setDxfMode(m.value)}
            />{' '}
            {m.label}
          </label>
        ))}
      </fieldset>
      <p className="muted hint">CSV nahradí seznam dílů, díly z DXF se přidají.</p>
      {reports.map((r, i) => (
        <div key={i} className="import-report" role="status">
          <p>
            {r.fileName}: načteno {r.partCount} dílů
            {r.errors.length > 0 && `, ${r.errors.length} chyb`}
            {r.warnings.length > 0 && `, ${r.warnings.length} varování`}.
          </p>
          {r.errors.length > 0 && (
            <ul className="errors">
              {r.errors.map((e, k) => (
                <li key={k}>{e}</li>
              ))}
            </ul>
          )}
          {r.warnings.length > 0 && (
            <ul className="warnings">
              {r.warnings.map((w, k) => (
                <li key={k}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}
