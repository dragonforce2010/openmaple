# Agent integration streaming SDK

## Goal

- Agent Integration code should be paste-ready: hardcode production `baseURL`, current `workspace_id`, agent id, selected environment id, and show the agent model id directly.
- Sample code must create a session, attach to SSE, send the first message, and stream output without polling `listSessionEvents`.
- SDK should expose a smooth helper for this flow and publish a new npm version.

## Files

- `packages/sdk/index.mjs`
- `packages/sdk/index.d.ts`
- `packages/sdk/README.md`
- `packages/sdk/package.json`
- `apps/admin-web/src/components/shared/code.tsx`
- `apps/admin-web/src/pages/agents/AgentPanels.tsx`
- `apps/admin-web/src/pages/agents/AgentDetailView.tsx`
- `apps/admin-web/src/pages/quickstart/QuickstartParts.tsx`
- `apps/admin-web/src/pages/docs/documentationSdkContent.tsx`
- `tests/contracts/maple_docs_contract.ts`
- `tests/contracts/npm_sdk_package_contract.ts`

## Verification

- `bun run test:maple-docs`
- `bun run test:npm-sdk`
- `bun run typecheck`
- `bun run lint`
- Browser smoke on `http://127.0.0.1:5173`, screenshot Agent Integration.
- `npm publish --registry https://registry.npmjs.org/` from `packages/sdk`.

## Tasks

- [x] Add SDK helper that opens SSE before posting `user.message`.
- [x] Generate integration snippets with concrete base/workspace/environment/model ids.
- [x] Update SDK docs and contracts.
- [x] Run verification and publish npm package.
  - VDB MySQL allowlists were added for the local NAT egress via MCP and `test:npm-sdk` passed.
  - Fixed `sessionUsesVefaasAgentRuntime()` to evaluate environments after workspace runtime credential injection, matching `ensureSessionRuntime()` and avoiding a false fallback to `local_docker`.
  - `maple-agent-sdk@0.1.1` published first, then `maple-agent-sdk@0.1.2` published with `baseURL` alias support after post-publish smoke exposed the missing alias.
  - Published `maple-agent-sdk@0.1.2` install smoke passed with create session -> SSE ready -> post `user.message` -> streamed `agent.message_delta` -> final `agent.message`.
