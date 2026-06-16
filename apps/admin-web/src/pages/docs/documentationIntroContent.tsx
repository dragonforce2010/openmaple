import { Icon } from "../../ui";
import type { DocContentHelpers, DocPage } from "./DocumentationTypes";

export function overviewDoc(helpers: DocContentHelpers): DocPage {
  const { L, Code, DocCard } = helpers;
  return {
            title: "OpenMaple API",
            lead: L(
              "OpenMaple 提供面向生产工作区的 REST API、Node/TypeScript SDK 和 CLI，用于创建 agent、environment、session、vault、MCP server，并观察事件流。",
              "OpenMaple provides production workspace REST APIs, a Node/TypeScript SDK, and a CLI for agents, environments, sessions, vaults, MCP servers, and event streams."
            ),
            sections: [
              {
                id: "start",
                h2: L("入口", "Entry points"),
                body: (
                  <div className="doc-cards">
  	                  <DocCard id="quickstart" icon="i-play" title={L("快速上手", "Quickstart")} desc={L("创建环境、Agent 和 Session。", "Create an environment, agent, and session.")} />
  	                  <DocCard id="authentication" icon="i-key" title={L("认证", "Authentication")} desc={L("cookie、Bearer 和 workspace key。", "Cookie, Bearer, and workspace key auth.")} />
  	                  <DocCard id="workspaces-api" icon="i-grid" title={L("Workspaces & keys", "Workspaces & keys")} desc={L("onboarding、runtime pool、成员和 API key。", "Onboarding, runtime pool, members, and API keys.")} />
  	                  <DocCard id="agents-api" icon="i-brain" title="Agents API" desc={L("system、model、tools、agent loop。", "System, model, tools, agent loop.")} />
                    <DocCard id="sessions-api" icon="i-terminal" title="Sessions API" desc={L("run、events、SSE、artifacts。", "Runs, events, SSE, artifacts.")} />
                    <DocCard id="environments-api" icon="i-boxes" title="Environments API" desc={L("sandbox 配置。", "Sandbox config.")} />
                    <DocCard id="vaults-api" icon="i-key" title="Vaults API" desc={L("凭证引用与 OAuth 状态。", "Credential references and OAuth status.")} />
                    <DocCard id="cli" icon="i-terminal" title="Maple CLI" desc={L("终端创建、部署、调用 agent。", "Create, deploy, and invoke agents from terminal.")} />
                    <DocCard id="skills" icon="i-sparkles" title={L("Skills 模块", "Skills modules")} desc={L("按资源域拆分可复用 agent skills。", "Resource-scoped reusable agent skills.")} />
                  </div>
                )
              },
              {
                id: "base-url",
                h2: L("基础 URL 与版本", "Base URL & versioning"),
                body: (
                  <>
                    <p className="doc-p">
                      {L(
                        "API base URL 由 OpenMaple 控制台提供；平台版本读取 GET /v1/platform/version。",
                        "The API base URL is provided by the OpenMaple console; platform version is available at GET /v1/platform/version."
                      )}
                    </p>
                    <Code>{"GET <MAPLE_API_BASE_URL>/v1/platform/version"}</Code>
                  </>
                )
              },
              {
                id: "resource-model",
                h2: L("资源关系", "Resource model"),
                body: (
                  <>
                    <p className="doc-p">
                      {L(
                        "最小运行链路是 workspace -> environment + agent -> session -> session_events/tool_calls/artifacts；vault_ids 和 resources 存在 session.metadata 中。",
                        "The minimal run path is workspace -> environment + agent -> session -> session_events/tool_calls/artifacts; vault_ids and resources live in session.metadata."
                      )}
                    </p>
                    <Code>{"workspace\n  environment (sandbox config)\n  agent (model + system + tools + agent_loop)\n  vault (credential metadata, no secret in API response)\n  session (agent + environment + vault_ids + resources)\n    session_events\n    tool_calls\n    session_artifacts"}</Code>
                  </>
                )
              },
              {
                id: "source",
                h2: L("真实性来源", "Truth sources"),
                body: (
                  <div className="doc-callout">
                    <Icon name="i-book" size={15} />
                    <span>
                      {L(
                        "本页内容按 apps/control-plane-api/src/routes/* 的 zod schema、storage hydrate 输出、maple-agent-sdk 的 MapleClient 方法生成；未发布的 Python SDK 和虚构速率限制不在当前能力内。",
                        "This page follows apps/control-plane-api/src/routes/* zod schemas, storage hydrate output, and maple-agent-sdk MapleClient methods; unpublished Python SDKs and invented rate limits are outside the current capability set."
                      )}
                    </span>
                  </div>
                )
              }
            ]
          };
}

export function quickstartDoc(helpers: DocContentHelpers): DocPage {
  const { L, Code } = helpers;
  return {
            title: L("快速上手", "Quickstart"),
            lead: L(
              "使用当前 Maple REST API 和仓库内置 SDK，创建环境、Agent、Session，并发送第一条消息。",
              "Use the current Maple REST API and repository SDK to create an environment, agent, session, and first message."
            ),
            sections: [
              {
                id: "base",
                h2: L("基础地址", "Base URL"),
                body: (
                  <>
                    <p className="doc-p">
                      {L(
                        "在 Maple 控制台的 API 设置中复制 API base URL 与 workspace key；控制面接口统一使用 /v1 前缀。",
                        "Copy the API base URL and workspace key from Maple console API settings; control-plane endpoints use the /v1 prefix."
                      )}
                    </p>
                    <Code>{"export MAPLE_API_BASE_URL=\"${MAPLE_API_BASE_URL:-https://sd8ihq8v316pc5mf9c1j0.apigateway-cn-beijing.volceapi.com}\"\nexport MAPLE_API_KEY=\"maple_ws_xxx\"\nexport MAPLE_WORKSPACE_ID=\"ws_xxx\""}</Code>
                  </>
                )
              },
              {
                id: "create-environment",
                h2: L("创建 Environment", "Create an environment"),
                body: (
                  <>
                    <p className="doc-p">
                      {L(
                        "Environment 定义 session 的 sandbox。用户接口只接受 sandbox 配置，不接受 agent runtime 配置。",
                        "An environment defines the session sandbox. User-facing environment APIs accept sandbox config, not agent runtime config."
                      )}
                    </p>
                    <Code>{`curl "$MAPLE_API_BASE_URL/v1/environments" \\
    -H "X-Maple-API-Key: $MAPLE_API_KEY" \\
    -H "Content-Type: application/json" \\
    -d '{
      "workspace_id": "ws_xxx",
      "name": "managed-sandbox",
      "config": {
        "type": "e2b",
        "sandbox": {
          "provider": "e2b",
          "e2b": { "template": "base", "workspace_path": "/workspace" }
        },
        "image": "node:22-bookworm",
        "networking": { "mode": "limited" }
      }
    }'`}</Code>
                  </>
                )
              },
              {
                id: "create-agent",
                h2: L("创建 Agent", "Create an agent"),
                body: (
                  <>
                    <p className="doc-p">
                      {L(
                        "Agent 必须给出模型、system prompt、agent_loop；workspace 下创建时，model.config_id 必须属于该 workspace 的模型池。",
                        "An agent needs model, system prompt, and agent_loop. When scoped to a workspace, model.config_id must belong to that workspace model pool."
                      )}
                    </p>
                    <Code>{`curl "$MAPLE_API_BASE_URL/v1/agents" \\
    -H "X-Maple-API-Key: $MAPLE_API_KEY" \\
    -H "Content-Type: application/json" \\
    -d '{
      "workspace_id": "ws_xxx",
      "name": "repo-reviewer",
      "description": "Review repository changes with concrete evidence.",
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
    }'`}</Code>
                  </>
                )
              },
              {
                id: "run-session",
                h2: L("创建 Session 并发送消息", "Create a session and send a message"),
                body: (
                  <>
                    <p className="doc-p">
                      {L(
                        "Session 创建使用字段 agent，不是 agent_id；agent 可传字符串 id，也可传包含 id 的对象。",
                        "Session creation uses the agent field, not agent_id. Pass either an agent id string or an object containing id."
                      )}
                    </p>
                    <Code>{`SESSION_RESPONSE=$(curl -sS "$MAPLE_API_BASE_URL/v1/sessions" \\
    -H "X-Maple-API-Key: $MAPLE_API_KEY" \\
    -H "Content-Type: application/json" \\
    -d '{
      "workspace_id": "ws_xxx",
      "agent": "agent_xxx",
      "environment_id": "env_xxx",
      "title": "repo review smoke",
      "vault_ids": [],
      "resources": [],
      "metadata": { "source": "docs_quickstart" }
    }')
  SESSION_ID=$(printf '%s\\n' "$SESSION_RESPONSE" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' | head -n 1)
  if [ -z "$SESSION_ID" ]; then
    printf '%s\\n' "$SESSION_RESPONSE"
    exit 1
  fi

  curl "$MAPLE_API_BASE_URL/v1/sessions/$SESSION_ID/events" \\
    -H "X-Maple-API-Key: $MAPLE_API_KEY" \\
    -H "Content-Type: application/json" \\
    -d '{"events":[{"type":"user.message","content":[{"type":"text","text":"Inspect the workspace."}]}]}'`}</Code>
                  </>
                )
              }
            ]
          };
}

export function authenticationDoc(helpers: DocContentHelpers): DocPage {
  const { L, Code, EndpointList } = helpers;
  return {
            title: L("认证", "Authentication"),
            lead: L(
              "当前后端接受登录态 cookie、Bearer session token、X-Maple-API-Key 和 X-API-Key；workspace key 使用 maple_ws_ 前缀。",
              "The current backend accepts session cookies, Bearer session tokens, X-Maple-API-Key, and X-API-Key; workspace keys use the maple_ws_ prefix."
            ),
            sections: [
              {
                id: "headers",
                h2: L("请求头", "Headers"),
                body: (
                  <>
                    <p className="doc-p">
                      {L(
                        "SDK 对 workspace key 发 X-Maple-API-Key；curl 和其他客户端也应使用 X-Maple-API-Key 或 X-API-Key。Authorization: Bearer 只用于登录态 token。",
                        "The SDK sends workspace keys as X-Maple-API-Key; curl and other clients should use X-Maple-API-Key or X-API-Key. Authorization: Bearer is for session tokens."
                      )}
                    </p>
                    <Code>{`X-Maple-API-Key: maple_ws_xxx
  X-API-Key: maple_ws_xxx
  Authorization: Bearer maple_sess_xxx
  Cookie: maple_session=maple_sess_xxx`}</Code>
                  </>
                )
              },
              {
                id: "login",
                h2: L("登录态与 API Key", "Session auth and API keys"),
                body: (
                  <>
                    <EndpointList rows={[
                      ["POST /v1/auth/login", L("完成控制台登录后建立 maple_session cookie。", "Creates a maple_session cookie after console sign-in.")],
                      ["GET /v1/auth/me", L("读取当前用户；支持 cookie 或 workspace key。", "Read the current user; supports cookie or workspace key.")],
                      ["POST /v1/workspace_onboarding", L("创建 tenant/workspace/runtime pool，并可返回初始 workspace API key。", "Create tenant/workspace/runtime pool and optionally return the first workspace API key.")],
                      ["POST /v1/workspaces/:workspaceId/api_keys", L("管理员为 workspace 签发 maple_ws_... key。", "Workspace admins issue maple_ws_... keys.")]
                    ]} />
                    <Code>{`curl "$MAPLE_API_BASE_URL/v1/auth/me" \\
    -H "Authorization: Bearer $MAPLE_API_KEY"`}</Code>
                  </>
                )
              },
              {
                id: "scope",
                h2: L("工作区作用域", "Workspace scope"),
                body: (
                  <div className="doc-callout">
                    <Icon name="i-key" size={15} />
                    <span>
                      {L(
                        "列表接口在未显式传 workspace_id 时只返回当前用户可访问 workspace 内的资源；跨工作区访问会返回 workspace_forbidden。",
                        "When workspace_id is omitted, list endpoints only return resources in workspaces accessible to the current user; cross-workspace access returns workspace_forbidden."
                      )}
                    </span>
                  </div>
                )
              }
            ]
  	        };
}
