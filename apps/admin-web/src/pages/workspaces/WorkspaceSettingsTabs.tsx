import type * as React from "react";
import { useState } from "react";
import { apiPatch } from "../../api";
import { maskSecret } from "../../components/shared/code";
import { apiKeyStatusPill, defaultToggle } from "../../components/shared/labels";
import { DataTable } from "../../components/shared/layout";
import { authProviderLabel, errorMessage, formatTime } from "../../components/shared/misc";
import type {
  JsonRecord,
  ModelConfig,
  RuntimePool,
  SandboxPool,
  Workspace,
  WorkspaceApiKey,
  WorkspaceMember
} from "../../types";
import { Icon, useToast } from "../../ui";
import { ProviderSettingsCard } from "./ProviderSettingsCard";
import { RuntimePoolDetails, SandboxPoolDetails } from "./RuntimePoolDetails";

type LFn = (zh: string, en: string) => string;

export function WorkspaceRuntimeTab(props: {
  L: LFn;
  runtimePool: RuntimePool | null;
  runtimeError: string;
  runtimeProvider: string;
  providerCredentials?: JsonRecord;
  onOpenRuntimePool?: (status?: string) => void;
}) {
  return (
    <>
      <div className="cfg-head"><Icon name="i-gauge" size={16} /> <b>{props.L("运行时池", "Runtime pool")}</b></div>
      <div className="cfg-cards">
        <RuntimeProviderCard runtimeProvider={props.runtimeProvider} runtimePool={props.runtimePool} providerCredentials={props.providerCredentials} onDetails={() => props.onOpenRuntimePool?.()} />
      </div>
      {props.runtimeError ? <div className="modal-note"><Icon name="i-alert" size={16} /> {props.runtimeError}</div> : null}
      {!props.runtimePool && !props.runtimeError ? <div className="empty-state">{props.L("正在加载运行时池…", "Loading runtime pool...")}</div> : null}
      {props.runtimePool ? (
        <>
          <RuntimePoolDetails pool={props.runtimePool} L={props.L} summaryOnly onOpenMembers={props.onOpenRuntimePool} />
        </>
      ) : null}
      <div className="modal-note"><Icon name="i-alert" size={16} /> {props.L("当前 API 下运行时池规格不可变。请通过新建工作区或开通流程调整。", "Runtime pool sizing is immutable in the current API. Create a new workspace or provisioning flow to change it.")}</div>
    </>
  );
}

export function RuntimeProviderCard(props: { runtimeProvider: string; runtimePool?: RuntimePool | null; providerCredentials?: JsonRecord; onDetails?: () => void }) {
  if (props.runtimeProvider === "local_docker") {
    return <ProviderSettingsCard icon="i-server" title="Local Docker Runtime" subtitle="Host Docker agent runtime" active fields={["DOCKER_SOCKET", "IMAGE", "PREWARMED_MEMBERS"]} snapshot={localDockerRuntimeSnapshot(props.runtimePool)} onDetails={props.onDetails} />;
  }
  return <ProviderSettingsCard icon="i-cloud" title="VeFaaS Runtime" subtitle="Agent runtime provider" active={props.runtimeProvider === "vefaas"} fields={["VOLCENGINE_ACCESS_KEY", "VOLCENGINE_SECRET_KEY"]} snapshot={props.providerCredentials?.vefaas} onDetails={props.onDetails} />;
}

export function WorkspaceProvidersTab(props: {
  L: LFn;
  sandboxProvider: string;
  providerCredentials?: JsonRecord;
  sandboxConfig?: JsonRecord;
  sandboxPool?: SandboxPool | null;
  sandboxError?: string;
  className?: string;
  onOpenSandboxPool?: (status?: string) => void;
}) {
  const sandboxCard = sandboxProviderCard(props);
  return (
    <>
      <div className="cfg-head"><Icon name="i-cloud" size={16} /> <b>{props.L("沙箱配置", "Sandbox providers")}</b></div>
      <div className={`cfg-cards${props.className ? ` ${props.className}` : ""}`}>
        <ProviderSettingsCard {...sandboxCard} subtitle="Sandbox/tool runtime provider" onDetails={() => props.onOpenSandboxPool?.()} />
      </div>
      {props.sandboxError ? <div className="modal-note"><Icon name="i-alert" size={16} /> {props.sandboxError}</div> : null}
      <SandboxPoolDetails pool={props.sandboxPool ?? null} L={props.L} summaryOnly onOpenMembers={props.onOpenSandboxPool} />
    </>
  );
}

function sandboxProviderCard(props: {
  sandboxProvider: string;
  providerCredentials?: JsonRecord;
  sandboxConfig?: JsonRecord;
}) {
  if (props.sandboxProvider === "local_docker") {
    return {
      icon: "i-server",
      title: "Local Docker Sandbox",
      active: true,
      fields: ["DOCKER_SOCKET", "IMAGE", "NETWORKING"],
      snapshot: localDockerSandboxSnapshot(props.sandboxConfig)
    };
  }
  if (props.sandboxProvider === "vefaas") {
    return {
      icon: "i-cloud",
      title: "VeFaaS Sandbox",
      active: true,
      fields: ["VEFAAS_SANDBOX_FUNCTION_ID", "VEFAAS_SANDBOX_GATEWAY_URL", "VEFAAS_SANDBOX_TIMEOUT_MS"],
      snapshot: compactRecord(vefaasSandboxSnapshot(props.sandboxConfig, props.providerCredentials))
    };
  }
  if (props.sandboxProvider === "daytona") {
    return {
      icon: "i-server",
      title: "Daytona",
      active: true,
      fields: ["DAYTONA_SERVER_URL", "DAYTONA_API_KEY"],
      snapshot: props.providerCredentials?.daytona
    };
  }
  return {
    icon: "i-server",
    title: "E2B",
    active: props.sandboxProvider === "e2b",
    fields: ["E2B_API_KEY"],
    snapshot: props.providerCredentials?.e2b
  };
}

function localDockerRuntimeSnapshot(pool?: RuntimePool | null) {
  const config = recordValue(pool?.config);
  const memberConfig = recordValue(pool?.members?.[0]?.config);
  return {
    DOCKER_SOCKET: "/var/run/docker.sock",
    IMAGE: stringValue(config.image ?? memberConfig.image) || "node:22-bookworm",
    PREWARMED_MEMBERS: String(pool?.desired_size ?? pool?.member_total ?? pool?.members?.length ?? "")
  };
}

function localDockerSandboxSnapshot(sandboxConfig?: JsonRecord) {
  const config = recordValue(sandboxConfig?.local_docker ?? sandboxConfig?.docker ?? sandboxConfig);
  const networking = recordValue(config.networking);
  return {
    DOCKER_SOCKET: "/var/run/docker.sock",
    IMAGE: stringValue(config.image) || "node:22-bookworm",
    NETWORKING: stringValue(networking.mode) || "limited"
  };
}

function vefaasSandboxSnapshot(sandboxConfig?: JsonRecord, providerCredentials?: JsonRecord) {
  const config = recordValue(sandboxConfig?.vefaas ?? sandboxConfig?.vefaas_sandbox ?? sandboxConfig);
  const creds = recordValue(providerCredentials?.vefaas_sandbox);
  return {
    VEFAAS_SANDBOX_FUNCTION_ID: stringValue(config.function_id ?? config.functionId ?? creds.VEFAAS_SANDBOX_FUNCTION_ID),
    VEFAAS_SANDBOX_GATEWAY_URL: stringValue(config.gateway_url ?? config.gatewayUrl ?? creds.VEFAAS_SANDBOX_GATEWAY_URL),
    VEFAAS_SANDBOX_TIMEOUT_MS: stringValue(config.timeout_ms ?? creds.VEFAAS_SANDBOX_TIMEOUT_MS)
  };
}

function compactRecord(record: Record<string, string>) {
  const entries = Object.entries(record).filter(([, value]) => value.trim());
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function recordValue(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

export function WorkspaceModelsTab(props: {
  L: LFn;
  modelConfigs: ModelConfig[];
  onModelsChanged?: () => Promise<void> | void;
}) {
  const toast = useToast();
  // Per-row busy flag while the set-default PATCH is in flight: block duplicate clicks.
  const [busyId, setBusyId] = useState("");
  // A global default and a workspace default can both be is_default=1 in their own scope, so the
  // pool may show two on toggles. Only lock the row when it is the *sole* default — otherwise
  // every row would be disabled and the user couldn't switch back (the bug this fixes). Permission
  // (tenant admin for global rows, workspace admin for workspace rows) is enforced by the PATCH
  // endpoint; a 403 surfaces as a toast rather than a pre-disabled toggle.
  const defaultCount = props.modelConfigs.filter((config) => config.is_default).length;
  const switchingName = props.modelConfigs.find((config) => config.id === busyId)?.name ?? "";
  const setDefault = async (config: ModelConfig) => {
    if (busyId || (config.is_default && defaultCount === 1)) return;
    setBusyId(config.id);
    try {
      await apiPatch(`/v1/model_configs/${config.id}`, { is_default: true });
      await props.onModelsChanged?.();
      toast(props.L("已设为默认模型", "Default model updated"), "ok");
    } catch (reason) {
      toast(errorMessage(reason), "err");
    } finally {
      setBusyId("");
    }
  };
  return (
    <>
      <div className="cfg-head"><Icon name="i-brain" size={16} /> <b>{props.L("工作区模型池", "Workspace model pool")}</b></div>
      <DataTable headers={[props.L("名称", "Name"), "Provider", props.L("模型", "Model"), props.L("默认", "Default"), "Key"]}>
        {props.modelConfigs.map((config) => (
          <tr key={config.id}>
            <td><strong>{config.name}</strong><small>{config.id}</small></td>
            <td>{config.provider_type}</td>
            <td>{config.model_name}</td>
            <td>{defaultToggle(config.is_default, {
              onClick: () => setDefault(config),
              disabled: (config.is_default && defaultCount === 1) || (!!busyId && busyId !== config.id),
              busy: busyId === config.id
            })}</td>
            <td>{config.has_api_key ? maskSecret(config.api_key_hint || "") : props.L("环境变量回退", "Env fallback")}</td>
          </tr>
        ))}
      </DataTable>
      <div className="modal-note"><Icon name="i-alert" size={16} /> {props.L("点击 Default 开关即可将该模型设为工作区默认；新增、测试或删除请在「模型管理」页操作。", "Toggle Default to make a model the workspace default; add, test, or delete from the Models page.")}</div>
      {busyId ? (
        <div className="tenant-switching" role="alert" aria-busy="true">
          <span className="boot-orbit"><i /><i /><i /></span>
          <div className="tenant-switching-text">{props.L("正在切换默认模型", "Switching default model")}{switchingName ? <> · <b>{switchingName}</b></> : null}…</div>
        </div>
      ) : null}
    </>
  );
}

export function WorkspaceMembersTab(props: {
  L: LFn;
  members: WorkspaceMember[];
  memberEmail: string;
  memberRole: "member" | "admin";
  memberBusy: string;
  memberError: string;
  setMemberEmail: (value: string) => void;
  setMemberRole: (value: "member" | "admin") => void;
  addMember: (event?: React.FormEvent) => void | Promise<void>;
  removeMember: (member: WorkspaceMember) => void | Promise<void>;
}) {
  return (
    <>
      <div className="cfg-head"><Icon name="i-users" size={16} /> <b>{props.L("工作区用户", "Workspace users")}</b></div>
      <form className="settings-inline-form member-create-form" onSubmit={props.addMember}>
        <label className="form">{props.L("邮箱", "Email")}<input className="fld" type="email" value={props.memberEmail} onChange={(event) => props.setMemberEmail(event.target.value)} placeholder={props.L("user@example.com", "user@example.com")} /></label>
        <label className="form">{props.L("角色", "Role")}
          <select className="fld" value={props.memberRole} onChange={(event) => props.setMemberRole(event.target.value as "member" | "admin")}>
            <option value="member">{props.L("成员", "Member")}</option>
            <option value="admin">{props.L("管理员", "Admin")}</option>
          </select>
        </label>
        <button className="btn primary" type="submit" disabled={props.memberBusy === "add" || !props.memberEmail.trim()}>
          {props.memberBusy === "add" ? props.L("添加中…", "Adding…") : props.memberRole === "admin" ? props.L("添加管理员", "Add admin") : props.L("添加用户", "Add user")}
        </button>
      </form>
      {props.memberError ? <div className="modal-note"><Icon name="i-alert" size={16} /> {props.memberError}</div> : null}
      <div className="settings-table members-table">
        <DataTable headers={[props.L("邮箱", "Email"), props.L("名称", "Name"), props.L("角色", "Role"), "Provider", props.L("加入时间", "Joined"), ""]}>
          {props.members.map((member) => {
            const locked = member.role === "owner";
            return (
              <tr key={member.user_id}>
                <td><strong>{member.email}</strong><small className="mono">{member.user_id}</small></td>
                <td>{member.name || member.email.split("@")[0]}</td>
                <td>{member.role === "member" ? props.L("成员", "Member") : <span className="status active">{member.role === "owner" ? props.L("所有者", "Owner") : member.role}</span>}</td>
                <td>{authProviderLabel(member.auth_provider)}</td>
                <td>{formatTime(member.created_at)}</td>
                <td className="actions-cell">
                  <button className="btn secondary compact danger-text" disabled={locked || props.memberBusy === member.user_id} onClick={() => props.removeMember(member)}>
                    <Icon name="i-x" size={13} /> {locked ? props.L("锁定", "Locked") : props.L("移除", "Remove")}
                  </button>
                </td>
              </tr>
            );
          })}
        </DataTable>
      </div>
    </>
  );
}

export function WorkspaceKeysTab(props: {
  L: LFn;
  workspace: Workspace;
  keys: WorkspaceApiKey[];
  issuedKey: string;
  keyName: string;
  creatingKey: boolean;
  settingsApiKeyPlaceholder: string;
  setKeyName: (value: string) => void;
  createKey: () => void | Promise<void>;
  copyIssuedKey: () => void;
  maskedWorkspaceKey: (key: WorkspaceApiKey) => string;
  copyWorkspaceApiKey: (key: WorkspaceApiKey) => void;
  copyWorkspaceApiKeyFromMasked: (event: React.ClipboardEvent<HTMLElement>, key: WorkspaceApiKey) => void;
  openRenameKeyModal: (key: WorkspaceApiKey) => void;
  onToggleKey: (key: WorkspaceApiKey) => void | Promise<void>;
  onDeleteKey: (key: WorkspaceApiKey) => void | Promise<void>;
}) {
  // Per-key busy flag for the async toggle/delete/copy actions: show a spinner on the row's
  // actions and block duplicate clicks while the request is in flight.
  const [busyKeyId, setBusyKeyId] = useState("");
  const runKey = async (key: WorkspaceApiKey, action: (key: WorkspaceApiKey) => void | Promise<void>) => {
    if (busyKeyId) return;
    setBusyKeyId(key.id);
    try {
      await action(key);
    } finally {
      setBusyKeyId("");
    }
  };
  return (
    <>
      <div className="cfg-head"><Icon name="i-key" size={16} /> <b>{props.L("工作区 API 秘钥", "Workspace API keys")}</b></div>
      {props.issuedKey ? (
        <div className="modal-note key-issued-note">
          <Icon name="i-check" size={16} />
          <div>
            <b>{props.L("完整 Workspace API key 已创建", "Full workspace API key issued")}</b>
            <p className="note-copy-once">{props.L("这是真实可用的完整 key。请立即复制；刷新页面或重新进入后无法再次查看完整密钥。", "This is the real full key. Copy it now; after refresh or re-entry, the full key cannot be viewed again.")}</p>
            <div className="reveal-key compact">
              <code>{props.issuedKey}</code>
              <button className="btn secondary compact" onClick={props.copyIssuedKey}><Icon name="i-copy" size={13} /> {props.L("复制完整 Key", "Copy full key")}</button>
            </div>
          </div>
        </div>
      ) : null}
      <div className="settings-inline-form key-create-row">
        <label className="form">{props.L("名称", "Display name")}<input className="fld" value={props.keyName} onChange={(event) => props.setKeyName(event.target.value)} placeholder={props.settingsApiKeyPlaceholder} /></label>
        <button className="btn primary" onClick={props.createKey} disabled={props.creatingKey || !props.workspace}>{props.creatingKey ? props.L("创建中…", "Creating...") : props.L("创建 Key", "Create key")}</button>
      </div>
      <div className="settings-table keys-table">
        <DataTable headers={[props.L("名称", "Name"), "Key", "Scopes", props.L("状态", "Status"), props.L("最后使用", "Last used"), ""]}>
          {props.keys.map((key) => (
            <tr key={key.id}>
              <td><strong>{key.display_name}</strong><small>{key.id}</small></td>
              <td><div className="secret-line ws-secret-line"><code className="mono" onCopy={(event) => props.copyWorkspaceApiKeyFromMasked(event, key)}>{props.maskedWorkspaceKey(key)}</code><button className="icon-btn" title={props.L("复制完整 Key", "Copy full key")} onClick={() => runKey(key, props.copyWorkspaceApiKey)} disabled={busyKeyId === key.id}><Icon name="i-copy" size={14} /></button></div></td>
              <td>{key.scopes.length ? <div className="scope-chip-row">{key.scopes.map((scope) => <span className="scope-chip" key={scope}>{scope}</span>)}</div> : "—"}</td>
              <td>{apiKeyStatusPill(key.enabled, props.L)}</td>
              <td>{key.last_used_at ? formatTime(key.last_used_at) : props.L("从未", "Never")}</td>
              <td className="actions-cell"><div className="action-row"><button className="btn secondary compact" onClick={() => props.openRenameKeyModal(key)} disabled={busyKeyId === key.id}>{props.L("重命名", "Rename")}</button><button className="btn secondary compact" onClick={() => runKey(key, props.onToggleKey)} disabled={busyKeyId === key.id}>{busyKeyId === key.id ? <span className="spin-dot" /> : null}{key.enabled ? props.L("停用", "Disable") : props.L("启用", "Enable")}</button><button className="btn secondary compact" onClick={() => runKey(key, props.onDeleteKey)} disabled={busyKeyId === key.id}><Icon name="i-trash" size={13} /></button></div></td>
            </tr>
          ))}
        </DataTable>
      </div>
    </>
  );
}
