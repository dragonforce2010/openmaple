# Maple Directory P0/P1/P2 Plan

## Goal

Normalize the Maple monorepo layout without changing product behavior, deploy the result to veFaaS, and pass the core local/cloud E2E path.

## Scope

- P0: clarify repository boundaries, keep source docs tracked, move root artifacts out of the root directory, and stop adding new generated output under source-facing paths.
- P1: split operational scripts into `infra/`, `tests/`, and `migrations/`, then update package scripts and deployment references.
- P2: reduce app-level giant files by introducing route/service/view grouping and moving reusable runtime/UI contracts into packages where the current code already has package boundaries.

## Files And Directories

- `.gitignore`
- `package.json`
- `tsconfig.json`
- `scripts/*`
- `infra/vefaas/**`
- `tests/contracts/**`
- `tests/e2e/**`
- `tests/smoke/**`
- `migrations/**`
- `apps/admin-web/src/**`
- `apps/control-plane-api/src/**`
- `packages/**`

## Commands

- `rtk bun run typecheck`
- `rtk bun run test:platform-sdk-cli`
- `rtk bun run test:vefaas-provisioner`
- `rtk bun run test:e2e`
- `rtk bun run test:all`
- `rtk python3 infra/vefaas/deploy_vefaas_stable.py deploy`
- Cloud E2E with `E2E_API_BASE` and `E2E_WEB_BASE` pointed at the stable gateway URL.

## Tasks

- [x] Create isolated worktree and branch.
- [x] Move root artifacts into `artifacts/` or `docs/architecture/`.
- [x] Split `scripts/` into `infra/`, `tests/`, and `migrations/`.
- [x] Update package scripts and runtime/deploy path references.
- [x] Add route/service/view grouping without changing public API behavior.
- [x] Run local verification.
- [x] Deploy to cloud.
- [x] Run cloud E2E and provide the URL for manual validation.
