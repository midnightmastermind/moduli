// server.js — Express + Socket.io bootstrap (~300 lines)
// All socket handlers are in server/socketHandlers/

import express from "express";
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
import ExifReader from "exifreader";
import sharp from "sharp";

// __dirname polyfill for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ========================================================
// MODELS
// ========================================================
import Module from "./models/Module.js";
import Grid from "./models/Grid.js";
import User from "./models/User.js";
import Occurrence from "./models/Occurrence.js";
import Field from "./models/Field.js";
import Transaction from "./models/Transaction.js";
import Manifest from "./models/Manifest.js";
import View from "./models/View.js";
import Folder from "./models/Folder.js";
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
import { makeApiV1Router } from "./routes/apiV1.js";
import { createOpRunBridge } from "./utils/opRunBridge.js";


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
  socketTimeoutMS: 20000,        // kill in-flight ops if Mongo goes silent for 20s
  serverSelectionTimeoutMS: 10000, // fail fast if Mongo is unreachable
  maxPoolSize: 20,                 // a few writers can run concurrently while reads stay snappy
  bufferTimeoutMS: 8000,           // don't sit in Mongoose buffer forever waiting for a connection
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
}).catch((err) => console.error("🔴 MongoDB connect error:", err));
console.log("🧪 Using MONGO_URI:", MONGO_URI);

// ========================================================
// GRID CACHE  (keyed by "userId:gridId" — one entry per grid)
// ========================================================
const cacheByUser = Object.create(null);       // "userId:gridId" → cache object
const cacheLastAccess = Object.create(null);   // "userId:gridId" → timestamp
const cacheLoadingPromise = Object.create(null); // "userId:gridId" → Promise
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function gridCacheKey(userId, gridId) { return `${userId}:${gridId}`; }

// Periodic cache eviction — runs every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const key of Object.keys(cacheLastAccess)) {
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
    uc.modulesById = {};
    modules.forEach((m) => { const id = m.id || m._id.toString(); uc.modulesById[id] = { ...m, id, label: m.label ?? "" }; });
    uc.occurrencesById = {};
    occurrences.forEach((o) => {
      const id = o.id || o._id.toString();
      const occ = o.textmap ? { ...o, id, textmap: decompressTextmap(o.textmap) } : { ...o, id };
      uc.occurrencesById[id] = occ;
    });
    uc.fieldsById = {};
    fields.forEach((f) => { const id = f.id || f._id.toString(); uc.fieldsById[id] = { ...f, id }; });
    uc.manifestsById = {};
    manifests.forEach((m) => { const id = m.id || m._id.toString(); uc.manifestsById[id] = { ...m, id }; });
    uc.viewsById = {};
    views.forEach((v) => { const id = v.id || v._id.toString(); uc.viewsById[id] = { ...v, id }; });
    uc.foldersById = {};
    folders.forEach((f) => { const id = f.id || f._id.toString(); uc.foldersById[id] = { ...f, id }; });
    uc.operationsById = {};
    operations.forEach((o) => { const id = o.id || o._id.toString(); uc.operationsById[id] = { ...o, id }; });
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
      if (d.kind === "cell-switch") {
        console.log(`📉 [scroll] CELL-SWITCH ${d.verdict} user=${socket.userId} `
          + `maxBlock=${d.maxGapMs}ms blocked=${d.blockedMs}ms frames=${d.frames} `
          + `rows=${d.rowsAtStart} animations=${d.animations} domNodes=${d.domNodes} `
          + `editors=${d.editors} ${d.viewport}@${d.dpr}x ua=${(d.ua || "").slice(-30)}`);
        return;
      }
      console.log(`📉 [scroll] ${d.verdict} burst#${d.index} arm=${d.arm} user=${socket.userId} `
        + `${d.viewport}@${d.dpr}x rows=${d.rowsAtStart} added=${d.rowsAdded} `
        + `unskipped=${d.unskipped} skippedAtStart=${d.skippedAtStart} `
        + `frameMedian=${d.frameMedian}ms missed=${d.slowFrames} `
        + `longTasks=${d.longTasks}(${d.longTaskMs}ms) `
        + `seed=${d.seedPx} real=${d.realPx} scrolled=${Math.round(d.endTop - d.startTop)}px `
        + `dur=${d.durationMs}ms longtaskAPI=${d.supportsLongTask} cvEvent=${d.supportsCvEvent} `
        + `ua=${(d.ua || "").slice(-40)}`);
    } catch { /* a diagnostic must never take the server down */ }
  });

  registerCrudHandlers(socket, ctx);
  registerOccurrenceHandlers(socket, ctx);
  registerTransactionHandlers(socket, ctx);
  registerTemplateHandlers(socket, ctx);
  registerImportHandlers(socket, ctx);

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
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

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

const CODE_EXTENSIONS = new Set([".js",".jsx",".ts",".tsx",".py",".sh",".bash",".json",".yaml",".yml",".toml",".css",".html",".xml",".sql",".go",".rs",".c",".cpp",".h",".rb",".php",".swift",".kt"]);
function mimeToKind(mime, filename = "") {
  if (mime?.startsWith("image/")) return "image";
  if (mime?.startsWith("video/")) return "video";
  if (mime?.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  const ext = filename.includes(".") ? "." + filename.split(".").pop().toLowerCase() : "";
  if (CODE_EXTENSIONS.has(ext)) return "code";
  return "markdown";
}
// Derives the panel-display View fields from the artifact module's kind.
// Keeps the existing artifact-panel path working: drag artifact onto empty grid cell
// → View is consulted for rendering. In containers, ArtifactCard reads `kind` directly.
function viewFieldsForKind(kind) {
  if (["image", "video", "audio", "pdf"].includes(kind)) return { viewType: "display", artifactType: kind };
  if (kind === "code") return { viewType: "code", artifactType: null };
  return { viewType: "markdown", artifactType: null };
}

// Year-month upload sharding (files/artifact audit gap #18). New uploads
// land in `uploads/user/YYYY-MM/` so the leaf directory listing stays
// manageable over long horizons. Existing flat files keep working since
// `resolveFileRef` and the Express static mount both serve nested paths
// — see `scripts/shardExistingUploads.js` for the one-off migration.
function yearMonthShard(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

// SHA-256 content hash for upload dedup (files/artifact audit gap #3). Streamed
// so 50MB uploads don't load into RAM. Returns a 64-char hex string.
function sha256OfFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

// Image thumbnails via sharp (files audit gap #4). Writes
// `<sha256>-256.webp` + `<sha256>-1024.webp` into uploads/thumbnails/.
// WebP for compression (~30% smaller than JPEG at comparable quality).
// Idempotent: if a thumb already exists for this sha (dedup hit /
// re-mirror / rerun), skip the regeneration. Returns `{ thumb256, thumb1024 }`
// as POSIX-style relative refs (resolvable via `/uploads/<ref>`), or null
// when the source isn't a supportable image. SVG / GIF / non-image types
// return null — sharp's raster pipeline doesn't preserve their semantics.
const THUMB_SUPPORTED = /^image\/(jpeg|jpg|png|webp|tiff|avif|heic|heif)$/i;
async function generateImageThumbnails(srcPath, sha256, mimeType) {
  if (!sha256 || !mimeType || !THUMB_SUPPORTED.test(mimeType)) return null;
  const ref256 = `thumbnails/${sha256}-256.webp`;
  const ref1024 = `thumbnails/${sha256}-1024.webp`;
  const path256 = path.join(uploadsDir, ref256);
  const path1024 = path.join(uploadsDir, ref1024);
  const need256 = !fs.existsSync(path256);
  const need1024 = !fs.existsSync(path1024);
  if (!need256 && !need1024) return { thumb256: ref256, thumb1024: ref1024 };
  try {
    if (need256) {
      // `withoutEnlargement` keeps tiny source images at their native size
      // instead of upscaling. quality 78 is the sweet-spot for thumbnails.
      await sharp(srcPath).rotate().resize({ width: 256, withoutEnlargement: true }).webp({ quality: 78 }).toFile(path256);
    }
    if (need1024) {
      await sharp(srcPath).rotate().resize({ width: 1024, withoutEnlargement: true }).webp({ quality: 82 }).toFile(path1024);
    }
    return { thumb256: ref256, thumb1024: ref1024 };
  } catch {
    // Cleanup any partially-written file so a future retry isn't blocked.
    try { if (need256 && fs.existsSync(path256)) fs.unlinkSync(path256); } catch { /* ignore */ }
    try { if (need1024 && fs.existsSync(path1024)) fs.unlinkSync(path1024); } catch { /* ignore */ }
    return null;
  }
}

// EXIF + dimensions for image uploads (files audit gap #12). Returns
// `{ width, height, exif }` or null on any failure — the upload itself
// shouldn't fail just because metadata extraction did. Reads the full
// file into a Buffer (capped at 50MB by multer; ExifReader's parser
// only inspects header bytes regardless of total size). Sanitizes EXIF
// to plain `{ tagName: description }` so Mongo can persist it under
// Module.meta.exif without nested-object headaches.
const EXIF_INTEREST = [
  "DateTimeOriginal", "DateTime", "CreateDate",
  "Make", "Model", "LensModel",
  "FNumber", "ExposureTime", "ISOSpeedRatings", "FocalLength",
  "Orientation",
  "GPSLatitude", "GPSLongitude", "GPSAltitude",
];
function extractImageMetadata(filePath, mimeType) {
  if (!mimeType?.startsWith("image/")) return null;
  try {
    const buffer = fs.readFileSync(filePath);
    const tags = ExifReader.load(buffer, { expanded: false });
    const out = {};
    // ExifReader keys are tag names; values shape `{description, value}`.
    for (const key of EXIF_INTEREST) {
      const t = tags[key];
      if (t && (t.description != null || t.value != null)) {
        out[key] = t.description ?? (Array.isArray(t.value) ? t.value.join(",") : String(t.value));
      }
    }
    // Width / height live on different tags depending on the format.
    // Prefer `Image Width` / `Image Height` (JPEG/TIFF), fall back to
    // PixelXDimension / PixelYDimension (EXIF block), then `ImageWidth`.
    const width = Number(
      tags["Image Width"]?.value ?? tags["PixelXDimension"]?.value ?? tags["ImageWidth"]?.value ?? NaN
    );
    const height = Number(
      tags["Image Height"]?.value ?? tags["PixelYDimension"]?.value ?? tags["ImageHeight"]?.value ?? NaN
    );
    return {
      width: Number.isFinite(width) ? width : null,
      height: Number.isFinite(height) ? height : null,
      exif: Object.keys(out).length ? out : null,
    };
  } catch {
    return null;
  }
}

app.post("/api/artifacts/upload", upload.single("file"), async (req, res) => {
  try {
    const { userId, gridId, parentFolderId, manifestId } = req.body;
    if (!userId || !req.file) return res.status(400).json({ error: "Missing userId or file" });

    // Use supplied IDs if present (optimistic flow), otherwise generate fresh ones.
    const moduleId = req.body.moduleId || nanoid();
    const occurrenceId = req.body.occurrenceId || nanoid();

    // ── Content-hash dedup (files audit gap #3) ──
    // Compute SHA-256 BEFORE the rename so we can short-circuit the file
    // move + new-module mint when the user already has an artifact module
    // for this exact bytes. External-URL fileRefs (Wikipedia drops etc.)
    // are filtered out — they can't dedup against local uploads.
    const sha256 = await sha256OfFile(req.file.path);
    const dedupCandidate = await Module.findOne({
      userId,
      role: "artifact",
      "meta.sha256": sha256,
      fileRef: { $not: /^(https?:|data:|blob:)/i },
    }).lean();

    if (dedupCandidate && dedupCandidate.id !== moduleId) {
      // Dedup hit: skip the file write, reuse the existing module.
      // Tear down the multer temp file (rename never happened).
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }

      // If the optimistic flow already inserted a placeholder Module
      // (via the `create_module` socket emit that fires alongside the
      // /api/artifacts/upload call), strip it now — the occurrence is
      // about to re-point at the dedup candidate's module.
      const placeholderMod = await Module.findOne({ id: moduleId, userId });
      if (placeholderMod) {
        await Module.deleteOne({ id: moduleId });
        const cache = cacheByUser[userId];
        if (cache) delete cache.modulesById[moduleId];
        io.to(userRoom(userId)).emit("module_deleted", moduleId);
      }

      // Wire (or rewire) the occurrence to point at the existing module.
      const existingOcc = await Occurrence.findOne({ id: occurrenceId });
      const occDoc = existingOcc
        ? { ...existingOcc.toObject(), moduleId: dedupCandidate.id }
        : {
            id: occurrenceId, userId, gridId: gridId || null,
            moduleId: dedupCandidate.id,
            parentId: parentFolderId || null,
            textmap: null,
          };
      if (!existingOcc) {
        // Reuse a single View per module-kind for the new occurrence so
        // the artifact-panel display path still works (same shape the
        // non-dedup branch emits below).
        const { viewType, artifactType } = viewFieldsForKind(dedupCandidate.kind);
        const artifactViewId = nanoid();
        const artifactView = new View({ id: artifactViewId, userId, gridId: gridId || null, viewType, artifactType, layout: {} });
        await artifactView.save();
        occDoc.viewId = artifactViewId;
      }
      await Occurrence.findOneAndUpdate({ id: occurrenceId }, occDoc, { upsert: true });

      const occObj = await Occurrence.findOne({ id: occurrenceId }).lean();
      const cache = cacheByUser[userId];
      if (cache) cache.occurrencesById[occObj.id] = occObj;
      if (existingOcc) {
        io.to(userRoom(userId)).emit("occurrence_updated", occObj);
      } else {
        io.to(userRoom(userId)).emit("occurrence_created", occObj);
      }
      io.to(userRoom(userId)).emit("artifact_created", { moduleId: dedupCandidate.id, occurrenceId, fileRef: dedupCandidate.fileRef });
      return res.json({
        module: dedupCandidate,
        occurrence: occObj,
        fileRef: dedupCandidate.fileRef,
        url: `/uploads/${dedupCandidate.fileRef}`,
        dedup: true,
      });
    }

    // Sharded layout: uploads/user/YYYY-MM/<file>. fileRef is the
    // POSIX-style path stored on the Module — always uses `/` regardless
    // of platform separator (URL semantics + cross-OS portability).
    const shard = yearMonthShard();
    const subfolder = `user/${shard}`;
    const artifactSubdir = path.join(uploadsDir, "user", shard);
    fs.mkdirSync(artifactSubdir, { recursive: true });
    const destFileName = req.file.filename;
    const destPath = path.join(artifactSubdir, destFileName);
    fs.renameSync(req.file.path, destPath);
    const fileRef = `${subfolder}/${destFileName}`;
    const kind = mimeToKind(req.file.mimetype, req.file.originalname);
    const { viewType, artifactType } = viewFieldsForKind(kind);

    const existingMod = await Module.findOne({ id: moduleId });
    const isUpdate = !!existingMod;

    // Extract EXIF + dimensions for image uploads (audit gap #12).
    // Read from the renamed destPath; metadata becomes part of
    // module.meta so the image artifact viewer + future
    // chronological gallery can use it without re-parsing.
    const imageMeta = extractImageMetadata(destPath, req.file.mimetype);

    // Generate sharp thumbnails for image uploads (audit gap #4).
    // sha256-keyed so dedup'd uploads reuse the existing thumbs.
    // Awaited because the response includes the thumb refs.
    const thumbs = await generateImageThumbnails(destPath, sha256, req.file.mimetype);

    const moduleDoc = {
      id: moduleId, userId, gridId: gridId || null,
      role: "artifact", kind,
      label: existingMod?.label || req.file.originalname,
      fileRef, defaultDragMode: "copy",
      meta: {
        ...(existingMod?.meta || {}),
        mimeType: req.file.mimetype,
        originalName: req.file.originalname,
        // Persist size so it survives reloads — the client-side
        // placeholder stamps this too, but rebuilding meta fresh
        // here would have wiped it (see file/artifact docket #5).
        uploadSize: req.file.size,
        // Content-hash stamped on every new module so subsequent uploads
        // of the same bytes can short-circuit via the dedup branch above.
        sha256,
        // Image-only: width / height / exif from ExifReader. All three
        // are nullable when the file isn't an image or the parse fails;
        // omit-when-null keeps non-image modules' meta unchanged.
        ...(imageMeta?.width != null  ? { width:  imageMeta.width  } : {}),
        ...(imageMeta?.height != null ? { height: imageMeta.height } : {}),
        ...(imageMeta?.exif         ? { exif: imageMeta.exif } : {}),
        // Sharp thumbnail refs — sha256-keyed paths under uploads/thumbnails/.
        // Resolves via the same /uploads/ static mount as the original.
        // Null for non-image or unsupported formats (SVG / GIF / etc.).
        ...(thumbs?.thumb256  ? { thumb256:  thumbs.thumb256  } : {}),
        ...(thumbs?.thumb1024 ? { thumb1024: thumbs.thumb1024 } : {}),
        folderId: parentFolderId || existingMod?.meta?.folderId || null,
        uploadStatus: "ready",
      },
    };
    await Module.findOneAndUpdate({ id: moduleId }, moduleDoc, { upsert: true });

    const existingOcc = await Occurrence.findOne({ id: occurrenceId });
    const occDoc = existingOcc
      ? { ...existingOcc.toObject(), moduleId }
      : {
          id: occurrenceId, userId, gridId: gridId || null,
          moduleId,
          parentId: parentFolderId || null,
          textmap: kind === "markdown" ? { type: "doc", content: [] } : null,
        };
    if (!existingOcc) {
      const artifactViewId = nanoid();
      const artifactView = new View({ id: artifactViewId, userId, gridId: gridId || null, viewType, artifactType, layout: {} });
      await artifactView.save();
      occDoc.viewId = artifactViewId;
    }
    await Occurrence.findOneAndUpdate({ id: occurrenceId }, occDoc, { upsert: true });

    if (manifestId) {
      const manifestView = await View.findOne({ manifestId, userId });
      if (manifestView) {
        manifestView.activeOccurrenceId = occurrenceId;
        await manifestView.save();
        const vc = { ...manifestView.toObject(), id: manifestView.id };
        const cache = cacheByUser[userId];
        if (cache) cache.viewsById[vc.id] = vc;
        io.to(userRoom(userId)).emit("view_updated", vc);
      }
    }

    const modObj = await Module.findOne({ id: moduleId }).lean();
    const occObj = await Occurrence.findOne({ id: occurrenceId }).lean();
    const cache = cacheByUser[userId];
    if (cache) {
      cache.modulesById[modObj.id] = modObj;
      cache.occurrencesById[occObj.id] = occObj;
    }

    if (isUpdate) {
      io.to(userRoom(userId)).emit("module_updated", modObj);
    } else {
      io.to(userRoom(userId)).emit("module_created", modObj);
      io.to(userRoom(userId)).emit("occurrence_created", occObj);
    }
    io.to(userRoom(userId)).emit("artifact_created", { moduleId, occurrenceId, fileRef });
    // Serve under /uploads/; the legacy /artifacts/ mount was removed
    // in March 2026 (see server/CLAUDE.md). The url field is purely
    // informational — clients resolve via helpers/fileRef.resolveFileRef.
    res.json({ module: modObj, occurrence: occObj, fileRef, url: `/uploads/${fileRef}` });
  } catch (err) {
    console.error("Artifact upload error:", err);
    res.status(500).json({ error: err.message });
  }
});

// /api/upload (legacy) deleted 2026-05-21 — every caller now goes through
// /api/artifacts/upload (canonical: Module + Occurrence + View, optimistic-id
// aware, idempotent on moduleId). See docket §8 quick wins.

app.post("/api/storage-settings", async (req, res) => {
  try {
    const { userId, manifestId, settings } = req.body;
    if (!manifestId) return res.status(400).json({ error: "Missing manifestId" });
    const manifest = await Manifest.findOneAndUpdate({ id: manifestId }, { $set: { "meta.storageSettings": settings } }, { returnDocument: 'after' });
    if (!manifest) return res.status(404).json({ error: "Manifest not found" });
    const obj = manifest.toObject();
    const cache = cacheByUser[userId];
    if (cache) cache.manifestsById[obj.id] = obj;
    io.to(userRoom(userId)).emit("manifest_updated", obj);
    res.json({ manifest: obj });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const CONNECTIONS = [
  { id: "file_storage", name: "File Storage", path: "/home/joshpoms/files" },
  { id: "external_notebook", name: "Notebook", path: "/home/joshpoms/notebook" },
];

app.get("/api/connections", (_req, res) => {
  const result = CONNECTIONS.map((c) => {
    try { const exists = fs.existsSync(c.path); return { ...c, exists, fileCount: exists ? fs.readdirSync(c.path).length : 0 }; }
    catch { return { ...c, exists: false, fileCount: 0 }; }
  });
  res.json({ connections: result });
});

app.get("/api/connections/:id/files", (req, res) => {
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

app.post("/api/connections/:id/import", async (req, res) => {
  const conn = CONNECTIONS.find((c) => c.id === req.params.id);
  if (!conn) return res.status(404).json({ error: "Connection not found" });
  const { fileName, userId, gridId, parentFolderId, manifestId } = req.body;
  if (!fileName || !userId) return res.status(400).json({ error: "Missing fileName or userId" });
  const srcPath = path.join(conn.path, fileName);
  if (!fs.existsSync(srcPath)) return res.status(404).json({ error: "File not found" });
  try {
    const ext = path.extname(fileName);
    const mimeMap = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".pdf": "application/pdf", ".mp4": "video/mp4", ".mp3": "audio/mpeg", ".md": "text/markdown", ".txt": "text/plain", ".json": "application/json" };
    const mime = mimeMap[ext.toLowerCase()] || "application/octet-stream";

    // Mirror /api/artifacts/upload: write into uploads/user/YYYY-MM/ +
    // mint a full Module + Occurrence + View triple. The legacy
    // flat-uploads/ path is gone; connection imports now sit alongside
    // drag-drop uploads in the sharded layout (audit gap #18).
    const shard = yearMonthShard();
    const subfolder = `user/${shard}`;
    const artifactSubdir = path.join(uploadsDir, "user", shard);
    fs.mkdirSync(artifactSubdir, { recursive: true });
    const destFileName = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    fs.copyFileSync(srcPath, path.join(artifactSubdir, destFileName));
    const fileRef = `${subfolder}/${destFileName}`;
    const stat = fs.statSync(path.join(artifactSubdir, destFileName));

    const kind = mimeToKind(mime, fileName);
    const { viewType, artifactType } = viewFieldsForKind(kind);

    const moduleId = nanoid();
    const occurrenceId = nanoid();
    const viewIdNew = nanoid();

    const moduleDoc = {
      id: moduleId, userId, gridId: gridId || null,
      role: "artifact", kind,
      label: fileName,
      fileRef, defaultDragMode: "copy",
      meta: {
        mimeType: mime,
        originalName: fileName,
        uploadSize: stat.size,
        folderId: parentFolderId || null,
        uploadStatus: "ready",
      },
    };
    await Module.findOneAndUpdate({ id: moduleId }, moduleDoc, { upsert: true });

    const artifactView = new View({ id: viewIdNew, userId, gridId: gridId || null, viewType, artifactType, layout: {} });
    await artifactView.save();

    const occDoc = {
      id: occurrenceId, userId, gridId: gridId || null,
      moduleId,
      parentId: parentFolderId || null,
      viewId: viewIdNew,
      textmap: kind === "markdown" ? { type: "doc", content: [] } : null,
    };
    await Occurrence.findOneAndUpdate({ id: occurrenceId }, occDoc, { upsert: true });

    if (manifestId) {
      const manifestView = await View.findOne({ manifestId, userId });
      if (manifestView) {
        manifestView.activeOccurrenceId = occurrenceId;
        await manifestView.save();
        const vc = { ...manifestView.toObject(), id: manifestView.id };
        const cache = cacheByUser[userId];
        if (cache) cache.viewsById[vc.id] = vc;
        io.to(userRoom(userId)).emit("view_updated", vc);
      }
    }

    const modObj = await Module.findOne({ id: moduleId }).lean();
    const occObj = await Occurrence.findOne({ id: occurrenceId }).lean();
    const cache = cacheByUser[userId];
    if (cache) {
      cache.modulesById[modObj.id] = modObj;
      cache.occurrencesById[occObj.id] = occObj;
    }

    io.to(userRoom(userId)).emit("module_created", modObj);
    io.to(userRoom(userId)).emit("occurrence_created", occObj);
    io.to(userRoom(userId)).emit("artifact_created", { moduleId, occurrenceId, fileRef });
    res.json({ module: modObj, occurrence: occObj, fileRef, url: `/uploads/${fileRef}` });
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

app.use("/api/v1", makeApiV1Router({
  getUserCache,
  io,
  userRoom,
  opRunBridge,
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

// Bare image upload — stores the file under uploads/user/YYYY-MM/ and returns
// its URL. Mints NO module/occurrence (unlike /api/artifacts/upload): the
// ImagePickerMenu uses this when the picked image becomes a FIELD VALUE
// (person photo, movie poster) rather than a standalone artifact.
app.post("/api/images/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "file required" });
    if (!req.file.mimetype?.startsWith("image/")) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "image files only" });
    }
    const shard = yearMonthShard();
    const shardDir = path.join(uploadsDir, "user", shard);
    fs.mkdirSync(shardDir, { recursive: true });
    const destPath = path.join(shardDir, req.file.filename);
    fs.renameSync(req.file.path, destPath);
    const fileRef = `user/${shard}/${req.file.filename}`;
    res.json({ fileRef, url: `/uploads/${fileRef}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Wikipedia import (no-/v1, no-API-token) ──────────────────────────────
// Mirror of /api/v1/research/wikipedia/import but uses {userId,gridId} from the
// request body the same way /api/artifacts/upload does. Lets the in-app
// "Import from Wikipedia" operation hit it via CALL_API without minting an
// API token first. Same-origin only is enforced upstream by CORS settings.
app.post("/api/research/wikipedia/import", async (req, res) => {
  try {
    const { userId, gridId, parentId = null, query, title: explicitTitle, dryRun = false } = req.body || {};
    if (!userId) return res.status(400).json({ error: "userId required" });
    if (!gridId) return res.status(400).json({ error: "gridId required" });
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
      io.to(userRoom(op.userId)).emit("trigger_operation", { operationId, transactionType: "WebhookOp", transaction: syntheticTx });
      res.json({ ok: true, operationId });
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
