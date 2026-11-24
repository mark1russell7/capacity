// node --expose-gc [the options of Node of the run] app-start --run FILE --case POINT (--seeded DIR | --home DIR)
//   --watch MS [--ballast BYTES@MOMENT ...] [--samples MS]
//
// The start program of an app case. The lab writes the run file --run from the contract `capacity-app.json` of a tree.
// The program starts the run of the contract in its own process: it sets the arguments, the folder and the environment of
// the run, and it imports the script of the run. Thus the container holds the process of the app and no second process
// of the lab, as the target does. The child has the same measures as the start programs of the other subjects.
//
// With --seeded, the program copies the store into a new folder, and the app opens the copy. With --home, the app opens
// the folder in place: the lab copied the store before the child. The folder is the placeholder `{store}` of the run.
// A run with the placeholder `{port}` gets a free port of the loopback. Each --ballast starts a process that holds BYTES
// of resident memory, at the MOMENT `start` (before the import of the app) or `ready` (at the ready signal). With
// --samples, a worker samples the reads, the major faults and the resident set of the process.
//
// The app is ready at its ready signal. A signal `line` is a write of the text of the signal to stdout or to stderr. A
// signal `http` is the first status 200 of the path, with a probe each 10 milliseconds. After the signal, the program
// watches the memory for --watch milliseconds. Then it stops the ballasts and the samples, and it sends SIGTERM to its
// own process: the listeners of the app close it. The close ends at the exit of the process.
//
// The last line of the program is one JSON line, as a child line of `@mark1russell7/rigor-bench/fresh`:
// - `ms` is the time from the import of the app to the ready signal.
// - `readiness` is the time from the start of the process to the ready signal, less the copy and the ballasts of the
//   moment `start`. `firstPass` and `passes` are null, because an app has no pass of the lab.
// - `startHeap` and `watchHeap` are the heap peaks of the start and of the watch.
// - `watchCpu` is the CPU time of the process over the watch, in milliseconds, and `watchMs` is the time of the watch. The
//   CPU time has the load of the fakes on the app, and the small work of the watch of the memory.
// - `peakRss` is VmHWM at ready. `ready` and `watch` are the memory at ready and the peak over the watch.
// - `io` is the reads and the faults of the process at ready. `live` is the used heap after a full GC at ready.
// - `limit` is the heap size limit of V8. `copyMs` and `ballastMs` are the times of the copy and of the ballasts of the
//   moment `start`.
// - `closeMs` is the time from SIGTERM to the exit. It is null when the app has no listener of SIGTERM, because then
//   the signal ends the process at once. It is also null when the app does not end in 10 seconds. `closeCode` is the
//   exit code of the app after the close.
// - `ballasts` is each ballast, and `samples` is each sample of the worker, with `ms` from the start of the process.
// - `open` names the resources at the line. `endMs` is the time from the start of the process to the line.
//
// An app that ends before the end of the watch, or whose import fails, ends the child with the exit code 1.

import { cpSync, mkdtempSync, readFileSync, rmSync, writeSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { getHeapStatistics } from "node:v8";
import { heapAfterGc, processIo, processMemory, startBallast, watchHeap, watchIo, watchMemory, type Ballast, type IoWatch } from "@mark1russell7/rigor-bench/fresh";
import { errorMessage } from "@mark1russell7/text";
import type { AppRunFile } from "../start-app.ts";
import { READY_POLL_MS, httpProbe, textWatch } from "./ready.ts";
/** This time is the longest close, in milliseconds. It is in the margin of the time limit of a child. */
const CLOSE_GRACE_MS = 10_000;

const { values } = parseArgs({
  options: {
    run: { type: "string" },
    case: { type: "string" },
    seeded: { type: "string" },
    home: { type: "string" },
    watch: { type: "string" },
    ballast: { type: "string", multiple: true },
    samples: { type: "string" },
  },
});
// The lab gives --case to each start program. The run of an app is the same at each point, thus the program does not read it.
if (values.run === undefined || (values.seeded === undefined) === (values.home === undefined)) throw new RangeError("The program needs --run, and --seeded or --home.");
const watchMs = Number(values.watch);
if (!(Number.isFinite(watchMs) && watchMs > 0)) throw new RangeError("--watch is a time above 0.");

// The samples start first, thus they have the import of the app.
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

const run = JSON.parse(readFileSync(values.run, "utf8")) as AppRunFile;

let home: string;
let copyMs = 0;
if (values.home === undefined) {
  home = mkdtempSync(join(tmpdir(), "app-start-"));
  const copied = performance.now();
  cpSync(values.seeded!, home, { recursive: true });
  copyMs = performance.now() - copied;
} else {
  home = values.home;
}

/** This function gives a free port of the loopback. */
const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => (typeof address === "object" && address !== null ? resolve(address.port) : reject(new Error("The loopback gave no port."))));
    });
  });
const port = run.slots.port === undefined ? undefined : String(await freePort());

/** This function puts the folder of the store and the port into a text of the run, in place of the tokens of the lab. */
const filled = (text: string): string => {
  let out = text.replaceAll(run.slots.store, home);
  if (run.slots.port !== undefined && port !== undefined) out = out.replaceAll(run.slots.port, port);
  return out;
};

// The ballasts of the moment `start` are the other processes of the target. They hold their memory before the start.
const ballasts: { readonly flag: BallastFlag; readonly ballast: Promise<Ballast> }[] = [];
const filling = performance.now();
for (const flag of flags.filter((each) => each.at === "start")) {
  const ballast = startBallast(flag.bytes);
  ballasts.push({ flag, ballast });
  await ballast;
}
const ballastMs = performance.now() - filling;

// The state of the child: the exit of the app before the line is a failure of the app.
let state: "start" | "close" | "done" = "start";
const fail = (why: string): void => {
  if (state !== "start") return;
  state = "done";
  writeSync(2, `app-start: ${why}\n`);
  process.exitCode = 1;
};
process.on("exit", (code) => fail(`The app "${run.app}" ended with the code ${code} before the end of the watch.`));

let readyAt: number | undefined;
let signal: () => void = () => undefined;
const signalled = new Promise<void>((resolve) => {
  signal = resolve;
});
const mark = (): void => {
  if (readyAt !== undefined) return;
  readyAt = performance.now();
  signal();
};
const { ready } = run;
if (ready.kind === "line") {
  // Each write of the app to stdout or to stderr goes through this check, until the ready signal.
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream) as (...args: unknown[]) => boolean;
    const seen = textWatch(ready.text);
    stream.write = ((chunk: unknown, ...rest: unknown[]): boolean => {
      if (readyAt === undefined && seen(typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString("utf8"))) mark();
      return write(chunk, ...rest);
    }) as typeof stream.write;
  }
}
const http = ready.kind === "http" ? await import("node:http") : undefined;

// The arguments, the folder and the environment of the run. The script of the run reads them as the main module does.
process.chdir(run.cwd);
process.argv = [process.argv[0] ?? process.execPath, run.script, ...run.args.map(filled)];
for (const [name, text] of Object.entries(run.env)) process.env[name] = filled(text);

const startHeap = watchHeap();
const started = performance.now();
void import(pathToFileURL(run.script).href).catch((error: unknown) => {
  fail(`The import of the app "${run.app}" failed: ${error instanceof Error && error.stack !== undefined ? error.stack : errorMessage(error)}`);
  process.exit(1);
});

if (http !== undefined && ready.kind === "http") {
  while (readyAt === undefined) {
    if (await httpProbe(http, Number(port), ready.path)) mark();
    else await sleep(READY_POLL_MS);
  }
}
await signalled;
const at = readyAt ?? performance.now();
const ms = at - started;
const readiness = at - copyMs - ballastMs;
const heapOfStart = startHeap.stop();
const io = processIo();
const memory = processMemory();
const live = heapAfterGc();

// The ballasts of the moment `ready` start at the ready signal. The watch does not wait for them.
for (const flag of flags.filter((each) => each.at === "ready")) ballasts.push({ flag, ballast: startBallast(flag.bytes) });

const watch = watchMemory();
const heapOfWatch = watchHeap();
const cpuOfReady = process.cpuUsage();
const watchStarted = performance.now();
await sleep(watchMs);
const cpuOfWatch = process.cpuUsage(cpuOfReady);
const watchCpu = (cpuOfWatch.user + cpuOfWatch.system) / 1000;
const watchedMs = performance.now() - watchStarted;
const watched = watch.peak();
watch.stop();
const watchedHeap = heapOfWatch.stop();

// The ballasts and the samples stop before the close, because they keep the process alive.
const held = [];
for (const { flag, ballast } of ballasts) {
  const each = await ballast;
  await each.stop();
  held.push({ bytes: flag.bytes, at: flag.at, rss: each.rss, ms: each.ms });
}
const samples = sampler === undefined ? [] : (await sampler.stop()).map(({ at: time, ...sample }) => ({ ms: time - performance.timeOrigin, ...sample }));

const line = {
  ms,
  readiness,
  firstPass: null,
  peakRss: memory.peakRss,
  ready: memory,
  io,
  live,
  startHeap: heapOfStart,
  watch: watched,
  watchHeap: watchedHeap,
  watchCpu,
  watchMs: watchedMs,
  passes: null,
  stalled: false,
  limit: getHeapStatistics().heap_size_limit,
  copyMs,
  ballastMs,
  ballasts: held,
  samples,
  writes: null,
};

/** This function writes the line of the child, and it removes the copy of --seeded. It does only synchronous work, for the event `exit`. */
const finish = (closeMs: number | null, closeCode: number | null): void => {
  if (state === "done") return;
  state = "done";
  if (values.home === undefined) rmSync(home, { recursive: true, force: true });
  writeSync(1, `${JSON.stringify({ ...line, closeMs, closeCode, open: process.getActiveResourcesInfo(), endMs: performance.now() })}\n`);
};

if (process.listenerCount("SIGTERM") === 0) {
  // With no listener, SIGTERM ends the process at once. The close has no time to measure.
  finish(null, null);
  process.exit(0);
} else {
  state = "close";
  const closing = performance.now();
  process.once("exit", (code) => {
    finish(performance.now() - closing, code);
    process.exitCode = 0;
  });
  // A resource that the close left open keeps the process alive. The line names it after the grace time.
  setTimeout(() => {
    finish(null, null);
    process.exit(0);
  }, CLOSE_GRACE_MS).unref();
  process.kill(process.pid, "SIGTERM");
}
