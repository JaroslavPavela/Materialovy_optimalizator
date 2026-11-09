import { useEffect, useId, useRef } from 'react';
import type { ImportReport } from '../state/store.ts';
import { reportSummary } from './labels.ts';

interface Props {
  /** Hlášení výkresů; zobrazí se jen ta s chybami nebo varováními. */
  readonly reports: readonly ImportReport[];
  readonly open: boolean;
  readonly onClose: () => void;
}

/**
 * Modální okno s chybami a varováními importu výkresů DXF/DWG (nativní
 * `<dialog>`: zavře se tlačítkem i klávesou Esc, jde otevřít znovu).
 */
export function ImportReportDialog({ reports, open, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);
  const shown = reports.filter((r) => r.errors.length > 0 || r.warnings.length > 0);

  return (
    <dialog ref={ref} className="report-dialog" aria-labelledby={titleId} onClose={onClose}>
      <h2 id={titleId}>Hlášení importu výkresů</h2>
      {shown.length === 0 && <p>Výkresy se načetly bez chyb a varování.</p>}
      {shown.map((r, i) => (
        <section key={i} className="report-file">
          <h3>{reportSummary(r)}</h3>
          {r.errors.length > 0 && (
            <div className="errors">
              <p>Chyby</p>
              <ul>
                {r.errors.map((e, k) => (
                  <li key={k}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          {r.warnings.length > 0 && (
            <div className="warnings">
              <p>Varování</p>
              <ul>
                {r.warnings.map((w, k) => (
                  <li key={k}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      ))}
      <div className="row report-dialog-actions">
        <button type="button" className="primary" onClick={onClose} autoFocus>
          Zavřít
        </button>
      </div>
    </dialog>
  );
}
