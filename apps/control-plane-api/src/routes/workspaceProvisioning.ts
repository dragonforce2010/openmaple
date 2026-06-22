import { replenishWorkspaceSandboxPool } from "../runtime/sandboxPoolManager";
import {
  getWorkspaceRuntimePool,
  listWorkspaceRuntimePools,
  getWorkspaceSandboxPool,
  provisionPoolMembersBackground,
  type RuntimePoolConfig
} from "../store";
import type { JsonRecord } from "../types";

type ProvisioningLog = { at: string; level: "info" | "warn" | "err"; message: string };

export async function finishWorkspaceProvisioning(created: JsonRecord, providerCredentials?: JsonRecord) {
  const workspace = record(created.workspace);
  const workspaceId = String(workspace.id || "");
  const initialRuntimePools = listWorkspaceRuntimePools(workspaceId) as JsonRecord[];
  const logs: ProvisioningLog[] = [];
  logs.push(log("info", `runtime pool provisioning started: pools=${initialRuntimePools.length}`));
  logs.push(log("info", "sandbox pool replenish started"));
  await Promise.all([finishRuntimePools(workspaceId, initialRuntimePools, providerCredentials, logs), finishSandboxPool(workspaceId, logs)]);
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

function runtimePoolConfig(pool: JsonRecord): RuntimePoolConfig & { provider?: string } {
  return {
    provider: String(pool.provider || ""),
    desired_size: Number(pool.desired_size ?? 0),
    min_instances_per_function: Number(pool.min_instances_per_function ?? 0),
    max_instances_per_function: Number(pool.max_instances_per_function ?? 1),
    max_concurrency_per_instance: Number(pool.max_concurrency_per_instance ?? 1),
    cpu_milli: Number(pool.cpu_milli ?? 1000),
    memory_mb: Number(pool.memory_mb ?? 1024)
  };
}

async function finishRuntimePools(
  workspaceId: string,
  pools: JsonRecord[],
  providerCredentials: JsonRecord | undefined,
  logs: ProvisioningLog[]
) {
  try {
    await Promise.all(pools.map((pool) => {
      const memberRefs = (Array.isArray(pool.members) ? pool.members : [])
        .map((member: JsonRecord, index: number) => ({ memberId: String(member.id), index, status: String(member.status || "") }))
        .filter((member) => member.status !== "active");
      return provisionPoolMembersBackground(workspaceId, memberRefs, runtimePoolConfig(pool), providerCredentials);
    }));
    const failed = (listWorkspaceRuntimePools(workspaceId) as JsonRecord[])
      .flatMap((pool) => Array.isArray(pool.members) ? pool.members as JsonRecord[] : [])
      .filter((member: JsonRecord) => member.status === "failed").length;
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
