# OpenMaple

OpenMaple 是开放的 managed agent 平台。它提供 Web Console、REST API、Node/TypeScript SDK、Maple CLI、Vault、Session observability、Runtime provider、Sandbox provider 和 Workspace 级 API key，用于构建、部署、运行和观测可托管的 AI agent。

OpenMaple is an open managed agent platform. It ships a web console, REST API, Node/TypeScript SDK, Maple CLI, vaults, observable sessions, runtime providers, sandbox providers, and workspace API keys for building, deploying, running, and inspecting managed AI agents.

[English](#english) · [中文](#中文) · [GitHub Pages](docs/index.html) · [Architecture](docs/architecture/maple-platform-overview.md) · [SDK/CLI guide](docs/product-manual/maple-sdk-cli-onboarding.md)

![OpenMaple mascot](docs/assets/openmaple-mascot.svg)

## English

### Why OpenMaple

OpenMaple is built around a clear control-plane/runtime-plane split:

- **Control Plane**: workspace, tenant, agents, environments, vaults, model configs, sessions, events, and API keys.
- **Runtime Plane**: agent loop execution through providers such as veFaaS runtime, local runtime, and future Lambda/FaaS adapters.
- **Sandbox Plane**: isolated file and shell execution through providers such as veFaaS Sandbox, E2B, local Docker, and future Vercel-style sandboxes.
- **Agent loops**: stable agent loop types include `anthropic_claude_code` and `codex_open_source`.
- **Integration surface**: use REST, `maple-agent-sdk`, or the `maple` CLI.

### Quickstart

```bash
bun install
cp .env.example .env
bun run dev
```

Open:

```text
Web Console: http://127.0.0.1:5173/
API Server:  http://127.0.0.1:27951/
```

### CLI smoke

```bash
npm install -g maple-agent-cli
maple config set api.baseUrl https://sd8ihq8v316pc5mf9c1j0.apigateway-cn-beijing.volceapi.com
maple config login --api-key <maple_ws_...>
maple version --json
maple init --name repo-auditor --loop codex_open_source --runtime e2b --directory ./repo-auditor --yes
maple build --project ./repo-auditor
maple deploy --project ./repo-auditor --json
```

### Skills

OpenMaple skills should be split by resource domain, similar to how `larksuite/cli` splits its skill modules:

| Skill | Scope |
|---|---|
| `openmaple-agent` | Agent config, model, system, tools, and agent loop. |
| `openmaple-runtime` | Runtime provider, sandbox provider, Codex/Claude loop, and pool state. |
| `openmaple-session` | Session create/detail/events/SSE/tool_calls. |
| `openmaple-vault` | Vault, credentials, OAuth, and credential detail. |
| `openmaple-mcp` | Preset MCP catalog and user-managed MCP servers. |
| `openmaple-workspace` | Workspace onboarding, API keys, members, and cloud provider identity. |
| `openmaple-memory` | Memory store, entries, query, and write flow. |
| `openmaple-deployment` | Deploy, invoke, and session evidence. |

### GitHub Pages

The static documentation entry is `docs/index.html`. The workflow at `.github/workflows/pages.yml` uploads the repository root so source code and docs are both browsable from GitHub Pages.

## 中文

### 项目定位

OpenMaple 目标是开放的 managed agent 平台，不绑定单一云或单一 agent loop：

- **控制面**：tenant、workspace、agents、environments、vaults、model configs、sessions、events、workspace API key。
- **运行时面**：runtime provider 可接 veFaaS runtime、本地 runtime，后续扩展阿里 FaaS、AWS Lambda、GCP Cloud Functions。
- **沙箱面**：sandbox provider 可接 veFaaS Sandbox、E2B、local Docker，后续扩展 Vercel 等。
- **Agent loop**：支持 `anthropic_claude_code` 和 `codex_open_source`，Codex 链路走真实 CLI 验证。
- **集成入口**：REST API、`maple-agent-sdk`、`maple` CLI。

### 快速开始

```bash
bun install
cp .env.example .env
bun run dev
```

打开：

```text
Web Console: http://127.0.0.1:5173/
API Server:  http://127.0.0.1:27951/
```

### CLI 验证

```bash
npm install -g maple-agent-cli
maple config set api.baseUrl https://sd8ihq8v316pc5mf9c1j0.apigateway-cn-beijing.volceapi.com
maple config login --api-key <maple_ws_...>
maple status --json
maple init --name codex-worker --loop codex_open_source --runtime e2b --directory ./codex-worker --yes
maple build --project ./codex-worker
maple deploy --project ./codex-worker --json
maple invoke "Run a workspace smoke test." --deployment <deployment_id> --stream
```

### 文档入口

- Console 内置文档：`apps/admin-web/src/pages/docs/*`
- GitHub Pages 静态入口：`docs/index.html`
- 架构总览：`docs/architecture/maple-platform-overview.md`
- SDK/CLI 指南：`docs/product-manual/maple-sdk-cli-onboarding.md`
- 当前实施计划：`docs/superpowers/plans/2026-06-15-openmaple-ui-docs-cloud-provider.md`

## 快速访问

本地开发模式：

- Web Console: `http://127.0.0.1:5173/`
- API Server: `http://127.0.0.1:27951`

容器部署模式：

- Web Console + API: `http://127.0.0.1:27951/`
- Health Check: `http://127.0.0.1:27951/health`

## 功能概览

- Quickstart: 从自然语言需求生成 agent definition。
- Agents: 查看和管理 agent 配置版本。
- Sessions: 启动运行、发送消息、查看 transcript/debug/all events。
- Environments: 通过 `sandbox.config.json` 配置 E2B cloud sandbox 或本地 Docker sandbox，默认 E2B。
- Credential vaults: 保存 MCP/OAuth/API key 等凭证引用，不向 API 响应泄露明文。
- Memory: 维护 workspace-scoped 长期记忆，元数据走远程 MySQL。
- Skills: 扫描、创建和编辑 `~/.agents/skills` 本地 skill。
- Templates: 创建和编辑可复用 agent 配置模板。
- Users: 登录态、用户列表和 OAuth/OIDC/Lark SSO/ByteSSO provider 配置状态。
- Model gateway: 用户模型池、自定义 OpenAI-compatible 模型、预置模型、gateway key 签发和 TPM/TPD quota。
- Artifacts: 汇总 session workspace 产物并支持下载。
- SDK + CLI: `sdk/index.mjs` 和 Maple CLI 支持终端用户用代码 + CLI 创建、构建、部署、调用 agent。
- E2E: 使用 Playwright + API checks 做完整验收。

## 技术栈

- Frontend: React 19 + Vite
- Backend: Express 5 + TypeScript on Bun
- Persistence: remote MySQL via worker-backed sync adapter
- Runtime: configurable sandbox infrastructure, default E2B with local Docker fallback
- Tests: TypeScript checker, Bun frontend build, Playwright E2E

## 目录结构

```text
.
├── apps/
│   ├── admin-web/          # React console
│   └── control-plane-api/  # Express API, runtime, store, provider adapter
├── agents/super-agent/     # hidden builder / AskMaple system agent config package
├── packages/               # SDK, CLI, runtime/sandbox contracts
├── tests/e2e/e2e.mjs       # Full acceptance suite
├── infra/vefaas/           # veFaaS deployment helpers and runtime app
├── docs/superpowers/plans/ # Spec-driven implementation plans
├── docs/product-manual/    # Product manual and screenshots
├── Dockerfile              # Container image
├── compose.yaml            # Docker Compose deployment
├── .env.example            # Runtime environment template
└── SPEC.md                 # Product/source-of-truth spec
```

## 前置依赖

本地开发需要：

- Bun 1.3+
- E2B API key，或 Docker Desktop / Colima / Docker Engine 用于本地 Docker 沙箱
- 可用的 OpenAI-compatible provider key：`OPENAI_API_KEY` 或 `ARK_API_KEY`

容器部署额外需要：

- Docker Compose v2
- 可访问宿主 Docker socket：`/var/run/docker.sock`
- 一个宿主机绝对路径映射给 session workspace，见 `MAPLE_DOCKER_WORKSPACE_HOST_ROOT`

## 本地开发启动

安装依赖：

```bash
bun install
```

配置 provider。项目启动只读取项目根目录 `.env`：

```bash
cp .env.example .env
```

配置沙箱基础设施：

```bash
export MAPLE_SANDBOX_CONFIG=./sandbox.config.json
export MAPLE_SANDBOX_PROVIDER=e2b
export E2B_API_KEY="e2b_..."
```

仓库内的 `sandbox.config.json` 已包含默认 E2B provider、template、workspace 路径，以及 `local_docker` fallback 配置。创建 Environment 时也可以显式选择 provider。

E2B runtime 使用官方 `e2b` JavaScript SDK。Docker 镜像会在生产依赖阶段安装该 SDK；本地开发如果要直接运行 E2B session，需要先在项目里安装 `e2b`，否则请选择 `local_docker` environment。

火山 veFaaS agent runtime 由 workspace runtime pool 管理。创建 workspace 时提供火山 AK/SK 和 pool size，平台会为每个 pool member 调用部署脚本创建固定 runtime 函数，并把返回的 `invoke_url` 写入 `workspace_runtime_pool_members`。函数协议见 [veFaaS Agent Runtime Contract](docs/design/2026-06-04-vefaas-runtime-contract.md)。

首次发布固定 runtime 模板时，只需要在项目根目录 `.env` 配置火山 AK/SK，region 默认北京：

```bash
VOLCENGINE_ACCESS_KEY=...
VOLCENGINE_SECRET_KEY=...
MAPLE_VEFAAS_REGION=cn-beijing
python3 infra/vefaas/deploy_vefaas_runtime.py
```

部署脚本会直接调用火山 OpenAPI/SDK 创建 veFaaS 函数、上传 `infra/vefaas/runtime-app` 模板代码、发布函数，然后在已有 APIG service 下创建独立 prefix route，输出 `function_id`、`url`、`invoke_url`。workspace runtime pool provisioning 会读取这个 payload 并写回 pool member，不需要手工配置 `VEFAAS_INVOKE_URL`。

启动开发服务：

```bash
bun run dev
```

打开：

```text
http://127.0.0.1:5173/
```

开发模式下 `apps/admin-web/vite.config.ts` 提供 React 前端，并把 `/v1/*` 和 `/health` 代理到 `http://127.0.0.1:27951`。生产静态站才使用 `apps/control-plane-api/src/web/web.ts` 服务 `dist/`。

首次进入页面会显示登录页。默认可用 `Local dev login`，也可以在 `.env` 中配置 OAuth/OIDC/Lark SSO/ByteSSO provider 元信息后接入企业 SSO。

## 容器部署：Docker Compose 推荐路径

复制环境变量模板：

```bash
cp .env.example .env
```

编辑 `.env`，至少设置：

```dotenv
OPENAI_API_KEY=sk-...
MAPLE_DOCKER_WORKSPACE_HOST_ROOT=/absolute/path/to/managed-agents-platform/.managed-agents/sessions
```

`MAPLE_DOCKER_WORKSPACE_HOST_ROOT` 必须是宿主机绝对路径。原因是平台容器通过宿主 Docker socket 创建 session runtime 容器，真正执行 `docker run -v <source>:/workspace` 的是宿主 Docker daemon，而不是平台容器本身。

启动：

```bash
docker compose up --build
```

后台启动：

```bash
docker compose up --build -d
```

访问：

```text
http://127.0.0.1:27951/
```

健康检查：

```bash
curl http://127.0.0.1:27951/health
```

停止：

```bash
docker compose down
```

## 容器部署：直接 Docker 命令

构建镜像：

```bash
docker build -t managed-agents-platform:local .
```

启动容器：

```bash
docker run --name managed-agents-platform \
  -p 27951:27951 \
  -e OPENAI_API_KEY="$OPENAI_API_KEY" \
  -e HOST=0.0.0.0 \
  -e PORT=27951 \
  -e MAPLE_DATA_DIR=/app/.managed-agents \
  -e MAPLE_SKILLS_ROOT=/root/.agents/skills \
  -e MAPLE_DOCKER_WORKSPACE_HOST_ROOT="$PWD/.managed-agents/sessions" \
  -v "$PWD/.managed-agents:/app/.managed-agents" \
  -v "$HOME/.agents:/root/.agents" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  managed-agents-platform:local
```

## 持久化数据

平台本地运行产物默认在 `.managed-agents/`，资源元数据在远程 MySQL：

```text
.managed-agents/
├── secrets/                 # encrypted local secret files
└── sessions/<session-id>/   # per-session workspace
```

容器部署时，`compose.yaml` 会把本地 `./.managed-agents` 挂载到容器 `/app/.managed-agents`。只要不删除这个目录，secret 文件和 session workspace 都会保留；agent、session、memory、vault metadata 由远程 MySQL 保存。

Skills 默认使用 `~/.agents/skills`。容器部署时，`compose.yaml` 会把宿主 `${HOME}/.agents` 挂载到容器 `/root/.agents`，因此 UI 创建的 skill 会写回宿主统一 skill 源目录。

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `HOST` | `127.0.0.1` | API 监听地址。容器内应设为 `0.0.0.0`。 |
| `PORT` | `27951` | API 和生产静态站点端口。 |
| `SERVE_STATIC` | production auto | 若 `dist/index.html` 存在，Express 会服务前端静态文件。容器显式设为 `true`；设为 `false` 可只跑 API。 |
| `MAPLE_DATA_DIR` | `<cwd>/.managed-agents` | secrets、sessions 的本地运行产物目录；业务元数据走远程 MySQL。 |
| `MAPLE_SKILLS_ROOT` | `~/.agents/skills` | 本地 skill 源目录。 |
| `MAPLE_DOCKER_WORKSPACE_HOST_ROOT` | empty | 容器控制宿主 Docker daemon 时，session workspace 的宿主路径根目录。 |
| `OPENAI_API_KEY` | empty | OpenAI-compatible provider key。 |
| `ARK_API_KEY` | empty | ARK provider key，可替代 `OPENAI_API_KEY`。 |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible API base URL。 |
| `OPENAI_MODEL` | provider default | 文本和 tool loop 使用的模型。 |
| `ARK_MODEL` | `doubao-seed-1-6-251015` | ARK 模型默认值。 |
| `MAPLE_SANDBOX_CONFIG` | `./sandbox.config.json` | 沙箱基础设施配置文件。 |
| `MAPLE_SANDBOX_PROVIDER` | `e2b` | 默认沙箱 provider，可选 `e2b`、`local_docker` 或 `vefaas`。 |
| `E2B_API_KEY` | config file value | E2B API key；也可写在 `sandbox.config.json`。 |
| `E2B_TEMPLATE` | `base` | E2B sandbox template。 |
| `E2B_WORKSPACE_PATH` | `/workspace` | E2B 内部 workspace 路径。 |
| `E2B_TIMEOUT_MS` | `3600000` | E2B sandbox 保活/超时配置。 |
| `VOLCENGINE_ACCESS_KEY` / `VOLCENGINE_SECRET_KEY` | empty | 一次性发布 veFaaS runtime 模板时使用的火山 AK/SK。 |
| `MAPLE_VEFAAS_REGION` | `cn-beijing` | veFaaS provisioning 区域；部署脚本默认北京。 |
| `MAPLE_VEFAAS_APP_NAME` | generated | veFaaS runtime 函数名前缀；不配置时自动生成 `maple-runtime-bun-*`。 |
| `MAPLE_VEFAAS_GATEWAY_SERVICE_ID` / `MAPLE_VEFAAS_RUNTIME_GATEWAY_SERVICE_ID` | empty | 指定复用的 APIG service；不指定时复用 gateway 下第一个 Running service。 |
| `MAPLE_VEFAAS_ROUTE_PREFIX` / `MAPLE_VEFAAS_RUNTIME_ROUTE_PREFIX` | generated | runtime route prefix；不配置时生成 `/maple-runtime/<app_name>`。 |
| `MAPLE_VEFAAS_ENABLE_LOGS` | `false` | 是否开启 TLS 日志采集。设为 `true` 时必须提供 TLS project/topic。 |
| `MAPLE_VEFAAS_TLS_PROJECT_ID` / `MAPLE_VEFAAS_TLS_TOPIC_ID` | empty | 函数日志投递的 TLS project/topic；仅在 `MAPLE_VEFAAS_ENABLE_LOGS=true` 时使用。 |
| `MAPLE_AGENT_LOOP_INSTALL_POLICY` | `check` | veFaaS runtime 启动 agent loop 前的 CLI 策略。`check` 只预检，`auto` 会用 npm 安装 Maple Code/Codex CLI 到函数临时目录。 |
| `MAPLE_CLAUDE_CODE_PROTOCOL` | `claude_sdk_ndjson` | Maple Code loop 默认使用 NDJSON 双向桥；显式设为 `cli_batch` 才走旧批处理模式。 |
| `MAPLE_CLAUDE_AGENT_SDK_PYTHON` / `MAPLE_CLAUDE_AGENT_SDK_RUNNER_COMMAND` | `python3` / empty | 覆盖 Maple Code runner 的 Python 或完整启动命令。 |
| `MAPLE_CLAUDE_CODE_VERSION` / `MAPLE_CODEX_VERSION` | `latest` | `MAPLE_AGENT_LOOP_INSTALL_POLICY=auto` 时安装的 npm 包版本。 |
| `MAPLE_CLAUDE_CODE_COMMAND` / `MAPLE_CODEX_COMMAND` | empty | veFaaS runtime 中 CLI 安装在非标准路径时显式指定命令。 |
| `MAPLE_VEFAAS_REUSE_EXISTING` | `false` | 同名 legacy veFaaS application 已存在时是否复用并输出现有绑定信息。 |
| `VEFAAS_INVOKE_URL` | empty | 仅用于显式单函数调试；workspace runtime pool 不读取这个值。 |
| `VEFAAS_API_KEY` | empty | 调用 veFaaS 触发器时发送的 bearer token。 |
| `VEFAAS_FUNCTION_ID` | empty | 传给 runtime 函数的函数标识。 |
| `VEFAAS_REGION` | `cn-beijing` | 火山函数区域。 |
| `VEFAAS_WORKSPACE_PATH` | `/workspace` | veFaaS runtime 内 workspace 路径。 |
| `VEFAAS_TIMEOUT_MS` | `120000` | veFaaS 工具调用超时时间。 |
| `MAPLE_API_BASE_URL` | `https://sd8ihq8v316pc5mf9c1j0.apigateway-cn-beijing.volceapi.com` | 平台自有 SDK/CLI 默认 API 地址。 |
| `MAPLE_API_KEY` | empty | 平台自有 SDK/CLI 使用的 workspace API key，通常是 `maple_ws_...`。 |
| `MAPLE_DEV_API_KEY` | `maple_dev_key` | 本地开发兜底 key；兼容层和调试可用，不是推荐生产接入口。 |
| `MAPLE_AUTH_SESSION_DAYS` | `7` | 登录 cookie/session 有效天数。 |
| `MAPLE_COOKIE_SECURE` | `false` | 是否只通过 HTTPS 发送登录 cookie。 |
| `MAPLE_OAUTH_AUTHORIZE_URL` / `MAPLE_OAUTH_TOKEN_URL` / `MAPLE_OAUTH_USERINFO_URL` | empty | OAuth 2.0 授权码登录端点。 |
| `MAPLE_OAUTH_CLIENT_ID` / `MAPLE_OAUTH_CLIENT_SECRET` / `MAPLE_OAUTH_SCOPE` | empty | OAuth 2.0 client 配置。 |
| `MAPLE_OIDC_AUTHORIZE_URL` / `MAPLE_OIDC_TOKEN_URL` / `MAPLE_OIDC_USERINFO_URL` | empty | OIDC 授权码登录端点。 |
| `MAPLE_OIDC_CLIENT_ID` / `MAPLE_OIDC_CLIENT_SECRET` / `MAPLE_OIDC_SCOPE` | empty | OIDC client 配置。 |
| `MAPLE_LARK_OPENAPI_BASE_URL` | `https://open.feishu.cn/open-apis` | 飞书 OpenAPI base URL。 |
| `MAPLE_LARK_APP_ID` / `MAPLE_LARK_APP_SECRET` | empty | 飞书应用凭证；配置后 `lark_sso` 走飞书扫码登录授权码流。 |
| `MAPLE_LARK_AUTHORIZE_URL` / `MAPLE_LARK_APP_ACCESS_TOKEN_URL` / `MAPLE_LARK_USER_ACCESS_TOKEN_URL` / `MAPLE_LARK_USERINFO_URL` | Feishu defaults | 飞书 SSO OpenAPI endpoint 覆盖项。 |
| `MAPLE_BYTESSO_*` | empty | ByteSSO 的 `AUTHORIZE_URL`、`TOKEN_URL`、`USERINFO_URL`、`CLIENT_ID`、`CLIENT_SECRET`、`SCOPE`。 |

## 用户、模型网关与产物

登录后所有业务 `/v1/*` API 都会校验登录态；例外是 `/health`、`/v1/auth/*` 和模型网关推理入口 `/v1/gateway/chat/completions`。网关入口使用 `Authorization: Bearer <gateway_key>` 校验，不使用浏览器 cookie。

SSO 接入方式：

1. Lark SSO 推荐配置 `MAPLE_LARK_APP_ID` 和 `MAPLE_LARK_APP_SECRET`；平台会默认使用飞书 OpenAPI 的授权页、app_access_token、user_access_token 和 user_info 接口。
2. 通用 OAuth/OIDC/ByteSSO 仍配置对应 provider 的 `AUTHORIZE_URL`、`TOKEN_URL`、`USERINFO_URL`、`CLIENT_ID`、`CLIENT_SECRET`。
3. 打开 `/v1/auth/providers` 确认 provider `configured=true`。
4. 前端选择 `Lark SSO` 时，如果用户没有登录会跳转到飞书登录/扫码页。
5. 用户扫码完成后，callback 会完成 code exchange、拉取 userinfo、创建平台用户并写入 `maple_session` cookie。

模型网关使用方式：

1. 在 `Model gateway` 页面创建模型配置。
2. 自定义模型需要填写 `base_url`、`model_name`、`api_key`；API key 会加密保存，后续列表只显示 `has_api_key`。
3. 预置模型当前包含 `GPT5.5` 和 `Maple Code`，可复用环境变量中的 provider key。
4. 点击 `Issue key` 签发业务方 gateway key，并配置 `TPM` 和 `TPD`。
5. 调用 `POST /v1/gateway/chat/completions` 时，平台会把 gateway key 映射成用户真实模型配置和 API key，再转发到真实模型服务。

产物管理使用方式：

1. agent 在 session workspace 中写出的文件会出现在 `Artifacts`。
2. API 可用 `GET /v1/artifacts` 汇总当前用户可访问 session 的产物。
3. 单 session 可用 `GET /v1/sessions/:sessionId/artifacts`。
4. 下载使用 `GET /v1/sessions/:sessionId/artifacts/<path>/download`。

## AgentLoop、SDK 与 Maple CLI

Agent 配置现在包含稳定的 `agent_loop` 字段：

```json
{
  "agent_loop": {
    "type": "anthropic_claude_code",
    "config": {},
    "hooks": []
  }
}
```

支持的类型：

| 类型 | 用途 |
|---|---|
| `anthropic_claude_code` | Maple Code managed coding loop，保留旧配置值用于兼容已有 agent。 |
| `codex_open_source` | Codex 风格 open-source loop，适合本地 harness 和 CLI 发布工作流。 |

默认执行语义是真实 agent loop，不再静默模拟。Maple Code loop 通过可配置的 coding-loop runner 双向传递 `init/query/interrupt/exit` 事件；Codex loop 继续走 `codex exec` 非交互 CLI。

| Loop | 默认命令 | 配置 |
|---|---|---|
| `anthropic_claude_code` | `python3 infra/vefaas/runtime-app/claude_agent_sdk_runner.py` -> configurable code runner | `MAPLE_CLAUDE_CODE_COMMAND=/path/to/claude`, `MAPLE_CLAUDE_AGENT_SDK_RUNNER_COMMAND=...` |
| `codex_open_source` | `codex exec --cd <workspace> --sandbox workspace-write --ask-for-approval never` | `MAPLE_CODEX_COMMAND=/path/to/codex` |

如果机器上有同名但不是 OpenAI Codex CLI 的 `codex`，需要显式设置 `MAPLE_CODEX_COMMAND`。测试或兼容旧 provider/tool-call loop 时可显式设置：

```bash
export MAPLE_AGENT_LOOP_EXECUTION=provider
```

veFaaS 函数不会假设 CLI 一定存在。默认 `MAPLE_AGENT_LOOP_INSTALL_POLICY=check` 会在执行前检查 Maple Code runner 或 `codex exec --help`；检查失败时直接返回配置错误。若函数运行时有 Node/npm 和外网访问，可设 `MAPLE_AGENT_LOOP_INSTALL_POLICY=auto`，冷启动会安装所需 coding-loop CLI 到 `/tmp/maple-vefaas-runtime/node-agent-loop-cli`。生产更推荐把 Python SDK 和 CLI 预装进函数镜像/层，并用 `MAPLE_CLAUDE_AGENT_SDK_RUNNER_COMMAND`、`MAPLE_CLAUDE_CODE_COMMAND` / `MAPLE_CODEX_COMMAND` 指向固定路径。

本地 CLI 入口：

```bash
bun run maple version --server
bun run maple config set api.baseUrl "${MAPLE_API_BASE_URL:-https://sd8ihq8v316pc5mf9c1j0.apigateway-cn-beijing.volceapi.com}"
bun run maple config login --local --email dev@example.com --name "Dev User"
MAPLE_API_KEY=maple_ws_xxx bun run maple status --json
# or
bun run maple config login --api-key maple_ws_xxx
bun run maple init --name repo-reviewer --loop codex_open_source --runtime local_docker --directory /tmp/repo-reviewer --yes
bun run maple build --project /tmp/repo-reviewer
bun run maple deploy --project /tmp/repo-reviewer --json
bun run maple status --json
```

`maple init` 会创建：

```text
maple.manifest.json
package.json
src/harness.mjs
```

`maple.manifest.json` 是发布源，包含 agent、environment、harness hooks、resources、vault_ids 和 memory_store_ids。`maple build` 会生成 `.maple/build/bundle.json`，`maple deploy` 调用 `POST /v1/deployments` 并创建 deployment、agent、environment 三个资源。

SDK 入口：

```js
import { MapleClient, defineHarness } from "maple-agent-sdk";

const client = new MapleClient({
  baseUrl: process.env.MAPLE_API_BASE_URL,
  apiKey: process.env.MAPLE_API_KEY
});
const session = await client.createSession({
  agent: "agent_xxx",
  environment_id: "env_xxx",
  title: "SDK smoke"
});
await client.sendSessionMessage(session.id, "Inspect the workspace.");
const events = await client.listSessionEvents(session.id);

export default defineHarness({
  async beforeInvoke(ctx) {
    return { message: ctx.input };
  },
  async onEvent(event, ctx) {
    ctx.log(event.type);
  },
  async afterInvoke(result) {
    return result;
  }
});
```

`MAPLE_API_KEY` 使用 workspace onboarding 生成的 `maple_ws_...` key。Maple Console 和文档推荐平台自有 SDK/CLI 入口，不要求外部平台 API key。

当前 MVP 会保存 harness manifest 和 bundle，用统一 session/event/runtime 链路执行 agent。上传 hook 代码的服务端沙箱执行仍是后续能力；推荐把业务逻辑放在外层 harness，通过 `beforeInvoke`、`onEvent`、`afterInvoke` 做输入改写、事件观察、审计和结果处理。

完整接入手册见 [docs/product-manual/maple-sdk-cli-onboarding.md](docs/product-manual/maple-sdk-cli-onboarding.md)。飞书文档版本：`https://bytedance.larkoffice.com/docx/Y7Vzd89AwoQlkjxKzpIcQizenid`。

## Docker Socket 安全说明

容器部署为了让平台创建 session runtime 容器，会挂载：

```text
/var/run/docker.sock:/var/run/docker.sock
```

这等价于让平台容器具备控制宿主 Docker daemon 的能力。只在可信本地或受控服务器上使用，不要把该容器暴露给不可信用户。

## 验证命令

类型检查：

```bash
bun run typecheck
```

生产构建：

```bash
bun run build
```

完整验收：

```bash
bun run test:all
```

Docker 构建：

```bash
docker build -t managed-agents-platform:local .
```

容器 smoke test：

```bash
docker run --rm -p 27951:27951 \
  -e HOST=0.0.0.0 \
  -e PORT=27951 \
  -e SERVE_STATIC=true \
  managed-agents-platform:local
```

然后在另一个终端执行：

```bash
curl http://127.0.0.1:27951/health
curl -I http://127.0.0.1:27951/
```

## 常见问题

### 1. 容器里页面能打开，但创建 session 失败

先确认宿主 Docker socket 已挂载：

```bash
docker compose exec managed-agents-platform docker info
```

再确认 `MAPLE_DOCKER_WORKSPACE_HOST_ROOT` 是宿主机绝对路径，并且对应到项目的 `.managed-agents/sessions`。

### 2. session runtime 报 workspace mount 路径不存在

这是 Docker-outside-of-Docker 的路径映射问题。设置：

```dotenv
MAPLE_DOCKER_WORKSPACE_HOST_ROOT=/absolute/path/to/managed-agents-platform/.managed-agents/sessions
```

然后重启：

```bash
docker compose up -d
```

### 3. 生成 agent draft 失败

检查 provider key：

```bash
echo "$OPENAI_API_KEY"
echo "$ARK_API_KEY"
```

API 错误会在 Quickstart 右侧或浏览器控制台显示。

### 4. Skill 创建后宿主机看不到

确认 Compose 挂载了：

```yaml
- ${HOME}/.agents:/root/.agents
```

并确认容器内 `MAPLE_SKILLS_ROOT=/root/.agents/skills`。

### 5. 端口冲突

修改 `.env`：

```dotenv
MAPLE_PORT=8877
```

然后访问：

```text
http://127.0.0.1:8877/
```

## 研发工作流建议

1. 需求先写入 `SPEC.md` 或 `docs/superpowers/plans/*.md`。
2. 实现最小可验证改动。
3. 跑 `bun run typecheck` 和 `bun run build`。
4. 涉及 UI 的改动补 `tests/e2e/e2e.mjs` 按钮点击覆盖。
5. 跑 `bun run test:all`。
6. 容器相关改动额外跑 `docker build` 和 health/static smoke test。
