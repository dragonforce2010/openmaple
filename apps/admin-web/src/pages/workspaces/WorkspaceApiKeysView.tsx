import { useState, type ClipboardEvent } from "react";
import { apiGet, type ApiList } from "../../api";
import { useI18n } from "../../appConfig";
import { maskSecret } from "../../components/shared/code";
import { apiKeyStatusPill } from "../../components/shared/labels";
import { DataTable, ModalShell, PageFrame } from "../../components/shared/layout";
import { errorMessage, formatRelativeTime, writeClipboard } from "../../components/shared/misc";
import type { Workspace, WorkspaceApiKey } from "../../types";
import { Icon, useToast } from "../../ui";

export function WorkspaceApiKeysView(props: {
  workspace: Workspace | null;
  keys: WorkspaceApiKey[];
  issuedKey: string;
  onCreate: (displayName: string) => void | Promise<void>;
  onRename: (key: WorkspaceApiKey, displayName: string) => void | Promise<void>;
  onToggle: (key: WorkspaceApiKey) => void;
  onDelete: (key: WorkspaceApiKey) => void;
  loading?: boolean;
}) {
  const { language } = useI18n();
  const toast = useToast();
  const L = (zh: string, en: string) => (language === "zh" ? zh : en);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [renameKey, setRenameKey] = useState<WorkspaceApiKey | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState("");

  const apiKeyPlaceholder = `${props.workspace?.name?.trim() || L("workspace 名称", "workspace-name")}-apikey`;
  const title = (
    <>
      {L("API Keys", "API keys")} <span className="title-count">{props.keys.length}</span>
    </>
  );

  function openCreateKeyModal() {
    setCreateName("");
    setCreateError("");
    setCreateOpen(true);
  }

  async function createKey() {
    const nextName = createName.trim() || apiKeyPlaceholder;
    setCreating(true);
    setCreateError("");
    try {
      await props.onCreate(nextName);
      setCreateOpen(false);
    } catch (reason) {
      setCreateError(errorMessage(reason));
    } finally {
      setCreating(false);
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
    setRenaming(true);
    setRenameError("");
    try {
      await props.onRename(renameKey, nextName);
      setRenameKey(null);
    } catch (reason) {
      setRenameError(errorMessage(reason));
    } finally {
      setRenaming(false);
    }
  }

  const createBtn = (
    <button className="btn primary" onClick={openCreateKeyModal} disabled={!props.workspace}>
      <Icon name="i-plus" size={15} /> {L("创建 Key", "Create key")}
    </button>
  );

  async function copyIssued() {
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

  return (
    <>
      <PageFrame
        title={title}
        sub={L(
          "API Key 归属于工作区，即使创建者被移除仍保持有效。",
          "API keys are owned by workspaces and remain active even after the creator is removed."
        )}
        action={createBtn}
      >
      {props.issuedKey ? (
        <div className="card" style={{ padding: "16px 18px", marginBottom: 16 }}>
          <div className="section-title" style={{ margin: "0 0 10px" }}>
            {L("完整 Workspace API key 已创建", "Full workspace API key issued")}
          </div>
          <div className="modal-note" style={{ marginBottom: 10 }}>
            <Icon name="i-alert" size={16} />
            {L(
              "这是真实可用的完整 key，请立即复制并妥善保存。刷新页面或重新进入后无法再次查看完整密钥；如需新的完整 key，请重新创建。",
              "This is the real full key. Copy and store it now. After refresh or re-entry, the full key cannot be viewed again; create a new key if you need another full key."
            )}
          </div>
          <div className="reveal-key">
            <code>{props.issuedKey}</code>
            <button className="btn secondary compact" onClick={copyIssued}>
              <Icon name="i-copy" size={13} /> {L("复制完整 Key", "Copy full key")}
            </button>
          </div>
        </div>
      ) : null}

      {props.keys.length || props.loading ? (
        <DataTable
          loading={props.loading}
          headers={[
            L("名称", "Name"),
            "Key",
            L("Scopes", "Scopes"),
            L("状态", "Status"),
            L("最近使用", "Last used"),
            ""
          ]}
        >
          {props.keys.map((key) => (
            <tr key={key.id}>
              <td>
                <span className="t-name">{key.display_name}</span>
                <small className="mono">{key.id}</small>
              </td>
              <td>
                <div className="secret-line ws-secret-line">
                  <code onCopy={(event) => copyWorkspaceApiKeyFromMasked(event, key)}>{maskedWorkspaceKey(key)}</code>
                  <button className="icon-btn" title={L("复制完整 Key", "Copy full key")} onClick={() => void copyWorkspaceApiKey(key)}>
                    <Icon name="i-copy" size={14} />
                  </button>
                </div>
              </td>
              <td>
                {key.scopes.length ? (
                  <div className="scope-chip-row">
                    {key.scopes.map((scope) => <span className="scope-chip" key={scope}>{scope}</span>)}
                  </div>
                ) : "—"}
              </td>
              <td>{apiKeyStatusPill(key.enabled, language)}</td>
              <td>{key.last_used_at ? formatRelativeTime(key.last_used_at, language) : L("从未", "Never")}</td>
              <td className="row-actions">
                <div className="action-row">
                  <button className="btn secondary compact" onClick={() => openRenameKeyModal(key)}>
                    <Icon name="i-edit" size={13} /> {L("重命名", "Rename")}
                  </button>
                  <button className="btn secondary compact" onClick={() => props.onToggle(key)}>
                    {key.enabled ? L("停用", "Disable") : L("启用", "Enable")}
                  </button>
                  <button
                    className="btn secondary compact"
                    title={L("删除", "Delete")}
                    aria-label={L("删除", "Delete")}
                    onClick={() => props.onDelete(key)}
                  >
                    <Icon name="i-trash" size={13} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
      ) : (
        <div className="empty-state">
          <div className="es-ico">
            <Icon name="i-key" size={22} />
          </div>
          <b>{L("该工作区暂无 API Key", "No API keys in this workspace")}</b>
          <span>{L("创建第一个 API Key 来调用托管 Agent。", "Create your first key to call the managed agents API.")}</span>
          <button className="btn primary" onClick={openCreateKeyModal} disabled={!props.workspace}>
            <Icon name="i-plus" size={15} /> {L("创建 Key", "Create key")}
          </button>
        </div>
      )}
      </PageFrame>
      {createOpen ? (
        <ModalShell title={L("创建 API Key", "Create API key")} onClose={() => setCreateOpen(false)}>
          <p className="modal-sub">{L("Key 创建后只会展示一次完整值。请创建后立即复制保存。", "The full key is shown only once. Copy and store it immediately after creation.")}</p>
          {createError ? <div className="modal-note"><Icon name="i-alert" size={16} /> {createError}</div> : null}
          <label className="form">
            {L("名称", "Name")}
            <input
              className="fld"
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void createKey();
                }
              }}
              autoFocus
              placeholder={apiKeyPlaceholder}
            />
          </label>
          <div className="modal-note">
            <Icon name="i-key" size={16} />
            {L("默认授予 control_plane 与 data_plane scope，可用于控制面和运行面 API。", "Defaults to control_plane and data_plane scopes for control-plane and data-plane APIs.")}
          </div>
          <div className="modal-foot">
            <button className="btn secondary" onClick={() => setCreateOpen(false)} disabled={creating}>{L("取消", "Cancel")}</button>
            <button className="btn primary" onClick={createKey} disabled={creating}>
              {creating ? <span className="spin-dot" /> : <Icon name="i-plus" size={15} />}
              {creating ? L("创建中…", "Creating...") : L("创建 Key", "Create key")}
            </button>
          </div>
        </ModalShell>
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
              placeholder={apiKeyPlaceholder}
            />
          </label>
          <div className="modal-note">
            <Icon name="i-key" size={16} />
            <span className="mono">{renameKey.id}</span>
          </div>
          <div className="modal-foot">
            <button className="btn secondary" onClick={() => setRenameKey(null)} disabled={renaming}>{L("取消", "Cancel")}</button>
            <button className="btn primary" onClick={renameWorkspaceKey} disabled={renaming || !renameName.trim()}>
              {renaming ? <span className="spin-dot" /> : <Icon name="i-edit" size={15} />}
              {renaming ? L("保存中…", "Saving...") : L("保存名称", "Save name")}
            </button>
          </div>
        </ModalShell>
      ) : null}
    </>
  );
}
