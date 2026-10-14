# 工作流素材 MinIO 直连接入设计

## 1. 状态与授权边界

- 日期：2026-09-21。
- 状态：用户已批准实施，并明确批准指定前缀匿名只读及 HTTP 非敏感文件验收。
- 实施范围仅限工作流素材 MinIO 接入；不自动修改 bucket 策略，不调用收费模型。
- 供应商、modelId、调用次数及费用上限由用户后续补充，模型端到端验收保持未完成。

## 2. 背景与已验证事实

上轮剩余验收为真实 PNG/TXT 上传及供应商模型消费。重新只读查询开发配置对应数据库，`link_conversion_settings/global.config.storagesvc.host` 仍为空，签名密钥及 bucket 已配置；不在文档中披露其值。

用户提供的新存储参数：

| 参数 | 值 |
|---|---|
| MINIO_ENDPOINT | 115.190.245.230 |
| MINIO_PORT | 9000 |
| MINIO_USE_SSL | false |
| MINIO_BUCKET | modelhub |

本次实际请求 `http://115.190.245.230:9000/minio/health/live` 与 `/minio/health/ready`，均返回 200。此证据仅证明当前机器可达健康端点，不证明 bucket 存在、访问凭证有效、对象公开可读或供应商可达。

当前 `WorkflowAssetService.upload` 经 `@akool-sdk/storage` 调用 Akool 存储服务的 `generateSignature`，再向返回的 `upload_url` PUT，保存 `final_url`。MinIO 是 S3 兼容服务，不能直接作为该签名服务的 `storagesvc.host`。

## 3. 目标

1. Portal 原有素材上传接口可选择直接写入 MinIO 的指定 bucket/前缀。
2. 保留文件校验、owner 隔离、TXT/JSON 正文、素材列表、输出引用及删除语义。
3. 返回可持久化的稳定 HTTP(S) 对象 URL，可在工作流重载、排队、重试后继续使用。
4. 新 MinIO 凭证仅在服务端部署环境注入，不进入前端、后台配置响应、数据库或日志。
5. 缺配置、鉴权失败、上传失败明确报错，不创建假素材，不静默切换存储后端。

## 4. 非目标

- 不替换全局链接转换的 Akool storagesvc，不迁移其配置或历史对象。
- 不改变模型计费、钱包、权限或供应商参数映射。
- 不自动创建 bucket、开放 bucket、设置生命周期或删除存储对象。
- 不新增管理后台 MinIO 表单，不重构已有配置加载体系。
- 不引入临时预签名 URL 持久化、自动续签、私有素材代理或 assetId 图参数迁移。
- 不将健康检查或上传成功宣称为供应商真实执行成功。

## 5. 现有实现与约束

### 5.1 上传和素材

`src/workflow/workflow-asset.controller.ts` 提供鉴权的 multipart 上传，字段为 `file`。`workflow-asset.service.ts` 校验媒体最大 20 MiB、文本/JSON 最大 1 MiB、MIME/文件头、UTF-8 和 JSON；仅上传成功后创建素材记录。

`workflow-asset.schema.ts` 持久化 `url`，文本同时保存 `text`。媒体输出保存引用，不重新上传；文本输出经过同一上传方法。删除仅删 owner 范围内的素材记录，返回 `storageObjectDeleted: false`。

### 5.2 附件消费

`portal/src/pages/WorkflowEditor.tsx` 将媒体 URL 或文本正文写入模型参数，图保存参数值而非动态 assetId。`src/workflow/node.executor.ts` 调用 `TaskService`，输入链接不会在执行前自动续签。

因此单次预签名 URL 会被固化，过期后已保存工作流失效。当前 `publicHttpUrl` 仅做 URL 字面检查，不证明真实可读，也不是完整的 SSRF 防护。

### 5.3 配置

`APP_CONFIG` 来自 Nacos 整包 JSON 或 `config/${NODE_ENV}.json`，已有 `AppConfig` 只有 TypeScript 类型，不能代替运行时校验。dotenv 加载环境变量，但不存在通用业务字段自动映射。现 Nacos 订阅不更新已注入配置对象，本设计配置变更须重启。

Akool 链接转换配置独立存于 MongoDB。新凭证不接入其配置 API、Mongo 文档或现有审计序列化路径。

## 6. 方案与架构

### 6.1 仅在素材上传分流

增加可选 `APP_CONFIG.workflowAssetStorage`：

- 整个字段缺省：保持旧 `storagesvc` 行为。
- 显式 `provider: "storagesvc"`：保持旧路径、旧配置校验与错误语义。
- 显式 `provider: "minio"`：使用独立 MinIO 上传服务。
- 字段存在但 provider 缺失或为其他值：配置错误，不回退。

必须在调用 `LinkConversionConfigService.getEffectiveConfig()` 之前选择后端。MinIO 上传不得因无关 Akool host 为空或链接转换配置校验失败而被阻塞。

保留现有 `StorageAdapter`、`createLinkConversionStorageAdapter` 和 `LinkConversionService`。新增一个仅服务于工作流素材的 `MinioWorkflowAssetStorageService` 即可；不引入多层工厂或新的全局存储框架。

调用链：Portal → 现有素材鉴权/文件校验 → 按 provider 分流 → MinIO PutObject 或原 Akool 上传 → 原 URL 检查 → 创建素材记录。

### 6.2 SDK 和生命周期

使用官方 `minio@8.0.6` Node.js SDK，不手写 S3 签名，lockfile 由包管理器更新。官方参考：https://github.com/minio/minio-js ，其提供 `Client`、`putObject` 及 TypeScript 类型。

MinIO provider 激活时构造单例客户端，配置校验在初始化阶段完成；不在每次上传时新建客户端或读取秘密。不在服务启动时上传探测对象，不因未选择 MinIO 而要求 MinIO 配置。

应用直接传入已有 `Buffer`，设置准确的 Content-Type 和长度，不额外进行 base64 编码、完整复制或临时落盘。已核实 SDK 8.0.6 的公开 putObject 路径内部存在 Buffer 复制，不能宣称端到端零复制，也不依赖私有 API 绕过。素材既有 20 MiB 上限不变。超时必须落实到传输中断/请求终止机制；仅 Promise.race 后遗留后台上传不可接受。不额外增加应用层重试；SDK 默认的 HTTP 重试必须被约束，确保操作有界。

## 7. 配置合同

新增 `AppConfig.workflowAssetStorage` 类型。非秘密配置遵循 APP_CONFIG；只有凭证从固定部署变量读取，集中在新存储服务内，不额外建立第二套 endpoint 优先级。

| 字段 | 合同 |
|---|---|
| provider | storagesvc 或 minio；整个配置缺省时为 storagesvc |
| minio.endPoint | 纯主机名/IP，无 scheme、端口、路径；用户提供值为 115.190.245.230 |
| minio.port | 整数 1–65535；本次 9000 |
| minio.useSSL | 布尔值；本次提供 false，不隐式转换字符串 |
| minio.bucket | 合法 S3 bucket 名；本次 modelhub |
| minio.region | 可选非空 region；未配置时使用 SDK 的 region 探测，不臆造实际 region |
| minio.publicBaseUrl | 必填，已包含 bucket 根或等价反向代理根；无 userinfo/query/hash；不从 endpoint 自动推断 |
| minio.pathPrefix | 缺省 workflow-assets；只接受安全相对路径段，拒绝空段、点段、反斜线及路径穿越 |
| minio.uploadTimeoutMs | 缺省 60000，整数 1000–300000；须约束整个上传操作 |
| minio.allowInsecureHttp | 缺省 false；上传或公开读取使用 HTTP 时必须显式开启，且仅用于已批准的非敏感验收 |

凭证变量固定为 `WORKFLOW_ASSET_MINIO_ACCESS_KEY_ID`、`WORKFLOW_ASSET_MINIO_SECRET_ACCESS_KEY`。不使用 MinIO root 凭证，不将空字符串视为有效凭证，不通过管理 API 接收凭证。

用户提供的 `MINIO_ENDPOINT` 等目前只是输入参数；本设计不声称它们已被应用识别。批准实施后映射到以上 APP_CONFIG 字段。`.env.example` 只记录两个空凭证变量及用途，不写实际秘密。

配置最小示例（仅说明结构，不自动应用）：

```json
{
  "workflowAssetStorage": {
    "provider": "minio",
    "minio": {
      "endPoint": "115.190.245.230",
      "port": 9000,
      "useSSL": false,
      "bucket": "modelhub",
      "publicBaseUrl": "http://115.190.245.230:9000/modelhub",
      "pathPrefix": "workflow-assets",
      "uploadTimeoutMs": 60000,
      "allowInsecureHttp": true
    }
  }
}
```

用户已批准 HTTP 非敏感验收和指定前缀公开读，但 URL 仍为待验证候选，不代表已公开可读。生产应使用 TLS 的上传端点和独立 HTTPS 素材域名。

## 8. 对象键、公开 URL 与权限

对象键：`<pathPrefix>/<sha256(ownerId)>/<assetId>.<validatedExt>`。沿用每次上传生成的 UUID，不用原始文件名或原始 ownerId，不允许调用者覆盖 bucket/prefix/key。对 URL 各路径段编码，规范化 base URL 的末尾斜线，保证 key 与 URL 指向同一对象。

稳定 URL 是“无应用层过期签名”，不是永久保留承诺；管理员删除、生命周期或域名变更仍可使其失效。

**已批准方案：稳定 publicBaseUrl + 指定前缀匿名只读；实际策略由部署负责人配置，应用不自动变更。**

- 仅对 `modelhub/workflow-assets/*`（或用户确认的前缀）授予匿名 GetObject。
- 不允许匿名 ListBucket、PutObject、DeleteObject，不开放整桶其他目录。
- 写账号只授予目标前缀 PutObject 及选定 SDK 确实需要的 bucket location 权限；若需要更多权限先核实原因，不能扩大为 root。
- 应用不设置 bucket policy；由部署负责人审查、配置并验收。
- owner 隔离只保护素材管理接口，不保护拿到 URL 后的对象读取。UUID 不等于鉴权，URL 可被转发，敏感素材不适用此方案。

若用户不允许匿名读取，此方案不得启用。必须重新设计私有存储访问：稳定受控下载 URL 或执行时 assetId 解析/重签；不能用短期链接冒充稳定地址，也不能暗中把 bucket 改公开。

本设计不在每次上传后额外匿名 GET 整个对象：避免重复传输，且一次读取也无法证明未来的供应商可达性。实际公网读取是上线验收的硬门槛；策略或域名变化后必须重做检查。日常上传接口成功表示对象写入与元数据持久化成功，不承诺任意外部网络永久可达。

## 9. API 与内部接口

外部 `/v1/workflow-assets` 的上传、分页列表、from-output、删除接口不改路径和响应字段。前端不获取上传凭证，也不直接连接 MinIO 写对象。

新内部服务建议：`upload(buffer, { assetId, ownerKey, fileExt, contentType }): Promise<string>`。由已校验文件派生扩展名；返回稳定 URL；不得返回模拟 URL、data URL 或临时预签名 URL。原有 ownerKey/id 生成仍在素材服务，避免重复计算。

新增 provider 的初始化校验只在 provider=minio 时运行。显式错误配置阻止相关应用启动，打印字段名和安全原因，不打印配置对象或 SDK 原始请求。

## 10. 数据模型与兼容性

不新增 Mongo 字段、不迁移历史素材、不修改用户工作流。保留现有 url/text/size/source 等字段；文本、JSON 输出经过新分流，媒体 output-reference 不重新上传。

回滚 provider 仅影响新上传。已有 MinIO URL 继续由原域名和读取策略提供，不能因应用回滚而删除对象或关闭读取。历史 Akool URL 原样保留。

## 11. 错误处理

| 情况 | 行为 |
|---|---|
| 未授权上传/跨 owner 访问 | 保留现有 Guard、owner 查询和 401/404 行为 |
| 空文件、超限、MIME/UTF-8/JSON 错误 | 保留现有 400，禁止调用存储 |
| MinIO provider 配置缺失、非法 URL/timeout、凭证为空 | 启动配置错误，信息不含秘密 |
| storagesvc 缺配置 | 保留旧分支错误语义，不被 MinIO 改写 |
| bucket 不存在、403、网络/TLS/上传超时 | 上传返回脱敏 503，不写素材记录，不回退 |
| 生成 URL 不满足既有资源 URL 条件 | 503，不写素材记录 |
| PutObject 成功而数据库失败 | 返回失败，不声称素材成功；不隐式删对象 |

不把 SDK 原始 XML、Authorization、access key、签名参数或配置打印到日志/API。安全日志只包含错误类别、素材 id 及必要请求标识。

上传成功后的数据库失败可能留下孤儿对象，与现有无物理删除契约一致。记录诊断 id，交部署方按精确对象键处理；不新增删除权限、自动扫桶或补偿删除。

## 12. 安全与性能

- 当前用户端点是公网 HTTP。签名不提供传输加密，文件内容可被窃听或篡改；HTTP 验收仅使用无敏感测试文件。生产 TLS 是部署门槛。
- HTTPS Portal 读取 HTTP 媒体可能触发混合内容限制；供应商可能拒绝 HTTP、IP 或非标准端口。健康检查不能排除这些问题。
- publicBaseUrl 必须是部署管理员控制的对象域名，不允许通过上传请求传入任意目标。新配置校验不应宣称解决整个项目的 DNS rebinding/SSRF 问题。
- 服务端上传，不新增浏览器直传；不自动放开 CORS。若实际媒体消费涉及跨域读取，按真实所需来源和方法配置并验收。
- 复用 SDK 客户端和已有 Buffer，保持原有文件上限；不新增队列、缓存或无上限后台重试。
- 本次不修复旧后台配置的独立脱敏问题，但明确不复用该路径承载新秘密。

## 13. 文件影响范围

实施时预计修改：

| 文件 | 用途 |
|---|---|
| src/config/interfaces/config.interface.ts | 增加可选配置类型 |
| src/workflow/workflow-asset.service.ts | 上传后端分流，保留原行为 |
| src/workflow/workflow.module.ts | 注册新的素材 MinIO 服务 |
| src/workflow/minio-workflow-asset-storage.service.ts（新增） | 运行时配置校验、SDK 单例、对象键/URL、真实上传 |
| src/workflow/__tests__/workflow-asset.service.spec.ts | 分流、失败和旧语义回归 |
| src/workflow/__tests__/minio-workflow-asset-storage.service.spec.ts（新增） | 新可观察合同测试 |
| package.json / package-lock.json | SDK 直接依赖，由包管理器更新 |
| config/nacos-config-template.json | 非敏感配置说明，默认行为不切换 |
| .env.example | 仅秘密变量空值与说明 |
| docs/workflow-and-portal.md | 实际实施后补充配置和验收事实 |

保持不变：LinkConversionService、原 Akool adapter/interface、旧管理后台配置 API/UI、素材 schema、Portal 上传接口和工作流参数协议。部署配置仅在用户批准且秘密到位后应用，不修改已存在的无关配置。`dist/` 禁止手工修改。

## 14. 测试计划

测试新增可观察合同，不以源码文本匹配代替行为验证：

1. 配置缺省和 storagesvc 分支保持现有语义；minio 不调用旧配置读取器；未知 provider 明确失败。
2. 仅 MinIO 激活时要求其配置；缺凭证、非法 host/port/base URL/prefix/timeout、未批准 HTTP 均失败且不泄露秘密。
3. 上传字节、Content-Type、大小正确；对象键唯一、owner 隔离且不含原始文件名；base URL/前缀拼接和路径编码一致。
4. TXT/JSON 同时保留真实 URL 与正文；媒体输出引用不重传；文本输出走选定后端。
5. SDK 拒绝、缺 bucket、网络/TLS/超时失败时不写记录、不 fallback；验证传输被终止而不是后台继续上传。
6. 数据库失败不返回成功、不删对象；删除仍只移除 owner 记录。
7. 继续运行既有 workflow-asset、node-executor、workflow-editor-contracts 回归，保持模型参数和终态行为。
8. 实施完成后统一执行相关测试及后端构建；若前端未修改，不为设计阶段新增或运行前端测试。

## 15. 真实验收与证据

设计阶段已执行：两个 MinIO 健康端点返回 200。未上传对象，未修改 bucket，未执行代码测试或构建。

实施后的验收必须使用专用账号和非敏感样本：

1. 部署方确认 bucket 存在、region、前缀权限、秘密注入和稳定 URL；不猜测凭证。
2. 启动实际 API 与 Portal，浏览器上传真实 PNG/TXT；观察接口成功和 owner 素材列表，刷新后仍可用。
3. 对返回 URL 发起不带认证的真实 GET，比对 PNG/TXT 原始字节和 Content-Type；PNG 浏览器解码成功，TXT UTF-8 正确。不得用 HTTP 200 的 XML/HTML 错误页替代。
4. 在 Portal 选择 PNG，验证模型附件字段写入 URL；选择 TXT，验证 prompt/文本字段写入正文。保存重载值不变。
5. 未授权用户不能管理他人素材；公开 URL 可读是批准的独立边界，不声称对象 owner 鉴权。
6. 删除测试素材只删除记录，返回 storageObjectDeleted:false；测试对象清理由用户明确授权后按精确键操作，不扫桶。
7. 供应商调用仍等待指定模型及费用授权。拿到授权后验证真实任务终态、供应商输出和输入文件消费；不以免费转换节点替代。

## 16. 发布与回滚

1. 用户确认设计、公开读取策略和 HTTP 验收边界。
2. 实施、相关测试、构建、独立 Review；阻塞问题修复后复审。
3. 部署方准备非 root 前缀凭证、bucket 策略和 HTTPS 公开域名；通过秘密渠道注入凭证。
4. 显式设置 provider=minio 并重启相关服务；未切换的环境保持旧行为。
5. 完成真实浏览器上传和匿名读取，保留证据后再宣告上传验收通过。
6. 出错时回滚代码/配置到旧 provider；旧 storagesvc.host 尚为空时，回滚不代表上传恢复可用。不得删 MinIO 对象或撤销历史 URL。

## 17. 风险与待确认事项

| 项目 | 当前状态 / 所需决定 |
|---|---|
| 设计实施 | 用户已批准实施 |
| 公开读取 | 用户已批准 modelhub/workflow-assets/* 匿名只读，不允许匿名列举/写入/删除 |
| 公开 URL | 当前 HTTP 对象 URL 已实际匿名 GET，返回 403 AccessDenied；生产 HTTPS 域名仍待部署方提供 |
| HTTP 验收 | 用户已批准仅用非敏感文件在现有 HTTP 端点验收 |
| 凭证 | 2026-09-21 续作已核实两个固定秘密变量在部署 .env 中均非空，未输出值；非 root 身份及最小权限范围仍需部署负责人确认 |
| bucket / region / policy | 最新复查 modelhub region 为 us-east-1，PNG/TXT 已写入且鉴权读取内容/MIME正确；getBucketPolicy 返回 NoSuchBucketPolicy，两个对象匿名 GET 均 403 AccessDenied。部署方需配置已批准的指定前缀匿名只读策略，应用不自动修改 |
| 保留期限 | 部署方确认生命周期不会使已保存工作流在预期使用期内失效 |
| 模型与费用 | 用户表示后续补充；真实模型验收继续阻塞 |

## 18. 验收标准

- 旧存储分支和全局结果转存无行为回归；MinIO 路径不依赖空的 Akool host。
- 真实 PNG/TXT 通过 Portal 上传到指定前缀，返回 URL 匿名获取的内容与原文件一致。
- 新凭证不进入提交文件、前端、配置响应、Mongo 或日志。
- 已保存工作流持有稳定 URL，不持久化一次性预签名地址；公开读边界经用户批准。
- 上传失败不创建假素材，元数据失败不误报成功，删除语义不变。
- 新合同测试、既有相关回归和实际运行验收通过；Review 无未关闭 Critical/High。
- 未授权收费调用不发生；供应商执行独立记录真实验收状态。

## 19. 审查记录

2026-09-21 独立设计审查：**PASS WITH NOTES**。Critical / High / Medium / Low 发现均为 0。已对照配置加载、上传/删除/from-output、Portal 参数消费、NodeExecutor、素材 schema 与模块注册核实设计。

审查时实施、前缀匿名读取及 HTTP 非敏感验收尚待批准，随后用户已明确批准这三项。bucket、region、policy、凭证、生产 TLS 与供应商费用授权仍待核实。该次审查仅为静态只读审查，没有执行上传、测试或构建，也没有独立复测健康端点，不等同于代码 Review 或真实上传/模型验收。

2026-09-21 续作代码独立审查：**PASS（静态）**，Critical / High / Medium / Low 均无发现。主代理另执行 4 个相关测试套件、102 个测试及后端构建，均通过。最新构建实际启动并经 Portal 验证 PNG/TXT 上传失败不落库、匿名列表 401 和安全日志；成功写入、匿名对象读取及附件保存重载仍因 `NoSuchBucket` 阻塞。完整实施及证据见 `docs/workflow-and-portal.md` §8.14，未执行收费模型调用。

后续 bucket 就绪复验：`modelhub` region 为 `us-east-1`，真实 PNG/TXT 已经 Portal 写入，鉴权读取内容与 MIME 一致；图保存重载后媒体 URL 和文本正文保留，跨 owner 管理隔离、删除记录不删对象均已实际验证。当前仅匿名读取/URL 图片解码仍返回 403，bucket 策略查询为 `NoSuchBucketPolicy`，由部署方配置已批准的前缀匿名只读，不由应用修改。两专用账号及新图已清理，无模型运行；两个无敏感样本对象保留供策略就绪后复验，精确键见工作流文档 §8.14。
