import { defineConfig } from "vitest/config";
import os from "os";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    cache: {
      dir: path.join(os.tmpdir(), "vitest-server"),
    },
  },
});
