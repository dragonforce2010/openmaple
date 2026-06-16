import { useEffect, useState } from "react";
import { apiPatch } from "../../api";
import type { JsonRecord } from "../../types";
import { Icon, useDrawerStack, useToast } from "../../ui";
import { useEntityNav, useI18n } from "../../appConfig";
import { environmentRuntimeLabel, workspaceLabel } from "../../components/shared/labels";
import { Crumb, PageFrame } from "../../components/shared/layout";
import { errorMessage } from "../../components/shared/misc";
import { useDeleteEnvironment } from "../../components/shared/useDeleteEnvironment";

export function envNetLabel(mode: string, L: (zh: string, en: string) => string) {
  const map: Record<string, string> = {
    cloud_limited: L("云端 · 受限", "Cloud · limited"),
    cloud_unrestricted: L("云端 · 不限制", "Cloud · unrestricted"),
    limited: L("受限", "Limited"),
    bridge: L("不限制", "Unrestricted"),
    none: L("无网络", "No network")
  };
  return map[mode] ?? mode;
}

export function EnvDetailView(props: { envId: string; edit?: boolean; embedded?: boolean }) {
  const { language } = useI18n();
  const L = (zh: string, en: string) => (language === "zh" ? zh : en);
  const toast = useToast();
  const drawerStack = useDrawerStack();
  const { run: removeEnvironment, busy: deleteBusy } = useDeleteEnvironment();
  const { data, openEntity, goView, refresh } = useEntityNav();
  const { environments, workspaces } = data;
  const env = environments.find((item) => item.id === props.envId) ?? environments[0] ?? null;
  const cfg = (env?.config ?? {}) as JsonRecord;
  const initialNet = String((cfg.networking as JsonRecord | undefined)?.mode ?? "cloud_limited");
  const initialDesc = String(cfg.description ?? "");
  const rawPkgs = Array.isArray(cfg.packages) ? (cfg.packages as unknown[]) : [];
  const initialPkgs: Array<[string, string]> = rawPkgs.map((p) => {
    if (Array.isArray(p)) return [String(p[0] ?? "pip"), String(p[1] ?? "")];
    const o = p as { manager?: unknown; name?: unknown };
    return [String(o.manager ?? "pip"), String(o.name ?? "")];
  });
  const metaObj = (cfg.metadata as JsonRecord | undefined) ?? {};
  const initialMeta: Array<[string, string]> = Object.entries(metaObj).map(([k, v]) => [k, String(v)]);

  const [draftName, setName] = useState(env?.name ?? "");
  const [desc, setDesc] = useState(initialDesc);
  const [net, setNet] = useState(initialNet);
  const [pkgs, setPkgs] = useState<Array<[string, string]>>(initialPkgs);
  const [meta, setMeta] = useState<Array<[string, string]>>(initialMeta);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const relatedSessions = data.sessions.filter((session) => session.environment_id === env?.id);
  const relatedAgentIds = new Set(relatedSessions.map((session) => session.agent_id));
  const relatedAgents = data.agents.filter((agent) => relatedAgentIds.has(agent.id));

  const PKG_MGRS = ["pip", "npm", "pnpm", "apt", "cargo", "go"];
  const NET_OPTS: Array<[string, string]> = [
    ["cloud_limited", envNetLabel("cloud_limited", L)],
    ["cloud_unrestricted", envNetLabel("cloud_unrestricted", L)]
  ];

  useEffect(() => {
    if (!env) return;
    setName(env.name);
    setDesc(String((env.config as JsonRecord).description ?? ""));
    setNet(String(((env.config as JsonRecord).networking as JsonRecord | undefined)?.mode ?? "cloud_limited"));
    setPkgs(initialPkgs);
    setMeta(initialMeta);
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env?.id]);

  if (!env) {
    return <PageFrame title={L("环境", "Environment")}><div className="empty-state"><b>{L("未找到环境", "Environment not found")}</b></div></PageFrame>;
  }

  const crumb = <Crumb parts={[{ label: L("环境", "Environments"), icon: "i-server", onClick: () => goView("environments") }, { label: env.name }]} />;

  async function save() {
    setSaving(true);
    setError("");
    try {
      await apiPatch(`/v1/environments/${env!.id}`, {
        name: draftName.trim() || env!.name,
        description: desc,
        config: {
          networking: { mode: net },
          packages: pkgs.filter((p) => p[1].trim()).map((p) => ({ manager: p[0], name: p[1].trim() })),
          description: desc
        },
        metadata: Object.fromEntries(meta.filter((m) => m[0].trim()).map((m) => [m[0].trim(), m[1]]))
      });
      await refresh();
      toast(L("配置已保存", "Configuration saved"));
      goView("environment", env!.id, false);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  function deleteEnvironment() {
    void removeEnvironment(env!.id, () => { void refresh(); goView("environments"); });
  }

  if (!props.edit) {
    const detailDoc = (
      <div className="detail-doc">
          {error ? <div className="modal-note"><Icon name="i-alert" size={16} /> {error}</div> : null}
          <div className="field-block">
            <div className="flabel">{L("描述", "Description")}</div>
            <div className="prose-box">{initialDesc || L("（无描述）", "(no description)")}</div>
          </div>
          <div className="field-block">
            <div className="flabel">{L("所属空间", "Workspace")}</div>
            <div className="chip-row">
              {(() => {
                const ws = workspaceLabel(workspaces, env.workspace_id);
                return ws
                  ? <button type="button" className="chip chip-button" onClick={() => openEntity("workspace", ws.id)}><Icon name="i-grid" size={14} /> {ws.name ?? ws.id}{ws.name ? <span className="mut mono">{ws.id}</span> : null}</button>
                  : <span className="hint">{L("未绑定空间", "No workspace bound")}</span>;
              })()}
            </div>
          </div>
          <div className="field-block">
            <div className="flabel">{L("网络", "Networking")}</div>
            <div className="chip-row"><span className="chip"><Icon name="i-cloud" size={14} /> {envNetLabel(initialNet, L)}</span></div>
          </div>
          <div className="field-block">
            <div className="flabel">{L("包", "Packages")}</div>
            <div className="chip-row">
              {initialPkgs.length ? initialPkgs.map((p, i) => (
                <span className="chip" key={i}><Icon name="i-package" size={14} /> <span className="mut">{p[0]}</span> {p[1]}</span>
              )) : <span className="hint">{L("未配置包", "No packages configured")}</span>}
            </div>
          </div>
          <div className="field-block">
            <div className="flabel">{L("元数据", "Metadata")}</div>
            {initialMeta.length ? (
              <div className="chip-row">{initialMeta.map((m, i) => <span className="chip" key={i}><span className="mut">{m[0]}</span> {m[1]}</span>)}</div>
            ) : <span className="hint">{L("无元数据", "No metadata")}</span>}
          </div>
          <div className="field-block">
            <div className="flabel">{L("关联 Agent", "Related agents")}</div>
            <div className="chip-row relatedAgents">
              {relatedAgents.length ? relatedAgents.map((agent) => (
                <button type="button" className="chip chip-button" key={agent.id} onClick={() => openEntity("agent", agent.id)}><Icon name="i-brain" size={14} /> {agent.name}<span className="mut mono">{agent.id}</span></button>
              )) : <span className="hint">{L("暂无关联 Agent", "No related agents")}</span>}
            </div>
          </div>
          <div className="field-block">
            <div className="flabel">{L("关联 Session", "Related sessions")}</div>
            <div className="chip-row relatedSessions">
              {relatedSessions.length ? relatedSessions.map((session) => (
                <button type="button" className="chip chip-button" key={session.id} onClick={() => openEntity("session", session.id)}><Icon name="i-terminal" size={14} /> {session.title}<span className="mut mono">{session.id}</span></button>
              )) : <span className="hint">{L("暂无关联 Session", "No related sessions")}</span>}
            </div>
          </div>
          <div className="edit-actions">
            <button className="btn primary" onClick={() => { drawerStack.closeAll(); goView("environment", env!.id, true); }}><Icon name="i-edit" size={14} /> {L("编辑环境", "Edit environment")}</button>
            <button className="btn secondary danger-text" onClick={deleteEnvironment} disabled={deleteBusy}>{deleteBusy ? <span className="btn-spin" aria-hidden /> : <Icon name="i-trash" size={14} />} {deleteBusy ? L("删除中…", "Deleting…") : L("删除环境", "Delete environment")}</button>
          </div>
        </div>
    );
    return props.embedded ? detailDoc : (
      <PageFrame
        title={<>{env.name} <span className="status active">{L("启用", "Active")}</span></>}
        sub={<><span className="mono">{env.id}</span> · {environmentRuntimeLabel(env)}</>}
        crumb={crumb}
        action={<button className="btn primary" onClick={() => goView("environment", env.id, true)}><Icon name="i-edit" size={15} /> {L("编辑", "Edit")}</button>}
      >
        {detailDoc}
      </PageFrame>
    );
  }

  return (
    <PageFrame title={`${L("编辑", "Edit")} ${env.name}`} crumb={crumb}>
      <div className="edit-form">
        {error ? <div className="modal-note"><Icon name="i-alert" size={16} /> {error}</div> : null}
        <label className="form">{L("名称", "Name")}<input className="fld" value={draftName} onChange={(e) => setName(e.target.value)} placeholder={L("环境名称", "Environment name")} /></label>
        <label className="form">{L("描述", "Description")}<textarea className="fld" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={L("这个环境用于…", "This environment is used for…")} /></label>
        <label className="form">{L("网络", "Networking")} · {L("外联策略", "Egress policy")}
          <select className="fld" value={net} onChange={(e) => setNet(e.target.value)}>
            {NET_OPTS.map((o) => <option key={o[0]} value={o[0]}>{o[1]}</option>)}
          </select>
        </label>
        <div className="field-block">
          <div className="flabel">{L("包", "Packages")}</div>
          {pkgs.length ? pkgs.map((p, i) => (
            <div className="repeat-row" key={i}>
              <select className="fld pkg-mgr" value={p[0]} onChange={(e) => setPkgs((cur) => cur.map((x, j) => j === i ? [e.target.value, x[1]] : x))}>
                {PKG_MGRS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <input className="fld pkg-name" value={p[1]} placeholder="package==1.0.0" onChange={(e) => setPkgs((cur) => cur.map((x, j) => j === i ? [x[0], e.target.value] : x))} />
              <button className="row-del" title={L("删除", "Remove")} onClick={() => setPkgs((cur) => cur.filter((_, j) => j !== i))}><Icon name="i-trash" size={14} /></button>
            </div>
          )) : <div className="hint" style={{ marginBottom: 8 }}>{L("暂无包", "No packages yet")}</div>}
          <button className="add-row" onClick={() => setPkgs((cur) => [...cur, ["pip", ""]])}><Icon name="i-plus" size={14} /> {L("添加包", "Add package")}</button>
          <div className="hint" style={{ marginTop: 8 }}>{L("包会在该环境的会话首次运行时安装,期间显示安装进度;安装失败不会阻断会话。", "Packages install on the session's first run with live progress; failures won't block the session.")}</div>
        </div>
        <div className="field-block">
          <div className="flabel">{L("元数据", "Metadata")}</div>
          {meta.length ? meta.map((m, i) => (
            <div className="repeat-row kv2" key={i}>
              <input className="fld meta-k" value={m[0]} placeholder="client_team" onChange={(e) => setMeta((cur) => cur.map((x, j) => j === i ? [e.target.value, x[1]] : x))} />
              <input className="fld meta-v" value={m[1]} placeholder="data-analytics" onChange={(e) => setMeta((cur) => cur.map((x, j) => j === i ? [x[0], e.target.value] : x))} />
              <button className="row-del" title={L("删除", "Remove")} onClick={() => setMeta((cur) => cur.filter((_, j) => j !== i))}><Icon name="i-trash" size={14} /></button>
            </div>
          )) : <div className="hint" style={{ marginBottom: 8 }}>{L("暂无元数据", "No metadata yet")}</div>}
          <button className="add-row" onClick={() => setMeta((cur) => [...cur, ["", ""]])}><Icon name="i-plus" size={14} /> {L("添加字段", "Add field")}</button>
        </div>
        <div className="edit-actions">
          <button className="btn primary" onClick={save} disabled={saving}>{saving ? <span className="btn-spin" aria-hidden /> : <Icon name="i-save" size={14} />} {saving ? L("保存中…", "Saving…") : L("保存更改", "Save changes")}</button>
          <button className="btn secondary" onClick={() => goView("environment", env!.id, false)}>{L("取消", "Cancel")}</button>
        </div>
      </div>
    </PageFrame>
  );
}
