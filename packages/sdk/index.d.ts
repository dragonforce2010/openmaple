export type AgentLoopType = "anthropic_claude_code" | "codex_open_source";

export type JsonRecord = Record<string, unknown>;

export type MapleList<T extends JsonRecord = JsonRecord> = JsonRecord & {
  data: T[];
};

export type MapleSession = JsonRecord & {
  id: string;
  title?: string;
  status?: string;
  workspace_id?: string;
  agent_id?: string;
  environment_id?: string;
};

export type MapleSessionEvent = JsonRecord & {
  id: string;
  type: string;
  payload: JsonRecord;
  session_id?: string;
  created_at?: string;
};

export type MapleSessionClientEvent = JsonRecord & {
  type: string;
  content?: unknown;
  payload?: JsonRecord;
};

export type MapleStreamReady = {
  session_id: string;
};

export type MapleEventStream = {
  on(event: "ready", listener: (event: MapleStreamReady) => void): MapleEventStream;
  on(event: "event", listener: (event: MapleSessionEvent | JsonRecord) => void): MapleEventStream;
  on(event: "error", listener: (error: Error) => void): MapleEventStream;
  on(event: "close", listener: () => void): MapleEventStream;
  once(event: "ready", listener: (event: MapleStreamReady) => void): MapleEventStream;
  once(event: "event", listener: (event: MapleSessionEvent | JsonRecord) => void): MapleEventStream;
  once(event: "error", listener: (error: Error) => void): MapleEventStream;
  once(event: "close", listener: () => void): MapleEventStream;
  off(event: "ready", listener: (event: MapleStreamReady) => void): MapleEventStream;
  off(event: "event", listener: (event: MapleSessionEvent | JsonRecord) => void): MapleEventStream;
  off(event: "error", listener: (error: Error) => void): MapleEventStream;
  off(event: "close", listener: () => void): MapleEventStream;
  close(): void;
};

export type MapleSessionStreamOptions = {
  onReady?: (event: MapleStreamReady) => void;
  onEvent?: (event: MapleSessionEvent | JsonRecord) => void;
  onError?: (error: Error) => void;
  stopOn?: string[];
  readyTimeoutMs?: number;
  signal?: AbortSignal;
};

export type MapleSessionStreamInput = JsonRecord & {
  message?: string | JsonRecord[];
  events?: MapleSessionClientEvent[];
};

export type MapleSessionStreamRun = {
  session: MapleSession;
  stream: MapleEventStream;
  posted: MapleList<MapleSessionEvent>;
  done: Promise<MapleSessionEvent | JsonRecord | null>;
};

export type MapleClientOptions = {
  baseUrl?: string;
  baseURL?: string;
  token?: string;
  apiKey?: string;
  workspaceId?: string;
  workspace_id?: string;
};

export declare function defineHarness<T extends JsonRecord>(harness: T): T;

export declare class MapleClient {
  constructor(options?: MapleClientOptions);
  baseUrl: string;
  token: string;
  workspaceId: string;
  withToken(token: string): MapleClient;
  health(): Promise<JsonRecord>;
  version(): Promise<JsonRecord>;
  loginLocal(input: { email: string; name?: string }): Promise<JsonRecord & { token: string }>;
  me(): Promise<JsonRecord>;
  listWorkspaces(): Promise<MapleList>;
  getWorkspaceRuntimePool(workspaceId: string): Promise<JsonRecord>;
  workspaceOnboardingStatus(): Promise<JsonRecord>;
  onboardWorkspace(input: JsonRecord): Promise<JsonRecord>;
  createWorkspace(input: JsonRecord): Promise<JsonRecord>;
  listTenantMembers(tenantId: string): Promise<MapleList>;
  addTenantMember(tenantId: string, input: { email: string }): Promise<JsonRecord>;
  removeTenantMember(tenantId: string, userId: string): Promise<JsonRecord>;
  addTenantAdmin(tenantId: string, input: { email: string }): Promise<JsonRecord>;
  removeTenantAdmin(tenantId: string, userId: string): Promise<JsonRecord>;
  listTenantApiKeys(tenantId: string): Promise<MapleList>;
  createTenantApiKey(tenantId: string, input: { display_name: string; scopes?: string[] }): Promise<JsonRecord>;
  updateTenantApiKey(tenantId: string, keyId: string, input: { display_name?: string; enabled?: boolean; scopes?: string[] }): Promise<JsonRecord>;
  deleteTenantApiKey(tenantId: string, keyId: string): Promise<JsonRecord>;
  listWorkspaceMembers(workspaceId: string): Promise<MapleList>;
  addWorkspaceMember(workspaceId: string, input: { email: string }): Promise<JsonRecord>;
  addWorkspaceAdmin(workspaceId: string, input: { email: string }): Promise<JsonRecord>;
  listWorkspaceApiKeys(workspaceId: string): Promise<MapleList>;
  createWorkspaceApiKey(workspaceId: string, input: { display_name: string; scopes?: string[] }): Promise<JsonRecord>;
  listModelConfigs(): Promise<MapleList>;
  listAgents(params?: { workspaceId?: string }): Promise<MapleList>;
  createAgent(input: JsonRecord): Promise<JsonRecord>;
  getAgent(id: string): Promise<JsonRecord>;
  createEnvironment(input: JsonRecord): Promise<JsonRecord>;
  listDeployments(params?: { workspaceId?: string; workspace_id?: string }): Promise<MapleList>;
  createDeployment(input: JsonRecord): Promise<JsonRecord>;
  getDeployment(id: string): Promise<JsonRecord>;
  invokeDeployment(id: string, input: { message: string; title?: string }): Promise<JsonRecord>;
  runDeployment(id: string, input?: JsonRecord): Promise<JsonRecord>;
  listDeploymentRuns(id: string, params?: { limit?: number }): Promise<MapleList>;
  pauseDeployment(id: string, input?: JsonRecord): Promise<JsonRecord>;
  unpauseDeployment(id: string): Promise<JsonRecord>;
  archiveDeployment(id: string): Promise<JsonRecord>;
  createSession(input: JsonRecord): Promise<MapleSession>;
  sessionDetail(id: string): Promise<JsonRecord>;
  listSessionEvents(id: string): Promise<MapleList<MapleSessionEvent>>;
  askMaple(sessionId: string, question: string): Promise<JsonRecord>;
  postSessionEvents(id: string, events: MapleSessionClientEvent[]): Promise<MapleList<MapleSessionEvent>>;
  postSessionMessage(id: string, message: string): Promise<JsonRecord>;
  createSessionAndStream(input: MapleSessionStreamInput, options?: MapleSessionStreamOptions): Promise<MapleSessionStreamRun>;
  sendSessionMessage(id: string, message: string): Promise<JsonRecord>;
  streamSessionEvents(id: string, options?: MapleSessionStreamOptions): MapleEventStream;
  listSkills(): Promise<MapleList>;
  createSkill(input: { name: string; description: string }): Promise<JsonRecord>;
  updateSkill(id: string, input: { name?: string; description?: string }): Promise<JsonRecord>;
  getSkillFiles(id: string): Promise<JsonRecord>;
  getSkillFile(id: string, path: string): Promise<JsonRecord>;
  saveSkillFile(id: string, path: string, content: string): Promise<JsonRecord>;
}
