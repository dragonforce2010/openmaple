import { Icon } from "../../ui";
import { MAX_SANDBOX_POOL_SIZE } from "../workspaces/WorkspaceOnboardingConfig";

type LFn = (zh: string, en: string) => string;

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

export function WorkspaceCreateSandboxStep(props: {
  L: LFn;
  error: string;
  setError: (value: string) => void;
  sandboxProvider: "e2b" | "vefaas";
  setSandboxProvider: (value: "e2b" | "vefaas") => void;
  e2bApiKey: string;
  setE2bApiKey: (value: string) => void;
  vefaasSandboxFunctionId: string;
  setVefaasSandboxFunctionId: (value: string) => void;
  vefaasSandboxGatewayUrl: string;
  setVefaasSandboxGatewayUrl: (value: string) => void;
  vefaasSandboxTimeoutMs: number;
  setVefaasSandboxTimeoutMs: (value: number) => void;
  sandboxPoolSize: number;
  setSandboxPoolSize: (value: number) => void;
}) {
  const L = props.L;
  const clearError = () => { if (props.error) props.setError(""); };
  return (
    <div className="provision-step">
      <div className="cfg-cards">
        <button type="button" className={`prov-card ${props.sandboxProvider === "e2b" ? "on" : ""}`} onClick={() => { props.setSandboxProvider("e2b"); clearError(); }}>
          <div className="pc-ic"><Icon name="i-server" size={18} /></div><b>E2B</b><span>{L("E2B 云沙箱", "E2B cloud sandbox")}</span>{props.sandboxProvider === "e2b" ? <span className="pc-check"><Icon name="i-check" size={15} /></span> : null}
        </button>
        <button type="button" className={`prov-card ${props.sandboxProvider === "vefaas" ? "on" : ""}`} onClick={() => { props.setSandboxProvider("vefaas"); clearError(); }}>
          <div className="pc-ic"><Icon name="i-cloud" size={18} /></div><b>VeFaaS</b><span>{L("火山云沙箱", "Volcengine cloud sandbox")}</span>{props.sandboxProvider === "vefaas" ? <span className="pc-check"><Icon name="i-check" size={15} /></span> : null}
        </button>
      </div>
      {props.sandboxProvider === "e2b" ? (
        <div className="cred-box">
          <div className="cred-head"><Icon name="i-key" size={14} /> E2B {L("凭据", "credentials")}</div>
          <label className="form">E2B_API_KEY<input className="fld" type="password" value={props.e2bApiKey} autoComplete="off" placeholder="E2B_API_KEY" onChange={(event) => { props.setE2bApiKey(event.target.value); clearError(); }} /></label>
        </div>
      ) : (
        <div className="cred-box">
          <div className="cred-head"><Icon name="i-key" size={14} /> VeFaaS Sandbox</div>
          <label className="form">VEFAAS_SANDBOX_FUNCTION_ID<input className="fld" value={props.vefaasSandboxFunctionId} autoComplete="off" placeholder="vefaas sandbox function id" onChange={(event) => { props.setVefaasSandboxFunctionId(event.target.value); clearError(); }} /></label>
          <label className="form">VEFAAS_SANDBOX_GATEWAY_URL<input className="fld" value={props.vefaasSandboxGatewayUrl} autoComplete="off" placeholder="https://your-sandbox-app.example.com" onChange={(event) => { props.setVefaasSandboxGatewayUrl(event.target.value); clearError(); }} /></label>
          <label className="form">VEFAAS_SANDBOX_TIMEOUT_MS<input className="fld" type="number" min={60000} step={60000} value={props.vefaasSandboxTimeoutMs} onChange={(event) => props.setVefaasSandboxTimeoutMs(Number(event.target.value))} /></label>
        </div>
      )}
      <label className="form">{L("备用沙箱数", "Standby sandboxes")}
        <input className="fld" type="number" min={1} max={MAX_SANDBOX_POOL_SIZE} value={props.sandboxPoolSize} onChange={(event) => props.setSandboxPoolSize(clampNumber(Number(event.target.value), 1, MAX_SANDBOX_POOL_SIZE))} />
      </label>
    </div>
  );
}
