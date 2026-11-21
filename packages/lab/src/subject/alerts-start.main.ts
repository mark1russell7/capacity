// node --expose-gc alerts-start --tree DIR --seeded DIR --end MS --watch MS
//
// The start program of the start subject alerts. It copies the store --seeded into a new folder. Then it
// opens the copy with `openMeasuredRuntime` of the tree --tree, with the wall clock at --end, the time of
// the last event of the store. The start has no network and no key. It is ready at the end of its first pass.
//
// The program reads the memory of the process at ready, and the live heap after a full GC. Then it does
// the passes of a live loop for --watch milliseconds: it waits until the wake time of each pass. It keeps
// the peak of the memory over the watch. The GC profiler of V8 gives the heap peaks of the start and of the watch.
//
// The last line of the program is one JSON line, as a child line of `@mark1russell7/rigor-bench/fresh`:
// - `ms` is the time to ready: the import of the runtime, the open of the store and the first pass.
// - `readiness` is the time from the start of the process to the end of the open (`opened`), less the copy.
//   The ready probe of a live start passes soon after this point. `firstPass` is the time from `opened` to ready.
// - `startHeap` and `watchHeap` are the heap peaks of the start and of the watch (`watchHeap`).
// - `peakRss` is VmHWM at ready: the peak of the resident set of the start.
// - `ready` and `watch` are the memory at ready and the peak over the watch (`processMemory`, `watchMemory`).
// - `live` is the used heap after a full GC at ready (`heapAfterGc`).
// - `passes` is the count of passes in the watch, and `limit` is the heap size limit of V8.
// - `stalled` tells that a pass gave a wake time that is not after the pass. Then no pass follows in the watch.
// - `copyMs` is the time of the copy of the store, before the start. `closeMs` is the time of the close.
// - `endMs` is the time from the start of the process to the line.
// - `open` names the resources after the close.

import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { getHeapStatistics } from "node:v8";
import { heapAfterGc, processMemory, watchHeap, watchMemory } from "@mark1russell7/rigor-bench/fresh";

const { values } = parseArgs({
  options: { tree: { type: "string" }, seeded: { type: "string" }, end: { type: "string" }, watch: { type: "string" }, case: { type: "string" } },
});
if (values.tree === undefined || values.seeded === undefined) throw new RangeError("The program needs --tree and --seeded.");
const end = Number(values.end);
const watchMs = Number(values.watch);
if (!Number.isSafeInteger(end) || !(Number.isFinite(watchMs) && watchMs > 0)) throw new RangeError("--end is a whole number of milliseconds, and --watch is a time above 0.");

interface Pass {
  readonly at: number;
  readonly wakeAt?: number;
}
interface Measured {
  readonly opened: number;
  readonly first: Pass;
  pass(): Promise<Pass>;
  close(): Promise<void>;
}
interface Clock {
  now(): number;
}

// The wall clock comes from the algebra of the tree, as the runtime of the tree reads it.
const fromTree = createRequire(join(values.tree, "packages/runtime/package.json"));
const clock = (await import(pathToFileURL(fromTree.resolve("@mark1russell7/algebra/clock")).href)) as { readonly wallClock: (options: { readonly start: number }) => Clock };

const home = mkdtempSync(join(tmpdir(), "alerts-start-"));
const copied = performance.now();
cpSync(values.seeded, home, { recursive: true });
const copyMs = performance.now() - copied;

const wall = clock.wallClock({ start: end });
const startHeap = watchHeap();
const started = performance.now();
const runtime = (await import(pathToFileURL(join(values.tree, "packages/runtime/src/measured-start.ts")).href)) as {
  readonly openMeasuredRuntime: (home: string, options: { readonly wall: Clock }) => Promise<Measured>;
};
const measured = await runtime.openMeasuredRuntime(home, { wall });
const ms = performance.now() - started;
const heapOfStart = startHeap.stop();
const { opened } = measured;
// A tree with no field opened is a tree with no graft of the measured start. The line has no readiness then.
const readiness = typeof opened === "number" ? opened - copyMs : null;
const firstPass = typeof opened === "number" ? started + ms - opened : null;
const ready = processMemory();
const live = heapAfterGc();

const watch = watchMemory();
const heapOfWatch = watchHeap();
const until = performance.now() + watchMs;
let last = measured.first;
let passes = 0;
let stalled = false;
for (;;) {
  const left = until - performance.now();
  if (left <= 0) break;
  // As in the live loop, a pass with no wake time starts no timer, and a wake time that is not after the pass is a defect.
  stalled = typeof last.wakeAt === "number" && !(last.wakeAt > last.at);
  const wake = typeof last.wakeAt === "number" && !stalled ? last.wakeAt - wall.now() : left;
  if (wake >= left) {
    await sleep(left);
    break;
  }
  if (wake > 0) await sleep(wake);
  last = await measured.pass();
  passes += 1;
}
const watched = watch.peak();
watch.stop();
const watchedHeap = heapOfWatch.stop();
const closing = performance.now();
await measured.close();
const closeMs = performance.now() - closing;
rmSync(home, { recursive: true, force: true });

const line = {
  ms,
  readiness,
  firstPass,
  peakRss: ready.peakRss,
  ready,
  live,
  startHeap: heapOfStart,
  watch: watched,
  watchHeap: watchedHeap,
  passes,
  stalled,
  limit: getHeapStatistics().heap_size_limit,
  copyMs,
  closeMs,
  open: process.getActiveResourcesInfo(),
  endMs: performance.now(),
};
// A resource that the close left open keeps the process alive. The line names it, and the exit does not wait for it.
process.stdout.write(`${JSON.stringify(line)}\n`, () => process.exit(0));
