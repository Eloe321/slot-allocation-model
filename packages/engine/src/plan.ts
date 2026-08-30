import { sumAvailable, type WaterfallStep, type WaterfallTrace } from './waterfall.js';

export interface Split {
  rowId: number;
  step: WaterfallStep;
  quantity: number;
}

export type PlanResult =
  | { ok: true; splits: Split[] }
  | { ok: false; requested: number; available: number; shortfall: number };

/**
 * Walk the candidates in order, taking as much as each can give.
 *
 * Splitting rather than requiring a single row to satisfy the whole request is
 * deliberate: a partially-filled dedicated allocation would otherwise strand its
 * remaining seats. Each split is later persisted as its own hold, link, and
 * ledger entry so a release returns seats to the exact source row.
 */
export function planConsumption(trace: WaterfallTrace, quantity: number): PlanResult {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new RangeError('quantity must be a positive integer');
  }

  const splits: Split[] = [];
  let remaining = quantity;

  for (const candidate of trace.candidates) {
    if (remaining === 0) break;
    const free = Math.max(
      0,
      candidate.row.allocatedSlots - candidate.row.soldSlots - candidate.row.heldSlots,
    );
    if (free === 0) continue;
    const take = Math.min(free, remaining);
    splits.push({ rowId: candidate.row.id, step: candidate.step, quantity: take });
    remaining -= take;
  }

  if (remaining > 0) {
    const available = sumAvailable(trace);
    return { ok: false, requested: quantity, available, shortfall: quantity - available };
  }

  return { ok: true, splits };
}
