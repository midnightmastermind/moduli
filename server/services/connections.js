// services/connections.js — a user's storage connections and which one new
// uploads go to. The one place that reads/writes `user.meta.storage` and the
// Connection collection, used by the REST routes and the storage registry.
import Connection from "../models/Connection.js";
import User from "../models/User.js";

export const SERVER_CONNECTION = Object.freeze({
  id: "server", type: "server", name: "Server", status: "ok", removable: false,
});

/** What a client may see — never `credentials`. */
export function publicConnection(c) {
  if (!c) return null;
  if (c.id === "server") return { ...SERVER_CONNECTION };
  const { id, type, name, config, status, statusMessage, lastCheckedAt, createdAt } = c;
  return { id, type, name, config: config || {}, status, statusMessage: statusMessage || null,
    lastCheckedAt: lastCheckedAt || null, createdAt: createdAt || null, removable: true };
}

export async function defaultConnectionId(userId) {
  const user = await User.findById(userId).lean().catch(() => null);
  return user?.meta?.storage?.defaultConnectionId || "server";
}

/** Server first, then the user's own, oldest first; the default flagged. */
export async function listConnections(userId) {
  const [rows, def] = await Promise.all([
    Connection.find({ userId }).sort({ createdAt: 1 }).lean(),
    defaultConnectionId(userId),
  ]);
  const all = [SERVER_CONNECTION, ...rows].map(publicConnection);
  const known = all.some((c) => c.id === def) ? def : "server";
  return { connections: all.map((c) => ({ ...c, isDefault: c.id === known })), defaultConnectionId: known };
}

/** The record (with credentials) — for services/storage only. */
export async function getConnection(userId, id) {
  if (!id || id === "server") return { ...SERVER_CONNECTION };
  return Connection.findOne({ id, userId }).lean();
}

export async function setDefaultConnection(userId, id) {
  if (id !== "server" && !(await Connection.exists({ id, userId }))) {
    const e = new Error(`connection ${id} not found`); e.status = 404; throw e;
  }
  if (id === "server") await User.updateOne({ _id: userId }, { $unset: { "meta.storage.defaultConnectionId": 1 } });
  else await User.updateOne({ _id: userId }, { $set: { "meta.storage.defaultConnectionId": id } });
  return id;
}

export async function renameConnection(userId, id, name) {
  if (id === "server") { const e = new Error("the Server connection cannot be renamed"); e.status = 400; throw e; }
  const row = await Connection.findOneAndUpdate({ id, userId }, { $set: { name: String(name || "").slice(0, 80) } }, { new: true }).lean();
  if (!row) { const e = new Error(`connection ${id} not found`); e.status = 404; throw e; }
  return publicConnection(row);
}

/**
 * Remove a connection. Files already stored there are NOT deleted (they stay
 * in your Drive); their rows keep pointing at it and will not load until it is
 * reconnected. When it was the default, new uploads go back to the Server.
 */
export async function removeConnection(userId, id) {
  if (id === "server") { const e = new Error("the Server connection is always kept"); e.status = 400; throw e; }
  const out = await Connection.deleteOne({ id, userId });
  if (!out.deletedCount) { const e = new Error(`connection ${id} not found`); e.status = 404; throw e; }
  if ((await defaultConnectionId(userId)) === id) await setDefaultConnection(userId, "server");
  return true;
}
