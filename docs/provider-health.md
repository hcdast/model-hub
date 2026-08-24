# 供应商健康度与熔断器

> 版本：v1.0
> 最后更新：2026-06-01
> 状态：已实现

---

## 目录

1. [概述](#1-概述)
2. [熔断器设计](#2-熔断器设计)
3. [健康指标采集](#3-健康指标采集)
4. [状态管理](#4-状态管理)
5. [与通知系统集成](#5-与通知系统集成)
6. [管理接口](#6-管理接口)

---

## 1. 概述

供应商健康度模块实现了经典的三态熔断器模式（CLOSED / OPEN / HALF_OPEN），用于保护系统免受供应商 API 故障的级联影响。

### 1.1 核心特性

| 特性 | 说明 |
|------|------|
| **三态熔断器** | CLOSED → OPEN → HALF_OPEN → CLOSED 状态机 |
| **Redis 状态存储** | 多实例共享状态，Lua CAS 原子操作 |
| **滑动窗口指标** | 5 分钟窗口内成功率、错误率、平均延迟 |
| **手动覆盖** | 管理员可强制打开/关闭熔断器 |
| **Prometheus 集成** | 状态转换自动更新 Prometheus Gauge |

---

## 2. 熔断器设计

### 2.1 状态机

```
                    错误率超过阈值
    CLOSED ──────────────────────────► OPEN
       ▲                                │
       │                                │ 冷却时间到达
       │                                ▼
       │  探测成功              HALF_OPEN（有限探测）
       │◄───────────────────────────────│
       │                                │
       │                                │ 探测失败
       │                                ▼
       │                               OPEN
```

### 2.2 状态说明

| 状态 | 行为 | 转换条件 |
|------|------|---------|
| **CLOSED** | 正常放行所有请求 | 连续失败次数或错误率超过阈值 → OPEN |
| **OPEN** | 拒绝所有请求 | 冷却时间到达 → HALF_OPEN |
| **HALF_OPEN** | 放行有限探测请求 | 探测成功 → CLOSED；探测失败 → OPEN |

### 2.3 关键参数

```typescript
{
  errorRateThreshold: number;     // 错误率阈值（如 0.5 = 50%）
  consecutiveFailures: number;    // 连续失败次数阈值
  cooldownMs: number;             // OPEN → HALF_OPEN 冷却时间
  probeCount: number;             // HALF_OPEN 探测请求数
  minSamples: number;             // 最小样本数（低于此数不触发熔断）
}
```

---

## 3. 健康指标采集

### 3.1 滑动窗口

`HealthMetricsCollector` 使用 Redis Sorted Set 实现 5 分钟滑动窗口：

```
Key: health:window:{provider}
Score: timestamp
Member: JSON-encoded CallOutcome
```

### 3.2 采集指标

| 指标 | 说明 |
|------|------|
| **成功率** | `successCount / totalCount` |
| **错误率** | `failCount / totalCount` |
| **平均延迟** | 窗口内所有调用的平均延迟 |
| **样本数** | 窗口内总调用次数 |

### 3.3 最小样本保护

当样本数低于 `minSamples`（默认 10）时，指标被视为无效，不触发熔断。避免在低流量时因偶发错误误触发。

---

## 4. 状态管理

### 4.1 Redis 存储

```
Key:   circuit:provider:{providerName}
Value: JSON { state, consecutiveFailures, lastStateChange, overrideState }
TTL:   可配置
```

### 4.2 原子状态转换

所有状态转换使用 Lua CAS（Compare-And-Set）脚本，确保多实例并发安全：

```lua
-- 伪代码
if redis.call('GET', KEYS[1]) == ARGV[1] then
    redis.call('SET', KEYS[1], ARGV[2])
    return 1
else
    return 0
end
```

### 4.3 本地缓存

`CircuitBreakerStore` 维护 1 秒的本地内存缓存，减少 Redis 访问：

```
请求 → 本地缓存（1s TTL）→ 缓存命中？→ 返回
                         → 缓存未命中 → Redis 读取 → 更新缓存
```

---

## 5. 与通知系统集成

熔断器状态转换自动发射事件，由通知系统监听并投递：

| 事件 | 严重级别 | 触发时机 |
|------|---------|---------|
| `system.provider_circuit_open` | CRITICAL | 熔断器打开（Provider 不可用） |
| `system.provider_circuit_half_open` | WARNING | 熔断器半开（开始探测） |
| `system.provider_circuit_closed` | INFO | 熔断器恢复（Provider 恢复） |

---

## 6. 管理接口

### 6.1 Prometheus 指标

```
modelhub_circuit_breaker_state{provider="wavespeed-ai"} 0  # 0=CLOSED, 1=OPEN, 2=HALF_OPEN
modelhub_health_success_rate{provider="wavespeed-ai"} 0.95
modelhub_health_error_rate{provider="wavespeed-ai"} 0.05
modelhub_health_avg_latency_ms{provider="wavespeed-ai"} 450
```

### 6.2 管理端 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/admin/provider-health` | 所有 Provider 健康状态 |
| POST | `/api/v1/admin/provider-health/:provider/override` | 手动覆盖熔断状态 |
| DELETE | `/api/v1/admin/provider-health/:provider/override` | 清除手动覆盖 |

### 6.3 手动覆盖

管理员可强制设置熔断器状态：

```json
POST /api/v1/admin/provider-health/wavespeed-ai/override
{
  "state": "OPEN",
  "reason": "厂商维护窗口，手动熔断"
}
```

手动覆盖后，自动状态转换暂停，直到管理员清除覆盖。
