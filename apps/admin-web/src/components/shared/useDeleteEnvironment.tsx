import { useState } from "react";
import { apiDelete, apiGet } from "../../api";
import type { Agent, Session } from "../../types";
import { useConfirm, useToast } from "../../ui";
import { useI18n } from "../../appConfig";
import { DeleteEnvironmentBody } from "./DeleteEnvironmentBody";
import { errorMessage } from "./misc";

type DeletePreview = { related_agents: Agent[]; related_sessions: Session[]; can_delete_without_force: boolean };

export function useDeleteEnvironment() {
  const { language } = useI18n();
  const L = (zh: string, en: string) => (language === "zh" ? zh : en);
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function run(environmentId: string, onDeleted: () => void) {
    setBusy(true);
    try {
      const preview = await apiGet<DeletePreview>(`/v1/environments/${environmentId}/delete_preview`);
      const intro = preview.can_delete_without_force
        ? L("这个环境没有关联 Agent 或 Session。删除后会从环境列表中归档。", "This environment has no linked agents or sessions. It will be archived from the environment list.")
        : L("这个环境仍有关联资源，删除会归档环境，但历史 Session 会保留可追溯信息。", "This environment still has linked resources. Deletion archives the environment while historical sessions keep traceability.");
      const body = preview.can_delete_without_force
        ? intro
        : <DeleteEnvironmentBody agents={preview.related_agents} sessions={preview.related_sessions} intro={intro} L={L} />;
      const ok = await confirm({ title: L("删除环境", "Delete environment"), body, confirmLabel: L("删除", "Delete"), cancelLabel: L("取消", "Cancel"), danger: true });
      if (!ok) return;
      await apiDelete(`/v1/environments/${environmentId}?force=1`);
      toast(L("环境已删除", "Environment deleted"), "ok");
      onDeleted();
    } catch (reason) {
      toast(errorMessage(reason), "err");
    } finally {
      setBusy(false);
    }
  }

  return { run, busy };
}
