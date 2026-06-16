import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeProviderAgentDraft } from "../../apps/control-plane-api/src/agents/agentBuilder";
import { presetToTarget, promptNeedsMultimodalModel, selectModelForPrompt } from "../../apps/control-plane-api/src/modelGateway";

const validDraft = normalizeProviderAgentDraft(
  JSON.stringify({
    name: "Core Tool Agent",
    description: "Tests full provider draft normalization.",
    model: { provider: "custom", id: "glm-4-7-251222", speed: "standard" },
    agent_loop: { type: "anthropic_claude_code", config: {}, hooks: [] },
    system: "Use all configured core tools and report failures.",
    tools: [{ type: "agent_toolset", configs: { read: true, grep: true, bash: true, edit: true } }],
    mcp_servers: [],
    skills: []
  }),
  "创建一个空白 Agent，仅含核心工具集。"
);
assert.equal((validDraft.tools[0].configs as Record<string, unknown>).write, true);
assert.equal((validDraft.tools[0].configs as Record<string, unknown>).edit, true);
assert.equal(validDraft.agent_loop.config?.execution, "provider");

const githubDraft = normalizeProviderAgentDraft(
  JSON.stringify({
    name: "GitHub MCP Agent",
    description: "Uses GitHub MCP.",
    model: { provider: "custom", id: "glm-4-7-251222", speed: "standard" },
    agent_loop: { type: "anthropic_claude_code", config: {}, hooks: [] },
    system: "Use GitHub MCP for repository queries.",
    tools: [],
    mcp_servers: [{ name: "github", provider: "github", url: "https://api.githubcopilot.com/mcp/", type: "url" }],
    skills: []
  }),
  "创建一个能查看我 GitHub 仓库的助手。"
);
assert.equal(githubDraft.agent_loop.config?.execution, "external");

assert.equal(promptNeedsMultimodalModel("创建一个能分析用户上传图片和视频的 Agent"), true);
assert.equal(promptNeedsMultimodalModel("Analyze product screenshots and short videos"), true);
assert.equal(promptNeedsMultimodalModel("Create a Docker image build assistant"), false);

const multimodalPreset = presetToTarget("volcoengine-doubao-seed-2-0-lite-260428");
assert.equal(multimodalPreset.modelName, "doubao-seed-2-0-lite-260428");

const multimodalSelection = selectModelForPrompt({ userId: "agent_builder_contract", prompt: "创建一个能理解图片、截图和视频内容的 Agent" });
assert.match(multimodalSelection.model, /doubao-seed-2-0-(lite|pro|mini)-/);

assert.throws(
  () => normalizeProviderAgentDraft(JSON.stringify({ name: "Broken" }), "broken"),
  /Provider draft field model must be an object/
);

// Fail fast: a draft missing any array field (mcp_servers/skills/tools) is a real provider
// problem and must throw, not be silently patched to []. A blank agent still emits explicit
// empty arrays — omission means the generation broke.
assert.throws(
  () => normalizeProviderAgentDraft(
    JSON.stringify({
      name: "No Optional",
      description: "Omits mcp_servers and skills.",
      model: { provider: "custom", id: "glm-4-7-251222", speed: "standard" },
      agent_loop: { type: "anthropic_claude_code", config: {}, hooks: [] },
      system: "Use core tools.",
      tools: [{ type: "bash" }]
    }),
    "创建一个空白 Agent，仅含核心工具集。"
  ),
  /Provider draft field mcp_servers must be an array/
);

const builderSource = readFileSync("apps/control-plane-api/src/agents/builderAgent.ts", "utf8");
const draftSource = readFileSync("apps/control-plane-api/src/agents/agentBuilder.ts", "utf8");
for (const forbidden of ["schema-fallback", "provider_fallback", "runLegacyBuilderFallback", "fallback_ready"]) {
  assert.equal(`${builderSource}\n${draftSource}`.includes(forbidden), false, `${forbidden} must not hide builder failures`);
}

// Perf regression locks for the Quickstart builder turn (see
// docs/superpowers/plans/2026-06-14-quickstart-builder-perf.md):
// the gateway aborted the request because the route awaited a multi-step LLM loop
// synchronously and the per-call provider had no timeout. Keep both root-cause fixes.
const quickstartRouteSource = readFileSync("apps/control-plane-api/src/routes/quickstartRoutes.ts", "utf8");
assert.match(quickstartRouteSource, /enqueueSessionTurn\(\s*sessionId/, "quickstart /message must run the builder turn on the background queue, not block the response");
assert.equal(/await\s+runQuickstartBuilderTurn/.test(quickstartRouteSource), false, "quickstart /message must not synchronously await the builder turn");
assert.match(quickstartRouteSource, /WorkspaceRuntimePoolUnavailableError/, "quickstart builder session must catch runtime pool unavailable errors");
assert.match(quickstartRouteSource, /workspace_runtime_pool_unavailable/, "quickstart builder session must return a JSON runtime-pool error");
assert.match(builderSource, /timeoutMs:\s*builderProviderTimeoutMs/, "builder turn must pass a provider timeout so a stuck LLM call cannot hang the turn");
assert.match(builderSource, /emitBuilderStatus/, "builder turn must emit user-visible progress status events");
assert.match(builderSource, /quickstart_builder\.local_draft/, "builder provider timeout must surface a local draft card instead of a failed wizard");
assert.match(draftSource, /isProviderTimeout/, "agent draft generation must distinguish provider timeout from invalid provider failures");
assert.match(draftSource, /buildLocalAgentDraft/, "builder local draft generation must stay explicit");

// The Quickstart progress card must reflect real events, not a wall clock.
const quickstartViewSource = readFileSync("apps/admin-web/src/pages/quickstart/QuickstartView.tsx", "utf8");
assert.equal(/Date\.now\(\)\s*-\s*startedAt/.test(quickstartViewSource), false, "QuickstartView must not drive builder progress from a wall-clock timer");

console.log("agent builder contract passed");
