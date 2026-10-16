// server/migrations/0404-day-page-reading-markers.mjs
//
// User 2026-10-15: "look through my books and query which ones can be daily devotionals". A daily
// e-book heads each day "October 15th" inside an <h3>, with the day's title glued on after a
// <br> — read as "### October 15th THE DAY TITLE…". 0402's markers were `^October 15\b` and
// `^(Month) \d+\b`: no `#` allowed in front, and a word boundary required after the number, so an
// ordinal ("15th") never matched. This rewrites the caller's two markers to 0402's new ones (a heading's
// `#`s allowed, the number not followed by another digit). Daily Reflections ("OCTOBER 15") still matches.

import { CALLER, CALLEE, NEXT_DAY_MARKER, dayMarker } from "./0402-day-page-readings.mjs";

export const id = "0404-day-page-reading-markers";
export const describe = "Day page readings: the day markers also match a heading and an ordinal (\"### October 15th\").";
export const touches = ["operations"];

/** PURE. Every RUN_OPERATION of the callee in `steps` gets the new markers. Returns how many changed. */
export function rewriteMarkers(steps) {
  let n = 0;
  const walk = (list) => {
    for (const s of list || []) {
      const c = s.config;
      if (s.type === "action" && c?.type === "RUN_OPERATION" && c.operationName === CALLEE && c.vars) {
        const from = dayMarker("${$md}"), to = `literal:${NEXT_DAY_MARKER}`;
        if (c.vars.$from !== from || c.vars.$to !== to) { c.vars.$from = from; c.vars.$to = to; n++; }
      }
      walk(s.then); walk(s.else); walk(s.body);
    }
  };
  walk(steps);
  return n;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation } = models;
  const op = await Operation.findOne({ gridId, name: CALLER }).lean();
  if (!op) { log(`no "${CALLER}" on this grid`); return; }
  const steps = JSON.parse(JSON.stringify(op.pipeline?.steps || []));
  const n = rewriteMarkers(steps);
  log(n ? `${CALLER}: ${n} RUN_OPERATION step(s) get the new markers` : `${CALLER}: markers already current`);
  if (!n || dryRun) return;
  await Operation.updateOne({ id: op.id }, { $set: { "pipeline.steps": steps } });
  const back = await Operation.findOne({ id: op.id }).lean();
  if (rewriteMarkers(JSON.parse(JSON.stringify(back.pipeline.steps)))) throw new Error("0404: markers did not stick");
  log("done. Restart the server (pm2).");
}
