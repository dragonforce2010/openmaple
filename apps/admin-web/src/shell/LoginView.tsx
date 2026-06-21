import { useEffect, useRef, useState } from "react";
import { apiPost } from "../api";
import type { AuthProvider, User } from "../types";
import { Icon } from "../ui";
import { currentConsoleReturnPath, oauthStartPath, requestedWorkspaceRouteFromLocation, useI18n } from "../appConfig";
import { errorMessage } from "../components/shared/misc";

export function LoginView(props: { providers: AuthProvider[]; error: string; onLogin: (user: User) => void }) {
  const { language, setLanguage, t } = useI18n();
  const [provider, setProvider] = useState<AuthProvider["id"]>("lark_sso");
  const email = "admin@example.com";
  const name = "Platform Admin";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(props.error);
  const autoLocalLoginStarted = useRef(false);
  const localProvider = props.providers.find((item) => item.id === "local");
  const larkProvider = props.providers.find((item) => item.id === "lark_sso");
  const loginProvider = localProvider ?? larkProvider;
  const autoLocalLogin =
    new URLSearchParams(window.location.search).get("dev_login") === "1" ||
    window.localStorage.getItem("maple.dev_login") === "1";

  async function login(nextProvider = provider) {
    setProvider(nextProvider);
    setBusy(true);
    setError("");
    try {
      if (nextProvider !== "local") {
        const next = props.providers.find((item) => item.id === nextProvider);
	        if (!next?.configured) throw new Error(`${next?.name ?? nextProvider} ${t("login.notConfigured")}.`);
	        const params = new URLSearchParams({ redirect: "1", return_to: currentConsoleReturnPath() });
	        window.location.assign(`${oauthStartPath(nextProvider, requestedWorkspaceRouteFromLocation())}?${params.toString()}`);
        return;
      }
      const result = await apiPost<{ user: User }>("/v1/auth/login", { provider: "local", email, name });
      props.onLogin(result.user);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!autoLocalLogin || !localProvider || autoLocalLoginStarted.current) return;
    autoLocalLoginStarted.current = true;
    void login("local");
  }, [autoLocalLogin, localProvider]);

  const L = (zh: string, en: string) => (language === "zh" ? zh : en);
  return (
    <div className="auth-stage">
      <header className="auth-top">
        <div className="auth-brand"><Icon name="i-maple" size={18} /><span>OpenMaple</span></div>
        <div className="lang-switch auth-lang">
          <button className={language === "zh" ? "on" : ""} onClick={() => setLanguage("zh")}>中</button>
          <button className={language === "en" ? "on" : ""} onClick={() => setLanguage("en")}>EN</button>
        </div>
      </header>
      <div className="auth-mid">
        <h1 className="auth-hero">{L("OpenMaple · 开放的托管 Agent 平台", "OpenMaple — open managed agents, out of the box")}</h1>
        <p className="auth-lede">{L("开箱即部署、上线即运行——用统一的托管 Agent 平台构建、运行并观测你的 Agent。", "Build, run and observe your agents on one managed platform.")}</p>
        <div className="auth-card">
          <p className="auth-hint">{L("登录 OpenMaple。你只能进入已被授权的工作区。", "Sign in to OpenMaple. You can only enter workspaces you have access to.")}</p>
          {error ? <div className="warning-box">{error}</div> : null}
          <button className="sso-btn" onClick={() => login(loginProvider?.id ?? "lark_sso")} disabled={busy || !loginProvider || loginProvider.configured === false}>
            <span className="lark-mark"><Icon name={localProvider ? "i-terminal" : "i-lark"} size={14} /></span>{localProvider ? L("本地开发登录", "Local dev login") : L("使用 Lark 登录", "Continue with Lark")}
          </button>
          {loginProvider?.configured === false ? <div className="warning-box">{t("login.providerMissing")}</div> : null}
        </div>
      </div>
      <div className="auth-foot">OpenMaple · Open Managed Agent Platform</div>
      <div className={busy && provider !== "local" ? "sso-overlay on" : "sso-overlay"}>
        <div className="sso-box">
          <div className="lark-mark lg"><Icon name="i-lark" size={26} /></div>
          <h3>{L("正在跳转 Lark 授权", "Redirecting to Lark SSO")}</h3>
          <p>{L("已向 Lark 发起单点登录请求，授权通过后将自动返回。", "A single sign-on request was sent to Lark.")}</p>
          <div className="sso-progress"><i style={{ width: busy ? "90%" : "0%" }} /></div>
        </div>
      </div>
    </div>
  );
}
