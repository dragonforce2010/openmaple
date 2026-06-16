import { useRef } from "react";
import { apiGet } from "../api";
import { errorMessage } from "../components/shared/misc";
import type { SessionDetail } from "../types";
import { builderFailureMessage } from "./quickstartBuilderPolling";
import { useSessionEventStream } from "./useSessionEventStream";

const SETTLED_STATUSES = new Set(["idle", "failed", "terminated"]);

// Builder turns run async on the server; SSE is the only live channel (no polling). Any builder
// event re-fetches its detail; once the session status settles we clear the builder busy state
// and surface a failure toast. Mirrors useSelectedSessionDetail's pure-SSE model.
export function useBuilderTurnStream(input: {
  sessionId: string;
  applyDetail: (detail: SessionDetail) => void;
  onSettled: (failure: string) => void;
}) {
  const applyRef = useRef(input.applyDetail);
  const settledRef = useRef(input.onSettled);
  applyRef.current = input.applyDetail;
  settledRef.current = input.onSettled;
  const { sessionId } = input;

  useSessionEventStream(sessionId, () => {
    if (!sessionId) return;
    apiGet<SessionDetail>(`/v1/sessions/${sessionId}/detail`, { timeoutMs: 12_000 })
      .then((detail) => {
        applyRef.current(detail);
        if (SETTLED_STATUSES.has(String(detail.session.status ?? ""))) settledRef.current(builderFailureMessage(detail));
      })
      .catch((reason: unknown) => console.warn("[builder-turn stream]", errorMessage(reason)));
  });
}
