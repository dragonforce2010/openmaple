import type { OnboardingCustomModelConfig } from "../../appConfig";

export const MAX_RUNTIME_INSTANCES = 100;
export const MAX_RUNTIME_CONCURRENCY = 1000;
export const MAX_SANDBOX_POOL_SIZE = 100;

export type OnboardingRuntimeProvider = "local_docker" | "vefaas" | "aliyun_fc";
export type OnboardingSandboxProvider = "local_docker" | "e2b" | "daytona" | "vefaas" | "aliyun_fc";
export type OnboardingArtifactProvider = "tos" | "oss";

export type WorkspaceOnboardingSubmitInput = {
  tenantName: string;
  tenantDescription: string;
  workspaceName: string;
  workspaceDescription: string;
  workspaceSlug: string;
  desiredSize: number;
  minInstances: number;
  maxInstances: number;
  maxConcurrency: number;
  cpuMilli: number;
  memoryMb: number;
  modelConfigIds: string[];
  customModelConfigs: OnboardingCustomModelConfig[];
  apiKeyName: string;
  runtimeProvider: OnboardingRuntimeProvider;
  standbyRuntimeProvider: OnboardingRuntimeProvider | "";
  artifactProvider: OnboardingArtifactProvider;
  connectedCloudProviders: string[];
  vefaasAccessKey: string;
  vefaasSecretKey: string;
  vefaasRegion: string;
  aliyunAccessKeyId: string;
  aliyunAccessKeySecret: string;
  aliyunRegion: string;
  sandboxProvider: OnboardingSandboxProvider;
  standbySandboxProvider: OnboardingSandboxProvider | "";
  e2bApiKey: string;
  daytonaServerUrl: string;
  daytonaApiKey: string;
  vefaasSandboxFunctionId: string;
  vefaasSandboxGatewayUrl: string;
  vefaasSandboxTimeoutMs: number;
  aliyunFcFunctionName: string;
  aliyunFcInvokeUrl: string;
  aliyunFcApiKey: string;
  sandboxPoolSize: number;
};

export function boundedIntString(value: string, min: number, max: number) {
  if (!value.trim()) return "";
  const next = Number.parseInt(value, 10);
  if (!Number.isFinite(next)) return "";
  return String(Math.min(max, Math.max(min, next)));
}
