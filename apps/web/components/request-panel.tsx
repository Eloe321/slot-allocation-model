'use client';

import type { Identity, Reservation, Tree } from '@/lib/types';

export interface RequestState {
  channel: Identity['channel'];
  ownerId: number | null;
  managed: boolean;
  quantity: number;
}

const CHANNELS: Identity['channel'][] = ['counter', 'online', 'marketplace', 'agency', 'reseller'];

export function RequestPanel({
  tree,
  state,
  onChange,
  available,
  onPreview,
  onReserve,
  onRelease,
  onConfirm,
  onCutoff,
  reservation,
  sale,
  shortfall,
  busy,
}: {
  tree: Tree;
  state: RequestState;
  onChange: (next: RequestState) => void;
  /** Seats the current identity can reach; null when it cannot be determined. */
  available: number | null;
  onPreview: () => void;
  onReserve: () => void;
  onRelease: () => void;
  onConfirm: () => void;
  onCutoff: () => void;
  reservation: Reservation | null;
  /** A completed sale. Terminal — the token can no longer be released. */
  sale: { bookingRef: string; seats: number } | null;
  shortfall: { requested: number; available: number; shortfall: number } | null;
  busy: boolean;
}) {
  const needsOwner = state.channel === 'agency' || state.channel === 'reseller';
  // Only owners that actually exist on this config are offerable, so the UI
  // cannot construct an identity the engine would reject as unresolved.
  const owners = tree.rows
    .filter((r) => r.ownerId !== null && r.channel === state.channel)
    .map((r) => ({ id: r.ownerId as number, name: r.ownerName ?? `owner ${r.ownerId}`, funding: r.fundingSource }));

  return (
    <section className="panel" aria-labelledby="req-heading">
      <div className="panel-head">
        <h2 id="req-heading">Request</h2>
      </div>

      <div className="fields">
        <label>
          <span>channel</span>
          <select
            value={state.channel}
            onChange={(e) => {
              const channel = e.target.value as Identity['channel'];
              onChange({ ...state, channel, ownerId: null });
            }}
          >
            {CHANNELS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>

        {needsOwner ? (
          <label>
            <span>owner</span>
            <select
              value={state.ownerId ?? ''}
              onChange={(e) => {
                const id = e.target.value === '' ? null : Number(e.target.value);
                const owner = owners.find((o) => o.id === id);
                onChange({
                  ...state,
                  ownerId: id,
                  managed: owner ? owner.funding === 'partner_pool' : state.managed,
                });
              }}
            >
              <option value="">— unresolved —</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </label>
        ) : null}

        {needsOwner ? (
          <label className="check">
            <input
              type="checkbox"
              checked={state.managed}
              onChange={(e) => onChange({ ...state, managed: e.target.checked })}
            />
            <span>managed (funded from the partner pool)</span>
          </label>
        ) : null}

        <label>
          <span>
            seats
            {available !== null ? (
              <span className="ceiling">
                {' '}· <span className="num">{available}</span> reachable
              </span>
            ) : null}
          </span>
          <input
            type="number"
            min={1}
            // Bounded by the cabin, not by what this identity can reach.
            // Capping at `available` would make it impossible to demonstrate a
            // refusal, and refusals are a documented behaviour of the waterfall
            // (the siloed counter scenario exists precisely to show one).
            // This stops nonsense like 9999 without hiding the interesting case.
            max={tree.cabinCapacity}
            value={state.quantity}
            onChange={(e) => {
              const raw = Number(e.target.value);
              if (Number.isNaN(raw)) return;
              const clamped = Math.min(Math.max(1, Math.trunc(raw)), tree.cabinCapacity);
              onChange({ ...state, quantity: clamped });
            }}
          />
        </label>
      </div>

      {available !== null && state.quantity > available ? (
        <p className="will-refuse">
          <span className="num">{state.quantity}</span> exceeds the{' '}
          <span className="num">{available}</span> this identity can reach — reserving
          will be refused, with the shortfall.
        </p>
      ) : null}

      <div className="actions">
        <button onClick={onPreview} disabled={busy}>Preview</button>
        <button data-variant="primary" onClick={onReserve} disabled={busy}>Reserve</button>
        {reservation ? (
          <button data-variant="primary" onClick={onConfirm} disabled={busy}>
            Confirm sale
          </button>
        ) : null}
        {reservation ? (
          <button onClick={onRelease} disabled={busy}>Release</button>
        ) : null}
        <button onClick={onCutoff} disabled={busy} className="push">Apply cutoff</button>
      </div>

      {shortfall ? (
        <p className="shortfall">
          Refused. Asked for <span className="num">{shortfall.requested}</span>,{' '}
          <span className="num">{shortfall.available}</span> reachable — short by{' '}
          <span className="num">{shortfall.shortfall}</span>.
        </p>
      ) : null}

      {sale ? (
        <p className="sold-note">
          Sold <span className="num">{sale.seats}</span> as{' '}
          <span className="num">{sale.bookingRef}</span>. Each split now has a durable
          link recording the exact row its seats came from.
        </p>
      ) : null}

      {reservation ? (
        <p className="held-note">
          Holding <span className="num">
            {reservation.splits.reduce((t, s) => t + s.quantity, 0)}
          </span>{' '}
          across <span className="num">{reservation.splits.length}</span>{' '}
          {reservation.splits.length === 1 ? 'row' : 'rows'}.
        </p>
      ) : null}
    </section>
  );
}
