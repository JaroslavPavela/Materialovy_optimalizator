import { useRef, useState } from 'react';
import { useAppStore } from '../state/store.ts';

/** Nahrání CSV s díly – přetažením nebo výběrem souboru. */
export function FileDrop() {
  const importCsv = useAppStore((s) => s.importCsv);
  const report = useAppStore((s) => s.importReport);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    importCsv(file.name, await file.arrayBuffer());
  };

  return (
    <section className="panel">
      <h2>Díly z CSV</h2>
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
        <p>Přetáhněte sem soubor CSV, nebo</p>
        <button type="button" onClick={() => input.current?.click()}>
          Vybrat soubor…
        </button>
        <input
          ref={input}
          type="file"
          accept=".csv,.tsv,.txt,text/csv"
          aria-label="Soubor CSV s díly"
          hidden
          onChange={(e) => {
            void load(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {report && (
        <div className="import-report" role="status">
          <p>
            {report.fileName}: načteno {report.partCount} dílů
            {report.errors.length > 0 && `, ${report.errors.length} chyb`}
            {report.warnings.length > 0 && `, ${report.warnings.length} varování`}.
          </p>
          {report.errors.length > 0 && (
            <ul className="errors">
              {report.errors.map((e, i) => (
                <li key={i}>{e.message}</li>
              ))}
            </ul>
          )}
          {report.warnings.length > 0 && (
            <ul className="warnings">
              {report.warnings.map((w, i) => (
                <li key={i}>{w.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
