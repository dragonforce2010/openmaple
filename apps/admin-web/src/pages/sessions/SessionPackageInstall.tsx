import { useState } from "react";
import type { SessionDetail } from "../../types";
import { Icon } from "../../ui";

type Pkg = { manager: string; name: string; status: "installing" | "ok" | "failed"; log: string };

// Aggregate package.install_* events into a per-package status list. The control plane emits
// started → log* → finished for each package while the session sits in installing_packages.
function aggregate(detail: SessionDetail | null): Pkg[] {
  const order: string[] = [];
  const byKey = new Map<string, Pkg>();
  for (const event of detail?.events ?? []) {
    if (!event.type.startsWith("package.install_")) continue;
    const payload = event.payload as { name?: unknown; manager?: unknown; ok?: unknown; chunk?: unknown };
    const name = String(payload.name ?? "");
    if (!name) continue;
    const key = `${String(payload.manager ?? "")}:${name}`;
    if (!byKey.has(key)) {
      byKey.set(key, { manager: String(payload.manager ?? ""), name, status: "installing", log: "" });
      order.push(key);
    }
    const pkg = byKey.get(key)!;
    if (event.type === "package.install_log") pkg.log = `${pkg.log}${String(payload.chunk ?? "")}\n`;
    if (event.type === "package.install_finished") pkg.status = payload.ok ? "ok" : "failed";
  }
  return order.map((key) => byKey.get(key)!);
}

export function SessionPackageInstall(props: { detail: SessionDetail | null; L: (zh: string, en: string) => string }) {
  const { detail, L } = props;
  const [open, setOpen] = useState("");
  const installing = String(detail?.session.status ?? "") === "installing_packages";
  const packages = aggregate(detail);
  const visiblePackages = installing ? packages : packages.filter((pkg) => pkg.status === "failed");
  if (!installing && !visiblePackages.length) return null;

  return (
    <div className="run-hint pkg-install">
      <Icon name="i-package" size={12} />{" "}
      {installing ? L("正在准备环境 · 安装自定义依赖", "Preparing environment · installing packages") : L("依赖安装失败", "Package install failed")}
      {installing ? <span className="track"><i /></span> : null}
      <div className="pkg-install-list">
        {visiblePackages.map((pkg) => (
          <div className="pkg-install-row" key={`${pkg.manager}:${pkg.name}`}>
            <button type="button" className="pkg-install-head" onClick={() => setOpen((cur) => (cur === pkg.name ? "" : pkg.name))}>
              <span className={`pkg-dot ${pkg.status}`} />
              <span className="mut">{pkg.manager}</span> {pkg.name}
              <span className="pkg-state">{pkg.status === "installing" ? L("安装中…", "Installing…") : pkg.status === "ok" ? "✓" : L("失败", "failed")}</span>
            </button>
            {open === pkg.name && pkg.log ? <pre className="pkg-install-logbox">{pkg.log.trim()}</pre> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
