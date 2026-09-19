// A deleted occurrence's embed must leave the editor showing it — on the
// DELETE EVENT, from every path — or the host editor re-saves the dead node
// (user, 2026-09-19: "embed: 4edd87c8…" left behind after un-picking a mood,
// and re-persisted after the server had scrubbed it).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { embedDeleteRegistry, dropEmbedsOf } from "../helpers/embedRegistry";
import * as CommitHelpers from "../helpers/CommitHelpers";

beforeEach(() => embedDeleteRegistry.clear());

describe("dropEmbedsOf", () => {
  it("runs the node's registered removal", () => {
    const fn = vi.fn();
    embedDeleteRegistry.set("ci", fn);
    expect(dropEmbedsOf("ci")).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("is a no-op for an occurrence nothing embeds", () => {
    expect(dropEmbedsOf("nothing")).toBe(false);
  });
  it("swallows a removal that throws — the node may already be gone", () => {
    embedDeleteRegistry.set("ci", () => { throw new Error("gone"); });
    expect(() => dropEmbedsOf("ci")).not.toThrow();
  });
});

describe("the delete paths drop the embed", () => {
  it("deleteOccurrence of the thing removes its embed", () => {
    const fn = vi.fn();
    embedDeleteRegistry.set("ci", fn);
    CommitHelpers.deleteOccurrence({ dispatch: () => {}, socket: null, occurrenceId: "ci", emit: false, fireTrigger: false });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // THE CONTROL: a placement removal may leave the thing alive, so its embeds
  // elsewhere must stay.
  it("a placement removal (fromParentId) leaves embeds alone", () => {
    const fn = vi.fn();
    embedDeleteRegistry.set("file", fn);
    CommitHelpers.deleteOccurrence({ dispatch: () => {}, socket: null, occurrenceId: "file",
      fromParentId: "page", emit: false, fireTrigger: false });
    expect(fn).not.toHaveBeenCalled();
  });

  it("removeOccurrence removes its embed", () => {
    const fn = vi.fn();
    embedDeleteRegistry.set("ci", fn);
    CommitHelpers.removeOccurrence({ dispatch: () => {}, socket: null, occurrenceId: "ci", emit: false, fireTrigger: false });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("a delete from another tab drops it too", () => {
    const src = readFileSync(resolve(__dirname, "../state/bindSocketToStore.js"), "utf-8");
    const at = src.indexOf("function onOccurrenceDeleted(");
    const body = src.slice(at, src.indexOf("\n  }\n", at));
    expect(body).toContain("dropEmbedsOf(occurrenceId)");
  });
});

describe("the node's removal is safe against a stale registry entry", () => {
  const src = readFileSync(resolve(__dirname, "../docs/ModuleEmbedNode.jsx"), "utf-8");
  it("checks the node at its position is still this occurrence before deleting", () => {
    const body = src.slice(src.indexOf("const onRegistryDelete"), src.indexOf("embedDeleteRegistry.set(occurrenceId"));
    expect(body).toContain("here.attrs?.occurrenceId !== occurrenceId");
    expect(body.indexOf("here.attrs?.occurrenceId !== occurrenceId")).toBeLessThan(body.indexOf("deleteNode?.()"));
  });
});

describe("wiring no test can mount", () => {
  const node = readFileSync(resolve(__dirname, "../docs/ModuleEmbedNode.jsx"), "utf-8");
  const editor = readFileSync(resolve(__dirname, "../ui/Editor.jsx"), "utf-8");
  // A re-created node view registers first and the old one's cleanup runs
  // after — an unconditional delete emptied the registry and the un-pick's
  // delete found nothing (the ghost embed).
  it("a node's cleanup removes only its OWN registration", () => {
    expect(node).toContain("if (embedDeleteRegistry.get(occurrenceId) === onRegistryDelete) embedDeleteRegistry.delete(occurrenceId);");
    expect(node).not.toMatch(/return \(\) => \{ embedDeleteRegistry\.delete\(occurrenceId\); \};/);
  });
  // A full replace re-mounts every node view and threw the page to the top.
  it("an op write tries the node-level diff before a full replace", () => {
    const at = editor.indexOf("const embedPlan = opWrote");
    expect(at).toBeGreaterThan(-1);
    expect(editor.indexOf("applyEmbedDiff(editor, embedPlan)", at)).toBeLessThan(editor.indexOf(".setContent(content, { emitUpdate: false })", at));
  });
});

// ── 2026-09-19 (video): deselecting every mood minted an empty textblock ──
import { isInNonEditableIsland } from "../ui/Editor.jsx";

describe("a delete-driven removal is a sync, not a user edit", () => {
  it("dropEmbedsOf asks for a SILENT removal", () => {
    const fn = vi.fn();
    embedDeleteRegistry.set("ci", fn);
    dropEmbedsOf("ci");
    expect(fn).toHaveBeenCalledWith({ silent: true });
  });
  it("the silent branch is neither an undo step nor an onUpdate (no save)", () => {
    const node = readFileSync(resolve(__dirname, "../docs/ModuleEmbedNode.jsx"), "utf-8");
    const body = node.slice(node.indexOf("if (silent && !member) {"), node.indexOf("if (member) {"));
    expect(body).toContain('tr.setMeta("addToHistory", false)');
    expect(body).toContain('tr.setMeta("preventUpdate", true)');
  });
});

describe("a click inside a node view is not a gesture on the doc's text", () => {
  it("a pointerdown inside a contenteditable=false island does not count", () => {
    document.body.innerHTML = `<div contenteditable="true"><p id="line"></p>
      <div contenteditable="false"><canvas id="wheel"></canvas></div></div>`;
    expect(isInNonEditableIsland(document.getElementById("wheel"))).toBe(true);
    // THE CONTROL: a click on an ordinary line still counts.
    expect(isInNonEditableIsland(document.getElementById("line"))).toBe(false);
  });
});
