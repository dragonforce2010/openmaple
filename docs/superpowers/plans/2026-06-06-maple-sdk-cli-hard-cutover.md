# Maple SDK/CLI Hard Cutover Plan

## Objective
把平台对外 SDK 和 CLI 完整切换到 Maple 命名，移除 `ManagedAgentsClient`、`magcli`、`MAGCLI_*` 等旧产品入口，让用户只看到 Maple SDK、Maple CLI、`LMAP_*` 环境变量和 Maple manifest/build 产物。

## Scope
- SDK 只导出 `MapleClient` 和 `defineHarness`。
- CLI 入口文件切换为 `scripts/maple.mjs`，package bin/script 只保留 `maple`。
- CLI 生成 `maple.manifest.json` 和 `.maple/build/bundle.json`。
- 当前 README、SPEC、产品手册、架构文档、E2E 合同引用切到 Maple。
- 研究历史文档保留外部平台名称和历史语境，不作为本次产品入口扫描范围。

## TDD Contract
- `bun run test:maple-branding` 先失败，证明旧 SDK/CLI alias 和旧 manifest/build 产物仍会被捕获。
- 实现后该合同必须通过，并额外跑 `bun run test:platform-sdk-cli` 验证真实本地 API + SDK + CLI 链路。

## Tasks
- [x] Tighten branding contract.
  - Files: `scripts/maple_branding_contract.ts`
  - Verify: `bun run test:maple-branding` fails before implementation.
- [x] Rename and update SDK/CLI implementation.
  - Files: `scripts/maple.mjs`, `sdk/index.mjs`, `sdk/index.d.ts`, `package.json`
  - Verify: `bun run test:maple-branding`
- [x] Update CLI integration tests and current docs.
  - Files: `scripts/platform_sdk_cli_contract.ts`, `scripts/e2e.mjs`, `README.md`, `SPEC.md`, `docs/product-manual/*`, `docs/design/*`
  - Verify: `bun run test:platform-sdk-cli`
- [x] Run local verification.
  - Commands: `bun run test:maple-branding`, `bun run test:platform-sdk-cli`, `bun run typecheck`, `bun run build`
  - Boundary: do not run real E2B or cloud-costing tests for this rename.
