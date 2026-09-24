//
// Payload → ONE COARSE TOKEN. A rule matches a token, not a regex, so the
// config stays readable (spec §3). Pure: no I/O, no DB.
const EXT_TYPE = {
  ics: "ics", ical: "ics",
  jpg: "image", jpeg: "image", png: "image", gif: "image", webp: "image", heic: "image",
  mp4: "video", mov: "video", mkv: "video", webm: "video",
  mp3: "audio", m4a: "audio", wav: "audio", ogg: "audio",
  pdf: "pdf",
};
const URL_RE = /^https?:\/\/\S+$/i;

const extOf = (name = "") => String(name).split(".").pop().toLowerCase();

function typeOfFile(f) {
  const mime = String(f.mimetype || "").toLowerCase();
  // Extension FIRST for calendars: Android commonly shares .ics as
  // application/octet-stream, so trusting the mime type alone loses them.
  const byExt = EXT_TYPE[extOf(f.filename)];
  if (byExt === "ics") return "ics";
  if (mime === "text/calendar") return "ics";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  return byExt || "file";
}

export function classifyShare({ files = [], url = null, text = null, title = null } = {}) {
  if (files.length) {
    const f = files[0];
    return { type: typeOfFile(f), props: {
      filename: f.filename, mimeType: f.mimetype, sizeBytes: f.size,
    }};
  }
  const candidate = url || (typeof text === "string" ? text.trim() : "");
  if (candidate && URL_RE.test(candidate)) {
    return { type: "link", props: { url: candidate, title: title || null } };
  }
  if (text) {
    return { type: "text", props: { text, firstLine: String(text).split("\n")[0], html: null } };
  }
  return { type: "file", props: {} };
}
