// server/services/shareIngress.js
//
// INGRESS PREPARES; THE RULE ROUTES (spec §3).
//
// All mechanical work happens here, before any rule runs — link metadata is
// fetched, a display label is chosen, the idempotency key is derived — so a
// rule sees clean flat data and the rule language stays free of I/O.
//
// Dependencies are INJECTED (`fetchPreview`, `storeFile`) so this module is
// testable without a network or a disk, and so the route supplies the SAME
// link-preview helper `/bookmarks` uses rather than a second one.
//
// FILES ARE NOT WIRED YET. The upload lives inline in server.js's
// `/api/artifacts/upload`; the share path must reuse it, not grow a second
// uploader (engine plan, Global Constraints). Until it is extracted, a share
// carrying a file is refused with a message that says so — never dropped.
import fs from "fs/promises";
import { classifyShare } from "./shareClassify.js";
import { parseIcs } from "./icsImport.js";
import { floorToSlot } from "./slotSnap.js";
import { parseVcards, profileLinkInfo, profileFromHtml } from "./sharePerson.js";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";

// A profile link is still a link everywhere a link is meant (its label, its
// identity, the catch-all's row on a grid with no people rule).
const isLinkType = (t) => t === "link" || t === "profile";

const trimTo = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** The one display label for a share — what the catch-all names its row. */
export function shareLabelFor(type, props = {}, explicit = null) {
  if (explicit && String(explicit).trim()) return trimTo(explicit, 200);
  if (type === "contact" || type === "profile") {
    if (props.personName) return trimTo(props.personName, 200);
  }
  if (isLinkType(type)) return trimTo(props.title || props.url, 200) || "Shared link";
  if (type === "text" || type === "html") return trimTo(props.firstLine || props.text, 120) || "Shared text";
  return trimTo(props.filename, 200) || "Shared file";
}

/**
 * Idempotency key (spec §7). A link keys on `<shape>:<url>` — the extension's
 * existing scheme, so a clip re-routed through /share updates the row the old
 * /ingest path made instead of duplicating it. Shape defaults to `link`.
 */
export function shareExternalIdFor(type, props = {}, { shape = null, sha256 = null } = {}) {
  // A profile is keyed on WHO it is, so re-sharing the same person updates
  // their row instead of adding them twice.
  if (type === "profile" && props.network && props.handle) return `profile:${props.network}:${props.handle.toLowerCase()}`;
  if (type === "contact" && props.personName) return `contact:${String(props.personName).toLowerCase().replace(/\s+/g, " ").trim()}`;
  if (isLinkType(type)) return `${shape || "link"}:${props.url}`;
  if (sha256) return `sha256:${sha256}`;
  if (props.filename) return `file:${props.filename}:${props.sizeBytes ?? ""}`;
  return `text:${trimTo(props.text, 200)}`;
}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * The browser extension's clip record (its `buildClipRecord` output), reduced
 * to the keys the catch-all writes. It arrives from the caller, so every key
 * is type-checked and anything else is DROPPED — a rule reads `$share.clip.*`
 * and must not be handed arbitrary structure.
 *
 * This is what keeps D15's "day one is identical": the extension still decides
 * the label, the bookmark/image shape and the field ids (resolved by NAME on
 * this grid), exactly as it did when it posted to /ingest.
 */
export function sanitizeClip(raw) {
  if (!isObj(raw)) return null;
  const fields = {};
  if (isObj(raw.fields)) {
    for (const [fid, cell] of Object.entries(raw.fields)) {
      if (typeof fid === "string" && fid && isObj(cell) && "value" in cell) {
        fields[fid] = { value: cell.value, flow: cell.flow === "out" ? "out" : "in" };
      }
    }
  }
  const meta = {};
  if (isObj(raw.meta)) {
    if (str(raw.meta.clipShape)) meta.clipShape = str(raw.meta.clipShape);
    if (str(raw.meta.clippedFrom)) meta.clippedFrom = str(raw.meta.clippedFrom);
  }
  return {
    // The clip's OWN identity (`<shape>:<url>`) is authoritative. Re-deriving
    // it here from the classified url breaks on anything that is not an http
    // link — an image on a search page is a `data:` URL, classifies as a bare
    // "file", and derived `text:` with nothing after it, so every such image
    // clip shared one identity and each overwrote the last.
    externalId: str(raw.externalId),
    label: str(raw.label),
    moduleRole: str(raw.moduleRole) || "artifact",
    moduleKind: str(raw.moduleKind),
    moduleFileRef: str(raw.moduleFileRef),
    parentId: str(raw.parentId),
    fields, meta,
  };
}

const EXT_FOR = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

/** A person's photo (vCard base64 or a URL) → stored like a shared image → its occurrence id. */
async function storePersonPhoto(photo, { storeFile, fetchImage, userId, gridId, name }) {
  let buf = null, mime = photo.mime || "image/jpeg";
  if (photo.base64) buf = Buffer.from(photo.base64, "base64");
  else if (photo.url && fetchImage) {
    const got = await fetchImage(photo.url);
    if (!got?.buf) return null;
    buf = got.buf; mime = got.type || mime;
  }
  if (!buf?.length || !EXT_FOR[mime]) return null;
  const safe = String(name || "person").replace(/[^\w .-]+/g, "").trim() || "person";
  const tmp = path.join(os.tmpdir(), `share-person-${randomUUID()}.${EXT_FOR[mime]}`);
  await fs.writeFile(tmp, buf);
  const file = { path: tmp, originalname: `${safe}.${EXT_FOR[mime]}`, mimetype: mime, size: buf.length };
  const stored = await storeFile({ file: { ...file, filename: file.originalname, _multer: file }, userId, gridId });
  return stored?.occurrenceId || null;
}

const EXT_BY_PATH = /\.(jpe?g|png|webp|gif)(?:$|[?#])/i;

/**
 * AN IMAGE CLIP IS A FILE (2026-10-14). The extension's "save image" sent only
 * the picture's URL, so it ran as a LINK: it landed in Bookmarks as a remote
 * reference — and a CDN link like Facebook's is signed and expires (`oe=`), so
 * the picture would have gone blank within days. The bytes are fetched and
 * stored like any shared image, so the share is an `image` with its own row in
 * Files › Images. Returns null when the picture cannot be read; the caller then
 * shares it as before.
 */
async function storeImageClip(url, { storeFile, fetchImage, userId, gridId }) {
  let buf = null, mime = null;
  const data = /^data:(image\/[\w+.-]+);base64,(.+)$/i.exec(url || "");
  if (data) { mime = data[1].toLowerCase(); buf = Buffer.from(data[2], "base64"); }
  else if (/^https?:\/\//i.test(url || "") && fetchImage) {
    const got = await fetchImage(url).catch(() => null);
    if (!got?.buf) return null;
    buf = got.buf; mime = got.type || null;
  }
  if (mime === "image/jpg") mime = "image/jpeg";
  if (!buf?.length || !EXT_FOR[mime]) return null;
  let base = "image";
  try {
    if (!data) base = decodeURIComponent(new URL(url).pathname.split("/").pop() || "image").replace(EXT_BY_PATH, "");
  } catch {}
  base = base.replace(/[^\w .-]+/g, "").trim().slice(0, 80) || "image";
  const name = `${base}.${EXT_FOR[mime]}`;
  const tmp = path.join(os.tmpdir(), `share-clip-${randomUUID()}.${EXT_FOR[mime]}`);
  await fs.writeFile(tmp, buf);
  const file = { path: tmp, originalname: name, mimetype: mime, size: buf.length };
  return storeFile({ file: { ...file, filename: name, _multer: file }, userId, gridId });
}

export async function prepareShare({
  userId, gridId, source = "api",
  files = [], url = null, text = null, title = null, label = null, shape = null,
  clip = null, externalId: senderExternalId = null,
  fetchPreview = null, storeFile = null, fetchProfile = null, fetchImage = null,
  timeZone = null, resolveSlotLabels = null, fetchCalendar = null,
}) {
  let { type, props } = classifyShare({ files, url, text, title });
  let enriched = { ...props, shape: shape || null };
  let cleanClip = sanitizeClip(clip);
  let sha256 = null;
  let clipLabel = null;

  const isImageClip = !files.length && (shape === "image" || cleanClip?.meta?.clipShape === "image");
  if (isImageClip && storeFile) {
    const src = url || cleanClip?.moduleFileRef;
    const stored = await storeImageClip(src, { storeFile, fetchImage, userId, gridId }).catch(() => null);
    if (stored?.occurrenceId) {
      clipLabel = label || cleanClip?.label || null;
      type = "image";
      enriched = {
        filename: null, mimeType: null, sizeBytes: null, shape: "image",
        url: /^https?:/i.test(src || "") ? src : null,
        clippedFrom: cleanClip?.meta?.clippedFrom || null,
        occurrenceId: stored.occurrenceId, fileRef: stored.fileRef,
      };
      sha256 = stored.sha256 || null;
      // The stored file IS the thing — a clip record beside it would make the
      // catch-all mint a second row.
      cleanClip = cleanClip ? { ...cleanClip, _stored: true } : null;
    }
  }

  // A CALENDAR is read BEFORE the file is stored — storing moves the temp file.
  let calendar = null;
  let shareType = type;

  // A calendar LINK — a `webcal://` subscription, or an https link to an
  // .ics — is fetched and read as a calendar, so its events reach the rules
  // exactly as a shared .ics file's would. A link that turns out not to be a
  // calendar stays a link.
  if (type === "link" && fetchCalendar && isCalendarUrl(props.url)) {
    const fetched = await fetchCalendar(calendarFetchUrl(props.url)).catch(() => null);
    if (typeof fetched === "string" && /BEGIN:VCALENDAR/i.test(fetched)) {
      calendar = await icsEvents(fetched, { timeZone, resolveSlotLabels });
      shareType = "ics";
    }
  }
  if (type === "ics" && files.length) {
    const f = files[0];
    const icsText = f.text ?? await fs.readFile(f.path, "utf8").catch(() => "");
    calendar = await icsEvents(icsText, { timeZone, resolveSlotLabels });
  }

  // ── A PERSON (contact card or profile link) → `$share.person` ─────────────
  // The .vcf itself is NOT stored — the person is the thing, not the file.
  // The photo is stored like any shared image and handed to the rule by id.
  let person = null;
  if (type === "contact" && files.length) {
    const f = files[0];
    const vcf = f.text ?? await fs.readFile(f.path, "utf8").catch(() => "");
    person = parseVcards(vcf)[0] || null;
    if (f.path) await fs.unlink(f.path).catch(() => {});
    files = [];
    if (!person) throw Object.assign(new Error("no contact with a name was found in that card"), { code: "empty_contact" });
  }
  if (type === "profile" && fetchProfile) {
    const info = profileLinkInfo(props.url);
    const html = await fetchProfile(info.profileUrl).catch(() => null);
    person = profileFromHtml(info, html || "");
    Object.assign(enriched, { network: info.network, handle: info.handle, url: info.profileUrl });
  }
  if (person) {
    let photoOccurrenceId = null;
    if (person.photo && storeFile) {
      photoOccurrenceId = await storePersonPhoto(person.photo, { storeFile, fetchImage, userId, gridId, name: person.name }).catch(() => null);
    }
    const { photo, ...rest } = person;
    person = { ...rest, photoOccurrenceId, photoIds: photoOccurrenceId ? [photoOccurrenceId] : [] };
    enriched.personName = person.name;
  }

  if (files.length) {
    if (!storeFile) {
      const err = new Error("sharing files is not wired up yet — links and text only for now");
      err.code = "files_unsupported";
      throw err;
    }
    const f = files[0];
    const stored = await storeFile({ file: f, userId, gridId });
    enriched.occurrenceId = stored.occurrenceId;
    enriched.fileRef = stored.fileRef;
    sha256 = stored.sha256 || f.sha256 || null;
  } else if (type === "link" && fetchPreview && !cleanClip) {
    // A CLIP IS NOT FETCHED. The extension already knows the page's title,
    // and a link clip is deliberately "bookmark it without visiting it"
    // (extension/README.md) — fetching it here would undo that.
    // A dead site still shares — the preview failing leaves the url itself as
    // the label, which is what /bookmarks does too.
    const preview = await fetchPreview(enriched.url).catch(() => null);
    if (preview?.ok) {
      enriched.title = enriched.title || preview.title || null;
      enriched.favicon = preview.favicon || null;
      enriched.image = preview.cover || null;
      enriched.finalUrl = preview.url || enriched.url;
    }
  }
  // The catalogue (spec §3) promises these keys on a link; present-but-null
  // beats absent, so a rule reading one resolves to null rather than failing.
  if (isLinkType(type)) {
    for (const k of ["title", "description", "siteName", "image", "favicon"]) {
      if (!(k in enriched)) enriched[k] = null;
    }
  }

  return {
    type: shareType, source,
    props: enriched,
    clip: cleanClip?._stored ? null : cleanClip,
    ...(person ? { person } : {}),
    ...(calendar ? { events: calendar.events, notices: calendar.notices } : {}),
    label: shareLabelFor(type, enriched, label || clipLabel || cleanClip?.label),
    externalId: cleanClip?.externalId || senderIdentity(source, senderExternalId) || (shareType === "ics" && type === "link"
      ? `webcal:${calendarFetchUrl(enriched.url)}`
      : shareExternalIdFor(type, enriched, { shape, sha256 })),
    receivedAt: new Date().toISOString(),
  };
}

/**
 * A sender's own id for a share, namespaced so it can never equal an id the
 * server derives (`text:…`, `link:…`, `ics:…`) and so overwrite that row.
 * Without one, two posts of the same text are ONE share: the second updates
 * the first (measured 2026-10-21 — the watch's "Drink water" twice kept one row).
 */
export function senderIdentity(source, id) {
  if (typeof id !== "string") return null;
  const v = id.trim();
  if (!v || v.length > 200) return null;
  return `ext:${String(source || "api").slice(0, 40)}:${v}`;
}

/**
 * A calendar's events as a rule sees them: `$share.events[]`, each with its
 * start FLOORED onto the grid's slot labels (D11) and its OWN identity
 * (`ics:<UID>`), so re-sharing an edited invite moves its row instead of adding
 * one (spec §7). Recurrence is not expanded (D12) and there is no cap (D20);
 * both are reported in `notices`, as is a timezone that had to be guessed.
 */
export async function icsEvents(text, { timeZone = null, resolveSlotLabels = null, expand = null } = {}) {
  const { events, zoneGuessed } = parseIcs(text, { timeZone, expand });
  const needsSlots = events.some((e) => e.start?.time);
  const slotLabels = needsSlots && resolveSlotLabels ? (await resolveSlotLabels()) || [] : [];
  const out = events.map((e) => ({
    ...e,
    start: { ...e.start, timeSlot: floorToSlot(e.start.time, slotLabels) },
    externalId: e.uid ? `ics:${e.uid}` : `ics:${e.summary}:${e.start.date}:${e.start.time ?? "allday"}`,
  }));
  const notices = [];
  if (!events.length) notices.push("no events found in this calendar");
  if (!expand && out.some((e) => e.recurring)) notices.push("recurrence not imported — first occurrence only");
  if (zoneGuessed) notices.push("your timezone is unknown — times read in each invite's own zone");
  if (needsSlots && !slotLabels.length) notices.push("this grid has no time slots — events have no Time Slot");
  return { events: out, notices };
}

/** A link that names a calendar: `webcal(s)://…`, or an http(s) link ending in .ics. */
export const isCalendarUrl = (url) =>
  typeof url === "string" && (/^webcals?:\/\//i.test(url) || /^https?:\/\/[^?#]+\.ics(?:[?#]|$)/i.test(url));

/** webcal:// is https:// with a different name (RFC-less but universal). */
export const calendarFetchUrl = (url) => String(url).replace(/^webcals?:\/\//i, "https://");
