import { useMemo, useRef, useState } from 'react';
import type { DxfPartMode } from '../core/import/dxf-parts.ts';
import { layerRole, LAYER_ROLES, type LayerRole } from '../core/import/layers.ts';
import { drawingInUse } from '../state/drawings.ts';
import { useAppStore } from '../state/store.ts';

const DXF_MODES: readonly { value: DxfPartMode; label: string }[] = [
  { value: 'single', label: '1 soubor = 1 díl' },
  { value: 'multi', label: 'více dílů v souboru' },
];

const ROLE_LABELS: Record<LayerRole, string> = {
  outer: 'vnější obrys',
  inner: 'vnitřní obrys',
  attach: 'přidej k dílu',
  ignore: 'ignoruj',
};

/**
 * Hladiny načtených výkresů s volbou role. Změna role díly z výkresů hned
 * znovu načte; role se pamatují podle názvu hladiny i pro další výkresy.
 */
function LayerRolesTable() {
  const drawings = useAppStore((s) => s.drawings);
  const parts = useAppStore((s) => s.parts);
  const roles = useAppStore((s) => s.layerRoles);
  const setLayerRole = useAppStore((s) => s.setLayerRole);
  const notesFromAll = useAppStore((s) => s.notesFromAllLayers);
  const setNotesFromAll = useAppStore((s) => s.setNotesFromAllLayers);
  const layers = useMemo(() => {
    const count = new Map<string, { segments: number; texts: number }>();
    for (const d of drawings) {
      if (!drawingInUse(d, parts)) continue;
      for (const l of d.layers) {
        const c = count.get(l.name) ?? { segments: 0, texts: 0 };
        count.set(l.name, { segments: c.segments + l.segments, texts: c.texts + l.texts });
      }
    }
    return [...count].sort(([a], [b]) => a.localeCompare(b, 'cs'));
  }, [drawings, parts]);
  if (layers.length === 0) return null;

  return (
    <fieldset className="layer-roles">
      <legend>Hladiny výkresů</legend>
      <table>
        <thead>
          <tr>
            <th>Hladina</th>
            <th className="num">Segmentů</th>
            <th className="num">Textů</th>
            <th>Použít jako</th>
          </tr>
        </thead>
        <tbody>
          {layers.map(([name, count]) => (
            <tr key={name}>
              <td>{name}</td>
              <td className="num">{count.segments}</td>
              <td className="num">{count.texts}</td>
              <td>
                <select
                  aria-label={`Role hladiny ${name}`}
                  value={layerRole(roles, name)}
                  onChange={(e) => void setLayerRole(name, e.target.value as LayerRole)}
                >
                  {LAYER_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <label className="notes-option">
        <input
          type="checkbox"
          checked={notesFromAll}
          onChange={(e) => void setNotesFromAll(e.target.checked)}
        />{' '}
        Přenášet texty i z hladin obrysů
      </label>
      <p className="muted hint">
        Vnější obrys: otvory se poznají podle vnoření. Vnitřní obrys: kontury jsou jen otvory.
        Přidej k dílu: geometrie (gravírování, ohyby) i texty jedou s dílem, skládání je nebere v
        úvahu. Export DXF zachová názvy hladin. Volba se pamatuje pro další výkresy.
      </p>
    </fieldset>
  );
}

/** Nahrání dílů z CSV, DXF nebo DWG – přetažením nebo výběrem, i víc souborů najednou. */
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
    await importFiles(files);
  };

  return (
    <section className="panel">
      <h2>Díly z CSV, DXF nebo DWG</h2>
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
        <p>Přetáhněte sem soubory CSV, DXF nebo DWG, nebo</p>
        <button type="button" onClick={() => input.current?.click()}>
          Vybrat soubory…
        </button>
        <input
          ref={input}
          type="file"
          multiple
          accept=".csv,.tsv,.txt,.dxf,.dwg,text/csv"
          aria-label="Soubory s díly"
          hidden
          onChange={(e) => {
            void load(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      <fieldset className="dxf-mode">
        <legend>DXF a DWG</legend>
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
      <p className="muted hint">
        CSV nahradí seznam dílů, díly z DXF a DWG se přidají. Při více dílech v souboru se díl
        pojmenuje podle textu uvnitř obrysu (největší písmo); stejné díly se stejným textem se
        sečtou.
      </p>
      <LayerRolesTable />
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
