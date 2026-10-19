/**
 * noSonnerImport.test.js — nothing mounts sonner's <Toaster>, so a toast from "sonner" renders
 * NOWHERE. Eight files imported it (2026-10-19 sweep: Define showed nothing; a failed upload, a
 * paste error, "Open in panel" errors were silent too). The app's messages go through
 * state/notificationStore, which exports a sonner-compatible `toast`.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === "__tests__" || e.name === "node_modules") continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (/\.(js|jsx)$/.test(e.name)) files.push(p);
  }
})(root);

describe("toasts reach the screen", () => {
  it("walks real source (control)", () => {
    expect(files.length).toBeGreaterThan(200);
    expect(files.some((f) => /from ["'][./]+state\/notificationStore["']/.test(fs.readFileSync(f, "utf8")))).toBe(true);
  });
  it("no source file imports from sonner", () => {
    const bad = files.filter((f) => /^\s*import\b[^;]*?from\s+["']sonner["']/m.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(root, f));
    expect(bad).toEqual([]);
  });
});
