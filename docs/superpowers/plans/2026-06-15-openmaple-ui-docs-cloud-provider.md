# OpenMaple UI, docs, and cloud provider runway

## Scope

This change renames the public product surface to **OpenMaple**, fixes the UI defects captured in the six screenshots, expands CLI/skills documentation, adds a mascot asset, and creates a reviewable runway for tenant-level cloud provider identity.

Multi-cloud runtime/sandbox/storage failover is larger than one reviewable change. This slice keeps the running product stable while documenting and typing the provider model so the next stack can move runtime, sandbox, and object storage adapters behind tenant-scoped provider identities.

## Files

- `apps/admin-web/src/App.tsx`
- `apps/admin-web/src/AppFrame.tsx`
- `apps/admin-web/src/app/useBootstrapController.ts`
- `apps/admin-web/src/components/shared/layout.tsx`
- `apps/admin-web/src/pages/agents/VaultDetailView.tsx`
- `apps/admin-web/src/pages/admin/ModelGatewayView.tsx`
- `apps/admin-web/src/pages/docs/*`
- `apps/admin-web/src/pages/sessions/VaultsView.tsx`
- `apps/admin-web/src/pages/workspaces/TenantKeysPanel.tsx`
- `apps/admin-web/src/pages/workspaces/WorkspaceApiKeysView.tsx`
- `apps/admin-web/src/styles/part-*.css`
- `docs/architecture/openmaple-cloud-provider-abstraction.md`
- `README.md`
- `tests/contracts/*`

## Expected behavior

- API key status pills stay on one line in tenant/workspace key tables.
- List pages show an explicit loading state during bootstrap/workspace refresh.
- Vault credential rows open a second-level drawer with credential detail.
- Model rows open endpoint detail, while the action menu stays anchored in the actions column and does not cover the default column.
- Documentation includes Maple CLI and skill usage, with skills split by module.
- Public docs/readme use OpenMaple naming and bilingual structure inspired by `larksuite/cli`.
- Cloud provider identity gets a documented type/config model for Volcengine, Alibaba Cloud, AWS, and GCP, without breaking existing `provider_credentials` workspace config.

## Verification

- `bun run typecheck`
- `bun run lint`
- `bun tests/contracts/maple_docs_contract.ts`
- `bun tests/contracts/maple_ui_interaction_contract.ts`
- `bun tests/contracts/maple_branding_contract.ts`
- `bun run build`
- Browser smoke with screenshots for affected pages.
- Full `bun run test:all` only after focused checks pass; if cloud/runtime external dependencies block, record the exact failing step.

## Tasks

- [ ] Add shared table/list loading UI and wire it through main list pages.
- [ ] Fix key-table status wrapping.
- [ ] Add credential second-level drawer from `VaultDetailView`.
- [ ] Add model endpoint detail interaction and menu layout fix.
- [ ] Expand docs with CLI and skills pages.
- [ ] Update README to bilingual OpenMaple style.
- [ ] Add cloud provider abstraction doc.
- [ ] Add mascot asset and reference it where appropriate.
- [ ] Add/extend contract tests.
- [ ] Run verification, screenshot, commit, deploy.
