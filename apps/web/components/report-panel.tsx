'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { CrmDelivery, InventoryReport } from '@/lib/types';

export function ReportPanel({ configId, revision, administrator }: { configId: number; revision: number; administrator: boolean }) {
  const [report, setReport] = useState<InventoryReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<CrmDelivery[]>([]);
  const [crmConfigured, setCrmConfigured] = useState(false);
  useEffect(() => {
    let live = true;
    api.report(configId).then((value) => { if (live) { setReport(value); setError(null); } })
      .catch((reason: Error) => { if (live) setError(reason.message); });
    return () => { live = false; };
  }, [configId, revision]);
  useEffect(() => {
    if (!administrator) return;
    Promise.all([api.crmStatus(), api.crmDeliveries()]).then(([status, entries]) => {
      setCrmConfigured(status.configured); setDeliveries(entries);
    }).catch((reason: Error) => setError(reason.message));
  }, [administrator, revision]);

  const retry = async (id: number) => {
    try {
      await api.retryCrmDelivery(id);
      setDeliveries(await api.crmDeliveries());
    } catch (reason) { setError((reason as Error).message); }
  };

  const exportCsv = async () => {
    try {
      const blob = await api.reportCsv(configId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `allocation-report-${configId}.csv`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) { setError((reason as Error).message); }
  };

  return <section className="report-view" aria-labelledby="report-heading">
    <div className="panel-head"><h2 id="report-heading">Inventory report · configuration {configId}</h2>
      <button type="button" onClick={() => void exportCsv()} disabled={!report}>Export CSV</button></div>
    {error ? <p className="error" role="alert">{error}</p> : null}
    {!report ? <p className="empty">Loading report…</p> : <>
      <p className="manager-intro">Sellable seats net child allocations out of their parent pool. Release and cutoff figures count ledger movements since this configuration was created.</p>
      <div className="report-metrics">
        {([
          ['Physical seats', report.physicalCapacity], ['Sellable now', report.sellableNow],
          ['Held seats', report.heldSeats], ['Due in 5 minutes', report.holdsDueSoon],
          ['Confirmed sales', report.confirmedSales], ['Released seats', report.releasedSeats],
          ['Returned at cutoff', report.cutoffReturnedSeats], ['Oversells prevented', report.preventedOversellAttempts],
        ] as const).map(([label, value]) => <div className="report-metric" key={label}>
          <span>{label}</span><strong className="num">{value}</strong></div>)}
      </div>
      <div className="table-scroll"><table><thead><tr>
        <th>Channel</th><th>Partner</th><th>Rule</th><th className="num-col">Allocated</th>
        <th className="num-col">Sellable</th><th className="num-col">Held</th><th className="num-col">Sold</th>
      </tr></thead><tbody>{report.channels.map((row, index) => <tr key={index}>
        <th scope="row">{row.channel}</th><td>{row.ownerName ?? '—'}</td><td>{row.allocationType}</td>
        <td className="num">{row.allocatedSeats}</td><td className="num">{row.sellableNow}</td>
        <td className="num">{row.heldSeats}</td><td className="num">{row.soldSeats}</td>
      </tr>)}</tbody></table></div>
      {administrator ? <section className="crm-deliveries" aria-labelledby="crm-heading">
        <div className="panel-head"><h3 id="crm-heading">CRM webhook deliveries</h3></div>
        <p className="panel-note">{crmConfigured ? 'Signed booking confirmations are sent to the configured CRM endpoint.' : 'Set CRM_WEBHOOK_URL and CRM_WEBHOOK_SECRET on the API to send queued confirmations.'}</p>
        <div className="table-scroll"><table><thead><tr><th>Event</th><th>Status</th><th className="num-col">Attempts</th><th>Last result</th><th>Action</th></tr></thead>
          <tbody>{deliveries.map((delivery) => <tr key={delivery.id}>
            <th scope="row">{delivery.eventKey}</th><td>{delivery.status}</td><td className="num">{delivery.attempts}</td>
            <td>{delivery.lastHttpStatus ?? delivery.lastError ?? '—'}</td>
            <td>{delivery.status === 'failed' ? <button type="button" onClick={() => void retry(delivery.id)}>Retry</button> : '—'}</td>
          </tr>)}</tbody></table></div>
        {deliveries.length === 0 ? <p className="empty">No booking confirmations have been queued.</p> : null}
      </section> : null}
    </>}
  </section>;
}
