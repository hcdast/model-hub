# Model-Hub 可落地项目架构清单

> 本文档为开发团队提供直接可落地的项目结构、模块清单、类/接口命名、Schema 定义、配置文件模板等。
> 配合以下文档使用：
> - `technical-design.md` — 技术方案与设计取舍
> - `workflow-and-portal.md` — 工作流引擎与开发者门户
> - `notification-system.md` — 通知系统
> - `provider-health.md` — 供应商健康度与熔断器
> - `billing-system.md` — 计费系统

### 与当前仓库的一致性说明

下文部分目录树、Controller 命名与「按进程拆 worker」等描述来自早期规划稿，**若与仓库不一致，以根目录 `README.md`、`ecosystem.config.js`、`src/app.module.ts`、各 `*.controller.ts` 及 `dashboard/src/App.tsx` 为准**。PM2 默认端口以 `ecosystem.config.js` 为准（当前为 api **7000**、admin-server **7003**）。

---

## 目录

1. [项目目录结构](#1-项目目录结构)
2. [NestJS 模块清单与入口](#2-nestjs-模块清单与入口)
3. [Controller 定义清单](#3-controller-定义清单)
4. [Service 定义清单](#4-service-定义清单)
5. [DTO 定义清单](#5-dto-定义清单)
6. [Mongoose Schema 定义](#6-mongoose-schema-定义)
7. [Bull Queue & Processor 清单](#7-bull-queue-processor-清单)
8. [Provider Adapter 清单](#8-provider-adapter-清单)
9. [Guard & Interceptor 清单](#9-guard-interceptor-清单)
10. [配置文件模板](#10-配置文件模板)
11. [PM2 进程管理与部署配置](#11-pm2-进程管理与部署配置)
12. [依赖清单](#12-依赖清单)
13. [初始化命令清单](#13-初始化命令清单)
14. [开发规范](#14-开发规范)

---

## 1. 项目目录结构

```
model-hub/
├── docs/                                  # 项目文档
│   ├── technical-design.md                # 技术方案文档
│   └── project-architecture.md            # 本文档
│
├── src/
│   ├── main.ts                            # 应用入口，按 PROCESS_TYPE 启动不同模块
│   ├── app.module.ts                      # 根模块
│   │
│   ├── config/                            # 配置模块
│   │   ├── config.module.ts               # ConfigModule.forRootAsync（合并 Nacos + env）
│   │   ├── config.schema.ts               # 环境变量校验 Schema（joi/zod）
│   │   ├── config.constants.ts            # 配置常量
│   │   ├── nacos-config.loader.ts         # Nacos 首次拉取 + JSON 解析（供 useFactory 调用）
│   │   ├── nacos-config.service.ts        # NacosConfigClient 封装、subscribe 热更新
│   │   └── interfaces/
│   │       └── config.interface.ts        # 配置类型定义
│   │
│   ├── database/                          # 数据库模块
│   │   ├── database.module.ts
│   │   └── database.providers.ts          # 连接配置
│   │
│   ├── redis/                             # Redis 模块
│   │   ├── redis.module.ts
│   │   ├── redis-lock.service.ts          # 分布式锁
│   │   ├── redis-pubsub.service.ts        # ★ Redis Pub/Sub（路由变更推送）
│   │   └── rate-limiter.service.ts        # 限流器
│   │
│   ├── auth/                              # 鉴权模块
│   │   ├── auth.module.ts
│   │   ├── guards/
│   │   │   ├── api-key.guard.ts           # API Key 鉴权
│   │   │   ├── jwt.guard.ts               # JWT 鉴权
│   │   │   ├── service-token.guard.ts     # 服务间鉴权
│   │   │   └── tenant-rate-limit.guard.ts # 租户限流
│   │   ├── decorators/
│   │   │   ├── api-key.decorator.ts
│   │   │   └── tenant.decorator.ts        # @Tenant() 参数装饰器
│   │   ├── strategies/
│   │   │   └── jwt.strategy.ts
│   │   └── interfaces/
│   │       └── auth.interface.ts
│   │
│   ├── task/                              # 任务核心模块
│   │   ├── task.module.ts
│   │   ├── task.controller.ts             # 任务 API Controller
│   │   ├── task.service.ts                # 任务业务逻辑
│   │   ├── task.repository.ts             # 任务数据库操作
│   │   ├── task-timeline.service.ts       # ★ 任务时间线记录服务
│   │   ├── task-timing.service.ts         # ★ 任务时长计算服务
│   │   ├── idempotency.service.ts         # 幂等性服务
│   │   ├── dto/
│   │   │   ├── create-task.dto.ts         # 创建任务 DTO
│   │   │   ├── query-task.dto.ts          # 查询任务 DTO
│   │   │   ├── task-list-query.dto.ts     # 任务列表查询 DTO
│   │   │   ├── cancel-task.dto.ts         # 取消任务 DTO
│   │   │   ├── task-response.dto.ts       # 任务响应 DTO
│   │   │   ├── task-timing-response.dto.ts  # ★ 时长查询响应 DTO
│   │   │   └── task-timeline-response.dto.ts # ★ 时间线查询响应 DTO
│   │   ├── schemas/
│   │   │   ├── task.schema.ts             # 任务 Mongoose Schema（含 timing + timeline）
│   │   │   └── idempotency.schema.ts      # 幂等记录 Schema
│   │   ├── enums/
│   │   │   ├── task-status.enum.ts        # 任务状态枚举
│   │   │   ├── callback-status.enum.ts    # 回调状态枚举
│   │   │   ├── feature-type.enum.ts       # ★ 功能类型枚举
│   │   │   └── timeline-event.enum.ts     # ★ 时间线事件类型枚举
│   │   ├── constants/
│   │   │   ├── task.constants.ts          # 任务相关常量
│   │   │   └── error-codes.constants.ts   # 错误码定义
│   │   └── interfaces/
│   │       ├── task.interface.ts           # 任务类型接口
│   │       ├── task-timing.interface.ts    # ★ 时长类型
│   │       └── timeline-entry.interface.ts # ★ 时间线条目类型
│   │
│   ├── queue/                             # 队列模块（★ 按功能拆分）
│   │   ├── queue.module.ts
│   │   ├── queue-registry.service.ts      # ★ 队列注册中心（统一管理所有队列）
│   │   ├── queue-router.service.ts        # ★ 队列路由（featureType + provider → 队列名）
│   │   ├── queue-stats-collector.service.ts # ★ 队列统计采集（定时快照）
│   │   ├── processors/
│   │   │   ├── image-generate.processor.ts    # ★ 图片生成消费者
│   │   │   ├── image-to-video.processor.ts    # ★ 图生视频消费者
│   │   │   ├── character-swap.processor.ts    # ★ 角色换装消费者
│   │   │   ├── video-upscale.processor.ts     # ★ 视频超分消费者
│   │   │   └── callback.processor.ts          # 回调发送消费者
│   │   ├── constants/
│   │   │   └── queue.constants.ts             # 队列名称 + 并发配置常量
│   │   ├── schemas/
│   │   │   └── queue-snapshot.schema.ts       # ★ 队列快照 Schema
│   │   └── interfaces/
│   │       ├── task-submit-job.interface.ts
│   │       └── callback-job.interface.ts
│   │
│   ├── provider/                          # 厂商适配模块
│   │   ├── provider.module.ts
│   │   ├── provider.registry.ts           # Adapter 注册中心
│   │   ├── provider.factory.ts            # Adapter 工厂
│   │   ├── provider-config.service.ts     # 厂商配置管理
│   │   ├── interfaces/
│   │   │   ├── provider-adapter.interface.ts   # 核心 Adapter 接口
│   │   │   ├── submit-result.interface.ts
│   │   │   ├── query-result.interface.ts
│   │   │   └── rate-limit-config.interface.ts
│   │   ├── adapters/                      # ★ 实际厂商 Adapter
│   │   │   ├── wavespeed.adapter.ts       # ★ WaveSpeed AI
│   │   │   ├── cloudwise.adapter.ts       # ★ Cloudwise
│   │   │   ├── akool.adapter.ts           # ★ Akool 自有模型
│   │   │   └── base.adapter.ts            # ★ 抽象基类（公共 HTTP/错误处理）
│   │   ├── schemas/
│   │   │   ├── provider-config.schema.ts  # 厂商配置 Schema
│   │   │   └── model-route.schema.ts      # ★ 模型路由 Schema
│   │   └── model-router.service.ts        # ★ 带热切换 + 灰度的路由服务
│   │
│   ├── polling/                           # 轮询模块
│   │   ├── polling.module.ts
│   │   ├── polling.scheduler.ts           # Cron 调度入口
│   │   ├── polling.service.ts             # 轮询业务逻辑
│   │   └── polling-interval.strategy.ts   # 动态轮询间隔策略
│   │
│   ├── callback/                          # 回调模块
│   │   ├── callback.module.ts
│   │   ├── callback.service.ts            # 回调发送服务
│   │   ├── callback-signature.service.ts  # 签名生成与校验
│   │   ├── callback-log.repository.ts     # 回调日志持久化
│   │   ├── schemas/
│   │   │   └── callback-log.schema.ts     # 回调日志 Schema
│   │   └── interfaces/
│   │       └── callback-payload.interface.ts
│   │
│   ├── stats/                             # ★ 统计模块（v2.0 新增）
│   │   ├── stats.module.ts
│   │   ├── stats.controller.ts            # 统计查询 API
│   │   ├── stats.service.ts               # 聚合统计业务逻辑
│   │   ├── stats-aggregation.scheduler.ts # 每日/每月聚合定时任务
│   │   ├── stats-compare.service.ts       # 厂商对比分析
│   │   ├── dto/
│   │   │   ├── daily-stats-query.dto.ts
│   │   │   ├── monthly-stats-query.dto.ts
│   │   │   └── stats-compare-query.dto.ts
│   │   ├── schemas/
│   │   │   ├── task-daily-stats.schema.ts
│   │   │   └── task-monthly-stats.schema.ts
│   │   └── interfaces/
│   │       └── stats.interface.ts
│   │
│   ├── health/                            # 健康检查模块
│   │   ├── health.module.ts
│   │   └── health.controller.ts
│   │
│   ├── observability/                     # 可观测模块
│   │   ├── observability.module.ts
│   │   ├── logger/
│   │   │   ├── logger.service.ts          # 结构化日志
│   │   │   └── log-sanitizer.ts           # 日志脱敏
│   │   ├── metrics/
│   │   │   ├── metrics.service.ts         # Prometheus 指标
│   │   │   └── metrics.middleware.ts      # HTTP 指标中间件
│   │   └── interceptors/
│   │       ├── logging.interceptor.ts     # 请求日志拦截器
│   │       ├── trace-id.interceptor.ts    # TraceId 注入拦截器
│   │       └── timing.interceptor.ts      # ★ 请求时间点采集拦截器
│   │
│   ├── common/                            # 公共模块
│   │   ├── filters/
│   │   │   └── global-exception.filter.ts # 全局异常过滤器
│   │   ├── interceptors/
│   │   │   └── response-transform.interceptor.ts  # 统一响应格式
│   │   ├── pipes/
│   │   │   └── validation.pipe.ts         # 全局校验管道
│   │   ├── decorators/
│   │   │   └── idempotency-key.decorator.ts
│   │   ├── utils/
│   │   │   ├── id-generator.ts            # TaskId 生成器（ULID）
│   │   │   ├── url-validator.ts           # 回调 URL 安全校验
│   │   │   ├── retry-helper.ts            # 重试工具
│   │   │   └── percentile-calc.ts         # ★ 分位数计算工具
│   │   └── interfaces/
│   │       ├── api-response.interface.ts  # 统一响应结构
│   │       └── pagination.interface.ts    # 分页结构
│   │
│   ├── admin/                             # 管理后台 API 模块
│   │   ├── admin.module.ts
│   │   ├── admin.controller.ts            # 通用管理接口（回调重放等）
│   │   ├── admin.service.ts
│   │   ├── route-admin.controller.ts      # ★ 路由热切换管理接口
│   │   ├── route-admin.service.ts         # ★ 路由切换/回退逻辑
│   │   ├── queue-admin.controller.ts      # ★ 队列管理接口
│   │   ├── queue-admin.service.ts         # ★ 动态队列注册/统计查询
│   │   ├── dashboard-overview.controller.ts  # ☆ 总览页数据接口
│   │   ├── dashboard-overview.service.ts     # ☆ 总览指标聚合
│   │   ├── task-admin.controller.ts       # ☆ 任务记录（列表/详情/时间线/时长）
│   │   ├── task-admin.service.ts          # ☆ 任务记录业务逻辑
│   │   ├── auth-admin.controller.ts       # ☆ 管理后台登录/刷新 Token
│   │   ├── auth-admin.service.ts          # ☆ JWT 签发/校验/用户查询
│   │   ├── user-admin.controller.ts       # ☆ 用户管理 CRUD
│   │   ├── user-admin.service.ts
│   │   ├── audit-log.controller.ts        # ☆ 操作日志查询
│   │   ├── audit-log.service.ts           # ☆ 操作日志记录与查询
│   │   ├── guards/
│   │   │   ├── admin-jwt.guard.ts         # ☆ 管理后台 JWT 鉴权
│   │   │   └── roles.guard.ts             # ☆ RBAC 角色校验
│   │   ├── decorators/
│   │   │   └── roles.decorator.ts         # ☆ @Roles() 装饰器
│   │   ├── strategies/
│   │   │   └── admin-jwt.strategy.ts      # ☆ Passport JWT 策略
│   │   ├── dto/
│   │   │   ├── switch-provider.dto.ts
│   │   │   ├── rollback-route.dto.ts
│   │   │   ├── register-queue.dto.ts
│   │   │   ├── login.dto.ts               # ☆ { username, password }
│   │   │   ├── create-user.dto.ts         # ☆
│   │   │   ├── update-user.dto.ts         # ☆
│   │   │   └── audit-log-query.dto.ts     # ☆
│   │   ├── schemas/
│   │   │   ├── admin-user.schema.ts       # ☆ 管理后台用户
│   │   │   └── audit-log.schema.ts        # ☆ 操作日志
│   │   ├── enums/
│   │   │   ├── admin-role.enum.ts         # ☆ admin | operator | viewer
│   │   │   └── audit-action.enum.ts       # ☆ 操作类型枚举
│   │   └── interfaces/
│   │       └── admin-auth.interface.ts    # ☆ JWT payload 等类型
│   │
│   ├── dashboard/                         # ☆ 管理后台静态资源托管模块
│   │   └── dashboard.module.ts            # ☆ ServeStaticModule 注册
│   │
│   ├── workflow/                          # ★ 工作流引擎模块
│   │   ├── workflow.module.ts             # 工作流 CRUD + 执行调度
│   │   ├── workflow.controller.ts         # 工作流 API（v1/workflows）
│   │   ├── workflow.service.ts            # 工作流业务逻辑
│   │   ├── workflow-execution.service.ts  # 执行生命周期管理
│   │   ├── execution-graph.resolver.ts    # DAG 解析 + 拓扑排序 + 环检测
│   │   ├── node.executor.ts              # 节点执行器（Bull: workflow-node）
│   │   ├── port-schema.service.ts         # 节点端口定义
│   │   ├── workflow-template.service.ts   # 模板管理
│   │   ├── workflow-run.controller.ts     # 执行运行 API
│   │   └── workflow-template.controller.ts # 模板 API
│   │
│   ├── portal-auth/                       # ★ 开发者门户鉴权模块
│   │   ├── portal-auth.module.ts          # 独立 JWT 鉴权
│   │   ├── portal-auth.controller.ts      # 注册/登录/Token 管理
│   │   ├── portal-auth.service.ts         # HMAC-SHA256 JWT 签发
│   │   ├── portal-api-key.controller.ts   # API Key 管理
│   │   ├── portal-api-key.service.ts      # Key 生成（mh_ + ULID）
│   │   ├── role-permissions.config.ts     # 角色配额配置（user/vip/admin）
│   │   ├── guards/portal-jwt.guard.ts     # Portal JWT 守卫
│   │   └── decorators/portal-user.decorator.ts
│   │
│   ├── notification/                      # ★ 通知系统模块
│   │   ├── notification.module.ts         # 多渠道通知
│   │   ├── services/                      # 核心服务
│   │   │   ├── notification.service.ts    # 规则匹配 + 限流 + 入队
│   │   │   ├── rule-matcher.service.ts    # 事件规则匹配
│   │   │   ├── notification-rate-limiter.service.ts # 冷却 + 滑动窗口
│   │   │   └── in-app-notification.service.ts # 站内信
│   │   ├── channels/                      # 投递渠道
│   │   │   ├── notification-channel.interface.ts
│   │   │   ├── wecom.channel.ts           # 企业微信
│   │   │   ├── email.channel.ts           # 邮件
│   │   │   └── in-app.channel.ts          # 站内信
│   │   ├── processors/notification.processor.ts # Bull 队列消费
│   │   ├── listeners/notification.listener.ts   # 系统事件监听
│   │   └── controllers/                   # 管理 API
│   │
│   ├── provider-health/                   # ★ 供应商健康度模块
│   │   ├── provider-health.module.ts      # 熔断器 + 健康指标
│   │   ├── circuit-breaker.service.ts     # 三态熔断器状态机
│   │   ├── circuit-breaker-store.service.ts # Redis 状态存储（Lua CAS）
│   │   ├── health-metrics-collector.service.ts # 滑动窗口指标采集
│   │   └── circuit-breaker-config.service.ts # 熔断配置
│   │
│   ├── billing/                           # ★ 计费模块（@Global）
│   │   ├── billing.module.ts              # Pricing + Billing + Wallet
│   │   ├── billing.service.ts             # 计费记录生命周期
│   │   ├── wallet.service.ts              # 钱包原子操作
│   │   ├── pricing.service.ts             # 模型单价查询
│   │   └── billing.adapter.ts             # 统一入口（按策略分发）
│   │
│   ├── common/                            # 公共模块
│   │   ├── constants/error-codes.ts       # 错误码枚举
│   │   ├── constants/task-status.ts       # 任务状态枚举
│   │   ├── descriptors/index.ts           # ★ 功能模块描述符（18 个）
│   │   ├── feature-registry.module.ts     # ★ 描述符注册 + 同步插件
│   │   ├── process-type.util.ts           # ★ PROCESS_TYPE 校验（4 种 + monolith）
│   │   └── ...
│   │
├── portal/                                # ★ 开发者门户前端（React + React Flow）
│   ├── package.json                       # developer-portal
│   ├── src/
│   │   ├── main.tsx                       # 入口
│   │   ├── App.tsx                        # 路由 + 布局
│   │   ├── pages/                         # 页面
│   │   │   ├── Login.tsx / Register.tsx   # 自助注册/登录
│   │   │   ├── WorkflowList.tsx           # 工作流列表
│   │   │   ├── WorkflowEditor.tsx         # React Flow 可视化编辑器
│   │   │   ├── TemplateGallery.tsx        # 模板市场
│   │   │   ├── ApiKeys.tsx                # API Key 管理
│   │   │   └── Profile.tsx                # 个人中心
│   │   ├── components/Node/               # 自定义 React Flow 节点
│   │   ├── services/workflow-api.ts       # 工作流 API 封装
│   │   └── store/                         # Zustand 状态管理
│   ├── vite.config.ts
│   └── tsconfig.json
│
├── test/                                  # 测试目录
│   ├── unit/
│   │   ├── task/
│   │   │   ├── task.service.spec.ts
│   │   │   ├── task-timeline.service.spec.ts  # ★
│   │   │   ├── task-timing.service.spec.ts    # ★
│   │   │   └── idempotency.service.spec.ts
│   │   ├── provider/
│   │   │   ├── wavespeed.adapter.spec.ts      # ★
│   │   │   ├── cloudwise.adapter.spec.ts      # ★
│   │   │   ├── akool.adapter.spec.ts          # ★
│   │   │   ├── model-router.service.spec.ts   # ★
│   │   │   └── provider.factory.spec.ts
│   │   ├── queue/
│   │   │   ├── queue-router.service.spec.ts   # ★
│   │   │   └── queue-stats-collector.spec.ts  # ★
│   │   ├── stats/
│   │   │   └── stats.service.spec.ts          # ★
│   │   ├── callback/
│   │   │   ├── callback.service.spec.ts
│   │   │   └── callback-signature.service.spec.ts
│   │   └── polling/
│   │       ├── polling.service.spec.ts
│   │       └── polling-interval.strategy.spec.ts
│   ├── integration/
│   │   ├── task-flow.integration.spec.ts
│   │   ├── queue-consumer.integration.spec.ts
│   │   ├── route-switch.integration.spec.ts   # ★
│   │   ├── stats-aggregation.integration.spec.ts # ★
│   │   └── callback-retry.integration.spec.ts
│   └── e2e/
│       └── task.e2e-spec.ts
│
├── dashboard/                             # ☆ 管理后台前端（React + Ant Design + Vite）
│   ├── public/
│   │   └── favicon.ico
│   ├── src/
│   │   ├── main.tsx                       # 入口
│   │   ├── App.tsx                        # 根组件（路由 + 布局）
│   │   ├── router/
│   │   │   └── index.tsx                  # React Router v6 路由定义
│   │   ├── layouts/
│   │   │   ├── AdminLayout.tsx            # Sidebar + Header + Content 布局
│   │   │   └── AuthLayout.tsx             # 登录页布局
│   │   ├── pages/
│   │   │   ├── LoginPage.tsx              # 登录页
│   │   │   ├── DashboardPage.tsx          # 总览页（核心指标 + 趋势图表）
│   │   │   ├── TaskListPage.tsx           # 任务列表（表格 + 筛选）
│   │   │   ├── TaskDetailPage.tsx         # 任务详情（时间线 + 时长甘特图）
│   │   │   ├── QueueMonitorPage.tsx       # 队列监控（实时面板 + 历史趋势）
│   │   │   ├── RouteManagePage.tsx        # 路由管理（列表 + 灰度切换）
│   │   │   ├── StatsReportPage.tsx        # 统计报表（每日/每月）
│   │   │   ├── ProviderComparePage.tsx    # 厂商对比（雷达图 + 对比表）
│   │   │   ├── ProviderConfigPage.tsx     # 厂商配置管理
│   │   │   ├── AlertConfigPage.tsx        # 告警规则管理
│   │   │   ├── UserManagePage.tsx         # 用户管理
│   │   │   └── AuditLogPage.tsx           # 操作日志
│   │   ├── components/
│   │   │   ├── StatCard.tsx               # 核心指标卡片
│   │   │   ├── TrendChart.tsx             # ECharts 趋势图封装
│   │   │   ├── QueueCard.tsx              # 队列状态卡片
│   │   │   ├── QueueGroupPanel.tsx        # 按功能分组面板
│   │   │   ├── TaskTable.tsx              # 任务列表表格
│   │   │   ├── TaskTimeline.tsx           # 任务时间线（Steps）
│   │   │   ├── TaskTimingBar.tsx          # 时长甘特图
│   │   │   ├── RouteTable.tsx             # 路由列表表格
│   │   │   ├── RouteWeightSlider.tsx      # 厂商权重分配滑块
│   │   │   ├── RouteSwitchModal.tsx       # 路由切换弹窗
│   │   │   ├── ProviderCompareChart.tsx   # 厂商对比雷达图
│   │   │   ├── DailyStatsTable.tsx        # 每日统计表格
│   │   │   ├── AuditLogTable.tsx          # 操作日志表格
│   │   │   ├── StatusTag.tsx              # 状态彩色标签
│   │   │   └── AutoRefresh.tsx            # 自动刷新控制器
│   │   ├── services/
│   │   │   ├── api.ts                     # Axios 实例（baseURL + 拦截器）
│   │   │   ├── auth.service.ts            # 登录 / 刷新 / 退出
│   │   │   ├── task.service.ts            # 任务相关 API
│   │   │   ├── queue.service.ts           # 队列相关 API
│   │   │   ├── route.service.ts           # 路由相关 API
│   │   │   ├── stats.service.ts           # 统计相关 API
│   │   │   └── user.service.ts            # 用户管理 API
│   │   ├── stores/
│   │   │   ├── auth.store.ts              # Zustand 鉴权状态
│   │   │   └── app.store.ts               # 全局 UI 状态
│   │   ├── hooks/
│   │   │   ├── useAutoRefresh.ts          # 自动刷新 Hook
│   │   │   └── usePermission.ts           # 角色权限 Hook
│   │   ├── types/
│   │   │   ├── task.types.ts
│   │   │   ├── queue.types.ts
│   │   │   ├── route.types.ts
│   │   │   ├── stats.types.ts
│   │   │   └── user.types.ts
│   │   └── utils/
│   │       ├── format.ts                  # 日期/数字格式化
│   │       └── export.ts                  # CSV/Excel 导出
│   ├── index.html
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── package.json
│
├── .env.example                           # 环境变量模板
├── .env                                   # 环境变量（.gitignore）
├── .gitignore
├── .eslintrc.js
├── .prettierrc
├── tsconfig.json
├── tsconfig.build.json
├── nest-cli.json
├── package.json
├── ecosystem.config.js                    # PM2 配置
├── Dockerfile
├── docker-compose.yml                     # 本地开发 Docker Compose
└── README.md
```

---

## 2. NestJS 模块清单与入口

### 2.1 main.ts 入口（按进程类型启动）

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

### 2.2 app.module.ts 根模块

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

### 2.3 模块注册清单

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

## 3. Controller 定义清单

### 3.1 TaskController

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

### 3.2 AdminController

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

### 3.3 ★ RouteAdminController（v2.0 新增 - 路由热切换管理）

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

### 3.4 ★ QueueAdminController（v2.0 新增 - 队列统计管理）

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

### 3.5 ★ StatsController（v2.0 新增 - 数据聚合统计）

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

### 3.6 ☆ AuthAdminController（v2.1 新增 - 管理后台登录）

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

### 3.7 ☆ DashboardOverviewController（v2.1 新增 - 总览数据）

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

### 3.8 ☆ TaskAdminController（v2.1 新增 - 任务记录）

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

### 3.9 ☆ UserAdminController（v2.1 新增 - 用户管理）

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

### 3.10 ☆ AuditLogController（v2.1 新增 - 操作日志）

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

### 3.11 HealthController

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

## 4. Service 定义清单

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

## 5. DTO 定义清单

### 5.1 CreateTaskDto

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

### 5.2 TaskListQueryDto

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

### 5.3 TaskResponseDto

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

### 5.4 ★ FeatureType 枚举（v2.0 新增）

```typescript
// src/task/enums/feature-type.enum.ts
export enum FeatureType {
  IMAGE_GENERATE = 'image_generate',
  IMAGE_TO_VIDEO = 'image_to_video',
  CHARACTER_SWAP = 'character_swap',
  VIDEO_UPSCALE  = 'video_upscale',
}
```

### 5.5 ★ TimelineEvent 枚举（v2.0 新增）

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

### 5.6 ★ TaskTimingResponseDto（v2.0 新增）

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

### 5.7 ★ SwitchProviderDto（v2.0 新增 - 路由切换）

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

## 6. Mongoose Schema 定义

### 6.1 Task Schema（★ v2.0 增强：timing + timeline + featureType + routeId）

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

### 6.2 Idempotency Schema

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

### 6.3 CallbackLog Schema

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

### 6.4 ★ ModelRoute Schema（v2.0 新增 - 路由配置）

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

### 6.5 ★ QueueSnapshot Schema（v2.0 新增 - 队列快照）

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

### 6.6 ★ TaskDailyStats Schema（v2.0 新增 - 每日聚合统计）

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

### 6.7 ★ TaskMonthlyStats Schema（v2.0 新增 - 每月聚合统计）

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

## 7. Bull Queue & Processor 清单

### 7.1 队列常量（★ v2.0 按功能拆分）

```typescript
// src/queue/constants/queue.constants.ts

export const FEATURE_QUEUES = {
  IMAGE_GENERATE: 'image-generate',
  IMAGE_TO_VIDEO: 'image-to-video',
  CHARACTER_SWAP: 'character-swap',
  VIDEO_UPSCALE: 'video-upscale',
} as const;

export const CROSS_CUT_QUEUES = {
  CALLBACK: 'callback',
  DEAD_LETTER: 'dead-letter',
} as const;

export const JOB_NAMES = {
  SUBMIT_TO_PROVIDER: 'submit-to-provider',
  SEND_CALLBACK: 'send-callback',
  DEAD_LETTER_CALLBACK: 'dead-letter-callback',
} as const;

// 厂商级子队列命名规则: "{featureType}:{provider}"
export function providerQueueName(featureType: string, provider: string): string {
  return `${featureType}:${provider}`;
}

// 各功能+厂商的并发配置
export const PROVIDER_CONCURRENCY: Record<string, Record<string, number>> = {
  'image-generate':  { 'wavespeed-ai': 10, 'cloudwise': 200, 'akool': 20 },
  'image-to-video':  { 'wavespeed-ai': 10, 'akool': 10 },
  'character-swap':  { 'wavespeed-ai': 10 },
  'video-upscale':   { 'wavespeed-ai': 5 },
};
```

### 7.2 Queue Module 注册（★ v2.0 按功能注册）

```typescript
// src/queue/queue.module.ts
const FEATURE_QUEUE_DEFAULTS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2000 },
  timeout: 60000,
  removeOnComplete: { age: 3600, count: 10000 },
  removeOnFail: { age: 86400 },
};

@Module({
  imports: [
    // 功能级队列
    BullModule.registerQueue(
      { name: FEATURE_QUEUES.IMAGE_GENERATE, defaultJobOptions: FEATURE_QUEUE_DEFAULTS },
      { name: FEATURE_QUEUES.IMAGE_TO_VIDEO, defaultJobOptions: FEATURE_QUEUE_DEFAULTS },
      { name: FEATURE_QUEUES.CHARACTER_SWAP, defaultJobOptions: FEATURE_QUEUE_DEFAULTS },
      { name: FEATURE_QUEUES.VIDEO_UPSCALE, defaultJobOptions: FEATURE_QUEUE_DEFAULTS },
      // 厂商级子队列（高并发场景）
      { name: 'image-generate:wavespeed-ai', defaultJobOptions: FEATURE_QUEUE_DEFAULTS },
      { name: 'image-generate:cloudwise', defaultJobOptions: FEATURE_QUEUE_DEFAULTS },
      { name: 'image-generate:akool', defaultJobOptions: FEATURE_QUEUE_DEFAULTS },
      { name: 'image-to-video:wavespeed-ai', defaultJobOptions: FEATURE_QUEUE_DEFAULTS },
      { name: 'image-to-video:akool', defaultJobOptions: FEATURE_QUEUE_DEFAULTS },
      { name: 'character-swap:wavespeed-ai', defaultJobOptions: FEATURE_QUEUE_DEFAULTS },
      { name: 'video-upscale:wavespeed-ai', defaultJobOptions: FEATURE_QUEUE_DEFAULTS },
      // 横切队列
      { name: CROSS_CUT_QUEUES.CALLBACK, defaultJobOptions: { attempts: 6, timeout: 30000, removeOnComplete: true, removeOnFail: false } },
      { name: CROSS_CUT_QUEUES.DEAD_LETTER, defaultJobOptions: { removeOnComplete: false, removeOnFail: false } },
    ),
  ],
  providers: [
    ImageGenerateProcessor, ImageToVideoProcessor,
    CharacterSwapProcessor, VideoUpscaleProcessor,
    CallbackProcessor,
    QueueRegistryService, QueueRouterService, QueueStatsCollector,
  ],
  exports: [BullModule, QueueRegistryService, QueueRouterService],
})
export class QueueModule {}
```

### 7.3 功能级 Processor（★ v2.0 每个功能独立消费者）

```typescript
// src/queue/processors/image-generate.processor.ts
@Processor(FEATURE_QUEUES.IMAGE_GENERATE)
export class ImageGenerateProcessor extends BaseFeatureProcessor {
  // 入口队列：分发到厂商级子队列或直接处理
  @Process(JOB_NAMES.SUBMIT_TO_PROVIDER)
  async handle(job: Job<TaskSubmitJobData>): Promise<void> {
    await this.routeOrProcess(job);
  }
}

// src/queue/processors/image-to-video.processor.ts
@Processor(FEATURE_QUEUES.IMAGE_TO_VIDEO)
export class ImageToVideoProcessor extends BaseFeatureProcessor { /* 同上模式 */ }

// src/queue/processors/character-swap.processor.ts
@Processor(FEATURE_QUEUES.CHARACTER_SWAP)
export class CharacterSwapProcessor extends BaseFeatureProcessor { /* 同上模式 */ }

// src/queue/processors/video-upscale.processor.ts
@Processor(FEATURE_QUEUES.VIDEO_UPSCALE)
export class VideoUpscaleProcessor extends BaseFeatureProcessor { /* 同上模式 */ }

// 基类封装：时间线记录、时长采集、厂商调用、状态更新
class BaseFeatureProcessor {
  async routeOrProcess(job: Job<TaskSubmitJobData>): Promise<void> {
    const { taskId, provider } = job.data;
    // 1. 记录 TASK_DEQUEUED 时间线
    // 2. 计算 dequeuedAt 时间
    // 3. 尝试转发到厂商级子队列
    // 4. 若无子队列，直接调用 Adapter
    // 5. 记录 PROVIDER_SUBMIT_OK / PROVIDER_SUBMIT_FAIL 时间线
    // 6. 更新 timing 字段
  }
}
```

### 7.4 CallbackProcessor

```typescript
// src/queue/processors/callback.processor.ts
@Processor(CROSS_CUT_QUEUES.CALLBACK)
export class CallbackProcessor {
  @Process(JOB_NAMES.SEND_CALLBACK)
  async handleCallback(job: Job<CallbackJobData>): Promise<void> {
    await this.callbackService.sendCallback(job.data.taskId, job.attemptsMade);
  }

  @OnQueueFailed()
  async handleFailed(job: Job, error: Error): Promise<void> {
    if (job.attemptsMade >= job.opts.attempts) {
      await this.callbackService.handleDeadLetter(job.data.taskId);
    }
  }
}
```

### 7.5 Job Data 接口

```typescript
// src/queue/interfaces/task-submit-job.interface.ts
export interface TaskSubmitJobData {
  taskId: string;
  provider: string;
  model: string;
  featureType: string;          // ★ 功能类型
  priority: number;
  tenantId: string;
  traceId: string;
  enqueuedAt: number;           // ★ 入队时间戳（计算等待时长）
}

// src/queue/interfaces/callback-job.interface.ts
export interface CallbackJobData {
  taskId: string;
  callbackUrl: string;
  callbackSecret?: string;
  traceId: string;
}
```

---

## 8. Provider Adapter 清单

### 8.1 核心接口

> 详细的 Provider Adapter 接口定义请参考 [technical-design.md - Provider Adapter 统一抽象层](./technical-design.md#7-provider-adapter-统一抽象层)

### 8.2 Adapter 实现列表

| Adapter | 文件 | 厂商 | 模式 | 支持功能 | 优先级 |
|---------|------|------|------|---------|--------|
| `WaveSpeedAdapter` | `adapters/wavespeed.adapter.ts` | WaveSpeed AI | 异步轮询 | 图生图/文生图/图生视频/文生视频/角色换装/视频超分 | MVP |
| `CloudwiseAdapter` | `adapters/cloudwise.adapter.ts` | Cloudwise | 异步轮询 | 文生图/图生图 | MVP |
| `AkoolAdapter` | `adapters/akool.adapter.ts` | Akool 自有 | 异步轮询 | 图生视频/文生视频/文生图/Avatar | MVP |
| `BaseAdapter` | `adapters/base.adapter.ts` | - | - | 抽象基类：HTTP 封装、错误处理、日志 | MVP |

### 8.3 Provider Registry

```typescript
// src/provider/provider.registry.ts
@Injectable()
export class ProviderRegistry {
  private adapters = new Map<string, IProviderAdapter>();

  register(adapter: IProviderAdapter): void {
    this.adapters.set(adapter.providerName, adapter);
  }

  getAdapter(providerName: string): IProviderAdapter {
    const adapter = this.adapters.get(providerName);
    if (!adapter) {
      throw new NotFoundException(`Provider "${providerName}" not registered`);
    }
    return adapter;
  }

  listProviders(): string[] {
    return Array.from(this.adapters.keys());
  }
}
```

### 8.4 Model → Provider 路由（支持热切换）

```typescript
// src/provider/model-router.service.ts
@Injectable()
export class ModelRouterService implements OnModuleInit {
  private routeCache = new Map<string, ModelRoute>();

  async onModuleInit() {
    await this.refreshCache();
    // 监听 Redis pub/sub 路由变更事件
    this.redisPubSub.subscribe('model-hub:route-changed:*', (routeId) => {
      this.refreshSingleRoute(routeId);
    });
  }

  async resolve(model: string, tenantId?: string, scene?: string): Promise<ResolvedRoute> {
    const route = this.routeCache.get(model) || await this.loadRouteFromDB(model);
    if (!route) {
      throw new BadRequestException(`Unsupported model: ${model}`);
    }

    // 按权重 + 条件选择 provider
    const selectedRule = this.selectRule(route.activeRules, tenantId, scene);
    return {
      provider: selectedRule.provider,
      providerModel: selectedRule.providerModel,
      routeId: route.routeId,
      featureType: route.featureType,
    };
  }
}
```

**初始路由配置（通过 seed 脚本或管理接口写入 `model_routes` 集合）：**

| model | featureType | provider | providerModel |
|-------|-------------|----------|---------------|
| `wavespeed-ai/flux-2-pro/text-to-image` | image_generate | wavespeed-ai | flux-2-pro |
| `cloudwise/nano-banana/text-to-image` | image_generate | cloudwise | nano-banana |
| `cloudwise/nano-banana-pro/text-to-image` | image_generate | cloudwise | nano-banana-pro |
| `akool/text-to-image` | image_generate | akool | imgGenByPrompt |
| `wavespeed-ai/wan-2.1/image-to-video` | image_to_video | wavespeed-ai | wan-2.1 |
| `akool/image-to-video` | image_to_video | akool | itv |
| `wavespeed-ai/wan-2.2/animate` | character_swap | wavespeed-ai | wan-2.2 |
| `wavespeed-ai/video-upscale` | video_upscale | wavespeed-ai | video-upscale |

---

## 9. Guard & Interceptor 清单

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

## 10. 配置文件模板

### 10.1 .env.example

```bash
# ===== 应用配置 =====
NODE_ENV=development
PORT=3000
PROCESS_TYPE=api                        # api | worker-image-generate | worker-image-to-video | worker-character-swap | worker-video-upscale | worker-callback | scheduler

# ===== MongoDB =====
MONGODB_URI=mongodb://localhost:27017/model-hub

# ===== Redis =====
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# ===== Nacos 配置中心（与 Akool 现有服务一致；NACOS_ENABLE=false 时走本文件其余变量）=====
NACOS_ENABLE=false
# NACOS_SERVER_ADDR=nacos-public.akool.io:8848
# NACOS_NAMESPACE=
# NACOS_DATA_ID=model-hub
# NACOS_GROUP=DEFAULT_GROUP
# NACOS_USERNAME=
# NACOS_PASSWORD=

# ===== 鉴权（业务 API）=====
API_KEY_HEADER=X-API-Key
SERVICE_TOKEN=your-internal-service-token

# ===== ☆ 管理后台 =====
ADMIN_PORT=3001
ADMIN_JWT_SECRET=your-admin-jwt-secret
ADMIN_JWT_EXPIRES_IN=2h
ADMIN_REFRESH_SECRET=your-admin-refresh-secret
ADMIN_REFRESH_EXPIRES_IN=7d
ADMIN_ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3001
ADMIN_DEFAULT_USERNAME=admin
ADMIN_DEFAULT_PASSWORD=changeme123

# ===== 回调 =====
DEFAULT_CALLBACK_SECRET=default-hmac-secret
CALLBACK_TIMEOUT_MS=10000
CALLBACK_MAX_RETRIES=6

# ===== 轮询 =====
POLLING_CRON=*/30 * * * * *
POLLING_LOCK_TTL_MS=30000
POLLING_BATCH_SIZE=200
POLLING_DEFAULT_INTERVAL_MS=30000
POLLING_MAX_INTERVAL_MS=60000
POLLING_MAX_POLL_COUNT=720
POLLING_MAX_DURATION_MS=3600000

# ===== 厂商配置 - WaveSpeed AI =====
WAVESPEED_API_KEY=your-wavespeed-api-key
WAVESPEED_BASE_URL=https://api.wavespeed.ai/api/v3
WAVESPEED_MAX_CONCURRENT=10
WAVESPEED_MAX_PER_SECOND=5

# ===== 厂商配置 - Cloudwise =====
CLOUDWISE_API_KEY=your-cloudwise-api-key
CLOUDWISE_BASE_URL=https://api.cloudwise.ai/v1
CLOUDWISE_MAX_CONCURRENT=200
CLOUDWISE_MAX_PER_SECOND=50

# ===== 厂商配置 - Akool 自有模型 =====
AKOOL_API_KEY=your-akool-internal-key
AKOOL_BASE_URL=http://internal-algorithm-queue.akool.com
AKOOL_MAX_CONCURRENT=50
AKOOL_MAX_PER_SECOND=20

# ===== 统计 =====
STATS_DAILY_CRON=0 1 * * *             # 每日 01:00 聚合
STATS_MONTHLY_CRON=0 2 1 * *           # 每月 1 号 02:00 聚合
QUEUE_STATS_INTERVAL_CRON=*/30 * * * * *  # 每 30 秒采集队列快照

# ===== 限流 =====
GLOBAL_RATE_LIMIT_TTL=60
GLOBAL_RATE_LIMIT_MAX=100
TENANT_RATE_LIMIT_TTL=60
TENANT_RATE_LIMIT_MAX=500

# ===== CORS =====
ALLOWED_ORIGINS=https://app.akool.com,https://api.akool.com

# ===== 日志 =====
LOG_LEVEL=info
LOG_FORMAT=json

# ===== 监控 =====
METRICS_ENABLED=true
METRICS_PORT=9090
```

### 10.2 配置校验 Schema

```typescript
// src/config/config.schema.ts
import * as Joi from 'joi';

export const configValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'staging', 'production').default('development'),
  PORT: Joi.number().default(3000),
  PROCESS_TYPE: Joi.string().valid(
    'api', 'admin-server',
    'worker-image-generate', 'worker-image-to-video', 'worker-character-swap', 'worker-video-upscale', 'worker-callback',
    'scheduler',
  ).default('api'),

  // ☆ 管理后台
  ADMIN_PORT: Joi.number().default(3001),
  ADMIN_JWT_SECRET: Joi.string().when('PROCESS_TYPE', {
    is: 'admin-server', then: Joi.required(), otherwise: Joi.optional(),
  }),

  MONGODB_URI: Joi.string().required(),

  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').default(''),
  REDIS_DB: Joi.number().default(0),

  // Nacos（与 technical-design §5.3 一致；.env 中为字符串）
  NACOS_ENABLE: Joi.string().valid('true', 'false').default('false'),
  NACOS_SERVER_ADDR: Joi.string().optional().allow(''),
  NACOS_NAMESPACE: Joi.string().optional().allow(''),
  NACOS_DATA_ID: Joi.string().default('model-hub'),
  NACOS_GROUP: Joi.string().default('DEFAULT_GROUP'),
  NACOS_USERNAME: Joi.string().optional().allow(''),
  NACOS_PASSWORD: Joi.string().optional().allow(''),

  DEFAULT_CALLBACK_SECRET: Joi.string().required(),
  CALLBACK_TIMEOUT_MS: Joi.number().default(10000),
  CALLBACK_MAX_RETRIES: Joi.number().default(6),

  POLLING_BATCH_SIZE: Joi.number().default(200),
  POLLING_DEFAULT_INTERVAL_MS: Joi.number().default(30000),
  POLLING_MAX_POLL_COUNT: Joi.number().default(720),
  POLLING_MAX_DURATION_MS: Joi.number().default(3600000),

  REPLICATE_API_TOKEN: Joi.string().when('PROCESS_TYPE', {
    is: Joi.valid('worker-submit', 'scheduler'),
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),

  LOG_LEVEL: Joi.string().valid('debug', 'info', 'warn', 'error').default('info'),
});
```

---

## 11. PM2 进程管理与部署配置

### 11.1 PM2 配置文件（ecosystem.config.js）

实际的 PM2 配置包含 **4 个进程**：

```javascript
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'model-hub-api',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'cluster',
      env: {
        PROCESS_TYPE: 'api',
        PORT: 7000,
      },
    },
    {
      name: 'model-hub-worker',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        PROCESS_TYPE: 'worker',
        PORT: 7001,
      },
    },
    {
      name: 'model-hub-scheduler',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        PROCESS_TYPE: 'scheduler',
        PORT: 7002,
      },
    },
    {
      name: 'model-hub-admin-server',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        PROCESS_TYPE: 'admin-server',
        PORT: 7003,
      },
    },
    // ★ 开发者门户前端（Vite 开发服务器，生产环境用 Nginx 托管）
    {
      name: 'model-hub-portal',
      script: 'node_modules/vite/bin/vite.js',
      cwd: './portal',
      instances: 1,
      exec_mode: 'fork',
      env: {
        PORT: 7004,
      },
    },
  ],
};
```

### 11.2 PM2 常用命令

**启动服务**：
```bash
# 启动所有进程
pm2 start ecosystem.config.js

# 启动单个进程
pm2 start ecosystem.config.js --only model-hub-api
```

**管理进程**：
```bash
# 查看进程状态
pm2 list
pm2 status

# 查看进程详情
pm2 show model-hub-api

# 查看日志
pm2 logs
pm2 logs model-hub-api
pm2 logs --lines 100

# 重启进程
pm2 restart model-hub-api
pm2 restart all

# 停止进程
pm2 stop model-hub-api
pm2 stop all

# 删除进程
pm2 delete model-hub-api
pm2 delete all
```

**监控和调试**：
```bash
# 实时监控
pm2 monit

# 查看进程指标
pm2 describe model-hub-api

# 重载进程（零停机）
pm2 reload model-hub-api
```

**持久化配置**：
```bash
# 保存当前进程列表
pm2 save

# 设置开机自启
pm2 startup
pm2 save
```

### 11.3 进程说明

| 进程名 | PROCESS_TYPE | 端口 | 实例数 | 说明 |
|--------|-------------|------|--------|------|
| model-hub-api | api | 7000 | 1-4 | 业务 API + 工作流 API + Portal 鉴权，可根据负载调整 |
| model-hub-worker | worker | 7001 | 1-4 | 消费所有 Bull 队列（任务提交 + 回调 + 通知 + 工作流节点），可根据队列积压调整 |
| model-hub-scheduler | scheduler | 7002 | 1 | 定时轮询 + 统计聚合，只能单实例运行（分布式锁） |
| model-hub-admin-server | admin-server | 7003 | 1 | 管理后台 API + React SPA 托管，通常单实例即可 |
| model-hub-portal | — | 7004 | 1 | 开发者门户前端（Vite），生产环境建议用 Nginx 托管静态文件 |

**扩容建议**：
- **api**：根据 QPS 调整，建议 2-4 实例
- **worker**：根据队列积压情况调整，建议 2-4 实例
- **scheduler**：必须单实例，避免重复执行
- **admin-server**：通常单实例，低频访问

### 11.4 环境变量配置

创建 `.env` 文件（基于 `.env.example`）：

```bash
# ===== 应用配置 =====
NODE_ENV=production
PORT=7000
PROCESS_TYPE=api

# ===== MongoDB =====
MONGODB_URI=mongodb://username:password@host:27017/model-hub?authSource=admin

# ===== Redis =====
REDIS_HOST=redis-host
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password
REDIS_DB=0

# ===== Nacos 配置中心（可选）=====
NACOS_ENABLE=false
# NACOS_SERVER_ADDR=nacos-server:8848
# NACOS_NAMESPACE=production
# NACOS_DATA_ID=model-hub
# NACOS_GROUP=DEFAULT_GROUP
# NACOS_USERNAME=nacos
# NACOS_PASSWORD=nacos-password

# ===== 鉴权 =====
API_KEY_HEADER=X-API-Key
SERVICE_TOKEN=your-internal-service-token-change-me

# ===== 管理后台 =====
ADMIN_PORT=7003
ADMIN_JWT_SECRET=your-admin-jwt-secret-change-me-min-32-chars
ADMIN_JWT_EXPIRES_IN=2h
ADMIN_REFRESH_SECRET=your-admin-refresh-secret-change-me
ADMIN_REFRESH_EXPIRES_IN=7d
ADMIN_ALLOWED_ORIGINS=https://admin.yourdomain.com
ADMIN_DEFAULT_USERNAME=admin
ADMIN_DEFAULT_PASSWORD=changeme123

# ===== 回调 =====
DEFAULT_CALLBACK_SECRET=your-callback-hmac-secret-change-me
CALLBACK_TIMEOUT_MS=10000
CALLBACK_MAX_RETRIES=6

# ===== 轮询 =====
POLLING_CRON=*/30 * * * * *
POLLING_LOCK_TTL_MS=30000
POLLING_BATCH_SIZE=200
POLLING_DEFAULT_INTERVAL_MS=30000
POLLING_MAX_INTERVAL_MS=60000
POLLING_MAX_POLL_COUNT=720
POLLING_MAX_DURATION_MS=3600000

# ===== 厂商配置 - WaveSpeed AI =====
WAVESPEED_API_KEY=your-wavespeed-api-key
WAVESPEED_BASE_URL=https://api.wavespeed.ai/api/v3
WAVESPEED_MAX_CONCURRENT=10
WAVESPEED_MAX_PER_SECOND=5

# ===== 厂商配置 - Cloudwise =====
CLOUDWISE_API_KEY=your-cloudwise-api-key
CLOUDWISE_BASE_URL=https://api.cloudwise.ai/v1
CLOUDWISE_MAX_CONCURRENT=200
CLOUDWISE_MAX_PER_SECOND=50

# ===== 厂商配置 - Akool =====
AKOOL_API_KEY=your-akool-internal-key
AKOOL_BASE_URL=http://internal-algorithm-queue.akool.com
AKOOL_MAX_CONCURRENT=50
AKOOL_MAX_PER_SECOND=20

# ===== 厂商配置 - MiniMax =====
MINIMAX_API_KEY=your-minimax-api-key
MINIMAX_BASE_URL=https://api.minimax.com
MINIMAX_MAX_CONCURRENT=20
MINIMAX_MAX_PER_SECOND=10

# ===== 厂商配置 - Seedance（火山豆包）=====
SEEDANCE_API_KEY=your-seedance-api-key
SEEDANCE_BASE_URL=https://api.seedance.com
SEEDANCE_MAX_CONCURRENT=30
SEEDANCE_MAX_PER_SECOND=15

# ===== 厂商配置 - Wan（阿里万相）=====
WAN_API_KEY=your-wan-api-key
WAN_BASE_URL=https://api.aliyun.com/wan
WAN_MAX_CONCURRENT=20
WAN_MAX_PER_SECOND=10
```

**安全注意事项**：

必须修改的密钥：
- `SERVICE_TOKEN`：服务间鉴权 token
- `ADMIN_JWT_SECRET`：管理后台 JWT 密钥（至少 32 字符）
- `ADMIN_REFRESH_SECRET`：刷新 token 密钥
- `DEFAULT_CALLBACK_SECRET`：回调签名密钥
- `ADMIN_DEFAULT_PASSWORD`：管理员默认密码（首次登录后立即修改）

厂商 API Key：
- 所有厂商的 API Key 必须配置
- 生产环境建议使用 Nacos 或其他密钥管理服务

权限控制：
```bash
# 设置 .env 文件权限
chmod 600 .env
chown app-user:app-group .env
```

### 11.5 模型配置同步

Model-Hub 提供了两个脚本用于模型配置管理：

1. **collect-model-configs.cjs**：从 AGI-Content 收集模型配置
2. **apply-model-config-seed.cjs**：将配置导入到 Model-Hub 数据库

**收集模型配置**：

从 AGI-Content 项目收集模型配置到种子文件：

```bash
# 进入 model-hub 目录
cd model-hub

# 运行收集脚本
node scripts/collect-model-configs.cjs

# 输出文件：seed/model-configs.json
```

**导入模型配置**：

将种子文件导入到 MongoDB：

```bash
# 方式 1：使用 npm script
npm run seed:model-configs

# 方式 2：直接运行脚本
node scripts/apply-model-config-seed.cjs

# 指定环境
NODE_ENV=production node scripts/apply-model-config-seed.cjs
```

**配置同步流程**：

首次部署：
```bash
# 1. 收集配置
node scripts/collect-model-configs.cjs

# 2. 检查生成的配置文件
cat seed/model-configs.json

# 3. 导入到数据库
npm run seed:model-configs
```

定期同步（当 AGI-Content 新增模型时）：
```bash
# 1. 拉取最新代码
cd AGI-Content
git pull

# 2. 重新收集配置
cd ../model-hub
node scripts/collect-model-configs.cjs

# 3. 对比差异
git diff seed/model-configs.json

# 4. 导入更新
npm run seed:model-configs
```

### 11.6 Dashboard 构建与部署

管理后台前端需要单独构建：

```bash
# 进入 dashboard 目录
cd dashboard

# 安装依赖
npm install

# 构建生产版本
npm run build

# 输出目录：dashboard/dist
```

**部署流程**：

方式 1：NestJS 静态托管（推荐）

admin-server 进程会自动托管 `dashboard/dist` 目录：

```bash
# 1. 构建 Dashboard
cd dashboard && npm run build && cd ..

# 2. 构建后端
npm run build

# 3. 启动 admin-server
pm2 start ecosystem.config.js --only model-hub-admin-server

# 4. 访问
# http://localhost:7003
```

方式 2：Nginx 独立部署

如果需要独立部署前端：

```nginx
server {
    listen 80;
    server_name admin.yourdomain.com;

    root /path/to/model-hub/dashboard/dist;
    index index.html;

    # SPA 路由支持
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API 代理
    location /api/ {
        proxy_pass http://localhost:7003;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 11.7 部署流程

**首次部署**：

```bash
# 1. 克隆代码
git clone <repository-url>
cd model-hub

# 2. 安装依赖
npm install
cd dashboard && npm install && cd ..

# 3. 配置环境变量
cp .env.example .env
vim .env  # 修改配置

# 4. 构建 Dashboard
cd dashboard
npm run build
cd ..

# 5. 构建后端
npm run build

# 6. 初始化数据库
# 导入模型配置
npm run seed:model-configs

# 7. 启动服务
pm2 start ecosystem.config.js

# 8. 保存 PM2 配置
pm2 save

# 9. 设置开机自启
pm2 startup
```

**更新部署**：

```bash
# 1. 拉取最新代码
git pull origin main

# 2. 安装新依赖（如有）
npm install
cd dashboard && npm install && cd ..

# 3. 重新构建 Dashboard（如有前端更新）
cd dashboard
npm run build
cd ..

# 4. 重新构建后端
npm run build

# 5. 重启服务（零停机）
pm2 reload all

# 或分批重启
pm2 reload model-hub-api
pm2 reload model-hub-worker
pm2 reload model-hub-scheduler
pm2 reload model-hub-admin-server

# 6. 检查服务状态
pm2 list
pm2 logs --lines 50
```

### 11.8 Docker 配置

> **说明**：管理后台前端构建与部署流程详见 [technical-design.md - 管理后台设计](./technical-design.md#24-管理后台设计)。

**Dockerfile**（多阶段构建示意；`backend-builder` / `dashboard-builder` 等前置阶段略）：

```dockerfile
# Stage 3: 生产镜像
FROM node:18-alpine
WORKDIR /app
COPY --from=backend-builder /prod_node_modules ./node_modules
COPY --from=backend-builder /app/dist ./dist
COPY --from=backend-builder /app/package.json ./
COPY --from=backend-builder /app/ecosystem.config.js ./
COPY --from=dashboard-builder /app/dashboard/dist ./dashboard/dist

RUN npm install -g pm2

EXPOSE 7000 7003
CMD ["pm2-runtime", "ecosystem.config.js"]
```

**docker-compose.yml（本地开发）**：

```yaml
version: '3.8'

services:
  mongodb:
    image: mongo:7
    ports:
      - "27017:27017"
    volumes:
      - mongodb_data:/data/db

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data

  model-hub-api:
    build: .
    ports:
      - "7000:7000"
    environment:
      - PROCESS_TYPE=api
      - PORT=7000
      - MONGODB_URI=mongodb://mongodb:27017/model-hub
      - REDIS_HOST=redis
    depends_on:
      - mongodb
      - redis
    env_file:
      - .env

  model-hub-worker:
    build: .
    environment:
      - PROCESS_TYPE=worker
      - PORT=7001
      - MONGODB_URI=mongodb://mongodb:27017/model-hub
      - REDIS_HOST=redis
    depends_on:
      - mongodb
      - redis
    env_file:
      - .env

  model-hub-scheduler:
    build: .
    environment:
      - PROCESS_TYPE=scheduler
      - PORT=7002
      - MONGODB_URI=mongodb://mongodb:27017/model-hub
      - REDIS_HOST=redis
    depends_on:
      - mongodb
      - redis
    env_file:
      - .env

  model-hub-admin:
    build: .
    ports:
      - "7003:7003"
    environment:
      - PROCESS_TYPE=admin-server
      - PORT=7003
      - MONGODB_URI=mongodb://mongodb:27017/model-hub
      - REDIS_HOST=redis
    depends_on:
      - mongodb
      - redis
    env_file:
      - .env

volumes:
  mongodb_data:
  redis_data:
```

---

### 11.9 AGI-Content 迁移指南

本节描述如何将 AGI-Content 从直接对接三方厂商迁移到通过 Model-Hub 统一接入。

#### 11.9.1 迁移概述

**当前架构**：
```
AGI-Content → AGI-Content-Job → 各厂商 API (WaveSpeed/Cloudwise/MiniMax/Seedance/Wan)
```

**目标架构**：
```
AGI-Content → Model-Hub → 各厂商 Adapter → 厂商 API
```

**核心变更**：
- AGI-Content 只需调用 Model-Hub 统一 API
- 厂商对接逻辑全部在 Model-Hub 的 Adapter 中实现
- 模型配置统一在 Model-Hub 管理

#### 11.9.2 模型数据迁移

Model-Hub 的 `model_configs` 集合与 AGI-Content 的 `aimodelconfigs` 完全对齐：

**数据同步流程**：

```bash
# 1. 从 AGI-Content 收集模型配置
cd model-hub
node scripts/collect-model-configs.cjs

# 2. 检查生成的配置
cat seed/model-configs.json

# 3. 导入到 Model-Hub 数据库
npm run seed:model-configs
```

**模型配置 Schema**：

```typescript
{
  model_name: string;              // 唯一标识
  model_type: number;              // 模型子类型
  provider: string;                // 厂商标识
  service: string;                 // 服务方标识
  group: string;                   // 模型分组
  label: string;                   // 展示标签
  description: string;             // 描述
  tags: Array<{text, color}>;      // 标签
  sort: number;                    // 排序权重
  disabled: boolean;               // 是否禁用
  unit_price_map: object;          // 分档定价（含 unit_credit / cost_unit_price / sale_unit_price 等）
  params: object;                  // 参数定义
  // ... 其他字段
}
```

#### 11.9.3 AGI-Content 接入改造

**最小改造路径**：

1. **新增 Model-Hub API 工具类**：

```javascript
// AGI-Content/utils/modelHubApi.js
const axios = require('axios');

class ModelHubApi {
  constructor(baseURL, apiKey) {
    this.client = axios.create({
      baseURL,
      headers: { 'X-API-Key': apiKey },
    });
  }

  async submitTask(model, input, callbackUrl, options = {}) {
    const response = await this.client.post('/v1/tasks', {
      model,
      input,
      callbackUrl,
      priority: options.priority || 50,
      bizId: options.bizId,
      metadata: options.metadata,
    });
    return response.data;
  }

  async getTask(taskId) {
    const response = await this.client.get(`/v1/tasks/${taskId}`);
    return response.data;
  }
}

module.exports = ModelHubApi;
```

2. **替换任务提交逻辑**：

```javascript
// 替换前（AGI-Content-Job）
const waveSpeedAiAPI = new WaveSpeedAiAPI(api_key, api_url);
const result = await waveSpeedAiAPI.textToImage(provider, model_name, {
  prompt, aspect_ratio, image, ...
});

// 替换后（调用 Model-Hub）
const modelHubApi = new ModelHubApi(
  process.env.MODEL_HUB_URL,
  process.env.MODEL_HUB_API_KEY
);
const result = await modelHubApi.submitTask(
  'wavespeed-ai/flux-2-pro/text-to-image',
  { prompt, aspect_ratio, image },
  'http://agi-content:3004/webhooks/model-hub',
  { bizId: imageContent._id }
);
```

3. **新增 Webhook 路由**：

```javascript
// AGI-Content/routes/webhooks.js
router.post('/webhooks/model-hub', async (req, res) => {
  const { taskId, status, result, error } = req.body;
  
  // 验证签名
  const signature = req.headers['x-modelhub-signature'];
  // ... HMAC 验证 ...
  
  // 根据 taskId 找到对应的业务记录
  const task = await TaskMapping.findOne({ modelHubTaskId: taskId });
  if (!task) return res.status(404).end();
  
  if (status === 'SUCCESS') {
    // result 为 URL 字符串数组（媒体类）；取首个输出
    const outputUrl = Array.isArray(result) ? result[0] : result?.output?.[0];
    const akoolUrl = await fileLinkConversionAkoolLink(outputUrl);
    await ImageContent.updateOne(
      { _id: task.bizId },
      { image_status: 3, url: akoolUrl }
    );
  } else if (status === 'FAILED') {
    await ImageContent.updateOne(
      { _id: task.bizId },
      { image_status: 4, error_reason: error.message }
    );
  }
  
  res.status(200).json({ received: true });
});
```

4. **模型列表接口改造**：

```javascript
// 替换前：从本地 DB 查询
router.get('/api/aiModelConfig', async (req, res) => {
  const configs = await AiModelConfig.find({ disabled: false });
  res.json(configs);
});

// 替换后：代理 Model-Hub
router.get('/api/aiModelConfig', async (req, res) => {
  const response = await axios.get(`${MODEL_HUB_URL}/v1/models`, {
    params: req.query,
    headers: { 'X-API-Key': MODEL_HUB_API_KEY },
  });
  res.json(response.data);
});
```

#### 11.9.4 迁移实施步骤

**Phase 1: Model-Hub 准备**（已完成）
- [x] 完善 WaveSpeed/Cloudwise/MiniMax/Seedance/Wan Adapter
- [x] 实现 `model_configs` 管理 API
- [x] 部署 Model-Hub 服务

**Phase 2: AGI-Content 接入**
- [ ] 新增 `modelHubApi.js` 工具类
- [ ] 新增 webhook 路由
- [ ] 图片生成改调 Model-Hub
- [ ] 视频生成改调 Model-Hub

**Phase 3: 清理**
- [ ] 下线 AGI-Content-Job 中三方厂商代码
- [ ] 迁移 `aimodelconfigs` 数据到 Model-Hub

#### 11.9.5 统一参数映射

AGI-Content 传给 Model-Hub 的统一参数：

```typescript
interface UnifiedTaskInput {
  // 通用
  prompt?: string;                    // 文本提示词
  negative_prompt?: string;           // 反向提示词
  
  // 图片相关
  image?: string;                     // 输入图片 URL
  images?: string[];                  // 多张输入图片
  aspect_ratio?: string;              // 宽高比 "16:9" / "1:1" / "9:16"
  resolution?: string;                // 分辨率 "1024x1024" / "720p" / "1080p"
  image_quantity?: number;            // 生成图片数量
  
  // 视频相关
  duration?: number;                  // 视频时长（秒）
  generate_audio?: boolean;           // 是否生成音频
  
  // 高级参数
  seed?: number;                      // 随机种子
  guidance_scale?: number;            // 引导系数
  cfg_scale?: number;                 // CFG 系数
  
  // 角色换装
  face_image?: string;                // 人脸图片
  pose_image?: string;                // 姿势图片
  
  // 视频编辑
  video?: string;                     // 输入视频 URL
  last_image?: string;                // 尾帧图片
  
  // 扩展
  [key: string]: any;                 // 厂商特有参数透传
}
```

Model-Hub 的各 Adapter 负责将统一参数转换为厂商特定格式。

---

## 12. 依赖清单

### 12.1 核心依赖（dependencies）

```json
{
  "@nestjs/common": "^10.x",
  "@nestjs/core": "^10.x",
  "@nestjs/platform-express": "^10.x",
  "@nestjs/config": "^3.x",
  "@nestjs/mongoose": "^10.x",
  "@nestjs/bull": "^10.x",
  "@nestjs/schedule": "^4.x",
  "@nestjs/terminus": "^10.x",
  "mongoose": "^8.x",
  "bull": "^4.x",
  "ioredis": "^5.x",
  "axios": "^1.x",
  "class-validator": "^0.14.x",
  "class-transformer": "^0.5.x",
  "joi": "^17.x",
  "ulid": "^2.x",
  "prom-client": "^15.x",
  "helmet": "^7.x",
  "express-rate-limit": "^7.x",
  "rxjs": "^7.x",
  "reflect-metadata": "^0.2.x",
  "@nestjs/serve-static": "^4.x",
  "@nestjs/passport": "^10.x",
  "@nestjs/jwt": "^10.x",
  "passport": "^0.7.x",
  "passport-jwt": "^4.x",
  "bcrypt": "^5.x",
  "nacos": "^2.6.0"
}
```

### 12.2 开发依赖（devDependencies）

```json
{
  "@nestjs/cli": "^10.x",
  "@nestjs/schematics": "^10.x",
  "@nestjs/testing": "^10.x",
  "@types/express": "^5.x",
  "@types/jest": "^29.x",
  "@types/node": "^20.x",
  "@types/bull": "^4.x",
  "typescript": "^5.x",
  "ts-jest": "^29.x",
  "jest": "^29.x",
  "supertest": "^6.x",
  "@types/supertest": "^6.x",
  "eslint": "^8.x",
  "@typescript-eslint/parser": "^7.x",
  "@typescript-eslint/eslint-plugin": "^7.x",
  "prettier": "^3.x",
  "mongodb-memory-server": "^9.x",
  "@types/passport-jwt": "^4.x",
  "@types/bcrypt": "^5.x"
}
```

---

## 13. 初始化命令清单

```bash
# 1. 创建 NestJS 项目
nest new model-hub --strict --skip-git

# 2. 安装核心依赖
npm install @nestjs/config @nestjs/mongoose mongoose
npm install @nestjs/bull bull ioredis
npm install @nestjs/schedule
npm install @nestjs/terminus
npm install class-validator class-transformer
npm install joi
npm install axios
npm install ulid
npm install prom-client
npm install helmet express-rate-limit
# ☆ v2.1 管理后台相关
npm install @nestjs/serve-static
npm install @nestjs/passport @nestjs/jwt passport passport-jwt bcrypt

# 3. 安装开发依赖
npm install -D mongodb-memory-server
npm install -D @types/bull

# 4. 生成模块脚手架
nest g module config
nest g module database
nest g module redis
nest g module auth
nest g module task
nest g module queue
nest g module provider
nest g module polling
nest g module callback
nest g module stats              # ★ v2.0
nest g module health
nest g module observability
nest g module admin
nest g module dashboard           # ☆ v2.1

# 5. 生成 Controller
nest g controller task --no-spec
nest g controller health --no-spec
nest g controller admin --no-spec
nest g controller admin/route-admin --flat --no-spec   # ★ v2.0
nest g controller admin/queue-admin --flat --no-spec   # ★ v2.0
nest g controller stats --no-spec                      # ★ v2.0
nest g controller admin/auth-admin --flat --no-spec    # ☆ v2.1
nest g controller admin/dashboard-overview --flat --no-spec  # ☆ v2.1
nest g controller admin/task-admin --flat --no-spec    # ☆ v2.1
nest g controller admin/user-admin --flat --no-spec    # ☆ v2.1
nest g controller admin/audit-log --flat --no-spec     # ☆ v2.1

# 6. 生成 Service
nest g service task/task --flat --no-spec
nest g service task/idempotency --flat --no-spec
nest g service task/task-timeline --flat --no-spec      # ★ v2.0
nest g service task/task-timing --flat --no-spec        # ★ v2.0
nest g service provider/provider-config --flat --no-spec
nest g service provider/model-router --flat --no-spec
nest g service queue/queue-registry --flat --no-spec    # ★ v2.0
nest g service queue/queue-router --flat --no-spec      # ★ v2.0
nest g service queue/queue-stats-collector --flat --no-spec  # ★ v2.0
nest g service polling/polling --flat --no-spec
nest g service callback/callback --flat --no-spec
nest g service callback/callback-signature --flat --no-spec
nest g service stats/stats --flat --no-spec             # ★ v2.0
nest g service stats/stats-aggregation-scheduler --flat --no-spec  # ★ v2.0
nest g service stats/stats-compare --flat --no-spec     # ★ v2.0
nest g service admin/route-admin --flat --no-spec       # ★ v2.0
nest g service admin/queue-admin --flat --no-spec       # ★ v2.0
nest g service admin/auth-admin --flat --no-spec        # ☆ v2.1
nest g service admin/dashboard-overview --flat --no-spec # ☆ v2.1
nest g service admin/task-admin --flat --no-spec         # ☆ v2.1
nest g service admin/user-admin --flat --no-spec         # ☆ v2.1
nest g service admin/audit-log --flat --no-spec          # ☆ v2.1
nest g service redis/redis-lock --flat --no-spec
nest g service redis/redis-pubsub --flat --no-spec      # ★ v2.0
nest g service redis/rate-limiter --flat --no-spec
nest g service observability/logger/logger --flat --no-spec
nest g service observability/metrics/metrics --flat --no-spec

# 7. 创建补充目录结构
mkdir -p src/task/dto src/task/schemas src/task/enums src/task/constants src/task/interfaces
mkdir -p src/queue/processors src/queue/constants src/queue/interfaces src/queue/schemas
mkdir -p src/provider/adapters src/provider/interfaces src/provider/schemas
mkdir -p src/callback/schemas src/callback/interfaces
mkdir -p src/stats/dto src/stats/schemas src/stats/interfaces
mkdir -p src/auth/guards src/auth/decorators src/auth/strategies src/auth/interfaces
mkdir -p src/admin/guards src/admin/decorators src/admin/strategies src/admin/dto src/admin/schemas src/admin/enums src/admin/interfaces
mkdir -p src/dashboard
mkdir -p src/common/filters src/common/interceptors src/common/pipes src/common/decorators src/common/utils src/common/interfaces
mkdir -p src/observability/logger src/observability/metrics src/observability/interceptors
mkdir -p test/unit/task test/unit/provider test/unit/queue test/unit/stats test/unit/admin test/unit/callback test/unit/polling
mkdir -p test/integration test/e2e

# 8. ☆ 初始化管理后台前端
cd dashboard
npm create vite@latest . -- --template react-ts
npm install antd @ant-design/icons @ant-design/charts
npm install react-router-dom zustand swr axios
npm install xlsx                    # CSV/Excel 导出
npm install -D @types/react @types/react-dom
# 创建前端目录结构
mkdir -p src/pages src/components src/services src/stores src/hooks src/types src/utils src/layouts src/router
cd ..
```

---

## 14. 开发规范

### 14.1 代码风格

- 严格使用 TypeScript strict 模式
- ESLint + Prettier 强制格式化
- 命名规范：
  - 文件：`kebab-case`（如 `task-submit.processor.ts`）
  - 类：`PascalCase`（如 `TaskSubmitProcessor`）
  - 方法/变量：`camelCase`（如 `submitTask`）
  - 常量：`UPPER_SNAKE_CASE`（如 `QUEUE_NAMES`）
  - 接口前缀 `I`（如 `IProviderAdapter`）
  - 枚举值：`UPPER_SNAKE_CASE`（如 `TaskStatus.PENDING`）

### 14.2 Git 分支规范

```
main              # 生产分支
├── develop       # 开发分支
├── feature/xxx   # 功能分支
├── fix/xxx       # 修复分支
└── release/x.x   # 发布分支
```

### 14.3 提交信息规范

```
feat: 新功能
fix: 修复
docs: 文档
style: 格式
refactor: 重构
test: 测试
chore: 构建/辅助工具
```

### 14.4 环境变量规范

- 所有密钥必须通过 `.env` 注入
- `.env` 必须在 `.gitignore` 中
- 所有环境变量必须在 `config.schema.ts` 中校验
- 日志中禁止打印环境变量原始值

### 14.5 安全规范

- 输入校验：所有 DTO 使用 `class-validator`
- 数据库查询：所有条件必须类型化
- 日志脱敏：token/secret/password 字段自动替换
- 回调 URL：禁止内网地址（SSRF 防护）
- 错误响应：禁止暴露 stack trace

### 14.6 测试规范

- 新增 Service / Adapter 必须编写单元测试
- 核心流程（提交/轮询/回调）必须集成测试覆盖
- PR 合并前 CI 必须通过所有测试
- 核心模块代码覆盖率 > 80%

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
| /api-keys | API 密钥管理 | system | 10 |
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