import { useState } from "react";
import { apiPost } from "../../api";
import { useL, type OnboardingCustomModelConfig } from "../../appConfig";
import { ConnectivityResult, Select } from "../../components/shared/forms";
import { ModalShell } from "../../components/shared/layout";
import { errorMessage } from "../../components/shared/misc";
import type { ModelConnectivityResult } from "../../types";
import { Icon } from "../../ui";

export function OnboardingCustomModelConfigForm(props: { onAdd: (config: OnboardingCustomModelConfig) => void }) {
  const L = useL();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [protocol, setProtocol] = useState<"openai" | "anthropic">("openai");
  const [baseUrl, setBaseUrl] = useState("");
  const [modelName, setModelName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ModelConnectivityResult | null>(null);
  const [error, setError] = useState("");

  function payload() {
    return {
      kind: "custom",
      base_url: baseUrl,
      model_name: modelName,
      api_key: apiKey || undefined
    };
  }

  async function testConnection() {
    setTesting(true);
    setError("");
    setTestResult(null);
    try {
      const result = await apiPost<ModelConnectivityResult>("/v1/model_configs/test", payload());
      setTestResult(result);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setTesting(false);
    }
  }

  function add() {
    if (!name.trim() || !baseUrl.trim() || !modelName.trim()) {
      setError(L("请填写名称、Base URL 和模型名称。", "Name, Base URL and model name are required."));
      return;
    }
    props.onAdd({
      local_id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      kind: "custom",
      name: name.trim(),
      protocol,
      base_url: baseUrl.trim(),
      model_name: modelName.trim(),
      api_key: apiKey.trim() || undefined,
      is_default: isDefault
    });
    setOpen(false);
    setTestResult(null);
    setError("");
  }

  const canAdd = Boolean(name.trim() && baseUrl.trim() && modelName.trim());
  const canTest = Boolean(baseUrl.trim() && modelName.trim());

  return (
    <div className="omc-box">
      <button type="button" className="tc-action" onClick={() => { setOpen(true); setError(""); setTestResult(null); }}>
        <span className="tc-ico"><Icon name="i-plus" size={18} /></span>
        <span className="tc-copy">
          <b>{L("添加模型", "Add model")}</b>
          <span>{L("添加自定义模型接入点。预置模型已在上方列出。", "Add a custom model endpoint. Presets are listed above.")}</span>
        </span>
        <Icon name="i-chevron-right" size={16} />
      </button>
      {open ? (
        <ModalShell title={L("添加自定义模型", "Add custom model")} onClose={() => setOpen(false)}>
          {error ? <div className="modal-note"><Icon name="i-alert" size={16} /> {error}</div> : null}
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
          <label className="form">{L("名称", "Name")}<input className="fld" autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label className="form">Base URL<input className="fld" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://ark.cn-beijing.volces.com/api/v3" /></label>
          <label className="form">{L("模型名称", "Model name")}<input className="fld" value={modelName} onChange={(event) => setModelName(event.target.value)} placeholder={protocol === "anthropic" ? "claude-..." : "gpt-..."} /></label>
          <label className="form">API Key<input className="fld" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={L("加密存储，不会再次展示", "Stored encrypted; never shown again")} /></label>
          <label className="form"><span className="flabel-in"><input type="checkbox" checked={isDefault} onChange={(event) => setIsDefault(event.target.checked)} /> {L("设为默认模型配置", "Use as default model config")}</span></label>
          {testResult ? <ConnectivityResult result={testResult} /> : null}
          <div className="modal-foot">
            <button type="button" className="btn secondary" onClick={testConnection} disabled={testing || !canTest}>{testing ? L("测试中…", "Testing...") : L("测试连接", "Test connection")}</button>
            <button type="button" className="btn primary" onClick={add} disabled={!canAdd}>{L("添加到模型池", "Add to model pool")}</button>
          </div>
        </ModalShell>
      ) : null}
    </div>
  );
}
