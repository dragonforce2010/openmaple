import { nanoid } from "nanoid";
import {
  claimDueAgentDeployments,
  finishDeploymentSchedule
} from "../store";
import type { JsonRecord } from "../types";
import { runDeployment } from "./runDeployment";
import { nextDeploymentRunAt } from "./schedule";

type ReadyHook = () => void;

let started = false;
let running = false;

export function startDeploymentScheduler(ensureReady: ReadyHook) {
  if (started || schedulerDisabled()) return;
  started = true;
  const intervalMs = Math.max(1_000, Number(process.env.MAPLE_DEPLOYMENT_SCHEDULER_INTERVAL_MS || 30_000));
  setInterval(() => void tick(ensureReady), intervalMs).unref();
}

async function tick(ensureReady: ReadyHook) {
  if (running) return;
  running = true;
  try {
    ensureReady();
    const owner = `scheduler_${nanoid(6)}`;
    const due = claimDueAgentDeployments(new Date().toISOString(), owner, Number(process.env.MAPLE_DEPLOYMENT_SCHEDULER_LIMIT || 10)) as JsonRecord[];
    for (const deployment of due) await runScheduledDeployment(deployment);
  } catch (error) {
    console.error("[deployments scheduler]", error instanceof Error ? error.message : String(error));
  } finally {
    running = false;
  }
}

async function runScheduledDeployment(deployment: JsonRecord) {
  try {
    await runDeployment({
      deployment,
      triggered_by: "scheduled",
      trigger_context: { scheduled_at: deployment.next_run_at }
    });
    finishDeploymentSchedule(String(deployment.id), nextRunAfter(deployment));
  } catch (error) {
    console.error("[deployments scheduler run]", deployment.id, error instanceof Error ? error.message : String(error));
    finishDeploymentSchedule(String(deployment.id), nextRunAfter(deployment));
  }
}

function nextRunAfter(deployment: JsonRecord) {
  const schedule = deployment.schedule as JsonRecord | null | undefined;
  if (!schedule) return null;
  return nextDeploymentRunAt(schedule, new Date());
}

function schedulerDisabled() {
  return ["1", "true", "yes"].includes(String(process.env.MAPLE_DEPLOYMENT_SCHEDULER_DISABLED || "").toLowerCase());
}
