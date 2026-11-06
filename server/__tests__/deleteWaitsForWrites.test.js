// "Keep the items" sends: re-parent each child, empty the container's list, delete the container. Handlers are async, so
// the delete could finish first: the late list write then wrote the deleted container back (found on test grid 2, an empty
// container left in Mongo after Keep), and the delete's cascade could reach a child whose re-parent had not landed.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { createSerialByKey } from "../utils/serialByKey.js";

const defer = () => { let r; const p = new Promise((res) => { r = res; }); return { p, r }; };

describe("settled", () => {
  it("waits for every write under the prefix that is running", async () => {
    const run = createSerialByKey(); const a = defer(), b = defer(); const log = [];
    run("u1:a", () => a.p.then(() => log.push("a")));
    run("u1:b", () => b.p.then(() => log.push("b")));
    const done = run.settled("u1:").then(() => log.push("settled"));
    a.r(); await Promise.resolve(); await Promise.resolve();
    expect(log).not.toContain("settled");
    b.r(); await done;
    expect(log).toEqual(["a", "b", "settled"]);
  });
  it("another user's writes are not waited for", async () => {
    const run = createSerialByKey(); const other = defer();
    run("u2:x", () => other.p);
    await run.settled("u1:");
    other.r();
  });
  it("a write that failed does not hold it up", async () => {
    const run = createSerialByKey();
    await run("u1:a", () => Promise.reject(new Error("no"))).catch(() => {});
    run("u1:b", () => Promise.reject(new Error("no"))).catch(() => {});
    await run.settled("u1:");
  });
  it("nothing running answers at once", async () => { await createSerialByKey().settled("u1:"); });
});

describe("wiring", () => {
  it("delete_occurrence waits before it reads the cache", () => {
    const src = fs.readFileSync(new URL("../socketHandlers/crud.js", import.meta.url), "utf8");
    const body = src.slice(src.indexOf('socket.on("delete_occurrence"'));
    const wait = body.indexOf("occurrenceWritesSettled(userId)"), read = body.indexOf("const uc = await getUc()");
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThan(read);
  });
});
