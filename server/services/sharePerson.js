// server/services/sharePerson.js
//
// A PERSON, SHARED (user, 2026-09-25: "id like to be able to share profile to
// moduli and it add it to the people board" → "only do vcf files. unless you
// can follow profile links to grab the info").
//
// Two ways a person reaches /share, both turned here into ONE flat shape a
// share rule can write (`$share.person`):
//
//   a CONTACT   a .vcf (vCard) shared from the phone's contacts
//   a PROFILE   an Instagram / Facebook / TikTok profile link. Measured
//               2026-09-25 from the prod box: fetched as a link-preview bot,
//               all three return the person's name and photo in their
//               og:title / og:image. X and LinkedIn do not, so they are not
//               recognised — they stay ordinary links.
//
//   $share.person = { name, network, handle, profileUrl, phone, email,
//                     birthday, company, jobTitle, foundVia: [],
//                     photo: { base64, mime } | { url } | null }
//
// Pure: no network, no disk. The ingress fetches and stores.

// ── Profile links ───────────────────────────────────────────────────────────
const NOT_A_PROFILE = new Set([
  "p", "reel", "reels", "tv", "stories", "explore", "accounts", "direct", "about", "legal",   // instagram
  "watch", "groups", "events", "pages", "photo", "photo.php", "story.php", "share", "marketplace",
  "hashtag", "login", "help", "policies", "settings", "gaming", "reel",                         // facebook
]);

/** `{ network, handle, profileUrl }` for a profile link, else null. */
export function profileLinkInfo(url) {
  let u;
  try { u = new URL(String(url || "").trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.|mobile\.|web\.)/, "");
  const parts = u.pathname.split("/").filter(Boolean);

  if (host === "instagram.com") {
    if (parts.length !== 1 || NOT_A_PROFILE.has(parts[0].toLowerCase())) return null;
    const handle = parts[0];
    return { network: "instagram", handle, profileUrl: `https://www.instagram.com/${handle}/` };
  }
  if (host === "facebook.com" || host === "fb.com") {
    if (parts[0] === "profile.php") {
      const id = u.searchParams.get("id");
      return id ? { network: "facebook", handle: id, profileUrl: `https://www.facebook.com/profile.php?id=${id}` } : null;
    }
    if (parts[0] === "people" && parts.length >= 3) {
      return { network: "facebook", handle: parts[2], profileUrl: `https://www.facebook.com/people/${parts[1]}/${parts[2]}/` };
    }
    if (parts.length !== 1 || NOT_A_PROFILE.has(parts[0].toLowerCase())) return null;
    return { network: "facebook", handle: parts[0], profileUrl: `https://www.facebook.com/${parts[0]}` };
  }
  if (host === "tiktok.com") {
    if (parts.length !== 1 || !parts[0].startsWith("@")) return null;
    const handle = parts[0].slice(1);
    return handle ? { network: "tiktok", handle, profileUrl: `https://www.tiktok.com/@${handle}` } : null;
  }
  return null;
}

const decodeEntities = (s) => String(s ?? "")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&amp;/g, "&");

function metaContent(html, prop) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, "i");
  const tag = String(html || "").match(re)?.[0];
  const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
  return content ? decodeEntities(content).trim() : null;
}

/** The person a profile page describes, from its og tags. */
export function profileFromHtml(info, html) {
  const title = metaContent(html, "og:title") || "";
  let name = title;
  if (info.network === "instagram") name = title.replace(/\s*\(@[^)]*\).*$/, "").replace(/\s*•\s*Instagram.*$/i, "");
  if (info.network === "tiktok") name = title.replace(/\s+on TikTok\s*$/i, "").replace(/\s*\|\s*TikTok\s*$/i, "");
  if (info.network === "facebook") name = title.replace(/\s*\|\s*Facebook\s*$/i, "");
  name = name.trim();
  // A login wall answers with the site's own name instead of the person's.
  if (!name || /^(instagram|facebook|tiktok|log in|login)\b/i.test(name)) name = null;
  const image = metaContent(html, "og:image");
  return {
    name: name || info.handle,
    network: info.network, handle: info.handle, profileUrl: info.profileUrl,
    phone: null, email: null, birthday: null, company: null, jobTitle: null,
    foundVia: info.network === "tiktok" ? [] : [info.network],
    photo: image ? { url: image } : null,
    nameFromPage: !!name,
  };
}

// ── vCard ───────────────────────────────────────────────────────────────────

/** Unfold RFC 6350 continuation lines (a line starting with space/tab). */
const unfold = (text) => String(text || "").replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");

function decodeQuotedPrintable(s) {
  const bytes = [];
  const t = s.replace(/=\n/g, "");
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "=" && /^[0-9A-F]{2}$/i.test(t.slice(i + 1, i + 3))) { bytes.push(parseInt(t.slice(i + 1, i + 3), 16)); i += 2; }
    else bytes.push(...Buffer.from(t[i], "utf8"));
  }
  return Buffer.from(bytes).toString("utf8");
}

const unescapeValue = (v) => v.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();

/** Every card in a .vcf as `$share.person` shapes (a shared contact is usually one). */
export function parseVcards(text) {
  const cards = [];
  let cur = null;
  for (const raw of unfold(text).split("\n")) {
    const line = raw.trimEnd();
    if (/^BEGIN:VCARD$/i.test(line)) { cur = { props: [] }; continue; }
    if (/^END:VCARD$/i.test(line)) { if (cur) cards.push(cur); cur = null; continue; }
    if (!cur) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const head = line.slice(0, colon).split(";");
    const key = head[0].replace(/^item\d+\./i, "").toUpperCase();
    const params = {};
    for (const p of head.slice(1)) {
      const [k, v] = p.split("=");
      if (v === undefined) params.TYPE = [...(params.TYPE || []), k.toUpperCase()];
      else params[k.toUpperCase()] = (params[k.toUpperCase()] ? params[k.toUpperCase()] + "," : "") + v.replace(/"/g, "");
    }
    let value = line.slice(colon + 1);
    if ((params.ENCODING || "").toUpperCase() === "QUOTED-PRINTABLE") value = decodeQuotedPrintable(value);
    cur.props.push({ key, params, value });
  }

  return cards.map(({ props }) => {
    const first = (k) => props.find(p => p.key === k);
    const fn = first("FN") ? unescapeValue(first("FN").value) : null;
    let name = fn;
    if (!name && first("N")) {
      const [last, given, middle] = first("N").value.split(";").map(unescapeValue);
      name = [given, middle, last].filter(Boolean).join(" ") || null;
    }
    const org = first("ORG") ? unescapeValue(first("ORG").value.split(";")[0]) : null;
    const tel = first("TEL")?.value?.replace(/^tel:/i, "").trim() || null;
    const email = first("EMAIL") ? unescapeValue(first("EMAIL").value) : null;
    const bday = first("BDAY")?.value?.trim() || null;
    const birthday = bday && /^\d{4}-?\d{2}-?\d{2}/.test(bday)
      ? `${bday.slice(0, 4)}-${bday.replace(/-/g, "").slice(4, 6)}-${bday.replace(/-/g, "").slice(6, 8)}`
      : null;

    let photo = null;
    const ph = first("PHOTO");
    if (ph) {
      const v = ph.value.trim();
      const dataUri = v.match(/^data:([^;,]+);base64,(.+)$/i);
      if (dataUri) photo = { base64: dataUri[2], mime: dataUri[1].toLowerCase() };
      else if (/^https?:\/\//i.test(v)) photo = { url: v };
      else if ((ph.params.ENCODING || "").toUpperCase().match(/^(B|BASE64)$/)) {
        const typeParam = Array.isArray(ph.params.TYPE) ? ph.params.TYPE[0] : String(ph.params.TYPE || "").split(",")[0];
        const t = typeParam || "JPEG";
        const sub = String(t).toLowerCase().replace("jpg", "jpeg");
        photo = { base64: v.replace(/\s+/g, ""), mime: sub.includes("/") ? sub : `image/${sub}` };
      }
    }

    return {
      name: name || org || null,
      network: null, handle: null, profileUrl: null,
      phone: tel, email, birthday,
      company: org && org !== name ? org : null,
      jobTitle: first("TITLE") ? unescapeValue(first("TITLE").value) : null,
      foundVia: [],
      photo,
    };
  }).filter(p => p.name);
}
