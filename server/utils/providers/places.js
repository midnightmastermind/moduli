// utils/providers/places.js — Location, Route, Area, Event, from the geocoder
// this repo already runs.
//
// User picked Places first among the remaining feeds, and it is the cheapest of
// them for one reason: **nothing new is called.** `utils/geocode.js` has queried
// Photon and Nominatim IN PARALLEL since the `address` field type shipped
// (2026-08-08), including the per-provider rate limits, the house-number-aware
// ranking, and the cross-provider dedupe that took a live prod call to find
// (`W/282412131` vs `way/282412131` — the same building, two spellings). This
// is an adapter over that, not a second geocoder.
//
// **THE OSM ID IS THE EXTERNAL ID**, and it is what makes the merge rule work:
// pick a place once and it stops being offered, matched on OSM's own identity
// rather than on a label two different buildings can share.
//
// It deliberately does NOT geocode on its own terms. `0054` records the reason
// twice over: Froedtert has several Milwaukee campuses and Dewey Center is in
// neither geocoder, so a plausible address attached to a medical appointment is
// indistinguishable from one the user entered. Here the user PICKS the row, so
// the address is chosen rather than inferred.

import { normalizeResult, registerProvider } from "../searchProviders.js";
import { searchPlaces, normalizeOsmId } from "../geocode.js";

export function placeFields(p) {
  const f = {};
  if (p?.address) f["Address"] = p.address;
  if (p?.kind) f["Kind"] = p.kind;
  // Coordinates are offered as their own fields rather than one "lat,lon"
  // string, so each can land in a number field and be used arithmetically.
  if (Number.isFinite(p?.lat)) f["Latitude"] = String(p.lat);
  if (Number.isFinite(p?.lon)) f["Longitude"] = String(p.lon);
  return f;
}

// OSM's own URL wants the type spelled out — `way/282412131`, never `w/…` and
// never the `W282412131` a naive slash-strip produces. Probed: only the long
// form answers 200; both short forms 404.
const OSM_TYPE = { n: "node", w: "way", r: "relation" };

export function osmUrl(osmId) {
  const norm = normalizeOsmId(osmId);            // `W/282412131` -> `w/282412131`
  const m = /^([nwr])\/(\d+)$/.exec(norm || "");
  return m ? `https://www.openstreetmap.org/${OSM_TYPE[m[1]]}/${m[2]}` : null;
}

const toResult = (p) => normalizeResult({
  provider: "places",
  // NORMALISED, and that is the whole point of the id. Photon spells the same
  // building `W/282412131` and Nominatim spells it `way/282412131`; storing
  // whichever geocoder happened to win would mean a place already on the grid
  // is offered again the next time the other one answers first — precisely the
  // duplicate the merge rule exists to prevent.
  externalId: normalizeOsmId(p.osmId),
  title: p.label || "",
  subtitle: p.address || null,
  url: osmUrl(p.osmId),
  fields: placeFields(p),
});

export const placesProvider = {
  id: "places", label: "Places (OpenStreetMap)", needsKey: false,
  async search(q, { limit = 6, lat, lon } = {}) {
    // Biased toward the caller when it knows roughly where they are — Photon
    // reads lat/lon and `isValidLatLon` ignores them when they are absent or
    // nonsense, so an unbiased search is still exactly today's behaviour.
    const { results } = await searchPlaces(String(q || ""), { limit, lat, lon });
    return (results || []).slice(0, limit).map(toResult);
  },
  async detail({ title, externalId } = {}) {
    // The search response already carries everything a place has, so detail
    // re-runs it and picks the row by its OSM id — no second API shape to keep
    // in step, and no extra call when the id is the one just clicked.
    const { results } = await searchPlaces(String(title || ""), { limit: 8 });
    // Compared NORMALISED on both sides, for the same reason the id is stored
    // that way — a raw comparison misses whenever the two geocoders disagree.
    const want = normalizeOsmId(externalId);
    const hit = (results || []).find((r) => normalizeOsmId(r.osmId) === want) || results?.[0];
    return hit ? toResult(hit) : null;
  },
};
registerProvider(placesProvider);
