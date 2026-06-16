import { eventRole, renderEventContent } from "../../components/shared/events";
import { formatTime } from "../../components/shared/misc";
import type { SessionDetail, SessionEvent } from "../../types";
import { useToast } from "../../ui";

type LFn = (zh: string, en: string) => string;

export function eventBarClass(event: SessionEvent) {
  if (event.type.includes("failed") || event.type.includes("error")) return "error";
  const role = eventRole(event.type, event);
  if (role === "Tool") return "tool";
  if (role === "User") return "user";
  if (role === "Agent") return "agent";
  return "";
}

export function composerPlaceholder(status: string | undefined, L: LFn) {
  if (status === "installing_packages") return L("正在安装依赖,请稍候…", "Installing packages, please wait…");
  if (status === "running") return L("Agent 正在回复…", "Agent is replying…");
  if (status === "bootstrapping") return L("环境启动中,请稍候…", "Bootstrapping the sandbox, please wait…");
  return L("给 agent 发送一条消息…（回车发送）", "Send a message to the agent…  (Enter)");
}

export function runningSessionLabel(events: SessionEvent[], L: LFn) {
  const latest = [...events].reverse().find((event) => event.type.startsWith("session.status_") || event.type.startsWith("agent."));
  if (latest?.type === "session.status_preparing_runtime") return L("准备运行时…", "Preparing runtime…");
  if (latest?.type === "session.status_installing_packages") return L("安装依赖…", "Installing packages…");
  return L("正在生成…", "Generating…");
}

function transcriptTextFrom(events: SessionEvent[]) {
  return events
    .filter((event) => {
      const role = eventRole(event.type, event);
      return role === "User" || role === "Agent" || role === "Tool";
    })
    .map((event) => `${eventRole(event.type, event)} · ${formatTime(event.created_at)}\n${renderEventContent(event)}`)
    .join("\n\n--------\n\n");
}

// Copy/download of the transcript, kept out of the view so SessionsView stays under the line cap.
export function useTranscriptActions(detail: SessionDetail | null, timelineEvents: SessionEvent[], L: LFn) {
  const toast = useToast();
  const transcriptText = transcriptTextFrom(timelineEvents);

  function copyTranscript() {
    if (!detail) return;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(transcriptText).then(
        () => toast(L("已复制对话", "Transcript copied")),
        () => toast(L("复制失败", "Copy failed"), "err")
      );
    } else {
      toast(L("已复制对话", "Transcript copied"));
    }
  }

  function downloadTranscript() {
    if (!detail) return;
    const blob = new Blob([transcriptText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${detail.session.id ?? "session"}-transcript.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast(L("已下载对话", "Transcript downloaded"));
  }

  return { copyTranscript, downloadTranscript };
}
