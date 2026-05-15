import { AccountPoolEntryDocument } from '../../../database/schemas/account-pool-entry.schema';

export interface SelectionContext {
  model?: string;
  featureType?: string;
  apiKey?: string;
}

/**
 * Pluggable load-balancing strategy interface.
 * Implementations decide how to pick one account from a list of active entries.
 */
export interface ILoadBalancerStrategy {
  /**
   * Select a single account from the given list.
   * Returns null when no suitable account can be found.
   */
  select(
    accounts: AccountPoolEntryDocument[],
    context?: SelectionContext,
  ): AccountPoolEntryDocument | null;
}
