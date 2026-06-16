import { Fragment, useState } from "react";
import { useEntityNav, useI18n } from "../../appConfig";
import { Select } from "../../components/shared/forms";
import { statusPill } from "../../components/shared/labels";
import { ListLoadingState, PageFrame } from "../../components/shared/layout";
import { formatRelativeTime } from "../../components/shared/misc";
import type { Vault } from "../../types";
import { Icon } from "../../ui";

export function VaultsView(props: { vaults: Vault[]; openCreate: () => void; openMcp: () => void; loading?: boolean }) {
  const { language } = useI18n();
  const { openEntity } = useEntityNav();
  const L = (zh: string, en: string) => (language === "zh" ? zh : en);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const filteredVaults = props.vaults.filter((vault) => {
    const haystack = `${vault.id} ${vault.display_name}`.toLowerCase();
    const matchesQuery = !query.trim() || haystack.includes(query.trim().toLowerCase());
    const matchesStatus = statusFilter === "all" || statusFilter === "active";
    return matchesQuery && matchesStatus;
  });

  return (
    <PageFrame
      title={L("凭证库", "Credential vaults")}
      sub={L("管理供 Agent 访问 MCP servers 与其他工具的 credential vaults。", "Manage credential vaults that provide agents with access to MCP servers and other tools.")}
      action={
        <Fragment>
          <button className="btn secondary" onClick={props.openMcp}>
            <Icon name="i-key" size={15} /> {L("接入 MCP", "Connect MCP")}
          </button>
          <button className="btn primary" onClick={props.openCreate}>
            <Icon name="i-plus" size={15} /> {L("新建凭证库", "New vault")}
          </button>
        </Fragment>
      }
    >
      <div className="vault-toolbar">
        <label className="vault-search">
          <Icon name="i-search" size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={L("按名称或精确 ID 搜索", "Search by name or exact ID")} />
        </label>
        <div className="vault-status-filter">
          <Icon name="i-filter" size={15} />
          <Select
            value={statusFilter}
            options={[{ value: "all", label: L("全部状态", "Status") }, { value: "active", label: L("启用", "Active") }]}
            onChange={setStatusFilter}
          />
        </div>
      </div>

      {props.loading && !props.vaults.length ? (
        <ListLoadingState />
      ) : !props.vaults.length ? (
        <div className="vault-empty">
          <span><Icon name="i-lock" size={22} /></span>
          <b>{L("还没有 vaults", "No vaults yet")}</b>
          <p>{L("创建第一个 vault 后即可保存 MCP OAuth 和 token。", "Create your first vault to get started.")}</p>
          <button className="btn primary" onClick={props.openCreate}><Icon name="i-plus" size={14} /> {L("创建凭证库", "Create vault")}</button>
        </div>
      ) : filteredVaults.length ? (
        <div className="vault-index card">
          <table className="data-table vault-list-table">
            <thead><tr><th>ID</th><th>{L("名称", "Name")}</th><th>{L("状态", "Status")}</th><th>{L("创建时间", "Created")}</th></tr></thead>
            <tbody>
              {filteredVaults.map((vault) => (
                <tr key={vault.id} className="clickable-row" onClick={() => openEntity("vault", vault.id)}>
                  <td><span className="id-link">{vault.id}</span></td>
                  <td className="t-name"><b>{vault.display_name}</b><small>{vault.credential_count ?? 0} {L("条凭据", "credentials")}</small></td>
                  <td>{statusPill("active", L)}</td>
                  <td>{formatRelativeTime(vault.created_at, language)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="vault-empty compact">
          <span><Icon name="i-search" size={20} /></span>
          <b>{L("没有匹配结果", "No matching vaults")}</b>
          <p>{L("换一个名称或 ID 继续搜索。", "Try a different name or ID.")}</p>
        </div>
      )}
    </PageFrame>
  );
}
