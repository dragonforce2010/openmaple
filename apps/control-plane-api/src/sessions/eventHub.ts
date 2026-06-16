import type { Response } from "express";
import type { SessionEvent } from "../types";

type Client = {
  id: string;
  response: Response;
  compat?: boolean;
};

const clients = new Map<string, Client[]>();

export function addStreamClient(sessionId: string, client: Client) {
  const existing = clients.get(sessionId) ?? [];
  existing.push(client);
  clients.set(sessionId, existing);

  if (client.compat) {
    client.response.write(": ready\n\n");
  } else {
    client.response.write(`event: ready\n`);
    client.response.write(`data: ${JSON.stringify({ session_id: sessionId })}\n\n`);
  }

  client.response.on("close", () => {
    const next = (clients.get(sessionId) ?? []).filter((item) => item.id !== client.id);
    if (next.length === 0) {
      clients.delete(sessionId);
      return;
    }
    clients.set(sessionId, next);
  });
}

export function emitSessionEvent(event: SessionEvent) {
  const sessionClients = clients.get(event.session_id) ?? [];
  for (const client of sessionClients) {
    if (client.compat && shouldHideCompatEvent(event)) continue;
    client.response.write(`event: ${event.type}\n`);
    client.response.write(`data: ${JSON.stringify(toWireSessionEvent(event))}\n\n`);
  }
}

export function shouldHideCompatEvent(event: SessionEvent) {
  if (event.type === "agent.message_delta") return true;
  // reasoning is a platform-private thinking side-channel; not part of the Anthropic message
  // protocol, so hide both the streaming and terminal events from compat (x-api-key) clients.
  if (event.type === "agent.reasoning_delta" || event.type === "agent.reasoning") return true;
  if (event.type === "session.status_idle" && !event.payload?.stop_reason) return true;
  return false;
}

export function toWireSessionEvent(event: SessionEvent) {
  const payload = event.payload ?? {};
  const content =
    Array.isArray(payload.content)
      ? payload.content
      : typeof payload.text === "string"
        ? [{ type: "text", text: payload.text }]
        : undefined;
  return {
    ...event,
    ...payload,
    ...(content ? { content } : {}),
    type: event.type,
    payload,
    created_at: event.created_at
  };
}
