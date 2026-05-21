// utils/opRunBridge.js
//
// Holds HTTP responses open while a connected client runs the operation
// and emits the result back via socket. Map<requestId, { resolve, reject,
// timer }> — the API handler awaits a Promise that resolves when the
// matching `api_op_result` socket event arrives.
//
// Slice 1 mechanism; Phase 3 replaces with a true server-side executor.

export function createOpRunBridge() {
  const pending = new Map(); // requestId → { resolve, reject, timer }

  function await_({ requestId, timeoutMs, emit }) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pending.has(requestId)) {
          pending.delete(requestId);
          const err = new Error(`Operation did not complete within ${timeoutMs}ms`);
          err.code = "TIMEOUT";
          reject(err);
        }
      }, timeoutMs);
      pending.set(requestId, { resolve, reject, timer });
      try {
        emit();
      } catch (err) {
        clearTimeout(timer);
        pending.delete(requestId);
        reject(err);
      }
    });
  }

  function resolve(requestId, payload) {
    const entry = pending.get(requestId);
    if (!entry) return false;
    clearTimeout(entry.timer);
    pending.delete(requestId);
    entry.resolve(payload);
    return true;
  }

  function size() {
    return pending.size;
  }

  return { await: await_, resolve, size };
}
