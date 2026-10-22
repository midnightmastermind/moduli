// Every artifactType the upload path writes must be one the View schema accepts.
// 2026-10-22: viewFieldsForKind returned "ebook" (since 0406, 2026-10-16) while View.artifactType's enum
// listed only image/pdf/audio/video, so every e-book upload failed with a 500 at the View save.
import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import View from "../models/View.js";
import { viewFieldsForKind } from "../utils/uploadKinds.js";

const KINDS = ["image", "video", "audio", "pdf", "ebook", "model", "code", "markdown"];

describe("View.artifactType accepts every kind an upload produces", () => {
  for (const kind of KINDS) {
    it(kind, () => {
      const { viewType, artifactType } = viewFieldsForKind(kind);
      const v = new View({ id: "v1", userId: new mongoose.Types.ObjectId(), gridId: "g", viewType, artifactType });
      const err = v.validateSync();
      expect(err?.errors?.artifactType).toBeUndefined();
      expect(err?.errors?.viewType).toBeUndefined();
    });
  }
});
