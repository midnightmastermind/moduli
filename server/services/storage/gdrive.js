// services/storage/gdrive.js — the Google Drive storage backend (plan
// 2026-09-24-connections-storage-gdrive, Task 5).
//
// Same interface as storage/local.js. A file lives in the connection's
// "Moduli uploads" folder, one subfolder per month; its ref is
//   gdrive:<connectionId>:<driveFileId>
// and a browser loads it through the server's /files/<connectionId>/<fileId>
// proxy — the file stays private in the user's Drive and the Google token
// never reaches a browser.
//
// Plain REST over fetch (Drive API v3); no Google SDK. Scope is drive.file,
// so this backend can only ever see files the app itself created.
//
// Failures that mean "the user must sign in to Google again" (a revoked or
// expired refresh token) throw a DriveAuthError and report
// `needs_reconnect` through onStatus, which the Connections tab shows.
import fs from "fs";
import { Readable } from "stream";
import { yearMonthShard } from "../../utils/uploadKinds.js";
import { refreshAccessToken, GoogleAuthError } from "../googleOAuth.js";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export class DriveAuthError extends Error {
  constructor(message) { super(message); this.name = "DriveAuthError"; this.status = 401; }
}

export const parseDriveRef = (ref) => {
  const m = /^gdrive:([^:]+):([^:]+)$/.exec(String(ref || ""));
  return m ? { connectionId: m[1], fileId: m[2] } : null;
};

/**
 * @param connection   the Connection record (with config.folderId)
 * @param refreshToken the decrypted refresh token
 * @param onStatus     async (status, message) => void — persist ok/needs_reconnect/error
 * @param fetchImpl    injectable for tests
 */
export function makeGdriveBackend({ connection, refreshToken, onStatus = async () => {}, fetchImpl = fetch, now = () => Date.now() }) {
  const connId = connection.id;
  const rootFolderId = connection.config?.folderId || null;
  let token = null;              // { accessToken, expiresAt }
  const monthFolders = new Map(); // "2026-09" -> folder id

  async function accessToken(force = false) {
    if (!force && token && token.expiresAt - 60_000 > now()) return token.accessToken;
    try {
      const t = await refreshAccessToken(refreshToken, { fetchImpl });
      token = { accessToken: t.accessToken, expiresAt: now() + (t.expiresIn || 3600) * 1000 };
      return token.accessToken;
    } catch (e) {
      if (e instanceof GoogleAuthError) {
        await onStatus("needs_reconnect", "Google access was revoked or expired — reconnect Google Drive.");
        throw new DriveAuthError(e.message);
      }
      throw e;
    }
  }

  // One authorised request; a 401 retries once with a fresh token (an access
  // token can be revoked before its stated expiry).
  async function call(url, init = {}, { retry = true } = {}) {
    const res = await fetchImpl(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${await accessToken()}` } });
    if (res.status === 401 && retry) { token = null; return call(url, init, { retry: false }); }
    if (res.status === 401) {
      await onStatus("needs_reconnect", "Google rejected the stored access — reconnect Google Drive.");
      throw new DriveAuthError("Google Drive rejected the request (401)");
    }
    return res;
  }

  async function json(res, what) {
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const e = new Error(`Drive ${what} failed: ${res.status} ${body.slice(0, 200)}`);
      e.status = res.status;
      throw e;
    }
    return res.json();
  }

  async function monthFolder() {
    if (!rootFolderId) throw new Error("this Drive connection has no upload folder — reconnect it");
    const shard = yearMonthShard();
    if (monthFolders.has(shard)) return monthFolders.get(shard);
    const q = `name='${shard}' and '${rootFolderId}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`;
    const found = await json(await call(`${API}/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`), "folder lookup");
    let id = found.files?.[0]?.id;
    if (!id) {
      const made = await json(await call(`${API}/files?fields=id`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: shard, mimeType: FOLDER_MIME, parents: [rootFolderId] }),
      }), "folder create");
      id = made.id;
    }
    monthFolders.set(shard, id);
    return id;
  }

  return {
    id: connId,
    type: "gdrive",
    name: connection.name || "Google Drive",
    owns: (ref) => parseDriveRef(ref)?.connectionId === connId,
    urlFor: (ref) => { const p = parseDriveRef(ref); return p ? `/files/${p.connectionId}/${p.fileId}` : null; },

    /**
     * Resumable upload (one session, one PUT) — fine for any size a
     * multer-limited upload can be. The temp file is deleted only AFTER Drive
     * confirms it; on any failure it is left in place so the caller can store
     * it on the Server instead (plan decision 1: never lose an upload).
     */
    async put({ tmpPath, name, originalName, mime, size }) {
      const parent = await monthFolder();
      const type = mime || "application/octet-stream";
      const bytes = size ?? fs.statSync(tmpPath).size;
      const start = await call(`${UPLOAD}/files?uploadType=resumable&fields=id`, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": type, "X-Upload-Content-Length": String(bytes) },
        body: JSON.stringify({ name: originalName || name || "upload", parents: [parent] }),
      });
      if (!start.ok) await json(start, "upload start");
      const session = start.headers.get("location");
      if (!session) throw new Error("Drive upload start returned no session URL");
      // The session URL is itself the credential; no Authorization header.
      const res = await fetchImpl(session, {
        method: "PUT",
        headers: { "Content-Type": type, "Content-Length": String(bytes) },
        body: Readable.toWeb(fs.createReadStream(tmpPath)),
        duplex: "half",
      });
      const out = await json(res, "upload");
      if (!out.id) throw new Error("Drive upload returned no file id");
      try { fs.unlinkSync(tmpPath); } catch {}
      await onStatus("ok", null);
      return { ref: `gdrive:${connId}:${out.id}` };
    },

    /**
     * The file's bytes, optionally a byte range. Returns null when Drive says
     * the file is gone (404). `status` is 206 for a satisfied range.
     */
    async open(ref, { start, end } = {}) {
      const p = parseDriveRef(ref);
      if (!p || p.connectionId !== connId) return null;
      const headers = {};
      if (start != null) headers.Range = `bytes=${start}-${end ?? ""}`;
      const res = await call(`${API}/files/${encodeURIComponent(p.fileId)}?alt=media`, { headers });
      if (res.status === 404) return null;
      if (!res.ok && res.status !== 206) await json(res, "download");
      const cr = res.headers.get("content-range");            // "bytes 0-99/1234"
      const total = cr ? Number(cr.split("/")[1]) : Number(res.headers.get("content-length"));
      return {
        stream: res.body ? Readable.fromWeb(res.body) : Readable.from([]),
        size: Number.isFinite(total) ? total : null,
        length: Number(res.headers.get("content-length")) || null,
        contentRange: cr || null,
        mime: res.headers.get("content-type") || null,
        status: res.status,
      };
    },

    async remove(ref) {
      const p = parseDriveRef(ref);
      if (!p || p.connectionId !== connId) return false;
      const res = await call(`${API}/files/${encodeURIComponent(p.fileId)}`, { method: "DELETE" });
      if (res.status === 404) return false;
      if (!res.ok) await json(res, "delete");
      return true;
    },

    async health() {
      try {
        if (!rootFolderId) return { ok: false, message: "no upload folder — reconnect" };
        const res = await call(`${API}/files/${encodeURIComponent(rootFolderId)}?fields=id,trashed`);
        if (res.status === 404) { await onStatus("error", "The Moduli uploads folder is missing from Drive."); return { ok: false, message: "upload folder missing in Drive" }; }
        const f = await json(res, "health");
        if (f.trashed) { await onStatus("error", "The Moduli uploads folder is in Drive's trash."); return { ok: false, message: "upload folder is in the trash" }; }
        await onStatus("ok", null);
        return { ok: true, message: "connected" };
      } catch (e) {
        return { ok: false, message: e.message, needsReconnect: e instanceof DriveAuthError };
      }
    },
  };
}
