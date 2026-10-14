import type { ForbiddenZone, NestingMode, Sheet } from '../core/model.ts';
import { rectZone, useAppStore } from '../state/store.ts';
import { formatNumber } from './format.ts';
import { NumberInput } from './NumberInput.tsx';

/** Zóna zadaná jako obdélník: hodnoty pro editaci (x, y, šířka, výška). */
function zoneRect(z: ForbiddenZone) {
  const xs = z.polygon.map((p) => p.x);
  const ys = z.polygon.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function ZoneRow({ sheet, zone, index }: { sheet: Sheet; zone: ForbiddenZone; index: number }) {
  const updateZone = useAppStore((s) => s.updateZone);
  const removeZone = useAppStore((s) => s.removeZone);
  const r = zoneRect(zone);
  const set = (patch: Partial<typeof r>) => {
    const n = { ...r, ...patch };
    updateZone(sheet.id, zone.id, rectZone(zone.id, n.x, n.y, n.w, n.h));
  };
  const label = `zóny ${index + 1} tabule ${sheet.name}`;
  return (
    <div className="zone-row">
      <span>Zóna {index + 1}</span>
      <label>
        x{' '}
        <NumberInput
          label={`X ${label}`}
          value={r.x}
          onCommit={(v) => v !== null && set({ x: v })}
        />
      </label>
      <label>
        y{' '}
        <NumberInput
          label={`Y ${label}`}
          value={r.y}
          onCommit={(v) => v !== null && set({ y: v })}
        />
      </label>
      <label>
        š{' '}
        <NumberInput
          label={`Šířka ${label}`}
          value={r.w}
          min={0.001}
          onCommit={(v) => v !== null && set({ w: v })}
        />
      </label>
      <label>
        v{' '}
        <NumberInput
          label={`Výška ${label}`}
          value={r.h}
          min={0.001}
          onCommit={(v) => v !== null && set({ h: v })}
        />
      </label>
      <button
        type="button"
        className="icon"
        aria-label={`Odebrat ${label}`}
        onClick={() => removeZone(sheet.id, zone.id)}
      >
        ×
      </button>
    </div>
  );
}

function SheetCard({ sheet, index }: { sheet: Sheet; index: number }) {
  const updateSheet = useAppStore((s) => s.updateSheet);
  const removeSheet = useAppStore((s) => s.removeSheet);
  const addZone = useAppStore((s) => s.addZone);
  const saveSheetToLibrary = useAppStore((s) => s.saveSheetToLibrary);
  const canRemove = useAppStore((s) => s.sheets.length > 1);
  const n = index + 1;
  return (
    <fieldset className="sheet-card">
      <legend>
        <input
          aria-label={`Název tabule ${n}`}
          value={sheet.name}
          onChange={(e) => updateSheet(sheet.id, { name: e.target.value })}
        />
      </legend>
      <div className="grid sheet-fields">
        <label>
          Šířka (mm)
          <NumberInput
            label={`Šířka tabule ${n}`}
            value={sheet.width}
            min={1}
            onCommit={(v) => v !== null && updateSheet(sheet.id, { width: v })}
          />
        </label>
        <label>
          Výška (mm)
          <NumberInput
            label={`Výška tabule ${n}`}
            value={sheet.height}
            min={1}
            onCommit={(v) => v !== null && updateSheet(sheet.id, { height: v })}
          />
        </label>
        <label>
          Skladem (ks)
          <NumberInput
            label={`Počet tabulí ${n} skladem`}
            value={sheet.stock}
            min={0}
            integer
            allowEmpty
            placeholder="neomezeno"
            onCommit={(v) => updateSheet(sheet.id, { stock: v })}
          />
        </label>
        <label>
          Okraj (mm)
          <NumberInput
            label={`Okraj tabule ${n}`}
            value={sheet.margin}
            min={0}
            onCommit={(v) => v !== null && updateSheet(sheet.id, { margin: v })}
          />
        </label>
        <label>
          Materiál
          <input
            aria-label={`Materiál tabule ${n}`}
            value={sheet.material ?? ''}
            placeholder="libovolný"
            onChange={(e) => updateSheet(sheet.id, { material: e.target.value || undefined })}
          />
        </label>
        <label>
          Tloušťka (mm)
          <NumberInput
            label={`Tloušťka tabule ${n}`}
            value={sheet.thickness}
            min={0.001}
            allowEmpty
            placeholder="libovolná"
            onCommit={(v) => updateSheet(sheet.id, { thickness: v ?? undefined })}
          />
        </label>
      </div>
      {sheet.forbiddenZones.map((z, i) => (
        <ZoneRow key={z.id} sheet={sheet} zone={z} index={i} />
      ))}
      <div className="row">
        <button type="button" className="secondary" onClick={() => addZone(sheet.id)}>
          + Zakázaná zóna
        </button>
        <button type="button" className="secondary" onClick={() => saveSheetToLibrary(sheet.id)}>
          Uložit do knihovny
        </button>
        {canRemove && (
          <button type="button" className="secondary" onClick={() => removeSheet(sheet.id)}>
            Odebrat tabuli
          </button>
        )}
      </div>
    </fieldset>
  );
}

/** Uložené formáty tabulí – přidání do projektu a odebrání. */
function SheetLibrary() {
  const library = useAppStore((s) => s.sheetLibrary);
  const addSheetFromLibrary = useAppStore((s) => s.addSheetFromLibrary);
  const removeFromLibrary = useAppStore((s) => s.removeFromLibrary);
  if (library.length === 0) return null;
  return (
    <div className="library">
      <h3>Knihovna formátů</h3>
      <ul>
        {library.map((l) => (
          <li key={l.id}>
            <span>
              {l.name}{' '}
              <span className="muted">
                {formatNumber(l.width)} × {formatNumber(l.height)} mm
              </span>
            </span>
            <button
              type="button"
              className="secondary"
              aria-label={`Přidat formát ${l.name}`}
              onClick={() => addSheetFromLibrary(l.id)}
            >
              Přidat
            </button>
            <button
              type="button"
              className="icon"
              aria-label={`Odebrat formát ${l.name} z knihovny`}
              onClick={() => removeFromLibrary(l.id)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Formáty tabulí, zakázané zóny a parametry výpočtu. */
export function SheetSettings() {
  const sheets = useAppStore((s) => s.sheets);
  const addSheet = useAppStore((s) => s.addSheet);
  const params = useAppStore((s) => s.params);
  const setParams = useAppStore((s) => s.setParams);
  return (
    <>
      <section className="panel">
        <h2>Tabule</h2>
        {sheets.map((s, i) => (
          <SheetCard key={s.id} sheet={s} index={i} />
        ))}
        <button type="button" onClick={addSheet}>
          + Přidat formát
        </button>
        <SheetLibrary />
      </section>
      <section className="panel">
        <h2>Parametry</h2>
        <div className="grid">
          <label>
            Rozestup (mm)
            <NumberInput
              label="Rozestup"
              value={params.spacing}
              min={0}
              onCommit={(v) => v !== null && setParams({ spacing: v })}
            />
          </label>
          <label>
            Krok volné rotace (°)
            <NumberInput
              label="Krok volné rotace"
              value={params.freeRotationStep}
              min={1}
              onCommit={(v) => v !== null && setParams({ freeRotationStep: v })}
            />
          </label>
          <label className="wide">
            Režim skládání
            <select
              aria-label="Režim skládání"
              value={params.mode}
              onChange={(e) => setParams({ mode: e.target.value as NestingMode })}
            >
              <option value="rect">obdélníkový (rychlý)</option>
              <option value="shape">tvarový (skutečné tvary)</option>
            </select>
          </label>
          {params.mode === 'shape' && (
            <label>
              Časový limit (s)
              <NumberInput
                label="Časový limit"
                value={params.timeLimitMs / 1000}
                min={1}
                onCommit={(v) => v !== null && setParams({ timeLimitMs: Math.round(v * 1000) })}
              />
            </label>
          )}
        </div>
        {params.mode === 'shape' && (
          <p className="muted hint">
            Tvarový režim skládá díly podle skutečného obrysu a zkouší různá pořadí a natočení až do
            časového limitu. Výpočet lze kdykoli zastavit a použít nejlepší dosavadní plán.
          </p>
        )}
      </section>
    </>
  );
}
