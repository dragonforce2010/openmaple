# Maple SDK + CLI 接入手册

本文面向希望用代码和 CLI 接入 Maple 的终端用户。Maple 是 Managed Agent Platform for Launch-ready Execution，目标是从一个空目录开始，完成 agent 创建、harness 编写、构建、部署、调用和排障。

飞书文档版本：`https://bytedance.larkoffice.com/docx/Y7Vzd89AwoQlkjxKzpIcQizenid`

## 1. 准备平台

确认本地服务可访问：

```bash
curl http://127.0.0.1:8787/health
```

期望返回：

```json
{ "ok": true, "service": "local-managed-agents-platform" }
```

Web Console 入口：

![Quickstart 首页](screenshots/01-quickstart.png)

## 2. 选择 AgentLoop

创建 agent 时需要选择 `agent_loop.type`：

| AgentLoop | 适用场景 |
|---|---|
| `anthropic_claude_code` | Maple Code managed coding loop。适合交互式代码任务、工具证据、简洁汇报；配置值保留用于兼容已有 agent。 |
| `codex_open_source` | Codex 风格 open-source loop。适合本地 harness、CLI 发布、脚本化调用。 |

`anthropic_claude_code` 默认不是一次性 print 模式，而是 Maple Code runner + NDJSON runner；需要本机或 veFaaS 镜像中可用对应 coding-loop runtime。

Web Console 的 Quickstart 中可以直接选择 Agent loop：

![AgentLoop 选择器](screenshots/15-agent-loop-picker.png)

Agents 页面会展示每个 agent 的 loop：

![Agents Loop 列](screenshots/16-agents-loop-column.png)

## 3. 配置 Maple CLI

在项目根目录运行：

```bash
bun run maple version --server
bun run maple config set api.baseUrl http://127.0.0.1:8787
bun run maple config login --local --email dev@example.com --name "Dev User"
bun run maple config whoami
```

如果已经在 workspace onboarding 中拿到了 `lmap_ws_...` key，可以直接使用平台自有 API key，不需要外部平台 API key：

```bash
bun run maple config login --api-key lmap_ws_xxx
LMAP_API_KEY=lmap_ws_xxx bun run maple status --json
```

本地配置默认写入：

```text
~/.maple/config.json
```

测试或 CI 中可以用独立配置文件，避免污染个人配置：

```bash
MAPLE_CONFIG=/tmp/maple-e2e.json bun run maple config get
```

## 4. 初始化一个 Agent 项目

推荐 Codex-style harness 项目：

```bash
bun run maple init \
  --name repo-reviewer \
  --loop codex_open_source \
  --runtime local_docker \
  --directory /tmp/repo-reviewer \
  --yes
```

生成目录：

```text
/tmp/repo-reviewer/
├── maple.manifest.json
├── package.json
└── src/
    └── harness.mjs
```

## 5. 编写 Harness

`src/harness.mjs` 使用 SDK 的 `defineHarness`：

```js
import { defineHarness } from 'maple-agent-sdk';

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

当前 MVP 的 hook 是外层 harness 契约：平台会保存 manifest 和 bundle，用统一 session/event/runtime 链路运行 agent。服务端直接执行上传 hook 代码需要后续沙箱执行能力支持。

## 6. 检查 Manifest

`maple.manifest.json` 是部署源。关键字段：

```json
{
  "schema_version": 1,
  "name": "repo-reviewer",
  "version": "0.1.0",
  "agent": {
    "name": "repo-reviewer",
    "agent_loop": {
      "type": "codex_open_source",
      "config": {},
      "hooks": []
    },
    "tools": [
      {
        "type": "agent_toolset",
        "configs": {
          "read": true,
          "grep": true,
          "bash": true,
          "write": true
        }
      }
    ]
  },
  "environment": {
    "name": "repo-reviewer-local-docker",
    "config": {
      "type": "local_docker",
      "sandbox": { "provider": "local_docker" }
    }
  },
  "harness": {
    "entry": "src/harness.mjs",
    "runtime": "node22",
    "hooks": ["beforeInvoke", "onEvent", "afterInvoke"]
  }
}
```

## 7. 构建 Bundle

```bash
bun run maple build --project /tmp/repo-reviewer
```

生成：

```text
/tmp/repo-reviewer/.maple/build/bundle.json
```

bundle 包含：

- manifest 的规范化 JSON。
- harness entry 的 base64 内容。
- `sha256`，用于部署记录审计。

## 8. 部署到平台

```bash
bun run maple deploy --project /tmp/repo-reviewer --json
```

成功返回：

```json
{
  "deployment_id": "dep_xxx",
  "agent_id": "agent_xxx",
  "environment_id": "env_xxx",
  "name": "repo-reviewer",
  "version": "0.1.0"
}
```

部署记录可以查询：

```bash
bun run maple status --json
```

## 9. 调用 Agent

```bash
bun run maple invoke \
  "读取 README，列出三个可以改进的地方" \
  --deployment dep_xxx \
  --stream
```

`invoke` 会：

1. 调用 `POST /v1/deployments/:deploymentId/invoke`。
2. 平台创建 session。
3. 写入 `user.message`。
4. 后台启动 runtime 并运行 provider/tool loop。
5. CLI 轮询 session detail 并输出事件。

Sessions 页面可以查看运行轨迹：

![Session composer](screenshots/05-sessions-composer.png)

Artifacts 页面可以下载 agent 写出的文件：

![Artifacts](screenshots/17-artifacts.png)

## 10. API 方式接入

推荐使用 workspace API key：

```js
import { MapleClient } from './sdk/index.mjs';

const client = new MapleClient({
  baseUrl: process.env.LMAP_API_BASE_URL ?? 'http://127.0.0.1:8787',
  apiKey: process.env.LMAP_API_KEY
});

const session = await client.createSession({
  agent: 'agent_xxx',
  environment_id: 'env_xxx',
  title: 'SDK smoke'
});
await client.sendSessionMessage(session.id, '读取 README，列出三个可以改进的地方');
const events = await client.listSessionEvents(session.id);
console.log(events.data);
```

本地开发也可以用登录 session token：

```bash
curl -i -X POST http://127.0.0.1:8787/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"provider":"local","email":"dev@example.com","name":"Dev User"}'
```

从 `Set-Cookie: lmap_session=...` 中取 token 后，业务 API 也支持：

```bash
curl http://127.0.0.1:8787/v1/deployments \
  -H "Authorization: Bearer $LMAP_SESSION_TOKEN"
```

纯 HTTP workspace key 调用：

```bash
curl http://127.0.0.1:8787/v1/agents \
  -H "Authorization: Bearer $LMAP_API_KEY"
```

旧 HTTP shape 仍保留用于迁移和 CWC workshop 兼容，但新业务接入推荐 Maple SDK/CLI，不需要安装外部平台 SDK。

## 11. 常见问题

| 问题 | 处理 |
|---|---|
| `login_required` | 先运行 `maple config login --api-key lmap_ws_xxx`，或本地开发用 `maple config login --local --email ...`。 |
| `deployment_create_failed` | 检查 `name + version` 是否重复；同一用户同一版本不可重复部署。 |
| `Invalid manifest agent_loop.type` | 只允许 `anthropic_claude_code` 或 `codex_open_source`。 |
| session 一直 `failed` | 检查 provider key、Docker/E2B 配置和 environment runtime。 |
| forged event 被拒绝 | 这是预期安全行为。外部只允许写 `user.message`，系统事件由 runner 写入。 |

## 12. 验收命令

```bash
npm run typecheck
npm run build
bun run maple version --server
bun run maple config login --api-key lmap_ws_xxx
bun run maple init --name demo-agent --loop codex_open_source --runtime local_docker --directory /tmp/maple-demo --yes
bun run maple build --project /tmp/maple-demo
bun run maple deploy --project /tmp/maple-demo --json
bun run maple status --json
```
