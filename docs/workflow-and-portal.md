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
8. [工作流编辑器交互完整性修复设计](#8-工作流编辑器交互完整性修复设计)

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

## 8. 工作流编辑器交互完整性修复设计

> 状态：第 8 章交互修复已实现，已通过本地构建、工作流回归、浏览器主要交互验收及独立 Review。真实存储上传与收费供应商模型调用尚未端到端验收，具体限制见 8.13；不能据此宣称生产全能力已验收。保留第 7 章安全约束。

### 8.1 背景与目标

用户在 `/workflows/new` 发现多个工具按钮无响应。实际并非统一的事件遮挡：新增节点、模型下拉、部分参数和画布缩放已接线，但格式工具栏、麦克风、附件、部分侧栏和配置入口未接通；保存、执行和结果展示也存在契约断裂。

目标是逐项恢复可见交互、保证编辑内容保存后可还原、让运行使用最新图并展示真实状态和结果。范围覆盖当前编辑器全部可见入口，不仅限于截图文本节点。

非目标：重构供应商协议、重写鉴权计费、增加任意代码执行、迁移前端框架或修改其他后台功能。不借本次任务扩展完整三维场景编辑器或独立图片处理产品；这些入口的实际语义须在 8.12 确认后执行，不得擅自删去。

### 8.2 当前实现与问题证据

- `WorkflowEditor.tsx` 的 React Flow 本地 nodes/edges 是画布数据源；不能只修改未接入画布的 Zustand nodes/edges。
- `ExpandedNodeShell.tsx` 的格式栏、附件加号、展开、麦克风和数量按钮存在无处理函数控件；`1x` 当前是静态文本。端口上的加号实际为 React Flow Handle，不是新增按钮。
- `AIAgentNode.tsx` 有普通 prompt textarea，没有富文本状态；`ModelNode.tsx` 提示配置但当前页面没有对应配置入口。
- `ModelParamChips.tsx` 仅枚举参数可编辑，数值标签没有编辑行为；模型切换保留旧模型特有参数。
- 单节点和整图运行未先保存当前编辑；整图没有持续状态追踪，单节点仅固定次数轮询并生成模拟进度。
- 模型执行结果为 `{ taskId, result }`，部分节点却读取 `image`、`video` 等字段；视频只有播放图标，没有真实播放器。
- 素材、聊天、历史侧栏以及部分右键操作只显示预告或关闭菜单；上传没有现成 API。旧 `NodeDetailPanel` 未挂载，不能算作已完成配置能力。
- 保存未保留 viewport、edge label/branchId；新建路由没有清理全部编辑状态。
- 浏览器已确认新增文本节点有效、H1 无实际编辑效果、麦克风无反馈。尚未执行付费模型任务，其他问题属于源码核对结果，实施时仍需逐项复现。

### 8.3 按钮行为与验收矩阵

| 分组/入口 | 目标行为 | 验收要点 |
|---|---|---|
| 返回、工作流名称 | 返回列表；名称写入保存数据；未保存离开提示 | 取消离开保留编辑，确认后导航 |
| 顶栏缩放、适应视图、画布 Controls | 操作同一 React Flow 实例 | 坐标变化正确，不改变图数据 |
| 新增菜单所有节点类型 | 新节点在视口内且可配置，选中可编辑 | 文本/图像/视频/音频及其他现有类型逐项验证 |
| 模型下拉 | 展示真实可用模型，选中后加载其参数 | 加载失败可重试，快速切换不被旧响应覆盖 |
| 参数标签及完整配置面板 | enum/number/boolean/string 等按模型元数据编辑校验 | 非枚举不再是空按钮；保存重载值一致 |
| H1/H2/H3/正文、粗体、斜体、列表 | 对当前文本选区或当前段落生效 | 保留光标、支持撤销；模型 prompt 使用可预测纯文本 |
| 文本颜色 | 修改文本呈现并保存 | 不只改变工具按钮自身颜色 |
| 复制、粘贴、副本、删除 | 节点副本使用新 ID；删除同步处理边；系统复制写剪贴板 | 文本输入内快捷键不被画布拦截 |
| 节点展开 | 打开可编辑的大视图，与节点共享同一数据 | 关闭不丢数据，不重复创建节点 |
| 端口加号、连线 | 拖拽连接并有明确方向提示；点击显示连接目标选择 | 禁止自环/非法连线；选中边可删除 |
| 附件加号、素材库 | 上传或选择当前用户素材，写入所选模型真实媒体参数 | 类型/大小/权限失败有反馈；不伪造 URL |
| 麦克风 | 开始/停止浏览器语音输入，识别文本写入 prompt | 权限拒绝、无设备、不支持均明确说明；不假装录音成功 |
| 1x 与数量按钮 | 必须绑定经过确认的速度/数量业务参数 | 模型不支持时明确原因；不向接口发送不存在参数 |
| 校验 | 校验当前未保存图并定位问题节点/边 | 展示真实业务错误，不只显示笼统失败 |
| 保存 | 新建/更新完整可持久化图、视口和边元数据 | 保存重载往返不丢字段，失败保留草稿 |
| 节点发送、整图运行 | 校验并保存当前编辑后运行；新图先创建 | 编辑后运行使用新值；防止重复提交 |
| 状态、取消、重试、历史 | 显示后端真实运行状态，提供实际操作 | 无模拟进度；终态停止订阅；失败/取消不显示成功 |
| 输出预览 | 文本/图片/视频/音频按真实结果解析展示 | 视频音频可播放；未知结果可查看结构化详情 |
| 模板 | 跳转/创建模板工作流时处理未保存状态 | 创建后加载真实新 ID 与图 |
| 右键保存素材、反馈、应用历史 | 分别保存真实素材、提交/导出诊断信息、明确选择历史输出 | 禁止仅关闭菜单或返回假成功 |
| 聊天、头像及其他侧栏入口 | 明确会话/账户功能与导航目标 | 不保留可点击的空业务入口；语义见 8.12 |

### 8.4 状态与组件方案

以编辑器本地 React Flow 状态为唯一图数据源，Context 暴露已存在的更新方法及必要的复制、删除、展开、附件、文本格式回调。避免建立第二套节点状态。右侧或展开配置面板复用模型元数据与现有组件，覆盖通用模型、音频及 input/output/condition/transform/loop 等可编辑节点。

文本格式使用受约束的结构化文档数据，不保存任意 HTML；渲染不使用未清理的 `dangerouslySetInnerHTML`。结构化内容转为纯文本 prompt，旧节点仍从现有 prompt 初始化。新增字段须同步 DTO、Schema 与序列化，不能只改前端而被 whitelist 丢弃。

新建时清理旧名称、边、选中节点、执行状态和 runId。异步模型加载带响应时序保护；失败与空结果区分。切换模型只保留明确兼容的通用输入，不能把旧模型特有参数混入新模型。

### 8.5 保存、执行与输出契约

抽取一个页面内部保存流程供保存、节点运行、整图运行共用；运行使用该流程返回的真实 workflowId。持久化只包含业务编辑字段，不把临时进度或结果写回节点定义。保留 viewport、edge label/branchId 和合法已有数据。

沿用现有接口：`POST /v1/workflows`、`PUT /v1/workflows/:id`、`POST /v1/workflows/validate`、`POST /v1/workflows/:id/run`、`POST /v1/workflows/:id/nodes/:nodeId/run`、`GET /v1/workflows/runs/:runId`、取消/重试接口。运行 body 按后端实际结构发送，不额外包裹未定义的 input 层。

运行采用可清理的状态轮询，或复用已有经过认证的 SSE；实现选一种主机制，不同时建立重复订阅。覆盖 pending/running/succeeded/failed/cancelled/skipped，取消和页面离开释放资源。不得用请求次数伪造百分比，也不得固定 30 秒把仍在执行的模型标记失败。

保持 Task 原始 result，不猜测供应商输出。统一模型节点 result 到显示类型与输出端口的适配；根据真实结果结构提取文本或媒体 URL，并保留原始结果查看。连线输入必须按端口类型验证，不再在缺少端口时悄悄传整个对象。旧工作流端口需要明确映射与回归，不能静默破坏已有图。

### 8.6 新增能力与 API 边界

- 历史：补充所有权隔离的工作流运行列表接口，支持分页及状态筛选，复用现有 listRuns 服务；路径不得与 `:id` 动态路由冲突。
- 素材：复用项目实际可用的存储适配器，提供认证上传、素材列表与读取能力。文件大小、内容类型、存储凭据、访问有效期和用户隔离必须先确认；缺少存储配置不得返回假素材。浏览器预览 URL 不能直接当供应商可访问 URL。
- 语音：优先浏览器能力转文字，不新增未经确认的收费转写供应商；不支持的浏览器提供明确限制及文字输入替代。若要求全浏览器语音能力，需要单独确认后端转写配置。
- 前端所有请求继续使用现有认证 Axios 实例和 `/api` 代理。新增接口遵循现有响应 envelope、鉴权和所有权规则。

### 8.7 数据、安全与错误处理

不更改用户角色、API Key、钱包余额或模型权限。素材、历史、工作流、运行记录都按当前认证主体隔离，跨用户访问返回 404。输出与富文本按不可信内容处理；禁止任意 HTML/代码执行。上传不能接受任意服务器文件路径，不引入任意 URL 服务端抓取。

401/403/429、余额不足、缺少可计费 API Key、模型参数错误、网络错误及取消均显示可理解的真实原因。密码、完整 API Key 和令牌不得进入日志、反馈导出或错误弹窗。复制、上传、运行等操作有提交中状态并防重复。

### 8.8 文件影响范围

- 页面与状态：`portal/src/pages/WorkflowEditor.tsx`、`portal/src/store/workflow-store.ts`、编辑器 Context。
- 编辑器组件：`portal/src/components/Editor/` 内侧栏、菜单、右键与配置组件。
- 节点：`portal/src/components/Node/ExpandedNodeShell.tsx`、`AIAgentNode.tsx`、`TextToImageNode.tsx`、`TextToVideoNode.tsx`、`ModelNode.tsx` 及其他需要配置的节点。
- 模型与 API：`portal/src/hooks/useNodeModelConfig.ts`、`useModels.ts`、`useModelParams.ts`、模型缓存/参数工具及 `portal/src/services/workflow-api.ts`。
- 后端：`src/workflow/` 中 Controller、DTO、序列化/执行器与结果适配；素材接口及存储接入具体路径在复用调查后确定。相应 Schema 只新增必要可持久化字段。
- 验证与说明：现有工作流测试及本文档验收记录。不手工编辑任何 `dist/`。

### 8.9 兼容性、性能与发布

新增编辑字段使用可选值并支持旧数据；现有工作流无需批量破坏性迁移。若端口变化需要迁移，先提供显式映射与回滚策略，禁止默默丢边。富文本、素材元信息及运行历史按需加载，历史分页；不在每次渲染请求模型列表；轮询终态及时停止。

先验证前后端数据兼容，再构建部署。开发模式仍使用 Vite 代理；生产静态托管必须存在 API 反向代理，本次不得把开发服务器误称为生产部署方案。仅重启受影响进程，保留其他未提交修改。

### 8.10 测试与验收

1. 为 8.3 每一行记录实际点击、期望结果和观察结果；不能只用编译通过证明 UI 可用。
2. 浏览器覆盖选择/输入/拖拽/复制/删除/撤销/展开、不同节点、模型切换与完整参数编辑；验证保存重载一致性。
3. 后端契约测试覆盖端口适配、图验证、状态终态、历史所有权与上传边界；复用现有测试模式，不为 UI 另引入测试框架。
4. 用隔离工作流验证保存当前修改后运行，验证取消、失败、重试以及真实输出。运行真实收费模型前确认模型凭据、额度与费用授权；不修改现有用户工作流或给钱包造余额。
5. 校验、保存、运行、模型加载失败均有错误反馈；接口拒绝不被视为按钮无反应。
6. 后端与 Portal 构建通过，相关回归通过；独立 Review 的阻塞问题修复后重新 Review。
7. 清理专用测试账号、图、任务和文件；无法安全清理的外部任务/费用明确记录，不删除用户已有数据。

### 8.11 实施顺序

设计确认后，先锁定节点数据/端口和回调契约，再并行实施：编辑器保存与执行、节点编辑与工具栏、模型参数与结果、素材/历史等能力。共享接口由主任务固定，禁止各分支各自定义一套。统一集成后逐项浏览器验证、后端回归、构建与 Review，最后更新本章实际完成状态。

### 8.12 执行前待确认事项与风险

- 已确认：速度与数量仅绑定模型实际声明的参数；数量识别包含现有配置中的 `image_quantity`、`img_count`、`num_images`、`batch_count`。无对应参数时禁用并解释原因，不发送虚构字段。
- 已确认：“3D 世界”和“图片编辑器”按模型驱动节点交付，不是独立三维场景或修图软件。
- 已确认：聊天为选中节点的多轮文本输入，历史明确选择一次运行输出，反馈复制脱敏诊断信息。
- 存储：复用现有 storagesvc，媒体最大 20 MiB，UTF-8 文本/JSON 最大 1 MiB。当前 `storagesvc.host` 缺失，用户选择暂不配置；真实上传验收等待该配置。
- 真实模型运行需要可用模型、API Key、余额及费用授权；本次没有执行收费模型。免费转换节点的真实队列执行不等价于供应商模型端到端验收。
- 用户已确认本章执行方案；尚未实施或验证的条目不能标记完成，也不能通过隐藏入口减少验收范围。

### 8.13 本次实现与验收记录

#### 实现落点

- `WorkflowEditor.tsx` 统一保存后运行、视口及边元数据往返、当前文档代际保护、真实状态轮询、取消/重试、历史、聊天与上下文操作。任意选中节点都有可见的“完整配置”入口，双击不再是控制节点的唯一配置方式。
- `StructuredTextEditor.tsx` 使用受约束文档与纯文本 prompt，实现标题、粗斜体、列表、颜色和原生撤销；列表转标题先退出列表，空段落占位不在往返中增长。颜色归一化为 `#RRGGBB`。
- `NodeParametersPanel`、模型 hooks、参数组件与 `NodeOutputPreview` 接通完整参数、元数据数量/速度、真实图片/视频/音频预览和原始 JSON。含斜杠的 modelId 经过 URL 编码后请求端口定义。
- 新增素材 API/面板及 owner 隔离的历史列表；新增后端受约束字段、结果端口映射与错误检查。loop 的新 last 输出使用显式版本包装，避免业务对象 `value/result/output/results` 键与输出别名冲突。
- 删除键优先处理实际选中的边并立即返回，只有确实选中节点时才删除节点，避免 stale selectedNodeId 误删。

#### 已执行验证

| 项目 | 证据与结果 |
|---|---|
| 后端回归 | `npm test -- --runInBand src/workflow/__tests__`：9 个套件、69 项测试通过；包括历史隔离、DTO 白名单、端口输出与循环对象兼容、取消终态、上传边界及配置缺失 |
| 构建 | 后端 `npm run build` 与 Portal `npm run build` 通过；Portal 有现存大 chunk 提示，不阻塞构建 |
| 新建/保存 | 浏览器新建保存返回 201，路由切换到真实 ID 且节点保留；新建初始名称及空图复位 |
| 最新编辑执行 | 转换表达式由 `40 + 2` 改为 `40 + 3` 后，浏览器依次发出校验、PUT 保存、POST run；真实队列 succeeded，历史输出为 `{ value: 43 }` |
| 状态/取消/重试 | 免费 8 节点图在页面点击取消，接口返回 200，页面显示 cancelled 且运行按钮恢复；历史失败运行点击重试实际触发 retry 接口 |
| 文本与展开 | 浏览器验证 H1/H2/H3/正文、粗斜体、列表、撤销/重做；最终 H1、红色及斜体经 API 存为结构化数据，重载文本和格式一致，标题字号 24px；展开视图共享同一文本 |
| 节点编辑 | 文本、图片、视频、音频、三维生成和图像编辑均可新增并打开配置；转换节点可见配置入口可修改表达式；Seedream 5.0 Lite 的真实 `img_count` 数值可编辑 |
| 画布与连接 | 缩放改变真实视口；重载还原 `translate(12px,25px) scale(0.8)`；节点复制粘贴后数量增加，删除副本后恢复；点击端口可选择目标并产生边；删除选中边时节点数 2→2，边数 1→0 |
| 导航与聊天 | 修改后尝试返回触发未保存确认，取消后名称和页面保留；消息加入选中节点 prompt；头像进入 `/profile`，模板入口进入 `/templates` |
| 历史与预览 | 分页历史显示 succeeded/failed，选择运行可展开真实 JSON 并应用节点输出；免费转换节点携带验收媒体数据，图片加载 64×64、视频实际播放、音频达到可播放就绪状态；这些不是供应商生成测试 |
| 素材 | 列表及从本人运行输出保存媒体引用成功；面板显示记录、删除确认和删除后的空列表；本地上传缺配置返回明确 503，不创建假素材；匿名素材访问 401 |
| 语音/剪贴板 | 当前浏览器麦克风被拒绝时明确提示权限原因；授予验收上下文剪贴板写权限后，系统复制和脱敏反馈显示成功。未验证真实声音识别质量、所有浏览器 IME 或全部模型参数组合 |
| 独立 Review | 修复并复审关闭生命周期跨图竞态、素材数组类型、数量字段遗漏、循环 last 对象歧义；浏览器追加发现的删边误删节点亦已修复复测 |

#### 未完成的外部验收与部署注意

1. **真实上传已通过，匿名读取等待 MinIO 策略**：2026-09-21 后续复查 `modelhub` bucket 已就绪，PNG/TXT 经 Portal 成功写入，鉴权读取的字节及 MIME 正确；但返回 URL 匿名 GET 均为 `403 AccessDenied`，`getBucketPolicy` 返回 `NoSuchBucketPolicy`。部署方须配置已批准的指定前缀匿名只读策略，详见 8.14 最新复验。
2. **收费模型端到端未执行**：需明确模型及额度授权。已完成免费转换节点执行和真实模型元数据配置，不宣称已验证供应商产出。
3. 浏览器语音依赖 SpeechRecognition、麦克风权限、设备和浏览器服务；拒绝或不支持有提示，不伪造识别成功。
4. 现有存储适配器没有物理删除接口，删除素材仅删当前用户素材记录，返回 `storageObjectDeleted: false`；不会撤销已被工作流引用的 URL。输出引用可能随供应商链接到期失效，界面已说明。
5. 旧 loop last 精确单键 `{ value: ... }` 无法区分历史标量包装与同形业务对象，旧记录沿用标量解释；新运行的版本包装消除此歧义。
6. API、worker、scheduler 与 admin-server 已加载本次构建，Portal 本地仍由 `7004` Vite 代理服务提供。生产静态部署仍必须配置反向代理，不能直接用无代理的 `serve -s dist` 替代。
7. 验收使用专用账号与免费工作流，不修改现有用户图或钱包；测试账号、图、运行、刷新令牌和临时媒体文件在验收后清理。未执行 commit 或 push。

### 8.14 MinIO 工作流素材直连实施记录（2026-09-21）

#### 实现与配置

- 按已批准的 `docs/minio-workflow-assets-design.md` 实施；只在素材上传路径分流，保留原 storagesvc 适配器、全局链接转换、素材 schema 和 Portal API。
- `APP_CONFIG.workflowAssetStorage` 整段缺省或 `provider: "storagesvc"` 使用旧路径；`provider: "minio"` 使用 `MinioWorkflowAssetStorageService`；未知 provider 明确报错，不回退。
- MinIO 非秘密配置：`endPoint`、`port`、`useSSL`、`bucket`、`publicBaseUrl`，以及可选 `region`、`pathPrefix`（默认 `workflow-assets`）、`uploadTimeoutMs`（默认 60000）、`allowInsecureHttp`（默认 false）。HTTP 上传或读取须显式授权；`publicBaseUrl` 已包含 bucket 根或等价代理根。
- 凭证仅由服务端环境变量 `WORKFLOW_ASSET_MINIO_ACCESS_KEY_ID`、`WORKFLOW_ASSET_MINIO_SECRET_ACCESS_KEY` 注入，不写入业务配置、数据库或前端。部署应使用限定前缀权限的非 root 账号；本次仅核实凭证存在，不宣称已验证账号权限范围。
- 配置由 Nacos 整包或本地环境 JSON 加载，变更须重启。模板仍保留 storagesvc 默认行为；开发配置已选择 `modelhub` bucket 和 `workflow-assets` 前缀。
- 固定 `minio@8.0.6`，客户端单例；对象键为前缀、owner 哈希、UUID 和已校验扩展名；持久化稳定 URL，不使用过期预签名地址。超时中断实际请求/响应，阻止 SDK 对可重试 HTTP 状态进入后台退避。
- 上传失败仅记录固定错误类别及 assetId；MinIO 写入后元数据失败记录 assetId 和精确 objectKey，不记录原始异常或秘密，不补偿删除对象。删除素材仍仅删 owner 范围内记录。

#### 本轮实际验证

| 项目 | 结果 |
|---|---|
| 合同与回归 | `minio-workflow-asset-storage`、`workflow-asset.service`、`node-executor`、`workflow-editor-contracts` 共 4 个套件、102 个测试通过；包含真实 SDK 对本地 HTTP 服务的字节/MIME、region、并发、超时中断及失败语义验证 |
| 后端构建 | `npm run build` 通过；`dist/` 仅由构建生成，未手工修改 |
| 实际运行 | 最新构建 API 在 7015 就绪，Portal 7016 代理该 API；使用专用验收账号及无敏感 PNG/TXT，通过素材面板文件选择器提交 |
| PNG/TXT 上传 | 两者均返回 HTTP 503，消息 `Workflow asset storage unavailable`；刷新素材列表 `items: []`、`total: 0`，未创建假素材 |
| 安全边界 | 匿名素材列表返回 401；实际服务日志含 `storage_failure` 和 assetId，不把原始 SDK 错误返回前端 |
| 部署诊断 | 对配置端点及 `modelhub` bucket 使用相同凭证执行只读 region 探测，返回 S3 `NoSuchBucket`；未创建 bucket、修改策略或调用收费模型 |
| 独立代码 Review | PASS：Critical / High / Medium / Low 均无发现；仅为静态审查，不代替真实成功上传与模型验收 |

#### 未通过的上线门槛

最新复查 `modelhub` bucket 已存在，region 为 `us-east-1`；Portal 真实 PNG/TXT 已成功写入。尚需部署负责人配置已批准的 `workflow-assets/*` 匿名只读策略，并确认应用账号权限最小化；应用不自动操作策略。公开读取就绪后继续匿名 GET 字节/MIME 比对与图片 URL 解码验收。

最新返回的素材 URL 仍匿名读取 403，不能宣称公开读取或供应商素材消费已通过；HTTP 仅用于已批准的非敏感验收，生产 TLS/公开域名仍是部署门槛。供应商真实执行仍等待指定模型、调用次数与费用上限；未执行 commit 或 push。

本轮创建的专用验收账号及 5 条关联刷新令牌已按精确账号清理；未保存工作流，未成功写入素材。临时 API/Portal 验收进程已停止；未改动既有用户数据或存储策略。

#### 部署 bucket 就绪后的复验

- 只读 region 查询成功：`modelhub` / `us-east-1`。API 7015 与 Portal 7016 重新启动，专用新账号经素材面板上传 PNG/TXT。
- PNG 对象为 95 字节，鉴权 `statObject/getObject` 确认 `image/png` 且与浏览器 canvas 生成的原始字节完全一致；TXT 为 66 字节、`text/plain`，中文正文及真实换行与原始样本一致。
- 对两个稳定对象 URL 分别执行不带认证的真实 GET，均返回 HTTP 403、`application/xml`、`AccessDenied`，不是图片或文本内容；匿名 bucket 列举也返回 403。鉴权读取成功不等价于匿名读取或供应商可达。
- 只读 `getBucketPolicy` 返回 `NoSuchBucketPolicy`；未创建 bucket、设置策略、开放整个 bucket 或调用模型。

部署方需配置的匿名读取范围如下，仅为审阅示例，**本次未应用**；如已有策略，应审阅合并而非盲目覆盖：

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "WorkflowAssetsAnonymousRead",
      "Effect": "Allow",
      "Principal": { "AWS": ["*"] },
      "Action": ["s3:GetObject"],
      "Resource": ["arn:aws:s3:::modelhub/workflow-assets/*"]
    }
  ]
}
```

后续浏览器及独立持久化核实：

- 素材面板上传后刷新，两条素材仍在；`gpt-image-1.5/text-to-image` 节点的 `parameters.prompt` 保存 TXT 原文，`wan2.7-image-pro/image-to-image` 的 `parameters.images` 保存 PNG 稳定 URL 单元素数组。保存新图并刷新后完整配置仍保留，另直接查询 Mongo 验证两字段一致。本次没有捕获上传 POST 的精确 HTTP 状态码，不将其记为某个具体状态码。
- 用户 B 的素材列表 200 且 total=0，删除 A 的两条素材均返回 404；匿名列表返回 401。A 删除两素材各返回 200、`storageObjectDeleted:false`，再次列表 total=0；独立 `statObject` 确认 95/66 字节对象仍在，未被物理删除。
- 唯一验收图的 `workflow_runs` 数量为 0，没有运行模型。两专用用户、7 条关联刷新令牌及唯一新图已按精确 ID 清理；素材记录已通过接口删除。
- 下列无敏感样本对象保留，用于部署方策略生效后的匿名读取复验；未获得物理删除授权，不清桶、不删除对象：
  - `modelhub/workflow-assets/751ea5b9059449ddbc403b678874bf45887b5ec5988cf1fcf2dbd36056f92be9/0be2e2f3-10c4-4ccf-bc2e-6ad227405802.png`
  - `modelhub/workflow-assets/751ea5b9059449ddbc403b678874bf45887b5ec5988cf1fcf2dbd36056f92be9/44cac247-9c68-475b-b391-b229b8b9c765.txt`

结论：真实上传、附件参数保存重载、owner 管理隔离、删除记录不删对象已通过；匿名读取及通过该 URL 的浏览器图片解码仍受 403 阻塞，供应商执行仍未授权。本轮未改运行时代码，未重复运行前轮已通过的 102 项测试或构建。

本轮临时 API/Portal 进程和专用浏览器标签页已关闭。另观察到 Akool V2 的 `source_image` 字段不在现有素材参数选择白名单中；本次使用真实 Wan `images` 字段完成验收，没有修改该范围外行为，也不宣称所有模型附件字段已覆盖。