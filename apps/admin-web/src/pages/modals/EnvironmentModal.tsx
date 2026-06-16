import { useI18n } from "../../appConfig";
import { ModalShell } from "../../components/shared/layout";
import { EnvironmentForm } from "./EnvironmentForm";

export function EnvironmentModal({ workspaceId, sandboxProvider, onClose, onCreated }: { workspaceId?: string; sandboxProvider?: string; onClose: () => void; onCreated: () => void }) {
  const { t } = useI18n();
  return (
    <ModalShell title={t("env.createTitle")} onClose={onClose}>
      <EnvironmentForm workspaceId={workspaceId} sandboxProvider={sandboxProvider} onClose={onClose} onCreated={() => onCreated()} />
    </ModalShell>
  );
}
