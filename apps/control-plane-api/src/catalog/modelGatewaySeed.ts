import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { encryptSecret } from "../secrets";
import { isLocalDockerMode } from "../runtime/localDockerMode";
import {
  GLOBAL_SCOPE_ID,
  createModelConfig,
  ensureGlobalDefaultModel,
  listGlobalModelConfigs,
  updateModelConfig,
  updateModelConfigSecret
} from "../store";
import type { JsonRecord } from "../types";

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
const bundledPresetKeys = new Set<string>(defaultVolcoEngineModels.map((model) => model.presetKey));

type SeedModel = {
  name: string;
  providerType: string;
  baseUrl: string;
  modelName: string;
  presetKey: string | null;
  isDefault: boolean;
  apiKey: string;
};

export function presetToTarget(presetKey: string) {
  const arkPreset = defaultVolcoEngineModels.find((model) => model.presetKey === presetKey);
  if (arkPreset) return { name: arkPreset.name, baseUrl: arkPreset.baseUrl, modelName: arkPreset.modelName };
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

export function ensureDefaultVolcoEngineConfig(_userId?: string) {
  const seeded = ensureGlobalModelConfigs() as JsonRecord[];
  return seeded.find((config) => config.preset_key === defaultVolcoEngineModel.presetKey) || seeded[0];
}

export function ensureGlobalModelConfigs() {
  const configured = configuredModelSeeds();
  if (configured.length) return ensureSeedModels(configured);
  if (shouldSeedBundledModels()) return ensureSeedModels(bundledVolcoEngineSeeds());
  ensureGlobalDefaultModel();
  return listGlobalModelConfigs() as JsonRecord[];
}

export function isBundledDefaultModelConfig(config: JsonRecord) {
  return bundledPresetKeys.has(String(config.preset_key || ""));
}

export function visibleModelConfigsForCurrentMode(configs: JsonRecord[]) {
  if (!isLocalDockerMode()) return configs;
  return configs.filter((config) => !isBundledDefaultModelConfig(config));
}

function shouldSeedBundledModels() {
  const override = String(process.env.MAPLE_SEED_DEFAULT_MODELS || "").toLowerCase();
  if (["1", "true", "yes"].includes(override)) return true;
  if (["0", "false", "no"].includes(override)) return false;
  return !isLocalDockerMode();
}

function bundledVolcoEngineSeeds(): SeedModel[] {
  const arkKey = arkProviderApiKey();
  return defaultVolcoEngineModels.map((model) => ({
    name: model.name,
    providerType: model.providerType,
    baseUrl: model.baseUrl,
    modelName: model.modelName,
    presetKey: model.presetKey,
    isDefault: model.isDefault,
    apiKey: arkKey
  }));
}

function configuredModelSeeds() {
  const configPath = resolve(process.cwd(), process.env.MAPLE_LOCAL_MODEL_CONFIG_FILE || "config/local-model.json");
  if (!existsSync(configPath)) return [];
  const raw = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
  const items = Array.isArray(raw) ? raw : Array.isArray((raw as JsonRecord)?.models) ? ((raw as JsonRecord).models as unknown[]) : [];
  return items.map((item, index) => normalizeConfiguredModel(item, index));
}

function normalizeConfiguredModel(item: unknown, index: number): SeedModel {
  const row = item as JsonRecord;
  const baseUrl = stringValue(row.base_url);
  const modelName = stringValue(row.model_name ?? row.model);
  if (!baseUrl || !modelName) throw new Error(`Local model config entry ${index + 1} requires base_url and model_name.`);
  const apiKeyEnv = stringValue(row.api_key_env);
  return {
    name: stringValue(row.name) || modelName,
    providerType: stringValue(row.provider_type ?? row.protocol) || "openai",
    baseUrl,
    modelName,
    presetKey: stringValue(row.preset_key) || null,
    isDefault: typeof row.is_default === "boolean" ? row.is_default : index === 0,
    apiKey: stringValue(row.api_key) || (apiKeyEnv ? process.env[apiKeyEnv] || "" : "")
  };
}

function ensureSeedModels(models: SeedModel[]) {
  const configs = listGlobalModelConfigs() as JsonRecord[];
  const results = models.map((model) => {
    const existing = findExistingSeed(configs, model);
    const api_key_ciphertext = model.apiKey ? encryptSecret(model.apiKey) : null;
    const api_key_hint = model.apiKey ? secretHint(model.apiKey) : null;
    if (existing) {
      if (api_key_ciphertext && !existing.has_api_key) updateModelConfigSecret(String(existing.id), { api_key_ciphertext, api_key_hint });
      if (model.isDefault || model.name !== existing.name) updateModelConfig(String(existing.id), { name: model.name, is_default: model.isDefault });
      const current = listGlobalModelConfigs() as JsonRecord[];
      return current.find((config) => String(config.id) === String(existing.id)) || existing;
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
      api_key_ciphertext,
      api_key_hint,
      is_default: model.isDefault
    }) as JsonRecord;
  });
  ensureGlobalDefaultModel();
  return results;
}

function findExistingSeed(configs: JsonRecord[], model: SeedModel) {
  return configs.find((config) => {
    if (model.presetKey && config.preset_key === model.presetKey) return true;
    return String(config.base_url || "").replace(/\/$/, "") === model.baseUrl.replace(/\/$/, "") && config.model_name === model.modelName;
  });
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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
