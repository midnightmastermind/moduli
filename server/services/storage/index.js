// services/storage/index.js — which backend a file goes to, and which one a
// stored ref belongs to.
//
// A new upload goes to the user's DEFAULT connection (services/connections).
// A connection whose type has no backend factory yet — or that cannot be
// built — sends the upload to the Server instead: never lose an upload
// (plan decision 1). The Drive backend registers a factory here (Task 5), so
// no caller of the registry changes.
import { makeLocalBackend } from "./local.js";

export function makeStorageRegistry({
  uploadsDir,
  factories = {},                 // { [type]: async (connection) => backend }
  getDefaultConnection = null,    // async (userId) => connection record | null
} = {}) {
  const server = makeLocalBackend({ uploadsDir });
  const built = new Map();        // connection id -> backend (for backendForRef)

  async function backendFor(connection) {
    if (!connection || connection.id === "server") return server;
    const make = factories[connection.type];
    if (!make) return server;
    const b = await make(connection);
    if (b) built.set(connection.id, b);
    return b || server;
  }

  return {
    server,
    /** Where a NEW upload for this user goes. Returns a backend, never null. */
    async backendForUpload(userId) {
      if (!getDefaultConnection) return server;
      try { return await backendFor(await getDefaultConnection(userId)); }
      catch (e) { console.warn("[storage] default connection unusable — using the Server:", e.message); return server; }
    },
    /** The backend that holds an existing ref (null for an external URL). */
    backendForRef(ref) {
      if (server.owns(ref)) return server;
      for (const b of built.values()) if (b.owns(ref)) return b;
      return null;
    },
  };
}
