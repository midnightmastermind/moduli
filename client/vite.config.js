import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // TipTap editor — only loaded when a doc container is opened
          if (id.includes("@tiptap/")) return "tiptap";
          // Lucide icons — large icon library
          if (id.includes("lucide-react")) return "lucide";
          // Radix UI primitives
          if (id.includes("@radix-ui/")) return "radix";
          // Pragmatic DnD
          if (id.includes("@atlaskit/pragmatic-drag-and-drop")) return "dnd";
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
