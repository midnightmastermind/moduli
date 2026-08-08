// helpers/geocode.js
// ============================================================
// CLIENT-SIDE readers for a location. This module deliberately does NOT know
// anything about Nominatim: the geocoder's response shape is parsed on the
// server (server/utils/geocode.js), where the fetch happens, and the client
// only ever sees the already-normalized `{ label, address, lat, lon, osmId }`.
//
// A LOCATION lives on the artifact MODULE's `meta.location` — it is a property
// of the place itself, not of where the place has been placed. An occurrence
// override is honoured so one copy can be nudged without forking the place.
// ============================================================

const num = (v) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * A latitude outside ±90 or a longitude outside ±180 is not a slow map, it is
 * a wrong one. Reject rather than clamp — a clamped coordinate silently pins
 * the wrong place, which is worse than showing nothing.
 */
export function isValidLatLon(lat, lon) {
  const la = num(lat), lo = num(lon);
  return la !== null && lo !== null
    && la >= -90 && la <= 90
    && lo >= -180 && lo <= 180;
}

/**
 * The object a location artifact carries in `module.meta.location`. Built here
 * so a HAND-ENTERED location (no geocoder involved) has exactly the same shape
 * as a searched one — nothing downstream should be able to tell them apart.
 * Returns null rather than a partial, so a caller cannot mint a location that
 * cannot be drawn.
 */
export function buildLocationMeta({ label, address = "", lat, lon, osmId = null }) {
  if (!isValidLatLon(lat, lon)) return null;
  const name = String(label || "").trim();
  if (!name) return null;
  return {
    label: name,
    address: String(address || "").trim(),
    lat: num(lat),
    lon: num(lon),
    osmId: osmId || null,
  };
}

/** Read a location off an occurrence, falling back to its module. */
export function locationOf(occurrence, module) {
  const fromOcc = occurrence?.meta?.location;
  if (fromOcc && isValidLatLon(fromOcc.lat, fromOcc.lon)) return fromOcc;
  const fromMod = module?.meta?.location;
  if (fromMod && isValidLatLon(fromMod.lat, fromMod.lon)) return fromMod;
  return null;
}

/**
 * True when this field holds an ADDRESS. The FIELD TYPE is the marker — not a
 * `meta.isAddress` flag — so "this input gets a map search" is something the
 * system can introspect rather than something a component hardcodes.
 *
 * NOTE the division of labour, because it is the whole design:
 *   • `address`    — the searchable thing. Holds the address text, the
 *                    coordinates, and the mini-map. Bound on a Location
 *                    option, and equally on a Person (a home address is an
 *                    address), so the search works everywhere addresses live.
 *   • `occurrence` — "Location" itself is an ordinary occurrence dropdown
 *                    into the Locations container. It gains nothing special;
 *                    the address-typed field on each OPTION does the work.
 */
export function isAddressField(field) {
  return field?.type === "address";
}

/** Human-readable coordinates, for a title attribute or a copy button. */
export function formatLatLon(lat, lon, digits = 5) {
  if (!isValidLatLon(lat, lon)) return "";
  return `${num(lat).toFixed(digits)}, ${num(lon).toFixed(digits)}`;
}

/**
 * A deep link that opens the place in whatever map app the device prefers.
 * Uses the OSM URL scheme, which every major maps app and browser handles.
 * Prefers coordinates over the address string: an address can be ambiguous,
 * a coordinate cannot.
 */
export function mapLinkFor(location) {
  if (!location || !isValidLatLon(location.lat, location.lon)) return null;
  const { lat, lon } = location;
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`;
}
