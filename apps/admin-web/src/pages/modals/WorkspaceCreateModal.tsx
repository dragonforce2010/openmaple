import { Fragment, useState } from "react";
import { apiPost } from "../../api";
import type { ModelConfig, Workspace, WorkspaceApiKey } from "../../types";
import { Icon, useToast } from "../../ui";
import { useI18n } from "../../appConfig";
import { Select } from "../../components/shared/forms";
import { WS_COLORS } from "../../components/shared/labels";
import { ModalShell } from "../../components/shared/layout";
import { slugify } from "../../components/shared/misc";
import { MAX_RUNTIME_CONCURRENCY, MAX_RUNTIME_INSTANCES, clampNumber } from "./modalConfig";
import { WorkspaceCreateSandboxStep } from "./WorkspaceCreateSandboxStep";
import { ProvisioningLogPanel, provisioningLog, type ProvisioningLog } from "../workspaces/ProvisioningLogPanel";

export function WorkspaceCreateModal(props: { onClose: () => void; onCreated: (workspaceId: string, apiKey: string) => void; modelConfigs: ModelConfig[]; tenantId?: string }) {
  const { language } = useI18n();
  const toast = useToast();
  const L = (zh: string, en: string) => (language === "zh" ? zh : en);

  const steps = [
    [L("基本信息", "Basic")],
    [L("运行时", "Runtime")],
    [L("沙箱", "Sandbox")],
    [L("模型池", "Models")],
    [L("成员", "Members")]
  ];
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [slug, setSlug] = useState("");
  const [color, setColor] = useState(WS_COLORS[5] ?? WS_COLORS[0]);
  const [vefaasAccessKey, setVefaasAccessKey] = useState("");
  const [vefaasSecretKey, setVefaasSecretKey] = useState("");
  const [vefaasRegion, setVefaasRegion] = useState("cn-beijing");
  const [sandboxProvider, setSandboxProvider] = useState<"e2b" | "vefaas">("e2b");
  const [e2bApiKey, setE2bApiKey] = useState("");
  const [vefaasSandboxFunctionId, setVefaasSandboxFunctionId] = useState("");
  const [vefaasSandboxGatewayUrl, setVefaasSandboxGatewayUrl] = useState("");
  const [vefaasSandboxTimeoutMs, setVefaasSandboxTimeoutMs] = useState(3_600_000);
  const [sandboxPoolSize, setSandboxPoolSize] = useState(1);
  const [desiredSize, setDesiredSize] = useState(3);
  const [minInstances, setMinInstances] = useState(1);
  const [maxInstances, setMaxInstances] = useState(100);
  const [maxConcurrency, setMaxConcurrency] = useState(MAX_RUNTIME_CONCURRENCY);
  const [cpuMilli, setCpuMilli] = useState(2000);
  const [memoryMb, setMemoryMb] = useState(4096);
  const [apiKeyName, setApiKeyName] = useState("");
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>(() => {
    const defaults = props.modelConfigs.filter((config) => config.is_default).map((config) => config.id);
    return defaults.length ? defaults : props.modelConfigs.slice(0, 1).map((config) => config.id);
  });
  const [memberDraft, setMemberDraft] = useState("");
  const [memberEmails, setMemberEmails] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [provisionLogs, setProvisionLogs] = useState<ProvisioningLog[]>([]);

  const normalizedSlug = slug.trim() || (name.trim() ? slugify(name.trim()) : "");
  const apiKeyPlaceholder = `${name.trim() || L("workspace 名称", "workspace-name")}-apikey`;

  const runtimeCredsFilled = Boolean(vefaasAccessKey.trim() && vefaasSecretKey.trim() && vefaasRegion.trim());
  const sandboxFilled = sandboxProvider === "e2b"
    ? Boolean(e2bApiKey.trim())
    : Boolean(vefaasSandboxFunctionId.trim() && vefaasSandboxGatewayUrl.trim());
  const credsFilled = runtimeCredsFilled && sandboxFilled;

  const slugTooShort = Boolean(slug.trim()) && slug.trim().length < 3;

  function isStepComplete(index: number) {
    if (index === 0) return Boolean(name.trim()) && !slugTooShort;
    if (index === 1) return runtimeCredsFilled;
    if (index === 2) return sandboxFilled;
    return true;
  }

  function canAdvance() {
    return isStepComplete(step);
  }

  function stepError(index: number) {
    if (index === 1) return L("请填写 VeFaaS AK/SK 与 Region。", "VeFaaS AK/SK and region are required.");
    if (index === 2) return sandboxProvider === "vefaas"
      ? L("请确认上一步 AK/SK/Region 已填写，并完成 VeFaaS sandbox 配置。", "Confirm AK/SK/Region in the previous step and complete VeFaaS sandbox configuration.")
      : L("请完成沙箱配置。", "Sandbox configuration is required.");
    if (slugTooShort) return L("标识至少 3 个字符，或留空自动生成。", "Slug needs at least 3 characters, or leave it empty.");
    return L("请填写工作区名称。", "Workspace name is required.");
  }

  function next() {
    if (!canAdvance()) {
      setError(stepError(step));
      return;
    }
    setError("");
    setStep((value) => Math.min(value + 1, steps.length - 1));
  }

  function canSelectStep(index: number) {
    if (index <= step) return true;
    if (index !== step + 1) return false;
    return canAdvance();
  }

  function goToStep(index: number) {
    if (busy || index === step) return;
    if (index <= step) {
      setError("");
      setStep(index);
      return;
    }
    if (index === step + 1) {
      next();
      return;
    }
    setError(L("请按顺序完成前面的步骤。", "Complete previous steps in order."));
  }

  function toggleModel(id: string) {
    setSelectedModelIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function addMemberEmail() {
    const email = memberDraft.trim().toLowerCase();
    if (!email) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError(L("请输入有效邮箱。", "Enter a valid email."));
      return;
    }
    setMemberEmails((current) => current.includes(email) ? current : [...current, email]);
    setMemberDraft("");
    setError("");
  }

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(L("请填写工作区名称。", "Workspace name is required."));
      return;
    }
    if (!credsFilled) {
      setError(!runtimeCredsFilled
        ? L("请填写 VeFaaS AK/SK 与 Region。", "VeFaaS AK/SK and region are required.")
        : sandboxProvider === "vefaas"
          ? L("请确认 AK/SK/Region 已填写，并完成 VeFaaS sandbox 配置。", "Confirm AK/SK/Region and complete VeFaaS sandbox configuration.")
          : L("请完成沙箱配置。", "Sandbox configuration is required."));
      setStep(runtimeCredsFilled ? 2 : 1);
      return;
    }
    setBusy(true);
    setError("");
    setProvisionLogs(provisioningPlan());
    const heartbeat = window.setInterval(() => {
      setProvisionLogs((current) => [...current, provisioningLog("info", L("仍在提交云端初始化请求。", "Still submitting cloud provisioning request."))]);
    }, 8000);
    try {
      const result = await apiPost<{ workspace: Workspace; api_key: WorkspaceApiKey }>("/v1/workspaces", {
        tenant_id: props.tenantId || undefined,
        workspace: { name: trimmed, description: description.trim(), slug: slug.trim() ? normalizedSlug : undefined },
        runtime_provider: "vefaas",
        sandbox_provider: sandboxProvider,
        sandbox_config: sandboxProvider === "vefaas"
          ? {
              vefaas: {
                function_id: vefaasSandboxFunctionId.trim(),
                gateway_url: vefaasSandboxGatewayUrl.trim(),
                timeout_ms: vefaasSandboxTimeoutMs,
                workspace_path: "/home/tiger/workspace"
              }
            }
          : {},
        sandbox_pool: { desired_size: sandboxPoolSize, standby_ttl_ms: 30 * 60 * 1000 },
        runtime_pool: {
          desired_size: desiredSize,
          min_instances_per_function: minInstances,
          max_instances_per_function: maxInstances,
          max_concurrency_per_instance: maxConcurrency,
          cpu_milli: cpuMilli,
          memory_mb: memoryMb
        },
        model_config_ids: selectedModelIds,
        member_emails: memberEmails,
        api_key: { display_name: apiKeyName.trim() || apiKeyPlaceholder, scopes: ["control_plane", "data_plane"] },
        provider_credentials: {
          vefaas: { VOLCENGINE_ACCESS_KEY: vefaasAccessKey.trim(), VOLCENGINE_SECRET_KEY: vefaasSecretKey.trim(), VEFAAS_REGION: vefaasRegion.trim() },
          e2b: sandboxProvider === "e2b" ? { E2B_API_KEY: e2bApiKey.trim() } : {}
        }
      });
      toast(L("工作区已创建", "Workspace created"), "ok");
      props.onCreated(result.workspace.id, result.api_key.key ?? "");
    } catch (err) {
      const message = err instanceof Error ? err.message : L("创建失败，请稍后重试。", "Failed to create workspace.");
      setProvisionLogs((current) => [...current, provisioningLog("err", message)]);
      setError(message);
      setBusy(false);
    } finally {
      window.clearInterval(heartbeat);
    }
  }

  function provisioningPlan() {
    return [
      provisioningLog("info", L("创建 workspace、workspace members 和 Workspace API key。", "Creating workspace, workspace members, and workspace API key.")),
      provisioningLog("info", L(`初始化 Runtime Pool：${desiredSize} 个 VeFaaS 函数，min=${minInstances}，max=${maxInstances}，concurrency=${maxConcurrency}。`, `Initializing Runtime Pool: ${desiredSize} VeFaaS functions, min=${minInstances}, max=${maxInstances}, concurrency=${maxConcurrency}.`)),
      provisioningLog("info", sandboxProvider === "vefaas"
        ? L(`初始化 Sandbox Pool：${sandboxPoolSize} 个 standby veFaaS 沙箱，TTL 30m。`, `Initializing Sandbox Pool: ${sandboxPoolSize} standby veFaaS sandboxes, TTL 30m.`)
        : L("Sandbox Provider 为 E2B：记录配置，standby veFaaS pool 不创建。", "Sandbox Provider is E2B: storing config; standby veFaaS pool is not created.")),
      provisioningLog("info", L("创建成功后 runtime pool 和 sandbox pool 会在后台继续初始化。", "After creation, the runtime pool and sandbox pool continue provisioning in the background."))
    ];
  }

  return (
    <ModalShell title={L("新建工作区", "Create workspace")} onClose={busy ? () => undefined : props.onClose} wide className="workspace-create-modal">
      <p className="modal-sub">{L("按步骤配置基本信息、运行时、模型池和工作区成员。", "Configure basic info, runtime, model pool, and workspace members.")}</p>
      <div className="pv-steps">
        {steps.map(([label], index) => (
          <Fragment key={label}>
            <button type="button" className={`pv-step${step === index ? " active" : ""}${step > index ? " done" : ""}`} onClick={() => goToStep(index)} disabled={busy || !canSelectStep(index)}>
              <span className="n">{step > index ? <Icon name="i-check" size={13} /> : index + 1}</span>
              <span className="lb">{label}</span>
            </button>
            {index < steps.length - 1 ? <span className="pv-sep" /> : null}
          </Fragment>
        ))}
      </div>

      {error ? <div className="modal-note"><Icon name="i-alert" size={16} /> {error}</div> : null}
      <ProvisioningLogPanel logs={provisionLogs} active={busy} L={L} />

      {step === 0 ? (
        <div className="provision-step">
          <label className="form">
            {L("名称", "Name")}
            <input
              className="fld"
              value={name}
              onChange={(event) => { setName(event.target.value); if (error) setError(""); }}
              placeholder={L("例如 Dev Shared Workspace", "e.g. Dev Shared Workspace")}
              autoFocus
            />
          </label>
          <label className="form">{L("描述", "Description")}<textarea className="fld" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder={L("可选", "Optional")} /></label>
          <label className="form">{L("标识", "Slug")}<input className="fld mono" value={slug} onChange={(event) => setSlug(event.target.value.trim() ? slugify(event.target.value) : "")} placeholder={normalizedSlug || "workspace-slug"} /></label>
          <div className="form">
            <span className="flabel-in">{L("颜色", "Color")}</span>
            <div className="sw-grid">
              {WS_COLORS.map((c, index) => (
                <button key={index} type="button" className={`sw${c === color ? " on" : ""}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={`color ${index + 1}`} />
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="provision-step">
          <div className="ro-provider">
            <span className="rop-ic"><Icon name="i-cloud" size={18} /></span>
            <span className="rop-main"><b>VeFaaS</b><span>{L("Agent 运行时 provider", "Agent runtime provider")}</span></span>
            <span className="ro-lock">{L("固定", "Locked")}</span>
          </div>
          <div className="cred-box">
            <div className="cred-head"><Icon name="i-key" size={14} /> VeFaaS {L("凭据", "credentials")}</div>
            <label className="form">VOLCENGINE_ACCESS_KEY<input className="fld" value={vefaasAccessKey} autoComplete="off" placeholder="VOLCENGINE_ACCESS_KEY" onChange={(event) => { setVefaasAccessKey(event.target.value); if (error) setError(""); }} /></label>
            <label className="form">VOLCENGINE_SECRET_KEY<input className="fld" type="password" value={vefaasSecretKey} autoComplete="off" placeholder="VOLCENGINE_SECRET_KEY" onChange={(event) => { setVefaasSecretKey(event.target.value); if (error) setError(""); }} /></label>
            <label className="form">VEFAAS_REGION
              <Select
                value={vefaasRegion}
                options={[
                  { value: "cn-beijing", label: "cn-beijing" },
                  { value: "cn-shanghai", label: "cn-shanghai" },
                  { value: "cn-guangzhou", label: "cn-guangzhou" },
                  { value: "ap-southeast-1", label: "ap-southeast-1" }
                ]}
                onChange={setVefaasRegion}
              />
            </label>
          </div>
          <div className="pool-grid two">
            <label className="form">{L("预热函数数", "Prewarm")}<input className="fld" type="number" min={0} value={desiredSize} onChange={(event) => setDesiredSize(Number(event.target.value))} /></label>
            <label className="form">{L("单函数最小实例", "Min instances")}<input className="fld" type="number" min={0} max={MAX_RUNTIME_INSTANCES} value={minInstances} onChange={(event) => setMinInstances(clampNumber(Number(event.target.value), 0, MAX_RUNTIME_INSTANCES))} /></label>
            <label className="form">{L("单函数最大实例", "Max instances")}<input className="fld" type="number" min={1} max={MAX_RUNTIME_INSTANCES} value={maxInstances} onChange={(event) => setMaxInstances(clampNumber(Number(event.target.value), 1, MAX_RUNTIME_INSTANCES))} /></label>
            <label className="form">{L("单实例并发", "Concurrency")}<input className="fld" type="number" min={1} max={MAX_RUNTIME_CONCURRENCY} value={maxConcurrency} onChange={(event) => setMaxConcurrency(clampNumber(Number(event.target.value), 1, MAX_RUNTIME_CONCURRENCY))} /></label>
            <label className="form">{L("CPU 毫核", "CPU milli")}<input className="fld" type="number" min={250} value={cpuMilli} onChange={(event) => setCpuMilli(Number(event.target.value))} /></label>
            <label className="form">{L("内存 (MB)", "Memory MB")}<input className="fld" type="number" min={512} value={memoryMb} onChange={(event) => setMemoryMb(Number(event.target.value))} /></label>
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <WorkspaceCreateSandboxStep
          L={L}
          error={error}
          setError={setError}
          sandboxProvider={sandboxProvider}
          setSandboxProvider={setSandboxProvider}
          e2bApiKey={e2bApiKey}
          setE2bApiKey={setE2bApiKey}
          vefaasSandboxFunctionId={vefaasSandboxFunctionId}
          setVefaasSandboxFunctionId={setVefaasSandboxFunctionId}
          vefaasSandboxGatewayUrl={vefaasSandboxGatewayUrl}
          setVefaasSandboxGatewayUrl={setVefaasSandboxGatewayUrl}
          vefaasSandboxTimeoutMs={vefaasSandboxTimeoutMs}
          setVefaasSandboxTimeoutMs={setVefaasSandboxTimeoutMs}
          sandboxPoolSize={sandboxPoolSize}
          setSandboxPoolSize={setSandboxPoolSize}
        />
      ) : null}

      {step === 3 ? (
        <div className="provision-step">
          <p className="modal-fine">{L("模型池为可选项；不选择时仍可创建工作区，之后可在模型管理中添加。", "Model pool is optional. You can create the workspace first and add models later.")}</p>
          <div className="mp-list">
            {props.modelConfigs.map((config) => (
              <button type="button" className={`mp-row selectable${selectedModelIds.includes(config.id) ? " on" : ""}`} key={config.id} onClick={() => toggleModel(config.id)}>
                <input type="checkbox" checked={selectedModelIds.includes(config.id)} readOnly />
                <span className="mp-main"><b>{config.name}</b><span>{config.provider_type} · {config.model_name}</span></span>
                {config.is_default ? <span className="status active">{L("默认", "default")}</span> : null}
              </button>
            ))}
            {!props.modelConfigs.length ? <div className="ce-empty">{L("暂无可选模型，可先跳过。", "No models available; you can skip this step.")}</div> : null}
          </div>
        </div>
      ) : null}

      {step === 4 ? (
        <div className="provision-step">
          <p className="modal-fine">{L("你将自动成为该工作区成员。可选：添加其他成员邮箱，会预创建用户并加入该工作区，用户登录后自动补全姓名。", "You join this workspace automatically. Optionally add other member emails to pre-create users; names are filled after sign-in.")}</p>
          <label className="form">{L("Workspace API Key 名称", "Workspace API key name")}<input className="fld" value={apiKeyName} onChange={(event) => setApiKeyName(event.target.value)} placeholder={apiKeyPlaceholder} /></label>
          <div className="chip-input">
            <span className="chips">
              {memberEmails.map((email) => (
                <span className="chip" key={email}>{email}<button type="button" onClick={() => setMemberEmails((current) => current.filter((item) => item !== email))}><Icon name="i-x" size={12} /></button></span>
              ))}
            </span>
            <input className="chip-field" value={memberDraft} onChange={(event) => setMemberDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addMemberEmail(); } }} placeholder={L("输入邮箱后回车", "Enter email and press Enter")} />
            <button type="button" className="btn secondary compact" onClick={addMemberEmail}>{L("添加", "Add")}</button>
          </div>
        </div>
      ) : null}

      <div className="modal-foot">
        <button className="btn secondary" onClick={props.onClose} disabled={busy}>{L("取消", "Cancel")}</button>
        <button className="btn secondary" onClick={() => setStep((value) => Math.max(0, value - 1))} disabled={busy || step === 0}>{L("上一步", "Back")}</button>
        {step < steps.length - 1 ? (
          <button className="btn primary" onClick={next} disabled={busy || !canAdvance()}>{L("下一步", "Next")}</button>
        ) : (
          <button className="btn primary" onClick={submit} disabled={busy || !name.trim() || !credsFilled}>{busy ? L("创建中…", "Creating…") : L("创建工作区", "Create workspace")}</button>
        )}
      </div>
    </ModalShell>
  );
}
