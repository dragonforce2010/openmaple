import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { consolePathForState, consoleRouteFromLocation, currentConsoleReturnPath, currentCredentialDetailReturnPath, currentQuickstartReturnPath } from "../../apps/admin-web/src/appConfig";
import type { Workspace } from "../../apps/admin-web/src/types";

const workspace = {
  id: "ws_1",
  tenant_id: "tenant_1",
  name: "Platform",
  description: "",
  status: "active",
  runtime_provider: "vefaas",
  sandbox_provider: "e2b",
  config: { tenant_slug: "acme", slug: "platform" },
  created_at: "",
  updated_at: ""
} satisfies Workspace;

const path = consolePathForState({
  workspace,
  view: "sessions",
  routeId: "",
  routeEdit: false,
  selectedSession: "sess_1",
  selectedEventId: "evt_1",
  eventMode: "debug",
  modal: "credential",
  modalVaultId: "vault_1",
  sessionAgentLock: "",
  askMapleOpen: true,
  settingsOpen: false,
  metric: "agents",
  drawers: [{ kind: "agent", id: "agent_1" }, { kind: "session", id: "sess_1" }]
});
const url = new URL(path, "https://maple.local");
assert.equal(url.pathname, "/t/acme/w/platform/sessions/sess_1");
assert.equal(url.searchParams.get("event"), "evt_1");
assert.equal(url.searchParams.get("mode"), "debug");
assert.equal(url.searchParams.get("modal"), "credential");
assert.equal(url.searchParams.get("modal_vault"), "vault_1");
assert.equal(url.searchParams.get("drawer"), "agent:agent_1,session:sess_1");

const parsed = consoleRouteFromLocation({ pathname: url.pathname, search: url.search });
assert.equal(parsed.hasConsoleAnchor, true);
assert.equal(parsed.view, "sessions");
assert.equal(parsed.selectedSession, "sess_1");
assert.equal(parsed.selectedEventId, "evt_1");
assert.equal(parsed.eventMode, "debug");
assert.equal(parsed.modal, "credential");
assert.equal(parsed.modalVaultId, "vault_1");
assert.deepEqual(parsed.drawers, [{ kind: "agent", id: "agent_1" }, { kind: "session", id: "sess_1" }]);

const credentialPath = consolePathForState({
  workspace,
  view: "credential",
  routeId: "vault_1/vcred_secret_1",
  routeEdit: false,
  selectedSession: "",
  selectedEventId: "",
  eventMode: "transcript",
  modal: null,
  modalVaultId: "",
  sessionAgentLock: "",
  askMapleOpen: false,
  settingsOpen: false,
  metric: null,
  drawers: []
});
assert.equal(credentialPath, "/t/acme/w/platform/vault/vault_1/credentials/vcred_secret_1");
const parsedCredential = consoleRouteFromLocation({ pathname: credentialPath, search: "" });
assert.equal(parsedCredential.view, "credential");
assert.equal(parsedCredential.routeId, "vault_1/vcred_secret_1");

(globalThis as unknown as { window: { location: { href: string; pathname: string; search: string; hash: string } } }).window = {
  location: {
    href: "https://maple.local/t/acme/w/platform/vault/vault_1?modal=credential&modal_vault=vault_1&credential_connected=github&vault=vault_1",
    pathname: "/t/acme/w/platform/vault/vault_1",
    search: "?modal=credential&modal_vault=vault_1&credential_connected=github&vault=vault_1",
    hash: ""
  }
};
assert.equal(currentConsoleReturnPath(), "/t/acme/w/platform/vault/vault_1?modal=credential&modal_vault=vault_1");
assert.equal(currentCredentialDetailReturnPath("vault_1", "vcred_secret_1"), "/t/acme/w/platform/vault/vault_1/credentials/vcred_secret_1");
assert.equal(currentQuickstartReturnPath(), "/t/acme/w/platform/quickstart?quickstart_restore=1");

const auth = readFileSync("apps/control-plane-api/src/auth/auth.ts", "utf8");
const returnPath = readFileSync("apps/control-plane-api/src/auth/returnPath.ts", "utf8");
const publicRoutes = readFileSync("apps/control-plane-api/src/routes/publicRoutes.ts", "utf8");
const mcpRoutes = readFileSync("apps/control-plane-api/src/routes/mcpRoutes.ts", "utf8");
const appFrame = readFileSync("apps/admin-web/src/AppFrame.tsx", "utf8");
const ui = readFileSync("apps/admin-web/src/ui.tsx", "utf8");

assert.match(returnPath, /export function safeWebReturnPath/, "auth must sanitize OAuth return_to");
assert.match(auth, /returnTo\?: string/, "login OAuth state cookie must store returnTo");
assert.match(publicRoutes, /return_to/, "login OAuth start must read return_to");
assert.match(mcpRoutes, /return_to/, "MCP OAuth start must read return_to");
assert.match(mcpRoutes, /mcpRedirect\(session\.returnTo/, "MCP OAuth callback must redirect to stored returnTo");
assert.equal(mcpRoutes.includes("MAPLE_WEB_BASE_URL ||"), false, "MCP OAuth callback must not hardcode root web redirect");
assert.match(appFrame, /<ConsoleRouteSync \{\.\.\.props\} \/>/, "AppFrame must mount console route sync");
assert.match(ui, /replace: \(entries: DrawerEntry\[\]\) => void/, "Drawer stack must expose replace for URL restore");

console.log("console route anchor contract passed");
