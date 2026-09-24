'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { DemoIdentity, LedgerEntry, Reservation, Scenario, Trace, Tree } from '@/lib/types';
import { TreePanel } from '@/components/tree-panel';
import { RequestPanel, type RequestState } from '@/components/request-panel';
import { WaterfallPanel } from '@/components/waterfall-panel';
import { LedgerPanel } from '@/components/ledger-panel';
import { ConfigurationManager } from '@/components/configuration-manager';
import { PartnerView } from '@/components/partner-view';
import { ReportPanel } from '@/components/report-panel';

const INITIAL: RequestState = { channel: 'online', ownerId: null, managed: false, quantity: 5 };

export default function Page() {
  const [identities, setIdentities] = useState<DemoIdentity[]>([]);
  const [currentIdentity, setCurrentIdentity] = useState<DemoIdentity | null>(null);
  const [view, setView] = useState<'inspector' | 'configuration' | 'report'>('inspector');
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
  const [competition, setCompetition] = useState<string | null>(null);

  const refresh = useCallback(async (id: number) => {
    const [t, l] = await Promise.all([api.tree(id), api.ledger(id)]);
    setTree(t);
    setLedger(l);
  }, []);

  useEffect(() => {
    api.demoIdentities()
      .then(async (options) => {
        setIdentities(options);
        const operator = options.find((item) => item.role === 'operator');
        if (!operator) throw new Error('Demo operator role is unavailable');
        await api.startDemoSession(operator.role, operator.ownerId);
        setCurrentIdentity(operator);
        const list = await api.scenarios();
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
    if (configId !== null && currentIdentity?.role !== 'partner') void refresh(configId).catch((e: Error) => setError(e.message));
  }, [configId, currentIdentity?.role, refresh]);

  // Keep the reachable count current for whatever identity is selected. This is
  // the read-only preview endpoint, so it changes nothing; it exists so the
  // seats field can show and bound its own ceiling instead of the user
  // discovering it only from a 409.
  useEffect(() => {
    if (!tree || currentIdentity?.role === 'partner') return;
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
  }, [tree, request.channel, request.ownerId, request.managed, currentIdentity?.role]);

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
      setIdentities(await api.demoIdentities());
      setActiveKey(key);
      setConfigId(id);
      setTrace(null);
      setReservation(null);
      setSale(null);
      setShortfall(null);
      setRequest(INITIAL);
      setCompetition(null);
    });

  const switchIdentity = (identity: DemoIdentity) => run(async () => {
    await api.startDemoSession(identity.role, identity.ownerId);
    setCurrentIdentity(identity);
    setTrace(null);
    setReservation(null);
    setSale(null);
    setShortfall(null);
    setCompetition(null);
    if (identity.role === 'partner') {
      setConfigId(null);
      setTree(null);
    } else {
      setView(identity.role === 'administrator' ? 'configuration' : 'inspector');
      const list = await api.scenarios();
      setScenarios(list);
      const first = list[0];
      setActiveKey(first?.key ?? null);
      setConfigId(first?.configId ? Number(first.configId) : null);
    }
  });

  const active = scenarios.find((s) => s.key === activeKey);
  const highlighted = new Set((trace?.candidates ?? []).map((c) => c.row.id));

  return (
    <main>
      <header className="masthead">
        <h1>Slot allocation</h1>
        <p className="lede">
          A sailing&rsquo;s seats are <em>partitioned</em> among sales channels. Plan
          the allocation, follow a booking, and see exactly why a seat is available.
        </p>
      </header>

      {currentIdentity ? <div className="role-switch">
        <label htmlFor="demo-role">Demo role</label>
        <select id="demo-role" value={`${currentIdentity.role}:${currentIdentity.ownerId ?? ''}`} disabled={busy}
          onChange={(event) => {
            const selected = identities.find((item) => `${item.role}:${item.ownerId ?? ''}` === event.target.value);
            if (selected) void switchIdentity(selected);
          }}>
          {identities.map((item) => <option key={`${item.role}:${item.ownerId ?? ''}`} value={`${item.role}:${item.ownerId ?? ''}`}>
            {item.role === 'partner' ? `Partner · ${item.label}` : item.label}
          </option>)}
        </select>
        <span>Demo identities are selectable by anyone. They are for exploring roles, not production accounts.</span>
      </div> : <p className="empty">Connecting to the demo…</p>}

      {error ? <p className="error" role="alert">{error}</p> : null}

      {currentIdentity?.role === 'partner' ? <PartnerView key={currentIdentity.ownerId} ownerName={currentIdentity.label} /> : currentIdentity ? <>
      <nav className="workspace-tabs" aria-label="Workspace views">
        <button type="button" data-active={view === 'inspector' || undefined} onClick={() => setView('inspector')}>Booking inspector</button>
        <button type="button" data-active={view === 'configuration' || undefined} onClick={() => setView('configuration')}>Plan allocations</button>
        <button type="button" data-active={view === 'report' || undefined} onClick={() => setView('report')}>Inventory report</button>
      </nav>

      {view === 'configuration' ? <ConfigurationManager role={currentIdentity.role} onApproved={async () => setIdentities(await api.demoIdentities())} onOpenConfig={(id) => {
        setActiveKey(null);
        setConfigId(id);
        setTree(null);
        setView('inspector');
      }} /> : view === 'report' ? (configId ? <ReportPanel configId={configId} revision={0} administrator={currentIdentity.role === 'administrator'} /> : <p className="empty">Open a configuration to view its report.</p>) : <>

      <p className="guided-demo"><strong>Follow a booking:</strong> reserve a hold, confirm or release it, or use “Expire hold now” to see time to live return seats. “Try competing requests” sends two requests at once and records the refusal. Apply cutoff to return flexible capacity; the ledger below explains each movement. <strong>Why can a parent show 65 free but only 30 sellable?</strong> Its raw count includes seats promised to child allocations. The netted count subtracts those promises.</p>

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
        <button type="button" onClick={() => { if (activeKey) void selectScenario(activeKey); }} disabled={busy || !activeKey} className="reset-scenario">Reset current scenario</button>
      </nav>

      {active ? <p className="teaches">{active.teaches}</p> : null}

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
              onExpire={() => run(async () => {
                if (!reservation) return;
                await api.expire(reservation.token);
                setReservation(null);
                await refresh(tree.configId);
              })}
              onCompete={() => run(async () => {
                if (!available || reservation) return;
                const results = await Promise.allSettled([
                  api.reserve(tree.configId, identity(), available),
                  api.reserve(tree.configId, identity(), available),
                ]);
                const winners = results.filter((result): result is PromiseFulfilledResult<Reservation> => result.status === 'fulfilled');
                await Promise.all(winners.map((result) => api.release(result.value.token)));
                const refused = results.length - winners.length;
                setCompetition(`${winners.length} request${winners.length === 1 ? '' : 's'} held seats; ${refused} refused when capacity was already committed. Winning holds were released after the demonstration. See the report for the refusal count.`);
                await refresh(tree.configId);
              })}
              competition={competition}
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
      </>}
      </> : null}
    </main>
  );
}
