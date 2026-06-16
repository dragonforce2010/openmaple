# Plan: Go Maple CLI

## Goal

Rewrite Maple CLI in Go while keeping existing `bun packages/cli/maple.mjs`
compatibility. Follow the useful parts of `larksuite/cli`: thin `main.go`,
`cmd/` command layer, `internal/*` packages, JSON-first agent output, and
embedded skill content readable through the CLI.

## Files

- `packages/cli/go.mod`
- `packages/cli/main.go`
- `packages/cli/cmd/*.go`
- `packages/cli/internal/client/*.go`
- `packages/cli/internal/config/*.go`
- `packages/cli/internal/project/*.go`
- `packages/cli/internal/skills/*.go`
- `packages/cli/internal/output/*.go`
- `packages/cli/skills/maple-managed-agent/SKILL.md`
- `packages/cli/maple.mjs`
- `packages/cli/package.json`
- `package.json`
- `tests/contracts/platform_sdk_cli_contract.ts`
- `tests/contracts/maple_branding_contract.ts`

## Tasks

- [ ] Add Go module and command skeleton.
- [ ] Implement config login/set/get/whoami/version.
- [ ] Implement project init/build/deploy/invoke/status.
- [ ] Implement skill list/init/push/deploy-run.
- [ ] Add embedded `skills list/read` for agents to inspect Maple usage.
- [ ] Keep `maple.mjs` as a wrapper that builds/caches/runs the Go binary.
- [ ] Update contracts to call the wrapper and isolate `MAPLE_SKILLS_ROOT`.
- [ ] Expose Maple OpenAPI through `api` plus resource commands for agents,
  environments, sessions, vaults, workspaces, models, MCP, memory stores,
  templates, files, artifacts, quickstart, runtime, and deployments.

## Commands

- `cd packages/cli && go test ./...`
- `bun run test:maple-branding`
- `bun run test:platform-sdk-cli`
- `bun run typecheck`

## Expected Results

- `bun packages/cli/maple.mjs version --json` returns Maple CLI JSON.
- Existing platform SDK/CLI contract passes through the Go CLI wrapper.
- Skill contract uses a temporary `MAPLE_SKILLS_ROOT`, avoiding real
  `~/.agents/skills` pollution and recursive cleanup.
- New `maple skills list/read` exposes agent-facing Maple CLI guidance.
