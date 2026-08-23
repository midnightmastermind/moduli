// The Archive mode's decision layer. Every case here is a shape the REAL
// availability API returned when it was measured on 2026-08-23.
import { describe, it, expect } from "vitest";
import { waybackQueryUrl, parseWaybackTimestamp, snapshotFrom, WAYBACK_API } from "../utils/waybackSnapshot.js";

const real = {
  url: "danbrown.com",
  archived_snapshots: {
    closest: { status: "200", available: true, timestamp: "20260817224150",
               url: "http://web.archive.org/web/20260817224150/https://danbrown.com/" },
  },
};

describe("waybackQueryUrl", () => {
  it("encodes the url as a query VALUE", () => {
    const q = waybackQueryUrl("https://a.test/x?y=1&z=2");
    expect(q.startsWith(`${WAYBACK_API}?url=`)).toBe(true);
    // An unencoded & would truncate the url and look up the wrong page.
    expect(q).not.toMatch(/&z=2/);
    expect(q).toContain("%26z%3D2");
  });
  it("survives a missing url rather than sending 'undefined'", () => {
    expect(waybackQueryUrl(undefined)).toBe(`${WAYBACK_API}?url=`);
  });
});

describe("parseWaybackTimestamp", () => {
  it("reads the compact UTC stamp", () => {
    // new Date("20260817224150") is Invalid Date — hence the explicit build.
    expect(parseWaybackTimestamp("20260817224150")).toBe("2026-08-17T22:41:50.000Z");
  });
  it("returns null for a shape it cannot read, instead of Invalid Date", () => {
    expect(parseWaybackTimestamp("2026-08-17")).toBeNull();
    expect(parseWaybackTimestamp("")).toBeNull();
    expect(parseWaybackTimestamp(undefined)).toBeNull();
  });
});

describe("snapshotFrom", () => {
  it("reads a real reply", () => {
    const s = snapshotFrom(real);
    expect(s.ok).toBe(true);
    expect(s.timestamp).toBe("20260817224150");
    expect(s.capturedAt).toBe("2026-08-17T22:41:50.000Z");
  });

  it("UPGRADES the archive host to https", () => {
    // The API hands back http://. The grid is https, so framing that is mixed
    // content: the browser blocks it and the panel goes blank in a way that
    // looks exactly like a site refusing to frame.
    expect(snapshotFrom(real).url).toBe("https://web.archive.org/web/20260817224150/https://danbrown.com/");
  });

  it("does NOT rewrite the original url embedded in the path", () => {
    // Only the archive's own host is upgraded. The captured url lives in the
    // path and names WHICH capture is being requested.
    const httpTarget = { archived_snapshots: { closest: { available: true, timestamp: "20200101000000",
      url: "http://web.archive.org/web/20200101000000/http://example.com/a" } } };
    expect(snapshotFrom(httpTarget).url)
      .toBe("https://web.archive.org/web/20200101000000/http://example.com/a");
  });

  it("treats the EMPTY archived_snapshots object as 'no snapshot', not an error", () => {
    // The real never-archived reply: a 200 whose body is {"archived_snapshots":{}}.
    const s = snapshotFrom({ url: "nope.example", archived_snapshots: {} });
    expect(s.ok).toBe(false);
    expect(s.reason).toMatch(/no snapshot/i);
  });

  it("handles a missing body without throwing", () => {
    expect(snapshotFrom(null).ok).toBe(false);
    expect(snapshotFrom({}).ok).toBe(false);
  });

  it("declines a snapshot the archive says is unavailable", () => {
    const s = snapshotFrom({ archived_snapshots: { closest: { available: false, url: "http://web.archive.org/x" } } });
    expect(s.ok).toBe(false);
  });

  it("keeps a non-200 capture — an archived error page is still the archive's answer", () => {
    // Filtering these would drop real captures; the honest thing is to show
    // what was captured and report its status.
    const s = snapshotFrom({ archived_snapshots: { closest: { available: true, status: "301",
      timestamp: "20260817224150", url: "http://web.archive.org/web/20260817224150/https://a.test/" } } });
    expect(s.ok).toBe(true);
    expect(s.status).toBe("301");
  });
});
