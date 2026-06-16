# Real Agent Loop Drivers

## Objective

Make `anthropic_claude_code` and `codex_open_source` execute real external agent loops by default instead of the platform's provider/tool-call simulation. `anthropic_claude_code` should follow Mira's shape: a Claude Agent SDK runner owns the Claude CLI subprocess and speaks NDJSON `init/query/interrupt/exit`; `codex_open_source` stays on `codex exec`.

## Commands

- Dev: `bun run dev`
- Typecheck: `bun run typecheck`
- Contract: `bun scripts/real_agent_loop_driver_contract.ts`
- veFaaS contract: `bun scripts/vefaas_runtime_contract.ts`

## Project Structure

- `server/agentLoopDrivers.ts`: external loop driver selection and execution; Claude uses a session-scoped NDJSON runner.
- `server/runner.ts`: use external drivers before legacy provider loop.
- `scripts/vefaas_runtime_app/app.py`: execute loop-specific command inside veFaaS runtime.
- `scripts/vefaas_runtime_app/claude_agent_sdk_runner.py`: Claude Agent SDK NDJSON bridge.
- `scripts/*contract*`: deterministic fake command coverage.

## Code Style

Use explicit environment variable names and small driver helpers:

```ts
const command = String(loop.config?.command || process.env.LMAP_CLAUDE_CODE_COMMAND || "claude");
```

## Testing Strategy

- Contract tests use fake commands so CI does not require Claude/Codex auth.
- Runtime failures must report command, exit code, stderr/stdout snippet.
- The legacy provider loop is allowed only when `agent_loop.config.execution === "provider"` or `LMAP_AGENT_LOOP_EXECUTION=provider`.

## Boundaries

- Always: execute real CLI by default for built-in loop types.
- Ask first: adding npm dependencies or changing database schema.
- Never: silently fall back from real CLI to simulated provider loop.

## Tasks

- [x] Add external loop driver module.
- [x] Wire runner to execute real drivers and record lifecycle events.
- [x] Update veFaaS template to choose Claude/Codex command by loop type.
- [x] Add contract tests with fake CLI commands.
- [x] Run targeted verification.

## Success Criteria

- `anthropic_claude_code` invokes a Claude Agent SDK NDJSON runner by default and streams raw events into platform session events.
- `codex_open_source` invokes a `codex exec`-compatible command by default.
- Missing/wrong CLI fails loudly instead of using provider simulation.
- Tests prove the command receives prompt/context and emits the final agent message.
