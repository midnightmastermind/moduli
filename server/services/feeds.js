// server/services/feeds.js
//
// FEED SUBSCRIPTIONS (user, 2026-10-12): "lets work on the subscription thing", "it should be any kind of
// feed". Two kinds, told apart by what the link RETURNS, never by its address:
//   calendar  — .ics / webcal (below).
//   news      — RSS / Atom (blogs, podcasts, YouTube channels, subreddits). Each NEW item is shared as a
//               link, exactly as if the user had shared it, so `Share: link` files it (a bookmark) and a
//               later manual share of the same link dedups against it. Items falling off a news feed is
//               normal (it lists the latest N), so nothing is ever cancelled there.
//
// CALENDAR: a calendar URL
// (Google / Outlook / iCloud private .ics, or webcal://) is fetched on a timer and its events go
// through the SAME rule a shared .ics file does (`Share: calendar (.ics)`), so a feed and a share
// land the same rows and a re-fetch updates them in place (identity `ics:<UID>`).
//
// An event that LEAVES the feed is kept and marked cancelled (user, 17:36: "keep it and mark it
// cancled") through a boolean field named Cancelled — visible on the row, so it is not a hidden
// setting. An event that comes back is un-cancelled.
//
// Feeds live on the grid as a TOP-LEVEL array (`grid.feeds`), not in `meta`: tabs write
// `meta` back whole and would clobber what the timer writes (the shareLog reason).

import crypto from "node:crypto";
import Grid from "../models/Grid.js";
import Occurrence from "../models/Occurrence.js";
import Module from "../models/Module.js";
import Field from "../models/Field.js";
import * as cheerio from "cheerio";
import { icsEvents, calendarFetchUrl } from "./shareIngress.js";

export const FEED_INTERVALS = [15, 30, 60, 180, 360, 1440]; // minutes
export const DEFAULT_EVERY = 60;
const CANCELLED_FIELD = "Cancelled";

/** PURE. Normalise what a client sends into a stored feed. */
export function newFeed({ url, name, everyMinutes } = {}) {
  const u = String(url || "").trim();
  if (!/^(https?|webcals?):\/\//i.test(u)) throw Object.assign(new Error("a feed link starts with https:// or webcal://"), { status: 400 });
  return {
    id: crypto.randomUUID(),
    url: u,
    name: String(name || "").trim() || hostOf(u),
    nameIsDefault: !String(name || "").trim(),   // a news feed renames itself to its own title
    everyMinutes: FEED_INTERVALS.includes(Number(everyMinutes)) ? Number(everyMinutes) : DEFAULT_EVERY,
    enabled: true,
    kind: null,           // "calendar" | "news" — set by the first fetch
    items: {},            // uid / item id -> { ids: [occurrenceId], date }
    destinationId: null,  // a container its events file into (a share rule reads $share.props.destinationId)
    lastFetchedAt: null, lastStatus: null, lastError: null, lastEventCount: 0, lastCancelled: 0,
  };
}
const hostOf = (u) => { try { return new URL(calendarFetchUrl(u)).hostname.replace(/^www\./, ""); } catch { return "Feed"; } };

/** PURE. Is this feed due a fetch? A feed never fetched is due at once. */
export function isFeedDue(feed, now = new Date()) {
  if (!feed?.enabled) return false;
  if (!feed.lastFetchedAt) return true;
  return now.getTime() - new Date(feed.lastFetchedAt).getTime() >= (Number(feed.everyMinutes) || DEFAULT_EVERY) * 60_000;
}

/**
 * PURE. Given what the feed held last time and what it holds now (uid -> occurrence ids), which rows
 * become cancelled and which come back. A uid seen before and missing now is cancelled; a uid present
 * now is (re)active. Rows are never removed.
 */
export function planFeedChanges(prevItems = {}, nowItems = {}, { today = null, until = null } = {}) {
  const cancel = [], active = [];
  for (const [uid, it] of Object.entries(prevItems || {})) {
    if (uid in nowItems) continue;
    // A repeat that fell off the BACK of the window is history, not a cancellation; one past its
    // END is not due yet (the window only ever reads ahead FEED_WINDOW_DAYS).
    if (today && it?.date && it.date < today) continue;
    if (until && it?.date && it.date >= until) continue;
    cancel.push(...(it?.ids || []));
  }
  for (const it of Object.values(nowItems || {})) active.push(...(it?.ids || []));
  return { cancel: [...new Set(cancel)], active: [...new Set(active)] };
}

/** The window a subscription expands repeating events over. */
export const FEED_WINDOW_DAYS = 60;
export function feedWindow(now = new Date()) {
  const from = new Date(now); from.setHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + FEED_WINDOW_DAYS * 86_400_000);
  return { from, to };
}
const localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The rows a share rule minted for these uids: their externalId is `ics:<UID>` or `ics:<UID>::<step>`. */
async function rowsForEvents({ userId, gridId, events }) {
  const out = {};
  for (const e of events) {
    if (!e.uid) continue;
    const rows = await Occurrence.find({ userId, gridId, "meta.externalId": { $regex: `^ics:${escapeRe(e.uid)}(::|$)` } }, { id: 1 }).lean();
    if (rows.length) out[e.uid] = { ids: rows.map((r) => r.id), date: e.start?.date || null };
  }
  return out;
}

/** Find (or make) the boolean Cancelled field. */
async function cancelledField({ userId, gridId, mirror, io, userRoom }) {
  const found = await Field.findOne({ gridId, name: CANCELLED_FIELD, type: "boolean" }).lean();
  if (found) return found;
  const doc = (await Field.create({ id: crypto.randomUUID(), userId, gridId, name: CANCELLED_FIELD, type: "boolean", inputEnabled: true })).toObject();
  mirror?.("field", doc);
  io?.to(userRoom(userId)).emit("field_created", { field: doc });
  return doc;
}

/** Set Cancelled = value on each row, binding the field on its module when it is not bound yet. */
export async function setCancelled({ userId, gridId, occurrenceIds, value, deps = {} }) {
  if (!occurrenceIds.length) return 0;
  const { mirror = null, io = null, userRoom = null } = deps;
  // Restoring needs no field: if none exists, nothing was ever marked.
  const field = value
    ? await cancelledField({ userId, gridId, mirror, io, userRoom })
    : await Field.findOne({ gridId, name: CANCELLED_FIELD, type: "boolean" }).lean();
  if (!field) return 0;
  const rows = await Occurrence.find({ userId, gridId, id: { $in: occurrenceIds } }).lean();
  let n = 0;
  for (const r of rows) {
    const cur = !!r.fields?.[field.id]?.value;
    if (cur === value) continue;
    if (!value && !(field.id in (r.fields || {}))) continue;
    const mod = r.moduleId ? await Module.findOne({ id: r.moduleId }).lean() : null;
    if (mod && !(mod.fieldBindings || []).some((b) => b.fieldId === field.id)) {
      const order = (mod.fieldBindings || []).length;
      const updated = await Module.findOneAndUpdate({ id: mod.id },
        { $push: { fieldBindings: { fieldId: field.id, order, role: "input" } } }, { returnDocument: "after" }).lean();
      mirror?.("module", updated);
      io?.to(userRoom(userId)).emit("module_updated", { module: updated });
    }
    const occ = await Occurrence.findOneAndUpdate({ id: r.id },
      { $set: { [`fields.${field.id}`]: { value, flow: "replace" } } }, { returnDocument: "after" }).lean();
    mirror?.("occurrence", occ);
    io?.to(userRoom(userId)).emit("occurrence_updated", { occurrence: occ });
    n++;
  }
  return n;
}

/** A NEWS feed's first fetch takes at most this many items (newest first); every later fetch takes all new ones. */
export const FIRST_FETCH_ITEMS = 25;
const ITEMS_KEPT = 1000;

/** PURE. Is this text an RSS / Atom / RDF feed? */
export const isNewsFeed = (text) => typeof text === "string" && /<(rss|feed|rdf:RDF)[\s>]/i.test(text.slice(0, 4000));

/** PURE. The items of an RSS / Atom feed, newest first as the feed lists them. */
export function parseNewsFeed(xml) {
  const $ = cheerio.load(String(xml || ""), { xmlMode: true });
  const title = $("channel > title").first().text().trim() || $("feed > title").first().text().trim() || null;
  const items = [];
  $("item, entry").each((_, el) => {
    const it = $(el);
    const link = it.find("link[rel='alternate']").attr("href") || it.find("link").attr("href")
      || it.find("link").first().text().trim() || it.find("enclosure").attr("url") || null;
    const id = it.find("guid").first().text().trim() || it.find("id").first().text().trim() || link;
    if (!id || !link) return;
    items.push({
      id, url: link,
      title: it.find("title").first().text().trim() || null,
      publishedAt: it.find("pubDate, published, updated").first().text().trim() || null,
    });
  });
  return { title, items };
}

async function syncNews({ feed, text, at, deps }) {
  const { title, items } = parseNewsFeed(text);
  const seen = feed.items || {};
  const fresh = items.filter((i) => !(i.id in seen));
  const take = Object.keys(seen).length ? fresh : fresh.slice(0, FIRST_FETCH_ITEMS);
  const next = { ...seen };
  // The first check's older items are remembered as seen, or the NEXT check would import them all.
  for (const i of fresh) if (!take.includes(i)) next[i.id] = { ids: [], date: at.slice(0, 10), skipped: true };
  const errors = [];
  let created = 0;
  // Oldest first, so a board that lists newest-last reads in the feed's order.
  for (const i of [...take].reverse()) {
    try {
      const share = await deps.prepareLink({ url: i.url, title: i.title });
      const result = await deps.runRules({ share });
      const ids = (result?.ran || []).flatMap((r) => (r.created || []).map((c) => c.occurrenceId)).filter(Boolean);
      for (const r of result?.ran || []) if (!r.ok) errors.push(`${r.ruleName}: ${r.error}`);
      created += ids.length;
      next[i.id] = { ids, date: at.slice(0, 10) };
    } catch (e) { errors.push(String(e?.message || e)); }
  }
  // An item seen once is never re-imported, even after it falls off the feed; the memory is bounded.
  const keys = Object.keys(next);
  const items2 = keys.length > ITEMS_KEPT ? Object.fromEntries(keys.slice(-ITEMS_KEPT).map((k) => [k, next[k]])) : next;
  return {
    kind: "news", items: items2, lastFetchedAt: at, lastEventCount: items.length, lastCancelled: 0, lastNew: created,
    ...(feed.nameIsDefault && title ? { name: title, nameIsDefault: false } : {}),
    lastStatus: errors.length && !created && take.length ? "failed" : "ok",
    lastError: errors.length ? [...new Set(errors)].slice(0, 3).join("; ") : (take.length < fresh.length ? `first check: took the newest ${take.length} of ${fresh.length}` : null),
  };
}

/**
 * Fetch one feed and run its events through the share rules. Never throws: the outcome is written
 * onto the feed (lastStatus / lastError) so the Imports tab can say what happened.
 *
 * deps: { fetchText(url) -> string|null, runRules({share}) -> result, mirror, io, userRoom,
 *         timeZone, resolveSlotLabels }
 */
export async function syncFeed({ userId, gridId, feedId, deps }) {
  const grid = await Grid.findOne({ _id: gridId, userId }, { feeds: 1 }).lean();
  const feed = (grid?.feeds || []).find((f) => f.id === feedId);
  if (!feed) return null;
  const at = new Date().toISOString();
  let patch;
  try {
    const text = await deps.fetchText(calendarFetchUrl(feed.url));
    if (isNewsFeed(text)) {
      patch = await syncNews({ feed, text, at, deps });
      return await saveFeedPatch({ userId, gridId, feedId, patch, deps });
    }
    if (typeof text !== "string" || !/BEGIN:VCALENDAR/i.test(text)) throw new Error("that link did not return a calendar or an RSS / Atom feed");
    const window = feedWindow(deps.now || new Date());
    const cal = await icsEvents(text, { timeZone: deps.timeZone || null, resolveSlotLabels: deps.resolveSlotLabels || null, expand: window });
    const share = {
      type: "ics", source: "feed", props: { url: feed.url, feedId: feed.id, destinationId: feed.destinationId || null },
      events: cal.events, notices: cal.notices, label: feed.name,
      externalId: `feed:${feed.id}`, receivedAt: at,
    };
    const result = await deps.runRules({ share });
    const failed = (result?.ran || []).filter((r) => !r.ok);
    const nowItems = await rowsForEvents({ userId, gridId, events: cal.events });
    const { cancel, active } = planFeedChanges(feed.items || {}, nowItems, { today: localDay(window.from), until: localDay(window.to) });
    // A uid that was cancelled and is gone for good stays in `items`, so it keeps its mark next time.
    const items = { ...Object.fromEntries(Object.entries(feed.items || {}).filter(([u]) => !(u in nowItems))), ...nowItems };
    const cancelled = await setCancelled({ userId, gridId, occurrenceIds: cancel, value: true, deps });
    await setCancelled({ userId, gridId, occurrenceIds: active, value: false, deps });
    patch = {
      kind: "calendar", items, lastFetchedAt: at, lastEventCount: cal.events.length, lastCancelled: cancelled,
      lastStatus: failed.length && !Object.keys(nowItems).length ? "failed" : "ok",
      lastError: failed.length ? failed.map((r) => `${r.ruleName}: ${r.error}`).join("; ") : (cal.notices || []).join("; ") || null,
    };
  } catch (e) {
    patch = { lastFetchedAt: at, lastStatus: "failed", lastError: String(e?.message || e).slice(0, 300) };
  }
  return saveFeedPatch({ userId, gridId, feedId, patch, deps });
}

async function saveFeedPatch({ userId, gridId, feedId, patch, deps }) {
  const set = Object.fromEntries(Object.entries(patch).map(([k, v]) => [`feeds.$.${k}`, v]));
  const saved = await Grid.findOneAndUpdate({ _id: gridId, userId, "feeds.id": feedId }, { $set: set },
    { returnDocument: "after", projection: { feeds: 1 } }).lean();
  if (saved && deps.io && deps.userRoom) deps.io.to(deps.userRoom(userId)).emit("grid_updated", { gridId, grid: { feeds: publicFeeds(saved.feeds) } });
  return (saved?.feeds || []).find((f) => f.id === feedId) || null;
}

/** What a client sees: the per-uid bookkeeping stays on the server. */
export const publicFeeds = (feeds = []) => (feeds || []).map(({ items, ...f }) => ({ ...f, eventCount: Object.keys(items || {}).length }));

/**
 * The timer. Every minute it looks for due feeds and syncs them one at a time. `makeDeps(userId, gridId)`
 * builds the per-grid dependencies (fetch, rules, cache mirror).
 */
export function startFeedScheduler({ makeDeps, everyMs = 60_000, log = console }) {
  const inflight = new Set();
  const tick = async () => {
    let grids = [];
    try { grids = await Grid.find({ "feeds.0": { $exists: true } }, { userId: 1, feeds: 1 }).lean(); }
    catch (e) { log.warn?.("[feeds] scan failed:", e?.message); return; }
    for (const g of grids) for (const feed of g.feeds || []) {
      const key = `${g._id}:${feed.id}`;
      if (inflight.has(key) || !isFeedDue(feed)) continue;
      inflight.add(key);
      try {
        const deps = await makeDeps(String(g.userId), String(g._id));
        await syncFeed({ userId: String(g.userId), gridId: String(g._id), feedId: feed.id, deps });
      } catch (e) { log.warn?.("[feeds] sync failed:", e?.message); }
      finally { inflight.delete(key); }
    }
  };
  const timer = setInterval(tick, everyMs);
  timer.unref?.();
  setTimeout(tick, 5_000).unref?.();
  return () => clearInterval(timer);
}

const CACHE_BUCKET = { occurrence: "occurrencesById", module: "modulesById", field: "fieldsById" };

/** The real dependencies for one grid: fetch through the guarded fetcher, run the share rules, mirror into the warm cache. */
export async function makeFeedDeps({ userId, gridId, io = null, userRoom = null, peekUserCache = null }) {
  const { fetchPageHtml } = await import("../utils/safeFetchUrl.js");
  const { runShareRules } = await import("./shareRules.js");
  const { scheduleSlotLabels } = await import("./scheduleSlots.js");
  const { default: User } = await import("../models/User.js");
  const user = await User.findById(userId).lean().catch(() => null);
  const mirror = (model, doc) => {
    if (!doc?.id) return;
    const uc = peekUserCache?.(userId, gridId);
    const b = CACHE_BUCKET[model];
    if (uc && b && uc[b]) uc[b][doc.id] = doc;
  };
  return {
    mirror, io, userRoom,
    timeZone: user?.meta?.share?.timeZone || null,
    resolveSlotLabels: () => scheduleSlotLabels({ userId, gridId }),
    fetchText: async (u) => {
      const r = await fetchPageHtml(u, { maxBytes: 20 * 1024 * 1024,
        allowTypes: /text\/calendar|text\/plain|application\/octet-stream|text\/html|xml/i });
      if (!r.ok) throw new Error(r.error || r.reason || `could not fetch that link (${r.status || "no answer"})`);
      return r.html;
    },
    prepareLink: async ({ url, title }) => {
      const { prepareShare } = await import("./shareIngress.js");
      const { fetchLinkPreview } = await import("../utils/linkPreview.js");
      return prepareShare({ userId, gridId, source: "feed", url, title,
        fetchPreview: (u) => fetchLinkPreview(u, { fetchPageHtml }) });
    },
    runRules: ({ share }) => runShareRules({ share, userId, gridId, io, mirror: (model, doc) => mirror(model, doc) }),
  };
}
