import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { selectCandidates, sumAvailable } from './waterfall.js';
import { planConsumption } from './plan.js';
import { checkInvariants } from './invariants.js';
import type { AllocationRow, RequesterIdentity } from './types.js';

/** Generates only structurally valid trees, so failures indicate engine bugs. */
const validTree = fc
  .record({
    capacity: fc.integer({ min: 20, max: 200 }),
    counterShare: fc.integer({ min: 0, max: 40 }),
    poolShare: fc.integer({ min: 0, max: 30 }),
    agencyShare: fc.integer({ min: 0, max: 30 }),
    managedShare: fc.integer({ min: 0, max: 20 }),
    onlineSold: fc.integer({ min: 0, max: 20 }),
  })
  .map(({ capacity, counterShare, poolShare, agencyShare, managedShare, onlineSold }) => {
    const counter = Math.min(counterShare, Math.floor(capacity / 2));
    const online = capacity - counter;
    const pool = Math.min(poolShare, online);
    const agency = Math.min(agencyShare, online - pool);
    const managed = Math.min(managedShare, pool);
    const rows: AllocationRow[] = [
      {
        id: 1,
        channel: 'counter',
        ownerId: null,
        allocationType: 'direct',
        fundingSource: 'online',
        allocatedSlots: counter,
        soldSlots: 0,
        heldSlots: 0,
        ownerIsHidden: false,
      },
      {
        id: 2,
        channel: 'online',
        ownerId: null,
        allocationType: 'direct',
        fundingSource: 'online',
        allocatedSlots: online,
        soldSlots: Math.min(onlineSold, Math.max(0, online - pool - agency)),
        heldSlots: 0,
        ownerIsHidden: false,
      },
      {
        id: 3,
        channel: 'partner_pool',
        ownerId: null,
        allocationType: 'flexible',
        fundingSource: 'online',
        allocatedSlots: pool,
        soldSlots: 0,
        heldSlots: 0,
        ownerIsHidden: false,
      },
      {
        id: 4,
        channel: 'agency',
        ownerId: 7,
        allocationType: 'guaranteed',
        fundingSource: 'online',
        allocatedSlots: agency,
        soldSlots: 0,
        heldSlots: 0,
        ownerIsHidden: false,
      },
      {
        id: 5,
        channel: 'agency',
        ownerId: 9,
        allocationType: 'guaranteed',
        fundingSource: 'partner_pool',
        allocatedSlots: managed,
        soldSlots: 0,
        heldSlots: 0,
        ownerIsHidden: false,
      },
    ];
    return { rows, capacity };
  });

const identities: RequesterIdentity[] = [
  { kind: 'counter' },
  { kind: 'online' },
  { kind: 'marketplace' },
  { kind: 'owner', channel: 'agency', ownerId: 7, managed: false },
  { kind: 'owner', channel: 'agency', ownerId: 9, managed: true },
];

describe('engine safety properties', () => {
  it('generates only valid trees', () => {
    fc.assert(
      fc.property(validTree, ({ rows, capacity }) => {
        expect(checkInvariants(rows, capacity)).toEqual([]);
      }),
      { numRuns: 300 },
    );
  });

  it('never offers an identity more seats than physically remain', () => {
    fc.assert(
      fc.property(validTree, fc.integer({ min: 0, max: 4 }), ({ rows, capacity }, idx) => {
        const identity = identities[idx]!;
        const trace = selectCandidates(rows, identity);
        const physicallySold = rows
          .filter((r) => r.allocationType === 'direct')
          .reduce((t, r) => t + r.soldSlots + r.heldSlots, 0);
        expect(sumAvailable(trace)).toBeLessThanOrEqual(capacity - physicallySold);
      }),
      { numRuns: 500 },
    );
  });

  it('produces splits that exactly satisfy the request, or a shortfall', () => {
    fc.assert(
      fc.property(
        validTree,
        fc.integer({ min: 0, max: 4 }),
        fc.integer({ min: 1, max: 250 }),
        ({ rows }, idx, qty) => {
          const trace = selectCandidates(rows, identities[idx]!);
          const result = planConsumption(trace, qty);
          if (result.ok) {
            const total = result.splits.reduce((t, s) => t + s.quantity, 0);
            expect(total).toBe(qty);
            expect(result.splits.every((s) => s.quantity > 0)).toBe(true);
          } else {
            expect(result.shortfall).toBe(qty - result.available);
            expect(result.available).toBeLessThan(qty);
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  it('never plans more from a row than that row has free', () => {
    fc.assert(
      fc.property(
        validTree,
        fc.integer({ min: 0, max: 4 }),
        fc.integer({ min: 1, max: 250 }),
        ({ rows }, idx, qty) => {
          const trace = selectCandidates(rows, identities[idx]!);
          const result = planConsumption(trace, qty);
          if (!result.ok) return;
          for (const split of result.splits) {
            const candidate = trace.candidates.find((c) => c.row.id === split.rowId)!;
            const free =
              candidate.row.allocatedSlots - candidate.row.soldSlots - candidate.row.heldSlots;
            expect(split.quantity).toBeLessThanOrEqual(free);
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});
