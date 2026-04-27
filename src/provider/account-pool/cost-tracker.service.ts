import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AccountCostDaily,
  AccountCostDailyDocument,
} from '../../database/schemas/account-cost-daily.schema';
import {
  AccountPoolEntry,
  AccountPoolEntryDocument,
} from '../../database/schemas/account-pool-entry.schema';

/** In-memory snapshot of an account's cost state */
interface AccountCostSnapshot {
  dailyCost: number;
  monthlyCost: number;
  dailyCostLimit: number;
  monthlyCostLimit: number;
  /** ISO date string 'YYYY-MM-DD' the snapshot was taken for */
  snapshotDate: string;
}

@Injectable()
export class CostTrackerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CostTrackerService.name);

  /** accountId → cost snapshot */
  private readonly cache = new Map<string, AccountCostSnapshot>();
  private refreshTimer?: NodeJS.Timeout;

  constructor(
    @InjectModel(AccountCostDaily.name)
    private readonly costModel: Model<AccountCostDailyDocument>,
    @InjectModel(AccountPoolEntry.name)
    private readonly accountModel: Model<AccountPoolEntryDocument>,
  ) {}

  onModuleInit(): void {
    void this.refreshAllSnapshots();
    // Refresh every 15 seconds, consistent with ProviderConfigService
    this.refreshTimer = setInterval(() => {
      void this.refreshAllSnapshots();
    }, 15_000);
  }

  onModuleDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  // ─── Public API ────────────────────────────────────────────────

  /**
   * Record cost for a completed request using atomic MongoDB upsert.
   * Updates both the daily cost record and the in-memory cache.
   */
  async recordCost(
    accountId: string,
    providerName: string,
    cost: number,
    success: boolean,
    latencyMs?: number,
  ): Promise<void> {
    const date = this.todayString();

    try {
      // Atomic upsert: increment counters for the day
      const update: Record<string, unknown> = {
        $inc: {
          total_cost: cost,
          request_count: 1,
          ...(success ? { success_count: 1 } : { failure_count: 1 }),
        },
        $setOnInsert: {
          account_id: accountId,
          provider_name: providerName,
          date,
        },
      };

      await this.costModel.updateOne(
        { account_id: accountId, date },
        update,
        { upsert: true },
      );

      // Update avg_latency_ms incrementally if provided
      if (latencyMs !== undefined && latencyMs >= 0) {
        await this.updateAvgLatency(accountId, date, latencyMs);
      }

      // Update in-memory cache
      this.updateCacheAfterRecord(accountId, cost);
    } catch (err: any) {
      this.logger.error(
        `Failed to record cost for account ${accountId}: ${err.message}`,
      );
    }
  }

  /**
   * Get the total daily cost for an account on a given date.
   * Defaults to today.
   */
  async getDailyCost(accountId: string, date?: string): Promise<number> {
    const d = date ?? this.todayString();
    const record = await this.costModel
      .findOne({ account_id: accountId, date: d })
      .lean()
      .exec();
    return record?.total_cost ?? 0;
  }

  /**
   * Get the total monthly cost for an account in a given month.
   * Month format: 'YYYY-MM'. Defaults to current month.
   */
  async getMonthlyCost(accountId: string, month?: string): Promise<number> {
    const m = month ?? this.currentMonthPrefix();
    const records = await this.costModel
      .find({
        account_id: accountId,
        date: { $regex: `^${m}` },
      })
      .lean()
      .exec();
    return records.reduce((sum, r) => sum + (r.total_cost ?? 0), 0);
  }

  /**
   * Cost score: 0 = highest cost (worst), 1 = lowest cost (best).
   * Computed relative to the account's daily cost limit.
   * If no limit is set, returns 1 (no cost pressure).
   */
  getCostScore(accountId: string): number {
    const snap = this.cache.get(accountId);
    if (!snap) return 1; // no data = no cost pressure

    // Use daily limit as the reference if set
    if (snap.dailyCostLimit > 0) {
      const ratio = snap.dailyCost / snap.dailyCostLimit;
      return Math.max(0, 1 - ratio);
    }

    // Use monthly limit as fallback reference
    if (snap.monthlyCostLimit > 0) {
      const ratio = snap.monthlyCost / snap.monthlyCostLimit;
      return Math.max(0, 1 - ratio);
    }

    return 1;
  }

  /**
   * Check if an account has exceeded its daily cost limit.
   * A limit of 0 means unlimited.
   */
  isOverDailyLimit(accountId: string): boolean {
    const snap = this.cache.get(accountId);
    if (!snap || snap.dailyCostLimit <= 0) return false;
    return snap.dailyCost >= snap.dailyCostLimit;
  }

  /**
   * Check if an account has exceeded its monthly cost limit.
   * A limit of 0 means unlimited.
   */
  isOverMonthlyLimit(accountId: string): boolean {
    const snap = this.cache.get(accountId);
    if (!snap || snap.monthlyCostLimit <= 0) return false;
    return snap.monthlyCost >= snap.monthlyCostLimit;
  }

  // ─── Snapshot Refresh ──────────────────────────────────────────

  /**
   * Refresh in-memory cost snapshots for all accounts.
   * Called on init and periodically.
   */
  async refreshAllSnapshots(): Promise<void> {
    try {
      const accounts = await this.accountModel.find().lean().exec();
      const today = this.todayString();
      const monthPrefix = this.currentMonthPrefix();

      for (const account of accounts) {
        const accountId = account._id.toString();
        try {
          const dailyCost = await this.getDailyCost(accountId, today);
          const monthlyCost = await this.getMonthlyCost(accountId, monthPrefix);

          this.cache.set(accountId, {
            dailyCost,
            monthlyCost,
            dailyCostLimit: account.daily_cost_limit ?? 0,
            monthlyCostLimit: account.monthly_cost_limit ?? 0,
            snapshotDate: today,
          });
        } catch (err: any) {
          this.logger.warn(
            `Failed to refresh snapshot for account ${accountId}: ${err.message}`,
          );
        }
      }
    } catch (err: any) {
      this.logger.warn(`Failed to refresh cost snapshots: ${err.message}`);
    }
  }

  /**
   * Refresh snapshot for a single account.
   */
  async refreshSnapshot(accountId: string): Promise<void> {
    try {
      const account = await this.accountModel
        .findById(accountId)
        .lean()
        .exec();
      if (!account) {
        this.cache.delete(accountId);
        return;
      }

      const today = this.todayString();
      const monthPrefix = this.currentMonthPrefix();
      const dailyCost = await this.getDailyCost(accountId, today);
      const monthlyCost = await this.getMonthlyCost(accountId, monthPrefix);

      this.cache.set(accountId, {
        dailyCost,
        monthlyCost,
        dailyCostLimit: account.daily_cost_limit ?? 0,
        monthlyCostLimit: account.monthly_cost_limit ?? 0,
        snapshotDate: today,
      });
    } catch (err: any) {
      this.logger.warn(
        `Failed to refresh snapshot for account ${accountId}: ${err.message}`,
      );
    }
  }

  /** Expose cache for testing / inspection */
  getSnapshot(accountId: string): AccountCostSnapshot | undefined {
    return this.cache.get(accountId);
  }

  // ─── Internal Helpers ──────────────────────────────────────────

  private updateCacheAfterRecord(accountId: string, cost: number): void {
    const snap = this.cache.get(accountId);
    if (snap) {
      snap.dailyCost += cost;
      snap.monthlyCost += cost;
    }
    // If no snapshot exists yet, next refresh cycle will pick it up
  }

  private async updateAvgLatency(
    accountId: string,
    date: string,
    latencyMs: number,
  ): Promise<void> {
    try {
      const record = await this.costModel
        .findOne({ account_id: accountId, date })
        .lean()
        .exec();
      if (!record || record.request_count <= 0) return;

      // Incremental average: new_avg = old_avg + (new_value - old_avg) / count
      const oldAvg = record.avg_latency_ms ?? 0;
      const count = record.request_count;
      const newAvg = oldAvg + (latencyMs - oldAvg) / count;

      await this.costModel.updateOne(
        { account_id: accountId, date },
        { $set: { avg_latency_ms: newAvg } },
      );
    } catch (err: any) {
      this.logger.warn(`Failed to update avg latency: ${err.message}`);
    }
  }

  /** Returns today's date as 'YYYY-MM-DD' */
  todayString(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /** Returns current month prefix as 'YYYY-MM' */
  private currentMonthPrefix(): string {
    return new Date().toISOString().slice(0, 7);
  }
}
