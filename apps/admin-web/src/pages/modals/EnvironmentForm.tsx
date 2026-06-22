import { useState } from "react";
import { apiPost } from "../../api";
import type { Environment } from "../../types";
import { Icon } from "../../ui";
import { useI18n, useL } from "../../appConfig";
import { Select } from "../../components/shared/forms";
import { errorMessage } from "../../components/shared/misc";

// Shared environment-create body, used both by EnvironmentModal and by the inline drawer in
// SessionModal. Owns all field state + the POST; the host supplies the outer shell (modal/drawer).
export function EnvironmentForm({ workspaceId, sandboxProvider, onClose, onCreated }: {
  workspaceId?: string;
  sandboxProvider?: string;
  onClose: () => void;
  onCreated: (environment: Environment) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const L = useL();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [networking, setNetworking] = useState("cloud_unrestricted");
  const [packages, setPackages] = useState<Array<{ manager: string; name: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const provider = sandboxProvider === "local_docker" ? "local_docker" : sandboxProvider === "vefaas" ? "vefaas" : sandboxProvider === "daytona" ? "daytona" : "e2b";
  const providerLabel = provider === "local_docker" ? "Local Docker Sandbox" : provider === "vefaas" ? "VeFaaS Sandbox" : provider === "daytona" ? "Daytona Sandbox" : "E2B";

  function sandboxConfig() {
    if (provider === "vefaas") return { provider: "vefaas" };
    if (provider === "local_docker") return { provider: "local_docker", local_docker: { image: "node:22-bookworm" } };
    if (provider === "daytona") return { provider: "daytona", daytona: { workspace_path: "/workspace", timeout_ms: 3_600_000 } };
    return { provider: "e2b", e2b: { template: "base", workspace_path: "/workspace", timeout_ms: 3_600_000 } };
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const created = await apiPost<Environment>("/v1/environments", {
        workspace_id: workspaceId || undefined,
        name,
        description,
        config: {
          type: provider,
          sandbox: sandboxConfig(),
          workspace_root: ".managed-agents/sessions",
          description,
          packages: packages.filter((item) => item.name.trim()),
          networking: {
            mode: networking,
            allow_internet_access: networking === "cloud_unrestricted",
            allow_mcp_servers: networking !== "none",
            allow_package_managers: networking === "cloud_unrestricted"
          }
        }
      });
      await onCreated(created);
      onClose();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {error ? <div className="modal-note"><Icon name="i-alert" size={16} /> {error}</div> : null}
      <label className="form">{t("env.name")}<input className="fld" value={name} onChange={(event) => setName(event.target.value)} placeholder="e2b-agent-env" /></label>
      <label className="form">{L("描述", "Description")}<textarea className="fld" value={description} onChange={(event) => setDescription(event.target.value)} placeholder={L("这个环境用于数据处理、浏览器验收或自动化脚本…", "This environment is used for data processing, browser verification, or automation scripts...")} /></label>
      <div className="locked-provider"><Icon name="i-server" size={15} /> {L("当前 Sandbox · ", "Current sandbox · ")}{providerLabel}</div>
      <div className="field-block">
        <div className="flabel">{L("环境模板", "Environment templates")}</div>
        <div className="ac-tpls env-template-grid">
          {packageTemplates(L).map((template) => (
            <button
              type="button"
              className="ac-tpl"
              key={template.name}
              onClick={() => {
                setName(template.name);
                setDescription(template.description);
                setNetworking(template.networking);
                setPackages(template.packages);
              }}
            >
              <b>{template.name}</b><span>{template.description}</span>
            </button>
          ))}
        </div>
      </div>
      <label className="form">{t("env.networking")}
        <Select
          value={networking}
          options={[
            { value: "cloud_unrestricted", label: L("允许联网", "Allow internet") },
            { value: "cloud_limited", label: L("受限联网", "Limited internet") },
            { value: "none", label: L("禁用联网", "No internet") }
          ]}
          onChange={setNetworking}
        />
      </label>
      <div className="field-block">
        <div className="flabel">packages</div>
        {packages.map((item, index) => (
          <div className="repeat-row" key={`${item.manager}:${index}`}>
            <Select
              value={item.manager}
              options={["pip", "npm", "pnpm", "apt", "cargo", "go"].map((manager) => ({ value: manager, label: manager }))}
              onChange={(value) => setPackages((current) => current.map((pkg, pkgIndex) => pkgIndex === index ? { ...pkg, manager: value } : pkg))}
            />
            <input className="fld pkg-name" value={item.name} placeholder="pandas==2.2.3" onChange={(event) => setPackages((current) => current.map((pkg, pkgIndex) => pkgIndex === index ? { ...pkg, name: event.target.value } : pkg))} />
            <button className="row-del" title={L("删除", "Remove")} onClick={() => setPackages((current) => current.filter((_, pkgIndex) => pkgIndex !== index))}><Icon name="i-trash" size={14} /></button>
          </div>
        ))}
        <button className="add-row" type="button" onClick={() => setPackages((current) => [...current, { manager: "pip", name: "" }])}><Icon name="i-plus" size={14} /> {L("添加包", "Add package")}</button>
      </div>
      <div className="modal-foot">
        <button className="btn secondary" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save} disabled={saving || !name.trim()}>{saving ? <span className="btn-spin" aria-hidden /> : null} {saving ? t("env.creating") : t("env.create")}</button>
      </div>
    </>
  );
}

function packageTemplates(L: (zh: string, en: string) => string) {
  return [
    { name: L("默认环境", "Default environment"), description: L("不预装额外依赖，适合基础 Shell、文件和 API 操作。", "No extra packages; suitable for basic shell, file, and API work."), networking: "cloud_unrestricted", packages: [] },
    { name: L("Python 数据分析", "Python data analysis"), description: L("pandas / openpyxl / matplotlib，适合表格分析和财务对账。", "pandas / openpyxl / matplotlib for spreadsheet analysis and reconciliation."), networking: "cloud_unrestricted", packages: [{ manager: "pip", name: "pandas==2.2.3" }, { manager: "pip", name: "openpyxl==3.1.5" }, { manager: "pip", name: "matplotlib==3.10.0" }] },
    { name: L("浏览器 E2E 验收", "Browser E2E verification"), description: L("playwright + pytest，用于端到端交互和截图验收。", "playwright + pytest for end-to-end interaction and screenshots."), networking: "cloud_unrestricted", packages: [{ manager: "pip", name: "playwright==1.49.1" }, { manager: "pip", name: "pytest==8.3.4" }] },
    { name: L("Node 自动化", "Node automation"), description: L("pnpm / zx / lodash，适合批量脚本和 API 自动化。", "pnpm / zx / lodash for batch scripts and API automation."), networking: "cloud_unrestricted", packages: [{ manager: "npm", name: "zx@8.3.0" }, { manager: "npm", name: "lodash@4.17.21" }] }
  ];
}
