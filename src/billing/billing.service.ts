import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  BillingRecord,
  BillingRecordDocument,
} from '../database/schemas/billing-record.schema';
import {
  BillingStatus,
  PriceEstimate,
} from './interfaces/billing.interface';
import { BillingQueryDto } from './dto/billing-query.dto';
import { BillingSummaryQueryDto } from './dto/billing-summary-query.dto';
import { roundMoney } from '../common/utils/money.util';

/** 计费汇总结果条目 */
export interface BillingSummaryItem {
  /** 分组键（模型名称 / apiKey / 日期字符串） */
  _id: string;
  /** 总预估费用 */
  totalEstimatedCost: number;
  /** 总实际费用 */
  totalActualCost: number;
  /** 记录数 */
  count: number;
}

/** 创建计费记录参数 */
export interface CreateRecordParams {
  /** 任务 ID */
  taskId: string;
  /** API Key（与 api_clients.apiKey 一致） */
  apiKey: string;
  /** 模型名称 */
  model: string;
  /** 供应商标识 */
  provider: string;
  /** 价格预估信息 */
  estimate: PriceEstimate;
  /** 计费策略 */
  billingPolicy: string;
}

/**
 * 计费记录服务 —— 管理 BillingRecord 的完整生命周期。
 *
 * 核心设计：
 * - 所有状态转换使用条件更新（findOneAndUpdate + status 条件），确保幂等性
 * - 支持 estimated → pre_deducted → settled / refunded / failed 的状态流转
 * - 提供分页查询和 MongoDB aggregate 汇总功能
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @InjectModel(BillingRecord.name)
    private readonly billingModel: Model<BillingRecordDocument>,
  ) {}

  /**
   * 创建计费记录 —— 任务创建时调用
   *
   * 初始状态为 estimated，包含预估用量和预估费用。
   */
  async createRecord(params: CreateRecordParams): Promise<BillingRecordDocument> {
    const { taskId, apiKey, model, provider, estimate, billingPolicy } = params;

    const record = await this.billingModel.create({
      taskId,
      apiKey,
      model,
      provider,
      usageType: estimate.usageType,
      estimatedUsage: estimate.estimatedUsage,
      estimatedCost: estimate.estimatedCost,
      unitPrice: estimate.unitPrice,
      currency: estimate.currency,
      billingPolicy,
      status: BillingStatus.ESTIMATED,
    });

    this.logger.log(
      `创建计费记录：taskId=${taskId}, apiKey=${apiKey}, model=${model}, ` +
      `billingPolicy=${billingPolicy}, estimatedCost=${estimate.estimatedCost}`,
    );

    return record;
  }

  /**
   * 标记为已预扣 —— 预扣费成功后调用
   *
   * 条件更新：仅当 status 为 estimated 时才更新为 pre_deducted。
   */
  async markPreDeducted(taskId: string): Promise<void> {
    const result = await this.billingModel.findOneAndUpdate(
      { taskId, status: BillingStatus.ESTIMATED },
      { $set: { status: BillingStatus.PRE_DEDUCTED } },
      { new: true },
    );

    if (!result) {
      this.logger.warn(`标记预扣失败：taskId=${taskId}，记录不存在或状态不是 estimated`);
      return;
    }

    this.logger.log(`标记预扣成功：taskId=${taskId}`);
  }

  /**
   * 结算 —— 任务成功完成时调用
   *
   * 条件更新：仅当 status 为 estimated 或 pre_deducted 时才更新为 settled。
   * 幂等：已经是 settled 状态则跳过，不重复变更。
   */
  async settle(taskId: string, actualUsage: number, actualCost: number): Promise<void> {
    // 先检查是否已经结算（幂等处理）
    const existing = await this.billingModel.findOne({ taskId }).lean();
    if (!existing) {
      this.logger.warn(`结算跳过：taskId=${taskId}，记录不存在`);
      return;
    }
    if (existing.status === BillingStatus.SETTLED) {
      this.logger.log(`结算跳过（幂等）：taskId=${taskId}，已经是 settled 状态`);
      return;
    }

    const result = await this.billingModel.findOneAndUpdate(
      {
        taskId,
        status: { $in: [BillingStatus.ESTIMATED, BillingStatus.PRE_DEDUCTED] },
      },
      {
        $set: {
          status: BillingStatus.SETTLED,
          actualUsage,
          actualCost,
          settledAt: new Date(),
        },
      },
      { new: true },
    );

    if (!result) {
      this.logger.warn(
        `结算失败：taskId=${taskId}，状态不允许结算（当前状态：${existing.status}）`,
      );
      return;
    }

    this.logger.log(
      `结算成功：taskId=${taskId}, actualUsage=${actualUsage}, actualCost=${actualCost}`,
    );
  }

  /**
   * 标记为已退款 —— 任务失败时调用
   *
   * 条件更新：仅当 status 为 estimated 或 pre_deducted 时才更新为 refunded。
   * 幂等：已经是 refunded 状态则跳过，不重复变更。
   */
  async markRefunded(taskId: string): Promise<void> {
    // 先检查是否已经退款（幂等处理）
    const existing = await this.billingModel.findOne({ taskId }).lean();
    if (!existing) {
      this.logger.warn(`退款跳过：taskId=${taskId}，记录不存在`);
      return;
    }
    if (existing.status === BillingStatus.REFUNDED) {
      this.logger.log(`退款跳过（幂等）：taskId=${taskId}，已经是 refunded 状态`);
      return;
    }

    const result = await this.billingModel.findOneAndUpdate(
      {
        taskId,
        status: { $in: [BillingStatus.ESTIMATED, BillingStatus.PRE_DEDUCTED] },
      },
      {
        $set: {
          status: BillingStatus.REFUNDED,
          refundedAt: new Date(),
        },
      },
      { new: true },
    );

    if (!result) {
      this.logger.warn(
        `退款失败：taskId=${taskId}，状态不允许退款（当前状态：${existing.status}）`,
      );
      return;
    }

    this.logger.log(`退款成功：taskId=${taskId}`);
  }

  /**
   * 标记为失败 —— 结算或退款过程中出错时调用
   *
   * 直接更新 status 为 failed，记录失败原因。
   */
  async markFailed(taskId: string, reason: string): Promise<void> {
    const result = await this.billingModel.findOneAndUpdate(
      { taskId },
      {
        $set: {
          status: BillingStatus.FAILED,
          failReason: reason,
        },
      },
      { new: true },
    );

    if (!result) {
      this.logger.warn(`标记失败跳过：taskId=${taskId}，记录不存在`);
      return;
    }

    this.logger.log(`标记失败：taskId=${taskId}, reason=${reason}`);
  }

  /**
   * 按 taskId 查询单条计费记录
   */
  async getRecord(taskId: string): Promise<BillingRecordDocument | null> {
    return this.billingModel.findOne({ taskId }).exec();
  }

  /**
   * 分页查询计费记录
   *
   * 支持 apiKey、model、billingPolicy、status、日期范围筛选。
   */
  async listRecords(
    query: BillingQueryDto,
  ): Promise<{ items: Record<string, unknown>[]; total: number }> {
    const { page = 1, pageSize = 20, apiKey, model, billingPolicy, status, startDate, endDate } = query;
    const skip = (page - 1) * pageSize;

    // 构建查询条件（旧库 billing_records 可能仍为 clientId）
    const filter: Record<string, any> = {};
    if (apiKey) {
      filter.$or = [{ apiKey }, { clientId: apiKey }];
    }
    if (model) {
      filter.model = model;
    }
    if (billingPolicy) {
      filter.billingPolicy = billingPolicy;
    }
    if (status) {
      filter.status = status;
    }
    // 日期范围筛选（基于 createdAt）
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) {
        filter.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        filter.createdAt.$lte = new Date(endDate);
      }
    }

    const [rows, total] = await Promise.all([
      this.billingModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean()
        .exec(),
      this.billingModel.countDocuments(filter).exec(),
    ]);

    const items = rows.map((raw) => {
      const o = raw as Record<string, unknown>;
      const key = String(o.apiKey ?? o.clientId ?? '').trim();
      const { clientId: _legacy, ...rest } = o;
      return {
        ...rest,
        apiKey: key,
        unitPrice: typeof o.unitPrice === 'number' ? roundMoney(o.unitPrice) : o.unitPrice,
        estimatedCost:
          typeof o.estimatedCost === 'number' ? roundMoney(o.estimatedCost) : o.estimatedCost,
        actualCost:
          typeof o.actualCost === 'number' ? roundMoney(o.actualCost) : o.actualCost,
      };
    });

    return { items, total };
  }

  /**
   * 计费汇总 —— 使用 MongoDB aggregate 按维度聚合费用
   *
   * 支持按 model / apiKey / date 分组，支持按 billingPolicy 筛选。
   */
  async getSummary(query: BillingSummaryQueryDto): Promise<BillingSummaryItem[]> {
    const { groupBy = 'model', billingPolicy, startDate, endDate } = query;

    // 构建 match 阶段
    const matchStage: Record<string, any> = {};
    if (billingPolicy) {
      matchStage.billingPolicy = billingPolicy;
    }
    if (startDate || endDate) {
      matchStage.createdAt = {};
      if (startDate) {
        matchStage.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        matchStage.createdAt.$lte = new Date(endDate);
      }
    }

    // 根据 groupBy 确定分组字段
    let groupId: any;
    switch (groupBy) {
      case 'model':
        groupId = '$model';
        break;
      case 'apiKey':
        groupId = '$apiKey';
        break;
      case 'date':
        // 按日期分组：提取 createdAt 的年月日
        groupId = {
          $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
        };
        break;
      default:
        groupId = '$model';
    }

    const pipeline: any[] = [];

    // 仅在有筛选条件时添加 $match 阶段
    if (Object.keys(matchStage).length > 0) {
      pipeline.push({ $match: matchStage });
    }

    // $group 阶段：按维度聚合
    pipeline.push({
      $group: {
        _id: groupId,
        totalEstimatedCost: { $sum: '$estimatedCost' },
        totalActualCost: { $sum: '$actualCost' },
        count: { $sum: 1 },
      },
    });

    // 按 _id 排序
    pipeline.push({ $sort: { _id: 1 } });

    const results = await this.billingModel.aggregate(pipeline).exec();
    return (results as BillingSummaryItem[]).map((row) => ({
      ...row,
      totalEstimatedCost: roundMoney(row.totalEstimatedCost ?? 0),
      totalActualCost: roundMoney(row.totalActualCost ?? 0),
    }));
  }

  /**
   * 今日成本总览 —— Dashboard 成本观测面板数据源
   *
   * 使用 $facet 在一次聚合中同时计算：
   * - 今日总消耗（settled + pre_deducted 的 actualCost 求和）
   * - 热门模型（按请求数排序取 Top 1）
   */
  async getTodayCostOverview(): Promise<{
    totalSpend: number;
    topModel: { model: string; requestCount: number; totalCost: number } | null;
  }> {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000 - 1);

    const results = await this.billingModel.aggregate([
      {
        $match: {
          createdAt: { $gte: startOfDay, $lte: endOfDay },
          status: { $in: [BillingStatus.SETTLED, BillingStatus.PRE_DEDUCTED] },
        },
      },
      {
        $facet: {
          totalSpend: [
            { $group: { _id: null, total: { $sum: '$actualCost' } } },
          ],
          byModel: [
            {
              $group: {
                _id: '$model',
                requestCount: { $sum: 1 },
                totalCost: { $sum: '$actualCost' },
              },
            },
            { $sort: { requestCount: -1 } },
            { $limit: 1 },
          ],
        },
      },
    ]).exec();

    const facet = results[0] || { totalSpend: [], byModel: [] };
    const totalSpend = roundMoney(facet.totalSpend[0]?.total || 0);
    const topDoc = facet.byModel[0] || null;

    return {
      totalSpend,
      topModel: topDoc
        ? {
            model: topDoc._id,
            requestCount: topDoc.requestCount,
            totalCost: roundMoney(topDoc.totalCost ?? 0),
          }
        : null,
    };
  }
}
