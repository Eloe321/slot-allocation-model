import type {
  Confirmation, Identity, LedgerEntry, Reservation, Scenario, Shortfall, Trace, Tree,
} from './types';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4001';

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw Object.assign(new Error(body.message ?? 'request failed'), { status: res.status, body });
  }
  return res.json() as Promise<T>;
}

export const api = {
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
  cutoff: (configId: number) =>
    json<{ ok: true }>(`/configs/${configId}/cutoff`, { method: 'POST' }),
  ledger: (configId: number) => json<LedgerEntry[]>(`/configs/${configId}/ledger`),
};

export type { Shortfall };
