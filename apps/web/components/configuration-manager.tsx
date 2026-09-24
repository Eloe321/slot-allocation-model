'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type {
  Channel, ConfigurationInput, ConfigurationPreview, ConfigurationRequest,
  ConfigurationRowInput, DemoRole,
} from '@/lib/types';

function localDate(daysAhead: number): string {
  const date = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  date.setMinutes(0, 0, 0);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

const INITIAL: ConfigurationInput = {
  vesselName: 'MV North Star',
  cabinName: 'Economy',
  departurePort: 'Manila',
  departsAt: '',
  bookingCutoffAt: '',
  capacity: 100,
  rows: [
    { channel: 'counter', allocationType: 'direct', fundingSource: 'online', allocatedSlots: 20, ownerName: null },
    { channel: 'online', allocationType: 'direct', fundingSource: 'online', allocatedSlots: 80, ownerName: null },
    { channel: 'agency', allocationType: 'guaranteed', fundingSource: 'online', allocatedSlots: 10, ownerName: 'Harbour Travel' },
  ],
};

const CHANNELS: Channel[] = ['counter', 'online', 'marketplace', 'partner_pool', 'agency', 'reseller'];

function normalized(input: ConfigurationInput): ConfigurationInput {
  return {
    ...input,
    departsAt: new Date(input.departsAt).toISOString(),
    bookingCutoffAt: new Date(input.bookingCutoffAt).toISOString(),
  };
}

export function ConfigurationManager({
  role,
  onOpenConfig,
  onApproved,
}: {
  role: Exclude<DemoRole, 'partner'>;
  onOpenConfig: (id: number) => void;
  onApproved: () => Promise<void>;
}) {
  const [input, setInput] = useState<ConfigurationInput>(INITIAL);
  const [preview, setPreview] = useState<ConfigurationPreview | null>(null);
  const [requests, setRequests] = useState<ConfigurationRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setInput((current) => ({
      ...current,
      departsAt: localDate(7),
      bookingCutoffAt: localDate(6),
    }));
  }, []);

  useEffect(() => {
    void api.configurationRequests().then(setRequests).catch((reason: Error) => setError(reason.message));
  }, [role]);

  const change = (patch: Partial<ConfigurationInput>) => {
    setInput((current) => ({ ...current, ...patch }));
    setPreview(null);
    setMessage(null);
  };

  const changeRow = (index: number, patch: Partial<ConfigurationRowInput>) => {
    const rows = input.rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row);
    change({ rows });
  };

  const changeChannel = (index: number, channel: Channel) => {
    const direct = channel === 'counter' || channel === 'online' || channel === 'marketplace';
    changeRow(index, {
      channel,
      allocationType: direct ? 'direct' : 'flexible',
      fundingSource: 'online',
      ownerName: channel === 'agency' || channel === 'reseller' ? '' : null,
    });
  };

  const addRow = () => change({
    rows: [...input.rows, {
      channel: 'agency', allocationType: 'flexible', fundingSource: 'online',
      allocatedSlots: 0, ownerName: '',
    }],
  });

  const execute = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Request failed'); }
    finally { setBusy(false); }
  };

  const refresh = async () => setRequests(await api.configurationRequests());

  return (
    <section className="manager" aria-labelledby="manager-heading">
      <div className="panel-head">
        <h2 id="manager-heading">Plan a sailing</h2>
        <span className="panel-note">A proposal becomes bookable only after administrator approval.</span>
      </div>
      <p className="manager-intro">
        Set the physical ceiling, divide it among channels, then inspect what each channel can actually sell.
      </p>

      <div className="manager-fields">
        <label>Vessel name<input value={input.vesselName} onChange={(event) => change({ vesselName: event.target.value })} /></label>
        <label>Cabin name<input value={input.cabinName} onChange={(event) => change({ cabinName: event.target.value })} /></label>
        <label>Departure port<input value={input.departurePort} onChange={(event) => change({ departurePort: event.target.value })} /></label>
        <label>Physical seats<input type="number" min="1" value={input.capacity} onChange={(event) => change({ capacity: Number(event.target.value) })} /></label>
        <label>Departure time<input type="datetime-local" value={input.departsAt} onChange={(event) => change({ departsAt: event.target.value })} /></label>
        <label>Booking cutoff<input type="datetime-local" value={input.bookingCutoffAt} onChange={(event) => change({ bookingCutoffAt: event.target.value })} /></label>
      </div>

      <div className="panel-head manager-rows-head">
        <h3>Channel allocations</h3>
        <button type="button" onClick={addRow} disabled={busy || input.rows.length >= 30}>Add channel</button>
      </div>
      <div className="table-scroll">
        <table className="manager-table">
          <thead><tr><th>Channel</th><th>Type</th><th>Funded from</th><th>Partner</th><th className="num-col">Seats</th><th><span className="visually-hidden">Remove</span></th></tr></thead>
          <tbody>
            {input.rows.map((row, index) => {
              const owned = row.channel === 'agency' || row.channel === 'reseller';
              const direct = row.allocationType === 'direct';
              return (
                <tr key={index}>
                  <td><select aria-label={`Channel ${index + 1}`} value={row.channel} onChange={(event) => changeChannel(index, event.target.value as Channel)}>
                    {CHANNELS.map((channel) => <option key={channel} value={channel}>{channel.replace('_', ' ')}</option>)}
                  </select></td>
                  <td><select aria-label={`Allocation type ${index + 1}`} value={row.allocationType} disabled={direct} onChange={(event) => changeRow(index, { allocationType: event.target.value as ConfigurationRowInput['allocationType'] })}>
                    {direct ? <option value="direct">direct</option> : <>
                      <option value="flexible">flexible</option><option value="guaranteed">guaranteed</option>
                    </>}
                  </select></td>
                  <td>{owned ? <select aria-label={`Funding source ${index + 1}`} value={row.fundingSource} onChange={(event) => changeRow(index, { fundingSource: event.target.value as ConfigurationRowInput['fundingSource'] })}>
                    <option value="online">online</option><option value="partner_pool">partner pool</option>
                  </select> : 'online'}</td>
                  <td>{owned ? <input aria-label={`Partner name ${index + 1}`} value={row.ownerName ?? ''} onChange={(event) => changeRow(index, { ownerName: event.target.value })} /> : '—'}</td>
                  <td><input className="num" aria-label={`Seats ${index + 1}`} type="number" min="0" value={row.allocatedSlots} onChange={(event) => changeRow(index, { allocatedSlots: Number(event.target.value) })} /></td>
                  <td><button type="button" aria-label={`Remove channel ${index + 1}`} onClick={() => change({ rows: input.rows.filter((_, rowIndex) => rowIndex !== index) })} disabled={busy || input.rows.length === 1}>Remove</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="actions">
        <button type="button" onClick={() => execute(async () => {
          const result = await api.previewConfiguration(normalized(input));
          setPreview(result);
          setMessage(result.violations.length ? 'Resolve the violations before submitting.' : 'Preview is valid. You can submit this proposal.');
        })} disabled={busy || !input.departsAt || !input.bookingCutoffAt}>Preview capacity</button>
        <button type="button" data-variant="primary" onClick={() => execute(async () => {
          const submitted = await api.submitConfiguration(normalized(input));
          setPreview(null);
          setMessage(`Proposal #${submitted.id} submitted for approval.`);
          await refresh();
        })} disabled={busy || !preview || preview.violations.length > 0}>Submit for approval</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {message && <p className="finding" role="status">{message}</p>}
      {preview && <div className="manager-preview">
        <div className="manager-totals">
          <span><strong className="num">{input.capacity}</strong> physical seats</span>
          <span><strong className="num">{preview.directAllocated}</strong> directly allocated</span>
          <span><strong className="num">{preview.unallocated}</strong> unallocated</span>
        </div>
        {preview.violations.length > 0 && <ul className="violations">
          {preview.violations.map((violation, index) => <li key={index}>{violation.detail}</li>)}
        </ul>}
        <div className="table-scroll"><table><thead><tr><th>Channel</th><th className="num-col">Allocated</th><th className="num-col">Raw free</th><th className="num-col">Actually sellable</th></tr></thead>
          <tbody>{preview.rows.map((row, index) => <tr key={index}><th>{row.ownerName ?? row.channel.replace('_', ' ')}</th><td className="num">{row.allocatedSlots}</td><td className="num">{row.rawAvailable}</td><td className="num">{row.nettedAvailable}</td></tr>)}</tbody>
        </table></div>
      </div>}

      <div className="panel-head manager-requests-head"><h3>Configuration requests</h3><span className="panel-note">{requests.length} total</span></div>
      {requests.length === 0 ? <p className="empty">No proposals yet. Preview and submit a sailing above.</p> : (
        <div className="table-scroll"><table><thead><tr><th>Proposal</th><th>Status</th><th>Submitted by</th><th>Review</th></tr></thead>
          <tbody>{requests.map((request) => <tr key={request.id}>
            <th>#{request.id} · {request.proposed.vesselName}<span className="row-meta">{request.proposed.departurePort} · {new Date(request.proposed.departsAt).toLocaleString()}</span></th>
            <td>{request.status}</td><td>{request.submittedBy}</td>
            <td><div className="request-actions">
              {request.status === 'submitted' && role === 'administrator' && <>
                <button type="button" disabled={busy} onClick={() => execute(async () => { await api.approveConfiguration(request.id); await refresh(); await onApproved(); setMessage(`Proposal #${request.id} approved.`); })}>Approve</button>
                <button type="button" disabled={busy} onClick={() => execute(async () => { await api.rejectConfiguration(request.id, 'Not approved for this sailing'); await refresh(); setMessage(`Proposal #${request.id} rejected.`); })}>Reject</button>
              </>}
              {request.configId && <button type="button" onClick={() => onOpenConfig(request.configId!)}>Inspect live allocation</button>}
              {request.status === 'submitted' && role === 'operator' && <span className="panel-note">Awaiting administrator</span>}
              {request.reviewReason && <span className="panel-note">{request.reviewReason}</span>}
            </div></td>
          </tr>)}</tbody></table></div>
      )}
    </section>
  );
}
