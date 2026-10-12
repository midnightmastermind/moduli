// An operation's effects are WRITES the user's gesture caused (a mood pick on the
// Emotions Wheel mints a Check In through CREATE_ITEM). They must leave through
// `safeEmit`, which stamps the open action's `__actionId` — a raw `socket.emit`
// skips it, the server records the create as DERIVED, and Ctrl+Z after the pick
// undid an unrelated earlier write instead (watched 2026-10-12: Check Ins 3 -> 4
// -> Ctrl+Z 4). It also skips the offline queue.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.join(__dirname, "../state/bindSocketToStore.js"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

// Reads and handshakes are not writes and carry no action.
const NOT_WRITES = new Set(["request_full_state", "feed_claim", "import_text"]);

describe("op effects stamp the user's action", () => {
  it("emits no WRITE through a raw socket.emit", () => {
    const raw = [...src.matchAll(/socket\??\.emit\(\s*["']([a-z_]+)["']/g)].map((m) => m[1]);
    expect(raw.filter((e) => !NOT_WRITES.has(e))).toEqual([]);
  });

  it("control: the effect writes still exist, through safeEmit", () => {
    for (const ev of ["create_occurrence", "create_folder", "update_view", "update_occurrence_hidden"]) {
      expect(src).toMatch(new RegExp(`safeEmit\\(\\s*socket,\\s*["']${ev}["']`));
    }
  });
});
