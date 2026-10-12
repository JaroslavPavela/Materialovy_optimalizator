import { useAppStore } from '../state/store.ts';

/** Tlačítko Vypočítat, průběh, zastavení a chyby vstupu. */
export function CalculatePanel() {
  const status = useAppStore((s) => s.status);
  const progress = useAppStore((s) => s.progress);
  const issues = useAppStore((s) => s.issues);
  const error = useAppStore((s) => s.error);
  const stopped = useAppStore((s) => s.stopped);
  const hasParts = useAppStore((s) => s.parts.length > 0);
  const calculate = useAppStore((s) => s.calculate);
  const stop = useAppStore((s) => s.stop);
  const running = status === 'running';

  return (
    <section className="panel calculate">
      <div className="row">
        <button
          type="button"
          className="primary"
          disabled={running || !hasParts}
          onClick={() => void calculate()}
        >
          Vypočítat
        </button>
        {running && (
          <button type="button" className="secondary" onClick={() => void stop()}>
            Zastavit a použít nejlepší
          </button>
        )}
        {running && (
          <progress
            aria-label="Průběh výpočtu"
            max={progress?.total ?? 1}
            value={progress?.step ?? 0}
          />
        )}
        {!hasParts && <span className="muted">Nejdřív přidejte díly.</span>}
        {status === 'done' && stopped && (
          <span className="muted" role="status">
            Výpočet zastaven – zobrazen nejlepší dosavadní výsledek.
          </span>
        )}
      </div>
      {status === 'error' && (
        <div className="errors" role="alert">
          {error && <p>Výpočet selhal: {error}</p>}
          {issues.length > 0 && (
            <>
              <p>Zadání obsahuje chyby:</p>
              <ul>
                {issues.map((issue, i) => (
                  <li key={i}>{issue.message}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
