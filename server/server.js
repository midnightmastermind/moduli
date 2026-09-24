// server.js — Express + Socket.io bootstrap (~300 lines)
// All socket handlers are in server/socketHandlers/

import express from "express";
import { withoutMongoId } from "./utils/mongoId.js";
import http from "http";
import cors from "cors";
import compression from "compression";
import mongoose from "mongoose";
import { Server } from "socket.io";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";
import "dotenv/config";
import { nanoid } from "nanoid";
import jwt from "jsonwebtoken";

// __dirname polyfill for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ========================================================
// MODELS
// ========================================================
import Module from "./models/Module.js";
import Grid from "./models/Grid.js";
import { requireSession, ownsGrid } from "./middleware/sessionAuth.js";
import { resolveInside } from "./utils/safePath.js";
import User from "./models/User.js";
import Occurrence from "./models/Occurrence.js";
import Field from "./models/Field.js";
import Transaction from "./models/Transaction.js";
import Manifest from "./models/Manifest.js";
import View from "./models/View.js";
import Folder from "./models/Folder.js";
import { resolveFilesFolderId } from "./utils/filesFolder.js";
import { makeArtifactUploader } from "./services/artifactUpload.js";
import { makeStorageRegistry } from "./services/storage/index.js";
import { getConnection, defaultConnectionId } from "./services/connections.js";
import { ARTIFACT_MAX_BYTES, SHARE_MAX_BYTES } from "./config/uploadLimits.js";
import Operation from "./models/Operation.js";

// ========================================================
// HELPERS
// ========================================================
import { getOccurrencesForGrid, createOccurrenceData } from "./utils/occurrenceHelpers.js";
import { decompressTextmap } from "./utils/textmapCompression.js";
import { selectGrid } from "./utils/gridHelpers.js";

// `operation` was missing here, so undo/redo could not resolve a Model for an
// operation snapshot and silently skipped it (2026-08-01).
const MODEL_MAP = { grid: Grid, module: Module, field: Field, occurrence: Occurrence, manifest: Manifest, view: View, folder: Folder, operation: Operation };
function getModelByType(entityType) { return MODEL_MAP[entityType] || null; }

// ========================================================
// SOCKET HANDLERS
// ========================================================
import { registerAuthHandlers } from "./socketHandlers/auth.js";
import { registerStateHandlers } from "./socketHandlers/state.js";
import { registerCrudHandlers } from "./socketHandlers/crud.js";
import { registerOccurrenceHandlers } from "./socketHandlers/occurrences.js";
import { registerTransactionHandlers } from "./socketHandlers/transactions.js";
import { registerTemplateHandlers } from "./socketHandlers/templates.js";
import { registerImportHandlers } from "./socketHandlers/import.js";
import { registerFeedLeaderHandlers, registerSessionHandlers } from "./socketHandlers/feedLeader.js";
import { makeApiV1Router } from "./routes/apiV1.js";
import { createOpRunBridge } from "./utils/opRunBridge.js";
import { handleProvidersList, handleProviderSearch, handleProviderDetail } from "./utils/searchRouteHandlers.js";


// ========================================================
// JWT
// ========================================================
const JWT_SECRET = process.env.JWT_SECRET || "SUPER_SECRET";
function signToken(payload) { return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" }); }
function verifyToken(token) { try { return jwt.verify(token, JWT_SECRET); } catch { return null; } }

// ========================================================
// TIPTAP → MARKDOWN SERIALIZER
// ========================================================
function serializeTipTapToMarkdown(tipTapJson) {
  if (!tipTapJson || !tipTapJson.content) return "";
  function nodeToMd(node) {
    if (!node) return "";
    if (node.type === "text") {
      let t = node.text || "";
      const marks = node.marks || [];
      if (marks.some(m => m.type === "bold") && marks.some(m => m.type === "italic")) t = `***${t}***`;
      else if (marks.some(m => m.type === "bold")) t = `**${t}**`;
      else if (marks.some(m => m.type === "italic")) t = `*${t}*`;
      return t;
    }
    if (node.type === "moduleEmbed") return `@:(${node.attrs?.occurrenceId || ""})`;
    if (node.type === "heading") { const level = node.attrs?.level || 1; return "#".repeat(level) + " " + (node.content || []).map(nodeToMd).join(""); }
    if (node.type === "paragraph") return (node.content || []).map(nodeToMd).join("");
    if (node.type === "bulletList") return (node.content || []).map(li => "- " + (li.content || []).map(p => (p.content || []).map(nodeToMd).join("")).join("")).join("\n");
    if (node.type === "doc") return (node.content || []).map(nodeToMd).join("\n\n");
    return (node.content || []).map(nodeToMd).join("");
  }
  return nodeToMd(tipTapJson).trim() + "\n";
}

// ========================================================
// EXPRESS / SOCKET.IO
// ========================================================
const app = express();
app.use(cors());
// Gzip every compressible response (API JSON, static JS/CSS when Cloudflare
// isn't in front — LAN/tablet access hits the origin directly).
app.use(compression());
// JSON body parser for all routes EXCEPT /api/webhooks/* — those need
// the raw bytes for HMAC verification and parse JSON themselves after.
app.use((req, res, next) => {
  if (req.path.startsWith("/api/webhooks/")) return next();
  return express.json()(req, res, next);
});

app.get("/health", async (req, res) => {
  const dbState = mongoose.connection.readyState; // 1 = connected
  const db = dbState === 1 ? "ok" : "disconnected";
  let gridCount = null;
  if (dbState === 1) {
    try { gridCount = await Grid.countDocuments(); } catch { /* ignore */ }
  }
  res.json({ ok: db === "ok", db, gridCount, uptime: Math.floor(process.uptime()), ts: Date.now() });
});
app.use((req, _res, next) => { if (req.path !== "/health") console.log(`📥 HTTP ${req.method} ${req.path}`); next(); });

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  allowEIO3: true,
  pingTimeout: 60000,    // 60s (default 20s) — remote DB can block event loop during cache load
  pingInterval: 25000,   // 25s (default 25s)
  maxHttpBufferSize: 64 * 1024 * 1024,
  // Socket.io v4 disables WS compression by default. full_state is ~1.5MB+ of
  // JSON (textmaps ship decompressed) and Cloudflare does not compress WS
  // frames — deflate cuts it ~85%. Threshold skips the tiny per-field events.
  perMessageDeflate: { threshold: 1024 },
});

io.engine.on("connection_error", (err) => { console.error("❌ [io.engine] connection_error:", err.req?.url, err.code, err.message); });
process.on("uncaughtException", (err) => { console.error("❌ [uncaughtException]", err.stack || err.message); });
process.on("unhandledRejection", (reason) => { console.error("❌ [unhandledRejection]", reason?.stack || reason); });

// ========================================================
// ROOMS
// ========================================================
function userRoom(userId) { return `user:${userId}`; }
function gridRoom(userId, gridId) { return `user:${userId}:grid:${gridId}`; }

// ========================================================
// AUTH MIDDLEWARE
// ========================================================
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) { socket.userId = null; socket.data.userId = null; return next(); }
  const decoded = verifyToken(token);
  if (!decoded) { console.log("❌ Invalid token"); return next(new Error("INVALID_TOKEN")); }
  // Trust the JWT — no DB round-trip needed on every connect
  socket.userId = decoded.userId.toString();
  socket.data.userId = socket.userId;
  next();
});

// ========================================================
// DATABASE
// ========================================================
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/dnd_containers";
mongoose.connect(MONGO_URI, {
  // Without these, a Mongo response that never arrives (e.g. mid-write when the
  // client F5'd) holds a connection forever and starves every later query —
  // request_full_state then hangs at Grid.findOne and the app spins.
  //
  // ── 2026-08-24: RAISED, AND IT IS A STOPGAP, NOT A DESIGN ────────────────
  //
  // The database is an Atlas SERVERLESS instance and its read throughput
  // collapsed to ~114 docs/s (measured on an indexed query over 0.9KB
  // documents; a healthy tier does tens of thousands). poms grid holds 18,172
  // occurrences, so its `full_state` read needs ~160s — and at 20s it was
  // killed every time. The symptom is total: the handler throws
  // `MongoNetworkTimeoutError`, no `full_state` is ever emitted, and the app
  // sits on its spinner forever with nothing in the console.
  //
  // Prod's own timing log is the evidence. test grid 1 (859 occurrences)
  // completes in 8,881ms; on poms grid the Manifest/View/Folder/Field/Operation
  // queries all return and **the Module and Occurrence queries never log at
  // all** — they are cut off mid-flight.
  //
  // WHAT THIS COSTS, said plainly: the guard above is real, and a genuinely
  // hung connection now occupies a pool slot for five minutes instead of
  // twenty seconds. With `maxPoolSize: 20` that is survivable, and it is
  // strictly better than an app that cannot load at all. **The actual fixes are
  // a database tier that is not throttled, or a `full_state` that stops
  // shipping every occurrence** — this only buys the grid back until one of
  // those happens.
  socketTimeoutMS: 300000,       // ~160s read + headroom; see the note above
  serverSelectionTimeoutMS: 10000, // fail fast if Mongo is unreachable
  maxPoolSize: 20,                 // a few writers can run concurrently while reads stay snappy
  // Raised with it: a slow read holds its connection far longer now, so a
  // queued operation must be willing to wait for a slot rather than failing
  // while the pool is legitimately busy.
  bufferTimeoutMS: 60000,
}).then(async () => {
  console.log("🟢 MongoDB connected");
  // One-time migration: stamp gridId on all untagged folders by BFS from each manifest
  try {
    const untagged = await Folder.find({ $or: [{ gridId: null }, { gridId: { $exists: false } }] }).lean();
    if (untagged.length > 0) {
      const manifests = await Manifest.find({ gridId: { $exists: true, $ne: null } }).lean();
      const byId = {};
      untagged.forEach(f => { byId[f.id] = f; });
      const ops = [];
      for (const m of manifests) {
        const reachable = new Set();
        const q = [m.rootFolderId].filter(Boolean);
        while (q.length) {
          const fid = q.shift();
          if (!fid || reachable.has(fid)) continue;
          reachable.add(fid);
          untagged.forEach(f => { if (f.parentId === fid) q.push(f.id); });
        }
        reachable.forEach(fid => {
          if (byId[fid]) ops.push({ updateOne: { filter: { id: fid }, update: { $set: { gridId: m.gridId } } } });
        });
      }
      if (ops.length) {
        await Folder.bulkWrite(ops);
        console.log(`✅ Migrated gridId on ${ops.length} folders`);
      }
    }
  } catch (e) { console.error("folder migration error:", e); }

  // ── PREWARM, so the cold read happens while nobody is waiting ──────────────
  // `full_state` is served ENTIRELY from the warm cache, so a pm2 restart — every
  // deploy, every migration — puts the ~184s cold read directly in front of the
  // next person to open the app. Starting it at boot moves that off the critical
  // path: by the time a browser connects the cache is warm, or the browser joins
  // the load already in flight.
  //
  // JOINING is what makes this safe rather than a second concurrent read:
  // `loadUserIntoCache` already dedupes on `cacheLoadingPromise[key]`, so a
  // connection arriving mid-prewarm attaches to the SAME promise and waits
  // exactly as long as it would have. It can never be slower for that grid.
  //
  // ONE grid, deliberately. Atlas is the scarce resource here (~100 KB/s), so
  // warming grids nobody asked for would compete for bandwidth with the grid
  // somebody is actually opening — the opposite of the point. `updatedAt` is the
  // right signal: it moves on navigation and on every write, so the most recently
  // updated grid is the one in use.
  if (process.env.PREWARM_GRID !== "0") {
    try {
      const recent = await Grid.find({}).sort({ updatedAt: -1 }).limit(1).lean();
      for (const g of recent) {
        const gid = String(g._id);
        console.log(`🔥 prewarming grid "${g.name}" (${gid}) in the background`);
        // Deliberately NOT awaited: the server must accept connections now.
        pinnedCacheKeys.add(gridCacheKey(g.userId, gid));
        loadUserIntoCache(g.userId, gid)
          .then(() => console.log(`🔥 prewarm done and PINNED: "${g.name}"`))
          .catch((e) => console.error("prewarm failed:", e?.message || e));
      }
    } catch (e) { console.error("prewarm lookup failed:", e?.message || e); }
  }
}).catch((err) => console.error("🔴 MongoDB connect error:", err));
console.log("🧪 Using MONGO_URI:", MONGO_URI);

// ========================================================
// GRID CACHE  (keyed by "userId:gridId" — one entry per grid)
// ========================================================
const cacheByUser = Object.create(null);       // "userId:gridId" → cache object
const cacheLastAccess = Object.create(null);   // "userId:gridId" → timestamp
const cacheLoadingPromise = Object.create(null); // "userId:gridId" → Promise
// ── WHY THIS IS HOURS AND NOT MINUTES ────────────────────────────────────────
// Evicting a grid means the next read is COLD, and a cold read of poms grid was
// measured on 2026-08-24 at ~184s: Atlas Serverless is throttling this cluster
// to ~100 KB/s (99 docs/s over 0.9KB documents, measured identically from the
// droplet and from a laptop, so it is the cluster and not a network). The cache
// it is reclaiming is ~15MB.
//
// Trading 15MB of RSS for a three-minute stall in front of the user is a bad
// trade at 30 minutes and an obviously bad one at any interval shorter than a
// working day — the old value meant coming back from lunch cost a cold read.
// The TTL still exists so an abandoned grid is not pinned forever.
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function gridCacheKey(userId, gridId) { return `${userId}:${gridId}`; }

// Grids the eviction sweep must never reclaim. The prewarmed grid is pinned so
// the ~184s cold read happens ONCE per process rather than once per idle gap —
// user's call, 2026-08-25: "keep it warm indefinitely". One grid is ~15MB, which
// is the whole cost; the TTL still governs every OTHER grid, so an abandoned one
// is not pinned forever just because it was opened.
const pinnedCacheKeys = new Set();

// Periodic cache eviction — runs every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const key of Object.keys(cacheLastAccess)) {
    if (pinnedCacheKeys.has(key)) continue;
    if (now - cacheLastAccess[key] > CACHE_TTL_MS) {
      delete cacheByUser[key];
      delete cacheLastAccess[key];
    }
  }
}, 5 * 60 * 1000);

function ensureUserCache(userId, gridId) {
  const key = gridCacheKey(userId, gridId);
  cacheLastAccess[key] = Date.now();
  if (!cacheByUser[key]) {
    cacheByUser[key] = { _loaded: false, gridId, modulesById: {}, occurrencesById: {}, fieldsById: {}, manifestsById: {}, viewsById: {}, foldersById: {}, operationsById: {} };
  }
  return cacheByUser[key];
}

async function getAllGridsForUser(userId) {
  // Lightweight query — always fresh, Grid collection is tiny
  const all = await Grid.find({ userId }).sort({ createdAt: 1 }).lean();
  return all.map((g) => ({ id: g._id.toString(), name: g.name, createdAt: g.createdAt }));
}

async function loadUserIntoCache(userId, gridId) {
  const key = gridCacheKey(userId, gridId);
  // Deduplicate: if a load is already in flight for this grid, reuse the same promise
  if (cacheLoadingPromise[key]) return cacheLoadingPromise[key];

  const promise = (async () => {
    console.log("📥 loadGridIntoCache START", { userId, gridId });
    const uc = ensureUserCache(userId, gridId);
    uc._loaded = false;
    const t0 = Date.now();
    // All queries filtered by gridId — no user-wide scans
    const [modules, occurrences, fields, manifests, views, folders, operations] = await Promise.all([
      Module.find({ userId, gridId }).lean().then(r => { console.log(`  ↳ Module query: ${Date.now()-t0}ms (${r.length})`); return r; }),
      Occurrence.find({ userId, gridId }).lean().then(r => { console.log(`  ↳ Occurrence query: ${Date.now()-t0}ms (${r.length})`); return r; }),
      Field.find({ userId, gridId }).lean().then(r => { console.log(`  ↳ Field query: ${Date.now()-t0}ms (${r.length})`); return r; }),
      Manifest.find({ userId, gridId }).lean().then(r => { console.log(`  ↳ Manifest query: ${Date.now()-t0}ms (${r.length})`); return r; }),
      View.find({ userId, gridId }).lean().then(r => { console.log(`  ↳ View query: ${Date.now()-t0}ms (${r.length})`); return r; }),
      Folder.find({ userId, gridId }).lean().then(r => { console.log(`  ↳ Folder query: ${Date.now()-t0}ms (${r.length})`); return r; }),
      Operation.find({ userId, gridId }).lean().then(r => { console.log(`  ↳ Operation query: ${Date.now()-t0}ms (${r.length})`); return r; }),
    ]);
    console.log(`📥 All queries done: ${Date.now()-t0}ms total`);
    // `withoutMongoId` on every cache entry: these documents are handed
    // straight back to `findOneAndUpdate` as UPDATE PAYLOADS by the write
    // handlers (`next = { ...cached, ...payload }`), and a lean doc carries
    // `_id` — so every write was `$set`ting it. Inert while it matches the live
    // document, and an ImmutableField rejection that LOSES THE USER'S EDIT the
    // moment they diverge. Nothing reads `_id` off these entries.
    uc.modulesById = {};
    modules.forEach((m) => { const id = m.id || m._id.toString(); uc.modulesById[id] = { ...withoutMongoId(m), id, label: m.label ?? "" }; });
    uc.occurrencesById = {};
    occurrences.forEach((o) => {
      const id = o.id || o._id.toString();
      const bare = withoutMongoId(o);
      const occ = o.textmap ? { ...bare, id, textmap: decompressTextmap(o.textmap) } : { ...bare, id };
      uc.occurrencesById[id] = occ;
    });
    uc.fieldsById = {};
    fields.forEach((f) => { const id = f.id || f._id.toString(); uc.fieldsById[id] = { ...withoutMongoId(f), id }; });
    uc.manifestsById = {};
    manifests.forEach((m) => { const id = m.id || m._id.toString(); uc.manifestsById[id] = { ...withoutMongoId(m), id }; });
    uc.viewsById = {};
    views.forEach((v) => { const id = v.id || v._id.toString(); uc.viewsById[id] = { ...withoutMongoId(v), id }; });
    uc.foldersById = {};
    folders.forEach((f) => { const id = f.id || f._id.toString(); uc.foldersById[id] = { ...withoutMongoId(f), id }; });
    uc.operationsById = {};
    operations.forEach((o) => { const id = o.id || o._id.toString(); uc.operationsById[id] = { ...withoutMongoId(o), id }; });
    uc._loaded = true;
    console.log(`✅ GRID CACHE READY: ${gridId} — Modules: ${Object.keys(uc.modulesById).length}, Occurrences: ${Object.keys(uc.occurrencesById).length}, Folders: ${Object.keys(uc.foldersById).length}`);
    return uc;
  })();

  cacheLoadingPromise[key] = promise;
  promise.finally(() => { delete cacheLoadingPromise[key]; });
  return promise;
}

function userCacheReady(userId, gridId) {
  const uc = cacheByUser[gridCacheKey(userId, gridId)];
  return !!(uc && uc._loaded);
}

// ========================================================
// SOCKET CONNECTION
// ========================================================
io.on("connection", (socket) => {
  console.log("\n===============================================");
  console.log("🔌 Client connected:", socket.id, "userId:", socket.userId);
  console.log("===============================================\n");

  const userId = socket.userId;
  if (userId) { socket.join(userRoom(userId)); console.log("🏠 joined", userRoom(userId)); }
  socket.data.activeGridId = socket.data.activeGridId || null;

  const ctx = {
    io, cacheByUser, gridCacheKey, ensureUserCache, userCacheReady, loadUserIntoCache,
    getAllGridsForUser, userRoom, gridRoom,
    getOccurrencesForGrid, createOccurrenceData, selectGrid,
    serializeTipTapToMarkdown, getModelByType,
    uploadsDir: path.join(__dirname, "uploads"),
    signToken,
  };

  registerAuthHandlers(socket, ctx);
  registerStateHandlers(socket, ctx);
  // `[scroll]` diagnostic reports (client: helpers/scrollDiag.js). A phone has
  // no console, so the numbers come here and land in the pm2 log instead of
  // depending on the user screenshotting an overlay. Read with:
  //   pm2 logs moduli --nostream --lines 500 | grep '\[scroll\]'
  socket.on("save_scroll_diag", (d = {}) => {
    try {
      // THE CLIENT ALREADY FORMATTED THIS. It used to be re-derived here, and
      // the re-derivation kept dropping fields the client had computed — the
      // scroll rate and its comparability verdict, then the render/op tallies,
      // then the trigger breakdown — each noticed only after a capture had
      // been read without them. Printing the client's own line means the pm2
      // log and the user's console cannot disagree. The blocks below stay as
      // the fallback for a tab on an older bundle.
      if (typeof d.line === "string" && d.line) {
        console.log(`📉 ${d.line} user=${socket.userId} ua=${(d.ua || "").slice(-30)}`);
        return;
      }
      if (d.kind === "cell-switch") {
        console.log(`📉 [scroll] CELL-SWITCH ${d.verdict} user=${socket.userId} `
          + `maxBlock=${d.maxGapMs}ms react=${d.reactMs}ms preReact=${d.preReactMs}ms gridRender=${d.gridRenderMs}ms paint=${d.paintMs}ms blocked=${d.blockedMs}ms frames=${d.frames} `
          + `rows=${d.rowsAtStart} animations=${d.animations} domNodes=${d.domNodes} `
          + `renders=${JSON.stringify(d.renders || {})} `
          // WHERE the renders landed. A total cannot separate "the tap
          // re-rendered too much" from "something ran after the paint", and
          // those have different fixes — see scrollDiag's subtractTally.
          + `inCommit=${JSON.stringify(d.rendersInCommit || {})} `
          + `afterCommit=${JSON.stringify(d.rendersAfterCommit || {})} `
          + `ops=${JSON.stringify(d.ops || {})} editors=${d.editors} build=${d.build} ${d.viewport}@${d.dpr}x ua=${(d.ua || "").slice(-30)}`);
        return;
      }
      console.log(`📉 [scroll] ${d.verdict} burst#${d.index} arm=${d.arm} user=${socket.userId} `
        + `${d.viewport}@${d.dpr}x rows=${d.rowsAtStart} added=${d.rowsAdded} `
        + `unskipped=${d.unskipped} skippedAtStart=${d.skippedAtStart} `
        + `frameMedian=${d.frameMedian}ms missed=${d.slowFrames} `
        + `longTasks=${d.longTasks}(${d.longTaskMs}ms) `
        + `seed=${d.seedPx} real=${d.realPx} scrolled=${Math.round(d.endTop - d.startTop)}px `
        + `dur=${d.durationMs}ms `
        // THE RATE AND ITS VERDICT, because this is the surface the call gets
        // made from. Printing `scrolled` and `dur` separately means comparing
        // two arms requires dividing by hand, and on 2026-08-31 that step did
        // not happen: four arms that differed 11x in gesture speed (one of
        // which never moved at all) were read as a valid A/B.
        + `rate=${d.ratePxPerSec}px/s cmp=${d.comparability || "?"} `
        + `renders=${d.rendersInBurst ?? "?"} opRuns=${d.opRuns ?? "?"} opMs=${d.opMs ?? "?"} `
        + `opBy=[${d.opBy || ""}] `
        // Whether the A/B arm's CSS was actually applied. A silent-mode burst
        // and a verbose one are measuring different pages.
        + `verbose=${d.verbose === undefined ? "?" : d.verbose} `
        + `longtaskAPI=${d.supportsLongTask} cvEvent=${d.supportsCvEvent} `
        + `ua=${(d.ua || "").slice(-40)}`);
    } catch { /* a diagnostic must never take the server down */ }
  });

  registerCrudHandlers(socket, ctx);
  registerOccurrenceHandlers(socket, ctx);
  registerTransactionHandlers(socket, ctx);
  registerTemplateHandlers(socket, ctx);
  registerImportHandlers(socket, ctx);
  registerFeedLeaderHandlers(socket, ctx);
  registerSessionHandlers(socket, ctx);

  // Result of a /api/v1/operations/:id/run request that this socket picked
  // up — resolves the HTTP response held open by opRunBridge.
  socket.on("api_op_result", ({ requestId, ok, vars, effects, log, error, durationMs } = {}) => {
    if (!requestId) return;
    opRunBridge.resolve(requestId, {
      ok: ok !== false,
      operationId: undefined,
      durationMs,
      vars: vars || {},
      effects: effects || [],
      log: log || [],
      ...(error ? { error } : {}),
    });
  });

  socket.on("disconnect", () => {
    console.log("❌ Client disconnected:", socket.id);
    // Cache persists — TTL eviction handles cleanup after 30min inactivity
  });
});

// ========================================================
// FILE UPLOAD (multer)
// ========================================================
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => { const ext = path.extname(file.originalname); cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`); },
});
const upload = multer({ storage, limits: { fileSize: ARTIFACT_MAX_BYTES } });
// Shares take 500 MB (D14 — phone video); every other upload keeps 50 MB.
const shareUpload = multer({ storage, limits: { fileSize: SHARE_MAX_BYTES } });

// Uploaded files get timestamp-random names (immutable once written) → cache
// hard. md/ and thumbnails/ are REWRITTEN under the same name on save →
// always revalidate those.
app.use("/uploads", express.static(uploadsDir, {
  setHeaders: (res, filePath) => {
    const rel = path.relative(uploadsDir, filePath);
    if (rel.startsWith("md/") || rel.startsWith("thumbnails/")) {
      res.setHeader("Cache-Control", "no-cache");
    } else {
      res.setHeader("Cache-Control", "public, max-age=2592000, immutable");
    }
  },
}));

// ─────────────────────────────────────────────────────────────────────────────

const mdDir = path.join(uploadsDir, "md");
if (!fs.existsSync(mdDir)) fs.mkdirSync(mdDir, { recursive: true });

// Thumbnails directory (files audit gap #4). Sharp output lands here as
// `<sha256>-256.webp` + `<sha256>-1024.webp`. Naming by content hash
// means dedup'd uploads automatically reuse existing thumbnails — no
// duplicates, no orphans tied to module ids.
const thumbDir = path.join(uploadsDir, "thumbnails");
if (!fs.existsSync(thumbDir)) fs.mkdirSync(thumbDir, { recursive: true });



// ── The warm cache these routes mirror into, and the folder an upload homes in ──
//
// `routeCache` exists because the mirrors below were SILENTLY DEAD. The cache is
// keyed `${userId}:${gridId}` everywhere it is written (`gridCacheKey`, the only
// assignment site), but these routes read `cacheByUser[userId]` — a key that is
// never written, so `if (cache)` was false every time. `request_full_state` is
// served ENTIRELY from that cache (socketHandlers/state.js, 30-min TTL), so an
// uploaded artifact reached Mongo and the socket broadcast but NOT the cache:
// reloading inside the TTL served a grid with the file missing, and the socket
// write path merges over `uc[bucket][id]`, so a later edit could republish the
// stale copy on top of it. Same class as the 2026-08-07 REST-write finding,
// which fixed /api/v1 and never reached these routes.
//
// Mirrors only when the cache is ALREADY warm (peek, never load): a cold cache
// holds nothing stale to correct, and a full-grid load per upload is cost with
// no correctness gain.
function routeCache(userId, gridId) {
  return gridId ? peekUserCache(userId, gridId) : null;
}

// Folders for the Files-folder resolution. Prefers the warm cache but FALLS BACK
// to a scoped Mongo read — where an upload lands must not depend on whether a
// cache happens to be warm.
async function filesCtxFor(userId, gridId) {
  const uc = routeCache(userId, gridId);
  if (uc?.foldersById && Object.keys(uc.foldersById).length) return uc;
  const folders = await Folder.find({ userId, gridId }).lean();
  return { foldersById: Object.fromEntries(folders.map((f) => [f.id, f])) };
}

// Where this upload's occurrence lives in the tree.
//
// An EXPLICIT `parentFolderId` always wins — the user picked that folder and it
// is not this rule's business to second-guess it. Only an upload with no chosen
// folder homes into Files/<kind>. That is deliberately NOT
// `resolveFilesFolderId`'s containment check: that guard exists to stop a FILE
// OPERATION writing outside Files, and refusing an upload because the user
// picked their own folder would be the guard firing on the wrong thing.
//
// Returns null when the grid has not run migration 0049 — which is exactly the
// behaviour uploads had before this existed (`parentId: null`), so a grid
// without the folder degrades to the status quo rather than failing the upload.
async function homeFolderForUpload({ userId, gridId, parentFolderId, kind }) {
  if (parentFolderId) return parentFolderId;
  if (!gridId) return null;
  const ctx = await filesCtxFor(userId, gridId);
  return resolveFilesFolderId(ctx, { gridId, userId, kind }) || null;
}

// One uploader for every path that turns a file into an artifact: this route
// and POST /api/v1/share (share → import routing). See services/artifactUpload.js.
// WHERE uploaded bytes live (plan 2026-09-24-connections-storage-gdrive):
// one registry, shared by every upload path below.
const storageRegistry = makeStorageRegistry({
  uploadsDir,
  getDefaultConnection: async (userId) => getConnection(userId, await defaultConnectionId(userId)),
});
const artifactUploader = makeArtifactUploader({ uploadsDir, routeCache, homeFolderForUpload, io, userRoom, storage: storageRegistry });

// requireSession BEFORE multer: an unauthenticated request must not reach the
// disk at all (audit A2). The user is the session's, never the body's.
app.post("/api/artifacts/upload", requireSession, upload.single("file"), async (req, res) => {
  try {
    const userId = req.userId;
    const { gridId, parentFolderId, manifestId } = req.body;
    if (!req.file) return res.status(400).json({ error: "Missing file" });
    if (!(await ownsGrid(userId, gridId))) {
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      return res.status(404).json({ error: "grid not found" });
    }
    // The upload itself lives in services/artifactUpload.js — shared with the
    // share route, so a shared photo lands exactly as an uploaded one does.
    // `sha256` is for the share path; this route's response is unchanged.
    const { sha256: _sha256, ...out } = await artifactUploader.storeUploadedFile({
      file: req.file, userId, gridId, parentFolderId, manifestId,
      moduleId: req.body.moduleId, occurrenceId: req.body.occurrenceId,
    });
    res.json(out);
  } catch (err) {
    console.error("Artifact upload error:", err);
    res.status(500).json({ error: err.message });
  }
});

// /api/upload (legacy) deleted 2026-05-21 — every caller now goes through
// /api/artifacts/upload (canonical: Module + Occurrence + View, optimistic-id
// aware, idempotent on moduleId). See docket §8 quick wins.

// /api/storage-settings removed 2026-09-24 (audit A5): it wrote
// manifest.meta.storageSettings, which nothing ever read, with no auth.
// Storage choice lives on the user now (plan 2026-09-24-connections-storage-gdrive).

const CONNECTIONS = [
  { id: "file_storage", name: "File Storage", path: "/home/joshpoms/files" },
  { id: "external_notebook", name: "Notebook", path: "/home/joshpoms/notebook" },
];

app.get("/api/connections", requireSession, (_req, res) => {
  const result = CONNECTIONS.map((c) => {
    try { const exists = fs.existsSync(c.path); return { ...c, exists, fileCount: exists ? fs.readdirSync(c.path).length : 0 }; }
    catch { return { ...c, exists: false, fileCount: 0 }; }
  });
  res.json({ connections: result });
});

app.get("/api/connections/:id/files", requireSession, (req, res) => {
  const conn = CONNECTIONS.find((c) => c.id === req.params.id);
  if (!conn) return res.status(404).json({ error: "Connection not found" });
  try {
    if (!fs.existsSync(conn.path)) return res.json({ files: [] });
    const entries = fs.readdirSync(conn.path).map((name) => {
      const full = path.join(conn.path, name);
      try { const stat = fs.statSync(full); return { name, isDirectory: stat.isDirectory(), size: stat.size, mtime: stat.mtimeMs }; }
      catch { return { name, isDirectory: false, size: 0, mtime: 0 }; }
    });
    res.json({ files: entries });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/connections/:id/import", requireSession, async (req, res) => {
  const conn = CONNECTIONS.find((c) => c.id === req.params.id);
  if (!conn) return res.status(404).json({ error: "Connection not found" });
  const userId = req.userId;
  const { fileName, gridId, parentFolderId, manifestId } = req.body;
  if (!fileName) return res.status(400).json({ error: "Missing fileName" });
  if (!(await ownsGrid(userId, gridId))) return res.status(404).json({ error: "grid not found" });
  // A name must stay INSIDE its connection's folder (audit A3): "../../x"
  // used to copy any readable server file into uploads.
  const srcPath = resolveInside(conn.path, fileName);
  if (!srcPath) return res.status(400).json({ error: "invalid file name" });
  if (!fs.existsSync(srcPath) || !fs.statSync(srcPath).isFile()) return res.status(404).json({ error: "File not found" });
  try {
    const ext = path.extname(fileName);
    const mimeMap = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".pdf": "application/pdf", ".mp4": "video/mp4", ".mp3": "audio/mpeg", ".md": "text/markdown", ".txt": "text/plain", ".json": "application/json", ".ics": "text/calendar" };
    // The SAME path as an upload (audit A4): dedup, EXIF, thumbnails, the
    // Files/<kind> home folder, the storage backend, cache mirror, broadcasts.
    const { sha256: _sha256, ...out } = await artifactUploader.storeFileFromPath({
      srcPath, originalName: path.basename(srcPath), mimeType: mimeMap[ext.toLowerCase()] || "application/octet-stream",
      userId, gridId, parentFolderId, manifestId,
    });
    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========================================================
// /api/v1 — REST surface (see docs/api-plan.md)
// ========================================================
const opRunBridge = createOpRunBridge();

async function getUserCache(userId, gridId) {
  if (!userCacheReady(userId, gridId)) {
    await loadUserIntoCache(userId, gridId);
  }
  return ensureUserCache(userId, gridId);
}

// Non-loading peek at the warm cache. `full_state` is served ENTIRELY from
// this cache (socketHandlers/state.js), and it survives 30 minutes — so a REST
// write that reaches only Mongo is invisible on the next page load, and the
// socket write path (which merges over the cached copy) can resurrect the stale
// row on top of it. The REST routes mirror every write into the cache, but must
// NOT pay a cold full-grid load to do it: when the cache is cold there is
// nothing stale to correct, because the next load reads Mongo anyway.
function peekUserCache(userId, gridId) {
  return userCacheReady(userId, gridId) ? ensureUserCache(userId, gridId) : null;
}

app.use("/api/v1", makeApiV1Router({
  getUserCache,
  peekUserCache,
  io,
  userRoom,
  opRunBridge,
  // Share → import routing: a shared file is stored by the SAME uploader.
  shareUpload,
  storeUploadedFile: artifactUploader.storeUploadedFile,
}));

// ─── Image search + bare image upload (ImagePickerMenu) ───────────────────
// Calibre-style "look up cover": the client's ImagePickerMenu queries this
// proxy by name (e.g. "Inception movie poster") and shows a thumbnail grid.
// Same auth class as /api/artifacts/upload (app-internal, no API token).
//
// Primary source: DuckDuckGo images (keyless; two-step vqd-token flow).
// Fallback: Wikipedia pageimages (famous subjects). Results are
// { image, thumbnail, title, width, height, source } — the client stores
// the picked `image` URL directly in the field value / module.fileRef
// (external URLs pass through resolveFileRef verbatim, same as the seeded
// Wikimedia artwork; scripts/mirrorRemoteImages.js can localize later).
const IMG_SEARCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Referer: "https://duckduckgo.com/",
};
async function searchImagesDDG(q, max = 24) {
  const tokenPage = await fetch(
    `https://duckduckgo.com/?q=${encodeURIComponent(q)}&iax=images&ia=images`,
    { headers: IMG_SEARCH_HEADERS },
  );
  const html = await tokenPage.text();
  const m = html.match(/vqd=["']?([\d-]+)["']?/);
  if (!m) throw new Error("no vqd token in DDG response");
  const r = await fetch(
    `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(q)}&vqd=${m[1]}&f=,,,&p=1`,
    { headers: IMG_SEARCH_HEADERS },
  );
  if (!r.ok) throw new Error(`DDG i.js ${r.status}`);
  const j = await r.json();
  return (j.results || []).slice(0, max).map((it) => ({
    image: it.image, thumbnail: it.thumbnail, title: it.title,
    width: it.width, height: it.height, source: it.url,
  }));
}
async function searchImagesWikipedia(q, max = 8) {
  const url =
    `https://en.wikipedia.org/w/api.php?action=query&generator=search` +
    `&gsrsearch=${encodeURIComponent(q)}&gsrlimit=${max}` +
    `&prop=pageimages&piprop=original|thumbnail&pithumbsize=300&format=json&formatversion=2`;
  const r = await fetch(url, { headers: { "User-Agent": "moduli/1.0" } });
  if (!r.ok) throw new Error(`wikipedia ${r.status}`);
  const j = await r.json();
  return (j?.query?.pages || [])
    .filter((p) => p.original?.source || p.thumbnail?.source)
    .map((p) => ({
      image: p.original?.source || p.thumbnail?.source,
      thumbnail: p.thumbnail?.source || p.original?.source,
      title: p.title, width: p.original?.width, height: p.original?.height,
      source: `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title)}`,
    }));
}
// ── Search providers, app-internal ────────────────────────────────────────
// The SAME handlers `/api/v1/search/*` serves, mounted without the Bearer-token
// guard because the browser has no API token — it authenticates over the socket
// — and the field editor + the occurrence dropdown call these from the page.
// Same auth class as `/api/images/search` directly below: a keyless proxy to a
// public API, on behalf of this app's own UI.
app.get("/api/search/providers", handleProvidersList);
app.get("/api/search/:provider", handleProviderSearch);
app.get("/api/search/:provider/detail", handleProviderDetail);

app.get("/api/images/search", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.status(400).json({ error: "q required" });
  try {
    const results = await searchImagesDDG(q);
    if (results.length) return res.json({ results, source: "duckduckgo" });
  } catch (e) {
    console.warn("[images/search] ddg failed:", e.message);
  }
  try {
    const results = await searchImagesWikipedia(q);
    return res.json({ results, source: "wikipedia" });
  } catch (e) {
    return res.status(502).json({ error: "image_search_unavailable", message: e.message });
  }
});

// ─── Address lookup ───────────────────────────────────────────────────────
// Backs the `address` FIELD TYPE's search box — wherever an address is edited
// (a Location option on the Locations board, a person's home address), not
// anything Location-specific. Queries Photon (place/venue names) and Nominatim
// (street addresses) in parallel and merges; see server/utils/geocode.js for
// why a fallback chain could not work. Both keyless, both rate-limited and
// User-Agent'd as their usage policies require.
app.get("/api/addresses/search", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.status(400).json({ error: "q required" });
  const near = {
    lat: req.query.lat !== undefined ? Number(req.query.lat) : undefined,
    lon: req.query.lon !== undefined ? Number(req.query.lon) : undefined,
  };
  try {
    const { searchPlaces } = await import("./utils/geocode.js");
    const { results, source } = await searchPlaces(q, near);
    res.json({ results, source });
  } catch (e) {
    res.status(502).json({ error: "geocode_unavailable", message: e.message });
  }
});

// Bare image upload — stores the file under uploads/user/YYYY-MM/ and returns
// its URL. Mints NO module/occurrence (unlike /api/artifacts/upload): the
// ImagePickerMenu uses this when the picked image becomes a FIELD VALUE
// (person photo, movie poster) rather than a standalone artifact.
app.post("/api/images/upload", requireSession, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "file required" });
    if (!req.file.mimetype?.startsWith("image/")) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "image files only" });
    }
    // Same storage choice as every upload (services/storage).
    res.json(await artifactUploader.storeBareFile({ file: req.file, userId: req.userId }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Wikipedia import (no-/v1, no-API-token) ──────────────────────────────
// Mirror of /api/v1/research/wikipedia/import but uses {userId,gridId} from the
// request body the same way /api/artifacts/upload does. Lets the in-app
// "Import from Wikipedia" operation hit it via CALL_API without minting an
// API token first. Same-origin only is enforced upstream by CORS settings.
app.post("/api/research/wikipedia/import", requireSession, async (req, res) => {
  try {
    // The session is the user (CALL_API sends it on same-site URLs); a body
    // userId is ignored. CORS never protected this — it only restrains browsers.
    const userId = req.userId;
    const { gridId, parentId = null, query, title: explicitTitle, dryRun = false } = req.body || {};
    if (!gridId) return res.status(400).json({ error: "gridId required" });
    if (!(await ownsGrid(userId, gridId))) return res.status(404).json({ error: "grid not found" });
    if (!query && !explicitTitle) return res.status(400).json({ error: "query or title required" });

    const { search, fullMarkdown } = await import("./services/wikipediaTools.js");
    const { markdownToModuli } = await import("./services/markdownImporter.js");

    let pickedTitle = explicitTitle;
    let searchHit = null;
    if (!pickedTitle) {
      const hits = await search(query, { limit: 1 });
      if (!hits.length) return res.status(404).json({ error: "No Wikipedia matches for that query" });
      searchHit = hits[0];
      pickedTitle = searchHit.title;
    }

    const full = await fullMarkdown(pickedTitle);
    if (!full) return res.status(404).json({ error: "Article not found" });

    const importResult = await markdownToModuli({
      gridId, parentId, userId,
      markdown: full.markdown, title: pickedTitle, dryRun,
    });

    if (!dryRun) {
      for (const m of importResult.modules) io.to(userRoom(userId)).emit("module_created", { module: m });
      for (const o of importResult.occurrences) io.to(userRoom(userId)).emit("occurrence_created", { occurrence: o });
    }

    res.json({
      ok: true,
      source: { title: pickedTitle, url: full.url, matchedFrom: explicitTitle ? "title" : "search" },
      searchHit,
      rootOccurrenceId: importResult.rootOccurrenceId,
      stats: importResult.stats,
      dryRun,
    });
  } catch (err) {
    console.error("[wiki-import] error:", err);
    res.status(500).json({ error: err.message });
  }
});

// HMAC verification needs the raw body bytes — use express.raw on this
// route only, then parse JSON ourselves after signature check passes.
app.post(
  "/api/webhooks/:operationId",
  express.raw({ type: "*/*", limit: "1mb" }),
  async (req, res) => {
    try {
      const { operationId } = req.params;
      const op = await Operation.findOne({ id: operationId });
      if (!op) return res.status(404).json({ error: "Operation not found" });

      // If the op has a secret, every request must carry a valid
      // X-Moduli-Signature header. Format: "sha256=<hex>".
      if (op.webhookSecret) {
        const sigHeader = req.headers["x-moduli-signature"] || "";
        const sigMatch = /^sha256=([a-f0-9]+)$/i.exec(String(sigHeader));
        if (!sigMatch) {
          return res.status(401).json({ error: "invalid_signature", message: "Missing or malformed X-Moduli-Signature header" });
        }
        const expected = crypto.createHmac("sha256", op.webhookSecret)
          .update(req.body)
          .digest("hex");
        const given = sigMatch[1];
        const a = Buffer.from(expected, "hex");
        const b = Buffer.from(given, "hex");
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
          return res.status(401).json({ error: "invalid_signature", message: "Signature mismatch" });
        }
      }

      // Parse body as JSON (best-effort). The raw bytes were preserved
      // above for the HMAC check; this just gives the pipeline a usable
      // object for $trigger.*.
      let body = {};
      try { body = req.body && req.body.length > 0 ? JSON.parse(req.body.toString("utf8")) : {}; } catch { body = {}; }

      const syntheticTx = { type: "WebhookOp", operationId, timestamp: new Date().toISOString(), ...body };

      // A webhook fires the operation on a CONNECTED CLIENT — the executor that
      // can CREATE/FIND/UPDATE occurrences is client-side (the server-side one
      // in services/serverExecutor.js handles only CALL_API / INIT_VAR /
      // SHOW_VALUE / IF / LOOP). With no tab open the emit reaches an empty room
      // and the payload is silently dropped. Reporting `ok: true` for that was a
      // lie that made a dead pipe look healthy, so say what actually happened.
      // For unattended data intake use POST /api/v1/ingest, which writes
      // server-side and needs no client at all.
      const room = io.sockets.adapter.rooms.get(userRoom(op.userId));
      const delivered = !!(room && room.size > 0);
      if (delivered) {
        io.to(userRoom(op.userId)).emit("trigger_operation", { operationId, transactionType: "WebhookOp", transaction: syntheticTx });
      } else {
        console.warn(`⚠️  webhook ${operationId}: no connected client — operation NOT run, payload dropped`);
      }
      res.json({
        ok: true,
        operationId,
        delivered,
        ...(delivered ? {} : {
          warning: "No Moduli client connected — the operation did not run and this payload was dropped. Webhook-triggered operations need an open tab; use POST /api/v1/ingest for unattended writes.",
        }),
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  }
);

// ========================================================
// SCHEDULE CRON — fires onSchedule operations every minute
// ========================================================
const _scheduleFired = new Map();
setInterval(async () => {
  try {
    const now = new Date();
    const hh = now.getHours();
    const mm = now.getMinutes();
    const key = `${hh}:${String(mm).padStart(2, "0")}`;
    const ops = await Operation.find({ triggerType: "onSchedule", enabled: true });
    for (const op of ops) {
      const cfg = op.triggerConfig || {};
      const sc = cfg.onSchedule ?? cfg; // support both nested {onSchedule:{hour,minute}} and flat {hour,minute}
      if (sc.hour == null || sc.minute == null) continue;
      if (Number(sc.hour) !== hh || Number(sc.minute) !== mm) continue;
      if (_scheduleFired.get(op.id) === key) continue;
      _scheduleFired.set(op.id, key);
      io.to(userRoom(op.userId)).emit("trigger_operation", { operationId: op.id, transactionType: "ScheduleOp", transaction: { type: "ScheduleOp", operationId: op.id, timestamp: now.toISOString(), hour: hh, minute: mm } });
    }
  } catch (err) { console.error("Schedule cron error:", err.message); }
}, 60_000);

// ========================================================
// STATIC CLIENT SERVING (production)
// ========================================================
const clientDistDir = path.join(__dirname, "../client/dist");
if (fs.existsSync(path.join(clientDistDir, "index.html"))) {
  // Vite content-hashes everything under assets/ → cache forever. index.html
  // (and other root files) must always revalidate so a deploy takes effect.
  app.use(express.static(clientDistDir, {
    setHeaders: (res, filePath) => {
      const rel = path.relative(clientDistDir, filePath);
      res.setHeader(
        "Cache-Control",
        rel.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache"
      );
    },
  }));
  // A phone/Windows SHARE posts here. Normally the app's service worker
  // (client/public/sw.js) catches it first; this runs only when it did not —
  // the worker not installed yet, or a browser without one. The share cannot
  // be handed on (the form carries no credential), so it SAYS so rather than
  // vanishing into a 404 (spec §12). 303 turns the POST into a GET.
  app.post("/share-target", (_req, res) => {
    const msg = "Moduli wasn't ready to receive shares on this device yet. Open Moduli once, then share again.";
    res.redirect(303, `/share-pending?error=${encodeURIComponent(msg)}`);
  });
  app.get("/{*splat}", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(clientDistDir, "index.html"));
  });
}

// ========================================================
// SERVER LISTEN
// ========================================================
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`\n🚀 Server running on port ${PORT} (0.0.0.0)`));
