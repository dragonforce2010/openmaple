export type SandboxProviderName = "e2b" | "vercel" | "vefaas";

export type SandboxContext = {
  session_id: string;
  workspace_path: string;
  metadata?: Record<string, unknown>;
};

export type SandboxHandle = {
  provider: SandboxProviderName;
  sandbox_id: string;
  workspace_path: string;
  metadata?: Record<string, unknown>;
};

export interface SandboxProvider {
  readonly name: SandboxProviderName;
  ensure(context: SandboxContext): Promise<SandboxHandle>;
  terminate?(handle: SandboxHandle): Promise<void>;
}
