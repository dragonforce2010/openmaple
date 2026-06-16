import type { JsonRecord } from "../types";

export type AgentRuntimeProvider = "local" | "vefaas" | "aws_lambda";
export type SandboxProvider = "e2b" | "local_docker" | "vercel" | "vefaas";
export type EffectiveRuntimeProvider = AgentRuntimeProvider | SandboxProvider;

export type EnvironmentPackage = { manager: string; name: string };

export type SandboxDefaults = {
  default_provider: SandboxProvider;
  default_agent_runtime_provider: AgentRuntimeProvider;
  e2b: {
    api_key: string;
    template: string;
    workspace_path: string;
    timeout_ms: number;
    envs: Record<string, string>;
  };
  local_docker: {
    image: string;
    networking: JsonRecord;
    sandbox_options: string[];
  };
  vercel: {
    api_key: string;
    project_id: string;
    region: string;
    runtime: string;
    timeout_ms: number;
    envs: Record<string, string>;
  };
  vefaas_sandbox: {
    access_key: string;
    secret_key: string;
    region: string;
    function_id: string;
    endpoint: string;
    gateway_url: string;
    api_token: string;
    workspace_path: string;
    timeout_ms: number;
    envs: Record<string, string>;
    metadata: Record<string, string>;
  };
  vefaas: {
    invoke_url: string;
    api_key: string;
    function_id: string;
    region: string;
    workspace_path: string;
    timeout_ms: number;
    envs: Record<string, string>;
  };
  aws_lambda: {
    function_name: string;
    region: string;
    qualifier: string;
    timeout_ms: number;
    envs: Record<string, string>;
  };
};

export type NormalizedAgentRuntimeConfig =
  | { provider: "local" }
  | {
      provider: "vefaas";
      invoke_url: string;
      api_key: string;
      function_id: string;
      region: string;
      workspace_path: string;
      timeout_ms: number;
      envs: Record<string, string>;
    }
  | {
      provider: "aws_lambda";
      function_name: string;
      region: string;
      qualifier: string;
      timeout_ms: number;
      envs: Record<string, string>;
    };

export type NormalizedSandboxRuntimeConfig =
  | {
      provider: "e2b";
      api_key: string;
      template: string;
      workspace_path: string;
      timeout_ms: number;
      envs: Record<string, string>;
    }
  | {
      provider: "local_docker";
      image: string;
      networking: JsonRecord;
      sandbox_options: string[];
    }
  | {
      provider: "vercel";
      api_key: string;
      project_id: string;
      region: string;
      runtime: string;
      timeout_ms: number;
      envs: Record<string, string>;
    }
  | {
      provider: "vefaas";
      access_key: string;
      secret_key: string;
      region: string;
      function_id: string;
      endpoint: string;
      gateway_url: string;
      api_token: string;
      workspace_path: string;
      timeout_ms: number;
      envs: Record<string, string>;
      metadata: Record<string, string>;
      packages: EnvironmentPackage[];
    };

export type NormalizedSandboxConfig = {
  provider: EffectiveRuntimeProvider;
  agent_runtime: NormalizedAgentRuntimeConfig;
  sandbox: NormalizedSandboxRuntimeConfig;
};

export const builtInDefaults: SandboxDefaults = {
  default_provider: "e2b",
  default_agent_runtime_provider: "local",
  e2b: {
    api_key: "",
    template: "base",
    workspace_path: "/workspace",
    timeout_ms: 60 * 60 * 1000,
    envs: {}
  },
  local_docker: {
    image: "node:22-bookworm",
    networking: {
      mode: "limited",
      allowed_hosts: ["api.maple.local"],
      allow_mcp_servers: true,
      allow_package_managers: true
    },
    sandbox_options: ["docker", "colima", "local_process_fallback"]
  },
  vercel: {
    api_key: "",
    project_id: "",
    region: "iad1",
    runtime: "nodejs22.x",
    timeout_ms: 120_000,
    envs: {}
  },
  vefaas_sandbox: {
    access_key: "",
    secret_key: "",
    region: "cn-beijing",
    function_id: "",
    endpoint: "https://open.volcengineapi.com",
    gateway_url: "",
    api_token: "",
    workspace_path: "/home/tiger/workspace",
    timeout_ms: 60 * 60 * 1000,
    envs: {},
    metadata: {}
  },
  vefaas: {
    invoke_url: "",
    api_key: "",
    function_id: "",
    region: "cn-beijing",
    workspace_path: "/workspace",
    timeout_ms: 120_000,
    envs: {}
  },
  aws_lambda: {
    function_name: "",
    region: "us-east-1",
    qualifier: "",
    timeout_ms: 120_000,
    envs: {}
  }
};
