import { useEffect, useState, type ClipboardEvent, type FormEvent } from "react";
import { apiDelete, apiGet, apiPost, type ApiList } from "../../api";
import { useEntityNav, useL } from "../../appConfig";
import { maskSecret } from "../../components/shared/code";
import { ModalShell } from "../../components/shared/layout";
import { errorMessage, formatTime, writeClipboard } from "../../components/shared/misc";
import type {
  JsonRecord,
  ModelConfig,
  RuntimePool,
  SandboxPool,
  Workspace,
  WorkspaceApiKey,
  WorkspaceMember
} from "../../types";
import { DrawerLayer, Icon, useConfirm, useToast } from "../../ui";
import { cloudProviderIdentityNames } from "./cloudProviderIdentityLabels";
import { PoolMembersDrawer, type PoolDrawerTarget } from "./PoolMembersDrawer";
import {
  WorkspaceKeysTab,
  WorkspaceMembersTab,
  WorkspaceModelsTab,
  WorkspaceProvidersTab,
  WorkspaceRuntimeTab
} from "./WorkspaceSettingsTabs";

export function WorkspaceSettingsDrawer(props: {
  workspace: Workspace | null;
  keys: WorkspaceApiKey[];
  modelConfigs: ModelConfig[];
  issuedKey: string;
  onClose: () => void;
  onCreateKey: (displayName?: string) => Promise<void>;
  onRenameKey: (key: WorkspaceApiKey, displayName: string) => Promise<void>;
  onToggleKey: (key: WorkspaceApiKey) => Promise<void>;
  onDeleteKey: (key: WorkspaceApiKey) => Promise<void>;
  onMembersChanged?: () => Promise<void> | void;
  onModelsChanged?: () => Promise<void> | void;
}) {
  const L = useL();
  const toast = useToast();
  const confirm = useConfirm();
  const { openEntity } = useEntityNav();
  const [tab, setTab] = useState<"overview" | "runtime" | "providers" | "models" | "members" | "keys">("overview");
  const [runtimePool, setRuntimePool] = useState<RuntimePool | null>(null);
  const [runtimeError, setRuntimeError] = useState("");
  const [sandboxPool, setSandboxPool] = useState<SandboxPool | null>(null);
  const [sandboxError, setSandboxError] = useState("");
  const [poolDrawer, setPoolDrawer] = useState<PoolDrawerTarget | null>(null);
  const [keyName, setKeyName] = useState("");
  const [creatingKey, setCreatingKey] = useState(false);
  const [renameKey, setRenameKey] = useState<WorkspaceApiKey | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renamingKey, setRenamingKey] = useState(false);
  const [renameError, setRenameError] = useState("");
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState<"member" | "admin">("member");
  const [memberBusy, setMemberBusy] = useState("");
  const [memberError, setMemberError] = useState("");
  const settingsApiKeyPlaceholder = `${props.workspace?.name?.trim() || L("workspace 名称", "workspace-name")}-apikey`;

  useEffect(() => {
    let cancelled = false;
    setRuntimePool(null);
    setRuntimeError("");
    setSandboxPool(null);
    setSandboxError("");
    if (!props.workspace) return;
    apiGet<RuntimePool>(`/v1/workspaces/${props.workspace.id}/runtime_pool`)
      .then((pool) => {
        if (!cancelled) setRuntimePool(pool);
      })
      .catch((reason) => {
        if (!cancelled) setRuntimeError(errorMessage(reason));
      });
    apiGet<SandboxPool>(`/v1/workspaces/${props.workspace.id}/sandbox_pool`)
      .then((pool) => {
        if (!cancelled) setSandboxPool(pool);
      })
      .catch((reason) => {
        if (!cancelled) setSandboxError(errorMessage(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [props.workspace?.id]);

  async function createKey() {
    setCreatingKey(true);
    try {
      await props.onCreateKey(keyName.trim() || settingsApiKeyPlaceholder);
      setKeyName("");
      setTab("keys");
    } finally {
      setCreatingKey(false);
    }
  }

  function openRenameKeyModal(key: WorkspaceApiKey) {
    setRenameKey(key);
    setRenameName(key.display_name);
    setRenameError("");
  }

  async function renameWorkspaceKey() {
    if (!renameKey) return;
    const nextName = renameName.trim();
    if (!nextName) {
      setRenameError(L("请输入 Key 名称。", "Enter a key name."));
      return;
    }
    setRenamingKey(true);
    setRenameError("");
    try {
      await props.onRenameKey(renameKey, nextName);
      setRenameKey(null);
    } catch (reason) {
      setRenameError(errorMessage(reason));
    } finally {
      setRenamingKey(false);
    }
  }

  async function copyIssuedKey() {
    if (!props.issuedKey) return;
    try {
      await writeClipboard(props.issuedKey);
      toast(L("已复制到剪贴板", "Copied to clipboard"), "ok");
    } catch (reason) {
      toast(errorMessage(reason), "err");
    }
  }

  async function fullWorkspaceApiKey(key: WorkspaceApiKey) {
    const value = key.key?.trim();
    if (value) return value;
    if (!props.workspace?.id) return "";
    const result = await apiGet<ApiList<WorkspaceApiKey>>(`/v1/workspaces/${props.workspace.id}/api_keys`);
    return result.data.find((item) => item.id === key.id)?.key?.trim() ?? "";
  }

  async function copyWorkspaceApiKey(key: WorkspaceApiKey) {
    const value = await fullWorkspaceApiKey(key);
    if (!value) {
      toast(L("当前没有完整 Key，请重新创建后复制。", "Full key is unavailable. Create a new key to copy it."), "err");
      return;
    }
    try {
      await writeClipboard(value);
      toast(L("已复制完整 Key", "Full key copied"), "ok");
    } catch (reason) {
      toast(errorMessage(reason), "err");
    }
  }

  function copyWorkspaceApiKeyFromMasked(event: ClipboardEvent<HTMLElement>, key: WorkspaceApiKey) {
    event.preventDefault();
    const value = key.key?.trim();
    if (!value) {
      toast(L("脱敏文本不是完整 Key，请点击复制按钮。", "Masked text is not the full key. Use the copy button."), "err");
      return;
    }
    event.clipboardData.setData("text/plain", value);
    toast(L("已复制完整 Key", "Full key copied"), "ok");
  }

  const maskedWorkspaceKey = (key: WorkspaceApiKey) => key.key ? maskSecret(key.key, 6) : key.key_prefix;
  async function loadMembers(workspaceId = props.workspace?.id) {
    if (!workspaceId) return setMembers([]);
    try {
      const result = await apiGet<ApiList<WorkspaceMember>>(`/v1/workspaces/${workspaceId}/members`);
      setMembers(result.data);
      setMemberError("");
    } catch (reason) {
      setMemberError(errorMessage(reason));
    }
  }

  useEffect(() => {
    void loadMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.workspace?.id]);

  function sortMembers(rows: WorkspaceMember[]) {
    return [...rows].sort((a, b) => ({ owner: 0, admin: 1, member: 2 })[a.role] - ({ owner: 0, admin: 1, member: 2 })[b.role] || a.created_at.localeCompare(b.created_at));
  }

  async function addMember(event?: FormEvent) {
    event?.preventDefault();
    if (!props.workspace?.id || !memberEmail.trim()) return;
    setMemberBusy("add");
    setMemberError("");
    try {
      const endpoint = memberRole === "admin" ? "admins" : "members";
      const member = await apiPost<WorkspaceMember>(`/v1/workspaces/${props.workspace.id}/${endpoint}`, { email: memberEmail.trim() });
      setMembers((current) => {
        const next = current.filter((item) => item.user_id !== member.user_id);
        return sortMembers([...next, member]);
      });
      setMemberEmail("");
      await props.onMembersChanged?.();
      toast(memberRole === "admin" ? L("已添加管理员", "Admin added") : L("已添加用户", "User added"), "ok");
    } catch (reason) {
      setMemberError(errorMessage(reason));
    } finally {
      setMemberBusy("");
    }
  }

  async function removeMember(member: WorkspaceMember) {
    if (!props.workspace?.id || member.role === "owner") return;
    const isAdmin = member.role === "admin";
    const ok = await confirm({
      title: isAdmin ? L("移除管理员", "Remove admin") : L("移除用户", "Remove user"),
      body: isAdmin
        ? L(`确定移除 ${member.email} 的管理员权限？`, `Remove ${member.email} as an administrator?`)
        : L(`确定将 ${member.email} 从当前工作区移除？`, `Remove ${member.email} from this workspace?`),
      confirmLabel: L("移除", "Remove"),
      cancelLabel: L("取消", "Cancel"),
      danger: true
    });
    if (!ok) return;
    setMemberBusy(member.user_id);
    setMemberError("");
    try {
      await apiDelete(`/v1/workspaces/${props.workspace.id}/${isAdmin ? "admins" : "members"}/${encodeURIComponent(member.user_id)}`);
      setMembers((current) => current.filter((item) => item.user_id !== member.user_id));
      await props.onMembersChanged?.();
      toast(isAdmin ? L("已移除管理员", "Admin removed") : L("已移除用户", "User removed"), "ok");
    } catch (reason) {
      setMemberError(errorMessage(reason));
    } finally {
      setMemberBusy("");
    }
  }

  const workspaceConfig = props.workspace?.config ?? {};
  const providerCredentials = workspaceConfig.provider_credentials as JsonRecord | undefined;
  const sandboxConfig = workspaceConfig.sandbox_config as JsonRecord | undefined;
  const cloudProviderNames = cloudProviderIdentityNames(workspaceConfig.cloud_provider_identities);
  const runtimeProvider = props.workspace?.runtime_provider ?? "vefaas";
  const sandboxProvider = props.workspace?.sandbox_provider ?? "e2b";

  return (
    <>
    <DrawerLayer onClose={props.onClose}>
      <aside className="ask-drawer settings-drawer" role="dialog" aria-modal="true" aria-label={L("工作区设置", "Workspace settings")}>
        <div className="drawer-head">
          <div>
            <b>{L("工作区设置", "Workspace settings")}</b>
            {!props.workspace ? <span>{L("未选择工作区", "No workspace selected")}</span> : null}
          </div>
          <button className="x" onClick={props.onClose} aria-label={L("关闭", "Close")}><Icon name="i-x" size={18} /></button>
        </div>
        {!props.workspace ? (
          <div className="drawer-body"><div className="empty-state">{L("请先选择一个工作区再进行设置。", "Select a workspace before editing settings.")}</div></div>
        ) : (
          <div className="drawer-body settings-content">
            <div className="seg settings-seg" role="tablist">
              {[
                ["overview", L("基本信息", "Overview")],
                ["runtime", L("运行时配置", "Runtime")],
                ["providers", L("沙箱配置", "Providers")],
                ["models", L("模型管理", "Model pool")],
                ["members", L("用户管理", "Users")],
                ["keys", L("秘钥管理", "API keys")]
              ].map(([id, label]) => (
                <button className={tab === id ? "on" : ""} key={id} onClick={() => setTab(id as typeof tab)}>{label}</button>
              ))}
            </div>

            {tab === "overview" ? (
              <div className="settings-overview">
                <section className="settings-overview-hero">
                  <span className="ov-icon"><Icon name="i-grid" size={18} /></span>
                  <div>
                    <button type="button" className="inline-link strong" onClick={() => openEntity("workspace", props.workspace!.id)}>{props.workspace.name}</button>
                    <p>{props.workspace.description || L("暂无描述", "No description")}</p>
                  </div>
                </section>
                <div className="settings-overview-grid">
                  <div className="t-row"><span>{L("工作区 ID", "Workspace ID")}</span><b className="mono">{String(workspaceConfig.slug ?? props.workspace.id)}</b></div>
                  <div className="t-row"><span>{L("运行时", "Runtime")}</span><b>{runtimeProvider}</b></div>
                  <div className="t-row"><span>{L("沙箱", "Sandbox")}</span><b>{sandboxProvider}</b></div>
                  <div className="t-row"><span>{L("云厂商", "Cloud providers")}</span><b>{cloudProviderNames || "-"}</b></div>
                  <div className="t-row"><span>{L("创建时间", "Created")}</span><b>{formatTime(props.workspace.created_at)}</b></div>
                </div>
              </div>
            ) : null}

            {tab === "runtime" ? (
              <WorkspaceRuntimeTab
                L={L}
                runtimePool={runtimePool}
                runtimeError={runtimeError}
                runtimeProvider={runtimeProvider}
                providerCredentials={providerCredentials}
                onOpenRuntimePool={(status) => setPoolDrawer({ kind: "runtime", status })}
              />
            ) : null}

            {tab === "providers" ? (
              <WorkspaceProvidersTab
                L={L}
                sandboxProvider={sandboxProvider}
                providerCredentials={providerCredentials}
                sandboxConfig={sandboxConfig}
                sandboxPool={sandboxPool}
                sandboxError={sandboxError}
                onOpenSandboxPool={(status) => setPoolDrawer({ kind: "sandbox", status })}
              />
            ) : null}

            {tab === "models" ? <WorkspaceModelsTab L={L} modelConfigs={props.modelConfigs} onModelsChanged={props.onModelsChanged} /> : null}

            {tab === "members" ? (
              <WorkspaceMembersTab
                L={L}
                members={members}
                memberEmail={memberEmail}
                memberRole={memberRole}
                memberBusy={memberBusy}
                memberError={memberError}
                setMemberEmail={setMemberEmail}
                setMemberRole={setMemberRole}
                addMember={addMember}
                removeMember={removeMember}
              />
            ) : null}

            {tab === "keys" ? (
              <WorkspaceKeysTab
                L={L}
                workspace={props.workspace}
                keys={props.keys}
                issuedKey={props.issuedKey}
                keyName={keyName}
                creatingKey={creatingKey}
                settingsApiKeyPlaceholder={settingsApiKeyPlaceholder}
                setKeyName={setKeyName}
                createKey={createKey}
                copyIssuedKey={copyIssuedKey}
                maskedWorkspaceKey={maskedWorkspaceKey}
                copyWorkspaceApiKey={copyWorkspaceApiKey}
                copyWorkspaceApiKeyFromMasked={copyWorkspaceApiKeyFromMasked}
                openRenameKeyModal={openRenameKeyModal}
                onToggleKey={props.onToggleKey}
                onDeleteKey={props.onDeleteKey}
              />
            ) : null}
          </div>
        )}
      </aside>
    </DrawerLayer>
    {poolDrawer && props.workspace ? (
      <PoolMembersDrawer
        target={poolDrawer}
        workspaceId={props.workspace.id}
        L={L}
        onClose={() => setPoolDrawer(null)}
      />
    ) : null}
    {renameKey ? (
      <ModalShell title={L("重命名 API Key", "Rename API key")} onClose={() => setRenameKey(null)}>
        <p className="modal-sub">{L("更新这个 Key 在控制台里的显示名称，不影响已签发的密钥值。", "Update the display name for this key without changing the issued secret.")}</p>
        {renameError ? <div className="modal-note"><Icon name="i-alert" size={16} /> {renameError}</div> : null}
        <label className="form">
          {L("名称", "Name")}
          <input
            className="fld"
            value={renameName}
            onChange={(event) => setRenameName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void renameWorkspaceKey();
              }
            }}
            autoFocus
            placeholder={settingsApiKeyPlaceholder}
          />
        </label>
        <div className="modal-note">
          <Icon name="i-key" size={16} />
          <span className="mono">{renameKey.id}</span>
        </div>
        <div className="modal-foot">
          <button className="btn secondary" onClick={() => setRenameKey(null)} disabled={renamingKey}>{L("取消", "Cancel")}</button>
          <button className="btn primary" onClick={renameWorkspaceKey} disabled={renamingKey || !renameName.trim()}>
            {renamingKey ? <span className="spin-dot" /> : <Icon name="i-edit" size={15} />}
            {renamingKey ? L("保存中…", "Saving...") : L("保存名称", "Save name")}
          </button>
        </div>
      </ModalShell>
    ) : null}
    </>
  );
}
