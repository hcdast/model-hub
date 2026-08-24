# Model-Hub

Akool 统一 AI 模型接入中台 —— 集成多家第三方 AI 模型厂商，为上层业务提供标准化的异步任务调度、状态轮询、结果回调能力。

## 技术栈

| 层面 | 选型 |
|------|------|
| 后端框架 | NestJS 10 + TypeScript 5 (strict) |
| 数据库 | MongoDB 8 (Mongoose ODM) |
| 队列 | Bull 4 (Redis-backed) |
| 缓存/锁 | ioredis 5 |
| 配置中心 | Nacos 2.6（与 Akool 现有服务对齐） |
| API 文档 | Swagger (@nestjs/swagger 7) |
| 进程管理 | PM2 |
| 监控 | Prometheus (prom-client) |
| 鉴权 | API Key（业务 API）/ HMAC-JWT（管理后台） |
| 管理后台前端 | React 18 + Ant Design 5 + Vite 6 + React Router 6 + Zustand |

## 前置依赖

启动前请确保以下服务已运行：

- **Node.js** >= 18
- **MongoDB** >= 6
- **Redis** >= 6

## 配置架构

与 Akool 现有服务（open-api / AGI-Content / faceswap）保持一致：

- **`.env`** —— 仅包含 Nacos 连接参数 + 进程标识，不含任何业务配置
- **Nacos JSON** —— 承载全量业务配置（DB / Redis / 厂商 Key / 回调 / 轮询 / Admin 等）
- **本地 `config/${NODE_ENV}.json`** —— Nacos 关闭时的降级，结构与 Nacos JSON 完全一致

```
启动 → 读 .env 中的 NACOS_ENABLE
         │
    ┌────┴─────┐
    true       false
    ▼          ▼
  Nacos       读本地
  getConfig   config/${NODE_ENV}.json
    │          │
    ▼          ▼
  JSON.parse → 注入为全局 APP_CONFIG
```

代码中所有模块通过 `@Inject(APP_CONFIG)` 获取强类型 `AppConfig` 对象（定义在 `src/config/interfaces/config.interface.ts`），不使用 `@nestjs/config` 的 `ConfigService`。

### .env 文件（仅需以下字段）

```bash
NODE_ENV=development
PORT=7000
PROCESS_TYPE=api                   # api | worker | scheduler | admin-server（开发可选 monolith）

NACOS_ENABLE=true
NACOS_SERVER_ADDR=nacos-public.akool.io:8848
NACOS_NAMESPACE=your-namespace-id
NACOS_DATA_ID=model-hub
NACOS_GROUP=DEFAULT_GROUP
NACOS_USERNAME=
NACOS_PASSWORD=
```

### Nacos JSON 配置（dataId=model-hub）

在 Nacos 控制台创建配置，格式选 JSON，内容参考 `config/nacos-config-template.json`：

```json
{
  "mongodb": {
    "uri": "mongodb://mongo-cluster:27017/model-hub?replicaSet=rs0",
    "maxPoolSize": 50
  },
  "redis": {
    "host": "redis-cluster.internal",
    "port": 6379,
    "password": "your-redis-password",
    "db": 0
  },
  "auth": {
    "apiKeyHeader": "X-API-Key",
    "serviceToken": "your-internal-service-token"
  },
  "callback": {
    "defaultSecret": "your-hmac-secret",
    "timeoutMs": 10000,
    "maxRetries": 6
  },
  "polling": {
    "cron": "*/30 * * * * *",
    "lockTtlMs": 30000,
    "batchSize": 200,
    "defaultIntervalMs": 30000,
    "maxIntervalMs": 60000,
    "maxPollCount": 720,
    "maxDurationMs": 3600000
  },
  "admin": {
    "jwtSecret": "prod-jwt-secret",
    "jwtExpiresIn": "2h",
    "defaultUsername": "admin",
    "defaultPassword": "prod-strong-password"
  },
  "log": {
    "level": "info"
  }
}
```

## 快速开始

```bash
# 1. 安装后端依赖
npm install

# 2. 安装前端依赖
cd dashboard && npm install && cd ..

# 3. 本地开发（不连 Nacos）
cp .env.example .env
# 编辑 .env：设置 NACOS_ENABLE=false
# 编辑 config/development.json：填入本地 MongoDB/Redis 地址

# 4. 构建后端 + 前端
npm run build:all

# 5. PM2 启动全部服务
pm2 start ecosystem.config.js
```

### 模型配置种子（`model_configs`）

与 AGI-Content 枚举对齐的全量模型文档，用于填充 MongoDB **`model_configs`** 集合（管理后台「模型配置」页数据源）。

```bash
# 需与本仓库同级存在 AGI-Content 目录；生成 seed/model-configs.json（文件较大，已 .gitignore）
npm run seed:models:collect

# 写入 MongoDB；默认跳过已存在记录。覆盖已存在记录请把 `--force` 传给脚本（勿写成 `npm run ... --force`，那是 npm 自身的开关）：
# 连接串优先级：环境变量 MONGODB_URI > .env > config/${NODE_ENV}.json 的 mongodb.uri
npm run seed:models:apply
npm run seed:models:apply -- --force

# apply 默认同时导入 seed/tencent-routing-rules.json；仅导入模型配置时加 --no-routing
# 生成联调文档附录：npm run seed:models:collect -- --appendix

# 若曾报 E11000 duplicate key … index: modelId_1：库中遗留了 modelId 唯一索引，与 aimodelconfigs（主键 model_name）不一致。
# apply 脚本启动时会尝试 dropIndex('modelId_1')；亦可手动：db.model_configs.dropIndex("modelId_1")
```

创建任务联调参数示例见 **[docs/create-task-demos.md](docs/create-task-demos.md)**（全量模型表可由 `npm run seed:models:collect -- --appendix` 生成 `docs/_task-demo-appendix.generated.md`）。

启动成功后访问（端口以根目录 `ecosystem.config.js` 为准，可用环境变量 `PORT` 覆盖）：

| 服务 | 地址 |
|------|------|
| 业务 API | `http://localhost:7000/v1/tasks` |
| Swagger 文档（API） | `http://localhost:7000/apidoc` |
| 管理后台页面 | `http://localhost:7003` |
| 管理后台 API | `http://localhost:7003/api/v1/admin/...` |
| Swagger 文档（Admin） | `http://localhost:7003/apidoc` |
| 健康检查 | `http://localhost:7000/health/liveness` |
| Prometheus 指标 | `http://localhost:7000/metrics` |

### 管理后台默认账号

首次启动自动创建，账号信息在 Nacos JSON 的 `admin` 节点配置：

| 字段 | 默认值 |
|------|--------|
| 用户名 | `admin` |
| 密码 | `changeme123`（本地开发默认值） |

## 架构原理：同一份代码 + 环境变量分角色

项目的核心设计是 **4 个 PM2 进程运行同一个 `dist/main.js`**，通过 `PROCESS_TYPE` 环境变量决定各自加载哪些 NestJS 模块，实现职责隔离与独立扩缩容。

```
ecosystem.config.js (PM2 启动 4 个进程)
  │
  ├─ PROCESS_TYPE=api          PORT=7000 ──→ main.js ──→ AppModule(api)
  ├─ PROCESS_TYPE=worker       PORT=7001 ──→ main.js ──→ AppModule(worker)
  ├─ PROCESS_TYPE=scheduler    PORT=7002 ──→ main.js ──→ AppModule(scheduler)
  └─ PROCESS_TYPE=admin-server PORT=7003 ──→ main.js ──→ AppModule(admin-server)
```

### 模块加载矩阵

`AppModule` 启动时通过 **`resolveProcessType(process.env.PROCESS_TYPE)`** 解析（非法值抛错；开发环境可设 **`PROCESS_TYPE=monolith`** 加载全模块，生产禁止），再按 `switch` 加载不同模块组合：

| 模块 | api | worker | scheduler | admin-server | 说明 |
|------|:---:|:------:|:---------:|:------------:|------|
| AppConfigModule | ● | ● | ● | ● | Nacos/本地 JSON 配置加载 |
| DatabaseModule | ● | ● | ● | ● | MongoDB 连接 + Schema 注册 |
| RedisModule | ● | ● | ● | ● | ioredis + 分布式锁 + 限流器 |
| QueueModule | ● | ● | ● | ● | Bull 队列注册（12 个功能队列 + callback） |
| ProviderModule | ● | ● | ● | ● | 多厂商 Adapter 注册表（`ProviderRegistry`） |
| ObservabilityModule | ● | ● | ● | ● | Prometheus 指标 |
| **AuthModule** | ● | | | | API Key 鉴权 |
| **TaskModule** | ● | | | | 任务 REST API（创建/查询/取消） |
| **CallbackModule** | | ● | | | 回调投递 + HMAC 签名 + 重试 |
| **PollingModule** | | | ● | | Cron 定时轮询厂商状态 |
| **StatsModule** | | | ● | ● | 每日聚合 + 队列快照采集 |
| **AdminModule** | | | | ● | 管理后台 API（JWT 鉴权 + RBAC） |
| **DashboardModule** | | | | ● | 前端 SPA 静态资源托管 |
| **HealthModule** | ● | | | ● | liveness + readiness |

### 各进程职责

| 进程 | PROCESS_TYPE | PM2 端口 | 模式 | 职责 |
|------|-------------|---------|------|------|
| **model-hub-api** | `api` | 7000 | cluster | 接收业务方 HTTP 请求，任务 CRUD，通过 QueueRouterService 按功能/厂商入队 |
| **model-hub-worker** | `worker` | 7001 | fork | 消费 12 个 Bull 队列，调用厂商 API 提交任务，RateLimiter 限流/并发控制 |
| **model-hub-scheduler** | `scheduler` | 7002 | fork | Cron 定时轮询厂商任务状态，分布式锁防多实例竞争，定时统计聚合 |
| **model-hub-admin-server** | `admin-server` | 7003 | fork | 管理后台 API + React SPA 托管，独立 JWT 鉴权 |

### 关键设计点

**Worker 如何消费队列？** 共享层包含 `QueueModule`，其中注册了 12 个功能队列及其 `@Processor` 装饰器。Bull 通过 Redis 协调多进程消费——api 进程负责入队（`queue.add()`），worker 进程负责消费（`@Process()`）。

**为什么拆分 4 个进程？**
- **api** 面向业务系统，高频高并发，可水平扩展（`instances: N`）
- **worker** CPU/IO 密集（调厂商 API + 限流等待），独立扩缩容不影响 API 响应
- **scheduler** 定时任务 + 分布式锁，全局只需 1 个实例（`fork` 模式）
- **admin-server** 面向内部运维，低频低优先级，独立部署不影响业务链路

**本地开发怎么办？** 不设 `PROCESS_TYPE` 时默认为 **`api`**（仅业务 API 模块）。若需**单进程加载全模块**联调，请显式设置 **`PROCESS_TYPE=monolith`**（**生产环境禁止使用 `monolith`**，启动时会校验失败）。非法的 `PROCESS_TYPE` 会直接抛错，避免误配导致重复消费队列等问题。

### 队列两级路由分发

任务入队时，`QueueRouterService` 按功能类型和厂商自动路由到最精确的队列：

```
TaskService.createTask()
  │
  └─ QueueRouterService.enqueue(featureType, provider)
       │
       ├─ 1. 优先匹配厂商队列: "image-generate:wavespeed-ai"
       ├─ 2. 降级到功能队列:   "image-generate"
       └─ 3. 兜底默认队列:     "task-submit"
```

功能级 Processor 收到 Job 后，若存在对应厂商子队列，会再次转发，实现**功能隔离 + 厂商级独立并发控制**。

## 开发模式

```bash
# 默认：仅 api 模块（PROCESS_TYPE 未设置时等同 api）
npm run start:dev

# 单进程全模块联调（开发环境）
# Windows PowerShell: $env:PROCESS_TYPE="monolith"; npm run start:dev
# Unix: PROCESS_TYPE=monolith npm run start:dev

# 管理后台前端开发（热重载，自动代理 /api → 后端）
cd dashboard && npm run dev    # → http://localhost:5173

# 开发者门户前端开发（热重载，自动代理 /api → 后端）
cd portal && npm run dev       # → http://localhost:7004
```

### 多进程启动（模拟生产）

Windows PowerShell：

```powershell
$env:PROCESS_TYPE="api"; $env:PORT="7000"; npm run start:dev
$env:PROCESS_TYPE="worker"; $env:PORT="7001"; npm run start:dev
$env:PROCESS_TYPE="scheduler"; $env:PORT="7002"; npm run start:dev
$env:PROCESS_TYPE="admin-server"; $env:PORT="7003"; npm run start:dev
```

## 生产部署（PM2）

```bash
# 构建后端 + 前端
npm run build:all

# PM2 启动全部进程
pm2 start ecosystem.config.js

# 查看状态
pm2 status

# 查看日志
pm2 logs model-hub-api
pm2 logs model-hub-admin-server

# 重启全部
pm2 reload ecosystem.config.js

# 单独重启管理后台
pm2 restart model-hub-admin-server

# 停止
pm2 stop ecosystem.config.js
```

## 核心 API

### 业务 API（默认端口 7000，见 `ecosystem.config.js`）

所有业务接口需携带 `X-API-Key` Header。完整文档见 Swagger：`http://localhost:7000/apidoc`

```bash
# 创建任务
curl -X POST http://localhost:7000/v1/tasks \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -H "X-Idempotency-Key: unique-key-123" \
  -d '{
    "model": "wavespeed-ai/flux-2-pro/text-to-image",
    "input": { "prompt": "A sunset over mountains", "width": 1024, "height": 1024 },
    "callbackUrl": "https://your-server.com/webhooks/model-hub",
    "priority": 50
  }'

# 查询任务
curl http://localhost:7000/v1/tasks/{taskId} -H "X-API-Key: your-api-key"

# 任务列表
curl "http://localhost:7000/v1/tasks?status=SUCCESS&page=1&pageSize=20" -H "X-API-Key: your-api-key"

# 取消任务
curl -X POST http://localhost:7000/v1/tasks/{taskId}/cancel -H "X-API-Key: your-api-key"
```

### 管理后台 API（默认端口 7003）

管理后台使用 JWT Bearer Token 鉴权。完整文档见 Swagger：`http://localhost:7003/apidoc`

```bash
# 登录
curl -X POST http://localhost:7003/api/v1/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "changeme123"}'

# 以下接口均需 Authorization: Bearer <token>

# Dashboard 总览
curl http://localhost:7003/api/v1/admin/overview -H "Authorization: Bearer <token>"

# 任务列表
curl "http://localhost:7003/api/v1/admin/tasks?status=FAILED&page=1" -H "Authorization: Bearer <token>"

# 任务时间线
curl http://localhost:7003/api/v1/admin/tasks/{taskId}/timeline -H "Authorization: Bearer <token>"

# 任务时长指标
curl http://localhost:7003/api/v1/admin/tasks/{taskId}/timing -H "Authorization: Bearer <token>"

# 回调重放
curl -X POST http://localhost:7003/api/v1/admin/tasks/{taskId}/replay-callback -H "Authorization: Bearer <token>"

# 队列监控
curl http://localhost:7003/api/v1/admin/queues/stats -H "Authorization: Bearer <token>"

# 每日统计
curl "http://localhost:7003/api/v1/admin/stats/daily?dateFrom=2026-04-01&dateTo=2026-04-07" -H "Authorization: Bearer <token>"

# 审计日志
curl http://localhost:7003/api/v1/admin/audit-logs -H "Authorization: Bearer <token>"

# 当前用户侧边栏菜单树（仅需登录）
curl http://localhost:7003/api/v1/admin/menu -H "Authorization: Bearer <token>"

# 菜单配置 CRUD（需 menu:read / menu:create 等）
curl http://localhost:7003/api/v1/admin/menus -H "Authorization: Bearer <token>"

# 用量账单 / 余额（钱包）（需 billing:read）
curl "http://localhost:7003/api/v1/admin/billing/records?page=1&pageSize=20" -H "Authorization: Bearer <token>"
curl http://localhost:7003/api/v1/admin/billing/wallets -H "Authorization: Bearer <token>"
```

### 健康检查 & 监控

```bash
curl http://localhost:7000/health/liveness     # 存活检查
curl http://localhost:7000/health/readiness    # 就绪检查（含 MongoDB 连通性）
curl http://localhost:7000/metrics             # Prometheus 指标
```

## 环境变量说明（.env）

`.env` 仅包含启动前必须的 Nacos 连接参数，业务配置全部在 Nacos JSON 中。

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `NODE_ENV` | `development` | 运行环境（对应 `config/${NODE_ENV}.json`） |
| `PORT` | `7000`（PM2 默认与 `ecosystem.config.js` 一致） | HTTP 监听端口 |
| `PROCESS_TYPE` | `api` | 进程类型：api / worker / scheduler / admin-server |
| `NACOS_ENABLE` | `true` | 是否启用 Nacos（`false` 时读本地 JSON） |
| `NACOS_SERVER_ADDR` | - | Nacos 服务地址 |
| `NACOS_NAMESPACE` | - | Nacos 命名空间 ID |
| `NACOS_DATA_ID` | `model-hub` | Nacos 配置 Data ID |
| `NACOS_GROUP` | `DEFAULT_GROUP` | Nacos 分组 |
| `NACOS_USERNAME` | - | Nacos 认证用户名（可选） |
| `NACOS_PASSWORD` | - | Nacos 认证密码（可选） |

## Nacos JSON 配置字段说明

| 路径 | 类型 | 说明 |
|------|------|------|
| `mongodb.uri` | string | MongoDB 连接串 |
| `mongodb.maxPoolSize` | number | 连接池大小 |
| `redis.host` / `port` / `password` / `db` | - | Redis 连接信息 |
| `auth.apiKeyHeader` | string | API Key Header 名称 |
| `auth.requireRegisteredApiKey` | boolean | 为 `true` 时仅接受 `api_clients` 注册的 `mh_....secret` 形式密钥 |
| `auth.serviceToken` | string | 内部服务间调用 Token |
| `callback.defaultSecret` | string | 回调签名默认密钥 |
| `callback.timeoutMs` | number | 回调超时（ms） |
| `callback.maxRetries` | number | 回调最大重试次数 |
| `polling.*` | - | 轮询配置（间隔/批量/最大次数/最大时长等） |
| （厂商密钥/URL/限流） | - | 厂商 URL 和限流见 MongoDB `provider_runtime_configs`；**API 密钥在 `account_pool_entries` 管理**；首次部署可 `npm run seed:providers` |
| `admin.jwtSecret` | string | 管理后台 JWT 签名密钥 |
| `admin.jwtExpiresIn` | string | JWT 有效期（如 `2h`） |
| `admin.defaultUsername` | string | 首次启动创建的管理员用户名 |
| `admin.defaultPassword` | string | 首次启动创建的管理员密码 |
| `log.level` | string | 日志级别：debug / info / warn / error |

完整模板见 [config/nacos-config-template.json](config/nacos-config-template.json)。

## 项目结构

```
model-hub/
├── src/                                # 后端（NestJS）
│   ├── main.ts                         # 入口（Swagger 初始化、全局管道/过滤器/拦截器）
│   ├── app.module.ts                   # 根模块（按 PROCESS_TYPE 加载不同模块）
│   ├── config/                         # 配置模块
│   │   ├── config.module.ts            # APP_CONFIG 全局注入（Nacos / 本地 JSON）
│   │   ├── nacos-config.loader.ts      # Nacos 拉取 / 本地文件加载
│   │   └── interfaces/config.interface.ts  # AppConfig 强类型接口
│   ├── database/                       # 数据库模块
│   │   ├── database.module.ts          # MongooseModule 注册
│   │   └── schemas/                    # 全部 Mongoose Schema
│   │       ├── task.schema.ts          # tasks 集合（含 timing + timeline）
│   │       ├── idempotency-record.schema.ts
│   │       ├── callback-log.schema.ts
│   │       ├── task-daily-stats.schema.ts
│   │       ├── queue-snapshot.schema.ts
│   │       ├── admin-user.schema.ts
│   │       ├── audit-log.schema.ts
│   │       ├── account-pool-entry.schema.ts    # ★ 账号池条目（密钥唯一来源）
│   │       ├── account-cost-daily.schema.ts    # ★ 账号每日成本聚合
│   │       ├── provider-runtime-config.schema.ts  # 厂商全局配置（不含密钥）
│   │       ├── model-config.schema.ts          # 模型配置
│   │       ├── model-routing-rule.schema.ts    # 模型路由策略（model_routing_rules）
│   │       ├── api-client.schema.ts            # 业务 API 客户端
│   │       ├── role.schema.ts / permission.schema.ts / menu-config.schema.ts  # RBAC + 菜单
│   │       ├── billing-record.schema.ts / wallet.schema.ts / wallet-transaction.schema.ts
│   │       ├── notification-rule.schema.ts / notification-record.schema.ts / in-app-notification.schema.ts
│   │       └── link-conversion-settings.schema.ts
│   ├── redis/                          # Redis 模块
│   │   ├── redis.module.ts             # ioredis 连接
│   │   ├── redis.constants.ts          # REDIS_CLIENT 注入 Token
│   │   ├── redis-lock.service.ts       # 分布式锁
│   │   └── rate-limiter.service.ts     # 滑动窗口限流 + 并发控制
│   ├── auth/                           # 业务 API 鉴权
│   │   ├── auth.module.ts
│   │   ├── guards/api-key.guard.ts     # X-API-Key 校验
│   │   └── decorators/tenant.decorator.ts  # @Tenant() 参数装饰器
│   ├── task/                           # 任务核心模块
│   │   ├── task.module.ts
│   │   ├── task.controller.ts          # REST API（Swagger 装饰器）
│   │   ├── task.service.ts             # 业务逻辑（Timeline + Timing + 厂商解析）
│   │   ├── task.repository.ts          # Mongoose 操作封装
│   │   ├── idempotency.service.ts      # 幂等检查
│   │   ├── task-timeline.service.ts    # 时间线事件记录
│   │   ├── task-timing.service.ts      # 时长指标跟踪
│   │   └── dto/                        # DTO（含 Swagger @ApiProperty）
│   │       ├── create-task.dto.ts
│   │       └── task-list-query.dto.ts
│   ├── queue/                          # 队列模块
│   │   ├── queue.module.ts             # BullModule 注册（task-submit + callback）
│   │   ├── task-submit.processor.ts    # Worker 消费（含 Timeline/Timing 埋点）
│   │   ├── queue-registry.service.ts   # 队列统一注册/发现
│   │   └── queue-router.service.ts     # 两级路由分发
│   ├── provider/                       # 厂商适配模块
│   │   ├── provider.module.ts          # 注册所有 Adapter
│   │   ├── provider.registry.ts        # Adapter 注册表
│   │   ├── provider-config.service.ts  # 厂商全局配置（不含密钥）
│   │   ├── provider-config.types.ts    # ResolvedProviderRuntime 类型
│   │   ├── create-runtime-axios.ts     # 统一 Axios 工厂（从账号池注入密钥）
│   │   ├── interfaces/provider-adapter.interface.ts  # IProviderAdapter 接口
│   │   ├── account-pool/              # ★ 账号池子模块（密钥唯一来源）
│   │   │   ├── account-pool.module.ts
│   │   │   ├── account-pool.service.ts          # 账号池核心服务
│   │   │   ├── resolved-account-credentials.interface.ts  # 认证凭据类型
│   │   │   ├── circuit-breaker.service.ts       # 熔断器
│   │   │   ├── cost-tracker.service.ts          # 成本追踪
│   │   │   ├── health-check.scheduler.ts        # 健康探测
│   │   │   └── strategies/                      # 负载均衡策略
│   │   └── adapters/
│   │       ├── wavespeed.adapter.ts
│   │       ├── cloudwise.adapter.ts
│   │       ├── akool.adapter.ts
│   │       ├── tencent.adapter.ts      # ★ 使用 extra_credentials 签名
│   │       ├── minimax.adapter.ts
│   │       ├── seedance.adapter.ts
│   │       └── wan.adapter.ts
│   ├── polling/                        # 轮询模块
│   │   ├── polling.module.ts
│   │   ├── polling.scheduler.ts        # Cron 调度 + 分布式锁
│   │   └── polling.service.ts          # 批量轮询 + 状态同步
│   ├── callback/                       # 回调模块
│   │   ├── callback.module.ts
│   │   ├── callback.processor.ts       # 回调投递 + 重试 + 死信
│   │   └── callback-signature.service.ts  # HMAC-SHA256 签名
│   ├── billing/                        # 计费与钱包（预扣/结算/退款等）
│   │   ├── billing.module.ts
│   │   ├── billing.service.ts
│   │   └── wallet.service.ts
│   │   ├── stats.module.ts
│   │   ├── stats.service.ts            # MongoDB Aggregation 每日聚合
│   │   ├── stats-aggregation.scheduler.ts  # 每日 01:00 定时聚合
│   │   └── queue-stats-collector.service.ts  # 每 30s 队列快照采集
│   ├── observability/                  # 可观测性
│   │   ├── observability.module.ts
│   │   ├── metrics.service.ts          # Prometheus Counter/Histogram/Gauge
│   │   └── metrics.controller.ts       # GET /metrics
│   ├── health/                         # 健康检查
│   │   ├── health.module.ts
│   │   └── health.controller.ts        # liveness + readiness
│   ├── admin/                          # 管理后台 API（JWT + 细粒度权限）
│   │   ├── admin.module.ts / rbac.module.ts
│   │   ├── admin-auth.controller.ts / admin-auth.service.ts
│   │   ├── admin-task.controller.ts / admin-stats.controller.ts / admin-audit.controller.ts
│   │   ├── admin-model-config.controller.ts / admin-model-routing.controller.ts
│   │   ├── admin-provider-config.controller.ts / admin-account-pool.controller.ts / admin-account-cost.controller.ts
│   │   ├── admin-api-client.controller.ts / admin-billing.controller.ts
│   │   ├── admin-menu.controller.ts（当前用户菜单树）/ menu-management.controller.ts（菜单 CRUD）
│   │   ├── user-management.controller.ts / role-management.controller.ts / permission-management.controller.ts
│   │   ├── provider-health.controller.ts / admin-callback-logs.controller.ts / admin-link-conversion-config.controller.ts
│   │   ├── admin-system-info.controller.ts
│   │   ├── guards/（admin-jwt、permission、roles）/ decorators/（require-permissions 等）
│   │   └── services/menu-registry.service.ts、permission-check.service.ts 等
│   ├── dashboard/                      # 前端静态资源托管
│   │   └── dashboard.module.ts         # ServeStaticModule → dashboard/dist
│   └── common/                         # 公共层
│       ├── constants/error-codes.ts    # 错误码枚举
│       ├── constants/task-status.ts    # 任务状态枚举
│       ├── exceptions/business.exception.ts
│       ├── filters/global-exception.filter.ts
│       ├── interceptors/response-transform.interceptor.ts
│       └── interfaces/api-response.interface.ts
│
├── dashboard/                          # 前端（React SPA）
│   ├── package.json                    # React 18 + Ant Design 5 + Vite 6
│   ├── vite.config.ts                  # 开发代理 /api → 后端
│   ├── index.html
│   ├── tsconfig.json
│   └── src/
│       ├── main.tsx                    # 入口（Ant Design ConfigProvider 中文）
│       ├── App.tsx                     # 路由 + 侧边栏布局 + AuthGuard
│       ├── services/api.ts             # Axios 封装 + 全部 API 调用
│       ├── store/auth.ts / store/menu.ts / store/theme.ts
│       ├── hooks/usePermission.ts
│       ├── components/ …
│       └── pages/                      # 各业务页（任务、模型、计费、RBAC、菜单等）
│           ├── Login.tsx / Dashboard.tsx / Tasks.tsx / TaskDetail.tsx / Queues.tsx
│           ├── Models.tsx / CreateModelConfig.tsx / EditModelConfig.tsx / ModelRoutingRules.tsx
│           ├── ProviderConfigs.tsx / ProviderHealth.tsx / AccountPool.tsx / AccountCost.tsx
│           ├── BillingRecords.tsx / WalletManagement.tsx / ApiClients.tsx / LinkConversionConfig.tsx
│           ├── Stats.tsx / AuditLogs.tsx / CallbackLogs.tsx / SystemInfo.tsx
│           ├── NotificationRules.tsx / NotificationRecords.tsx / InAppNotifications.tsx
│           ├── Users.tsx / Roles.tsx / Permissions.tsx / Menus.tsx / Forbidden.tsx
│
├── config/
│   ├── development.json                # 本地开发配置（NACOS_ENABLE=false 时使用）
│   ├── production.json                 # 生产本地降级配置
│   └── nacos-config-template.json      # Nacos JSON 配置模板
├── seed/                               # 种子数据
│   ├── provider-runtime-configs.json   # 厂商全局配置（不含密钥）
│   ├── account-pool-entries.json       # ★ 账号池默认条目模板（api_key 留空）
│   └── model-configs.json              # 模型配置
├── scripts/                            # 运维脚本
│   ├── migrate-secrets-to-pool.cjs     # ★ 密钥迁移脚本（provider_runtime_configs → account_pool_entries）
│   ├── cleanup-provider-secrets.cjs    # ★ 密钥清理脚本（移除旧 api_key 字段）
│   ├── seed-provider-runtime-from-config.cjs  # 种子数据导入
│   ├── collect-model-configs.cjs       # 模型配置采集
│   └── ...                             # 其他运维脚本
├── docs/
│   ├── technical-design.md             # 技术方案（设计为主；运行时细节以 README + 代码为准）
│   ├── project-architecture.md         # 架构清单（部分为规划稿，与仓库不一致时以代码为准）
│   ├── workflow-and-portal.md          # 工作流引擎与开发者门户
│   ├── notification-system.md          # 通知系统（规则匹配 + 多渠道投递）
│   ├── provider-health.md              # 供应商健康度与熔断器
│   ├── billing-system.md               # 计费系统（Pricing/Billing/Wallet）
│   └── todo.md                         # Spec 顺序与待办备忘
├── portal/                             # 开发者门户前端（React + React Flow）
├── ecosystem.config.js                 # PM2 多进程配置（api/worker/scheduler/admin-server/portal）
├── .env.example                        # 环境变量模板（仅 Nacos 连接参数）
├── package.json
├── tsconfig.json                       # include: ["src"]，排除前端
└── nest-cli.json
```

## 任务生命周期

```
客户端 POST /v1/tasks
  → API 鉴权 (X-API-Key) + 参数校验 + 幂等检查
  → 查 `model_configs` 按 `service` 映射 Adapter（无记录或 `service` 为空时回退为 `model` 路径首段）
  → 入库 (PENDING) + 入队 + Timeline 埋点 + Timing 记录
  → Worker 消费 → 调用厂商 API → 更新 (SUBMITTED)
  → Scheduler 定时轮询厂商状态 → 状态同步
  → 成功 → 入库 (SUCCESS) → 计算时长指标 → HMAC 签名回调 → 重试保障
```

状态流转：`PENDING → SUBMITTED → PROCESSING → SUCCESS / FAILED / TIMEOUT / CANCELLED`

## 支持的厂商

| 厂商 | Adapter | 功能 |
|------|---------|------|
| WaveSpeed AI | `wavespeed-ai` | 文生图 / 图生视频 / 角色换装 / 视频超分 |
| Cloudwise | `cloudwise` | 文生图 |
| Akool 自有 | `akool` | 图生视频 / 文生视频 / 文生图 |

新增厂商只需实现 `IProviderAdapter` 接口并在 `ProviderModule` 注册，无需改动上层代码。

## 管理后台与权限

- **鉴权**：业务 API 使用 `X-API-Key`；管理后台使用 JWT（`Authorization: Bearer`），细粒度权限由 `PermissionGuard` + `@RequirePermissions('resource:action')` 控制；`super_admin` 角色拥有全部能力。
- **侧边栏菜单**：`GET /api/v1/admin/menu` 返回按当前用户过滤后的分组菜单（一级分组如 **仪表盘、业务接入、模型路由、供应商管理、计费与成本、通知中心、系统设置** 等）；菜单项注册见 `MenuRegistryService` 与 `src/common/descriptors/index.ts`，启动时由 **`MenuSyncPlugin`** 同步到 MongoDB **`menu_configs`**（与「菜单管理」页配合）。修改菜单文案或层级后，可执行 `npm run build && npm run sync:docs` 更新本文档与 `docs/` 中带 `<!-- AUTO:... -->` 的章节。
- **菜单管理 API**：`GET|POST|PUT|DELETE /api/v1/admin/menus`（需 `menu:*` 权限），对应前端 `dashboard/src/pages/Menus.tsx`。
- **角色**：`roles` 集合支持权限码列表与授权菜单 key；详见 `role-management.service.ts`、`permission-check.service.ts`。

## 管理后台页面

> 下列「页面」名称与侧栏展示一致；**实际分组与排序** 以 `GET /api/v1/admin/menu` 返回为准。

| 页面 | 路由 | 权限（示例） | 功能 |
|------|------|--------------|------|
| 登录 | `/login` | — | 用户名/密码登录 |
| 总览 | `/` | — | 核心指标；菜单由后端下发 |
| 应用管理 | `/api-clients` | `api-client:read` 等 | 业务应用与 API 客户端（密钥、限流、白名单等） |
| 任务记录 | `/tasks`、`/tasks/:taskId` | `task:read` 等 | 列表、详情、时间线、回调重放等 |
| 队列监控 | `/queues` | `queue:read` | 队列状态卡片 |
| 路由策略 | `/model-routing-rules` | `model:read` | 模型路由策略 CRUD |
| 模型配置 | `/models`、`/models/create`、`/models/edit/:id` | `model:read` 等 | 列表、创建、编辑 |
| 请求转换配置 | `/link-conversion-config` | `link-conversion:read` | 请求转换（原链接转存）设置 |
| 供应商配置 | `/provider-configs` | `provider:read` | 供应商全局配置 |
| 供应商健康度 | `/provider-health` | `provider:read` | 健康与熔断 |
| 账号池 | `/account-pool` | `provider:read` | 密钥与账号条目 |
| 成本分析 | `/account-costs` | `provider:read` | 账号成本聚合（侧栏归「计费与成本」） |
| 用量账单 | `/billing/records` | `billing:read` | 计费流水 |
| 余额充值 | `/billing/wallets` | `billing:read` | 余额与手工调账等 |
| 统计报表 | `/stats` | `stats:read` | 每日统计等（侧栏归「仪表盘」，与总览同组） |
| 审计日志 | `/audit-logs` | `audit:read` | 操作审计 |
| 通知规则/记录/消息中心 | `/notification-rules` 等 | `notification:read` | 通知子系统 |
| 回调日志 | `/callback-logs` | `callback-log:read` | 回调投递日志 |
| 系统信息 | `/system-info` | `system:read` | 运行信息 |
| 用户管理 | `/users` | `user:read` 等 | 后台用户 CRUD |
| 角色管理 | `/roles` | `role:read` 等 | 角色与菜单/权限绑定 |
| 权限管理 | `/permissions` | `permission:read` | 权限定义 |
| 菜单管理 | `/menus` | `menu:read` 等 | `menu_configs` 维护 |

路由定义见 `dashboard/src/App.tsx`。

## 常用命令

```bash
npm install              # 安装后端依赖
cd dashboard && npm install  # 安装前端依赖
npm run build            # 构建后端
npm run build:dashboard  # 构建前端
npm run build:all        # 构建后端 + 前端
npm run start:dev        # 开发模式（热重载）
npm run start:prod       # 生产模式
pm2 start ecosystem.config.js  # PM2 启动全部服务
npm test                 # 单元测试
npm run lint             # ESLint 检查
npm run sync:docs        # 根据 src/common/descriptors 更新 docs 中带 AUTO 标记的章节（建议先 npm run build）
npm run seed:init        # 首次部署：厂商配置 + 默认 API 客户端 + RBAC 种子
npm run seed:api-client  # 若 api_clients 为空则创建默认客户端并打印 apiKey
npm run seed:providers   # 导入厂商配置 + 账号池种子数据
npm run seed:rbac        # 初始化权限与超级管理员
```
