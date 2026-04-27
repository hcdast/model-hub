import { Injectable } from '@nestjs/common';
import { AccountPoolEntryDocument } from '../../../database/schemas/account-pool-entry.schema';
import {
  ILoadBalancerStrategy,
  SelectionContext,
} from './load-balancer-strategy.interface';

/**
 * Weighted-round-robin: distributes requests proportionally to each account's weight.
 *
 * Uses the "smooth weighted round-robin" algorithm (Nginx-style):
 *   1. For each candidate, add its configured weight to a running `currentWeight`.
 *   2. Pick the candidate with the highest `currentWeight`.
 *   3. Subtract the total weight from the winner's `currentWeight`.
 *
 * This produces an even spread without bursts.
 */
@Injectable()
export class WeightedRoundRobinStrategy implements ILoadBalancerStrategy {
  /** accountId → running current weight */
  private readonly currentWeights = new Map<string, number>();

  select(
    accounts: AccountPoolEntryDocument[],
    _context?: SelectionContext,
  ): AccountPoolEntryDocument | null {
    if (accounts.length === 0) return null;
    if (accounts.length === 1) return accounts[0];

    const totalWeight = accounts.reduce((sum, a) => sum + (a.weight ?? 1), 0);
    if (totalWeight <= 0) return accounts[0];

    let best: AccountPoolEntryDocument | null = null;
    let bestCw = -Infinity;

    for (const account of accounts) {
      const id = (account as any)._id?.toString?.() ?? (account as any).id ?? '';
      const w = account.weight ?? 1;

      const prev = this.currentWeights.get(id) ?? 0;
      const cw = prev + w;
      this.currentWeights.set(id, cw);

      if (cw > bestCw) {
        bestCw = cw;
        best = account;
      }
    }

    if (best) {
      const bestId =
        (best as any)._id?.toString?.() ?? (best as any).id ?? '';
      this.currentWeights.set(bestId, bestCw - totalWeight);
    }

    return best;
  }

  /** Reset internal state (useful for testing). */
  reset(): void {
    this.currentWeights.clear();
  }
}
