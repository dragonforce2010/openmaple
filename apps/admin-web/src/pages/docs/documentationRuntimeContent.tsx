import { Icon } from "../../ui";
import type { DocContentHelpers, DocPage } from "./DocumentationTypes";

export function environmentsDoc(helpers: DocContentHelpers): DocPage {
  const { L, Code, EndpointList, FieldTable } = helpers;
  return {
            title: "Environments API",
            lead: L(
              "Environments API 管理 session sandbox 配置。agent runtime 由 workspace runtime pool 或后端配置负责。",
              "The Environments API manages session sandbox config. Agent runtime is owned by workspace runtime pools or backend config."
            ),
            sections: [
              {
                id: "endpoints",
                h2: L("接口", "Endpoints"),
                body: (
                  <EndpointList rows={[
                    ["GET /v1/environments?workspace_id=ws_xxx", L("列出环境。", "List environments.")],
                    ["POST /v1/environments", L("创建环境；成功返回 201。", "Create an environment; returns 201.")],
                    ["GET /v1/environments/:environmentId", L("读取环境。", "Retrieve an environment.")],
                    ["PATCH /v1/environments/:environmentId", L("更新 name/config/metadata。", "Update name/config/metadata.")]
                  ]} />
                )
              },
              {
                id: "request",
                h2: L("创建/更新入参", "Create/update request"),
                body: (
                  <>
                    <FieldTable rows={[
                      { field: "workspace_id", type: "string", required: L("否", "No"), description: L("不传时 workspace key 优先使用所属 workspace，其他登录态回退到当前用户第一个 workspace。", "When omitted, workspace keys default to their bound workspace; other auth defaults to the current user's first workspace.") },
                      { field: "name", type: "string", required: L("创建必填", "Required on create"), description: L("Environment 名称。", "Environment name.") },
                      { field: "description", type: "string", required: L("否", "No"), description: L("当前 schema 接受，持久化到 config.metadata 之外的独立描述尚未展开使用。", "Accepted by schema; independent persisted description is not expanded in the current response model.") },
                      { field: "config", type: "object", required: L("否", "No"), description: L("默认 {}。可放 sandbox、image、networking、packages 等配置。", "Defaults to {}. Holds sandbox, image, networking, packages, and related config.") },
                      { field: "metadata", type: "object", required: L("否", "No"), description: L("默认 {}，写入 config.metadata。", "Defaults to {}; stored as config.metadata.") }
                    ]} />
                    <div className="doc-callout">
                      <Icon name="i-alert" size={15} />
                      <span>
                        {L(
                          "如果请求里包含 config.agent_runtime、agentRuntime、agent_runtime_provider、agentRuntimeProvider，或 config.type=managed_agent，后端返回 400 environment_agent_runtime_forbidden。",
                          "If the request includes config.agent_runtime, agentRuntime, agent_runtime_provider, agentRuntimeProvider, or config.type=managed_agent, the backend returns 400 environment_agent_runtime_forbidden."
                        )}
                      </span>
                    </div>
                    <Code>{`{
    "workspace_id": "ws_xxx",
    "name": "e2b-sandbox",
    "config": {
      "type": "e2b",
      "sandbox": {
        "provider": "e2b",
        "e2b": { "template": "base", "workspace_path": "/workspace" }
      },
      "networking": { "mode": "limited", "allowed_hosts": ["api.partner.com"] },
      "packages": [{ "manager": "pip", "packages": ["pytest==8.0.0"] }]
    },
    "metadata": { "source": "docs" }
  }`}</Code>
                  </>
                )
              },
              {
                id: "response",
                h2: L("出参", "Response"),
                body: (
                  <Code>{`{
    "id": "env_xxx",
    "name": "e2b-sandbox",
    "workspace_id": "ws_xxx",
    "config": {
      "type": "e2b",
      "sandbox": { "provider": "e2b", "e2b": { "template": "base", "workspace_path": "/workspace" } },
      "metadata": { "source": "docs" }
    },
    "created_at": "2026-06-09T00:00:00.000Z"
  }`}</Code>
                )
              }
            ]
          };
}

export function sessionsDoc(helpers: DocContentHelpers): DocPage {
  const { L, Code, EndpointList, FieldTable } = helpers;
  return {
            title: "Sessions API",
            lead: L(
              "Sessions API 创建一次 agent run，保存 workspace_path、事件、tool calls、vault/resource 引用，并提供 SSE。",
              "The Sessions API creates an agent run, stores workspace_path, events, tool calls, vault/resource refs, and exposes SSE."
            ),
            sections: [
              {
                id: "endpoints",
                h2: L("接口", "Endpoints"),
                body: (
                  <EndpointList rows={[
                    ["GET /v1/sessions", L("列出当前用户拥有或可访问 workspace 内的 sessions。", "List sessions owned by the current user or in accessible workspaces.")],
                    ["POST /v1/sessions", L("创建 session；成功返回 201，并触发 bootstrap。", "Create a session; returns 201 and triggers bootstrap.")],
                    ["GET /v1/sessions/:sessionId", L("读取 session 概要。", "Read session summary.")],
                    ["GET /v1/sessions/:sessionId/detail", L("读取 session、agent、environment、vaults、events、tool_calls。", "Read session, agent, environment, vaults, events, and tool_calls.")],
                    ["POST /v1/sessions/:sessionId/events", L("写入客户端可写事件；成功返回 202。", "Append client-writable events; returns 202.")],
                    ["GET /v1/sessions/:sessionId/events", L("列出事件。", "List events.")],
                    ["GET /v1/sessions/:sessionId/events/stream", L("SSE 事件流。", "SSE event stream.")],
                    ["DELETE /v1/sessions/:sessionId", L("标记 session 为 terminated，并关闭外部 agent loop。", "Mark the session terminated and shut down the external agent loop.")],
                    ["GET /v1/sessions/:sessionId/artifacts", L("列出 session artifacts。", "List session artifacts.")]
                  ]} />
                )
              },
              {
                id: "create",
                h2: L("创建入参", "Create request"),
                body: (
                  <>
                    <FieldTable rows={[
                      { field: "workspace_id", type: "string", required: L("否", "No"), description: L("不传时 workspace key 优先使用所属 workspace，其他登录态回退到当前用户第一个 workspace。", "When omitted, workspace keys default to their bound workspace; other auth defaults to the current user's first workspace.") },
                      { field: "agent", type: "string | object", required: L("是", "Yes"), description: L("Agent id 字符串，或包含 id 的对象。", "Agent id string, or an object containing id.") },
                      { field: "environment_id", type: "string", required: L("是", "Yes"), description: L("Environment id。", "Environment id.") },
                      { field: "title", type: "string", required: L("否", "No"), description: L("Session 标题。", "Session title.") },
                      { field: "vault_ids", type: "string[]", required: L("否", "No"), description: L("默认 []，写入 session.metadata.vault_ids。", "Defaults to []; stored in session.metadata.vault_ids.") },
                      { field: "resources", type: "object[]", required: L("否", "No"), description: L("默认 []，写入 session.metadata.resources。", "Defaults to []; stored in session.metadata.resources.") },
                      { field: "metadata", type: "object", required: L("否", "No"), description: L("默认 {}，后端会补 owner_user_id。", "Defaults to {}; backend adds owner_user_id.") }
                    ]} />
                    <Code>{`{
    "workspace_id": "ws_xxx",
    "agent": "agent_xxx",
    "environment_id": "env_xxx",
    "title": "integration smoke",
    "vault_ids": ["vault_xxx"],
    "resources": [{ "type": "file", "file_id": "file_xxx", "mount_path": "app.log" }],
    "metadata": { "source": "docs" }
  }`}</Code>
                  </>
                )
              },
              {
                id: "events",
                h2: L("事件写入与流式读取", "Event write and stream"),
                body: (
                  <>
                    <p className="doc-p">
                      {L(
                        "客户端只能写 user.message、user.custom_tool_result、tool_result、user.tool_result、user.define_outcome；其他类型返回 event_type_not_client_writable。",
                        "Clients may write only user.message, user.custom_tool_result, tool_result, user.tool_result, and user.define_outcome; other types return event_type_not_client_writable."
                      )}
                    </p>
                    <Code>{`curl "$MAPLE_API_BASE_URL/v1/sessions/$SESSION_ID/events" \\
    -H "Authorization: Bearer $MAPLE_API_KEY" \\
    -H "Content-Type: application/json" \\
    -d '{
      "events": [{
        "type": "user.message",
        "content": [{ "type": "text", "text": "Continue" }],
        "payload": { "source": "docs" }
      }]
    }'

  curl -N "$MAPLE_API_BASE_URL/v1/sessions/$SESSION_ID/events/stream" \\
    -H "Authorization: Bearer $MAPLE_API_KEY"`}</Code>
                    <Code>{`event: ready
  data: {"session_id":"sess_xxx"}

  event: user.message
  data: {"id":"evt_xxx","session_id":"sess_xxx","type":"user.message","content":[{"type":"text","text":"Continue"}],"payload":{"content":[{"type":"text","text":"Continue"}]},"created_at":"2026-06-09T00:00:00.000Z"}`}</Code>
                  </>
                )
              },
              {
                id: "response",
                h2: L("出参", "Response"),
                body: (
                  <Code>{`{
    "type": "session",
    "id": "sess_xxx",
    "title": "integration smoke",
    "agent_id": "agent_xxx",
    "agent_version": 1,
    "environment_id": "env_xxx",
    "workspace_id": "ws_xxx",
    "status": "bootstrapping",
    "workspace_path": "/.../.managed-agents/sessions/sess_xxx",
    "metadata": {
      "owner_user_id": "user_xxx",
      "vault_ids": ["vault_xxx"],
      "resources": []
    },
    "agent": { "type": "agent", "id": "agent_xxx", "version": 1 },
    "created_at": "2026-06-09T00:00:00.000Z",
    "updated_at": "2026-06-09T00:00:00.000Z"
  }`}</Code>
                )
              }
            ]
          };
}
