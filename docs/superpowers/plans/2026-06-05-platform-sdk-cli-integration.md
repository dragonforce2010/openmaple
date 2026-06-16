# Plan: Platform SDK/CLI Integration

## Objective

把代码集成路径从 Anthropic SDK / `ANTHROPIC_API_KEY` 口径切到平台自有入口：

- Console 示例默认使用 `LMAP_API_KEY` / `LMAP_API_BASE_URL`。
- TypeScript 示例使用 `ManagedAgentsClient`。
- Python 示例使用平台 HTTP API，而不是 `anthropic` 包。
- `magcli` 支持 workspace API key 登录。
- onboarding 生成的 `lmap_ws_...` workspace API key 能访问控制面和数据面。

## Assumptions

- Anthropic-compatible API 继续作为兼容层保留，但不作为产品推荐接入方式。
- 本轮不新增 npm 依赖。
- 不跑真实 E2B 付费测试；合同测试使用 fake veFaaS runtime 和临时数据目录。

## Files

- `server/auth.ts`
- `server/store.ts`
- `server/artifacts.ts`
- `sdk/index.mjs`
- `sdk/index.d.ts`
- `scripts/magcli.mjs`
- `scripts/platform_sdk_cli_contract.ts`
- `src/App.tsx`
- `README.md`
- `docs/design/2026-06-05-current-architecture.md`
- `docs/product-manual/magcli-sdk-onboarding.md`

## Commands

- `bun run test:platform-sdk-cli`
- `bun run typecheck`
- `bun run build`

## Acceptance

- `lmap_ws_...` workspace key can authenticate `/v1` routes without cookie login.
- SDK can onboard a workspace, create environment/agent/session, send a message, and read events without `ANTHROPIC_API_KEY`.
- `magcli config login --api-key <lmap_ws_...>` works and `magcli status --json` can call the platform.
- Console code samples no longer mention `ANTHROPIC_API_KEY` or `from anthropic import Anthropic`.
- Docs describe platform SDK/CLI as the primary path and compatibility as secondary.
