# Credential Return And Builder UX

## Scope

- Add a vault-scoped credential detail URL and page.
- Split OAuth return behavior:
  - Vault flow returns to the new credential detail page.
  - Quickstart flow returns to Quickstart, restores Builder context, and dismisses the credential modal.
- Return JSON for Quickstart runtime-pool unavailable errors instead of raw Express HTML.
- Dismiss workspace picker when clicking outside or pressing Escape.
- Emit more Builder Agent status/reasoning events and show frontend progress hints while waiting.

## Files

- `apps/admin-web/src/config/consoleRoutes.ts`
- `apps/admin-web/src/app/ConsoleRouteSync.tsx`
- `apps/admin-web/src/AppFrame.tsx`
- `apps/admin-web/src/config/appTypes.ts`
- `apps/admin-web/src/config/navigation.ts`
- `apps/admin-web/src/pages/agents/VaultDetailView.tsx`
- `apps/admin-web/src/pages/agents/CredentialDetailView.tsx`
- `apps/admin-web/src/pages/modals/CredentialModal.tsx`
- `apps/admin-web/src/pages/quickstart/QuickstartParts.tsx`
- `apps/admin-web/src/pages/quickstart/QuickstartView.tsx`
- `apps/admin-web/src/shell/WorkspacePicker.tsx`
- `apps/admin-web/src/api.ts`
- `apps/control-plane-api/src/routes/quickstartRoutes.ts`
- `apps/control-plane-api/src/routes/vaultRoutes.ts`
- `apps/control-plane-api/src/agents/builderAgent.ts`
- focused contract tests under `tests/contracts/`

## Verification

- `bun run typecheck`
- `bun run lint`
- `bun tests/contracts/console_route_anchor_contract.ts`
- `bun tests/contracts/auth_tenant_flow_contract.ts`
- `bun tests/contracts/ui_overlay_contract.ts`
- `bun tests/contracts/agent_builder_contract.ts`
- `bun tests/contracts/vault_mcp_credentials_contract.ts`
- `bun run build`
- Browser smoke screenshot for visible frontend changes.

## Tasks

- [x] Add credential route parsing/building and page render.
- [x] Add credential detail API.
- [x] Make CredentialModal return path caller-driven.
- [x] Persist and restore Quickstart OAuth context without reopening modal.
- [x] Fix Quickstart runtime pool unavailable error response.
- [x] Add workspace picker outside click/Escape close.
- [x] Add Builder Agent status events and frontend hint fallback.
- [ ] Verify and deploy/commit if clean.
