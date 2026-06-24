import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiPut, type ApiList } from "../../api";
import type { MemoryRecord, MemoryStore } from "../../types";
import { Icon } from "../../ui";
import { useI18n } from "../../appConfig";
import { Select } from "../../components/shared/forms";
import { DataTable, ModalShell, PageFrame } from "../../components/shared/layout";
import { errorMessage, formatTime } from "../../components/shared/misc";

export function MemoryView({
  memoryStores,
  workspaceId,
  onChanged,
  loading = false
}: {
  memoryStores: MemoryStore[];
  workspaceId: string;
  onChanged: () => Promise<void> | void;
  loading?: boolean;
}) {
  const { language } = useI18n();
  const L = (zh: string, en: string) => (language === "zh" ? zh : en);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [query, setQuery] = useState("");
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const selectedStore = memoryStores.find((store) => store.id === selectedStoreId) ?? memoryStores[0] ?? null;
  const selectedMemory = memories.find((memory) => memory.path === selectedPath) ?? null;

  useEffect(() => {
    if (!selectedStoreId && memoryStores[0]) setSelectedStoreId(memoryStores[0].id);
    if (selectedStoreId && !memoryStores.some((store) => store.id === selectedStoreId)) setSelectedStoreId(memoryStores[0]?.id ?? "");
  }, [memoryStores, selectedStoreId]);

  useEffect(() => {
    if (!selectedStore) {
      setMemories([]);
      setSelectedPath("");
      return;
    }
    void loadMemories(selectedStore.id, query);
  }, [selectedStore?.id, query]);

  useEffect(() => {
    setDraftContent(selectedMemory?.content ?? "");
  }, [selectedMemory?.id, selectedMemory?.content]);

  const filteredStores = useMemo(() => {
    const needle = query.toLowerCase();
    if (!needle) return memoryStores;
    return memoryStores.filter((store) => `${store.id}\n${store.name}\n${store.description}\n${store.provider || "local"}`.toLowerCase().includes(needle));
  }, [memoryStores, query]);

  async function loadMemories(memoryStoreId: string, search = "") {
    try {
      const suffix = search ? `?query=${encodeURIComponent(search)}` : "";
      const result = await apiGet<ApiList<MemoryRecord>>(`/v1/memory_stores/${memoryStoreId}/memories${suffix}`);
      setMemories(result.data ?? []);
      setSelectedPath((current) => current && result.data?.some((memory) => memory.path === current) ? current : result.data?.[0]?.path ?? "");
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  async function saveSelectedMemory() {
    if (!selectedStore || !selectedPath) return;
    setBusy("save-memory");
    setError("");
    try {
      await apiPut(`/v1/memory_stores/${selectedStore.id}/memories/${selectedPath}`, { actor: "user", content: draftContent });
      await loadMemories(selectedStore.id, query);
      await onChanged();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy("");
    }
  }

  return (
    <PageFrame
      title={<>{L("记忆库", "Memory stores")} <span className="title-count">{memoryStores.length}</span></>}
      sub={L("为 Agent 提供持久、跨会话的记忆。", "Give agents persistent, cross-session memory.")}
      action={<button className="btn primary" onClick={() => setCreateOpen(true)}><Icon name="i-plus" size={15} /> {L("创建记忆库", "Create memory store")}</button>}
    >
      {error ? <div className="error-banner inline">{error}</div> : null}
      <div className="memory-toolbar">
        <label className="memory-search"><Icon name="i-search" size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={L("搜索记忆库或记忆…", "Search stores or memories...")} /></label>
      </div>
      {memoryStores.length || loading ? (
        <DataTable headers={["ID", L("名称", "Name"), L("状态", "Status"), "Provider", L("记忆", "Memories"), L("创建时间", "Created")]} loading={loading}>
          {filteredStores.map((store) => (
            <tr key={store.id} className={selectedStore?.id === store.id ? "sel clickable-row" : "clickable-row"} onClick={() => setSelectedStoreId(store.id)}>
              <td><span className="id-link">{store.id}</span></td>
              <td className="t-name">{store.name}<small>{store.description}</small></td>
              <td><span className="status active">{store.status || "active"}</span></td>
              <td className="mono">{store.provider || "local"}</td>
              <td>{store.memory_count ?? 0}</td>
              <td>{formatTime(store.created_at || "") || "-"}</td>
            </tr>
          ))}
        </DataTable>
      ) : (
        <div className="empty-state">
          <div className="es-ico"><Icon name="i-memory" size={22} /></div>
          <b>{L("还没有记忆库", "No memory stores yet")}</b>
          <span>{L("创建一个记忆库后，可以在 Session 或 Deployment 中挂载。", "Create a memory store, then attach it to sessions or deployments.")}</span>
          <button className="btn primary" onClick={() => setCreateOpen(true)}><Icon name="i-plus" size={15} /> {L("创建记忆库", "Create memory store")}</button>
        </div>
      )}
      {selectedStore ? (
        <section className="memory-detail">
          <div className="memory-detail-head">
            <div>
              <span className="breadcrumb">{L("记忆库", "Memory stores")} / {selectedStore.name}</span>
              <h2>{selectedStore.name}</h2>
              <p>{selectedStore.description || selectedStore.id}</p>
            </div>
            <button className="btn primary compact" onClick={() => setAddOpen(true)}><Icon name="i-plus" size={14} /> {L("添加记忆", "Add memory")}</button>
          </div>
          <div className="memory-detail-meta">
            <span>ID <b>{selectedStore.id}</b></span>
            <span>Status <b>{selectedStore.status || "active"}</b></span>
            <span>Provider <b>{selectedStore.provider || "local"}</b></span>
            {selectedStore.external_ref ? <span>URI <b>{selectedStore.external_ref}</b></span> : null}
          </div>
          <div className="memory-browser">
            <aside className="memory-tree memory-store-select">
              {memories.length ? memories.map((memory) => (
                <button key={memory.path} className={selectedPath === memory.path ? "tree-entry sel" : "tree-entry"} onClick={() => setSelectedPath(memory.path)}>
                  <Icon name={memory.path.includes("/") ? "i-folder" : "i-file"} size={14} />
                  <span>{memory.path}</span>
                </button>
              )) : <div className="memory-empty-tree">{L("暂无记忆", "No memories")}</div>}
            </aside>
            <section className="memory-preview">
              {selectedMemory ? (
                <>
                  <div className="memory-preview-head">
                    <div><b>{selectedMemory.path}</b><span>{formatTime(selectedMemory.updated_at || "") || selectedMemory.content_sha256 || ""}</span></div>
                    <button className="btn secondary compact" onClick={saveSelectedMemory} disabled={busy === "save-memory"}>{busy === "save-memory" ? <span className="spin-dot" /> : null}{L("保存", "Save")}</button>
                  </div>
                  <textarea className="file-editor memory-editor" value={draftContent} onChange={(event) => setDraftContent(event.target.value)} />
                </>
              ) : (
                <div className="memory-preview-empty">
                  <Icon name="i-file" size={22} />
                  <b>{L("选择一条记忆", "Select a memory")}</b>
                </div>
              )}
            </section>
          </div>
        </section>
      ) : null}
      {createOpen ? <CreateMemoryStoreModal workspaceId={workspaceId} onClose={() => setCreateOpen(false)} onCreated={async (store) => { setCreateOpen(false); setSelectedStoreId(store.id); await onChanged(); }} /> : null}
      {addOpen && selectedStore ? <AddMemoryModal store={selectedStore} onClose={() => setAddOpen(false)} onCreated={async (path) => { setAddOpen(false); await loadMemories(selectedStore.id, query); setSelectedPath(path); await onChanged(); }} /> : null}
    </PageFrame>
  );
}

function CreateMemoryStoreModal(props: { workspaceId: string; onClose: () => void; onCreated: (store: MemoryStore) => Promise<void> | void }) {
  const { language } = useI18n();
  const L = (zh: string, en: string) => (language === "zh" ? zh : en);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [provider, setProvider] = useState("local");
  const [baseUrl, setBaseUrl] = useState("");
  const [targetUri, setTargetUri] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function create() {
    setBusy(true);
    setError("");
    try {
      const store = await apiPost<MemoryStore>("/v1/memory_stores", {
        workspace_id: props.workspaceId,
        name: name.trim(),
        description: description.trim(),
        provider,
        openviking: provider === "openviking" ? { base_url: baseUrl.trim() || undefined, target_uri: targetUri.trim() || undefined, api_key: apiKey.trim() || undefined } : {}
      });
      await props.onCreated(store);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <ModalShell title={L("创建记忆库", "Create memory store")} onClose={props.onClose}>
      <p className="modal-sub">{L("Name and description 会进入 Agent 的记忆资源提示。", "Name and description are rendered in the agent memory prompt.")}</p>
      {error ? <div className="modal-note"><Icon name="i-alert" size={16} /> {error}</div> : null}
      <label className="form">{L("名称", "Name")}<input className="fld" value={name} onChange={(event) => setName(event.target.value)} placeholder="Project Memory" /></label>
      <label className="form">{L("描述", "Description")}<textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder={L("项目约定、用户偏好、历史错误…", "Project conventions, user preferences, historical errors...")} /></label>
      <div className="form"><span className="flabel-in">Provider</span><Select value={provider} options={[{ value: "local", label: "Local" }, { value: "openviking", label: "OpenViking" }]} onChange={setProvider} /></div>
      {provider === "openviking" ? (
        <>
          <label className="form">OpenViking Base URL<input className="fld" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://openviking.example.com" /></label>
          <label className="form">Target URI<input className="fld" value={targetUri} onChange={(event) => setTargetUri(event.target.value)} placeholder="viking://user/memories/project" /></label>
          <label className="form">API key<input className="fld" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={L("留空则使用 OPENVIKING_API_KEY", "Leave blank to use OPENVIKING_API_KEY")} /></label>
        </>
      ) : null}
      <div className="modal-foot">
        <button className="btn secondary" onClick={props.onClose}>{L("取消", "Cancel")}</button>
        <button className="btn primary" disabled={busy || !name.trim()} onClick={create}>{busy ? <span className="btn-spin" /> : null}{L("创建", "Create")}</button>
      </div>
    </ModalShell>
  );
}

function AddMemoryModal(props: { store: MemoryStore; onClose: () => void; onCreated: (path: string) => Promise<void> | void }) {
  const { language } = useI18n();
  const L = (zh: string, en: string) => (language === "zh" ? zh : en);
  const [path, setPath] = useState("projects/conventions.md");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function create() {
    setBusy(true);
    setError("");
    try {
      await apiPut(`/v1/memory_stores/${props.store.id}/memories/${path.trim()}`, { actor: "user", content });
      await props.onCreated(path.trim());
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <ModalShell title={L("添加记忆", "Add memory")} onClose={props.onClose} wide>
      <p className="modal-sub">{L("目录由路径里的斜杠自动派生。", "folders are derived from slashes in path.")}</p>
      {error ? <div className="modal-note"><Icon name="i-alert" size={16} /> {error}</div> : null}
      <label className="form">Path<input className="fld mono" value={path} onChange={(event) => setPath(event.target.value)} /></label>
      <label className="form">Content<textarea className="file-editor" value={content} onChange={(event) => setContent(event.target.value)} /></label>
      <div className="modal-foot">
        <button className="btn secondary" onClick={props.onClose}>{L("取消", "Cancel")}</button>
        <button className="btn primary" disabled={busy || !path.trim()} onClick={create}>{busy ? <span className="btn-spin" /> : <Icon name="i-plus" size={14} />}{L("创建记忆", "Create memory")}</button>
      </div>
    </ModalShell>
  );
}
