import { describe, it, expect } from "vitest";
import { fileTitle, parseFileName, volumeOf, planBookLinks, pickKeeper, mergeFields, mergeMeta, norm } from "../migrations/0401-link-drive-books.mjs";

const f = (id, name, size = 1048576) => ({ id, name, size, mimeType: "application/octet-stream" });

describe("0401 parseFileName", () => {
  it("drops the extension, the Kindle key / ASIN suffix and ' - Unknown'", () => {
    expect(fileTitle("A Book_0123456789ABCDEF0123456789ABCDEF.azw")).toBe("A Book");
    expect(fileTitle("Some Title - Unknown.mobi")).toBe("Some Title");
    expect(fileTitle("A Dictionary_B0053VMNY2.azw")).toBe("A Dictionary");
    expect(fileTitle("Guide to X - Unknown.pdf-cdeKey_0123456789ABCDEF0123456789ABCDEF.pdf")).toBe("Guide to X");
  });
  it("reads '_ ' as a colon and splits the author on the LAST ' - '", () => {
    expect(parseFileName("Main_ The Subtitle - Ann Writer.azw")).toEqual({ title: "Main: The Subtitle", author: "Ann Writer" });
    expect(parseFileName("A Guide - Ann Writer & Trend-Pro Co_.pdf")).toEqual({ title: "A Guide", author: "Ann Writer & Trend-Pro Co" });
  });
  it("reads the bracketed and the 'Author - title-Publisher (year)' shapes", () => {
    expect(parseFileName("[(Big Title_ Sub)] [Author_ Ann Writer] Published on (May, 2006)_0123456789ABCDEF0123456789ABCDEF.azw"))
      .toEqual({ title: "Big Title: Sub", author: "Ann Writer" });
    expect(parseFileName("(1st Ed) Writer, Ann_ Other, Bo - the book _ a subtitle-Some Press (2017).pdf"))
      .toEqual({ title: "the book: a subtitle", author: "Writer, Ann & Other, Bo" });
  });
  it("matches a censored title the row spells differently", () => {
    expect(norm(fileTitle("Not Giving a F_ck_ Sub.azw"))).toBe(norm("Not Giving a F**k: Sub"));
  });
  it("finds a volume number", () => {
    expect(volumeOf("Saga (Volume 3)")).toBe(3);
    expect(volumeOf("Saga Vol. 2")).toBe(2);
    expect(volumeOf("Saga")).toBe(null);
  });
});

describe("0401 planBookLinks", () => {
  const rows = [
    { id: "r1", label: "Gardening Basics", sizeMiB: 1 },
    { id: "r2", label: "Deep Work: Rules for Focus", sizeMiB: 2 },
    { id: "r3", label: "Twin Book", sizeMiB: 1 },
    { id: "r4", label: "Twin Book", sizeMiB: 1 },
    { id: "r5", label: "Saga: The Series", sizeMiB: 1 },
  ];
  const plan = planBookLinks({ rows, files: [
    f("a", "Gardening Basics - Ann Writer.azw"),
    f("a2", "Gardening Basics - Ann Writer.pdf"),
    f("b", "Deep Work_ Rules for Focus_0123456789ABCDEF0123456789ABCDEF.azw"),
    f("c", "Twin Book.mobi"),
    f("e", "Saga_ The Series Vol 2.azw"),
    f("d", "Saga_ The Series Vol 1.azw"),
    f("z", "Something Else Entirely - Bo Author.pdf"),
  ] });
  const link = (id) => plan.links.find((l) => l.rowId === id);

  it("attaches every format of one book to its row", () => {
    expect(link("r1").fileIds.sort()).toEqual(["a", "a2"]);
    expect(link("r2").fileIds).toEqual(["b"]);
  });
  it("two rows for one book are merged, not left ambiguous", () => {
    expect(plan.merges).toEqual([{ keepId: "r3", dropIds: ["r4"] }]);
    expect(link("r3").fileIds).toEqual(["c"]);
  });
  it("a second volume gets its own row", () => {
    expect(link("r5")).toMatchObject({ fileIds: ["d"], relabel: "Saga: The Series Vol 1" });
  });
  it("other formats of the same volume stay on one row", () => {
    const p = planBookLinks({ rows: [{ id: "r", label: "Plain Book", sizeMiB: 1 }],
      files: [f("x", "Plain Book.azw"), f("y", "Writer, Ann - Plain Book_ with a subtitle-Press (2015).pdf")] });
    expect(p.links).toEqual([{ rowId: "r", fileIds: ["x", "y"] }]);
    expect(p.clones).toEqual([]);
    expect(plan.clones).toEqual([{ fromRowId: "r5", label: "Saga: The Series Vol 2", fileIds: ["e"] }]);
  });
  it("a file no row matches becomes a new row with its author", () => {
    expect(plan.creates).toEqual([{ label: "Something Else Entirely", author: "Bo Author", fileIds: ["z"] }]);
  });
});

describe("0401 merging", () => {
  const a = { id: "a", fields: { x: { value: "1" }, y: { value: "" } } };
  const b = { id: "b", fields: { x: { value: "2" }, y: { value: "kept" }, z: { value: [1] } } };
  it("keeps the fuller row", () => { expect(pickKeeper([a, b]).id).toBe("b"); });
  it("fills only the keeper's empty fields", () => {
    expect(mergeFields(a, [b])).toEqual({ x: { value: "1" }, y: { value: "kept" }, z: { value: [1] } });
  });
  it("keeps the keeper's meta and borrows only what it lacks", () => {
    expect(mergeMeta({ meta: { cover: "a", mediaAuthor: null } }, [{ meta: { cover: "b", mediaAuthor: "Ann", x: 1 } }]))
      .toEqual({ cover: "a", mediaAuthor: "Ann", x: 1 });
  });
});
