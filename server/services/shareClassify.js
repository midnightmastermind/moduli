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
// F3: Accept webcal: as a link scheme alongside http(s)
const URL_RE = /^(https?|webcal):\/\/\S+$/i;
const TRAILING_PUNCT_RE = /[.,;:!?\]}\'"]*$/;

const extOf = (name = "") => String(name).split(".").pop().toLowerCase();

// F4: Strip trailing sentence punctuation from detected URL
const stripTrailingPunct = (url) => {
  if (!url) return url;
  return url.replace(TRAILING_PUNCT_RE, "");
};

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
  // T1: files wins over url when both present
  if (files.length) {
    const f = files[0];
    return { type: typeOfFile(f), props: {
      filename: f.filename, mimeType: f.mimetype, sizeBytes: f.size,
    }};
  }
  // F1: Trim url before testing it
  const trimmedUrl = (url || "").trim();
  if (trimmedUrl && URL_RE.test(trimmedUrl)) {
    const cleanUrl = stripTrailingPunct(trimmedUrl);
    // F5: link props gains text field
    return { type: "link", props: { url: cleanUrl, title: title || null, text: null } };
  }
  // F2: Find URL anywhere in text, not only as the whole string
  if (typeof text === "string") {
    const tokens = text.split(/\s+/);
    for (const token of tokens) {
      const trimmedToken = token.trim();
      if (trimmedToken && URL_RE.test(trimmedToken)) {
        const cleanUrl = stripTrailingPunct(trimmedToken);
        // F5: keep the ORIGINAL full text in props.text
        return { type: "link", props: { url: cleanUrl, title: title || null, text } };
      }
    }
  }
  if (text) {
    return { type: "text", props: { text, firstLine: String(text).split("\n")[0], html: null } };
  }
  return { type: "file", props: {} };
}
