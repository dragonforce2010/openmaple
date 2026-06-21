export type RuntimeProviderName = "local_docker" | "vefaas" | "vercel";

export type RuntimeContext = {
  session_id: string;
  workspace_id?: string | null;
  workspace_path: string;
  sandbox_runtime?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type RuntimeHandle = {
  provider: RuntimeProviderName;
  runtime_id: string;
  invoke_url?: string;
  metadata?: Record<string, unknown>;
};

export interface RuntimeProvider {
  readonly name: RuntimeProviderName;
  ensure(context: RuntimeContext): Promise<RuntimeHandle>;
  terminate?(handle: RuntimeHandle): Promise<void>;
}
