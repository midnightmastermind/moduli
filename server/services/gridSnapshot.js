// services/gridSnapshot.js — the warm cache's modules and occurrences, kept on disk.
//
// A cold load reads the whole grid from Atlas at ~103 KB/s: poms' 54,922 occurrences took 656s (measured on the droplet
// with no browser involved, 2026-11-05; connection compression changes nothing, the limit is Atlas's). Every restart left
// the grid unopenable that long. So the cache is saved here, and a restart reads it back and asks Atlas only for
// id + updatedAt (~1 minute) and the whole rows that differ.
//
// updatedAt decides, so a write that does not move it is invisible: a migration on the native driver. Each snapshot
// names the grid's migration ledger and is refused when that has moved. Delete server/cache/grids to force a full read.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { EJSON } from "bson";

export const SNAPSHOT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../cache/grids");
export const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const YIELD_EVERY = 500; // a row at a time on one thread: never hold the loop for the whole grid
const FETCH_CHUNK = 500;

const fileFor = (dir, gridId) => path.join(dir, `${gridId}.ndjson`);
const yieldLoop = () => new Promise((r) => setImmediate(r));

export function migrationLedger(grid) {
  const m = grid?.meta?.migrations || [];
  const last = m[m.length - 1];
  return `${m.length}:${last?.id || last || ""}`;
}

export async function saveSnapshot({ gridId, userId, uc, ledger, dir = SNAPSHOT_DIR }) {
  fs.mkdirSync(dir, { recursive: true });
  const target = fileFor(dir, gridId);
  // A restart mid-save leaves its temp file behind.
  for (const f of fs.readdirSync(dir)) if (f.startsWith(`${gridId}.ndjson.`) && f.endsWith(".tmp")) fs.rmSync(path.join(dir, f), { force: true });
  const tmp = `${target}.${process.pid}.tmp`;
  const out = fs.createWriteStream(tmp);
  const write = (s) => new Promise((res, rej) => {
    out.once("error", rej);
    if (out.write(`${s}\n`)) { out.removeListener("error", rej); res(); }
    else out.once("drain", () => { out.removeListener("error", rej); res(); });
  });
  try {
    // savedAt is taken first and a row changed mid-write has a newer updatedAt than it was saved with: the next load refetches it.
    await write(JSON.stringify({ v: 1, gridId, userId, ledger, savedAt: new Date().toISOString() }));
    let n = 0, rows = 0;
    for (const [kind, map] of [["m", uc.modulesById], ["o", uc.occurrencesById]]) {
      for (const row of Object.values(map || {})) {
        await write(`${kind}${EJSON.stringify(row, { relaxed: true })}`);
        rows++;
        if (++n % YIELD_EVERY === 0) await yieldLoop();
      }
    }
    await write(JSON.stringify({ end: rows }));
    await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
    fs.renameSync(tmp, target);
    return rows;
  } catch (e) {
    out.destroy();
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

/** The saved rows, or null when there is no snapshot this load can trust. */
export async function loadSnapshot({ gridId, userId, ledger, dir = SNAPSHOT_DIR, maxAgeMs = SNAPSHOT_MAX_AGE_MS }) {
  const file = fileFor(dir, gridId);
  if (!fs.existsSync(file)) return null;
  const lines = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  let header = null, end = null, rows = 0;
  const modulesById = {}, occurrencesById = {};
  try {
    for await (const line of lines) {
      if (!header) {
        header = JSON.parse(line);
        if (header.v !== 1 || header.gridId !== gridId || header.userId !== userId || header.ledger !== ledger) return null;
        if (Date.now() - new Date(header.savedAt).getTime() > maxAgeMs) return null;
        continue;
      }
      if (line[0] === "{") { end = JSON.parse(line).end; continue; }
      const row = EJSON.parse(line.slice(1), { relaxed: true });
      (line[0] === "m" ? modulesById : occurrencesById)[row.id] = row;
      if (++rows % YIELD_EVERY === 0) await yieldLoop();
    }
  } catch (e) {
    console.error("[snapshot] unreadable, reading the grid from the database:", e?.message || e);
    return null;
  } finally {
    lines.close();
  }
  if (end !== rows) return null; // no end mark, or a short file: never serve part of a grid
  return { savedAt: new Date(header.savedAt), modulesById, occurrencesById };
}

const moment = (v) => (v == null ? null : new Date(v).getTime());

export function planReconcile(snapshotById, scan) {
  const seen = new Set();
  const fetchIds = [];
  for (const { id, updatedAt } of scan) {
    seen.add(id);
    const had = snapshotById[id];
    const stamp = had ? moment(had.updatedAt) : null;
    if (stamp == null || stamp !== moment(updatedAt)) fetchIds.push(id);
  }
  return { fetchIds, dropIds: Object.keys(snapshotById).filter((id) => !seen.has(id)) };
}

/** The snapshot's rows brought level with the database. `shape` is what a cold load does to a stored row. */
export async function reconcileRows({ snapshotById, Model, filter, shape }) {
  const scan = await Model.find(filter, { id: 1, updatedAt: 1, _id: 0 }).lean();
  const { fetchIds, dropIds } = planReconcile(snapshotById, scan);
  const out = { ...snapshotById };
  for (const id of dropIds) delete out[id];
  for (let i = 0; i < fetchIds.length; i += FETCH_CHUNK) {
    const docs = await Model.find({ ...filter, id: { $in: fetchIds.slice(i, i + FETCH_CHUNK) } }).lean();
    for (const d of docs) out[d.id] = shape(d);
  }
  return out;
}
