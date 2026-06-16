import { useEffect, useState } from "react";
import { apiGet, type ApiList } from "../../api";
import type { JsonRecord, RuntimePool, SandboxPool, WorkspaceApiKey, WorkspaceMember } from "../../types";
import { Icon } from "../../ui";
import { useEntityNav, useI18n, type EntityKind } from "../../appConfig";
import { maskSecret } from "../../components/shared/code";
import { apiKeyStatusPill, defaultToggle, statusPill } from "../../components/shared/labels";
import { Crumb, DataTable, PageFrame } from "../../components/shared/layout";
import { authProviderLabel, errorMessage, formatTime } from "../../components/shared/misc";
import { SessionDrawerDetail } from "../sessions/SessionViews";
import { PoolMembersDrawer, type PoolDrawerTarget } from "../workspaces/PoolMembersDrawer";
import { RuntimePoolDetails } from "../workspaces/RuntimePoolDetails";
import { RuntimeProviderCard, WorkspaceProvidersTab } from "../workspaces/WorkspaceSettingsTabs";
import { AgentDetailView } from "./AgentDetailView";
import { EnvDetailView } from "./EnvironmentDetailView";
import { VaultDetailView } from "./VaultDetailView";

export function EntityDetailBody({ kind, id }: { kind: EntityKind; id: string }) {
  if (kind === "agent") return <AgentDetailView agentId={id} embedded />;
  if (kind === "environment") return <EnvDetailView envId={id} embedded />;
  if (kind === "session") return <SessionDrawerDetail sessionId={id} />;
  if (kind === "workspace") return <WorkspaceDetailView workspaceId={id} embedded />;
  return <VaultDetailView vaultId={id} embedded />;
}

export function WorkspaceDetailView({ workspaceId, embedded }: { workspaceId: string; embedded?: boolean }) {
  const { language } = useI18n();
  const L = (zh: string, en: string) => (language === "zh" ? zh : en);
  const { data, goView } = useEntityNav();
  const [tab, setTab] = useState<"overview" | "runtime" | "providers" | "models" | "members" | "keys">("overview");
  const [runtimePool, setRuntimePool] = useState<RuntimePool | null>(null);
  const [runtimeError, setRuntimeError] = useState("");
  const [sandboxPool, setSandboxPool] = useState<SandboxPool | null>(null);
  const [sandboxError, setSandboxError] = useState("");
  const [poolDrawer, setPoolDrawer] = useState<PoolDrawerTarget | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [membersError, setMembersError] = useState("");
  const [keys, setKeys] = useState<WorkspaceApiKey[]>([]);
  const [keysError, setKeysError] = useState("");
  const workspace = data.workspaces.find((item) => item.id === workspaceId) ?? (data.workspace?.id === workspaceId ? data.workspace : null);
  const workspaceConfig = workspace?.config ?? {};
  const providerCredentials = workspaceConfig.provider_credentials as JsonRecord | undefined;
  const sandboxConfig = workspaceConfig.sandbox_config as JsonRecord | undefined;
  const runtimeProvider = workspace?.runtime_provider ?? "vefaas";
  const sandboxProvider = workspace?.sandbox_provider ?? "e2b";
  const workspaceModelConfigs = data.modelConfigs.filter((config) => !config.workspace_id || config.workspace_id === workspaceId || config.workspace_id === "-1");
  useEffect(() => {
    let cancelled = false;
    setTab("overview");
    setRuntimePool(null);
    setRuntimeError("");
    setSandboxPool(null);
    setSandboxError("");
    setMembers([]);
    setMembersError("");
    setKeys([]);
    setKeysError("");
    if (!workspaceId) return;
    apiGet<RuntimePool>(`/v1/workspaces/${workspaceId}/runtime_pool`)
      .then((pool) => { if (!cancelled) setRuntimePool(pool); })
      .catch((reason) => { if (!cancelled) setRuntimeError(errorMessage(reason)); });
    apiGet<SandboxPool>(`/v1/workspaces/${workspaceId}/sandbox_pool`)
      .then((pool) => { if (!cancelled) setSandboxPool(pool); })
      .catch((reason) => { if (!cancelled) setSandboxError(errorMessage(reason)); });
    apiGet<ApiList<WorkspaceMember>>(`/v1/workspaces/${workspaceId}/members`)
      .then((result) => {
        if (cancelled) return;
        const rank = { owner: 0, admin: 1, member: 2 };
        setMembers([...result.data].sort((a, b) => rank[a.role] - rank[b.role] || a.created_at.localeCompare(b.created_at)));
      })
      .catch((reason) => { if (!cancelled) setMembersError(errorMessage(reason)); });
    apiGet<ApiList<WorkspaceApiKey>>(`/v1/workspaces/${workspaceId}/api_keys`)
      .then((result) => { if (!cancelled) setKeys(result.data); })
      .catch((reason) => { if (!cancelled) setKeysError(errorMessage(reason)); });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  if (!workspace) {
    const empty = <div className="empty-state"><b>{L("未找到工作区", "Workspace not found")}</b></div>;
    return embedded ? empty : <PageFrame title={L("工作区", "Workspace")}>{empty}</PageFrame>;
  }
  const keyMask = (key: WorkspaceApiKey) => maskSecret(key.key || key.key_prefix, 6);
  const tabs: Array<[typeof tab, string]> = [
    ["overview", L("基本信息", "Overview")],
    ["runtime", L("运行时配置", "Runtime")],
    ["providers", L("沙箱配置", "Providers")],
    ["models", L("模型管理", "Models")],
    ["members", L("用户管理", "Users")],
    ["keys", L("秘钥管理", "API keys")]
  ];
  const content = (
    <>
    <div className="detail-doc workspace-detail-doc workspace-detail-settings">
      <div className="seg settings-seg workspace-detail-tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button className={tab === id ? "on" : ""} key={id} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === "overview" ? (
        <>
          <div className="tile-grid c3 workspace-summary-tiles">
            <div className="tile"><div className="lbl">{L("模型", "Models")}</div><div className="num">{workspaceModelConfigs.length}</div><span>{L("模型池接入点", "model endpoints")}</span></div>
            <div className="tile"><div className="lbl">{L("用户", "Users")}</div><div className="num">{members.length || "-"}</div><span>{membersError ? L("无权限读取", "not available") : L("工作区成员", "workspace members")}</span></div>
            <div className="tile"><div className="lbl">{L("API Keys", "API keys")}</div><div className="num">{keys.length || "-"}</div><span>{keysError ? L("无权限读取", "not available") : L("工作区秘钥", "workspace keys")}</span></div>
          </div>
          <div className="card t-card">
            <div className="t-row"><span>{L("工作区名称", "Workspace name")}</span><b>{workspace.name}</b></div>
            <div className="t-row"><span>{L("工作区描述", "Workspace description")}</span><b>{workspace.description || L("暂无描述", "No description")}</b></div>
            <div className="t-row"><span>{L("工作区 ID", "Workspace ID")}</span><b className="mono">{String(workspaceConfig.slug ?? workspace.id)}</b></div>
            <div className="t-row"><span>{L("内部 ID", "Internal ID")}</span><b className="mono">{workspace.id}</b></div>
            <div className="t-row"><span>{L("状态", "Status")}</span><b>{statusPill(workspace.status || "active", L)}</b></div>
            <div className="t-row"><span>{L("创建时间", "Created")}</span><b>{formatTime(workspace.created_at)}</b></div>
          </div>
        </>
      ) : null}

      {tab === "runtime" ? (
        <>
          <div className="cfg-head"><Icon name="i-gauge" size={16} /> <b>{L("运行时池", "Runtime pool")}</b></div>
          <div className="cfg-cards workspace-provider-grid">
            <RuntimeProviderCard runtimeProvider={runtimeProvider} providerCredentials={providerCredentials} onDetails={() => setPoolDrawer({ kind: "runtime" })} />
          </div>
          {runtimeError ? <div className="modal-note"><Icon name="i-alert" size={16} /> {runtimeError}</div> : null}
          {!runtimePool && !runtimeError ? <div className="empty-state">{L("正在加载运行时池…", "Loading runtime pool...")}</div> : null}
          {runtimePool ? (
            <RuntimePoolDetails pool={runtimePool} L={L} summaryOnly onOpenMembers={(status) => setPoolDrawer({ kind: "runtime", status })} />
          ) : null}
        </>
      ) : null}

      {tab === "providers" ? (
        <WorkspaceProvidersTab
          L={L}
          sandboxProvider={sandboxProvider}
          providerCredentials={providerCredentials}
          sandboxConfig={sandboxConfig}
          sandboxPool={sandboxPool}
          sandboxError={sandboxError}
          className="workspace-provider-grid"
          onOpenSandboxPool={(status) => setPoolDrawer({ kind: "sandbox", status })}
        />
      ) : null}

      {tab === "models" ? (
        <>
          <div className="cfg-head"><Icon name="i-brain" size={16} /> <b>{L("工作区模型池", "Workspace model pool")}</b></div>
          <div className="settings-table">
            <DataTable headers={[L("名称", "Name"), "Provider", L("模型", "Model"), L("默认", "Default"), "Key"]}>
              {workspaceModelConfigs.map((config) => (
                <tr key={config.id}>
                  <td><strong>{config.name}</strong><small>{config.id}</small></td>
                  <td>{config.provider_type}</td>
                  <td>{config.model_name}</td>
                  <td>{defaultToggle(config.is_default)}</td>
                  <td>{config.has_api_key ? maskSecret(config.api_key_hint || "") : L("环境变量回退", "Env fallback")}</td>
                </tr>
              ))}
            </DataTable>
          </div>
          {!workspaceModelConfigs.length ? <div className="modal-note"><Icon name="i-alert" size={16} /> {L("当前工作区没有模型池配置。", "No model pool is configured for this workspace.")}</div> : null}
        </>
      ) : null}

      {tab === "members" ? (
        <>
          <div className="cfg-head"><Icon name="i-users" size={16} /> <b>{L("工作区用户", "Workspace users")}</b></div>
          {membersError ? <div className="modal-note"><Icon name="i-alert" size={16} /> {membersError}</div> : null}
          <div className="settings-table members-table">
            <DataTable headers={[L("邮箱", "Email"), L("名称", "Name"), L("角色", "Role"), "Provider", L("加入时间", "Joined")]}>
              {members.map((member) => (
                <tr key={member.user_id}>
                  <td><strong>{member.email}</strong><small className="mono">{member.user_id}</small></td>
                  <td>{member.name || member.email.split("@")[0]}</td>
                  <td>{member.role === "member" ? L("成员", "Member") : <span className="status active">{member.role === "owner" ? L("所有者", "Owner") : member.role}</span>}</td>
                  <td>{authProviderLabel(member.auth_provider)}</td>
                  <td>{formatTime(member.created_at)}</td>
                </tr>
              ))}
            </DataTable>
          </div>
        </>
      ) : null}

      {tab === "keys" ? (
        <>
          <div className="cfg-head"><Icon name="i-key" size={16} /> <b>{L("工作区 API 秘钥", "Workspace API keys")}</b></div>
          {keysError ? <div className="modal-note"><Icon name="i-alert" size={16} /> {keysError}</div> : null}
          <div className="settings-table keys-table">
            <DataTable headers={[L("名称", "Name"), "Key", "Scopes", L("状态", "Status"), L("最后使用", "Last used")]}>
              {keys.map((key) => (
                <tr key={key.id}>
                  <td><strong>{key.display_name}</strong><small>{key.id}</small></td>
                  <td><code className="mono">{keyMask(key)}</code></td>
                  <td>{key.scopes.length ? <div className="scope-chip-row">{key.scopes.map((scope) => <span className="scope-chip" key={scope}>{scope}</span>)}</div> : "-"}</td>
                  <td>{apiKeyStatusPill(key.enabled, L)}</td>
                  <td>{key.last_used_at ? formatTime(key.last_used_at) : L("从未", "Never")}</td>
                </tr>
              ))}
            </DataTable>
          </div>
        </>
      ) : null}
    </div>
    {poolDrawer ? (
      <PoolMembersDrawer target={poolDrawer} workspaceId={workspaceId} L={L} onClose={() => setPoolDrawer(null)} />
    ) : null}
    </>
  );
  if (embedded) return content;
  return (
    <PageFrame
      title={<>{workspace.name} {statusPill(workspace.status || "active", L)}</>}
      sub={<span className="mono">{workspace.id}</span>}
      crumb={<Crumb parts={[{ label: L("租户", "Tenant"), icon: "i-boxes", onClick: () => goView("tenant") }, { label: workspace.name }]} />}
    >
      {content}
    </PageFrame>
  );
}
