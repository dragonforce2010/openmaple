# Vault detail drawer interaction

## Scope

Change Credential vaults list interaction so clicking a vault row opens the existing project side-drawer detail pattern instead of navigating to the full detail page. The detail drawer must support adding a credential and show credential archive/delete actions as direct row buttons, not a hidden `...` menu. Remove the `Optional` badge next to the credential `Name` field.

## Files

- `apps/admin-web/src/config/appTypes.ts`
- `apps/admin-web/src/config/navigation.ts`
- `apps/admin-web/src/App.tsx`
- `apps/admin-web/src/AppFrame.tsx`
- `apps/admin-web/src/pages/sessions/VaultsView.tsx`
- `apps/admin-web/src/pages/agents/VaultDetailView.tsx`
- `apps/admin-web/src/pages/modals/CredentialModal.tsx`
- `apps/admin-web/src/styles/part-2.css`

## Tasks

- [x] Add a `vault` detail view route.
- [x] Make vault list rows call `openEntity("vault", vault.id)` for side-drawer detail.
- [x] Keep drawer stack overflow fallback on the specific vault detail route.
- [x] Move credential archive/delete controls into `VaultDetailView`.
- [x] Render archive/delete as direct credential row buttons.
- [x] Let the vault drawer detail content use full drawer width so the credential table does not leave a large blank area on the right.
- [x] Refresh vault detail after credential count or row mutations change.
- [x] Remove the Name field `Optional` badge.

## Verification

- [x] `PATH=/Users/bytedance/.bun/bin:$PATH /Users/bytedance/.bun/bin/bun run typecheck`
- [x] `/Users/bytedance/.bun/bin/bun run lint`
- [x] Run local web app and verify vault list row opens detail drawer.
- [x] Verify detail drawer shows direct archive/delete buttons.
- [x] Verify detail drawer Add credential opens the credential modal.
- [x] Capture final screenshot proof: `docs/superpowers/screenshots/2026-06-15-vault-detail-drawer-actions.png` and `docs/superpowers/screenshots/2026-06-15-vault-detail-drawer-actions-cloud.png`.
- [x] Deploy stable and verify cloud: frontend revision 79, backend revision 80, `/health` 200.
- [x] Verify wide drawer layout at 2048px viewport: `docs/superpowers/screenshots/2026-06-15-vault-detail-drawer-wide-layout-local.png`.
- [x] Deploy stable layout fix and verify cloud: frontend revision 80, backend revision 81, `/health` 200.
