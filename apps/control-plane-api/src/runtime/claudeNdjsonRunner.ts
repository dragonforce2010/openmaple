import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { AgentConfig, JsonRecord } from "../types";
import { claudeInitPayload, parseJson, truncate } from "./agentLoopDriverUtils";

type RunnerInput = {
  sessionId: string;
  userText: string;
  onEvent?: (event: JsonRecord) => void;
};

export class ClaudeNdjsonRunner {
  private child: ChildProcessWithoutNullStreams;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;
  private pending: {
    events: JsonRecord[];
    onEvent?: (event: JsonRecord) => void;
    resolve: (value: { events: JsonRecord[]; stderr: string }) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  } | null = null;
  private stderr = "";
  readonly ready: Promise<void>;
  readonly closed: Promise<void>;

  constructor(
    readonly command: string,
    readonly args: string[],
    readonly cwd: string,
    readonly env: NodeJS.ProcessEnv,
    readonly agent: AgentConfig,
    systemPrompt: string
  ) {
    this.ready = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.child = spawn(command, args, { cwd, env, stdio: "pipe" });
    this.closed = new Promise<void>((resolve) => {
      this.child.once("error", (error) => {
        this.readyReject?.(error);
        this.pending?.reject(error);
        this.pending = null;
        resolve();
      });
      this.child.once("close", (code, signal) => {
        const error = new Error(`Claude SDK runner exited: command=${command} exit=${String(code ?? "unknown")} signal=${signal ?? ""} stderr=${truncate(this.stderr)}`);
        this.readyReject?.(error);
        this.pending?.reject(error);
        this.pending = null;
        resolve();
      });
    });
    this.child.stderr.on("data", (chunk) => {
      this.stderr = truncate(`${this.stderr}${String(chunk)}`, 8000);
    });
    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => this.handleLine(line));
    this.write({ type: "init", payload: claudeInitPayload(agent, cwd, env, systemPrompt) });
  }

  async query(input: RunnerInput, timeoutMs: number) {
    await this.ready;
    if (this.pending) throw new Error(`Claude SDK runner is already handling a query for session ${input.sessionId}`);
    return new Promise<{ events: JsonRecord[]; stderr: string }>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error(`Claude SDK runner timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending = { events: [], onEvent: input.onEvent, resolve, reject, timer };
      this.write({
        type: "query",
        payload: {
          type: "user",
          message: {
            role: "user",
            content: input.userText
          }
        }
      });
    });
  }

  async shutdown() {
    if (!this.child.killed) {
      this.write({ type: "exit" });
      setTimeout(() => {
        if (!this.child.killed) this.child.kill("SIGTERM");
      }, 1000).unref();
    }
    await this.closed;
  }

  private handleLine(line: string) {
    const event = parseJson(line);
    if (!event || typeof event !== "object") return;
    const record = event as JsonRecord;
    if (record.type === "system" && record.subtype === "ready") {
      this.readyResolve?.();
      return;
    }
    if (record.type === "system" && record.subtype === "error") {
      const error = new Error(String(record.message || "Claude SDK runner error"));
      this.readyReject?.(error);
      this.pending?.reject(error);
      this.pending = null;
      return;
    }
    if (!this.pending) return;
    this.pending.events.push(record);
    this.pending.onEvent?.(record);
    if (record.type !== "result") return;
    clearTimeout(this.pending.timer);
    const pending = this.pending;
    this.pending = null;
    pending.resolve({ events: pending.events, stderr: this.stderr });
  }

  private write(value: JsonRecord) {
    this.child.stdin.write(`${JSON.stringify(value)}\n`);
  }
}
