import type { RotationMode } from '../core/model.ts';
import { useAppStore } from '../state/store.ts';
import { ROTATION_LABEL } from './labels.ts';
import { NumberInput } from './NumberInput.tsx';

/** Editovatelná tabulka dílů. */
export function PartsTable() {
  const parts = useAppStore((s) => s.parts);
  const updatePart = useAppStore((s) => s.updatePart);
  const removePart = useAppStore((s) => s.removePart);
  const addPart = useAppStore((s) => s.addPart);
  const clearParts = useAppStore((s) => s.clearParts);
  const total = parts.reduce((n, p) => n + p.quantity, 0);

  return (
    <section className="panel">
      <h2>
        Díly{' '}
        <span className="muted">
          ({parts.length} druhů, {total} ks)
        </span>
      </h2>
      <div className="table-wrap">
        <table className="parts">
          <thead>
            <tr>
              <th>Název</th>
              <th>Šířka</th>
              <th>Výška</th>
              <th>Počet</th>
              <th>Rotace</th>
              <th>Materiál</th>
              <th>Tl.</th>
              <th aria-label="Akce" />
            </tr>
          </thead>
          <tbody>
            {parts.map((p, i) => (
              <tr key={p.id}>
                <td>
                  <input
                    aria-label={`Název dílu ${i + 1}`}
                    value={p.name}
                    onChange={(e) => updatePart(p.id, { name: e.target.value })}
                  />
                </td>
                <td>
                  <NumberInput
                    label={`Šířka dílu ${i + 1}`}
                    value={p.width}
                    min={0.001}
                    onCommit={(v) => v !== null && updatePart(p.id, { width: v })}
                  />
                </td>
                <td>
                  <NumberInput
                    label={`Výška dílu ${i + 1}`}
                    value={p.height}
                    min={0.001}
                    onCommit={(v) => v !== null && updatePart(p.id, { height: v })}
                  />
                </td>
                <td>
                  <NumberInput
                    label={`Počet dílu ${i + 1}`}
                    value={p.quantity}
                    min={1}
                    integer
                    onCommit={(v) => v !== null && updatePart(p.id, { quantity: v })}
                  />
                </td>
                <td>
                  <select
                    aria-label={`Rotace dílu ${i + 1}`}
                    value={p.rotation}
                    onChange={(e) => updatePart(p.id, { rotation: e.target.value as RotationMode })}
                  >
                    {(Object.keys(ROTATION_LABEL) as RotationMode[]).map((r) => (
                      <option key={r} value={r}>
                        {ROTATION_LABEL[r]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    aria-label={`Materiál dílu ${i + 1}`}
                    value={p.material ?? ''}
                    onChange={(e) => updatePart(p.id, { material: e.target.value || undefined })}
                  />
                </td>
                <td>
                  <NumberInput
                    label={`Tloušťka dílu ${i + 1}`}
                    value={p.thickness}
                    min={0.001}
                    allowEmpty
                    onCommit={(v) => updatePart(p.id, { thickness: v ?? undefined })}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="icon"
                    aria-label={`Odebrat díl ${i + 1}`}
                    onClick={() => removePart(p.id)}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row">
        <button type="button" onClick={addPart}>
          + Přidat díl
        </button>
        {parts.length > 0 && (
          <button type="button" className="secondary" onClick={clearParts}>
            Smazat vše
          </button>
        )}
      </div>
    </section>
  );
}
