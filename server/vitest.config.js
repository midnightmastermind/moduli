import { defineConfig } from "vitest/config";
import os from "os";
import path from "path";

export default defineConfig({
  // Vitest's cache lives under `<cacheDir>/vitest`. Top-level `cacheDir`
  // replaces the deprecated `test.cache.dir`.
  cacheDir: path.join(os.tmpdir(), "vitest-server"),
  test: {
    globals: true,
    environment: "node",
  },
});
