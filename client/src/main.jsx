import React from 'react';
import ReactDOM from 'react-dom/client';
import "./index.css";
import reportWebVitals from './reportWebVitals';

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

if (previewOcc) {
  // Lightweight preview app — only loads the occurrence subtree
  import("./PagePreviewApp.jsx").then(({ default: PagePreviewApp }) => {
    root.render(<PagePreviewApp occurrenceId={previewOcc} />);
  });
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
