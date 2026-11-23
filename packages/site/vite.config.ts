import { defineConfig } from "vite";

// The Pages workflow sets SITE_BASE to "/capacity". A local build uses the root.
const site = process.env["SITE_BASE"];

export default defineConfig({
  base: site ? `${site.replace(/\/$/, "")}/` : "/",
  build: { target: "es2022" },
  // The globs of src/data.ts import single fields of each law file. Thus the page keeps only those fields, and not the replicates.
  json: { namedExports: true, stringify: false },
});
