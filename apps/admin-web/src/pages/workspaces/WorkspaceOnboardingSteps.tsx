import type * as React from "react";
import type { OnboardingCustomModelConfig } from "../../appConfig";
import { Select } from "../../components/shared/forms";
import { slugReasonLabel } from "../../components/shared/misc";
import type { ModelConfig, User, WorkspaceSlugStatus } from "../../types";
import { Icon } from "../../ui";
import { OnboardingCustomModelConfigForm } from "./OnboardingCustomModelConfigForm";
import {
  MAX_RUNTIME_CONCURRENCY,
  MAX_RUNTIME_INSTANCES,
  MAX_SANDBOX_POOL_SIZE,
  type OnboardingRuntimeProvider,
  type OnboardingSandboxProvider,
  boundedIntString
} from "./WorkspaceOnboardingConfig";

type LFn = (zh: string, en: string) => string;

export function WorkspaceOnboardingSteps(props: {
  L: LFn;
  step: number;
  currentUser: User;
  modelConfigs: ModelConfig[];
  tenantName: string;
  setTenantName: (value: string) => void;
  tenantDescription: string;
  setTenantDescription: (value: string) => void;
  workspaceName: string;
  setWorkspaceName: (value: string) => void;
  workspaceDescription: string;
  setWorkspaceDescription: (value: string) => void;
  workspaceSlug: string;
  setWorkspaceSlug: (value: string) => void;
  slugStatus: WorkspaceSlugStatus | null;
  slugStatusClass: string;
  inferredWorkspaceSlug: string;
  derivedWorkspaceSlug: string;
  vefaasAccessKey: string;
  setVefaasAccessKey: (value: string) => void;
  vefaasSecretKey: string;
  setVefaasSecretKey: (value: string) => void;
  vefaasRegion: string;
  setVefaasRegion: (value: string) => void;
  desiredSizeInput: string;
  setDesiredSizeInput: (value: string) => void;
  minInstancesInput: string;
  setMinInstancesInput: (value: string) => void;
  maxInstancesInput: string;
  setMaxInstancesInput: (value: string) => void;
  maxConcurrencyInput: string;
  setMaxConcurrencyInput: (value: string) => void;
  cpuMilliInput: string;
  setCpuMilliInput: (value: string) => void;
  memoryMbInput: string;
  setMemoryMbInput: (value: string) => void;
  desiredSize: number;
  minInstances: number;
  maxInstances: number;
  maxConcurrency: number;
  warmQps: number;
  peakQps: number;
  runtimeProvider: OnboardingRuntimeProvider;
  setRuntimeProvider: (value: OnboardingRuntimeProvider) => void;
  sandboxProvider: OnboardingSandboxProvider;
  setSandboxProvider: (value: OnboardingSandboxProvider) => void;
  e2bApiKey: string;
  setE2bApiKey: (value: string) => void;
  vefaasSandboxFunctionId: string;
  setVefaasSandboxFunctionId: (value: string) => void;
  vefaasSandboxGatewayUrl: string;
  setVefaasSandboxGatewayUrl: (value: string) => void;
  vefaasSandboxTimeoutInput: string;
  setVefaasSandboxTimeoutInput: (value: string) => void;
  sandboxPoolSizeInput: string;
  setSandboxPoolSizeInput: (value: string) => void;
  sandboxPoolSize: number;
  modelConfigIds: string[];
  toggleModel: (id: string) => void;
  customModelConfigs: OnboardingCustomModelConfig[];
  setCustomModelConfigs: React.Dispatch<React.SetStateAction<OnboardingCustomModelConfig[]>>;
  apiKeyName: string;
  setApiKeyName: (value: string) => void;
  workspaceApiKeyPlaceholder: string;
}) {
  const L = props.L;
  if (props.step === 0) {
    return (
      <>
        <div className="cfg-head"><Icon name="i-boxes" size={16} /> <b>{L("租户信息", "Tenant")}</b></div>
        <label className="form">{L("租户名称", "Tenant name")}<input className="fld" value={props.tenantName} onChange={(event) => props.setTenantName(event.target.value)} placeholder={`${props.currentUser.name} 的租户`} /></label>
        <label className="form">{L("管理员", "Administrator")}<input className="fld" value={`${props.currentUser.name} · ${props.currentUser.email}`} readOnly /></label>
        <label className="form">{L("租户描述", "Tenant description")}<textarea className="fld" value={props.tenantDescription} onChange={(event) => props.setTenantDescription(event.target.value)} placeholder="Managed agents tenant" /></label>
      </>
    );
  }
  if (props.step === 1) {
    return (
      <>
        <div className="cfg-head"><Icon name="i-grid" size={16} /> <b>{L("默认工作区", "Default workspace")}</b></div>
        <label className="form">{L("工作区名称", "Workspace name")}<input className="fld" value={props.workspaceName} onChange={(event) => props.setWorkspaceName(event.target.value)} placeholder={L("默认工作区", "Default workspace")} /></label>
        <label className="form">{L("工作区描述", "Workspace description")}<input className="fld" value={props.workspaceDescription} onChange={(event) => props.setWorkspaceDescription(event.target.value)} placeholder={L("承载 Agent、Session、Environment 和运行时池。", "Holds agents, sessions, environments, and runtime pools.")} /></label>
        <label className="form">{L("工作区 slug", "Workspace slug")}
          <input className={`fld ${props.slugStatus && !props.slugStatus.available ? "invalid" : ""}`} value={props.workspaceSlug} onChange={(event) => props.setWorkspaceSlug(event.target.value)} placeholder={props.inferredWorkspaceSlug || "workspace-slug"} autoComplete="off" />
          <div className={`slug-status ${props.slugStatusClass}`}>
            {props.slugStatus ? (
              <>
                <Icon name={props.slugStatus.available ? "i-check" : props.slugStatus.reason === "taken" ? "i-x" : "i-alert"} size={14} />
                {props.slugStatus.available ? L("Slug 可用", "Slug available") : slugReasonLabel(props.slugStatus.reason)}
              </>
            ) : L("输入 slug 后校验", "Validated after you type a slug")}
          </div>
          <div className="slug-url">{L("后台登录地址", "Console URL")}：<span className="mono">{props.slugStatus?.console_url ?? `http://localhost:6789/t/${props.derivedWorkspaceSlug || "workspace"}/w/${props.derivedWorkspaceSlug || "workspace"}`}</span></div>
        </label>
      </>
    );
  }
  if (props.step === 2) {
    return (
      <>
        <div className="cfg-head"><Icon name="i-cloud" size={16} /> <b>{L("运行时 Provider", "Runtime provider")}</b></div>
        <div className="cfg-cards">
          <button type="button" className={`prov-card ${props.runtimeProvider === "local_docker" ? "on" : ""}`} onClick={() => props.setRuntimeProvider("local_docker")}><div className="pc-ic"><Icon name="i-server" size={18} /></div><b>Local Docker</b><span>{L("本地容器运行时", "Local container runtime")}</span>{props.runtimeProvider === "local_docker" ? <span className="pc-check"><Icon name="i-check" size={15} /></span> : null}</button>
          <button type="button" className={`prov-card ${props.runtimeProvider === "vefaas" ? "on" : ""}`} onClick={() => props.setRuntimeProvider("vefaas")}><div className="pc-ic"><Icon name="i-cloud" size={18} /></div><b>VeFaaS</b><span>{L("云端 Agent 运行时", "Cloud agent runtime")}</span>{props.runtimeProvider === "vefaas" ? <span className="pc-check"><Icon name="i-check" size={15} /></span> : null}</button>
          <div className="prov-card disabled" aria-disabled="true" title={L("敬请期待", "Coming soon")}><div className="pc-ic"><Icon name="i-cloud" size={18} /></div><b>AWS Lambda</b><span>{L("敬请期待", "Coming soon")}</span></div>
        </div>
        {props.runtimeProvider === "vefaas" ? <div className="cred-box">
          <div className="cred-head"><Icon name="i-key" size={14} /> VeFaaS {L("凭据", "credentials")}</div>
          <label className="form">VOLCENGINE_ACCESS_KEY<input className="fld" value={props.vefaasAccessKey} autoComplete="off" placeholder="VOLCENGINE_ACCESS_KEY" onChange={(event) => props.setVefaasAccessKey(event.target.value)} /></label>
          <label className="form">VOLCENGINE_SECRET_KEY<input className="fld" type="password" value={props.vefaasSecretKey} autoComplete="off" placeholder="VOLCENGINE_SECRET_KEY" onChange={(event) => props.setVefaasSecretKey(event.target.value)} /></label>
          <label className="form">VEFAAS_REGION
            <Select value={props.vefaasRegion} options={[{ value: "cn-beijing", label: "cn-beijing" }, { value: "cn-shanghai", label: "cn-shanghai" }, { value: "cn-guangzhou", label: "cn-guangzhou" }, { value: "ap-southeast-1", label: "ap-southeast-1" }]} onChange={props.setVefaasRegion} />
          </label>
        </div> : <div className="cred-box"><div className="cred-head"><Icon name="i-server" size={14} /> Local Docker</div><div className="panel-empty">{L("无需云账号。Docker Compose 会挂载本机 Docker daemon，并用 node:22-bookworm 启动运行时容器。", "No cloud account required. Docker Compose mounts the local Docker daemon and starts runtime containers from node:22-bookworm.")}</div></div>}
        <div className="cfg-head"><Icon name="i-gauge" size={16} /> <b>{L("运行时池配置", "Runtime pool")}</b></div>
        {props.runtimeProvider === "local_docker" ? (
          <>
            <label className="form">{L("预热 Runtime 数", "Prewarmed runtimes")}<input className="fld" type="number" min={1} step={1} value={props.desiredSizeInput} onChange={(event) => props.setDesiredSizeInput(event.target.value)} /></label>
            <div className="qps-estimate"><div><span>{L("池化目标", "Pool target")}</span><b>{props.desiredSize}</b><small>{L("本机 Docker runtime member，按需绑定 Session。", "Local Docker runtime members are bound to sessions on demand.")}</small></div></div>
          </>
        ) : (
          <>
            <div className="pool-grid">
              <label className="form">{L("预热函数数", "Prewarmed functions")}<input className="fld" type="number" min={1} step={1} value={props.desiredSizeInput} onChange={(event) => props.setDesiredSizeInput(event.target.value)} /></label>
              <label className="form">{L("单函数最小实例", "Min instances per function")}<input className="fld" type="number" min={0} max={MAX_RUNTIME_INSTANCES} step={1} value={props.minInstancesInput} onChange={(event) => props.setMinInstancesInput(boundedIntString(event.target.value, 0, MAX_RUNTIME_INSTANCES))} /></label>
              <label className="form">{L("单函数最大实例", "Max instances per function")}<input className="fld" type="number" min={1} max={MAX_RUNTIME_INSTANCES} step={1} value={props.maxInstancesInput} onChange={(event) => props.setMaxInstancesInput(boundedIntString(event.target.value, 1, MAX_RUNTIME_INSTANCES))} /></label>
              <label className="form">{L("单实例并发", "Concurrency per instance")}<input className="fld" type="number" min={1} max={MAX_RUNTIME_CONCURRENCY} step={1} value={props.maxConcurrencyInput} onChange={(event) => props.setMaxConcurrencyInput(boundedIntString(event.target.value, 1, MAX_RUNTIME_CONCURRENCY))} /></label>
              <label className="form">CPU Milli<input className="fld" type="number" min={250} step={250} value={props.cpuMilliInput} onChange={(event) => props.setCpuMilliInput(event.target.value)} /></label>
              <label className="form">Memory MB<input className="fld" type="number" min={512} step={128} value={props.memoryMbInput} onChange={(event) => props.setMemoryMbInput(event.target.value)} /></label>
            </div>
            <div className="qps-estimate">
              <div><span>{L("预热容量估算", "Warm capacity estimate")}</span><b>{props.warmQps.toLocaleString()} QPS</b><small>{props.desiredSize} × {props.minInstances} × {props.maxConcurrency}</small></div>
              <div><span>{L("峰值容量估算", "Peak capacity estimate")}</span><b>{props.peakQps.toLocaleString()} QPS</b><small>{props.desiredSize} × {props.maxInstances} × {props.maxConcurrency}</small></div>
            </div>
          </>
        )}
      </>
    );
  }
  if (props.step === 3) {
    return (
      <>
        <div className="cfg-head"><Icon name="i-server" size={16} /> <b>{L("沙箱 Provider", "Sandbox provider")}</b></div>
        <div className="cfg-cards">
          <button type="button" className={`prov-card ${props.sandboxProvider === "local_docker" ? "on" : ""}`} onClick={() => props.setSandboxProvider("local_docker")}><div className="pc-ic"><Icon name="i-server" size={18} /></div><b>Local Docker</b><span>{L("本地容器沙箱", "Local container sandbox")}</span>{props.sandboxProvider === "local_docker" ? <span className="pc-check"><Icon name="i-check" size={15} /></span> : null}</button>
          <button type="button" className={`prov-card ${props.sandboxProvider === "e2b" ? "on" : ""}`} onClick={() => props.setSandboxProvider("e2b")}><div className="pc-ic"><Icon name="i-server" size={18} /></div><b>E2B</b><span>{L("E2B 云沙箱", "E2B cloud sandbox")}</span>{props.sandboxProvider === "e2b" ? <span className="pc-check"><Icon name="i-check" size={15} /></span> : null}</button>
          <button type="button" className={`prov-card ${props.sandboxProvider === "vefaas" ? "on" : ""}`} onClick={() => props.setSandboxProvider("vefaas")}><div className="pc-ic"><Icon name="i-cloud" size={18} /></div><b>VeFaaS</b><span>{L("火山云沙箱", "Volcengine cloud sandbox")}</span>{props.sandboxProvider === "vefaas" ? <span className="pc-check"><Icon name="i-check" size={15} /></span> : null}</button>
        </div>
        {props.sandboxProvider === "local_docker" ? (
          <div className="cred-box"><div className="cred-head"><Icon name="i-server" size={14} /> Local Docker Sandbox</div><div className="panel-empty">{L("无需 API Key。沙箱池会在本机 Docker 上按需领取容器，并挂载每个 Session 的工作目录。", "No API key required. The sandbox pool claims local Docker containers on demand and mounts each session workspace.")}</div></div>
        ) : props.sandboxProvider === "e2b" ? (
          <div className="cred-box"><div className="cred-head"><Icon name="i-key" size={14} /> E2B {L("凭据", "credentials")}</div><label className="form">E2B_API_KEY<input className="fld" type="password" value={props.e2bApiKey} autoComplete="off" placeholder="E2B_API_KEY" onChange={(event) => props.setE2bApiKey(event.target.value)} /></label></div>
        ) : (
          <div className="cred-box">
            <div className="cred-head"><Icon name="i-key" size={14} /> VeFaaS Sandbox</div>
            <label className="form">VEFAAS_SANDBOX_FUNCTION_ID<input className="fld" value={props.vefaasSandboxFunctionId} autoComplete="off" placeholder="vefaas sandbox function id" onChange={(event) => props.setVefaasSandboxFunctionId(event.target.value)} /></label>
            <label className="form">VEFAAS_SANDBOX_GATEWAY_URL<input className="fld" value={props.vefaasSandboxGatewayUrl} autoComplete="off" placeholder="https://your-sandbox-app.example.com" onChange={(event) => props.setVefaasSandboxGatewayUrl(event.target.value)} /></label>
            <label className="form">VEFAAS_SANDBOX_TIMEOUT_MS<input className="fld" type="number" min={60000} step={60000} value={props.vefaasSandboxTimeoutInput} onChange={(event) => props.setVefaasSandboxTimeoutInput(event.target.value)} /></label>
          </div>
        )}
        <div className="cfg-head"><Icon name="i-gauge" size={16} /> <b>{L("沙箱池配置", "Sandbox pool")}</b></div>
        <label className="form">{L("备用沙箱数", "Standby sandboxes")}<input className="fld" type="number" min={1} max={MAX_SANDBOX_POOL_SIZE} step={1} value={props.sandboxPoolSizeInput} onChange={(event) => props.setSandboxPoolSizeInput(boundedIntString(event.target.value, 1, MAX_SANDBOX_POOL_SIZE))} /></label>
        <div className="qps-estimate"><div><span>{L("池化目标", "Pool target")}</span><b>{props.sandboxPoolSize}</b><small>{L("每个备用沙箱生命周期 30 分钟", "Each standby sandbox lives for 30 minutes")}</small></div></div>
      </>
    );
  }
  return (
    <>
      <div className="cfg-head"><Icon name="i-brain" size={16} /> <b>{L("模型池", "Model pool")} <span className="opt-tag">{L("可选", "Optional")}</span></b></div>
      {props.modelConfigs.length ? (
        <div className="mp-list">
          {props.modelConfigs.map((config) => (
            <label className={`mp-row ${props.modelConfigIds.includes(config.id) ? "on" : ""}`} key={config.id}>
              <input type="checkbox" checked={props.modelConfigIds.includes(config.id)} onChange={() => props.toggleModel(config.id)} />
              <div className="mp-main"><b>{config.name}</b><span>{config.model_name}</span></div>
            </label>
          ))}
        </div>
      ) : <div className="panel-empty">{L("暂无可选模型，可直接跳过或添加自定义模型。", "No preset models available. Skip this step or add a custom model.")}</div>}
      {props.customModelConfigs.length ? (
        <div className="mp-list custom-model-picks">
          {props.customModelConfigs.map((config) => (
            <div className="mp-row custom" key={config.local_id}>
              <Icon name="i-brain" size={16} />
              <div className="mp-main"><b>{config.name}</b><span>{config.model_name} · {config.base_url}</span></div>
              {config.is_default ? <span className="status active">{L("默认", "default")}</span> : null}
              <button type="button" className="icon-btn" title={L("移除", "Remove")} onClick={() => props.setCustomModelConfigs((current) => current.filter((item) => item.local_id !== config.local_id))}><Icon name="i-x" size={14} /></button>
            </div>
          ))}
        </div>
      ) : null}
      <OnboardingCustomModelConfigForm onAdd={(config) => props.setCustomModelConfigs((current) => [...current, config])} />
      <label className="form">{L("Workspace API Key 名称", "Workspace API key name")}<input className="fld" value={props.apiKeyName} onChange={(event) => props.setApiKeyName(event.target.value)} placeholder={props.workspaceApiKeyPlaceholder} /></label>
    </>
  );
}
