export function createTextDeltaBuffer(emit: (text: string) => void) {
  let pending = "";
  let total = "";
  let lastFlush = 0;
  let emitted = false;

  function flush(force = false) {
    const now = Date.now();
    if (!pending) return;
    if (!force && emitted && pending.length < 96 && now - lastFlush < 250) return;
    total += pending;
    emit(total);
    pending = "";
    lastFlush = now;
    emitted = true;
  }

  return {
    push(text: string) {
      pending += text;
      flush(!emitted);
    },
    flush() {
      flush(true);
    },
    get emitted() {
      return emitted;
    }
  };
}
