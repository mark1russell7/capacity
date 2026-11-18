import { defineConfig } from "tsdown";

// The build of the package for npm: an ES module and its declarations in build/. The workspace uses the source.
export default defineConfig({
  entry: { index: "src/index.ts", schema: "src/schema.ts" },
  outDir: "build",
  format: "esm",
  // A law is data and its value is math, thus the package also runs in a browser.
  platform: "neutral",
  fixedExtension: false,
  sourcemap: true,
  publint: true,
});
