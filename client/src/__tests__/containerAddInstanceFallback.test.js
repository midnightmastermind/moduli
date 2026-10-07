// A container rendered by a doc's embed node (a Kanban column inside a board that
// is embedded in a doc page) received no `addInstanceToContainer` prop, so its own
// "+ › Item" threw `i is not a function` and added nothing (2026-10-07). The
// 2026-08-18 fix wired the prop at ONE more call site; the default now lives in
// the callee: App already publishes the function on the actions context.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.join(__dirname, "../modules/ModuleContainer.jsx"), "utf8");
const app = fs.readFileSync(path.join(__dirname, "../App.jsx"), "utf8");

describe("ModuleContainer always has an addInstanceToContainer", () => {
  it("control: App publishes it on the actions context", () => {
    expect(app).toMatch(/addInstanceToContainer,/);
  });
  it("falls back to the context's when no parent passes the prop", () => {
    const i = src.indexOf("function Container({");
    expect(i).toBeGreaterThan(0);
    const head = src.slice(i, i + 4000);
    expect(head).toMatch(/addInstanceToContainer: addInstanceToContainerProp/);
    expect(head).toMatch(/useGridActionsSelector\(\(?s\)? => s\.addInstanceToContainer\)/);
    expect(head).toMatch(/const addInstanceToContainer = addInstanceToContainerProp \|\| /);
  });
});
