// 0230 — the Location map `0229` recorded as impossible, and it was not.
//
// `0229` closed with a list of what it deliberately did not map. The first line
// read:
//
//     Location   `Address` is type `address`, which the mapper cannot write
//
// **That was a property of OUR OWN ALLOWLIST, not of the field.**
// `mapProviderFields` kept a `WRITABLE_TYPES` set that happened to omit
// `address`, and the reason got written down as though the field could not hold
// a provider's string. It can, and it already does:
//
//   • `readAddress` (helpers/geocode.js) documents TWO legal shapes — the
//     picker's object with coordinates, and a bare STRING.
//   • TEN People rows on poms grid have carried the bare string since long
//     before any provider existed. The header there says so in as many words:
//     *"Those are still perfectly good addresses; they just have no
//     coordinates."*
//
// So this maps `Address` -> `Address`, and the type is now on the allowlist.
//
// ── MEASURED AGAINST THE LIVE PROVIDER, NOT DOCUMENTATION ─────────────────
//
//     places "Froedtert Hospital Milwaukee" -> Froedtert Hospital
//       Address    9200 West Wisconsin Avenue, Milwaukee, WI, 53226, United States
//       Kind       hospital
//       Latitude   43.0413956
//       Longitude  -88.024...
//
// ── AND ONLY `Address` IS MAPPED, out of four keys ────────────────────────
//
//   Latitude/Longitude  poms grid has NO field of either name. Minting a pair
//                       to hold numbers nothing renders is authoring a feature
//                       nobody asked for.
//   Kind                likewise no field. `Board Category` is the tag that
//                       PUTS a row on the Places board and is not a synonym for
//                       "hospital".
//
// **The coordinates are therefore dropped, and that costs nothing today.** The
// mini-map was deleted at the user's own request (*"we dont need an image for
// it"*, 2026-08-08 (2)) and no surface reads lat/lon. If a pin is ever wanted,
// the fix is a richer value at the MAPPER, not a different field map here.
//
// The authoring loop is `0229`'s, imported rather than copied — it carries the
// refusals that matter (a field configured for a different provider is skipped,
// an existing map is never overwritten) and two copies would drift.

import { authorFieldMaps } from "./0229-author-the-field-maps.mjs";

/** Only `fields` documents are written, so the pre-migration snapshot does not
 *  need to read every occurrence on the grid. The runner scopes it only when
 *  EVERY pending migration declares this. */
export const touches = ["fields"];

export const id = "0230-location-takes-the-geocoders-address";
export const description = "Map the places provider's Address onto the Address field";

export const AUTHORED = [
  { field: "Location", provider: "places", map: { Address: "Address" } },
];

export async function up(ctx) {
  return authorFieldMaps({ entries: AUTHORED, ...ctx });
}
