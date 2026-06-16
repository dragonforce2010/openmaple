# Console URL anchors and OAuth return state

目标: 给 Maple console 每个 workspace 页面、详情页、overlay 一个稳定 URL, OAuth 回跳后按 URL 精准恢复,不再落到 dashboard 或错误 workspace。

## Context

- 现有 workspace URL 是 `/t/<tenant-slug>/w/<workspace-slug>`。
- `routeAfterAuth()` 命中 workspace 后会先落 `dashboard`。
- MCP credential OAuth callback 当前重定向到 `MAPLE_WEB_BASE_URL/?credential_connected=...`,只带 provider/vault,丢页面和 overlay 状态。
- `App.tsx` 和 `AppFrame.tsx` 接近 400 行上限,新增逻辑必须拆到新文件。

## Files

- `apps/admin-web/src/config/consoleRoutes.ts`
- `apps/admin-web/src/app/ConsoleRouteSync.tsx`
- `apps/admin-web/src/config/appTypes.ts`
- `apps/admin-web/src/config/tenantRoutes.ts`
- `apps/admin-web/src/AppFrame.tsx`
- `apps/admin-web/src/App.tsx`
- `apps/admin-web/src/ui.tsx`
- `apps/admin-web/src/shell/LoginView.tsx`
- `apps/admin-web/src/pages/modals/CredentialModal.tsx`
- `apps/admin-web/src/pages/modals/McpConnectModal.tsx`
- `apps/admin-web/src/app/useBootstrapController.ts`
- `apps/control-plane-api/src/auth/auth.ts`
- `apps/control-plane-api/src/routes/publicRoutes.ts`
- `apps/control-plane-api/src/routes/mcpRoutes.ts`
- `tests/contracts/console_route_anchor_contract.ts`

## URL shape

- Workspace base: `/t/<tenant>/w/<workspace>`
- Page: `/t/<tenant>/w/<workspace>/<page>`
- Detail: `/t/<tenant>/w/<workspace>/agent/<id>`, `/environment/<id>`, `/vault/<id>`, `/sessions/<id>`
- UI state: `?edit=1&modal=credential&modal_vault=<id>&drawer=agent:<id>,session:<id>&ask=1&settings=1&metric=agents&event=<id>&mode=debug`
- OAuth state: POST/GET start sends `return_to=<current relative console path>`.

## Tasks

- [ ] T1 Add parse/build helpers for console routes and safe current return path.
- [ ] T2 Add `ConsoleRouteSync` to restore initial URL and keep current URL in sync.
- [ ] T3 Add drawer route metadata + stack replace API for restoring stacked entity drawers.
- [ ] T4 Pass `return_to` from login OAuth, MCP connect, and credential OAuth start.
- [ ] T5 Store sanitized return path in auth/MCP OAuth state and redirect callback to it.
- [ ] T6 Stop credential callback toast handler from forcing vault detail when a URL anchor exists.
- [ ] T7 Add contract coverage for URL shape, return_to, callback redirect, and line caps.
- [ ] T8 Run `bun run typecheck`, `bun run lint`, focused contracts, and browser smoke screenshot.

## Expected verification

- Direct URL to agent/environment/vault/session detail restores correct workspace and page.
- URL with modal/drawer params restores overlay state.
- Credential GitHub OAuth callback returns to original URL plus success marker.
- `bun run typecheck` and `bun run lint` pass.
