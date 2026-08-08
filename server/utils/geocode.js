// server/utils/geocode.js
// ============================================================
// Turning a typed query into PLACES. Parsing lives here, on the side that
// makes the request, so the client only ever sees a normalized row.
//
// TWO PROVIDERS, AND THE ORDER IS THE POINT (the /api/images/search pattern:
// DuckDuckGo primary, Wikipedia fallback).
//
//   • PHOTON (photon.komoot.io) is PRIMARY. It is built for type-ahead PLACE
//     search — "froedtert", "dewey center", "the coffee shop on Brady" — and
//     returns named POIs ranked by prominence. Free, no key.
//   • NOMINATIM is the FALLBACK. It is the better STREET-ADDRESS resolver
//     ("2010 W Wisconsin Ave") and the canonical OSM geocoder, but it ranks
//     bare venue names poorly, which is exactly the query the user cares
//     about ("we should look up places with that mini search, not just
//     addresses").
//
// Running Photon first and Nominatim second means a venue name resolves to the
// venue, and a street address still resolves — rather than one provider doing
// both jobs badly.
//
// Both are donated public infrastructure and both REQUIRE a genuine
// identifying User-Agent; anonymous bulk traffic gets blocked. Requests are
// serialised through a small rate limiter for the same reason.
// ============================================================

const USER_AGENT = "Moduli/1.0 (personal workspace; +https://viafluere.com)";

// ── Rate limiting ─────────────────────────────────────────────────────────
// PER-PROVIDER queues, not one shared queue. Nominatim's policy is an absolute
// maximum of 1 request/second; Photon's is far more relaxed. Sharing a single
// 1.1s queue would serialise the two providers behind each other and turn every
// parallel lookup into a 2.2s wait for no reason.
//
// Serialised queues rather than token buckets on purpose: a burst of parallel
// requests that each "pass" a bucket check still lands as a burst at the far end.
function makeThrottle(minGapMs) {
  let chain = Promise.resolve();
  let lastAt = 0;
  return function throttled(fn) {
    const run = async () => {
      const wait = Math.max(0, lastAt + minGapMs - Date.now());
      if (wait) await new Promise((r) => setTimeout(r, wait));
      lastAt = Date.now();
      return fn();
    };
    // Chain regardless of whether the previous call rejected, or one failure
    // would wedge the queue permanently.
    const next = chain.then(run, run);
    chain = next.then(() => {}, () => {});
    return next;
  };
}

const nominatimThrottle = makeThrottle(1100); // their stated hard limit
const photonThrottle = makeThrottle(200);

async function getJson(url, { timeoutMs = 8000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (!r.ok) throw new Error(`${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

// ── Shared normalization ──────────────────────────────────────────────────

const num = (v) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

export function isValidLatLon(lat, lon) {
  const la = num(lat), lo = num(lon);
  return la !== null && lo !== null
    && la >= -90 && la <= 90 && lo >= -180 && lo <= 180;
}

/**
 * Nominatim's `display_name` is a comma-joined path from most to least
 * specific. When the hit has a name ("Dewey Center") it is almost always the
 * FIRST segment, so the address is the remainder.
 *
 * The split matters because the two halves are used in different places: the
 * name is what a dropdown shows, the address is what you navigate to. Storing
 * the raw display_name in both makes every row read "Dewey Center, 2010 West
 * Wisconsin Avenue, Milwaukee, Milwaukee County, Wisconsin, 53233, United
 * States".
 */
export function splitDisplayName(displayName, name) {
  const full = String(displayName || "").trim();
  if (!full) return { label: String(name || "").trim(), address: "" };

  const segments = full.split(",").map((s) => s.trim()).filter(Boolean);
  const first = segments[0] || "";
  const fold = (s) => String(s || "").trim().toLowerCase();

  if (name && fold(name) === fold(first)) {
    return { label: String(name).trim(), address: segments.slice(1).join(", ") };
  }
  if (name) {
    // Named, but not at the head — keep the address whole rather than
    // guessing which segment to remove.
    return { label: String(name).trim(), address: full };
  }
  // Unnamed (a bare street address): a lone house number is a useless label,
  // so take the number AND the street.
  if (/^\d+[a-z]?$/i.test(first) && segments.length > 1) {
    return { label: `${first} ${segments[1]}`, address: full };
  }
  return { label: first, address: full };
}

/**
 * Photon returns GeoJSON whose properties are already SPLIT into parts, so
 * the address is composed rather than parsed — no display_name to pick apart.
 */
function fromPhotonFeature(f) {
  const p = f?.properties || {};
  const [lon, lat] = f?.geometry?.coordinates || [];
  if (!isValidLatLon(lat, lon)) return null;

  const label = String(p.name || "").trim()
    || [p.housenumber, p.street].filter(Boolean).join(" ").trim();
  if (!label) return null;

  // Compose the postal address from most to least specific, skipping the
  // parts Photon omits for this hit. `filter(Boolean)` is doing real work —
  // most hits are missing at least one component.
  const street = [p.housenumber, p.street].filter(Boolean).join(" ");
  const address = [street, p.district, p.city, p.state, p.postcode, p.country]
    .map((s) => (s ? String(s).trim() : ""))
    .filter(Boolean)
    .join(", ");

  return {
    label,
    address,
    lat: num(lat),
    lon: num(lon),
    osmId: p.osm_type && p.osm_id ? `${p.osm_type}/${p.osm_id}` : null,
    kind: p.osm_value || p.osm_key || p.type || null,
  };
}

function fromNominatimHit(hit) {
  const lat = num(hit?.lat), lon = num(hit?.lon);
  if (!isValidLatLon(lat, lon)) return null;
  const { label, address } = splitDisplayName(hit.display_name, hit.name);
  if (!label) return null;
  return {
    label,
    address,
    lat,
    lon,
    // place_id is NOT stable across Nominatim rebuilds; osm_type/osm_id is.
    osmId: hit.osm_type && hit.osm_id ? `${hit.osm_type}/${hit.osm_id}` : null,
    kind: hit.type || hit.class || null,
  };
}

/** Drop unusable rows and collapse duplicates the two providers both return. */
function dedupe(rows) {
  const out = [];
  const seen = new Set();
  for (const hit of rows) {
    if (!hit) continue;
    const key = hit.osmId || `${hit.label.toLowerCase()}@${hit.lat},${hit.lon}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out;
}

// ── Providers ─────────────────────────────────────────────────────────────

export async function searchPhoton(q, { limit = 8, lat, lon } = {}) {
  let url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=${limit}`;
  // Bias toward the user when we know roughly where they are: "the gym" should
  // mean a gym near them, not the highest-ranked gym on Earth.
  if (isValidLatLon(lat, lon)) url += `&lat=${lat}&lon=${lon}`;
  const j = await photonThrottle(() => getJson(url));
  return dedupe((j?.features || []).map(fromPhotonFeature));
}

export async function searchNominatim(q, { limit = 8 } = {}) {
  const url = `https://nominatim.openstreetmap.org/search`
    + `?q=${encodeURIComponent(q)}&format=jsonv2&addressdetails=1&limit=${limit}`;
  const j = await nominatimThrottle(() => getJson(url));
  return dedupe((Array.isArray(j) ? j : []).map(fromNominatimHit));
}

/**
 * Does this query look like a STREET ADDRESS rather than a place name?
 *
 * Measured, not guessed. Against the real providers:
 *
 *   "Froedtert"                       photon ✅   nominatim ✅
 *   "2010 W Wisconsin Ave Milwaukee"  photon ❌   nominatim ✅  ← exact house
 *   "Dewey Center Milwaukee"          photon ❌   nominatim ❌  ← not in OSM
 *
 * Photon returned EIGHT hits for the street address and not one was the right
 * building; Nominatim returned exactly one and it was correct. So the two are
 * genuinely good at different things and the ordering has to follow the query.
 *
 * The signal is a leading house number, optionally with a unit letter ("221B").
 * A place name almost never starts with a bare number, and when one does
 * ("1900 Barker") the address ranking is still a reasonable answer.
 */
export function looksLikeStreetAddress(q) {
  return /^\s*\d+[a-z]?\s+\S/i.test(String(q || ""));
}

/**
 * Interleave two ranked lists, `primary` first, dropping duplicates.
 *
 * Interleaved rather than concatenated because both providers are frequently
 * right — concatenating would bury a good Nominatim hit under eight mediocre
 * Photon ones. Taking from the front of each in turn keeps both providers'
 * best guesses visible without deciding which one "won".
 */
export function mergeRanked(primary, secondary, limit = 10) {
  const out = [];
  const seen = new Set();
  const push = (hit) => {
    if (!hit || out.length >= limit) return;
    const key = hit.osmId || `${hit.label.toLowerCase()}@${hit.lat},${hit.lon}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(hit);
  };
  for (let i = 0; i < Math.max(primary.length, secondary.length); i++) {
    push(primary[i]);
    push(secondary[i]);
  }
  return out;
}

/**
 * The one entry point. Queries BOTH providers in PARALLEL and merges.
 *
 * THIS REPLACES A FALLBACK CHAIN THAT COULD NEVER FIRE. The first version was
 * "Photon, then Nominatim if Photon finds nothing" — but Photon returns eight
 * hits for essentially any query, including ones where every hit is wrong, so
 * the Nominatim branch was unreachable dead code. **"Returns results" is not
 * "returns the right results."** Only running both and ranking by query shape
 * makes a street address resolve.
 *
 * One provider failing is survivable; both failing is an error.
 */
export async function searchPlaces(q, opts = {}) {
  const query = String(q || "").trim();
  if (!query) return { results: [], source: "none" };

  const [photon, nominatim] = await Promise.allSettled([
    searchPhoton(query, opts),
    searchNominatim(query, opts),
  ]);

  const ok = (r, name) => {
    if (r.status === "fulfilled") return r.value;
    console.warn(`[locations/search] ${name} failed:`, r.reason?.message);
    return null;
  };
  const p = ok(photon, "photon");
  const n = ok(nominatim, "nominatim");

  if (p === null && n === null) {
    const err = new Error("both geocoders are unreachable");
    err.code = "geocode_unavailable";
    throw err;
  }

  const addressy = looksLikeStreetAddress(query);
  const results = addressy
    ? mergeRanked(n || [], p || [])
    : mergeRanked(p || [], n || []);

  return {
    results,
    source: [p?.length && "photon", n?.length && "nominatim"].filter(Boolean).join("+") || "none",
  };
}
