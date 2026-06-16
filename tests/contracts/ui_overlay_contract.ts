import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync("apps/admin-web/src/App.tsx", "utf8");
const appFrame = readFileSync("apps/admin-web/src/AppFrame.tsx", "utf8");
const bootstrapController = readFileSync("apps/admin-web/src/app/useBootstrapController.ts", "utf8");
const settingsModal = readFileSync("apps/admin-web/src/shell/SettingsModal.tsx", "utf8");
const tenantView = readFileSync("apps/admin-web/src/pages/workspaces/TenantView.tsx", "utf8");
const workspaceSettingsDrawer = readFileSync("apps/admin-web/src/pages/workspaces/WorkspaceSettingsDrawer.tsx", "utf8");
const askMapleDrawer = readFileSync("apps/admin-web/src/pages/sessions/AskMapleDrawer.tsx", "utf8");
const metricDrawer = readFileSync("apps/admin-web/src/pages/agents/MetricDrawer.tsx", "utf8");
const workspacePicker = readFileSync("apps/admin-web/src/shell/WorkspacePicker.tsx", "utf8");
const sharedLayout = readFileSync("apps/admin-web/src/components/shared/layout.tsx", "utf8");
const ui = readFileSync("apps/admin-web/src/ui.tsx", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };
const appSurface = [app, appFrame, settingsModal, tenantView, workspaceSettingsDrawer, askMapleDrawer, metricDrawer, sharedLayout].join("\n");

function section(source: string, startMarker: string, endMarker: string, label: string) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${label} should contain ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `${label} should contain ${endMarker} after ${startMarker}`);
  return source.slice(start, end);
}

function assertOverlaySection(input: { label: string; block: string; layer: "DrawerLayer" | "ModalLayer"; onClose: string }) {
  assert.match(input.block, new RegExp(`<${input.layer}\\s+onClose=\\{${escapeRegExp(input.onClose)}\\}`), `${input.label} must use ${input.layer} with ${input.onClose}`);
  assert.equal(input.block.includes('className="scrim"'), false, `${input.label} must not hand-write .scrim`);
  assert.equal(input.block.includes('className="drawer-layer open"'), false, `${input.label} must not hand-write .drawer-layer`);
  assert.equal(input.block.includes('className="modal-layer open"'), false, `${input.label} must not hand-write .modal-layer`);
}

function sectionToEnd(source: string, startMarker: string, label: string) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${label} should contain ${startMarker}`);
  return source.slice(start);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const drawerStackProvider = section(ui, "export function DrawerStackProvider", "// Rendered INSIDE", "DrawerStackProvider");
assert.match(drawerStackProvider, /event\.key === "Escape"/, "Drawer stack must close on Escape");
assert.match(drawerStackProvider, /close\(\);/, "Drawer stack Escape handler must close the top drawer");

const drawerStackViewport = section(ui, "export function DrawerStackViewport", "/* ============================================================", "DrawerStackViewport");
assert.match(drawerStackViewport, /const scrimZIndex = 99 \+ \(stack\.length - 1\) \* 10;/, "Drawer stack scrim must sit below the active drawer and above covered drawers");
assert.match(drawerStackViewport, /<div className="dw-scrim" style=\{\{ zIndex: scrimZIndex \}\} onClick=\{close\} \/>/, "Drawer stack scrim must close only the top drawer");

const openEntity = section(app, "const openEntity = useCallback", "const entityNav = useMemo", "openEntity");
assert.match(openEntity, /if \(drawerStack\.depth >= 3\) \{\s+drawerStack\.closeAll\(\);/, "Fourth-level drawer navigation must close the drawer stack before routing");

const drawerLayer = section(ui, "export function DrawerLayer", "export function ModalLayer", "DrawerLayer");
assert.match(drawerLayer, /useEscClose\(onClose\);/, "DrawerLayer must install Escape close");
assert.match(drawerLayer, /<div className="scrim" onClick=\{onClose\} \/>/, "DrawerLayer scrim must close");

const modalLayer = section(ui, "export function ModalLayer", "\n}", "ModalLayer");
assert.match(modalLayer, /useEscClose\(onClose\);/, "ModalLayer must install Escape close");
assert.match(modalLayer, /<div className="scrim" onClick=\{onClose\} \/>/, "ModalLayer scrim must close");

assert.match(appFrame, /<DrawerStackViewport \/>/, "AppFrame must mount shared drawer stack viewport");
assert.match(appFrame, /switchingTenant, switchingWorkspace/, "AppFrame must receive tenant and workspace switching state");
assert.match(appFrame, /switchingTarget = switchingTenant[\s\S]+switchingWorkspace/, "AppFrame must normalize tenant/workspace switching into one global overlay target");
assert.match(appFrame, /正在切换工作区/, "Workspace switching overlay must have workspace-specific copy");
assert.match(bootstrapController, /const \[switchingWorkspace, setSwitchingWorkspace\] = useState<Workspace \| null>\(null\);/, "Bootstrap controller must track workspace switching state");
assert.match(bootstrapController, /function switchWorkspace\(workspaceId: string, workspace: Workspace \| null\)/, "Bootstrap controller must expose workspace switching action");
assert.match(bootstrapController, /\.finally\(\(\) => setSwitchingWorkspace\(null\)\)/, "Workspace switching overlay must clear after bootstrap refresh settles");
assert.equal(appSurface.includes('className="scrim"'), false, "App modules must not hand-write .scrim; use DrawerLayer/ModalLayer");
assert.equal(appSurface.includes('className="drawer-layer open"'), false, "App modules must not hand-write .drawer-layer");
assert.equal(appSurface.includes('className="modal-layer open"'), false, "App modules must not hand-write .modal-layer");
assert.match(workspacePicker, /document\.addEventListener\("pointerdown"/, "Workspace picker must close on outside pointerdown");
assert.match(workspacePicker, /rootRef\.current\?\.contains\(target\)/, "Workspace picker outside close must ignore clicks inside the picker");
assert.match(workspacePicker, /event\.key === "Escape"/, "Workspace picker must close on Escape");

assertOverlaySection({
  label: "SettingsModal",
  block: sectionToEnd(settingsModal, "export function SettingsModal", "SettingsModal"),
  layer: "ModalLayer",
  onClose: "props.onClose"
});

assertOverlaySection({
  label: "Add admin modal",
  block: section(tenantView, "{adding ? (", "</ModalLayer>", "Add admin modal"),
  layer: "ModalLayer",
  onClose: "closeAddAdmin"
});

assertOverlaySection({
  label: "WorkspaceSettingsDrawer",
  block: section(workspaceSettingsDrawer, "export function WorkspaceSettingsDrawer", "{renameKey ? (", "WorkspaceSettingsDrawer"),
  layer: "DrawerLayer",
  onClose: "props.onClose"
});

assertOverlaySection({
  label: "AskMapleDrawer",
  block: sectionToEnd(askMapleDrawer, "export function AskMapleDrawer", "AskMapleDrawer"),
  layer: "DrawerLayer",
  onClose: "onClose"
});

assertOverlaySection({
  label: "MetricDrawer",
  block: sectionToEnd(metricDrawer, "export function MetricDrawer", "MetricDrawer"),
  layer: "DrawerLayer",
  onClose: "props.onClose"
});

assertOverlaySection({
  label: "ModalShell",
  block: sectionToEnd(sharedLayout, "export function ModalShell", "ModalShell"),
  layer: "ModalLayer",
  onClose: "onClose"
});

assert.equal(pkg.scripts?.["test:ui-overlay"], "bun tests/contracts/ui_overlay_contract.ts", "package.json must expose test:ui-overlay");
assert.match(pkg.scripts?.["test:all"] ?? "", /test:ui-overlay/, "test:all must include test:ui-overlay");

console.log("ui overlay contract passed");
