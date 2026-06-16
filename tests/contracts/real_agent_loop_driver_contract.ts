import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runExternalAgentLoop, shouldUseExternalAgentLoop, shutdownExternalAgentLoop } from "../../apps/control-plane-api/src/agentLoopDrivers";
import type { AgentConfig } from "../../apps/control-plane-api/src/types";

const temp = mkdtempSync(join(tmpdir(), "maple-real-agent-loop-"));
const workspace = join(temp, "workspace");
mkdirSync(workspace, { recursive: true });

const fakeClaudeTrace = join(temp, "fake-claude-trace.txt");
const fakeClaude = join(temp, "fake-claude-runner.mjs");
writeFileSync(
  fakeClaude,
  [
    `#!${process.execPath}`,
    "import readline from 'node:readline';",
    "import { appendFileSync } from 'node:fs';",
    "const trace = process.env.FAKE_CLAUDE_TRACE;",
    "const rl = readline.createInterface({ input: process.stdin });",
    "for await (const line of rl) {",
    "  if (!line.trim()) continue;",
    "  const msg = JSON.parse(line);",
    "  if (msg.type === 'init') {",
    "    appendFileSync(trace, `init:${msg.payload.cwd}\\n`);",
    "    appendFileSync(trace, `auth:${msg.payload.env?.ANTHROPIC_AUTH_TOKEN || ''}\\n`);",
    "    console.log(JSON.stringify({ type: 'system', subtype: 'ready' }));",
    "  }",
    "  if (msg.type === 'query') {",
    "    const content = msg.payload?.message?.content || '';",
    "    appendFileSync(trace, `query:${content}\\n`);",
    "    console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: `stream ${content.includes('Review the repo')}` }] } }));",
    "    console.log(JSON.stringify({ type: 'result', result: `fake claude final: ${content.includes('Review the repo')}`, usage: { total_tokens: 3 } }));",
    "  }",
    "  if (msg.type === 'exit') process.exit(0);",
    "}"
  ].join("\n")
);
chmodSync(fakeClaude, 0o755);

const fakeCodex = join(temp, "fake-codex.mjs");
writeFileSync(
  fakeCodex,
  [
    `#!${process.execPath}`,
    "import { writeFileSync } from 'node:fs';",
    "const args = process.argv.slice(2);",
    "if (args[0] === 'exec' && args.includes('--help')) {",
    "  console.log('Run Codex non-interactively');",
    "  process.exit(0);",
    "}",
    "const outputPath = args[args.indexOf('--output-last-message') + 1];",
    "const prompt = args[args.length - 1] || '';",
    "writeFileSync(outputPath, `fake codex final: ${prompt.includes('Review the repo')}`);",
    "console.error(`fake-codex cwd=${process.cwd()}`);",
    "console.log('codex progress line');"
  ].join("\n")
);
chmodSync(fakeCodex, 0o755);

process.env.MAPLE_CLAUDE_AGENT_SDK_RUNNER_COMMAND = fakeClaude;
process.env.FAKE_CLAUDE_TRACE = fakeClaudeTrace;
process.env.MAPLE_CODEX_COMMAND = fakeCodex;
process.env.MAPLE_AGENT_LOOP_EXECUTION = "external";
delete process.env.ANTHROPIC_AUTH_TOKEN;
process.env.ARK_API_KEY = "contract-ark-key";

const baseAgent: AgentConfig = {
  name: "Real Loop Contract Agent",
  description: "Contract agent",
  model: { provider: "openai", id: "test-model" },
  system: "Use the real CLI loop.",
  tools: [],
  mcp_servers: [],
  skills: [],
  agent_loop: { type: "anthropic_claude_code", config: {}, hooks: [] }
};

assert.equal(shouldUseExternalAgentLoop(baseAgent), true);
assert.equal(shouldUseExternalAgentLoop({ ...baseAgent, agent_loop: { type: "anthropic_claude_code", config: { execution: "provider" }, hooks: [] } }), false);
assert.equal(shouldUseExternalAgentLoop({
  ...baseAgent,
  mcp_servers: [{ name: "github", provider: "github", url: "https://api.githubcopilot.com/mcp/", type: "url" }],
  agent_loop: { type: "anthropic_claude_code", config: { execution: "provider" }, hooks: [] }
}), true);

const claudeResult = await runExternalAgentLoop({
  sessionId: "sess_real_loop_contract_claude",
  agent: baseAgent,
  userText: "Review the repo with Claude Code.",
  workspacePath: workspace
});
assert.equal(claudeResult.driver, "claude_code");
assert.match(claudeResult.message, /fake claude final: true/);
assert.equal(claudeResult.events?.some((event) => event.type === "assistant"), true);

const secondClaudeResult = await runExternalAgentLoop({
  sessionId: "sess_real_loop_contract_claude",
  agent: baseAgent,
  userText: "Second turn.",
  workspacePath: workspace
});
assert.match(secondClaudeResult.message, /fake claude final: false/);
await shutdownExternalAgentLoop("sess_real_loop_contract_claude");
const trace = readFileSync(fakeClaudeTrace, "utf8").trim().split("\n");
assert.equal(trace.filter((line) => line.startsWith("init:")).length, 1);
assert.equal(trace.filter((line) => line === "auth:contract-ark-key").length, 1);
assert.equal(trace.filter((line) => line.startsWith("query:")).length, 2);

const codexResult = await runExternalAgentLoop({
  sessionId: "sess_real_loop_contract_codex",
  agent: { ...baseAgent, agent_loop: { type: "codex_open_source", config: {}, hooks: [] } },
  userText: "Review the repo with Codex.",
  workspacePath: workspace
});
assert.equal(codexResult.driver, "codex_cli");
assert.match(codexResult.message, /fake codex final: true/);
assert.match(codexResult.stderr, /fake-codex cwd=/);

console.log("real agent loop driver contract passed");
