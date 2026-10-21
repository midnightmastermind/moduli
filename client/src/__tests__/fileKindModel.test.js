import { describe, it, expect } from "vitest";
import { mimeToKind } from "../helpers/fileKind.js";

describe("client mimeToKind (twin of the server's)", () => {
  it("a .glb / .gltf is a model", () => {
    expect(mimeToKind("application/octet-stream", "Armchair.glb")).toBe("model");
    expect(mimeToKind("model/gltf+json", "x")).toBe("model");
    expect(mimeToKind("", "notes.md")).toBe("markdown");
  });
});
