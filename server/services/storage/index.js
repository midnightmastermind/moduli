// services/storage/index.js — which backend a file goes to, and which one a
// stored ref belongs to.
//
// A new upload goes to the user's DEFAULT connection (services/connections).
// A connection whose type has no backend factory yet — or that cannot be
// built — sends the upload to the Server instead: never lose an upload
// (plan decision 1). The Drive backend registers a factory here (Task 5), so
// no caller of the registry changes.
import { makeLocalBackend } from "./local.js";
import { parseDriveRef } from "./gdrive.js";

export function makeStorageRegistry({
  uploadsDir,
  factories = {},                 // { [type]: async (connection) => backend }
  getDefaultConnection = null,    // async (userId) => connection record | null
  getConnectionById = null,       // async (id) => connection record | null (the /files proxy)
} = {}) {
  const server = makeLocalBackend({ uploadsDir });
  const built = new Map();        // connection id -> { key, backend } (for backendForRef)

  // A backend is reused while its credentials are unchanged (it caches its
  // access token); a reconnect writes new credentials, so it is rebuilt.
  const keyOf = (c) => `${c.credentials?.ciphertext || ""}|${c.config?.folderId || ""}`;
  async function backendFor(connection) {
    if (!connection || connection.id === "server") return server;
    const hit = built.get(connection.id);
    if (hit && hit.key === keyOf(connection)) return hit.backend;
    const make = factories[connection.type];
    if (!make) return server;
    const b = await make(connection);
    if (b) built.set(connection.id, { key: keyOf(connection), backend: b });
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
    /**
     * Store a new upload for this user: the default connection, or — when it
     * cannot take the file (Drive unreachable, token revoked) — the Server,
     * with `fallback` saying why (plan decision 1: never lose an upload).
     * A remote put leaves the temp file in place when it fails, which is what
     * lets the Server take it here.
     */
    async putForUser(userId, args) {
      const backend = await this.backendForUpload(userId);
      if (backend === server) return { ...(await server.put(args)), backend: server, fallback: null };
      try {
        return { ...(await backend.put(args)), backend, fallback: null };
      } catch (e) {
        console.warn(`[storage] ${backend.type} ${backend.id} could not store ${args?.name} — kept on the Server:`, e.message);
        return { ...(await server.put(args)), backend: server,
          fallback: { connectionId: backend.id, reason: e.message, needsReconnect: e.status === 401 } };
      }
    },
    /** The backend that holds an existing ref (null for an external URL). */
    backendForRef(ref) {
      if (server.owns(ref)) return server;
      for (const { backend } of built.values()) if (backend.owns(ref)) return backend;
      return null;
    },
    /** The URL a browser loads a stored ref from — including a backend not built since boot. */
    urlForRef(ref) {
      const b = this.backendForRef(ref);
      if (b) return b.urlFor(ref);
      const d = parseDriveRef(ref);
      return d ? `/files/${d.connectionId}/${d.fileId}` : `/uploads/${ref}`;
    },
    /** A connection's backend by id (the /files proxy has only the id). Null when unknown. */
    async backendForConnectionId(id) {
      if (!id) return null;
      if (id === "server") return server;
      if (!getConnectionById) return null;
      const c = await getConnectionById(id);
      if (!c || !factories[c.type]) return null;
      const b = await backendFor(c);
      return b === server ? null : b;
    },
  };
}
