'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { LedgerEntry, Reservation, Scenario, Trace, Tree } from '@/lib/types';
import { TreePanel } from '@/components/tree-panel';
import { RequestPanel, type RequestState } from '@/components/request-panel';
import { WaterfallPanel } from '@/components/waterfall-panel';
import { LedgerPanel } from '@/components/ledger-panel';

const INITIAL: RequestState = { channel: 'online', ownerId: null, managed: false, quantity: 5 };

export default function Page() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [configId, setConfigId] = useState<number | null>(null);
  const [tree, setTree] = useState<Tree | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [reservation, setReservation] = useState<Reservation | null>(null);
  // A confirmed sale is terminal: the token can no longer be released, so this
  // replaces the held reservation rather than sitting alongside it.
  const [sale, setSale] = useState<{ bookingRef: string; seats: number } | null>(null);
  const [shortfall, setShortfall] = useState<Reservation extends never ? never : {
    requested: number; available: number; shortfall: number;
  } | null>(null);
  const [request, setRequest] = useState<RequestState>(INITIAL);
  // What the CURRENT identity can actually reach, kept live by the preview
  // effect below so the seats field always knows its own ceiling.
  const [available, setAvailable] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (id: number) => {
    const [t, l] = await Promise.all([api.tree(id), api.ledger(id)]);
    setTree(t);
    setLedger(l);
  }, []);

  useEffect(() => {
    api
      .scenarios()
      .then((list) => {
        setScenarios(list);
        const first = list[0];
        if (first?.configId) {
          setActiveKey(first.key);
          setConfigId(Number(first.configId));
        }
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    if (configId !== null) void refresh(configId).catch((e: Error) => setError(e.message));
  }, [configId, refresh]);

  // Keep the reachable count current for whatever identity is selected. This is
  // the read-only preview endpoint, so it changes nothing; it exists so the
  // seats field can show and bound its own ceiling instead of the user
  // discovering it only from a 409.
  useEffect(() => {
    if (!tree) return;
    // An owned channel with no owner selected is a deliberate hard-fail on the
    // server. Don't ask: it would 400 every time and log a console error that
    // looks like a defect rather than the guard working.
    const needsOwner = request.channel === 'agency' || request.channel === 'reseller';
    if (needsOwner && request.ownerId === null) {
      setAvailable(null);
      return;
    }
    let cancelled = false;
    const id = {
      channel: request.channel,
      ...(request.ownerId !== null ? { ownerId: request.ownerId } : {}),
      ...(request.managed ? { managed: true } : {}),
    };
    api
      .waterfall(tree.configId, id)
      .then((t) => {
        if (!cancelled) setAvailable(typeof t.available === 'number' ? t.available : null);
      })
      .catch(() => {
        // An unresolved owner legitimately 400s here; the field just loses its
        // ceiling hint rather than surfacing an error the user did not ask for.
        if (!cancelled) setAvailable(null);
      });
    return () => {
      cancelled = true;
    };
  }, [tree, request.channel, request.ownerId, request.managed]);

  const identity = () => ({
    channel: request.channel,
    ...(request.ownerId !== null ? { ownerId: request.ownerId } : {}),
    ...(request.managed ? { managed: true } : {}),
  });

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      const err = e as Error & { body?: Record<string, unknown> };
      if (err.body?.error === 'insufficient_capacity') {
        setShortfall(err.body as never);
        setTrace(null);
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const selectScenario = (key: string) =>
    run(async () => {
      const { configId: id } = await api.resetScenario(key);
      setActiveKey(key);
      setConfigId(id);
      setTrace(null);
      setReservation(null);
      setSale(null);
      setShortfall(null);
      setRequest(INITIAL);
    });

  const active = scenarios.find((s) => s.key === activeKey);
  const highlighted = new Set((trace?.candidates ?? []).map((c) => c.row.id));

  return (
    <main>
      <header className="masthead">
        <h1>Slot allocation inspector</h1>
        <p className="lede">
          A trip&rsquo;s capacity is <em>partitioned</em> among sales channels, not
          duplicated. A child row is a claim staked inside its parent. Every number
          below comes from the running engine.
        </p>
      </header>

      <nav className="scenarios" aria-label="Scenarios">
        {scenarios.map((s) => (
          <button
            key={s.key}
            onClick={() => selectScenario(s.key)}
            data-active={s.key === activeKey || undefined}
            disabled={busy}
          >
            {s.title}
          </button>
        ))}
      </nav>

      {active ? <p className="teaches">{active.teaches}</p> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}

      {tree ? (
        <div className="grid">
          <div className="col-main">
            <TreePanel tree={tree} highlighted={highlighted} />
          </div>
          <div className="col-side">
            <RequestPanel
              tree={tree}
              state={request}
              onChange={setRequest}
              available={available}
              busy={busy}
              reservation={reservation}
              shortfall={shortfall}
              onPreview={() =>
                run(async () => {
                  setShortfall(null);
                  setTrace(await api.waterfall(tree.configId, identity()));
                })
              }
              onReserve={() =>
                run(async () => {
                  setShortfall(null);
                  const r = await api.reserve(tree.configId, identity(), request.quantity);
                  setSale(null);
                  setReservation(r);
                  setTrace(r.trace);
                  await refresh(tree.configId);
                })
              }
              onRelease={() =>
                run(async () => {
                  if (!reservation) return;
                  await api.release(reservation.token);
                  setReservation(null);
                  await refresh(tree.configId);
                })
              }
              sale={sale}
              onConfirm={() =>
                run(async () => {
                  if (!reservation) return;
                  const bookingRef = `BK-${Date.now().toString(36).toUpperCase().slice(-6)}`;
                  const result = await api.confirm(reservation.token, bookingRef);
                  const seats = result.splits.reduce((t, sp) => t + sp.quantity, 0);
                  // Confirmed tokens cannot be released, so drop the held
                  // reservation and show the sale in its place.
                  setReservation(null);
                  setSale({ bookingRef, seats });
                  await refresh(tree.configId);
                })
              }
              onCutoff={() =>
                run(async () => {
                  await api.cutoff(tree.configId);
                  setReservation(null);
                  setSale(null);
                  setTrace(null);
                  await refresh(tree.configId);
                })
              }
            />
            <WaterfallPanel trace={trace} splits={reservation?.splits ?? null} />
          </div>
          <div className="col-full">
            <LedgerPanel entries={ledger} />
          </div>
        </div>
      ) : (
        <p className="empty">Loading…</p>
      )}
    </main>
  );
}
