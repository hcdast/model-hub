# 计费系统

> 版本：v1.0
> 最后更新：2026-06-01
> 状态：已实现

---

## 目录

1. [概述](#1-概述)
2. [三层架构](#2-三层架构)
3. [计费策略](#3-计费策略)
4. [计费生命周期](#4-计费生命周期)
5. [钱包系统](#5-钱包系统)
6. [API 参考](#6-api-参考)
7. [MongoDB Schema](#7-mongodb-schema)

---

## 1. 概述

计费系统提供任务级别的用量计量、费用计算、预扣/结算/退款能力。作为 `@Global()` 模块，在所有进程中可用。

### 1.1 核心特性

| 特性 | 说明 |
|------|------|
| **三层架构** | Pricing → Billing → Wallet 职责分离 |
| **三种计费策略** | exempt（豁免）、external（仅记录）、internal（完整计费） |
| **原子操作** | 钱包余额使用 MongoDB `$inc` + `$expr` 原子操作，防并发超扣 |
| **幂等状态机** | 计费记录状态转换使用条件更新，保证幂等 |
| **审计追踪** | 每笔钱包操作记录 `WalletTransaction` 流水 |

---

## 2. 三层架构

```
BillingAdapter（统一入口）
    │
    ├── PricingService           # 价格查询
    │     └── model_configs.unit_price_map
    │
    ├── BillingService           # 计费记录生命周期
    │     └── billing_records 集合
    │
    └── WalletService            # 钱包余额管理
          ├── wallets 集合
          └── wallet_transactions 集合
```

### 2.1 PricingService

从 `model_configs` 集合查询模型单价：

| 用量类型 | 适用场景 | 说明 |
|---------|---------|------|
| `count` | 文生图、图生图 | 按生成数量计费 |
| `duration` | 图生视频、文生视频 | 按视频时长（秒）计费 |
| `token` | 文本生成 | 按 Token 数量计费 |

**价格查找逻辑：**

```
model_configs.unit_price_map
    │
    ├── 按 usageType 查找对应档位
    ├── 返回 unit_credit / cost_unit_price / sale_unit_price
    └── 无配置时返回 0（带 WARN 日志）
```

### 2.2 BillingService

管理 `billing_records` 记录生命周期，提供查询和汇总能力。

### 2.3 WalletService

管理 API Client 级别的钱包，提供原子余额操作。

---

## 3. 计费策略

### 3.1 策略类型

由 `api_clients` 集合中的 `billingPolicy` 字段决定：

| 策略 | 说明 | 行为 |
|------|------|------|
| **exempt** | 豁免 | 跳过所有计费逻辑，不写入 `billing_records` |
| **external** | 外部计费 | 仅记录用量和费用，不操作钱包（由外部系统结算） |
| **internal** | 内部计费 | 完整的 Pricing → Billing → Wallet 链路 |

### 3.2 策略分发

```typescript
// BillingAdapter.initBilling()
switch (billingPolicy) {
  case 'exempt':
    return; // 跳过
  case 'external':
    // 仅创建 billing_record，不操作钱包
    await this.billingService.createRecord(...);
    break;
  case 'internal':
    // 创建记录 + 预扣钱包余额
    const record = await this.billingService.createRecord(...);
    await this.walletService.freeze(clientId, estimatedCost);
    break;
}
```

---

## 4. 计费生命周期

### 4.1 状态流转

```
任务创建
    │
    ▼
estimated（预估）─── 预扣钱包余额
    │
    ▼
pre_deducted（已预扣）
    │
    ├─── 任务成功 ──► settled（已结算）─── 实际扣费，解冻预扣
    │
    ├─── 任务失败 ──► refunded（已退款）─── 解冻预扣
    │
    └─── 结算异常 ──► failed（失败）
```

### 4.2 关键调用点

| 时机 | 调用 | 说明 |
|------|------|------|
| 任务创建 | `BillingAdapter.initBilling()` | 创建记录 + 预扣（internal） |
| 任务成功 | `BillingAdapter.settle()` | 计算实际费用 + 结算 |
| 任务失败 | `BillingAdapter.refund()` | 解冻预扣金额 |
| 退款失败 | 指数退避重试（3 次） | 保证最终一致性 |

### 4.3 幂等保障

所有状态转换使用 MongoDB 条件更新：

```typescript
await this.billingRecordModel.findOneAndUpdate(
  {
    _id: recordId,
    status: 'pre_deducted',  // 只有当前状态匹配才更新
  },
  { $set: { status: 'settled', actualCost, settledAt: new Date() } },
);
```

---

## 5. 钱包系统

### 5.1 原子操作

所有余额操作使用 MongoDB 原子 `$inc` + `$expr` 条件，防止并发超扣：

```typescript
// freeze（预扣）
await this.walletModel.findOneAndUpdate(
  { clientId },
  {
    $inc: { balance: -amount, frozenAmount: amount },
    $expr: { $gte: [{ $add: ['$balance', -amount] }, 0] }, // 余额不能为负
  },
);
```

### 5.2 钱包操作

| 操作 | 说明 | 余额变化 | 冻结变化 |
|------|------|---------|---------|
| `freeze()` | 预扣（任务创建时） | -amount | +amount |
| `unfreeze()` | 解冻（任务失败退款） | +amount | -amount |
| `debit()` | 实际扣费（任务成功结算） | 不变 | -amount |
| `credit()` | 充值 | +amount | 不变 |

### 5.3 低余额告警

当余额低于阈值时，发射 `wallet.low_balance` 事件，由通知系统处理：

```typescript
if (wallet.balance < wallet.lowBalanceThreshold) {
  this.eventEmitter.emit('wallet.low_balance', {
    clientId: wallet.clientId,
    balance: wallet.balance,
    threshold: wallet.lowBalanceThreshold,
  });
}
```

---

## 6. API 参考

> 需管理后台 JWT 鉴权

### 6.1 计费记录

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/admin/billing/records` | `billing:read` | 计费记录列表（分页） |
| GET | `/api/v1/admin/billing/summary` | `billing:read` | 费用汇总（按模型/API Key/日期） |
| GET | `/api/v1/admin/billing/today` | `billing:read` | 今日费用概览 |

### 6.2 钱包管理

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/admin/billing/wallets` | `billing:read` | 钱包列表 |
| POST | `/api/v1/admin/billing/wallets/:clientId/credit` | `billing:write` | 充值 |
| POST | `/api/v1/admin/billing/wallets/:clientId/adjust` | `billing:write` | 手工调账 |

---

## 7. MongoDB Schema

### billing_records 集合

```typescript
{
  taskId: string;                // 关联任务
  clientId: string;              // API Client ID
  model: string;                 // 模型标识
  billingPolicy: 'exempt' | 'external' | 'internal';

  // 用量
  usageType: 'count' | 'duration' | 'token';
  estimatedUsage: number;        // 预估用量
  actualUsage?: number;          // 实际用量

  // 费用
  unitPrice: number;             // 单位价格
  estimatedCost: number;         // 预估费用
  actualCost?: number;           // 实际费用

  // 状态
  status: 'estimated' | 'pre_deducted' | 'settled' | 'refunded' | 'failed';

  createdAt: Date;
  updatedAt: Date;
}
```

### wallets 集合

```typescript
{
  clientId: string;              // 唯一
  balance: number;               // 当前余额
  frozenAmount: number;          // 冻结金额（预扣中）
  lowBalanceThreshold: number;   // 低余额告警阈值
  currency: string;              // 货币类型
  createdAt: Date;
  updatedAt: Date;
}
```

### wallet_transactions 集合

```typescript
{
  walletId: string;              // 关联钱包
  clientId: string;
  type: 'freeze' | 'unfreeze' | 'debit' | 'credit' | 'adjust';
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  relatedTaskId?: string;        // 关联任务
  reason?: string;               // 操作原因
  operatorId?: string;           // 操作人（手工调账时）
  createdAt: Date;
}
```
