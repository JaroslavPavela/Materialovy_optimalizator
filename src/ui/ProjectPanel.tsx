import { useRef, useState } from 'react';
import { serializeProject } from '../core/project.ts';
import { useAppStore } from '../state/store.ts';
import { download } from './download.ts';

/** Nový projekt, uložení a načtení projektu jako JSON. */
export function ProjectPanel() {
  const importProjectJson = useAppStore((s) => s.importProjectJson);
  const newProject = useAppStore((s) => s.newProject);
  const report = useAppStore((s) => s.projectReport);
  const [confirming, setConfirming] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const save = () => {
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    download(
      `narezovy-plan-${date}.json`,
      serializeProject(useAppStore.getState(), now),
      'application/json',
    );
  };

  const load = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    importProjectJson(file.name, await file.text());
  };

  return (
    <section className="panel">
      <h2>Projekt</h2>
      <div className="row">
        {confirming ? (
          <>
            <span>Smazat díly i tabule?</span>
            <button
              type="button"
              onClick={() => {
                newProject();
                setConfirming(false);
              }}
            >
              Ano, nový projekt
            </button>
            <button type="button" className="secondary" onClick={() => setConfirming(false)}>
              Zrušit
            </button>
          </>
        ) : (
          <>
            <button type="button" className="secondary" onClick={() => setConfirming(true)}>
              Nový projekt
            </button>
            <button type="button" className="secondary" onClick={save}>
              Uložit jako JSON
            </button>
            <button type="button" className="secondary" onClick={() => input.current?.click()}>
              Načíst JSON…
            </button>
          </>
        )}
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          aria-label="Soubor projektu JSON"
          hidden
          onChange={(e) => {
            void load(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      <p className="muted hint">Projekt se v prohlížeči ukládá automaticky.</p>
      {report && (
        <div
          className={!report.ok ? 'errors' : report.messages.length > 0 ? 'warnings' : ''}
          role="status"
        >
          <p>
            {report.fileName}: {report.ok ? 'projekt načten' : 'projekt nelze načíst'}.
          </p>
          {report.messages.length > 0 && (
            <ul>
              {report.messages.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
