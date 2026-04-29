# Model-Hub 技术方案文档

> 版本：v2.6  
> 最后更新：2026-04-29  
> 状态：设计阶段  
> 变更：v2.6 统一密钥管理 — `provider_runtime_configs` 移除 `api_key`，所有密钥收敛到 `account_pool_entries`  
> 变更：v2.5 Dashboard 总览页新增全部数据统计模块（历史累计任务统计）  
> 变更：v2.4 轮询查询失败优雅重试机制（retryable/non-retryable 分类处理 + 退避调度）  
> 变更：v2.3 完善错误日志系统、补充厂商适配器开发指南、添加故障排查手册  
> 变更：v2.2 路由规则 `model_routing_rules` 落地（fixed / weighted / primary_fallback）、管理端 CRUD；补充「主挂了再切备」TODO  
> 变更：v2.1 新增管理后台设计（前后端同项目不同服务）  
> 变更：v2.0 新增多服务商热切换、按功能队列隔离、队列统计、数据聚合、时长跟踪、任务时间线

---

## 目录

1. [项目概述](#1-项目概述)
2. [需求分析](#2-需求分析)
3. [系统架构设计](#3-系统架构设计)
4. [核心流程设计](#4-核心流程设计)
5. [NestJS 模块设计](#5-nestjs-模块设计)
6. [多服务商热切换设计](#6-多服务商热切换设计) ★ v2.0 新增，v2.2 与实现对齐
    - [6.8 TODO：主挂了再切备（健康感知故障转移）](#68-todo主挂了再切备健康感知故障转移)
7. [Provider Adapter 统一抽象层](#7-provider-adapter-统一抽象层)
8. [数据模型设计（MongoDB）](#8-数据模型设计mongodb)
    - [8.10 统一密钥管理架构](#810-统一密钥管理架构) ★ v2.6 新增
9. [按功能队列隔离设计](#9-按功能队列隔离设计) ★ v2.0 重构
10. [统一 API 设计](#10-统一-api-设计)
11. [任务状态机设计](#11-任务状态机设计)
12. [定时轮询策略](#12-定时轮询策略)
    - [11.5 轮询查询失败优雅重试](#115-轮询查询失败优雅重试--v24-新增) ★ v2.4 新增
13. [回调可靠性设计](#13-回调可靠性设计)
14. [安全方案](#14-安全方案)
15. [可观测与告警](#15-可观测与告警)
16. [部署与扩展策略](#16-部署与扩展策略)
17. [测试策略](#17-测试策略)
18. [迭代路线图](#18-迭代路线图)
19. [关键风险与规避](#19-关键风险与规避)
20. [队列消费情况统计](#20-队列消费情况统计) ★ v2.0 新增
21. [任务数据聚合统计](#21-任务数据聚合统计) ★ v2.0 新增
22. [任务时长精确跟踪](#22-任务时长精确跟踪) ★ v2.0 新增
23. [任务处理日志时间线](#23-任务处理日志时间线) ★ v2.0 新增
24. [管理后台设计](#24-管理后台设计) ★ v2.1 新增
25. [附录：术语表](#25-附录术语表)

---

## 1. 项目概述

> 本文档与 [project-architecture.md](./project-architecture.md) 配合使用，提供详细的技术设计方案。

### 1.1 项目定位

`model-hub` 是 Akool 平台的**统一 AI 模型接入中台**，负责集成多家第三方 AI 模型厂商，为上层业务（AGI-Content、FaceSwap、Open-API 等）提供标准化的模型调用能力。

### 1.2 核心目标

| 目标 | 说明 |
|------|------|
| **统一接入** | 对外暴露一致的 RESTful API，屏蔽不同厂商协议差异 |
| **异步化** | 通过 Bull 队列削峰填谷，解耦请求与处理 |
| **多厂商适配** | 可插拔 Adapter 机制，新增厂商无需改动对外接口 |
| **任务轮询** | 支持异步模型任务的定时状态轮询 |
| **可靠回调** | 任务完成后自动回调业务方，保证最终送达 |
| **生产级治理** | 限流、熔断、幂等、监控、告警一体化 |

### 1.3 技术栈

| 层面 | 技术选型 |
|------|----------|
| 后端框架 | NestJS (Node.js) |
| 语言 | TypeScript (strict mode) |
| 数据库 | MongoDB (Mongoose ODM) |
| 队列 | Bull (Redis-backed) |
| 配置中心 | Nacos（NacosConfigClient，与现有服务保持一致） |
| 缓存/锁 | Redis |
| 定时任务 | @nestjs/schedule (cron) |
| 进程管理 | PM2 |
| 容器化 | Docker |
| HTTP 客户端 | Axios (带重试与超时) |
| ★ 管理后台前端 | React 18 + Ant Design 5 + Vite |
| ★ 图表 | ECharts / @ant-design/charts |
| ★ 前端路由 | React Router v6 |
| ★ 状态管理 | Zustand |
| ★ 前端 HTTP | Axios + SWR |

---

## 2. 需求分析

### 2.1 功能需求

#### FR-01：统一任务提交
- 业务方通过统一 API 提交 AI 任务（文本生成、图像生成、视频生成等）
- 系统根据 `model` 字段路由到对应厂商 Adapter
- 立即返回 `taskId`，任务异步处理

#### FR-02：多厂商模型适配
- 支持的厂商包括但不限于：OpenAI、Anthropic、Replicate、Runway、Stability AI、自建服务
- 每个厂商通过独立 Adapter 实现，遵循统一接口规范
- 支持同步响应和异步轮询两种模式

#### FR-03：Bull 队列异步处理
- 请求入 Bull 队列，由 Worker 消费
- Worker 调用厂商 API 创建任务
- 支持重试、超时、优先级

#### FR-04：任务状态轮询
- 定时器扫描 `SUBMITTED/PROCESSING` 状态的任务
- 按厂商调用查询接口获取最新状态
- 状态变更后更新数据库并触发下游流程

#### FR-05：结果回调
- 任务成功后，将结果 POST 到业务方提供的 `callbackUrl`
- 回调携带签名，防篡改防重放
- 失败自动重试，超限进入死信

#### FR-06：任务状态查询
- 提供 `GET /v1/tasks/:taskId` 主动查询接口
- 返回完整的任务状态、结果、错误信息

#### FR-07：任务取消（可选）
- 支持取消 `PENDING/SUBMITTED` 状态的任务
- 尝试调用厂商取消接口

### 2.2 非功能需求

| 维度 | 要求 |
|------|------|
| **可用性** | 99.9%，队列解耦保证核心链路不因厂商故障中断 |
| **并发** | 支持 1000+ TPS 提交（队列削峰） |
| **延迟** | 提交接口 P99 < 200ms；回调延迟 < 30s（任务完成后） |
| **幂等** | 相同 `idempotencyKey` 不会重复创建任务 |
| **安全** | API 鉴权、回调签名、输入校验、SSRF 防护 |
| **可扩展** | 新增厂商仅需新增 Adapter + 配置 |
| **可观测** | 全链路 traceId、核心指标 Prometheus、日志 ELK |

---

## 3. 系统架构设计

### 3.1 整体架构图

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

### 3.2 组件职责

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

### 3.3 数据流

```
请求进入 → 鉴权 → 校验 → 幂等检查 → 入库(PENDING) → 入队
    → Worker 消费 → Adapter 转换 → 厂商API → 更新(SUBMITTED)
    → Scheduler 轮询 → Adapter 查询 → 状态同步
    → 成功 → 入库(SUCCESS) → Callback投递 → 签名+POST → 重试保障
```

---

## 4. 核心流程设计

### 4.1 任务提交流程（异步模式）

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

### 4.2 任务消费流程（Worker 提交到厂商）

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

### 4.3 定时轮询流程

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

### 4.4 结果回调流程

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
     "result": { ... },
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

---

## 5. NestJS 模块设计

### 5.1 模块总览

```
AppModule
├── ConfigModule          # Nacos 配置中心 + 环境变量校验
├── DatabaseModule        # MongoDB 连接、Schema 注册
├── RedisModule           # Redis 连接（队列 + 缓存 + 锁）
├── AuthModule            # API Key / JWT / Service Token 鉴权
├── TaskModule            # 任务核心业务逻辑
├── QueueModule           # Bull 队列注册与消费
├── ProviderModule        # 厂商 Adapter 注册与管理
├── PollingModule         # 定时轮询调度
├── CallbackModule        # 回调投递与重试
├── StatsModule           # 数据聚合统计
├── AdminModule           # ★ 管理后台 API（路由切换/队列管理/任务管理）
├── DashboardModule       # ★ 管理后台静态资源服务（serve SPA）
├── HealthModule          # 健康检查（liveness + readiness）
└── ObservabilityModule   # 日志、Metrics、Tracing
```

### 5.2 模块依赖关系

```
ConfigModule ─────────────────────────────────────────────┐
     │                                                     │
DatabaseModule ──── RedisModule                            │
     │                  │                                  │
     ├──────────────────┼──────────────── AuthModule       │
     │                  │                    │             │
     ├──────────────────┼──── TaskModule ────┤             │
     │                  │         │          │             │
     │                  ├── QueueModule      │             │
     │                  │         │          │             │
     │                  │    ProviderModule   │             │
     │                  │         │          │             │
     │                  ├── PollingModule     │             │
     │                  │                    │             │
     │                  ├── CallbackModule    │             │
     │                  │                    │             │
     └──────────────────┴── HealthModule ────┘             │
                        │                                  │
                        └── ObservabilityModule ───────────┘
```

### 5.3 各模块详细职责

#### ConfigModule
- **双来源加载**：优先从 Nacos 配置中心拉取整份 JSON 配置；Nacos 不可用时降级到本地 `.env` + 配置文件
- 使用 `@nestjs/config` 做配置注册，`joi` / `zod` 校验最终合并后的配置
- 管理所有配置项：数据库连接、Redis、厂商 API Key/Endpoint、队列参数
- 环境隔离：development / staging / production（通过 `NACOS_DATA_ID` 或 `NODE_ENV` 区分）
- 敏感配置仅通过 Nacos 或 `.env` 注入，禁止硬编码
- 支持 Nacos `subscribe` 监听配置变更，热更新非连接类配置（如限流参数、厂商开关）

**Nacos 加载流程（与现有 Akool 服务保持一致）：**

```
启动 → 读 NACOS_ENABLE 环境变量
         │
    ┌────┴─────┐
    │  true    │  false / 未设置
    ▼          ▼
NacosConfigClient        读本地配置
  .getConfig(             require(`config/${NODE_ENV}`)
    NACOS_DATA_ID,        或 .env
    NACOS_GROUP)
    │
    ▼
JSON.parse → 合并到 ConfigService
    │
    ▼
subscribe(dataId, group) → 监听变更 → 热更新可变配置
```

**Nacos 环境变量（与现有服务统一）：**

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `NACOS_ENABLE` | `false` | 是否启用 Nacos 配置中心 |
| `NACOS_SERVER_ADDR` | - | Nacos 服务地址（如 `nacos-public.akool.io:8848`） |
| `NACOS_NAMESPACE` | - | 命名空间 ID |
| `NACOS_DATA_ID` | `model-hub` | 配置 Data ID |
| `NACOS_GROUP` | `DEFAULT_GROUP` | 配置分组 |
| `NACOS_USERNAME` | - | 认证用户名（可选） |
| `NACOS_PASSWORD` | - | 认证密码（可选） |

##### 5.3.1 NestJS 与 Nacos 集成实现要点

- **启动顺序**：在 `ConfigModule.forRootAsync` 的 `useFactory`（或独立 `loadConfig()`）内 **先** `await` 完成 Nacos 首次拉取（或判定关闭 Nacos 并读本地），**再** 将解析后的对象与 `process.env` 合并，**最后** 交给 `validationSchema`（Joi/Zod）校验；避免在 `main.ts` 里重复拉取，除非采用「`bootstrap()` 预加载 + 全局变量注入」的显式两阶段写法。
- **合并策略（推荐）**：`process.env` **覆盖** Nacos JSON 中的同名键，便于本地调试与 K8s/PM2 注入密钥；或约定 Nacos 仅承载非敏感业务参数（限流、厂商开关），密钥类 **仅** 来自环境变量。
- **代码分层**：`nacos-config.service.ts`（或 `nacos-config.loader.ts`）封装 `new NacosConfigClient(...)`、`getConfig(dataId, group)`、`subscribe`；`config.module.ts` 使用 `ConfigModule.forRootAsync({ isGlobal: true, load: [mergedLoader], validationSchema })`。
- **热更新**：`subscribe` 回调中只刷新 **进程内可变配置**（如 `ProviderConfigService` 缓存的限流阈值、厂商启用开关），**不**在回调里销毁并重建 MongoDB/Redis 连接；需要连接串级变更时，走 **发布 + PM2 reload / 滚动重启**。
- **PM2 多进程**：每个 Worker/API 进程各自 `subscribe`，Nacos 推送到达时间可能略有先后，**短时** 存在实例间配置视图不一致；对强一致开关应以 **DB/Redis 为事实源**，Nacos 仅作默认下发。

**`main.ts` 与异步配置（示意）：**

```typescript
// main.ts — 通常无需在 create 之前单独 await Nacos；
// 将拉取逻辑放进 ConfigModule.forRootAsync 即可。

async function bootstrap() {
  const app = await NestFactory.create(AppModule); // AppModule 导入 ConfigModule.forRootAsync
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
```

```typescript
// config.module.ts — forRootAsync 内合并 Nacos + env
ConfigModule.forRootAsync({
  isGlobal: true,
  useFactory: async () => {
    const nacosJson = await loadNacosJsonIfEnabled(); // NacosConfigService / loader
    return { ...nacosJson, ...process.env }; // 或 env 覆盖 nacosJson，按团队约定
  },
  validationSchema: configValidationSchema,
});
```

#### DatabaseModule
- 基于 `@nestjs/mongoose` 注册所有 Schema
- 配置连接池、超时、重连策略
- 注册数据库中间件（如查询日志、慢查询监控）

#### RedisModule
- 基于 `ioredis` 或 `@nestjs/bull` 内置 Redis 连接
- 提供分布式锁工具（`RedisLockService`）
- 提供限流计数器（`RateLimiterService`）

#### AuthModule
- `ApiKeyGuard`：校验 `X-API-Key` Header
- `JwtGuard`：校验 Bearer Token（可选）
- `ServiceTokenGuard`：内部服务间调用鉴权
- `TenantExtractor`：从 Token/Key 提取 tenantId 注入 Request

#### TaskModule
- `TaskController`：暴露 REST API
- `TaskService`：任务创建、状态查询、状态流转
- `IdempotencyService`：幂等检查与记录
- `TaskRepository`：封装 Mongoose 操作，条件更新

#### QueueModule
- 注册 Bull 队列：`task-submit`、`callback`、`dead-letter`
- `TaskSubmitProcessor`：消费提交队列
- `CallbackProcessor`：消费回调队列
- 配置重试策略、并发数、速率限制

#### ProviderModule
- `ProviderRegistry`：管理所有已注册 Adapter
- `ProviderFactory`：根据 provider 名称获取 Adapter 实例
- `ProviderConfigService`：管理厂商配置（API Key、Endpoint、限流参数）
- 各厂商 Adapter 实现类

#### PollingModule
- `PollingScheduler`：Cron 定时任务入口
- `PollingService`：批量查询待轮询任务，调用 Adapter，更新状态
- 使用分布式锁防止多实例竞争
- 动态轮询间隔策略

#### CallbackModule
- `CallbackService`：构建 payload、签名、投递
- `CallbackSignatureService`：HMAC-SHA256 签名生成与校验
- `CallbackLogRepository`：回调日志持久化
- Dead-letter 处理与手动重放接口

#### HealthModule
- `/health/liveness`：进程存活检查
- `/health/readiness`：数据库 + Redis + 队列就绪检查

#### ObservabilityModule
- 结构化日志（pino / winston），统一 traceId
- Prometheus Metrics Middleware
- OpenTelemetry Tracing（可选）
- 错误上报（Sentry 可选）

---

## 6. 多服务商热切换设计

> **v2.2 说明**：本节与当前代码实现对齐。早期文档中的独立集合 `model_routes` + Redis pub/sub 推送路由缓存属于**草案/未落地**方案；**实际热切换**以 MongoDB **`model_routing_rules`**（及既有 **`model_configs`**）为准。

### 6.1 设计目标

| 目标 | 说明 |
|------|------|
| **配置化切换** | 通过 `model_routing_rules` 或 `model_configs` 调整，新任务即时按新策略解析（无需改业务调用方 `model` 字符串） |
| **最小影响面** | **已创建任务** `tasks.provider` 与已入队 Job 不变；仅**新任务**走新路由 |
| **灰度与分流** | **weighted**：多厂商按权重比例；**primary_fallback**：主备比例（`primary_weight` / `fallback_weight`） |
| **可审计** | `tasks.routeId` 存规则文档 `_id`；时间线 `TASK_CREATED` 记录 `routingSource`、`routeId` |
| **回退** | 禁用规则、改权重、`effective_until` 到期、或删除规则，下一单即恢复为下层兜底逻辑 |

### 6.2 配置分层（当前实现）

#### （1）MongoDB `model_routing_rules`（**最高优先级**）

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

#### （2）MongoDB `model_configs`（**次优**）

- 当**无命中**路由规则时：若存在 `model_configs` 且 `service` 非空，则经 `mapModelConfigServiceToProvider(service)` 映射为 Adapter 名（`wavespeed` → `wavespeed-ai` 等）。

#### （3）模型路径兜底

- 无配置或 `service` 为空时：`model` 路径**首段**视为 `provider`（兼容历史调用）。

### 6.3 路由解析与入队流程

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

- **队列**：与 [§9 按功能队列隔离设计](#9-按功能队列隔离设计) 一致；解析出的 `provider` 决定进入哪条厂商子队列。
- **时间线**：`TASK_CREATED` 可携带 `routingSource`、`routeId`，便于排障与审计。

### 6.4 管理接口（路由规则）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/admin/model-routing-rules` | 列表，可选 `model_name`、分页 |
| POST | `/api/v1/admin/model-routing-rules` | 创建规则 |
| PUT | `/api/v1/admin/model-routing-rules/:id` | 更新 |
| DELETE | `/api/v1/admin/model-routing-rules/:id` | 删除 |

需管理端 JWT，角色 `admin` / `super_admin`。

**说明**：早期草案中的 `POST /v1/admin/routes/:routeId/switch`（独立 `model_routes` 文档 + Redis pub/sub）**未作为当前实现**；热切换以本表 CRUD + DB 为准。

### 6.5 灰度与主备配置示例

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

### 6.6 回退机制（当前实现）

- 将规则 **`enabled: false`**、或设置 **`effective_until`**、或 **删除**该规则文档；新任务将回退到 §6.2 中下一层（`model_configs.service` → 路径兜底）。
- 不在此文档承诺「一键回滚到上一 revision」的专用接口；可通过管理端保留规则副本或 GitOps 管理 Mongo 变更。

### 6.7 与现有 AGI-Content 的兼容

| 原 AGI-Content 方式 | Model-Hub 方式 |
|---------------------|----------------|
| 大段 `switch (provider)` / `model_name` 硬编码 | 统一 `model` + Model-Hub 内路由与 Adapter |
| 改枚举/代码 + 部署 | **优先**改 `model_routing_rules` / `model_configs`；新增厂商 Adapter 仍需发版注册 |
| 无平台级灰度表 | **weighted / primary_fallback** 支持比例灰度与主备比例 |

### 6.8 【TODO】「主挂了再切备」（健康感知故障转移） {#todo-primary-fallback-health-failover}

> 当前 **primary_fallback** 仅在**创建任务时**按权重在主次之间分流，**不**感知厂商实时健康状态。以下为实现「主不可用则自动走备」的候选方案，供后续迭代。

| 方向 | 说明 |
|------|------|
| **健康信号** | 周期性探针或基于 Metrics 的滑动窗口（错误率、超时率、连续失败次数）；状态写入 Redis（如 `circuit:provider:{name}`）并设 TTL，多实例可读 |
| **解析阶段** | `tryResolveFromRules` 若策略为 `primary_fallback`，在选中「主」前检查熔断器；若主为 OPEN，则**仅本次**选用备（需记录到 timeline / metadata） |
| **提交失败路径** | 在 `FeatureQueueProcessor.submitToProvider` 首次失败且错误可重试、且映射为「厂商侧不可用」时，**可选**将任务改派到 `fallback_provider` 并重新入队（**强约束**：幂等键、任务状态、与 `providerTaskId` 一致性，避免重复扣费） |
| **幂等与对账** | 改派必须满足：同一 `taskId` 仅一个对外厂商任务；或先取消主侧再提交备侧（若厂商 API 支持） |
| **队列语义** | Job 已带 `provider`；若运行时改派，需更新 DB `task.provider` 并投递到新 `{feature}:{provider}` 队列，或统一经 `task-submit` 再转发 |
| **配置** | 规则上可增加 `failover_on_submit_error: boolean`、白名单错误码等，避免所有错误都切备 |

**建议落地顺序**：先 **解析阶段 + 熔断读 Redis**（仅影响新任务）→ 再评估提交失败自动改派（复杂度高）。

---

## 7. Provider Adapter 统一抽象层

### 7.1 核心接口定义

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

### 7.2 状态映射标准（按实际厂商）

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

### 7.3 已支持厂商 Adapter 实现

> 以下为项目初期优先实现的三个厂商，参照 AGI-Content / AGI-Content-Job 中已有的 `WaveSpeedAiAPI`、`CloudwiseAPI`、`akoolApi` 封装。

#### 7.3.1 WaveSpeed Adapter

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

#### 7.3.2 Cloudwise Adapter

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

#### 7.3.3 Akool 自有模型 Adapter

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

### 7.4 新增厂商流程

1. 在 `src/providers/adapters/` 下创建 `<provider-name>.adapter.ts`
2. 实现 `IProviderAdapter` 接口
3. 在 `provider.module.ts` 中注册 Adapter
4. 在配置中添加厂商 API Key、Endpoint、限流参数
5. 在 `model_routing_rules` 集合中配置路由规则（或依赖 `model_configs.service` 映射）
6. **无需**改动 Controller / TaskService / Queue / Callback 任何代码
7. 可通过管理接口灰度切流量到新厂商

**详细开发指南：** 参见本文档 [§7 Provider Adapter 统一抽象层](#7-provider-adapter-统一抽象层)

---

## 8. 数据模型设计（MongoDB）

### 8.1 tasks 集合

```typescript
{
  // ===== 基础标识 =====
  taskId: string;               // 全局唯一，UUID v4 / ULID
  tenantId: string;             // 租户标识
  bizId?: string;               // 业务方自定义 ID

  // ===== 模型与路由信息 =====
  model: string;                // 统一模型标识，如 "wavespeed-ai/flux-2-pro/text-to-image"
  provider: string;             // 厂商标识："wavespeed-ai" | "cloudwise" | "akool"
  providerModel?: string;       // 厂商侧实际模型名（路由解析后填入）
  featureType: string;          // ★ 功能类型："image_generate" | "image_to_video" | "character_swap" | "video_upscale"
  scene?: string;               // 业务场景，如 "faceswap", "avatar"
  routeId?: string;             // ★ 命中 `model_routing_rules` 时写入规则文档 _id（Mongo ObjectId 字符串）

  // ===== 任务状态 =====
  status: enum {
    PENDING,                    // 已入队，待消费
    SUBMITTED,                  // 已提交厂商，待处理
    PROCESSING,                 // 厂商处理中
    SUCCESS,                    // 成功
    FAILED,                     // 失败
    TIMEOUT,                    // 超时
    CANCELLED                   // 已取消
  };
  version: number;              // 乐观锁版本号

  // ===== 厂商任务信息 =====
  providerTask: {
    providerTaskId: string;     // 厂商侧任务 ID
    requestId?: string;         // 厂商请求追踪 ID
    rawMeta?: object;           // 厂商返回的元数据
  };

  // ===== 请求与结果 =====
  requestPayload: object;       // 标准化后的请求体（脱敏）
  resultPayload?: object;       // 成功时的结果
  error?: {
    code: string;               // Hub 统一错误码
    message: string;            // 错误描述
    providerCode?: string;      // 厂商原始错误码
    providerMessage?: string;   // 厂商原始错误信息
    retryable: boolean;         // 是否可重试
  };

  // ===== 回调信息 =====
  callback: {
    url: string;                // 回调地址
    secret?: string;            // 签名密钥（加密存储）
    status: enum {
      PENDING,                  // 待回调
      SUCCESS,                  // 回调成功
      FAILED,                   // 回调失败（重试中）
      DEAD_LETTER               // 超过最大重试
    };
    retryCount: number;         // 已重试次数
    nextRetryAt?: Date;         // 下次重试时间
    lastAttemptAt?: Date;       // 最后一次尝试时间
    lastError?: string;         // 最后一次错误信息
  };

  // ===== 轮询信息 =====
  polling: {
    nextPollAt?: Date;          // 下次轮询时间
    pollCount: number;          // 已轮询次数
    lastPolledAt?: Date;        // 最后一次轮询时间
    pollInterval: number;       // 当前轮询间隔（ms）
    maxPollCount: number;       // 最大轮询次数
    maxDuration: number;        // 最大处理时长（ms）
  };

  // ===== ★ 时长精确跟踪（v2.0 新增） =====
  timing: {
    receivedAt: Date;           // 请求到达 API 层的时间
    enqueuedAt: Date;           // 入队时间
    dequeuedAt?: Date;          // 出队（Worker 开始处理）时间
    submittedAt?: Date;         // 提交厂商 API 的时间
    providerStartedAt?: Date;   // 厂商开始处理的时间（若厂商返回）
    providerCompletedAt?: Date; // 厂商处理完成时间
    completedAt?: Date;         // Hub 标记完成时间
    callbackSentAt?: Date;      // 回调发送成功时间

    // 计算字段（写入时计算，方便查询聚合）
    queueWaitMs?: number;       // 排队等待时长 = dequeuedAt - enqueuedAt
    providerProcessMs?: number; // 厂商实际处理时长 = providerCompletedAt - submittedAt
    totalE2eMs?: number;        // 端到端总时长 = completedAt - receivedAt
    callbackDelayMs?: number;   // 回调延迟 = callbackSentAt - completedAt
  };

  // ===== ★ 任务处理时间线（v2.0 新增） =====
  timeline: [{
    event: string;              // 事件类型（见 23 章定义）
    timestamp: Date;            // 事件发生时间
    detail?: object;            // 事件附加信息
    durationFromPrev?: number;  // 距上一事件的毫秒数
  }];

  // ===== 优先级与路由 =====
  priority: number;             // 0(最高) - 100(最低)，默认 50
  metadata?: object;            // 业务扩展字段

  // ===== 时间戳 =====
  createdAt: Date;
  updatedAt: Date;
}
```

**索引设计：**

```javascript
// 轮询查询：查找需要轮询的任务
{ status: 1, "polling.nextPollAt": 1 }

// 租户查询：按租户查看任务列表
{ tenantId: 1, createdAt: -1 }

// 厂商任务关联
{ provider: 1, "providerTask.providerTaskId": 1 }

// 回调重试：查找需要重试回调的任务
{ "callback.status": 1, "callback.nextRetryAt": 1 }

// 幂等查询
{ tenantId: 1, bizId: 1 }     // unique sparse

// 任务 ID 唯一索引
{ taskId: 1 }                  // unique

// ★ 功能类型 + 状态（用于按功能统计）
{ featureType: 1, status: 1, createdAt: -1 }

// ★ 厂商 + 功能 + 状态（用于厂商维度统计）
{ provider: 1, featureType: 1, status: 1, createdAt: -1 }

// ★ 按日期聚合统计
{ createdAt: -1, featureType: 1, provider: 1, model: 1 }
```

### 8.2 callback_logs 集合

```typescript
{
  taskId: string;
  callbackUrl: string;
  attempt: number;              // 第几次尝试
  requestHeaders: object;
  requestBody: object;          // 发送的 payload
  responseCode?: number;        // HTTP 响应码
  responseBody?: string;        // 响应体（截断至 1KB）
  success: boolean;
  error?: string;               // 错误信息
  latencyMs: number;            // 请求耗时
  createdAt: Date;
}
```

**索引：**
```javascript
{ taskId: 1, attempt: 1 }
{ createdAt: 1 }               // TTL 索引，30 天自动清理
```

### 8.3 idempotency_records 集合

```typescript
{
  tenantId: string;
  idempotencyKey: string;
  taskId: string;               // 关联的任务 ID
  createdAt: Date;
  expireAt: Date;               // TTL 索引，24h 后自动清理
}
```

**索引：**
```javascript
{ tenantId: 1, idempotencyKey: 1 }   // unique
{ expireAt: 1 }                       // TTL index, expireAfterSeconds: 0
```

### 8.4 provider_configs 集合（可选，也可用配置文件管理）

```typescript
{
  provider: string;             // 唯一
  displayName: string;
  enabled: boolean;
  endpoint: string;
  authType: 'api_key' | 'bearer' | 'custom';
  credentials: object;         // 加密存储
  rateLimits: {
    maxConcurrent: number;
    maxPerSecond: number;
    maxPerMinute: number;
  };
  pollingConfig: {
    defaultInterval: number;    // 默认轮询间隔（ms）
    minInterval: number;
    maxInterval: number;
    maxPollCount: number;
    maxDuration: number;
  };
  models: [{                    // 支持的模型列表
    modelId: string;
    modelVersion?: string;
    enabled: boolean;
  }];
  updatedAt: Date;
}
```

### 8.5 model_routing_rules 集合（★ v2.2 落地，多服务商路由规则）

> 与 §6 一致；**替代**早期文档中的 `model_routes` 草案。

```typescript
{
  model_name: string;               // 与请求 model 完全一致
  client_id: string;                // 空串 = 全客户端；否则仅匹配该 clientId
  enabled: boolean;
  priority: number;                 // 同模型多规则时越大越优先
  effective_from?: Date;
  effective_until?: Date;

  strategy_type: 'fixed' | 'weighted' | 'primary_fallback';

  fixed_provider?: string;         // strategy_type === fixed

  weighted_targets?: {             // strategy_type === weighted
    provider: string;
    weight: number;                // > 0
  }[];

  primary_provider?: string;        // strategy_type === primary_fallback
  fallback_provider?: string;
  primary_weight?: number;          // 默认 100
  fallback_weight?: number;        // 默认 0（为 0 且未要求分流时仅走主）

  note?: string;
  createdAt: Date;                  // timestamps
  updatedAt: Date;
}
```

**索引（实现侧）：**
```javascript
{ model_name: 1, enabled: 1 }
{ model_name: 1, client_id: 1, enabled: 1 }
```

**管理 API：** `GET/POST /api/v1/admin/model-routing-rules`、`PUT/DELETE …/:id`（见 §6.4）。

### 8.6 task_daily_stats 集合（★ v2.0 新增，每日聚合统计）

```typescript
{
  date: string;                     // "2026-04-04"
  featureType: string;              // "image_generate" | "image_to_video" 等
  provider: string;                 // "wavespeed-ai" | "cloudwise" | "akool"
  model: string;                    // 模型标识

  // 任务计数
  totalCount: number;
  successCount: number;
  failedCount: number;
  timeoutCount: number;
  cancelledCount: number;

  // 时长统计（毫秒）
  avgQueueWaitMs: number;           // 平均排队等待
  avgProviderProcessMs: number;     // 平均厂商处理时长
  avgTotalE2eMs: number;            // 平均端到端时长
  p50E2eMs: number;                 // P50 端到端
  p95E2eMs: number;                 // P95 端到端
  p99E2eMs: number;                 // P99 端到端
  maxE2eMs: number;                 // 最大端到端

  // 回调统计
  callbackSuccessCount: number;
  callbackFailedCount: number;

  updatedAt: Date;
}
```

**索引：**
```javascript
{ date: 1, featureType: 1, provider: 1, model: 1 }  // unique compound
{ date: -1 }
{ featureType: 1, date: -1 }
```

### 8.7 task_monthly_stats 集合（★ v2.0 新增，每月聚合统计）

```typescript
{
  month: string;                    // "2026-04"
  featureType: string;
  provider: string;
  model: string;

  // 与 task_daily_stats 相同的统计字段
  totalCount: number;
  successCount: number;
  failedCount: number;
  timeoutCount: number;
  cancelledCount: number;
  avgQueueWaitMs: number;
  avgProviderProcessMs: number;
  avgTotalE2eMs: number;
  p50E2eMs: number;
  p95E2eMs: number;
  p99E2eMs: number;
  maxE2eMs: number;
  callbackSuccessCount: number;
  callbackFailedCount: number;

  updatedAt: Date;
}
```

**索引：**
```javascript
{ month: 1, featureType: 1, provider: 1, model: 1 }  // unique compound
{ month: -1 }
```

### 8.8 queue_snapshots 集合（★ v2.0 新增，队列快照统计）

```typescript
{
  timestamp: Date;                  // 快照时间
  queueName: string;               // 队列名称
  featureType: string;             // 功能类型
  provider?: string;               // 厂商（若是厂商级队列）

  // Bull getJobCounts() 快照
  waiting: number;                 // 等待中
  active: number;                  // 处理中
  completed: number;               // 已完成
  failed: number;                  // 已失败
  delayed: number;                 // 延迟中
  paused: number;                  // 已暂停

  // 计算指标
  depth: number;                   // 队列深度 = waiting + delayed
  throughputPerMin: number;        // 每分钟处理量（与上一快照差值计算）
}
```

**索引：**
```javascript
{ queueName: 1, timestamp: -1 }
{ timestamp: 1 }                   // TTL 索引，保留 7 天
```

### 8.9 provider_runtime_configs 集合（厂商全局配置，不含密钥）

> ⚠️ **v2.6 变更**：`api_key` 字段已从本集合移除，所有厂商 API 密钥统一存储在 `account_pool_entries` 集合中。详见 [8.10 统一密钥管理架构](#810-统一密钥管理架构)。

各厂商的 `base_url`、submit 路径 `limits`（`max_concurrent` / `max_per_second` / `max_per_minute`）及可选轮询路径 `poll_limits` **仅**从 Mongo 本集合读取（`ProviderConfigService`）；`config/*.json` / Nacos **不再**包含 `providers`。无文档或文档 `enabled === false` 时回退为代码内建默认 `base_url` 与限流。进程内短 TTL 刷新 + 管理端写入后 `invalidateAndRefresh`。

本集合**仅存储非密钥的全局配置**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `provider_name` | string | 厂商唯一标识（如 `wavespeed-ai`） |
| `enabled` | boolean | 厂商启用开关 |
| `icon_url` | string | 厂商图标 URL |
| `base_url` | string | 厂商 API 默认地址 |
| `extra` | object | 非密钥扩展字段（如 `region`、`subAppId`） |
| `limits` | object | 提交任务限流（`max_concurrent` / `max_per_second` / `max_per_minute`） |
| `poll_limits` | object | 轮询限流（`max_per_second` / `max_concurrent`） |
| `revision` | number | 版本号 |

- **限流键名**：submit 使用 `provider:{name}:qps` / `provider:{name}:concurrent`；轮询 query 使用 `provider:{name}:poll:qps` 及可选 `provider:{name}:poll:concurrent`，与 submit 隔离。
- **种子**：`npm run seed:providers:apply` 将 `seed/provider-runtime-configs.json` 写入 Mongo（首次部署或迁移用）。

### 8.10 统一密钥管理架构

> ★ v2.6 新增：将所有厂商 API 密钥从 `provider_runtime_configs` 收敛到 `account_pool_entries`，实现"密钥只有一个来源"。

#### 设计原则

| 原则 | 说明 |
|------|------|
| **单一来源** | 所有 API 密钥仅存储在 `account_pool_entries` 集合中 |
| **职责分离** | `provider_runtime_configs` 负责全局配置（地址、限流），`account_pool_entries` 负责认证凭据 |
| **特殊认证支持** | 通过 `extra_credentials` 字段支持 tencent-cloud 等需要多认证参数的厂商 |
| **向后兼容** | 过渡期通过 `secret_migration_complete` 标志控制降级行为 |

#### 密钥选择流程

```
请求发起
  └── AccountPoolService.selectAccount(provider)
        ├── 有可用账号 → 使用 account.api_key + account.extra_credentials
        └── 无可用账号
              ├── secret_migration_complete=false → 打印 deprecation 警告，尝试降级
              └── secret_migration_complete=true  → 抛出错误，提示配置账号池
```

#### account_pool_entries 密钥相关字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `api_key` | string | API 密钥（唯一来源） |
| `extra_credentials` | object | 扩展认证参数（如 tencent-cloud 的 `secretId`/`secretKey`/`region`） |
| `base_url` | string | 可选覆盖厂商默认地址 |

#### 各厂商认证结构

| 厂商 | api_key | extra_credentials |
|------|---------|-------------------|
| wavespeed-ai | Bearer Token | `{}` |
| cloudwise | Bearer Token | `{}` |
| akool | Bearer Token | `{}` |
| minimax | Bearer Token | `{ bizId }` |
| seedance | Bearer Token | `{}` |
| alibaba | Bearer Token | `{}` |
| tencent-cloud | — | `{ secretId, secretKey, region, subAppId }` |

#### 迁移指南

1. 执行迁移脚本：`npm run migrate:secrets`（将 provider_runtime_configs 中的密钥迁移到 account_pool_entries）
2. 验证迁移结果：检查 account_pool_entries 中每个厂商都有对应的 `{provider}-default` 条目
3. 部署新版本代码
4. 验证所有厂商请求正常
5. 执行清理脚本：`npm run cleanup:provider-secrets`（从 provider_runtime_configs 中移除密钥字段）
6. 设置 `secret_migration_complete: true`

---

## 9. 按功能队列隔离设计

> ★ v2.0 重构：按功能（featureType）拆分独立队列，避免不同功能之间的队列积压互相影响。参考 AGI-Content 中 `task_image_generate_queue`、`task_image2video_queue`、`task_characterSwap_queue` 等已有拆分实践。

### 9.1 设计原则

| 原则 | 说明 |
|------|------|
| **功能隔离** | 图片生成、图生视频、角色换装、视频超分 各自独立队列 |
| **厂商可拆** | 同一功能下可按厂商再拆子队列（如 Cloudwise 高并发需独立） |
| **独立扩缩** | 每个功能队列的 Worker 实例数可独立调整 |
| **统一管理** | 通过 `QueueRegistryService` 统一注册/发现/监控所有队列 |

### 9.2 队列拆分方案

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

### 9.3 完整队列清单

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

### 9.4 两级路由分发机制

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

### 9.5 功能级队列 Consumer（入口队列转发到厂商队列）

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

### 9.6 队列配置模板

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

### 9.7 回调队列配置

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

### 9.8 Job Data 结构

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

### 9.9 动态队列注册

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

### 9.10 队列与 Worker 进程映射

| Worker 进程 | 消费的队列 | PM2 实例数 |
|-------------|-----------|-----------|
| `worker-image-generate` | `image-generate`, `image-generate:*` | 2~N |
| `worker-image-to-video` | `image-to-video`, `image-to-video:*` | 2~N |
| `worker-character-swap` | `character-swap`, `character-swap:*` | 1~N |
| `worker-video-upscale` | `video-upscale`, `video-upscale:*` | 1~N |
| `worker-callback` | `callback`, `dead-letter` | 1~N |

---

## 10. 统一 API 设计

### 9.1 提交任务

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

### 9.2 查询任务

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
    "provider": "replicate",
    "result": {
      "output": ["https://replicate.delivery/xxx/output.png"],
      "metrics": {
        "predict_time": 3.45
      }
    },
    "createdAt": "2026-04-04T12:00:00.000Z",
    "submittedAt": "2026-04-04T12:00:01.000Z",
    "completedAt": "2026-04-04T12:00:05.000Z"
  }
}
```

### 9.3 查询任务列表

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

### 9.4 取消任务

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

### 9.5 回调重放（管理端）

```
POST /v1/admin/tasks/:taskId/replay-callback
X-Service-Token: <service_token>
```

### 9.6 错误码定义

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

### 9.7 回调 Payload 格式

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
  "event": "task.completed",
  "taskId": "01HXYZ1234567890ABCDEF",
  "status": "SUCCESS",
  "model": "text-to-image/sd-xl",
  "result": {
    "output": ["https://replicate.delivery/xxx/output.png"]
  },
  "metadata": {
    "userId": "user_123",
    "orderId": "order_456"
  },
  "timestamps": {
    "createdAt": "2026-04-04T12:00:00.000Z",
    "completedAt": "2026-04-04T12:00:05.000Z"
  }
}
```

---

## 11. 任务状态机设计

### 10.1 状态定义

| 状态 | 说明 | 进入条件 |
|------|------|----------|
| `PENDING` | 任务已创建，等待消费 | 创建任务 |
| `SUBMITTED` | 已提交到厂商 | Worker 成功调用厂商 API |
| `PROCESSING` | 厂商处理中 | 轮询发现厂商状态为处理中 |
| `SUCCESS` | 任务成功 | 厂商返回成功结果 |
| `FAILED` | 任务失败 | 厂商返回失败 / 不可重试错误 |
| `TIMEOUT` | 任务超时 | 超过最大轮询次数或时长 |
| `CANCELLED` | 任务已取消 | 用户请求取消 |

### 10.2 合法状态流转

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

### 10.3 状态流转约束

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

### 10.4 并发安全保障

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

## 12. 定时轮询策略

### 11.1 轮询调度器

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

### 11.2 动态轮询间隔

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

### 11.3 批量轮询实现

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

### 11.4 超时与异常处理

- **任务超时**：`pollCount >= maxPollCount` 或 `elapsed >= maxDuration` → 标记 `TIMEOUT`
- **厂商 429**：该厂商所有任务 `nextPollAt` 延后 60s
- **厂商 5xx**：延后 30s + 触发熔断计数
- **熔断**：连续 N 次失败后暂停该厂商轮询 5 分钟

### 11.5 轮询查询失败优雅重试 ★ v2.4 新增

> **背景**：`queryTask` 调用厂商 API 查询任务状态时，可能因厂商临时故障（502/503/429 等）抛出异常。v2.4 之前，异常直接 re-throw，`nextPollAt` 和 `pollCount` 均未更新，导致下一个 30s cron 周期立即重新拉取该任务"暴力重试"，产生大量 ERROR 日志且无退避。

#### 设计原则

| 原则 | 说明 |
|------|------|
| **复用 `mapError`** | 所有 Adapter 已实现 `mapError(err) → { code, message, retryable }`，轮询阶段直接复用，无需新增判断逻辑 |
| **可重试 vs 不可重试** | `retryable: true`（429/5xx）→ 退避重试；`retryable: false`（400/401/403）→ 直接标记 `FAILED` |
| **不消耗 pollCount** | 可重试错误使用 `deferNextPoll`（仅推迟 `nextPollAt`），不递增 `pollCount`，避免因上游临时故障导致任务被误判超时 |
| **退避策略** | `backoffMs = min(currentPollInterval × 2, maxIntervalMs)`，给上游恢复时间 |
| **及时释放资源** | 异常时提前释放并发令牌（`concToken`），避免占用并发槽位 |

#### 处理流程

```
queryTask(providerTaskId) 抛出异常
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

#### 各 Adapter `mapError` 可重试判定（已有实现）

| Adapter | 可重试条件 | 错误码格式 |
|---------|-----------|-----------|
| WaveSpeed | `status === 429 \|\| status >= 500` | `WAVESPEED_502` |
| Cloudwise | `status === 429 \|\| status >= 500` | `CLOUDWISE_503` |
| Akool | `status === 429 \|\| status >= 500` | `AKOOL_502` |
| MiniMax | `status === 429 \|\| status >= 500` | `MINIMAX_429` |
| Seedance | `status === 429 \|\| status >= 500` | `SEEDANCE_500` |
| Tencent | `RequestLimitExceeded \|\| InternalError` | `TENCENT_RequestLimitExceeded` |
| Wan | `status === 429 \|\| status >= 500` | `WAN_502` |

#### 与现有机制的对比

| 阶段 | 重试机制 | 退避策略 | 说明 |
|------|---------|---------|------|
| **提交阶段**（FeatureQueueProcessor） | Bull 队列自动重试 | Bull 内置指数退避 | `retryable` 时 throw → Bull 重试 |
| **轮询阶段**（PollingService）★ v2.4 | `deferNextPoll` 推迟 | `pollInterval × 2`，上限 `maxIntervalMs` | 不消耗 pollCount |
| **轮询限流** | `deferNextPoll` 推迟 | 固定 500ms / 1000ms | QPS/并发超限时 |
| **回调阶段**（CallbackProcessor） | Bull 队列自动重试 | 指数退避，超限进死信 | `maxRetries` 配置 |

#### 关键代码（`polling.service.ts` `pollSingleTask` catch 块）

```typescript
try {
  queryResult = await adapter.queryTask(providerTaskId);
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

## 13. 回调可靠性设计

### 12.1 签名算法

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

### 12.2 回调发送

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

### 12.3 重试策略

| 重试次数 | 延迟时间 | 累计等待 |
|---------|---------|---------|
| 第 1 次 | 1 分钟 | 1 分钟 |
| 第 2 次 | 5 分钟 | 6 分钟 |
| 第 3 次 | 15 分钟 | 21 分钟 |
| 第 4 次 | 1 小时 | 1 小时 21 分 |
| 第 5 次 | 6 小时 | 7 小时 21 分 |
| 第 6 次 | 24 小时 | 31 小时 21 分 |

### 12.4 死信处理

- 超过 6 次重试后，任务回调状态标记为 `DEAD_LETTER`
- 进入 `dead-letter` 队列保留
- 提供管理端接口 `POST /v1/admin/tasks/:taskId/replay-callback` 手动重放
- 告警通知运维人员

### 12.5 安全防护

- **URL 白名单**：可配置允许回调的域名列表
- **SSRF 防护**：禁止回调到内网地址（`10.x`、`192.168.x`、`127.0.0.1`、`localhost`）
- **防重放**：业务方校验 timestamp 在 5 分钟窗口内
- **签名校验**：业务方使用 `callbackSecret` 验证签名完整性

---

## 14. 安全方案

### 13.1 输入校验

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

### 13.2 鉴权方案

| 场景 | 方案 | Header |
|------|------|--------|
| 外部业务方 | API Key 鉴权 | `X-API-Key` |
| 内部微服务 | Service Token | `X-Service-Token` |
| 管理端 | JWT + RBAC | `Authorization: Bearer` |

### 13.3 限流策略

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

### 13.4 日志脱敏

```typescript
// 敏感字段列表
const SENSITIVE_FIELDS = ['apiKey', 'secret', 'password', 'token', 'callbackSecret', 'credentials'];

// 日志输出前自动脱敏
function sanitizeLog(data: any): any {
  // 递归遍历，将敏感字段值替换为 '***'
}
```

### 13.5 CORS 配置

```typescript
app.enableCors({
  origin: configService.get<string[]>('ALLOWED_ORIGINS'),  // 白名单
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'X-API-Key', 'X-Service-Token', 'X-Idempotency-Key'],
});
```

---

## 15. 可观测与告警

### 15.1 核心 Metrics（Prometheus）

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

### 15.2 统一错误日志系统

#### 15.2.1 ErrorLogger 工具类

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

#### 15.2.2 错误码体系

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

#### 15.2.3 错误日志覆盖范围

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
- [错误码定义](#96-错误码定义)
- [统一错误日志系统](#152-统一错误日志系统)
- [错误日志覆盖范围](#1523-错误日志覆盖范围)

### 15.3 日志规范

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

### 15.4 告警规则

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

## 16. 部署与扩展策略

### 15.1 部署架构

```
  ┌──────────────────────────────────────────────────────────────────┐
  │                        Load Balancer                              │
  │          :3000 (API)                :3001 (Admin)                 │
  └──────┬────────────────────────────────────┬──────────────────────┘
         │                                    │
  ┌──────┼────────────────┐     ┌─────────────┼──────────────────┐
  │      │   API Layer    │     │   ★ Admin Layer                │
  │ ┌────▼────┐ ┌────────┐│     │ ┌──────────────┐              │
  │ │API Node1│ │API NodeN││     │ │ Admin Server │ ← 管理后台   │
  │ │ :3000   │ │ :3000  ││     │ │ :3001        │   API +      │
  │ └────────┘ └────────┘│     │ │ (Nest+React) │   静态资源   │
  └───────────────────────┘     │ └──────────────┘              │
         │                      └────────────────────────────────┘
  ┌──────┼──────────────────────────────────────┐
  │      │            Worker Layer               │
  │ ┌────▼──────┐ ┌───────────┐ ┌────────────┐  │
  │ │Worker:img │ │Worker:vid │ │Worker:cb   │  │
  │ │(generate) │ │(to-video) │ │(callback)  │  │
  │ └───────────┘ └───────────┘ └────────────┘  │
  │ ┌───────────┐ ┌───────────┐                  │
  │ │Worker:swap│ │Worker:ups │                  │
  │ │(char-swap)│ │(upscale)  │                  │
  │ └───────────┘ └───────────┘                  │
  └──────────────────────┬───────────────────────┘
                         │
  ┌──────────────────────┼───────────────────────┐
  │   ┌─────────────┐   │   ┌─────────────┐     │
  │   │  Scheduler   │   │   │             │     │
  │   │(poll+stats)  │   │   │             │     │
  │   └─────────────┘   │   │             │     │
  └──────────────────────┼───────────────────────┘
                         │
  ┌──────────────────────┼───────────────────────┐
  │              ┌───────▼───────┐ ┌───────────┐ │
  │              │   MongoDB     │ │   Redis   │ │
  │              │  (Replica)    │ │ (Cluster) │ │
  │              └───────────────┘ └───────────┘ │
  └──────────────────────────────────────────────┘
```

### 15.2 进程分类

| 进程类型 | 职责 | 可扩展 | PM2 实例数 | 端口 |
|---------|------|--------|-----------|------|
| `api` | 接收业务请求，提交任务 | 水平扩展 | 2~N | 3000 |
| ★ `admin-server` | 管理后台 API + 前端静态资源 | 水平扩展 | 1~2 | 3001 |
| `worker-image-generate` | 图片生成队列消费 | 水平扩展 | 2~N | - |
| `worker-image-to-video` | 图生视频队列消费 | 水平扩展 | 2~N | - |
| `worker-character-swap` | 角色换装队列消费 | 水平扩展 | 1~N | - |
| `worker-video-upscale` | 视频超分队列消费 | 水平扩展 | 1~N | - |
| `worker-callback` | 回调队列消费 | 水平扩展 | 1~N | - |
| `scheduler` | 定时轮询 + 统计聚合 | 单实例+分布式锁 | 1~2 | - |

### 15.3 PM2 配置

```javascript
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'model-hub-api',
      script: 'dist/main.js',
      instances: 2,
      exec_mode: 'cluster',
      max_memory_restart: '500M',
      env: { PROCESS_TYPE: 'api', PORT: 3000 },
    },
    // ★ v2.1 新增：管理后台服务
    {
      name: 'model-hub-admin-server',
      script: 'dist/main.js',
      instances: 1,
      max_memory_restart: '400M',
      env: { PROCESS_TYPE: 'admin-server', ADMIN_PORT: 3001 },
    },
    {
      name: 'model-hub-worker-image-generate',
      script: 'dist/main.js',
      instances: 2,
      exec_mode: 'cluster',
      max_memory_restart: '500M',
      env: { PROCESS_TYPE: 'worker-image-generate' },
    },
    {
      name: 'model-hub-worker-image-to-video',
      script: 'dist/main.js',
      instances: 2,
      exec_mode: 'cluster',
      max_memory_restart: '500M',
      env: { PROCESS_TYPE: 'worker-image-to-video' },
    },
    {
      name: 'model-hub-worker-character-swap',
      script: 'dist/main.js',
      instances: 1,
      max_memory_restart: '400M',
      env: { PROCESS_TYPE: 'worker-character-swap' },
    },
    {
      name: 'model-hub-worker-video-upscale',
      script: 'dist/main.js',
      instances: 1,
      max_memory_restart: '400M',
      env: { PROCESS_TYPE: 'worker-video-upscale' },
    },
    {
      name: 'model-hub-worker-callback',
      script: 'dist/main.js',
      instances: 1,
      max_memory_restart: '300M',
      env: { PROCESS_TYPE: 'worker-callback' },
    },
    {
      name: 'model-hub-scheduler',
      script: 'dist/main.js',
      instances: 1,
      max_memory_restart: '300M',
      env: { PROCESS_TYPE: 'scheduler' },
    },
  ],
};
```

### 15.4 Docker 化（含管理后台前端构建）

```dockerfile
# Stage 1: 构建前端
FROM node:18-alpine AS dashboard-builder
WORKDIR /app/dashboard
COPY dashboard/package*.json ./
RUN npm ci
COPY dashboard/ .
RUN npm run build

# Stage 2: 构建后端
FROM node:18-alpine AS backend-builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && cp -R node_modules /prod_node_modules
RUN npm ci
COPY . .
RUN npm run build

# Stage 3: 生产镜像
FROM node:18-alpine
WORKDIR /app
COPY --from=backend-builder /prod_node_modules ./node_modules
COPY --from=backend-builder /app/dist ./dist
COPY --from=backend-builder /app/package.json ./
COPY --from=dashboard-builder /app/dashboard/dist ./dashboard/dist
COPY ecosystem.config.js ./

RUN npm install -g pm2
EXPOSE 3000 3001
CMD ["pm2-runtime", "ecosystem.config.js"]
```

### 15.5 扩展策略

| 场景 | 策略 |
|------|------|
| 提交 QPS 增加 | 增加 API 实例 |
| 队列积压 | 增加对应功能 Worker 实例 |
| 回调积压 | 增加 Worker-Callback 实例 |
| 新增厂商 | 仅新增 Adapter + 配置 |
| 大客户隔离 | 创建独立队列 + 独立 Worker |
| 结果大对象 | 结果落 S3/OSS，任务中仅存 URL |
| ★ 管理后台访问增加 | 增加 Admin Server 实例 |

---

## 17. 测试策略

### 16.1 测试金字塔

| 层级 | 覆盖内容 | 工具 | 覆盖率要求 |
|------|---------|------|-----------|
| **单元测试** | Service、Adapter、工具函数 | Jest | > 80% |
| **集成测试** | Controller + DB + Queue | Jest + MongoDB Memory | > 60% |
| **端到端测试** | 完整流程（提交→轮询→回调） | Jest + Supertest | 核心流程 100% |
| **压测** | 吞吐量、延迟、稳定性 | k6 / Artillery | - |
| **故障演练** | Redis 断连、厂商超时 | 手动注入 | - |

### 16.2 单元测试重点

- 状态机流转合法性
- Adapter 请求/响应映射
- 签名生成与校验
- 幂等检查逻辑
- 轮询间隔计算
- 输入校验 DTO

### 16.3 集成测试重点

- 任务创建到入队全流程
- Worker 消费并更新状态
- 轮询调度并状态同步
- 回调发送与重试
- 并发状态更新冲突处理
- 死信队列处理

### 16.4 压测场景

- 提交接口峰值：5000 TPS 持续 5 分钟
- 队列积压恢复：堆积 10 万 Job 后观察恢复时间
- 回调风暴：1000 个任务同时完成触发回调
- 长时间稳定性：72 小时持续运行

---

## 18. 迭代路线图

### Phase 1：MVP（2~3 周）

- [x] 项目脚手架搭建（NestJS + TypeScript）
- [ ] 统一提交/查询 API
- [ ] MongoDB Schema + 基础 CRUD
- [ ] Bull 队列：按功能拆分（image-generate / image-to-video / character-swap / video-upscale）
- [ ] WaveSpeed + Cloudwise + Akool 三个厂商 Adapter
- [ ] 基础轮询调度器
- [ ] 基础回调发送（无签名、无重试）
- [ ] API Key 鉴权
- [ ] 任务 timing 字段记录（排队/处理/端到端时长）
- [ ] 任务 timeline 时间线基础埋点
- [ ] 基础 PM2 部署（api + worker-* + scheduler）
- [ ] 核心流程单元测试

### Phase 2：生产就绪（3~4 周）

- [ ] 回调签名 + 重试 + 死信
- [ ] 幂等性保障
- [ ] 状态机严格约束 + 乐观锁
- [ ] 分布式锁轮询 + 动态轮询间隔
- [ ] 厂商级限流
- [x] 多服务商热切换（`model_routing_rules` + fixed/weighted/primary_fallback + 管理端 CRUD；见 §6）
- [ ] 「主挂了再切备」健康感知故障转移（见 §6.8 TODO）
- [ ] 按功能队列隔离 + 厂商级子队列
- [ ] 队列消费情况实时统计（queue_snapshots）
- [ ] 每日/每月数据聚合统计（task_daily_stats / task_monthly_stats）
- [ ] 输入校验完善 + 日志脱敏
- [ ] Prometheus Metrics + 告警配置
- [ ] 集成测试 + 压测

### Phase 3：管理后台（2~3 周）

- [ ] 管理后台后端服务（admin-server，独立 PROCESS_TYPE）
- [ ] 管理后台前端搭建（React + Ant Design + Vite）
- [ ] Dashboard 总览页（核心指标 + 趋势图表）
- [ ] 任务管理页（列表/详情/时间线/时长甘特图/回调重放）
- [ ] 队列监控页（实时面板 + 历史趋势 + 队列管理操作）
- [ ] 路由管理页（对接 `model_routing_rules` CRUD；灰度权重/主备表单，见 §24.5.4）
- [ ] 统计报表页（每日/每月统计 + 厂商对比 + 导出）
- [ ] 系统设置页（厂商配置/告警规则/用户管理/操作日志）
- [ ] 管理后台独立鉴权（JWT 登录 + RBAC 角色）
- [ ] 前端构建集成（Vite build → NestJS ServeStatic 托管）

### Phase 4：治理增强（持续）

- [ ] 更多厂商 Adapter（按需扩展）
- [ ] 租户级队列隔离
- [ ] 动态路由（成功率/成本/延迟择优）
- [ ] 多厂商 Fallback / 降级
- [ ] 成本分析与计费对账
- [ ] OpenTelemetry 全链路追踪
- [ ] 自动弹性扩缩容
- [ ] 管理后台 Dashboard 高级功能（实时 WebSocket 推送、告警联动）

---

## 19. 关键风险与规避

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

## 20. 队列消费情况统计

> ★ v2.0 新增：对每个功能队列、每个厂商级子队列的排队/消费情况进行实时采集与展示。

### 20.1 采集机制

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

### 20.2 实时查询接口

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

### 20.3 历史趋势查询

```
GET /v1/admin/queues/stats/history?queueName=image-generate:wavespeed-ai&from=2026-04-04T00:00:00Z&to=2026-04-04T23:59:59Z&interval=5m
```

返回按时间间隔聚合的队列深度、吞吐量趋势数据，供 Dashboard 绘图。

### 20.4 告警规则集成

| 指标 | 告警条件 | 级别 |
|------|---------|------|
| 队列深度 | 任意功能队列 depth > 1000 持续 5 分钟 | P2 |
| 队列深度 | 任意厂商队列 depth > 5000 持续 3 分钟 | P1 |
| 吞吐量 | 某队列 throughputPerMin 降为 0 持续 5 分钟 | P1 |
| 失败率 | 某队列 failed/(completed+failed) > 10% 持续 5 分钟 | P2 |

### 20.5 Prometheus Metrics 导出

```typescript
// 为每个队列导出 Gauge
modelhub_queue_depth{queue="image-generate:wavespeed-ai", feature="image_generate", provider="wavespeed-ai"}
modelhub_queue_active{queue="image-generate:wavespeed-ai", feature="image_generate", provider="wavespeed-ai"}
modelhub_queue_throughput_per_min{queue="image-generate:wavespeed-ai", feature="image_generate", provider="wavespeed-ai"}
modelhub_queue_failed_total{queue="image-generate:wavespeed-ai", feature="image_generate", provider="wavespeed-ai"}
```

---

## 21. 任务数据聚合统计

> ★ v2.0 新增：按功能、模型、厂商维度进行每日/每月数据聚合，支持运营分析和成本核算。

### 21.1 聚合维度

| 维度 | 字段 | 示例 |
|------|------|------|
| 时间 | date / month | `"2026-04-04"` / `"2026-04"` |
| 功能 | featureType | `"image_generate"` |
| 厂商 | provider | `"wavespeed-ai"` |
| 模型 | model | `"wavespeed-ai/flux-2-pro/text-to-image"` |

### 21.2 聚合指标

| 指标类别 | 具体指标 |
|---------|---------|
| **任务量** | totalCount, successCount, failedCount, timeoutCount, cancelledCount |
| **成功率** | successRate = successCount / totalCount |
| **时长** | avgQueueWaitMs, avgProviderProcessMs, avgTotalE2eMs |
| **分位数** | p50E2eMs, p95E2eMs, p99E2eMs, maxE2eMs |
| **回调** | callbackSuccessCount, callbackFailedCount |

### 21.3 聚合调度

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

### 21.4 每日聚合实现（MongoDB Aggregation Pipeline）

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

### 21.5 统计查询接口

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

### 21.6 对比分析

支持同一模型在不同厂商之间的性能/成功率对比：

```
GET /v1/admin/stats/compare?model=text-to-image&from=2026-04-01&to=2026-04-04
```

返回 wavespeed-ai / cloudwise / akool 在同一模型上的并排数据，辅助厂商切换决策。

---

## 22. 任务时长精确跟踪

> ★ v2.0 新增：记录每条任务在各阶段的精确时间点，计算等待时长和实际处理时长。

### 22.1 时长指标定义

| 指标 | 计算方式 | 说明 |
|------|---------|------|
| **排队等待时长** | `dequeuedAt - enqueuedAt` | 任务在 Bull 队列中等待被消费的时间 |
| **厂商处理时长** | `providerCompletedAt - submittedAt` | 从提交厂商到厂商返回结果的时间 |
| **端到端总时长** | `completedAt - receivedAt` | 从 API 收到请求到任务最终完成的总时间 |
| **回调延迟** | `callbackSentAt - completedAt` | 从任务完成到回调成功发送的时间 |
| **Hub 内部开销** | `totalE2eMs - queueWaitMs - providerProcessMs` | 系统自身消耗的时间 |

### 22.2 时间点采集位置

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

### 22.3 计算字段自动填充

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

### 22.4 慢任务告警

| 告警 | 条件 | 级别 |
|------|------|------|
| 排队等待过长 | `queueWaitMs > 60000` (1 分钟) | P3 |
| 排队等待严重 | `queueWaitMs > 300000` (5 分钟) | P2 |
| 厂商处理超时 | `providerProcessMs > maxDuration` | P2 |
| 端到端超时 | `totalE2eMs > 2 * 厂商 SLA` | P2 |

### 22.5 查询接口

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

## 23. 任务处理日志时间线

> ★ v2.0 新增：为每条任务记录完整的生命周期事件时间线，便于后续问题排查和链路分析。

### 23.1 时间线事件类型

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

### 23.2 时间线写入工具

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

### 23.3 在各关键节点埋点

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

### 23.4 时间线查询接口

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

### 23.5 时间线数据管理

- **存储位置**：内嵌在 `tasks` 集合的 `timeline` 数组中（单任务事件通常 < 30 条，不会导致文档膨胀问题）
- **数据保留**：随 tasks 文档生命周期；若需长期保留，可定期归档到 `task_timeline_archive` 集合
- **查询优化**：timeline 按时间顺序追加，查询时无需排序
- **调试用途**：
  - 定位任务在哪个阶段耗时最长
  - 排查厂商提交失败的具体错误
  - 分析回调重试历史
  - 追溯路由决策（切换厂商前后对比）

---

## 24. 管理后台设计

> ★ v2.1 新增：管理后台（Dashboard）用于可视化展示任务统计、队列监控、路由管理、任务调试等功能。  
> 前端与后端 API 放在同一项目 `model-hub` 中，通过不同 `PROCESS_TYPE` 启动为不同服务。

### 24.1 总体架构：同项目双服务

```
model-hub/                          # 同一个 Git 仓库
├── src/                            # 后端（NestJS）
│   ├── main.ts                     # PROCESS_TYPE 分发
│   ├── admin/                      # 管理后台 API
│   ├── dashboard/                  # DashboardModule（仅 admin-server 加载）
│   │   └── dashboard.module.ts     # 注册 ServeStaticModule → 托管前端产物
│   └── ...                         # 其他业务模块
│
├── dashboard/                      # 前端（React + Ant Design）
│   ├── src/
│   ├── public/
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.json
│
└── ecosystem.config.js             # PM2：api / worker-* / scheduler / admin-server
```

**两个独立服务进程：**

| 服务 | PROCESS_TYPE | 端口 | 职责 |
|------|-------------|------|------|
| **API Server** | `api` | 3000 | 业务 API（提交任务/查询任务/回调等） |
| **Admin Server** | `admin-server` | 3001 | 管理后台 API + 托管前端 SPA 静态资源 |

**为什么分开：**
- API Server 面向业务系统调用，高频高并发，鉴权方式为 API Key / Service Token
- Admin Server 面向运营/运维人员，低频，鉴权方式为 JWT 登录，加载的模块不同
- 独立部署、独立扩缩容、互不影响
- 前端构建产物通过 `@nestjs/serve-static` 静态托管，无需独立 Nginx

### 24.2 进程启动分发

```typescript
// src/main.ts
async function bootstrap() {
  const processType = process.env.PROCESS_TYPE || 'api';

  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  if (processType === 'api') {
    app.enableCors({ origin: configService.get('ALLOWED_ORIGINS') });
    await app.listen(process.env.PORT || 3000);
  } else if (processType === 'admin-server') {
    app.enableCors({ origin: configService.get('ADMIN_ALLOWED_ORIGINS') });
    await app.listen(process.env.ADMIN_PORT || 3001);
  } else {
    await app.init(); // worker / scheduler
  }
}
```

```typescript
// src/app.module.ts
@Module({
  imports: [
    ConfigModule, DatabaseModule, RedisModule, ObservabilityModule,

    // API Server 专用
    ...(isApi() ? [AuthModule, TaskModule, QueueModule, HealthModule] : []),

    // Admin Server 专用
    ...(isAdminServer() ? [
      AdminModule,       // 管理后台 API
      StatsModule,       // 统计聚合
      DashboardModule,   // 静态资源托管
    ] : []),

    // Worker 专用
    ...(isWorker() ? [QueueModule, ProviderModule, CallbackModule] : []),

    // Scheduler 专用
    ...(isScheduler() ? [PollingModule, ProviderModule, StatsModule] : []),
  ],
})
export class AppModule {}

function isAdminServer(): boolean {
  return process.env.PROCESS_TYPE === 'admin-server';
}
```

### 24.3 DashboardModule（静态资源托管）

```typescript
// src/dashboard/dashboard.module.ts
import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'dashboard', 'dist'),
      serveRoot: '/',                    // SPA 根路径
      exclude: ['/api/(.*)'],            // 排除 API 路径
      serveStaticOptions: {
        fallthrough: true,               // SPA 路由回退到 index.html
      },
    }),
  ],
})
export class DashboardModule {}
```

访问方式：
- 管理后台页面：`http://admin-host:3001/`
- 管理后台 API：`http://admin-host:3001/api/v1/admin/...`

### 24.4 管理后台功能模块总览

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Model-Hub 管理后台                            │
├──────────┬──────────┬──────────┬──────────┬──────────┬──────────────┤
│  总览    │  任务    │  队列    │  路由    │  统计    │  系统        │
│ Dashboard│ 管理     │ 监控     │ 管理     │ 报表     │ 设置        │
├──────────┼──────────┼──────────┼──────────┼──────────┼──────────────┤
│ 核心指标 │ 任务列表 │ 实时状态 │ 路由列表 │ 每日统计 │ 厂商配置    │
│ 趋势图表 │ 任务详情 │ 历史趋势 │ 权重配置 │ 每月统计 │ 告警规则    │
│ 告警通知 │ 时间线   │ 队列管理 │ 灰度切换 │ 厂商对比 │ 操作日志    │
│ 快捷操作 │ 回调重放 │ 积压告警 │ 切换历史 │ 导出报表 │ 用户管理    │
└──────────┴──────────┴──────────┴──────────┴──────────┴──────────────┘
```

### 24.5 页面设计详细

#### 24.5.1 总览 Dashboard（首页）

**核心指标卡片（实时）：**

| 指标 | 数据源 | 刷新频率 |
|------|--------|---------|
| 今日任务总量 | `GET /api/v1/admin/overview` → `today.totalTasks` | 30s |
| 今日成功率 | 同上 → `today.successRate` | 30s |
| ★ 全部任务总量 | 同上 → `total.totalTasks` | 30s |
| ★ 全部成功率 | 同上 → `total.successRate` | 30s |
| 当前队列总深度 | 同上 → `queues.totalDepth` | 30s |
| 当前处理中任务 | 同上 → `queues.totalActive` | 30s |

> ★ v2.5 新增：顶部统计行从 4 列（`lg={6}`）扩展为 6 列（`lg={4}`），新增"全部任务总量"和"全部成功率"卡片，与今日数据形成对比展示。

**详情卡片区域：**

| 卡片 | 内容 | 数据源 |
|------|------|--------|
| 今日任务统计 | 成功 / 失败 / 超时 / 总量（4 列） | `today.*` |
| ★ 全部数据统计 | 成功 / 失败 / 超时 / 总量（4 列） | `total.*` |
| 队列状态 | 等待+延迟 / 处理中 | `queues.*` |

> ★ v2.5 新增："全部数据统计" Card 与"今日任务统计" Card 使用相同的 Row + 4 列 Col 布局和颜色编码（成功绿色 #52c41a、失败红色 #ff4d4f、超时黄色 #faad14），保持视觉一致性。

**页面布局（v2.5 更新）：**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  顶部统计行（Row 6 列，每列 lg={4}）                                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │今日任务  │ │今日成功率│ │★全部任务 │ │★全部成功率│ │队列深度  │ │处理中    │ │
│  │  总量    │ │          │ │  总量    │ │          │ │          │ │          │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘ │
├─────────────────────────────────────────────────────────────────────────────┤
│  中部详情行（Row 3 列）                                                      │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐                │
│  │ 今日任务统计     │ │ ★全部数据统计   │ │ 队列状态         │                │
│  │ 成功/失败/超时/  │ │ 成功/失败/超时/  │ │ 等待+延迟/处理中 │                │
│  │ 总量             │ │ 总量             │ │                  │                │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘                │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Overview API 响应结构（v2.5 更新）：**

```typescript
// GET /api/v1/admin/overview
{
  code: 0,
  data: {
    today: {
      totalTasks: number,
      successTasks: number,
      failedTasks: number,
      timeoutTasks: number,
      cancelledTasks: number,
      successRate: number       // 基于已完结任务计算，保留两位小数
    },
    total: {                    // ★ v2.5 新增：全部历史累计统计
      totalTasks: number,
      successTasks: number,
      failedTasks: number,
      timeoutTasks: number,
      cancelledTasks: number,
      successRate: number       // 计算公式与 today 一致
    },
    queues: {
      totalDepth: number,
      totalActive: number
    },
    snapshotAt: Date
  }
}
```

**后端实现要点（v2.5）：**

- `StatsService` 新增 `getAllTimeStats()` 方法，复用 `getTodayRealtimeStats()` 的 aggregation pipeline 结构，仅移除 `createdAt` 时间范围过滤条件
- `AdminStatsController.getOverview()` 使用 `Promise.all` 并行调用 `getAllTimeStats()`、`getTodayRealtimeStats()` 和 `getLatestStats()`
- 空集合时返回全零默认值
- `successRate` 计算公式：`Math.round((successTasks / completedTasks) * 10000) / 100`，`completedTasks = successTasks + failedTasks + timeoutTasks + cancelledTasks`

**前端防御性处理（v2.5）：**

- `data?.total || {}` 防御 `total` 字段为空
- 所有数值使用 `|| 0` 兜底
- `successRate?.toFixed(1) || '0.0'` 防御 NaN

**性能考量（v2.5）：**

全量聚合需扫描整个 `tasks` 集合。当前数据量级（数十万级）可在合理时间内完成。未来数据量增长到百万级以上时可考虑：
- 使用 `task_daily_stats` 预聚合表进行 `$sum` 汇总（需额外处理当日未聚合数据）
- 引入 Redis 缓存，设置较短 TTL（如 60 秒）

**趋势图表（ECharts）：**

- 24 小时任务量趋势（按功能分色折线）
- 24 小时成功率趋势（按厂商分色折线）
- 队列深度变化趋势
- P95 端到端时长趋势

**快捷操作：**
- 一键查看异常任务列表
- 跳转到队列积压页
- 跳转到厂商路由切换

#### 24.5.2 任务管理页

**任务列表（表格 + 筛选）：**

| 列 | 说明 |
|----|------|
| TaskId | 任务 ID（链接到详情） |
| 状态 | PENDING/SUBMITTED/PROCESSING/SUCCESS/FAILED（彩色标签） |
| 功能类型 | image_generate / image_to_video / ... |
| 模型 | wavespeed-ai/flux-2-pro/... |
| 厂商 | wavespeed-ai / cloudwise / akool |
| 排队等待 | queueWaitMs（色阶：绿 < 5s，黄 5-30s，红 > 30s） |
| 厂商处理 | providerProcessMs |
| 总时长 | totalE2eMs |
| 创建时间 | createdAt |
| 操作 | 查看详情 / 查看时间线 / 重放回调 |

**筛选条件：**
- 状态（多选）
- 功能类型（多选）
- 厂商（多选）
- 时间范围（日期选择器）
- TaskId / BizId 搜索

**对应 API：**
```
GET /api/v1/admin/tasks?status=FAILED&featureType=image_generate&provider=wavespeed-ai&from=...&to=...&page=1&pageSize=20
```

**任务详情页（Drawer / 子页面）：**

| 区域 | 内容 |
|------|------|
| 基础信息 | taskId, model, provider, featureType, status, priority |
| 时长指标 | timing 所有字段，可视化甘特图展示各阶段耗时 |
| 时间线 | 完整 timeline 事件列表（Steps 组件展示） |
| 请求/响应 | requestPayload（脱敏）、resultPayload |
| 回调信息 | callback 状态、重试次数、回调日志 |
| 错误信息 | error 详情（仅失败任务） |
| 操作 | 重放回调按钮 / 取消任务按钮 |

**对应 API：**
```
GET  /api/v1/admin/tasks/:taskId
GET  /api/v1/admin/tasks/:taskId/timing
GET  /api/v1/admin/tasks/:taskId/timeline
POST /api/v1/admin/tasks/:taskId/replay-callback
```

#### 24.5.3 队列监控页

**实时面板（自动刷新 10s）：**

按功能分组展示每个队列的卡片：

```
┌──────────────────────────────────────────────────────┐
│  image-generate                                       │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐  │
│  │ wavespeed-ai │ │  cloudwise   │ │    akool     │  │
│  │ waiting: 23  │ │ waiting: 0   │ │ waiting: 5   │  │
│  │ active:  10  │ │ active:  45  │ │ active:  12  │  │
│  │ failed:  2   │ │ failed:  0   │ │ failed:  1   │  │
│  │ depth:   28  │ │ depth:   0   │ │ depth:   5   │  │
│  │ 34.5/min     │ │ 120.3/min    │ │ 18.7/min     │  │
│  └──────────────┘ └──────────────┘ └──────────────┘  │
├──────────────────────────────────────────────────────┤
│  image-to-video                                       │
│  ┌──────────────┐ ┌──────────────┐                    │
│  │ wavespeed-ai │ │    akool     │                    │
│  │ ...          │ │ ...          │                    │
│  └──────────────┘ └──────────────┘                    │
└──────────────────────────────────────────────────────┘
```

**历史趋势：**
- 选择队列 → 展示 24h / 7d 的深度/吞吐量折线图
- 对应 `GET /api/v1/admin/queues/stats/history`

**队列管理：**
- 新增厂商级子队列（动态注册）
- 暂停/恢复队列
- 清空死信队列
- 对应 `POST /api/v1/admin/queues`、`POST /api/v1/admin/queues/:name/pause`

#### 24.5.4 路由管理页（与 v2.2 `model_routing_rules` 对齐）

**路由列表（表格）：**

| 列 | 说明 |
|----|------|
| 模型标识 | `model_name` |
| 客户端 | `client_id`（空 = 全站） |
| 策略 | `fixed` / `weighted` / `primary_fallback` |
| 目标厂商 | 随策略展示（固定单厂商、多目标权重、主备及权重） |
| 优先级 / 生效期 | `priority`、`effective_from`～`effective_until` |
| 状态 | `enabled` |
| 操作 | 编辑 / 禁用 / 删除 |

**表单能力（建议）：**
- **fixed**：选择单一 `provider`
- **weighted**：多行 `provider` + `weight`，校验权重和 > 0
- **primary_fallback**：主/备、`primary_weight` / `fallback_weight`（或仅主、备权重为 0）
- 可选 `note` 备注灰度原因

**说明：** 早期草案中的「switchHistory / 一键回退专用接口」未实现；回退通过禁用规则、改权重或 `effective_until` 完成（见 §6.6）。

**对应 API（已实现）：**
```
GET    /api/v1/admin/model-routing-rules
POST   /api/v1/admin/model-routing-rules
PUT    /api/v1/admin/model-routing-rules/:id
DELETE /api/v1/admin/model-routing-rules/:id
```

**管理端前端（v2.2 已接入）：** Dashboard 侧栏 **「路由规则」**，路由路径 `/model-routing-rules`，实现文件 `dashboard/src/pages/ModelRoutingRules.tsx`（列表 / 新建 / 编辑 / 删除，表单覆盖 fixed、weighted、primary_fallback）。

#### 24.5.5 统计报表页

**每日统计（Tab 1）：**
- 日期选择器（单日 / 范围）
- 筛选：功能类型、厂商、模型
- 表格：每日各维度的任务量 / 成功率 / 各时长指标
- 图表：趋势折线图（可叠加多指标）

**每月统计（Tab 2）：**
- 月份选择器
- 同上结构

**厂商对比（Tab 3）：**
- 选择模型 → 展示不同厂商的并排对比
- 对比维度：成功率、P50/P95/P99 时长、任务量
- 雷达图 + 对比表格
- 辅助路由切换决策

**导出功能：**
- CSV / Excel 导出按钮
- 通过前端 `xlsx` 库生成，不需后端额外接口

**对应 API：**
```
GET /api/v1/admin/stats/daily
GET /api/v1/admin/stats/monthly
GET /api/v1/admin/stats/compare
```

#### 24.5.6 系统设置页

**厂商配置管理：**
- 查看当前已注册的厂商列表
- 厂商状态（健康 / 降级 / 熔断）
- 限流参数查看

**告警规则管理：**
- 查看/编辑告警阈值
- 告警历史记录
- 告警通知渠道配置

**操作日志（审计）：**
- 记录所有管理后台操作（路由切换、回调重放、队列操作等）
- 操作人 / 时间 / 操作类型 / 详情

**用户管理（基础）：**
- 管理后台用户列表
- 角色权限（admin / viewer）
- 登录日志

### 24.6 管理后台鉴权方案

**独立于业务 API 的鉴权流程：**

```
管理后台登录
    │
    ├── POST /api/v1/admin/auth/login
    │   Body: { username, password }
    │   Response: { accessToken, refreshToken, user }
    │
    ├── JWT Token 存储在前端 localStorage
    │
    ├── 后续请求携带 Authorization: Bearer <accessToken>
    │
    └── Token 过期 → POST /api/v1/admin/auth/refresh
```

**RBAC 角色：**

| 角色 | 权限 |
|------|------|
| `admin` | 全部操作：路由切换、队列管理、回调重放、用户管理 |
| `operator` | 查看 + 操作：查看所有页面、执行回调重放、队列暂停/恢复 |
| `viewer` | 只读：查看所有页面，不能执行任何修改操作 |

```typescript
// src/admin/guards/admin-jwt.guard.ts
@Injectable()
export class AdminJwtGuard extends AuthGuard('admin-jwt') {}

// src/admin/decorators/roles.decorator.ts
export const Roles = (...roles: AdminRole[]) => SetMetadata('roles', roles);

// src/admin/guards/roles.guard.ts
@Injectable()
export class RolesGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.get<AdminRole[]>('roles', context.getHandler());
    const user = context.switchToHttp().getRequest().user;
    return requiredRoles.includes(user.role);
  }
}
```

### 24.7 管理后台 API 清单

> Admin Server 所有 API 统一前缀 `/api/v1/admin`，使用 `AdminJwtGuard` 鉴权。

| 模块 | 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|------|
| **Auth** | POST | `/auth/login` | 无 | 登录 |
| **Auth** | POST | `/auth/refresh` | 无 | 刷新 Token |
| **Auth** | GET | `/auth/me` | all | 获取当前用户信息 |
| **Dashboard** | GET | `/dashboard/overview` | all | 总览核心指标 |
| **Dashboard** | GET | `/dashboard/trends` | all | 24h 趋势数据 |
| **Tasks** | GET | `/tasks` | all | 任务列表（分页+筛选） |
| **Tasks** | GET | `/tasks/:taskId` | all | 任务详情 |
| **Tasks** | GET | `/tasks/:taskId/timing` | all | 任务时长 |
| **Tasks** | GET | `/tasks/:taskId/timeline` | all | 任务时间线 |
| **Tasks** | POST | `/tasks/:taskId/replay-callback` | operator+ | 回调重放 |
| **Tasks** | POST | `/tasks/:taskId/cancel` | operator+ | 取消任务 |
| **Queues** | GET | `/queues/stats` | all | 队列实时状态 |
| **Queues** | GET | `/queues/stats/history` | all | 队列历史趋势 |
| **Queues** | POST | `/queues` | admin | 注册新队列 |
| **Queues** | POST | `/queues/:name/pause` | operator+ | 暂停队列 |
| **Queues** | POST | `/queues/:name/resume` | operator+ | 恢复队列 |
| **Queues** | DELETE | `/queues/:name/dead-letter` | admin | 清空死信 |
| **Routes** | GET | `/routes` | all | 路由列表 |
| **Routes** | GET | `/routes/:routeId` | all | 路由详情 |
| **Routes** | POST | `/routes/:routeId/switch` | admin | 切换厂商 |
| **Routes** | POST | `/routes/:routeId/rollback` | admin | 回退路由 |
| **Routes** | GET | `/routes/:routeId/history` | all | 切换历史 |
| **Stats** | GET | `/stats/daily` | all | 每日统计 |
| **Stats** | GET | `/stats/monthly` | all | 每月统计 |
| **Stats** | GET | `/stats/compare` | all | 厂商对比 |
| **Providers** | GET | `/providers` | all | 厂商列表与状态 |
| **Providers** | GET | `/providers/:name/health` | all | 厂商健康状态 |
| **AuditLogs** | GET | `/audit-logs` | admin | 操作日志列表 |
| **Users** | GET | `/users` | admin | 用户列表 |
| **Users** | POST | `/users` | admin | 创建用户 |
| **Users** | PUT | `/users/:id` | admin | 更新用户 |
| **Users** | DELETE | `/users/:id` | admin | 删除用户 |

### 24.8 前端路由设计

```typescript
const routes = [
  { path: '/login',              component: LoginPage,          auth: false },
  { path: '/',                   component: DashboardPage,      auth: true,  roles: ['admin','operator','viewer'] },
  { path: '/tasks',              component: TaskListPage,       auth: true,  roles: ['admin','operator','viewer'] },
  { path: '/tasks/:taskId',      component: TaskDetailPage,     auth: true,  roles: ['admin','operator','viewer'] },
  { path: '/queues',             component: QueueMonitorPage,   auth: true,  roles: ['admin','operator','viewer'] },
  { path: '/routes',             component: RouteManagePage,    auth: true,  roles: ['admin','operator','viewer'] },
  { path: '/stats',              component: StatsReportPage,    auth: true,  roles: ['admin','operator','viewer'] },
  { path: '/stats/compare',      component: ProviderComparePage,auth: true,  roles: ['admin','operator','viewer'] },
  { path: '/settings/providers', component: ProviderConfigPage, auth: true,  roles: ['admin'] },
  { path: '/settings/alerts',    component: AlertConfigPage,    auth: true,  roles: ['admin'] },
  { path: '/settings/users',     component: UserManagePage,     auth: true,  roles: ['admin'] },
  { path: '/audit-logs',         component: AuditLogPage,       auth: true,  roles: ['admin'] },
];
```

### 24.9 前端组件设计

**布局组件：**

```
┌─────────────────────────────────────────────────────┐
│  Header                                              │
│  ┌──────┐ Model-Hub 管理后台     [用户头像] [退出]   │
│  │ Logo │                                            │
│  └──────┘                                            │
├──────────┬──────────────────────────────────────────┤
│ Sidebar  │  Content Area                             │
│          │                                           │
│ 📊 总览  │  ┌────────────────────────────────────┐   │
│ 📋 任务  │  │                                    │   │
│ 📦 队列  │  │       Page Content                 │   │
│ 🔀 路由  │  │                                    │   │
│ 📈 统计  │  │                                    │   │
│ ⚙ 设置  │  │                                    │   │
│   ├ 厂商 │  │                                    │   │
│   ├ 告警 │  └────────────────────────────────────┘   │
│   └ 用户 │                                           │
│ 📝 日志  │                                           │
│          │                                           │
├──────────┴──────────────────────────────────────────┤
│  Footer: Model-Hub v2.1 | 连接状态: ● 正常            │
└─────────────────────────────────────────────────────┘
```

**核心业务组件清单：**

| 组件 | 文件 | 用途 |
|------|------|------|
| `StatCard` | `components/StatCard.tsx` | 核心指标卡片（数字 + 趋势箭头） |
| `TrendChart` | `components/TrendChart.tsx` | 趋势折线图（ECharts 封装） |
| `QueueCard` | `components/QueueCard.tsx` | 单个队列状态卡片 |
| `QueueGroupPanel` | `components/QueueGroupPanel.tsx` | 按功能分组的队列面板 |
| `TaskTable` | `components/TaskTable.tsx` | 任务列表表格（含筛选排序） |
| `TaskTimeline` | `components/TaskTimeline.tsx` | 任务时间线展示（Steps） |
| `TaskTimingBar` | `components/TaskTimingBar.tsx` | 任务时长甘特图 |
| `RouteTable` | `components/RouteTable.tsx` | 路由列表表格 |
| `RouteWeightSlider` | `components/RouteWeightSlider.tsx` | 厂商权重分配滑块 |
| `RouteSwitchModal` | `components/RouteSwitchModal.tsx` | 路由切换弹窗 |
| `ProviderCompareChart` | `components/ProviderCompareChart.tsx` | 厂商对比雷达图 |
| `DailyStatsTable` | `components/DailyStatsTable.tsx` | 每日统计表格 |
| `AuditLogTable` | `components/AuditLogTable.tsx` | 操作日志表格 |
| `StatusTag` | `components/StatusTag.tsx` | 状态彩色标签（通用） |
| `AutoRefresh` | `components/AutoRefresh.tsx` | 自动刷新控制器（10s/30s/关闭） |

### 24.10 管理后台数据模型补充

#### admin_users 集合

```typescript
{
  userId: string;               // UUID
  username: string;             // 登录用户名（unique）
  passwordHash: string;         // bcrypt 哈希
  displayName: string;          // 显示名
  role: 'admin' | 'operator' | 'viewer';
  enabled: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

#### audit_logs 集合

```typescript
{
  logId: string;                // UUID
  userId: string;               // 操作人
  username: string;             // 操作人用户名
  action: string;               // 操作类型：ROUTE_SWITCH / CALLBACK_REPLAY / QUEUE_PAUSE / ...
  target: string;               // 操作对象标识
  detail: object;               // 操作详情（变更前后的 diff）
  ip: string;                   // 操作 IP
  userAgent: string;
  createdAt: Date;
}
```

**索引：**
```javascript
// admin_users
{ username: 1 }                 // unique

// audit_logs
{ userId: 1, createdAt: -1 }
{ action: 1, createdAt: -1 }
{ createdAt: 1 }                // TTL 索引，保留 180 天
```

### 24.11 构建与部署流程

**开发阶段：**

```bash
# 终端 1：启动后端 admin-server（热更新）
PROCESS_TYPE=admin-server npm run start:dev

# 终端 2：启动前端 dev server（Vite，自动代理 API 到 3001）
cd dashboard && npm run dev
```

**Vite 代理配置：**
```typescript
// dashboard/vite.config.ts
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
```

**生产构建：**

```bash
# 1. 构建前端
cd dashboard && npm run build    # → dashboard/dist/

# 2. 构建后端
npm run build                    # → dist/

# 3. PM2 启动 admin-server（自动托管 dashboard/dist）
pm2 start ecosystem.config.js --only model-hub-admin-server
```

**Docker 构建（多阶段）：**

```dockerfile
# Stage 1: 构建前端
FROM node:18-alpine AS dashboard-builder
WORKDIR /app/dashboard
COPY dashboard/package*.json ./
RUN npm ci
COPY dashboard/ .
RUN npm run build

# Stage 2: 构建后端
FROM node:18-alpine AS backend-builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 3: 生产镜像
FROM node:18-alpine
WORKDIR /app
COPY --from=backend-builder /app/dist ./dist
COPY --from=backend-builder /app/node_modules ./node_modules
COPY --from=backend-builder /app/package.json ./
COPY --from=dashboard-builder /app/dashboard/dist ./dashboard/dist
COPY ecosystem.config.js ./

RUN npm install -g pm2
EXPOSE 3000 3001
CMD ["pm2-runtime", "ecosystem.config.js"]
```

---

## 25. 附录：术语表

| 术语 | 说明 |
|------|------|
| **Provider** | 第三方 AI 模型厂商（WaveSpeed、Cloudwise、Akool 等） |
| **Adapter** | 厂商协议适配器，实现统一接口 |
| **Task** | 一次 AI 模型调用任务 |
| **Job** | Bull 队列中的工作单元 |
| **Polling** | 定时查询厂商任务状态 |
| **Callback** | 任务完成后向业务方推送结果 |
| **Dead-letter** | 超过最大重试次数的失败任务/回调 |
| **Idempotency** | 幂等性，相同请求只处理一次 |
| **Tenant** | 租户/业务方 |
| **Normalized Request** | 标准化后的统一请求格式 |
| **featureType** | ★ 功能类型（image_generate / image_to_video / character_swap / video_upscale） |
| **Hot-Switch** | ★ 多服务商热切换，运行时修改路由不停服 |
| **Route** | ★ 模型路由规则，决定请求路由到哪个厂商 |
| **Timeline** | ★ 任务处理时间线，完整记录任务生命周期各事件 |
| **Queue Snapshot** | ★ 队列快照，定时采集的队列排队/消费状态 |
| **Daily/Monthly Stats** | ★ 按天/月的任务数据聚合统计 |
| **queueWaitMs** | ★ 排队等待时长（出队时间 - 入队时间） |
| **providerProcessMs** | ★ 厂商实际处理时长（完成时间 - 提交时间） |
| **totalE2eMs** | ★ 端到端总时长（Hub 完成时间 - 请求到达时间） |

<!-- AUTO:overview:START -->
### 系统总览 (overview)

模块 `overview` 暂无技术设计文档。
<!-- AUTO:overview:END -->

<!-- AUTO:user:START -->
### 用户管理 (user)

模块 `user` 暂无技术设计文档。
<!-- AUTO:user:END -->

<!-- AUTO:role:START -->
### 角色管理 (role)

模块 `role` 暂无技术设计文档。
<!-- AUTO:role:END -->

<!-- AUTO:permission:START -->
### 权限管理 (permission)

模块 `permission` 暂无技术设计文档。
<!-- AUTO:permission:END -->

<!-- AUTO:model:START -->
### 模型配置 (model)

模块 `model` 暂无技术设计文档。
<!-- AUTO:model:END -->

<!-- AUTO:task:START -->
### 任务管理 (task)

模块 `task` 暂无技术设计文档。
<!-- AUTO:task:END -->

<!-- AUTO:api-client:START -->
### API客户端 (api-client)

模块 `api-client` 暂无技术设计文档。
<!-- AUTO:api-client:END -->

<!-- AUTO:audit:START -->
### 审计日志 (audit)

模块 `audit` 暂无技术设计文档。
<!-- AUTO:audit:END -->

<!-- AUTO:stats:START -->
### 统计数据 (stats)

模块 `stats` 暂无技术设计文档。
<!-- AUTO:stats:END -->

<!-- AUTO:queue:START -->
### 队列管理 (queue)

模块 `queue` 暂无技术设计文档。
<!-- AUTO:queue:END -->

<!-- AUTO:provider:START -->
### 提供商配置 (provider)

模块 `provider` 暂无技术设计文档。
<!-- AUTO:provider:END -->

<!-- AUTO:notification-rule:START -->
### 通知规则 (notification-rule)

模块 `notification-rule` 暂无技术设计文档。
<!-- AUTO:notification-rule:END -->

<!-- AUTO:notification-record:START -->
### 通知记录 (notification-record)

模块 `notification-record` 暂无技术设计文档。
<!-- AUTO:notification-record:END -->

<!-- AUTO:in-app-notification:START -->
### 站内通知 (in-app-notification)

模块 `in-app-notification` 暂无技术设计文档。
<!-- AUTO:in-app-notification:END -->