import React from 'react';
import ReactDOM from 'react-dom/client';

// ── FONTS ────────────────────────────────────────────────────────────────
// `--font-mono` has named "JetBrains Mono" since the first stylesheet and the
// package has been a dependency for months — and it was NEVER IMPORTED, so no
// webfont was ever served (checked 2026-08-19: no @font-face in the sheet, no
// .woff2 in dist, none served by production). Every machine fell through to its
// own `ui-monospace`, which is why the app looked subtly different on Windows,
// macOS and Linux. Importing it is the fix; the latin subsets keep it small.
//
// The two pixel faces belong to the Stardew skin (`--font-display` /
// `--font-pixel`). They are imported here rather than lazily because a skin
// that swaps the font AFTER first paint reflows the entire grid.
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-500.css";
import "@fontsource/silkscreen/latin-400.css";
import "@fontsource/silkscreen/latin-700.css";
import "@fontsource/vt323/latin-400.css";

import "./index.css";
import reportWebVitals from './reportWebVitals';
import { hasSession } from "./helpers/authStorage.js";
import { PROMO_PATHS } from "./promo/promoPaths.js";

// Polyfill crypto.randomUUID for insecure contexts (LAN/WSL IPs over http).
// crypto.getRandomValues is available everywhere; only randomUUID is
// secure-context-gated. Without this, dozens of unguarded crypto.randomUUID()
// callsites crash on grid load when the SPA is opened from a non-localhost URL.
if (globalThis.crypto && typeof globalThis.crypto.randomUUID !== "function") {
  globalThis.crypto.randomUUID = function randomUUID() {
    const b = new Uint8Array(16);
    globalThis.crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
}

const root = ReactDOM.createRoot(document.getElementById("root"));

// Check for preview mode — iframe thumbnails pass ?previewOcc=<occId>
const params = new URLSearchParams(window.location.search);
const previewOcc = params.get("previewOcc");

// Which of the three apps is this?
//
//   previewOcc      the iframe thumbnail renderer (unchanged)
//   promo           the public site — no session, or an explicitly public path
//   App             the grid
//
// The decision is SYNCHRONOUS and reads only localStorage, so a visitor with no
// session never begins downloading the grid chunk. A path under PROMO_PATHS
// wins even with a session: a signed-in user clicking "Features" should read
// the feature page, not be bounced into the app.
const isPromoPath = (p) =>
  PROMO_PATHS.some((base) => p === base || p.startsWith(base + "/"));

if (previewOcc) {
  // Lightweight preview app — only loads the occurrence subtree
  import("./PagePreviewApp.jsx").then(({ default: PagePreviewApp }) => {
    root.render(<PagePreviewApp occurrenceId={previewOcc} />);
  });
} else if (!hasSession() || isPromoPath(window.location.pathname)) {
  const PromoApp = React.lazy(() => import("./promo/PromoApp.jsx"));
  root.render(
    <React.Suspense fallback={null}>
      <PromoApp />
    </React.Suspense>
  );
} else {
  // Full app
  const App = React.lazy(() => import("./App"));
  root.render(
    <React.Suspense fallback={null}>
      <App />
    </React.Suspense>
  );
}

reportWebVitals();
