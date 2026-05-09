// server.js — Express + Socket.io bootstrap (~300 lines)
// All socket handlers are in server/socketHandlers/

import express from "express";
import http from "http";
import cors from "cors";
import mongoose from "mongoose";
import { Server } from "socket.io";
import multer from "multer";
import path from "path";
import fs from "fs";
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

const MODEL_MAP = { grid: Grid, module: Module, field: Field, occurrence: Occurrence, manifest: Manifest, view: View, folder: Folder };
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
app.use(express.json());

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
  registerCrudHandlers(socket, ctx);
  registerOccurrenceHandlers(socket, ctx);
  registerTransactionHandlers(socket, ctx);
  registerTemplateHandlers(socket, ctx);

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

app.use("/uploads", express.static(uploadsDir));

// ─────────────────────────────────────────────────────────────────────────────

const mdDir = path.join(uploadsDir, "md");
if (!fs.existsSync(mdDir)) fs.mkdirSync(mdDir, { recursive: true });

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

app.post("/api/artifacts/upload", upload.single("file"), async (req, res) => {
  try {
    const { userId, gridId, parentFolderId, manifestId } = req.body;
    if (!userId || !req.file) return res.status(400).json({ error: "Missing userId or file" });

    const subfolder = "user";
    const artifactSubdir = path.join(uploadsDir, subfolder);
    fs.mkdirSync(artifactSubdir, { recursive: true });
    const destFileName = req.file.filename;
    const destPath = path.join(artifactSubdir, destFileName);
    fs.renameSync(req.file.path, destPath);
    const fileRef = `${subfolder}/${destFileName}`;
    const kind = mimeToKind(req.file.mimetype, req.file.originalname);
    const { viewType, artifactType } = viewFieldsForKind(kind);

    // Use supplied IDs if present (optimistic flow), otherwise generate fresh ones.
    const moduleId = req.body.moduleId || nanoid();
    const occurrenceId = req.body.occurrenceId || nanoid();

    const existingMod = await Module.findOne({ id: moduleId });
    const isUpdate = !!existingMod;

    const moduleDoc = {
      id: moduleId, userId, gridId: gridId || null,
      role: "artifact", kind,
      label: existingMod?.label || req.file.originalname,
      fileRef, defaultDragMode: "copy",
      meta: {
        ...(existingMod?.meta || {}),
        mimeType: req.file.mimetype,
        originalName: req.file.originalname,
        folderId: parentFolderId || existingMod?.meta?.folderId || null,
        uploadStatus: "ready",
      },
    };
    await Module.findOneAndUpdate({ id: moduleId }, moduleDoc, { upsert: true });

    const existingOcc = await Occurrence.findOne({ id: occurrenceId });
    const occDoc = existingOcc
      ? { ...existingOcc.toObject(), targetType: "module", targetId: moduleId }
      : {
          id: occurrenceId, userId, gridId: gridId || null,
          targetType: "module", targetId: moduleId,
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
    res.json({ module: modObj, occurrence: occObj, fileRef, url: `/artifacts/${fileRef}` });
  } catch (err) {
    console.error("Artifact upload error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    const { userId, gridId } = req.body;
    if (!userId || !req.file) return res.status(400).json({ error: "Missing userId or file" });
    const fileRef = req.file.filename;
    const kind = mimeToKind(req.file.mimetype, req.file.originalname);
    const moduleId = nanoid();
    const module = new Module({ id: moduleId, userId, gridId: gridId || null, role: "artifact", kind, label: req.file.originalname, fileRef, meta: { mimeType: req.file.mimetype, originalName: req.file.originalname } });
    await module.save();
    const obj = module.toObject();
    const modObj = { ...obj, id: obj.id || obj._id.toString() };
    const cache = cacheByUser[userId];
    if (cache) cache.modulesById[modObj.id] = modObj;
    io.to(userRoom(userId)).emit("module_created", modObj);
    res.json({ module: modObj, fileRef, url: `/uploads/${fileRef}` });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: err.message });
  }
});

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
  const { fileName, userId, gridId } = req.body;
  if (!fileName || !userId) return res.status(400).json({ error: "Missing fileName or userId" });
  const srcPath = path.join(conn.path, fileName);
  if (!fs.existsSync(srcPath)) return res.status(404).json({ error: "File not found" });
  try {
    const ext = path.extname(fileName);
    const mimeMap = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".pdf": "application/pdf", ".mp4": "video/mp4", ".mp3": "audio/mpeg", ".md": "text/markdown", ".txt": "text/plain", ".json": "application/json" };
    const mime = mimeMap[ext.toLowerCase()] || "application/octet-stream";
    const fileRef = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    fs.copyFileSync(srcPath, path.join(uploadsDir, fileRef));
    const moduleId = nanoid();
    const kind = mimeToKind(mime, fileName);
    const module = new Module({ id: moduleId, userId, gridId: gridId || null, role: "artifact", kind, label: fileName, fileRef, meta: { mimeType: mime, originalName: fileName } });
    await module.save();
    const obj = module.toObject();
    const modObj = { ...obj, id: obj.id || obj._id.toString() };
    const cache = cacheByUser[userId];
    if (cache) cache.modulesById[modObj.id] = modObj;
    io.to(userRoom(userId)).emit("module_created", modObj);
    res.json({ module: modObj, fileRef, url: `/uploads/${fileRef}` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/webhooks/:operationId", async (req, res) => {
  try {
    const { operationId } = req.params;
    const op = await Operation.findOne({ id: operationId });
    if (!op) return res.status(404).json({ error: "Operation not found" });
    const syntheticTx = { type: "WebhookOp", operationId, timestamp: new Date().toISOString(), ...(req.body || {}) };
    io.to(userRoom(op.userId)).emit("trigger_operation", { operationId, transactionType: "WebhookOp", transaction: syntheticTx });
    res.json({ ok: true, operationId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

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
  app.use(express.static(clientDistDir));
  app.get("/{*splat}", (_req, res) => res.sendFile(path.join(clientDistDir, "index.html")));
}

// ========================================================
// SERVER LISTEN
// ========================================================
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`\n🚀 Server running on port ${PORT} (0.0.0.0)`));
