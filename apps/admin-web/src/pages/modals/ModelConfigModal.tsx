import { useState } from "react";
import { apiPost } from "../../api";
import type { ModelConfig, ModelConnectivityResult, Workspace } from "../../types";
import { Icon } from "../../ui";
import { MODEL_PRESET_OPTIONS, useL } from "../../appConfig";
import { ConnectivityResult, Select } from "../../components/shared/forms";
import { ModalShell } from "../../components/shared/layout";
import { errorMessage } from "../../components/shared/misc";

export function ModelConfigModal(props: { workspace: Workspace | null; modelConfigs: ModelConfig[]; onClose: () => void; onSaved: () => void }) {
  const L = useL();
  const [kind, setKind] = useState<"custom" | "preset">("preset");
  const [presetKey, setPresetKey] = useState(MODEL_PRESET_OPTIONS[0].value);
  const [name, setName] = useState("");
  const [protocol, setProtocol] = useState<"openai" | "anthropic">("openai");
  const [baseUrl, setBaseUrl] = useState("");
  const [modelName, setModelName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [isDefault, setIsDefault] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ModelConnectivityResult | null>(null);
  const [error, setError] = useState("");

  const presetName = MODEL_PRESET_OPTIONS.find((option) => option.value === presetKey)?.name ?? "";
  const normalizeUrl = (url?: string | null) => String(url || "").replace(/\/+$/, "").toLowerCase();

  function duplicateConfig() {
    return props.modelConfigs.find((config) =>
      kind === "preset"
        ? (config.preset_key || "") === presetKey
        : normalizeUrl(config.base_url) === normalizeUrl(baseUrl) && (config.model_name || "") === modelName.trim()
    );
  }

  async function save() {
    if (kind === "custom" && (!name.trim() || !baseUrl.trim() || !modelName.trim())) {
      setError(L("请填写名称、Base URL 和模型名称。", "Name, Base URL and model name are required."));
      return;
    }
    const dupe = duplicateConfig();
    if (dupe) {
      setError(L(`模型「${dupe.name}」已添加，无需重复添加。`, `Model "${dupe.name}" is already added — no need to add it again.`));
      return;
    }
    setSaving(true);
    setError("");
    try {
      await apiPost("/v1/model_configs", {
        kind,
        name: kind === "preset" ? presetName : name.trim(),
        protocol: kind === "custom" ? protocol : undefined,
        workspace_id: props.workspace?.id || undefined,
        preset_key: kind === "preset" ? presetKey : undefined,
        base_url: kind === "custom" ? baseUrl : undefined,
        model_name: kind === "custom" ? modelName : undefined,
        api_key: kind === "custom" ? apiKey || undefined : undefined,
        is_default: isDefault
      });
      await props.onSaved();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setError("");
    setTestResult(null);
    try {
      const result = await apiPost<ModelConnectivityResult>("/v1/model_configs/test", {
        kind,
        preset_key: kind === "preset" ? presetKey : undefined,
        base_url: kind === "custom" ? baseUrl : undefined,
        model_name: kind === "custom" ? modelName : undefined,
        api_key: kind === "custom" ? apiKey || undefined : undefined
      });
      setTestResult(result);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setTesting(false);
    }
  }

  const canTest = kind === "preset" || Boolean(baseUrl.trim() && modelName.trim());

  return (
    <ModalShell title={L("添加模型接入点", "Add model endpoint")} onClose={props.onClose} wide>
      {error ? <div className="modal-note"><Icon name="i-alert" size={16} /> {error}</div> : null}
      <label className="form">{L("所属工作区", "Workspace")}
        <input className="fld" value={props.workspace?.name ?? L("未选择工作区", "No workspace selected")} readOnly />
      </label>
      <label className="form">{L("类型", "Type")}
        <Select
          value={kind}
          options={[
            { value: "preset", label: L("预设模型", "Preset model") },
            { value: "custom", label: L("自定义模型", "Custom model") }
          ]}
          onChange={(value) => { setKind(value as "custom" | "preset"); setTestResult(null); setError(""); }}
        />
      </label>
      {kind === "preset" ? (
        <>
          <label className="form">{L("预设", "Preset")}
            <Select value={presetKey} options={MODEL_PRESET_OPTIONS.map((option) => ({ value: option.value, label: option.label }))} onChange={setPresetKey} />
          </label>
          <label className="form">{L("名称", "Name")}
            <input className="fld" value={presetName} readOnly />
            <span className="ce-hint">{L("预设模型名称与密钥已内置，无需填写。", "Preset name and API key are built in.")}</span>
          </label>
        </>
      ) : (
        <>
          <label className="form">{L("模型协议", "Model protocol")}
            <Select
              value={protocol}
              options={[
                { value: "openai", label: "OpenAI" },
                { value: "anthropic", label: "Anthropic" }
              ]}
              onChange={(value) => setProtocol(value as "openai" | "anthropic")}
            />
          </label>
          <label className="form">{L("名称", "Name")}<input className="fld" value={name} onChange={(event) => setName(event.target.value)} placeholder={L("我的模型接入点", "My model endpoint")} /></label>
          <label className="form">Base URL<input className="fld" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://ark.cn-beijing.volces.com/api/v3" /></label>
          <label className="form">{L("模型名称", "Model name")}<input className="fld" value={modelName} onChange={(event) => setModelName(event.target.value)} placeholder={protocol === "anthropic" ? "claude-..." : "gpt-..."} /></label>
          <label className="form">API Key<input className="fld" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={L("加密存储，不会再次展示", "Stored encrypted; never shown again")} /></label>
        </>
      )}
      <label className="form"><span className="flabel-in"><input type="checkbox" checked={isDefault} onChange={(event) => setIsDefault(event.target.checked)} /> {L("设为默认模型配置", "Use as default model config")}</span></label>
      {testResult ? <ConnectivityResult result={testResult} /> : null}
      <div className="modal-foot">
        <button className="btn secondary" onClick={testConnection} disabled={testing || !canTest}>{testing ? L("测试中…", "Testing...") : L("测试连接", "Test connection")}</button>
        <button className="btn primary" onClick={save} disabled={saving || !props.workspace || (kind === "custom" && !name.trim())}>{saving ? L("保存中…", "Saving...") : L("添加", "Add")}</button>
      </div>
    </ModalShell>
  );
}
