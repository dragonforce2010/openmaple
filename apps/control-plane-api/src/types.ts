export type JsonRecord = Record<string, unknown>;

export type AgentLoopType = "anthropic_claude_code" | "codex_open_source";

export type AgentLoopConfig = {
  type: AgentLoopType;
  config?: JsonRecord;
  hooks?: JsonRecord[];
};

export type AgentConfig = {
  name: string;
  description: string;
  model: {
    provider: string;
    id: string;
    speed?: string;
    config_id?: string;
    name?: string;
  };
  system: string;
  tools: JsonRecord[];
  mcp_servers: JsonRecord[];
  skills: JsonRecord[];
  agent_loop: AgentLoopConfig;
  multiagent?: JsonRecord;
  metadata?: JsonRecord;
};

export type SessionStatus =
  | "created"
  | "bootstrapping"
  | "installing_packages"
  | "idle"
  | "running"
  | "tool_waiting"
  | "rescheduling"
  | "failed"
  | "terminated"
  | "archived";

export type SessionEvent = {
  id: string;
  session_id: string;
  thread_id: string | null;
  type: string;
  payload: JsonRecord;
  provider_event_type?: string | null;
  created_at: string;
};
