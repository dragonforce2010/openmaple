import { useEffect, useState } from "react";
import { apiDelete, apiPatch, apiPost } from "../../api";
import type { ModelConfig, ModelConnectivityResult, Workspace } from "../../types";
import { Icon, useConfirm, useToast } from "../../ui";
import { useI18n } from "../../appConfig";
import { ConnectivityResult } from "../../components/shared/forms";
import { PageFrame } from "../../components/shared/layout";
import { errorMessage } from "../../components/shared/misc";

export function ModelGatewayView(props: {
  modelConfigs: ModelConfig[];
  workspace: Workspace | null;
  openModelConfig: () => void;
  onChanged?: () => Promise<void> | void;
  loading?: boolean;
}) {
  const { language } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const L = (zh: string, en: string) => (language === "zh" ? zh : en);

  const [selectedModelId, setSelectedModelId] = useState(props.modelConfigs[0]?.id ?? "");
  const [testingModelId, setTestingModelId] = useState("");
  const [testResult, setTestResult] = useState<ModelConnectivityResult | null>(null);
  const [testError, setTestError] = useState("");
  const [menuModelId, setMenuModelId] = useState("");
  // Row-level busy flag for menu actions (default/delete). The menu closes on click so a
  // per-button spinner would vanish; instead we mark the row busy to show progress and block
  // duplicate clicks while the request is in flight.
  const [busyModelId, setBusyModelId] = useState("");
  const selectedModel =
    props.modelConfigs.find((config) => config.id === selectedModelId) ?? props.modelConfigs[0] ?? null;

  useEffect(() => {
    if (props.modelConfigs.length > 0 && !props.modelConfigs.some((config) => config.id === selectedModelId)) {
      setSelectedModelId(props.modelConfigs[0].id);
    }
  }, [props.modelConfigs, selectedModelId]);

  useEffect(() => {
    if (!menuModelId) return;
    const close = () => setMenuModelId("");
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuModelId]);

  async function testModel(config: ModelConfig) {
    setTestingModelId(config.id);
    setTestError("");
    setMenuModelId("");
    try {
      const result = await apiPost<ModelConnectivityResult>(`/v1/model_configs/${config.id}/test`);
      setTestResult(result);
    } catch (reason) {
      setTestResult(null);
      setTestError(errorMessage(reason));
    } finally {
      setTestingModelId("");
    }
  }

  async function setDefaultModel(config: ModelConfig) {
    setMenuModelId("");
    if (busyModelId) return;
    setBusyModelId(config.id);
    try {
      await apiPatch(`/v1/model_configs/${config.id}`, { is_default: true });
      await props.onChanged?.();
      toast(L("已设为默认模型", "Default model updated"), "ok");
    } catch (reason) {
      toast(errorMessage(reason), "err");
    } finally {
      setBusyModelId("");
    }
  }

  async function deleteModel(config: ModelConfig) {
    setMenuModelId("");
    const ok = await confirm({
      title: L("删除模型接入点", "Delete model endpoint"),
      body: L(`确定删除「${config.name}」？`, `Delete "${config.name}"?`),
      confirmLabel: L("删除", "Delete"),
      cancelLabel: L("取消", "Cancel"),
      danger: true
    });
    if (!ok || busyModelId) return;
    setBusyModelId(config.id);
    try {
      await apiDelete(`/v1/model_configs/${config.id}`);
      await props.onChanged?.();
      toast(L("已删除模型", "Model deleted"), "ok");
    } catch (reason) {
      toast(errorMessage(reason), "err");
    } finally {
      setBusyModelId("");
    }
  }

  const protoLabel = (provider: string) => {
    const key = (provider || "").toLowerCase();
    if (key === "anthropic") return "Anthropic";
    if (key === "openai") return "OpenAI";
    return provider || L("自定义", "Custom");
  };
  const isReadonly = (config: ModelConfig) => !config.workspace_id || config.workspace_id === "-1";

  return (
    <PageFrame
      title={
        <>
          {L("模型管理", "Models")} <span className="title-count">{props.modelConfigs.length}</span>
        </>
      }
      sub={L("统一接入内置与自定义模型接入点，供工作区与 Agent 调用。", "Unified built-in and custom model endpoints for workspace and Agent calls.")}
      action={
        <div className="action-row">
          <button className="btn primary" onClick={props.openModelConfig} disabled={!props.workspace}>
            <Icon name="i-plus" size={15} /> {L("添加模型", "New model")}
          </button>
        </div>
      }
    >
      <h2 className="section-title">{L("模型池", "Model pool")}</h2>
      {props.modelConfigs.length || props.loading ? (
        <div className="data-table-wrap model-table-wrap">
          <div className="card menu-host">
            <table className="data-table model-table">
              <colgroup>
                <col style={{ width: "27%" }} />
                <col style={{ width: "13%" }} />
                <col style={{ width: "20%" }} />
                <col style={{ width: "27%" }} />
                <col style={{ width: "8%" }} />
                <col style={{ width: "5%" }} />
              </colgroup>
              <thead>
                <tr><th>{L("名称", "Name")}</th><th>{L("协议", "Protocol")}</th><th>{L("模型", "Model")}</th><th>Base URL</th><th>{L("默认", "Default")}</th><th /></tr>
              </thead>
              <tbody>
                {props.loading ? (
                  <tr className="table-loading-row">
                    <td colSpan={6}>
                      <span className="table-loading" role="status" aria-live="polite" aria-busy="true">
                        <span className="spin-dot" /> {L("加载模型接入点中…", "Loading model endpoints...")}
                      </span>
                    </td>
                  </tr>
                ) : props.modelConfigs.map((config) => (
                  <tr
                    key={config.id}
                    className={selectedModel?.id === config.id ? "sel model-row" : "model-row"}
                    onClick={() => setSelectedModelId(config.id)}
                    tabIndex={0}
                  >
                    <td>
                      <span className="t-name">{config.name}</span>
                      <small>{isReadonly(config) ? L("内置接入点", "Built-in endpoint") : L("自定义接入点", "Custom endpoint")}</small>
                    </td>
                    <td>
                      <span className={`proto-tag ${(config.provider_type || "").toLowerCase()}`}>
                        {protoLabel(config.provider_type)}
                      </span>
                    </td>
                    <td className="mono">{config.model_name}</td>
                    <td className="mono model-url">{config.base_url}</td>
                    <td>{config.is_default ? <span className="status active">{L("默认", "default")}</span> : "—"}</td>
                    <td className="row-end">
                      <div className="row-menu-wrap">
                        {busyModelId === config.id ? (
                          <span className="spin-dot" aria-label={L("处理中", "Working")} />
                        ) : (
                        <button className="kebab" onClick={(event) => { event.stopPropagation(); setMenuModelId(menuModelId === config.id ? "" : config.id); }} aria-label={L("更多操作", "More actions")}>...</button>
                        )}
                        {menuModelId === config.id ? (
                          <div className="row-menu open" onClick={(event) => event.stopPropagation()}>
                            <button onClick={() => testModel(config)}><Icon name="i-circle-dot" size={14} /> {L("测试连接", "Test connection")}</button>
                            {!isReadonly(config) ? <button onClick={() => setDefaultModel(config)}><Icon name="i-check" size={14} /> {L("设为默认", "Set default")}</button> : null}
                            {!isReadonly(config) ? <button className="danger" onClick={() => deleteModel(config)}><Icon name="i-trash" size={14} /> {L("删除", "Delete")}</button> : null}
                          </div>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="panel-empty">{L("暂无模型接入点，先添加一个。", "No model endpoints yet — add one.")}</div>
      )}

      {selectedModel && !props.loading ? (
        <section className="model-detail-card card" aria-label={L("模型接入点详情", "Model endpoint detail")}>
          <div className="mdl-head">
            <span className="mdl-ico"><Icon name="i-gauge" size={18} /></span>
            <span className="mdl-head-main">
              <b>{selectedModel.name}</b>
              <span>{selectedModel.id}</span>
            </span>
            {selectedModel.is_default ? <span className="status active">{L("默认", "default")}</span> : null}
          </div>
          <div className="mdl-kv-grid">
            <div className="kv"><span>{L("协议", "Protocol")}</span><strong>{protoLabel(selectedModel.provider_type)}</strong></div>
            <div className="kv"><span>{L("模型", "Model")}</span><strong>{selectedModel.model_name}</strong></div>
            <div className="kv"><span>Base URL</span><strong>{selectedModel.base_url}</strong></div>
            <div className="kv"><span>{L("范围", "Scope")}</span><strong>{isReadonly(selectedModel) ? L("内置", "Built-in") : props.workspace?.name ?? L("工作区", "Workspace")}</strong></div>
            <div className="kv"><span>API Key</span><strong>{selectedModel.has_api_key ? selectedModel.api_key_hint || L("已配置", "Configured") : L("环境变量回退", "Env fallback")}</strong></div>
            <div className="kv"><span>{L("更新时间", "Updated")}</span><strong>{selectedModel.updated_at}</strong></div>
          </div>
        </section>
      ) : null}

      {testingModelId ? <div className="modal-note"><Icon name="i-refresh" size={16} /> {L("正在测试模型连接…", "Testing model connection...")}</div> : null}
      {testError ? <div className="error-inline">{testError}</div> : null}
      {testResult ? <ConnectivityResult result={testResult} /> : null}
    </PageFrame>
  );
}
