import type { LedgerEntry } from '@/lib/types';

export function LedgerPanel({ entries }: { entries: LedgerEntry[] }) {
  return (
    <section className="panel" aria-labelledby="ledger-heading">
      <div className="panel-head">
        <h2 id="ledger-heading">Movement ledger</h2>
        <p className="panel-note">append-only · newest first</p>
      </div>
      {entries.length === 0 ? (
        <p className="empty">No movements recorded yet.</p>
      ) : (
        <div className="table-scroll ledger-scroll">
          <table className="ledger">
            <thead>
              <tr>
                <th scope="col">event</th>
                <th scope="col" className="num-col">qty</th>
                <th scope="col" className="num-col">row</th>
                <th scope="col">actor</th>
                <th scope="col">why</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td><code>{e.eventType}</code></td>
                  <td className="num">{e.quantity}</td>
                  <td className="num">{e.allocationId ?? '—'}</td>
                  <td>{e.actor}</td>
                  <td className="why">{e.reason ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
