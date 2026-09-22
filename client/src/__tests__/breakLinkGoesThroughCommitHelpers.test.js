// __tests__/breakLinkGoesThroughCommitHelpers.test.js
//
// "Break Link" on a copy-linked row was the ONE raw `socket.emit` left in the
// whole component tree — measured 2026-09-22 across modules/ ui/ docs/ mobile/
// components/, exactly one hit:
//
//     onClick: () => socket?.emit("break_link", { occurrenceId: occurrence.id })
//
// A raw emit skips `safeEmit`, which is the offline queue. So Break Link pressed
// while the socket is down is DROPPED — no queue, no error, no retry — and the
// row silently keeps fanning every later field edit out to its group. The user
// has no way to see that the break never happened. Same class as the raw
// `create_module` emit fixed on 2026-09-19 ("the op path's create_module was the
// one raw socket.emit among nine sites; it is safeEmit now").
//
// Found by building a grid by clicking: this is the last surface of the
// copy-link feature, reached while checking what else touches linkedGroupId.
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { breakOccurrenceLink } from "../helpers/CommitHelpers";

const connected = () => ({ emit: vi.fn(), connected: true });

describe("breakOccurrenceLink", () => {
  it("emits break_link with the occurrence id", () => {
    const socket = connected();
    breakOccurrenceLink({ socket, occurrenceId: "occ-1" });
    const [event, payload] = socket.emit.mock.calls[0];
    expect(event).toBe("break_link");
    expect(payload).toMatchObject({ occurrenceId: "occ-1" });
    // The emit is wrapped in an action scope (2026-09-22) so the break is
    // UNDOABLE — unstamped it records `derived` and the undo stack skips it.
    expect(payload.__actionId).toBeTruthy();
  });

  it("QUEUES instead of dropping when the socket is disconnected", () => {
    // THE DEFECT, stated as a contract. A raw `socket.emit` on a disconnected
    // socket is a no-op that reports nothing; safeEmit buffers it and replays
    // it after the reconnect + full_state.
    const socket = { emit: vi.fn(), connected: false };
    breakOccurrenceLink({ socket, occurrenceId: "occ-1" });
    expect(socket.emit, "a disconnected break must be queued, not sent").not.toHaveBeenCalled();
  });

  it("does nothing without an occurrence id", () => {
    const socket = connected();
    breakOccurrenceLink({ socket });
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it("honours emit:false", () => {
    // The CONTROL for the guard above: "never emits" must not be satisfied by a
    // helper that emits nothing at all.
    const socket = connected();
    breakOccurrenceLink({ socket, occurrenceId: "occ-1", emit: false });
    expect(socket.emit).not.toHaveBeenCalled();
    breakOccurrenceLink({ socket, occurrenceId: "occ-1" });
    expect(socket.emit).toHaveBeenCalledTimes(1);
  });
});

describe("no component fire-and-forgets to the socket directly", () => {
  // A source guard, because the defect was ONE LINE inside a radial-menu item
  // that needs the whole grid mounted to reach. It is also the contract this
  // project states in CLAUDE.md: "CommitHelpers is the only layer that talks to
  // socket. Components never call socket directly."
  //
  // SCOPED TO FIRE-AND-FORGET, and the narrowing was forced by the data rather
  // than chosen: the first version of this guard failed on two REQUEST emits in
  // `modules/BookmarkView.jsx` (`import_text`, `import_plan`), both of which
  // pass an ACK CALLBACK as the third argument. `safeEmit(socket, event, data)`
  // takes no third parameter — it cannot carry an ack — so a request/response
  // emit is not something it can replace, and BookmarkView already reports its
  // own failure through that ack ("Could not add the page: no reply"). A guard
  // that flags what has no fix gets deleted the first time it is in the way.
  //
  // (My own `grep` over the same tree reported ONE hit and missed both. The
  // walker is the measurement; a hand grep is not.)
  const ROOT = path.join(__dirname, "..");
  const DIRS = ["modules", "ui", "docs", "mobile", "components"];

  const walk = (dir) => {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...walk(p));
      else if (/\.jsx$/.test(e.name)) out.push(p);
    }
    return out;
  };

  const EMIT = /\bsocket\s*\??\.\s*emit\s*\(/;

  /** The whole call, from `socket.emit(` to its matching `)`, brace-balanced —
   *  a request's ack callback is a multi-line arrow function, so a per-LINE
   *  test cannot tell a request from a fire-and-forget write. */
  const callAt = (src, at) => {
    let i = src.indexOf("(", at), depth = 0;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") { depth--; if (depth === 0) return src.slice(at, i + 1); }
    }
    return src.slice(at);
  };
  /** Three top-level arguments, or two where the second is a callback. */
  const hasAck = (call) => {
    let depth = 0, args = 0, inStr = null;
    for (let i = call.indexOf("(") + 1; i < call.length; i++) {
      const c = call[i];
      if (inStr) { if (c === inStr && call[i - 1] !== "\\") inStr = null; continue; }
      if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") { if (depth === 0) break; depth--; }
      else if (c === "," && depth === 0) args++;
    }
    return args >= 2 || /=>\s*\{/.test(call);
  };

  it("has zero fire-and-forget socket.emit calls in the component tree", () => {
    const hits = [];
    for (const d of DIRS) {
      const dir = path.join(ROOT, d);
      if (!fs.existsSync(dir)) continue;
      for (const file of walk(dir)) {
        const src = fs.readFileSync(file, "utf8");
        const re = new RegExp(EMIT.source, "g");
        for (let m; (m = re.exec(src)); ) {
          const call = callAt(src, m.index);
          if (!hasAck(call)) hits.push(`${path.relative(ROOT, file)}: ${call.split("\n")[0].trim().slice(0, 70)}`);
        }
      }
    }
    expect(hits, `route these through CommitHelpers (safeEmit): ${hits.join(" | ")}`).toEqual([]);
  });

  it("the guard can SEE a fire-and-forget emit, and still passes a request", () => {
    // Without this, "zero hits" is also what a broken walker reports — and the
    // ack exemption has to be shown NOT to swallow the defect it was narrowed
    // around.
    const files = DIRS.flatMap((d) => (fs.existsSync(path.join(ROOT, d)) ? walk(path.join(ROOT, d)) : []));
    expect(files.length).toBeGreaterThan(50);
    const bare = 'socket?.emit("break_link", { occurrenceId: x })';
    const req = 'socket.emit("import_plan", { content: md }, (out) => {\n  setPlan(out);\n})';
    expect(EMIT.test(bare)).toBe(true);
    expect(hasAck(callAt(bare, 0)), "a bare write must NOT read as a request").toBe(false);
    expect(hasAck(callAt(req, 0)), "a request with an ack must be exempt").toBe(true);
  });

  it("ModuleInstance's Break Link goes through CommitHelpers", () => {
    const src = fs.readFileSync(path.join(ROOT, "modules/ModuleInstance.jsx"), "utf8");
    expect(src).toMatch(/CommitHelpers\.breakOccurrenceLink\(/);
  });
});
