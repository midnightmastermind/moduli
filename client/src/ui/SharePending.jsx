// ui/SharePending.jsx — the page a phone/Windows share lands on.
//
// Reached four ways (share plan 3):
//   /share-pending?id=<id>      the service worker stashed a share_target POST
//   /share-pending?error=<msg>  the worker, or the server's fallback, could not
//   /share-target  (launch)     Windows "Open with" an .ics → files in launchQueue
//   /share-target?url=webcal:…  the webcal:// protocol handler
//
// It takes the share, posts it to /api/v1/share with the SIGNED-IN SESSION as
// the Bearer (the route accepts it — server middleware/apiAuth allowSessionJwt),
// and says exactly what happened. A share must never vanish or look like it
// worked when it did not (spec §12) — which is why this page exists at all
// rather than redirecting straight into the grid.
//
// Rendered on its own (main.jsx), without the grid app: it must work before the
// grid has loaded and when nobody is signed in.
import React, { useEffect, useRef, useState } from "react";
import { AUTH_KEYS } from "../helpers/authStorage";
import {
  takeStashedShare, partsFromForm, buildShareForm, shareSourceFor, describeShareResult,
} from "../helpers/shareHandoff";

const readToken = () => { try { return localStorage.getItem(AUTH_KEYS.token); } catch { return null; } };
const userZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; } };

/** Resolve what was shared, from whichever of the four entry points this is. */
async function receiveShare({ location = window.location, launchQueue = window.launchQueue } = {}) {
  const params = new URLSearchParams(location.search);
  if (params.get("error")) return { error: params.get("error") };
  if (params.get("id")) {
    const form = await takeStashedShare(params.get("id"));
    if (!form) return { error: "That share was already filed (or it expired). Share it again if it isn't in Moduli." };
    return { parts: partsFromForm(form) };
  }
  if (location.pathname === "/share-target") {
    if (params.get("url")) return { parts: { url: params.get("url") } };
    if (launchQueue?.setConsumer) {
      // Windows "Open with": the files arrive through launchQueue, not the URL.
      const files = await new Promise((resolve) => {
        const t = setTimeout(() => resolve([]), 2500);
        launchQueue.setConsumer(async (p) => {
          clearTimeout(t);
          resolve(await Promise.all((p?.files || []).map((h) => h.getFile())));
        });
      });
      if (files.length) return { parts: { files } };
    }
  }
  return { error: "Nothing was shared to Moduli." };
}

export async function fileShare({ fetchImpl = fetch, token = readToken(), ...where } = {}) {
  const got = await receiveShare(where);
  if (got.error) return { ok: false, message: got.error };
  if (!token) return { ok: false, message: "Sign in to Moduli on this device, then share again.", needsSignIn: true };
  const body = buildShareForm(got.parts, { source: shareSourceFor(navigator.userAgent), timeZone: userZone() });
  const res = await fetchImpl("/api/v1/share", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body });
  const json = await res.json().catch(() => ({}));
  return describeShareResult(res.status, json);
}

export default function SharePending() {
  const [state, setState] = useState({ status: "working" });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;       // once: the stash is consumed on read
    started.current = true;
    fileShare()
      .then((r) => setState({ status: r.ok ? "done" : "error", ...r }))
      .catch((e) => setState({ status: "error", message: String(e?.message || e) }));
  }, []);

  const box = {
    maxWidth: 420, margin: "15vh auto 0", padding: 20, borderRadius: 10,
    fontFamily: "system-ui, sans-serif", lineHeight: 1.5,
    background: "var(--surface-1, #1b1b1f)", color: "var(--text-primary, #eee)",
    border: "1px solid var(--border-default, #333)",
  };
  return (
    <div style={{ minHeight: "100vh", background: "var(--body-bg, #111)", padding: 16 }}>
      <div style={box} data-testid="share-pending">
        {state.status === "working" && <p>Filing your share…</p>}
        {state.status === "error" && (
          <>
            <p role="alert" style={{ color: "var(--danger, #f87171)" }}>Couldn’t file that: {state.message}</p>
            {state.needsSignIn && <p><a href="/login">Sign in</a></p>}
          </>
        )}
        {state.status === "done" && (
          <>
            <p><strong>{state.updated ? "Already in Moduli — updated." : "Filed."}</strong> {state.message}</p>
            {state.title && <p style={{ opacity: 0.8 }}>{state.title}</p>}
            {(state.notices || []).map((n) => <p key={n} style={{ opacity: 0.8 }}>Note: {n}</p>)}
          </>
        )}
        <p><a href="/">Open Moduli</a></p>
      </div>
    </div>
  );
}
