import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Wallet, WalletDocument } from '../database/schemas/wallet.schema';
import {
  WalletTransaction,
  WalletTransactionDocument,
} from '../database/schemas/wallet-transaction.schema';
import { ApiClient } from '../database/schemas/api-client.schema';
import { APP_CONFIG } from '../config/config.module';
import { AppConfig } from '../config/interfaces/config.interface';
import { TransactionType, WalletBalance } from './interfaces/wallet.interface';
import { TransactionQueryDto } from './dto/transaction-query.dto';

/**
 * 钱包服务 —— 为 billingPolicy=internal 的 API Client 管理独立余额。
 *
 * 核心设计：
 * - 所有余额变更使用 MongoDB 原子操作（$inc + 条件更新），防止并发超扣
 * - 可用余额 = balance - frozenAmount
 * - 每次余额变更都记录 WalletTransaction 流水，用于审计追踪
 * - 余额低于阈值时通过 EventEmitter 发射 wallet.low_balance 事件
 */
@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    @InjectModel(Wallet.name)
    private readonly walletModel: Model<WalletDocument>,
    @InjectModel(WalletTransaction.name)
    private readonly txModel: Model<WalletTransactionDocument>,
    @InjectModel(ApiClient.name)
    private readonly apiClientModel: Model<ApiClient>,
    private readonly eventEmitter: EventEmitter2,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * 确保钱包存在 —— 使用 findOneAndUpdate + upsert 原子创建
   *
   * 如果钱包已存在则直接返回，不存在则创建默认钱包（余额为 0）。
   */
  async ensureWallet(clientId: string): Promise<WalletDocument> {
    const wallet = await this.walletModel.findOneAndUpdate(
      { clientId },
      { $setOnInsert: { clientId, balance: 0, frozenAmount: 0, lowBalanceThreshold: 0 } },
      { upsert: true, new: true },
    );
    return wallet!;
  }

  /**
   * 查询钱包余额
   *
   * 返回总余额、冻结金额和可用余额。
   * 钱包不存在时返回全零值。
   */
  async getBalance(clientId: string): Promise<WalletBalance> {
    const wallet = await this.walletModel.findOne({ clientId }).lean();
    if (!wallet) {
      return { balance: 0, frozenAmount: 0, available: 0 };
    }
    return {
      balance: wallet.balance,
      frozenAmount: wallet.frozenAmount,
      available: wallet.balance - wallet.frozenAmount,
    };
  }

  /**
   * 分页查询钱包列表（关联 api_clients 获取客户端名称）
   */
  async listWallets(query: {
    keyword?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{ items: any[]; total: number }> {
    const { keyword, page = 1, pageSize = 20 } = query;
    const skip = (page - 1) * pageSize;

    const match: Record<string, any> = {};
    if (keyword) {
      const regex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      match.$or = [{ clientId: regex }];
    }

    const [items, total] = await Promise.all([
      this.walletModel.aggregate([
        ...(Object.keys(match).length ? [{ $match: match }] : []),
        {
          $lookup: {
            from: 'api_clients',
            localField: 'clientId',
            foreignField: 'clientId',
            as: 'client',
          },
        },
        { $unwind: { path: '$client', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            clientId: 1,
            balance: 1,
            frozenAmount: 1,
            available: { $subtract: ['$balance', '$frozenAmount'] },
            clientName: '$client.name',
            billingPolicy: '$client.billingPolicy',
            enabled: '$client.enabled',
            updatedAt: 1,
          },
        },
        { $sort: { updatedAt: -1 } },
        { $skip: skip },
        { $limit: pageSize },
      ]),
      this.walletModel.countDocuments(match),
    ]);

    return { items, total };
  }

  /**
   * 冻结余额 —— 预扣费时调用
   *
   * 原子操作：检查可用余额 >= amount，成功则增加 frozenAmount。
   * 使用 $expr 在数据库层面保证并发安全。
   *
   * @returns true 冻结成功，false 余额不足
   */
  async freeze(clientId: string, amount: number, taskId: string): Promise<boolean> {
    const wallet = await this.walletModel.findOneAndUpdate(
      {
        clientId,
        $expr: {
          $gte: [{ $subtract: ['$balance', '$frozenAmount'] }, amount],
        },
      },
      { $inc: { frozenAmount: amount } },
      { new: true },
    );

    if (!wallet) {
      this.logger.warn(`冻结失败：clientId=${clientId}, amount=${amount}, taskId=${taskId}，可用余额不足`);
      return false;
    }

    // 记录冻结交易流水
    // 冻结操作不改变 balance，只改变 frozenAmount，因此 balanceBefore/After 反映 balance 值
    await this.recordTransaction({
      clientId,
      type: TransactionType.FREEZE,
      amount,
      balanceBefore: wallet.balance,
      balanceAfter: wallet.balance,
      relatedTaskId: taskId,
      reason: '预扣费冻结',
    });

    this.logger.log(`冻结成功：clientId=${clientId}, amount=${amount}, taskId=${taskId}`);
    return true;
  }

  /**
   * 解冻余额 —— 退款或结算时释放冻结金额
   *
   * 原子操作：检查 frozenAmount >= amount，成功则减少 frozenAmount。
   */
  async unfreeze(clientId: string, amount: number, taskId: string): Promise<void> {
    const wallet = await this.walletModel.findOneAndUpdate(
      {
        clientId,
        frozenAmount: { $gte: amount },
      },
      { $inc: { frozenAmount: -amount } },
      { new: true },
    );

    if (!wallet) {
      this.logger.warn(`解冻失败：clientId=${clientId}, amount=${amount}, taskId=${taskId}，冻结金额不足`);
      return;
    }

    // 记录解冻交易流水
    await this.recordTransaction({
      clientId,
      type: TransactionType.UNFREEZE,
      amount,
      balanceBefore: wallet.balance,
      balanceAfter: wallet.balance,
      relatedTaskId: taskId,
      reason: '解冻释放',
    });

    this.logger.log(`解冻成功：clientId=${clientId}, amount=${amount}, taskId=${taskId}`);
  }

  /**
   * 扣费 —— 从可用余额中扣除费用
   *
   * 原子操作：检查可用余额（balance - frozenAmount）>= amount，成功则减少 balance。
   * 扣费后检查余额是否低于阈值，低于则发射 wallet.low_balance 事件。
   *
   * @returns true 扣费成功，false 余额不足
   */
  async debit(clientId: string, amount: number, taskId: string): Promise<boolean> {
    // 先获取扣费前的余额（用于记录 balanceBefore）
    const walletBefore = await this.walletModel.findOne({ clientId }).lean();
    const balanceBefore = walletBefore?.balance ?? 0;

    const wallet = await this.walletModel.findOneAndUpdate(
      {
        clientId,
        $expr: {
          $gte: [{ $subtract: ['$balance', '$frozenAmount'] }, amount],
        },
      },
      { $inc: { balance: -amount } },
      { new: true },
    );

    if (!wallet) {
      this.logger.warn(`扣费失败：clientId=${clientId}, amount=${amount}, taskId=${taskId}，可用余额不足`);
      return false;
    }

    // 记录扣费交易流水
    await this.recordTransaction({
      clientId,
      type: TransactionType.DEBIT,
      amount,
      balanceBefore,
      balanceAfter: wallet.balance,
      relatedTaskId: taskId,
      reason: '任务扣费',
    });

    // 检查余额是否低于阈值
    const threshold = this.config.billing?.wallet?.lowBalanceThreshold
      ?? wallet.lowBalanceThreshold
      ?? 0;
    if (threshold > 0 && wallet.balance < threshold) {
      this.eventEmitter.emit('wallet.low_balance', {
        clientId,
        balance: wallet.balance,
        threshold,
      });
      this.logger.warn(`低余额告警：clientId=${clientId}, balance=${wallet.balance}, threshold=${threshold}`);
    }

    this.logger.log(`扣费成功：clientId=${clientId}, amount=${amount}, taskId=${taskId}, 余额=${wallet.balance}`);
    return true;
  }

  /**
   * 充值 —— 增加钱包余额
   *
   * 先调用 ensureWallet 确保钱包存在，然后原子增加余额。
   */
  async credit(
    clientId: string,
    amount: number,
    reason: string,
    taskId?: string,
  ): Promise<void> {
    // 确保钱包存在
    await this.ensureWallet(clientId);

    // 获取充值前余额
    const walletBefore = await this.walletModel.findOne({ clientId }).lean();
    const balanceBefore = walletBefore?.balance ?? 0;

    // 原子增加余额
    const wallet = await this.walletModel.findOneAndUpdate(
      { clientId },
      { $inc: { balance: amount } },
      { new: true },
    );

    // 记录充值交易流水
    await this.recordTransaction({
      clientId,
      type: TransactionType.CREDIT,
      amount,
      balanceBefore,
      balanceAfter: wallet!.balance,
      relatedTaskId: taskId,
      reason,
    });

    this.logger.log(`充值成功：clientId=${clientId}, amount=${amount}, reason=${reason}`);
  }

  /**
   * 分页查询交易记录
   */
  async listTransactions(
    clientId: string,
    query: TransactionQueryDto,
  ): Promise<{ items: WalletTransactionDocument[]; total: number }> {
    const { page = 1, pageSize = 20, type } = query;
    const skip = (page - 1) * pageSize;

    // 构建查询条件
    const filter: Record<string, any> = { clientId };
    if (type) {
      filter.type = type;
    }

    const [items, total] = await Promise.all([
      this.txModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .exec(),
      this.txModel.countDocuments(filter).exec(),
    ]);

    return { items, total };
  }

  /**
   * 记录交易流水 —— 私有方法，创建 WalletTransaction 文档
   */
  private async recordTransaction(params: {
    clientId: string;
    type: TransactionType;
    amount: number;
    balanceBefore: number;
    balanceAfter: number;
    relatedTaskId?: string;
    reason?: string;
  }): Promise<void> {
    try {
      await this.txModel.create({
        clientId: params.clientId,
        type: params.type,
        amount: params.amount,
        balanceBefore: params.balanceBefore,
        balanceAfter: params.balanceAfter,
        relatedTaskId: params.relatedTaskId,
        reason: params.reason,
      });
    } catch (err: any) {
      // 交易流水记录失败不应阻断主流程，仅记录错误日志
      this.logger.error(
        `记录交易流水失败：clientId=${params.clientId}, type=${params.type}, error=${err.message}`,
      );
    }
  }
}
