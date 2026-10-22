import { describe, it, expect } from "vitest";
import { fileHomeOccId, isUploadedFile } from "../helpers/fileHome.js";

const folders = { "files-video": { id: "files-video" } };
const mod = { id: "m", role: "artifact", kind: "video", fileRef: "gdrive:c:x" };
const home = { id: "home", moduleId: "m", parentId: "files-video" };
const copy = { id: "copy", moduleId: "m", parentId: "doc-1" };

describe("fileHomeOccId", () => {
  it("a copy points at the occurrence filed in a Files folder", () => {
    expect(fileHomeOccId(copy, mod, [home, copy], folders)).toBe("home");
  });
  // The home's own card is drawn on a board/doc too (a dropped file is listed there and homed in Files);
  // a file card is never drawn on a folder page, so it always gets the button.
  it("the home's own card points at itself", () => {
    expect(fileHomeOccId(home, mod, [home, copy], folders)).toBe("home");
  });
  it("no filed placement → null", () => {
    expect(fileHomeOccId(copy, mod, [copy], folders)).toBe(null);
  });
  // Controls: only uploads have a home. An external picture (Wikipedia) and a shared type module (993 movies
  // on one "Movie" module) are never looked up — the second is what keeps this off the Movies board.
  it("external urls and non-file kinds are not uploads", () => {
    expect(isUploadedFile({ role: "artifact", kind: "image", fileRef: "https://upload.wikimedia.org/x.jpg" })).toBe(false);
    expect(isUploadedFile({ role: "artifact", kind: "movie", fileRef: "x" })).toBe(false);
    expect(fileHomeOccId(copy, { ...mod, kind: "movie" }, [home, copy], folders)).toBe(null);
  });
});
