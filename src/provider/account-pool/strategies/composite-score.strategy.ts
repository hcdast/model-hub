import { Injectable, Logger } from '@nestjs/common';
import { AccountPoolEntryDocument } from '../../../database/schemas/account-pool-entry.schema';
import { CircuitBreakerService } from '../circuit-breaker.service';
import { CostTrackerService } from '../cost-tracker.service';
import {
  ILoadBalancerStrategy,
  SelectionContext,
} from './load-balancer-strategy.interface';

export interface CompositeScoreConfig {
  /** Weight given to availability in the composite score (default 0.7) */
  availability_weight: number;
  /** Weight given to cost efficiency in the composite score (default 0.3) */
  cost_weight: number;
  /** Accounts below this availability score are excluded (default 0.3) */
  availability_threshold: number;
}

const DEFAULT_CONFIG: CompositeScoreConfig = {
  availability_weight: 0.7,
  cost_weight: 0.3,
  availability_threshold: 0.3,
};

/**
 * Composite-score strategy: selects the account with the highest combined
 * score = (availability_weight × availability_score) + (cost_weight × cost_score).
 *
 * Accounts whose availability_score is below the configured threshold are
 * excluded regardless of their cost_score (Requirement 7.5).
 */
@Injectable()
export class CompositeScoreStrategy implements ILoadBalancerStrategy {
  private readonly logger = new Logger(CompositeScoreStrategy.name);
  private config: CompositeScoreConfig;

  constructor(
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly costTracker: CostTrackerService,
  ) {
    this.config = { ...DEFAULT_CONFIG };
  }

  configure(partial: Partial<CompositeScoreConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  getConfig(): CompositeScoreConfig {
    return { ...this.config };
  }

  /**
   * Synchronous selection using pre-fetched availability scores.
   * The caller is expected to provide scores via {@link selectWithScores}
   * or use the async {@link selectAsync} helper.
   *
   * For the ILoadBalancerStrategy interface we provide a sync version that
   * works with pre-computed scores stored on the account documents' metadata.
   */
  select(
    accounts: AccountPoolEntryDocument[],
    _context?: SelectionContext,
  ): AccountPoolEntryDocument | null {
    if (accounts.length === 0) return null;

    // Build scored list using metadata._availabilityScore if present,
    // otherwise fall back to 1.0 (fully healthy).
    const scored = accounts.map((a) => {
      const id = (a as any)._id?.toString?.() ?? (a as any).id ?? '';
      const availScore =
        (a.metadata as any)?._availabilityScore ?? 1.0;
      const costScore = this.costTracker.getCostScore(id);
      return { account: a, availScore, costScore };
    });

    return this.pickBest(scored);
  }

  /**
   * Async selection that fetches live availability scores from the circuit breaker.
   */
  async selectAsync(
    accounts: AccountPoolEntryDocument[],
    _context?: SelectionContext,
  ): Promise<AccountPoolEntryDocument | null> {
    if (accounts.length === 0) return null;

    const scored = await Promise.all(
      accounts.map(async (a) => {
        const id = (a as any)._id?.toString?.() ?? (a as any).id ?? '';
        const availScore =
          await this.circuitBreaker.getAvailabilityScore(id);
        const costScore = this.costTracker.getCostScore(id);
        return { account: a, availScore, costScore };
      }),
    );

    return this.pickBest(scored);
  }

  /**
   * Pure scoring + selection logic, also usable directly in tests.
   */
  selectWithScores(
    entries: {
      account: AccountPoolEntryDocument;
      availScore: number;
      costScore: number;
    }[],
  ): AccountPoolEntryDocument | null {
    return this.pickBest(entries);
  }

  /** Compute composite score for a single entry. */
  computeScore(availScore: number, costScore: number): number {
    return (
      this.config.availability_weight * availScore +
      this.config.cost_weight * costScore
    );
  }

  // ─── Internal ──────────────────────────────────────────────────

  private pickBest(
    entries: {
      account: AccountPoolEntryDocument;
      availScore: number;
      costScore: number;
    }[],
  ): AccountPoolEntryDocument | null {
    // Filter out accounts below availability threshold
    const eligible = entries.filter(
      (e) => e.availScore >= this.config.availability_threshold,
    );

    if (eligible.length === 0) return null;

    let best = eligible[0];
    let bestComposite = this.computeScore(best.availScore, best.costScore);

    for (let i = 1; i < eligible.length; i++) {
      const composite = this.computeScore(
        eligible[i].availScore,
        eligible[i].costScore,
      );
      if (composite > bestComposite) {
        bestComposite = composite;
        best = eligible[i];
      }
    }

    return best.account;
  }
}
