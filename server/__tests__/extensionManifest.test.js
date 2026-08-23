// The manifest and the code have to agree, and NOTHING ELSE HERE CAN CHECK IT.
//
// An MV3 extension will not load in this environment, so the ordinary way to
// find "declared a menu without the contextMenus permission" or "pointed at a
// background file that does not exist" is to install it and watch it do
// nothing. These assertions are the substitute.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CLIP_MENUS } from "../../extension/clip.js";

const DIR = path.join(import.meta.dirname, "..", "..", "extension");
const read = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
const chrome = read("manifest.json");
const firefox = read("manifest.firefox.json");

describe.each([["chrome", chrome], ["firefox", firefox]])("%s manifest", (_name, m) => {
  it("asks for every permission the code uses", () => {
    // background.js calls contextMenus, storage and notifications. A missing
    // one throws inside a service worker, where nobody sees it.
    for (const p of ["contextMenus", "storage", "notifications", "declarativeNetRequest"]) {
      expect(m.permissions).toContain(p);
    }
  });

  it("points at background and options files that EXIST", () => {
    const bg = m.background.service_worker || m.background.scripts?.[0];
    expect(bg).toBeTruthy();
    expect(fs.existsSync(path.join(DIR, bg))).toBe(true);
    expect(fs.existsSync(path.join(DIR, m.options_ui.page))).toBe(true);
  });

  it("declares the background as a MODULE, because background.js imports", () => {
    // `background.js` uses `import` — without `type: "module"` the worker fails
    // to parse and every menu silently never registers.
    expect(m.background.type).toBe("module");
  });

  it("still carries the framing rules — clip must not have displaced them", () => {
    expect(m.declarative_net_request.rule_resources[0].path).toBe("rules.json");
    expect(fs.existsSync(path.join(DIR, "rules.json"))).toBe(true);
  });
});

describe("the two manifests stay in step", () => {
  it("agree on permissions and version", () => {
    // They drift the moment one is edited alone, and the Firefox build is the
    // one nobody remembers to check.
    expect([...firefox.permissions].sort()).toEqual([...chrome.permissions].sort());
    expect(firefox.version).toBe(chrome.version);
    expect(firefox.options_ui.page).toBe(chrome.options_ui.page);
  });
});

describe("the menu the code registers", () => {
  it("uses only contexts the browser actually defines", () => {
    const VALID = ["selection", "link", "image", "page", "video", "audio", "editable", "frame"];
    for (const m of CLIP_MENUS) for (const c of m.contexts) expect(VALID).toContain(c);
  });

  it("gives every item a distinct id and a title", () => {
    // `contextMenus.create` throws on a duplicate id, which kills registration
    // for every item after it.
    expect(new Set(CLIP_MENUS.map(m => m.id)).size).toBe(CLIP_MENUS.length);
    for (const m of CLIP_MENUS) expect(m.title.length).toBeGreaterThan(0);
  });

  it("every background.js import resolves to a real file", () => {
    const src = fs.readFileSync(path.join(DIR, "background.js"), "utf8");
    const imports = [...src.matchAll(/from\s+"\.\/([^"]+)"/g)].map(m => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const f of imports) expect(fs.existsSync(path.join(DIR, f))).toBe(true);
  });
});
