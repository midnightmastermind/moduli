// helpers/fullStateRequest.js
//
// WHEN THE CLIENT ASKS THE SERVER FOR STATE.
//
// The server only sends `full_state` when it is asked, and the on-load
// operation sweep rides on that payload — so "when do we ask" decides when the
// app re-derives anything. This latched per MOUNT (`didRequest` + a
// `socket.once("connect")`), which meant a reconnect asked for nothing.
//
// THE DEFECT THAT COST (2026-08-20): a `pm2 restart` during the schedule build
// truncates the server's SERIALIZED create queue mid-burst — measured on the
// live grid, the day column stopped at 18 of 49 slots, in clock order, with the
// 18th create logging START and never DONE. The op tops a partial column up
// correctly on its very next sweep; it simply never got one, because the client
// reconnected and never re-asked. The half column then survived for as long as
// the tab did, healing only on a full page reload.
//
// So the latch is per CONNECTION, not per mount. It still collapses the
// already-connected fast path and the `connect` event into ONE request (without
// that, a socket that is connected at bind time would ask twice), and a
// disconnect re-arms it.
export function bindFullStateRequest(socket, getSavedGridId = () => null) {
  if (!socket) return () => {};

  let requestedThisConnection = false;

  const request = () => {
    if (requestedThisConnection) return;
    requestedThisConnection = true;
    const savedGridId = getSavedGridId();
    socket.emit(
      "request_full_state",
      savedGridId ? { gridId: savedGridId } : undefined,
    );
  };

  const rearm = () => { requestedThisConnection = false; };

  if (socket.connected) request();
  socket.on("connect", request);
  socket.on("disconnect", rearm);

  return () => {
    socket.off("connect", request);
    socket.off("disconnect", rearm);
  };
}
