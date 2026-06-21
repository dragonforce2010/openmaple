export type JsonRecord = Record<string, unknown>;

export type SuperAgentModel = {
  provider: string;
  id: string;
  speed?: string;
  config_id?: string;
  name?: string;
};

export type SuperAgentLoopType = "anthropic_claude_code" | "codex_open_source";

export type SuperAgentConfig = {
  name: string;
  description: string;
  model: SuperAgentModel;
  system: string;
  tools: JsonRecord[];
  mcp_servers: JsonRecord[];
  skills: JsonRecord[];
  agent_loop: { type: SuperAgentLoopType; config?: JsonRecord; hooks?: JsonRecord[] };
  metadata: JsonRecord;
};

export const QUICKSTART_BUILDER_PURPOSE = "quickstart_builder";
export const MAPLE_AGENT_PURPOSE = "maple_session_assistant";

export const builderRuntime = {
  provider: "vefaas",
  execution: "centralized_function",
  function_name: "maple-super-agent-builder",
  mode: "control_plane_only"
} as const;

export const askMapleRuntime = {
  provider: "vefaas",
  execution: "centralized_function",
  function_name: "maple-super-agent-ask-maple",
  mode: "session_context_qa"
} as const;

export function createBuilderAgentConfig(input: { model: SuperAgentModel; agentLoopType?: SuperAgentLoopType }): SuperAgentConfig {
  return {
    name: "Maple Agent Builder",
    description: "Hidden system agent that helps users create managed agent configurations.",
    model: input.model,
    system: [
      "You are Maple Agent Builder, a hidden control-plane assistant.",
      "Help users create managed agent definitions, runtime environments, and launch-ready sessions.",
      "Never execute user workload. Only propose or perform confirmed control-plane actions in the current workspace."
    ].join("\n"),
    tools: [{ type: "builder_toolset", configs: { draft_agent_config: true, list_environments: true, create_agent: true, create_environment: true } }],
    mcp_servers: [],
    skills: [],
    agent_loop: { type: input.agentLoopType ?? "anthropic_claude_code", config: {}, hooks: [] },
    metadata: {
      purpose: QUICKSTART_BUILDER_PURPOSE,
      system_agent: true,
      hidden: true,
      super_agent: "builder",
      runtime: builderRuntime
    }
  };
}

export function createBuilderEnvironmentConfig() {
  return {
    type: "control_plane",
    sandbox: { provider: "none" },
    networking: { mode: "control_plane_only" },
    metadata: {
      purpose: QUICKSTART_BUILDER_PURPOSE,
      system_environment: true,
      hidden: true,
      runtime: builderRuntime
    }
  };
}

export function createQuickstartEnvironmentConfig(mode: "unrestricted" | "none", sandboxProvider: "local_docker" | "e2b" | "vefaas" = "e2b") {
  // Honor the workspace's configured sandbox provider instead of hardcoding e2b — a vefaas
  // workspace must get a vefaas environment. Provider-specific connection details (function_id,
  // gateway, etc.) are resolved at runtime by sandboxConfig.ts from env/workspace config, the
  // same way ensureDefaultEnvironments does it.
  const sandbox =
    sandboxProvider === "local_docker"
      ? { provider: "local_docker", local_docker: { image: "node:22-bookworm" } }
      : sandboxProvider === "vefaas"
      ? { provider: "vefaas", vefaas: { workspace_path: "/home/tiger/workspace", timeout_ms: 3_600_000 } }
      : { provider: "e2b", e2b: { template: "base", workspace_path: "/workspace", timeout_ms: 3_600_000 } };
  return {
    type: sandboxProvider,
    sandbox,
    workspace_root: ".managed-agents/sessions",
    networking:
      mode === "unrestricted"
        ? { mode: "cloud_unrestricted", allow_internet_access: true, allow_mcp_servers: true, allow_package_managers: true }
        : { mode: "none", allow_internet_access: false, allow_mcp_servers: false, allow_package_managers: false },
    metadata: { source: QUICKSTART_BUILDER_PURPOSE }
  };
}

export function createMapleAgentConfig(input: { model: SuperAgentModel; agentLoopType?: SuperAgentLoopType }): SuperAgentConfig {
  return {
    name: "Maple Session Assistant",
    description: "System agent that answers questions about Maple sessions, tools, events, and runtime state.",
    model: input.model,
    system: [
      "You are Maple Session Assistant.",
      "Explain current session state, event history, runtime/tool calls, artifacts, and next-step diagnostics.",
      "Do not mutate user resources unless a future Maple action explicitly requests it."
    ].join("\n"),
    tools: [{ type: "maple_session_toolset", configs: { inspect_session: true, explain_events: true, summarize_tool_calls: true } }],
    mcp_servers: [],
    skills: [],
    agent_loop: { type: input.agentLoopType ?? "anthropic_claude_code", config: {}, hooks: [] },
    metadata: {
      purpose: MAPLE_AGENT_PURPOSE,
      system_agent: true,
      hidden: true,
      super_agent: "maple",
      priority: "p1",
      runtime: askMapleRuntime
    }
  };
}
