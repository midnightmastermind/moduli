// UI sweep 2026-10-19: "make sure the artifact viewer is a solid black background in the terminal
// skin and make sure the css for that is editable by the user".
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { tokenOverrideCss, applyTokenOverrides } from "../helpers/tokenOverrides";

const css = fs.readFileSync(path.resolve(__dirname, "../index.css"), "utf8");
const tab = fs.readFileSync(path.resolve(__dirname, "../ui/commandCenter/AppearanceTab.jsx"), "utf8");
const block = (sel) => { const i = css.indexOf(`${sel} {`); return css.slice(i, css.indexOf("\n}", i)); };

describe("artifact viewer surfaces are tokens", () => {
  it("the viewer, its tiles and the full-screen card read them", () => {
    expect(block(".artifact-spread")).toMatch(/background: var\(--viewer-bg\);/);
    expect(block(".artifact-spread-body .instance-wrap > .instance-row")).toMatch(/background: var\(--viewer-tile-bg\) !important;/);
    expect(block(".artifact-fullscreen")).toMatch(/background: var\(--viewer-fullscreen-bg\);/);
  });
  it("the Terminal skin makes all three solid black", () => {
    const t = block(':root[data-skin="terminal"]');
    for (const k of ["--viewer-bg", "--viewer-tile-bg", "--viewer-fullscreen-bg"]) expect(t).toMatch(new RegExp(`${k}: #000;`));
  });
  it("the user can set them in Appearance › Token overrides", () => {
    for (const k of ["--viewer-bg", "--viewer-tile-bg", "--viewer-fullscreen-bg"]) expect(tab).toContain(`name: "${k}"`);
  });
});

describe("token overrides", () => {
  it("are written !important, so they beat a skin's own value", () => {
    expect(tokenOverrideCss({ "--viewer-bg": " #123 ", "--empty": "  " })).toBe(":root { --viewer-bg: #123 !important; }");
    expect(tokenOverrideCss({})).toBe("");
  });
  it("one writer: applying replaces, applying nothing clears", () => {
    applyTokenOverrides({ "--viewer-bg": "red" });
    expect(document.getElementById("moduli-token-overrides").textContent).toContain("--viewer-bg: red !important");
    applyTokenOverrides({});
    expect(document.getElementById("moduli-token-overrides").textContent).toBe("");
  });
});
