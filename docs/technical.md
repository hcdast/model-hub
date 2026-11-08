# 技术文档

架构、模块与数据结构、任务生命周期、队列与回调、监控以及配置部署。源码与运行配置是接口和环境事实的最终依据，文中的类型与流程片段用于解释技术合同。

[返回文档索引](README.md)

## 阅读导航

- [系统架构与执行机制](#architecture)
- [模块与数据结构](#structures)
- [配置、部署与数据库迁移](#deployment)
- [模块权限、菜单与审计](#module-registry)

<a id="architecture"></a>

## 系统架构与执行机制

<a id="architecture-1"></a>

### 系统架构设计

<a id="architecture-2"></a>

#### 整体架构图

```
                          ┌─────────────────────────────────────────────────────┐
                          │                   Model-Hub Service                 │
                          │                                                     │
  ┌──────────┐   HTTP     │  ┌──────────┐   ┌──────────────┐   ┌────────────┐  │
  │  Client  │ ──────────>│  │   API    │──>│  Task Service │──>│  Bull Queue│  │
  │ (业务方) │   202      │  │Controller│   │  (入库+入队)  │   │  (Redis)   │  │
  └──────────┘ <──────────│  └──────────┘   └──────────────┘   └─────┬──────┘  │
       │                  │                       │                    │         │
       │                  │                       ▼                    ▼         │
       │                  │               ┌──────────────┐   ┌──────────────┐   │
       │    callback      │               │   MongoDB     │   │   Worker     │   │
       │ <────────────────│               │  (任务持久化) │   │  Consumer    │   │
       │                  │               └──────────────┘   └──────┬───────┘   │
       │                  │                       ▲                  │           │
       │                  │                       │                  ▼           │
       │                  │               ┌──────────────┐   ┌──────────────┐   │
       │                  │               │   Polling     │   │  Provider    │   │
       │                  │               │  Scheduler    │──>│  Adapter     │──>│──> 第三方 API
       │                  │               │  (定时轮询)   │   │  Layer       │   │
       │                  │               └──────────────┘   └──────────────┘   │
       │                  │                                                     │
       │                  │               ┌──────────────┐                      │
       │ <────────────────│───────────────│  Callback     │                      │
       │                  │               │  Dispatcher   │                      │
       │                  │               └──────────────┘                      │
       │                  └─────────────────────────────────────────────────────┘
       │
       ▼
  ┌──────────┐
  │ 业务方   │
  │ 回调接口 │
  └──────────┘
```

<a id="architecture-3"></a>

#### 组件职责

| 组件 | 职责 |
|------|------|
| **API Controller** | 接收外部请求，参数校验，鉴权，返回 taskId |
| **Task Service** | 任务生命周期管理：创建、状态流转、查询、幂等 |
| **Bull Queue** | 异步任务缓冲区，解耦提交与处理 |
| **Worker Consumer** | 消费队列 Job，调用 Provider Adapter 提交厂商请求 |
| **Provider Adapter Layer** | 厂商协议适配层，统一抽象提交/查询/取消接口 |
| **Polling Scheduler** | 定时扫描待轮询任务，调用 Adapter 查询厂商状态 |
| **Callback Dispatcher** | 负责将成功结果投递到业务方 callbackUrl |
| **MongoDB** | 任务持久化，状态存储，回调日志 |
| **Redis** | Bull 队列后端，分布式锁，限流计数器，缓存 |

<a id="architecture-4"></a>

#### 数据流

```
请求进入 → 鉴权 → 校验 → 幂等检查 → 入库(PENDING) → 入队
    → Worker 消费 → Adapter 转换 → 厂商API → 更新(SUBMITTED)
    → Scheduler 轮询 → Adapter 查询 → 状态同步
    → 成功 → 入库(SUCCESS) → Callback投递 → 签名+POST → 重试保障
```

---


<a id="architecture-5"></a>

### 核心流程设计

<a id="architecture-6"></a>

#### 任务提交流程（异步模式）

```
Client                    API              TaskService          Bull Queue
  │                        │                    │                    │
  │── POST /v1/tasks ─────>│                    │                    │
  │                        │── 鉴权+校验 ──────>│                    │
  │                        │                    │── 幂等检查         │
  │                        │                    │── 写入 DB(PENDING) │
  │                        │                    │──────────────────>│ add Job
  │<── 202 { taskId } ─────│<───────────────────│                    │
  │                        │                    │                    │
```

**详细步骤：**

1. 客户端调用 `POST /v1/tasks`，传入 `model`、`input`、`callbackUrl` 等参数
2. API Controller 执行鉴权（API Key / JWT / Service Token）
3. 使用 DTO + class-validator 进行参数校验
4. TaskService 检查 `idempotencyKey` 是否重复（查 `idempotency_records` 集合）
5. 若重复，直接返回原 `taskId`（幂等保护）
6. 若新任务：
    - 生成 `taskId`（UUID v4 或 ULID）
    - 根据 `model` 解析 `provider`（查配置映射表）
    - 写入 `tasks` 集合，状态 `PENDING`
    - 写入 `idempotency_records`（带 TTL 索引，如 24h 过期）
    - 推送 Bull Job 到 `task-submit` 队列
7. 返回 HTTP 202：`{ taskId, status: "PENDING", createdAt }`

<a id="architecture-7"></a>

#### 任务消费流程（Worker 提交到厂商）

```
Bull Queue         Worker Consumer       Adapter              Third Party
    │                    │                  │                      │
    │── pull Job ──────>│                  │                      │
    │                    │── submit() ────>│                      │
    │                    │                  │── HTTP POST ────────>│
    │                    │                  │<── { providerTaskId }│
    │                    │<── result ───────│                      │
    │                    │── update DB      │                      │
    │                    │   (SUBMITTED)    │                      │
    │                    │                  │                      │
```

**详细步骤：**

1. Worker Consumer 拉取 `task-submit` 队列中的 Job
2. 从 Job data 中获取 `taskId`，查询 DB 获取完整任务信息
3. 校验任务状态为 `PENDING`（防止重复消费）
4. 根据 `provider` 获取对应 Adapter 实例
5. Adapter 将统一格式 `normalizedRequest` 转换为厂商特定格式
6. 调用厂商 API 创建任务
7. **同步模式**：厂商立即返回结果
    - 保存结果，状态改为 `SUCCESS`
    - 投递回调任务到 `callback` 队列
8. **异步模式**：厂商返回 `providerTaskId`
    - 保存 `providerTaskId`，状态改为 `SUBMITTED`
    - 设置 `nextPollAt` 时间
9. 若厂商调用失败：
    - 可重试错误：Bull 自动重试（指数退避）
    - 不可重试错误：标记 `FAILED`，记录错误详情

<a id="architecture-8"></a>

#### 定时轮询流程

```
Scheduler            DB               Adapter           Third Party
    │                 │                  │                   │
    │── 获取分布式锁   │                  │                   │
    │── query tasks ─>│                  │                   │
    │   (SUBMITTED,   │                  │                   │
    │    nextPollAt   │                  │                   │
    │    <= now)      │                  │                   │
    │<── task list ───│                  │                   │
    │                 │                  │                   │
    │── queryTask() ────────────────────>│                   │
    │                 │                  │── GET status ────>│
    │                 │                  │<── { status } ────│
    │<── result ──────────────────────────│                   │
    │                 │                  │                   │
    │── update DB ───>│                  │                   │
    │   (状态变更)     │                  │                   │
    │                 │                  │                   │
```

**详细步骤：**

1. Cron 触发器按配置间隔启动（默认每 30 秒）
2. 尝试获取 Redis 分布式锁（防止多实例重复扫描）
3. 查询 DB：`status IN (SUBMITTED, PROCESSING) AND nextPollAt <= NOW()`
4. 按 `provider` 分组，批量查询
5. 对每个任务调用 Adapter 的 `queryTask(providerTaskId)`
6. 根据返回状态更新：
    - `running/processing` → 更新 `nextPollAt`（动态间隔），`pollCount++`
    - `succeeded` → 保存结果，状态改 `SUCCESS`，投递回调任务
    - `failed` → 状态改 `FAILED`，记录错误
7. 检查超时：`pollCount > maxPollCount` 或 `elapsed > maxDuration` → `TIMEOUT`
8. 释放分布式锁

<a id="architecture-9"></a>

#### 结果回调流程

```
Callback Queue     Callback Dispatcher     Client
      │                    │                  │
      │── pull Job ──────>│                  │
      │                    │── 构建 payload   │
      │                    │── HMAC 签名      │
      │                    │── POST ─────────>│
      │                    │<── 200 OK ───────│
      │                    │── 记录成功日志    │
      │                    │                  │
      │   失败时自动重试:   │                  │
      │   1m, 5m, 15m,    │                  │
      │   1h, 6h, 24h     │                  │
      │                    │                  │
```

**详细步骤：**

1. 回调任务从 `callback` 队列中被消费
2. 查询 DB 获取任务完整结果
3. 构建回调 payload：
   ```json
   {
     "taskId": "xxx",
     "status": "SUCCESS",
     "result": ["https://cdn.example.com/output.mp4"],
     "completedAt": "2026-04-04T12:00:00Z"
   }
   ```
4. 生成签名：
    - 签名串：`${timestamp}.${JSON.stringify(body)}`
    - 使用 `callbackSecret`（或系统默认密钥）计算 `HMAC-SHA256`
5. 发送 HTTP POST，携带 Header：
    - `X-ModelHub-Signature: sha256=<hmac>`
    - `X-ModelHub-Timestamp: <unix_timestamp>`
    - `X-ModelHub-TaskId: <taskId>`
6. 2xx 响应视为成功，记录日志
7. 非 2xx / 超时 / 网络错误 → Bull 自动重试
8. 超过最大重试次数 → 进入死信队列，任务回调状态改 `CALLBACK_DEAD_LETTER`

<a id="architecture-10"></a>

#### 计费合同

资金事务、价格快照与授权封顶统一见 [平台服务](design.md#platform)。


<a id="architecture-11"></a>

### 多服务商热切换设计

> **v2.2 说明**：本节与当前代码实现对齐。早期文档中的独立集合 `model_routes` + Redis pub/sub 推送路由缓存属于**草案/未落地**方案；**实际热切换**以 MongoDB **`model_routing_rules`**（及既有 **`model_configs`**）为准。

<a id="architecture-12"></a>

#### 设计目标

| 目标 | 说明 |
|------|------|
| **配置化切换** | 通过 `model_routing_rules` 或 `model_configs` 调整，新任务即时按新策略解析（无需改业务调用方 `model` 字符串） |
| **最小影响面** | **已创建任务** `tasks.provider` 与已入队 Job 不变；仅**新任务**走新路由 |
| **灰度与分流** | **weighted**：多厂商按权重比例；**primary_fallback**：主备比例（`primary_weight` / `fallback_weight`） |
| **可审计** | `tasks.routeId` 存规则文档 `_id`；时间线 `TASK_CREATED` 记录 `routingSource`、`routeId` |
| **回退** | 禁用规则、改权重、`effective_until` 到期、或删除规则，下一单即恢复为下层兜底逻辑 |

<a id="architecture-13"></a>

#### 配置分层（当前实现）

<a id="architecture-14"></a>

##### （1）MongoDB `model_routing_rules`（**最高优先级**）

| 字段 | 说明 |
|------|------|
| `model_name` | 与请求体 `model` 一致（完整字符串） |
| `client_id` | 空字符串表示**全客户端**；非空则仅匹配该 `clientId` |
| `enabled` | 是否启用 |
| `priority` | 同模型多规则时，越大越优先；相同时**绑定具体 client** 的规则优先于通配 |
| `effective_from` / `effective_until` | 可选生效窗口 |
| `strategy_type` | 见下表 |

**strategy_type 取值：**

| 类型 | 行为 |
|------|------|
| **fixed** | 使用 `fixed_provider`，固定单一厂商 |
| **weighted** | `weighted_targets: [{ provider, weight }, ...]`，权重和 > 0；按**稳定哈希**（`clientId + model + 规则 _id`）分流，同一用户同模型同规则下结果稳定，适合灰度 |
| **primary_fallback** | 必填 `primary_provider`；可选 `fallback_provider` 与 `primary_weight`（默认 100）、`fallback_weight`（默认 0）。未配置备或备权重为 0 时**仅走主**；否则主备按权重比例分流（算法同 weighted） |

管理服务：`ProviderRoutingService.tryResolveFromRules(modelName, clientId)`。

<a id="architecture-15"></a>

##### （2）MongoDB `model_configs`（**次优**）

- 当**无命中**路由策略时：若存在 `model_configs` 且 `service` 非空，则经 `mapModelConfigServiceToProvider(service)` 映射为 Adapter 名（`wavespeed` → `wavespeed-ai` 等）。

<a id="architecture-16"></a>

##### （3）模型路径兜底

- 无配置或 `service` 为空时：`model` 路径**首段**视为 `provider`（兼容历史调用）。

<a id="architecture-17"></a>

#### 路由解析与入队流程

```
创建任务 API
    → 校验 model_configs.disabled（若存在配置）
    → 计算 featureType（options / 路径推断）
    → ProviderRoutingService.tryResolveFromRules(model, clientId)
           ├─ 命中规则 → provider + routeId（规则 _id），routingSource = routing_rule
           └─ 未命中 → model_configs.service 映射 或 路径兜底
    → ProviderRegistry.hasAdapter(provider)
    → 持久化 tasks（含 provider、routeId）
    → QueueRouterService.enqueue(featureType, provider, …) → Bull 子队列 {feature}:{provider}
```

- **队列**：与 [§9 按功能队列隔离设计](#architecture-31) 一致；解析出的 `provider` 决定进入哪条厂商子队列。
- **时间线**：`TASK_CREATED` 可携带 `routingSource`、`routeId`，便于排障与审计。

<a id="architecture-18"></a>

#### 管理接口（路由策略）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/admin/model-routing-rules` | 列表，可选 `model_name`、分页 |
| POST | `/api/v1/admin/model-routing-rules` | 创建规则 |
| PUT | `/api/v1/admin/model-routing-rules/:id` | 更新 |
| DELETE | `/api/v1/admin/model-routing-rules/:id` | 删除 |

需管理端 JWT，角色 `admin` / `super_admin`。

**说明**：早期草案中的 `POST /v1/admin/routes/:routeId/switch`（独立 `model_routes` 文档 + Redis pub/sub）**未作为当前实现**；热切换以本表 CRUD + DB 为准。

<a id="architecture-19"></a>

#### 灰度与主备配置示例

**weighted（例如 70% / 30%）：**

```json
{
  "model_name": "wavespeed-ai/foo/text-to-image",
  "strategy_type": "weighted",
  "weighted_targets": [
    { "provider": "wavespeed-ai", "weight": 70 },
    { "provider": "minimax", "weight": 30 }
  ]
}
```

**primary_fallback（主备 9:1）：**

```json
{
  "model_name": "wavespeed-ai/foo/text-to-image",
  "strategy_type": "primary_fallback",
  "primary_provider": "wavespeed-ai",
  "fallback_provider": "akool",
  "primary_weight": 90,
  "fallback_weight": 10
}
```

观察各厂商成功率、延迟、错误率（Metrics 按 `provider` / `feature_type` 维度），再调整权重或规则。

<a id="architecture-20"></a>

#### 回退机制（当前实现）

- 将规则 **`enabled: false`**、或设置 **`effective_until`**、或 **删除**该规则文档；新任务将回退到 §6.2 中下一层（`model_configs.service` → 路径兜底）。
- 不在此文档承诺「一键回滚到上一 revision」的专用接口；可通过管理端保留规则副本或 GitOps 管理 Mongo 变更。

<a id="architecture-21"></a>

#### 与现有 AGI-Content 的兼容

| 原 AGI-Content 方式 | Model-Hub 方式 |
|---------------------|----------------|
| 大段 `switch (provider)` / `model_name` 硬编码 | 统一 `model` + Model-Hub 内路由与 Adapter |
| 改枚举/代码 + 部署 | **优先**改 `model_routing_rules` / `model_configs`；新增厂商 Adapter 仍需发版注册 |
| 无平台级灰度表 | **weighted / primary_fallback** 支持比例灰度与主备比例 |

<a id="architecture-22"></a>

#### 健康感知故障转移（熔断器）

健康信号与熔断器的完整合同统一见 [平台服务设计](design.md#platform)。

**已实现的能力：**

| 能力 | 实现 |
|------|------|
| **三态熔断器** | `CircuitBreakerService`：CLOSED → OPEN → HALF_OPEN 状态机，Redis Lua CAS 原子操作 |
| **滑动窗口指标** | `HealthMetricsCollector`：5 分钟窗口成功率、错误率、平均延迟 |
| **状态存储** | Redis `circuit:provider:{name}` + 1 秒本地缓存，多实例共享 |
| **事件通知** | `system.provider_circuit_open` / `half_open` / `closed` 事件，对接通知系统 |
| **手动覆盖** | 管理员可强制 OPEN/CLOSED，暂停自动状态转换 |
| **Prometheus** | `modelhub_circuit_breaker_state` Gauge 实时暴露 |

**待实现（仍为 TODO）：**

| 方向 | 说明 |
|------|------|
| **解析阶段集成** | `tryResolveFromRules` 在选中「主」前检查熔断器状态；若主为 OPEN，则选用备 |
| **提交失败改派** | `FeatureQueueProcessor` 首次失败且错误可重试时，改派到 `fallback_provider`（需处理幂等和对账） |

---


<a id="architecture-23"></a>

### Provider Adapter 统一抽象层

<a id="architecture-24"></a>

#### 核心接口定义

```typescript
interface IProviderAdapter {
  readonly providerName: string;

  submitTask(request: NormalizedTaskRequest): Promise<SubmitResult>;

  queryTask(providerTaskId: string, meta?: Record<string, any>): Promise<QueryResult>;

  cancelTask?(providerTaskId: string): Promise<CancelResult>;

  mapStatus(providerStatus: string): TaskStatus;

  mapError(providerError: any): HubError;

  getRateLimitConfig(): RateLimitConfig;
}

interface NormalizedTaskRequest {
  taskId: string;
  model: string;
  input: Record<string, any>;
  options?: Record<string, any>;
}

interface SubmitResult {
  providerTaskId: string;
  isSync: boolean;           // 厂商是否同步返回结果
  result?: any;              // 同步模式下的结果
  rawResponse?: any;
}

interface QueryResult {
  status: 'pending' | 'processing' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';
  progress?: number;         // 0-100
  result?: any;
  error?: { code: string; message: string };
  rawResponse?: any;
}

interface CancelResult {
  accepted: boolean;
  message?: string;
}

interface RateLimitConfig {
  maxConcurrent: number;     // 最大并发
  maxPerSecond: number;      // QPS 限制
  maxPerMinute?: number;
}
```

<a id="architecture-25"></a>

#### 状态映射标准（按实际厂商）

| 厂商 | 原始状态 | Hub 统一状态 |
|------|---------|-------------|
| **WaveSpeed** | `created` | `SUBMITTED` |
| **WaveSpeed** | `processing` | `PROCESSING` |
| **WaveSpeed** | `completed` | `SUCCESS` |
| **WaveSpeed** | `failed` | `FAILED` |
| **Cloudwise** | `pending` / `queued` | `SUBMITTED` |
| **Cloudwise** | `running` | `PROCESSING` |
| **Cloudwise** | `completed` | `SUCCESS` |
| **Cloudwise** | `failed` | `FAILED` |
| **Akool 自有** | `queued` | `SUBMITTED` |
| **Akool 自有** | `processing` | `PROCESSING` |
| **Akool 自有** | `done` / `succeeded` | `SUCCESS` |
| **Akool 自有** | `failed` / `error` | `FAILED` |
| 所有厂商 | 其他未知状态 | `PROCESSING`（继续轮询） |

<a id="architecture-26"></a>

#### 已支持厂商 Adapter 实现

> 以下为项目初期优先实现的三个厂商，参照 AGI-Content / AGI-Content-Job 中已有的 `WaveSpeedAiAPI`、`CloudwiseAPI`、`akoolApi` 封装。

<a id="architecture-27"></a>

##### WaveSpeed Adapter

```typescript
@Injectable()
class WaveSpeedAdapter implements IProviderAdapter {
  readonly providerName = 'wavespeed-ai';

  // 基于 AGI-Content-Job 的 waveSpeedAIApi.js 封装
  // baseUrl: config.weveSpeedAi.api_url (https://api.wavespeed.ai/api/v3)
  // auth: Bearer ${config.weveSpeedAi.api_key}

  async submitTask(request: NormalizedTaskRequest): Promise<SubmitResult> {
    // 根据 featureType 调用不同端点：
    // - text-to-video:  POST /predictions (textToVideo)
    // - image-to-video: POST /predictions (imageToVideo / referenceToVideo)
    // - text-to-image:  POST /predictions (imageGenerate)
    // - character-swap: POST /predictions (characterFaceswap)
    // - video-upscale:  POST /predictions (videoUpscale)
    const endpoint = this.resolveEndpoint(request.model);
    const body = this.transformInput(request);
    const response = await this.httpClient.post(endpoint, body, { headers: this.headers });
    return {
      providerTaskId: response.data.id,
      isSync: false,
    };
  }

  async queryTask(providerTaskId: string): Promise<QueryResult> {
    // GET /predictions/{taskId}/result
    const response = await this.httpClient.get(
      `${this.baseUrl}/predictions/${providerTaskId}/result`,
      { headers: this.headers },
    );
    return {
      status: this.mapInternalStatus(response.data.status),
      progress: response.data.progress || 0,
      result: response.data.output,
      rawResponse: response.data,
    };
  }

  mapStatus(providerStatus: string): TaskStatus {
    const map = {
      created: TaskStatus.SUBMITTED,
      processing: TaskStatus.PROCESSING,
      completed: TaskStatus.SUCCESS,
      failed: TaskStatus.FAILED,
    };
    return map[providerStatus] || TaskStatus.PROCESSING;
  }

  getRateLimitConfig(): RateLimitConfig {
    return { maxConcurrent: 10, maxPerSecond: 5 };
  }
}
```

**支持的功能模型映射：**

| 功能 | Model 标识示例 | WaveSpeed 端点 |
|------|---------------|---------------|
| 文生图 | `wavespeed-ai/flux-2-pro/text-to-image` | `POST /predictions` |
| 图生图 | `wavespeed-ai/flux-dev/image-to-image` | `POST /predictions` |
| 图生视频 | `wavespeed-ai/wan-2.1/image-to-video` | `POST /predictions` |
| 文生视频 | `wavespeed-ai/wan-2.1/text-to-video` | `POST /predictions` |
| 角色换装 | `wavespeed-ai/wan-2.2/animate` | `POST /predictions` |
| 视频超分 | `wavespeed-ai/video-upscale` | `POST /predictions` |

<a id="architecture-28"></a>

##### Cloudwise Adapter

```typescript
@Injectable()
class CloudwiseAdapter implements IProviderAdapter {
  readonly providerName = 'cloudwise';

  // 基于 AGI-Content-Job 的 cloudwiseApi.js 封装
  // baseUrl: config.cloudwise.api_url
  // auth: Bearer ${config.cloudwise.api_key}

  async submitTask(request: NormalizedTaskRequest): Promise<SubmitResult> {
    // text-to-image / image-to-image → POST /v1/images/generations
    const body = this.transformInput(request);
    const response = await this.httpClient.post(
      `${this.baseUrl}/v1/images/generations`,
      body,
      { headers: this.headers },
    );
    return {
      providerTaskId: response.data.id || response.data.task_id,
      isSync: false,
    };
  }

  async queryTask(providerTaskId: string): Promise<QueryResult> {
    // GET /v1/videos/{taskId}/content （Cloudwise 查询接口）
    const response = await this.httpClient.get(
      `${this.baseUrl}/v1/videos/${providerTaskId}/content`,
      { headers: this.headers },
    );
    return {
      status: this.mapInternalStatus(response.data.status),
      result: response.data.output,
      rawResponse: response.data,
    };
  }

  getRateLimitConfig(): RateLimitConfig {
    // Cloudwise 并发较高（AGI-Content-Job 中配置为 200 并发）
    return { maxConcurrent: 200, maxPerSecond: 50 };
  }
}
```

**支持的功能模型映射：**

| 功能 | Model 标识示例 |
|------|---------------|
| 文生图 | `cloudwise/nano-banana/text-to-image` |
| 文生图 Pro | `cloudwise/nano-banana-pro/text-to-image` |

<a id="architecture-29"></a>

##### Akool 自有模型 Adapter

```typescript
@Injectable()
class AkoolAdapter implements IProviderAdapter {
  readonly providerName = 'akool';

  // 基于 AGI-Content-Job 的 akool_api.js 封装
  // baseUrl: config.ai_voice.api_url
  // 实际走内部算法队列: POST /api/v1/task/publish

  async submitTask(request: NormalizedTaskRequest): Promise<SubmitResult> {
    // Akool 自有模型走算法队列 API
    const body = {
      algorithmFrom: request.options?.algorithmFrom,
      algorithmType: request.options?.algorithmType,
      priority: request.options?.priority || 0,
      data: request.input,
      webhookOverride: request.options?.webhook,
      queueName: request.options?.queueName,
      taskName: request.options?.taskName,
    };
    const response = await this.httpClient.post(
      `${this.baseUrl}/api/v1/task/publish`,
      body,
      { headers: this.headers },
    );
    return {
      providerTaskId: response.data.task_id || response.data.id,
      isSync: false,
    };
  }

  async queryTask(providerTaskId: string, meta?: Record<string, any>): Promise<QueryResult> {
    // GET /api/v1/itv/status?provider=xxx&task_id=xxx
    const provider = meta?.subProvider || 'akool';
    const response = await this.httpClient.get(
      `${this.baseUrl}/api/v1/itv/status`,
      { params: { provider, task_id: providerTaskId }, headers: this.headers },
    );
    return {
      status: this.mapInternalStatus(response.data.status),
      result: response.data.output,
      rawResponse: response.data,
    };
  }

  getRateLimitConfig(): RateLimitConfig {
    return { maxConcurrent: 50, maxPerSecond: 20 };
  }
}
```

**支持的功能模型映射：**

| 功能 | Model 标识示例 | 内部算法类型 |
|------|---------------|-------------|
| 图生视频 | `akool/image-to-video` | `algorithmFrom: 'itv'` |
| 文生视频 | `akool/text-to-video` | `algorithmFrom: 'ttv'` |
| 文生图 | `akool/text-to-image` | `algorithmFrom: 'imgGenByPrompt'` |
| Avatar | `akool/avatar` | `algorithmFrom: 'avatar'` |

<a id="architecture-30"></a>

#### 新增厂商流程

1. 在 `src/providers/adapters/` 下创建 `<provider-name>.adapter.ts`
2. 实现 `IProviderAdapter` 接口
3. 在 `provider.module.ts` 中注册 Adapter
4. 在配置中添加厂商 API Key、Endpoint、限流参数
5. 在 `model_routing_rules` 集合中配置路由策略（或依赖 `model_configs.service` 映射）
6. **无需**改动 Controller / TaskService / Queue / Callback 任何代码
7. 可通过管理接口灰度切流量到新厂商

**详细开发指南：** 参见本文档 [§7 Provider Adapter 统一抽象层](#architecture-23)

---


<a id="architecture-31"></a>

### 按功能队列隔离设计

> ★ v2.0 重构：按功能（featureType）拆分独立队列，避免不同功能之间的队列积压互相影响。参考 AGI-Content 中 `task_image_generate_queue`、`task_image2video_queue`、`task_characterSwap_queue` 等已有拆分实践。

<a id="architecture-32"></a>

#### 设计原则

| 原则 | 说明 |
|------|------|
| **功能隔离** | 图片生成、图生视频、角色换装、视频超分 各自独立队列 |
| **厂商可拆** | 同一功能下可按厂商再拆子队列（如 Cloudwise 高并发需独立） |
| **独立扩缩** | 每个功能队列的 Worker 实例数可独立调整 |
| **统一管理** | 通过 `QueueRegistryService` 统一注册/发现/监控所有队列 |

<a id="architecture-33"></a>

#### 队列拆分方案

```
                    ┌─────────────────────────────────────────────────┐
                    │              Bull Queue 拆分                     │
                    │                                                 │
                    │  ┌─── 功能维度 ──────────────────────────────┐  │
                    │  │                                            │  │
                    │  │  image-generate          图片生成          │  │
                    │  │    ├── :wavespeed-ai     WaveSpeed 子队列  │  │
                    │  │    ├── :cloudwise        Cloudwise 子队列  │  │
                    │  │    └── :akool            Akool 子队列      │  │
                    │  │                                            │  │
                    │  │  image-to-video           图生视频          │  │
                    │  │    ├── :wavespeed-ai                       │  │
                    │  │    └── :akool                               │  │
                    │  │                                            │  │
                    │  │  character-swap            角色换装          │  │
                    │  │    └── :wavespeed-ai                       │  │
                    │  │                                            │  │
                    │  │  video-upscale             视频超分          │  │
                    │  │    └── :wavespeed-ai                       │  │
                    │  │                                            │  │
                    │  └────────────────────────────────────────────┘  │
                    │                                                 │
                    │  ┌─── 横切队列 ──────────────────────────────┐  │
                    │  │  callback                  回调投递         │  │
                    │  │  dead-letter               死信             │  │
                    │  └────────────────────────────────────────────┘  │
                    │                                                 │
                    └─────────────────────────────────────────────────┘
```

<a id="architecture-34"></a>

#### 完整队列清单

| 队列名称 | featureType | provider | 并发数 | 重试 | 说明 |
|----------|-------------|----------|--------|------|------|
| `image-generate` | image_generate | 所有 | 10 | 5次/指数退避 | 图片生成入口队列 |
| `image-generate:wavespeed-ai` | image_generate | wavespeed-ai | 10 | 5次 | WaveSpeed 图片生成 |
| `image-generate:cloudwise` | image_generate | cloudwise | 200 | 5次 | Cloudwise 高并发 |
| `image-generate:akool` | image_generate | akool | 20 | 5次 | Akool 自有图片模型 |
| `image-to-video` | image_to_video | 所有 | 5 | 5次/指数退避 | 图生视频入口队列 |
| `image-to-video:wavespeed-ai` | image_to_video | wavespeed-ai | 10 | 5次 | WaveSpeed 图生视频 |
| `image-to-video:akool` | image_to_video | akool | 10 | 5次 | Akool 自有视频模型 |
| `character-swap` | character_swap | 所有 | 5 | 5次/指数退避 | 角色换装 |
| `character-swap:wavespeed-ai` | character_swap | wavespeed-ai | 10 | 5次 | WaveSpeed 角色换装 |
| `video-upscale` | video_upscale | 所有 | 3 | 5次 | 视频超分 |
| `video-upscale:wavespeed-ai` | video_upscale | wavespeed-ai | 5 | 5次 | WaveSpeed 视频超分 |
| `callback` | - | - | 20 | 6次/阶梯退避 | 回调投递 |
| `dead-letter` | - | - | 1 | 无 | 死信队列 |

<a id="architecture-35"></a>

#### 两级路由分发机制

```
客户端请求
    │
    ▼
TaskService.createTask()
    │
    ├─ 解析 featureType + provider
    │
    ▼
QueueRouterService.resolveQueue(featureType, provider)
    │
    ├─ 1. 优先匹配厂商级队列: "{featureType}:{provider}"
    │     （若存在且已注册 → 直接入该队列）
    │
    ├─ 2. 降级到功能级队列: "{featureType}"
    │     （功能入口队列的 Consumer 内部再按 provider 分发）
    │
    └─ 3. 兜底到默认队列: "task-submit-default"
```

```typescript
@Injectable()
class QueueRouterService {
  resolveQueueName(featureType: string, provider: string): string {
    const providerQueue = `${featureType}:${provider}`;
    if (this.queueRegistry.has(providerQueue)) {
      return providerQueue;
    }
    if (this.queueRegistry.has(featureType)) {
      return featureType;
    }
    return 'task-submit-default';
  }
}
```

<a id="architecture-36"></a>

#### 功能级队列 Consumer（入口队列转发到厂商队列）

```typescript
@Processor('image-generate')
class ImageGenerateEntryProcessor {
  @Process()
  async handle(job: Job<TaskSubmitJobData>) {
    const providerQueue = `image-generate:${job.data.provider}`;
    if (this.queueRegistry.has(providerQueue)) {
      // 转发到厂商专用队列
      await this.queueRegistry.getQueue(providerQueue).add(
        JOB_NAMES.SUBMIT_TO_PROVIDER,
        job.data,
        { priority: job.data.priority },
      );
      return;
    }
    // 无专用队列时直接处理
    await this.submitToProvider(job);
  }
}
```

<a id="architecture-37"></a>

#### 队列配置模板

```typescript
// 功能级队列统一配置
const FEATURE_QUEUE_DEFAULTS = {
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
    timeout: 60000,
    removeOnComplete: { age: 3600, count: 10000 },
    removeOnFail: { age: 86400 },
  },
};

// 厂商级并发配置（覆盖默认）
const PROVIDER_CONCURRENCY: Record<string, Record<string, number>> = {
  'image-generate': {
    'wavespeed-ai': 10,
    'cloudwise': 200,   // Cloudwise 高并发特性
    'akool': 20,
  },
  'image-to-video': {
    'wavespeed-ai': 10,
    'akool': 10,
  },
  'character-swap': {
    'wavespeed-ai': 10,
  },
  'video-upscale': {
    'wavespeed-ai': 5,
  },
};
```

<a id="architecture-38"></a>

#### 回调队列配置

```typescript
BullModule.registerQueue({
  name: 'callback',
  defaultJobOptions: {
    attempts: 6,
    backoff: { type: 'custom' },
    timeout: 30000,
    removeOnComplete: true,
    removeOnFail: false,
  },
});

const CALLBACK_BACKOFF = [60000, 300000, 900000, 3600000, 21600000, 86400000];
```

<a id="architecture-39"></a>

#### Job Data 结构

```typescript
interface TaskSubmitJobData {
  taskId: string;
  provider: string;
  model: string;
  featureType: string;          // ★ 新增：功能类型
  priority: number;
  tenantId: string;
  traceId: string;
  enqueuedAt: number;           // ★ 新增：入队时间戳（用于计算等待时长）
}

interface CallbackJobData {
  taskId: string;
  callbackUrl: string;
  callbackSecret?: string;
  traceId: string;
}
```

<a id="architecture-40"></a>

#### 动态队列注册

支持运行时通过管理接口新增/移除厂商级队列：

```
POST /v1/admin/queues
{
  "queueName": "image-generate:new-provider",
  "featureType": "image_generate",
  "provider": "new-provider",
  "concurrency": 15,
  "enabled": true
}
```

<a id="architecture-41"></a>

#### 队列与 Worker 进程映射

| Worker 进程 | 消费的队列 | PM2 实例数 |
|-------------|-----------|-----------|
| `worker-image-generate` | `image-generate`, `image-generate:*` | 2~N |
| `worker-image-to-video` | `image-to-video`, `image-to-video:*` | 2~N |
| `worker-character-swap` | `character-swap`, `character-swap:*` | 1~N |
| `worker-video-upscale` | `video-upscale`, `video-upscale:*` | 1~N |
| `worker-callback` | `callback`, `dead-letter` | 1~N |

---


<a id="architecture-42"></a>

### 统一 API 设计

<a id="architecture-43"></a>

#### 提交任务

```
POST /v1/tasks
Content-Type: application/json
X-API-Key: <api_key>
X-Idempotency-Key: <idempotency_key>
X-Trace-Id: <trace_id>          (可选)
```

**Request Body：**

```json
{
  "model": "text-to-image/sd-xl",
  "input": {
    "prompt": "A beautiful sunset over mountains",
    "negative_prompt": "blurry, low quality",
    "width": 1024,
    "height": 1024,
    "num_outputs": 1
  },
  "options": {
    "version": "39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b"
  },
  "callbackUrl": "https://api.example.com/webhooks/model-hub",
  "callbackSecret": "whsec_xxxxxxxxxxxxxxxx",
  "priority": 50,
  "metadata": {
    "userId": "user_123",
    "orderId": "order_456"
  }
}
```

**Response（202 Accepted）：**

```json
{
  "code": 0,
  "message": "Task created successfully",
  "data": {
    "taskId": "01HXYZ1234567890ABCDEF",
    "status": "PENDING",
    "model": "text-to-image/sd-xl",
    "provider": "replicate",
    "createdAt": "2026-04-04T12:00:00.000Z"
  }
}
```

<a id="architecture-44"></a>

#### 查询任务

```
GET /v1/tasks/:taskId
X-API-Key: <api_key>
```

**Response（200 OK）：**

```json
{
  "code": 0,
  "data": {
    "taskId": "01HXYZ1234567890ABCDEF",
    "status": "SUCCESS",
    "model": "text-to-image/sd-xl",
    "provider": "wavespeed-ai",
    "result": [
      "https://cdn.example.com/output.mp4"
    ],
    "createdAt": "2026-04-04T12:00:00.000Z",
    "submittedAt": "2026-04-04T12:00:01.000Z",
    "completedAt": "2026-04-04T12:00:05.000Z"
  }
}
```

**`data.result` 格式（SUCCESS 时）：**

| 场景 | 类型 | 示例 |
|------|------|------|
| 图/视频/音频等 URL 输出 | `string[]` | `["https://cdn.example.com/out.mp4"]` |
| 少数同步任务（含 usage 等） | `object` | `{ "output": ["https://..."], "usage": { "total_tokens": 128 } }` |

裸 URL 不再以单个 `string` 返回；查询接口与业务回调均经 `normalizeTaskResultPayload` 统一。

<a id="architecture-45"></a>

#### 查询任务列表

```
GET /v1/tasks?status=SUCCESS&model=text-to-image/sd-xl&page=1&pageSize=20
X-API-Key: <api_key>
```

**Response（200 OK）：**

```json
{
  "code": 0,
  "data": {
    "items": [ ... ],
    "total": 156,
    "page": 1,
    "pageSize": 20
  }
}
```

<a id="architecture-46"></a>

#### 取消任务

```
POST /v1/tasks/:taskId/cancel
X-API-Key: <api_key>
```

**Response（200 OK）：**

```json
{
  "code": 0,
  "message": "Task cancellation requested",
  "data": {
    "taskId": "01HXYZ1234567890ABCDEF",
    "status": "CANCELLED"
  }
}
```

<a id="architecture-47"></a>

#### 回调重放（管理端）

```
POST /v1/admin/tasks/:taskId/replay-callback
X-Service-Token: <service_token>
```

<a id="architecture-48"></a>

#### 错误码定义

| 错误码 | HTTP Status | 说明 |
|--------|-------------|------|
| 0 | 200/202 | 成功 |
| 1001 | 400 | 参数校验失败 |
| 1002 | 400 | 不支持的模型 |
| 1003 | 409 | 重复提交（幂等命中） |
| 2001 | 401 | 未授权 |
| 2002 | 403 | 权限不足 |
| 3001 | 404 | 任务不存在 |
| 3002 | 409 | 任务状态不允许此操作 |
| 4001 | 500 | 厂商调用失败 |
| 4002 | 503 | 厂商限流 |
| 4003 | 504 | 厂商超时 |
| 5001 | 500 | 内部错误 |
| 5002 | 503 | 服务不可用 |

<a id="architecture-49"></a>

#### 回调 Payload 格式

业务方收到的 POST 请求：

```
POST https://api.example.com/webhooks/model-hub
Content-Type: application/json
X-ModelHub-Signature: sha256=xxxxxxxxxxxxx
X-ModelHub-Timestamp: 1712236800
X-ModelHub-TaskId: 01HXYZ1234567890ABCDEF
X-ModelHub-Event: task.completed
```

```json
{
  "taskId": "01HXYZ1234567890ABCDEF",
  "status": "SUCCESS",
  "result": [
    "https://cdn.example.com/output.mp4"
  ],
  "error": null,
  "completedAt": "2026-04-04T12:00:05.000Z"
}
```

> **result 格式说明**：媒体类（图/视频/音频）成功结果统一为 **URL 字符串数组**；不再返回单个 URL 字符串。少数同步任务可能仍为结构化对象（如 `{ "output": [...], "usage": {...} }`）。

---


<a id="architecture-50"></a>

### 任务状态机设计

<a id="architecture-51"></a>

#### 状态定义

| 状态 | 说明 | 进入条件 |
|------|------|----------|
| `PENDING` | 任务已创建，等待消费 | 创建任务 |
| `SUBMITTED` | 已提交到厂商 | Worker 成功调用厂商 API |
| `PROCESSING` | 厂商处理中 | 轮询发现厂商状态为处理中 |
| `SUCCESS` | 任务成功 | 厂商返回成功结果 |
| `FAILED` | 任务失败 | 厂商返回失败 / 不可重试错误 |
| `TIMEOUT` | 任务超时 | 超过最大轮询次数或时长 |
| `CANCELLED` | 任务已取消 | 用户请求取消 |

<a id="architecture-52"></a>

#### 合法状态流转

```
                            ┌──────────────┐
                            │   PENDING    │
                            └──────┬───────┘
                                   │
                        ┌──────────┼──────────┐
                        │          │          │
                        ▼          ▼          ▼
                   ┌─────────┐  ┌──────┐  ┌──────────┐
                   │SUBMITTED│  │FAILED│  │CANCELLED │
                   └────┬────┘  └──────┘  └──────────┘
                        │
                 ┌──────┼──────┐
                 │      │      │
                 ▼      ▼      ▼
           ┌──────────┐ │  ┌──────┐  ┌────────┐  ┌──────────┐
           │PROCESSING│ │  │FAILED│  │TIMEOUT │  │CANCELLED │
           └────┬─────┘ │  └──────┘  └────────┘  └──────────┘
                │       │
          ┌─────┼───────┤
          │     │       │
          ▼     ▼       ▼
      ┌───────┐ │  ┌──────┐  ┌────────┐
      │SUCCESS│ │  │FAILED│  │TIMEOUT │
      └───────┘    └──────┘  └────────┘
```

<a id="architecture-53"></a>

#### 状态流转约束

```typescript
const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  [TaskStatus.PENDING]:    [TaskStatus.SUBMITTED, TaskStatus.FAILED, TaskStatus.CANCELLED],
  [TaskStatus.SUBMITTED]:  [TaskStatus.PROCESSING, TaskStatus.SUCCESS, TaskStatus.FAILED, TaskStatus.TIMEOUT, TaskStatus.CANCELLED],
  [TaskStatus.PROCESSING]: [TaskStatus.SUCCESS, TaskStatus.FAILED, TaskStatus.TIMEOUT],
  [TaskStatus.SUCCESS]:    [],  // 终态
  [TaskStatus.FAILED]:     [],  // 终态
  [TaskStatus.TIMEOUT]:    [],  // 终态
  [TaskStatus.CANCELLED]:  [],  // 终态
};
```

<a id="architecture-54"></a>

#### 并发安全保障

使用**条件更新 + 乐观锁**避免并发覆盖：

```typescript
async transitionStatus(taskId: string, fromStatus: TaskStatus, toStatus: TaskStatus, update: object) {
  const result = await this.taskModel.findOneAndUpdate(
    {
      taskId,
      status: fromStatus,       // 条件：当前状态必须匹配
      version: currentVersion,  // 乐观锁
    },
    {
      $set: { status: toStatus, ...update },
      $inc: { version: 1 },
    },
    { new: true },
  );

  if (!result) {
    throw new ConflictException('Task status transition conflict');
  }
  return result;
}
```

---


<a id="architecture-55"></a>

### 定时轮询策略

<a id="architecture-56"></a>

#### 轮询调度器

```typescript
@Injectable()
class PollingScheduler {
  // 每 30 秒触发一次
  @Cron('*/30 * * * * *')
  async handlePolling() {
    const lockKey = 'model-hub:polling:lock';
    const locked = await this.redisLock.acquire(lockKey, 30000); // 30s 锁
    if (!locked) return; // 其他实例已在处理

    try {
      await this.pollingService.pollPendingTasks();
    } finally {
      await this.redisLock.release(lockKey);
    }
  }
}
```

<a id="architecture-57"></a>

#### 动态轮询间隔

```typescript
// 根据任务已等待时间动态调整轮询间隔
function calculateNextPollInterval(task: Task): number {
  const elapsed = Date.now() - task.submittedAt.getTime();
  const config = task.providerConfig.pollingConfig;

  if (elapsed < 60_000) {
    return config.minInterval;          // 前 1min：快轮询（30s）
  } else if (elapsed < 300_000) {
    return 30_000;                      // 1-5min：30s
  } else if (elapsed < 600_000) {
    return 45_000;                      // 5-10min：45s
  } else {
    return Math.min(60_000, config.maxInterval); // 10min+：60s
  }
}
```

<a id="architecture-58"></a>

#### 批量轮询实现

```typescript
async pollPendingTasks() {
  const batchSize = 200;
  const tasks = await this.taskModel.find({
    status: { $in: [TaskStatus.SUBMITTED, TaskStatus.PROCESSING] },
    'polling.nextPollAt': { $lte: new Date() },
  })
  .sort({ 'polling.nextPollAt': 1 })
  .limit(batchSize)
  .lean();

  // 按 provider 分组并行处理
  const grouped = groupBy(tasks, 'provider');
  await Promise.allSettled(
    Object.entries(grouped).map(([provider, providerTasks]) =>
      this.pollProviderTasks(provider, providerTasks)
    )
  );
}
```

<a id="architecture-59"></a>

#### 超时与异常处理

- **任务超时**：`pollCount >= maxPollCount` 或 `elapsed >= maxDuration` → 标记 `TIMEOUT`
- **厂商 429**：该厂商所有任务 `nextPollAt` 延后 60s
- **厂商 5xx**：延后 30s + 触发熔断计数
- **熔断**：连续 N 次失败后暂停该厂商轮询 5 分钟

<a id="architecture-60"></a>

#### 轮询查询失败优雅重试 ★ v2.4 新增

> **背景**：`queryTask` 调用厂商 API 查询任务状态时，可能因厂商临时故障（502/503/429 等）抛出异常。v2.4 之前，异常直接 re-throw，`nextPollAt` 和 `pollCount` 均未更新，导致下一个 30s cron 周期立即重新拉取该任务"暴力重试"，产生大量 ERROR 日志且无退避。

<a id="architecture-61"></a>

##### 设计原则

| 原则 | 说明 |
|------|------|
| **复用 `mapError`** | 所有 Adapter 已实现 `mapError(err) → { code, message, retryable }`，轮询阶段直接复用，无需新增判断逻辑 |
| **可重试 vs 不可重试** | `retryable: true`（429/5xx）→ 退避重试；`retryable: false`（400/401/403）→ 直接标记 `FAILED` |
| **不消耗 pollCount** | 可重试错误使用 `deferNextPoll`（仅推迟 `nextPollAt`），不递增 `pollCount`，避免因上游临时故障导致任务被误判超时 |
| **退避策略** | `backoffMs = min(currentPollInterval × 2, maxIntervalMs)`，给上游恢复时间 |
| **及时释放资源** | 异常时提前释放并发令牌（`concToken`），避免占用并发槽位 |

<a id="architecture-62"></a>

##### 处理流程
    │
    ├── 释放并发令牌（concToken）
    │
    ├── adapter.mapError(err) → { code, message, retryable }
    │
    ├─── retryable === true ──────────────────────────────┐
    │    │                                                 │
    │    ├── 计算退避时间 backoffMs                         │
    │    │   = min(pollInterval × 2, maxIntervalMs)       │
    │    │                                                 │
    │    ├── deferNextPoll(taskId, backoffMs)              │
    │    │   → 仅更新 nextPollAt，不增加 pollCount          │
    │    │                                                 │
    │    ├── 记录 POLL_RESULT 时间线事件                    │
    │    │   { providerStatus: 'error', retryable: true,  │
    │    │     errorCode, nextRetryMs }                    │
    │    │                                                 │
    │    └── WARN 日志（非 ERROR，减少告警噪音）             │
    │                                                      │
    └─── retryable === false ─────────────────────────────┐
         │                                                 │
         ├── updateStatus → FAILED                         │
         │   { code, message, retryable: false }           │
         │                                                 │
         ├── metrics.taskFailedTotal.inc(...)               │
         │                                                 │
         ├── 记录 TASK_FAILED 时间线事件                    │
         │                                                 │
         └── 发射 system.task_failed + provider_error 事件  │
```

#### 12.5.3 各 Adapter `mapError` 可重试判定（已有实现）
|---------|-----------|-----------|
| WaveSpeed | `status === 429 \|\| status >= 500` | `WAVESPEED_502` |
| Cloudwise | `status === 429 \|\| status >= 500` | `CLOUDWISE_503` |
| Akool | `status === 429 \|\| status >= 500` | `AKOOL_502` |
| MiniMax | `status === 429 \|\| status >= 500` | `MINIMAX_429` |
| Seedance | `status === 429 \|\| status >= 500` | `SEEDANCE_500` |
| Tencent | `RequestLimitExceeded \|\| InternalError` | `TENCENT_RequestLimitExceeded` |
| Wan | `status === 429 \|\| status >= 500` | `WAN_502` |

#### 12.5.4 与现有机制的对比
|------|---------|---------|------|
| **提交阶段**（FeatureQueueProcessor） | Bull 队列自动重试 | Bull 内置指数退避 | `retryable` 时 throw → Bull 重试 |
| **轮询阶段**（PollingService）★ v2.4 | `deferNextPoll` 推迟 | `pollInterval × 2`，上限 `maxIntervalMs` | 不消耗 pollCount |
| **轮询限流** | `deferNextPoll` 推迟 | 固定 500ms / 1000ms | QPS/并发超限时 |
| **回调阶段**（CallbackProcessor） | Bull 队列自动重试 | 指数退避，超限进死信 | `maxRetries` 配置 |

#### 12.5.5 关键代码（`polling.service.ts` `pollSingleTask` catch 块）
} catch (err: any) {
  // 提前释放并发令牌
  if (concToken) {
    await this.rateLimiter.releaseConcurrent(...);
    concToken = null;
  }

  const mapped = adapter.mapError(err);

  if (mapped.retryable) {
    // 可重试：退避调度，不消耗 pollCount
    const backoffMs = Math.min(
      (task.polling?.pollInterval ?? this.config.polling.defaultIntervalMs) * 2,
      this.config.polling.maxIntervalMs,
    );
    await this.taskRepo.deferNextPoll(task.taskId, backoffMs);
    // 记录时间线 + WARN 日志
  } else {
    // 不可重试：直接标记 FAILED + 发射事件
    await this.taskRepo.updateStatus(task.taskId, [...], TaskStatus.FAILED, { error: mapped });
  }
  return;
}
```

---


<a id="architecture-63"></a>

### 回调可靠性设计

<a id="architecture-64"></a>

#### 签名算法

```typescript
function generateSignature(secret: string, timestamp: number, body: string): string {
  const signaturePayload = `${timestamp}.${body}`;
  return crypto
    .createHmac('sha256', secret)
    .update(signaturePayload)
    .digest('hex');
}

// 回调请求头
headers = {
  'Content-Type': 'application/json',
  'X-ModelHub-Signature': `sha256=${signature}`,
  'X-ModelHub-Timestamp': timestamp.toString(),
  'X-ModelHub-TaskId': taskId,
  'X-ModelHub-Event': 'task.completed',
};
```

<a id="architecture-65"></a>

#### 回调发送

```typescript
async sendCallback(taskId: string) {
  const task = await this.taskModel.findOne({ taskId });
  const payload = this.buildCallbackPayload(task);
  const bodyStr = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const secret = task.callback.secret || this.configService.get('DEFAULT_CALLBACK_SECRET');
  const signature = this.generateSignature(secret, timestamp, bodyStr);

  try {
    const response = await this.httpClient.post(task.callback.url, payload, {
      headers: { ... },
      timeout: 10000,  // 10s 超时
    });

    await this.logCallback(taskId, task.callback.url, attempt, payload, response, true);
    await this.updateCallbackStatus(taskId, 'SUCCESS');
  } catch (error) {
    await this.logCallback(taskId, task.callback.url, attempt, payload, error, false);
    throw error; // Bull 自动重试
  }
}
```

<a id="architecture-66"></a>

#### 重试策略

| 重试次数 | 延迟时间 | 累计等待 |
|---------|---------|---------|
| 第 1 次 | 1 分钟 | 1 分钟 |
| 第 2 次 | 5 分钟 | 6 分钟 |
| 第 3 次 | 15 分钟 | 21 分钟 |
| 第 4 次 | 1 小时 | 1 小时 21 分 |
| 第 5 次 | 6 小时 | 7 小时 21 分 |
| 第 6 次 | 24 小时 | 31 小时 21 分 |

<a id="architecture-67"></a>

#### 死信处理

- 超过 6 次重试后，任务回调状态标记为 `DEAD_LETTER`
- 进入 `dead-letter` 队列保留
- 提供管理端接口 `POST /v1/admin/tasks/:taskId/replay-callback` 手动重放
- 告警通知运维人员

<a id="architecture-68"></a>

#### 安全防护

- **URL 白名单**：可配置允许回调的域名列表
- **SSRF 防护**：禁止回调到内网地址（`10.x`、`192.168.x`、`127.0.0.1`、`localhost`）
- **防重放**：业务方校验 timestamp 在 5 分钟窗口内
- **签名校验**：业务方使用 `callbackSecret` 验证签名完整性

---


<a id="architecture-69"></a>

### 安全方案

<a id="architecture-70"></a>

#### 输入校验

```typescript
// 使用 class-validator + class-transformer
class CreateTaskDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  model: string;

  @IsObject()
  @ValidateNested()
  input: Record<string, any>;

  @IsUrl({ protocols: ['https'] })
  @MaxLength(500)
  callbackUrl: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  callbackSecret?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  idempotencyKey?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  priority?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
```

<a id="architecture-71"></a>

#### 鉴权方案

| 场景 | 方案 | Header |
|------|------|--------|
| 外部业务方 | API Key 鉴权 | `X-API-Key` |
| 内部微服务 | Service Token | `X-Service-Token` |
| 管理端 | JWT + **细粒度权限** | `Authorization: Bearer` |

<a id="architecture-72"></a>

##### 管理端权限模型（与实现对齐）

- **认证**：`AdminJwtGuard` 校验 JWT，载荷中含用户标识及角色列表等。
- **授权**：多数管理接口使用 **`PermissionGuard`** + 装饰器 **`@RequirePermissions('resource:action')`**（如 `task:read`、`billing:read`、`menu:create`）。权限字符串来自 **`permissions`** 集合，由角色引用。
- **超级管理员**：角色名包含 **`super_admin`** 时视为拥有全部能力（与前端 `PermissionRoute` 一致）；权限列表含 **`*`** 时视为通配。
- **菜单可见性**：侧边栏由 **`GET /api/v1/admin/menu`** 返回；优先按角色绑定的 **菜单 key** 过滤（`MenuRegistryService.getFilteredMenuTreeByKeys`）；若无绑定菜单则回退为按权限码过滤（`getFilteredMenuTree`）。持久化见 **`menu_configs`** 集合及 **菜单管理 API** ` /api/v1/admin/menus`。
- **审计**：敏感操作应记入 `audit_logs`（具体埋点以各 Service 为准）。

> 早期「仅 `admin` / `operator` / `viewer` + `RolesGuard`」的三角色模型已被 **多角色 + 权限码 + 可选菜单 key** 替代；遗留文档提及 `RolesGuard` 处请以本段为准。

<a id="architecture-73"></a>

#### 限流策略

```typescript
// 全局限流
@UseGuards(ThrottlerGuard)
@Throttle(100, 60)  // 每分钟 100 次
class TaskController { ... }

// 租户级限流（Redis 滑动窗口）
@UseGuards(TenantRateLimitGuard)
@TenantRateLimit({ points: 500, duration: 60 })  // 每租户每分钟 500 次
async createTask() { ... }
```

<a id="architecture-74"></a>

#### 日志脱敏

```typescript
// 敏感字段列表
const SENSITIVE_FIELDS = ['apiKey', 'secret', 'password', 'token', 'callbackSecret', 'credentials'];

// 日志输出前自动脱敏
function sanitizeLog(data: any): any {
  // 递归遍历，将敏感字段值替换为 '***'
}
```

<a id="architecture-75"></a>

#### CORS 配置

```typescript
app.enableCors({
  origin: configService.get<string[]>('ALLOWED_ORIGINS'),  // 白名单
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'X-API-Key', 'X-Service-Token', 'X-Idempotency-Key'],
});
```

---


<a id="architecture-76"></a>

### 可观测与告警

<a id="architecture-77"></a>

#### 核心 Metrics（Prometheus）

| 指标名 | 类型 | 标签 | 说明 |
|--------|------|------|------|
| `modelhub_task_created_total` | Counter | `model`, `provider`, `tenant` | 任务创建数 |
| `modelhub_task_completed_total` | Counter | `model`, `provider`, `status` | 任务完成数（按状态） |
| `modelhub_task_duration_seconds` | Histogram | `model`, `provider` | 任务端到端时长 |
| `modelhub_provider_request_total` | Counter | `provider`, `method`, `status_code` | 厂商 API 调用数 |
| `modelhub_provider_request_duration` | Histogram | `provider`, `method` | 厂商 API 延迟 |
| `modelhub_queue_depth` | Gauge | `queue` | 队列积压数量 |
| `modelhub_queue_processing` | Gauge | `queue` | 正在处理数量 |
| `modelhub_callback_total` | Counter | `status` | 回调发送数 |
| `modelhub_callback_retry_total` | Counter | - | 回调重试数 |
| `modelhub_polling_batch_size` | Histogram | `provider` | 每批轮询任务数 |

<a id="architecture-78"></a>

#### 统一错误日志系统

<a id="architecture-79"></a>

##### ErrorLogger 工具类

项目使用统一的 `ErrorLogger` 工具类记录所有错误，确保错误信息完整、格式统一、易于排查。

**核心特性：**
- 结构化错误信息（错误码、消息、堆栈、上下文）
- 统一的日志格式
- 自动提取堆栈跟踪
- 支持丰富的上下文信息（taskId、provider、model、featureType 等）
- 区分错误日志（logError）和警告日志（logWarning）
- 自动提取 HTTP 错误详情

**使用示例：**

```typescript
import { ErrorLogger } from '../common/utils/error-logger.util';

// 记录错误（带堆栈和上下文）
ErrorLogger.logError(
  this.logger,
  error,
  {
    taskId: task.taskId,
    provider: task.provider,
    model: task.model,
    featureType: task.featureType,
  },
  'Provider submit failed',
);

// 记录警告
ErrorLogger.logWarning(
  this.logger,
  'Rate limited, will retry',
  { provider: 'wavespeed-ai', qps: 15 },
);
```

**日志输出格式：**

```
[ERROR] Provider submit failed [WAVESPEED_429] Rate limit exceeded | taskId=01JXXX, provider=wavespeed-ai, model=flux-2-pro/text-to-image, featureType=image_generate | retryable=true | HTTP 429 | POST https://api.wavespeed.ai/v1/predictions
Error: Rate limit exceeded
    at WaveSpeedAdapter.submitTask (wavespeed.adapter.ts:45:15)
    at FeatureQueueProcessor.submitToProvider (feature-queue.processor.ts:89:28)
    ...
```

<a id="architecture-80"></a>

##### 错误码体系

项目定义了完整的错误码体系（`src/common/constants/error-codes.ts`），按类别划分：

| 错误码范围 | 类别 | 示例 |
|-----------|------|------|
| 1000-1999 | 客户端错误 | `INVALID_INPUT`, `MISSING_REQUIRED_FIELD` |
| 2000-2999 | 认证授权错误 | `UNAUTHORIZED`, `FORBIDDEN` |
| 3000-3999 | 资源错误 | `TASK_NOT_FOUND`, `MODEL_NOT_FOUND` |
| 4000-4999 | 厂商错误 | `PROVIDER_UNAVAILABLE`, `PROVIDER_RATE_LIMITED` |
| 5000-5999 | 服务器错误 | `INTERNAL_ERROR`, `DATABASE_ERROR` |

**工具函数：**
- `isRetryableError(errorCode)` - 判断错误是否可重试
- `getHttpStatusForErrorCode(errorCode)` - 获取对应的 HTTP 状态码

<a id="architecture-81"></a>

##### 错误日志覆盖范围

所有核心服务和厂商适配器已完成错误日志更新：

**核心服务：**
- 全局异常过滤器（`global-exception.filter.ts`）
- 队列处理器（`feature-queue.processor.ts`）
- 轮询服务（`polling.service.ts`）
- 回调处理器（`callback.processor.ts`）
- 任务服务（`task.service.ts`）
- 管理后台认证（`admin-auth.service.ts`）

**厂商适配器（100% 覆盖）：**
- WaveSpeed AI
- 腾讯云
- MiniMax
- Akool
- Cloudwise
- Seedance
- 阿里云万相

**详细文档：**
- [错误码定义](#architecture)
- [统一错误日志系统](#architecture-78)
- [错误日志覆盖范围](#architecture-81)

<a id="architecture-82"></a>

#### 日志规范

```json
{
  "level": "info",
  "timestamp": "2026-04-04T12:00:00.000Z",
  "traceId": "abc-123",
  "taskId": "01HXYZ...",
  "tenantId": "tenant_001",
  "module": "TaskSubmitProcessor",
  "event": "task.submitted",
  "provider": "replicate",
  "providerTaskId": "pred_xxx",
  "latencyMs": 450,
  "message": "Task submitted to provider successfully"
}
```

<a id="architecture-83"></a>

#### 告警规则

| 告警 | 条件 | 严重级别 | 通知方式 |
|------|------|---------|---------|
| 任务失败率过高 | 5 分钟内失败率 > 10% | P1 | Slack + 短信 |
| 队列积压 | queue depth > 5000 持续 5 分钟 | P2 | Slack |
| 回调失败率过高 | 5 分钟内回调失败率 > 20% | P2 | Slack |
| 厂商超时率突增 | 单厂商 5 分钟超时率 > 30% | P1 | Slack + 短信 |
| 轮询延迟 | 平均轮询延迟 > 60s | P3 | Slack |
| Redis 连接异常 | 连接数 < 1 | P0 | 电话 + Slack |
| MongoDB 延迟 | 查询 P99 > 1s | P2 | Slack |

---


<a id="architecture-84"></a>

### 测试策略

<a id="architecture-85"></a>

#### 测试金字塔

| 层级 | 覆盖内容 | 工具 | 覆盖率要求 |
|------|---------|------|-----------|
| **单元测试** | Service、Adapter、工具函数 | Jest | > 80% |
| **集成测试** | Controller + DB + Queue | Jest + MongoDB Memory | > 60% |
| **端到端测试** | 完整流程（提交→轮询→回调） | Jest + Supertest | 核心流程 100% |
| **压测** | 吞吐量、延迟、稳定性 | k6 / Artillery | - |
| **故障演练** | Redis 断连、厂商超时 | 手动注入 | - |

<a id="architecture-86"></a>

#### 单元测试重点

- 状态机流转合法性
- Adapter 请求/响应映射
- 签名生成与校验
- 幂等检查逻辑
- 轮询间隔计算
- 输入校验 DTO

<a id="architecture-87"></a>

#### 集成测试重点

- 任务创建到入队全流程
- Worker 消费并更新状态
- 轮询调度并状态同步
- 回调发送与重试
- 并发状态更新冲突处理
- 死信队列处理

<a id="architecture-88"></a>

#### 压测场景

- 提交接口峰值：5000 TPS 持续 5 分钟
- 队列积压恢复：堆积 10 万 Job 后观察恢复时间
- 回调风暴：1000 个任务同时完成触发回调
- 长时间稳定性：72 小时持续运行

---


<a id="architecture-89"></a>

### 关键风险与规避

| 风险 | 影响 | 规避措施 |
|------|------|---------|
| 厂商 API 不稳定 | 任务失败率上升 | 熔断 + 降级 + 多厂商 Fallback |
| 队列堆积 | 任务延迟增大 | 弹性扩容 Worker + 优先级 + 超时剔除 |
| 回调不可靠 | 业务方丢失结果 | 签名 + 6 级重试 + Dead-letter + 手动重放 |
| 状态不一致 | 重复处理/丢失 | 严格状态机 + 条件更新 + 幂等键 |
| 成本不可控 | 超预算 | 配额限制 + 预算阈值告警 + 模型路由策略 |
| Redis 宕机 | 队列不可用 | Redis Cluster / Sentinel + 本地降级 |
| MongoDB 性能 | 查询慢 | 合理索引 + 读写分离 + 分片（大规模） |
| 单点故障 | 轮询停止 | 多实例 + 分布式锁 + 健康检查 |

---


<a id="architecture-90"></a>

### 队列消费情况统计

> ★ v2.0 新增：对每个功能队列、每个厂商级子队列的排队/消费情况进行实时采集与展示。

<a id="architecture-91"></a>

#### 采集机制

```typescript
@Injectable()
class QueueStatsCollector {
  // 每 30 秒采集一次所有队列的 jobCounts
  @Cron('*/30 * * * * *')
  async collectQueueSnapshots() {
    const lock = await this.redisLock.acquire('queue-stats-lock', 25000);
    if (!lock) return;

    try {
      const queues = this.queueRegistry.getAllQueues();
      for (const { name, queue, featureType, provider } of queues) {
        const counts = await queue.getJobCounts();
        const prevSnapshot = await this.getLastSnapshot(name);

        await this.queueSnapshotRepo.create({
          timestamp: new Date(),
          queueName: name,
          featureType,
          provider,
          waiting: counts.waiting,
          active: counts.active,
          completed: counts.completed,
          failed: counts.failed,
          delayed: counts.delayed,
          paused: counts.paused,
          depth: counts.waiting + counts.delayed,
          throughputPerMin: this.calcThroughput(prevSnapshot, counts),
        });
      }
    } finally {
      await this.redisLock.release('queue-stats-lock');
    }
  }
}
```

<a id="architecture-92"></a>

#### 实时查询接口

```
GET /v1/admin/queues/stats
X-Service-Token: <token>
```

**Response：**

```json
{
  "code": 0,
  "data": {
    "queues": [
      {
        "queueName": "image-generate:wavespeed-ai",
        "featureType": "image_generate",
        "provider": "wavespeed-ai",
        "waiting": 23,
        "active": 10,
        "completed": 15680,
        "failed": 42,
        "delayed": 5,
        "depth": 28,
        "throughputPerMin": 34.5
      },
      {
        "queueName": "image-generate:cloudwise",
        "featureType": "image_generate",
        "provider": "cloudwise",
        "waiting": 0,
        "active": 45,
        "completed": 89200,
        "failed": 12,
        "delayed": 0,
        "depth": 0,
        "throughputPerMin": 120.3
      }
    ],
    "summary": {
      "totalDepth": 56,
      "totalActive": 78,
      "totalThroughputPerMin": 245.8,
      "byFeature": {
        "image_generate": { "depth": 28, "active": 55, "throughputPerMin": 154.8 },
        "image_to_video": { "depth": 12, "active": 8, "throughputPerMin": 45.2 },
        "character_swap": { "depth": 10, "active": 10, "throughputPerMin": 32.1 },
        "video_upscale": { "depth": 6, "active": 5, "throughputPerMin": 13.7 }
      }
    },
    "snapshotAt": "2026-04-04T12:00:30.000Z"
  }
}
```

<a id="architecture-93"></a>

#### 历史趋势查询

```
GET /v1/admin/queues/stats/history?queueName=image-generate:wavespeed-ai&from=2026-04-04T00:00:00Z&to=2026-04-04T23:59:59Z&interval=5m
```

返回按时间间隔聚合的队列深度、吞吐量趋势数据，供 Dashboard 绘图。

<a id="architecture-94"></a>

#### 告警规则集成

| 指标 | 告警条件 | 级别 |
|------|---------|------|
| 队列深度 | 任意功能队列 depth > 1000 持续 5 分钟 | P2 |
| 队列深度 | 任意厂商队列 depth > 5000 持续 3 分钟 | P1 |
| 吞吐量 | 某队列 throughputPerMin 降为 0 持续 5 分钟 | P1 |
| 失败率 | 某队列 failed/(completed+failed) > 10% 持续 5 分钟 | P2 |

<a id="architecture-95"></a>

#### Prometheus Metrics 导出

```typescript
// 为每个队列导出 Gauge
modelhub_queue_depth{queue="image-generate:wavespeed-ai", feature="image_generate", provider="wavespeed-ai"}
modelhub_queue_active{queue="image-generate:wavespeed-ai", feature="image_generate", provider="wavespeed-ai"}
modelhub_queue_throughput_per_min{queue="image-generate:wavespeed-ai", feature="image_generate", provider="wavespeed-ai"}
modelhub_queue_failed_total{queue="image-generate:wavespeed-ai", feature="image_generate", provider="wavespeed-ai"}
```

---


<a id="architecture-96"></a>

### 任务数据聚合统计

> ★ v2.0 新增：按功能、模型、厂商维度进行每日/每月数据聚合，支持运营分析和成本核算。

<a id="architecture-97"></a>

#### 聚合维度

| 维度 | 字段 | 示例 |
|------|------|------|
| 时间 | date / month | `"2026-04-04"` / `"2026-04"` |
| 功能 | featureType | `"image_generate"` |
| 厂商 | provider | `"wavespeed-ai"` |
| 模型 | model | `"wavespeed-ai/flux-2-pro/text-to-image"` |

<a id="architecture-98"></a>

#### 聚合指标

| 指标类别 | 具体指标 |
|---------|---------|
| **任务量** | totalCount, successCount, failedCount, timeoutCount, cancelledCount |
| **成功率** | successRate = successCount / totalCount |
| **时长** | avgQueueWaitMs, avgProviderProcessMs, avgTotalE2eMs |
| **分位数** | p50E2eMs, p95E2eMs, p99E2eMs, maxE2eMs |
| **回调** | callbackSuccessCount, callbackFailedCount |

<a id="architecture-99"></a>

#### 聚合调度

```typescript
@Injectable()
class StatsAggregationScheduler {
  // 每日 01:00 聚合前一天的数据
  @Cron('0 1 * * *')
  async aggregateDailyStats() {
    const yesterday = this.getYesterdayDateString();
    await this.statsService.aggregateDaily(yesterday);
  }

  // 每月 1 号 02:00 聚合上个月的数据
  @Cron('0 2 1 * *')
  async aggregateMonthlyStats() {
    const lastMonth = this.getLastMonthString();
    await this.statsService.aggregateMonthly(lastMonth);
  }
}
```

<a id="architecture-100"></a>

#### 每日聚合实现（MongoDB Aggregation Pipeline）

```typescript
async aggregateDaily(date: string) {
  const startOfDay = new Date(`${date}T00:00:00.000Z`);
  const endOfDay   = new Date(`${date}T23:59:59.999Z`);

  const pipeline = [
    { $match: { createdAt: { $gte: startOfDay, $lte: endOfDay } } },
    {
      $group: {
        _id: { featureType: '$featureType', provider: '$provider', model: '$model' },
        totalCount: { $sum: 1 },
        successCount: { $sum: { $cond: [{ $eq: ['$status', 'SUCCESS'] }, 1, 0] } },
        failedCount: { $sum: { $cond: [{ $eq: ['$status', 'FAILED'] }, 1, 0] } },
        timeoutCount: { $sum: { $cond: [{ $eq: ['$status', 'TIMEOUT'] }, 1, 0] } },
        cancelledCount: { $sum: { $cond: [{ $eq: ['$status', 'CANCELLED'] }, 1, 0] } },
        avgQueueWaitMs: { $avg: '$timing.queueWaitMs' },
        avgProviderProcessMs: { $avg: '$timing.providerProcessMs' },
        avgTotalE2eMs: { $avg: '$timing.totalE2eMs' },
        allE2eMs: { $push: '$timing.totalE2eMs' },
        callbackSuccessCount: {
          $sum: { $cond: [{ $eq: ['$callback.status', 'SUCCESS'] }, 1, 0] }
        },
        callbackFailedCount: {
          $sum: { $cond: [{ $in: ['$callback.status', ['FAILED', 'DEAD_LETTER']] }, 1, 0] }
        },
      },
    },
    // 后续在应用层计算分位数 (p50/p95/p99)
  ];

  const results = await this.taskModel.aggregate(pipeline);

  for (const row of results) {
    const percentiles = this.calcPercentiles(row.allE2eMs);
    await this.dailyStatsModel.findOneAndUpdate(
      {
        date,
        featureType: row._id.featureType,
        provider: row._id.provider,
        model: row._id.model,
      },
      {
        $set: {
          ...row,
          p50E2eMs: percentiles.p50,
          p95E2eMs: percentiles.p95,
          p99E2eMs: percentiles.p99,
          maxE2eMs: percentiles.max,
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
  }
}
```

<a id="architecture-101"></a>

#### 统计查询接口

```
GET /v1/admin/stats/daily?date=2026-04-04&featureType=image_generate
GET /v1/admin/stats/daily?from=2026-04-01&to=2026-04-04&provider=wavespeed-ai

GET /v1/admin/stats/monthly?month=2026-04&featureType=image_to_video
GET /v1/admin/stats/monthly?from=2026-01&to=2026-04
```

**Response 示例：**

```json
{
  "code": 0,
  "data": [
    {
      "date": "2026-04-04",
      "featureType": "image_generate",
      "provider": "wavespeed-ai",
      "model": "wavespeed-ai/flux-2-pro/text-to-image",
      "totalCount": 12580,
      "successCount": 12320,
      "failedCount": 210,
      "timeoutCount": 50,
      "successRate": 0.979,
      "avgQueueWaitMs": 230,
      "avgProviderProcessMs": 4520,
      "avgTotalE2eMs": 4980,
      "p50E2eMs": 3200,
      "p95E2eMs": 8900,
      "p99E2eMs": 15200,
      "maxE2eMs": 42000
    }
  ]
}
```

<a id="architecture-102"></a>

#### 对比分析

支持同一模型在不同厂商之间的性能/成功率对比：

```
GET /v1/admin/stats/compare?model=text-to-image&from=2026-04-01&to=2026-04-04
```

返回 wavespeed-ai / cloudwise / akool 在同一模型上的并排数据，辅助厂商切换决策。

---


<a id="architecture-103"></a>

### 任务时长精确跟踪

> ★ v2.0 新增：记录每条任务在各阶段的精确时间点，计算等待时长和实际处理时长。

<a id="architecture-104"></a>

#### 时长指标定义

| 指标 | 计算方式 | 说明 |
|------|---------|------|
| **排队等待时长** | `dequeuedAt - enqueuedAt` | 任务在 Bull 队列中等待被消费的时间 |
| **厂商处理时长** | `providerCompletedAt - submittedAt` | 从提交厂商到厂商返回结果的时间 |
| **端到端总时长** | `completedAt - receivedAt` | 从 API 收到请求到任务最终完成的总时间 |
| **回调延迟** | `callbackSentAt - completedAt` | 从任务完成到回调成功发送的时间 |
| **Hub 内部开销** | `totalE2eMs - queueWaitMs - providerProcessMs` | 系统自身消耗的时间 |

<a id="architecture-105"></a>

#### 时间点采集位置

```
Client Request
    │
    ▼ ── receivedAt（API Controller 入口中间件）
    │
TaskService.createTask()
    │ ── enqueuedAt（Bull queue.add() 调用时）
    │
    ▼ ── dequeuedAt（Worker Processor 开始处理时）
    │
Adapter.submitTask()
    │ ── submittedAt（调用厂商 API 前）
    │
    ▼ ── providerStartedAt（厂商返回的开始时间，若提供）
    │
    ▼ ── providerCompletedAt（轮询发现完成时）
    │
    ▼ ── completedAt（Hub 标记 SUCCESS/FAILED 时）
    │
Callback.send()
    │ ── callbackSentAt（回调 2xx 响应时）
```

<a id="architecture-106"></a>

#### 计算字段自动填充

```typescript
// 在 TaskService.transitionStatus 中自动计算
async markCompleted(taskId: string, result: any) {
  const now = new Date();
  const task = await this.taskRepo.findByTaskId(taskId);

  const timing = {
    ...task.timing,
    completedAt: now,
    queueWaitMs: task.timing.dequeuedAt
      ? task.timing.dequeuedAt.getTime() - task.timing.enqueuedAt.getTime()
      : null,
    providerProcessMs: task.timing.submittedAt
      ? now.getTime() - task.timing.submittedAt.getTime()
      : null,
    totalE2eMs: task.timing.receivedAt
      ? now.getTime() - task.timing.receivedAt.getTime()
      : null,
  };

  await this.taskRepo.updateWithCondition(taskId, {
    status: TaskStatus.SUCCESS,
    resultPayload: result,
    timing,
  });
}
```

<a id="architecture-107"></a>

#### 慢任务告警

| 告警 | 条件 | 级别 |
|------|------|------|
| 排队等待过长 | `queueWaitMs > 60000` (1 分钟) | P3 |
| 排队等待严重 | `queueWaitMs > 300000` (5 分钟) | P2 |
| 厂商处理超时 | `providerProcessMs > maxDuration` | P2 |
| 端到端超时 | `totalE2eMs > 2 * 厂商 SLA` | P2 |

<a id="architecture-108"></a>

#### 查询接口

```
GET /v1/tasks/:taskId/timing

Response:
{
  "taskId": "01HXYZ...",
  "timing": {
    "receivedAt": "2026-04-04T12:00:00.000Z",
    "enqueuedAt": "2026-04-04T12:00:00.050Z",
    "dequeuedAt": "2026-04-04T12:00:00.230Z",
    "submittedAt": "2026-04-04T12:00:00.450Z",
    "providerCompletedAt": "2026-04-04T12:00:05.200Z",
    "completedAt": "2026-04-04T12:00:05.210Z",
    "callbackSentAt": "2026-04-04T12:00:05.380Z",
    "queueWaitMs": 180,
    "providerProcessMs": 4750,
    "totalE2eMs": 5210,
    "callbackDelayMs": 170
  }
}
```

---


<a id="architecture-109"></a>

### 任务处理日志时间线

> ★ v2.0 新增：为每条任务记录完整的生命周期事件时间线，便于后续问题排查和链路分析。

<a id="architecture-110"></a>

#### 时间线事件类型

| 事件代码 | 描述 | 触发时机 | detail 示例 |
|---------|------|---------|------------|
| `TASK_CREATED` | 任务创建 | TaskService.createTask | `{ model, provider, featureType }` |
| `TASK_ENQUEUED` | 入队 | Bull queue.add 成功 | `{ queueName, jobId }` |
| `TASK_DEQUEUED` | 出队开始处理 | Worker Processor 入口 | `{ workerId, attempt }` |
| `PROVIDER_SUBMIT_START` | 开始提交厂商 | Adapter.submitTask 调用前 | `{ provider, endpoint }` |
| `PROVIDER_SUBMIT_OK` | 厂商提交成功 | Adapter.submitTask 返回 | `{ providerTaskId, isSync }` |
| `PROVIDER_SUBMIT_FAIL` | 厂商提交失败 | Adapter.submitTask 异常 | `{ errorCode, errorMsg, retryable }` |
| `POLL_START` | 开始轮询 | PollingService 查询前 | `{ pollCount }` |
| `POLL_RESULT` | 轮询结果 | PollingService 查询后 | `{ providerStatus, progress }` |
| `PROVIDER_COMPLETED` | 厂商处理完成 | 轮询发现 completed | `{ result_summary }` |
| `PROVIDER_FAILED` | 厂商处理失败 | 轮询发现 failed | `{ errorCode, errorMsg }` |
| `TASK_SUCCESS` | 任务成功 | 状态变更为 SUCCESS | `{ totalE2eMs }` |
| `TASK_FAILED` | 任务失败 | 状态变更为 FAILED | `{ errorCode, failReason }` |
| `TASK_TIMEOUT` | 任务超时 | 超过最大轮询/时长 | `{ pollCount, elapsedMs }` |
| `TASK_CANCELLED` | 任务取消 | 用户请求取消 | `{ cancelledBy }` |
| `CALLBACK_SEND` | 发送回调 | CallbackService.send 调用 | `{ callbackUrl, attempt }` |
| `CALLBACK_OK` | 回调成功 | 收到 2xx 响应 | `{ responseCode, latencyMs }` |
| `CALLBACK_FAIL` | 回调失败 | 非 2xx / 超时 | `{ responseCode, error, nextRetryAt }` |
| `CALLBACK_DEAD_LETTER` | 回调进入死信 | 超过最大重试 | `{ totalAttempts }` |
| （路由信息） | — | 路由结果挂在 `TASK_CREATED` 的 detail 中 | `{ routingSource, routeId }`（`routeId` 为 `model_routing_rules._id`） |
| `RETRY_ENQUEUED` | 重试入队 | Bull 重试触发 | `{ attempt, delay }` |

<a id="architecture-111"></a>

#### 时间线写入工具

```typescript
@Injectable()
class TaskTimelineService {
  async addEvent(taskId: string, event: string, detail?: object) {
    const now = new Date();
    const lastEvent = await this.getLastEvent(taskId);
    const durationFromPrev = lastEvent
      ? now.getTime() - lastEvent.timestamp.getTime()
      : 0;

    await this.taskModel.updateOne(
      { taskId },
      {
        $push: {
          timeline: {
            event,
            timestamp: now,
            detail: detail || {},
            durationFromPrev,
          },
        },
      },
    );
  }
}
```

<a id="architecture-112"></a>

#### 在各关键节点埋点

```typescript
// TaskService
async createTask(dto) {
  const task = await this.taskRepo.create(taskData);
  await this.timelineService.addEvent(task.taskId, 'TASK_CREATED', {
    model: dto.model, provider, featureType,
  });
  // ...
  await this.timelineService.addEvent(task.taskId, 'TASK_ENQUEUED', {
    queueName, jobId,
  });
}

// Worker Processor
async handleSubmit(job) {
  await this.timelineService.addEvent(job.data.taskId, 'TASK_DEQUEUED', {
    workerId: process.pid, attempt: job.attemptsMade,
  });
  await this.timelineService.addEvent(job.data.taskId, 'PROVIDER_SUBMIT_START', {
    provider: job.data.provider,
  });
  try {
    const result = await adapter.submitTask(request);
    await this.timelineService.addEvent(job.data.taskId, 'PROVIDER_SUBMIT_OK', {
      providerTaskId: result.providerTaskId,
    });
  } catch (error) {
    await this.timelineService.addEvent(job.data.taskId, 'PROVIDER_SUBMIT_FAIL', {
      errorCode: error.code, errorMsg: error.message,
    });
  }
}

// PollingService
async pollTask(task) {
  await this.timelineService.addEvent(task.taskId, 'POLL_START', {
    pollCount: task.polling.pollCount,
  });
  const result = await adapter.queryTask(task.providerTask.providerTaskId);
  await this.timelineService.addEvent(task.taskId, 'POLL_RESULT', {
    providerStatus: result.status, progress: result.progress,
  });
}
```

<a id="architecture-113"></a>

#### 时间线查询接口

```
GET /v1/tasks/:taskId/timeline
```

**Response：**

```json
{
  "code": 0,
  "data": {
    "taskId": "01HXYZ...",
    "timeline": [
      {
        "event": "TASK_CREATED",
        "timestamp": "2026-04-04T12:00:00.000Z",
        "detail": { "model": "wavespeed-ai/flux-2-pro/text-to-image", "provider": "wavespeed-ai", "featureType": "image_generate" },
        "durationFromPrev": 0
      },
      {
        "event": "ROUTE_RESOLVED",
        "timestamp": "2026-04-04T12:00:00.010Z",
        "detail": { "routeId": "text-to-image/flux-2-pro", "provider": "wavespeed-ai", "weight": 100 },
        "durationFromPrev": 10
      },
      {
        "event": "TASK_ENQUEUED",
        "timestamp": "2026-04-04T12:00:00.050Z",
        "detail": { "queueName": "image-generate:wavespeed-ai", "jobId": "job_12345" },
        "durationFromPrev": 40
      },
      {
        "event": "TASK_DEQUEUED",
        "timestamp": "2026-04-04T12:00:00.230Z",
        "detail": { "workerId": 12345, "attempt": 0 },
        "durationFromPrev": 180
      },
      {
        "event": "PROVIDER_SUBMIT_START",
        "timestamp": "2026-04-04T12:00:00.235Z",
        "detail": { "provider": "wavespeed-ai", "endpoint": "/predictions" },
        "durationFromPrev": 5
      },
      {
        "event": "PROVIDER_SUBMIT_OK",
        "timestamp": "2026-04-04T12:00:00.450Z",
        "detail": { "providerTaskId": "pred_abc123", "isSync": false },
        "durationFromPrev": 215
      },
      {
        "event": "POLL_START",
        "timestamp": "2026-04-04T12:00:05.000Z",
        "detail": { "pollCount": 1 },
        "durationFromPrev": 4550
      },
      {
        "event": "POLL_RESULT",
        "timestamp": "2026-04-04T12:00:05.180Z",
        "detail": { "providerStatus": "completed", "progress": 100 },
        "durationFromPrev": 180
      },
      {
        "event": "PROVIDER_COMPLETED",
        "timestamp": "2026-04-04T12:00:05.185Z",
        "detail": { "result_summary": "1 image generated" },
        "durationFromPrev": 5
      },
      {
        "event": "TASK_SUCCESS",
        "timestamp": "2026-04-04T12:00:05.210Z",
        "detail": { "totalE2eMs": 5210 },
        "durationFromPrev": 25
      },
      {
        "event": "CALLBACK_SEND",
        "timestamp": "2026-04-04T12:00:05.300Z",
        "detail": { "callbackUrl": "https://api.example.com/webhooks", "attempt": 0 },
        "durationFromPrev": 90
      },
      {
        "event": "CALLBACK_OK",
        "timestamp": "2026-04-04T12:00:05.380Z",
        "detail": { "responseCode": 200, "latencyMs": 80 },
        "durationFromPrev": 80
      }
    ]
  }
}
```

<a id="architecture-114"></a>

#### 时间线数据管理

- **存储位置**：内嵌在 `tasks` 集合的 `timeline` 数组中（单任务事件通常 < 30 条，不会导致文档膨胀问题）
- **数据保留**：随 tasks 文档生命周期；若需长期保留，可定期归档到 `task_timeline_archive` 集合
- **查询优化**：timeline 按时间顺序追加，查询时无需排序
- **调试用途**：
  - 定位任务在哪个阶段耗时最长
  - 排查厂商提交失败的具体错误
  - 分析回调重试历史
  - 追溯路由决策（切换厂商前后对比）

---


<a id="structures"></a>

## 模块与数据结构

<a id="structures-1"></a>

### NestJS 模块清单与入口

<a id="structures-2"></a>

#### main.ts 入口（按进程类型启动）

```typescript
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const processType = process.env.PROCESS_TYPE || 'api';

  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  if (processType === 'api') {
    const port = process.env.PORT || 3000;
    await app.listen(port);
  } else {
    // worker / scheduler 不需要监听端口，仅初始化即可
    await app.init();
  }
}

bootstrap();
```

<a id="structures-3"></a>

#### app.module.ts 根模块

> **重要**：`PROCESS_TYPE` 仅支持 4 种生产值（`api`、`worker`、`scheduler`、`admin-server`）+ 开发环境的 `monolith`。
> 文档早期描述的 `worker-image-generate`、`worker-image-to-video` 等按功能拆分的进程类型**未实现**。
> 队列隔离在 Bull 队列层面完成（见 §7），不在进程层面。

```typescript
// src/app.module.ts
import { Module } from '@nestjs/common';
import { resolveProcessType, MONOLITH_PROCESS_TYPE } from './common/process-type.util';

const processType = resolveProcessType(process.env.PROCESS_TYPE);

function getProcessModules() {
  // 所有进程共享的模块
  const shared = [
    AppConfigModule, DatabaseModule, RedisModule, QueueModule,
    ResourceMetadataQueueModule, ProviderModule, ObservabilityModule,
    FeatureRegistryModule, BillingModule,  // BillingModule 是 @Global 的
  ];

  switch (processType) {
    case 'api':
      return [...shared, AuthModule, TaskModule, HealthModule,
              NotificationModule, ProviderHealthModule, WorkflowModule, PortalAuthModule];
    case 'worker':
      return [...shared, CallbackModule, NotificationModule, ProviderHealthModule];
    case 'scheduler':
      return [...shared, PollingModule, StatsModule, NotificationModule, ProviderHealthModule];
    case 'admin-server':
      return [...shared, AdminModule, StatsModule, DashboardModule, HealthModule, NotificationModule];
    case MONOLITH_PROCESS_TYPE:
      // 仅非 production：单进程加载全模块
      return [...shared, AuthModule, TaskModule, CallbackModule, PollingModule,
              StatsModule, AdminModule, HealthModule, NotificationModule,
              ProviderHealthModule, WorkflowModule, PortalAuthModule];
  }
}
```

<a id="structures-4"></a>

#### 模块注册清单

| 模块 | 文件路径 | 进程类型 | 全局 | 说明 |
|------|---------|---------|------|------|
| AppConfigModule | `src/config/config.module.ts` | 全部 | 是 | Nacos/本地 JSON 配置 |
| DatabaseModule | `src/database/database.module.ts` | 全部 | 是 | MongoDB 连接 + Schema |
| RedisModule | `src/redis/redis.module.ts` | 全部 | 是 | ioredis + 分布式锁 + 限流 |
| QueueModule | `src/queue/queue.module.ts` | 全部 | 是 | Bull 队列注册 |
| ResourceMetadataQueueModule | `src/queue/resource-metadata-queue.module.ts` | 全部 | 是 | 资源元数据提取队列 |
| ProviderModule | `src/provider/provider.module.ts` | 全部 | 是 | 厂商 Adapter 注册 |
| ObservabilityModule | `src/observability/observability.module.ts` | 全部 | 是 | Prometheus 指标 |
| FeatureRegistryModule | `src/common/feature-registry.module.ts` | 全部 | 是 | 功能描述符注册 + 同步插件 |
| ★ BillingModule | `src/billing/billing.module.ts` | 全部 | 是 | 计费（Pricing/Billing/Wallet） |
| AuthModule | `src/auth/auth.module.ts` | api | 否 | API Key 鉴权 |
| TaskModule | `src/task/task.module.ts` | api | 否 | 任务 REST API |
| HealthModule | `src/health/health.module.ts` | api, admin-server | 否 | liveness + readiness |
| ★ WorkflowModule | `src/workflow/workflow.module.ts` | api | 否 | 工作流引擎 |
| ★ PortalAuthModule | `src/portal-auth/portal-auth.module.ts` | api | 否 | 开发者门户鉴权 |
| ★ NotificationModule | `src/notification/notification.module.ts` | api, worker, scheduler, admin-server | 否 | 多渠道通知 |
| ★ ProviderHealthModule | `src/provider-health/provider-health.module.ts` | api, worker, scheduler | 否 | 熔断器 + 健康指标 |
| CallbackModule | `src/callback/callback.module.ts` | worker | 否 | 回调投递 |
| PollingModule | `src/polling/polling.module.ts` | scheduler | 否 | 定时轮询 |
| StatsModule | `src/stats/stats.module.ts` | scheduler, admin-server | 否 | 数据聚合统计 |
| AdminModule | `src/admin/admin.module.ts` | admin-server | 否 | 管理后台 API |
| DashboardModule | `src/dashboard/dashboard.module.ts` | admin-server | 否 | 前端 SPA 托管 |

---


<a id="structures-5"></a>

### Controller 定义清单

<a id="structures-6"></a>

#### TaskController

```typescript
// src/task/task.controller.ts

@Controller('v1/tasks')
@UseGuards(ApiKeyGuard)
export class TaskController {

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async createTask(
    @Body() dto: CreateTaskDto,
    @Headers('X-Idempotency-Key') idempotencyKey: string,
    @Tenant() tenantId: string,
  ): Promise<ApiResponse<TaskResponseDto>>

  @Get(':taskId')
  async getTask(
    @Param('taskId') taskId: string,
    @Tenant() tenantId: string,
  ): Promise<ApiResponse<TaskResponseDto>>

  @Get()
  async listTasks(
    @Query() query: TaskListQueryDto,
    @Tenant() tenantId: string,
  ): Promise<ApiResponse<PaginatedResponse<TaskResponseDto>>>

  @Post(':taskId/cancel')
  async cancelTask(
    @Param('taskId') taskId: string,
    @Tenant() tenantId: string,
  ): Promise<ApiResponse<TaskResponseDto>>

  // ★ v2.0 新增端点
  @Get(':taskId/timing')
  async getTaskTiming(
    @Param('taskId') taskId: string,
  ): Promise<ApiResponse<TaskTimingResponseDto>>

  @Get(':taskId/timeline')
  async getTaskTimeline(
    @Param('taskId') taskId: string,
  ): Promise<ApiResponse<TaskTimelineResponseDto>>
}
```

<a id="structures-7"></a>

#### AdminController

```typescript
// src/admin/admin.controller.ts

@Controller('v1/admin')
@UseGuards(ServiceTokenGuard)
export class AdminController {

  @Post('tasks/:taskId/replay-callback')
  async replayCallback(
    @Param('taskId') taskId: string,
  ): Promise<ApiResponse<void>>

  @Get('providers')
  async listProviders(): Promise<ApiResponse<ProviderStatusDto[]>>
}
```

<a id="structures-8"></a>

#### ★ RouteAdminController（v2.0 新增 - 路由热切换管理）

```typescript
// src/admin/route-admin.controller.ts

@Controller('v1/admin/routes')
@UseGuards(ServiceTokenGuard)
export class RouteAdminController {

  @Get()
  async listRoutes(): Promise<ApiResponse<ModelRouteDto[]>>

  @Get(':routeId')
  async getRoute(
    @Param('routeId') routeId: string,
  ): Promise<ApiResponse<ModelRouteDto>>

  @Post(':routeId/switch')
  async switchProvider(
    @Param('routeId') routeId: string,
    @Body() dto: SwitchProviderDto,
  ): Promise<ApiResponse<ModelRouteDto>>

  @Post(':routeId/rollback')
  async rollbackRoute(
    @Param('routeId') routeId: string,
    @Body() dto: RollbackRouteDto,
  ): Promise<ApiResponse<ModelRouteDto>>

  @Get(':routeId/history')
  async getSwitchHistory(
    @Param('routeId') routeId: string,
  ): Promise<ApiResponse<SwitchHistoryDto[]>>
}
```

<a id="structures-9"></a>

#### ★ QueueAdminController（v2.0 新增 - 队列统计管理）

```typescript
// src/admin/queue-admin.controller.ts

@Controller('v1/admin/queues')
@UseGuards(ServiceTokenGuard)
export class QueueAdminController {

  @Get('stats')
  async getQueueStats(): Promise<ApiResponse<QueueStatsDto>>

  @Get('stats/history')
  async getQueueStatsHistory(
    @Query() query: QueueStatsHistoryQueryDto,
  ): Promise<ApiResponse<QueueSnapshotDto[]>>

  @Post()
  async registerQueue(
    @Body() dto: RegisterQueueDto,
  ): Promise<ApiResponse<void>>
}
```

<a id="structures-10"></a>

#### ★ StatsController（v2.0 新增 - 数据聚合统计）

```typescript
// src/stats/stats.controller.ts

@Controller('v1/admin/stats')
@UseGuards(ServiceTokenGuard)
export class StatsController {

  @Get('daily')
  async getDailyStats(
    @Query() query: DailyStatsQueryDto,
  ): Promise<ApiResponse<DailyStatsDto[]>>

  @Get('monthly')
  async getMonthlyStats(
    @Query() query: MonthlyStatsQueryDto,
  ): Promise<ApiResponse<MonthlyStatsDto[]>>

  @Get('compare')
  async compareProviders(
    @Query() query: StatsCompareQueryDto,
  ): Promise<ApiResponse<ProviderCompareDto[]>>
}
```

<a id="structures-11"></a>

#### ☆ AuthAdminController（v2.1 新增 - 管理后台登录）

```typescript
// src/admin/auth-admin.controller.ts

@Controller('api/v1/admin/auth')
export class AuthAdminController {

  @Post('login')
  async login(@Body() dto: LoginDto): Promise<{ accessToken: string; refreshToken: string; user: AdminUserDto }>

  @Post('refresh')
  async refresh(@Body('refreshToken') token: string): Promise<{ accessToken: string }>

  @Get('me')
  @UseGuards(AdminJwtGuard)
  async me(@Req() req): Promise<AdminUserDto>
}
```

<a id="structures-12"></a>

#### ☆ DashboardOverviewController（v2.1 新增 - 总览数据）

```typescript
// src/admin/dashboard-overview.controller.ts

@Controller('api/v1/admin/dashboard')
@UseGuards(AdminJwtGuard)
export class DashboardOverviewController {

  @Get('overview')
  async getOverview(): Promise<ApiResponse<DashboardOverviewDto>>

  @Get('trends')
  async getTrends(@Query('hours') hours: number): Promise<ApiResponse<DashboardTrendsDto>>
}
```

<a id="structures-13"></a>

#### ☆ TaskAdminController（v2.1 新增 - 任务记录）

```typescript
// src/admin/task-admin.controller.ts

@Controller('api/v1/admin/tasks')
@UseGuards(AdminJwtGuard)
export class TaskAdminController {

  @Get()
  async listTasks(@Query() query: AdminTaskListQueryDto): Promise<ApiResponse<PaginatedResponse<TaskResponseDto>>>

  @Get(':taskId')
  async getTask(@Param('taskId') taskId: string): Promise<ApiResponse<TaskResponseDto>>

  @Get(':taskId/timing')
  async getTaskTiming(@Param('taskId') taskId: string): Promise<ApiResponse<TaskTimingResponseDto>>

  @Get(':taskId/timeline')
  async getTaskTimeline(@Param('taskId') taskId: string): Promise<ApiResponse<TaskTimelineResponseDto>>

  @Post(':taskId/replay-callback')
  @Roles('admin', 'operator')
  async replayCallback(@Param('taskId') taskId: string): Promise<ApiResponse<void>>

  @Post(':taskId/cancel')
  @Roles('admin', 'operator')
  async cancelTask(@Param('taskId') taskId: string): Promise<ApiResponse<void>>
}
```

<a id="structures-14"></a>

#### ☆ UserAdminController（v2.1 新增 - 用户管理）

```typescript
// src/admin/user-admin.controller.ts

@Controller('api/v1/admin/users')
@UseGuards(AdminJwtGuard, RolesGuard)
@Roles('admin')
export class UserAdminController {

  @Get()
  async listUsers(): Promise<ApiResponse<AdminUserDto[]>>

  @Post()
  async createUser(@Body() dto: CreateUserDto): Promise<ApiResponse<AdminUserDto>>

  @Put(':id')
  async updateUser(@Param('id') id: string, @Body() dto: UpdateUserDto): Promise<ApiResponse<AdminUserDto>>

  @Delete(':id')
  async deleteUser(@Param('id') id: string): Promise<ApiResponse<void>>
}
```

<a id="structures-15"></a>

#### ☆ AuditLogController（v2.1 新增 - 操作日志）

```typescript
// src/admin/audit-log.controller.ts

@Controller('api/v1/admin/audit-logs')
@UseGuards(AdminJwtGuard, RolesGuard)
@Roles('admin')
export class AuditLogController {

  @Get()
  async listLogs(@Query() query: AuditLogQueryDto): Promise<ApiResponse<PaginatedResponse<AuditLogDto>>>
}
```

<a id="structures-16"></a>

#### HealthController

```typescript
// src/health/health.controller.ts

@Controller('health')
export class HealthController {

  @Get('liveness')
  liveness(): { status: 'ok' }

  @Get('readiness')
  async readiness(): Promise<{ status: 'ok' | 'degraded'; checks: HealthCheck[] }>
}
```

---


<a id="structures-17"></a>

### Service 定义清单

| 服务类 | 文件 | 关键方法 |
|--------|------|---------|
| `NacosConfigService` | `config/nacos-config.service.ts` | `getClient()`, `loadJson()`, `subscribe()`, `close()` |
| `TaskService` | `task/task.service.ts` | `createTask()`, `getTask()`, `listTasks()`, `cancelTask()`, `transitionStatus()` |
| `TaskRepository` | `task/task.repository.ts` | `create()`, `findByTaskId()`, `findByStatus()`, `updateStatus()`, `updateWithCondition()` |
| ★ `TaskTimelineService` | `task/task-timeline.service.ts` | `addEvent()`, `getTimeline()`, `getLastEvent()` |
| ★ `TaskTimingService` | `task/task-timing.service.ts` | `recordTiming()`, `calculateDurations()`, `getTiming()` |
| `IdempotencyService` | `task/idempotency.service.ts` | `check()`, `record()`, `cleanup()` |
| `ProviderRegistry` | `provider/provider.registry.ts` | `register()`, `getAdapter()`, `listProviders()` |
| `ProviderFactory` | `provider/provider.factory.ts` | `getAdapterForModel()`, `getAdapterByName()` |
| ★ `ModelRouterService` | `provider/model-router.service.ts` | `resolve()`, `refreshCache()`, `onRouteChanged()` (热切换) |
| `ProviderConfigService` | `provider/provider-config.service.ts` | `getConfig()`, `getPollingConfig()`, `getRateLimits()` |
| ★ `QueueRegistryService` | `queue/queue-registry.service.ts` | `register()`, `has()`, `getQueue()`, `getAllQueues()` |
| ★ `QueueRouterService` | `queue/queue-router.service.ts` | `resolveQueueName()`, `enqueue()` |
| ★ `QueueStatsCollector` | `queue/queue-stats-collector.service.ts` | `collectSnapshots()`, `getStats()`, `getHistory()` |
| `PollingScheduler` | `polling/polling.scheduler.ts` | `handlePolling()` (Cron 入口) |
| `PollingService` | `polling/polling.service.ts` | `pollPendingTasks()`, `pollProviderTasks()`, `handleTimeout()` |
| `PollingIntervalStrategy` | `polling/polling-interval.strategy.ts` | `calculateNextInterval()` |
| `CallbackService` | `callback/callback.service.ts` | `sendCallback()`, `buildPayload()`, `handleDeadLetter()` |
| `CallbackSignatureService` | `callback/callback-signature.service.ts` | `sign()`, `verify()` |
| `CallbackLogRepository` | `callback/callback-log.repository.ts` | `log()`, `findByTaskId()` |
| ★ `StatsService` | `stats/stats.service.ts` | `aggregateDaily()`, `aggregateMonthly()`, `queryDaily()`, `queryMonthly()`, ★ `getAllTimeStats()`, `getTodayRealtimeStats()` |
| ★ `StatsAggregationScheduler` | `stats/stats-aggregation.scheduler.ts` | `aggregateDailyStats()`, `aggregateMonthlyStats()` |
| ★ `StatsCompareService` | `stats/stats-compare.service.ts` | `compareProviders()` |
| ★ `RouteAdminService` | `admin/route-admin.service.ts` | `switchProvider()`, `rollback()`, `getHistory()` |
| ★ `QueueAdminService` | `admin/queue-admin.service.ts` | `registerQueue()`, `removeQueue()`, `getQueueStats()` |
| ☆ `AuthAdminService` | `admin/auth-admin.service.ts` | `login()`, `refresh()`, `validateUser()`, `generateTokens()` |
| ☆ `DashboardOverviewService` | `admin/dashboard-overview.service.ts` | `getOverview()`, `getTrends()` |
| ☆ `TaskAdminService` | `admin/task-admin.service.ts` | `listTasks()`, `getTask()`, `replayCallback()`, `cancelTask()` |
| ☆ `UserAdminService` | `admin/user-admin.service.ts` | `list()`, `create()`, `update()`, `delete()`, `findByUsername()` |
| ☆ `AuditLogService` | `admin/audit-log.service.ts` | `log()`, `list()`, `findByAction()` |
| `RedisLockService` | `redis/redis-lock.service.ts` | `acquire()`, `release()`, `extend()` |
| ★ `RedisPubSubService` | `redis/redis-pubsub.service.ts` | `publish()`, `subscribe()`, `onRouteChanged()` |
| `RateLimiterService` | `redis/rate-limiter.service.ts` | `getLimiter()`, `acquire()`, `release()` |
| `LoggerService` | `observability/logger/logger.service.ts` | `info()`, `warn()`, `error()` (结构化) |
| `MetricsService` | `observability/metrics/metrics.service.ts` | `incTaskCreated()`, `observeTaskDuration()`, `updateQueueDepth()` 等 |

---


<a id="structures-18"></a>

### DTO 定义清单

<a id="structures-19"></a>

#### CreateTaskDto

```typescript
// src/task/dto/create-task.dto.ts
import { IsString, IsNotEmpty, IsUrl, IsOptional, IsObject, IsInt, Min, Max, MaxLength } from 'class-validator';

export class CreateTaskDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  model: string;

  @IsObject()
  input: Record<string, any>;

  @IsOptional()
  @IsObject()
  options?: Record<string, any>;

  @IsUrl({ protocols: ['https'] })
  @MaxLength(500)
  callbackUrl: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  callbackSecret?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  priority?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  bizId?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
```

<a id="structures-20"></a>

#### TaskListQueryDto

```typescript
// src/task/dto/task-list-query.dto.ts
export class TaskListQueryDto {
  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @IsString()
  sortBy?: string = 'createdAt';

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}
```

<a id="structures-21"></a>

#### TaskResponseDto

```typescript
// src/task/dto/task-response.dto.ts
export class TaskResponseDto {
  taskId: string;
  status: TaskStatus;
  model: string;
  provider: string;
  featureType: FeatureType;      // ★
  result?: any;
  error?: {
    code: string;
    message: string;
  };
  callbackStatus?: CallbackStatus;
  timing?: TaskTimingResponseDto; // ★
  createdAt: Date;
  metadata?: Record<string, any>;
}
```

<a id="structures-22"></a>

#### ★ FeatureType 枚举（v2.0 新增）

```typescript
// src/task/enums/feature-type.enum.ts
export enum FeatureType {
  IMAGE_GENERATE = 'image_generate',
  IMAGE_TO_VIDEO = 'image_to_video',
  CHARACTER_SWAP = 'character_swap',
  VIDEO_UPSCALE  = 'video_upscale',
}
```

<a id="structures-23"></a>

#### ★ TimelineEvent 枚举（v2.0 新增）

```typescript
// src/task/enums/timeline-event.enum.ts
export enum TimelineEvent {
  TASK_CREATED         = 'TASK_CREATED',
  ROUTE_RESOLVED       = 'ROUTE_RESOLVED',
  TASK_ENQUEUED        = 'TASK_ENQUEUED',
  TASK_DEQUEUED        = 'TASK_DEQUEUED',
  PROVIDER_SUBMIT_START = 'PROVIDER_SUBMIT_START',
  PROVIDER_SUBMIT_OK   = 'PROVIDER_SUBMIT_OK',
  PROVIDER_SUBMIT_FAIL = 'PROVIDER_SUBMIT_FAIL',
  POLL_START           = 'POLL_START',
  POLL_RESULT          = 'POLL_RESULT',
  PROVIDER_COMPLETED   = 'PROVIDER_COMPLETED',
  PROVIDER_FAILED      = 'PROVIDER_FAILED',
  TASK_SUCCESS         = 'TASK_SUCCESS',
  TASK_FAILED          = 'TASK_FAILED',
  TASK_TIMEOUT         = 'TASK_TIMEOUT',
  TASK_CANCELLED       = 'TASK_CANCELLED',
  CALLBACK_SEND        = 'CALLBACK_SEND',
  CALLBACK_OK          = 'CALLBACK_OK',
  CALLBACK_FAIL        = 'CALLBACK_FAIL',
  CALLBACK_DEAD_LETTER = 'CALLBACK_DEAD_LETTER',
  RETRY_ENQUEUED       = 'RETRY_ENQUEUED',
}
```

<a id="structures-24"></a>

#### ★ TaskTimingResponseDto（v2.0 新增）

```typescript
// src/task/dto/task-timing-response.dto.ts
export class TaskTimingResponseDto {
  receivedAt: Date;
  enqueuedAt: Date;
  dequeuedAt?: Date;
  submittedAt?: Date;
  providerCompletedAt?: Date;
  completedAt?: Date;
  callbackSentAt?: Date;
  queueWaitMs?: number;
  providerProcessMs?: number;
  totalE2eMs?: number;
  callbackDelayMs?: number;
}
```

<a id="structures-25"></a>

#### ★ SwitchProviderDto（v2.0 新增 - 路由切换）

```typescript
// src/admin/dto/switch-provider.dto.ts
export class SwitchProviderDto {
  @IsString() fromProvider: string;
  @IsString() toProvider: string;
  @IsString() toProviderModel: string;
  @IsInt() @Min(0) @Max(100) weight: number;
  @IsString() reason: string;
}
```

---


<a id="structures-26"></a>

### Mongoose Schema 定义

<a id="structures-27"></a>

#### Task Schema（★ v2.0 增强：timing + timeline + featureType + routeId）

```typescript
// src/task/schemas/task.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { TaskStatus } from '../enums/task-status.enum';
import { CallbackStatus } from '../enums/callback-status.enum';
import { FeatureType } from '../enums/feature-type.enum';

@Schema({ timestamps: true, collection: 'tasks' })
export class Task extends Document {

  @Prop({ required: true, unique: true, index: true })
  taskId: string;

  @Prop({ required: true, index: true })
  tenantId: string;

  @Prop({ sparse: true })
  bizId?: string;

  @Prop({ required: true })
  model: string;

  @Prop({ required: true })
  provider: string;

  @Prop()
  providerModel?: string;

  @Prop({ required: true, enum: FeatureType, index: true })
  featureType: FeatureType;               // ★ 功能类型

  @Prop()
  scene?: string;

  @Prop()
  routeId?: string;                       // ★ 命中的路由策略 ID

  @Prop({ required: true, enum: TaskStatus, default: TaskStatus.PENDING, index: true })
  status: TaskStatus;

  @Prop({ default: 0 })
  version: number;

  @Prop({ type: Object })
  providerTask: {
    providerTaskId?: string;
    requestId?: string;
    rawMeta?: Record<string, any>;
  };

  @Prop({ type: Object })
  requestPayload: Record<string, any>;

  @Prop({ type: Object })
  resultPayload?: Record<string, any>;

  @Prop({ type: Object })
  error?: {
    code: string;
    message: string;
    providerCode?: string;
    providerMessage?: string;
    retryable: boolean;
  };

  @Prop({ type: Object })
  callback: {
    url: string;
    secret?: string;
    status: CallbackStatus;
    retryCount: number;
    nextRetryAt?: Date;
    lastAttemptAt?: Date;
    lastError?: string;
  };

  @Prop({ type: Object })
  polling: {
    nextPollAt?: Date;
    pollCount: number;
    lastPolledAt?: Date;
    pollInterval: number;
    maxPollCount: number;
    maxDuration: number;
  };

  // ★ 时长精确跟踪（v2.0 新增）
  @Prop({ type: Object })
  timing: {
    receivedAt: Date;
    enqueuedAt: Date;
    dequeuedAt?: Date;
    submittedAt?: Date;
    providerStartedAt?: Date;
    providerCompletedAt?: Date;
    completedAt?: Date;
    callbackSentAt?: Date;
    queueWaitMs?: number;
    providerProcessMs?: number;
    totalE2eMs?: number;
    callbackDelayMs?: number;
  };

  // ★ 任务处理时间线（v2.0 新增）
  @Prop({ type: [Object], default: [] })
  timeline: Array<{
    event: string;
    timestamp: Date;
    detail?: Record<string, any>;
    durationFromPrev?: number;
  }>;

  @Prop({ default: 50 })
  priority: number;

  @Prop({ type: Object })
  metadata?: Record<string, any>;
}

export const TaskSchema = SchemaFactory.createForClass(Task);

TaskSchema.index({ status: 1, 'polling.nextPollAt': 1 });
TaskSchema.index({ tenantId: 1, createdAt: -1 });
TaskSchema.index({ provider: 1, 'providerTask.providerTaskId': 1 });
TaskSchema.index({ 'callback.status': 1, 'callback.nextRetryAt': 1 });
TaskSchema.index({ tenantId: 1, bizId: 1 }, { unique: true, sparse: true });
// ★ v2.0 新增索引
TaskSchema.index({ featureType: 1, status: 1, createdAt: -1 });
TaskSchema.index({ provider: 1, featureType: 1, status: 1, createdAt: -1 });
TaskSchema.index({ createdAt: -1, featureType: 1, provider: 1, model: 1 });
```

<a id="structures-28"></a>

#### Idempotency Schema

```typescript
// src/task/schemas/idempotency.schema.ts
@Schema({ timestamps: true, collection: 'idempotency_records' })
export class IdempotencyRecord extends Document {

  @Prop({ required: true })
  tenantId: string;

  @Prop({ required: true })
  idempotencyKey: string;

  @Prop({ required: true })
  taskId: string;

  @Prop({ required: true })
  expireAt: Date;
}

export const IdempotencySchema = SchemaFactory.createForClass(IdempotencyRecord);

IdempotencySchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true });
IdempotencySchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });
```

<a id="structures-29"></a>

#### CallbackLog Schema

```typescript
// src/callback/schemas/callback-log.schema.ts
@Schema({ timestamps: true, collection: 'callback_logs' })
export class CallbackLog extends Document {

  @Prop({ required: true, index: true })
  taskId: string;

  @Prop({ required: true })
  callbackUrl: string;

  @Prop({ required: true })
  attempt: number;

  @Prop({ type: Object })
  requestHeaders: Record<string, string>;

  @Prop({ type: Object })
  requestBody: Record<string, any>;

  @Prop()
  responseCode?: number;

  @Prop({ maxlength: 1024 })
  responseBody?: string;

  @Prop({ required: true })
  success: boolean;

  @Prop()
  error?: string;

  @Prop()
  latencyMs: number;
}

export const CallbackLogSchema = SchemaFactory.createForClass(CallbackLog);

CallbackLogSchema.index({ taskId: 1, attempt: 1 });
CallbackLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 }); // 30 天 TTL
```

<a id="structures-30"></a>

#### ★ ModelRoute Schema（v2.0 新增 - 路由配置）

```typescript
// src/provider/schemas/model-route.schema.ts
@Schema({ timestamps: true, collection: 'model_routes' })
export class ModelRoute extends Document {

  @Prop({ required: true, unique: true })
  routeId: string;

  @Prop({ required: true })
  featureType: string;

  @Prop({ required: true, index: true })
  model: string;

  @Prop({ type: [Object], required: true })
  activeRules: Array<{
    provider: string;
    providerModel: string;
    weight: number;
    enabled: boolean;
    conditions?: { tenantIds?: string[]; scenes?: string[] };
  }>;

  @Prop({ required: true })
  defaultProvider: string;

  @Prop({ required: true })
  defaultProviderModel: string;

  @Prop({ type: [Object], default: [] })
  switchHistory: Array<{
    fromProvider: string;
    toProvider: string;
    reason: string;
    operator: string;
    timestamp: Date;
  }>;

  @Prop({ default: true })
  enabled: boolean;
}

export const ModelRouteSchema = SchemaFactory.createForClass(ModelRoute);
ModelRouteSchema.index({ routeId: 1 }, { unique: true });
ModelRouteSchema.index({ model: 1 });
ModelRouteSchema.index({ featureType: 1 });
```

<a id="structures-31"></a>

#### ★ QueueSnapshot Schema（v2.0 新增 - 队列快照）

```typescript
// src/queue/schemas/queue-snapshot.schema.ts
@Schema({ timestamps: true, collection: 'queue_snapshots' })
export class QueueSnapshot extends Document {

  @Prop({ required: true })
  queueName: string;

  @Prop({ required: true })
  featureType: string;

  @Prop()
  provider?: string;

  @Prop({ required: true })
  waiting: number;

  @Prop({ required: true })
  active: number;

  @Prop({ required: true })
  completed: number;

  @Prop({ required: true })
  failed: number;

  @Prop({ required: true })
  delayed: number;

  @Prop({ default: 0 })
  paused: number;

  @Prop({ required: true })
  depth: number;

  @Prop({ default: 0 })
  throughputPerMin: number;
}

export const QueueSnapshotSchema = SchemaFactory.createForClass(QueueSnapshot);
QueueSnapshotSchema.index({ queueName: 1, createdAt: -1 });
QueueSnapshotSchema.index({ createdAt: 1 }, { expireAfterSeconds: 604800 }); // 7 天 TTL
```

<a id="structures-32"></a>

#### ★ TaskDailyStats Schema（v2.0 新增 - 每日聚合统计）

```typescript
// src/stats/schemas/task-daily-stats.schema.ts
@Schema({ timestamps: true, collection: 'task_daily_stats' })
export class TaskDailyStats extends Document {

  @Prop({ required: true })
  date: string;                // "2026-04-04"

  @Prop({ required: true })
  featureType: string;

  @Prop({ required: true })
  provider: string;

  @Prop({ required: true })
  model: string;

  @Prop({ default: 0 }) totalCount: number;
  @Prop({ default: 0 }) successCount: number;
  @Prop({ default: 0 }) failedCount: number;
  @Prop({ default: 0 }) timeoutCount: number;
  @Prop({ default: 0 }) cancelledCount: number;

  @Prop({ default: 0 }) avgQueueWaitMs: number;
  @Prop({ default: 0 }) avgProviderProcessMs: number;
  @Prop({ default: 0 }) avgTotalE2eMs: number;
  @Prop({ default: 0 }) p50E2eMs: number;
  @Prop({ default: 0 }) p95E2eMs: number;
  @Prop({ default: 0 }) p99E2eMs: number;
  @Prop({ default: 0 }) maxE2eMs: number;

  @Prop({ default: 0 }) callbackSuccessCount: number;
  @Prop({ default: 0 }) callbackFailedCount: number;
}

export const TaskDailyStatsSchema = SchemaFactory.createForClass(TaskDailyStats);
TaskDailyStatsSchema.index(
  { date: 1, featureType: 1, provider: 1, model: 1 },
  { unique: true },
);
TaskDailyStatsSchema.index({ date: -1 });
```

<a id="structures-33"></a>

#### ★ TaskMonthlyStats Schema（v2.0 新增 - 每月聚合统计）

```typescript
// src/stats/schemas/task-monthly-stats.schema.ts
// 结构与 TaskDailyStats 相同，date → month ("2026-04")
@Schema({ timestamps: true, collection: 'task_monthly_stats' })
export class TaskMonthlyStats extends Document {
  @Prop({ required: true }) month: string;
  @Prop({ required: true }) featureType: string;
  @Prop({ required: true }) provider: string;
  @Prop({ required: true }) model: string;
  // ... 与 DailyStats 相同的统计字段 ...
}

export const TaskMonthlyStatsSchema = SchemaFactory.createForClass(TaskMonthlyStats);
TaskMonthlyStatsSchema.index(
  { month: 1, featureType: 1, provider: 1, model: 1 },
  { unique: true },
);
```

---


<a id="structures-34"></a>

### Guard & Interceptor 清单

| 类型 | 名称 | 文件 | 用途 |
|------|------|------|------|
| Guard | `ApiKeyGuard` | `auth/guards/api-key.guard.ts` | 校验 X-API-Key |
| Guard | `ServiceTokenGuard` | `auth/guards/service-token.guard.ts` | 内部服务鉴权 |
| Guard | `JwtGuard` | `auth/guards/jwt.guard.ts` | JWT Bearer 鉴权 |
| Guard | `TenantRateLimitGuard` | `auth/guards/tenant-rate-limit.guard.ts` | 租户限流 |
| Interceptor | `LoggingInterceptor` | `observability/interceptors/logging.interceptor.ts` | 请求/响应日志 |
| Interceptor | `TraceIdInterceptor` | `observability/interceptors/trace-id.interceptor.ts` | 注入 traceId |
| ★ Interceptor | `TimingInterceptor` | `observability/interceptors/timing.interceptor.ts` | 请求到达时间点采集 |
| Interceptor | `ResponseTransformInterceptor` | `common/interceptors/response-transform.interceptor.ts` | 统一响应格式 |
| Filter | `GlobalExceptionFilter` | `common/filters/global-exception.filter.ts` | 全局异常处理 |
| Pipe | `ValidationPipe` | `common/pipes/validation.pipe.ts` | 全局参数校验 |
| ☆ Guard | `AdminJwtGuard` | `admin/guards/admin-jwt.guard.ts` | 管理后台 JWT 鉴权 |
| ☆ Guard | `RolesGuard` | `admin/guards/roles.guard.ts` | RBAC 角色校验 |
| Decorator | `@Tenant()` | `auth/decorators/tenant.decorator.ts` | 提取当前租户 |
| Decorator | `@IdempotencyKey()` | `common/decorators/idempotency-key.decorator.ts` | 提取幂等键 |
| ☆ Decorator | `@Roles()` | `admin/decorators/roles.decorator.ts` | 指定接口所需角色 |

---


<a id="deployment"></a>

## 配置、部署与数据库迁移


本文维护配置合同与操作流程，不记录按日期追加的环境状态、账号、预算和验收统计。初次安装及 PM2 命令见 [项目 README](../README.md)。

<a id="deployment-1"></a>

### 运行前提

API、Worker、Scheduler、管理端须连接同一目标 MongoDB/Redis。资金写入要求支持会话的副本集或分片集群；部署前以 hello、只读事务和 `/health/readiness` 检查实际能力。FFprobe、FFmpeg、字体和对象存储应满足相应业务需求。

本机访问 Atlas 如需经过已有 SOCKS5 代理，可在本地 `mongodb.uri` 的查询参数中追加 `proxyHost=127.0.0.1&proxyPort=7890`，MongoDB 驱动使用项目的 `socks` 运行时依赖连接。代理须保持在线，TLS 证书校验继续开启；仅在实际需要代理的环境配置这些参数，并重启使用该配置的 API、Worker、Scheduler 和管理端。代理参数不改变原数据库、账号和认证选项。

启动阶段的数据库查询或模块初始化失败时，启动入口记录异常并以退出码 1 退出，由 PM2 等进程管理器重新拉起，避免未监听端口的进程因残留连接而一直显示 online。服务可用性仍以实际端口及 readiness 为准；运行中的后台刷新遇到数据库波动时记录警告并保留已有快照。

同名数据库不代表同一份数据。模型、供应商、账号、用户、钱包、作品和预算要核对归属；项目缺失不能视为零消费。模型每千 Token/字符价格先除以 1000，实际报价须在明确预算内。构建成功不证明运行进程已经加载，也不证明外部 OAuth、通知或模型已验收。

切换或发布前检查活动任务、Redis 队列和数据库一致性；在安全窗口更新进程。保留旧前端 hash 资源与可回退版本，不能以清空活动目录完成发布。回填/迁移快照和私有配置单独保留。


<a id="deployment-2"></a>

### 素材存储

`workflowAssetStorage.provider` 明确选择存储，`S3WorkflowAssetStorageService` 复用 S3 客户端并使用 pathStyle。配置来自唯一后端源：Nacos 开启时读取完整 Nacos JSON，否则读取 `config/<NODE_ENV>.json`。示例不会自动加载。

| provider | 生效配置 | 说明 |
| --- | --- | --- |
| storagesvc 或整段缺省 | 原链接转换存储配置 | 保持兼容 |
| minio | workflowAssetStorage.minio | MinIO / S3 兼容服务 |
| datacapsule | workflowAssetStorage.datacapsule | 中国科技云数据胶囊 |
| qiniu | workflowAssetStorage.qiniu | 七牛 S3 接口 |

只读取并校验选中节点，未知 provider 报错，上传失败不自动回退。真实凭据放在私有配置或 Nacos；旧 WORKFLOW_ASSET_MINIO_* / WORKFLOW_ASSET_DATACAPSULE_* 环境变量不再读取。

<a id="deployment-3"></a>

#### 通用配置与行为

| 字段 | 含义 |
| --- | --- |
| endPoint | 上传主机名，不含协议、端口或路径 |
| port / useSSL | 与实际 endpoint 一致，生产使用 HTTPS |
| bucket / region | 服务商提供的 S3 bucket 标识及区域；region 缺省时由 SDK 探测 |
| accessKeyId / secretAccessKey | 当前 provider 的服务端凭据 |
| publicBaseUrl | 稳定文件读取根地址，包含实际所需的 bucket 路径 |
| pathPrefix | 应用命名空间，默认 modelhub；旧默认 workflow-assets 自动升级为 modelhub，自定义值统一限制在 modelhub/ 下 |
| uploadTimeoutMs | 上传总超时，默认 60000 毫秒 |
| allowInsecureHttp | HTTP 配置需要显式允许；生产应配置有效 HTTPS 域名与证书 |

S3 对象键统一为 `modelhub/{功能}/{用途}/{媒体类型}/{owner SHA-256}/{UUID}.{扩展名}`。bucket 是存储空间，`modelhub/` 是空间内部的项目目录；即使 bucket 名为 modelhub，对象键仍保留项目目录。路径集中定义在 `src/common/storage/asset-storage-path.ts`，新增功能在 `ASSET_STORAGE_PATHS` 注册用途，由服务端选择，调用方不传任意目录。

| 功能 / 用途 | 对象目录 | source |
| --- | --- | --- |
| 工作流素材上传 | modelhub/workflow/uploads/ | upload |
| 工作流文本、JSON 输出保存 | modelhub/workflow/outputs/ | output-text |
| 短剧素材上传 | modelhub/short-drama/uploads/ | drama-upload |
| 短剧模型结果归档 | modelhub/short-drama/archives/ | drama-archive |
| 短剧成片导出 | modelhub/short-drama/renders/ | drama-render |

每个用途下再按 `image`、`video`、`audio`、`text` 分层，JSON 归入 text。例如 `modelhub/short-drama/renders/video/{owner哈希}/{UUID}.mp4`。保留原始 owner 标识在数据库中做所有权校验，不放入对象路径。UUID 避免同名文件覆盖。自定义 `pathPrefix=team-a` 或 `modelhub/team-a` 均生成 `modelhub/team-a/{功能}/...`；路径片段不允许绝对路径、空段、反斜杠或路径穿越。旧默认 `workflow-assets` 显式配置和缺省配置均使用新目录，避免升级代码后继续写入桶根目录的旧目录。

`POST /v1/workflow-assets` 的 multipart 文件字段仍为 `file`，可选字段 `feature` 仅接受 `workflow`（缺省）或 `short-drama`。短剧门户显式传 short-drama；归档与成片用途只能由后端指定。媒体输出引用（output-reference）沿用供应商 URL，不重复上传，因此不生成对象键。

publicBaseUrl 后追加完整对象键，不自动追加 bucket，也不能把对象目录重复填入 publicBaseUrl。上传 endpoint 与下载域名可以不同；填写 URL 不改变 bucket 策略。素材限制沿用平台 20 MiB，存储成功才写元数据，失败不落成功记录；响应和日志不回显密钥。元数据保存失败的日志使用同一套路径生成规则定位实际对象。

storagesvc 兼容适配器和第三方链接转换仍由外部存储网关生成对象键；当前 SDK 的签名与分片接口没有自定义对象键/前缀字段，不能依靠本地路径配置保证网关的物理目录。需要上述目录约束的素材上传应选择 minio、datacapsule 或 qiniu；网关端统一目录需另行在网关配置或接口中支持。

持久化的是稳定 URL，适合可被目标模型读取的原始文件地址。网页分享页、提取码页面和短期预签名链接不能直接当永久素材地址。私有对象需另行设计受控下载代理或签名生命周期。新目录规则与切换后端均只影响新上传，历史对象与数据库中已保存的 URL 继续有效；读取时不重算路径。历史文件如需整理，须先复制到新键、核验内容与可读性，再更新所有引用并保留旧键兼容，不能直接移动或按字符串批量替换 URL。删除素材记录也不自动删远程对象。

旧 `workflow-assets/` 同步迁移工具为 `scripts/migrate-workflow-assets.cjs`，复用当前运行环境的本地或 Nacos 配置，仅处理选中的 S3 provider 和数据库。先运行 `node scripts/migrate-workflow-assets.cjs plan <run>` 生成只读清单，再运行 `apply <run>` 执行，最后运行 `verify <run>` 独立复核。重复使用同一 run 可从已校验的副本继续；遇到并发引用编辑会停止，避免覆盖业务修改。

工具从素材 source 和短剧候选记录恢复功能用途：归档、成片、短剧上传及工作流输出分别归类；无素材记录且无候选引用的孤立文件保守归入 workflow/uploads。复制前核对源 ETag/大小，目标存在时只核验不覆盖；源与目标的 SHA-256、MIME、大小以及公开 URL 读取全部通过后，才用字段级比较更新同步数据库内嵌对象、数组和 JSON 字符串中的已知资源 URL。只替换当前文件域名与完整对象键对应的 URL，不改其他域名或相似文件名。备份集合和无资源 URL 的队列统计不参与引用更新，旧对象全部保留。

清单与校验报告位于私有的 `config/migration-backups/workflow-assets_<run>/`。引用修改前值保存在 AES-256-GCM 加密文件，密钥由 Windows 当前用户 DPAPI 保护，不将业务文档或连接凭据输出到控制台。迁移期间若旧进程继续创建根目录文件，报告会显示新增旧文件数；应应用新目录规则后重新生成增量迁移清单。迁移不会触发模型生成、计费或删除远程文件。

<a id="deployment-4"></a>

#### 各服务配置

MinIO 使用当前 minio 节点的 endpoint、bucket 和凭据；部署者预先准备 bucket 与最小权限，应用不自动公开 bucket、不清理历史对象。

数据胶囊从数据集的 S3 设置取得真实 endpoint、bucket 与访问密钥。公开分享链接不等于 S3 原始文件地址。参考 [配置示例](#deployment)，文件也演示独立 MinIO 节点；未选中的占位配置不参与运行校验。

七牛上传需使用区域 S3 服务域名，例如 `s3.cn-east-1.qiniucs.com` 与 `cn-east-1`；bucket 使用控制台 S3 空间名，可能不同于普通空间显示名称。publicBaseUrl 填绑定的文件域名，不能填要求 AWS 签名的 S3 endpoint。参考 [七牛配置](#deployment)。正式使用自己的 HTTPS 域名，避免依赖有有效期的测试域名。

<a id="deployment-5"></a>

#### 切换与验收

1. 核对目标服务配置、最小权限、bucket 和 HTTPS 文件域名；保留其余后端配置。
2. 修改 provider 后重启受影响进程，检查 readiness 和公开模型列表。
3. 上传非敏感测试文件，核对实际对象、元数据、所有权、原始字节和 MIME。
4. 验证匿名/预期授权读取、HTTPS 门户预览及供应商网络取源。HTTP 下载成功不证明 HTTPS、浏览器或模型可用。
5. 回退时恢复原 provider，保留已有对象；新旧存储间迁移单独预览和备份，不用全量覆盖。

`Invalid workflowAssetStorage.<provider>.*` 属于选中节点配置校验，不等于已连通存储。HTTPS 证书失败应修复证书或使用有效域名，不能用关闭 TLS 校验掩盖。

如果错误字段是 `qiniu.allowInsecureHttp`，分别检查上传的 `useSSL` 和读取的 `publicBaseUrl`。即使上传 `useSSL=true`，读取地址为 `http://` 仍需要显式许可。正式环境应将读取域名证书更新为有效证书，再配置 HTTPS 地址；经确认允许 HTTP 的可信测试环境，可以在选中的 `qiniu` 节点设置布尔值 `allowInsecureHttp: true`，这不会关闭 HTTPS 证书校验，也不会把公开读取地址升级为 HTTPS。修复配置前可暂停反复启动失败的 PM2 后端进程，门户进程可继续保留；恢复消费者前应核对遗留待执行任务，避免自动重放。

回归入口：`src/workflow/__tests__/minio-workflow-asset-storage.service.spec.ts`（历史文件名，测试当前 S3 服务）和 `workflow-asset.service.spec.ts`。历史七牛上传曾通过 HTTP 读取，但 HTTPS 403/证书异常曾阻塞，当前状态需重新检查。


<a id="deployment-6"></a>

### 门户认证配置

配置示例见 [认证配置](#deployment)，发布前检查见 [运行前提](#deployment)。

<a id="deployment-7"></a>

#### 恢复第三方登录：配置清单

以下是配置所需的最小清单；两种登录可独立配置。配置是否存在、网络是否可达与完整登录是否成功需要分别检查。

| 需要准备 | 获取位置 / 本地填写值 |
| --- | --- |
| Google Client ID、Client Secret | Google Auth Platform 创建 **Web application** OAuth 客户端 |
| GitHub Client ID、Client Secret | GitHub → Settings → Developer settings → OAuth Apps，创建应用并生成 Client Secret |
| 门户地址 `publicUrl` | 本地填写 `http://localhost:7004` |
| 会话签名密钥 `jwtSecret` | 优先沿用已有有效密钥；没有时生成至少 32 字节的随机密钥，持久保存并供所有 API 副本共用 |

平台控制台需要登记以下完整地址：

| 控制台字段 | 本地填写值 |
| --- | --- |
| Google → Authorized redirect URIs | `http://localhost:7004/api/v1/auth/oauth/google/callback` |
| GitHub → Homepage URL | `http://localhost:7004` |
| GitHub → Authorization callback URL | `http://localhost:7004/api/v1/auth/oauth/github/callback` |

`7004` 是用户门户；`7003` 是管理后台，`7000` 是内部 API。回调地址使用门户地址。`localhost` 与 `127.0.0.1` 是不同 origin，浏览器访问地址、`publicUrl` 和控制台回调地址必须匹配。生产环境替换为实际 HTTPS 门户域名。

将下面节点合并到 `config/development.json` 根节点，保留原有 MongoDB、Redis 等配置。占位文字必须替换为真实值后才能启用；只配置一个提供方时，另一个的两个字段留空。

```json
{
  "portalAuth": {
    "publicUrl": "http://localhost:7004",
    "jwtSecret": "<已有有效密钥或新生成的至少32字节随机密钥>",
    "accessTokenExpires": "15m",
    "refreshTokenExpiresDays": 7,
    "google": {
      "clientId": "<Google Client ID>",
      "clientSecret": "<Google Client Secret>"
    },
    "github": {
      "clientId": "<GitHub Client ID>",
      "clientSecret": "<GitHub Client Secret>"
    }
  }
}
```

`accessTokenExpires`、`refreshTokenExpiresDays` 可省略，默认分别为 `15m`、`7`。开发环境未配置 `jwtSecret` 时会生成临时密钥，重启后旧 access token 失效，因此建议持久配置。更换已有密钥也会让旧 access token 失效。

配置仅存于后端，不放入前端 `VITE_*`。无需 Google/GitHub 用户密码、GitHub Personal Access Token 或 MaaS Key。SMTP 是邮箱注册/找回密码验证码的独立配置，本清单无需填写。

如果以后启用 Nacos，将同一 `portalAuth` 节点放到 `.env` 指定的 Data ID / Group / Namespace 对应完整 JSON 中；Nacos 模式不会合并本地文件。若配置中心读取返回 403，先检查配置读取权限。

填写后执行 `pm2 restart model-hub-api`，再运行：

```powershell
Invoke-RestMethod 'http://localhost:7004/api/v1/auth/providers'
```

已配置的提供方应在响应 `data` 中为 `true`；没有 SMTP 时 `email` 可以仍为 `false`。随后在门户分别完成一次真实授权并刷新页面，确认会话恢复。入口启用仅说明配置完整，真实授权成功才完成登录验收。

创建客户端的官方说明：[Google Web Server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)、[GitHub 创建 OAuth App](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app)。

<a id="deployment-8"></a>

#### 已实现的流程

- 邮箱：发送 6 位验证码，填写用户名、邮箱、密码和验证码，同意条款后注册并登录。验证码成功使用后立即失效。
- 邮箱密码登录：沿用现有 access token + HttpOnly refresh cookie，会话可在刷新页面后恢复。原有邮箱密码账号仍可登录。
- 找回密码：邮箱验证码校验后更新密码、递增认证版本，撤销旧 refresh token；现有 access token 保持原有到期语义（默认最多 15 分钟）。仅邮箱密码账号可找回密码。
- Google / GitHub：授权码 + PKCE（S256），一次性 state 存入 Redis，并通过 HttpOnly、SameSite=Lax cookie 绑定发起浏览器。首次登录自动创建普通用户，再次登录按提供方用户 ID 匹配。
- Google 必须返回已验证邮箱；GitHub 从 `/user/emails` 获取已验证邮箱，优先主邮箱，支持隐藏邮箱。
- 同邮箱不同登录方式不自动关联。发生冲突时，使用原登录方式登录，在个人中心的「登录方式」点击 Google / GitHub「关联账号」，选择与本站邮箱一致的第三方账号授权；成功后即可直接用该方式登录原账号。无需重复注册，不提供解绑或覆盖其他已关联身份。
- 关联入口为 `POST /api/v1/auth/oauth/:provider/link`，要求有效本站 access token 和 CSRF 校验。目标用户 ID 与认证版本只存入十分钟有效、一次性且绑定浏览器的 Redis OAuth state，回调校验账号状态、认证版本、邮箱和提供方身份唯一性；相同邮箱本身不构成关联凭证。
- OAuth 提供方 token 不保存到用户表、浏览器或 URL。回调仅设置本站会话 cookie，再跳到 `/auth/callback` 恢复会话。
- 邮箱验证码有效期 10 分钟；每个邮箱、用途 60 秒内只能申请一次；每邮箱每小时最多 10 次、每 IP 每小时最多 30 次；单个验证码最多允许 5 次错误尝试。注册和重置密码的验证码不能混用。Redis 不可用时拒绝验证码/OAuth 操作。
- 未配置的 Google/GitHub 登录入口显示为不可用；SMTP 未配置时邮件发送返回服务不可用，不会跳过邮箱验证。

<a id="deployment-9"></a>

#### 配置文件

认证配置统一位于 **`APP_CONFIG.portalAuth`**，与项目已有配置加载方式一致：

- `NACOS_ENABLE=false`：读取 `config/${NODE_ENV}.json`，如 `config/development.json`。
- `NACOS_ENABLE=true`：读取 Nacos 对应 Data ID 的完整 JSON，在根节点加入 `portalAuth`；此时本地配置文件不参与合并。
- 认证逻辑不再读取旧 `PORTAL_*` 环境变量，也不读取通知模块的 SMTP 渠道配置。`.env` 仅保留应用启动、Nacos 连接等已有基础设置。
- 修改配置后重启 API 进程生效；所有 API 副本保持相同配置。

完整无密钥配置示例见 [portal-auth.config.example.json](#deployment)，将其中 `portalAuth` 节点合并到已有应用配置，保留原有 MongoDB、Redis 等节点。实际配置目录 `/config/` 已被 Git 忽略，示例单独保存在 `docs/` 以便随代码交付。

| 配置字段 | 必需性 | 说明 |
| --- | --- | --- |
| `portalAuth.publicUrl` | OAuth 必需 | 门户的浏览器 origin，例如 `https://hub.example.com`；不带路径、query 或 hash。生产必须 HTTPS |
| `portalAuth.jwtSecret` | 生产必需 | 至少 32 字节的随机密钥；所有 API 副本一致，轮换后旧 access token 失效 |
| `portalAuth.accessTokenExpires` | 可选 | 默认 `15m`，允许 `60s` 到 `1d` |
| `portalAuth.refreshTokenExpiresDays` | 可选 | 默认 `7`，允许 1–365 的整数，同时用于 refresh token 和 cookie 有效期 |
| `portalAuth.google.clientId` | Google 必需 | Google Web application 的客户端 ID |
| `portalAuth.google.clientSecret` | Google 必需 | 对应客户端密钥，仅后端保存 |
| `portalAuth.github.clientId` | GitHub 必需 | GitHub OAuth App 的客户端 ID |
| `portalAuth.github.clientSecret` | GitHub 必需 | 对应客户端密钥，仅后端保存 |
| `portalAuth.smtp.host` | 邮件必需 | SMTP 服务器地址 |
| `portalAuth.smtp.port` | 可选 | JSON 数字；默认 `587`（强制 STARTTLS），`465` 使用隐式 TLS |
| `portalAuth.smtp.user` | 邮件必需 | SMTP 用户名 |
| `portalAuth.smtp.pass` | 邮件必需 | SMTP 密码或服务商专用授权码 |
| `portalAuth.smtp.from` | 邮件必需 | 发件人，如 `Model Hub <no-reply@example.com>`，需要服务商允许的发件域名 |

`TRUST_PROXY` 仍沿用服务现有启动环境变量：仅在可信代理后设置正确代理跳数，保证 IP 限流有效，禁止让客户端绕过代理直连 API。

MongoDB 与 Redis 继续使用现有 `APP_CONFIG.mongodb` / `APP_CONFIG.redis`。多副本必须连接同一个 MongoDB 和 Redis。MongoDB 用户需要创建索引权限，以创建 `googleId`、`githubId` 的稀疏唯一索引；它们是新增可选字段，现有用户不需要补密码或第三方 ID。

配置模板同时补充在本地 `config/nacos-config-template.json`。密钥仅存于后端配置文件或 Nacos，不写入前端 `VITE_*` 变量。前后端无需新增依赖。

<a id="deployment-10"></a>

#### 本地与生产的路由

浏览器始终在门户 origin 上访问 `/api/v1/auth/*`。Vite 已去掉 `/api` 后转发至后端 `/v1/auth/*`，可在 `portal/.env.local` 设置：

```dotenv
PORT=7004
VITE_API_TARGET=http://localhost:7000
```

本地 `config/development.json` 设置 `portalAuth.publicUrl` 为 `http://localhost:7004`。后端实际端口须与 `VITE_API_TARGET` 一致。不要让 OAuth 直接回调 API 内部端口，否则浏览器 cookie 和门户会话无法对齐。

| 环境 | Google 回调 | GitHub 回调 |
| --- | --- | --- |
| 本地 | `http://localhost:7004/api/v1/auth/oauth/google/callback` | `http://localhost:7004/api/v1/auth/oauth/github/callback` |
| 生产示例 | `https://hub.example.com/api/v1/auth/oauth/google/callback` | `https://hub.example.com/api/v1/auth/oauth/github/callback` |

生产反向代理须将 `/api/` 转发到 API 并去掉 `/api` 前缀；SPA 须支持 `/auth/callback`、`/forgot-password` 深链接回退。门户和 API 使用同一浏览器 origin。不要通过宽松 CORS 或跨站 cookie 替代此拓扑。OAuth 回调 query 含一次性授权码，代理/访问日志应隐藏该路由 query。

<a id="deployment-11"></a>

#### Google 控制台

1. 在 Google Cloud / Google Auth Platform 创建项目，配置应用名称、支持邮箱、授权域名和 OAuth 同意信息。
2. 创建 **Web application** 类型的 OAuth 客户端，取得 Client ID / Client Secret。
3. 在 Authorized redirect URIs 中填入上述完整回调地址，必须与实际 origin、端口、路径一致。
4. 请求范围为 `openid email profile`，不申请离线访问或其他业务权限。
5. 测试状态配置测试用户；面向公众使用时完成对应发布设置及控制台要求。

详见 [Google Web Server OAuth 文档](https://developers.google.com/identity/protocols/oauth2/web-server) 和 [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)。

<a id="deployment-12"></a>

#### GitHub 控制台

1. Settings → Developer settings → OAuth Apps → New OAuth App。
2. Homepage URL 填门户地址；Authorization callback URL 填上述 GitHub 完整回调地址。
3. 创建并安全保存 Client Secret，与 Client ID 一起填入后端 `portalAuth.github`。开发和生产建议分别创建 OAuth App。
4. 请求范围为 `read:user user:email`，不需要仓库权限。用户必须拥有可用的已验证邮箱。

详见 [GitHub OAuth Web Flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps) 和 [GitHub 邮箱接口权限](https://docs.github.com/en/rest/users/emails#list-email-addresses-for-the-authenticated-user)。

<a id="deployment-13"></a>

#### 邮件与上线验收

准备能访问 SMTP 的后端网络、发件域名和授权账号，并按邮件服务商配置 SPF / DKIM / DMARC。注册和找回密码邮件直接发送数字验证码，无须配置邮件跳转域名。

上线前需准备实际服务条款和隐私政策页面（门户现有链接为 `/terms` 与 `/privacy`，本次未编写法律文本）。需要运营方提供可发布的正式内容。

1. 配置完整时，`GET /api/v1/auth/providers` 返回相应入口为 `true`，响应不包含密钥。
2. 验证真实验证码邮件、60 秒重发限制、过期/错误/重复验证码被拒绝，注册成功后可刷新恢复会话。
3. 分别验证 Google/GitHub 新用户、再次登录、用户取消授权、state 失效、相同邮箱冲突和禁用用户。
4. 验证找回密码后新密码可登录、旧密码和旧 refresh token 不再可用。
5. 确认生产 cookie 的 `Secure` / `HttpOnly`、HTTPS、回调地址，以及多个 API 副本间的 OAuth/验证码互通。

真实 OAuth 和邮件验收需要部署方提供凭据；本地自动测试使用模拟提供方和 SMTP，不代表外部配置已经完成。


<a id="deployment-14"></a>

### 数据库迁移与回退

本地配置切换到其他 MongoDB 集群时，先确认数据来源与副本集事务能力。相同的数据库名不代表用户、模型、凭证、钱包和作品相同；不能将项目缺失解释成预算已用 0。

<a id="deployment-15"></a>

#### 完整迁移与回退

迁移工具为 [migrate-modelhub-to-atlas.cjs](../scripts/migrate-modelhub-to-atlas.cjs)。当前实现用于 Windows，源连接取私有配置 `mongodb.uri1`，目标 Atlas 连接取 `mongodb.uri`。不会在日志中打印连接串或业务文档。

1. 暂停 API、管理端、worker 和调度器，盘点数据、索引、遗留任务与资金基线。
2. 使用唯一 RUN 执行 `node scripts/migrate-modelhub-to-atlas.cjs backup RUN`。源库与现有目标库的 BSON 备份采用 AES-256-GCM 加密，密钥由 Windows 当前用户 DPAPI 保护；配置快照也加密保存。
3. 执行 `node scripts/migrate-modelhub-to-atlas.cjs copy RUN`。只向空的独立库 `modelhub_migrated_RUN` 写入，保留 ID、BSON 数值类型及关联；逐集合验证文档数、SHA-256 和非 TTL 索引。
4. 执行 `node scripts/migrate-modelhub-to-atlas.cjs switch RUN`。再次核验源数据与目标副本，最后恢复原 TTL 索引并核验全部索引，仅原子修改当前配置的数据库名。配置存在其他并发修改时拒绝覆盖。
5. 核验当前连接、只读快照事务并中止、用户归属、作品/素材关联、项目预算和迁移前后资金对账。先解决存储等启动前提，再恢复服务；不自动重放旧生成任务。

首次独立库迁移阶段保留原源库和原 Atlas 库。该阶段回退连接时，暂停后端，核对清单中的 `originalTargetDatabase`，只恢复连接中的数据库名；不要覆盖整份配置或删除迁移库。若随后已同步进原 `modelhub`，不能仅切换数据库名来恢复旧内容：须依据同步清单、加密备份和 `__before_sync_RUN_` 备份集合，另行核对并恢复相应集合。发生新业务写入后，先核对增量数据和资金。

备份及清单位于 Git 忽略的 `config/migration-backups/RUN/`，最近迁移状态位于 `config/migration-backups/latest-verification.json`。这些文件与私有配置不属于可随意清理的测试产物。DPAPI 备份需原 Windows 用户解密，跨机器恢复需单独安排密钥导出与保护。

<a id="deployment-16"></a>

#### 同步到指定的现有 modelhub

用户明确要求最终使用已有 `modelhub` 时，使用 [sync-modelhub.cjs](../scripts/sync-modelhub.cjs) 完成已有迁移副本到该库的同步。该工具当前限定源为已核验的 `20261103_03` 迁移副本，目标固定为 `modelhub`，并非任意数据库的覆盖工具。执行前暂停四个后端进程，使用唯一 RUN，例如 `node scripts/sync-modelhub.cjs 20261103_04`。

工具先重新加密备份现有目标数据，在 `modelhub` 内构建 `__sync_RUN_` 临时集合，核验 BSON 和索引后，将原集合改名为 `__before_sync_RUN_` 备份集合，再将临时集合提升为正式名称，最后仅将应用连接的数据库名改回 `modelhub`。全程不自动删除旧库、备份集合或执行业务任务；中断时保留清单与所有副本，先核对已完成阶段再恢复。

同集群的数据复制使用 MongoDB 的 [`$out`](https://www.mongodb.com/docs/manual/reference/operator/aggregation/out/) 写入临时集合，不依赖跨库重命名。集合存在检查在客户端过滤名称，避免 Atlas 对 `listCollections` 操作符的限制。切换集合不是跨集合事务，因此需保持维护暂停；全部正式集合及索引验证完成后才切换连接、进行事务和资金复核。

该次同步的加密备份及清单位于 `config/migration-backups/sync_RUN/`。原目标记录可在相应备份集合或加密备份中查回；不能因为备份集合与业务集合位于同一库，就把二者合并统计为业务账目或用于任务重放。

<a id="deployment-17"></a>

#### TTL 与一致性边界

工具在业务、资金、用户和模型集合上做完整 BSON 一致性检查。只有原有 `queue_snapshots.timestamp` 七天 TTL 遥测集合采用保留期感知的源端变化检查，排除即将正常过期的历史行；备份副本和完整复制仍进行全量 BSON 校验。目标 TTL 在全量数据校验后才启用，过期历史快照随后可能按原策略自然清理。

特殊集合、视图、不受支持的选项、目标库已存在、业务数据漂移或配置并发变化会阻止继续。中断的 RUN 不用于切换，保留其备份供排查，不自动删除或覆盖；使用清单确认已完成的阶段。

源库若为单机，迁移期间需阻止其他业务写入；工具的多次变化检查不等同于跨集合事务快照。迁移保持原有业务状态，不自动修复旧账、退款、重置余额、取消任务或更改价格。媒体数据库记录与 URL 一并复制；外部存储对象和本机媒体文件不因数据库迁移而搬迁。

<a id="deployment-18"></a>

#### 验证入口

- `node --test scripts/migrate-modelhub-to-atlas.test.cjs`：BSON 类型/分帧、损坏备份、配置原子切换前置条件及遥测 TTL 范围。
- `node scripts/inspect-language-readiness.cjs --out output/language-readiness.json`：模型、供应商、只读上游、项目与预算；先准备输出目录。
- `npm run audit:money`：只读资金检查。迁移前后对比发现原有异常时保留记录，不能自动调整资金。
- [运行前提](#deployment)、[存储](#deployment)、[资金与媒体](design.md#platform)。数据库可连接不代表存储、供应商或整个应用已就绪。

<a id="deployment-19"></a>

### 配置示例

以下仅为字段结构，必须按实际服务替换占位值，不能直接作为运行配置。

<a id="deployment-20"></a>

#### 认证

```json
{
  "portalAuth": {
    "publicUrl": "http://localhost:7004",
    "jwtSecret": "REPLACE_WITH_PRIVATE_VALUE",
    "accessTokenExpires": "15m",
    "refreshTokenExpiresDays": 7,
    "google": {
      "clientId": "REPLACE_WITH_PRIVATE_VALUE",
      "clientSecret": "REPLACE_WITH_PRIVATE_VALUE"
    },
    "github": {
      "clientId": "REPLACE_WITH_PRIVATE_VALUE",
      "clientSecret": "REPLACE_WITH_PRIVATE_VALUE"
    },
    "smtp": {
      "host": "",
      "port": 587,
      "user": "REPLACE_WITH_PRIVATE_VALUE",
      "pass": "REPLACE_WITH_PRIVATE_VALUE",
      "from": "Model Hub <no-reply@example.com>"
    }
  }
}
```

<a id="deployment-21"></a>

#### 数据胶囊与 MinIO

```json
{
  "workflowAssetStorage": {
    "provider": "datacapsule",
    "minio": {
      "endPoint": "minio.example.com",
      "port": 443,
      "useSSL": true,
      "bucket": "your-bucket",
      "accessKeyId": "REPLACE_WITH_PRIVATE_VALUE",
      "secretAccessKey": "REPLACE_WITH_PRIVATE_VALUE",
      "publicBaseUrl": "https://assets.example.com",
      "pathPrefix": "modelhub",
      "uploadTimeoutMs": 60000
    },
    "datacapsule": {
      "endPoint": "s3-endpoint.example.com",
      "port": 443,
      "useSSL": true,
      "bucket": "your-bucket",
      "accessKeyId": "REPLACE_WITH_PRIVATE_VALUE",
      "secretAccessKey": "REPLACE_WITH_PRIVATE_VALUE",
      "publicBaseUrl": "https://assets.example.com",
      "pathPrefix": "modelhub",
      "uploadTimeoutMs": 60000
    }
  }
}
```

<a id="deployment-22"></a>

#### 七牛 S3

```json
{
  "workflowAssetStorage": {
    "provider": "qiniu",
    "qiniu": {
      "endPoint": "s3.cn-east-1.qiniucs.com",
      "port": 443,
      "useSSL": true,
      "bucket": "your-bucket",
      "region": "cn-east-1",
      "accessKeyId": "REPLACE_WITH_PRIVATE_VALUE",
      "secretAccessKey": "REPLACE_WITH_PRIVATE_VALUE",
      "publicBaseUrl": "https://assets.example.com",
      "pathPrefix": "modelhub",
      "uploadTimeoutMs": 60000
    }
  }
}
```

<a id="module-registry"></a>

## 模块权限、菜单与审计

以下 AUTO 区域由模块描述符生成，统一列出权限、菜单、审计与设计补充。

<!-- AUTO:overview:START -->
### 仪表盘 (overview)

#### 菜单配置

| 路径 | 标签 | 父级 | 排序 |
|------|------|------|------|
| / | 总览 | overview | 0 |
<!-- AUTO:overview:END -->

<!-- AUTO:user:START -->
### 用户管理 (user)

#### 权限定义

| 资源 | 操作 | 所属模块 |
|------|------|---------|
| user | read, create, update, delete | user-management |

#### 菜单配置

| 路径 | 标签 | 父级 | 排序 |
|------|------|------|------|
| /users | 用户管理 | access | 20 |
<!-- AUTO:user:END -->

<!-- AUTO:role:START -->
### 角色管理 (role)

#### 权限定义

| 资源 | 操作 | 所属模块 |
|------|------|---------|
| role | read, create, update, delete | role-management |

#### 菜单配置

| 路径 | 标签 | 父级 | 排序 |
|------|------|------|------|
| /roles | 角色管理 | access | 30 |
<!-- AUTO:role:END -->

<!-- AUTO:permission:START -->
### 权限管理 (permission)

#### 权限定义

| 资源 | 操作 | 所属模块 |
|------|------|---------|
| permission | read, create | permission-management |

#### 菜单配置

| 路径 | 标签 | 父级 | 排序 |
|------|------|------|------|
| /permissions | 权限管理 | access | 40 |
<!-- AUTO:permission:END -->

<!-- AUTO:model:START -->
### 模型配置 (model)

#### 权限定义

| 资源 | 操作 | 所属模块 |
|------|------|---------|
| model | read, create, update, delete | model-management |

#### 菜单配置

| 路径 | 标签 | 父级 | 排序 |
|------|------|------|------|
| /models | 模型配置 | model-routing | 20 |
| /model-routing-rules | 路由策略 | model-routing | 10 |
<!-- AUTO:model:END -->

<!-- AUTO:task:START -->
### 任务记录 (task)

#### 权限定义

| 资源 | 操作 | 所属模块 |
|------|------|---------|
| task | read, create, update, delete | task-management |

#### 菜单配置

| 路径 | 标签 | 父级 | 排序 |
|------|------|------|------|
| /tasks | 任务记录 | business | 10 |
<!-- AUTO:task:END -->

<!-- AUTO:api-client:START -->
### 应用与 API 密钥 (api-client)

#### 权限定义

| 资源 | 操作 | 所属模块 |
|------|------|---------|
| api-client | read, create, update, delete | api-client-management |

#### 菜单配置

| 路径 | 标签 | 父级 | 排序 |
|------|------|------|------|
| /api-clients | 应用管理 | business | 5 |
<!-- AUTO:api-client:END -->

<!-- AUTO:audit:START -->
### 审计日志 (audit)

#### 权限定义

| 资源 | 操作 | 所属模块 |
|------|------|---------|
| audit | read | audit-management |

#### 菜单配置

| 路径 | 标签 | 父级 | 排序 |
|------|------|------|------|
| /audit-logs | 审计日志 | audit | 10 |
<!-- AUTO:audit:END -->

<!-- AUTO:stats:START -->
### 统计数据 (stats)

#### 权限定义

| 资源 | 操作 | 所属模块 |
|------|------|---------|
| stats | read | stats-management |

#### 菜单配置

| 路径 | 标签 | 父级 | 排序 |
|------|------|------|------|
| /stats | 统计报表 | overview | 5 |
<!-- AUTO:stats:END -->

<!-- AUTO:queue:START -->
### 队列管理 (queue)

#### 权限定义

| 资源 | 操作 | 所属模块 |
|------|------|---------|
| queue | read | queue-management |

#### 菜单配置

| 路径 | 标签 | 父级 | 排序 |
|------|------|------|------|
| /queues | 队列监控 | business | 20 |
<!-- AUTO:queue:END -->

<!-- AUTO:provider:START -->
### 供应商管理 (provider)

#### 权限定义

| 资源 | 操作 | 所属模块 |
|------|------|---------|
| provider | read, create, update, delete | provider-management |

#### 菜单配置

| 路径 | 标签 | 父级 | 排序 |
|------|------|------|------|
| /provider-configs | 供应商配置 | provider | 10 |
| /account-pool | 账号池 | provider | 20 |
| /provider-health | 供应商健康度 | provider | 30 |
<!-- AUTO:provider:END -->

<!-- AUTO:notification:START -->
### 通知中心 (notification)

#### 权限定义

| 资源 | 操作 | 所属模块 |
|------|------|---------|
| notification | read, create, update, delete | notification-management |

#### 菜单配置

| 路径 | 标签 | 父级 | 排序 |
|------|------|------|------|
| /notification-rules | 通知规则 | notification | 10 |
| /notification-records | 通知记录 | notification | 20 |
| /notifications | 消息中心 | notification | 30 |
<!-- AUTO:notification:END -->

<!-- AUTO:callback-log:START -->
### 回调日志 (callback-log)

#### 权限定义

| 资源 | 操作 | 所属模块 |
|------|------|---------|
| callback-log | read | callback-log-management |

#### 菜单配置

| 路径 | 标签 | 父级 | 排序 |
|------|------|------|------|
| /callback-logs | 回调日志 | audit | 15 |
<!-- AUTO:callback-log:END -->

<!-- AUTO:system-info:START -->
### 系统信息 (system-info)

#### 权限定义

| 资源 | 操作 | 所属模块 |
|------|------|---------|
| system | read | system-info-management |

#### 菜单配置

| 路径 | 标签 | 父级 | 排序 |
|------|------|------|------|
| /system-info | 系统信息 | system | 15 |
<!-- AUTO:system-info:END -->

<!-- AUTO:billing:START -->
### 计费与成本 (billing)

#### 权限定义

| 资源 | 操作 | 所属模块 |
|------|------|---------|
| billing | read, write | billing-management |

#### 菜单配置

| 路径 | 标签 | 父级 | 排序 |
|------|------|------|------|
| /billing/records | 用量账单 | billing | 10 |
| /billing/wallets | 余额充值 | billing | 20 |
| /account-costs | 成本分析 | billing | 30 |

#### 审计配置

| 控制器 | 资源类型 |
|--------|---------|
| AdminBilling | billing |
<!-- AUTO:billing:END -->

<!-- AUTO:link-conversion:START -->
### 请求转换配置 (link-conversion)

#### 权限定义

| 资源 | 操作 | 所属模块 |
|------|------|---------|
| link-conversion | read, update | link-conversion-management |

#### 菜单配置

| 路径 | 标签 | 父级 | 排序 |
|------|------|------|------|
| /link-conversion-config | 请求转换配置 | model-routing | 30 |
<!-- AUTO:link-conversion:END -->

<!-- AUTO:menu:START -->
### 菜单管理 (menu)

#### 权限定义

| 资源 | 操作 | 所属模块 |
|------|------|---------|
| menu | read, create, update, delete | menu-management |

#### 菜单配置

| 路径 | 标签 | 父级 | 排序 |
|------|------|------|------|
| /menus | 菜单管理 | access | 5 |
<!-- AUTO:menu:END -->

<!-- AUTO:portal-user:START -->
### Portal 用户管理 (portal-user)

#### 权限定义

| 资源 | 操作 | 所属模块 |
|------|------|---------|
| portal-user | read, update, delete | portal-user-management |

#### 菜单配置

| 路径 | 标签 | 父级 | 排序 |
|------|------|------|------|
| /portal-users | Portal 用户 | access | 25 |
<!-- AUTO:portal-user:END -->

<!-- AUTO:workflow:START -->
### 工作流管理 (workflow)

#### 权限定义

| 资源 | 操作 | 所属模块 |
|------|------|---------|
| workflow | read, update, delete | workflow-management |

#### 菜单配置

| 路径 | 标签 | 父级 | 排序 |
|------|------|------|------|
| /workflows | 工作流管理 | business | 35 |
<!-- AUTO:workflow:END -->


## 创作闭环接口与数据

- 公开只读：GET /v1/catalog/drama-templates（search、page、pageSize，最大 48）与 GET /v1/catalog/drama-templates/:id。只投影故事结构；不使用登录刷新或返回内部模型绑定。官方静态模板与已发布社区模板共同分页。
- 登录后投稿：POST /v1/creation-templates/submissions；GET 同路径查询本人的投稿。提交参数为 kind、sourceId、name、description、instructions，服务端读取所属源项目并构建不可变快照，客户端不能指定公开状态。
- 后台审核：GET /api/v1/admin/creation-templates、GET /:id、PUT /:id/review（action=publish/reject/withdraw，note）。使用既有 JWT、角色与权限守卫。
- 镜头关联：POST /v1/drama-workflows（projectId、shotId、kind=image/video、revision）；GET /v1/drama-workflows/by-workflow/:workflowId；POST /v1/drama-workflows/:id/import（runId、nodeId）。后端分别验证作品、关联、运行的所有者、媒体类型和输入指纹。

新增集合 creation_template_submissions 和 drama_workflow_links，由 WorkflowModule 注册。投稿以 ownerId/kind/sourceId/sourceFingerprint 唯一；关联以 id、workflowId 唯一。工作流发布复用投稿 ObjectId 作为 workflow_templates 的 ID，重复审核不产生重复模板。短剧采用已发布快照；旧官方静态模板继续有效。已有模型配置、钱包、项目及模板无需数据迁移。

关联流程运行时保存 workflow_runs.definitionSnapshot 与 definitionHash。后续节点调度、失败策略和重试使用同次运行的快照，后续画布编辑不改变该次执行；普通及历史未保存快照的运行继续原路径。运行列表不返回完整快照。短剧候选增加 source=workflow 和 workflowOrigin（workflowId/runId/nodeId/workflowVersion/definitionHash/sourceRevision），导入使用确定性候选 ID 保证幂等，并沿用后台媒体归档。

验证命令：

- npm run test:creation:browser：先构建到 output/creation-portal-dist 与 output/creation-dashboard-dist，再运行门户与审核后台的隔离浏览器用例，不替换正在服务的 portal/dist 或 dashboard/dist。
- npx jest --cacheDirectory ./output/creation-jest-cache --runInBand --runTestsByPath src/creation/creation-loop.integration.spec.ts：隔离 MongoDB、模拟身份与计费依赖，不连接真实供应商或钱包。

关联镜头的高级流程模型任务现计入原短剧项目预算；下文规定统一预算准入及核对流程。生成开关同时检查创建分支、新运行和失败重试。生产上线仍需按既有部署方式发布后端、Portal 与管理后台，并确认数据库索引及角色权限。

### 模板推荐与项目漏斗（P2）

TemplateInsightsService 从 workflows / short_drama_projects 的 templateSource，按模板、所属账号、项目聚合实际 workflow_runs / short_drama_candidates。关联同时验证 workflowId/projectId 与 triggerId/ownerId。输出 copies、creators、startedProjects、completedProjects、startedCreators、completedCreators，不输出账号、剧本、节点参数或素材。统计保留当前存量直接副本，按模板 ID 跨版本汇总，不是永久累计事件账本。

工作流从模板创建时由服务端第三参数写入 templateSource.id/version，普通创建和表单更新不能指定归因；工作流及短剧增加 templateSource.id/owner 复合索引。旧来源不明的项目不迁移猜测，已存在的短剧来源可直接统计。归档保留、删除移出；重复运行和导出通过项目级 max 聚合去重。短剧完成要求 source=render、kind=export、status=succeeded；工作流要求至少一次所属账号的运行 status=succeeded。短剧 upload 不计启动，model/render/workflow 计制作活动。

两个公开目录增加推荐排序与 metrics；短剧另支持 official/community 来源过滤，工作流保持原有筛选。推荐分数为 3*ln(1+completedCreators)+ln(1+startedCreators)+0.25*ln(1+creators)，相同分数按创建时间排序。工作流先在完整可公开且匹配筛选的 ID 集合上排序，再分页，避免仅对当前页排序。每种类型内存缓存 60 秒，同实例并发统计请求合并，聚合限制 10 秒；缓存失败不伪造成功数据。部署多实例时刷新时间可相差最多一分钟。当前为目录规模的内存排序，模板或归因项目量增长时需结合生产执行计划评估预聚合，不能把此实现当作海量推荐服务。

GET /api/v1/admin/creation-templates/insights?kind=short-drama|workflow&page=1 返回逐模板效果、全量阶段合计及 computedAt；复用现有 admin/super_admin 角色和 workflow:read 权限。该项目效果接口只读，成功数仍从服务端结果计算。新增操作事件独立统计，不能写入付费金额或成功状态。

验证：src/creation/template-insights.integration.spec.ts 使用隔离 MongoDB 验证所有权关联、去重、完成定义、删除与归档、推荐/筛选/分页、下架隔离、归因写入和缓存合并；creation-loop.integration.spec.ts 验证统计接口鉴权与查询校验。npm run test:creation:browser 覆盖发现页排序、来源筛选、活动数据及后台效果类型切换、零分母展示与原有创作闭环。

### 统一预算、操作事件与阶段模板

关联镜头流程的 NodeExecutor 在创建模型任务前调用 WorkflowBudgetService。drama_workflow_budget_tasks 按 runId/nodeId/attempt 的哈希唯一，记录模型配置版本、参数指纹、授权上限和任务关联。与普通短剧报价共用项目 budgetHolds，通过单次条件更新验证「全部已用和预留 + 本次上限 <= budgetLimit」。模型参数验证及现有积分估价通过后才预留；传入 TaskService 的可信 maxCharge 继续约束实际结算。普通独立工作流沿用原路径。钱包余额和供应商成本不等于项目预算，整个流程没有提前计算总报价，后续节点可能因预算不足停止，前序已提交节点仍会扣费。

节点提交先以 ready→submitting 原子认领，成功绑定 taskId；相同节点尝试不能重复调用创建。未知提交结果保留预留，通过受信任的 task metadata、运行执行密钥核对已存在任务。仅明确的提交前拒绝释放；settled/refunded 计费记录确认后条件更新 hold，重复核对不会重复释放。免计费密钥的终态任务核对为 0。归档、暂停生成、无效节点状态阻止新提交。旧版本已提交、未带预算关联的高级任务不倒填为零消费；金额超授权、结果不明且查无任务的记录需人工核对，不直接删除 hold 重试。

POST /v1/creation-events/public 接受 template_view/create_click、kind、templateId、sessionId（UUID）；仅允许当前公开模板，按实例/IP 每分钟最多 120 次。POST /v1/creation-events 接受 quote_viewed/take_selected/download_started、projectId、referenceId，要求登录、所属项目及有效报价/成功候选，下载开始还要求成功成片 URL。DTO 拒绝额外字段，不采集剧本、素材 URL、费用、凭证或原始 IP。会话/账号只保留哈希。creation_events 按 UTC 日去重，TTL 90 天；GET /api/v1/admin/creation-templates/funnel?kind=short-drama|workflow 查询近 30 天。浏览/采用按会话去重，短剧操作按项目去重，不将匿名浏览与登录作品强行拼接为完整转化率。事件来自浏览器且可受重复会话、拦截或请求伪造影响，不参与费用和成功结果统计；发送失败不阻塞主要操作。选片是点击信号，下载是开始信号，均不证明保存或下载完成。

POST /v1/short-dramas/:id/stage-templates 接受 revision/templateId/stage=characters|storyboard。服务端读取官方或已发布模板，角色阶段只追加角色；分镜阶段追加完整依赖的角色、场景和镜头，全部重新分配 ID、移除选片与制作参数。保留原有故事、设置、条目及素材，撤销角色/分镜确认；超出原有数量或时长限制时整次失败。作品修订条件更新同时保存 history 和 stageTemplates（最近 50 条 id/version/stage/appliedAt/revision），并发修订不重复追加。历史恢复只恢复草稿，不抹除应用记录。

POST /v1/drama-workflows 可选 templateId，将公开工作流的可移植快照复制到新的镜头流程，并记录 templateSource.id/version。模板须包含所选类型的媒体节点；不自动填充任意图输入，也不自动运行。已下架模板不能新采用，已有副本独立。工作流模板详情包含 compatibility.checkedAt/issues/runnable，只检查当前模型配置存在、启用和显式版本匹配；不承诺参数、素材或外部供应商完整可用。真正运行仍使用原参数校验、权限与计费路径。

### 本地发布预检

先执行隔离构建、专项集成测试及 npm run test:creation:browser；后端可用 `npx tsc -p tsconfig.build.json --outDir output/creation-api-dist --tsBuildInfoFile output/creation-api.tsbuildinfo` 构建，不覆盖正在服务的 dist。`node scripts/check-creation-local.cjs --out output/creation-local-preflight.json` 只检查本机 API/后台的 JSON readiness、未登录保护、媒体工具和 Redis。MongoDB 不是回环地址时默认跳过；确认配置目标后可加 --inspect-configured-db 只读核查事务能力、模型类型与索引，indexPlan 只列缺项，不创建索引。预检不启动 worker/scheduler，不重放旧队列，不调用付费模型，不打印连接串或凭证。

发布前需要确保 creation_template_submissions、drama_workflow_links、drama_workflow_budget_tasks 的唯一索引和 creation_events 的唯一/TTL/查询索引、tasks 的预算关联索引已存在；先排查重复数据，再按索引计划执行。构建或隔离测试通过不证明本地运行进程已加载新代码。真实生成验收需明确本地账号、钱包、费用上限及运行中的 API/媒体工具；按模板创建→报价确认→少量生成→高级流程→回传选片→导出→下载开始逐项验收，并核对项目预算、钱包与事件，不能以静态 HTTP 200 或模拟结果替代。

### 统一预算、操作事件与阶段模板

关联镜头流程的 NodeExecutor 在创建模型任务前调用 WorkflowBudgetService。drama_workflow_budget_tasks 按 runId/nodeId/attempt 的哈希唯一，记录模型配置版本、参数指纹、授权上限和任务关联。与普通短剧报价共用项目 budgetHolds，通过单次条件更新验证「全部已用和预留 + 本次上限 <= budgetLimit」。模型参数验证及现有积分估价通过后才预留；传入 TaskService 的可信 maxCharge 继续约束实际结算。普通独立工作流沿用原路径。钱包余额和供应商成本不等于项目预算，整个流程没有提前计算总报价，后续节点可能因预算不足停止，前序已提交节点仍会扣费。

节点提交先以 ready→submitting 原子认领，成功绑定 taskId；相同节点尝试不能重复调用创建。未知提交结果保留预留，通过受信任的 task metadata、运行执行密钥核对已存在任务。仅明确的提交前拒绝释放；settled/refunded 计费记录确认后条件更新 hold，重复核对不会重复释放。免计费密钥的终态任务核对为 0。归档、暂停生成、无效节点状态阻止新提交。旧版本已提交、未带预算关联的高级任务不倒填为零消费；金额超授权、结果不明且查无任务的记录需人工核对，不直接删除 hold 重试。

POST /v1/creation-events/public 接受 template_view/create_click、kind、templateId、sessionId（UUID）；仅允许当前公开模板，按实例/IP 每分钟最多 120 次。POST /v1/creation-events 接受 quote_viewed/take_selected/download_started、projectId、referenceId，要求登录、所属项目及有效报价/成功候选，下载开始还要求成功成片 URL。DTO 拒绝额外字段，不采集剧本、素材 URL、费用、凭证或原始 IP。会话/账号只保留哈希。creation_events 按 UTC 日去重，TTL 90 天；GET /api/v1/admin/creation-templates/funnel?kind=short-drama|workflow 查询近 30 天。浏览/采用按会话去重，短剧操作按项目去重，不将匿名浏览与登录作品强行拼接为完整转化率。事件来自浏览器且可受重复会话、拦截或请求伪造影响，不参与费用和成功结果统计；发送失败不阻塞主要操作。选片是点击信号，下载是开始信号，均不证明保存或下载完成。

POST /v1/short-dramas/:id/stage-templates 接受 revision/templateId/stage=characters|storyboard。服务端读取官方或已发布模板，角色阶段只追加角色；分镜阶段追加完整依赖的角色、场景和镜头，全部重新分配 ID、移除选片与制作参数。保留原有故事、设置、条目及素材，撤销角色/分镜确认；超出原有数量或时长限制时整次失败。作品修订条件更新同时保存 history 和 stageTemplates（最近 50 条 id/version/stage/appliedAt/revision），并发修订不重复追加。历史恢复只恢复草稿，不抹除应用记录。

POST /v1/drama-workflows 可选 templateId，将公开工作流的可移植快照复制到新的镜头流程，并记录 templateSource.id/version。模板须包含所选类型的媒体节点；不自动填充任意图输入，也不自动运行。已下架模板不能新采用，已有副本独立。工作流模板详情包含 compatibility.checkedAt/issues/runnable，只检查当前模型配置存在、启用和显式版本匹配；不承诺参数、素材或外部供应商完整可用。真正运行仍使用原参数校验、权限与计费路径。

### 本地发布预检

先执行隔离构建、专项集成测试及 npm run test:creation:browser；后端可用 `npx tsc -p tsconfig.build.json --outDir output/creation-api-dist --tsBuildInfoFile output/creation-api.tsbuildinfo` 构建，不覆盖正在服务的 dist。`node scripts/check-creation-local.cjs --out output/creation-local-preflight.json` 只检查本机 API/后台的 JSON readiness、未登录保护、媒体工具和 Redis。MongoDB 不是回环地址时默认跳过；确认配置目标后可加 --inspect-configured-db 只读核查事务能力、模型类型与索引，indexPlan 只列缺项，不创建索引。预检不启动 worker/scheduler，不重放旧队列，不调用付费模型，不打印连接串或凭证。

发布前需要确保 creation_template_submissions、drama_workflow_links、drama_workflow_budget_tasks 的唯一索引和 creation_events 的唯一/TTL/查询索引、tasks 的预算关联索引已存在；先排查重复数据，再按索引计划执行。构建或隔离测试通过不证明本地运行进程已加载新代码。真实生成验收需明确本地账号、钱包、费用上限及运行中的 API/媒体工具；按模板创建→报价确认→少量生成→高级流程→回传选片→导出→下载开始逐项验收，并核对项目预算、钱包与事件，不能以静态 HTTP 200 或模拟结果替代。
