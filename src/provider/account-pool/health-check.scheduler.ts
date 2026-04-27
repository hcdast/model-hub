import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import axios from 'axios';
import {
  AccountPoolEntry,
  AccountPoolEntryDocument,
} from '../../database/schemas/account-pool-entry.schema';
import { CircuitBreakerService } from './circuit-breaker.service';
import { RedisLockService } from '../../redis/redis-lock.service';

export interface HealthCheckEvent {
  accountId: string;
  providerName: string;
  accountAlias: string;
  previousState: string;
  newState: string;
  timestamp: Date;
}

export type HealthCheckEventListener = (event: HealthCheckEvent) => void;

@Injectable()
export class HealthCheckScheduler {
  private readonly logger = new Logger(HealthCheckScheduler.name);
  private readonly listeners: HealthCheckEventListener[] = [];

  /** Probe timeout in ms */
  private readonly probeTimeoutMs = 5000;
  /** Distributed lock TTL — must be shorter than the interval */
  private readonly lockTtlMs = 25_000;

  constructor(
    @InjectModel(AccountPoolEntry.name)
    private readonly accountModel: Model<AccountPoolEntryDocument>,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly lockService: RedisLockService,
  ) {}

  /**
   * Register a listener for account recovery/state-change events.
   * Used by other services that need to react to health transitions.
   */
  onHealthEvent(listener: HealthCheckEventListener): void {
    this.listeners.push(listener);
  }

  /**
   * Runs every 30 seconds (matching recovery_probe_interval_seconds default).
   * Acquires a distributed lock so only one instance probes at a time.
   */
  @Interval(30_000)
  async handleHealthCheck(): Promise<void> {
    const lockToken = await this.lockService.acquire(
      'health-check-scheduler',
      this.lockTtlMs,
    );
    if (!lockToken) return; // Another instance is already running

    try {
      await this.probeUnhealthyAccounts();
    } catch (err: any) {
      this.logger.error(`Health check cycle failed: ${err.message}`);
    } finally {
      await this.lockService.release('health-check-scheduler', lockToken);
    }
  }

  /**
   * Core logic: find accounts in open/half-open state, probe them,
   * and transition based on probe result.
   */
  async probeUnhealthyAccounts(): Promise<void> {
    // Find accounts whose health_status is open or half-open
    const unhealthy = await this.accountModel
      .find({
        enabled: true,
        health_status: { $in: ['open', 'half-open'] },
      })
      .lean()
      .exec();

    if (unhealthy.length === 0) return;

    this.logger.log(
      `Probing ${unhealthy.length} unhealthy account(s)`,
    );

    for (const account of unhealthy) {
      await this.probeAccount(account as unknown as AccountPoolEntryDocument);
    }
  }

  /**
   * Probe a single account with a lightweight HTTP request.
   * On success: transition to closed (recovered) with reduced weight.
   * On failure: ensure state stays open.
   */
  async probeAccount(account: AccountPoolEntryDocument): Promise<void> {
    const accountId = (account as any)._id?.toString?.() ?? '';
    const previousState = account.health_status;

    // Ensure circuit breaker is in half-open so it accepts the probe result
    const cbState = await this.circuitBreaker.getState(accountId);
    if (cbState === 'open') {
      await this.circuitBreaker.transitionToHalfOpen(accountId);
    }

    const probeSuccess = await this.sendProbe(account);

    if (probeSuccess) {
      // Successful probe → recover the account
      await this.circuitBreaker.recordSuccess(accountId);

      // Update health_status in DB to 'closed'
      await this.accountModel.updateOne(
        { _id: accountId },
        { $set: { health_status: 'closed' } },
      );

      const recoveryWeight = this.circuitBreaker.getRecoveryWeight(
        account.weight,
      );

      this.logger.log(
        `Account ${account.account_alias} (${account.provider_name}) recovered. ` +
          `Effective weight: ${recoveryWeight} (original: ${account.weight})`,
      );

      this.emitEvent({
        accountId,
        providerName: account.provider_name,
        accountAlias: account.account_alias,
        previousState,
        newState: 'closed',
        timestamp: new Date(),
      });
    } else {
      // Failed probe → record failure, stay open
      await this.circuitBreaker.recordFailure(accountId);

      // Ensure DB reflects open state
      await this.accountModel.updateOne(
        { _id: accountId },
        { $set: { health_status: 'open' } },
      );

      this.logger.warn(
        `Probe failed for account ${account.account_alias} (${account.provider_name}), staying open`,
      );
    }
  }

  /**
   * Send a lightweight probe request to verify the account's API key is valid.
   * Uses a simple GET/HEAD to the account's base_url or a known lightweight endpoint.
   * Returns true if the probe succeeds (any 2xx/3xx), false otherwise.
   */
  async sendProbe(account: AccountPoolEntryDocument): Promise<boolean> {
    const baseUrl = account.base_url;
    if (!baseUrl) {
      // No base_url configured — can't probe, treat as success
      // (the account will be validated on next real request)
      this.logger.debug(
        `No base_url for account ${account.account_alias}, skipping probe (treating as success)`,
      );
      return true;
    }

    try {
      await axios.get(baseUrl, {
        timeout: this.probeTimeoutMs,
        headers: {
          Authorization: `Bearer ${account.api_key}`,
        },
        // We only care about connectivity, not response body
        validateStatus: (status) => status < 500,
      });
      return true;
    } catch (err: any) {
      this.logger.debug(
        `Probe to ${account.account_alias} failed: ${err.message}`,
      );
      return false;
    }
  }

  private emitEvent(event: HealthCheckEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err: any) {
        this.logger.error(`Health event listener error: ${err.message}`);
      }
    }
  }
}
