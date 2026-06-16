import type { DocContentHelpers, DocPage } from "./DocumentationTypes";

export function workspacesDoc(helpers: DocContentHelpers): DocPage {
  const { L, Code, EndpointList, FieldTable } = helpers;
  return {
  	          title: L("Workspaces & keys", "Workspaces & keys"),
  	          lead: L(
  	            "Workspace 是所有 Agent、Environment、Session、Vault、Model config 的访问边界；workspace API key 是服务端集成调用 Maple API 的主要凭证。",
  	            "Workspaces are the access boundary for agents, environments, sessions, vaults, and model configs; workspace API keys are the main credential for server-side integrations."
  	          ),
  	          sections: [
  	            {
  	              id: "endpoints",
  	              h2: L("接口", "Endpoints"),
  	              body: (
  	                <EndpointList rows={[
  	                  ["GET /v1/workspace_onboarding/status", L("判断当前用户是否需要 onboarding，并返回可访问 workspaces。", "Check whether the current user needs onboarding and return accessible workspaces.")],
  	                  ["POST /v1/workspace_onboarding", L("首次创建 tenant、workspace、runtime pool、模型池和初始 workspace API key。", "Create the first tenant, workspace, runtime pool, model pool, and initial workspace API key.")],
  	                  ["GET /v1/workspaces", L("列出当前用户可访问 workspace；可用 workspace_id 缩小到同 tenant。", "List workspaces accessible by the current user; workspace_id narrows to the same tenant.")],
  	                  ["POST /v1/workspaces", L("在已有 tenant 下创建 workspace；无 tenant 的新用户会走同一创建链路创建第一个 tenant。", "Create a workspace under an existing tenant; a brand-new user with no tenant uses the same creation path for the first tenant.")],
  	                  ["GET /v1/workspaces/:workspaceId", L("读取 workspace。", "Retrieve a workspace.")],
  	                  ["PATCH /v1/workspaces/:workspaceId", L("只允许更新 name/description；runtime_pool、provider、slug、model_config_ids 不可变。", "Update only name/description; runtime_pool, providers, slug, and model_config_ids are immutable.")],
  	                  ["DELETE /v1/workspaces/:workspaceId", L("级联删除 workspace 及其 agents/sessions/environments/vaults/models/keys/members。", "Cascade-delete workspace resources including agents, sessions, environments, vaults, models, keys, and members.")],
  	                  ["GET /v1/workspaces/:workspaceId/runtime_pool", L("读取 workspace agent runtime pool 和成员状态。", "Read the workspace agent runtime pool and member status.")],
  	                  ["GET /v1/workspaces/:workspaceId/members", L("列出 workspace 成员。", "List workspace members.")],
  	                  ["POST /v1/workspaces/:workspaceId/members", L("按 email 添加 workspace member。", "Add a workspace member by email.")],
  	                  ["DELETE /v1/workspaces/:workspaceId/members/:userId", L("移除 workspace member。", "Remove a workspace member.")],
  	                  ["GET /v1/workspaces/:workspaceId/api_keys", L("列出 workspace API keys；管理员可获得加密保存后的完整 key。", "List workspace API keys; admins receive the full key decrypted from encrypted storage.")],
  	                  ["POST /v1/workspaces/:workspaceId/api_keys", L("签发新的 maple_ws_... workspace key；后端会加密保存完整 key。", "Issue a new maple_ws_... workspace key; the backend stores the full key encrypted.")],
  	                  ["PATCH /v1/workspaces/:workspaceId/api_keys/:keyId", L("更新 display_name/enabled。", "Update display_name/enabled.")],
  	                  ["DELETE /v1/workspaces/:workspaceId/api_keys/:keyId", L("删除 workspace API key。", "Delete a workspace API key.")]
  	                ]} />
  	              )
  	            },
  	            {
  	              id: "onboarding-request",
  	              h2: L("Onboarding 入参", "Onboarding request"),
  	              body: (
  	                <>
  	                  <FieldTable rows={[
  	                    { field: "tenant", type: "object", required: L("是", "Yes"), description: <span><code>name</code>, <code>description?</code></span> },
  	                    { field: "workspace", type: "object", required: L("是", "Yes"), description: <span><code>name</code>, <code>description?</code>, <code>slug?</code></span> },
  	                    { field: "runtime_provider", type: "vefaas", required: L("否", "No"), description: L("默认 vefaas。", "Defaults to vefaas.") },
  	                    { field: "runtime_pool", type: "object", required: L("是", "Yes"), description: <span><code>desired_size</code>, <code>min_instances_per_function</code>, <code>max_instances_per_function</code>, <code>max_concurrency_per_instance</code>, <code>cpu_milli</code>, <code>memory_mb</code></span> },
  	                    { field: "sandbox_provider", type: "e2b | vefaas", required: L("否", "No"), description: L("默认 e2b；选择 vefaas 时创建 VeFaaS 云沙箱实例。", "Defaults to e2b; vefaas creates a VeFaaS cloud sandbox instance.") },
  	                    { field: "sandbox_config.vefaas.function_id", type: "string", required: L("VeFaaS sandbox 必填", "Required for VeFaaS sandbox"), description: L("VeFaaS sandbox 应用 FunctionId。", "VeFaaS sandbox application FunctionId.") },
  	                    { field: "sandbox_config.vefaas.gateway_url", type: "string", required: L("VeFaaS sandbox 必填", "Required for VeFaaS sandbox"), description: L("沙箱应用统一访问域名；工具调用会携带 x-faas-instance-name。", "Sandbox application unified gateway URL; tool calls include x-faas-instance-name.") },
  	                    { field: "model_config_ids", type: "string[]", required: L("否", "No"), description: L("引用全局默认模型配置 id；后端校验它们存在。", "References global default model config ids; backend verifies they exist.") },
  	                    { field: "custom_model_configs", type: "object[]", required: L("否", "No"), description: L("可在 onboarding 时一起创建 workspace-scoped model configs。", "Create workspace-scoped model configs during onboarding.") },
  	                    { field: "api_key", type: "object", required: L("否", "No"), description: <span><code>display_name</code>, <code>scopes</code>，默认 <code>control_plane</code>/<code>data_plane</code>。</span> },
  	                    { field: "provider_credentials.vefaas.VOLCENGINE_ACCESS_KEY", type: "string", required: L("是", "Yes"), description: L("POST /v1/workspace_onboarding 当前会校验非空。", "POST /v1/workspace_onboarding currently requires a non-empty value.") },
  	                    { field: "provider_credentials.vefaas.VOLCENGINE_SECRET_KEY", type: "string", required: L("是", "Yes"), description: L("POST /v1/workspace_onboarding 当前会校验非空。", "POST /v1/workspace_onboarding currently requires a non-empty value.") },
  	                    { field: "provider_credentials.vefaas.VEFAAS_REGION", type: "string", required: L("是", "Yes"), description: L("用于 runtime pool member region。", "Used as runtime pool member region.") },
  	                    { field: "provider_credentials.e2b.E2B_API_KEY", type: "string", required: L("E2B sandbox 必填", "Required for E2B sandbox"), description: L("sandbox_provider=e2b 时校验非空。", "Required when sandbox_provider=e2b.") }
  	                  ]} />
  	                  <Code>{`{
    "tenant": { "name": "Acme Platform", "description": "Managed agent tenant" },
    "workspace": { "name": "Default Workspace", "description": "Primary workspace", "slug": "default-workspace" },
    "runtime_provider": "vefaas",
    "runtime_pool": {
      "desired_size": 2,
      "min_instances_per_function": 1,
      "max_instances_per_function": 100,
      "max_concurrency_per_instance": 1000,
      "cpu_milli": 2000,
      "memory_mb": 4096
    },
    "sandbox_provider": "e2b",
    "sandbox_config": {},
    "model_config_ids": ["modelcfg_xxx"],
    "api_key": { "display_name": "Default workspace key", "scopes": ["control_plane", "data_plane"] },
    "provider_credentials": {
      "vefaas": {
        "VOLCENGINE_ACCESS_KEY": "...",
        "VOLCENGINE_SECRET_KEY": "...",
        "VEFAAS_REGION": "cn-beijing"
      },
      "e2b": { "E2B_API_KEY": "..." }
    }
  }`}</Code>
  	                </>
  	              )
  	            },
  	            {
  	              id: "onboarding-response",
  	              h2: L("Onboarding 出参", "Onboarding response"),
  	              body: (
  	                <Code>{`{
    "tenant": { "id": "tenant_xxx", "name": "Acme Platform", "status": "active" },
    "workspace": {
      "id": "ws_xxx",
      "tenant_id": "tenant_xxx",
      "name": "Default Workspace",
      "runtime_provider": "vefaas",
      "sandbox_provider": "e2b",
      "config": {
        "slug": "default-workspace",
        "runtime_provider": "vefaas",
        "sandbox_provider": "e2b",
        "runtime_pool": { "desired_size": 2, "min_instances_per_function": 1, "cpu_milli": 2000, "memory_mb": 4096 },
        "model_config_ids": ["modelcfg_xxx"],
        "provider_credentials": { "vefaas": { "VEFAAS_REGION": "cn-beijing" }, "e2b": {} },
        "immutable": true
      }
    },
    "runtime_pool": {
      "id": "rpool_xxx",
      "workspace_id": "ws_xxx",
      "provider": "vefaas",
      "desired_size": 2,
      "min_instances_per_function": 1,
      "members": [{ "id": "rpmem_xxx", "status": "active", "invoke_url": "https://..." }]
    },
    "api_key": {
      "id": "wskey_xxx",
      "workspace_id": "ws_xxx",
      "display_name": "Default workspace key",
      "scopes": ["control_plane", "data_plane"],
      "enabled": true,
      "key": "maple_ws_xxx"
    }
  }`}</Code>
  	              )
  	            },
  	            {
  	              id: "api-key-fields",
  	              h2: L("Workspace API key", "Workspace API key"),
  	              body: (
  	                <>
  	                  <FieldTable rows={[
  	                    { field: "display_name", type: "string", required: L("是", "Yes"), description: L("API key 展示名。", "API key display name.") },
  	                    { field: "scopes", type: "string[]", required: L("否", "No"), description: L("默认 control_plane/data_plane；当前后端只存储 scopes，不做细粒度 scope 判定。", "Defaults to control_plane/data_plane; current backend stores scopes but does not yet enforce fine-grained scope checks.") },
  	                    { field: "enabled", type: "boolean", required: L("PATCH 可选", "Optional on PATCH"), description: L("禁用后该 key 不再可用于认证。", "When disabled, the key can no longer authenticate.") }
  	                  ]} />
  	                  <Code>{`curl "$MAPLE_API_BASE_URL/v1/workspaces/ws_xxx/api_keys" \\
    -H "X-Maple-API-Key: $MAPLE_API_KEY" \\
    -H "Content-Type: application/json" \\
    -d '{"display_name":"CI integration","scopes":["control_plane","data_plane"]}'`}</Code>
  	                  <Code>{`{
    "id": "wskey_xxx",
    "workspace_id": "ws_xxx",
    "display_name": "CI integration",
    "scopes": ["control_plane", "data_plane"],
    "enabled": true,
    "created_at": "2026-06-09T00:00:00.000Z",
    "updated_at": "2026-06-09T00:00:00.000Z",
    "last_used_at": null,
    "key": "maple_ws_xxx"
  }`}</Code>
  	                </>
  	              )
  	            }
  	          ]
  	        };
}

export function agentsDoc(helpers: DocContentHelpers): DocPage {
  const { L, Code, EndpointList, FieldTable } = helpers;
  return {
            title: "Agents API",
            lead: L(
              "Agents API 管理 system prompt、模型、工具、MCP、skills 和 agent loop 配置。",
              "The Agents API manages system prompts, models, tools, MCP, skills, and agent loop configuration."
            ),
            sections: [
              {
                id: "endpoints",
                h2: L("接口", "Endpoints"),
                body: (
                  <EndpointList rows={[
                    ["GET /v1/agents?workspace_id=ws_xxx", L("列出可访问 workspace 的 agents。", "List agents in accessible workspaces.")],
                    ["POST /v1/agents", L("创建 agent；成功返回 201。", "Create an agent; returns 201 on success.")],
                    ["GET /v1/agents/:agentId", L("读取 agent；返回展开后的 config 字段。", "Retrieve an agent with expanded config fields.")],
                    ["PATCH /v1/agents/:agentId", L("局部更新 agent config。", "Partially update agent config.")],
                    ["POST /v1/agents/:agentId", L("兼容更新入口，行为与 PATCH 相同。", "Compatibility update endpoint with the same behavior as PATCH.")],
                    ["GET /v1/agents/:agentId/versions", L("列出版本记录。", "List version records.")],
                    ["GET /v1/agents/:agentId/runtime", L("读取 workspace runtime pool 和最近 session runtime 元数据。", "Read workspace runtime pool and recent session runtime metadata.")]
                  ]} />
                )
              },
              {
                id: "request",
                h2: L("创建入参", "Create request"),
                body: (
                  <>
                    <FieldTable rows={[
                      { field: "workspace_id", type: "string", required: L("否", "No"), description: L("不传时 workspace key 优先使用所属 workspace，其他登录态回退到当前用户第一个 workspace。", "When omitted, workspace keys default to their bound workspace; other auth defaults to the current user's first workspace.") },
                      { field: "name", type: "string", required: L("是", "Yes"), description: L("Agent 名称。", "Agent name.") },
                      { field: "description", type: "string", required: L("是", "Yes"), description: L("Agent 描述。", "Agent description.") },
                      { field: "model", type: "object", required: L("是", "Yes"), description: <span><code>provider</code>, <code>id</code>, <code>speed?</code>, <code>config_id?</code>, <code>name?</code></span> },
                      { field: "system", type: "string", required: L("是", "Yes"), description: L("系统提示词。", "System prompt.") },
                      { field: "tools", type: "object[]", required: L("否", "No"), description: L("默认 []。工具对象原样存入 config。", "Defaults to []. Tool objects are stored in config as provided.") },
                      { field: "mcp_servers", type: "object[]", required: L("否", "No"), description: L("默认 []。", "Defaults to [].") },
                      { field: "skills", type: "object[]", required: L("否", "No"), description: L("默认 []。", "Defaults to [].") },
                      { field: "agent_loop", type: "object", required: L("否", "No"), description: <span><code>type</code> 为 <code>anthropic_claude_code</code> 或 <code>codex_open_source</code>，含 <code>config</code> 与 <code>hooks</code>。</span> },
                      { field: "multiagent", type: "object", required: L("否", "No"), description: L("可选多 agent 配置。", "Optional multi-agent config.") },
                      { field: "metadata", type: "object", required: L("否", "No"), description: L("可选元数据。", "Optional metadata.") }
                    ]} />
                    <Code>{`{
    "workspace_id": "ws_xxx",
    "name": "Platform SDK Agent",
    "description": "Created through the Maple SDK.",
    "model": {
      "provider": "custom",
      "id": "glm-4-7-251222",
      "config_id": "modelcfg_xxx",
      "name": "Default model"
    },
    "agent_loop": { "type": "codex_open_source", "config": {}, "hooks": [] },
    "system": "Respond with concise evidence.",
    "tools": [],
    "mcp_servers": [],
    "skills": []
  }`}</Code>
                  </>
                )
              },
              {
                id: "response",
                h2: L("出参", "Response"),
                body: (
                  <>
                    <p className="doc-p">
                      {L(
                        "返回对象会带 type=agent，并把 config 内字段展开到顶层，同时保留完整 config。",
                        "The response includes type=agent, expands config fields to the top level, and keeps the full config object."
                      )}
                    </p>
                    <Code>{`{
    "type": "agent",
    "id": "agent_xxx",
    "workspace_id": "ws_xxx",
    "name": "Platform SDK Agent",
    "description": "Created through the Maple SDK.",
    "version": 1,
    "current_version": 1,
    "model": { "provider": "custom", "id": "glm-4-7-251222", "config_id": "modelcfg_xxx" },
    "agent_loop": { "type": "codex_open_source", "config": {}, "hooks": [] },
    "system": "Respond with concise evidence.",
    "tools": [],
    "mcp_servers": [],
    "skills": [],
    "config": { "...": "canonical agent config" },
    "created_at": "2026-06-09T00:00:00.000Z",
    "updated_at": "2026-06-09T00:00:00.000Z"
  }`}</Code>
                  </>
                )
              }
            ]
          };
}
