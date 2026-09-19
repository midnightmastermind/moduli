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
