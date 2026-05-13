// server/__tests__/cloneSubtree.test.js
import mongoose from "mongoose";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import { cloneSubtree } from "../utils/cloneSubtree.js";

describe("cloneSubtree", () => {
  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGO_URL || "mongodb://127.0.0.1:27017/moduli-test", {
        serverSelectionTimeoutMS: 1000,
      }).catch(() => {});
    }
  });
  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });
  beforeEach(async () => {
    if (mongoose.connection.readyState !== 1) return;
    await Module.deleteMany({ userId: "u-clone" });
    await Occurrence.deleteMany({ userId: "u-clone" });
  });

  it("clones a 2-level tree, regenerates ids, sets parent + meta patches", async () => {
    if (mongoose.connection.readyState !== 1) return;
    const uc = { modulesById: {}, occurrencesById: {} };
    uc.modulesById["m-p"] = { id: "m-p", userId: "u-clone", role: "container", label: "P", meta: {} };
    uc.modulesById["m-c"] = { id: "m-c", userId: "u-clone", role: "instance", label: "C", meta: {} };
    uc.occurrencesById["o-p"] = {
      id: "o-p", userId: "u-clone", moduleId: "m-p", targetId: "m-p", gridId: "g1",
      occurrences: ["o-c"], meta: {},
    };
    uc.occurrencesById["o-c"] = {
      id: "o-c", userId: "u-clone", moduleId: "m-c", targetId: "m-c", gridId: "g1",
      occurrences: [], meta: {},
    };

    const r = await cloneSubtree({
      rootOccurrenceId: "o-p", userId: "u-clone", gridId: "g1", uc,
      moduleMetaPatch: { templateModule: true },
      occMetaPatch: { templateName: "Test" },
      newParentId: "folder-x",
    });

    expect(r.occurrenceIds).toHaveLength(2);
    expect(r.moduleIds).toHaveLength(2);

    const newRoot = uc.occurrencesById[r.rootClonedOccurrenceId];
    expect(newRoot.parentId).toBe("folder-x");
    expect(newRoot.occurrences).toHaveLength(1);
    expect(newRoot.meta.templateName).toBe("Test");

    const childClone = uc.occurrencesById[newRoot.occurrences[0]];
    expect(childClone.parentId).toBe(r.rootClonedOccurrenceId);
    expect(childClone.meta.templateName).toBeUndefined(); // occMetaPatch is root-only

    // All cloned modules carry the moduleMetaPatch
    expect(uc.modulesById[newRoot.targetId].meta.templateModule).toBe(true);
    expect(uc.modulesById[childClone.targetId].meta.templateModule).toBe(true);
  });

  it("returns null root when the source occurrence is missing", async () => {
    if (mongoose.connection.readyState !== 1) return;
    const uc = { modulesById: {}, occurrencesById: {} };
    const r = await cloneSubtree({
      rootOccurrenceId: "missing", userId: "u-clone", gridId: "g1", uc,
    });
    expect(r.rootClonedOccurrenceId).toBeNull();
    expect(r.occurrenceIds).toHaveLength(0);
    expect(r.moduleIds).toHaveLength(0);
  });
});
