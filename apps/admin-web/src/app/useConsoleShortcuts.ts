import type { Dispatch, SetStateAction } from "react";
import { useEffect } from "react";
import type { Modal } from "../appConfig";

export function useConsoleShortcuts(input: {
  enabled: boolean;
  settingsOpen: boolean;
  metric: string | null;
  askMapleOpen: boolean;
  modal: Modal;
  userMenuOpen: boolean;
  workspacePickerOpen: boolean;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  setMetric: Dispatch<SetStateAction<string | null>>;
  setAskMapleOpen: Dispatch<SetStateAction<boolean>>;
  setModal: Dispatch<SetStateAction<Modal>>;
  setUserMenuOpen: Dispatch<SetStateAction<boolean>>;
  setWorkspacePickerOpen: Dispatch<SetStateAction<boolean>>;
}) {
  useEffect(() => {
    if (!input.enabled) return;
    function onKey(event: KeyboardEvent) {
      const meta = event.metaKey || event.ctrlKey;
      if (event.key === "Escape") {
        if (input.settingsOpen) return input.setSettingsOpen(false);
        if (input.metric) return input.setMetric(null);
        if (input.askMapleOpen) return input.setAskMapleOpen(false);
        if (input.modal) return input.setModal(null);
        if (input.userMenuOpen) return input.setUserMenuOpen(false);
        if (input.workspacePickerOpen) return input.setWorkspacePickerOpen(false);
        return;
      }
      if (meta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        const box = document.querySelector<HTMLInputElement>(".search-box input, .ws-search input");
        if (box) box.focus();
        return;
      }
      if (meta && event.key === ",") {
        event.preventDefault();
        input.setSettingsOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [input.enabled, input.settingsOpen, input.metric, input.askMapleOpen, input.modal, input.userMenuOpen, input.workspacePickerOpen]);
}
