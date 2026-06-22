import { useState } from "react";
import { Icon } from "../../ui";
import { MAX_SANDBOX_POOL_SIZE } from "../workspaces/WorkspaceOnboardingConfig";

type LFn = (zh: string, en: string) => string;

export function WorkspaceCreateSandboxStep(props: {
  L: LFn;
  error: string;
  setError: (value: string) => void;
  sandboxProvider: "e2b" | "daytona" | "vefaas" | "aliyun_fc";
  setSandboxProvider: (value: "e2b" | "daytona" | "vefaas" | "aliyun_fc") => void;
  standbySandboxProvider: "" | "e2b" | "daytona" | "vefaas" | "aliyun_fc";
  setStandbySandboxProvider: (value: "" | "e2b" | "daytona" | "vefaas" | "aliyun_fc") => void;
  volcengineConnected: boolean;
  aliyunConnected: boolean;
  e2bApiKey: string;
  setE2bApiKey: (value: string) => void;
  daytonaServerUrl: string;
  setDaytonaServerUrl: (value: string) => void;
  daytonaApiKey: string;
  setDaytonaApiKey: (value: string) => void;
  vefaasSandboxFunctionId: string;
  setVefaasSandboxFunctionId: (value: string) => void;
  vefaasSandboxGatewayUrl: string;
  setVefaasSandboxGatewayUrl: (value: string) => void;
  aliyunFcFunctionName: string;
  setAliyunFcFunctionName: (value: string) => void;
  aliyunFcInvokeUrl: string;
  setAliyunFcInvokeUrl: (value: string) => void;
  aliyunFcApiKey: string;
  setAliyunFcApiKey: (value: string) => void;
  vefaasSandboxTimeoutInput: string;
  setVefaasSandboxTimeoutInput: (value: string) => void;
  sandboxPoolSizeInput: string;
  setSandboxPoolSizeInput: (value: string) => void;
}) {
  const L = props.L;
  const [timeoutHelpOpen, setTimeoutHelpOpen] = useState(false);
  const clearError = () => { if (props.error) props.setError(""); };
  const timeoutHelp = L("VeFaaS 沙箱的保活/请求超时时间，单位毫秒。通常建议 3600000（一小时）；短任务可设 600000 到 1800000，长任务不建议低于一小时。", "VeFaaS sandbox keep-alive/request timeout in milliseconds. 3600000 (one hour) is a good default; short jobs can use 600000-1800000, while long jobs should usually stay at one hour or more.");
  return (
    <div className="provision-step">
      <div className="cfg-cards">
        <button type="button" className={`prov-card ${props.sandboxProvider === "e2b" ? "on" : ""}`} onClick={() => { props.setSandboxProvider("e2b"); clearError(); }}>
          <div className="pc-ic"><Icon name="i-server" size={18} /></div><b>E2B</b><span>{L("E2B 云沙箱", "E2B cloud sandbox")}</span>{props.sandboxProvider === "e2b" ? <span className="pc-check"><Icon name="i-check" size={15} /></span> : null}
        </button>
        <button type="button" className={`prov-card ${props.sandboxProvider === "daytona" ? "on" : ""}`} onClick={() => { props.setSandboxProvider("daytona"); clearError(); }}>
          <div className="pc-ic"><Icon name="i-server" size={18} /></div><b>Daytona</b><span>{L("独立开发环境沙箱", "Independent development-environment sandbox")}</span>{props.sandboxProvider === "daytona" ? <span className="pc-check"><Icon name="i-check" size={15} /></span> : null}
        </button>
        {props.volcengineConnected ? (
          <button type="button" className={`prov-card ${props.sandboxProvider === "vefaas" ? "on" : ""}`} onClick={() => { props.setSandboxProvider("vefaas"); clearError(); }}>
            <div className="pc-ic"><Icon name="i-cloud" size={18} /></div><b>VeFaaS</b><span>{L("火山云沙箱", "Volcengine cloud sandbox")}</span>{props.sandboxProvider === "vefaas" ? <span className="pc-check"><Icon name="i-check" size={15} /></span> : null}
          </button>
        ) : null}
        {props.aliyunConnected ? (
          <button type="button" className={`prov-card ${props.sandboxProvider === "aliyun_fc" ? "on" : ""}`} onClick={() => { props.setSandboxProvider("aliyun_fc"); clearError(); }}>
            <div className="pc-ic"><Icon name="i-cloud" size={18} /></div><b>Aliyun FC</b><span>{L("阿里云函数计算沙箱", "Aliyun FC sandbox")}</span>{props.sandboxProvider === "aliyun_fc" ? <span className="pc-check"><Icon name="i-check" size={15} /></span> : null}
          </button>
        ) : null}
      </div>
      <label className="form">{L("Sandbox 备池", "Sandbox standby pool")}
        <select className="fld" value={props.standbySandboxProvider} onChange={(event) => props.setStandbySandboxProvider(event.target.value as "" | "e2b" | "daytona" | "vefaas" | "aliyun_fc")}>
          <option value="">{L("不启用", "Disabled")}</option>
          {props.sandboxProvider !== "e2b" ? <option value="e2b">E2B</option> : null}
          {props.sandboxProvider !== "daytona" ? <option value="daytona">Daytona</option> : null}
          {props.volcengineConnected && props.sandboxProvider !== "vefaas" ? <option value="vefaas">VeFaaS</option> : null}
          {props.aliyunConnected && props.sandboxProvider !== "aliyun_fc" ? <option value="aliyun_fc">Aliyun FC</option> : null}
        </select>
      </label>
      {props.sandboxProvider === "e2b" ? (
        <div className="cred-box">
          <div className="cred-head"><Icon name="i-key" size={14} /> E2B {L("凭据", "credentials")}</div>
          <label className="form">E2B_API_KEY<input className="fld" type="password" value={props.e2bApiKey} autoComplete="off" placeholder="E2B_API_KEY" onChange={(event) => { props.setE2bApiKey(event.target.value); clearError(); }} /></label>
        </div>
      ) : props.sandboxProvider === "daytona" ? (
        <div className="cred-box">
          <div className="cred-head"><Icon name="i-key" size={14} /> Daytona</div>
          <label className="form">DAYTONA_SERVER_URL<input className="fld" value={props.daytonaServerUrl} autoComplete="off" placeholder="https://daytona.example.com" onChange={(event) => { props.setDaytonaServerUrl(event.target.value); clearError(); }} /></label>
          <label className="form">DAYTONA_API_KEY<input className="fld" type="password" value={props.daytonaApiKey} autoComplete="off" placeholder="DAYTONA_API_KEY" onChange={(event) => { props.setDaytonaApiKey(event.target.value); clearError(); }} /></label>
        </div>
      ) : props.sandboxProvider === "vefaas" ? (
        <div className="cred-box">
          <div className="cred-head"><Icon name="i-key" size={14} /> VeFaaS Sandbox</div>
          <label className="form">VEFAAS_SANDBOX_FUNCTION_ID<input className="fld" value={props.vefaasSandboxFunctionId} autoComplete="off" placeholder="vefaas sandbox function id" onChange={(event) => { props.setVefaasSandboxFunctionId(event.target.value); clearError(); }} /></label>
          <label className="form">VEFAAS_SANDBOX_GATEWAY_URL<input className="fld" value={props.vefaasSandboxGatewayUrl} autoComplete="off" placeholder="https://your-sandbox-app.example.com" onChange={(event) => { props.setVefaasSandboxGatewayUrl(event.target.value); clearError(); }} /></label>
          <label className="form"><span className="field-label-inline">VEFAAS_SANDBOX_TIMEOUT_MS <button type="button" className="field-help" title={timeoutHelp} aria-label={timeoutHelp} onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }} onClick={(event) => { event.preventDefault(); event.stopPropagation(); setTimeoutHelpOpen((open) => !open); }}><Icon name="i-info" size={13} /></button>{timeoutHelpOpen ? <span className="field-help-popover" role="tooltip">{timeoutHelp}</span> : null}</span><input className="fld" type="number" min={60000} step={60000} value={props.vefaasSandboxTimeoutInput} onChange={(event) => props.setVefaasSandboxTimeoutInput(event.target.value)} /></label>
        </div>
      ) : (
        <div className="cred-box">
          <div className="cred-head"><Icon name="i-key" size={14} /> Aliyun FC Sandbox</div>
          <label className="form">ALIYUN_FC_FUNCTION_NAME<input className="fld" value={props.aliyunFcFunctionName} autoComplete="off" placeholder="maple-fc-sandbox" onChange={(event) => { props.setAliyunFcFunctionName(event.target.value); clearError(); }} /></label>
          <label className="form">ALIYUN_FC_INVOKE_URL<input className="fld" value={props.aliyunFcInvokeUrl} autoComplete="off" placeholder="https://..." onChange={(event) => { props.setAliyunFcInvokeUrl(event.target.value); clearError(); }} /></label>
          <label className="form">ALIYUN_FC_API_KEY<input className="fld" type="password" value={props.aliyunFcApiKey} autoComplete="off" placeholder={L("可选", "Optional")} onChange={(event) => props.setAliyunFcApiKey(event.target.value)} /></label>
        </div>
      )}
      <label className="form">{L("备用沙箱数", "Standby sandboxes")}
        <input className="fld" type="number" min={1} max={MAX_SANDBOX_POOL_SIZE} value={props.sandboxPoolSizeInput} onChange={(event) => props.setSandboxPoolSizeInput(event.target.value)} />
      </label>
    </div>
  );
}
