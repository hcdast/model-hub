# 提交前六项审查问题修复设计

> 2026-10-14 更新：用户已要求将当前 `dev` 分支改动分批提交。以下第 1–16 节保留 2026-09-24 的设计与审查快照，其中“等待批准”“未提交”等描述属于当时状态。
>
> 当前源码已包含认证版本及密码原子更新、旧索引迁移幂等处理、历史记录归属隔离、参数默认值兼容、loop last value 端口兼容和素材元数据异常脱敏。提交前检查修正了仍使用旧 `save()` 合同的密码重置测试，并新增认证并发回归：旧登录/刷新/注册请求在重置后签发的令牌被拒绝；新密码登录不被旧版本清理撤销；清理失败仍拒绝旧令牌；并发密码修改不能覆盖管理员重置；首次启动与并发索引删除可接受，而存储故障继续失败。
>
> 本轮验证：原有 6 个管理后台/工作流相关套件通过；更新后的认证 2 个套件共 29 项测试通过。后端与 Dashboard 的 `npm run build:all`、Portal 的 `npm run build` 均通过，前端仅有大 chunk 提示。认证并发测试使用可控 Promise 与隔离内存存储替身；本轮未验证真实 MongoDB 并发持久化，也未执行浏览器历史切图验收或独立代码复审，不将历史设计审查 PASS 当作本轮实现审查结论。
>
> 本次授权范围为本地提交。生产认证进程切换、MinIO 匿名读取与权限设置、收费模型执行继续按实际部署流程单独处理。

## 1. 状态、背景与授权

- 日期：2026-09-24。
- 用户已授权编写本设计；尚未批准实施。本文件不是实现完成记录。
- 用户此前授权 commit、不授权 push。当前 Review 为 BLOCKED；修复与复审通过前不提交。
- 本次完整静态审查发现 3 项 High、3 项 Medium；发现基于代码和异步交错分析，尚未动态复现。
- 已有验证：7 个后端套件、157 项测试及后端构建通过；Portal、Dashboard 构建通过，有 chunk 大小警告。它们不覆盖此次发现的全部边界。

## 2. 目标与验收范围

| 编号 | 级别 | 当前证据位置 | 目标 |
|---|---|---|---|
| R1 | High | portal-auth.service.ts:389–393、246–286 | 重置密码后，旧认证快照签发的 refresh token 不能继续刷新 |
| R2 | High | portal-auth.service.ts:76–88 | 旧索引迁移支持首次启动与多进程并发，真正存储故障仍阻止启动 |
| R3 | High | WorkflowEditor.tsx:146–158、393–401 | 切图后不能显示或重试另一张图的历史记录 |
| R4 | Medium | model-params.util.ts:90–99 | 只保留兼容旧参数，不丢失新模型合法默认值 |
| R5 | Medium | workflow-ports.ts:50–57 | loop last 的版本化输出保留旧 value 端口的已支持语义 |
| R6 | Medium | workflow-asset.service.ts:123–125 | 素材元数据失败不得把原始数据库异常传入全局日志 |

行号为审查时快照，实施定位以符号为准。

## 3. 非目标

- 不改变现有 access token 的自然到期合同，不增加逐请求会话版本查询，不承诺重置密码立即撤销已签发的 access token。
- 不改 Portal API Key、钱包、供应商计费、角色模型或冻结/解冻策略。
- 不修复全部既有认证问题，不另建分布式锁、会话服务或通用迁移框架。
- 不修改 bucket policy、不删除 MinIO 对象、不调用收费模型。
- 不处理静态审查额外指出的既有“工作流加载失败后空图可保存”风险；该问题单独记录，不能据本设计宣称已修复。
- 不手工修改 dist/，不提交 .env、.claude 本地设置或审查临时文件。

## 4. 当前实现与问题分析

### 4.1 会话撤销

PortalUser 当前没有认证版本字段；PortalRefreshToken 保存 tokenId、secretHash、familyId、isValid 等，但没有绑定密码状态。resetPassword 先保存新 passwordHash，再 updateMany 撤销已有 token。

存在交错：refresh 读取有效旧 token 和用户 → resetPassword 保存密码并完成 updateMany → refresh 插入 isValid=true 的 replacement。旧密码登录在密码校验成功后尚未签发时也存在同类问题。多次扫描 token 或仅在签发前重读用户不能消除最后一次检查后的竞争窗口。

### 4.2 其他问题

- onModuleInit 先读索引再删除，未处理其他进程已删除的结果。
- 编辑器路由 id 变化时未隔离历史列表；历史请求失败时旧列表仍可操作。
- compatibleParams 先用旧值覆盖默认值，校验失败后直接删除。
- loop last 已增加版本化 envelope，但 value 读取没有对应解包语义。
- assets.create 错误被原样抛出，GlobalExceptionFilter/ErrorLogger 可记录原始 message/stack；局部安全日志并不能保护下游日志。

## 5. R1：持久化认证版本

### 5.1 数据模型与不变量

新增内部字段：

| 集合 | 字段 | 写入及读取合同 |
|---|---|---|
| portal_users | authVersion: number | 非负安全整数；新用户显式初始化为 0；旧用户缺字段仅在服务端解释为 0 |
| portal_refresh_tokens | authVersion: number | 每次签发必须显式写入认证快照版本；不设置默认值；存量缺字段 token 明确拒绝 |

关键不变量：一个 refresh token 只有在其 authVersion 与当前用户版本相等，且原有 hash、有效性、期限、用户状态检查全部通过时才可刷新。

不要给 token 字段添加会在 Mongoose hydration 时填补缺失值的 default，否则无法可靠区分旧 token。非法类型、负数、非安全整数均失败关闭。

版本不是秘密，不包含 passwordHash；不添加到公开用户响应、JWT payload、管理列表或日志。本次不需要新索引，版本比较以现有用户 _id 查询为基础。

### 5.2 密码修改的原子边界

- resetPassword 使用单次用户文档原子更新，同时写入新 passwordHash 并 $inc authVersion，返回更新后的版本。缺字段的旧用户通过 $inc 从 0 进入 1。
- 保留严格 ObjectId 校验、软删除过滤、bcrypt 和随机临时密码生成。
- changePassword 同样使用这条版本边界；它修改相同密码状态，不能留下第二条不递增版本的写路径。条件还须包含完成旧密码验证时的 passwordHash，避免并发重置后用旧密码校验快照覆盖新密码；不匹配返回明确冲突，不自动重试。
- 两次并发管理员重置仍可能最后一次生效；不承诺两次返回的临时密码都可登录。每次成功写入必须推进版本，不能用 read+set 代替原子递增。
- token 批量撤销作为记录清理：只撤销该用户缺版本或版本小于本次新版本的 token，不能无条件撤销重置后新密码登录产生的同版本/更高版本 token。
- 清理失败不得回退密码或版本，不返回成功密码；保留当前操作失败语义，错误须脱敏。新版本一旦写入，旧 token 已因版本不匹配失去刷新能力，安全性不依赖清理成功。

### 5.3 签发与刷新

- 注册使用创建用户时的版本。
- 注册的签发后版本/状态检查必须置于现有 createRefreshToken 创建失败补偿 catch 之外；并发密码重置导致版本失配时只能拒绝凭证，不能进入 register 的 deleteOne 用户补偿。增加对应交错用例，确保不会误删用户。
- 登录使用校验 passwordHash 时读取的用户版本。不得在异步密码校验后重新读取新版本并把它赋给旧认证结果。
- refresh 验证 token 的显式版本与读取的用户版本相等；replacement 继承该认证版本，不因期间用户变化而升级版本。
- createRefreshToken 增加必需版本参数；迁移全部调用点，不保留缺版本默认参数。
- 签发后、返回凭证前补一次当前用户版本/状态检查：若已变化，拒绝响应并尽力将本次精确 tokenId 标记无效；即使标记失败，版本校验仍拒绝它。存储故障不得伪装成校验成功。
- 最后一次检查与响应之间仍可能发生重置。允许在途请求返回旧版本 token，但该 token 不能用于重置之后的新刷新。不能宣称所有并发请求都必然收到 401。

### 5.4 安全保证边界

对关键交错，旧请求始终只能签发旧版本 replacement；后续刷新读取新用户版本时必然拒绝。因此不会延续旧会话的长期刷新能力。

已有或并发签发的 access token 仍遵守现有自然到期语义。若将来要求重置成功后立即拒绝全部 access token，需要单独变更 JWT/Guard 合同，不能偷偷纳入本次。

### 5.5 存量数据与上线

采用明确安全切换，不回填存量 refresh token 的版本：

1. 停止接收认证新请求，排空并停止所有旧版 PortalAuthService 进程。
2. 部署新版 schema 与服务到全部相关 API/worker 进程；禁止旧版与新版混跑。旧代码会绕过版本检查。
3. 新登录创建显式版本 token；存量无版本 token 返回 401，用户重新登录。现存 access token 保持自然到期。
4. 不删除用户、不改密码、不批量删除 token。存量记录按原 TTL 清理。
5. 文档提示“一次重新登录”，不得将服务端拒绝旧 refresh 的行为误报成账户损坏。

不能直接回滚到忽略版本的旧认证代码，否则可能重新接受数据库中仍存在的旧会话。回滚需保留版本校验修复，或另行审批离线失效会话的方案；本次不自动做破坏性回滚操作。

## 6. R2：启动迁移幂等性

仅对既有旧 token 单字段 unique 索引执行当前迁移，不增加删除范围。

- list/indexes 查询只忽略明确 NamespaceNotFound（Mongo code 26）；集合不存在时没有旧索引可删，正常结束。
- dropIndex 只忽略明确 IndexNotFound（code 27）和 NamespaceNotFound（code 26）；这是另一进程已完成迁移/集合已不存在的成功终态。
- 网络故障、认证失败、其他错误必须继续抛出，不能 catch-all 使服务假启动。
- 不使用异常 message 模糊匹配；按驱动实际 code/codeName 精确判定，测试覆盖。
- 不删除 tokenId、TTL 或其他业务索引，不增加启动上传或 bucket 操作。

## 7. R3：历史状态归属隔离

- 历史状态同时保存所属 workflowId；路由 id 变化即清空 items、total、error、页码及旧文档相关 UI 状态。
- 渲染列表要求状态所属 id 与当前路由/已加载文档一致，防止 effect 清空前的一帧显示旧记录。
- 请求捕获 workflowId 与请求代次；过期成功和失败响应都不得写入当前列表或 loading/error 状态。
- 重试操作检查当前文档已就绪、记录.workflowId 与当前图一致；不能只比较 owner 或 runId。切图或加载中禁用历史操作。
- 异步重试响应同样校验捕获的文档 id/代次，不能将 A 的 runId、监控和输出安装到 B。
- 不修改后端按 owner+runId 授权的 API，不以新增跨图权限限制掩盖前端状态错误。

## 8. R4：模型参数默认值与依赖

- 继续复用 extractDefaultParams、validateParam、resolveEnumOptions，不引入第二套参数校验。
- 以新模型有效默认值为基线，只将通过新合同校验的旧值覆盖进去；不存在/隐藏的旧参数不迁移。
- 对 enumDependsOn 先确定依赖字段的最终值，再校验依赖参数。独立于 definitions 的对象迭代顺序，非法旧依赖值回退后须重新校验依赖选项。
- 依赖按有向关系求值；检测环而非无限递归。环内不继承旧值，只考虑默认候选，并在最终候选集合中校验；无法成立则删除并由现有参数 UI 提示。
- 最终每个保留值都必须在最终参数集合中合法。不兼容旧值不应使合法默认值丢失；不擅自选择 enum 的第一个值冒充 default。
- 保留 false、0 等合法值；覆盖类型变化、范围收缩、条件枚举、缺失依赖、隐藏参数和循环依赖边界。

## 9. R5：loop last 兼容端口

保留新的版本 envelope，不退回无法区分业务对象的旧包装。

- result/output 继续返回完整 last 结果。
- 对版本 envelope 的 value 端口按旧 executor 语义映射：标量、null、数组返回 last 结果本身；非 null 且非数组的对象只有自身存在 value 且值非 undefined 时返回该属性，否则明确缺端口。
- 依据 node.executor.ts:110–113，旧执行器将 null、数组和标量包装为 { value: output }。空循环的 undefined 不得变成成功输入，继续按缺端口/缺值处理；以上边界均须回归验证。
- 继续拒绝 __proto__/constructor/prototype；不放宽任意端口，不将不存在端口默认为完整结果。
- 既有未版本化历史输出保留当前有证据的兼容路径；不修改用户业务对象的 result/output/value 字段。

## 10. R6：素材元数据异常脱敏

- 在 assets.create 的失败边界，保留安全诊断（MinIO assetId、精确 objectKey），随后抛固定消息的 ServiceUnavailableException，不携带原异常 message、stack、cause 或数据库连接信息。
- 同一素材元数据路径对 storagesvc 也不原样抛出数据库错误；不改变其上传分支配置校验或上传错误合同。
- 不调用补偿删除，不返回素材成功，不假造记录；MinIO 已上传对象可能保留，沿用原有诊断与人工处理合同。
- 测试通过真实异常过滤/日志边界观察收到的错误，不能仅断言局部 logMetadataFailure 没输出秘密。

## 11. 架构与接口变化

不新增 Nest 模块、第三方依赖或公共 API。

- 内部认证服务增加版本传递和密码原子写入；已有 service 方法外部返回格式保持不变。
- refresh 请求/响应 token 字符串格式仍为 tokenId.secret；版本只保存在数据库，不由客户端提交。
- 历史 API、retry API、素材 API 路径和响应字段不变；元数据存储故障使用脱敏 503。
- 用户 API 不返回 authVersion；dashboard 的重置提示应准确区分 refresh token 失效与 access token 自然到期。
- 参数与端口变更只修复已约定行为，不迁移图 schema。

## 12. 预计文件范围

| 文件 | 修改目的 |
|---|---|
| src/database/schemas/portal-user.schema.ts | 用户 authVersion |
| src/database/schemas/portal-refresh-token.schema.ts | 必需且无默认的 token authVersion |
| src/portal-auth/portal-auth.service.ts | 签发/刷新版本、密码原子更新、索引迁移 |
| src/portal-auth/portal-auth.service.spec.ts | 并发交错、迁移、旧 token、密码边界回归 |
| src/admin/admin-portal-user.controller.spec.ts | 如 mock 合同受影响，仅更新必要用例 |
| portal/src/pages/WorkflowEditor.tsx | 文档范围历史状态与异步响应隔离 |
| portal/src/utils/model-params.util.ts | 兼容参数筛选与依赖顺序 |
| src/workflow/workflow-ports.ts | loop last value 读取 |
| src/workflow/workflow-asset.service.ts | 元数据异常安全边界 |
| src/workflow/__tests__/node-executor.spec.ts、workflow-editor-contracts.spec.ts | 端口和参数合同回归 |
| src/workflow/__tests__/workflow-asset.service.spec.ts | 元数据与日志边界回归 |
| docs/workflow-and-portal.md、docs/minio-workflow-assets-design.md | 仅更新受本修复影响的真实合同/验证记录 |

优先现有测试设施；实施前检查导出符号引用并迁移所有实际调用者。若有其他测试直接构造 refresh token，必须同步显式版本，但不得扩大业务范围。生成文件仅由对应构建更新。

## 13. 性能与异常语义

- 认证额外版本确认局限在登录/刷新签发，不增加普通 API 的逐请求数据库查询。
- 版本更新为单文档原子操作，不要求 Mongo replica-set 事务、不依赖进程内锁。
- token 清理沿用已有 userId 索引；不新增无边界重试或全库扫描。
- 旧/不匹配 token 返回通用 401，用户状态和数据库内部原因不泄漏。
- 并发 changePassword 条件冲突返回 409；数据库不可用不伪装成用户密码错误。
- 前端状态隔离只增加小型 id/代次标记，不复制整张图或重复缓存模型。

## 14. 验证与验收标准

### 14.1 先复现再修复

用可控 Promise 屏障而非 sleep，固定以下交错：

1. refresh 已读取旧用户/token，暂停 create；重置完成；恢复 create；后续 refresh 必须 401。
2. 旧密码登录已验证、暂停签发；重置完成；恢复；该 token 不能获得新版本刷新能力。
3. 新密码登录在重置原子更新后签发，旧版本清理不能撤销新版本 token。
4. 清理失败时旧 token 仍因版本不匹配被拒绝；不返回成功临时密码。
5. 存量 token 缺版本、用户缺版本、非法版本、普通注册/登录/刷新、changePassword 并发冲突。
6. 两实例都读到旧索引，后者删除收到 code 27；两个初始化成功。code 26 首次启动可接受；网络/权限错误仍失败。

除确定性单测外，使用隔离测试数据库及真实服务验证版本持久化和密码原子更新，不接触既有用户。测试数据与清理限定本轮精确 ID；环境不可用则记录未验收，不能声称完成真实并发验收。

### 14.2 前端与工作流

- 浏览器同一 SPA 编辑器实例从 A 切到 B，延迟或拒绝 B 历史请求；不得展示可操作的 A 历史，也不得发出 A 的 retry 请求。
- 延迟 A 的历史/重试响应，切 B 后释放；B 状态不得被污染。不调用收费模型，可拦截并观察请求及使用隔离的免费结构节点图。
- duration=10 切换到 enum=[5]、default=5，结果必须为 5；再覆盖依赖顺序和合法旧值保留。
- 执行真实 loop last 到 value 下游路径，覆盖标量、null、对象 value、普通对象、数组、result/output 业务键与非法端口。
- 构造包含哨兵秘密的数据库异常，经过服务和异常日志边界后，响应/日志均不得含哨兵；无成功元数据且无对象删除。

### 14.3 提交门槛

- 以上六项均有对应复现与修复后证据；相关回归、后端/Portal/Dashboard 构建通过。
- 独立复审无未关闭 Critical/High，Medium 已修复或用户明确接受。
- 不把 MinIO 匿名读取仍 403 或收费模型未授权宣称为通过；两项外部验收保持独立阻塞。
- 只暂存审查过的源码、必要测试/文档和明确生成的既有产物；排除秘密与临时文件。
- 满足门槛后执行此前授权的 commit，不 push。

## 15. 风险、替代方案与待确认决定

不选择仅重复 updateMany 或增加一次前置检查：不能阻止检查后的插入。不选择单进程 mutex：不能覆盖多进程部署。不选择全面 JWT 即时撤销：会改变请求开销与已确认 access token 合同。

需用户确认后才实施：

1. 同意增加内部 authVersion，并同时更新 resetPassword、changePassword 和所有签发/刷新路径。
2. 同意上线时停止旧认证进程、存量 refresh token 一次性要求重新登录，access token 仍自然到期。
3. 同意六项问题一起修复、验证和复审，之后继续已授权的 commit；不 push、不执行收费模型、不改 MinIO 策略。

本设计未申请直接变更生产部署或清理线上会话数据。设计批准后仍需按实际环境安排上线窗口。

## 16. 设计审查记录

2026-09-24 独立静态设计审查：PASS，无阻塞项。已核对认证快照版本、原子密码更新、旧 token 拒绝、上线/回滚边界，以及 R2–R6 的方案与现有源码合同。主代理另补充注册签发后检查不得触发删用户补偿的约束。

该结论不代表代码修复完成，不关闭当前实现的 High，不替代并发/真实数据库/浏览器验收。仍等待用户批准本设计实施，未 commit、未 push。
