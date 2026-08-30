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
  const [shortfall, setShortfall] = useState<Reservation extends never ? never : {
    requested: number; available: number; shortfall: number;
  } | null>(null);
  const [request, setRequest] = useState<RequestState>(INITIAL);
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
              onCutoff={() =>
                run(async () => {
                  await api.cutoff(tree.configId);
                  setReservation(null);
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
