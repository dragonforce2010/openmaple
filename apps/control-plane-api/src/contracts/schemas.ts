import { z } from "zod";
import { agentLoopTypes, defaultAgentLoop } from "../agentLoops";

export const agentConfigSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  model: z.object({
    provider: z.string().default("custom"),
    id: z.string().default("glm-4-7-251222"),
    speed: z.string().optional(),
    config_id: z.string().optional(),
    name: z.string().optional()
  }),
  system: z.string().min(1),
  tools: z.array(z.record(z.string(), z.unknown())).default([]),
  mcp_servers: z.array(z.record(z.string(), z.unknown())).default([]),
  skills: z.array(z.record(z.string(), z.unknown())).default([]),
  agent_loop: z
    .object({
      type: z.enum(agentLoopTypes).default(defaultAgentLoop.type),
      config: z.record(z.string(), z.unknown()).default({}),
      hooks: z.array(z.record(z.string(), z.unknown())).default([])
    })
    .default({ type: defaultAgentLoop.type, config: {}, hooks: [] }),
  multiagent: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export const templateSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  category: z.string().default("custom"),
  template: z.record(z.string(), z.unknown()).default({})
});

export const localSkillSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1)
});

export const loginSchema = z.object({
  provider: z.enum(["local", "oauth", "oidc", "lark_sso", "bytesso"]).default("local"),
  email: z.string().email(),
  name: z.string().optional()
});

export const modelConfigSchema = z
  .object({
    kind: z.enum(["custom", "preset"]).default("custom"),
    name: z.string().min(1),
    protocol: z.enum(["openai", "anthropic"]).optional(),
    base_url: z.string().url().optional(),
    model_name: z.string().min(1).optional(),
    api_key: z.string().optional(),
    workspace_id: z.string().min(1).optional(),
    preset_key: z
      .enum([
        "volcoengine-glm-4-7-251222",
        "volcoengine-doubao-seed-1-6-flash-250615",
        "volcoengine-doubao-seed-2-0-lite-260428",
        "volcoengine-deepseek-v4-flash-260425",
        "gpt-5.5",
        "maple-code"
      ])
      .optional(),
    is_default: z.boolean().default(false)
  })
  .refine((value) => value.kind === "preset" || (value.base_url && value.model_name), {
    message: "custom model configs require base_url and model_name"
  });

export const modelConfigPatchSchema = z.object({
  name: z.string().min(1).optional(),
  base_url: z.string().url().optional(),
  model_name: z.string().min(1).optional(),
  is_default: z.boolean().optional()
});

export const modelConfigTestSchema = z
  .object({
    kind: z.enum(["custom", "preset"]).default("custom"),
    base_url: z.string().url().optional(),
    model_name: z.string().min(1).optional(),
    api_key: z.string().optional(),
    preset_key: z
      .enum([
        "volcoengine-glm-4-7-251222",
        "volcoengine-doubao-seed-1-6-flash-250615",
        "volcoengine-doubao-seed-2-0-lite-260428",
        "volcoengine-deepseek-v4-flash-260425",
        "gpt-5.5",
        "maple-code"
      ])
      .optional()
  })
  .refine((value) => value.kind === "preset" || (value.base_url && value.model_name), {
    message: "custom model tests require base_url and model_name"
  });

const workspaceOnboardingBaseSchema = z.object({
  tenant: z.object({
    name: z.string().min(1),
    description: z.string().default("")
  }),
  workspace: z.object({
    name: z.string().min(1),
    description: z.string().default(""),
    slug: z.string().min(3, "workspace slug must be 3-30 characters (leave empty to auto-generate)").max(30).optional()
  }),
  runtime_provider: z.enum(["vefaas", "local_docker"]).default("vefaas"),
  runtime_pool: z.object({
    desired_size: z.coerce.number().int().nonnegative().default(3),
    min_instances_per_function: z.coerce.number().int().nonnegative().default(1),
    max_instances_per_function: z.coerce.number().int().positive().default(100),
    max_concurrency_per_instance: z.coerce.number().int().positive().default(1000),
    cpu_milli: z.coerce.number().int().positive().default(2000),
    memory_mb: z.coerce.number().int().positive().default(4096)
  }),
  sandbox_provider: z.enum(["e2b", "vefaas", "local_docker", "daytona"]).default("e2b"),
  sandbox_config: z.record(z.string(), z.unknown()).default({}),
  sandbox_pool: z
    .object({
      desired_size: z.coerce.number().int().min(1).max(100).default(1),
      standby_ttl_ms: z.coerce.number().int().min(60_000).default(30 * 60 * 1000)
    })
    .default({ desired_size: 1, standby_ttl_ms: 30 * 60 * 1000 }),
  model_config_ids: z.array(z.string().min(1)).default([]),
  custom_model_configs: z.array(modelConfigSchema).default([]),
  api_key: z
    .object({
      display_name: z.string().min(1).default("Default workspace key"),
      scopes: z.array(z.string().min(1)).default(["control_plane", "data_plane"])
    })
    .default({ display_name: "Default workspace key", scopes: ["control_plane", "data_plane"] }),
  admin: z.object({ email: z.string().email().optional(), name: z.string().optional() }).default({}),
  member_emails: z.array(z.string().email()).default([]),
  provider_credentials: z.record(z.string(), z.unknown()).default({})
});

const requiresModelPool = (value: { model_config_ids?: string[]; custom_model_configs?: unknown[] }) =>
  (value.model_config_ids?.length ?? 0) > 0 || (value.custom_model_configs?.length ?? 0) > 0;

export const workspaceOnboardingSchema = workspaceOnboardingBaseSchema.refine(requiresModelPool, {
  message: "at least one model config is required",
  path: ["model_config_ids"]
});

export const workspaceApiKeySchema = z.object({
  display_name: z.string().min(1),
  scopes: z.array(z.string().min(1)).default(["control_plane", "data_plane"])
});

export const tenantApiKeySchema = z.object({
  display_name: z.string().min(1),
  scopes: z.array(z.string().min(1)).default(["tenant_admin", "control_plane", "data_plane"])
});

export const workspaceCreateSchema = workspaceOnboardingBaseSchema.omit({ tenant: true }).extend({
  tenant_id: z.string().min(1).optional(),
  model_config_ids: z.array(z.string().min(1)).default([])
}).refine(requiresModelPool, {
  message: "at least one model config is required",
  path: ["model_config_ids"]
});

export const workspacePatchSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional()
});

export const workspaceAdminSchema = z.object({
  email: z.string().email()
});

export const deploymentManifestSchema = z
  .object({
    schema_version: z.union([z.literal(1), z.string()]).default(1),
    name: z.string().min(1),
    version: z.string().min(1).default("0.1.0"),
    description: z.string().default(""),
    agent: agentConfigSchema,
    environment: z
      .object({
        name: z.string().min(1).default("maple-e2b-sandbox"),
        config: z.record(z.string(), z.unknown()).default({
          type: "e2b",
          sandbox: { provider: "e2b" }
        })
      })
      .default({
        name: "maple-e2b-sandbox",
        config: { type: "e2b", sandbox: { provider: "e2b" } }
      }),
    harness: z.record(z.string(), z.unknown()).default({}),
    resources: z.array(z.record(z.string(), z.unknown())).default([]),
    vault_ids: z.array(z.string()).default([]),
    memory_store_ids: z.array(z.string()).default([]),
    metadata: z.record(z.string(), z.unknown()).default({})
  })
  .passthrough();

export const deploymentBundleSchema = z
  .object({
    sha256: z.string().min(1),
    files: z
      .array(
        z.object({
          path: z.string().min(1),
          content_base64: z.string().default("")
        })
      )
      .default([])
  })
  .default({ sha256: "empty", files: [] });

export const deploymentInitialEventSchema = z
  .object({
    type: z.string().min(1),
    content: z.array(z.record(z.string(), z.unknown())).optional(),
    payload: z.record(z.string(), z.unknown()).optional()
  })
  .passthrough();

export const deploymentScheduleSchema = z
  .object({
    type: z.literal("cron").default("cron"),
    expression: z.string().min(1),
    timezone: z.string().min(1).default("UTC")
  })
  .passthrough();

export const deploymentCreateSchema = z
  .object({
    workspace_id: z.string().min(1).optional(),
    agent_id: z.string().min(1),
    environment_id: z.string().min(1),
    name: z.string().min(1),
    version: z.string().min(1).default("1"),
    initial_events: z.array(deploymentInitialEventSchema).default([]),
    schedule: deploymentScheduleSchema.nullish(),
    vault_ids: z.array(z.string()).default([]),
    memory_store_ids: z.array(z.string()).default([]),
    resources: z.array(z.record(z.string(), z.unknown())).default([]),
    metadata: z.record(z.string(), z.unknown()).default({})
  })
  .passthrough();

export const deploymentPatchSchema = z
  .object({
    name: z.string().min(1).optional(),
    version: z.string().min(1).optional(),
    initial_events: z.array(deploymentInitialEventSchema).optional(),
    schedule: deploymentScheduleSchema.nullable().optional(),
    vault_ids: z.array(z.string()).optional(),
    memory_store_ids: z.array(z.string()).optional(),
    resources: z.array(z.record(z.string(), z.unknown())).optional(),
    metadata: z.record(z.string(), z.unknown()).optional()
  })
  .passthrough();

export const deploymentRunCreateSchema = z
  .object({
    message: z.string().min(1).optional(),
    title: z.string().optional(),
    initial_events: z.array(deploymentInitialEventSchema).optional(),
    vault_ids: z.array(z.string()).optional(),
    memory_store_ids: z.array(z.string()).optional(),
    resources: z.array(z.record(z.string(), z.unknown())).optional(),
    trigger_context: z.record(z.string(), z.unknown()).default({})
  })
  .passthrough();
