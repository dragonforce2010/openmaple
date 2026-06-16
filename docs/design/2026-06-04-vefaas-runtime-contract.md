# veFaaS Agent Runtime Contract

本地平台现在支持把火山引擎 veFaaS HTTP 触发器作为 agent runtime。API server 仍负责 Anthropic-compatible resources、session events、workspace、auth、model gateway 和 sandbox bridge；veFaaS 函数负责承载 Claude Code loop / Codex loop 等 agent loop。

关键边界：

- Agent runtime: veFaaS，承载 agent loop。
- Tool sandbox: E2B，承载文件、shell、grep、memory 等工具执行。
- Control plane: 本平台，负责把 veFaaS agent loop 的工具请求桥接到 sandbox provider。

## Workspace Runtime Pool Config

最新架构中，veFaaS 不再由 Environment 配置。Environment 只描述工具执行 sandbox、网络、包和 metadata；AgentRuntime 由 Workspace Runtime Pool 管理，并在创建 session 时绑定到 session metadata。

onboarding payload 示例：

```json
{
  "tenant": { "name": "Acme", "description": "" },
  "workspace": { "name": "Default Workspace", "description": "" },
  "runtime_provider": "vefaas",
  "runtime_pool": {
    "desired_size": 2,
    "max_instances_per_function": 100,
    "max_concurrency_per_instance": 100,
    "cpu_milli": 2000,
    "memory_mb": 4096
  },
  "sandbox_provider": "e2b",
  "model_config_ids": ["modelcfg_xxx"],
  "api_key": {
    "display_name": "Default workspace key",
    "scopes": ["control_plane", "data_plane"]
  }
}
```

Environment payload 示例：

```json
{
  "workspace_id": "ws_xxx",
  "name": "anthropic-hand-env",
  "config": {
    "type": "e2b",
    "sandbox": {
      "provider": "e2b",
      "e2b": {
        "template": "base",
        "workspace_path": "/workspace",
        "timeout_ms": 3600000
      }
    },
    "networking": {
      "mode": "limited",
      "allowed_hosts": ["api.anthropic.com"]
    }
  }
}
```

新 API 会拒绝 `config.agent_runtime`、`config.agentRuntime`、`config.agent_runtime_provider`、`config.agentRuntimeProvider` 以及 `config.type=managed_agent`，错误码是 `environment_agent_runtime_forbidden`。`server/store.ts` 里 legacy seed 和少量底层 contract 保留旧 Environment 形态只用于兼容，不代表产品目标态。

环境变量等价配置：

- `VEFAAS_INVOKE_URL` or `LMAP_VEFAAS_INVOKE_URL`
- `VEFAAS_API_KEY` or `LMAP_VEFAAS_API_KEY`
- `VEFAAS_FUNCTION_ID` or `LMAP_VEFAAS_FUNCTION_ID`
- `VEFAAS_REGION` or `LMAP_VEFAAS_REGION`
- `VEFAAS_WORKSPACE_PATH` or `LMAP_VEFAAS_WORKSPACE_PATH`
- `VEFAAS_TIMEOUT_MS` or `LMAP_VEFAAS_TIMEOUT_MS`

项目只从项目根目录 `.env` 加载上述环境变量。region 未配置时默认 `cn-beijing`。

## Runtime Template Deployment

推荐把 veFaaS agent runtime 做成固定模板，而不是每次创建 agent 都打包代码、上传并重新构建镜像。

目标流程：

1. 平台维护一个版本化 runtime 模板，例如 `managed-agent-runtime:<version>` 或一个固定 veFaaS 应用版本。
2. 创建 agent 时只保存 `agent_config`、tool/mcp/skill 配置、权限策略和 sandbox 绑定，不触发镜像构建。
3. 租户 onboarding 或 workspace runtime pool 初始化时通过火山 OpenAPI 创建或复用 veFaaS 应用、API Gateway、upstream 和触发器，并把 `invoke_url`、`function_id`、`region` 写入 `workspace_runtime_pool_members`。
4. 创建 agent 时只保存 `agent_config`、tool/mcp/skill 配置、权限策略和模型绑定，不触发镜像构建。
5. 创建 session 时从 workspace runtime pool 选择函数成员，并把 `runtime_pool_id`、`runtime_pool_member_id`、`agent_runtime` 写入 session metadata。
6. session bootstrap 时由平台把 `session_id`、envs、resources 和 sandbox metadata 传给 runtime。
7. 只有 runtime 模板升级、系统依赖变更、基础工具镜像变更时才重新发布 veFaaS 应用。

这种模式下，火山 AK/SK 用于控制面自动创建或复用 veFaaS 应用、API Gateway、upstream 和触发器；业务用户创建 agent 不需要手动提供 invoke URL。invoke URL 是 provisioning 的结果，写回 workspace runtime pool member 记录。

需要保留一个高级路径给自定义代码或 native 依赖：用户可以选择自定义 runtime image/template，但默认 agent 创建走固定模板加配置发布。

## Bootstrap Request

The platform calls the function once when a session runtime is prepared:

```json
{
  "action": "bootstrap",
  "function_id": "<function-id>",
  "region": "cn-beijing",
  "workspace_path": "/workspace",
  "envs": {},
  "session_id": "sess_xxx",
  "resources": [
    {
      "type": "file",
      "mount_path": "/mnt/session/uploads/app.log",
      "content_base64": "..."
    }
  ]
}
```

The function should create the workspace, materialize uploaded files, and return:

```json
{ "ok": true, "result": { "runtime": "ready" } }
```

## Run Request

收到 `user.message` 后，平台把 agent loop 输入发给绑定的 veFaaS function：

```json
{
  "action": "run",
  "function_id": "<function-id>",
  "region": "cn-beijing",
  "session_id": "sess_xxx",
  "input": { "type": "user.message", "text": "List files." },
  "agent_config": {
    "name": "Managed Agent",
    "model": { "provider": "openai", "id": "glm-4-7-251222", "config_id": "modelcfg_xxx" },
    "agent_loop": { "type": "anthropic_claude_code", "config": {}, "hooks": [] },
    "tools": [{ "type": "agent_toolset", "configs": { "read": true, "write": true, "bash": true } }]
  },
  "agent_env": {
    "LMAP_WORKSPACE_ID": "ws_xxx",
    "LMAP_SESSION_ID": "sess_xxx",
    "LMAP_AGENT_RUNTIME_ROLE": "agent_loop",
    "LMAP_AGENT_TEMPLATE_SOURCE": "runtime_request",
    "LMAP_AGENT_TEMPLATE": "{\"name\":\"Managed Agent\",...}",
    "LMAP_AGENT_LOOP_TYPE": "anthropic_claude_code",
    "LMAP_AGENT_MODEL": "glm-4-7-251222",
    "LMAP_AGENT_TOOLS": "[{\"type\":\"agent_toolset\",...}]"
  },
  "tool_bridge": {
    "url": "https://control-plane.example.com/v1/runtime/sessions/sess_xxx/tools",
    "token": "rtb_xxx"
  },
  "sandbox_runtime": {
    "type": "e2b",
    "sandbox_id": "sbx_xxx",
    "workspace_path": "/workspace"
  }
}
```

veFaaS runtime 必须把 `agent_env` 注入 loop 进程，并支持通过 `LMAP_AGENT_TEMPLATE` 读取当前用户创建的 agent 模板。默认模板不随 agent 创建而重新打包，只有 `agent_config` 和 env 变化。

Expected response shape:

```json
{
  "ok": true,
  "result": {
    "message": "..."
  }
}
```

## Tool Bridge Request

veFaaS runtime 内部的 agent loop 需要执行工具时，调用控制面 tool bridge：

```json
{
  "tool": "bash",
  "input": { "command": "grep -RIn checkout /mnt/session/uploads/app.log | head" }
}
```

HTTP Header:

```text
Authorization: Bearer rtb_xxx
```

控制面校验 `runtime_tool_bridge_token` 后调用 `runRuntimeToolCall()`，再由 `executeTool()` 根据 session metadata 中的 `sandbox_runtime` 进入 E2B 或 local Docker。

当前工具名：

- `bash`
- `read_file`
- `write_file`
- `list_files`
- `grep`

响应：

```json
{
  "ok": true,
  "status": "completed",
  "tool_call_id": "bridge_xxx",
  "output": {
    "stdout": "...",
    "stderr": "",
    "exit_code": 0
  }
}
```

非 shell 工具的 `output` 保持本地 runtime shape，例如：

```json
{ "ok": true, "status": "completed", "tool_call_id": "bridge_xxx", "output": { "path": "app.log", "content": "..." } }
```

Errors should return either non-2xx HTTP or:

```json
{ "ok": false, "error": "permission denied" }
```

## Current Boundary

This is a runtime provider contract, not a full control-plane integration. Agent/session CRUD, events, Files API, custom tool handoff, memory and vault resources remain in this platform. The veFaaS function runs the agent loop; tool execution stays behind the control-plane sandbox bridge.
