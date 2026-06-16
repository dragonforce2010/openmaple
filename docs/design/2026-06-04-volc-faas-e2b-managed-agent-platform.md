# 基于火山 veFaaS + 可插拔 Sandbox 的 Managed Agent 平台工业级设计方案

> 本文目标：在火山引擎函数服务 veFaaS 与可插拔 sandbox 基础设施之上，构建一个自研、统一、可插拔、尽量对齐 Anthropic Managed Agents 设计语义的 Managed Agent 平台。平台不依赖 Anthropic 托管 agent runtime，而是自研控制面、事件模型、runtime gateway、agent runner、工具执行、安全审计和客户接入层。Sandbox 选型必须可切换，首期支持火山函数服务云沙箱与 E2B。

## 1. 结论摘要

| 结论 | 说明 |
|---|---|
| 主技术选型 | 火山 veFaaS 承载生产化 agent runtime 调度与 runner 执行；SandboxRuntimeProvider 可在火山函数服务云沙箱与 E2B 之间切换。 |
| 产品语义 | 对齐 Anthropic Managed Agents 的 Agents、Environments、Sessions、Vaults、Memory Stores、Files、Skills、User Profiles、Webhooks、Work/Events/Threads/Resources。 |
| 核心自研层 | Control Plane、Runtime Gateway、Event Log、Work Queue、Agent Runner、Tool Runtime Adapter、Vault/Memory/Artifact 服务。 |
| FaaS 定位 | 不是简单函数，而是 AgentRuntimeProvider 的一种实现：异步任务承载每轮 agent run，微服务/Web 应用承载 runtime gateway 或长连接服务。 |
| Sandbox 定位 | 不是完整 agentRuntime，而是 SandboxRuntimeProvider：负责命令、文件、PTY、浏览器、代码执行、隔离 workspace，可选 `volc_cloud_sandbox` 或 `e2b`。 |
| 关键架构原则 | 所有 session event 必须先落平台 event log；SSE/Webhook 从平台 gateway 推送，不从 E2B 或 FaaS runner 直连客户。 |
| 生产优先级 | 先做统一事件模型、work lease、FaaS runner、SandboxRuntime 抽象、火山云沙箱/E2B adapter、SSE gateway、artifact sync，再做高级 checkpoint、复杂 multi-agent、成本优化。 |

## 2. 背景与目标

Anthropic Managed Agents 的核心设计是把 Agent 定义、Environment 模板、Session 运行实例、事件流、工具执行、Vault、Memory、Skill、资源挂载统一成一个控制面 API。我们的目标不是使用 Anthropic 的托管 agent，而是自研类似能力，并保留国内云基础设施、企业内部 SSO、私有模型池、私有工具、私有知识与审计治理能力。

本文采用三类基础设施，其中 agent runtime 与 sandbox runtime 分层：

| 基建 | 强项 | 在本平台中的角色 |
|---|---|---|
| 火山 veFaaS | 异步任务、函数实例、预留实例、API 网关、VPC、TLS 日志、云监控、TOS/NAS 挂载、版本发布、灰度发布 | AgentRuntimeProvider，承载 runner 执行、runtime gateway、后台任务、生产化调度 |
| 火山函数服务云沙箱 | 隔离容器运行环境、公共/自定义镜像、启动命令、端口、规格、timeout、TOS 挂载、Webshell、统一域名访问 | SandboxRuntimeProvider 默认生产候选，承载命令、文件、浏览器/代码环境和 workspace 隔离 |
| E2B | 安全隔离 sandbox、Linux OS、命令执行、文件系统、PTY、模板、metadata、timeout、kill、connect | SandboxRuntimeProvider 备选/跨云候选，承载 agent 工具执行与 workspace 隔离 |

平台目标：

- 提供兼容 Anthropic 风格的 Managed Agent API 和 Console 交互。
- 支持 Agent 模板版本化、Environment 模板、Session 实例、事件流、资源挂载、Vault、Memory、Skills、Files、Artifacts。
- 支持用火山 veFaaS 执行 agent runner，并在火山云沙箱与 E2B 之间切换 bash/file/browser/code 工具执行环境。
- 支持 SSE 实时流、Webhook 异步通知、SDK/CLI/Console 多入口接入。
- 支持未来替换 AgentRuntimeProvider，例如 K8s、VCI、其他云 FaaS，或者本地 Docker。

## 3. 设计原则

| 原则 | 设计含义 |
|---|---|
| Control Plane 与 Runtime 解耦 | Agents、Sessions、Events、Vaults、Memory 等资源永远由平台控制面持久化；FaaS 与 Sandbox provider 只是可替换执行基建。 |
| Event Log 是事实源 | 前端 transcript、debug、SSE、webhook、审计、重放、checkpoint 都以 `session_events` 为准。 |
| Runtime Provider 可插拔 | `volc_faas_task`、`volc_faas_microservice`、`volc_cloud_sandbox`、`e2b`、`local_docker` 都通过接口接入。 |
| Tool Runtime 与 Agent Runtime 分层 | Agent loop 在 runner 内；工具执行在火山云沙箱、E2B 或其他 sandbox 内；两者通过 ToolRuntimeAdapter 通信。 |
| 账号与租户分离 | 用户账号是人；Workspace/Organization 是资源归属与计费边界；飞书、Google/Gmail、GitHub 只是登录身份 provider。 |
| 安全默认收敛 | API key、Vault secret、模型 key 不进入明文 DB；工具执行有权限策略、审计、可回放记录。 |
| 长任务可恢复 | 每轮 run 有 work item、lease、heartbeat、status、runtime instance、event seq、artifact checkpoint。 |
| 对外协议稳定 | 客户只依赖 `/v1/agents`、`/v1/sessions`、`/events/stream`、SDK/Webhook；底层 provider 变更对客户透明。 |

## 4. Anthropic Managed Agents 对齐范围

| 官方资源族 | 平台对应模块 | 本期策略 |
|---|---|---|
| Agents / Agent Versions | `agents`、`agent_versions` | 完整支持创建、读取、更新、归档、版本列表；更新生成不可变版本。 |
| Environments | `environments` | 支持 AgentRuntime 与 SandboxRuntime 模板、网络、包、镜像、workspace、provider 配置。 |
| Sessions | `sessions`、`session_runs` | 创建时保存 agent snapshot；运行时绑定 environment、vault、resources。 |
| Session Events | `session_events` | 对齐 `user.message`、`agent.message`、`agent.tool_use`、`tool.result`、`session.status_*`。 |
| Session Threads | `session_threads` | 为 multi-agent 预留 coordinator/delegate thread。 |
| Session Resources | `session_resources` | 一等建模 file、memory_store、git_repository、artifact、workspace mount。 |
| Vaults / Credentials | `vaults`、`vault_credentials` | secret 只存 secret ref，支持 MCP OAuth validate 扩展。 |
| Memory Stores | `memory_stores`、`memories`、`memory_versions` | path-based memory，版本、redact、hash、size。 |
| Files | `files` | 上传、下载、metadata、删除；可挂载到 session。 |
| Skills | `skills`、`skill_versions`、`agent_skills` | 支持本地 skill 扫描、版本冻结、内容下载、agent 绑定。 |
| User Profiles | `user_profiles` | 支持用户偏好、enrollment URL、组织 profile。 |
| Accounts / Workspaces | `users`、`user_identities`、`workspaces`、`workspace_memberships` | 自研扩展；支持平台注册、飞书/Google/GitHub 登录、企业客户工作区与成员权限。 |
| Webhooks | `webhooks`、`webhook_deliveries` | 支持事件订阅、签名、重试、死信。 |
| Work Queue | `work_items`、`work_heartbeats` | 自研 runtime queue，FaaS runner 消费 work item。 |

## 5. 技术选型详解

### 5.1 火山 veFaaS

火山 veFaaS 提供多种函数类型。对 agentRuntime 最关键的是：

| 函数形态 | 官方能力特征 | 适用位置 |
|---|---|---|
| 任务函数 | 一次性脚本任务；异步调用；可追踪状态；适合长任务和重计算 | 每个 `session run` 的 agent runner 执行单元 |
| Web 应用函数 | HTTP server；API 网关接入；代码包或镜像 | Runtime Gateway、SDK webhook receiver、轻量 control callback |
| 微服务应用函数 | 任意语言/框架，始终分配 CPU，至少常驻实例 | 高可用 Runtime Gateway、work poller、事件 dispatcher |
| 异步任务 | 提交后返回 RequestId；后台执行；支持状态、终止、日志、监控 | `work_items` 到 FaaS run 的映射 |
| 预留实例 | 降低冷启动；保持实例常驻 | 高峰期或低延迟环境 |
| TOS/NAS 挂载 | 远端存储本地访问 | workspace、artifact、checkpoint、大型上下文 |
| TLS 日志与云监控 | stdout/stderr、QPS、延迟、错误、CPU/内存/GPU、实例数 | 运行观测、故障定位、成本分析 |

重要边界：

- 同步调用超时通常适合短任务；异步任务更适合 agent run。
- 异步任务 payload 有大小限制，应只传 `work_item_id`，大对象从 DB/TOS/NAS 读取。
- 异步任务的系统级重试不能替代 agent 语义重试，用户代码失败、模型失败、工具失败仍需平台重试策略。
- API Gateway 可作为 HTTP 入口，但 SSE 长连接建议由平台 Runtime Gateway 管控和实测，不让 runner 直接面向客户。

### 5.2 火山函数服务云沙箱

火山函数服务云沙箱提供和 veFaaS 同一云侧的隔离容器运行环境，适合在生产环境里承载默认 sandbox runtime：

- 公共镜像与自定义镜像，支持 All-in-One、Code、Browser 等基础能力组合。
- 创建、查询、设置超时、终止 sandbox。
- 支持启动命令、监听端口、CPU/内存规格、最大并发、请求超时。
- 支持环境变量、metadata、TOS 挂载、统一域名/泛域名访问、Webshell。
- 支持镜像预热，降低首次启动耗时。

在本设计里，火山云沙箱与 E2B 是同一层 SandboxRuntimeProvider 的两个实现：

| 能力 | 在平台中的使用方式 |
|---|---|
| bash/code execution | `agent.tool_use` 为 bash/code 时，由 FaaS runner 调用 `volc_cloud_sandbox` adapter 执行。 |
| workspace filesystem | 通过 TOS 挂载或启动时同步 workspace；run 结束后扫描 artifact 与 changed files。 |
| browser/computer-use | 使用 Browser/All-in-One 自定义镜像，必要时暴露受控端口给平台 gateway。 |
| 网络与云内访问 | 通过火山 VPC/公网策略接入私有服务、模型网关、TOS/NAS，云内治理更自然。 |
| timeout/kill | 由平台根据 session/run 生命周期调用 SetSandboxTimeout/KillSandbox。 |
| metadata | 记录 `session_id`、`run_id`、`tenant_id`、`environment_id`，用于审计、成本与回收。 |

火山云沙箱的优势是和 veFaaS、TOS、VPC、TLS、云监控、权限体系更贴近；限制是生态成熟度、SDK 便利性、浏览器/桌面能力需要更多镜像维护与实测。

### 5.3 E2B

E2B 提供安全隔离的 cloud sandbox，支持：

- 创建、连接、终止 sandbox。
- 运行 Linux 命令。
- 读写文件系统。
- 通过 metadata、envs、template 传递环境信息。
- timeout、kill、connect 等生命周期控制。

在本设计里，E2B 不承载完整 agentRuntime，而承载 SandboxRuntime/ToolRuntime：

| 能力 | 在平台中的使用方式 |
|---|---|
| bash/code execution | `agent.tool_use` 为 bash/code 时，由 FaaS runner 调用 `e2b` adapter 执行。 |
| workspace filesystem | Session workspace 同步到 E2B；run 结束后同步 artifact 与 changed files。 |
| browser/computer-use | 用 E2B template 预装浏览器或桌面环境，作为可插拔 sandbox 环境。 |
| timeout/kill | 由平台根据 session 生命周期管理，避免孤儿 sandbox。 |
| metadata | 记录 `session_id`、`run_id`、`tenant_id`、`environment_id`。 |

E2B 的优势是开发体验、模板生态、命令/文件 API 易用；限制是跨云网络、审计、成本、云内权限与国内合规链路需要平台额外补齐。

### 5.4 Sandbox 选择与切换策略

Sandbox 选型必须由 `environment.sandbox_runtime.provider` 或 `session.sandbox_runtime_override` 决定，不能写死在 runner 中。Agent Runner 只依赖统一接口：

| Provider | 推荐场景 | 注意事项 |
|---|---|---|
| `volc_cloud_sandbox` | 默认生产、国内云内访问、需要 TOS/VPC/TLS/统一权限治理、希望和 veFaaS 同云闭环 | 需要维护自定义镜像、工具 API adapter、浏览器/桌面模板和预热策略。 |
| `e2b` | 快速开发、跨云验证、成熟命令/文件 API、已有 E2B template 资产、computer-use 快速试验 | 需要控制跨云访问、secret 注入、日志审计、成本与数据出境风险。 |
| `local_docker` | 本地开发、CI fake、离线调试 | 不能作为生产隔离边界。 |
| `custom` | 后续内部沙箱、K8s/VCI sandbox、第三方 sandbox | 必须通过同一 contract test。 |

切换原则：

- Environment 定义默认 sandbox；Session 可在创建时 override，但必须通过权限与配额校验。
- `agent_versions` 只绑定能力需求，例如 `requires_browser=true`、`requires_filesystem=true`，不绑定具体 vendor。
- `sandbox_runtime_instances` 记录真实 provider、sandbox id、image/template、region、timeout、cost、metadata。
- Tool call event 记录 provider 与 instance id，便于复盘同一 agent 在不同 sandbox 上的行为差异。
- 所有 provider 必须通过同一组 contract tests：create、run command、read/write/list、artifact collect、timeout、kill、reconnect、secret redaction。

### 5.5 为什么不是只用 E2B 或只用 FaaS

| 方案 | 优点 | 问题 |
|---|---|---|
| 只用 E2B | 工具执行和 workspace 隔离直接；开发体验快 | 缺少生产级 work queue、lease、日志监控、发布、预留、云权限、事件入口。 |
| 只用 veFaaS | 调度、日志、监控、弹性、云权限更生产化 | 普通函数不适合直接执行复杂不可信工具；文件系统隔离、浏览器/桌面/代码环境不如 sandbox 自然。 |
| veFaaS + 火山云沙箱 | 同云闭环、VPC/TOS/TLS/权限治理自然、生产一致性更好 | adapter 与镜像生态需要自研，browser/computer-use 模板要压实。 |
| veFaaS + E2B | FaaS 做 agent runner 与生产调度，E2B 做成熟工具 sandbox | 跨云网络、审计、成本和数据边界要额外治理。 |
| veFaaS + 可切换 SandboxRuntime | AgentRuntime 生产化，SandboxRuntime 可按环境切换火山云沙箱/E2B/local/custom | 需要统一 provider contract、事件归一化、artifact sync 和成本模型，但这是平台应承担的核心复杂度。 |

推荐最终形态：`FaaS AgentRuntimeProvider + switchable SandboxRuntimeProvider`，生产默认优先评估 `volc_cloud_sandbox`，E2B 作为快速开发、跨云验证和特定模板能力的可选 provider。

## 6. 总体架构组件图

<whiteboard type="mermaid">flowchart TB
  subgraph Client["Client Access"]
    Console["Web Console"]
    SDK["TypeScript / Python SDK"]
    CLI["Maple CLI / REST"]
    WebhookConsumer["Customer Webhook Endpoint"]
  end

  subgraph Control["Managed Agent Control Plane"]
    APIGW["API Gateway / Auth / Rate Limit"]
    AgentSvc["Agent Service"]
    InboundGW["Agent Inbound Gateway"]
    HubSvc["Agent Hub Registry"]
    A2AGW["A2A Gateway"]
    SessionSvc["Session Service"]
    EventGateway["Runtime Event Gateway"]
    WebhookSvc["Webhook Dispatcher"]
    VaultSvc["Vault Service"]
    MemorySvc["Memory Service"]
    FileSvc["File and Artifact Service"]
    SkillSvc["Skill Service"]
    QueueSvc["Work Queue / Lease / Heartbeat"]
  end

  subgraph Store["Persistent Data Plane"]
    DB["PostgreSQL or SQLite dev"]
    ObjectStore["TOS / S3 Artifact Store"]
    NAS["NAS Workspace Mount"]
    SecretStore["KMS / Keychain / Secret Manager"]
    EventBus["Redis Streams / Kafka optional"]
  end

  subgraph Runtime["Runtime Providers"]
    FaaSRunner["Volc veFaaS Async Task Runner"]
    FaaSGateway["Volc veFaaS Web/Microservice Gateway"]
    SandboxRouter["SandboxRuntimeProvider Switch"]
    VolcSandbox["Volc Cloud Sandbox"]
    E2B["E2B Tool Sandbox"]
    Future["Future Sandbox: Local Docker / Internal"]
  end

  Console --> APIGW
  SDK --> APIGW
  CLI --> APIGW
  APIGW --> AgentSvc
  APIGW --> InboundGW
  APIGW --> HubSvc
  APIGW --> A2AGW
  APIGW --> SessionSvc
  APIGW --> EventGateway
  AgentSvc --> DB
  SessionSvc --> DB
  InboundGW --> SessionSvc
  InboundGW --> DB
  HubSvc --> DB
  A2AGW --> HubSvc
  A2AGW --> InboundGW
  SessionSvc --> QueueSvc
  QueueSvc --> DB
  QueueSvc --> FaaSRunner
  FaaSRunner --> EventGateway
  FaaSRunner --> SandboxRouter
  SandboxRouter --> VolcSandbox
  SandboxRouter --> E2B
  SandboxRouter --> Future
  FaaSRunner --> VaultSvc
  FaaSRunner --> MemorySvc
  FaaSRunner --> FileSvc
  VolcSandbox --> ObjectStore
  E2B --> ObjectStore
  FileSvc --> ObjectStore
  FileSvc --> NAS
  VaultSvc --> SecretStore
  EventGateway --> DB
  EventGateway --> EventBus
  EventGateway --> Console
  WebhookSvc --> WebhookConsumer
  EventBus --> WebhookSvc
  FaaSGateway --> EventGateway
</whiteboard>

## 7. 核心组件职责

| 组件 | 职责 |
|---|---|
| API Gateway/Auth | Lark SSO、API key、workspace/tenant 鉴权、限流、审计入口。 |
| Agent Service | Agent CRUD、版本化、模板生成、模型池绑定、skills/mcp/tools 配置。 |
| Agent Inbound Gateway | 校验 Agent-scoped API key/OAuth token、agent access grant、scope、rate limit，并将调用转成 session/run。 |
| Agent Hub / A2A Gateway | 发布 Agent Card、暴露 A2A endpoint、处理 Task/Message/Artifact 映射和 peer trust。 |
| Environment Service | 定义 AgentRuntimeProvider、SandboxRuntimeProvider、FaaS 配置、火山云沙箱镜像/E2B template、网络、存储、包、资源限制。 |
| Session Service | 创建 session、保存 agent snapshot、绑定 environment/vault/resources、状态机维护。 |
| Work Queue | 生成 work item、lease、heartbeat、重试、stop、dead letter。 |
| Runtime Event Gateway | 接收 runner 事件、规范化、持久化、SSE 推送、webhook 事件 fanout。 |
| Agent Runner | 运行 agent loop，调用模型池，规划工具，调用 ToolRuntimeAdapter。 |
| ToolRuntimeAdapter | 火山云沙箱/E2B/local docker/未来云沙箱工具执行统一接口。 |
| Vault Service | 凭证元数据、secret ref、临时注入、MCP OAuth validate。 |
| Memory Service | 长期记忆读写、版本化、redact、召回、session resource mount。 |
| Artifact Service | 产物扫描、上传、下载、metadata、生命周期管理。 |
| Webhook Dispatcher | 签名、幂等、重试、退避、死信、投递日志。 |
| SDK/CLI | 封装 API、SSE、webhook 校验、文件上传、session run 轮询。 |

## 8. 数据流图

### 8.1 用户消息到 Agent Run

<whiteboard type="mermaid">flowchart LR
  U["User / SDK"] --> A["POST /v1/sessions/{id}/events user.message"]
  A --> B["Session Service validate"]
  B --> C["append user.message to session_events"]
  C --> D["create work_item"]
  D --> E["Volc FaaS async task start"]
  E --> F["Agent Runner loads snapshot"]
  F --> G["Model Pool call"]
  G --> H{"Tool needed?"}
  H -->|No| I["append agent.message"]
  H -->|Yes| J["append agent.tool_use"]
  J --> K["SandboxRuntimeProvider execute"]
  K --> L["append tool.result"]
  L --> G
  I --> M["append session.status_idle"]
  M --> N["SSE stream / Webhook"]
</whiteboard>

### 8.2 Artifact 与 Workspace 同步

<whiteboard type="mermaid">flowchart TB
  Runner["FaaS Runner"] --> Tool["SandboxRuntimeProvider"]
  Tool --> VS["Volc Cloud Sandbox"]
  Tool --> E2B["E2B Sandbox"]
  VS --> W1["/workspace files"]
  E2B --> W1
  VS --> W2["/workspace/artifacts"]
  E2B --> W2
  Runner --> Scan["Artifact Scanner"]
  Scan --> TOS["TOS Object Store"]
  Scan --> DB["artifacts table"]
  Scan --> Event["artifact.created event"]
  Event --> SSE["SSE"]
  Event --> Webhook["Webhook"]
  Runner --> Checkpoint["checkpoint.json / HANDOFF.md"]
  Checkpoint --> TOS
  Checkpoint --> DB
</whiteboard>

## 9. 关键时序图

### 9.1 创建 Agent 与 Environment

<whiteboard type="mermaid">sequenceDiagram
  participant C as Console
  participant A as Agent Service
  participant E as Environment Service
  participant DB as Database

  C->>A: POST /v1/agents
  A->>DB: insert agents
  A->>DB: insert agent_versions v1
  A-->>C: agent with current_version
  C->>E: POST /v1/environments
  E->>DB: insert environment config
  E-->>C: environment_id
</whiteboard>

### 9.2 Session Run：FaaS Runner + 可切换 SandboxRuntime

<whiteboard type="mermaid">sequenceDiagram
  participant SDK as Client SDK
  participant API as Control Plane API
  participant Q as Work Queue
  participant F as Volc FaaS Runner
  participant EV as Runtime Event Gateway
  participant M as Model Pool
  participant T as SandboxRuntime
  participant DB as Event Store

  SDK->>API: POST /v1/sessions
  API->>DB: create session and primary thread
  API-->>SDK: session_id status=created
  SDK->>API: POST /v1/sessions/{id}/events user.message
  API->>DB: append user.message
  API->>Q: create work_item
  Q->>F: invoke async task with work_item_id
  F->>Q: acquire lease and heartbeat
  F->>EV: session.status_running
  EV->>DB: persist event seq
  F->>M: chat/completions with agent snapshot
  M-->>F: tool call bash
  F->>EV: agent.tool_use
  F->>T: commands.run bash via provider
  T-->>F: stdout stderr exit_code
  F->>EV: tool.result
  F->>M: continue with tool result
  M-->>F: final answer
  F->>EV: agent.message
  F->>EV: session.status_idle
  F->>Q: ack work_item
</whiteboard>

### 9.3 SSE 与 Webhook Bridge

<whiteboard type="mermaid">sequenceDiagram
  participant Browser as Browser or SDK
  participant GW as Runtime Event Gateway
  participant DB as session_events
  participant Bus as Event Bus
  participant WH as Webhook Dispatcher
  participant App as Customer App

  Browser->>GW: GET /v1/sessions/{id}/events/stream?cursor=seq
  GW->>DB: load historical events after cursor
  GW-->>Browser: SSE event batch
  GW->>Bus: subscribe live session events
  Bus-->>GW: new event
  GW-->>Browser: SSE event
  Bus-->>WH: webhook eligible event
  WH->>App: POST signed webhook
  App-->>WH: 2xx
  WH->>DB: record delivery success
</whiteboard>

### 9.4 Stop / Timeout / Retry

<whiteboard type="mermaid">stateDiagram-v2
  [*] --> queued
  queued --> leased: FaaS runner starts
  leased --> running: heartbeat ok
  running --> idle: end_turn
  running --> failed: user_error or provider_error
  running --> stopping: user stop
  stopping --> terminated: FaaS terminate success
  running --> retrying: system_error and retry budget remains
  retrying --> queued
  failed --> dead_letter: retry exhausted
  idle --> [*]
  terminated --> [*]
  dead_letter --> [*]
</whiteboard>

## 10. 账号与租户设计

### 10.1 账号模型

平台账号设计分三层：

| 层级 | 对象 | 说明 |
|---|---|---|
| User | `users` | 平台内的自然人账号，保存 canonical email、name、avatar、status，不绑定单一登录方式。 |
| Identity | `user_identities` | 第三方登录身份，一名用户可绑定多个 provider，例如 Lark、Google、GitHub。 |
| Workspace | `workspaces` | 客户/组织/个人工作区，是资源归属、权限、配额、计费和审计边界。 |

核心原则：

- 注册与登录统一走 OAuth/OIDC callback，但业务语义不同：没有平台用户时创建 `users`；没有 workspace membership 时进入创建或加入 workspace 流程。
- 飞书、Google/Gmail、GitHub 都不能直接作为资源 owner；资源 owner 必须是 `workspace_id`，操作 actor 才是 `user_id`。
- 一个 user 可以加入多个 workspace；一个 workspace 可以允许多个登录 provider。
- 同一用户可绑定多个 identities，但自动合并只允许基于 verified email 或显式登录后绑定，避免账号劫持。

### 10.2 登录注册方式

| Provider | 平台名称 | 用途 | 关键标识 |
|---|---|---|---|
| Lark/Feishu | `lark` | 国内企业客户、内部团队、扫码登录、组织信息获取 | `open_id/union_id`、verified email、tenant key。 |
| Google | `google` | Gmail/Google Workspace 用户登录注册 | OIDC `sub`、verified email、hosted domain。 |
| GitHub | `github` | 开发者登录注册、团队开发场景 | GitHub user id、primary verified email、org membership optional。 |

登录注册流程：

1. 用户点击 `Continue with Lark / Google / GitHub`。
2. Auth Service 创建 `oauth_states`，写入 provider、redirect_uri、csrf state、pkce verifier、intended workspace/invite。
3. 跳转到 provider 授权页；飞书可使用扫码登录体验。
4. Callback 校验 state、code、PKCE，换取 token，并拉取 provider profile。
5. 根据 `(provider, provider_subject)` 查 `user_identities`；命中则登录。
6. 未命中时，若 provider email verified，按 canonical email 查 `users`；命中则进入“绑定身份”流程。
7. 没有 user 时创建 `users`，创建默认个人 workspace 或根据 invitation/domain rule 加入客户 workspace。
8. 创建 `auth_sessions`，签发 httpOnly session cookie；API key 由用户进入 Console 后显式创建。

### 10.3 Workspace 加入策略

| 场景 | 策略 |
|---|---|
| 个人开发者首次注册 | 创建 personal workspace，用户为 owner。 |
| 企业客户邀请链接 | 校验 `workspace_invitations.token_hash`，创建 membership，默认 role 来自邀请。 |
| 企业域名自动加入 | `workspace_domains.domain` 与 verified email domain 匹配，且 auto_join enabled 时加入。 |
| 飞书组织登录 | 可按 Lark tenant key 映射 workspace；若未配置则创建待确认 workspace。 |
| GitHub 组织接入 | 可选校验 GitHub org membership 后加入指定 workspace。 |

角色模型：

| Role | 能力 |
|---|---|
| `owner` | 管理 workspace、成员、计费、SSO、删除高危资源。 |
| `admin` | 管理 agents、environments、vaults、members。 |
| `developer` | 创建 agents/sessions/files/webhooks，读取必要资源。 |
| `viewer` | 只读查看 sessions、events、artifacts。 |
| `service_account` | 供后端系统调用 API，不能登录 Console。 |

### 10.4 安全与合规策略

- OAuth state 必须短期有效、单次使用、绑定 provider 和 redirect_uri。
- Session cookie 使用 httpOnly、secure、sameSite=lax/strict；长会话支持 refresh token rotation。
- `user_identities.provider_token_ref` 只存 secret ref，访问第三方 API 时再取短期 token。
- GitHub、Google、Lark 返回的 email 必须 verified 才能用于自动合并或域名加入。
- 高风险操作要求 workspace role + step-up auth；比如删除 vault、导出审计日志、修改 SSO/domain rule。
- 所有登录、注册、身份绑定、workspace 加入、API key 创建都写入 `audit_logs`。

## 11. Runtime 抽象设计

### 11.1 AgentRuntimeProvider

```ts
export interface AgentRuntimeProvider {
  kind: "volc_faas_task" | "volc_faas_microservice" | "local_process" | "k8s" | "custom";

  prepareSession(input: PrepareSessionInput): Promise<RuntimeInstance>;
  startRun(input: StartRunInput): Promise<RuntimeRunHandle>;
  getRun(runId: string): Promise<RuntimeRunStatus>;
  terminateRun(runId: string, reason: string): Promise<void>;
  heartbeat(instanceId: string): Promise<HeartbeatResult>;
  collectLogs(input: CollectLogsInput): Promise<RuntimeLogBatch>;
  destroyInstance(instanceId: string): Promise<void>;
}
```

### 11.2 SandboxRuntimeProvider

```ts
export interface SandboxRuntimeProvider {
  kind: "volc_cloud_sandbox" | "e2b" | "local_docker" | "custom";

  ensureWorkspace(input: EnsureWorkspaceInput): Promise<ToolRuntimeInstance>;
  getCapabilities(input: CapabilityInput): Promise<SandboxCapabilities>;
  runCommand(input: RunCommandInput): Promise<CommandResult>;
  readFile(input: ReadFileInput): Promise<FileContent>;
  writeFile(input: WriteFileInput): Promise<WriteFileResult>;
  listFiles(input: ListFilesInput): Promise<ListFilesResult>;
  collectArtifacts(input: CollectArtifactsInput): Promise<ArtifactRef[]>;
  stop(instanceId: string): Promise<void>;
}
```

### 11.3 Provider 选择策略

| 场景 | AgentRuntimeProvider | SandboxRuntimeProvider |
|---|---|---|
| 默认生产运行 | `volc_faas_task` | `volc_cloud_sandbox` |
| 低延迟高频交互 | `volc_faas_microservice` with reserved instances | `volc_cloud_sandbox` with image warmup |
| 本地开发 | `local_process` | `local_docker` |
| 浏览器/Computer Use 快速试验 | `volc_faas_task` | `e2b_browser_template` |
| 浏览器/Computer Use 生产化 | `volc_faas_task` | `volc_cloud_sandbox` browser image |
| 大型 workspace | `volc_faas_task` | `volc_cloud_sandbox` + TOS/NAS mount |
| 跨云/成熟模板复用 | `volc_faas_task` | `e2b` |
| 未来替换 | `k8s` or `vci` | internal sandbox or `custom` |

## 12. Agent Inbound Auth 与 A2A Hub 设计

### 12.1 Inbound Auth 分层

Agent 创建之后必须明确“谁可以调用这个 Agent”。这里和 Console 管理权限是两层：

| 层级 | 解决的问题 | 首期实现 |
|---|---|---|
| Control Plane Auth | 谁能创建、编辑、删除、发布 Agent | `workspace_memberships.role` + Console session/API key。 |
| Agent Inbound Auth | 谁能调用 Agent 创建 session、发消息、读事件、取 artifact | Agent-scoped API key + `agent_inbound_auth_policies`。 |
| Delegated Auth | 第三方应用代表用户调用某个 Agent | 后续 OAuth2/OIDC client、consent、scoped access token。 |
| Agent-to-Agent Auth | 另一个 agent 通过 A2A 调用该 Agent | A2A Gateway 复用 inbound auth policy，额外校验 peer agent trust。 |

第一阶段只做 API key，但 API key 必须是 scoped，不做 workspace 万能 key 直通所有 Agent。推荐两类 key：

| Key 类型 | 用途 | 限制 |
|---|---|---|
| Workspace API Key | 后端管理资源、CI/CD、内部服务 | 默认不能调用所有 Agent，必须带 resource policy 或显式 grant。 |
| Agent API Key | 外部应用调用某个或某组 Agent | 绑定 `agent_id`、scope、rate limit、allowed origins/IP、可选环境。 |

### 12.2 Agent Inbound Policy

每个 Agent 有一份 inbound policy，默认 `private`：

```json
{
  "mode": "api_key",
  "default_deny": true,
  "allowed_auth_methods": ["api_key"],
  "required_scopes": ["agent:invoke", "sessions:create", "sessions:events:write"],
  "session_policy": {
    "allowed_environment_ids": ["env_prod_faas_switchable_sandbox"],
    "max_concurrent_sessions": 20,
    "max_session_ttl_seconds": 86400,
    "allow_sandbox_override": false
  },
  "network_policy": {
    "allowed_origins": ["https://app.customer.com"],
    "allowed_cidrs": ["203.0.113.0/24"]
  },
  "rate_limit": {
    "requests_per_minute": 120,
    "tokens_per_day": 1000000
  }
}
```

Inbound Gateway 校验顺序：

1. 解析 API key 或 OAuth bearer token。
2. 校验 key/token hash、状态、过期时间、workspace 归属。
3. 读取 `agent_inbound_auth_policies`，确认 Agent 是否允许该 auth method。
4. 校验 `agent_access_grants`，确认 principal 对该 `agent_id` 有调用权限。
5. 校验 scope，例如 `agent:invoke`、`sessions:create`、`sessions:events:write`、`sessions:events:read`、`artifacts:read`。
6. 校验 origin/IP、rate limit、quota、environment override 权限。
7. 写入 `inbound_request_logs` 和 `audit_logs`。
8. 创建 session/run，并把 caller identity 写入 `sessions.metadata_json.caller`，供审计、策略和计费使用。

### 12.3 Inbound API

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/v1/agents/{agent_id}/inbound/api_keys` | 创建 Agent-scoped API key。 |
| `GET` | `/v1/agents/{agent_id}/inbound/api_keys` | 查询该 Agent 的 inbound keys。 |
| `PATCH` | `/v1/agents/{agent_id}/inbound/policy` | 更新 inbound auth policy。 |
| `GET` | `/v1/agents/{agent_id}/inbound/policy` | 获取 inbound auth policy。 |
| `POST` | `/v1/agents/{agent_id}/invoke` | 快速调用 Agent，内部创建 session 并发送首条 user.message。 |
| `POST` | `/v1/agents/{agent_id}/sessions` | 使用 inbound auth 创建 session。 |
| `POST` | `/v1/agents/{agent_id}/sessions/{session_id}/events` | 使用 inbound auth 发送事件。 |
| `GET` | `/v1/agents/{agent_id}/sessions/{session_id}/events/stream` | 使用 inbound auth 消费 SSE。 |

API key 示例：

```http
POST /v1/agents/agent_xxx/invoke
Authorization: Bearer ma_agent_key_xxx
Content-Type: application/json

{
  "input": [{"type": "text", "text": "帮我查询退款政策"}],
  "metadata": {"customer_user_id": "cust_123"}
}
```

### 12.4 OAuth/OIDC 扩展路径

未来支持第三方应用授权访问 Agent 时，不要复用用户登录 OAuth 表，单独建 Agent inbound OAuth：

| 对象 | 说明 |
|---|---|
| `oauth_clients` | 第三方应用注册，绑定 workspace，配置 redirect URI、client secret、allowed scopes。 |
| `oauth_authorizations` | 用户/管理员授权某 client 调用某些 agents。 |
| `oauth_access_tokens` | 短期 access token，只存 hash，绑定 scopes、agent grants、workspace。 |
| `oauth_refresh_tokens` | 可选，需 rotation 和撤销。 |

授权模型：

- Client 只能请求 `agent:invoke`、`sessions:create`、`sessions:events:write/read`、`artifacts:read` 等 inbound scopes。
- 授权对象可以是 workspace admin，也可以是 end user；两者语义不同，要在 token claims 中区分 `actor_user_id` 与 `client_id`。
- OAuth token 只表达“可以调用哪个 Agent 和哪些动作”，不能自动继承 Console 管理权限。

### 12.5 Agent Hub 与 A2A Gateway

Agent Hub 是平台在 Anthropic Managed Agents 之上的创新层：把创建出来的 Agent 发布成可发现、可授权、可互调的能力单元。A2A 支持应当做成“可发布能力”，不要求所有草稿 Agent 默认公网暴露。

| 模块 | 职责 |
|---|---|
| Agent Hub Registry | 管理已发布 Agent、可见性、分类、版本、能力标签、评分/审核、owner workspace。 |
| Agent Card Service | 生成 A2A Agent Card，描述 name、description、skills、capabilities、endpoint、auth requirements。 |
| A2A Gateway | 对外暴露 A2A endpoint，协议转换到内部 Session/Run/Event/Artifact。 |
| A2A Task Mapper | 将 A2A `Task` 映射到 `sessions/session_runs`，将 `Message` 映射到 `session_events`，将 `Artifact` 映射到 `artifacts`。 |
| Trust & Policy Engine | 控制哪些 peer agents/clients 可以发现、调用、订阅或取消任务。 |

对外端点建议：

| 路径 | 说明 |
|---|---|
| `GET /a2a/{workspace_slug}/{agent_slug}/.well-known/agent-card.json` | 获取公开或授权后的 Agent Card。 |
| `POST /a2a/{workspace_slug}/{agent_slug}` | A2A JSON-RPC over HTTP endpoint。 |
| `GET /a2a/{workspace_slug}/{agent_slug}/tasks/{task_id}/events` | A2A streaming/SSE 兼容入口。 |
| `GET /v1/agent_hub/agents` | 平台内 Hub 搜索和发现。 |
| `POST /v1/agents/{agent_id}/publish` | 发布到 Hub，可选择是否启用 A2A。 |

A2A 到内部模型映射：

| A2A 概念 | 平台内部对象 |
|---|---|
| `AgentCard` | `agent_publications.agent_card_json` + `agent_versions` snapshot。 |
| `SendMessage` | 创建或续写 `session_events user.message`，触发 `work_items`。 |
| `SendStreamingMessage` | 写入 message 后返回 SSE/stream，消费 `session_events`。 |
| `Task` | `session_runs`，task id 使用服务端生成的 `a2a_tasks.id`。 |
| `Message` | `session_events.payload_json.content`。 |
| `Artifact` | `artifacts` + `session_resources`。 |
| `CancelTask` | `work_items.status=stopping` + runtime terminate。 |
| `SubscribeToTask` | `session_events` cursor/SSE 订阅。 |

### 12.6 A2A 安全策略

- Agent Card 只展示该 caller 有权看到的信息；public card 不泄露内部模型、vault、私有 tool 名称。
- A2A endpoint 复用 inbound auth：首期支持 Agent API key，后续支持 OAuth2 bearer、mTLS、JWT client assertion。
- Hub visibility 分为 `private`、`workspace`、`organization`、`public`；默认 `private`。
- A2A peer agent 要有 `agent_access_grants`，可以按 peer `agent_publication_id`、workspace、client_id 或 API key 维度授权。
- 所有 A2A 调用写入 `a2a_tasks`、`a2a_messages`、`inbound_request_logs`、`audit_logs`。
- A2A 不绕过 human approval、tool permission、vault policy；被调用 Agent 的原有策略仍然生效。
- 对 A2A loop 做保护：最大 delegation depth、最大 fanout、task budget、token budget、cycle detection。

## 13. 数据库设计

### 13.1 ER 图

<whiteboard type="mermaid">erDiagram
  users ||--o{ auth_sessions : owns
  users ||--o{ user_identities : login_with
  users ||--o{ api_keys : owns
  users ||--o{ user_profiles : has
  users ||--o{ workspace_memberships : joins
  users ||--o{ audit_logs : acts
  identity_providers ||--o{ user_identities : issues
  identity_providers ||--o{ workspace_identity_providers : allowed
  workspaces ||--o{ workspace_memberships : has
  workspaces ||--o{ workspace_domains : verifies
  workspaces ||--o{ workspace_invitations : invites
  workspaces ||--o{ workspace_identity_providers : configures
  workspaces ||--o{ api_keys : scopes
  workspaces ||--o{ agents : owns
  workspaces ||--o{ environments : owns
  workspaces ||--o{ files : owns
  workspaces ||--o{ vaults : owns
  workspaces ||--o{ memory_stores : owns
  workspaces ||--o{ webhooks : owns
  agents ||--o{ agent_versions : versions
  agents ||--o{ sessions : creates
  agents ||--o{ agent_inbound_auth_policies : protects
  agents ||--o{ agent_access_grants : grants
  agents ||--o{ agent_publications : publishes
  agent_versions ||--o{ agent_skills : binds
  api_keys ||--o{ agent_access_grants : authorizes
  oauth_clients ||--o{ agent_access_grants : authorizes
  oauth_clients ||--o{ oauth_authorizations : consented
  oauth_authorizations ||--o{ oauth_access_tokens : issues
  agent_publications ||--o{ a2a_peer_agents : trusts
  agent_publications ||--o{ a2a_tasks : exposes
  a2a_tasks ||--o{ a2a_messages : messages
  a2a_tasks ||--o{ a2a_artifacts : artifacts
  skills ||--o{ skill_versions : versions
  skills ||--o{ agent_skills : used_by
  environments ||--o{ sessions : hosts
  sessions ||--o{ session_runs : runs
  sessions ||--o{ session_threads : threads
  sessions ||--o{ session_events : events
  sessions ||--o{ session_resources : resources
  sessions ||--o{ session_vaults : vaults
  session_runs ||--o{ work_items : work
  session_runs ||--o{ runtime_instances : instances
  work_items ||--o{ work_heartbeats : heartbeats
  session_events ||--o{ tool_calls : tool_calls
  files ||--o{ session_resources : mounted
  memory_stores ||--o{ session_resources : mounted
  memory_stores ||--o{ memories : contains
  memories ||--o{ memory_versions : versions
  vaults ||--o{ vault_credentials : credentials
  vaults ||--o{ session_vaults : mounted
  artifacts ||--o{ session_events : announced
  webhooks ||--o{ webhook_deliveries : deliveries
</whiteboard>

### 13.2 核心表

| 表 | 关键字段 | 说明 |
|---|---|---|
| `users` | `id,email,email_verified,name,avatar_url,status,primary_workspace_id,metadata_json` | 平台自然人账号，不绑定单一登录方式。 |
| `identity_providers` | `id,provider,display_name,type,client_id,enabled,config_json` | 登录 provider 配置，支持 `lark/google/github`。 |
| `user_identities` | `id,user_id,provider,provider_subject,provider_tenant_id,email,email_verified,username,avatar_url,provider_token_ref,last_login_at` | 第三方登录身份；`provider_subject` 为 Lark open_id/union_id、Google sub、GitHub user id。 |
| `oauth_states` | `id,provider,state_hash,pkce_verifier_ref,redirect_uri,intent,workspace_hint,invitation_id,expires_at,used_at` | OAuth/OIDC 登录注册临时状态。 |
| `auth_sessions` | `id,token_hash,user_id,workspace_id,expires_at,last_seen_at,ip_hash,user_agent_hash` | Console 登录态。 |
| `workspaces` | `id,name,slug,type,status,created_by,billing_plan,quota_json,metadata_json` | 客户/组织/个人工作区，资源归属与计费边界。 |
| `workspace_memberships` | `workspace_id,user_id,role,status,joined_at,last_seen_at` | 用户在 workspace 下的角色。 |
| `workspace_domains` | `id,workspace_id,domain,verified_at,auto_join,provider_hint` | 企业域名校验与自动加入规则。 |
| `workspace_invitations` | `id,workspace_id,email,role,token_hash,invited_by,expires_at,accepted_at,revoked_at` | 邀请成员加入 workspace。 |
| `workspace_identity_providers` | `workspace_id,provider,enabled,auto_join,config_json` | workspace 允许的登录方式和企业 SSO 策略。 |
| `api_keys` | `id,workspace_id,user_id,key_hash,key_prefix,scope_json,quota_json,enabled` | SDK/REST API key，作用域绑定 workspace。 |
| `agent_inbound_auth_policies` | `id,workspace_id,agent_id,mode,allowed_auth_methods,required_scopes_json,session_policy_json,network_policy_json,rate_limit_json,status` | Agent inbound auth policy，默认 private。 |
| `agent_access_grants` | `id,workspace_id,agent_id,principal_type,principal_id,scopes_json,resource_policy_json,expires_at,status` | 授权某 API key、OAuth client、peer agent 调用某 Agent。 |
| `inbound_request_logs` | `id,workspace_id,agent_id,principal_type,principal_id,auth_method,scope,session_id,status,error_code,ip_hash,user_agent_hash,created_at` | Agent inbound 调用审计、限流和排障。 |
| `oauth_clients` | `id,workspace_id,name,client_id,client_secret_ref,redirect_uris_json,allowed_scopes_json,status` | 未来第三方应用 OAuth client。 |
| `oauth_authorizations` | `id,workspace_id,client_id,user_id,agent_ids_json,scopes_json,status,created_at,revoked_at` | 用户/管理员授权第三方应用调用 Agent。 |
| `oauth_access_tokens` | `id,workspace_id,client_id,user_id,token_hash,scopes_json,agent_grants_json,expires_at,revoked_at` | Agent inbound OAuth access token，只存 hash。 |
| `oauth_refresh_tokens` | `id,access_token_id,token_hash,rotated_from_id,expires_at,revoked_at` | 可选 refresh token，必须 rotation。 |
| `user_profiles` | `id,user_id,profile_json,enrollment_status` | 偏好、组织上下文、个人记忆入口。 |
| `agents` | `id,workspace_id,name,description,current_version,archived_at,metadata_json` | Agent 逻辑实体。 |
| `agent_versions` | `id,agent_id,version,model_json,system,tools_json,mcp_servers_json,skills_json,multiagent_json,runtime_json,config_hash` | 不可变版本。 |
| `agent_publications` | `id,workspace_id,agent_id,agent_version,slug,visibility,a2a_enabled,agent_card_json,endpoint_url,status,published_at` | Agent Hub 发布记录和 A2A Agent Card。 |
| `a2a_peer_agents` | `id,workspace_id,publication_id,peer_agent_card_url,peer_agent_subject,trust_level,metadata_json,status` | 受信任或已安装的 peer agents。 |
| `a2a_tasks` | `id,workspace_id,publication_id,session_id,run_id,external_task_id,status,caller_principal_json,metadata_json,created_at,updated_at` | A2A Task 到内部 session/run 的映射。 |
| `a2a_messages` | `id,a2a_task_id,session_event_id,role,parts_json,metadata_json,created_at` | A2A Message 映射。 |
| `a2a_artifacts` | `id,a2a_task_id,artifact_id,parts_json,metadata_json,created_at` | A2A Artifact 映射。 |
| `environments` | `id,workspace_id,name,description,scope,agent_runtime_json,sandbox_runtime_json,networking_json,storage_json,package_json,archived_at` | Environment 模板；sandbox provider 选择写入 `sandbox_runtime_json.provider`。 |
| `sessions` | `id,workspace_id,title,agent_id,agent_version,agent_snapshot_json,environment_id,status,usage_json,metadata_json,archived_at` | 运行实例。 |
| `session_runs` | `id,session_id,status,input_event_id,started_at,ended_at,error_json,provider_run_id` | 一次用户消息触发的一轮 run。 |
| `session_threads` | `id,session_id,agent_id,agent_version,parent_thread_id,role,status` | multi-agent thread。 |
| `session_events` | `id,session_id,thread_id,run_id,seq,type,direction,source,external_event_id,payload_json,created_at,processed_at` | append-only 事件日志。 |
| `session_resources` | `id,session_id,type,resource_id,mount_path,access,instructions,metadata_json` | file/memory/git/artifact 挂载。 |
| `tool_calls` | `id,session_id,thread_id,run_id,event_id,tool_name,sandbox_instance_id,sandbox_provider,input_json,output_json,status,permission_policy,approval_status` | 工具调用审计，记录实际使用的火山云沙箱/E2B/local provider。 |
| `work_items` | `id,session_id,run_id,type,status,lease_owner,lease_expires_at,attempt,payload_json,result_json` | runtime work queue。 |
| `work_heartbeats` | `id,work_item_id,runtime_instance_id,status,metrics_json,created_at` | runner 心跳。 |
| `runtime_instances` | `id,runtime_role,provider,session_id,run_id,external_id,status,endpoint,image_or_template,region,cost_json,metadata_json,started_at,stopped_at` | Agent runner 与 sandbox 实例映射；`runtime_role` 为 `agent_runner` 或 `sandbox`。 |
| `files` | `id,workspace_id,filename,mime_type,size_bytes,sha256,storage_ref,purpose,deleted_at` | 文件资源。 |
| `artifacts` | `id,session_id,run_id,path,mime_type,size_bytes,sha256,storage_ref,metadata_json` | 运行产物。 |
| `vaults` | `id,workspace_id,display_name,scope,metadata_json,archived_at` | 凭证集合。 |
| `vault_credentials` | `id,vault_id,name,auth_type,secret_ref,scopes_json,status,last_validated_at,expires_at` | 凭证元数据，secret 不入库。 |
| `memory_stores` | `id,workspace_id,name,description,metadata_json,archived_at` | 长期记忆容器。 |
| `memories` | `id,memory_store_id,path,current_version_id,content_sha256,content_size_bytes,updated_at` | path-based memory。 |
| `memory_versions` | `id,memory_id,content,content_sha256,actor_type,actor_id,session_id,redacted_at` | 可审计版本。 |
| `skills` | `id,workspace_id,name,source_type,source_path,current_version,metadata_json` | Skill 注册表。 |
| `skill_versions` | `id,skill_id,version,manifest_json,content_hash,storage_ref` | Skill 版本内容。 |
| `agent_skills` | `agent_version_id,skill_id,skill_version,config_json` | Agent 与 skill 绑定。 |
| `webhooks` | `id,workspace_id,owner_id,url,secret_ref,event_types_json,status` | webhook 配置。 |
| `webhook_deliveries` | `id,webhook_id,event_id,status,attempts,next_retry_at,response_status,error_json` | 投递记录。 |
| `audit_logs` | `id,workspace_id,actor_user_id,action,resource_type,resource_id,ip_hash,user_agent_hash,metadata_json,created_at` | 登录、注册、身份绑定、成员管理、API key、secret 访问等审计。 |

### 13.3 关键索引

```sql
CREATE UNIQUE INDEX uniq_agent_version ON agent_versions(agent_id, version);
CREATE UNIQUE INDEX uniq_user_identity ON user_identities(provider, provider_subject);
CREATE UNIQUE INDEX uniq_workspace_slug ON workspaces(slug);
CREATE UNIQUE INDEX uniq_workspace_member ON workspace_memberships(workspace_id, user_id);
CREATE UNIQUE INDEX uniq_workspace_domain ON workspace_domains(domain);
CREATE INDEX idx_agent_inbound_policy ON agent_inbound_auth_policies(agent_id, status);
CREATE INDEX idx_agent_access_grants ON agent_access_grants(agent_id, principal_type, principal_id, status);
CREATE INDEX idx_inbound_request_logs_agent ON inbound_request_logs(agent_id, created_at DESC);
CREATE UNIQUE INDEX uniq_oauth_client_id ON oauth_clients(client_id);
CREATE UNIQUE INDEX uniq_agent_publication_slug ON agent_publications(workspace_id, slug);
CREATE INDEX idx_a2a_tasks_publication_status ON a2a_tasks(publication_id, status, updated_at DESC);
CREATE INDEX idx_sessions_status_updated ON sessions(status, updated_at DESC);
CREATE INDEX idx_sessions_workspace_status ON sessions(workspace_id, status, updated_at DESC);
CREATE UNIQUE INDEX uniq_session_event_seq ON session_events(session_id, seq);
CREATE INDEX idx_session_events_run ON session_events(run_id, seq);
CREATE INDEX idx_work_items_status_lease ON work_items(status, lease_expires_at);
CREATE INDEX idx_runtime_instances_external ON runtime_instances(provider, external_id);
CREATE INDEX idx_runtime_instances_role_provider ON runtime_instances(runtime_role, provider, status);
CREATE INDEX idx_tool_calls_sandbox ON tool_calls(sandbox_provider, sandbox_instance_id);
CREATE UNIQUE INDEX uniq_memory_path ON memories(memory_store_id, path);
CREATE INDEX idx_webhook_delivery_retry ON webhook_deliveries(status, next_retry_at);
```

## 14. API 设计

API 风格以 `/v1` 为稳定前缀，尽量贴近 Anthropic Managed Agents beta，但保留自研扩展字段。

### 14.1 Accounts / Auth / Workspaces

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/v1/auth/providers` | 获取当前部署启用的登录 provider，例如 Lark、Google、GitHub。 |
| `POST` | `/v1/auth/oauth/{provider}/start` | 创建 OAuth state，返回 redirect URL。 |
| `GET` | `/v1/auth/oauth/{provider}/callback` | OAuth callback，完成登录或注册。 |
| `POST` | `/v1/auth/logout` | 退出当前会话。 |
| `GET` | `/v1/me` | 获取当前用户、identities、workspaces。 |
| `POST` | `/v1/me/identities/{provider}/link` | 已登录用户绑定新的第三方身份。 |
| `DELETE` | `/v1/me/identities/{identity_id}` | 解绑第三方身份，至少保留一个可登录身份。 |
| `POST` | `/v1/workspaces` | 创建个人或组织 workspace。 |
| `GET` | `/v1/workspaces` | 查询当前用户可访问 workspace。 |
| `POST` | `/v1/workspaces/{id}/invitations` | 邀请成员。 |
| `POST` | `/v1/workspaces/{id}/join` | 通过 invitation token 或 domain rule 加入 workspace。 |
| `PATCH` | `/v1/workspaces/{id}/members/{user_id}` | 修改成员角色。 |
| `DELETE` | `/v1/workspaces/{id}/members/{user_id}` | 移除成员。 |

OAuth start:

```json
{
  "provider": "google",
  "redirect_uri": "https://agents.example.com/auth/callback/google",
  "intent": "login_or_signup",
  "workspace_hint": "ws_xxx",
  "invitation_token": "invite_xxx"
}
```

登录成功响应：

```json
{
  "user": {"id": "user_xxx", "email": "user@example.com", "name": "Alex"},
  "current_workspace": {"id": "ws_xxx", "name": "Acme AI", "role": "admin"},
  "identities": [
    {"provider": "google", "email": "user@example.com", "verified": true},
    {"provider": "github", "username": "alex-dev", "verified": true}
  ],
  "session": {"expires_at": "2026-06-11T12:00:00Z"}
}
```

### 14.2 Agents

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/v1/agents` | 创建 agent，生成 v1。 |
| `GET` | `/v1/agents` | 分页查询。 |
| `GET` | `/v1/agents/{agent_id}` | 获取当前版本。 |
| `PATCH` | `/v1/agents/{agent_id}` | 更新并生成新版本。 |
| `POST` | `/v1/agents/{agent_id}/archive` | 归档。 |
| `GET` | `/v1/agents/{agent_id}/versions` | 版本列表。 |

```json
{
  "name": "ecommerce-support-agent",
  "description": "电商客服 Agent",
  "model": {
    "provider": "model_pool",
    "model": "doubao-seed-1.6",
    "config_id": "model_cfg_xxx"
  },
  "system": "你是电商客服助理...",
  "tools": [{"type": "agent_toolset_20260401"}],
  "skills": [{"type": "skill", "id": "skill_lark_doc", "version": 3}],
  "mcp_servers": [{"type": "url", "name": "github", "url": "https://example.com/mcp"}],
  "agent_runtime": {
    "provider": "volc_faas_task",
    "runner_image": "cr.volces.com/org/agent-runner:2026-06-04"
  },
  "metadata": {"team": "platform"}
}
```

### 14.3 Agent Inbound Auth / Agent Hub / A2A

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/v1/agents/{agent_id}/inbound/policy` | 获取 Agent inbound auth policy。 |
| `PATCH` | `/v1/agents/{agent_id}/inbound/policy` | 更新 Agent inbound auth policy。 |
| `POST` | `/v1/agents/{agent_id}/inbound/api_keys` | 创建 Agent-scoped API key。 |
| `GET` | `/v1/agents/{agent_id}/inbound/api_keys` | 查询 Agent inbound API keys。 |
| `POST` | `/v1/agents/{agent_id}/invoke` | 使用 inbound auth 快速调用 Agent。 |
| `POST` | `/v1/agents/{agent_id}/publish` | 发布到 Agent Hub，可启用 A2A。 |
| `GET` | `/v1/agent_hub/agents` | 搜索可发现 Agent。 |
| `GET` | `/v1/agent_hub/agents/{publication_id}` | 查看发布信息、Agent Card、权限要求。 |
| `GET` | `/a2a/{workspace_slug}/{agent_slug}/.well-known/agent-card.json` | A2A Agent Card。 |
| `POST` | `/a2a/{workspace_slug}/{agent_slug}` | A2A JSON-RPC endpoint。 |

Agent-scoped API key:

```json
{
  "name": "customer-app-prod",
  "scopes": ["agent:invoke", "sessions:create", "sessions:events:write", "sessions:events:read"],
  "resource_policy": {
    "agent_ids": ["agent_xxx"],
    "allowed_environment_ids": ["env_prod_faas_switchable_sandbox"]
  },
  "rate_limit": {"requests_per_minute": 120},
  "expires_at": "2026-12-31T23:59:59Z"
}
```

A2A publish:

```json
{
  "slug": "refund-policy-agent",
  "visibility": "workspace",
  "a2a_enabled": true,
  "agent_card": {
    "name": "Refund Policy Agent",
    "description": "Handles refund policy questions",
    "capabilities": {"streaming": true, "pushNotifications": false},
    "security": [{"type": "apiKey", "scope": "agent:invoke"}]
  }
}
```

### 14.4 Environments

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/v1/environments` | 创建运行环境模板。 |
| `GET` | `/v1/environments` | 查询环境。 |
| `GET` | `/v1/environments/{id}` | 详情。 |
| `PATCH` | `/v1/environments/{id}` | 更新配置。 |
| `POST` | `/v1/environments/{id}/archive` | 归档。 |
| `DELETE` | `/v1/environments/{id}` | 删除未使用环境。 |
| `GET` | `/v1/runtime_providers/sandbox` | 查询可用 sandbox provider、能力、配额与默认镜像/template。 |
| `POST` | `/v1/environments/{id}/sandbox_runtime/validate` | 校验火山云沙箱/E2B 配置是否可创建、联网、读写 workspace。 |

```json
{
  "name": "prod-faas-switchable-sandbox",
  "description": "生产默认运行环境",
  "scope": "organization",
  "agent_runtime": {
    "provider": "volc_faas_task",
    "region": "cn-beijing",
    "function_id": "vefaas_fn_xxx",
    "async_task": {"timeout_seconds": 10800, "max_retry": 1},
    "reserved_instances": 1
  },
  "sandbox_runtime": {
    "provider": "volc_cloud_sandbox",
    "fallback_provider": "e2b",
    "capabilities": ["bash", "filesystem", "browser"],
    "volc_cloud_sandbox": {
      "region": "cn-beijing",
      "image": "managed-agent-browser:2026-06-04",
      "cpu_milli": 2000,
      "memory_mb": 4096,
      "timeout_minutes": 120,
      "workspace_path": "/workspace",
      "tos_mount": "tos://bucket/managed-agent-workspaces"
    },
    "e2b": {
      "template": "base",
      "timeout_ms": 3600000,
      "workspace_path": "/workspace"
    }
  },
  "networking": {
    "mode": "limited",
    "allow_public_internet": true,
    "allowed_hosts": ["ark.cn-beijing.volces.com", "open.volcengineapi.com", "api.e2b.dev"]
  },
  "storage": {
    "artifact_store": "tos://bucket/managed-agent-artifacts",
    "workspace_store": "tos://bucket/managed-agent-workspaces"
  }
}
```

### 14.5 Sessions 与 Events

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/v1/sessions` | 创建 session，保存 agent snapshot。 |
| `GET` | `/v1/sessions` | 查询 sessions。 |
| `GET` | `/v1/sessions/{id}` | 获取 session。 |
| `PATCH` | `/v1/sessions/{id}` | 更新 title/metadata。 |
| `POST` | `/v1/sessions/{id}/archive` | 归档。 |
| `DELETE` | `/v1/sessions/{id}` | 删除。 |
| `POST` | `/v1/sessions/{id}/events` | 发送用户消息、approval、interrupt。 |
| `GET` | `/v1/sessions/{id}/events` | 事件列表。 |
| `GET` | `/v1/sessions/{id}/events/stream` | SSE 流。 |

```json
{
  "agent": {"type": "agent", "id": "agent_xxx", "version": 3},
  "environment_id": "env_prod_faas_switchable_sandbox",
  "sandbox_runtime_override": {
    "provider": "e2b",
    "reason": "reuse existing browser template for this session"
  },
  "title": "售后退换货咨询",
  "vault_ids": ["vault_prod"],
  "resources": [
    {"type": "memory_store", "memory_store_id": "mem_store_shop", "access": "read_write"},
    {"type": "file", "file_id": "file_policy_pdf", "mount_path": "/inputs/policy.pdf"}
  ],
  "metadata": {"customer_id": "cust_123"}
}
```

事件发送：

```json
{
  "events": [
    {
      "type": "user.message",
      "content": [{"type": "text", "text": "我买的衣服想退货，怎么操作？"}],
      "metadata": {"client_event_id": "evt_client_001"}
    }
  ]
}
```

SSE：

```text
event: agent.message
id: 42
data: {"type":"agent.message","content":[{"type":"text","text":"您好..."}]}

event: session.status_idle
id: 43
data: {"type":"session.status_idle","reason":"end_turn"}
```

### 14.6 Resources / Files / Artifacts

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/v1/files` | 上传文件。 |
| `GET` | `/v1/files` | 查询文件。 |
| `GET` | `/v1/files/{id}/download` | 下载。 |
| `DELETE` | `/v1/files/{id}` | 删除。 |
| `POST` | `/v1/sessions/{id}/resources` | 添加 session resource。 |
| `GET` | `/v1/sessions/{id}/resources` | 列表。 |
| `PATCH` | `/v1/sessions/{id}/resources/{resource_id}` | 更新。 |
| `DELETE` | `/v1/sessions/{id}/resources/{resource_id}` | 删除。 |
| `GET` | `/v1/sessions/{id}/artifacts` | 查询产物。 |
| `GET` | `/v1/artifacts/{id}/download` | 下载产物。 |

### 14.7 Vaults / Memory / Skills / Webhooks

| 资源 | API |
|---|---|
| Vaults | `POST /v1/vaults`、`GET /v1/vaults`、`PATCH /v1/vaults/{id}`、`POST /v1/vaults/{id}/archive` |
| Credentials | `POST /v1/vaults/{id}/credentials`、`GET /v1/vaults/{id}/credentials`、`POST /v1/vaults/{id}/credentials/{cid}/validate` |
| Memory Stores | `POST /v1/memory_stores`、`GET /v1/memory_stores`、`PATCH /v1/memory_stores/{id}` |
| Memories | `PUT /v1/memory_stores/{id}/memories/{path}`、`GET /v1/memory_stores/{id}/memories`、`GET /v1/memory_stores/{id}/memories/{path}` |
| Memory Versions | `GET /v1/memory_stores/{id}/memory_versions`、`POST /v1/memory_versions/{id}/redact` |
| Skills | `POST /v1/skills`、`GET /v1/skills`、`GET /v1/skills/{id}`、`POST /v1/skills/{id}/versions` |
| Webhooks | `POST /v1/webhooks`、`GET /v1/webhooks`、`PATCH /v1/webhooks/{id}`、`DELETE /v1/webhooks/{id}` |

## 15. 客户端 SDK 设计

### 15.1 TypeScript SDK

```ts
import { MapleClient } from "@maple/launch-sdk";

const client = new MapleClient({
  apiKey: process.env.LMAP_API_KEY,
  baseUrl: "https://agents.example.com"
});

const session = await client.sessions.create({
  agent: { type: "agent", id: "agent_xxx", version: 3 },
  environmentId: "env_prod_faas_switchable_sandbox",
  resources: [
    { type: "memory_store", memoryStoreId: "mem_store_shop", access: "read_write" }
  ]
});

const stream = client.sessions.events.stream(session.id);

await client.sessions.events.send(session.id, {
  events: [
    {
      type: "user.message",
      content: [{ type: "text", text: "帮我查一下退货规则" }]
    }
  ]
});

for await (const event of stream) {
  if (event.type === "agent.message") {
    process.stdout.write(event.content.map((x) => x.text ?? "").join(""));
  }
  if (event.type === "session.status_idle") break;
}
```

### 15.2 Python SDK

```python
from managed_agents import ManagedAgents

client = ManagedAgents(api_key="ma_key_xxx", base_url="https://agents.example.com")

session = client.sessions.create(
    agent={"type": "agent", "id": "agent_xxx", "version": 3},
    environment_id="env_prod_faas_switchable_sandbox",
)

client.sessions.events.send(
    session.id,
    events=[{
        "type": "user.message",
        "content": [{"type": "text", "text": "请生成本周客服问题摘要"}],
    }],
)

for event in client.sessions.events.stream(session.id):
    print(event)
    if event["type"] == "session.status_idle":
        break
```

### 15.3 SDK 模块

| 模块 | 方法 |
|---|---|
| `client.auth` | `providers`、`oauth.start`、`logout`、`me` |
| `client.workspaces` | `create`、`list`、`retrieve`、`invitations.create`、`members.update`、`members.remove` |
| `client.agents` | `create`、`list`、`retrieve`、`update`、`archive`、`versions.list` |
| `client.agents.inbound` | `policy.retrieve`、`policy.update`、`apiKeys.create`、`apiKeys.list`、`invoke` |
| `client.agentHub` | `list`、`retrieve`、`publish`、`unpublish`、`agentCard.retrieve` |
| `client.a2a` | `sendMessage`、`sendStreamingMessage`、`getTask`、`cancelTask`、`subscribeToTask` |
| `client.environments` | `create`、`list`、`retrieve`、`update`、`archive` |
| `client.sessions` | `create`、`list`、`retrieve`、`update`、`archive`、`delete` |
| `client.sessions.events` | `send`、`list`、`stream` |
| `client.sessions.resources` | `add`、`list`、`retrieve`、`update`、`delete` |
| `client.files` | `upload`、`list`、`retrieveMetadata`、`download`、`delete` |
| `client.memoryStores` | store/memory/version CRUD |
| `client.vaults` | vault/credential CRUD and validate |
| `client.webhooks` | CRUD、signature verify helper |

### 15.4 Webhook 校验

```ts
import { verifyWebhook } from "@maple/launch-sdk/webhooks";

app.post("/managed-agent-webhook", express.raw({ type: "application/json" }), (req, res) => {
  const event = verifyWebhook({
    body: req.body,
    headers: req.headers,
    secret: process.env.MANAGED_AGENT_WEBHOOK_SECRET
  });

  if (event.type === "session.status_idle") {
    // update business record
  }
  res.status(204).end();
});
```

## 16. 用户接入方式

| 接入方式 | 目标用户 | 能力 |
|---|---|---|
| Login / Signup | 新用户、客户管理员、开发者 | 使用飞书、Google/Gmail、GitHub 登录注册；创建或加入 workspace。 |
| Console | 产品、运营、开发者 | 创建 agent、配置 environment、测试 session、查看 events、管理 vault/memory/skills。 |
| REST API | 后端系统 | 完整资源管理、session run、file upload、webhook。 |
| Agent Inbound API | 客户业务系统 | 使用 Agent-scoped API key 调用指定 Agent，创建 session、发送消息、消费 SSE、读取 artifact。 |
| A2A Endpoint | 其他 Agent / Agent Hub | 通过 A2A Agent Card 发现能力，并用 A2A JSON-RPC/SSE 与 Agent 互调。 |
| TypeScript/Python SDK | 应用开发者 | 简化 session、SSE、webhook、文件和资源挂载。 |
| Maple CLI | 内部研发/调试 | 本地创建 agent、运行 session、导出 artifact、查看 event log。 |
| Webhook | 业务系统 | 接收 run completed、failed、artifact created、approval required 等事件。 |
| Embedded Widget | SaaS 控制台 | 嵌入 transcript、agent status、artifact preview。 |

## 17. Console 产品设计

| 页面 | 关键功能 |
|---|---|
| Login / Signup | Continue with Lark、Google、GitHub；邀请链接注册；企业域名自动加入；首次创建 workspace。 |
| Account Settings | 个人资料、已绑定 identities、绑定/解绑飞书/Google/GitHub、会话管理。 |
| Workspace Settings | workspace 基本信息、成员、角色、邀请、企业域名、允许登录 provider、审计日志。 |
| Quickstart | 自然语言生成 agent；YAML/JSON 精调；创建 environment；test run；生成集成代码。 |
| Agents | 列表、过滤、详情、版本、archive、clone、模板化。 |
| Agent Inbound Auth | 访问模式 private/api_key/oauth、Agent-scoped API keys、scope、rate limit、allowed origins/IP、调用日志。 |
| Agent Hub | 发布/下架 Agent、设置 visibility、生成 Agent Card、启用 A2A endpoint、查看安装/调用统计。 |
| Environments | FaaS provider、Sandbox provider 切换、火山云沙箱镜像、E2B template、网络、存储、预留实例、包。 |
| Sessions | Transcript、Debug events、runs、threads、resources、artifacts、stop/resume。 |
| Vaults | vault 列表、credential、OAuth validate、使用范围、安全提示。 |
| Memory Stores | memory tree、内容编辑、版本历史、redact、resource mount。 |
| Skills | skill 列表、目录树、文件查看/编辑/保存、版本冻结。 |
| Files/Artifacts | 文件上传、产物预览、下载、绑定 session。 |
| Model Pool | provider 配置、key 管理、限额、默认模型。 |
| Webhooks | URL、事件类型、签名 secret、投递日志、重放。 |
| Analytics | token、duration、tool cost、FaaS cost、sandbox provider cost、错误率。 |

## 18. 安全设计

| 维度 | 设计 |
|---|---|
| 身份认证 | Console 支持飞书、Google/Gmail、GitHub 登录注册；API 走 scoped API key；runner 回调用短期 runtime token。 |
| Agent Inbound Auth | Agent 默认 private；调用必须通过 inbound policy、agent access grant、scope、rate limit、origin/IP 校验。 |
| Agent-scoped API Key | key 只存 hash；绑定 workspace、agent、scope、resource policy、过期时间、quota；支持撤销和轮换。 |
| A2A Auth | A2A endpoint 复用 inbound auth；Agent Card 只暴露 auth requirements，不泄露 secret；peer agent 调用需 trust grant。 |
| 租户隔离 | 所有资源带 `workspace_id/tenant_id`；DB 查询强制 tenant scope。 |
| 账号绑定 | `user_identities` 允许一人多 provider；自动合并仅基于 verified email；解绑必须至少保留一个可登录身份。 |
| Workspace 权限 | `workspace_memberships.role` 决定操作能力；所有 API key、agent、session、vault、memory、file 都绑定 workspace。 |
| Secret 管理 | `vault_credentials.secret_ref` 指向 KMS/Secret Manager；runner 只拿临时 secret。 |
| 工具权限 | `permission_policy` 支持 allow、confirm、deny、workspace_only、readonly。 |
| 网络控制 | Environment 定义 allow hosts、VPC、公网开关、E2B network policy。 |
| 文件隔离 | 每个 session 独立 workspace；路径 escape 防护；artifact 上传后只读。 |
| Runtime 回调 | FaaS runner 到 Event Gateway 使用 HMAC/JWT/mTLS；事件幂等校验。 |
| Webhook | 每次投递签名，包含 timestamp、event_id、delivery_id；防重放。 |
| 审计 | API access、event log、tool call、secret access、artifact download 全审计。 |

## 19. 可靠性与恢复

| 问题 | 设计 |
|---|---|
| FaaS runner 超时 | 拆分 run、checkpoint、可恢复 event log；超过阈值转 continuation work item。 |
| FaaS 系统错误 | `work_items.attempt` 重试，指数退避，超过预算进入 dead letter。 |
| 用户代码错误 | 不盲目重试；记录 `session.status_failed`，可由用户 resume。 |
| Sandbox 丢失 | 根据 workspace checkpoint 重建火山云沙箱或 E2B；恢复 sandbox runtime。 |
| SSE 断开 | 客户端按 `Last-Event-ID` 或 `cursor` 恢复。 |
| Webhook 失败 | dispatcher 重试、退避、死信、人工重放。 |
| 重复事件 | `external_event_id` 和 `(session_id, seq)` 幂等。 |
| 并发消息 | 每 session 单 active run；并发消息排队或明确返回 conflict。 |

## 20. 可观测性

| 指标类型 | 指标 |
|---|---|
| Session | created/running/idle/failed 数、run duration、end_turn latency。 |
| Model | tokens、latency、error rate、model fallback count。 |
| Tool | tool call count、duration、exit_code、approval wait time。 |
| FaaS | RequestId、task status、instance count、CPU/Memory、cold start、timeout。 |
| Sandbox | provider、sandbox create latency、command latency、timeout、kill count、sync bytes、fallback count。 |
| Inbound Auth | auth method、principal、agent_id、scope denied count、rate limit hit、key last used。 |
| A2A | task count、task duration、peer agent、stream disconnect、cancel count、artifact count。 |
| Artifact | artifact count、size、download count、upload latency。 |
| Webhook | delivery success rate、retry count、dead letter count。 |
| Cost | model token cost、FaaS duration cost、sandbox provider time、TOS/NAS storage。 |

日志关联字段：

```json
{
  "workspace_id": "ws_xxx",
  "session_id": "sesn_xxx",
  "run_id": "run_xxx",
  "work_item_id": "work_xxx",
  "provider": "volc_faas_task",
  "provider_request_id": "req_xxx",
  "sandbox_provider": "volc_cloud_sandbox",
  "sandbox_instance_id": "sandbox_xxx",
  "event_seq": 42
}
```

## 21. 部署拓扑

| 环境 | 组件 |
|---|---|
| Dev | SQLite、本地 Express API、local runner、local Docker、E2B optional、火山云沙箱 optional。 |
| Staging | PostgreSQL、Redis Streams、Volc FaaS runner、火山云沙箱、E2B、TOS、TLS 日志。 |
| Production | 多副本 Control Plane、Runtime Gateway 微服务、PostgreSQL HA、Redis/Kafka、Volc FaaS task/microservice、火山云沙箱默认、E2B optional、TOS/NAS、KMS、云监控。 |

推荐生产部署：

- Control Plane：K8s 或 veFaaS Web/Microservice 常驻。
- Runtime Gateway：微服务应用函数，预留实例大于等于 1。
- Agent Runner：任务函数异步执行，按 session run 弹性扩容。
- Sandbox Runtime：生产默认 `volc_cloud_sandbox`；按 environment/session 策略可切换 `e2b` 或 `custom`。
- Work Queue：PostgreSQL lease 起步；规模上来后迁移 Redis Streams/Kafka。
- Artifact：TOS。
- Workspace 大文件：TOS；高频读写可引入 NAS。
- Logs：TLS。

## 22. 版本与发布

| 对象 | 发布策略 |
|---|---|
| Agent | 每次更新生成 `agent_versions`；session 保存 snapshot，不受后续更新影响。 |
| Runner | 容器镜像版本化；environment 绑定 runner image tag；灰度发布到部分 env。 |
| SDK | SemVer；API breaking change 只进入 `/v2`。 |
| Skills | `skill_versions` 内容 hash；agent_version 绑定固定 skill_version。 |
| Environment | provider config 版本化；已有 session 使用创建时 snapshot。 |

## 23. 里程碑规划

| 阶段 | 目标 | 验收标准 |
|---|---|---|
| M0 | API/DB 对齐 | 完成表结构 migration、核心 CRUD、event seq、resources 一等模型。 |
| M0.5 | Account/Auth MVP | 飞书、Google、GitHub OAuth 登录注册，workspace/membership/API key 资源隔离可用。 |
| M0.6 | Agent Inbound Auth MVP | Agent-scoped API key、inbound policy、access grant、invoke API、调用日志完成。 |
| M1 | FaaS runner MVP | user.message 触发 FaaS 异步任务，runner 调模型并写回 `agent.message`。 |
| M2 | 可切换 SandboxRuntime | 支持火山云沙箱与 E2B 两个 provider 的 bash/read/write/list/grep，产物同步到 TOS，事件可回放。 |
| M3 | SSE/Webhook gateway | SDK 可流式消费；webhook 签名、重试、投递日志完成。 |
| M4 | Console parity | Quickstart、Agent/Environment/Session/Vault/Memory/Skill 详情页可用。 |
| M5 | Production hardening | heartbeat、stop、retry、dead letter、成本、审计、告警、压测完成。 |
| M6 | Advanced agent | multi-agent threads、checkpoint/resume、approval、memory extraction。 |
| M7 | Agent Hub / A2A | Agent publication、Agent Card、A2A Gateway、Task/Message/Artifact 映射、peer trust 完成。 |

## 24. 测试策略

| 层级 | 测试 |
|---|---|
| Unit | schema validation、event normalization、provider adapter、path safety、signature verify。 |
| Integration | FaaSProvider fake、火山云沙箱/E2B real smoke、TOS artifact sync、Vault temp injection。 |
| Auth | Lark/Google/GitHub OAuth callback、state replay 防护、verified email 合并、邀请加入 workspace、角色权限。 |
| Inbound Auth | Agent-scoped API key scope、agent grant、origin/IP、rate limit、key revoke/rotate、audit log。 |
| A2A | Agent Card schema、SendMessage/streaming/get/cancel/subscribe 映射、task recovery、peer trust。 |
| Contract | OpenAPI snapshot、SDK mock server、webhook signature fixtures。 |
| E2E | create agent -> create session -> send event -> SSE agent.message -> artifact download。 |
| Chaos | FaaS timeout、火山云沙箱/E2B kill、SSE disconnect、duplicate webhook、lease expiry。 |
| Security | path escape、secret leakage scan、API scope、tenant isolation、tool permission。 |
| Load | session concurrency、event fanout、webhook retry backlog、artifact throughput。 |

关键 E2E 场景：

```text
1. 创建 Agent 与 Environment
2. 创建 Session，状态 created -> idle
3. 发送 user.message，生成 work_item
4. FaaS runner 领取 work，状态 running
5. runner 调模型，触发 bash tool
6. SandboxRuntimeProvider 选择火山云沙箱或 E2B 执行命令，返回 tool.result
7. runner 写 agent.message 和 session.status_idle
8. SDK SSE 收到完整事件
9. artifact 可下载，webhook 投递成功
```

## 25. 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| FaaS 异步任务 3 小时上限 | 超长 agent run 失败 | run 分片、checkpoint、continuation work item、必要时微服务常驻 runner。 |
| API Gateway SSE 行为不确定 | 流式体验不稳定 | SSE 从自研 Runtime Gateway 提供；API Gateway 只做入口，必要时独立 Web 服务。 |
| Sandbox 成本不可控 | 长时间空闲浪费 | provider quota、idle timeout、按 session 复用、artifact sync 后 kill、成本告警。 |
| Tool 权限过宽 | 安全事故 | 默认 workspace_only；危险工具 approval；所有 tool call 审计。 |
| Secret 泄漏 | 高风险 | secret ref、短期 token、输出脱敏、日志扫描。 |
| Event schema 漂移 | SDK/Console 兼容问题 | event version、schema registry、contract test。 |
| Runner 镜像发布失败 | 大面积 run 失败 | 灰度发布、版本 pin、rollback、canary session。 |
| OAuth 账号误合并 | 账号劫持或客户数据越权 | 只信任 verified email；provider subject 唯一；跨 provider 合并需要已登录用户显式绑定。 |
| Workspace 越权访问 | 跨客户数据泄漏 | 所有查询强制 `workspace_id` scope；API key 绑定 workspace；审计日志覆盖成员和 key 操作。 |
| Agent inbound key 泄漏 | 外部系统可滥用 Agent | Agent-scoped key、短过期、最小 scope、rate limit、IP/origin allowlist、快速 revoke。 |
| A2A 调用环路/扩散 | 多 Agent 相互调用导致成本和风险失控 | delegation depth、fanout、budget、cycle detection、peer trust allowlist。 |
| Agent Card 泄漏内部能力 | 暴露私有 tool/model/vault 信息 | Public card 做脱敏；extended card 需授权；按 caller 生成 card。 |
| 供应商锁定 | 后续迁移成本 | Provider interface、外部 API 稳定、storage/event 抽象。 |

## 26. 与当前项目的落地差距

| 模块 | 当前已有 | 需要补齐 |
|---|---|---|
| Account/Auth | 基础 user/session/API key | Lark/Google/GitHub OAuth、user_identities、workspace/membership、invite/domain join、audit logs。 |
| Agent Inbound Auth | workspace API key | Agent-scoped API key、inbound policy、agent_access_grants、调用日志、scope/rate limit。 |
| Agent Hub/A2A | 缺 | agent_publications、Agent Card、A2A Gateway、Task/Message/Artifact 映射、peer trust。 |
| Agents | 基础表和 CRUD | archive API、版本字段完整化、runtime_json、mcp/skills/multiagent schema。 |
| Environments | E2B/local docker 配置 | FaaS provider config、`sandbox_runtime.provider`、火山云沙箱配置、storage/networking 明确 schema。 |
| Sessions | 基础 session/events/SSE | session_runs、resources 一等表、event seq、official event naming。 |
| Runtime | 本地 provider loop + E2B sandbox | FaaS AgentRuntimeProvider、SandboxRuntimeProvider switch、火山云沙箱 adapter、work queue、lease、heartbeat。 |
| Events | 基础 append/SSE | event direction/source/external id、cursor replay、schema normalization。 |
| Vault/Memory/Skills | 基础管理 | validate、memory versions/redact、skill content download/agent binding。 |
| Files/Artifacts | artifacts 部分 | files 一等 API、artifact metadata、TOS/NAS storage ref。 |
| Webhooks | 缺 | webhook CRUD、dispatcher、签名、重试。 |
| SDK | 初版 SDK | 完整 resource clients、SSE reconnect、webhook helper。 |

## 27. 推荐下一步

1. 先做 DB migration：`workspaces`、`workspace_memberships`、`user_identities`、`oauth_states`、`audit_logs`、`agent_inbound_auth_policies`、`agent_access_grants`、`inbound_request_logs`、`agent_publications`、`a2a_tasks`、`session_runs`、`session_resources`、`work_items`、`runtime_instances`、`event seq`。
2. 实现 Account/Auth MVP：飞书、Google、GitHub OAuth 登录注册，支持邀请加入 workspace 和个人 workspace 自动创建。
3. 实现 Agent Inbound Auth MVP：Agent 默认 private，支持 agent-scoped API key、invoke API、SSE、调用日志。
4. 抽象 `AgentRuntimeProvider` 和 `SandboxRuntimeProvider`，把现有 E2B 逻辑下沉为一个 sandbox provider，同时新增火山云沙箱 provider。
5. 实现 `volc_faas_task` provider 的 fake 与真实 adapter，先 fake 跑通 E2E，再接火山 API。
6. 实现 `volc_cloud_sandbox` 与 `e2b` 两个 SandboxRuntimeProvider adapter，并补齐 provider contract tests。
7. Runtime Event Gateway 独立出来，统一处理 runner callback、SSE、webhook fanout。
8. 实现 Agent Hub/A2A MVP：publish、Agent Card、A2A SendMessage/streaming 到内部 session/run 映射。
9. 用当前 Console Quickstart 做端到端验证：登录注册 -> 创建/加入 workspace -> 创建 agent -> inbound API key -> environment -> sandbox provider switch -> session/A2A task -> stream -> artifact。

## 28. 参考资料

- Anthropic Managed Agents API Beta：<https://platform.claude.com/docs/en/api/beta>
- Anthropic Create Agent：<https://platform.claude.com/docs/en/api/beta/agents/create>
- Anthropic Create Session：<https://platform.claude.com/docs/en/api/beta/sessions/create>
- A2A Protocol Specification：<https://a2aproject.github.io/A2A/latest/specification/>
- A2A GitHub / normative proto：<https://github.com/a2aproject/A2A>
- A2A Core Protocol Specification：<https://agent2agent.info/specification/core/>
- 火山函数服务首页：<https://www.volcengine.com/docs/6662>
- 火山函数创建方式选型：<https://www.volcengine.com/docs/6662/97175>
- 火山创建任务函数：<https://www.volcengine.com/docs/6662/1322679>
- 火山异步任务概述：<https://www.volcengine.com/docs/6662/1158775>
- 火山配置异步任务：<https://www.volcengine.com/docs/6662/1322860>
- 火山函数配置：<https://www.volcengine.com/docs/6662/1206174>
- 火山 API 网关触发器：<https://www.volcengine.com/docs/6662/116904>
- 火山 CreateFunction：<https://www.volcengine.com/docs/6662/1262132>
- 火山 API 列表：<https://www.volcengine.com/docs/6662/1282973>
- 火山 CreateSandbox：<https://www.volcengine.com/docs/6662/1824706>
- E2B Sandbox lifecycle：<https://e2b.dev/docs/legacy/sandbox/compute>
- E2B JS SDK Sandbox：<https://e2b-preview.com/docs/sdk-reference/js-sdk/v2.1.0/sandbox>
