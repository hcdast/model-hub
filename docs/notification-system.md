# 通知系统

> 版本：v1.0
> 最后更新：2026-06-01
> 状态：已实现

---

## 目录

1. [概述](#1-概述)
2. [架构设计](#2-架构设计)
3. [通知规则](#3-通知规则)
4. [通知渠道](#4-通知渠道)
5. [限流与冷却](#5-限流与冷却)
6. [系统事件](#6-系统事件)
7. [API 参考](#7-api-参考)
8. [MongoDB Schema](#8-mongodb-schema)

---

## 1. 概述

通知系统提供基于规则的事件驱动通知能力，支持多渠道投递（企业微信、邮件、站内信），并内置限流与冷却机制防止告警风暴。

### 1.1 核心特性

| 特性 | 说明 |
|------|------|
| **规则匹配** | 基于事件类型、严重级别、Provider 等条件匹配通知规则 |
| **多渠道投递** | 企业微信（WeCom）、邮件（Email）、站内信（In-App） |
| **限流保护** | 每条规则独立的冷却时间和滑动窗口限流 |
| **队列化处理** | 通过 Bull 队列异步投递，失败自动重试 |
| **事件驱动** | 监听 `EventEmitter2` 系统事件，自动触发通知 |

---

## 2. 架构设计

```
系统事件（EventEmitter2）
    │
    ▼
NotificationListener
    │  监听事件：system.*、wallet.*、task.* 等
    │
    ▼
NotificationService.processEvent()
    │
    ├── RuleMatcherService        # 匹配启用的规则
    ├── NotificationRateLimiter   # 检查冷却 + 滑动窗口限流
    │
    ▼
Bull Queue (notification)
    │
    ▼
NotificationProcessor
    │
    ├── WeComChannel              # 企业微信
    ├── EmailChannel              # 邮件
    └── InAppChannel              # 站内信
```

### 2.1 组件职责

| 组件 | 文件 | 职责 |
|------|------|------|
| `NotificationListener` | `listeners/notification.listener.ts` | 监听系统事件，转发给 NotificationService |
| `NotificationService` | `services/notification.service.ts` | 规则匹配、限流检查、入队 |
| `RuleMatcherService` | `services/rule-matcher.service.ts` | 按条件匹配通知规则 |
| `NotificationRateLimiterService` | `services/notification-rate-limiter.service.ts` | 冷却时间 + 滑动窗口限流 |
| `NotificationProcessor` | `processors/notification.processor.ts` | Bull 队列消费，分发到渠道 |
| `WeComChannel` | `channels/wecom.channel.ts` | 企业微信 Webhook 投递 |
| `EmailChannel` | `channels/email.channel.ts` | SMTP 邮件投递 |
| `InAppChannel` | `channels/in-app.channel.ts` | 站内信写入 MongoDB |
| `InAppNotificationService` | `services/in-app-notification.service.ts` | 站内信 CRUD + 已读管理 |

---

## 3. 通知规则

### 3.1 规则结构

```typescript
{
  name: string;                    // 规则名称
  enabled: boolean;                // 是否启用
  eventPatterns: string[];         // 匹配的事件模式（支持通配符）
  severity?: string[];             // 严重级别过滤
  providers?: string[];            // Provider 过滤
  channels: Array<{                // 投递渠道配置
    type: 'wecom' | 'email' | 'in-app';
    config: Record<string, any>;
  }>;
  cooldownMs: number;              // 冷却时间（ms）
  rateLimit?: {                    // 滑动窗口限流
    maxCount: number;
    windowMs: number;
  };
}
```

### 3.2 规则匹配逻辑

```
事件到达
    │
    ▼
遍历所有 enabled 规则
    │
    ├── eventPatterns 匹配？（支持 * 通配符）
    ├── severity 匹配？
    ├── providers 匹配？
    │
    ▼ 全部匹配
检查冷却时间 → 未冷却？
    │
    ▼
检查滑动窗口限流 → 未超限？
    │
    ▼
入队投递
```

---

## 4. 通知渠道

### 4.1 企业微信（WeCom）

通过 Webhook 发送企业微信群消息。

**配置：**
```typescript
{
  type: 'wecom',
  config: {
    webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx',
    mentionedList?: string[],    // @指定成员
    mentionedMobileList?: string[], // @指定手机号
  }
}
```

### 4.2 邮件（Email）

通过 SMTP 发送邮件通知。

**配置：**
```typescript
{
  type: 'email',
  config: {
    to: string[];                // 收件人列表
    cc?: string[];               // 抄送
    subject?: string;            // 自定义主题（默认根据事件生成）
  }
}
```

### 4.3 站内信（In-App）

写入 MongoDB `in_app_notifications` 集合，前端通过轮询或 WebSocket 获取。

**配置：**
```typescript
{
  type: 'in-app',
  config: {
    targetUserId?: string;       // 目标用户（空则广播）
  }
}
```

---

## 5. 限流与冷却

### 5.1 冷却时间

每条规则独立配置 `cooldownMs`。在冷却期内，同一规则的重复事件将被静默丢弃。

```
事件 A → 规则 1 匹配 → 投递 → 记录 lastSentAt
事件 B（5 秒后）→ 规则 1 匹配 → cooldownMs=60000 → 丢弃
事件 C（61 秒后）→ 规则 1 匹配 → 冷却已过 → 投递
```

### 5.2 滑动窗口限流

防止短时间内大量事件导致通知风暴：

```typescript
{
  rateLimit: {
    maxCount: 10,    // 窗口内最大通知数
    windowMs: 300000 // 5 分钟窗口
  }
}
```

---

## 6. 系统事件

通知系统监听以下事件类型：

| 事件 | 严重级别 | 触发时机 |
|------|---------|---------|
| `system.provider_circuit_open` | CRITICAL | Provider 熔断器打开 |
| `system.provider_circuit_half_open` | WARNING | 熔断器半开 |
| `system.provider_circuit_closed` | INFO | 熔断器恢复 |
| `system.task_failed` | WARNING | 任务失败 |
| `system.provider_error` | WARNING | Provider 调用错误 |
| `wallet.low_balance` | WARNING | 钱包余额不足 |

---

## 7. API 参考

> 需管理后台 JWT 鉴权

### 7.1 通知规则管理

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/admin/notification-rules` | `notification:read` | 规则列表 |
| POST | `/api/v1/admin/notification-rules` | `notification:create` | 创建规则 |
| PUT | `/api/v1/admin/notification-rules/:id` | `notification:update` | 更新规则 |
| DELETE | `/api/v1/admin/notification-rules/:id` | `notification:delete` | 删除规则 |

### 7.2 通知记录查询

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/admin/notification-records` | `notification:read` | 投递记录列表 |

### 7.3 站内信管理

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/admin/notifications` | `notification:read` | 站内信列表 |
| PUT | `/api/v1/admin/notifications/:id/read` | `notification:read` | 标记已读 |

---

## 8. MongoDB Schema

### notification_rules 集合

```typescript
{
  name: string;
  enabled: boolean;
  eventPatterns: string[];
  severity?: string[];
  providers?: string[];
  channels: Array<{
    type: 'wecom' | 'email' | 'in-app';
    config: Record<string, any>;
  }>;
  cooldownMs: number;
  rateLimit?: { maxCount: number; windowMs: number };
  createdAt: Date;
  updatedAt: Date;
}
```

### notification_records 集合

```typescript
{
  ruleId: string;
  eventId: string;
  eventType: string;
  channel: string;
  status: 'pending' | 'sent' | 'failed';
  error?: string;
  sentAt?: Date;
  createdAt: Date;
}
```

### in_app_notifications 集合

```typescript
{
  userId?: string;               // 目标用户（空则广播）
  title: string;
  content: string;
  severity: string;
  eventType: string;
  read: boolean;
  readAt?: Date;
  createdAt: Date;
}
```
