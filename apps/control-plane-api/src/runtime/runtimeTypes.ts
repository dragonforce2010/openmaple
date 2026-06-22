import type { JsonRecord } from "../types";

export type DockerRuntimeInfo = {
  type: "docker";
  container_id: string;
  container_name: string;
  image: string;
  workspace_path: string;
};

export type E2BRuntimeInfo = {
  type: "e2b";
  sandbox_id: string;
  template: string;
  workspace_path: string;
  sandbox_workspace_path: string;
  timeout_ms: number;
  lifecycle?: JsonRecord;
};

export type VefaasRuntimeInfo = {
  type: "vefaas";
  invoke_url: string;
  function_id: string;
  cloud_function_id?: string;
  region: string;
  workspace_path: string;
  sandbox_workspace_path: string;
  timeout_ms: number;
  envs: Record<string, string>;
  api_key?: string;
};

export type AliyunFcRuntimeInfo = {
  type: "aliyun_fc";
  provider: "aliyun_fc";
  invoke_url: string;
  function_name: string;
  region: string;
  workspace_path: string;
  sandbox_workspace_path: string;
  timeout_ms: number;
  envs: Record<string, string>;
  api_key?: string;
  runtime_pool_id?: string;
  runtime_pool_member_id?: string;
};

export type VefaasSandboxRuntimeInfo = {
  type: "vefaas_sandbox";
  provider: "vefaas";
  sandbox_id: string;
  function_id: string;
  region: string;
  endpoint: string;
  gateway_url: string;
  api_token?: string;
  workspace_path: string;
  sandbox_workspace_path: string;
  timeout_ms: number;
  envs: Record<string, string>;
  metadata: Record<string, string>;
  pool_member_id?: string;
  pooled?: boolean;
  expires_at?: string;
  last_ready_at?: string;
  lifecycle?: JsonRecord;
};

export type AliyunFcSandboxRuntimeInfo = {
  type: "aliyun_fc_sandbox";
  provider: "aliyun_fc";
  sandbox_id: string;
  function_name: string;
  region: string;
  invoke_url: string;
  api_key?: string;
  workspace_path: string;
  sandbox_workspace_path: string;
  timeout_ms: number;
  envs: Record<string, string>;
  metadata: Record<string, string>;
  pool_member_id?: string;
  pooled?: boolean;
  expires_at?: string;
  lifecycle?: JsonRecord;
};

export type RuntimeInfo = DockerRuntimeInfo | E2BRuntimeInfo | VefaasRuntimeInfo | AliyunFcRuntimeInfo | VefaasSandboxRuntimeInfo | AliyunFcSandboxRuntimeInfo;

export type E2BSandbox = {
  sandboxId: string;
  commands: {
    run: (command: string, options?: JsonRecord) => Promise<JsonRecord>;
  };
  files: {
    read: (...args: unknown[]) => Promise<unknown>;
    write: (...args: unknown[]) => Promise<unknown>;
  };
  pause?: (options?: JsonRecord) => Promise<boolean>;
  setTimeout?: (timeoutMs: number, options?: JsonRecord) => Promise<void>;
};

export type E2BSandboxConstructor = {
  create: (options?: JsonRecord) => Promise<E2BSandbox>;
  connect: (sandboxId: string, options?: JsonRecord) => Promise<E2BSandbox>;
};
