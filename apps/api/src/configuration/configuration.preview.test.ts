import { describe, expect, it } from 'vitest';
import { previewConfiguration } from './configuration.preview.js';

const valid = {
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

describe('configuration preview', () => {
  it('shows the parent amount that remains sellable after a child is carved out', () => {
    const preview = previewConfiguration(valid);
    expect(preview.violations).toEqual([]);
    expect(preview.directAllocated).toBe(100);
    expect(preview.rows.find((row) => row.channel === 'online')).toMatchObject({
      rawAvailable: 80,
      nettedAvailable: 70,
    });
  });

  it('reports a child that exceeds its parent before anything is saved', () => {
    const preview = previewConfiguration({
      ...valid,
      rows: [valid.rows[0], { ...valid.rows[1], allocatedSlots: 5 }, valid.rows[2]],
    });
    expect(preview.violations.map((item) => item.code)).toContain('online_children_exceed_parent');
  });

  it('treats repeated owner names as the same owner for duplicate-row checks', () => {
    const preview = previewConfiguration({ ...valid, rows: [...valid.rows, valid.rows[2]] });
    expect(preview.violations.map((item) => item.code)).toContain('duplicate_owner_row');
  });

  it('rejects malformed dates and ownerless partner rows', () => {
    expect(() => previewConfiguration({ ...valid, departsAt: 'tomorrow' })).toThrow('departsAt');
    expect(() => previewConfiguration({ ...valid, rows: [...valid.rows, { channel: 'reseller', allocationType: 'flexible', allocatedSlots: 3 }] })).toThrow('ownerName');
  });

  it('rejects seat counts outside the supported database range', () => {
    expect(() => previewConfiguration({ ...valid, capacity: 2_147_483_648 })).toThrow('capacity');
  });
});
