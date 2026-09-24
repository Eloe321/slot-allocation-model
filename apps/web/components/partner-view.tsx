'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { PartnerActivity, PartnerInventory } from '@/lib/types';

export function PartnerView({ ownerName }: { ownerName: string }) {
  const [inventory, setInventory] = useState<PartnerInventory[]>([]);
  const [activity, setActivity] = useState<PartnerActivity[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [rows, movements] = await Promise.all([api.partnerInventory(), api.partnerActivity()]);
    setInventory(rows);
    setActivity(movements);
  }, []);

  useEffect(() => { void refresh().catch((reason: Error) => setError(reason.message)); }, [refresh, ownerName]);

  return <div className="partner-view">
    <section className="panel">
      <div className="panel-head"><h2>{ownerName} inventory</h2><button type="button" onClick={() => void refresh().catch((reason: Error) => setError(reason.message))}>Refresh</button></div>
      <p className="manager-intro">Only allocations assigned to this partner appear here.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {inventory.length === 0 ? <p className="empty">No allocation is assigned to this partner yet.</p> :
        <div className="table-scroll"><table><thead><tr><th>Sailing</th><th>Channel</th><th className="num-col">Allocated</th><th className="num-col">Held</th><th className="num-col">Sold</th><th className="num-col">Available</th></tr></thead>
          <tbody>{inventory.map((row) => <tr key={row.allocationId}>
            <th>{row.vesselName}<span className="row-meta">{row.departurePort} · {new Date(row.departsAt).toLocaleString()}</span></th>
            <td>{row.channel}</td><td className="num">{row.allocatedSlots}</td><td className="num">{row.heldSlots}</td><td className="num">{row.soldSlots}</td><td className="num">{row.availableSlots}</td>
          </tr>)}</tbody></table></div>}
    </section>
    <section className="panel">
      <div className="panel-head"><h2>Booking activity</h2><span className="panel-note">Latest 100 movements on your allocations</span></div>
      {activity.length === 0 ? <p className="empty">No booking activity yet.</p> :
        <div className="table-scroll"><table><thead><tr><th>When</th><th>Event</th><th className="num-col">Seats</th><th>Reason</th></tr></thead>
          <tbody>{activity.map((item) => <tr key={item.id}>
            <td>{new Date(item.createdAt).toLocaleString()}</td><th>{item.eventType.replaceAll('_', ' ')}</th><td className="num">{item.quantity}</td><td>{item.reason ?? '—'}</td>
          </tr>)}</tbody></table></div>}
    </section>
  </div>;
}
