import { Injectable } from '@nestjs/common';
import { AccountPoolEntryDocument } from '../../../database/schemas/account-pool-entry.schema';
import { CostTrackerService } from '../cost-tracker.service';
import {
  ILoadBalancerStrategy,
  SelectionContext,
} from './load-balancer-strategy.interface';

/**
 * Least-cost strategy: selects the account with the lowest accumulated cost
 * in the current billing period.
 *
 * Cost scores come from CostTrackerService's in-memory cache (0–1 scale,
 * where 1 = lowest cost). We pick the account with the highest cost score
 * (i.e. the one that has spent the least relative to its limit).
 *
 * When scores are tied, the first account in the list wins (stable selection).
 */
@Injectable()
export class LeastCostStrategy implements ILoadBalancerStrategy {
  constructor(private readonly costTracker: CostTrackerService) {}

  select(
    accounts: AccountPoolEntryDocument[],
    _context?: SelectionContext,
  ): AccountPoolEntryDocument | null {
    if (accounts.length === 0) return null;
    if (accounts.length === 1) return accounts[0];

    let best: AccountPoolEntryDocument = accounts[0];
    let bestScore = this.score(best);

    for (let i = 1; i < accounts.length; i++) {
      const s = this.score(accounts[i]);
      if (s > bestScore) {
        bestScore = s;
        best = accounts[i];
      }
    }

    return best;
  }

  private score(account: AccountPoolEntryDocument): number {
    const id =
      (account as any)._id?.toString?.() ?? (account as any).id ?? '';
    return this.costTracker.getCostScore(id);
  }
}
