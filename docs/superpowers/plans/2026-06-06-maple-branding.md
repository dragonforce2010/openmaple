# Maple Branding Plan

## Objective

Rebrand the self-developed Managed Agent Platform as Maple, short for Managed Agent Platform for Launch-ready Execution. Maple should feel productized and deployment-ready while keeping existing protocol-compatible internals stable.

## Scope

- Frontend console title, login copy, Ask drawer, and integration samples.
- SDK primary client export and CLI product surface.
- Package scripts and browser title.
- Product and architecture docs where the platform is described as the product.

## Compatibility Boundary

- Keep existing endpoint paths and persisted enum values such as `anthropic_claude_code` unless a migration is added later.
- Keep existing endpoint paths, persisted enum values, and compatible HTTP shapes stable; SDK and CLI product entrypoints hard-cut to Maple-only naming in the follow-up plan.
- Do not rewrite research or comparison docs where Anthropic is a referenced external platform.

## TDD Contract

- Add `scripts/maple_branding_contract.ts`.
- Red state: fail while app still exposes `Claude Console`, `Ask Claude`, Anthropic SDK sample copy, or missing Maple SDK/CLI product surfaces.
- Green state: pass after user-facing app, SDK, CLI, package metadata, and HTML title expose Maple as the primary product surface.

## Verification

- `bun run test:maple-branding`
- `bun run test:platform-sdk-cli`
- `bun run typecheck`
- `bun run build`
