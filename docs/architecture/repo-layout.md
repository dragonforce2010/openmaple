# Maple Repository Layout

## Top-Level Boundaries

- `apps/`: deployable user-facing applications.
- `agents/`: first-party Maple system agents and agent definitions.
- `services/`: independently deployable backend services that are not the control plane.
- `packages/`: reusable libraries, SDKs, CLIs, runtime adapters, sandbox adapters, and UI packages.
- `infra/`: cloud deployment code, runtime templates, Docker assets, and operational state.
- `tests/`: contract, smoke, and end-to-end test entrypoints.
- `migrations/`: one-off or repeatable data migration scripts.
- `docs/`: tracked product, architecture, design, research, and acceptance documentation.
- `examples/`: runnable examples for external users or integration checks.
- `artifacts/`: curated non-source assets that are useful to keep with the repository, such as reference screenshots and historical logs.
- `output/`: generated local deployment/test output. New files in this directory should remain ignored.

## Package Rules

- `apps/*` may depend on `packages/*`.
- `services/*` may depend on `packages/*`.
- `agents/*` may depend on `packages/*`.
- `packages/*` must not depend on `apps/*`, `services/*`, or `agents/*`.
- `infra/*`, `tests/*`, and `migrations/*` may depend on source modules when needed, but they must not be imported by runtime app code.

## Script Placement

- Deployment scripts live under `infra/`.
- Contract tests live under `tests/contracts/`.
- Full browser or cloud journeys live under `tests/e2e/`.
- Small smoke tests live under `tests/smoke/`.
- Database/data migrations live under `migrations/`.

## Generated Output

Generated deployment packages, local screenshots, and temporary E2E output should stay under ignored output directories. Stable cloud state files may be tracked only when they are required to safely update existing long-lived resources.
