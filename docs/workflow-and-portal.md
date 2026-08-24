# 工作流引擎与开发者门户

> 版本：v1.1
> 最后更新：2026-08-24
> 状态：已实现并验证

---

## 目录

1. [概述](#1-概述)
2. [工作流引擎](#2-工作流引擎)
3. [开发者门户（Portal）](#3-开发者门户portal)
4. [Portal 鉴权系统](#4-portal-鉴权系统)
5. [API 参考](#5-api-参考)
6. [前端架构](#6-前端架构)
7. [安全与完整性修复设计](#7-安全与完整性修复设计)

---

## 1. 概述

Model-Hub 提供了两个面向外部开发者的核心能力：

| 能力 | 说明 | 前端 |
|------|------|------|
| **工作流引擎** | 可视化 DAG 编排，串联多个 AI 模型调用 | `portal/` (React Flow) |
| **开发者门户** | 自助注册、API Key 管理、工作流管理 | `portal/` (React + Ant Design) |

这两个能力通过独立的后端模块（`WorkflowModule`、`PortalAuthModule`）和独立的前端应用（`portal/`）实现，与管理后台（`dashboard/`）完全分离。

---

## 2. 工作流引擎

### 2.1 设计目标

| 目标 | 说明 |
|------|------|
| **可视化编排** | 通过拖拽式 DAG 编辑器组合多个 AI 模型调用 |
| **多节点类型** | 支持模型调用、条件分支、循环、数据转换等 6 种节点 |
| **实时执行监控** | 通过 SSE (Server-Sent Events) 实时推送节点执行状态 |
| **模板系统** | 预置工作流模板，支持一键复用 |
| **选择性重试** | 支持对失败节点单独重试，无需重跑整个工作流 |

### 2.2 架构总览

```
Portal 前端 (React Flow)
    │
    ▼
WorkflowController (v1/workflows)
    │
    ├── WorkflowService          # 工作流 CRUD
    ├── ExecutionGraphResolver   # DAG 解析 + 拓扑排序 + 环检测
    ├── PortSchemaService        # 节点端口定义
    └── WorkflowTemplateService  # 模板管理

WorkflowRunController (v1/workflows)
    │
    └── WorkflowExecutionService # 执行生命周期
            │
            ▼
        NodeExecutor (Bull: workflow-node)
            │
            ├── model      → TaskService.submitTask()
            ├── condition  → 表达式求值 → 分支
            ├── loop       → 数组迭代（上限 1000）
            ├── transform  → 表达式求值 → 数据转换
            ├── input      → 工作流入参
            └── output     → 工作流出参
```

### 2.3 节点类型

| 节点类型 | 说明 | 输入端口 | 输出端口 |
|---------|------|---------|---------|
| **model** | 调用 AI 模型（通过 TaskService） | 模型参数 | 任务结果 |
| **condition** | 条件分支（表达式求值） | 条件表达式 + 分支数据 | true/false 分支 |
| **loop** | 循环迭代（最大 1000 次） | 数组 + 循环体 | 迭代结果数组 |
| **transform** | 数据转换（表达式求值） | 输入数据 + 表达式 | 转换后数据 |
| **input** | 工作流入参定义 | 外部输入 | 传递数据 |
| **output** | 工作流出参定义 | 上游数据 | 最终输出 |

### 2.4 执行流程

```
用户触发 POST /v1/workflows/:id/run
    │
    ▼
WorkflowExecutionService.run()
    │
    ├── 1. 校验 DAG 合法性（ExecutionGraphResolver.validate()）
    │     - 环检测（DFS）
    │     - 必需端口连接检查
    │     - 端口类型兼容性检查
    │
    ├── 2. 创建 WorkflowRun 文档（per-node 状态跟踪）
    │
    ├── 3. 拓扑排序确定执行层级（Kahn 算法）
    │
    ├── 4. 按层级调度节点执行
    │     - 同层节点并行执行
    │     - 上游节点完成后自动触发下游
    │
    ├── 5. NodeExecutor 消费 workflow-node 队列
    │     - model 节点 → 调用 TaskService 创建任务
    │     - 其他节点 → 本地表达式求值
    │
    └── 6. 全部节点成功 → 标记 run 为 succeeded
            任一节点失败 → 标记 run 为 failed
```

### 2.5 表达式系统

条件和转换节点使用简单的表达式求值器：

| 变量 | 说明 | 示例 |
|------|------|------|
| `$input.*` | 工作流入参 | `$input.prompt` |
| `$nodes[nodeId].*` | 上游节点输出 | `$nodes.abc123.output` |

### 2.6 MongoDB Schema

#### workflows 集合

```typescript
{
  name: string;                // 工作流名称
  description?: string;
  creatorId: string;           // 创建者 ID（Portal 用户）
  nodes: Array<{               // 节点定义
    id: string;
    type: 'model' | 'condition' | 'loop' | 'transform' | 'input' | 'output';
    position: { x: number; y: number };
    data: Record<string, any>;
  }>;
  edges: Array<{               // 连接定义
    id: string;
    source: string;            // 源节点 ID
    target: string;            // 目标节点 ID
    sourceHandle?: string;
    targetHandle?: string;
  }>;
  viewport?: { x: number; y: number; zoom: number };
  inputSchema?: object;        // 入参 JSON Schema
  outputMapping?: object;      // 出参映射
  executionConfig?: object;    // 执行配置
  tags?: string[];
  status: 'draft' | 'published' | 'archived';
  createdAt: Date;
  updatedAt: Date;
}
```

#### workflow_runs 集合

```typescript
{
  workflowId: string;          // 关联工作流
  creatorId: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  nodeStates: Map<string, {    // 每个节点的执行状态
    status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
    result?: any;
    error?: string;
    startedAt?: Date;
    completedAt?: Date;
  }>;
  input?: Record<string, any>;
  output?: Record<string, any>;
  startedAt: Date;
  completedAt?: Date;
}
```

#### workflow_templates 集合

```typescript
{
  name: string;
  description?: string;
  workflowDefinition: object;  // 完整的工作流定义
  tags?: string[];
  status: 'draft' | 'published';
  createdAt: Date;
}
```

---

## 3. 开发者门户（Portal）

### 3.1 概述

Portal 是面向外部开发者的独立前端应用，提供：

- 自助注册与登录
- API Key 管理
- 工作流可视化编辑器
- 工作流模板市场
- 执行监控

### 3.2 技术栈

| 技术 | 用途 |
|------|------|
| React 18 | UI 框架 |
| React Router v6 | 路由 |
| Zustand | 状态管理 |
| Ant Design 5 | UI 组件库 |
| React Flow | 可视化 DAG 编辑器 |
| Axios | HTTP 客户端 |

### 3.3 页面结构

| 页面 | 路由 | 说明 |
|------|------|------|
| 登录 | `/login` | 开发者登录 |
| 注册 | `/register` | 开发者注册 |
| 首页 | `/` | Landing Page |
| 工作流列表 | `/workflows` | 用户的工作流列表 |
| 工作流编辑器 | `/workflows/:id/edit` | React Flow 可视化编辑器 |
| 模板市场 | `/templates` | 浏览和使用工作流模板 |
| API Key 管理 | `/api-keys` | 创建/管理 API Key |
| 个人中心 | `/profile` | 用户信息管理 |

### 3.4 PM2 配置

Portal 先执行 `npm run build`，PM2 仅托管生成的 `dist/` 静态文件，不运行 Vite 开发服务器：

```javascript
// ecosystem.config.js
{
  name: 'model-hub-portal',
  script: 'node_modules/serve/build/main.js',
  args: ['-s', 'dist', '-l', '7004'],
  cwd: './portal',
  instances: 1,
  exec_mode: 'fork',
}
```

---

## 4. Portal 鉴权系统

### 4.1 概述

Portal 使用独立的鉴权体系，与管理后台（Admin JWT）和业务 API（API Key）完全分离。

### 4.2 认证流程

```
注册/登录 → 签发 JWT（HMAC-SHA256）
    │
    ├── Access Token（15 分钟）
    └── Refresh Token（7 天）
```

### 4.3 角色与配额

| 角色 | API Key 数量 | QPS | 每日请求数 | 工作流数 | 节点/工作流 | 并发运行 | 模板 | 循环 |
|------|-------------|-----|-----------|---------|-----------|---------|------|------|
| user | 3 | 10 | 5,000 | 10 | 10 | 2 | ✗ | ✗ |
| vip | 10 | 50 | 50,000 | 50 | 30 | 5 | ✓ | ✓ |
| admin | 无限 | 200 | 无限 | 无限 | 无限 | 无限 | ✓ | ✓ |

### 4.4 API Key 格式

```
mh_<29字符 ULID>
示例：mh_01HXYZ1234567890ABCDEFGHIJK
```

- 列表接口返回脱敏格式：`mh_01H...IJK`
- 创建时返回完整密钥（仅一次）

### 4.5 MongoDB Schema

#### portal_users 集合

```typescript
{
  email: string;               // 唯一、规范化为小写
  username: string;
  passwordHash: string;        // bcrypt
  avatar?: string;
  role: 'user' | 'vip' | 'admin';
  status: 'active' | 'suspended' | 'pending';
  workflowCount: number;       // 原子工作流配额计数
  usage: {
    totalWorkflows: number;
    totalRuns: number;
    totalTokens: number;
  };
  deletedAt?: Date;
  lastLoginAt?: Date;
  lastLoginIp?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

#### portal_api_keys 集合

```typescript
{
  userId: string;              // 关联 portal_users
  slot: number;                // `(userId, slot)` 唯一，原子保证数量配额
  keyId: string;               // 完整 Key 中的公开定位段
  secretHash: string;          // SHA-256，仅服务端校验时读取
  maskedKey: string;           // 列表和管理后台展示
  billingKey: string;          // 非敏感计费/钱包归属标识
  name: string;
  permissions: string[];
  modelAllowlist: string[];
  billingPolicy: 'internal' | 'external' | 'exempt';
  rateLimit: { maxQps?: number; maxDailyRequests?: number };
  enabled: boolean;
  lastUsedAt?: Date;
  expiresAt?: Date;            // TTL 索引
  createdAt: Date;
}
```

---

## 5. API 参考

### 5.1 工作流 API

> 支持 Portal JWT `Authorization: Bearer ...` 或 Portal API Key `X-API-Key`。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/v1/workflows` | 创建工作流 |
| GET | `/v1/workflows` | 工作流列表（分页） |
| GET | `/v1/workflows/:id` | 获取工作流定义 |
| PUT | `/v1/workflows/:id` | 更新工作流 |
| DELETE | `/v1/workflows/:id` | 删除工作流 |
| POST | `/v1/workflows/validate` | 校验工作流（不保存） |
| GET | `/v1/workflows/models/:modelId/port-schema` | 获取模型端口定义 |
| POST | `/v1/workflows/from-template/:templateId` | 从模板创建工作流 |
| POST | `/v1/workflows/:id/run` | 触发执行 |
| GET | `/v1/workflows/runs/:runId` | 查询执行状态 |
| GET | `/v1/workflows/runs/:runId/stream` | SSE 实时状态推送 |
| POST | `/v1/workflows/runs/:runId/cancel` | 取消执行 |
| POST | `/v1/workflows/runs/:runId/retry` | 重试失败节点 |
| GET | `/v1/workflows/runs/:runId/nodes/:nodeId` | 查询节点详情 |

### 5.2 模板 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/v1/workflow-templates` | 模板列表 |
| GET | `/v1/workflow-templates/:id` | 模板详情 |

### 5.3 Portal 鉴权 API

> 以下接口无需认证（除标注外）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/v1/auth/register` | 注册 |
| POST | `/v1/auth/login` | 登录 |
| POST | `/v1/auth/logout` | 登出（需认证） |
| POST | `/v1/auth/refresh` | 刷新 Token |
| GET | `/v1/auth/me` | 获取当前用户（需认证） |
| PUT | `/v1/auth/me` | 更新个人信息（需认证） |
| POST | `/v1/auth/change-password` | 修改密码（需认证） |

### 5.4 Portal API Key API

> 需携带 `Authorization: Bearer <access_token>`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/v1/api-keys/limits` | 查看当前角色配额 |
| GET | `/v1/api-keys` | API Key 列表 |
| POST | `/v1/api-keys` | 创建 API Key |
| PUT | `/v1/api-keys/:id` | 更新 API Key |
| DELETE | `/v1/api-keys/:id` | 删除 API Key |

---

## 6. 前端架构

### 6.1 目录结构

```
portal/
├── src/
│   ├── main.tsx                    # 入口
│   ├── App.tsx                     # 路由 + 布局
│   ├── pages/
│   │   ├── Login.tsx               # 登录
│   │   ├── Register.tsx            # 注册
│   │   ├── Home.tsx                # 首页
│   │   ├── WorkflowList.tsx        # 工作流列表
│   │   ├── WorkflowEditor.tsx      # 可视化编辑器（React Flow）
│   │   ├── TemplateGallery.tsx     # 模板市场
│   │   ├── ApiKeys.tsx             # API Key 管理
│   │   └── Profile.tsx             # 个人中心
│   ├── components/
│   │   ├── Node/                   # 自定义 React Flow 节点
│   │   │   ├── ModelNode.tsx       # 模型调用节点
│   │   │   ├── ConditionNode.tsx   # 条件分支节点
│   │   │   ├── LoopNode.tsx        # 循环节点
│   │   │   ├── InputNode.tsx       # 输入节点
│   │   │   ├── OutputNode.tsx      # 输出节点
│   │   │   ├── TransformNode.tsx   # 转换节点
│   │   │   └── NodePalette.tsx     # 节点拖拽面板
│   │   ├── Panel/
│   │   │   └── NodeDetailPanel.tsx # 节点属性编辑面板
│   │   ├── Layout/
│   │   │   └── AppLayout.tsx       # 应用布局
│   │   └── Auth/
│   │       └── ProtectedRoute.tsx  # 路由守卫
│   ├── services/
│   │   ├── workflow-api.ts         # 工作流 API
│   │   └── auth-api.ts            # 鉴权 API
│   └── store/
│       ├── workflow-store.ts       # 工作流状态
│       └── auth-store.ts           # 鉴权状态
├── package.json
├── vite.config.ts
└── tsconfig.json
```

### 6.2 自定义节点

每个节点类型都有独立的 React 组件，通过 React Flow 的 `nodeTypes` 注册：

```tsx
const nodeTypes = {
  model: ModelNode,
  condition: ConditionNode,
  loop: LoopNode,
  input: InputNode,
  output: OutputNode,
  transform: TransformNode,
};
```

### 6.3 状态管理

使用 Zustand 管理全局状态：

- **workflow-store**: 当前编辑的工作流、节点列表、边列表、选中节点
- **auth-store**: 用户信息、Token、登录状态

---

## 7. 安全与完整性修复设计

> 本章记录 2026-08-24 代码审查后的修复设计。第 2～6 章描述目标能力；在本章验收标准全部满足前，不得将工作流执行、Portal API Key 或 Portal 生产部署标记为可上线。

### 7.1 背景

当前工作区同时引入工作流引擎、Portal 鉴权、Portal API Key、Developer Portal、管理后台入口和部署配置。审查发现以下阻断问题：

- 工作流表达式通过 `new Function` 执行，存在服务端任意代码执行风险。
- 工作流和运行实例缺少租户所有权过滤，存在跨用户读写、执行和事件泄露。
- 公共执行接口返回模拟结果，未接入 DAG、Bull `workflow-node` 队列和 `TaskService`。
- Portal API Key 未完整接入已有的限流、模型权限、计费和 Wallet 链路。
- Admin 权限守卫、路由顺序、分页和密钥脱敏不符合现有项目约定。
- Portal 不能通过 TypeScript 构建，根构建脚本和 PM2 也未形成生产部署闭环。

### 7.2 目标

1. 消除表达式执行、JWT 默认密钥、跨租户访问和完整密钥泄露风险。
2. 让工作流严格按已校验 DAG 调度，并通过现有 `TaskService` 执行模型节点。
3. 让取消、失败、重试、SSE、统计和最终状态具有一致、可恢复的状态机语义。
4. 将 Portal 身份和 Portal API Key 接入已有 ApiClient 能力，而不是建立第二套限流、allowlist 和计费约定。
5. 让 Dashboard、Portal、后端、测试和生产构建形成可验证的端到端链路。
6. 保持现有管理端 API Key 和任务 API 兼容，不引入兼容别名或长期双轨实现。

### 7.3 非目标

- 不修改 Provider Adapter 的供应商协议和模型参数映射。
- 不重构现有任务队列的 Provider 两级路由。
- 不新增任意代码节点；表达式只支持声明式、无副作用计算。
- 不在本次修复中引入微服务拆分或新的外部基础设施。
- 不手工修改 `dist/`，不将本地 IDE/Agent 配置纳入业务提交。
- 不以隐藏入口、返回假成功或降低测试范围代替真实修复。

### 7.4 当前实现与问题边界

```text
Portal JWT / Portal API Key
        │
        ├── WorkflowController ──> WorkflowService
        │                              │
        │                              └── 当前未按 owner 过滤
        │
        ├── WorkflowExecutionService
        │      └── 当前 sleep + mock output，未投递 Bull
        │
        └── TaskController
               ├── ClientRateLimitGuard 仅查询 api_clients
               ├── ModelAllowlistGuard 仅查询 api_clients
               └── BillingAdapter 未识别 portal_api_keys
```

修复必须从统一身份解析、资源所有权和客户端策略解析三个源头完成，不在各 Controller 中增加互不一致的例外分支。

### 7.5 总体方案

#### 7.5.1 统一请求主体

定义统一的 `RequestPrincipal`：

```typescript
interface RequestPrincipal {
  subjectType: 'admin-client' | 'portal-user' | 'portal-api-key';
  subjectId: string;
  ownerId?: string;
  apiKey?: string;
  roles: string[];
}
```

- Admin API Client：`subjectId` 为 API Key。
- Portal JWT：`subjectId` 和 `ownerId` 均为 Portal User ID。
- Portal API Key：`subjectId` 为 Key ID，`ownerId` 为 Portal User ID，`apiKey` 为所提交密钥。
- Guard 只负责认证和生成主体；Service 负责资源授权和策略执行。
- 非严格 API Key 模式仅保留给既有任务 API 的开发兼容行为；工作流资源接口必须取得非空、已注册主体。

#### 7.5.2 工作流所有权

所有用户侧 Workflow 和 WorkflowRun 查询必须把资源 ID 与 `ownerId` 放在同一个数据库条件中：

```typescript
{ _id: workflowId, creatorId: principal.ownerId }
{ runId, triggerId: principal.ownerId }
```

- 详情、更新、删除、执行、取消、重试和节点详情均执行同样的所有权约束。
- 用户列表忽略调用者传入的 `creatorId`，强制使用当前 `ownerId`。
- Admin Service 使用显式 `adminScope` 查询全部资源，不能复用用户侧无 owner 查询。
- 未找到或不属于当前用户统一返回 HTTP 404，避免资源枚举。

#### 7.5.3 安全表达式

删除 `new Function`。表达式实现采用无副作用 AST 解释器，白名单如下：

- 字面量：string、number、boolean、null、array、plain object。
- 引用：`$input`、`$workflow`、`$nodes` 下的自有属性。
- 运算：`==`、`!=`、`===`、`!==`、`>`、`>=`、`<`、`<=`、`&&`、`||`、`!`、基础算术。
- 禁止函数调用、赋值、构造器、原型访问、动态 import 和全局对象。
- 限制表达式长度、AST 深度和执行步数。
- 属性解析只允许 `Object.prototype.hasOwnProperty`，拒绝 `__proto__`、`prototype`、`constructor`。

若仓库现有依赖无法提供满足约束的解释器，优先实现小型递归下降解析器；不得继续使用 `eval`、`vm` 或 `Function` 作为过渡。

#### 7.5.4 工作流执行状态机

```text
pending -> running -> succeeded
                   ├-> failed -> running (retry)
                   └-> cancelling -> cancelled
```

执行步骤：

1. 读取并校验 owner、workflow 状态、角色配额和输入。
2. `ExecutionGraphResolver.validate()` 校验节点、边、端口和纯环。
3. 创建 `WorkflowRun(status=running)`，保存目标节点快照、工作流版本和非敏感计费 Key。
4. 根据 DAG 和 `maxParallelism` 投递首批 `workflow-node` Job。
5. `NodeExecutor`：
   - model/创作节点：调用 `TaskService.createTask()`，记录子任务 ID，并轮询现有任务状态直到终态；
   - condition：使用安全表达式解释器选择唯一分支；
   - transform：使用相同解释器计算输出；
   - loop：对数组执行受限安全表达式，默认执行恒等映射；
   - input/output：只做数据映射。
6. 节点完成后，以条件更新声明节点执行权，再根据依赖计算下一批可执行节点。
7. 全部目标节点进入终态后计算 Run 最终状态并发出事件。

调度幂等键由 `runId + nodeId(base64url) + attempt` 构成；重复调度无法再次声明非 `pending` 节点。

#### 7.5.5 取消与重试

- 取消以条件更新将 Run 从 `running` 改为 `cancelled`。
- 删除尚未开始的 Bull Job；已创建的模型子任务调用现有取消能力。
- 节点回调写入前检查 Run 是否仍为 `running`，禁止把已取消 Run 改回成功。
- 模型子任务与取消并发时，任务创建回调会补偿取消新建任务。
- 重试仅允许失败节点；递增 attempt，清理该 attempt 的错误和输出，并重置其下游已跳过节点。
- 重试重新计算依赖并重新获取并发 Run 租约。

#### 7.5.6 SSE 隔离

- 建立精确事件名 `workflow.run.<runId>`，不订阅全局通配符。
- 建立流之前查询 `{ runId, triggerId: ownerId }`。
- 事件 payload 不包含 API Key、JWT、完整上游响应或非当前 Run 数据。
- 连接关闭时移除 listener，避免内存泄漏。
- 多进程部署下，事件最终应通过 Redis Pub/Sub 或现有 Event Bus 广播；单进程 EventEmitter 只作为本地实现。

#### 7.5.7 Portal JWT 与 Refresh Token

- `PORTAL_JWT_SECRET` 为必需生产配置，至少 32 字节；生产缺失或命中已知默认值时启动失败。
- JWT 验证使用恒定时间签名比较，并校验 `alg`、`typ`、`sub`、`iat`、`exp`。
- Refresh Token 采用 `tokenId.secret` 格式；数据库只保存 secret 哈希和 tokenId。
- Refresh Token 每次刷新执行原子旋转；检测到已失效 Token 重用时撤销同一 token family。
- 密码修改、用户冻结和软删除撤销全部 Refresh Token。
- Portal 前端不再把 Refresh Token 放入 `localStorage`；使用 `HttpOnly + Secure + SameSite=Strict` Cookie。
- Access Token 仅保存在内存；页面刷新通过 Refresh Cookie 恢复会话。
- CSRF 防护覆盖 Refresh、Logout 和其他 Cookie 认证写接口。

#### 7.5.8 Portal API Key 策略接入

- `ApiKeyGuard` 将 Portal 完整凭据校验后转换为非敏感 `billingKey`，后续 Task、Billing 和 Wallet 链路不携带完整密钥。
- `ClientRateLimitGuard` 同时解析 Admin Client 和 Portal API Key 的限流配置。
- `ModelAllowlistGuard` 对 Portal Key 读取当前用户角色的模型权限，角色变更立即生效。
- Workflow 创建和执行入口再次校验当前角色权限，避免内部 `TaskService` 调用绕过 HTTP Guard。
- 创建 Portal API Key 时创建或关联 Wallet，并显式写入计费策略。
- Key 数量限制使用 `(userId, slot)` 唯一索引原子分配；过期或删除后槽位自动复用。
- 完整 Key 仅创建成功响应返回一次；数据库查询默认排除哈希，Admin 页面只显示掩码和管理 ID。

#### 7.5.9 工作流角色配额

在创建和执行入口统一检查：

- 工作流总数。
- 单工作流最大节点数。
- 最大并发 Run。
- 执行超时。
- 模型 allowlist / premium 权限。
- condition、loop、template 权限。

配额检查失败返回 HTTP 403 或 429，并提供稳定业务错误码。并发 Run 数必须使用 Redis semaphore 或数据库原子计数，不能采用“先 count 后 create”。

#### 7.5.10 Admin API

- `AdminWorkflowController` 使用 `AdminJwtGuard + PermissionGuard + RolesGuard`。
- 每个写操作声明明确 `RequirePermissions`。
- 静态路由 `templates`、`runs` 放在动态 `:id` 之前，或拆为独立 Controller。
- 执行历史实现真实分页，不返回固定空数组。
- Admin API Client 列表在数据库层统一排序和分页，`total` 使用两个集合真实总数。
- Portal Key 只返回 masked key；用户详情也不返回完整凭据。

#### 7.5.11 Portal 与 Dashboard

- Portal 的认证、工作流、模型 API 共用一个 Axios 实例和一致响应类型。
- 401 刷新重试必须通过同一实例，避免首次请求与重试返回结构不同。
- 模板接口同时支持 Portal JWT 和已注册 API Key。
- Dashboard 注册 `WorkflowManagementPage` 路由、菜单 descriptor 和权限。
- 修复所有 TypeScript 错误；Portal、Dashboard 均以 production build 作为门禁。
- 大型页面按路由动态 import；保留现有 vendor chunk 约定，优先拆分 Monaco、ECharts、Ant Design。

#### 7.5.12 构建与部署

- 根脚本增加 `install:portal`、`build:portal`，`build:all` 包含后端、Dashboard、Portal。
- PM2 不运行 Vite 开发服务器；Portal 使用构建后的静态文件，由明确的静态服务器或现有反向代理托管。
- 统一 Portal 默认端口和 README 示例。
- `dist/`、`*.tsbuildinfo`、本地 Agent/IDE 配置保持忽略。

### 7.6 架构变化

```text
Guard
  └── RequestPrincipal
          │
          ├── WorkflowAccessService ── owner-scoped CRUD
          ├── ClientPolicyResolver
          │      ├── RateLimit
          │      ├── ModelAllowlist
          │      └── Billing / Wallet
          └── WorkflowExecutionService
                 ├── ExecutionGraphResolver
                 ├── Bull workflow-node
                 ├── SafeExpressionService
                 └── TaskService
```

核心原则：

- 身份只解析一次。
- 授权在数据库查询条件中执行。
- 策略只解析一次并贯穿限流、模型权限和计费。
- Run 状态转换使用条件更新，事件在持久化成功后发出。

### 7.7 文件影响范围

预计修改：

- `src/auth/guards/*`、`src/auth/decorators/*`
- `src/portal-auth/*`
- `src/workflow/*`
- `src/admin/admin-workflow.controller.ts`
- `src/admin/admin-portal-user.controller.ts`
- `src/admin/admin-api-client.controller.ts`
- `src/billing/*`、`src/auth/guards/client-rate-limit.guard.ts`
- `src/auth/guards/model-allowlist.guard.ts`
- `src/database/schemas/portal-*.ts`
- `src/database/schemas/workflow*.ts`
- `portal/src/services/*`、`portal/src/store/auth-store.ts`
- `portal/src/pages/*`、`portal/src/theme/dark.ts`
- `dashboard/src/App.tsx`、`dashboard/src/services/api.ts`
- `package.json`、`ecosystem.config.js`、`.gitignore`、`README.md`
- 本文档及相关架构说明

预计新增：

- 安全表达式解释器及测试。
- 统一 Principal / ClientPolicy 类型与解析服务。
- 工作流访问控制和状态机测试。

预计删除：

- 模拟输出、未使用的模拟执行路径。
- `new Function` 表达式路径。
- Portal Vite PM2 生产进程配置。
- 被跟踪的 `dashboard/tsconfig.tsbuildinfo`。

`dist/` 只允许由构建生成，不作为手工修改目标。

### 7.8 API 与接口变化

- 用户工作流列表不再接受任意 `creatorId`；始终限定当前 owner。
- 资源不属于当前用户时返回 HTTP 404。
- SSE 只推送 URL 中 `runId` 的事件。
- Portal Refresh Token 从 JSON body/localStorage 迁移为 HttpOnly Cookie。
- Portal API Key 列表和 Admin 详情只返回掩码，不返回完整 Key。
- 分页参数统一为正整数并设置最大 `pageSize=100`。
- 新增稳定错误码：
  - `WORKFLOW_NOT_FOUND`
  - `WORKFLOW_LIMIT_EXCEEDED`
  - `WORKFLOW_CONCURRENCY_EXCEEDED`
  - `WORKFLOW_INVALID_GRAPH`
  - `EXPRESSION_NOT_ALLOWED`
  - `PORTAL_KEY_POLICY_INVALID`

### 7.9 数据模型

- `portal_refresh_tokens`：
  - 删除明文 `token`；
  - 新增 `tokenId`、`secretHash`、`familyId`、`revokedAt`、`replacedByTokenId`。
- `portal_api_keys`：
  - 新增不可逆 credential hash 和单独的显示前缀；
  - 完整 Key 不再可从数据库恢复；
  - 明确 `billingPolicy` 和 Wallet 关联。
- `workflow_runs`：
  - 新增 `ownerId`、`attempt`、`activeJobIds`、`cancelRequestedAt`；
  - 节点状态保存 `attempt`、`childTaskId` 和幂等键。
- `portal_users.username` 增加与业务规则一致的唯一索引。

迁移脚本必须先支持旧数据读取、完成回填、验证数量，再切换写入；不能直接删除旧字段。

### 7.10 异常处理

- 认证失败：HTTP 401。
- 已认证但权限/配额不足：HTTP 403。
- 并发或速率限制：HTTP 429。
- 资源不存在或不属于当前 owner：HTTP 404。
- 状态冲突：HTTP 409。
- 图和表达式校验失败：HTTP 400。
- Controller 不再返回 HTTP 200 加业务 `code: 404`。
- 日志不得记录密码、JWT、Refresh Token、完整 API Key 或用户表达式中的敏感输入。

### 7.11 兼容性

- 现有管理端 API Client Key 格式和任务 API 保持不变。
- Portal Key 保持 `mh_` 展示前缀，但验证迁移到哈希查询。
- 已签发 Access Token 最长 15 分钟后自然失效；Refresh Token 迁移时要求重新登录属于可接受的安全切换。
- 工作流尚未上线真实执行，因此直接删除模拟成功行为，不保留兼容开关。
- Admin API 路径一次性修正，前后端同批切换，不保留错误路径别名。

### 7.12 安全

必须覆盖：

- 表达式 RCE 与原型链攻击。
- JWT 弱密钥、算法混淆、签名时序比较。
- Refresh Token 数据库泄露和重放。
- Workflow / Run / SSE 跨租户访问。
- Admin RBAC。
- 完整 API Key 泄露。
- 登录爆破和注册滥用。
- 正则搜索输入转义和分页上限。
- Cookie CSRF、Secure、SameSite 与 CORS 凭据策略。

### 7.13 性能

- Principal 和 ClientPolicy 在单次请求内缓存，避免重复 Mongo 查询。
- Portal Key 验证使用带索引的 credential hash，不全表扫描。
- DAG 调度只计算受影响节点，状态写入使用精确条件更新。
- SSE listener 在断开时释放；多进程广播不使用进程内全局扫描。
- Admin 混合集合分页使用稳定排序游标或两路有界查询，禁止加载全部 Portal Key 后切片。
- Portal/Dashboard 使用路由级 code splitting，避免继续扩大主 bundle。

### 7.14 测试

单元测试：

- 表达式允许/拒绝语法、原型链、全局对象和复杂度限制。
- 纯环、自环、重复边、缺失节点和合法 DAG。
- Run 状态转换、重复回调、取消竞态、重试 attempt。
- Portal JWT、Refresh Token 旋转和重放检测。
- Portal/Admin ClientPolicy 一致性。

集成测试：

- 用户 A 无法读取、修改、执行或订阅用户 B 的资源。
- Portal Key 的 QPS、每日限额、模型 allowlist、计费和 Wallet。
- Admin 权限不足返回 403。
- 模板 JWT/API Key 两种认证。
- Mongo/Bull 下真实工作流 model 节点创建子任务。

前端验证：

- Portal 和 Dashboard production build。
- 登录、刷新、登出、工作流 CRUD、编辑、运行、取消、重试。
- 管理后台工作流和 Portal 用户权限路由。

回归：

- 现有后端全量 Jest。
- Dashboard 菜单一致性脚本。
- API、worker、scheduler、admin-server 四进程启动烟测。

### 7.15 Migration / Rollout

1. 增加新字段和双读能力，部署但不切换写路径。
2. 回填 Refresh Token、Portal Key 和 WorkflowRun owner 数据；无法安全迁移的凭据要求重新签发。
3. 启用新 Principal、ClientPolicy 和 owner-scoped 查询。
4. 启用真实工作流队列，先限内部管理员账号。
5. 验证取消、重试、计费和事件指标后开放 Portal 用户。
6. 移除旧明文字段、模拟执行和双读逻辑。
7. 发布 Portal 静态构建，停止 Vite 开发进程。

回滚不得恢复明文 Token 或不安全表达式；如真实执行异常，应关闭工作流运行入口而不是返回模拟成功。

### 7.16 风险

- TaskService 是异步模型任务接口，工作流节点完成需要可靠消费任务终态事件。
- 多进程 EventEmitter 无法跨进程推送 SSE，需要确认现有 Redis 能否作为事件总线。
- Portal Key 哈希化后无法在 Admin 页面恢复完整 Key，产品交互必须接受“只显示一次”。
- 旧 Portal 用户没有 Wallet 或 owner 回填数据时不能直接开放模型调用。
- Cookie 会改变现有前端会话恢复方式，需要同步配置反向代理、HTTPS 和 CORS。

### 7.17 待确认事项

本设计采用以下保守默认值，若无额外产品要求即按此实施：

1. Portal API Key 默认计费策略为 `internal`，创建 Key 时同时创建零余额 Wallet；余额不足明确拒绝任务。
2. 工作流真实执行先支持现有 `model/input/output/condition/transform/loop`，不增加自定义代码节点。
3. Portal Refresh Token 改用 HttpOnly Cookie，已有会话统一重新登录。
4. SSE 跨进程事件使用现有 Redis，不引入 Kafka 等新基础设施。
5. 管理后台只显示 API Key 掩码，任何角色都不能恢复完整 Key。

### 7.18 验收标准

- 仓库不存在 `eval`、`new Function` 或等价动态代码执行。
- 用户 A 对用户 B 的 Workflow、Run、SSE 全部得到 404。
- 纯环和自环工作流无法保存或执行。
- model 节点产生真实 Task，结果来自 Task 状态而非 placeholder。
- 取消后 Run 永远不能回到 succeeded；重试会产生新 attempt 和真实 Job。
- Portal Key 的限流、模型权限、计费和 Wallet 均有通过的集成测试。
- JWT 生产缺失密钥时启动失败；数据库不保存可直接使用的 Refresh Token 或 API Key。
- Admin 工作流和 Portal 用户接口同时通过认证、权限和角色守卫。
- Admin 列表分页总数准确，任何列表/详情不返回完整 Portal Key。
- 后端、Dashboard、Portal 均构建成功；后端全量测试通过。
- 四类后端进程与 Portal production 静态服务完成烟测。
- README、本文档、实际端口、构建脚本和部署方式一致。
