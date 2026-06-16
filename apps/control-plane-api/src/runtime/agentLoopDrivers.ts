import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { AgentConfig, JsonRecord } from "../types";
import {
  asRecord,
  claudeRuntimeAuthEnv,
  messageFromClaudeEvents,
  messageFromClaudeOutput,
  numberConfig,
  nvmCodexCandidates,
  optionalPair,
  parseJson,
  pathCandidates,
  redactPromptArg,
  splitCommand,
  stringArray,
  truncate,
  truthy,
  unique,
  usageFromClaudeEvents,
  usageFromClaudeOutput
} from "./agentLoopDriverUtils";
import { normalizeAgentLoop } from "./agentLoops";
import { ClaudeNdjsonRunner } from "./claudeNdjsonRunner";

const execFileAsync = promisify(execFile);
const defaultTimeoutMs = 10 * 60 * 1000;
const repoRoot = process.env.MAPLE_REPO_ROOT || findRepoRoot(dirname(fileURLToPath(import.meta.url)));
const defaultClaudeSdkRunner = join(repoRoot, "infra", "vefaas", "runtime-app", "claude_agent_sdk_runner.py");
const claudeRunners = new Map<string, ClaudeNdjsonRunner>();

export type ExternalAgentLoopResult = {
  driver: "claude_code" | "codex_cli";
  command: string;
  args: string[];
  cwd: string;
  stdout: string;
  stderr: string;
  message: string;
  duration_ms: number;
  events?: JsonRecord[];
  usage?: JsonRecord;
};

type DriverInput = {
  sessionId: string;
  agent: AgentConfig;
  userText: string;
  workspacePath: string;
  onEvent?: (event: JsonRecord) => void;
};

type CommandResult = {
  stdout: string;
  stderr: string;
};

export function shouldUseExternalAgentLoop(agent: AgentConfig) {
  if (hasMcpServers(agent)) return true;
  const loop = normalizeAgentLoop(agent.agent_loop);
  const config = asRecord(loop.config);
  const execution = String(config.execution || process.env.MAPLE_AGENT_LOOP_EXECUTION || "provider").toLowerCase();
  return !["provider", "legacy_provider", "simulated"].includes(execution);
}

function hasMcpServers(agent: AgentConfig) {
  if (!Array.isArray(agent.mcp_servers)) return false;
  return agent.mcp_servers.some((server) => {
    const record = asRecord(server);
    return Boolean(record.name || record.id || record.url || record.mcp_url);
  });
}

function findRepoRoot(start: string) {
  let current = start;
  while (current !== dirname(current)) {
    if (existsSync(join(current, "package.json")) && existsSync(join(current, "apps"))) return current;
    current = dirname(current);
  }
  return process.cwd();
}

export async function runExternalAgentLoop(input: DriverInput): Promise<ExternalAgentLoopResult> {
  const loop = normalizeAgentLoop(input.agent.agent_loop);
  if (loop.type === "codex_open_source") return runCodexLoop(input);
  return runClaudeCodeLoop(input);
}

async function runClaudeCodeLoop(input: DriverInput): Promise<ExternalAgentLoopResult> {
  const loop = normalizeAgentLoop(input.agent.agent_loop);
  const config = asRecord(loop.config);
  const protocol = String(config.protocol || process.env.MAPLE_CLAUDE_CODE_PROTOCOL || "claude_sdk_ndjson").toLowerCase();
  if (["cli_batch", "batch", "print"].includes(protocol)) return runClaudeCliBatchLoop(input);

  const startedAt = Date.now();
  const commandSpec = claudeSdkRunnerCommand(config);
  const runnerKey = `${input.sessionId}:${commandSpec.command}:${commandSpec.args.join("\u0000")}`;
  let runner = claudeRunners.get(runnerKey);
  if (!runner) {
    runner = new ClaudeNdjsonRunner(
      commandSpec.command,
      commandSpec.args,
      input.workspacePath,
      externalLoopEnv(input),
      input.agent,
      externalLoopSystemPrompt(input.agent, input.sessionId, input.workspacePath)
    );
    claudeRunners.set(runnerKey, runner);
    runner.closed.then(() => claudeRunners.delete(runnerKey)).catch(() => claudeRunners.delete(runnerKey));
  }
  const result = await runner.query(input, numberConfig(config.timeout_ms, process.env.MAPLE_AGENT_LOOP_TIMEOUT_MS, defaultTimeoutMs));
  return {
    driver: "claude_code",
    command: commandSpec.command,
    args: commandSpec.args,
    cwd: input.workspacePath,
    stdout: truncate(result.events.map((event) => JSON.stringify(event)).join("\n")),
    stderr: truncate(result.stderr),
    message: messageFromClaudeEvents(result.events),
    duration_ms: Date.now() - startedAt,
    events: result.events,
    usage: usageFromClaudeEvents(result.events)
  };
}

async function runClaudeCliBatchLoop(input: DriverInput): Promise<ExternalAgentLoopResult> {
  const loop = normalizeAgentLoop(input.agent.agent_loop);
  const config = asRecord(loop.config);
  const command = String(config.command || process.env.MAPLE_CLAUDE_CODE_COMMAND || "claude");
  const prompt = String(config.prompt || input.userText);
  const timeoutMs = numberConfig(config.timeout_ms, process.env.MAPLE_AGENT_LOOP_TIMEOUT_MS, defaultTimeoutMs);
  const permissionMode = String(config.permission_mode || process.env.MAPLE_CLAUDE_CODE_PERMISSION_MODE || "bypassPermissions");
  const outputFormat = String(config.output_format || process.env.MAPLE_CLAUDE_CODE_OUTPUT_FORMAT || "json");
  const args = [
    ...stringArray(config.pre_args),
    ...(truthy(config.bare ?? process.env.MAPLE_CLAUDE_CODE_BARE) ? ["--bare"] : []),
    "--print",
    "--output-format",
    outputFormat,
    "--permission-mode",
    permissionMode,
    "--no-session-persistence",
    "--append-system-prompt",
    externalLoopSystemPrompt(input.agent, input.sessionId, input.workspacePath),
    ...optionalPair("--model", config.model || process.env.MAPLE_CLAUDE_CODE_MODEL),
    ...optionalPair("--tools", config.tools || process.env.MAPLE_CLAUDE_CODE_TOOLS),
    ...stringArray(config.args),
    prompt
  ];
  const startedAt = Date.now();
  const result = await execCommand(command, args, input.workspacePath, timeoutMs, externalLoopEnv(input));
  const parsed = parseJson(result.stdout);
  return {
    driver: "claude_code",
    command,
    args: redactPromptArg(args),
    cwd: input.workspacePath,
    stdout: truncate(result.stdout),
    stderr: truncate(result.stderr),
    message: messageFromClaudeOutput(parsed, result.stdout),
    duration_ms: Date.now() - startedAt,
    usage: usageFromClaudeOutput(parsed)
  };
}

export async function shutdownExternalAgentLoop(sessionId: string) {
  const closers = [...claudeRunners.entries()]
    .filter(([key]) => key.startsWith(`${sessionId}:`))
    .map(([, runner]) => runner.shutdown());
  await Promise.allSettled(closers);
}

async function runCodexLoop(input: DriverInput): Promise<ExternalAgentLoopResult> {
  const loop = normalizeAgentLoop(input.agent.agent_loop);
  const config = asRecord(loop.config);
  const command = await resolveCodexCommand(config);
  await assertOpenAICodexCommand(command);
  const timeoutMs = numberConfig(config.timeout_ms, process.env.MAPLE_AGENT_LOOP_TIMEOUT_MS, defaultTimeoutMs);
  const outputPath = join(input.workspacePath, ".session", "codex-last-message.txt");
  await mkdir(join(input.workspacePath, ".session"), { recursive: true });
  const prompt = codexPrompt(input);
  const args = [
    "exec",
    "--cd",
    input.workspacePath,
    "--sandbox",
    String(config.sandbox || process.env.MAPLE_CODEX_SANDBOX || "workspace-write"),
    "--ask-for-approval",
    String(config.approval_policy || process.env.MAPLE_CODEX_APPROVAL_POLICY || "never"),
    "--skip-git-repo-check",
    "--color",
    "never",
    "--output-last-message",
    outputPath,
    ...optionalPair("--model", config.model || process.env.MAPLE_CODEX_MODEL),
    ...optionalPair("--profile", config.profile || process.env.MAPLE_CODEX_PROFILE),
    ...(truthy(config.oss || process.env.MAPLE_CODEX_OSS) ? ["--oss"] : []),
    ...stringArray(config.args),
    prompt
  ];
  const startedAt = Date.now();
  const result = await execCommand(command, args, input.workspacePath, timeoutMs, externalLoopEnv(input));
  const lastMessage = await readFile(outputPath, "utf8").catch(() => "");
  return {
    driver: "codex_cli",
    command,
    args: redactPromptArg(args),
    cwd: input.workspacePath,
    stdout: truncate(result.stdout),
    stderr: truncate(result.stderr),
    message: (lastMessage || result.stdout || result.stderr).trim(),
    duration_ms: Date.now() - startedAt
  };
}

async function execCommand(command: string, args: string[], cwd: string, timeoutMs: number, env: NodeJS.ProcessEnv): Promise<CommandResult> {
  try {
    const result = await execFileAsync(command, args, {
      cwd,
      env,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024
    });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failed = error as Error & { code?: number | string; signal?: string; stdout?: string; stderr?: string };
    throw new Error(
      [
        `External agent loop command failed: ${command}`,
        `exit=${String(failed.code ?? "unknown")}`,
        failed.signal ? `signal=${failed.signal}` : "",
        failed.stderr ? `stderr=${truncate(failed.stderr)}` : "",
        failed.stdout ? `stdout=${truncate(failed.stdout)}` : "",
        failed.message ? `message=${failed.message}` : ""
      ]
        .filter(Boolean)
        .join(" ")
    );
  }
}

async function assertOpenAICodexCommand(command: string) {
  const result = await execCommand(command, ["exec", "--help"], process.cwd(), 10_000, {
    ...process.env,
    NO_COLOR: "1"
  });
  const combined = `${result.stdout}\n${result.stderr}`;
  if (combined.includes("Run Codex non-interactively") || combined.includes("Usage: codex exec")) return;
  throw new Error(`Configured codex command is not OpenAI Codex CLI: ${command}`);
}

async function resolveCodexCommand(config: JsonRecord) {
  const explicit = String(config.command || process.env.MAPLE_CODEX_COMMAND || "");
  if (explicit) return explicit;
  const candidates = unique([...pathCandidates("codex"), ...nvmCodexCandidates()]);
  for (const candidate of candidates) {
    try {
      await assertOpenAICodexCommand(candidate);
      return candidate;
    } catch {
      // Keep looking; some machines have unrelated binaries named codex.
    }
  }
  return "codex";
}

function externalLoopSystemPrompt(agent: AgentConfig, sessionId: string, workspacePath: string) {
  const loop = normalizeAgentLoop(agent.agent_loop);
  return [
    agent.system,
    "",
    `Managed agent: ${agent.name}`,
    `Session: ${sessionId}`,
    `AgentLoop: ${loop.type}`,
    `Workspace root: ${workspacePath}`,
    "You are the real external agent loop for this managed-agent session.",
    "Use your native CLI tools and keep file operations inside the workspace unless the user explicitly asks otherwise.",
    "Do not claim file, shell, or code results unless you actually inspected or changed them.",
    "Return a concise final response with concrete file paths, commands, or errors when relevant."
  ].join("\n");
}

function codexPrompt(input: DriverInput) {
  return [
    externalLoopSystemPrompt(input.agent, input.sessionId, input.workspacePath),
    "",
    "User message:",
    input.userText
  ].join("\n");
}

function externalLoopEnv(input: DriverInput) {
  const loop = normalizeAgentLoop(input.agent.agent_loop);
  return {
    ...process.env,
    ...claudeRuntimeAuthEnv(process.env),
    NO_COLOR: "1",
    MAPLE_SESSION_ID: input.sessionId,
    MAPLE_AGENT_LOOP_TYPE: loop.type,
    MAPLE_AGENT_TEMPLATE: JSON.stringify(input.agent),
    MAPLE_WORKSPACE_PATH: input.workspacePath
  };
}

function claudeSdkRunnerCommand(config: JsonRecord) {
  const configured = String(config.runner_command || config.command || process.env.MAPLE_CLAUDE_AGENT_SDK_RUNNER_COMMAND || "").trim();
  if (configured) {
    const [command, ...args] = splitCommand(configured);
    return { command: command || configured, args: [...args, ...stringArray(config.runner_args)] };
  }
  return { command: process.env.MAPLE_CLAUDE_AGENT_SDK_PYTHON || "python3", args: [defaultClaudeSdkRunner, ...stringArray(config.runner_args)] };
}
