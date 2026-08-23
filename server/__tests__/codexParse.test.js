// The two things about a codex file the generic markdown importer cannot know:
// which line is metadata, and which blockquotes are machine commentary.
import { describe, it, expect } from "vitest";
import { splitTagLine, annotationLabelOf } from "../utils/codexParse.js";

describe("splitTagLine", () => {
  it("takes the leading hashtag line and hands back the rest", () => {
    const { tags, body } = splitTagLine("#reference #alchemy #daoism\n\nFabrizio Pregadio: teacher\n");
    expect(tags).toEqual(["reference", "alchemy", "daoism"]);
    expect(body.trim()).toBe("Fabrizio Pregadio: teacher");
  });

  it("lowercases and de-duplicates", () => {
    expect(splitTagLine("#Tech #tech #TECH\n\nx").tags).toEqual(["tech"]);
  });

  it("leaves a MARKDOWN HEADING alone — '# GRID' is not a tag line", () => {
    // The discriminator that matters: a tag line is several `#word` tokens with
    // no space after the hash. `# GRID` is an h1 and must survive into the body,
    // or 72 files lose their title.
    const { tags, body } = splitTagLine("# GRID\n\nsome prose");
    expect(tags).toEqual([]);
    expect(body).toContain("# GRID");
  });

  it("takes only the FIRST line, not hashtags further down", () => {
    // Annotations end with hashtags too (measured). Sweeping those into the
    // page's tags would attach an LLM's chosen words to the user's note.
    const { tags } = splitTagLine("#tech\n\nprose\n\n> **[annotation]** ... #adhd #habits");
    expect(tags).toEqual(["tech"]);
  });

  it("returns no tags and an unchanged body when there is no tag line", () => {
    const { tags, body } = splitTagLine("just prose\n");
    expect(tags).toEqual([]);
    expect(body).toBe("just prose\n");
  });
});

describe("annotationLabelOf", () => {
  it("reads the bracketed marker", () => {
    expect(annotationLabelOf("**[annotation]** A quick reference note.")).toBe("annotation");
    expect(annotationLabelOf("**[vision document]** The plan.")).toBe("vision document");
  });

  it("returns null for an ORDINARY quote — 51 of the 460 are not annotations", () => {
    // Marking every blockquote would label the user's own quoted material as
    // machine commentary, which is the opposite of the point.
    expect(annotationLabelOf("The unexamined life is not worth living.")).toBeNull();
    expect(annotationLabelOf("**bold** but not a marker")).toBeNull();
  });

  it("only matches a marker at the START", () => {
    expect(annotationLabelOf("Some prose then **[annotation]** later")).toBeNull();
  });
});
