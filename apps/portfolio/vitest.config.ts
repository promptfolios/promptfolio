import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // The same alias as `tsconfig.json`, so tests can load modules that use it, such as routes.
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
});
