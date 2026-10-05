// The in-app Wikipedia import route must put what it imports into the warm
// cache (full_state reads only the cache), as its /api/v1 twin does.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve(__dirname, "../server.js"), "utf8");
const route = src.slice(src.indexOf('app.post("/api/research/wikipedia/import"'), src.indexOf('app.post(\n  "/api/webhooks/:operationId"'));

describe("POST /api/research/wikipedia/import", () => {
  it("is the route (control)", () => {
    expect(route).toMatch(/markdownToModuli\(/);
    expect(route.length).toBeGreaterThan(500);
  });
  it("persists the import into the grid's warm cache before broadcasting", () => {
    const persist = route.indexOf("persistImportResult({ result: importResult, userId, uc: await getUserCache(userId, gridId) })");
    expect(persist).toBeGreaterThan(-1);
    expect(persist).toBeLessThan(route.indexOf('emit("module_created"'));
  });
});
