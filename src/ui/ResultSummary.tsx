import { UNPLACED_REASON_LABEL, type UnplacedReason } from '../core/model.ts';
import { useAppStore } from '../state/store.ts';
import { formatArea, formatPercent } from './format.ts';

/** Souhrn výsledku: využití, odpad, počty tabulí a neumístěné díly. */
export function ResultSummary() {
  const result = useAppStore((s) => s.result);
  const input = useAppStore((s) => s.resultInput);
  const stale = useAppStore(
    (s) =>
      s.resultInput !== null &&
      (s.resultInput.parts !== s.parts ||
        s.resultInput.sheets !== s.sheets ||
        s.resultInput.params !== s.params),
  );
  if (!result || !input) return null;

  const m = result.metrics;
  const partArea = m.sheets.reduce((sum, s) => sum + s.partArea, 0);
  const sheetArea = m.sheets.reduce((sum, s) => sum + s.sheetArea, 0);

  const names = new Map(input.parts.map((p) => [p.id, p.name]));
  const unplaced = new Map<string, { name: string; reason: UnplacedReason; count: number }>();
  for (const u of result.unplaced) {
    const key = `${u.partId}\u0000${u.reason}`;
    const entry = unplaced.get(key);
    if (entry) entry.count++;
    else unplaced.set(key, { name: names.get(u.partId) ?? u.partId, reason: u.reason, count: 1 });
  }

  return (
    <section className="panel summary" aria-label="Souhrn výsledku">
      {stale && (
        <p className="muted" role="status">
          Zadání se od výpočtu změnilo – pro aktuální plán spusťte výpočet znovu.
        </p>
      )}
      <dl className="metrics">
        <div>
          <dt>Využití</dt>
          <dd data-testid="utilization">{formatPercent(m.utilization)}</dd>
        </div>
        <div>
          <dt>Odpad</dt>
          <dd>{formatPercent(m.waste)}</dd>
        </div>
        <div>
          <dt>Tabulí</dt>
          <dd>{result.layouts.length}</dd>
        </div>
        <div>
          <dt>Umístěno</dt>
          <dd>
            {m.placedCount} / {m.placedCount + m.unplacedCount} ks
          </dd>
        </div>
        <div>
          <dt>Plocha dílů / tabulí</dt>
          <dd>
            {formatArea(partArea)} / {formatArea(sheetArea)}
          </dd>
        </div>
      </dl>
      {unplaced.size > 0 && (
        <div className="warnings">
          <p>Neumístěné díly:</p>
          <ul>
            {[...unplaced.values()].map((u, i) => (
              <li key={i}>
                {u.name} – {u.count} ks ({UNPLACED_REASON_LABEL[u.reason]})
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
