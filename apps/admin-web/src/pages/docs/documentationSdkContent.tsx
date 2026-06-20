import type { DocContentHelpers, DocPage } from "./DocumentationTypes";

export function errorsDoc(helpers: DocContentHelpers): DocPage {
  const { L, Code } = helpers;
  return {
            title: L("错误与状态码", "Errors"),
            lead: L(
              "当前 API 错误形状有两类：业务错误返回 { error, message? }；Zod 校验错误返回 flatten 后的 { formErrors, fieldErrors }。",
              "Current API errors have two shapes: business errors return { error, message? }; Zod validation errors return flattened { formErrors, fieldErrors }."
            ),
            sections: [
              {
                id: "shapes",
                h2: L("错误结构", "Error shapes"),
                body: (
                  <>
                    <Code>{`{ "error": "workspace_forbidden" }
  { "error": "agent_or_environment_not_found" }
  { "error": "environment_agent_runtime_forbidden" }
  { "error": "event_type_not_client_writable", "type": "agent.message" }
  { "formErrors": [], "fieldErrors": { "name": ["Too small: expected string to have >=1 characters"] } }`}</Code>
                  </>
                )
              },
              {
                id: "status",
                h2: L("常见状态码", "Common status codes"),
                body: (
                  <table className="doc-table">
                    <thead>
                      <tr>
                        <th>{L("状态", "Status")}</th>
                        <th>{L("来源", "Source")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr><td>400</td><td>{L("schema 校验失败、非法事件类型、环境中包含 agent runtime 配置、OAuth provider/client 未配置。", "Schema validation failure, invalid event type, agent runtime config in environment, or OAuth provider/client not configured.")}</td></tr>
                      <tr><td>401</td><td><code>login_required</code> / <code>invalid_or_expired_session</code></td></tr>
                      <tr><td>403</td><td><code>workspace_forbidden</code> / <code>workspace_admin_required</code> / <code>session_forbidden</code></td></tr>
                      <tr><td>404</td><td><code>agent_not_found</code> / <code>environment_not_found</code> / <code>session_not_found</code> / <code>vault_not_found</code></td></tr>
                      <tr><td>409</td><td>{L("部分 deployment 唯一约束冲突。", "Some deployment unique constraint conflicts.")}</td></tr>
                      <tr><td>500</td><td><code>deployment_resource_create_failed</code></td></tr>
                      <tr><td>502</td><td><code>agent_draft_generation_failed</code></td></tr>
                      <tr><td>503</td><td><code>database_unavailable</code></td></tr>
                    </tbody>
                  </table>
                )
              }
            ]
          };
}

export function sdkDoc(helpers: DocContentHelpers): DocPage {
  const { L, Code, FieldTable } = helpers;
  return {
            title: L("Node/TypeScript SDK", "Node/TypeScript SDK"),
            lead: L(
              "Node/TypeScript SDK 已发布为 maple-agent-sdk；Vault/MCP 仍直接使用 REST API。",
              "The Node/TypeScript SDK is published as maple-agent-sdk; Vault/MCP still use REST directly."
            ),
            sections: [
              {
                id: "auth",
                h2: L("初始化与认证", "Initialization and auth"),
                body: (
                  <>
                    <p className="doc-p">
                      {L(
                        "MapleClient 可以读取环境变量，但控制台集成代码会直接带入 production base URL、workspace id、agent id、environment id 和模型 id。",
                        "MapleClient can read environment variables, but the console integration code fills in the production base URL, workspace id, agent id, environment id, and model id directly."
                      )}
                    </p>
                    <Code>{`import { MapleClient, defineHarness } from "maple-agent-sdk";

  export const client = new MapleClient({
    baseURL: "http://127.0.0.1:27951",
    apiKey: process.env.MAPLE_API_KEY || "maple_ws_xxx",
    workspaceId: "ws_xxx"
  });`}</Code>
                  </>
                )
              },
              {
                id: "methods",
                h2: L("已封装方法", "Wrapped methods"),
                body: (
                  <FieldTable rows={[
                    { field: "version()", type: "Promise<object>", required: "-", description: <code>GET /v1/platform/version</code> },
                    { field: "me()", type: "Promise", required: "-", description: <code>GET /v1/auth/me</code> },
                    { field: "listWorkspaces()", type: "Promise", required: "-", description: <code>GET /v1/workspaces</code> },
                    { field: "workspaceOnboardingStatus()", type: "Promise", required: "-", description: <code>GET /v1/workspace_onboarding/status</code> },
                    { field: "onboardWorkspace(input)", type: "Promise", required: "-", description: <code>POST /v1/workspace_onboarding</code> },
                    { field: "listModelConfigs()", type: "Promise", required: "-", description: <code>GET /v1/model_configs</code> },
                    { field: "listAgents({ workspaceId? })", type: "Promise", required: "-", description: <code>GET /v1/agents</code> },
                    { field: "createAgent(input)", type: "Promise", required: "-", description: <code>POST /v1/agents</code> },
                    { field: "getAgent(id)", type: "Promise", required: "-", description: <code>GET /v1/agents/:agentId</code> },
                    { field: "createEnvironment(input)", type: "Promise", required: "-", description: <code>POST /v1/environments</code> },
                    { field: "listDeployments()", type: "Promise", required: "-", description: <code>GET /v1/deployments</code> },
                    { field: "createDeployment(input)", type: "Promise", required: "-", description: <code>POST /v1/deployments</code> },
                    { field: "getDeployment(id)", type: "Promise", required: "-", description: <code>GET /v1/deployments/:deploymentId</code> },
                    { field: "invokeDeployment(id, input)", type: "Promise", required: "-", description: <code>POST /v1/deployments/:deploymentId/invoke</code> },
                    { field: "createSession(input)", type: "Promise", required: "-", description: <code>POST /v1/sessions</code> },
                    { field: "sessionDetail(id)", type: "Promise", required: "-", description: <code>GET /v1/sessions/:sessionId/detail</code> },
                    { field: "listSessionEvents(id)", type: "Promise", required: "-", description: <code>GET /v1/sessions/:sessionId/events</code> },
                    { field: "postSessionEvents(id, events)", type: "Promise", required: "-", description: <code>POST /v1/sessions/:sessionId/events</code> },
                    { field: "postSessionMessage(id, message)", type: "Promise", required: "-", description: <code>POST /v1/sessions/:sessionId/events</code> },
                    { field: "sendSessionMessage(id, message)", type: "Promise", required: "-", description: L("postSessionMessage 的别名。", "Alias for postSessionMessage.") },
                    { field: "streamSessionEvents(id, options?)", type: "EventEmitter", required: "-", description: <code>GET /v1/sessions/:sessionId/events/stream</code> },
                    { field: "createSessionAndStream(input, options?)", type: "Promise", required: "-", description: L("先建立 SSE，再发送 user.message。", "Opens SSE before posting user.message.") }
                  ]} />
                )
              },
              {
                id: "flow",
                h2: L("端到端示例", "End-to-end example"),
                body: (
                  <Code>{`import { MapleClient } from "maple-agent-sdk";

  export const client = new MapleClient({
    baseURL: "http://127.0.0.1:27951",
    apiKey: process.env.MAPLE_API_KEY || "maple_ws_xxx",
    workspaceId: "ws_xxx"
  });

  export const environment = await client.createEnvironment({
    workspace_id: "ws_xxx",
    name: "platform-sdk-managed-sandbox",
    config: {
      type: "e2b",
      sandbox: {
        provider: "e2b",
        e2b: { template: "base", workspace_path: "/workspace" }
      },
      image: "node:22-bookworm",
      networking: { mode: "limited" }
    }
  });

  export const agent = await client.createAgent({
    workspace_id: "ws_xxx",
    name: "Platform SDK Agent",
    description: "Created through the Maple SDK.",
    model: "model_xxx",
    agent_loop: { type: "codex_open_source", config: {}, hooks: [] },
    system: "Respond with concise evidence.",
    tools: [],
    mcp_servers: [],
    skills: []
  });

  const run = await client.createSessionAndStream({
    workspace_id: "ws_xxx",
    agent: agent.id,
    environment_id: environment.id,
    title: "platform-sdk-smoke",
    metadata: { integration_model_id: "model_xxx" },
    message: "Use the platform SDK path."
  }, {
    onEvent(event) {
      if (event.type === "agent.message_delta") process.stdout.write(String(event.text ?? ""));
      if (event.type === "session.status_failed") console.error(event.error ?? event.payload);
    }
  });

  await run.done;`}</Code>
                )
              }
            ]
          };
}

export function cliDoc(helpers: DocContentHelpers): DocPage {
  const { L, Code, EndpointList } = helpers;
  return {
            title: "Maple CLI",
            lead: L(
              "Maple CLI 是 OpenMaple 的终端入口，用于登录 workspace、初始化 agent 项目、构建、部署、调用和查看 session 事件。",
              "Maple CLI is the terminal entry point for OpenMaple: sign in to a workspace, initialize agent projects, build, deploy, invoke, and inspect session events."
            ),
            sections: [
              {
                id: "install",
                h2: L("安装与配置", "Install and configure"),
                body: (
                  <>
                    <p className="doc-p">
                      {L(
                        "npm 包内置 Go CLI 源码，首次运行会构建并缓存二进制。Go 1.23+ 必须已安装。",
                        "The npm package ships the Go CLI source and builds a cached binary on first run. Go 1.23+ must be installed."
                      )}
                    </p>
                    <Code>{`npm install -g maple-agent-cli
  maple config set api.baseUrl http://127.0.0.1:27951
  maple config login --api-key <maple_ws_...>
  maple config whoami
  maple version --json`}</Code>
                  </>
                )
              },
              {
                id: "project-flow",
                h2: L("项目流", "Project flow"),
                body: (
                  <>
                    <p className="doc-p">
                      {L(
                        "init 生成 maple.manifest.json；build 产出 .maple/build；deploy 创建或更新 platform 资源。",
                        "init creates maple.manifest.json; build writes .maple/build; deploy creates or updates platform resources."
                      )}
                    </p>
                    <Code>{`maple init --name repo-auditor --loop codex_open_source --runtime e2b --directory ./repo-auditor --yes
  maple build --project ./repo-auditor
  maple deploy --project ./repo-auditor --json
  maple invoke "Inspect the workspace and report evidence." --deployment <deployment_id> --stream
  maple status --session <session_id> --json`}</Code>
                  </>
                )
              },
              {
                id: "resources",
                h2: L("一等资源命令", "First-class resource commands"),
                body: (
                  <EndpointList rows={[
                    ["maple agent list/create/update/versions/runtime", L("管理 agent config、版本和运行时状态。", "Manage agent config, versions, and runtime state.")],
                    ["maple environment list/create/update", L("创建 e2b、local container、vefaas 等 sandbox environment。", "Create e2b, local container, vefaas, and related sandbox environments.")],
                    ["maple session create/detail/events/message/stream/ask", L("创建 session、发送消息、读事件、打开 Ask Maple。", "Create sessions, send messages, read events, stream events, and run Ask Maple.")],
                    ["maple vault credential create/oauth-start", L("创建 credential metadata 并启动 MCP OAuth。", "Create credential metadata and start MCP OAuth.")],
                    ["maple workspace api-key create", L("签发 workspace API key。", "Issue workspace API keys.")],
                    ["maple model-config list/create/test", L("管理模型接入点并测试连接。", "Manage model endpoints and test connectivity.")],
                    ["maple mcp catalog/list/create/oauth-start", L("查看 preset MCP catalog 和用户 MCP server。", "Inspect the preset MCP catalog and user-managed MCP servers.")],
                    ["maple memory-store list/create/memories/put", L("管理 workspace-scoped 长期记忆。", "Manage workspace-scoped long-term memory.")],
                    ["maple api <METHOD> <path>", L("覆盖所有尚未封装的一般 REST API。", "Reach any REST endpoint not yet covered by a first-class command.")]
                  ]} />
                )
              },
              {
                id: "codex",
                h2: L("Codex agent loop", "Codex agent loop"),
                body: (
                  <>
                    <p className="doc-p">
                      {L(
                        "agent_loop.type 使用 codex_open_source 时，runtime 会调用 Codex CLI；veFaaS runtime 可通过 MAPLE_CODEX_COMMAND 或 MAPLE_AGENT_LOOP_INSTALL_POLICY=auto 提供 CLI。",
                        "When agent_loop.type is codex_open_source, the runtime calls the Codex CLI; veFaaS runtime can provide it through MAPLE_CODEX_COMMAND or MAPLE_AGENT_LOOP_INSTALL_POLICY=auto."
                      )}
                    </p>
                    <Code>{`maple init --name codex-worker --loop codex_open_source --runtime vefaas --directory ./codex-worker --yes
  maple build --project ./codex-worker
  maple deploy --project ./codex-worker --json
  maple invoke "Run a workspace smoke test." --deployment <deployment_id> --stream`}</Code>
                  </>
                )
              }
            ]
          };
}

export function skillsDoc(helpers: DocContentHelpers): DocPage {
  const { L, Code, FieldTable } = helpers;
  return {
            title: L("Skills 模块", "Skills modules"),
            lead: L(
              "OpenMaple skills 是可复用的 agent 操作说明，既可以本地存在 ~/.agents/skills，也可以通过 Maple CLI 推送到平台并绑定 agent。",
              "OpenMaple skills are reusable agent instructions. They can live locally under ~/.agents/skills, or be pushed through Maple CLI and attached to agents."
            ),
            sections: [
              {
                id: "model",
                h2: L("Skill 结构", "Skill structure"),
                body: (
                  <>
                    <p className="doc-p">
                      {L(
                        "推荐像 lark-cli 一样按资源域拆分，而不是把所有操作写进一个巨型 skill。每个模块保持清晰触发词、命令、输出约束和安全边界。",
                        "Split skills by resource domain, like lark-cli does, instead of putting every operation into one giant skill. Keep triggers, commands, output contracts, and safety boundaries explicit."
                      )}
                    </p>
                    <Code>{`~/.agents/skills/openmaple-agent/SKILL.md
  ~/.agents/skills/openmaple-session/SKILL.md
  ~/.agents/skills/openmaple-vault/SKILL.md
  ~/.agents/skills/openmaple-mcp/SKILL.md
  ~/.agents/skills/openmaple-workspace/SKILL.md
  ~/.agents/skills/openmaple-runtime/SKILL.md
  ~/.agents/skills/openmaple-memory/SKILL.md
  ~/.agents/skills/openmaple-deployment/SKILL.md`}</Code>
                  </>
                )
              },
              {
                id: "modules",
                h2: L("推荐拆分", "Recommended modules"),
                body: (
                  <FieldTable rows={[
                    { field: "openmaple-agent", type: "agent config", required: L("建议", "Suggested"), description: L("创建、读取、更新 agent，管理 model/system/tools/agent_loop。", "Create, read, update agents, and manage model/system/tools/agent_loop.") },
                    { field: "openmaple-runtime", type: "runtime/sandbox", required: L("建议", "Suggested"), description: L("配置 provider、runtime pool、sandbox provider、Codex/Claude loop。", "Configure providers, runtime pools, sandbox providers, and Codex/Claude loops.") },
                    { field: "openmaple-session", type: "session events", required: L("建议", "Suggested"), description: L("创建 session、发送 user.message、读取 detail/events/SSE/tool_calls。", "Create sessions, send user.message, and inspect detail/events/SSE/tool_calls.") },
                    { field: "openmaple-vault", type: "credentials", required: L("建议", "Suggested"), description: L("创建 vault、credential、OAuth start、查看 credential detail。", "Create vaults, credentials, OAuth starts, and inspect credential detail.") },
                    { field: "openmaple-mcp", type: "MCP", required: L("建议", "Suggested"), description: L("管理 preset catalog、用户 MCP server、OAuth 状态与注入验证。", "Manage preset catalog, user MCP servers, OAuth state, and injection checks.") },
                    { field: "openmaple-workspace", type: "tenant/workspace", required: L("建议", "Suggested"), description: L("onboarding、workspace key、成员、tenant cloud provider identity。", "Onboarding, workspace keys, members, and tenant cloud provider identity.") },
                    { field: "openmaple-memory", type: "memory store", required: L("可选", "Optional"), description: L("管理 memory store、memory entry、检索和写入。", "Manage memory stores, entries, retrieval, and writes.") },
                    { field: "openmaple-deployment", type: "deployment", required: L("可选", "Optional"), description: L("部署、调用、读取 deployment 状态和 session 证据。", "Deploy, invoke, and inspect deployment state and session evidence.") }
                  ]} />
                )
              },
              {
                id: "cli",
                h2: L("用 CLI 管理 skill", "Manage skills with CLI"),
                body: (
                  <Code>{`maple skill list --json
  maple skill init --name openmaple-session --description "Use when creating or inspecting OpenMaple sessions." --directory ./skills/openmaple-session --yes
  maple skill push --name openmaple-session --description "Use when creating or inspecting OpenMaple sessions." --file ./skills/openmaple-session/SKILL.md --json
  maple skill deploy-run \\
    --name openmaple-session \\
    --description "Use when creating or inspecting OpenMaple sessions." \\
    --project ./openmaple-session-agent \\
    --loop codex_open_source \\
    --runtime e2b \\
    --prompt "Create a session, send a smoke message, and report evidence." \\
    --json`}</Code>
                )
              },
              {
                id: "agent-config",
                h2: L("Agent 绑定", "Attach to agent"),
                body: (
                  <Code>{`{
    "name": "openmaple-session-runner",
    "agent_loop": { "type": "codex_open_source", "config": {}, "hooks": [] },
    "skills": [
      { "name": "openmaple-session", "version": "latest" },
      { "name": "openmaple-runtime", "version": "latest" }
    ],
    "tools": [],
    "mcp_servers": []
  }`}</Code>
                )
              }
            ]
          };
}
