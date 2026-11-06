# 设计文档

模型契约、工作流、平台服务和供应商接入的业务规则、接口边界与兼容要求。

[返回文档索引](README.md)

## 阅读导航

- [模型契约](#model-contract)
- [工作流引擎](#workflow)
- [平台服务](#platform)
- [供应商接入](#providers)

<a id="model-contract"></a>

## 模型契约


<a id="model-contract-1"></a>

### 目标与兼容边界

一份发布配置驱动后台编辑、公开目录、API 文档、Playground 和任务校验。保留 model_id、model_type、provider、provider_model_name、params、unit_price_map 和 /v1/tasks 协议。与参考站对齐 API / 文档 / 在线测试功能；参考站的 /api/v1/run、官方兼容协议、CLI、MCP 不冒充本服务已实现的接口。

<a id="model-contract-2"></a>

### 数据契约

- params 是唯一输入定义。支持 string、number、integer、boolean、array、object；递归 items/properties；required、default、enum、范围、长度、数量、format(uri)、multipleOf、枚举联动。旧平铺定义无需迁移。
- params_rules 是声明式跨字段规则：when 条件全部满足时执行 require、forbid、values、maxTotalItems；无脚本、eval 或模型名分支。默认值补齐后再执行规则；后端为最终裁决。
- 参数 media 声明 image/video/audio、accept、maxBytes、referencePrefix。ui_schema 声明 order、advanced 和字段分组，独立于 params，不混入请求参数。
- output_schema 使用同一参数类型描述任务 data.result；媒体 format/media 驱动预览。docs 使用纯文本章节，React 转义展示；examples 保存名称、输入、可选输出，均使用公开参数。
- pricing 声明 usage_type、usage_param、tier_param、tier_rules、auto_value、auto_prelock_units；金额仍取 unit_price_map.unit_credit，公开投影只返回 credits，不暴露内部成本。tier_rules 复用 when 条件结构，第一条满足全部条件的规则指定 tier（价格表键）；无匹配规则时沿用 tier_param/default。显式规则引用的档位须有有效价格，缺失时拒绝保存或计费，避免错误回退。duration=-1 采用正数预估，结算优先使用供应商报告的实际用量；供应商未返回时长时，使用请求时长，自适应时长回退到已预估的正数用量。结算沿用任务账单锁定的单价和计费类型。
- contract_version=2；revision 为活动配置修订号。draft_revision 为草稿修订号，防止多个编辑者互相覆盖；draft 保存待发布完整快照，history 保留最近 20 个活动快照。编辑草稿不会改变运行配置；发布和回滚带 expected_revision 和 expected_draft_revision，使用原子条件更新防止覆盖。历史不会公开。

<a id="model-contract-3"></a>

### 身份与执行

公开详情返回 config_id（配置 _id 的不透明字符串），前端提交 options.configId 和 configRevision。任务校验 ID、公开模型、能力、启停状态和修订号一致，并继续执行白名单、限流、供应商路由。若选中配置与路由策略冲突，拒绝并提示重新选择，不能绕过管理员路由。未传 configId 的旧调用保持原有路由方式。

计费使用任务实际选中的配置和转换前输入，避免同名多厂商串价；按 tier_param 选择档位，默认 default。任务记录保存配置 ID 和修订号用于追溯。不在配置中加入供应商密钥或任意可执行适配脚本；新供应商协议仍通过 Adapter 接入。

带视频参考的差异价格可直接配置：`{"when":[{"field":"videos","operator":"present"},{"field":"resolution","operator":"eq","value":"720p"}],"tier":"720p:video"}`。空数组视为未提供素材。后台、公开价格与 Playground 使用同一选价和用量计算；公开投影过滤引用隐藏参数的规则，沿用现有字段隔离。

<a id="model-contract-4"></a>

### 后台

保留基础参数可视化编辑，并提供高级契约 JSON 编辑区，错误保留草稿、阻止保存。参数行编辑往返保留递归结构和媒体描述。编辑页提供保存草稿、加载草稿、发布、回滚；原立即更新入口保留兼容。所有保存和发布入口执行同一契约校验。新增配置可先 disabled=true，预览确认后启用。

<a id="model-contract-5"></a>

### 门户

模型详情展示 API / 文档 / 在线测试。API 展示本站鉴权、请求、轮询、回调、终态、错误以及输入输出结构。文档展示后台配置章节与示例。在线测试支持 Form/JSON、示例载入、恢复默认、图片/视频/音频 URL 与上传、增删排序、素材引用提示、基础/高级参数、cURL/Python 同步预览、运行、取消、查询状态、结果 JSON 和媒体预览。

运行使用用户主动填写的 API Key，仅存组件内存；不自动创建 Key。上传复用已登录用户的 /v1/workflow-assets；未登录可浏览文档。提交保留真实鉴权和计费，不增设免计费路径。使用幂等键避免网络重试重复创建；超时后显式刷新同一任务，不能自动重发。切换模型/卸载取消轮询，失败显示错误并允许恢复查询。

<a id="model-contract-6"></a>

### 媒体边界

参数传输仍为 URL 或 URL 数组；普通参数校验后，由可信下载与 FFprobe 探测真实媒体，再进入计费和队列。签名、字节数、尺寸、时长和混合素材规则见 [资金与媒体校验](#platform)。上传仍受平台 20 MiB 上限约束，模型配置只能进一步收紧。供应商语义及实际生成能力仍需单独验收。

<a id="model-contract-7"></a>

### 发布和验证

没有自动数据库回填、供应商调用或生产部署。提供可导入的多模态参考模板，不擅自指定未接入的供应商或价格。验收覆盖类型和默认值、嵌套/数组/联动/条件规则、公开字段隔离、修订冲突、发布回滚、同名模型选取、价格档位与自适应时长、任务 API 示例、前后台构建和浏览器界面。真实生成需配置 MongoDB、Redis、素材存储、供应商和有余额的 API Key。

<a id="model-contract-8"></a>

### 接口与配置流程

| 接口 | 用途 | 权限 |
| --- | --- | --- |
| GET /v1/catalog/models | 可用模型目录，含 config_id | 匿名只读 |
| GET /v1/catalog/models/detail | 参数、规则、文档、示例、输出结构和公开价格 | 匿名只读 |
| PUT /api/v1/admin/models/:id/draft | 保存完整待发布配置 | 管理员 model:update |
| POST /api/v1/admin/models/:id/publish | 将已保存草稿设为活动配置 | 管理员 model:update |
| POST /api/v1/admin/models/:id/rollback | 恢复上一份保存的活动快照，以新修订号生效 | 管理员 model:update |
| POST /v1/tasks | 校验选中配置、鉴权并创建计费任务 | X-API-Key |
| GET /v1/tasks/:taskId | 读取当前 Key 所属任务及账单摘要 | X-API-Key |
| POST /v1/tasks/:taskId/cancel | 取消允许取消的任务 | X-API-Key |
| POST /v1/workflow-assets | 上传素材并返回可访问 URL | 已有 API Key/JWT 上传鉴权 |

详情查询支持 model_id、model_type、provider、config_id。目录条目、文档链接、工作流节点和任务请求均传递 config_id，避免相同 model_id / model_type / provider 对应不同 provider_model_name 时选错配置。旧链接不带 config_id 仍兼容。

保存草稿请求示例：

```json
{
  "expected_revision": 3,
  "expected_draft_revision": 1,
  "config": { "model_name": "新版展示名称" }
}
```

发布/回滚请求只携带两个 expected 版本号。保存成功应替换页面缓存的活动与草稿版本号；409 时重新加载后核对差异。正常状态转换为：活动 revision=3 / draft_revision=1 → 保存草稿后 3/2 → 发布后 4/3，草稿清空，历史加入 revision=3 的完整配置。回滚生成新 revision，不重复使用旧版本号。历史最多 20 条，不提供任意历史版本选择。立即完整更新也保存历史；快捷启停和独立调价递增活动版本号，使旧草稿编辑请求失效。

<a id="model-contract-9"></a>

### 接入新模型与渐进上线

1. 使用 model-contract-v2.example.json 作为配置参考，替换 model_id、provider_model_name、展示信息和真实价格，保持 disabled=true。
2. 定义 params，再补充 params_rules、ui_schema、output_schema、docs、examples 和 pricing；示例输入和输出须通过相同结构校验。已有 Adapter 能原样承接的参数只需配置；新厂商鉴权、异步任务协议或字段转换超出当前 Adapter 能力时，增加对应 Adapter。
3. 后台检查参数预览并保存草稿。发布前配置真实素材存储、供应商凭据和路由，核对字段映射、白名单及计费单位。
4. 部署后端和两套前端，再发布正式配置、按计划启用；用测试账户做真实生成与账单核对。本文模板含占位模型和价格，不能直接作为生产接入配置。
5. 旧记录缺少新增字段时按 contract_version=1、revision=0、draft_revision=0 读取，不需要全量回填。首次编辑会执行完整契约校验，应先修复旧记录中的非法默认值或枚举联动。既有任务继续使用自己的参数与账单；新任务带配置修订号，遇到活动配置变更时返回冲突并要求刷新。

<a id="model-contract-10"></a>

### 验收范围

回归入口为 `src/common/utils/model-contract.spec.ts`、`src/admin/model-config-version.spec.ts`、`src/task/model-selection.spec.ts` 和 `src/billing/model-contract-billing.spec.ts`。媒体探测已补充独立实现与定向测试；供应商实际可用性、真实费用、生产部署、官方兼容 API、CLI 和 MCP 仍须分别验证。UI 的条件规则会展示校验原因并阻止提交；不会自动改写用户输入或自动替换非法选项。上传大小沿用平台限制，不能通过模型配置放大到超过平台上限。

<a id="model-contract-11"></a>

### 完整契约样例

[多模态配置夹具](../src/common/fixtures/model-contract-v2.example.json) 包含递归参数、联动、媒体、输出与计费字段，使用占位模型及价格，仅用于说明和回归。

<a id="workflow"></a>

## 工作流引擎


> 工作流引擎技术参考。认证配置以 [门户认证](technical.md#deployment) 为准，素材后端以 [存储配置](technical.md#deployment) 为准。

---


<a id="workflow-1"></a>

### 概述

Model-Hub 提供了两个面向外部开发者的核心能力：

| 能力 | 说明 | 前端 |
|------|------|------|
| **工作流引擎** | 可视化 DAG 编排，串联多个 AI 模型调用 | `portal/` (React Flow) |
| **开发者门户** | 自助注册、API Key 管理、工作流管理 | `portal/` (React + Ant Design) |

这两个能力通过独立的后端模块（`WorkflowModule`、`PortalAuthModule`）和独立的前端应用（`portal/`）实现，与管理后台（`dashboard/`）完全分离。

---

<a id="workflow-2"></a>

### 工作流引擎

<a id="workflow-3"></a>

#### 设计目标

| 目标 | 说明 |
|------|------|
| **可视化编排** | 通过拖拽式 DAG 编辑器组合多个 AI 模型调用 |
| **多节点类型** | 支持模型调用、条件分支、循环、数据转换等 6 种节点 |
| **实时执行监控** | 通过 SSE (Server-Sent Events) 实时推送节点执行状态 |
| **模板系统** | 预置工作流模板，支持一键复用 |
| **选择性重试** | 支持对失败节点单独重试，无需重跑整个工作流 |

<a id="workflow-4"></a>

#### 架构总览

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

<a id="workflow-5"></a>

#### 节点类型

| 节点类型 | 说明 | 输入端口 | 输出端口 |
|---------|------|---------|---------|
| **model** | 调用 AI 模型（通过 TaskService） | 模型参数 | 任务结果 |
| **condition** | 条件分支（表达式求值） | 条件表达式 + 分支数据 | true/false 分支 |
| **loop** | 循环迭代（最大 1000 次） | 数组 + 循环体 | 迭代结果数组 |
| **transform** | 数据转换（表达式求值） | 输入数据 + 表达式 | 转换后数据 |
| **input** | 工作流入参定义 | 外部输入 | 传递数据 |
| **output** | 工作流出参定义 | 上游数据 | 最终输出 |

<a id="workflow-6"></a>

#### 执行流程

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

<a id="workflow-7"></a>

#### 表达式系统

条件和转换节点使用简单的表达式求值器：

| 变量 | 说明 | 示例 |
|------|------|------|
| `$input.*` | 工作流入参 | `$input.prompt` |
| `$nodes[nodeId].*` | 上游节点输出 | `$nodes.abc123.output` |

<a id="workflow-8"></a>

#### MongoDB Schema

<a id="workflow-9"></a>

##### workflows 集合

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

<a id="workflow-10"></a>

##### workflow_runs 集合

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

<a id="workflow-11"></a>

##### workflow_templates 集合

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

<a id="workflow-12"></a>

### 开发者门户（Portal）

<a id="workflow-13"></a>

#### 概述

Portal 是面向外部开发者的独立前端应用，提供：

- 自助注册与登录
- API Key 管理
- 工作流可视化编辑器
- 工作流模板市场
- 执行监控

<a id="workflow-14"></a>

#### 技术栈

| 技术 | 用途 |
|------|------|
| React 18 | UI 框架 |
| React Router v6 | 路由 |
| Zustand | 状态管理 |
| Ant Design 5 | UI 组件库 |
| React Flow | 可视化 DAG 编辑器 |
| Axios | HTTP 客户端 |

<a id="workflow-15"></a>

#### 页面结构

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

<a id="workflow-16"></a>

#### PM2 配置

在仓库根目录先执行 `npm run install:portal` 安装 Portal 独立依赖，再执行 `npm run build:portal`（`build:all` 也包含此步骤）。PM2 通过 Portal 依赖中的 `serve` 托管生成的 `portal/dist/` 静态文件，不运行 Vite 开发服务器。仅安装根目录依赖不能提供 `portal/node_modules/serve/build/main.js`：

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

<a id="workflow-17"></a>

### Portal 鉴权系统

认证、验证码、OAuth、账号关联和会话撤销统一见 [门户认证](technical.md#deployment)。运行模型节点还需启用的 Portal API Key 及足够钱包余额，详见 [模板与首次运行](interaction.md#portal)。

<a id="workflow-18"></a>

### API 参考

<a id="workflow-19"></a>

#### 工作流 API

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

<a id="workflow-20"></a>

#### 模板 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/v1/workflow-templates` | 模板列表 |
| GET | `/v1/workflow-templates/:id` | 模板详情 |

<a id="workflow-21"></a>

#### Portal 鉴权 API

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

<a id="workflow-22"></a>

#### Portal API Key API

> 需携带 `Authorization: Bearer <access_token>`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/v1/api-keys/limits` | 查看当前角色配额 |
| GET | `/v1/api-keys` | API Key 列表 |
| POST | `/v1/api-keys` | 创建 API Key |
| PUT | `/v1/api-keys/:id` | 更新 API Key |
| DELETE | `/v1/api-keys/:id` | 删除 API Key |

---

<a id="workflow-23"></a>

### 前端架构

<a id="workflow-24"></a>

#### 目录结构

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

<a id="workflow-25"></a>

#### 自定义节点

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

<a id="workflow-26"></a>

#### 状态管理

使用 Zustand 管理全局状态：

- **workflow-store**: 当前编辑的工作流、节点列表、边列表、选中节点
- **auth-store**: 用户信息、Token、登录状态

---


<a id="workflow-27"></a>

### 执行与编辑器约束

- 表达式只使用受限解释器；用户输入不执行任意 JavaScript。项目、素材、运行和重试均校验归属。
- 执行模型节点复用 TaskService、参数校验、计费和现有队列；没有供应商结果时不能生成模拟成功结果。
- 编辑器保存节点、连线、画布和执行配置；上传素材先存储再记录元数据。存储失败不产生成功素材记录。
- 切换工作流时隔离历史和重试请求，迟到响应不能污染当前画布。切换模型保留合法参数，并补齐新模型默认值。
- 暂停、取消、节点重试服从实际任务能力；供应商已经执行的请求不能仅取消本地等待就视为停止计费。
- 素材删除遵循所有权与引用规则；删除数据库记录不意味着自动删除远程对象。历史链接不会因切换存储而迁移。

<a id="workflow-28"></a>

### 验证入口

```powershell
npx jest --runInBand --testPathPattern='workflow/.*spec|portal-auth.*spec'
npm --prefix portal run build
node --test portal/server.test.cjs
```

接口测试、测试替身和本地合成通过，不能代替实际供应商、对象存储和生产账号验收；发布前核对 [运行前提与待验收项](technical.md#deployment)。

<a id="platform"></a>

## 平台服务


本文集中维护计费与资金事务、通知、供应商健康度、媒体校验和认证安全的技术合同。

<a id="platform-1"></a>

### 计费与钱包

---


<a id="platform-2"></a>

#### 概述

计费系统提供任务级别的用量计量、费用计算、预扣/结算/退款能力。作为 `@Global()` 模块，在所有进程中可用。

<a id="platform-3"></a>

##### 核心特性

| 特性 | 说明 |
|------|------|
| **三层架构** | Pricing → Billing → Wallet 职责分离 |
| **三种计费策略** | exempt（豁免）、external（仅记录）、internal（完整计费） |
| **原子操作** | 钱包余额使用 MongoDB `$inc` + `$expr` 原子操作，防并发超扣 |
| **幂等状态机** | 计费记录状态转换使用条件更新，保证幂等 |
| **审计追踪** | 每笔钱包操作记录 `WalletTransaction` 流水 |

---

<a id="platform-4"></a>

#### 三层架构

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

<a id="platform-5"></a>

##### PricingService

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

<a id="platform-6"></a>

##### BillingService

管理 `billing_records` 记录生命周期，提供查询和汇总能力。

<a id="platform-7"></a>

##### WalletService

管理 API Client 级别的钱包，提供原子余额操作。

---

<a id="platform-8"></a>

#### 计费策略

<a id="platform-9"></a>

##### 策略类型

由 `api_clients` 集合中的 `billingPolicy` 字段决定：

| 策略 | 说明 | 行为 |
|------|------|------|
| **exempt** | 豁免 | 跳过所有计费逻辑，不写入 `billing_records` |
| **external** | 外部计费 | 仅记录用量和费用，不操作钱包（由外部系统结算） |
| **internal** | 内部计费 | 完整的 Pricing → Billing → Wallet 链路 |

<a id="platform-10"></a>

##### 策略分发

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

<a id="platform-11"></a>

#### 计费生命周期

<a id="platform-12"></a>

##### 状态流转

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

<a id="platform-13"></a>

##### 关键调用点

| 时机 | 调用 | 说明 |
|------|------|------|
| 任务创建 | `BillingAdapter.initBilling()` | 创建记录 + 预扣（internal） |
| 任务成功 | `BillingAdapter.settle()` | 计算实际费用 + 结算 |
| 任务失败 | `BillingAdapter.refund()` | 解冻预扣金额 |
| 退款失败 | 指数退避重试（3 次） | 保证最终一致性 |

<a id="platform-14"></a>

##### 幂等保障

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

<a id="platform-15"></a>

#### 钱包系统

<a id="platform-16"></a>

##### 原子操作

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

<a id="platform-17"></a>

##### 钱包操作

| 操作 | 说明 | 余额变化 | 冻结变化 |
|------|------|---------|---------|
| `freeze()` | 预扣（任务创建时） | -amount | +amount |
| `unfreeze()` | 解冻（任务失败退款） | +amount | -amount |
| `debit()` | 实际扣费（任务成功结算） | 不变 | -amount |
| `credit()` | 充值 | +amount | 不变 |

<a id="platform-18"></a>

##### 低余额告警

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

<a id="platform-19"></a>

#### API 参考

> 需管理后台 JWT 鉴权

<a id="platform-20"></a>

##### 计费记录

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/admin/billing/records` | `billing:read` | 计费记录列表（分页） |
| GET | `/api/v1/admin/billing/summary` | `billing:read` | 费用汇总（按模型/API Key/日期） |
| GET | `/api/v1/admin/billing/today` | `billing:read` | 今日费用概览 |

<a id="platform-21"></a>

##### 钱包管理

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/admin/billing/wallets` | `billing:read` | 钱包列表 |
| POST | `/api/v1/admin/billing/wallets/:clientId/credit` | `billing:write` | 充值 |
| POST | `/api/v1/admin/billing/wallets/:clientId/adjust` | `billing:write` | 手工调账 |

---

<a id="platform-22"></a>

#### MongoDB Schema

<a id="platform-23"></a>

##### billing_records 集合

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

<a id="platform-24"></a>

##### wallets 集合

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

<a id="platform-25"></a>

##### wallet_transactions 集合

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

<a id="platform-26"></a>

#### 事务与历史账单

资金写入现要求 MongoDB 副本集或分片集群，余额、流水、账单共用事务，单机拒绝写入；详见 [资金一致性](#platform)。新账单保留定价快照，历史缺快照时只能展示当前参考估算，不能冒充历史实际成本。短剧可信 maxCharge 限制用户授权扣费，普通用户 metadata 不能覆盖该上限。


<a id="platform-27"></a>

### 通知投递

---


<a id="platform-28"></a>

#### 概述

通知系统提供基于规则的事件驱动通知能力，支持多渠道投递（企业微信、邮件、站内信），并内置限流与冷却机制防止告警风暴。

<a id="platform-29"></a>

##### 核心特性

| 特性 | 说明 |
|------|------|
| **规则匹配** | 基于事件类型、严重级别、Provider 等条件匹配通知规则 |
| **多渠道投递** | 企业微信（WeCom）、邮件（Email）、站内信（In-App） |
| **限流保护** | 每条规则独立的冷却时间和滑动窗口限流 |
| **队列化处理** | 通过 Bull 队列异步投递，失败自动重试 |
| **事件驱动** | 监听 `EventEmitter2` 系统事件，自动触发通知 |

---

<a id="platform-30"></a>

#### 架构设计

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

<a id="platform-31"></a>

##### 组件职责

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

<a id="platform-32"></a>

#### 通知规则

<a id="platform-33"></a>

##### 规则结构

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

<a id="platform-34"></a>

##### 规则匹配逻辑

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

<a id="platform-35"></a>

#### 通知渠道

<a id="platform-36"></a>

##### 企业微信（WeCom）

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

<a id="platform-37"></a>

##### 邮件（Email）

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

<a id="platform-38"></a>

##### 站内信（In-App）

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

<a id="platform-39"></a>

#### 限流与冷却

<a id="platform-40"></a>

##### 冷却时间

每条规则独立配置 `cooldownMs`。在冷却期内，同一规则的重复事件将被静默丢弃。

```
事件 A → 规则 1 匹配 → 投递 → 记录 lastSentAt
事件 B（5 秒后）→ 规则 1 匹配 → cooldownMs=60000 → 丢弃
事件 C（61 秒后）→ 规则 1 匹配 → 冷却已过 → 投递
```

<a id="platform-41"></a>

##### 滑动窗口限流

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

<a id="platform-42"></a>

#### 系统事件

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

<a id="platform-43"></a>

#### API 参考

> 需管理后台 JWT 鉴权

<a id="platform-44"></a>

##### 通知规则管理

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/admin/notification-rules` | `notification:read` | 规则列表 |
| POST | `/api/v1/admin/notification-rules` | `notification:create` | 创建规则 |
| PUT | `/api/v1/admin/notification-rules/:id` | `notification:update` | 更新规则 |
| DELETE | `/api/v1/admin/notification-rules/:id` | `notification:delete` | 删除规则 |

<a id="platform-45"></a>

##### 通知记录查询

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/admin/notification-records` | `notification:read` | 投递记录列表 |

<a id="platform-46"></a>

##### 站内信管理

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/admin/notifications` | `notification:read` | 站内信列表 |
| PUT | `/api/v1/admin/notifications/:id/read` | `notification:read` | 标记已读 |

---

<a id="platform-47"></a>

#### MongoDB Schema

<a id="platform-48"></a>

##### notification_rules 集合

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

<a id="platform-49"></a>

##### notification_records 集合

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

<a id="platform-50"></a>

##### in_app_notifications 集合

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

<a id="platform-51"></a>

#### 渠道确认与失败处理

系统事件统一通过 SystemEventsModule 启用通配匹配。企业微信只有 HTTP 200 且 errcode=0 才成功；SMTP 部分拒绝记录失败并避免向全部地址重复投递。渠道异常也写失败记录，超时有上限，凭证、Webhook 与收件地址不进入错误详情。隔离回归使用本机 HTTP/SMTP 与独立数据库/队列，实际渠道投递须分别验收。

2026-11-05 通知可靠性修复：滑动窗口的清理、计数、准入和 TTL 通过单次 Redis Lua 完成，并使用 Redis 服务端时间；限流状态不可用时拒绝准入并记录错误，避免绕过上限。每次投递先把记录 ID 与准备阶段保存到 Bull 作业，再持久化 pending 审计记录，成功后才能发送。渠道结果先保存为作业回执，再更新同一条审计记录；审计写库失败使作业重试或失败，重试只补写结果，不重复调用渠道。审计记录保留 queueName/queueJobId 以定位原作业。重试耗尽后保留 pending 记录和失败作业回执，恢复数据库后在现有失败作业保留期内重试原作业；不得复制新作业来补写记录。默认失败作业保留 24 小时，需及时处理或归档回执。

若 Worker 在发送中断开、未能保存渠道回执，再次处理时标记 unknown（结果待核验）并停止自动重发；后台支持筛选 pending/unknown。外部渠道执行和 Redis/MongoDB 不能构成一个事务，无法据此承诺外部精确一次投递；unknown 可能已经发送或尚未发送，需要按渠道证据人工核验。渠道返回明确可重试失败且该次审计已落库后，才开始下一次渠道尝试。上线应同步更新通知消费者，避免旧 Worker 忽略新检查点。2026-11-05 后续运行验收已完成后端整体构建、实际数据库事务检查及四个后端进程统一更新；先停止全部旧消费者再启动新进程，门户保持原进程。更新前队列均无等待/活动/延迟作业，仅站内通知规则启用。实际消费者验证了正常站内投递、预置回执仅补写审计、预置 sending 检查点转 unknown，未重复生成站内消息；200 个并发准入仅放行配置的 7 个。测试作业、3 条审计记录和 1 条站内消息已按独立测试标记清理，未向邮件/企业微信发送通知。API 与管理后台就绪检查均为 200，Worker/Scheduler 接口可访问，四个 PM2 进程持续在线。资金只读核对仍有 2 条无任务账单、1 个超时任务，保留历史状态，不自动退款或修改。运行证据保存在忽略目录 output/verification/notification-live-acceptance-2026-11-05.json 与 notification-activation-processes-2026-11-05.json。



<a id="platform-52"></a>

### 健康度与熔断

---


<a id="platform-53"></a>

#### 概述

供应商健康度模块实现了经典的三态熔断器模式（CLOSED / OPEN / HALF_OPEN），用于保护系统免受供应商 API 故障的级联影响。

<a id="platform-54"></a>

##### 核心特性

| 特性 | 说明 |
|------|------|
| **三态熔断器** | CLOSED → OPEN → HALF_OPEN → CLOSED 状态机 |
| **Redis 状态存储** | 多实例共享状态，Lua CAS 原子操作 |
| **滑动窗口指标** | 5 分钟窗口内成功率、错误率、平均延迟 |
| **手动覆盖** | 管理员可强制打开/关闭熔断器 |
| **Prometheus 集成** | 状态转换自动更新 Prometheus Gauge |

---

<a id="platform-55"></a>

#### 熔断器设计

<a id="platform-56"></a>

##### 状态机

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

<a id="platform-57"></a>

##### 状态说明

| 状态 | 行为 | 转换条件 |
|------|------|---------|
| **CLOSED** | 正常放行所有请求 | 连续失败次数或错误率超过阈值 → OPEN |
| **OPEN** | 拒绝所有请求 | 冷却时间到达 → HALF_OPEN |
| **HALF_OPEN** | 放行有限探测请求 | 探测成功 → CLOSED；探测失败 → OPEN |

<a id="platform-58"></a>

##### 关键参数

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

<a id="platform-59"></a>

#### 健康指标采集

<a id="platform-60"></a>

##### 滑动窗口

`HealthMetricsCollector` 使用 Redis Sorted Set 实现 5 分钟滑动窗口：

```
Key: health:window:{provider}
Score: timestamp
Member: JSON-encoded CallOutcome
```

<a id="platform-61"></a>

##### 采集指标

| 指标 | 说明 |
|------|------|
| **成功率** | `successCount / totalCount` |
| **错误率** | `failCount / totalCount` |
| **平均延迟** | 窗口内所有调用的平均延迟 |
| **样本数** | 窗口内总调用次数 |

<a id="platform-62"></a>

##### 最小样本保护

当样本数低于 `minSamples`（默认 10）时，指标被视为无效，不触发熔断。避免在低流量时因偶发错误误触发。

---

<a id="platform-63"></a>

#### 状态管理

<a id="platform-64"></a>

##### Redis 存储

```
Key:   circuit:provider:{providerName}
Value: JSON { state, consecutiveFailures, lastStateChange, overrideState }
TTL:   可配置
```

<a id="platform-65"></a>

##### 原子状态转换

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

<a id="platform-66"></a>

##### 本地缓存

`CircuitBreakerStore` 维护 1 秒的本地内存缓存，减少 Redis 访问：

```
请求 → 本地缓存（1s TTL）→ 缓存命中？→ 返回
                         → 缓存未命中 → Redis 读取 → 更新缓存
```

---

<a id="platform-67"></a>

#### 与通知系统集成

熔断器状态转换自动发射事件，由通知系统监听并投递：

| 事件 | 严重级别 | 触发时机 |
|------|---------|---------|
| `system.provider_circuit_open` | CRITICAL | 熔断器打开（Provider 不可用） |
| `system.provider_circuit_half_open` | WARNING | 熔断器半开（开始探测） |
| `system.provider_circuit_closed` | INFO | 熔断器恢复（Provider 恢复） |

---

<a id="platform-68"></a>

#### 管理接口

<a id="platform-69"></a>

##### Prometheus 指标

```
modelhub_circuit_breaker_state{provider="wavespeed-ai"} 0  # 0=CLOSED, 1=OPEN, 2=HALF_OPEN
modelhub_health_success_rate{provider="wavespeed-ai"} 0.95
modelhub_health_error_rate{provider="wavespeed-ai"} 0.05
modelhub_health_avg_latency_ms{provider="wavespeed-ai"} 450
```

<a id="platform-70"></a>

##### 管理端 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/admin/provider-health` | 所有 Provider 健康状态 |
| POST | `/api/v1/admin/provider-health/:provider/override` | 手动覆盖熔断状态 |
| DELETE | `/api/v1/admin/provider-health/:provider/override` | 清除手动覆盖 |

<a id="platform-71"></a>

##### 手动覆盖

管理员可强制设置熔断器状态：

```json
POST /api/v1/admin/provider-health/wavespeed-ai/override
{
  "state": "OPEN",
  "reason": "厂商维护窗口，手动熔断"
}
```

手动覆盖后，自动状态转换暂停，直到管理员清除覆盖。

<a id="platform-72"></a>

#### 列表来源与刷新

管理端每 10 秒刷新，支持暂停、隐藏页暂停与错误重试。总览按当前数据库配置且已注册的供应商读取指标和状态，Redis 中已删除供应商的历史键不再决定列表。零样本不伪造成功率、延迟或转换时间；CLOSED 只表示熔断器未打开。手动覆盖需原因、有效期及相应权限。


<a id="platform-73"></a>

### 资金事务与媒体校验

资金写入要求 MongoDB 副本集或分片集群，并提供可信媒体探测器。请针对当前配置与运行进程检查，历史验收记录不代表现时部署状态。

<a id="platform-74"></a>

#### 资金一致性

- 预扣、结算、退款使用同一个 MongoDB session/transaction，覆盖钱包余额与冻结额、钱包流水、账单状态；独立充值也使用事务。
- 流水写入失败会向上传播并回滚，不能出现余额已变但流水丢失。状态更新失败同样回滚解冻、扣款。
- MongoDB 驱动处理瞬时写冲突与提交结果不确定时的重试；按任务保留释放、扣款、充值的幂等凭证，结算与退款竞争只接受一个终态。
- 扣费不足时回滚整个结算，保留原冻结和待结算账单；不会先释放冻结再把账单标为失败。
- 低余额通知在事务提交后发出。单机数据库的资金写入明确返回 503，不降级到非事务写入。
- 就绪探针检查事务能力与媒体检测器；系统信息页显示两项状态。

隔离测试使用临时 MongoDB 副本集，覆盖流水/账单故障、退款回滚、并发结算与退款、重复扣费和充值、提交连接中断、写入进程在提交前被杀，以及单机数据库拒绝写入。测试不操作应用的真实钱包和账单。

事务保证本地资金文档一致性；供应商远程执行与本地数据库、任务队列之间仍不是分布式事务。既有历史异常账单也不会因代码更新自动修正。

<a id="platform-75"></a>

#### 媒体校验

- 创建任务时先校验普通参数，再下载并读取真实媒体；通过后才初始化计费、写任务及入队。
- 图片/视频宽高、短边与长边、宽高比，音视频单文件时长、同字段素材总时长，固定输出时长加输入时长上限均可强制校验。
- 格式依据文件签名和 FFprobe 流信息判定，大小依据实际下载字节；不相信扩展名、HTTP Content-Type、Content-Length 或客户端填写的元数据。损坏文件或缺失元数据直接拒绝。
- 自定义输出尺寸检查边长、总像素和宽高比。混合素材数量规则支持 paramMap，并校验最低总数量。
- 下载限制公开 HTTP(S) IPv4、80/443 端口；解析并固定公网地址，每次重定向重新检查，限制重定向、字节数、DNS/下载/探测时间；临时文件结束后清理。私网、回环及云元数据地址不能访问。
- 检测器通过 `@ffprobe-installer/ffprobe` 安装；可用 `MEDIA_FFPROBE_PATH` 指向部署环境维护的 FFprobe，兼容 `DRAMA_FFPROBE_PATH`。未配置或不可运行时返回 503。
- `skipValidation` 不会绕过真实媒体检查。含外部引用的播放清单在运行检测器前拒绝。

源数据中明确的约束已转换为 `params.<field>.media` 和 `sizeRules`；`addToOutDuration` 等语义不明确的旧元数据继续留档，不擅自解释成新限制。普通办公文档的页数与分镜脚本的语义检查不属于媒体文件尺寸/时长校验。

<a id="platform-76"></a>

#### 模型约束回填

`scripts/backfill-media-constraints.cjs` 默认预览，显式 `--apply` 才写入。更新时比较原参数、规则和 revision，不覆盖价格或启停状态。真实备份保存在 Git 忽略的 logs/ 中，不能作为测试产物删除。未知语义不自动转换。

<a id="platform-77"></a>

#### 验证与启用

部署前确认实际连接的是目标数据库，`hello` 能确认副本集/分片集群且支持会话，再执行只读事务检查。单纯向 URI 增加 replicaSet 参数不会改造数据库。

在队列安全窗口发布并统一加载 API、Worker、Scheduler 和管理端；检查 `/health/readiness` 的 moneyTransactions 与 mediaValidation 均为 up，再验证资金和媒体请求。构建通过、历史回填完成不等于当前运行进程已启用。

回归入口：`src/billing/money-transaction.integration.spec.ts`、`src/billing/billing-init-failure.spec.ts`、`src/billing/reconciliation.spec.ts`、`src/metadata/media-input-validator.spec.ts`、`src/task/media-validation.spec.ts`。媒体输入夹具位于 `src/metadata/fixtures/`，属于必要测试资源。

历史环境切换的注意事项见 [运行前提](technical.md#deployment)。

<a id="platform-78"></a>

### 认证与工作流安全合同

用户 authVersion 与 refresh token 的认证快照绑定。密码修改/重置原子递增版本；登录、注册、刷新和签发路径都需检查版本与账号状态，避免旧请求在重置后得到可续期会话。撤销清理失败不能恢复旧令牌，新版本会话不被旧版本清理误伤；access token 保持原自然到期语义。

旧索引迁移允许首次集合不存在与并发实例已删除索引，真实网络/权限/存储异常仍失败。编辑器切换工作流后隔离历史、重试及迟到响应；切模型仅保留合法旧值并补齐新默认值。loop last 的版本化输出保持既有 value 端口语义。素材元数据异常经过全局日志后也必须脱敏，不能自动删除历史对象。

并发回归使用可控 Promise 屏障，覆盖密码变更与签发交错、会话清理失败、索引并发、跨图响应和敏感异常。测试入口为 `src/portal-auth/portal-auth-version.spec.ts`、`portal-auth.service.spec.ts` 与 `src/workflow/__tests__/`；测试替身不代替实际 MongoDB 多实例和浏览器验收。

<a id="providers"></a>

## 供应商接入


接入协议与平台公开协议分别维护；供应商参数、账号、价格及修订号须按当前环境确认。

<a id="providers-1"></a>

### LLM 与 OpenAPI 配音

<a id="providers-2"></a>

#### 配置入口与初始化

- 后台 → 模型配置：新增「MaaS LLM · 编剧」「AKOOL OpenAPI · TTS」预设。参数、上游模型名、价格、禁用状态与其他模型共用 Mongo 模型配置、草稿/发布和版本机制。
- 预设为 `DeepSeek-V4-Flash`（`akool-maas`、`textGenerate`）与 `akool-voicelab-tts`（`akool-openapi`、`tts`）；初始化以禁用、无价格状态补缺，实际状态以当前配置为准。
- 后台 → 供应商配置：配置 `akool-openapi`；Base URL 为 `https://openapi.akool.com`。API Key 仅通过现有账号池配置，不写入前端或模型参数。
- 初始化脚本 `node scripts/seed-language-models.cjs` 默认只预览；`--apply` 仅补缺失记录，保留已有配置、价格、状态和凭证。不会生成任务。

<a id="providers-3"></a>

#### 管理员启用步骤

1. 在 `akool-maas` 供应商编辑页配置环境对应的 **LLM Base URL**，以 `/v1` 结尾；已有 FAT 文档对应 `https://llm-fat.akool.io/v1`。沿用该供应商账号池，媒体 Base URL 不受影响。
2. 在 `akool-openapi` 的账号池中填写独立的有效 OpenAPI API Key 并启用账号，再启用供应商。请求使用 `x-api-key`。
3. 编辑两个禁用模型：LLM 价格填**每 Token**；TTS 价格填**每字符**。`default` 中补全 `unit_credit`（Portal 积分）、`sale_unit_price`（销售单价）和 `cost_unit_price`（成本）。每千 Token/字符报价须先除以 1000，供应商 credits 不等于 Portal 积分。
4. 保存/发布并启用模型；普通更新、发布和快速启用均校验价格。未定价时允许保存禁用配置，不允许启用。
5. 短剧 → 制作方案按能力选择模型：图片/视频保留 MaaS，编剧使用 LLM，旁白选择 OpenAPI；也可直接在配音窗口选择明确标有供应商的配音配置。选择保存到作品，不自动切换其他能力的供应商。
6. 在配音窗口选择官方音色、试听已有示例，调整语速/情绪/音量/语言，再查看消耗并确认生成。编剧结果需人工检查后应用。

<a id="providers-4"></a>

#### 协议与业务行为

- MaaS LLM：隐藏并限制协议为 `chat-completions`，独立 LLM 地址，非流式请求，完整保留文本、结束原因和 token 用量；通过现有任务、计费、预算和剧本审核流程处理。
- VoiceLab v4：只读官方音色分页、音色详情校验、异步 TTS 提交和结果轮询；当前预设使用 **Akool Multilingual 3**。不包含声音克隆、声音转换和口型生成。
- 音色选项携带账号归属和上游音色标识，服务端再次核实音色详情。任务轮询固定到原账号，原账号不可用时不换其他密钥查询。
- 配音文本来自镜头旁白，不接受参数覆盖镜头文字。参数随作品保存；文本、模型、供应商或音色设置变更会使旧候选标记需复查，保留已有结果。
- 按 Unicode code point 数量计算字符用量（含空格、标点）。预估、公开价格计算和结算一致；结算读取创建时保存的字符用量，避免供应商时长、客户端数量或后续价格修改影响原任务。
- 任务成功返回标准 `audio` URL，接入现有候选预览、手动选用、音频归档和 FFmpeg 成片流程。供应商资源有效期有限，长期使用应检查归档状态。
- 音色列表和详情的只读查询遇到网络/429/5xx 异常，固定原账号最多尝试两次，每次 6 秒超时；耗尽后提示尚未提交配音生成。认证失败不重试。付费 POST 的超时/5xx 不自动重提。供应商未文档化取消与幂等保证，因此无法承诺上游严格 exactly-once；提交结果不明时需核对上游任务。候选中提供明确错误指引。

官方协议依据：[VoiceLab](https://docs.akool.com/ai-tools-suite/voiceLab)、[MaaS LLM](https://maas-fat.akool.io/docs/llm)。Portal 价格始终来自后台配置，不从文档猜测或硬编码。


<a id="providers-5"></a>

#### 地址与并发编辑

LLM 地址要求 HTTPS、以 `/v1` 结尾，不含凭证、query 或 hash。OpenAPI 支持根地址及 `/api` 前缀，接口拼接避免重复 `/api/api/`，不能将具体业务接口当 Base URL。

供应商表单从最新详情读取字段与 revision。409 后做原始值/当前输入/服务器值三方比较；无冲突时保留输入并提示核对再保存，同字段冲突则阻止覆盖，允许放弃修改并加载最新配置。不会自动重试写入。

<a id="providers-6"></a>

#### 短剧使用

模板仅在某能力恰好一个兼容配置时带入；多个可选配置交由用户选择。创建模板不执行生成。配音文字取镜头旁白，官方音色附带账号归属；翻页保留选择，本页搜索不承诺搜索全部音色。非中文情绪按协议约束不提交。

制作方案可刷新能力列表。先报价，再由用户确认；超过项目可用预算时禁止提交，服务端继续原子校验。缺少作品/钱包/预算时返回明确阻塞，不能视为零消费。

<a id="providers-7"></a>

#### 检查与回归

```powershell
node scripts/inspect-language-readiness.cjs
npx jest --runInBand --runTestsByPath src/provider/adapters/akool-maas.adapter.spec.ts src/provider/adapters/akool-openapi.adapter.spec.ts src/admin/language-model-config.spec.ts
```

只读检查脚本读取实际应用配置，不输出密钥、不提交付费模型任务。协议测试使用本机模拟供应商；真实编剧质量、中文音色、音频归档、成片音画和实际费用须用有效配置分别验收。历史环境问题与预算单位检查见 [运行前提](technical.md#deployment)。

契约样本见 [LLM 测试夹具](../src/common/fixtures/maas-llm.contract.json)。


<a id="providers-8"></a>

### Seedance 2.5 MaaS

本文维护接入协议、离线配置与验收命令。真实生成、供应商幂等和账单核对须在有效环境与明确预算下验收。

<a id="providers-9"></a>

#### 已实现

- 独立 `akool-maas` Adapter，使用账号池 Bearer Key；不修改直连火山 Ark 的 `seedance` Adapter。
- 供应商 API base 必须显式配置为包含 `/api/v1` 的地址。参考 FAT 为 `https://maas-fat.akool.io/api/v1`，不得把 model-hub 自身地址误配成供应商地址造成循环调用。
- POST `/run/{encodeURIComponent(provider_model_name)}`，请求只包含 `{ input }`；多媒体数组、布尔 false、seed=-1 和 duration=-1 原样保留。
- 使用固定的 model-hub taskId 作为供应商 `Idempotency-Key` 和 `X-Client-Reference`；队列重试复用该标识。真实渠道幂等行为仍需 FAT 验证。
- GET `/run/tasks/{task_uuid}`；pending/processing/completed/failed/cancelled 映射到本平台状态，保存 output 与 error_message。
- 注册厂商限流与队列。默认并发 2、每秒 1 次是保守的本地配置，可在后台调整，不代表供应商配额。
- 上游 cancelled 终止轮询并调用退款；钱包解冻抛出异常且重试耗尽时会向上传递，不再继续标记 refunded。该取消分支遇到退款异常时保持可轮询状态。
- 未公开上游取消接口，因此该渠道已提交任务拒绝本地取消，避免让用户误认为供应商已停止执行。

<a id="providers-10"></a>

#### 配置准备

`seedance25-maas.contract.json` 是从参考站 API 参数表整理的**无价格、默认禁用**契约片段，不能直接创建完整模型。

```powershell
node scripts/prepare-seedance25-maas.cjs
```

该命令离线校验契约，并明确报告 `import_ready=false`。准备实际价格文件，键为 `default`、`480p`、`720p`、`1080p`、`480p:video`、`720p:video`，每个值都必须包含 `cost_unit_price`（>=0）、`sale_unit_price`（>0）、`unit_credit`（>0）。脚本根据分辨率枚举和条件价格规则检查所有档位。已有本机禁用配置另存于 `seedance25-maas-fat-baseline.json`，仅包含有既有价格来源的 480p/720p；不能用其价格推算 1080p。

```powershell
node scripts/prepare-seedance25-maas.cjs --pricing <实际价格文件> --out <新配置文件>
```

输出始终 `disabled=true`，且拒绝覆盖已有文件。通过后台创建模型，或把契约字段合入已有配置草稿后发布。已有模型保留自己的价格、展示与访问设置，不运行全量 seed 覆盖。发布/启用前检查返回的配置 ID 与版本。

将来需要启用真实生成时，在后台账号池填写该环境的 Key；本次结构交付无需此项。不把 Key 写入契约、仓库或聊天。多账号是否属于同一可见任务空间，须实际确认。

<a id="providers-11"></a>

#### 联调命令

`MODEL_HUB_API_BASE` 是**待验收的 model-hub** API 前缀，经过门户代理时通常含 `/api/v1`，直连 Nest 服务时通常含 `/v1`。它不是上面的 MaaS 供应商 API base。

先设置目标后执行只读目录检查，不需要 API Key，也不生成视频：

```powershell
$env:MODEL_HUB_API_BASE = 'https://<model-hub-fat-host>/api/v1'
node scripts/smoke-seedance25-maas.cjs
```

确认价格与测试预算后，在进程环境设置 `MODEL_HUB_API_KEY`、稳定的 `MODEL_HUB_IDEMPOTENCY_KEY`。Key 不经参数传入、不打印。输入文件只放模型 `input` 对象，使用可公开访问且获准使用的素材 URL；先测固定 5 秒、720p。

```powershell
node scripts/smoke-seedance25-maas.cjs --run --input <测试输入JSON> --max-estimated-credits <预估费用上限>
```

只有 `--run` 才会创建任务，且必须提供固定时长和预估费用上限；这不是供应商最终费用硬上限。脚本本地校验参数，绑定 configId/configRevision，检查对应分辨率价格，随后创建一次并轮询。成功要求输出及 settled 账单，默认最多等 900 秒。超时或断线不会自动重建任务，保留 taskId 后可继续检查：

```powershell
node scripts/smoke-seedance25-maas.cjs --task-id <已有taskId>
node scripts/smoke-seedance25-maas.cjs --task-id <供应商失败taskId> --expect FAILED
node scripts/smoke-seedance25-maas.cjs --task-id <供应商取消taskId> --expect CANCELLED
```

失败/取消验收要求账单 refunded。请使用正常内部计费测试 Key；免计费 Key 不适用于账单验收。脚本日志不包含 Key、提示词和素材 URL。

<a id="providers-12"></a>

#### 必须在真实 FAT 验证的事项

| 项目 | 验收证据 |
|---|---|
| 门户文件上传 | 登录后上传至现有存储，供应商可读取 URL；图片/视频/音频分别检查 |
| 普通参考生成 | 创建、轮询、结果预览；供应商与本站 taskId 对应 |
| 多模态与模式 | 三类数组、引用顺序、edit/extend 参数及实际视频时长限制 |
| 价格及账单 | 平台预冻结、实际解冻与扣费、失败退款；与供应商 amount 分开核对 |
| 自动时长 | 捕获真实 output/meta_info 用量，确认有效秒数来源；当前无有效秒数时回退 30 秒预冻结用量，不能声称按实际秒数完成验收 |
| 渠道限制 | API 表列 1080p，正文只列 480p/720p；普通视频 4–15 秒与 edit 4–30 秒说明有差异，须实测 |
| 重试与并发 | 同一幂等标识不重复生成、账号池任务可见性、限流/429/5xx 恢复 |
| 钱包边界 | 资金写入要求 MongoDB 副本集或分片集群；本地事务回归不能替代供应商执行结果与实际账务核对 |

参考来源：2026-10-25 读取的 [模型 API 参数表及生命周期](https://maas-fat.akool.io/router/doubao/seedance-2-5/reference-to-video#api) 和 [模型说明](https://maas-fat.akool.io/router/doubao/seedance-2-5/reference-to-video#docs)。正文列出的火山估算价不作为本系统实际成本或售价。


<a id="providers-13"></a>

#### 契约与回归

测试契约与历史价格基线位于 [测试夹具](../src/common/fixtures)，基线只用于回归，不是生产定价。执行 `node --test scripts/seedance25-maas.test.cjs` 与 `npx jest --runInBand --runTestsByPath src/common/utils/seedance25-maas-contract.spec.ts`。
