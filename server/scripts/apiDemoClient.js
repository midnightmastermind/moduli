// scripts/apiDemoClient.js
//
// Headless "fake client" for the API demo. Connects to the server via
// socket.io exactly like a browser tab would, then sits in a loop:
//   - On `run_op_for_api`: load the op from Mongo, execute its CALL_API
//     steps directly (lightweight executor — just enough to demo the
//     bridge), emit `api_op_result` back.
//
// In production this is what the user's browser tab does via
// bindSocketToStore.js + the full pipeline executor. For the demo,
// running this in a terminal lets us prove the end-to-end flow without
// keeping a browser open.
//
// Run: node --env-file=.env server/scripts/apiDemoClient.js <email>
//   Connects to ws://localhost:5001 (override with MODULI_API_BASE).

import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { io as ioClient } from "socket.io-client";
import User from "../models/User.js";
import Operation from "../models/Operation.js";

const [, , email] = process.argv;
if (!email) {
  console.error("Usage: node server/scripts/apiDemoClient.js <email>");
  process.exit(1);
}

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/dnd_containers";
const JWT_SECRET = process.env.JWT_SECRET || "SUPER_SECRET";
const BASE = process.env.MODULI_API_BASE || "http://localhost:5001";

await mongoose.connect(MONGO_URI);
const user = await User.findOne({ email });
if (!user) { console.error(`No user with email ${email}`); process.exit(1); }
const userId = user._id.toString();
const jwtToken = jwt.sign({ userId }, JWT_SECRET, { expiresIn: "1h" });

console.log(`📡 Connecting to ${BASE} as ${email} ...`);
const socket = ioClient(BASE, { auth: { token: jwtToken } });

socket.on("connect", () => console.log(`✅ Connected as socket ${socket.id}`));
socket.on("disconnect", reason => console.log(`❌ Disconnected: ${reason}`));
socket.on("connect_error", err => console.error("connect_error:", err.message));

// Minimal executor for the demo op. Reads steps, resolves CALL_API,
// INIT_VAR, and SHOW_VALUE. Enough to drive `Demo: Weather Lookup`
// end-to-end; the full browser executor handles every action type.
function resolvePath(value, vars) {
  if (typeof value !== "string") return value;
  if (!value.startsWith("$")) return value;
  const parts = value.slice(1).split(".");
  let cur = vars[`$${parts[0]}`];
  for (let i = 1; i < parts.length; i++) {
    if (cur == null) return null;
    cur = cur[parts[i]];
  }
  return cur;
}

async function runDemoOp(op, vars) {
  const $vars = { ...vars };
  // Fold both "$foo" and "foo" keys.
  for (const [k, v] of Object.entries(vars || {})) {
    $vars[k.startsWith("$") ? k : `$${k}`] = v;
  }
  const effects = [];
  for (const step of op.pipeline?.steps || []) {
    const cfg = step.config || {};
    if (cfg.type === "CALL_API") {
      const url = cfg.url;
      const qs = Object.entries(cfg.query || {})
        .map(([k, v]) => `${k}=${encodeURIComponent(resolvePath(v, $vars) ?? "")}`)
        .join("&");
      const finalUrl = url + (qs ? `?${qs}` : "");
      const res = await fetch(finalUrl, { method: cfg.method || "GET" });
      const parsed = await res.json();
      $vars[cfg.responseVar || "$apiResponse"] = parsed;
    } else if (cfg.type === "INIT_VAR") {
      $vars[cfg.name] = resolvePath(cfg.expr, $vars);
    } else if (cfg.type === "SHOW_VALUE") {
      const name = cfg.name?.startsWith("$") ? cfg.name : `$${cfg.name}`;
      effects.push({ _effect: "SHOW_VALUE", name, value: resolvePath(cfg.value, $vars) });
    }
  }
  return { effects, $vars };
}

socket.on("run_op_for_api", async ({ requestId, operationId, vars } = {}) => {
  console.log(`\n📨 run_op_for_api  requestId=${requestId}  opId=${operationId}`);
  const startedAt = Date.now();
  try {
    const op = await Operation.findOne({ id: operationId, userId });
    if (!op) {
      socket.emit("api_op_result", {
        requestId, ok: false,
        error: { code: "not_found", message: "Operation not found" },
        durationMs: Date.now() - startedAt,
      });
      return;
    }
    console.log(`   running pipeline for "${op.name}" with vars`, vars);
    const { effects } = await runDemoOp(op, vars || {});
    const finalVars = {};
    for (const eff of effects) {
      if (eff._effect === "SHOW_VALUE") finalVars[eff.name] = eff.value;
    }
    console.log(`   → returning vars:`, finalVars);
    socket.emit("api_op_result", {
      requestId, ok: true,
      vars: finalVars,
      effects,
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    console.error("   ERROR:", err.message);
    socket.emit("api_op_result", {
      requestId, ok: false,
      error: { code: "execution_error", message: String(err?.message || err) },
      durationMs: Date.now() - startedAt,
    });
  }
});

console.log("✋ Waiting for run_op_for_api events. Ctrl-C to exit.");
