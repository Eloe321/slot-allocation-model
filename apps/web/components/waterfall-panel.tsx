import type { Trace, Split } from '@/lib/types';

const STEP_LABEL: Record<string, string> = {
  primary: 'own row',
  partner_pool: 'partner pool',
  online_remainder: 'online remainder',
};

function rowName(row: Trace['candidates'][number]['row']): string {
  return row.ownerName ? `${row.channel} · ${row.ownerName}` : row.channel;
}

export function WaterfallPanel({
  trace,
  splits,
}: {
  trace: Trace | null;
  splits: Split[] | null;
}) {
  if (!trace) {
    return (
      <section className="panel" aria-labelledby="wf-heading">
        <div className="panel-head">
          <h2 id="wf-heading">Waterfall</h2>
        </div>
        <p className="empty">
          Choose an identity and preview it. The waterfall resolves who is asking
          into an ordered list of rows they may draw from, and shows why each
          candidate was included or skipped.
        </p>
      </section>
    );
  }

  const takenFrom = new Map((splits ?? []).map((s) => [s.rowId, s.quantity]));

  return (
    <section className="panel" aria-labelledby="wf-heading">
      <div className="panel-head">
        <h2 id="wf-heading">Waterfall</h2>
        <p className="panel-note">
          {/* A reserve response carries the pre-reservation trace, which has no
              `available` total; only the preview endpoint computes one. */}
          {typeof trace.available === 'number' ? (
            <>
              <span className="num">{trace.available}</span> reachable
            </>
          ) : (
            'as reserved'
          )}
          {trace.freeForAll ? ' · free-for-all' : ''}
        </p>
      </div>

      <ol className="steps">
        {trace.candidates.map((c, i) => (
          <li key={c.row.id} data-taken={takenFrom.has(c.row.id) || undefined}>
            <span className="step-index num">{i + 1}</span>
            <span className="step-body">
              <span className="step-name">{rowName(c.row)}</span>
              <span className="step-meta">
                {STEP_LABEL[c.step] ?? c.step} ·{' '}
                <span className="num">
                  {c.row.allocatedSlots - c.row.soldSlots - c.row.heldSlots}
                </span>{' '}
                free
              </span>
            </span>
            {takenFrom.has(c.row.id) ? (
              <span className="step-take num">took {takenFrom.get(c.row.id)}</span>
            ) : null}
          </li>
        ))}
        {trace.candidates.length === 0 ? (
          <li className="step-none">No row is reachable for this identity.</li>
        ) : null}
      </ol>

      {trace.skipped.length > 0 ? (
        <ul className="skipped">
          {trace.skipped.map((s, i) => (
            <li key={i}>
              <span className="skip-step">{STEP_LABEL[s.step] ?? s.step}</span>
              <span className="skip-reason">{s.reason}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
