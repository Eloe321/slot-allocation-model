import type {
  Confirmation, ConfigurationInput, ConfigurationPreview, ConfigurationRequest,
  DemoIdentity, DemoRole, Identity, LedgerEntry, PartnerActivity, PartnerInventory,
  Reservation, Scenario, Shortfall, Trace, Tree, InventoryReport, CrmDelivery,
} from './types';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4001';
let demoToken: string | null = null;

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(demoToken ? { authorization: `Bearer ${demoToken}` } : {}),
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw Object.assign(new Error(body.message ?? 'request failed'), { status: res.status, body });
  }
  return res.json() as Promise<T>;
}

export const api = {
  demoIdentities: () => json<DemoIdentity[]>('/demo/identities'),
  startDemoSession: async (role: DemoRole, ownerId: number | null) => {
    const result = await json<{ token: string }>('/demo/sessions', {
      method: 'POST',
      body: JSON.stringify({ role, ...(ownerId === null ? {} : { ownerId }) }),
    });
    demoToken = result.token;
  },
  previewConfiguration: (input: ConfigurationInput) =>
    json<ConfigurationPreview>('/configuration-requests/preview', {
      method: 'POST', body: JSON.stringify(input),
    }),
  submitConfiguration: (input: ConfigurationInput) =>
    json<{ id: number; status: 'submitted' }>('/configuration-requests', {
      method: 'POST', body: JSON.stringify(input),
    }),
  configurationRequests: () => json<ConfigurationRequest[]>('/configuration-requests'),
  approveConfiguration: (id: number) =>
    json<{ configId: number; alreadyApproved: boolean }>(`/configuration-requests/${id}/approve`, {
      method: 'POST', body: '{}',
    }),
  rejectConfiguration: (id: number, reason: string) =>
    json<{ ok: true }>(`/configuration-requests/${id}/reject`, {
      method: 'POST', body: JSON.stringify({ reason }),
    }),
  partnerInventory: () => json<PartnerInventory[]>('/partner/inventory'),
  partnerActivity: () => json<PartnerActivity[]>('/partner/activity'),
  scenarios: () => json<Scenario[]>('/scenarios'),
  resetScenario: (key: string) =>
    json<{ configId: number }>(`/scenarios/${key}/reset`, { method: 'POST' }),
  tree: (configId: number) => json<Tree>(`/configs/${configId}`),
  waterfall: (configId: number, identity: Identity) =>
    json<Trace>(`/configs/${configId}/waterfall`, {
      method: 'POST',
      body: JSON.stringify(identity),
    }),
  reserve: (configId: number, identity: Identity, quantity: number) =>
    json<Reservation>(`/configs/${configId}/reservations`, {
      method: 'POST',
      body: JSON.stringify({ ...identity, quantity }),
    }),
  confirm: (token: string, bookingRef: string) =>
    json<Confirmation>(`/reservations/${token}/confirm`, {
      method: 'POST',
      body: JSON.stringify({ bookingRef }),
    }),
  release: (token: string) =>
    json<{ ok: true }>(`/reservations/${token}/release`, { method: 'POST' }),
  expire: (token: string) =>
    json<{ expired: boolean }>(`/reservations/${token}/expire`, { method: 'POST' }),
  cutoff: (configId: number) =>
    json<{ ok: true }>(`/configs/${configId}/cutoff`, { method: 'POST' }),
  ledger: (configId: number) => json<LedgerEntry[]>(`/configs/${configId}/ledger`),
  report: (configId: number) => json<InventoryReport>(`/configs/${configId}/report`),
  reportCsv: async (configId: number) => {
    const response = await fetch(`${BASE}/configs/${configId}/report/csv`, {
      headers: demoToken ? { authorization: `Bearer ${demoToken}` } : {},
    });
    if (!response.ok) throw new Error('Could not export report');
    return response.blob();
  },
  crmStatus: () => json<{ configured: boolean }>('/integrations/crm/deliveries/status'),
  crmDeliveries: () => json<CrmDelivery[]>('/integrations/crm/deliveries'),
  retryCrmDelivery: (id: number) => json<{ queued: boolean }>(`/integrations/crm/deliveries/${id}/retry`, { method: 'POST' }),
};

export type { Shortfall };
