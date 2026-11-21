import type { StartSubject } from "../start.ts";

const MIB = 1024 * 1024;

/**
 * This subject is the runtime of the public application alerts: a service that folds an event log into its
 * state at each start. Layer 3 of the lab measures its start as the log grows.
 *
 * - The seed program writes the log `runtime.sqlite`, the cache `shapes.sqlite` and the copy of the transit
 *   catalog with `seedStore` of the testkit of alerts. The variables are the byte sizes of the three files.
 * - The start program opens a copy of the store with `openMeasuredRuntime` of the runtime, with no network and
 *   no key. The start is ready at the end of its first pass, as a live start is.
 */
export const ALERTS: StartSubject = {
  name: "alerts",
  repository: "https://github.com/metrograph-labs/alerts.git",
  install: ["pnpm", "install", "--frozen-lockfile"],
  // The graft is the entry of the measure in the runtime. The typecheck of the runtime checks it against its tree.
  check: ["pnpm", "--filter", "@mark1russell7/alerts-runtime", "run", "typecheck"],
  variables: {
    log: { unit: "B", min: MIB, max: 4096 * MIB },
    shapes: { unit: "B", min: 0, max: 256 * MIB },
    transit: { unit: "B", min: 0, max: 64 * MIB },
  },
  seed: "alerts-seed.main.ts",
  start: "alerts-start.main.ts",
};
