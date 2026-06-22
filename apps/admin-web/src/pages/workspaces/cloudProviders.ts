export type CloudProviderId = "volcengine" | "aliyun" | "alibaba_cloud" | "tencent_cloud" | "aws";
export type ProviderCapability = "runtime" | "sandbox" | "artifact";

export type CloudProviderMeta = {
  id: CloudProviderId;
  name: string;
  enabled: boolean;
  credentialKey: string;
  capabilities: ProviderCapability[];
  runtimeProviders: Array<{ id: "vefaas" | "aliyun_fc"; label: string; descriptionZh: string; descriptionEn: string }>;
  sandboxProviders: Array<{ id: "vefaas" | "aliyun_fc"; label: string; descriptionZh: string; descriptionEn: string }>;
  artifactProviders: Array<{ id: "tos" | "oss"; label: string; descriptionZh: string; descriptionEn: string }>;
};

export const CLOUD_PROVIDERS: CloudProviderMeta[] = [
  {
    id: "volcengine",
    name: "火山引擎",
    enabled: true,
    credentialKey: "vefaas",
    capabilities: ["runtime", "sandbox", "artifact"],
    runtimeProviders: [{ id: "vefaas", label: "VeFaaS", descriptionZh: "火山引擎 Agent Runtime", descriptionEn: "Volcengine agent runtime" }],
    sandboxProviders: [{ id: "vefaas", label: "VeFaaS Sandbox", descriptionZh: "火山引擎云沙箱", descriptionEn: "Volcengine cloud sandbox" }],
    artifactProviders: [{ id: "tos", label: "TOS Artifact", descriptionZh: "火山引擎对象存储制品", descriptionEn: "Volcengine object-storage artifacts" }]
  },
  {
    id: "aliyun",
    name: "阿里云",
    enabled: true,
    credentialKey: "aliyun",
    capabilities: ["runtime", "sandbox", "artifact"],
    runtimeProviders: [{ id: "aliyun_fc", label: "FC", descriptionZh: "阿里云函数计算 Agent Runtime", descriptionEn: "Aliyun Function Compute agent runtime" }],
    sandboxProviders: [{ id: "aliyun_fc", label: "FC Sandbox", descriptionZh: "阿里云函数计算沙箱", descriptionEn: "Aliyun Function Compute sandbox" }],
    artifactProviders: [{ id: "oss", label: "OSS Artifact", descriptionZh: "阿里云对象存储制品", descriptionEn: "Aliyun object-storage artifacts" }]
  },
  { id: "tencent_cloud", name: "腾讯云", enabled: false, credentialKey: "tencent_cloud", capabilities: [], runtimeProviders: [], sandboxProviders: [], artifactProviders: [] },
  { id: "aws", name: "AWS", enabled: false, credentialKey: "aws", capabilities: [], runtimeProviders: [], sandboxProviders: [], artifactProviders: [] }
];

export const INDEPENDENT_SANDBOX_PROVIDERS = [
  { id: "e2b" as const, label: "E2B", descriptionZh: "独立云沙箱", descriptionEn: "Independent cloud sandbox" },
  { id: "daytona" as const, label: "Daytona", descriptionZh: "独立开发环境沙箱", descriptionEn: "Independent development-environment sandbox" }
];
