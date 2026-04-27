import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Inject,
  forwardRef,
  Optional,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AccountPoolEntry,
  AccountPoolEntryDocument,
} from '../../database/schemas/account-pool-entry.schema';
import { CircuitBreakerService } from './circuit-breaker.service';
import { CostTrackerService } from './cost-tracker.service';
import {
  ILoadBalancerStrategy,
  SelectionContext,
} from './strategies/load-balancer-strategy.interface';
import { WeightedRoundRobinStrategy } from './strategies/weighted-round-robin.strategy';
import { CompositeScoreStrategy } from './strategies/composite-score.strategy';
import { REGISTERED_PROVIDER_NAMES } from '../../queue/queue.constants';
import { ProviderConfigService } from '../provider-config.service';

export interface AccountPoolConfig {
  /** Maximum retry attempts when selecting an account (default 3) */
  max_retries: number;
  /** Refresh interval for in-memory snapshot in ms (default 15000) */
  refresh_interval_ms: number;
}

const DEFAULT_CONFIG: AccountPoolConfig = {
  max_retries: 3,
  refresh_interval_ms: 15_000,
};

export interface RequestResult {
  success: boolean;
  durationMs: number;
  estimatedCost?: number;
  errorCode?: string;
  retryable?: boolean;
}

/**
 * Validation errors for account creation/update.
 */
export class AccountValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountValidationError';
  }
}

@Injectable()
export class AccountPoolService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AccountPoolService.name);
  private config: AccountPoolConfig;

  /** providerName → list of account documents (in-memory snapshot) */
  private readonly snapshot = new Map<string, AccountPoolEntryDocument[]>();
  /** Set of provider names that have at least one account in the DB */
  private readonly poolProviders = new Set<string>();
  private refreshTimer?: NodeJS.Timeout;

  constructor(
    @InjectModel(AccountPoolEntry.name)
    private readonly accountModel: Model<AccountPoolEntryDocument>,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly costTracker: CostTrackerService,
    private readonly defaultStrategy: WeightedRoundRobinStrategy,
    private readonly compositeStrategy: CompositeScoreStrategy,
    @Optional()
    @Inject(forwardRef(() => ProviderConfigService))
    private readonly providerConfigService?: ProviderConfigService,
  ) {
    this.config = { ...DEFAULT_CONFIG };
  }

  configure(partial: Partial<AccountPoolConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  getConfig(): AccountPoolConfig {
    return { ...this.config };
  }

  // ─── Lifecycle ─────────────────────────────────────────────────

  onModuleInit(): void {
    void this.refreshAllPools();
    this.refreshTimer = setInterval(() => {
      void this.refreshAllPools();
    }, this.config.refresh_interval_ms);
  }

  onModuleDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  // ─── Validation ────────────────────────────────────────────────

  /**
   * Validate an account entry before creation.
   * Throws AccountValidationError if invalid.
   */
  validateAccountEntry(entry: {
    provider_name?: string;
    api_key?: string;
    weight?: number;
  }): void {
    if (!entry.provider_name || entry.provider_name.trim() === '') {
      throw new AccountValidationError('provider_name must be non-empty');
    }
    if (
      !REGISTERED_PROVIDER_NAMES.includes(entry.provider_name as any)
    ) {
      throw new AccountValidationError(
        `provider_name "${entry.provider_name}" is not a registered provider. Valid providers: ${REGISTERED_PROVIDER_NAMES.join(', ')}`,
      );
    }
    if (!entry.api_key || entry.api_key.trim() === '') {
      throw new AccountValidationError('api_key must be non-empty');
    }
    if (entry.weight !== undefined && (typeof entry.weight !== 'number' || entry.weight <= 0)) {
      throw new AccountValidationError('weight must be a positive number');
    }
  }

  /**
   * Check for duplicate api_key within the same provider.
   * Returns true if a duplicate exists.
   */
  async isDuplicateApiKey(
    providerName: string,
    apiKey: string,
    excludeId?: string,
  ): Promise<boolean> {
    const query: Record<string, unknown> = {
      provider_name: providerName,
      api_key: apiKey,
    };
    if (excludeId) {
      query._id = { $ne: excludeId };
    }
    const existing = await this.accountModel.findOne(query).lean().exec();
    return !!existing;
  }

  // ─── Pool Queries ───────────────────────────────────────────────

  /**
   * Check if a provider has an account pool configured.
   */
  hasPool(providerName: string): boolean {
    return this.poolProviders.has(providerName);
  }

  /**
   * Get active (enabled + not circuit-broken + not over monthly limit) accounts
   * for a provider from the in-memory snapshot.
   */
  getActiveAccounts(providerName: string): AccountPoolEntryDocument[] {
    const all = this.snapshot.get(providerName) ?? [];
    return all.filter((a) => {
      if (!a.enabled) return false;
      const id = (a as any)._id?.toString?.() ?? '';
      // Exclude accounts over monthly cost limit (hard exclusion)
      if (this.costTracker.isOverMonthlyLimit(id)) return false;
      return true;
    });
  }

  // ─── Account Selection ─────────────────────────────────────────

  /**
   * Select an account from the pool using the configured strategy.
   * Implements retry logic: on failure, retries with a different account
   * up to max_retries times.
   *
   * Returns null if no account is available (caller should fall back to
   * ProviderConfigService single-account logic or fallback provider).
   */
  async selectAccount(
    providerName: string,
    context?: SelectionContext,
    excludeIds?: Set<string>,
  ): Promise<AccountPoolEntryDocument | null> {
    const active = this.getActiveAccounts(providerName);
    if (active.length === 0) return null;

    // If only one account, return it directly (Requirement 3.5)
    if (active.length === 1) return active[0];

    // Filter out excluded accounts (used during retry)
    const candidates = excludeIds
      ? active.filter((a) => {
          const id = (a as any)._id?.toString?.() ?? '';
          return !excludeIds.has(id);
        })
      : active;

    if (candidates.length === 0) return null;

    // Enrich accounts with availability scores for composite strategy
    const enriched = await this.enrichWithAvailabilityScores(candidates);

    // Try composite strategy first (it handles availability threshold)
    const selected = this.compositeStrategy.select(enriched, context);
    if (selected) return selected;

    // Fall back to default weighted-round-robin
    return this.defaultStrategy.select(candidates, context);
  }

  /**
   * Select an account with automatic retry on retryable errors.
   * Returns the selected account, or null if all retries are exhausted.
   */
  async selectAccountWithRetry(
    providerName: string,
    context?: SelectionContext,
  ): Promise<AccountPoolEntryDocument | null> {
    const excludeIds = new Set<string>();
    const maxAttempts = Math.min(
      this.config.max_retries,
      this.getActiveAccounts(providerName).length,
    );

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const account = await this.selectAccount(providerName, context, excludeIds);
      if (account) return account;
      // If selectAccount returns null, all candidates are exhausted
      break;
    }

    return null;
  }

  /**
   * Get the next retry candidate, excluding previously tried accounts.
   * Used by the integration layer after a retryable error.
   */
  async retrySelect(
    providerName: string,
    excludeIds: Set<string>,
    context?: SelectionContext,
  ): Promise<AccountPoolEntryDocument | null> {
    if (excludeIds.size >= this.config.max_retries) return null;
    return this.selectAccount(providerName, context, excludeIds);
  }

  // ─── Result Reporting ────────────────────────────────────────────

  /**
   * Report the result of a request served by a specific account.
   * Updates circuit breaker state and records cost.
   */
  async reportResult(
    accountId: string,
    providerName: string,
    result: RequestResult,
  ): Promise<void> {
    try {
      // Update circuit breaker
      if (result.success) {
        await this.circuitBreaker.recordSuccess(accountId);
      } else {
        await this.circuitBreaker.recordFailure(accountId);
      }

      // Record cost if provided
      if (result.estimatedCost !== undefined && result.estimatedCost > 0) {
        await this.costTracker.recordCost(
          accountId,
          providerName,
          result.estimatedCost,
          result.success,
          result.durationMs,
        );
      }
    } catch (err: any) {
      this.logger.error(
        `Failed to report result for account ${accountId}: ${err.message}`,
      );
    }
  }

  // ─── Pool Refresh ──────────────────────────────────────────────

  /**
   * Refresh the in-memory snapshot for a specific provider.
   */
  async refreshPool(providerName: string): Promise<void> {
    try {
      const accounts = await this.accountModel
        .find({ provider_name: providerName })
        .lean()
        .exec();

      if (accounts.length > 0) {
        this.snapshot.set(
          providerName,
          accounts as unknown as AccountPoolEntryDocument[],
        );
        this.poolProviders.add(providerName);
      } else {
        this.snapshot.delete(providerName);
        this.poolProviders.delete(providerName);
      }
    } catch (err: any) {
      this.logger.warn(
        `Failed to refresh pool for ${providerName}: ${err.message}`,
      );
      // Keep existing snapshot on failure
    }
  }

  /**
   * Refresh all provider pools from the database.
   * Also checks provider runtime config enabled state and cascades
   * disable/re-enable to account pool entries.
   */
  async refreshAllPools(): Promise<void> {
    try {
      const allAccounts = await this.accountModel.find().lean().exec();

      // Group by provider_name
      const grouped = new Map<string, AccountPoolEntryDocument[]>();
      for (const account of allAccounts) {
        const pn = account.provider_name;
        if (!grouped.has(pn)) grouped.set(pn, []);
        grouped.get(pn)!.push(account as unknown as AccountPoolEntryDocument);
      }

      // Provider disable/re-enable cascade
      if (this.providerConfigService) {
        for (const [providerName] of grouped) {
          try {
            const providerConfig =
              this.providerConfigService.getResolvedSync(providerName);
            if (!providerConfig.enabled) {
              await this.autoDisableByProvider(providerName);
            } else {
              await this.autoReEnableByProvider(providerName);
            }
          } catch (err: any) {
            this.logger.warn(
              `Failed to check provider status for ${providerName}: ${err.message}`,
            );
          }
        }

        // Re-fetch after potential cascade updates
        const refreshed = await this.accountModel.find().lean().exec();
        grouped.clear();
        for (const account of refreshed) {
          const pn = account.provider_name;
          if (!grouped.has(pn)) grouped.set(pn, []);
          grouped.get(pn)!.push(account as unknown as AccountPoolEntryDocument);
        }
      }

      // Update snapshot
      this.poolProviders.clear();
      this.snapshot.clear();
      for (const [providerName, accounts] of grouped) {
        this.snapshot.set(providerName, accounts);
        this.poolProviders.add(providerName);
      }
    } catch (err: any) {
      this.logger.warn(`Failed to refresh all pools: ${err.message}`);
      // Keep existing snapshot on failure
    }
  }

  // ─── Provider Cascade Helpers ──────────────────────────────────

  /**
   * Auto-disable all enabled accounts for a provider that has been disabled.
   * Marks them with metadata._auto_disabled_by_provider = true so they can
   * be restored when the provider is re-enabled.
   */
  private async autoDisableByProvider(providerName: string): Promise<void> {
    try {
      const result = await this.accountModel.updateMany(
        {
          provider_name: providerName,
          enabled: true,
        },
        {
          $set: {
            enabled: false,
            'metadata._auto_disabled_by_provider': true,
          },
        },
      );
      if (result.modifiedCount > 0) {
        this.logger.log(
          `Auto-disabled ${result.modifiedCount} accounts for provider ${providerName}`,
        );
      }
    } catch (err: any) {
      this.logger.warn(
        `Failed to auto-disable accounts for ${providerName}: ${err.message}`,
      );
    }
  }

  /**
   * Re-enable accounts that were auto-disabled when their provider was disabled.
   * Only restores accounts that have the _auto_disabled_by_provider marker.
   */
  private async autoReEnableByProvider(providerName: string): Promise<void> {
    try {
      const result = await this.accountModel.updateMany(
        {
          provider_name: providerName,
          enabled: false,
          'metadata._auto_disabled_by_provider': true,
        },
        {
          $set: { enabled: true },
          $unset: { 'metadata._auto_disabled_by_provider': '' },
        },
      );
      if (result.modifiedCount > 0) {
        this.logger.log(
          `Auto-re-enabled ${result.modifiedCount} accounts for provider ${providerName}`,
        );
      }
    } catch (err: any) {
      this.logger.warn(
        `Failed to auto-re-enable accounts for ${providerName}: ${err.message}`,
      );
    }
  }

  // ─── Internal Helpers ──────────────────────────────────────────

  /**
   * Enrich account documents with availability scores from the circuit breaker.
   * Stores the score in metadata._availabilityScore for the CompositeScoreStrategy.
   */
  private async enrichWithAvailabilityScores(
    accounts: AccountPoolEntryDocument[],
  ): Promise<AccountPoolEntryDocument[]> {
    return Promise.all(
      accounts.map(async (a) => {
        const id = (a as any)._id?.toString?.() ?? '';
        const score = await this.circuitBreaker.getAvailabilityScore(id);
        // Create a shallow copy with enriched metadata
        const enriched = {
          ...((a as any).toObject?.() ?? a),
          metadata: {
            ...((a as any).metadata ?? {}),
            _availabilityScore: score,
          },
        } as unknown as AccountPoolEntryDocument;
        return enriched;
      }),
    );
  }
}
