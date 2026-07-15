import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // The render worker lazily imports the bundled BOSL2 library, which splits it
  // into a separate chunk; ES module workers support code-splitting (the worker
  // is already created with { type: "module" }), IIFE workers do not.
  worker: {
    format: "es"
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "functions/**/*.test.ts"],
    setupFiles: ["src/test/setup.ts"]
  }
});
