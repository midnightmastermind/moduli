// Calendar subscriptions (2026-10-12): a feed's events run through the share rules, an event that
// leaves the feed is KEPT and marked Cancelled, and one that comes back is un-marked.
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = { grids: [], occs: [], mods: [], fields: [] };
const lean = (v) => ({ lean: async () => structuredClone(v ?? null) });
const match = (doc, q) => Object.entries(q).every(([k, v]) => {
  if (k === "_id") return String(doc._id) === String(v);
  if (k === "feeds.id") return (doc.feeds || []).some((f) => f.id === v);
  if (k === "meta.externalId") return new RegExp(v.$regex).test(doc.meta?.externalId || "");
  if (k === "id" && v?.$in) return v.$in.includes(doc.id);
  return doc[k] === v;
});
vi.mock("../models/Grid.js", () => ({ default: {
  findOne: (q) => lean(db.grids.find((g) => match(g, q))),
  findOneAndUpdate: (q, u) => {
    const g = db.grids.find((x) => match(x, q)); if (!g) return lean(null);
    const f = g.feeds.find((x) => x.id === q["feeds.id"]);
    for (const [k, v] of Object.entries(u.$set)) f[k.replace("feeds.$.", "")] = v;
    return lean(g);
  },
}}));
vi.mock("../models/Occurrence.js", () => ({ default: {
  find: (q) => lean(db.occs.filter((o) => match(o, q))),
  findOneAndUpdate: (q, u) => {
    const o = db.occs.find((x) => x.id === q.id);
    for (const [k, v] of Object.entries(u.$set)) { const fid = k.split(".")[1]; o.fields = { ...o.fields, [fid]: v }; }
    return lean(o);
  },
}}));
vi.mock("../models/Module.js", () => ({ default: {
  findOne: (q) => lean(db.mods.find((m) => m.id === q.id)),
  findOneAndUpdate: (q, u) => { const m = db.mods.find((x) => x.id === q.id); m.fieldBindings.push(u.$push.fieldBindings); return lean(m); },
}}));
vi.mock("../models/Field.js", () => ({ default: {
  findOne: (q) => lean(db.fields.find((f) => f.name === q.name && f.type === q.type)),
  create: async (doc) => { db.fields.push(doc); return { toObject: () => doc }; },
}}));

const { syncFeed, planFeedChanges, isFeedDue, newFeed, parseNewsFeed, FIRST_FETCH_ITEMS } = await import("../services/feeds.js");

const ics = (uids) => ["BEGIN:VCALENDAR", "VERSION:2.0", ...uids.flatMap((u) => [
  "BEGIN:VEVENT", `UID:${u}`, `SUMMARY:Event ${u}`, "DTSTART:20991015T150000", "DTEND:20991015T160000", "END:VEVENT"]), "END:VCALENDAR"].join("\r\n");

function deps(text) {
  return {
    now: new Date(2099, 9, 1),   // the fixture's events are on 2099-10-15, inside a 60-day window from here
    fetchText: async () => text,
    // stands in for the calendar rule: one row per event, keyed ics:<UID>::<step>
    runRules: async ({ share }) => {
      for (const e of share.events) {
        if (!db.occs.some((o) => o.meta.externalId === `ics:${e.uid}::mk`)) {
          db.mods.push({ id: `m-${e.uid}`, fieldBindings: [] });
          db.occs.push({ id: `o-${e.uid}`, userId: "u1", gridId: "g1", moduleId: `m-${e.uid}`, fields: {}, meta: { externalId: `ics:${e.uid}::mk` } });
        }
      }
      return { ran: [{ ok: true }] };
    },
  };
}
const cancelled = (uid) => {
  const f = db.fields.find((x) => x.name === "Cancelled");
  return !!(f && db.occs.find((o) => o.id === `o-${uid}`).fields[f.id]?.value);
};

beforeEach(() => {
  db.occs = []; db.mods = []; db.fields = [];
  db.grids = [{ _id: "g1", userId: "u1", feeds: [{ ...newFeed({ url: "webcal://cal.example.com/me.ics" }), id: "f1" }] }];
});

describe("calendar feeds", () => {
  it("a new feed is due at once; one just fetched is not", () => {
    expect(isFeedDue({ enabled: true, lastFetchedAt: null })).toBe(true);
    expect(isFeedDue({ enabled: true, everyMinutes: 60, lastFetchedAt: new Date().toISOString() })).toBe(false);
    expect(isFeedDue({ enabled: false })).toBe(false);
  });

  it("an event that leaves the feed is cancelled, never removed; one that returns is restored", async () => {
    await syncFeed({ userId: "u1", gridId: "g1", feedId: "f1", deps: deps(ics(["a", "b"])) });
    expect(db.occs).toHaveLength(2);
    expect(cancelled("a") || cancelled("b")).toBe(false);

    const feed = await syncFeed({ userId: "u1", gridId: "g1", feedId: "f1", deps: deps(ics(["a"])) });
    expect(db.occs).toHaveLength(2);           // kept
    expect(cancelled("b")).toBe(true);
    expect(cancelled("a")).toBe(false);
    expect(feed.lastCancelled).toBe(1);
    expect(db.mods.find((m) => m.id === "m-b").fieldBindings).toHaveLength(1);   // shown on the row

    await syncFeed({ userId: "u1", gridId: "g1", feedId: "f1", deps: deps(ics(["a", "b"])) });
    expect(cancelled("b")).toBe(false);
  });

  it("a link that is not a calendar is reported, and nothing is cancelled", async () => {
    await syncFeed({ userId: "u1", gridId: "g1", feedId: "f1", deps: deps(ics(["a"])) });
    const feed = await syncFeed({ userId: "u1", gridId: "g1", feedId: "f1", deps: deps("<html>login</html>") });
    expect(feed.lastStatus).toBe("failed");
    expect(cancelled("a")).toBe(false);
  });

  it("a weekly event becomes one row per week inside the window", async () => {
    const text = ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:wk", "SUMMARY:Standup",
      "DTSTART:20261013T090000", "DTEND:20261013T093000", "RRULE:FREQ=WEEKLY;COUNT=20", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    const d = { ...deps(text), now: new Date(2026, 9, 12) };
    await syncFeed({ userId: "u1", gridId: "g1", feedId: "f1", deps: d });
    expect(db.occs.map((o) => o.meta.externalId).sort()).toEqual(
      ["2026-10-13", "2026-10-20", "2026-10-27", "2026-11-03", "2026-11-10", "2026-11-17", "2026-11-24", "2026-12-01", "2026-12-08"].map((x) => `ics:wk@${x}::mk`));
  });

  it("a one-off event outside the window is not brought in (a holidays calendar holds years)", async () => {
    const ev = (u, d) => ["BEGIN:VEVENT", `UID:${u}`, `SUMMARY:${u}`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${d}`, "END:VEVENT"];
    const text = ["BEGIN:VCALENDAR", "VERSION:2.0", ...ev("past", "20211225"), ...ev("soon", "20261111"),
      ...ev("far", "20271225"), "END:VCALENDAR"].join("\r\n");
    await syncFeed({ userId: "u1", gridId: "g1", feedId: "f1", deps: { ...deps(text), now: new Date(2026, 9, 13) } });
    expect(db.occs.map((o) => o.meta.externalId)).toEqual(["ics:soon::mk"]);
  });

  it("a row for an event beyond the window's end is not cancelled when it is left out", () => {
    const prev = { far: { ids: ["9"], date: "2027-12-25" } };
    expect(planFeedChanges(prev, {}, { today: "2026-10-13", until: "2026-12-12" }).cancel).toEqual([]);
    expect(planFeedChanges(prev, {}, { today: "2026-10-13" }).cancel).toEqual(["9"]);   // control
  });

  it("a feed's destination rides on the share, so a rule can file its events there", async () => {
    db.grids[0].feeds[0].destinationId = "ctr-holidays";
    let seen = null;
    const d = { ...deps(ics(["a"])), runRules: async ({ share }) => { seen = share.props; return { ran: [{ ok: true }] }; } };
    await syncFeed({ userId: "u1", gridId: "g1", feedId: "f1", deps: d });
    expect(seen.destinationId).toBe("ctr-holidays");
    db.grids[0].feeds[0].destinationId = null;
    await syncFeed({ userId: "u1", gridId: "g1", feedId: "f1", deps: d });
    expect(seen.destinationId ?? null).toBe(null);   // control: no destination named, none passed
  });

  it("an RSS feed shares each NEW item as a link, once; the first check takes only the newest few", async () => {
    const rss = (n) => `<?xml version="1.0"?><rss version="2.0"><channel><title>A Blog</title>${
      Array.from({ length: n }, (_, k) => `<item><title>Post ${k}</title><link>https://blog.example.com/${k}</link><guid>p${k}</guid></item>`).join("")}</channel></rss>`;
    const shared = [];
    const d = (text) => ({
      fetchText: async () => text,
      prepareLink: async ({ url, title }) => ({ type: "link", props: { url, title }, externalId: `link:${url}` }),
      runRules: async ({ share }) => { shared.push(share.props.url); return { ran: [{ ok: true, created: [{ occurrenceId: `o:${share.props.url}` }] }] }; },
    });
    db.grids[0].feeds[0].nameIsDefault = true;
    let feed = await syncFeed({ userId: "u1", gridId: "g1", feedId: "f1", deps: d(rss(FIRST_FETCH_ITEMS + 5)) });
    expect(shared).toHaveLength(FIRST_FETCH_ITEMS);
    expect(feed.kind).toBe("news");
    expect(feed.name).toBe("A Blog");
    // the next check: nothing new -> nothing shared (the skipped older items are remembered too)
    feed = await syncFeed({ userId: "u1", gridId: "g1", feedId: "f1", deps: d(rss(FIRST_FETCH_ITEMS + 5)) });
    expect(shared).toHaveLength(FIRST_FETCH_ITEMS);
    // a new post appears at the top
    const withNew = rss(FIRST_FETCH_ITEMS + 5).replace("<item>", `<item><title>New</title><link>https://blog.example.com/new</link><guid>pnew</guid></item><item>`);
    await syncFeed({ userId: "u1", gridId: "g1", feedId: "f1", deps: d(withNew) });
    expect(shared.at(-1)).toBe("https://blog.example.com/new");
    expect(shared).toHaveLength(FIRST_FETCH_ITEMS + 1);
  });

  it("parseNewsFeed reads Atom too", () => {
    const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Chan</title><entry><id>yt:1</id><title>Vid</title><link rel="alternate" href="https://www.youtube.com/watch?v=1"/></entry></feed>`;
    expect(parseNewsFeed(atom)).toEqual({ title: "Chan", items: [{ id: "yt:1", url: "https://www.youtube.com/watch?v=1", title: "Vid", publishedAt: null }] });
  });

  it("planFeedChanges cancels only uids that were seen and are now gone", () => {
    expect(planFeedChanges({ a: { ids: ["1"] }, b: { ids: ["2"] } }, { a: { ids: ["1"] } })).toEqual({ cancel: ["2"], active: ["1"] });
    // a repeat that fell off the back of the window is not cancelled
    expect(planFeedChanges({ b: { ids: ["2"], date: "2026-10-01" } }, {}, { today: "2026-10-12" }).cancel).toEqual([]);
  });

  it("newFeed refuses a link that is not http(s) or webcal", () => {
    expect(() => newFeed({ url: "ftp://x" })).toThrow();
  });
});
