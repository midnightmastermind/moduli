// utils/framingVerdict.js
//
// "Will this page let us put it in an iframe?" — answered from the response
// headers we already have, rather than guessed from a load timeout.
//
// The iframe view fetches every page anyway (reader mode), so the headers are
// free. Knowing beforehand is the difference between switching to a mode that
// works and showing a blank box for five seconds and then switching.
//
// TWO HEADERS DECIDE IT, and a third is a decoy:
//
//   x-frame-options: DENY | SAMEORIGIN     both refuse us — we are always a
//                                          different origin from the page
//   content-security-policy: frame-ancestors …   the modern form; 'none'
//                                          refuses, a list we are not on refuses
//   content-security-policy-REPORT-ONLY    DOES NOT BLOCK ANYTHING. It reports.
//
// That last one is why this is measured rather than remembered: a survey of the
// user's top domains listed google.com and instagram.com as "blocked", and both
// were sending REPORT-ONLY. Treating a report-only header as a refusal would
// send perfectly framable pages to the reader.

const DENY = /^\s*deny\s*$/i;
const SAMEORIGIN = /^\s*sameorigin\s*$/i;

/**
 * @param {object} h  { xFrameOptions, csp }  — raw header values, or null
 * @returns {{ framable: boolean, why: string|null }}
 *
 * Fails OPEN: with no relevant header the page is assumed framable, because
 * most of the web sends nothing and the frame is what the user asked for. A
 * wrong "yes" costs one blank frame the user can switch away from; a wrong "no"
 * silently withholds the live page.
 */
export function framingVerdict({ xFrameOptions = null, csp = null } = {}) {
  const xfo = typeof xFrameOptions === "string" ? xFrameOptions.trim() : "";
  if (DENY.test(xfo)) return { framable: false, why: "x-frame-options: deny" };
  if (SAMEORIGIN.test(xfo)) return { framable: false, why: "x-frame-options: sameorigin" };

  const policy = typeof csp === "string" ? csp : "";
  // `frame-ancestors` is the only directive that governs framing. Anything else
  // in a CSP — script-src, object-src — says nothing about it, and matching on
  // the header's mere presence would refuse most of the modern web.
  const m = /(?:^|;)\s*frame-ancestors\s+([^;]+)/i.exec(policy);
  if (m) {
    const sources = m[1].trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (sources.includes("'none'")) return { framable: false, why: "csp frame-ancestors 'none'" };
    if (sources.includes("*")) return { framable: true, why: null };
    // A list of specific origins. We are not any of them — this app is not the
    // site being framed — so anything other than a wildcard refuses us.
    // 'self' is the same statement as SAMEORIGIN.
    return { framable: false, why: `csp frame-ancestors ${sources.join(" ")}`.slice(0, 60) };
  }
  return { framable: true, why: null };
}
