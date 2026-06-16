import type { MemoryStore } from "../../types";
import { Icon } from "../../ui";
import { useI18n } from "../../appConfig";
import { DataTable, PageFrame } from "../../components/shared/layout";

export function MemoryView({ memoryStores, seedMemory, loading = false }: { memoryStores: MemoryStore[]; seedMemory: () => void; loading?: boolean }) {
  const { language } = useI18n();
  const L = (zh: string, en: string) => (language === "zh" ? zh : en);
  return (
    <PageFrame
      title={<>{L("记忆库", "Memory stores")} <span className="title-count">{memoryStores.length}</span></>}
      sub={L("为 Agent 提供持久、跨会话的记忆。", "Give agents persistent, cross-session memory.")}
      action={<button className="btn primary" onClick={seedMemory}><Icon name="i-database" size={15} /> {L("写入示例记忆", "Seed memory")}</button>}
    >
      {memoryStores.length || loading ? (
        <DataTable headers={["ID", L("名称", "Name"), L("描述", "Description")]} loading={loading}>
          {memoryStores.map((store) => (
            <tr key={store.id} className="clickable-row">
              <td><span className="id-link">{store.id}</span></td>
              <td className="t-name">{store.name}</td>
              <td>{store.description}</td>
            </tr>
          ))}
        </DataTable>
      ) : (
        <div className="empty-state">
          <div className="es-ico"><Icon name="i-memory" size={22} /></div>
          <b>{L("还没有记忆库", "No memory stores yet")}</b>
          <span>{L("写入一条示例记忆来创建第一个记忆库。", "Seed a sample memory to create your first store.")}</span>
          <button className="btn primary" onClick={seedMemory}><Icon name="i-database" size={15} /> {L("写入示例记忆", "Seed memory")}</button>
        </div>
      )}
    </PageFrame>
  );
}
