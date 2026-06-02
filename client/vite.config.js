import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import os from "os";

export default defineConfig({
  plugins: [react()],
  // Vitest's per-project cache lives under `<cacheDir>/vitest`. Top-level
  // `cacheDir` replaces the deprecated `test.cache.dir`.
  cacheDir: path.join(os.tmpdir(), "vitest-client"),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    sourcemap: true,
    // Bumped from 800 kB. The two remaining large chunks are intentional
    // lazy splits, not initial-load cost:
    //   - highlight.js (~969 kB) — only loaded when user opens a code
    //     file in ArtifactContent's CodeViewer
    //   - ModulePage  (~761 kB) — only loaded after React.lazy resolves
    //     on first grid render
    // Initial entry is ~3 kB; the app shell is split across react /
    // radix / dnd / App chunks each well under the warning threshold.
    chunkSizeWarningLimit: 1024,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // ── Big editor / viewer libs (lazy when not opened) ────────────
          if (id.includes("@tiptap/")) return "tiptap";
          if (id.includes("pdfjs-dist")) return "pdf";
          if (id.includes("wavesurfer.js")) return "wavesurfer";
          if (id.includes("highlight.js")) return "highlight";
          if (id.includes("tesseract.js")) return "tesseract";
          // ── Vendor UI / DnD ────────────────────────────────────────────
          if (id.includes("lucide-react")) return "lucide";
          if (id.includes("@radix-ui/")) return "radix";
          if (id.includes("@atlaskit/pragmatic-drag-and-drop")) return "dnd";
          // Date picker (and its plugins / styles)
          if (id.includes("react-multi-date-picker")) return "datepicker";
          // ── React core split out so route/lazy chunks don't duplicate ──
          if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/") || id.includes("node_modules/scheduler/")) {
            return "react";
          }
          // ── Socket / state libs ────────────────────────────────────────
          if (id.includes("socket.io-client") || id.includes("engine.io-client")) return "socketio";
          if (id.includes("sonner")) return "toast";
        },
      },
    },
  },
  server: {
    port: 3000,
    strictPort: true,
    proxy: {
      // Proxy socket.io WebSocket + HTTP polling through Vite → avoids WSL2 port 5000 firewall issues
      "/socket.io": {
        target: "http://localhost:5000",
        ws: true,
        changeOrigin: true,
      },
      // Proxy REST API calls
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
      // Proxy preview render pages (iframe thumbnails)
      "/preview-render": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/__tests__/setup.js"],
    include: ["src/__tests__/**/*.test.{js,jsx}"],
    coverage: {
      reporter: ["text", "json", "html"],
    },
  },
});
