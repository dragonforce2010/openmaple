const sessionTurns = new Map<string, Promise<void>>();

export function enqueueSessionTurn(sessionId: string, task: () => Promise<void>) {
  const previous = sessionTurns.get(sessionId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  const tracked = current
    .catch((error) => {
      console.error("[session-turn]", sessionId, error);
    })
    .finally(() => {
      if (sessionTurns.get(sessionId) === tracked) sessionTurns.delete(sessionId);
    });
  sessionTurns.set(sessionId, tracked);
}
