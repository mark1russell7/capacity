// node --expose-gc alerts-start --tree DIR (--seeded DIR | --home DIR) --end MS --watch MS
//   [--snapshot] [--ballast BYTES@MOMENT ...] [--samples MS]
//
// The start program of the start subject alerts. With --seeded, it copies the store into a new folder, and it
// opens the copy. With --home, it opens the folder in place, with no copy, and it keeps the folder: the lab
// copied the store before the child. It opens the home with `openMeasuredRuntime` of the tree --tree, with
// the wall clock at --end, the time of the last event of the store. The start has no network and no key. It
// is ready at the end of its first pass, as a live start is.
//
// With --snapshot, the start reads and writes the snapshot of the start in the home, as a live start of the
// tree does. It also times each write of the snapshot (the option `timeSnapshot` of AL-115). An older tree
// ignores that option. Each --ballast starts a process that holds BYTES of resident memory, at the MOMENT `start` (before
// the import of the runtime) or `ready` (at the end of the first pass). With --samples, a worker samples the
// reads, the major faults and the resident set of the process, and the memory and the reads of its container.
//
// The program reads the memory of the process at ready, and the live heap after a full GC. Then it does
// the passes of a live loop for --watch milliseconds: it waits until the wake time of each pass. It keeps
// the peak of the memory over the watch. The GC profiler of V8 gives the heap peaks of the start and of the watch.
//
// The last line of the program is one JSON line, as a child line of `@mark1russell7/rigor-bench/fresh`:
// - `ms` is the time to ready: the import of the runtime, the open of the store and the first pass.
// - `readiness` is the time from the start of the process to the end of the open (`opened`), less the copy
//   and the ballasts of the moment `start`. The ready probe of a live start passes soon after this point.
//   `firstPass` is the time from `opened` to ready.
// - `startHeap` and `watchHeap` are the heap peaks of the start and of the watch (`watchHeap`).
// - `peakRss` is VmHWM at ready: the peak of the resident set of the start.
// - `ready` and `watch` are the memory at ready and the peak over the watch (`processMemory`, `watchMemory`).
// - `io` is the reads and the faults of the process at ready (`processIo`).
// - `live` is the used heap after a full GC at ready (`heapAfterGc`).
// - `passes` is the count of passes in the watch, and `limit` is the heap size limit of V8.
// - `stalled` tells that a pass gave a wake time that is not after the pass. Then no pass follows in the watch.
// - `copyMs` is the time of the copy of the store, before the start. `ballastMs` is the time of the ballasts
//   of the moment `start`, before the start. `closeMs` is the time of the close.
// - `ballasts` is each ballast: its bytes, its moment, its resident set and its time to fill.
// - `samples` is each sample of the worker, with `ms`, the time from the start of the process.
// - `writes` is the record of each write of the snapshot in the start and the watch (`snapshotWrites`). A tree
//   with no such record gives null.
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
import { heapAfterGc, processIo, processMemory, startBallast, watchHeap, watchIo, watchMemory, type Ballast, type IoWatch } from "@mark1russell7/rigor-bench/fresh";

const { values } = parseArgs({
  options: {
    tree: { type: "string" },
    seeded: { type: "string" },
    home: { type: "string" },
    end: { type: "string" },
    watch: { type: "string" },
    case: { type: "string" },
    snapshot: { type: "boolean" },
    ballast: { type: "string", multiple: true },
    samples: { type: "string" },
  },
});
if (values.tree === undefined || (values.seeded === undefined) === (values.home === undefined)) throw new RangeError("The program needs --tree, and --seeded or --home.");
const end = Number(values.end);
const watchMs = Number(values.watch);
if (!Number.isSafeInteger(end) || !(Number.isFinite(watchMs) && watchMs > 0)) throw new RangeError("--end is a whole number of milliseconds, and --watch is a time above 0.");

// The samples start first, thus they have the import of the runtime and the open.
const sampleMs = values.samples === undefined ? undefined : Number(values.samples);
if (sampleMs !== undefined && !(Number.isFinite(sampleMs) && sampleMs > 0)) throw new RangeError("--samples is a time above 0.");
const sampler: IoWatch | undefined = sampleMs === undefined ? undefined : watchIo(sampleMs);

/** A ballast flag is a whole number of bytes and a moment, for example `337641472@start`. */
interface BallastFlag {
  readonly bytes: number;
  readonly at: "start" | "ready";
}
const flags: readonly BallastFlag[] = (values.ballast ?? []).map((text) => {
  const [bytes = "", at = ""] = text.split("@");
  const value = Number(bytes);
  if (!(Number.isSafeInteger(value) && value > 0) || (at !== "start" && at !== "ready")) throw new RangeError(`The ballast "${text}" is not BYTES@start or BYTES@ready.`);
  return { bytes: value, at };
});

interface Pass {
  readonly at: number;
  readonly wakeAt?: number;
}
interface Measured {
  readonly opened: number;
  readonly first: Pass;
  // A tree before AL-115 has no record of the writes of the snapshot.
  readonly snapshotWrites?: readonly unknown[];
  pass(): Promise<Pass>;
  close(): Promise<void>;
}
interface Clock {
  now(): number;
}

// The wall clock comes from the algebra of the tree, as the runtime of the tree reads it.
const fromTree = createRequire(join(values.tree, "packages/runtime/package.json"));
const clock = (await import(pathToFileURL(fromTree.resolve("@mark1russell7/algebra/clock")).href)) as { readonly wallClock: (options: { readonly start: number }) => Clock };

let home: string;
let copyMs = 0;
if (values.home === undefined) {
  home = mkdtempSync(join(tmpdir(), "alerts-start-"));
  const copied = performance.now();
  cpSync(values.seeded!, home, { recursive: true });
  copyMs = performance.now() - copied;
} else {
  home = values.home;
}

// The ballasts of the moment `start` are the other processes of the target. They hold their memory before the start.
const ballasts: { readonly flag: BallastFlag; readonly ballast: Promise<Ballast> }[] = [];
const filling = performance.now();
for (const flag of flags.filter((each) => each.at === "start")) {
  const ballast = startBallast(flag.bytes);
  ballasts.push({ flag, ballast });
  await ballast;
}
const ballastMs = performance.now() - filling;

const wall = clock.wallClock({ start: end });
const startHeap = watchHeap();
const started = performance.now();
const runtime = (await import(pathToFileURL(join(values.tree, "packages/runtime/src/measured-start.ts")).href)) as {
  readonly openMeasuredRuntime: (home: string, options: { readonly wall: Clock; readonly startSnapshot?: boolean; readonly timeSnapshot?: boolean }) => Promise<Measured>;
};
const measured = await runtime.openMeasuredRuntime(home, { wall, ...(values.snapshot === true ? { startSnapshot: true, timeSnapshot: true } : {}) });
const ms = performance.now() - started;
const heapOfStart = startHeap.stop();
const { opened } = measured;
// A tree with no field opened is a tree with no graft of the measured start. The line has no readiness then.
const readiness = typeof opened === "number" ? opened - copyMs - ballastMs : null;
const firstPass = typeof opened === "number" ? started + ms - opened : null;
const io = processIo();
const ready = processMemory();
const live = heapAfterGc();

// The ballasts of the moment `ready` start at the end of the first pass. The watch does not wait for them.
for (const flag of flags.filter((each) => each.at === "ready")) ballasts.push({ flag, ballast: startBallast(flag.bytes) });

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
const writes = Array.isArray(measured.snapshotWrites) ? measured.snapshotWrites : null;
// The home of --home stays: the lab keeps it as the store of a later point, or it removes it.
if (values.home === undefined) rmSync(home, { recursive: true, force: true });

// Each ballast stops after the close, as the other processes of the target live on after a start.
const held = [];
for (const { flag, ballast } of ballasts) {
  const each = await ballast;
  await each.stop();
  held.push({ bytes: flag.bytes, at: flag.at, rss: each.rss, ms: each.ms });
}
const samples = sampler === undefined ? [] : (await sampler.stop()).map(({ at, ...sample }) => ({ ms: at - performance.timeOrigin, ...sample }));

const line = {
  ms,
  readiness,
  firstPass,
  peakRss: ready.peakRss,
  ready,
  io,
  live,
  startHeap: heapOfStart,
  watch: watched,
  watchHeap: watchedHeap,
  passes,
  stalled,
  limit: getHeapStatistics().heap_size_limit,
  copyMs,
  ballastMs,
  closeMs,
  ballasts: held,
  samples,
  writes,
  open: process.getActiveResourcesInfo(),
  endMs: performance.now(),
};
// A resource that the close left open keeps the process alive. The line names it, and the exit does not wait for it.
process.stdout.write(`${JSON.stringify(line)}\n`, () => process.exit(0));
