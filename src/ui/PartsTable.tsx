import { useRef, useState } from 'react';
import type { RotationMode } from '../core/model.ts';
import { useAppStore, type BulkPartPatch } from '../state/store.ts';
import { ROTATION_LABEL } from './labels.ts';
import { formatNumber } from './format.ts';
import { NumberInput } from './NumberInput.tsx';

/** Editovatelná tabulka dílů. */
export function PartsTable() {
  const parts = useAppStore((s) => s.parts);
  const updatePart = useAppStore((s) => s.updatePart);
  const removePart = useAppStore((s) => s.removePart);
  const addPart = useAppStore((s) => s.addPart);
  const clearParts = useAppStore((s) => s.clearParts);
  const updateParts = useAppStore((s) => s.updateParts);
  const removeParts = useAppStore((s) => s.removeParts);
  const total = parts.reduce((n, p) => n + p.quantity, 0);

  // Výběr řádků je jen stav UI; ID odebraných dílů se ignorují.
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const lastClicked = useRef<number | null>(null);
  const selectedIds = parts.filter((p) => selection.has(p.id)).map((p) => p.id);
  const allSelected = parts.length > 0 && selectedIds.length === parts.length;

  const toggle = (index: number, checked: boolean, range: boolean) => {
    const next = new Set(selectedIds);
    const from = range && lastClicked.current !== null ? lastClicked.current : index;
    for (let k = Math.min(from, index); k <= Math.max(from, index); k++) {
      const id = parts[k]!.id;
      if (checked) next.add(id);
      else next.delete(id);
    }
    lastClicked.current = index;
    setSelection(next);
  };

  return (
    <section className="panel">
      <h2>
        Díly{' '}
        <span className="muted">
          ({parts.length} druhů, {total} ks)
        </span>
      </h2>
      {parts.length > 0 && (
        <BulkEdit
          count={selectedIds.length || parts.length}
          selected={selectedIds.length > 0}
          onApply={(patch) =>
            updateParts(selectedIds.length > 0 ? selectedIds : parts.map((p) => p.id), patch)
          }
          onRemove={() => {
            removeParts(selectedIds);
            setSelection(new Set());
          }}
          onClearSelection={() => setSelection(new Set())}
        />
      )}
      <div className="table-wrap">
        <table className="parts">
          <thead>
            <tr>
              <th className="select">
                <input
                  type="checkbox"
                  aria-label="Vybrat všechny díly"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = selectedIds.length > 0 && !allSelected;
                  }}
                  onChange={() => setSelection(new Set(allSelected ? [] : parts.map((p) => p.id)))}
                />
              </th>
              <th className="name">Název</th>
              <th>Šířka</th>
              <th>Výška</th>
              <th>Počet</th>
              <th>Rotace</th>
              <th>Materiál</th>
              <th>Tl.</th>
              <th className="actions" aria-label="Akce" />
            </tr>
          </thead>
          <tbody>
            {parts.map((p, i) => (
              <tr key={p.id} className={selection.has(p.id) ? 'selected' : undefined}>
                <td className="select">
                  <input
                    type="checkbox"
                    aria-label={`Vybrat díl ${i + 1}`}
                    title="Shift + klik vybere rozsah"
                    checked={selection.has(p.id)}
                    onChange={(e) =>
                      toggle(
                        i,
                        e.target.checked,
                        'shiftKey' in e.nativeEvent && (e.nativeEvent as MouseEvent).shiftKey,
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    aria-label={`Název dílu ${i + 1}`}
                    value={p.name}
                    onChange={(e) => updatePart(p.id, { name: e.target.value })}
                  />
                </td>
                {p.shape ? (
                  // Rozměry tvaru z DXF/DWG plynou z obrysu – needitují se.
                  <>
                    <td className="num-ro" title="Rozměr obalového obdélníku tvaru z výkresu">
                      <span aria-label={`Šířka dílu ${i + 1}`}>{formatNumber(p.width, 2)}</span>
                    </td>
                    <td className="num-ro" title="Rozměr obalového obdélníku tvaru z výkresu">
                      <span aria-label={`Výška dílu ${i + 1}`}>{formatNumber(p.height, 2)}</span>
                    </td>
                  </>
                ) : (
                  <>
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
                  </>
                )}
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
                <td className="actions">
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

interface BulkEditProps {
  /** Počet dílů, kterých se úprava týká. */
  readonly count: number;
  /** `true` = týká se vybraných dílů, jinak všech. */
  readonly selected: boolean;
  readonly onApply: (patch: BulkPartPatch) => void;
  readonly onRemove: () => void;
  readonly onClearSelection: () => void;
}

/** Hromadná úprava vybraných dílů (bez výběru všech). Prázdné pole = beze změny. */
function BulkEdit({ count, selected, onApply, onRemove, onClearSelection }: BulkEditProps) {
  const [rotation, setRotation] = useState<RotationMode | ''>('');
  const [quantity, setQuantity] = useState<number | null>(null);
  const [material, setMaterial] = useState('');
  const [thickness, setThickness] = useState<number | null>(null);

  const patch: BulkPartPatch = {
    ...(rotation && { rotation }),
    ...(quantity !== null && { quantity }),
    ...(material.trim() && { material: material.trim() }),
    ...(thickness !== null && { thickness }),
  };
  const empty = Object.keys(patch).length === 0;
  const target = selected ? `vybrané (${count})` : `všechny (${count})`;

  return (
    <form
      className="bulk-edit"
      aria-label="Hromadná úprava dílů"
      onSubmit={(e) => {
        e.preventDefault();
        if (empty) return;
        onApply(patch);
        setRotation('');
        setQuantity(null);
        setMaterial('');
        setThickness(null);
      }}
    >
      <span className="bulk-title">Hromadně:</span>
      <label>
        Rotace{' '}
        <select
          aria-label="Hromadně rotace"
          value={rotation}
          onChange={(e) => setRotation(e.target.value as RotationMode | '')}
        >
          <option value="">beze změny</option>
          {(Object.keys(ROTATION_LABEL) as RotationMode[]).map((r) => (
            <option key={r} value={r}>
              {ROTATION_LABEL[r]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Počet{' '}
        <NumberInput
          label="Hromadně počet"
          value={quantity}
          min={1}
          integer
          allowEmpty
          placeholder="—"
          onCommit={setQuantity}
        />
      </label>
      <label>
        Materiál{' '}
        <input
          aria-label="Hromadně materiál"
          value={material}
          placeholder="beze změny"
          onChange={(e) => setMaterial(e.target.value)}
        />
      </label>
      <label>
        Tl.{' '}
        <NumberInput
          label="Hromadně tloušťka"
          value={thickness}
          min={0.001}
          allowEmpty
          placeholder="—"
          onCommit={setThickness}
        />
      </label>
      <button type="submit" disabled={empty}>
        Použít na {target}
      </button>
      {selected && (
        <>
          <button type="button" className="secondary" onClick={onRemove}>
            Odebrat vybrané
          </button>
          <button type="button" className="secondary" onClick={onClearSelection}>
            Zrušit výběr
          </button>
        </>
      )}
    </form>
  );
}
