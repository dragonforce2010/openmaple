import { Fragment, useEffect, useMemo, useState } from "react";
import { apiGet } from "../../api";
import { useL, type OnboardingCustomModelConfig } from "../../appConfig";
import { errorMessage, slugify } from "../../components/shared/misc";
import type { ModelConfig, User, WorkspaceSlugStatus } from "../../types";
import { Icon, useToast } from "../../ui";
import {
  MAX_RUNTIME_CONCURRENCY,
  MAX_RUNTIME_INSTANCES,
  MAX_SANDBOX_POOL_SIZE,
  type WorkspaceOnboardingSubmitInput
} from "./WorkspaceOnboardingConfig";
import { WorkspaceOnboardingSteps } from "./WorkspaceOnboardingSteps";
import { ProvisioningLogPanel, provisioningLog, type ProvisioningLog } from "./ProvisioningLogPanel";

export function WorkspaceOnboardingView(props: {
  currentUser: User;
  modelConfigs: ModelConfig[];
  issuedWorkspaceKey: string;
  onSubmit: (input: WorkspaceOnboardingSubmitInput) => Promise<void>;
}) {
  const L = useL();
  const toast = useToast();
  const draftKey = `maple_onboarding_${props.currentUser.id}`;
  const draft0 = (() => { try { return JSON.parse(localStorage.getItem(draftKey) || "{}") as Record<string, unknown>; } catch { return {}; } })();
  const num = (key: string, fallback: number) => (typeof draft0[key] === "number" ? (draft0[key] as number) : fallback);
  const numString = (key: string, fallback: number) => (typeof draft0[key] === "string" ? (draft0[key] as string) : String(num(key, fallback)));
  const readInt = (value: string, fallback: number, min: number, max = Number.MAX_SAFE_INTEGER) => {
    const next = Number.parseInt(value, 10);
    return Number.isFinite(next) ? Math.min(max, Math.max(min, next)) : fallback;
  };
  const [step, setStep] = useState(0);
  const [tenantName, setTenantName] = useState("");
  const [tenantDescription, setTenantDescription] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceDescription, setWorkspaceDescription] = useState("");
  const [workspaceSlug, setWorkspaceSlug] = useState("");
  const [slugStatus, setSlugStatus] = useState<WorkspaceSlugStatus | null>(null);
  const [desiredSizeInput, setDesiredSizeInput] = useState(numString("desiredSize", 3));
  const [minInstancesInput, setMinInstancesInput] = useState(numString("minInstances", 1));
  const [maxInstancesInput, setMaxInstancesInput] = useState(numString("maxInstances", 100));
  const [maxConcurrencyInput, setMaxConcurrencyInput] = useState(numString("maxConcurrency", MAX_RUNTIME_CONCURRENCY));
  const [cpuMilliInput, setCpuMilliInput] = useState(numString("cpuMilli", 2000));
  const [memoryMbInput, setMemoryMbInput] = useState(numString("memoryMb", 4096));
  const [apiKeyName, setApiKeyName] = useState("");
  const [modelConfigIds, setModelConfigIds] = useState<string[]>(Array.isArray(draft0.modelConfigIds) ? (draft0.modelConfigIds as string[]) : []);
  const [customModelConfigs, setCustomModelConfigs] = useState<OnboardingCustomModelConfig[]>([]);
  const [vefaasAccessKey, setVefaasAccessKey] = useState("");
  const [vefaasSecretKey, setVefaasSecretKey] = useState("");
  const [vefaasRegion, setVefaasRegion] = useState(typeof draft0.vefaasRegion === "string" ? draft0.vefaasRegion : "cn-beijing");
  const [sandboxProvider, setSandboxProvider] = useState<"e2b" | "vefaas">(draft0.sandboxProvider === "vefaas" ? "vefaas" : "e2b");
  const [e2bApiKey, setE2bApiKey] = useState("");
  const [vefaasSandboxFunctionId, setVefaasSandboxFunctionId] = useState("");
  const [vefaasSandboxGatewayUrl, setVefaasSandboxGatewayUrl] = useState("");
  const [vefaasSandboxTimeoutInput, setVefaasSandboxTimeoutInput] = useState(numString("vefaasSandboxTimeoutMs", 3_600_000));
  const [sandboxPoolSizeInput, setSandboxPoolSizeInput] = useState(numString("sandboxPoolSize", 1));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [provisionLogs, setProvisionLogs] = useState<ProvisioningLog[]>([]);
  const desiredSize = readInt(desiredSizeInput, 3, 1);
  const minInstances = readInt(minInstancesInput, 1, 0, MAX_RUNTIME_INSTANCES);
  const maxInstances = Math.max(minInstances || 1, readInt(maxInstancesInput, 100, 1, MAX_RUNTIME_INSTANCES));
  const maxConcurrency = readInt(maxConcurrencyInput, MAX_RUNTIME_CONCURRENCY, 1, MAX_RUNTIME_CONCURRENCY);
  const cpuMilli = readInt(cpuMilliInput, 2000, 250);
  const memoryMb = readInt(memoryMbInput, 4096, 512);
  const vefaasSandboxTimeoutMs = readInt(vefaasSandboxTimeoutInput, 3_600_000, 60_000);
  const sandboxPoolSize = readInt(sandboxPoolSizeInput, 1, 1, MAX_SANDBOX_POOL_SIZE);
  const inferredWorkspaceSlug = workspaceName.trim() ? slugify(workspaceName.trim()) : "";
  const derivedWorkspaceSlug = workspaceSlug.trim() || inferredWorkspaceSlug;
  const workspaceApiKeyPlaceholder = `${workspaceName.trim() || L("workspace 名称", "workspace-name")}-apikey`;
  const validModelConfigIds = useMemo(() => modelConfigIds.filter((id) => props.modelConfigs.some((config) => config.id === id)), [modelConfigIds, props.modelConfigs]);
  const warmQps = desiredSize * minInstances * maxConcurrency;
  const peakQps = desiredSize * maxInstances * maxConcurrency;
  const runtimeCredsFilled = Boolean(vefaasAccessKey.trim() && vefaasSecretKey.trim() && vefaasRegion.trim());
  const sandboxFilled = sandboxProvider === "e2b"
    ? Boolean(e2bApiKey.trim())
    : Boolean(vefaasSandboxFunctionId.trim() && vefaasSandboxGatewayUrl.trim());
  const workspaceSlugReady = Boolean(derivedWorkspaceSlug.trim() && slugStatus?.available === true);

  // Persist non-sensitive runtime choices only; text fields stay placeholder-only on reload.
  // secrets (AK/SK, e2b key) are intentionally NOT persisted and must be re-entered
  useEffect(() => {
    try {
      localStorage.setItem(draftKey, JSON.stringify({ desiredSize, minInstances, maxInstances, maxConcurrency, cpuMilli, memoryMb, modelConfigIds: validModelConfigIds, vefaasRegion, sandboxProvider, vefaasSandboxTimeoutMs, sandboxPoolSize }));
    } catch { /* ignore storage quota */ }
  }, [desiredSize, minInstances, maxInstances, maxConcurrency, cpuMilli, memoryMb, validModelConfigIds, vefaasRegion, sandboxProvider, vefaasSandboxTimeoutMs, sandboxPoolSize, draftKey]);

  useEffect(() => {
    if (!props.modelConfigs.length) return;
    const validIds = new Set(props.modelConfigs.map((config) => config.id));
    const kept = modelConfigIds.filter((id) => validIds.has(id));
    if (kept.length !== modelConfigIds.length) {
      setModelConfigIds(kept);
    }
  }, [props.modelConfigs, modelConfigIds]);

  useEffect(() => {
    let cancelled = false;
    if (!derivedWorkspaceSlug.trim()) {
      setSlugStatus(null);
      return;
    }
    apiGet<WorkspaceSlugStatus>(`/v1/workspace_slugs/${encodeURIComponent(derivedWorkspaceSlug)}`)
      .then((result) => {
        if (!cancelled) setSlugStatus(result);
      })
      .catch(() => {
        if (!cancelled) setSlugStatus({ available: false, slug: derivedWorkspaceSlug, reason: "invalid" });
      });
    return () => {
      cancelled = true;
    };
  }, [derivedWorkspaceSlug]);

  function toggleModel(id: string) {
    setModelConfigIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function isStepComplete(index: number) {
    if (index === 0) return Boolean(tenantName.trim());
    if (index === 1) return Boolean(workspaceName.trim() && workspaceSlugReady);
    if (index === 2) return runtimeCredsFilled;
    if (index === 3) return sandboxFilled;
    return true;
  }

  function stepError(index: number) {
    if (index === 0) return L("请先填写租户名称。", "Enter the tenant name first.");
    if (index === 1) return L("请先填写工作区名称，并等待 slug 校验通过。", "Enter the workspace name and wait for slug validation to pass.");
    if (index === 2) return L("请先填写 VOLCENGINE_ACCESS_KEY、VOLCENGINE_SECRET_KEY 与 VEFAAS_REGION。", "Enter VOLCENGINE_ACCESS_KEY, VOLCENGINE_SECRET_KEY, and VEFAAS_REGION first.");
    if (index === 3) return sandboxProvider === "e2b"
      ? L("请先填写 E2B_API_KEY。", "Enter E2B_API_KEY first.")
      : L("请确认上一步 AK/SK/Region 已填写，并填写 VEFAAS_SANDBOX_FUNCTION_ID 与 VEFAAS_SANDBOX_GATEWAY_URL。", "Confirm AK/SK/Region in the previous step, then enter VEFAAS_SANDBOX_FUNCTION_ID and VEFAAS_SANDBOX_GATEWAY_URL.");
    return L("请按顺序完成前面的步骤。", "Complete previous steps in order.");
  }

  function canSelectStep(index: number) {
    if (index <= step) return true;
    if (index !== step + 1) return false;
    return isStepComplete(step);
  }

  function goToStep(index: number) {
    if (saving || index === step) return;
    if (index <= step) {
      setError("");
      setStep(index);
      return;
    }
    if (index === step + 1 && isStepComplete(step)) {
      setError("");
      setStep(index);
      return;
    }
    setError(stepError(step));
  }

  function nextStep() {
    if (!isStepComplete(step)) {
      setError(stepError(step));
      return;
    }
    setError("");
    setStep(Math.min(4, step + 1));
  }

  async function submit() {
    if (!runtimeCredsFilled) {
      setError("请先在「运行时」步骤填写 VOLCENGINE_ACCESS_KEY、VOLCENGINE_SECRET_KEY 与 VEFAAS_REGION。");
      setStep(2);
      return;
    }
    if (sandboxProvider === "e2b" && !sandboxFilled) {
      setError("请先在「沙箱」步骤填写 E2B_API_KEY。");
      setStep(3);
      return;
    }
    if (sandboxProvider === "vefaas" && !sandboxFilled) {
      setError("请确认「运行时」步骤 AK/SK/Region 已填写，并在「沙箱」步骤填写 VEFAAS_SANDBOX_FUNCTION_ID 与 VEFAAS_SANDBOX_GATEWAY_URL。");
      setStep(3);
      return;
    }
    setSaving(true);
    setError("");
    setProvisionLogs(provisioningPlan());
    const heartbeat = window.setInterval(() => {
      setProvisionLogs((current) => [...current, provisioningLog("info", L("仍在提交云端初始化请求。", "Still submitting cloud provisioning request."))]);
    }, 8000);
    try {
      await props.onSubmit({
        tenantName,
        tenantDescription,
        workspaceName,
        workspaceDescription,
        workspaceSlug: derivedWorkspaceSlug,
        desiredSize,
        minInstances,
        maxInstances,
        maxConcurrency,
        cpuMilli,
        memoryMb,
        modelConfigIds: validModelConfigIds,
        customModelConfigs,
        apiKeyName: apiKeyName.trim() || workspaceApiKeyPlaceholder,
        vefaasAccessKey,
        vefaasSecretKey,
        vefaasRegion,
        sandboxProvider,
        e2bApiKey,
        vefaasSandboxFunctionId,
        vefaasSandboxGatewayUrl,
        vefaasSandboxTimeoutMs,
        sandboxPoolSize
      });
      try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
    } catch (reason) {
      setProvisionLogs((current) => [...current, provisioningLog("err", errorMessage(reason))]);
      setError(errorMessage(reason));
    } finally {
      window.clearInterval(heartbeat);
      setSaving(false);
    }
  }

  function provisioningPlan() {
    return [
      provisioningLog("info", L("创建 tenant、workspace、workspace members 和 Workspace API key。", "Creating tenant, workspace, workspace members, and workspace API key.")),
      provisioningLog("info", L(`初始化 Runtime Pool：${desiredSize} 个 VeFaaS 函数，min=${minInstances}，max=${maxInstances}，concurrency=${maxConcurrency}。`, `Initializing Runtime Pool: ${desiredSize} VeFaaS functions, min=${minInstances}, max=${maxInstances}, concurrency=${maxConcurrency}.`)),
      provisioningLog("info", sandboxProvider === "vefaas"
        ? L(`初始化 Sandbox Pool：${sandboxPoolSize} 个 standby veFaaS 沙箱，TTL 30m。`, `Initializing Sandbox Pool: ${sandboxPoolSize} standby veFaaS sandboxes, TTL 30m.`)
        : L("Sandbox Provider 为 E2B：记录配置，standby veFaaS pool 不创建。", "Sandbox Provider is E2B: storing config; standby veFaaS pool is not created.")),
      provisioningLog("info", L("创建成功后 runtime pool 和 sandbox pool 会在后台继续初始化。", "After creation, the runtime pool and sandbox pool continue provisioning in the background."))
    ];
  }

  function copyIssuedWorkspaceKey() {
    if (!props.issuedWorkspaceKey) return;
    try {
      navigator.clipboard?.writeText(props.issuedWorkspaceKey);
    } catch {
      /* clipboard unavailable */
    }
    toast(L("已复制到剪贴板", "Copied to clipboard"), "ok");
  }

  const slugStatusClass = slugStatus ? (slugStatus.available ? "ok" : slugStatus.reason ?? "invalid") : "";

  return (
    <div className="page-frame">
      <div className="provision wizard">
        <div className="prov-title">
          <Icon name="i-boxes" size={24} />
          <div>
            <h1>{L("开通Maple租户", "Provision Maple tenant")}</h1>
            <p>{[L("租户信息", "Tenant"), L("默认工作区", "Workspace"), L("运行时", "Runtime"), L("沙箱", "Sandbox"), L("模型池与 Workspace API Key", "Model pool & workspace API key")][step]} · {props.currentUser.email}</p>
          </div>
        </div>
        <div className="pv-steps">
          {["Tenant", "Workspace", "Runtime", "Sandbox", "Models"].map((label, index) => (
            <Fragment key={label}>
              {index > 0 ? <span className="pv-sep" /> : null}
              <button className={`pv-step ${step === index ? "active" : step > index ? "done" : ""}`} onClick={() => goToStep(index)} disabled={saving || !canSelectStep(index)}>
                <span className="n">{step > index ? <Icon name="i-check" size={13} /> : index + 1}</span>
                <span className="lb">{label}</span>
              </button>
            </Fragment>
          ))}
        </div>
        <div className="pv-card">
          {error ? <div className="modal-note"><Icon name="i-alert" size={16} /> {error}</div> : null}
          {props.issuedWorkspaceKey ? (
            <div className="modal-note key-issued-note">
              <Icon name="i-check" size={16} />
              <div>
                <b>{L("完整 Workspace API key 已创建", "Full workspace API key issued")}</b>
                <p className="note-copy-once">{L("这是真实可用的完整 key。请立即复制；刷新页面或重新进入后无法再次查看完整密钥。", "This is the real full key. Copy it now; after refresh or re-entry, the full key cannot be viewed again.")}</p>
                <div className="reveal-key compact">
                  <code>{props.issuedWorkspaceKey}</code>
                  <button className="btn secondary compact" onClick={copyIssuedWorkspaceKey}><Icon name="i-copy" size={13} /> {L("复制完整 Key", "Copy full key")}</button>
                </div>
              </div>
            </div>
          ) : null}
          <ProvisioningLogPanel logs={provisionLogs} active={saving} L={L} />

          <WorkspaceOnboardingSteps
            L={L}
            step={step}
            currentUser={props.currentUser}
            modelConfigs={props.modelConfigs}
            tenantName={tenantName}
            setTenantName={setTenantName}
            tenantDescription={tenantDescription}
            setTenantDescription={setTenantDescription}
            workspaceName={workspaceName}
            setWorkspaceName={setWorkspaceName}
            workspaceDescription={workspaceDescription}
            setWorkspaceDescription={setWorkspaceDescription}
            workspaceSlug={workspaceSlug}
            setWorkspaceSlug={setWorkspaceSlug}
            slugStatus={slugStatus}
            slugStatusClass={slugStatusClass}
            inferredWorkspaceSlug={inferredWorkspaceSlug}
            derivedWorkspaceSlug={derivedWorkspaceSlug}
            vefaasAccessKey={vefaasAccessKey}
            setVefaasAccessKey={setVefaasAccessKey}
            vefaasSecretKey={vefaasSecretKey}
            setVefaasSecretKey={setVefaasSecretKey}
            vefaasRegion={vefaasRegion}
            setVefaasRegion={setVefaasRegion}
            desiredSizeInput={desiredSizeInput}
            setDesiredSizeInput={setDesiredSizeInput}
            minInstancesInput={minInstancesInput}
            setMinInstancesInput={setMinInstancesInput}
            maxInstancesInput={maxInstancesInput}
            setMaxInstancesInput={setMaxInstancesInput}
            maxConcurrencyInput={maxConcurrencyInput}
            setMaxConcurrencyInput={setMaxConcurrencyInput}
            cpuMilliInput={cpuMilliInput}
            setCpuMilliInput={setCpuMilliInput}
            memoryMbInput={memoryMbInput}
            setMemoryMbInput={setMemoryMbInput}
            desiredSize={desiredSize}
            minInstances={minInstances}
            maxInstances={maxInstances}
            maxConcurrency={maxConcurrency}
            warmQps={warmQps}
            peakQps={peakQps}
            sandboxProvider={sandboxProvider}
            setSandboxProvider={setSandboxProvider}
            e2bApiKey={e2bApiKey}
            setE2bApiKey={setE2bApiKey}
            vefaasSandboxFunctionId={vefaasSandboxFunctionId}
            setVefaasSandboxFunctionId={setVefaasSandboxFunctionId}
            vefaasSandboxGatewayUrl={vefaasSandboxGatewayUrl}
            setVefaasSandboxGatewayUrl={setVefaasSandboxGatewayUrl}
            vefaasSandboxTimeoutInput={vefaasSandboxTimeoutInput}
            setVefaasSandboxTimeoutInput={setVefaasSandboxTimeoutInput}
            sandboxPoolSizeInput={sandboxPoolSizeInput}
            setSandboxPoolSizeInput={setSandboxPoolSizeInput}
            sandboxPoolSize={sandboxPoolSize}
            modelConfigIds={modelConfigIds}
            toggleModel={toggleModel}
            customModelConfigs={customModelConfigs}
            setCustomModelConfigs={setCustomModelConfigs}
            apiKeyName={apiKeyName}
            setApiKeyName={setApiKeyName}
            workspaceApiKeyPlaceholder={workspaceApiKeyPlaceholder}
          />
        </div>
        <div className="prov-foot">
          {step === 4 ? (
            <span className="prov-note"><Icon name="i-alert" size={14} /> {L("模型配置可跳过，完成开通后仍可在模型页补充。", "Models are optional; you can add them later from Models.")}</span>
          ) : (
            <span className="pv-progress">{L("第", "Step")} {step + 1} / 5</span>
          )}
          <button className="btn secondary" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0 || saving}><Icon name="i-chevron-left" size={14} /> {L("上一步", "Back")}</button>
          {step < 4 ? (
            <button className="btn primary" onClick={nextStep} disabled={saving || !isStepComplete(step)}>{L("下一步", "Next")} <Icon name="i-chevron-right" size={14} /></button>
          ) : (
            <button className="btn primary" onClick={submit} disabled={saving || !tenantName.trim() || !workspaceName.trim() || slugStatus?.available === false}>
              {saving ? <Icon name="i-refresh" size={15} /> : <Icon name="i-key" size={15} />}
              {saving ? L("正在开通...", "Provisioning...") : L("开通Maple租户", "Provision Maple tenant")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
