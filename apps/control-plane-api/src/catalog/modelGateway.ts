import { decryptSecret, encryptSecret, readSecret } from "../secrets";
import {
  GLOBAL_SCOPE_ID,
  createModelConfig,
  ensureGlobalDefaultModel,
  getDefaultModelConfig,
  getDefaultModelConfigInternal,
  getModelConfig,
  getModelConfigInternal,
  listGlobalModelConfigs,
  listModelConfigs,
  updateModelConfigSecret
} from "../store";
import type { JsonRecord } from "../types";

export type ModelTarget = {
  baseUrl: string;
  model: string;
  apiKey: string;
  source: "user_config" | "environment";
};

export type ModelSelection = {
  configId?: string;
  name?: string;
  provider: string;
  model: string;
};

export type ModelConnectivityResult = {
  ok: boolean;
  status: number;
  latency_ms: number;
  model: string;
  base_url: string;
  source: ModelTarget["source"] | "unsaved_config";
  message: string;
};

export const defaultVolcoEngineModels = [
  {
    name: "VolcoEngine",
    providerType: "custom",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    modelName: "glm-4-7-251222",
    presetKey: "volcoengine-glm-4-7-251222",
    isDefault: true
  },
  {
    name: "VolcoEngine Doubao Seed Flash",
    providerType: "custom",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    modelName: "doubao-seed-1-6-flash-250615",
    presetKey: "volcoengine-doubao-seed-1-6-flash-250615",
    isDefault: false
  },
  {
    name: "VolcoEngine Doubao Seed 2.0 Lite Multimodal",
    providerType: "custom",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    modelName: "doubao-seed-2-0-lite-260428",
    presetKey: "volcoengine-doubao-seed-2-0-lite-260428",
    isDefault: false
  },
  {
    name: "VolcoEngine DeepSeek V4 Flash",
    providerType: "custom",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    modelName: "deepseek-v4-flash-260425",
    presetKey: "volcoengine-deepseek-v4-flash-260425",
    isDefault: false
  }
] as const;

export const defaultVolcoEngineModel = defaultVolcoEngineModels[0];

export function presetToTarget(presetKey: string) {
  const arkPreset = defaultVolcoEngineModels.find((model) => model.presetKey === presetKey);
  if (arkPreset) {
    return {
      name: arkPreset.name,
      baseUrl: arkPreset.baseUrl,
      modelName: arkPreset.modelName
    };
  }
  if (presetKey === "maple-code") {
    return {
      name: "Maple Code",
      baseUrl: process.env.OPENAI_BASE_URL || defaultVolcoEngineModel.baseUrl,
      modelName: process.env.MAPLE_CODE_MODEL || defaultVolcoEngineModel.modelName
    };
  }
  return {
    name: "GPT5.5",
    baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    modelName: "gpt-5.5"
  };
}

// model configs are now global (workspace_id = "-1"), shared across all workspaces.
// kept as an alias accepting an ignored userId so existing call sites keep compiling.
export function ensureDefaultVolcoEngineConfig(_userId?: string) {
  const seeded = ensureGlobalModelConfigs();
  return seeded.find((config) => config.preset_key === defaultVolcoEngineModel.presetKey) || seeded[0];
}

export function ensureGlobalModelConfigs() {
  const configs = listGlobalModelConfigs() as JsonRecord[];
  const arkKey = arkProviderApiKey();
  const encryptArkKey = () => (arkKey ? encryptSecret(arkKey) : null);
  const api_key_hint = arkKey ? secretHint(arkKey) : null;
  const results = defaultVolcoEngineModels.map((model) => {
    const existing = configs.find((config) => {
      return (
        config.preset_key === model.presetKey ||
        (String(config.base_url || "").replace(/\/$/, "") === model.baseUrl && config.model_name === model.modelName)
      );
    });
    if (existing) {
      const api_key_ciphertext = encryptArkKey();
      if (api_key_ciphertext && !existing.has_api_key) {
        return updateModelConfigSecret(String(existing.id), { api_key_ciphertext, api_key_hint }) as JsonRecord;
      }
      return existing;
    }
    return createModelConfig({
      workspace_id: GLOBAL_SCOPE_ID,
      tenant_id: GLOBAL_SCOPE_ID,
      owner_user_id: null,
      name: model.name,
      provider_type: model.providerType,
      base_url: model.baseUrl,
      model_name: model.modelName,
      preset_key: model.presetKey,
      api_key_ciphertext: encryptArkKey(),
      api_key_hint,
      is_default: model.isDefault
    }) as JsonRecord;
  });
  ensureGlobalDefaultModel();
  return results;
}

export function selectModelForPrompt(input: { userId: string; prompt?: string; modelConfigId?: string | null; workspaceId?: string | null }): ModelSelection {
  ensureGlobalModelConfigs();
  const workspaceId = input.workspaceId ?? GLOBAL_SCOPE_ID;
  if (input.modelConfigId) {
    const explicit = getModelConfig(input.modelConfigId, workspaceId) as JsonRecord | null;
    if (explicit) return modelSelectionFromConfig(explicit);
    throw new Error(`Model config not found: ${input.modelConfigId}`);
  }

  const configs = listModelConfigs(workspaceId) as JsonRecord[];
  const prompt = (input.prompt || "").toLowerCase();
  if (promptNeedsMultimodalModel(prompt)) {
    const multimodal = configs.find(modelConfigLooksMultimodal);
    if (multimodal) return modelSelectionFromConfig(multimodal);
  }

  const matched = configs.find((config) => {
    const terms = [config.name, config.model_name, config.provider_type, config.preset_key].filter(Boolean).map((value) => String(value).toLowerCase());
    return terms.some((term) => term && prompt.includes(term));
  });
  if (matched) return modelSelectionFromConfig(matched);

  const wantsFast = ["fast", "quick", "cheap", "low latency", "低延迟", "快速", "便宜", "省钱"].some((term) => prompt.includes(term));
  if (wantsFast) {
    const fast = configs.find((config) => /mini|flash|fast|lite|turbo/i.test(`${config.name} ${config.model_name}`));
    if (fast) return modelSelectionFromConfig(fast);
  }

  const wantsReasoning = ["reason", "research", "complex", "planning", "code", "推理", "研究", "复杂", "规划", "代码"].some((term) => prompt.includes(term));
  if (wantsReasoning) {
    const reasoning = configs.find((config) => /gpt|reason|thinking|pro|glm|maple/i.test(`${config.name} ${config.model_name}`));
    if (reasoning) return modelSelectionFromConfig(reasoning);
  }

  const defaultConfig = (getDefaultModelConfig(workspaceId) as JsonRecord | null) || configs[0];
  if (defaultConfig) return modelSelectionFromConfig(defaultConfig);

  return {
    provider: "openai",
    model: process.env.OPENAI_MODEL || process.env.ARK_MODEL || defaultVolcoEngineModel.modelName
  };
}

export function promptNeedsMultimodalModel(prompt: string) {
  const text = prompt.toLowerCase();
  if (!text.trim()) return false;
  const terms = [
    "图片", "图像", "照片", "截图", "视觉", "看图", "识图", "视频", "帧", "多模态", "全模态", "音频", "语音",
    "photo", "screenshot", "vision", "video", "frame", "multimodal", "omnimodal", "ocr", "audio"
  ];
  if (terms.some((term) => text.includes(term))) return true;
  if (/\bimages?\b/.test(text) && !/\b(docker|container|runtime|base)\s+images?\b/.test(text)) return true;
  return false;
}

export function modelConfigLooksMultimodal(config: JsonRecord) {
  const label = [config.name, config.id, config.model_name, config.provider_type, config.preset_key].filter(Boolean).join(" ").toLowerCase();
  return /multimodal|omnimodal|vision|video|image|全模态|多模态|doubao-seed-2[-.]0-(lite|pro|mini)/i.test(label);
}

export function modelSelectionFromConfig(config: JsonRecord): ModelSelection {
  return {
    configId: String(config.id),
    name: String(config.name || config.model_name || "Model config"),
    provider: String(config.provider_type || "openai"),
    model: String(config.model_name)
  };
}

export function resolveModelTarget(input: { userId?: string; modelConfigId?: string | null; workspaceId?: string | null }): ModelTarget {
  ensureGlobalModelConfigs();
  const workspaceId = input.workspaceId ?? GLOBAL_SCOPE_ID;
  const config = input.modelConfigId
    ? getModelConfigInternal(input.modelConfigId, workspaceId)
    : getDefaultModelConfigInternal(workspaceId);
  if (config) {
    const row = config as JsonRecord;
    const apiKeyCiphertext = row.api_key_ciphertext ? String(row.api_key_ciphertext) : "";
    const apiKeyRef = row.api_key_ref ? String(row.api_key_ref) : "";
    const apiKey = resolveConfigApiKey(row, apiKeyCiphertext, apiKeyRef);
    if (!apiKey) throw new Error("Model config has no API key and no OPENAI_API_KEY/ARK_API_KEY fallback is configured.");
    return {
      baseUrl: String(row.base_url).replace(/\/$/, ""),
      model: String(row.model_name),
      apiKey,
      source: "user_config"
    };
  }
  const apiKey = providerApiKey();
  if (!apiKey) throw new Error("No provider credential configured. Set OPENAI_API_KEY, ARK_API_KEY, or create a user model config.");
  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model =
    process.env.OPENAI_MODEL ||
    process.env.ARK_MODEL ||
    (baseUrl.includes("volces.com") || baseUrl.includes("ark.cn-beijing") ? "doubao-seed-1-6-251015" : "gpt-4.1-mini");
  return { baseUrl, model, apiKey, source: "environment" };
}

function resolveConfigApiKey(row: JsonRecord, apiKeyCiphertext: string, apiKeyRef: string) {
  try {
    return apiKeyCiphertext ? decryptSecret(apiKeyCiphertext) : apiKeyRef ? readSecret(apiKeyRef) : providerApiKey();
  } catch (error) {
    if (String(row.workspace_id || "") !== GLOBAL_SCOPE_ID) throw error;
    const fallback = providerApiKey();
    if (!fallback) throw error;
    return fallback;
  }
}

export async function testSavedModelConfig(input: { userId: string; modelConfigId?: string | null; timeoutMs?: number }) {
  const current = input.modelConfigId ? (getModelConfig(input.modelConfigId) as JsonRecord | null) : null;
  const workspaceId = current?.workspace_id ? String(current.workspace_id) : GLOBAL_SCOPE_ID;
  const target = resolveModelTarget({ userId: input.userId, modelConfigId: input.modelConfigId || null, workspaceId });
  return testModelTarget(target, input.timeoutMs);
}

export async function testUnsavedModelConfig(input: {
  baseUrl: string;
  modelName: string;
  apiKey?: string;
  timeoutMs?: number;
}) {
  const apiKey = input.apiKey || providerApiKey();
  if (!apiKey) {
    return {
      ok: false,
      status: 0,
      latency_ms: 0,
      model: input.modelName,
      base_url: input.baseUrl.replace(/\/$/, ""),
      source: "unsaved_config" as const,
      message: "No API key provided and no OPENAI_API_KEY/ARK_API_KEY fallback is configured."
    };
  }
  return testModelTarget(
    {
      baseUrl: input.baseUrl.replace(/\/$/, ""),
      model: input.modelName,
      apiKey,
      source: "environment"
    },
    input.timeoutMs,
    "unsaved_config"
  );
}

async function testModelTarget(target: ModelTarget, timeoutMs = 12_000, sourceOverride?: ModelConnectivityResult["source"]): Promise<ModelConnectivityResult> {
  const startedAt = Date.now();
  try {
    const upstream = await fetch(`${target.baseUrl}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Authorization: `Bearer ${target.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: target.model,
        messages: [{ role: "user", content: "Reply with ok." }],
        temperature: 0,
        max_tokens: 8
      })
    });
    const text = await upstream.text();
    const data = parseJson(text);
    const choice = Array.isArray(data.choices) ? (data.choices[0] as JsonRecord | undefined) : undefined;
    const content = choice && typeof choice.message === "object" && choice.message ? String((choice.message as JsonRecord).content ?? "") : "";
    const errorMessage = typeof data.error === "object" && data.error ? String((data.error as JsonRecord).message ?? "") : "";
    return {
      ok: upstream.ok,
      status: upstream.status,
      latency_ms: Date.now() - startedAt,
      model: target.model,
      base_url: target.baseUrl,
      source: sourceOverride || target.source,
      message: upstream.ok ? content.slice(0, 180) || "Connection succeeded." : errorMessage.slice(0, 240) || text.slice(0, 240) || "Connection failed."
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      latency_ms: Date.now() - startedAt,
      model: target.model,
      base_url: target.baseUrl,
      source: sourceOverride || target.source,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

function parseJson(text: string) {
  try {
    return JSON.parse(text) as JsonRecord;
  } catch {
    return {};
  }
}

function providerApiKey() {
  return process.env.OPENAI_API_KEY || process.env.ARK_API_KEY;
}

function arkProviderApiKey() {
  if (process.env.ARK_API_KEY) return process.env.ARK_API_KEY;
  const openAiBase = process.env.OPENAI_BASE_URL || "";
  return /volces\.com|ark\.cn-beijing/i.test(openAiBase) ? process.env.OPENAI_API_KEY || "" : "";
}

function secretHint(value: string) {
  const trimmed = value.trim();
  if (trimmed.length <= 8) return `${"*".repeat(Math.max(0, trimmed.length - 2))}${trimmed.slice(-2)}`;
  return `${trimmed.slice(0, 3)}...${trimmed.slice(-4)}`;
}
