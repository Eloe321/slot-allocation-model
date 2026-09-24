import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { resetDatabase, testPool } from '../db/test-helpers.js';
import { ConfigurationService } from './configuration.service.js';
import { DemoSessionService } from '../demo/demo-session.service.js';

const proposal = {
  vesselName: 'MV North Star',
  cabinName: 'Economy',
  departurePort: 'Manila',
  departsAt: '2026-10-02T08:00:00.000Z',
  bookingCutoffAt: '2026-10-02T06:00:00.000Z',
  capacity: 100,
  rows: [
    { channel: 'counter', allocationType: 'direct', allocatedSlots: 20 },
    { channel: 'online', allocationType: 'direct', allocatedSlots: 80 },
    { channel: 'agency', allocationType: 'guaranteed', allocatedSlots: 10, ownerName: 'Harbour Travel' },
  ],
};

let pool: Pool;
let service: ConfigurationService;
beforeAll(() => { pool = testPool(); service = new ConfigurationService(pool); });
beforeEach(async () => { await resetDatabase(pool); });
afterAll(async () => { await pool.end(); });

describe('configuration approval', () => {
  it('refuses a proposal that would carve more seats than its online parent owns', async () => {
    const invalid = { ...proposal, rows: [proposal.rows[0], { ...proposal.rows[1], allocatedSlots: 5 }, proposal.rows[2]] };
    await expect(service.submit(invalid, 'operator')).rejects.toThrow('online_children_exceed_parent');
    const { rows } = await pool.query('SELECT count(*)::int AS count FROM configuration_requests');
    expect(rows[0].count).toBe(0);
  });

  it('refuses duplicate direct rows that would strand seats', async () => {
    for (const channel of ['counter', 'marketplace']) {
      const invalid = { ...proposal, rows: [
        { channel, allocationType: 'direct', allocatedSlots: 10 },
        { channel, allocationType: 'direct', allocatedSlots: 10 },
        { channel: 'online', allocationType: 'direct', allocatedSlots: 80 },
      ] };
      await expect(service.submit(invalid, 'operator')).rejects.toThrow('duplicate_direct_channel');
    }
  });

  it('records a proposal and creates a bookable config only after approval', async () => {
    const submitted = await service.submit(proposal, 'operator');
    expect(submitted.status).toBe('submitted');
    const before = await pool.query('SELECT count(*)::int AS count FROM allocation_configs');
    expect(before.rows[0].count).toBe(0);

    const approved = await service.approve(submitted.id, 'administrator');
    expect(approved.alreadyApproved).toBe(false);
    const rows = await pool.query(
      `SELECT a.channel, a.allocated_slots, o.name AS owner_name
         FROM channel_allocations a LEFT JOIN owners o ON o.id = a.owner_id
        WHERE a.config_id = $1 ORDER BY a.id`,
      [approved.configId],
    );
    expect(rows.rows).toMatchObject([
      { channel: 'counter', allocated_slots: 20 },
      { channel: 'online', allocated_slots: 80 },
      { channel: 'agency', allocated_slots: 10, owner_name: 'Harbour Travel' },
    ]);
    const audit = await pool.query('SELECT status, submitted_by, reviewed_by FROM configuration_requests WHERE id = $1', [submitted.id]);
    expect(audit.rows[0]).toMatchObject({ status: 'approved', submitted_by: 'operator', reviewed_by: 'administrator' });
  });

  it('returns the same approved config on a repeated approval', async () => {
    const submitted = await service.submit(proposal, 'operator');
    const first = await service.approve(submitted.id, 'administrator');
    const second = await service.approve(submitted.id, 'administrator');
    expect(second).toEqual({ configId: first.configId, alreadyApproved: true });
    const { rows } = await pool.query('SELECT count(*)::int AS count FROM allocation_configs');
    expect(rows[0].count).toBe(1);
  });

  it('uses one partner identity across approved sailings', async () => {
    const first = await service.approve((await service.submit(proposal, 'operator')).id, 'administrator');
    const secondProposal = { ...proposal, vesselName: 'MV South Star', rows: [
      proposal.rows[0], proposal.rows[1],
      { ...proposal.rows[2], ownerName: ' harbour travel ' },
    ] };
    const second = await service.approve((await service.submit(secondProposal, 'operator')).id, 'administrator');
    const { rows } = await pool.query<{ config_id: string; owner_id: string }>(
      `SELECT config_id, owner_id FROM channel_allocations WHERE config_id IN ($1,$2) AND channel = 'agency' ORDER BY config_id`,
      [first.configId, second.configId],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]!.owner_id).toBe(rows[1]!.owner_id);
    const identities = await new DemoSessionService(pool).identities();
    expect(identities.filter((identity) => identity.role === 'partner')).toHaveLength(1);
  });

  it('retires old demo proposals and their custom inventory', async () => {
    const approved = await service.approve((await service.submit(proposal, 'operator')).id, 'administrator');
    await pool.query("UPDATE configuration_requests SET created_at = now() - interval '25 hours'");
    await pool.query("UPDATE owners SET created_at = now() - interval '25 hours'");
    await service.cleanupExpired();
    const { rows } = await pool.query<{ requests: number; configs: number; owners: number }>(
      `SELECT (SELECT count(*)::int FROM configuration_requests) AS requests,
              (SELECT count(*)::int FROM allocation_configs) AS configs,
              (SELECT count(*)::int FROM owners) AS owners`,
    );
    expect(rows[0]).toEqual({ requests: 0, configs: 0, owners: 0 });
    const gone = await pool.query('SELECT 1 FROM allocation_configs WHERE id = $1', [approved.configId]);
    expect(gone.rowCount).toBe(0);
  });

  it('caps stored demo proposals even with concurrent submissions', async () => {
    const submissions = await Promise.all(Array.from({ length: 101 }, () =>
      service.submit(proposal, 'operator').then(() => true, () => false)));
    expect(submissions.filter(Boolean)).toHaveLength(100);
    const { rows } = await pool.query<{ count: number }>('SELECT count(*)::int AS count FROM configuration_requests');
    expect(rows[0]!.count).toBe(100);
  });

  it('keeps a rejected proposal out of live inventory', async () => {
    const submitted = await service.submit(proposal, 'operator');
    await service.reject(submitted.id, 'administrator', 'Sailing cancelled');
    await expect(service.approve(submitted.id, 'administrator')).rejects.toThrow('rejected');
    const { rows } = await pool.query('SELECT count(*)::int AS count FROM allocation_configs');
    expect(rows[0].count).toBe(0);
  });
});
