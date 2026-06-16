import { replenishWorkspaceSandboxPool } from "../runtime/sandboxPoolManager";
import {
  getWorkspaceRuntimePool,
  getWorkspaceSandboxPool,
  provisionPoolMembersBackground,
  type RuntimePoolConfig
} from "../store";
import type { JsonRecord } from "../types";

type ProvisioningLog = { at: string; level: "info" | "warn" | "err"; message: string };

export async function finishWorkspaceProvisioning(created: JsonRecord, providerCredentials?: JsonRecord) {
  const workspace = record(created.workspace);
  const workspaceId = String(workspace.id || "");
  const initialRuntimePool = getWorkspaceRuntimePool(workspaceId);
  const memberRefs = (initialRuntimePool?.members ?? [])
    .map((member: JsonRecord, index: number) => ({ memberId: String(member.id), index, status: String(member.status || "") }))
    .filter((member) => member.status !== "active");
  const logs: ProvisioningLog[] = [];
  logs.push(log("info", `runtime pool provisioning started: members=${memberRefs.length}`));
  logs.push(log("info", "sandbox pool replenish started"));
  await Promise.all([finishRuntimePool(workspaceId, initialRuntimePool as JsonRecord | null, memberRefs, providerCredentials, logs), finishSandboxPool(workspaceId, logs)]);
  return {
    runtime_pool: getWorkspaceRuntimePool(workspaceId),
    sandbox_pool: getWorkspaceSandboxPool(workspaceId),
    provisioning_logs: logs
  };
}

export function startWorkspaceProvisioningBackground(created: JsonRecord, providerCredentials?: JsonRecord) {
  const workspace = record(created.workspace);
  const workspaceId = String(workspace.id || "");
  void finishWorkspaceProvisioning(created, providerCredentials).catch((error) => {
    console.error("[workspace-provisioning] background provisioning failed", workspaceId, error);
  });
}

function log(level: ProvisioningLog["level"], message: string): ProvisioningLog {
  return { at: new Date().toISOString(), level, message };
}

function record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function runtimePoolConfig(pool: JsonRecord): RuntimePoolConfig {
  return {
    desired_size: Number(pool.desired_size ?? 0),
    min_instances_per_function: Number(pool.min_instances_per_function ?? 0),
    max_instances_per_function: Number(pool.max_instances_per_function ?? 1),
    max_concurrency_per_instance: Number(pool.max_concurrency_per_instance ?? 1),
    cpu_milli: Number(pool.cpu_milli ?? 1000),
    memory_mb: Number(pool.memory_mb ?? 1024)
  };
}

async function finishRuntimePool(
  workspaceId: string,
  pool: JsonRecord | null,
  memberRefs: Array<{ memberId: string; index: number }>,
  providerCredentials: JsonRecord | undefined,
  logs: ProvisioningLog[]
) {
  try {
    if (pool) await provisionPoolMembersBackground(workspaceId, memberRefs, runtimePoolConfig(pool), providerCredentials);
    const runtimePool = getWorkspaceRuntimePool(workspaceId);
    const failed = (runtimePool?.members ?? []).filter((member: JsonRecord) => member.status === "failed").length;
    logs.push(log(failed ? "warn" : "info", `runtime pool provisioning completed: failed=${failed}`));
  } catch (error) {
    logs.push(log("err", `runtime pool provisioning failed: ${error instanceof Error ? error.message : String(error)}`));
  }
}

async function finishSandboxPool(workspaceId: string, logs: ProvisioningLog[]) {
  try {
    const result = await replenishWorkspaceSandboxPool(workspaceId);
    logs.push(log("info", `sandbox pool replenish completed: ${JSON.stringify(result)}`));
  } catch (error) {
    logs.push(log("err", `sandbox pool replenish failed: ${error instanceof Error ? error.message : String(error)}`));
  }
}
