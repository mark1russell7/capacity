import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { arch, release, totalmem } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  benchEnv,
  childLine,
  containerStart,
  diskOf,
  dropPageCache,
  freshRun,
  startProcess,
  type ChildTurn,
  type DiskLimit,
  type CaseOrder,
  type ChildFields,
  type ContainerOptions,
  type FreshRun,
  type FreshSkip,
  type IoSample,
  type Sidecar,
  type SkipKind,
  type StartChild,
} from "@mark1russell7/rigor-bench/fresh";
import { isRecord } from "@mark1russell7/optional/read";
import { BYTES_1024, DURATION_MS, convertible, formatOnScale, quantity, valueIn, type Quantity } from "@mark1russell7/quantity";
import { escapeMarkdown } from "@mark1russell7/text";
import { cpuSetsOf } from "./cell.ts";
import type { CheckProblem } from "./check.ts";
import type { Host, Measures } from "./record.ts";
import {
  CHILD_MARGIN,
  DISK_UNITS,
  IMAGE_MARGIN,
  SEED_RATE,
  TREE_MARGIN,
  pointAmounts,
  pointBytes,
  startCaseProblems,
  startSubjectOf,
  startVariablesOf,
  type BallastMoment,
  type Graft,
  type StartArm,
  type StartBallast,
  type StartCase,
  type StartObservation,
  type StartPoint,
  type StartTarget,
  type StartVariables,
} from "./start.ts";
import {
  APP_START_PROGRAM,
  FAKES_MEMORY,
  FAKES_PROGRAM,
  appCaseProblems,
  appFakesOf,
  appRunOf,
  fillCommand,
  hostCommand,
  levelsOf,
  readTreeApp,
  seedAmountsOf,
  startWorkloadOf,
  variableValues,
  type TreeApp,
} from "./start-app.ts";

/** This text is the format of the record of a start case. */
export const START_RECORD_FORMAT = "capacity-start-record/1";

/**
 * These measures are the measures of one start, with their units. The start program reads them in a fresh process.
 *
 * - `ready` is the time to ready: the import of the runtime, the open and the first pass.
 * - `readiness` is the time from the start of the process to the end of the open, less the copy. `firstPass` is the time from that point to ready.
 * - `copy` and `close` are the times of the copy of the store before the start and of the close after the watch.
 *   `ballast` is the time of the ballasts of the moment `start`, before the start. A child with a cold cache has no copy: it opens its home in place.
 * - `end` is the time from the start of the process to the line of the child.
 * - `peak`, `rss`, `anon`, `file`, `heap` and `external` are the memory at ready. `peak` is VmHWM, the peak of the resident set.
 * - `live` is the used heap after a full GC at ready.
 * - `read` is the bytes that the process read from the disk up to ready. `faults` is the count of its major faults up to ready.
 * - `heapPeak` and `livePeak` are the peaks of the used heap and of the live heap over the start, from the GC profiler.
 * - `gc` is the GC time of the start, and `fullGc` is the count of its full GC events.
 * - The measures `watch...` are the peaks over the watch after ready, and `passes` is the count of passes in the watch.
 * - `limit` is the heap size limit of V8 in the child.
 * - `writes` is the count of the writes of the snapshot of the start, in the start and the watch.
 * - `writeLongest` is the longest block of the event loop in one write: the longest time between two pauses of the write.
 * - `writeStore`, `writeRows`, `writeWall` and `writeCpu` are the longest times of one write. They are the time of the store, the build of the rows, the wall time and the CPU time.
 * - A tree with no record of the writes gives null for each measure of the writes.
 */
export const START_MEASURES = {
  ready: "ms",
  readiness: "ms",
  firstPass: "ms",
  copy: "ms",
  ballast: "ms",
  close: "ms",
  end: "ms",
  peak: "B",
  rss: "B",
  anon: "B",
  file: "B",
  heap: "B",
  external: "B",
  live: "B",
  read: "B",
  faults: "{fault}",
  heapPeak: "B",
  livePeak: "B",
  gc: "ms",
  fullGc: "{gc}",
  watchPeak: "B",
  watchRss: "B",
  watchAnon: "B",
  watchHeap: "B",
  watchHeapPeak: "B",
  watchLive: "B",
  watchGc: "ms",
  passes: "{pass}",
  limit: "B",
  writes: "{write}",
  writeLongest: "ms",
  writeStore: "ms",
  writeRows: "ms",
  writeWall: "ms",
  writeCpu: "ms",
} as const;

/** A start measure is the name of a measure of a start. */
export type StartMeasure = keyof typeof START_MEASURES;

/** The machine of a start record: the host, its kernel, its memory and the Node of the host. Each child has the Node of the target. */
export interface StartMachine extends Host {
  readonly kernel: string;
  readonly architecture: string;
  readonly node: string;
  readonly memory: Quantity;
}

/** The image of a start record: the image of the target, as the pull found it. */
export interface StartImage {
  readonly name: string;
  /** This id is the id of the image on the host. */
  readonly id: string;
  /** This digest is the first digest of the image in its registry, or null for an image with no digest. */
  readonly digest: string | null;
}

/**
 * The target check is the facts of a check child in the container of the target. Each fact must be the fact of the
 * target. Thus a record cannot model another machine.
 */
export interface TargetCheck {
  readonly node: string;
  /** This text is the field `memory.max` of the cgroup of the container, or null when the child cannot read it. */
  readonly memoryMax: string | null;
  /** This text is the field `memory.swap.max` of the cgroup of the container, or null when the child cannot read it. */
  readonly swapMax: string | null;
  /** This amount is the swap of the host (`SwapTotal`), or null when the child cannot read it. */
  readonly hostSwap: Quantity | null;
  readonly heapLimit: Quantity;
  readonly cpus: number;
  /** This time is the start of the container: the time of the command less the time of the Node process in it. */
  readonly start: Quantity;
}

/** A tree of a start record: one checkout of the subject, and the time of its clone and its install. */
export interface StartTree {
  /** This id is the id of the arm, or `seeder` for the tree of the seed program only. */
  readonly id: string;
  readonly commit: string;
  readonly graft: readonly Graft[];
  readonly time: Quantity;
}

/** A seeded point is the store of one point as the seed program wrote it. */
export interface SeededPoint {
  readonly id: string;
  /**
   * These sizes are the amount of each variable of the store that the seed wrote, by its name. For a subject of
   * `START_SUBJECTS`, each one is the byte size of a file. For an app, the seed gives them in its last line.
   */
  readonly sizes: Readonly<Record<string, Quantity>>;
  /** This count is the events of the log, for the subject `alerts`. A seed of an app does not give it. */
  readonly events?: number | undefined;
  readonly time: Quantity;
  /** These arguments go to the start program for this store. */
  readonly args: readonly string[];
}

/** A held ballast is one ballast of a child: its bytes and its moment, the resident set that it held, and its time to fill. */
export interface HeldBallast {
  readonly bytes: Quantity;
  readonly at: BallastMoment;
  readonly rss: Quantity;
  readonly time: Quantity;
}

/**
 * A start sample is one sample of a child, as `watchIo` of `@mark1russell7/rigor-bench/fresh` gives it. The field `ms` is the
 * time from the start of the process. The amounts are bytes and counts. A value that the child cannot read is null.
 */
export type StartSample = Omit<IoSample, "at"> & { readonly ms: number };

/** A start reading is the measures of one child: the start of one arm on one point, in one round. */
export interface StartReading {
  /** This id is the id of an arm, or the id of the A/A pair of the base, for example `cloud~aa`. */
  readonly arm: string;
  readonly point: string;
  readonly round: number;
  /** This place is the place of the child in the order of its point and round, from 0. */
  readonly position: number;
  readonly measures: Measures<StartMeasure>;
  /** These names are the resources that stayed open after the close of the runtime. */
  readonly open: readonly string[];
  /** This flag tells that a pass gave a wake time that is not after the pass. Then no pass followed in the watch. */
  readonly stalled: boolean;
  /** These ballasts are the ballasts of the child, in the order of their start. */
  readonly ballasts: readonly HeldBallast[];
  /** These samples are the samples of the child, for a case with the field `samples`. */
  readonly samples: readonly StartSample[];
}

/**
 * A first start is the start of one arm on the earlier point of a point with the field `after`. It is not measured.
 * Its home is the store of the arm on the later point. Thus a second start reads what a first start wrote.
 */
export interface FirstStart {
  /** This id is the id of the later point. */
  readonly point: string;
  /** This id is the id of the earlier point. */
  readonly after: string;
  readonly arm: string;
  readonly time: Quantity;
  /** This count is the passes of the watch of the first start. An arm with a snapshot writes it at the first pass of the watch. */
  readonly passes: number;
  /** This count is the writes of the snapshot in the first start. It is null for a tree with no record of the writes. */
  readonly writes: Quantity | null;
  /** This time is the longest block of the event loop in one write of the snapshot of the first start, or null. */
  readonly writeLongest: Quantity | null;
  /** These sizes are the byte size of each file of the home after the first start, by its name. */
  readonly files: Readonly<Record<string, Quantity>>;
}

/**
 * The record of a start case is the reading of each child of one job. It also has the image, the target check,
 * the trees and the stores of the job. It has the order of the children, each failure and each skip.
 *
 * A failure is a child that passed a limit of the target: its time limit, its memory limit or the heap limit of V8.
 * A failure is the result "does not fit", and it has no reading. A skip is a child that printed a skip line.
 */
export interface StartRecord {
  readonly format: typeof START_RECORD_FORMAT;
  readonly case: StartCase;
  readonly machine: StartMachine;
  readonly at: { readonly started: string; readonly ended: string };
  /** This text is the job of the run: the number of the run of the plan. */
  readonly job: string;
  readonly image: StartImage;
  readonly check: TargetCheck;
  readonly trees: readonly StartTree[];
  /** These ids are the pairs of the run: each other arm with the base, then the A/A pair of the base, for example `cloud~aa`. */
  readonly pairs: readonly string[];
  readonly points: readonly SeededPoint[];
  /** These first starts give the store of each arm on each point with the field `after`. */
  readonly firsts: readonly FirstStart[];
  /** These limits are the limits of the disks of the host for each child, from the disk of the target. */
  readonly disks: readonly StartDiskRecord[];
  readonly readings: readonly StartReading[];
  readonly orders: readonly CaseOrder[];
  /** These children passed a limit of the target. Each one has the kind `time`, `memory` or `heap`. */
  readonly failures: readonly FreshSkip[];
  /** These children printed a skip line. */
  readonly skipped: readonly FreshSkip[];
}

/** A start measurement is the record of a start case and the raw result of its run. A later analysis can judge the raw result again. */
export interface StartMeasurement {
  readonly record: StartRecord;
  readonly result: FreshRun;
}

/** The record of a disk is one disk of the host, its paths of the host, and the limits of each child on it. */
export interface StartDiskRecord {
  readonly device: string;
  /** These paths are the paths of the host on this disk: the work folder, the data of Docker and each swap file. */
  readonly paths: readonly string[];
  readonly limit: DiskLimit;
}

/** The host disk is the access of a measure to the disks and the page cache of the host. A test gives its own. */
export interface HostDisk {
  /** This function gives the device of the whole disk of a path, for example `/dev/sda`. */
  readonly of: (path: string) => string;
  /** This function drops the page cache of the host. */
  readonly drop: () => Promise<void>;
  /** This function gives the path of each swap file of the host. A swap partition is not a file. */
  readonly swaps: () => readonly string[];
}

/** This function gives the path of each swap file of the host, from `/proc/swaps`. */
const swapFiles = (): readonly string[] =>
  readFileSync("/proc/swaps", "utf8")
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((fields) => fields[1] === "file" && fields[0] !== undefined)
    .map((fields) => fields[0]!.replaceAll("\\040", " "));

/** The options of the measure of a start case. Each one has a default for a real run, and a test gives its own. */
export interface StartMeasureOptions {
  /** This folder gets the trees and the stores of the case. Each child mounts it. */
  readonly work: string;
  /** This number is the number of the run of the plan, 1 or more. It turns the order of the arms. The default is 1. */
  readonly run?: number;
  /** This function starts each command on the host. The default is `startProcess` of `@mark1russell7/rigor-bench/fresh`. */
  readonly start?: StartChild;
  /** This function gives the start of the children in the container of the target. The default is `containerStart` with `start`. */
  readonly container?: (options: ContainerOptions) => StartChild;
  /** This host gives the CPU model of the record and the count of its CPUs. The default is `benchEnv()` of `@mark1russell7/rigor-bench/fresh`. */
  readonly host?: Host;
  /** This function gives the time. The default is the clock of the system. */
  readonly now?: () => Date;
  /** This access gives the disks and the page cache of the host. The default is `diskOf` and `dropPageCache` of `@mark1russell7/rigor-bench/fresh`, and `/proc/swaps`. */
  readonly disk?: HostDisk;
}

/** This folder is the root of the repository of the lab. Each child mounts it, for the start program and its packages. */
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url)).replace(/[\\/]+$/, "");

/** This function gives the last 500 characters of a text, on one line. */
const tailOf = (text: string): string => text.slice(-500).replaceAll(/\s+/g, " ").trim();

/**
 * This function starts one command and throws with the tail of its stderr when the command fails. A command with an
 * empty stderr gives the tail of its stdout, because `tsc` prints its errors there.
 */
const command = async (start: StartChild, argv: readonly string[], cwd: string | undefined, limit: Quantity): Promise<string> => {
  const exit = await start(argv, { timeoutMs: valueIn(limit, "ms"), maxBuffer: 1 << 26, ...(cwd === undefined ? {} : { cwd }) });
  if (exit.code !== 0 || exit.timedOut === true || exit.error !== undefined) {
    const why = exit.timedOut === true ? `took more than ${limit.value} ${limit.unit}` : (exit.error ?? `exited with the code ${String(exit.code)}`);
    const [stream, text] = exit.stderr.trim() === "" ? ["stdout", exit.stdout] : ["stderr", exit.stderr];
    throw new Error(`The command ${argv.join(" ")} ${why}. The tail of ${stream}: ${tailOf(text)}`);
  }
  return exit.stdout;
};

/** This function gives a time in milliseconds since `from`, as an amount. */
const since = (from: number): Quantity => quantity(performance.now() - from, "ms");

/** This rule is the form of the digest of an image: a name with no space and no backtick, and a SHA-256. */
const DIGEST = /^[^\s`]+@sha256:[0-9a-f]{64}$/;

/** This function pulls the image of the target on the host, and it gives its id and its digest. A digest of a wrong form is null. */
const pullImage = async (start: StartChild, name: string): Promise<StartImage> => {
  await command(start, ["docker", "pull", "--quiet", name], undefined, IMAGE_MARGIN);
  const stdout = await command(start, ["docker", "image", "inspect", "--format", "{{.Id}} {{json .RepoDigests}}", name], undefined, IMAGE_MARGIN);
  const [id = "", ...rest] = stdout.trim().split(" ");
  const digests: unknown = JSON.parse(rest.join(" ") || "[]");
  if (!/^sha256:[0-9a-f]{64}$/.test(id)) throw new Error(`The inspect of the image ${name} gave no id: ${tailOf(stdout)}`);
  const digest = Array.isArray(digests) && typeof digests[0] === "string" && DIGEST.test(digests[0]) ? digests[0] : null;
  return { name, id, digest };
};

/** This program is the check child. It prints the facts of its container as one JSON line. */
export const CHECK_PROGRAM: string = [
  'const fs = require("node:fs"), os = require("node:os"), v8 = require("node:v8");',
  'const read = (path) => { try { return fs.readFileSync(path, "utf8").trim(); } catch { return null; } };',
  'const swap = /SwapTotal:\\s+(\\d+) kB/.exec(read("/proc/meminfo") ?? "");',
  "console.log(JSON.stringify({ uptime: process.uptime() * 1000, node: process.version,",
  '  memoryMax: read("/sys/fs/cgroup/memory.max"), swapMax: read("/sys/fs/cgroup/memory.swap.max"),',
  "  hostSwap: swap === null ? null : Number(swap[1]) * 1024, heapLimit: v8.getHeapStatistics().heap_size_limit, cpus: os.availableParallelism() }));",
].join("\n");

/** This function reads the line of the check child, and the time of its command in milliseconds. It throws for a line that it cannot read. */
export const targetCheckOf = (stdout: string, commandMs: number): TargetCheck => {
  const last = stdout.trim().split("\n").at(-1) ?? "";
  let line: unknown;
  try {
    line = JSON.parse(last);
  } catch {
    throw new Error(`The check child printed no JSON line: ${tailOf(stdout)}`);
  }
  if (!isRecord(line)) throw new Error(`The check child printed no record: ${tailOf(last)}`);
  const { uptime, node, memoryMax, swapMax, hostSwap, heapLimit, cpus } = line;
  const text = (value: unknown): value is string | null => value === null || typeof value === "string";
  const count = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
  if (!count(uptime) || typeof node !== "string" || !text(memoryMax) || !text(swapMax) || !(hostSwap === null || count(hostSwap)) || !count(heapLimit) || !Number.isSafeInteger(cpus)) {
    throw new Error(`The line of the check child has a field of a wrong type: ${tailOf(last)}`);
  }
  return {
    node,
    memoryMax,
    swapMax,
    hostSwap: hostSwap === null ? null : quantity(hostSwap, "B"),
    heapLimit: quantity(heapLimit, "B"),
    cpus: cpus as number,
    start: quantity(Math.max(0, commandMs - uptime), "ms"),
  };
};

/** This function gives each fact of a target check that is not the fact of the target, as a text. An empty list is a match. */
export const targetMismatches = (target: StartTarget, check: TargetCheck): readonly string[] => {
  const memory = valueIn(target.memory, "B");
  const swap = valueIn(target.swap, "B");
  const out: string[] = [];
  if (check.node !== target.node) out.push(`the Node version is ${check.node}, not ${target.node}`);
  if (check.memoryMax !== String(memory)) out.push(`the memory limit of the cgroup is ${check.memoryMax ?? "not readable"}, not ${memory}`);
  if (check.swapMax !== String(swap)) out.push(`the swap limit of the cgroup is ${check.swapMax ?? "not readable"}, not ${swap}`);
  const hostSwap = check.hostSwap === null ? null : valueIn(check.hostSwap, "B");
  if (swap > 0 && !(hostSwap !== null && hostSwap >= swap)) out.push(`the host has ${hostSwap ?? "no readable"} bytes of swap, less than ${swap}`);
  if (target.heapLimit !== null && valueIn(check.heapLimit, "B") !== valueIn(target.heapLimit, "B")) {
    out.push(`the heap limit of V8 is ${valueIn(check.heapLimit, "B")}, not ${valueIn(target.heapLimit, "B")}`);
  }
  if (check.cpus !== target.cpus) out.push(`the child has ${check.cpus} CPUs, not ${target.cpus}`);
  return out;
};

/** This function starts the check child in the container of the target, and it throws when a fact is not the fact of the target. */
const checkTarget = async (child: StartChild, target: StartTarget): Promise<TargetCheck> => {
  const begun = performance.now();
  const exit = await child(["node", "-e", CHECK_PROGRAM], { timeoutMs: valueIn(IMAGE_MARGIN, "ms"), maxBuffer: 1 << 16 });
  const commandMs = performance.now() - begun;
  if (exit.code !== 0 || exit.timedOut === true || exit.error !== undefined) throw new Error(`The check child in the container of the target failed. The tail of stderr: ${tailOf(exit.stderr)}`);
  const check = targetCheckOf(exit.stdout, commandMs);
  const mismatches = targetMismatches(target, check);
  if (mismatches.length > 0) throw new Error(`The container does not model the target: ${mismatches.join(", ")}.`);
  return check;
};

/**
 * This function makes one tree of a repository in `dir`. The steps are a shallow fetch of the commit and the file of each
 * graft from its commit. Then `setup` installs the dependencies, and it examines a tree with a graft. It gives the time of the tree.
 */
const makeTree = async (
  start: StartChild,
  repository: string,
  id: string,
  commit: string,
  graft: readonly Graft[],
  dir: string,
  setup: (dir: string, grafted: boolean) => Promise<void>,
): Promise<StartTree> => {
  const begun = performance.now();
  const git = (...args: string[]): Promise<string> => command(start, ["git", "-C", dir, ...args], undefined, TREE_MARGIN);
  mkdirSync(dir, { recursive: true });
  await git("init", "-q");
  await git("remote", "add", "origin", repository);
  await git("fetch", "-q", "--depth", "1", "origin", commit);
  await git("checkout", "-q", "FETCH_HEAD");
  for (const each of graft) {
    await git("fetch", "-q", "--depth", "1", "origin", each.commit);
    await git("checkout", each.commit, "--", each.path);
  }
  await setup(dir, graft.length > 0);
  return { id, commit, graft, time: since(begun) };
};

/** This function gives the flags of the start program for a list of ballasts. */
const ballastFlags = (list: readonly StartBallast[] | undefined): readonly string[] => (list ?? []).flatMap((each) => ["--ballast", `${valueIn(each.bytes, "B")}@${each.at}`]);

/** This function gives the byte size of each file of a folder and of its folders, by its path in the folder with `/`. */
const filesOf = (dir: string, prefix = ""): Record<string, Quantity> => {
  const out: Record<string, Quantity> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory()) Object.assign(out, filesOf(join(dir, entry.name), `${name}/`));
    else if (entry.isFile()) out[name] = quantity(statSync(join(dir, entry.name)).size, "B");
  }
  return out;
};

/**
 * This function gives the id of the seed point of a point. It is the point itself, or the seed point of the earlier
 * point of a point with the field `after`. The seed program wrote the store of the seed point. It is undefined for an id that is not a point.
 */
export const seedPointOf = (points: readonly StartPoint[], id: string): string | undefined => {
  const point = points.find((each) => each.id === id);
  if (point === undefined) return undefined;
  return point.after === undefined ? point.id : seedPointOf(points, point.after);
};

/** This function gives the limit of a child on a disk from the disk of the target, in bytes and in operations each second. */
const limitOf = (device: string, disk: NonNullable<StartTarget["disk"]>): DiskLimit => ({
  device,
  readBytes: valueIn(disk.readBytes, DISK_UNITS.readBytes),
  readOps: valueIn(disk.readOps, DISK_UNITS.readOps),
  writeBytes: valueIn(disk.writeBytes, DISK_UNITS.writeBytes),
  writeOps: valueIn(disk.writeOps, DISK_UNITS.writeOps),
});

/** This function reads the child line of the seed program, or it throws. */
const seededOf = (point: StartPoint, stdout: string, time: Quantity, subject: StartVariables): SeededPoint => {
  const line = childLine(stdout);
  if (line.skipped !== undefined) throw new Error(`The seed program skipped the point "${point.id}": ${line.skipped}`);
  const extra = line.extra ?? {};
  const sizes = extra["sizes"];
  const args = extra["args"];
  // The field `events` of a child line is the GC events of the child. Thus the seed program gives `logEvents`.
  const events = extra["logEvents"];
  const bad = (what: string): Error => new Error(`The seed program of the point "${point.id}" gave no ${what}.`);
  if (!isRecord(sizes)) throw bad("sizes");
  if (!Array.isArray(args) || !args.every((each) => typeof each === "string")) throw bad("arguments of the start program");
  if (!Number.isSafeInteger(events)) throw bad("count of events");
  const read: Record<string, Quantity> = {};
  for (const [name, variable] of Object.entries(subject.variables)) {
    const value = sizes[name];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw bad(`size of "${name}"`);
    read[name] = quantity(value, variable.unit);
  }
  return { id: point.id, sizes: read, events: events as number, time, args: args as string[] };
};

/** This function gives the number in a field of a record, or null. */
const numberIn = (value: unknown, key: string): number | null => {
  const read = isRecord(value) ? value[key] : undefined;
  return typeof read === "number" && Number.isFinite(read) ? read : null;
};

/** This function gives an amount in the unit of a start measure, or null for a value that the child did not give. */
const amount = (name: StartMeasure, value: number | null): Quantity | null => (value === null ? null : quantity(value, START_MEASURES[name]));

/** The measures of the writes of the snapshot of the start. */
type WriteMeasure = "writes" | "writeLongest" | "writeStore" | "writeRows" | "writeWall" | "writeCpu";

/**
 * This function gives the measures of the writes of the snapshot from the fields of a child. The measures are the count of
 * the writes and the longest value of each time. A field `writes` that is not a list gives null for each measure. A time that
 * no write has is null.
 */
export const writeMeasures = (fields: ChildFields): Record<WriteMeasure, Quantity | null> => {
  const list = fields.extra?.["writes"];
  const writes = Array.isArray(list) ? (list as readonly unknown[]) : null;
  const longest = (key: string): number | null => {
    const values = (writes ?? []).flatMap((each) => {
      const value = numberIn(each, key);
      return value === null ? [] : [value];
    });
    return values.length === 0 ? null : Math.max(...values);
  };
  return {
    writes: amount("writes", writes === null ? null : writes.length),
    writeLongest: amount("writeLongest", longest("longestMs")),
    writeStore: amount("writeStore", longest("writeMs")),
    writeRows: amount("writeRows", longest("rowsMs")),
    writeWall: amount("writeWall", longest("wallMs")),
    writeCpu: amount("writeCpu", longest("cpuMs")),
  };
};

/** This function gives the measures of one child from its time to ready and its fields. */
export const startMeasures = (ms: number, fields: ChildFields): Measures<StartMeasure> => {
  const extra = fields.extra ?? {};
  const ready = extra["ready"];
  const watch = extra["watch"];
  const startHeap = extra["startHeap"];
  const watchHeap = extra["watchHeap"];
  return {
    ready: amount("ready", ms),
    readiness: amount("readiness", numberIn(extra, "readiness")),
    firstPass: amount("firstPass", numberIn(extra, "firstPass")),
    copy: amount("copy", numberIn(extra, "copyMs")),
    ballast: amount("ballast", numberIn(extra, "ballastMs")),
    close: amount("close", numberIn(extra, "closeMs")),
    end: amount("end", numberIn(extra, "endMs")),
    peak: amount("peak", fields.peakRss ?? numberIn(ready, "peakRss")),
    rss: amount("rss", numberIn(ready, "rss")),
    anon: amount("anon", numberIn(ready, "anon")),
    file: amount("file", numberIn(ready, "file")),
    heap: amount("heap", numberIn(ready, "heapUsed")),
    external: amount("external", numberIn(ready, "external")),
    live: amount("live", numberIn(extra, "live")),
    read: amount("read", numberIn(extra["io"], "readBytes")),
    faults: amount("faults", numberIn(extra["io"], "majorFaults")),
    heapPeak: amount("heapPeak", numberIn(startHeap, "used")),
    livePeak: amount("livePeak", numberIn(startHeap, "live")),
    gc: amount("gc", numberIn(startHeap, "gcMs")),
    fullGc: amount("fullGc", numberIn(startHeap, "fullGc")),
    watchPeak: amount("watchPeak", numberIn(watch, "peakRss")),
    watchRss: amount("watchRss", numberIn(watch, "rss")),
    watchAnon: amount("watchAnon", numberIn(watch, "anon")),
    watchHeap: amount("watchHeap", numberIn(watch, "heapUsed")),
    watchHeapPeak: amount("watchHeapPeak", numberIn(watchHeap, "used")),
    watchLive: amount("watchLive", numberIn(watchHeap, "live")),
    watchGc: amount("watchGc", numberIn(watchHeap, "gcMs")),
    passes: amount("passes", numberIn(extra, "passes")),
    limit: amount("limit", numberIn(extra, "limit")),
    ...writeMeasures(fields),
  };
};

/** This function gives the ballasts of the fields of a child. An entry with a field of a wrong type is not in the list. */
export const ballastsOf = (fields: ChildFields): readonly HeldBallast[] => {
  const list = fields.extra?.["ballasts"];
  if (!Array.isArray(list)) return [];
  return list.flatMap((each: unknown) => {
    const bytes = numberIn(each, "bytes");
    const rss = numberIn(each, "rss");
    const ms = numberIn(each, "ms");
    const at = isRecord(each) ? each["at"] : undefined;
    if (bytes === null || rss === null || ms === null || (at !== "start" && at !== "ready")) return [];
    return [{ bytes: quantity(bytes, "B"), at, rss: quantity(rss, "B"), time: quantity(ms, "ms") }];
  });
};

/** This function gives a number or null from a field of a record. A field with no number is null. */
const orNull = (value: unknown, key: string): number | null => numberIn(value, key);

/** This function gives the samples of the fields of a child. A sample with no time is not in the list. */
export const samplesOf = (fields: ChildFields): readonly StartSample[] => {
  const list = fields.extra?.["samples"];
  if (!Array.isArray(list)) return [];
  return list.flatMap((each: unknown) => {
    const ms = numberIn(each, "ms");
    if (ms === null || !isRecord(each)) return [];
    const cgroup = each["cgroup"];
    return [
      {
        ms,
        readBytes: orNull(each, "readBytes"),
        writeBytes: orNull(each, "writeBytes"),
        majorFaults: orNull(each, "majorFaults"),
        rss: orNull(each, "rss"),
        cgroup: {
          memory: orNull(cgroup, "memory"),
          swap: orNull(cgroup, "swap"),
          readBytes: orNull(cgroup, "readBytes"),
          writeBytes: orNull(cgroup, "writeBytes"),
          reads: orNull(cgroup, "reads"),
          writes: orNull(cgroup, "writes"),
        },
      },
    ];
  });
};

/** This function gives the names of the open resources of the fields of a child. */
const openOf = (fields: ChildFields): readonly string[] => {
  const open = fields.extra?.["open"];
  return Array.isArray(open) ? open.filter((each): each is string => typeof each === "string") : [];
};

/** This function gives the folder of the program of a subject, in the folder `src/subject` of this package. */
const programOf = (name: string): string => fileURLToPath(new URL(`./subject/${name}`, import.meta.url));

/** This function gives the time limit of one child of a start case: the limit, the watch and `CHILD_MARGIN`. */
export const childLimitOf = (value: StartCase): Quantity => quantity(valueIn(value.limit, "ms") + valueIn(value.watch, "ms") + valueIn(CHILD_MARGIN, "ms"), "ms");

/**
 * This function measures a start case on this machine. It throws a `RangeError` for a case with a problem.
 *
 * 1. It pulls the image of the target, and it starts a check child in the container of the target. A fact of the
 *    container that is not the fact of the target stops the case.
 * 2. It makes a tree for each arm, and a tree of the seeder when no arm without a graft has its commit.
 * 3. It seeds the store of each point once, with the seed program in the tree of the seeder.
 * 4. It starts the children with `freshRun` of `@mark1russell7/rigor-bench/fresh`, in the order `arms`. Each round
 *    starts one child of each arm and one A/A child of the base, on each point.
 *
 * Each child is the start program in a new container of the target, with `--expose-gc`. The container mounts the work
 * folder and the repository of the lab at the same paths. A child that passes a limit of the target is a failure of
 * its arm on its point. The other arms still start.
 *
 * The contract of an arm can have outside services. Then each child of the arm gets a sidecar with the fakes of the
 * services, on the CPUs that the child does not use. The fakes get a workload with no load (`startWorkloadOf`).
 */
export const measureStart = async (value: StartCase, options: StartMeasureOptions): Promise<StartMeasurement> => {
  const problems = startCaseProblems(value);
  if (problems.length > 0) throw new RangeError(`The start case "${String(value.id)}" has problems: ${problems.map((each) => `${each.path}: ${each.message}`).join(" ")}`);
  const run = options.run ?? 1;
  if (!Number.isSafeInteger(run) || run < 1) throw new RangeError(`The run is a whole number of 1 or more, not ${run}.`);
  const start = options.start ?? startProcess;
  const container = options.container ?? ((each: ContainerOptions) => containerStart({ ...each, start }));
  const now = options.now ?? (() => new Date());
  const host = options.host ?? benchEnv();
  // An app case has no subject of START_SUBJECTS: the contract of each tree gives its steps.
  const subject = value.app === undefined ? startSubjectOf(value) : undefined;
  const variables = startVariablesOf(value);
  const repository = value.app ?? startSubjectOf(value).repository;
  const started = now();
  const { target } = value;

  const image = await pullImage(start, target.image);
  const disk = options.disk ?? { of: diskOf, drop: () => dropPageCache(start), swaps: swapFiles };
  const disks: StartDiskRecord[] = [];
  if (target.disk !== undefined) {
    // Each child reads the store and the trees from the work folder, the image from the data of Docker, and its swap from the swap files.
    const root = (await command(start, ["docker", "info", "--format", "{{.DockerRootDir}}"], undefined, IMAGE_MARGIN)).trim();
    for (const path of [options.work, root, ...disk.swaps()]) {
      const device = disk.of(path);
      const known = disks.findIndex((each) => each.device === device);
      if (known === -1) disks.push({ device, paths: [path], limit: limitOf(device, target.disk) });
      else disks[known] = { ...disks[known]!, paths: [...disks[known]!.paths, path] };
    }
  }
  const cpus = cpuSetsOf(target.cpus, host.cores);
  const containerOf = (limited: boolean, sidecars: readonly Sidecar[] = []): StartChild =>
    container({
      image: target.image,
      memory: valueIn(target.memory, "B"),
      swap: valueIn(target.swap, "B"),
      cpuset: cpus.subject,
      mounts: [options.work, REPO_ROOT],
      ...(limited && disks.length > 0 ? { disks: disks.map((each) => each.limit) } : {}),
      ...(sidecars.length > 0 ? { sidecars } : {}),
    });
  const child = containerOf(true);
  const check = await checkTarget(child, target);

  const [base, ...candidates] = value.arms;
  if (base === undefined) throw new RangeError("The start case has no arm.");
  const treeOf = (id: string): string => join(options.work, "trees", id);
  const trees: StartTree[] = [];
  // The contract of each tree of an app case, by the id of the tree. The lab reads it after the grafts.
  const apps = new Map<string, TreeApp>();
  const setupOf =
    (id: string) =>
    async (dir: string, grafted: boolean): Promise<void> => {
      if (subject !== undefined) {
        await command(start, subject.install, dir, TREE_MARGIN);
        if (grafted) await command(start, subject.check, dir, TREE_MARGIN);
        return;
      }
      const tree = readTreeApp(id, dir);
      const problems = appCaseProblems(value, [tree]);
      if (problems.length > 0) throw new RangeError(`The start case "${value.id}" has problems: ${problems.map((each) => `${each.path}: ${each.message}`).join(" ")}`);
      apps.set(id, tree);
      const { install, check } = tree.app.start;
      for (const step of [install, grafted ? check : undefined]) {
        if (step === undefined) continue;
        const host = hostCommand(fillCommand(step, {}), dir);
        await command(start, host.argv, host.cwd, TREE_MARGIN);
      }
    };
  for (const arm of value.arms) trees.push(await makeTree(start, repository, arm.id, arm.commit, arm.graft ?? [], treeOf(arm.id), setupOf(arm.id)));
  const plain = value.arms.find((arm) => arm.commit === value.seeder && (arm.graft ?? []).length === 0);
  const seederId = plain === undefined ? "seeder" : plain.id;
  const seeder = treeOf(seederId);
  if (plain === undefined) trees.push(await makeTree(start, repository, "seeder", value.seeder, [], seeder, setupOf("seeder")));
  /** This function gives the contract of a tree of an app case. */
  const appOf = (id: string): TreeApp => {
    const tree = apps.get(id);
    if (tree === undefined) throw new Error(`The tree "${id}" has no contract.`);
    return tree;
  };

  const storeOf = (id: string): string => join(options.work, "stores", id);
  const points: SeededPoint[] = [];
  for (const point of value.points) {
    if (point.after !== undefined) continue;
    const limit = quantity(valueIn(CHILD_MARGIN, "s") + pointBytes(variables, point) / SEED_RATE, "s");
    mkdirSync(storeOf(point.id), { recursive: true });
    const begun = performance.now();
    if (subject !== undefined) {
      const amounts = pointAmounts(subject, point);
      const flags = Object.entries(amounts).flatMap(([name, each]) => [`--${name}`, String(Math.round(each))]);
      const stdout = await command(start, [process.execPath, programOf(subject.seed), "--tree", seeder, "--out", storeOf(point.id), "--seed", value.seed, ...flags], undefined, limit);
      points.push(seededOf(point, stdout, since(begun), subject));
      continue;
    }
    // The seed of the contract of the seeder writes the store. Its last line gives the amounts that it wrote.
    // The point sets the level variables of the seed, thus the sizes of the point have them too.
    const tree = appOf(seederId);
    const { seed } = tree.app.start;
    const host = seed === undefined ? undefined : hostCommand(fillCommand(seed, { store: storeOf(point.id), ...variableValues(tree.app, point) }), seeder);
    const sizes = { ...levelsOf(tree.app, point), ...(host === undefined ? {} : seedAmountsOf(await command(start, host.argv, host.cwd, limit), tree.app)) };
    points.push({ id: point.id, sizes, time: since(begun), args: [] });
  }

  // The program of the child is the Node of the image. Node sizes the heap of V8 from the memory limit of the container.
  // The program of an app arm imports the run of its contract, with the options of Node of the run.
  const runOf = (id: string): string => join(options.work, "runs", `${id}.json`);
  const appOptions = new Map<string, readonly string[]>();
  // The fakes of the services of an arm run in a sidecar of each child of the arm, with the workload of a start: no load.
  // The map has the sidecars by the run file of their arm, because the argv of a child names its run file.
  const sidecars = new Map<string, Sidecar>();
  if (subject === undefined) {
    mkdirSync(join(options.work, "runs"), { recursive: true });
    for (const arm of value.arms) {
      const tree = appOf(arm.id);
      const { file, options: flags } = appRunOf(tree, treeOf(arm.id));
      writeFileSync(runOf(arm.id), `${JSON.stringify(file, null, 2)}\n`);
      appOptions.set(arm.id, flags);
      if (tree.app.services.length === 0) continue;
      const fakes = join(options.work, "fakes", `${arm.id}.json`);
      const workload = join(options.work, "fakes", `${arm.id}.workload.json`);
      mkdirSync(join(options.work, "fakes"), { recursive: true });
      writeFileSync(workload, `${JSON.stringify(startWorkloadOf(tree.app), null, 2)}\n`);
      writeFileSync(fakes, `${JSON.stringify(appFakesOf(tree, treeOf(arm.id), workload), null, 2)}\n`);
      const program = ["node", programOf(FAKES_PROGRAM)];
      sidecars.set(runOf(arm.id), { argv: [...program, "host", "--file", fakes], memory: valueIn(FAKES_MEMORY, "B"), cpuset: cpus.others, mounts: [options.work, REPO_ROOT], ready: [...program, "ready"] });
    }
  }
  /** This function gives the start of the children of the arms. The child of an arm with services gets the sidecar of its fakes. */
  const armsStart = (limited: boolean): StartChild => {
    const plain = containerOf(limited);
    const own = new Map([...sidecars].map(([run, sidecar]) => [run, containerOf(limited, [sidecar])]));
    return (argv, rest) => {
      const at = argv.indexOf("--run");
      return ((at === -1 ? undefined : own.get(argv[at + 1] ?? "")) ?? plain)(argv, rest);
    };
  };
  const programFor = (arm: StartArm): string[] =>
    subject === undefined
      ? ["node", "--expose-gc", ...(appOptions.get(arm.id) ?? []), programOf(APP_START_PROGRAM), "--run", runOf(arm.id)]
      : ["node", "--expose-gc", programOf(subject.start), "--tree", treeOf(arm.id), ...(arm.snapshot === true ? ["--snapshot"] : [])];
  // The ballasts of the target and of the arm model the processes of the target that the program does not run.
  const armOf = (arm: StartArm) => ({ id: arm.id, command: [...programFor(arm), ...ballastFlags(target.others), ...ballastFlags(arm.ballast)], cwd: treeOf(arm.id), commit: arm.commit });
  // A point with the field after has the seeded store of its seed point.
  const seededFor = (point: StartPoint): SeededPoint => {
    const root = seedPointOf(value.points, point.id);
    const seeded = points.find((each) => each.id === root);
    if (seeded === undefined) throw new RangeError(`The point "${point.id}" has no seeded store.`);
    return seeded;
  };
  const watchFlags = ["--watch", String(valueIn(value.watch, "ms")), ...(value.samples === undefined ? [] : ["--samples", String(valueIn(value.samples, "ms"))])];
  const firstOf = (point: string, arm: string): string => join(options.work, "firsts", point, arm);
  const storeFor = (point: StartPoint, arm: string): string => (point.after === undefined ? storeOf(point.id) : firstOf(point.id, arm));

  // A point with the field after gets one first start of each arm on its earlier point, with no limit of the disk and no ballast.
  const firsts: FirstStart[] = [];
  const unlimited = armsStart(false);
  for (const point of value.points) {
    if (point.after === undefined) continue;
    const earlier = value.points.find((each) => each.id === point.after)!;
    for (const arm of value.arms) {
      const home = firstOf(point.id, arm.id);
      rmSync(home, { recursive: true, force: true });
      mkdirSync(join(home, ".."), { recursive: true });
      cpSync(storeFor(earlier, arm.id), home, { recursive: true });
      const begun = performance.now();
      const argv = [...programFor(arm), "--case", earlier.id, "--home", home, ...seededFor(earlier).args, "--watch", String(valueIn(value.watch, "ms"))];
      const line = childLine(await command(unlimited, argv, treeOf(arm.id), childLimitOf(value)));
      if (line.skipped !== undefined) throw new Error(`The first start of the arm "${arm.id}" on "${earlier.id}" skipped: ${line.skipped}`);
      const passes = numberIn(line.extra, "passes") ?? 0;
      // The snapshot of the start is written at the first pass of the watch. With no pass, the second start reads no snapshot.
      if (arm.snapshot === true && passes < 1) throw new Error(`The first start of the arm "${arm.id}" on "${earlier.id}" did no pass in its watch. It wrote no snapshot.`);
      const { writes, writeLongest } = writeMeasures(line);
      firsts.push({ point: point.id, after: earlier.id, arm: arm.id, time: since(begun), passes, writes, writeLongest, files: filesOf(home) });
    }
  }

  // A child with a cold cache, or of a point with the field after, opens a home that the lab places before the child.
  const cold = target.cache === "cold";
  const placed = cold || value.points.some((point) => point.after !== undefined);
  const childHome = join(options.work, "home");
  const argsOf = new Map(
    value.points.map((point) => {
      const store = placed ? [cold ? "--home" : "--seeded", childHome] : ["--seeded", storeOf(point.id)];
      return [point.id, ["--case", point.id, ...store, ...seededFor(point).args, ...watchFlags]];
    }),
  );
  // The turn of a child of the A/A copy has the id of the base, thus the copy opens the store of the base.
  const before = async (turn: ChildTurn): Promise<void> => {
    const point = value.points.find((each) => each.id === turn.case);
    if (point === undefined) throw new RangeError(`The turn has no point "${turn.case}".`);
    rmSync(childHome, { recursive: true, force: true });
    cpSync(storeFor(point, turn.arm), childHome, { recursive: true });
    if (cold) await disk.drop();
  };
  const fresh = await freshRun({
    base: armOf(base),
    candidates: candidates.map(armOf),
    cases: value.points.map((point) => point.id),
    rounds: value.rounds,
    roundOffset: (run - 1) * value.rounds,
    aa: true,
    order: "arms",
    args: (id) => argsOf.get(id) ?? [],
    timeoutMs: valueIn(childLimitOf(value), "ms"),
    overLimit: "skip",
    skipScope: "child",
    job: String(run),
    env: { ...benchEnv(), ...host },
    start: armsStart(true),
    ...(placed ? { before } : {}),
  });

  const readings: StartReading[] = (fresh.children ?? []).map((each) => {
    const fields = each.fields ?? {};
    return {
      arm: each.arm,
      point: each.case,
      round: each.round,
      position: each.position,
      measures: startMeasures(each.ms, fields),
      open: openOf(fields),
      stalled: fields.extra?.["stalled"] === true,
      ballasts: ballastsOf(fields),
      samples: samplesOf(fields),
    };
  });
  const ended = now();
  const record: StartRecord = {
    format: START_RECORD_FORMAT,
    case: value,
    machine: {
      cpu: host.cpu,
      cores: host.cores,
      ...(host.runner === undefined ? {} : { runner: host.runner }),
      kernel: release(),
      architecture: arch(),
      node: process.version,
      memory: quantity(totalmem(), "B"),
    },
    at: { started: started.toISOString(), ended: ended.toISOString() },
    job: String(run),
    image,
    check,
    trees,
    pairs: Object.keys(fresh.pairs),
    points,
    firsts,
    disks,
    readings,
    orders: fresh.orders ?? [],
    failures: fresh.skipped.filter((skip) => skip.kind !== "line"),
    skipped: fresh.skipped.filter((skip) => skip.kind === "line"),
  };
  return { record, result: fresh };
};

/** This read tells if a child was ready in a window: `ready`, `late`, or `no read` when the record cannot tell. */
export type WindowRead = "ready" | "late" | "no read";

/** A window read is the read of one child in one ready window of the case. */
export interface StartWindowRead {
  readonly point: string;
  readonly arm: string;
  readonly round: number;
  readonly window: Quantity;
  readonly read: WindowRead;
  /** This kind is the kind of the failure of the child, for a child that passed a limit of the target. */
  readonly failure?: SkipKind;
}

/**
 * This function gives the late margin of a point, in milliseconds, or null when no reading gives it. A child over the
 * time limit needs this margin for a late read. The margin is the start of the container and the longest copy of the
 * point. It also has the longest time of a child of the record after the end of its open.
 */
const lateMarginOf = (record: StartRecord, point: string): number | null => {
  const after: number[] = [];
  const copies: number[] = [];
  for (const reading of record.readings) {
    const { end, readiness, copy, ballast } = reading.measures;
    if (end === null || readiness === null || copy === null) continue;
    // A record of a version with no measure ballast has no ballast. Then the preparation is the copy.
    const prepared = valueIn(copy, "ms") + (ballast === null ? 0 : valueIn(ballast, "ms"));
    after.push(valueIn(end, "ms") - valueIn(readiness, "ms") - prepared);
    if (reading.point === point) copies.push(prepared);
  }
  return after.length === 0 || copies.length === 0 ? null : valueIn(record.check.start, "ms") + Math.max(...copies) + Math.max(...after);
};

/**
 * This function gives the read of each child of a start record in each ready window of its case.
 *
 * - A child with a reading is ready in a window when its readiness and one probe interval are in the window.
 * - A child over the time limit is late in a window when its time limit holds the window and the late margin of its point.
 *   The late margin is the start of the container, the longest copy of the point and the longest time of a child after its open.
 *   Else the child has no read.
 * - A child that passed the memory limit or the heap limit has no read. It does not fit, and the time of its stop does not tell its readiness.
 */
export const windowReads = (record: StartRecord): readonly StartWindowRead[] => {
  const probe = valueIn(record.case.probe, "ms");
  const limit = valueIn(childLimitOf(record.case), "ms");
  const out: StartWindowRead[] = [];
  for (const window of record.case.windows) {
    const ms = valueIn(window, "ms");
    for (const reading of record.readings) {
      const { readiness } = reading.measures;
      const read: WindowRead = readiness === null ? "no read" : valueIn(readiness, "ms") + probe <= ms ? "ready" : "late";
      out.push({ point: reading.point, arm: reading.arm, round: reading.round, window, read });
    }
    for (const failure of record.failures) {
      const margin = failure.kind === "time" ? lateMarginOf(record, failure.case) : null;
      const read: WindowRead = margin !== null && ms + margin <= limit ? "late" : "no read";
      out.push({ point: failure.case, arm: failure.arm, round: failure.round, window, read, failure: failure.kind });
    }
  }
  return out;
};

/** This function tells if a child of an arm or of its A/A copy is a child of the arm of an observation. */
const ofArm = (child: string, arm: string): boolean => child === arm || child === `${arm}~aa`;

/** An observation read is an observation of the target machine. It has the reads of the children of the record at the point, the arm and the window of the observation. */
export interface ObservationRead {
  readonly observation: StartObservation;
  readonly reads: readonly WindowRead[];
  /** This flag tells that each read is the fact of the machine. It is null when the record has no read of the observation. */
  readonly agrees: boolean | null;
}

/** This function compares each observation of the case of a start record with the reads of its children. */
export const observationReads = (record: StartRecord, reads: readonly StartWindowRead[] = windowReads(record)): readonly ObservationRead[] =>
  record.case.observed.map((observation) => {
    const window = valueIn(observation.window, "ms");
    const mine = reads.filter((each) => each.point === observation.point && ofArm(each.arm, observation.arm) && valueIn(each.window, "ms") === window).map((each) => each.read);
    const known = mine.filter((read) => read !== "no read");
    const agrees = known.length === 0 || known.length < mine.length ? null : known.every((read) => (read === "ready") === observation.ready);
    return { observation, reads: mine, agrees };
  });

/** These measures are the measures that each reading has. The others are null on a machine with no `/proc`, or with no full GC. */
const NEEDED: readonly StartMeasure[] = ["ready", "readiness", "firstPass", "end", "peak", "rss", "heap", "live", "read", "faults", "heapPeak", "gc", "watchPeak", "watchRss", "watchHeapPeak", "limit"];

/**
 * This function examines a start record and gives each problem that it finds.
 *
 * - Each reading has each needed measure.
 * - Each arm and the A/A pair have a child of each point in each round: a reading, a failure or a skip.
 * - Each observation of the target machine agrees with the reads of the children. A record with no read of an observation has a problem too.
 */
export const startRecordProblems = (record: StartRecord): readonly CheckProblem[] => {
  const problems: CheckProblem[] = [];
  const id = record.case.id;
  // An app has no pass of the lab, thus its readings have no first pass.
  const needed = record.case.app === undefined ? NEEDED : NEEDED.filter((name) => name !== "firstPass");
  for (const reading of record.readings) {
    const missing = needed.filter((name) => reading.measures[name] === null);
    if (missing.length > 0) problems.push({ code: "read", path: `${id}: ${reading.arm} on ${reading.point}`, message: `The reading has no ${missing.join(", ")}.` });
  }
  const arms = [record.case.arms[0]?.id ?? "", ...record.pairs];
  const rounds = [...new Set(record.orders.map((order) => order.round))];
  if (rounds.length === 0) problems.push({ code: "record", path: id, message: "The record has no order of a round." });
  const ended = [...record.failures, ...record.skipped];
  for (const point of record.case.points) {
    for (const round of rounds) {
      const absent = arms.filter((arm) => !record.readings.some((each) => each.arm === arm && each.point === point.id && each.round === round) && !ended.some((each) => each.arm === arm && each.case === point.id && each.round === round));
      if (absent.length > 0) problems.push({ code: "record", path: `${id}: ${point.id}, round ${round}`, message: `The point has no child of ${absent.join(", ")}.` });
    }
  }
  for (const each of observationReads(record)) {
    const { point, arm, window, ready, source } = each.observation;
    const where = `${id}: ${arm} on ${point} in ${shown(window)}`;
    const fact = ready ? "ready" : "not ready";
    if (each.agrees === null) problems.push({ code: "observed", path: where, message: `The record has no read of each child, and the machine was ${fact} (${source}). The reads: ${each.reads.join(", ") || "none"}.` });
    else if (!each.agrees) problems.push({ code: "observed", path: where, message: `The children were ${each.reads.join(", ")}, and the machine was ${fact} (${source}). The lab does not model the time of the machine.` });
  }
  return problems;
};

/** This function prints an amount of a start record: bytes on the scale of 1024, and times on the scale of short times. */
const shown = (amount: Quantity | null | undefined): string => {
  if (amount === null || amount === undefined) return "no read";
  if (convertible(amount.unit, "B")) return formatOnScale(amount, BYTES_1024);
  if (convertible(amount.unit, "s")) return formatOnScale(amount, DURATION_MS);
  return String(amount.value);
};

/** This function gives the lines of the machine model of a start record: the disks, the cache, the ballasts and the first starts. */
const machineLines = (record: StartRecord): readonly string[] => {
  const { target } = record.case;
  const lines: string[] = [];
  const rate = (bytes: number | undefined, ops: number | undefined, verb: string): string => `${shown(quantity(bytes ?? 0, "B"))}/s and ${ops ?? 0} ${verb}s/s`;
  for (const disk of record.disks) {
    const { limit } = disk;
    lines.push(`- The disk \`${disk.device}\` (${disk.paths.map((path) => `\`${path}\``).join(", ")}): each child reads at ${rate(limit.readBytes, limit.readOps, "read")}, and writes at ${rate(limit.writeBytes, limit.writeOps, "write")}.`);
  }
  if (target.cache === "cold") lines.push("- The cache is cold: the lab drops the page cache of the host before each child, and the child opens its home in place.");
  const ballasts = (list: readonly StartBallast[] | undefined): string => (list ?? []).map((each) => `${shown(each.bytes)} at ${each.at}`).join(", ");
  if ((target.others ?? []).length > 0) lines.push(`- The other processes of the target: ${ballasts(target.others)}.`);
  for (const arm of record.case.arms) if ((arm.ballast ?? []).length > 0) lines.push(`- The ballasts of the arm \`${arm.id}\`: ${ballasts(arm.ballast)}.`);
  for (const first of record.firsts) {
    const bytes = Object.values(first.files).reduce((sum, each) => sum + valueIn(each, "B"), 0);
    lines.push(`- The first start of \`${first.arm}\` on \`${first.after}\` for \`${first.point}\`: ${shown(first.time)}, ${first.passes} passes, ${writesOf(first.writes, first.writeLongest)}, ${Object.keys(first.files).length} files of ${shown(quantity(bytes, "B"))}.`);
  }
  return lines;
};

/** This function gives the text of the writes of the snapshot of a child: the count and the longest block, or no read. */
const writesOf = (writes: Quantity | null | undefined, longest: Quantity | null | undefined): string => {
  if (writes === null || writes === undefined) return "no read of the writes";
  if (writes.value === 0) return "no write";
  return `${writes.value} ${writes.value === 1 ? "write" : "writes"}, the longest block ${shown(longest)}`;
};

/**
 * This function gives the summary of a start record as Markdown, for the summary of a job. The summary has the
 * target, the check, the trees and one row for each child. Each skip and each problem follows the table.
 */
export const startSummaryOf = (record: StartRecord): string => {
  const { machine, check, image } = record;
  const { target } = record.case;
  const reads = windowReads(record);
  // The columns of the variables come from the sizes of the points. Thus the summary names no subject.
  const names = [...new Set(record.points.flatMap((point) => Object.keys(point.sizes)))];
  const windows = record.case.windows;
  const readOf = (point: string, arm: string, round: number): string =>
    windows.map((window) => reads.find((each) => each.point === point && each.arm === arm && each.round === round && valueIn(each.window, "ms") === valueIn(window, "ms"))?.read ?? "no read").join(" | ");
  const lines = [
    `### The start case \`${record.case.id}\`, job ${record.job}`,
    "",
    `- The host: ${escapeMarkdown(`${machine.cpu}, ${machine.cores} CPUs, ${shown(machine.memory)}, Node ${machine.node}, kernel ${machine.kernel}`)}`,
    `- The target: ${escapeMarkdown(`${target.cpus} CPUs, ${shown(target.memory)} of memory, ${shown(target.swap)} of swap, Node ${target.node}`)}. The image: \`${image.digest ?? image.id}\`.`,
    `- The check child: the heap limit of V8 is ${shown(check.heapLimit)}, and the container starts in ${shown(check.start)}.`,
    `- The trees: ${record.trees.map((tree) => `\`${tree.id}\` ${tree.commit.slice(0, 7)}${tree.graft.length > 0 ? ` with ${tree.graft.length} graft` : ""} in ${shown(tree.time)}`).join(", ")}`,
    ...machineLines(record),
    "",
    `| Point | ${names.map((name) => `\`${name}\``).join(" | ")} | Arm | Readiness | ${windows.map((window) => `In ${shown(window)}`).join(" | ")} | Ready | Read to ready | Major faults | VmHWM at ready | Heap peak | Live heap | GC | VmHWM of the watch | Passes | Writes of the snapshot |`,
    `|${" --- |".repeat(names.length + windows.length + 13)}`,
  ];
  // A point with the field after has the sizes of its seed point.
  for (const point of record.case.points) {
    const seeded = record.points.find((each) => each.id === seedPointOf(record.case.points, point.id));
    const sizes = names.map((name) => shown(seeded?.sizes[name]));
    for (const reading of record.readings.filter((each) => each.point === point.id)) {
      const m = reading.measures;
      const cells = [`\`${point.id}\``, ...sizes, `\`${reading.arm}\``, shown(m.readiness), readOf(point.id, reading.arm, reading.round), shown(m.ready), shown(m.read), shown(m.faults), shown(m.peak), shown(m.heapPeak), shown(m.live), shown(m.gc), shown(m.watchPeak)];
      cells.push(m.passes === null ? "no read" : String(m.passes.value));
      cells.push(writesOf(m.writes, m.writeLongest));
      lines.push(`| ${cells.join(" | ")} |`);
    }
    for (const failure of record.failures.filter((each) => each.case === point.id)) {
      const cells = [`\`${point.id}\``, ...sizes, `\`${failure.arm}\``, `does not fit: ${failure.kind}`, readOf(point.id, failure.arm, failure.round), ...Array<string>(10).fill("")];
      lines.push(`| ${cells.join(" | ")} |`);
    }
  }
  lines.push("");
  for (const each of record.readings.filter((reading) => reading.stalled)) {
    lines.push(`- **stalled** \`${each.arm}\` on \`${each.point}\`, round ${each.round}: a pass gave a wake time that is not after the pass. No pass followed in the watch.`);
  }
  for (const failure of record.failures) lines.push(`- **${failure.kind}** \`${failure.case}\`, the arm \`${failure.arm}\`, round ${failure.round}: ${escapeMarkdown(failure.reason)}`);
  for (const skip of record.skipped) lines.push(`- **skip** \`${skip.case}\`, the arm \`${skip.arm}\`, round ${skip.round}: ${escapeMarkdown(skip.reason)}`);
  for (const each of startRecordProblems(record)) lines.push(`- **${each.code}** ${escapeMarkdown(each.path)}: ${escapeMarkdown(each.message)}`);
  return `${lines.join("\n")}\n`;
};
