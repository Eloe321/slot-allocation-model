import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { selectCandidates, sumAvailable } from './waterfall.js';
import { planConsumption } from './plan.js';
import { checkInvariants } from './invariants.js';
import type { AllocationRow, RequesterIdentity } from './types.js';

/**
 * Trees that are *roughly* shaped like a real config.
 *
 * The clamping below only keeps the shape plausible; it deliberately does not
 * guarantee validity. Every property gates on `fc.pre(checkInvariants(...))`
 * instead, so the generator and the invariant module are forced to agree on
 * what "valid" means — a generator that hand-guaranteed validity would happily
 * keep producing trees the invariant module had since learned to reject.
 */
const candidateTree = fc
  .record({
    capacity: fc.integer({ min: 20, max: 200 }),
    counterShare: fc.integer({ min: 0, max: 40 }),
    poolShare: fc.integer({ min: 0, max: 30 }),
    agencyShare: fc.integer({ min: 0, max: 30 }),
    managedShare: fc.integer({ min: 0, max: 20 }),
    onlineSold: fc.integer({ min: 0, max: 20 }),
    onlineHeld: fc.integer({ min: 0, max: 10 }),
    poolHeld: fc.integer({ min: 0, max: 10 }),
    agencyHeld: fc.integer({ min: 0, max: 10 }),
    managedHeld: fc.integer({ min: 0, max: 10 }),
    agencyHidden: fc.boolean(),
    managedHidden: fc.boolean(),
  })
  .map((g) => {
    const counter = Math.min(g.counterShare, Math.floor(g.capacity / 2));
    const online = g.capacity - counter;
    const pool = Math.min(g.poolShare, online);
    const agency = Math.min(g.agencyShare, online - pool);
    const managed = Math.min(g.managedShare, pool);
    const onlineSold = Math.min(g.onlineSold, Math.max(0, online - pool - agency));
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
        soldSlots: onlineSold,
        heldSlots: Math.min(g.onlineHeld, online - onlineSold),
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
        heldSlots: Math.min(g.poolHeld, pool),
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
        heldSlots: Math.min(g.agencyHeld, agency),
        ownerIsHidden: g.agencyHidden,
      },
      {
        id: 5,
        channel: 'agency',
        ownerId: 9,
        allocationType: 'guaranteed',
        fundingSource: 'partner_pool',
        allocatedSlots: managed,
        soldSlots: 0,
        heldSlots: Math.min(g.managedHeld, managed),
        ownerIsHidden: g.managedHidden,
      },
    ];
    return { rows, capacity: g.capacity };
  });

const identities: RequesterIdentity[] = [
  { kind: 'counter' },
  { kind: 'online' },
  { kind: 'marketplace' },
  { kind: 'owner', channel: 'agency', ownerId: 7, managed: false },
  { kind: 'owner', channel: 'agency', ownerId: 9, managed: true },
];

const committedSeats = (rows: AllocationRow[]): number =>
  rows.reduce((total, r) => total + r.soldSlots + r.heldSlots, 0);

describe('engine safety properties', () => {
  it('generates a useful fraction of invariant-valid trees', () => {
    const sampled = fc.sample(candidateTree, 2000);
    const valid = sampled.filter(({ rows, capacity }) => checkInvariants(rows, capacity).length === 0);
    expect(valid.length).toBeGreaterThan(sampled.length / 4);
  });

  it('never offers an identity more seats than physically remain', () => {
    fc.assert(
      fc.property(candidateTree, fc.integer({ min: 0, max: 4 }), ({ rows, capacity }, idx) => {
        fc.pre(checkInvariants(rows, capacity).length === 0);
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
        candidateTree,
        fc.integer({ min: 0, max: 4 }),
        fc.integer({ min: 1, max: 250 }),
        ({ rows, capacity }, idx, qty) => {
          fc.pre(checkInvariants(rows, capacity).length === 0);
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
        candidateTree,
        fc.integer({ min: 0, max: 4 }),
        fc.integer({ min: 1, max: 250 }),
        ({ rows, capacity }, idx, qty) => {
          fc.pre(checkInvariants(rows, capacity).length === 0);
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

  /**
   * The headline claim is cross-identity, so the property has to be too.
   *
   * Asking a single identity whether it was offered too much is trivially
   * satisfiable: each identity's view can be perfectly self-consistent while two
   * views between them hand out the same physical seat. Draining every identity
   * in turn, against one shared mutable tree, is what actually catches that.
   */
  it('draining every identity in turn never exceeds physical capacity', () => {
    fc.assert(
      fc.property(candidateTree, ({ rows, capacity }) => {
        fc.pre(checkInvariants(rows, capacity).length === 0);

        const current = rows.map((r) => ({ ...r }));
        const startingCommitment = committedSeats(current);
        let granted = 0;

        for (let iteration = 0; iteration < 1000; iteration += 1) {
          let progressed = false;
          for (const identity of identities) {
            const trace = selectCandidates(current, identity);
            const result = planConsumption(trace, 1);
            if (!result.ok) continue;
            for (const split of result.splits) {
              const target = current.find((r) => r.id === split.rowId)!;
              target.heldSlots += split.quantity;
            }
            granted += 1;
            progressed = true;
          }
          if (!progressed) break;
        }

        // Every grant was for exactly one seat, and landed on exactly one row.
        expect(committedSeats(current)).toBe(startingCommitment + granted);
        expect(committedSeats(current)).toBeLessThanOrEqual(capacity);
        expect(
          checkInvariants(current, capacity).some((v) => v.code === 'row_overcommitted'),
        ).toBe(false);
      }),
      { numRuns: 300 },
    );
  });
});
