import { useEffect, useState } from "react";
import { useI18n } from "../../appConfig";
import { MarkdownText, transcriptMessagesFromEvents } from "../../components/shared/events";
import type { SessionEvent } from "../../types";
import { Icon } from "../../ui";

// Collapsible thinking block — expanded while the model is still streaming its reasoning, then
// collapsed to a summary line once the terminal reasoning event arrives. Mirrors the builder's
// ReasoningBlock without importing across the quickstart domain.
function ThinkingBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(streaming);
  useEffect(() => { setOpen(streaming); }, [streaming]);
  return (
    <div className="ask-msg ask-reasoning">
      <button className="ask-reasoning-head" onClick={() => setOpen((value) => !value)}>
        <span className="ask-kicker">
          {streaming ? <span className="typing"><i /><i /><i /></span> : <Icon name="i-sparkles" size={14} />}
          {streaming ? t("ask.thinking") : t("ask.thought")}
        </span>
        <Icon name={open ? "i-chevron-down" : "i-chevron-right"} size={14} />
      </button>
      {open ? <div className="ask-reasoning-body"><MarkdownText text={text} /></div> : null}
    </div>
  );
}

// The conversation with Maple about the target session: a time-ordered stream of user questions,
// streamed thinking blocks, and answer bubbles, built from the ask session's own event log.
export function AskMapleTranscript({ events, working, optimisticQuestion = "" }: { events: SessionEvent[]; working: boolean; optimisticQuestion?: string }) {
  const { t } = useI18n();
  const messages = transcriptMessagesFromEvents(events);
  const reasoningStreaming = messages.some((message) => message.kind === "reasoning" && !message.final);
  const showOptimistic = optimisticQuestion.trim() && !messages.some((message) => message.kind === "user" && message.text.trim() === optimisticQuestion.trim());
  return (
    <div className="ask-transcript">
      {showOptimistic ? (
        <div className="ask-msg ask-user">
          <MarkdownText text={optimisticQuestion.trim()} />
        </div>
      ) : null}
      {messages.map((message) =>
        message.kind === "reasoning" ? (
          <ThinkingBlock key={message.id} text={message.text} streaming={!message.final} />
        ) : (
          <div className={message.kind === "user" ? "ask-msg ask-user" : "ask-msg ask-agent"} key={message.id}>
            {message.kind === "agent" ? <div className="ask-kicker"><Icon name="i-sparkles" size={14} /> Maple</div> : null}
            <MarkdownText text={message.text} />
          </div>
        )
      )}
      {working && !reasoningStreaming ? (
        <div className="ask-msg ask-agent"><span className="typing"><i /><i /><i /></span> {t("ask.working")}</div>
      ) : null}
    </div>
  );
}
