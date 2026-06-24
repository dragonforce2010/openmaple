export type JsonRecord = Record<string, unknown>;

export type Agent = {
  id: string;
  name: string;
  description: string;
  current_version: number;
  workspace_id?: string | null;
  config: AgentConfig;
  created_at: string;
  updated_at: string;
};

export type AgentModel = { provider: string; id: string; speed?: string; config_id?: string; name?: string };

export type AgentLoopType = "anthropic_claude_code" | "codex_open_source";

export type AgentLoopConfig = {
  type: AgentLoopType;
  config?: JsonRecord;
  hooks?: JsonRecord[];
};

export type AgentConfig = {
  name: string;
  description: string;
  model: AgentModel;
  system: string;
  tools: JsonRecord[];
  mcp_servers: JsonRecord[];
  skills: JsonRecord[];
  agent_loop: AgentLoopConfig;
  multiagent?: JsonRecord;
  metadata?: JsonRecord;
};

export type Environment = {
  id: string;
  name: string;
  workspace_id?: string | null;
  config: JsonRecord;
  created_at: string;
};

export type Session = {
  id: string;
  title: string;
  agent_id: string;
  agent_version: number;
  environment_id: string;
  workspace_id?: string | null;
  status: string;
  workspace_path: string;
  metadata: JsonRecord;
  created_at: string;
  updated_at: string;
};

export type Workspace = {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  status: string;
  runtime_provider: string;
  sandbox_provider: string;
  config: JsonRecord;
  created_at: string;
  updated_at: string;
};

export type WorkspaceMember = {
  id: string;
  workspace_id: string;
  user_id: string;
  email: string;
  name: string;
  role: "owner" | "admin" | "member";
  auth_provider: string;
  user_role: string;
  created_at: string;
};

export type WorkspaceApiKey = {
  id: string;
  workspace_id: string;
  display_name: string;
  key_prefix: string;
  scopes: string[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
  last_used_at?: string | null; key?: string;
};

export type TenantApiKey = {
  id: string;
  tenant_id: string;
  display_name: string;
  key_prefix: string;
  scopes: string[];
  enabled: boolean;
  created_by_user_id?: string | null;
  created_at: string;
  updated_at: string;
  last_used_at?: string | null;
  key?: string;
};

export type WorkspaceSlugStatus = {
  available: boolean;
  slug: string;
  reason: "ok" | "taken" | "invalid" | "reserved";
  console_url?: string;
};

export type RuntimePoolMember = {
  id: string;
  runtime_pool_id: string;
  workspace_id: string;
  provider: string;
  cloud_function_id: string;
  cloud_app_id: string;
  invoke_url: string;
  region: string;
  status: string;
  weight: number;
  active_session_count: number;
  config: JsonRecord;
};

export type PoolMemberStatusCounts = Record<string, number>;

export type PoolPageMeta = {
  member_total?: number;
  member_status_counts?: PoolMemberStatusCounts;
  page?: number;
  page_size?: number;
};

export type RuntimePool = PoolPageMeta & {
  id: string;
  workspace_id: string;
  provider: string;
  desired_size: number;
  min_instances_per_function: number;
  max_instances_per_function: number;
  max_concurrency_per_instance: number;
  cpu_milli: number;
  memory_mb: number;
  status: string;
  config: JsonRecord;
  members: RuntimePoolMember[];
};

export type SandboxPoolMember = {
  id: string;
  workspace_id: string;
  provider: string;
  sandbox_id: string;
  status: string;
  claimed_session_id?: string | null;
  claimed_agent_id?: string | null;
  expires_at?: string | null;
  last_checked_at?: string | null;
  error?: string | null;
  config: JsonRecord;
  created_at: string;
  updated_at: string;
};

export type SandboxPool = PoolPageMeta & {
  workspace_id: string;
  provider: string;
  desired_size: number;
  standby_ttl_ms: number;
  members: SandboxPoolMember[];
};

export type WorkspaceOnboardingStatus = {
  required: boolean;
  workspaces: Workspace[];
};

export type AgentRuntimeInfo = {
  agent_id: string;
  workspace: Workspace | null;
  runtime_pool: RuntimePool | null;
  recent_sessions: Array<{
    id: string;
    status: string;
    runtime_pool_id?: string | null;
    runtime_pool_member_id?: string | null;
    agent_runtime?: JsonRecord | null;
    sandbox_runtime?: JsonRecord | null;
    created_at: string;
    updated_at: string;
  }>;
};

export type SessionEvent = {
  id: string;
  session_id: string;
  thread_id: string | null;
  type: string;
  payload: JsonRecord;
  provider_event_type?: string | null;
  created_at: string;
};

export type Vault = {
  id: string;
  display_name: string;
  workspace_id?: string | null;
  metadata: JsonRecord;
  credential_count?: number;
  credentials?: VaultCredential[];
  created_at?: string;
  updated_at?: string;
};

export type VaultCredential = {
  id: string;
  vault_id: string;
  name: string;
  mcp_server_url?: string | null;
  auth_type: string;
  metadata: JsonRecord;
  status: string;
  created_at: string;
  updated_at: string;
};

export type { MemoryRecord, MemoryStore } from "./memoryTypes";

export type Skill = {
  id: string;
  name: string;
  source_path: string;
  current_version: number;
  metadata: JsonRecord;
};

export type SkillTreeEntry = {
  path: string;
  name: string;
  type: "file" | "directory" | "symlink";
  size?: number;
  children?: SkillTreeEntry[];
};

export type SkillFileContent = {
  path: string;
  content: string;
  size: number;
  editable: boolean;
};

export type Template = {
  id: string;
  name: string;
  description: string;
  category: string;
  template: JsonRecord;
};

export type User = {
  id: string;
  email: string;
  name: string;
  auth_provider: string;
  role: string;
  tenant_role?: string | null;
  effective_role?: "admin" | "member" | string;
  workspace_ids?: string[];
  workspace_names?: string[];
  workspace_roles?: string[];
  workspace_count?: number;
  metadata: JsonRecord;
  created_at: string;
  updated_at: string;
};

export type AuthProvider = {
  id: "local" | "oauth" | "oidc" | "lark_sso" | "bytesso";
  name: string;
  configured: boolean;
};

export type ModelConfig = {
  id: string;
  owner_user_id: string;
  workspace_id?: string | null;
  tenant_id?: string | null;
  name: string;
  provider_type: string;
  base_url: string;
  model_name: string;
  preset_key?: string | null;
  is_default: boolean;
  has_api_key: boolean;
  api_key_hint?: string | null;
  created_at: string;
  updated_at: string;
};

export type ModelConnectivityResult = {
  ok: boolean;
  status: number;
  latency_ms: number;
  model: string;
  base_url: string;
  source: string;
  message: string;
};

export type Artifact = {
  session_id: string;
  session_title: string;
  path: string;
  size: number;
  updated_at: string;
};

export type AgentDeployment = {
  id: string;
  user_id: string;
  workspace_id: string;
  tenant_id?: string;
  agent_id: string;
  agent_version?: number | null;
  environment_id: string;
  name: string;
  version: string;
  manifest: JsonRecord;
  bundle: JsonRecord;
  initial_events: JsonRecord[];
  schedule: JsonRecord | null;
  vault_ids: string[];
  memory_store_ids: string[];
  resources: JsonRecord[];
  metadata: JsonRecord;
  status: string;
  next_run_at?: string | null;
  last_run_at?: string | null;
  paused_at?: string | null;
  paused_reason?: string | null;
  archived_at?: string | null;
  upcoming_runs_at?: string[];
  created_at: string;
  updated_at: string;
};

export type DeploymentRun = {
  id: string;
  deployment_id: string;
  workspace_id: string;
  tenant_id?: string;
  session_id: string | null;
  triggered_by: string;
  triggered_by_user_id?: string | null;
  status: string;
  error?: JsonRecord | null;
  initial_events: JsonRecord[];
  trigger_context: JsonRecord;
  started_at: string;
  finished_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type ToolCall = {
  id: string;
  session_id: string;
  thread_id: string | null;
  event_id: string | null;
  tool_name: string;
  input: JsonRecord;
  output: unknown;
  status: string;
  permission_policy: string;
  created_at: string;
  completed_at?: string | null;
};

export type SessionDetail = {
  session: Session;
  agent: Agent | null;
  environment: Environment | null;
  vaults: Vault[];
  events: SessionEvent[];
  events_mode?: "full" | "append";
  tool_calls: ToolCall[];
};
