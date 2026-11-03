import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseFrame, isWrite, READ_EVENTS, guardScript } from "../writeGuard.mjs";

const SRC = path.resolve(import.meta.dirname, "../../../client/src");
function clientEmitNames() {
  const out = new Set();
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === "__tests__" || e.name === "node_modules") continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(jsx?|mjs)$/.test(e.name)) {
      const t = fs.readFileSync(p, "utf8");
      // a literal emit, or an event named in a request helper's options (`event: "link_harvest"`)
      for (const m of t.matchAll(/(?:safeEmit\([^,"]*,\s*|\.emit\(|\bevent:\s*)"([a-z_]+)"/g)) out.add(m[1]);
    }
  } };
  walk(SRC);
  return out;
}

test("a socket.io event frame names its event", () => {
  assert.deepEqual(parseFrame('42["update_occurrence",{"occurrence":{"id":"x"}}]'), { event: "update_occurrence" });
  assert.deepEqual(parseFrame('421["import_plan",{}]'), { event: "import_plan" }); // with an ack id
  assert.equal(parseFrame("2"), null); // ping
  assert.equal(parseFrame("40"), null); // connect
});

test("writes are everything not known to be a read", () => {
  assert.equal(isWrite("update_occurrence"), true);
  assert.equal(isWrite("some_new_event_nobody_listed"), true); // unknown = blocked
  assert.equal(isWrite("request_full_state"), false);
});

test("every read the guard lets through is an event the client really sends", () => {
  const sent = clientEmitNames();
  assert.ok(sent.has("update_occurrence"), "control: the scan finds the client's emits");
  for (const r of READ_EVENTS) assert.ok(sent.has(r) || r === "join_grid", `READ_EVENTS lists "${r}", which the client never sends`);
});

test("no event that changes data is in the read list", () => {
  for (const r of READ_EVENTS) assert.doesNotMatch(r, /^(update|create|delete|move|link_occurrence|unpin|pin|trash|restore|save_over|apply|copy|break|undo|redo|import_text)/, r);
});

test("the init script is self-contained JavaScript", () => {
  const src = guardScript(false);
  assert.doesNotThrow(() => new Function(src));
  assert.match(src, /__blockedWrites/);
  assert.doesNotThrow(() => new Function(guardScript(true)));
});

test("the skin script rewrites only grid frames, and only the skin key", async () => {
  const { skinScript } = await import("../session.mjs");
  const src = skinScript("terminal");
  assert.doesNotThrow(() => new Function(src));
  assert.match(src, /full_state\|grid_updated/);
  assert.equal(skinScript(null), "");
});
