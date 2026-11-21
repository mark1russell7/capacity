import { mkdirSync } from "node:fs";
import { arch, release, totalmem } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  benchEnv,
  childLine,
  containerStart,
  freshRun,
  startProcess,
  type CaseOrder,
  type ChildFields,
  type ContainerOptions,
  type FreshRun,
  type FreshSkip,
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
  IMAGE_MARGIN,
  SEED_RATE,
  TREE_MARGIN,
  pointAmounts,
  pointBytes,
  startCaseProblems,
  startSubjectOf,
  type Graft,
  type StartCase,
  type StartObservation,
  type StartPoint,
  type StartSubject,
  type StartTarget,
} from "./start.ts";

/** This text is the format of the record of a start case. */
export const START_RECORD_FORMAT = "capacity-start-record/1";

/**
 * These measures are the measures of one start, with their units. The start program reads them in a fresh process.
 *
 * - `ready` is the time to ready: the import of the runtime, the open and the first pass.
 * - `readiness` is the time from the start of the process to the end of the open, less the copy. `firstPass` is the time from that point to ready.
 * - `copy` and `close` are the times of the copy of the store before the start and of the close after the watch.
 * - `end` is the time from the start of the process to the line of the child.
 * - `peak`, `rss`, `anon`, `file`, `heap` and `external` are the memory at ready. `peak` is VmHWM, the peak of the resident set.
 * - `live` is the used heap after a full GC at ready.
 * - `heapPeak` and `livePeak` are the peaks of the used heap and of the live heap over the start, from the GC profiler.
 * - `gc` is the GC time of the start, and `fullGc` is the count of its full GC events.
 * - The measures `watch...` are the peaks over the watch after ready, and `passes` is the count of passes in the watch.
 * - `limit` is the heap size limit of V8 in the child.
 */
export const START_MEASURES = {
  ready: "ms",
  readiness: "ms",
  firstPass: "ms",
  copy: "ms",
  close: "ms",
  end: "ms",
  peak: "B",
  rss: "B",
  anon: "B",
  file: "B",
  heap: "B",
  external: "B",
  live: "B",
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
  /** These sizes are the byte size of each file that the seed wrote, by the name of its variable. */
  readonly sizes: Readonly<Record<string, Quantity>>;
  /** This count is the events of the log. */
  readonly events: number;
  readonly time: Quantity;
  /** These arguments go to the start program for this store. */
  readonly args: readonly string[];
}

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
 * This function makes one tree of a subject in `dir`. The steps are a shallow fetch of the commit, the file of each
 * graft from its commit, and the install of the dependencies. A tree with a graft gets the type check of the subject.
 * It gives the time of the tree.
 */
const makeTree = async (start: StartChild, subject: StartSubject, id: string, commit: string, graft: readonly Graft[], dir: string): Promise<StartTree> => {
  const begun = performance.now();
  const git = (...args: string[]): Promise<string> => command(start, ["git", "-C", dir, ...args], undefined, TREE_MARGIN);
  mkdirSync(dir, { recursive: true });
  await git("init", "-q");
  await git("remote", "add", "origin", subject.repository);
  await git("fetch", "-q", "--depth", "1", "origin", commit);
  await git("checkout", "-q", "FETCH_HEAD");
  for (const each of graft) {
    await git("fetch", "-q", "--depth", "1", "origin", each.commit);
    await git("checkout", each.commit, "--", each.path);
  }
  await command(start, subject.install, dir, TREE_MARGIN);
  if (graft.length > 0) await command(start, subject.check, dir, TREE_MARGIN);
  return { id, commit, graft, time: since(begun) };
};

/** This function reads the child line of the seed program, or it throws. */
const seededOf = (point: StartPoint, stdout: string, time: Quantity, subject: StartSubject): SeededPoint => {
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
    close: amount("close", numberIn(extra, "closeMs")),
    end: amount("end", numberIn(extra, "endMs")),
    peak: amount("peak", fields.peakRss ?? numberIn(ready, "peakRss")),
    rss: amount("rss", numberIn(ready, "rss")),
    anon: amount("anon", numberIn(ready, "anon")),
    file: amount("file", numberIn(ready, "file")),
    heap: amount("heap", numberIn(ready, "heapUsed")),
    external: amount("external", numberIn(ready, "external")),
    live: amount("live", numberIn(extra, "live")),
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
  };
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
  const subject = startSubjectOf(value);
  const started = now();
  const { target } = value;

  const image = await pullImage(start, target.image);
  const child = container({
    image: target.image,
    memory: valueIn(target.memory, "B"),
    swap: valueIn(target.swap, "B"),
    cpuset: cpuSetsOf(target.cpus, host.cores).subject,
    mounts: [options.work, REPO_ROOT],
  });
  const check = await checkTarget(child, target);

  const [base, ...candidates] = value.arms;
  if (base === undefined) throw new RangeError("The start case has no arm.");
  const treeOf = (id: string): string => join(options.work, "trees", id);
  const trees: StartTree[] = [];
  for (const arm of value.arms) trees.push(await makeTree(start, subject, arm.id, arm.commit, arm.graft ?? [], treeOf(arm.id)));
  const plain = value.arms.find((arm) => arm.commit === value.seeder && (arm.graft ?? []).length === 0);
  const seeder = plain === undefined ? treeOf("seeder") : treeOf(plain.id);
  if (plain === undefined) trees.push(await makeTree(start, subject, "seeder", value.seeder, [], seeder));

  const storeOf = (id: string): string => join(options.work, "stores", id);
  const points: SeededPoint[] = [];
  for (const point of value.points) {
    const amounts = pointAmounts(subject, point);
    const flags = Object.entries(amounts).flatMap(([name, each]) => [`--${name}`, String(Math.round(each))]);
    const limit = quantity(valueIn(CHILD_MARGIN, "s") + pointBytes(subject, point) / SEED_RATE, "s");
    mkdirSync(storeOf(point.id), { recursive: true });
    const begun = performance.now();
    const stdout = await command(start, [process.execPath, programOf(subject.seed), "--tree", seeder, "--out", storeOf(point.id), "--seed", value.seed, ...flags], undefined, limit);
    points.push(seededOf(point, stdout, since(begun), subject));
  }

  // The program of the child is the Node of the image. Node sizes the heap of V8 from the memory limit of the container.
  const armOf = (arm: StartCase["arms"][number]) => ({ id: arm.id, command: ["node", "--expose-gc", programOf(subject.start), "--tree", treeOf(arm.id)], cwd: treeOf(arm.id), commit: arm.commit });
  const argsOf = new Map(points.map((point) => [point.id, ["--case", point.id, "--seeded", storeOf(point.id), ...point.args, "--watch", String(valueIn(value.watch, "ms"))]]));
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
    start: child,
  });

  const readings: StartReading[] = (fresh.children ?? []).map((each) => {
    const fields = each.fields ?? {};
    return { arm: each.arm, point: each.case, round: each.round, position: each.position, measures: startMeasures(each.ms, fields), open: openOf(fields), stalled: fields.extra?.["stalled"] === true };
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
    const { end, readiness, copy } = reading.measures;
    if (end === null || readiness === null || copy === null) continue;
    after.push(valueIn(end, "ms") - valueIn(readiness, "ms") - valueIn(copy, "ms"));
    if (reading.point === point) copies.push(valueIn(copy, "ms"));
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
const NEEDED: readonly StartMeasure[] = ["ready", "readiness", "firstPass", "end", "peak", "rss", "heap", "live", "heapPeak", "gc", "watchPeak", "watchRss", "watchHeapPeak", "limit"];

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
  for (const reading of record.readings) {
    const missing = NEEDED.filter((name) => reading.measures[name] === null);
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
    "",
    `| Point | ${names.map((name) => `\`${name}\``).join(" | ")} | Arm | Readiness | ${windows.map((window) => `In ${shown(window)}`).join(" | ")} | Ready | VmHWM at ready | Heap peak | Live heap | GC | VmHWM of the watch | Passes |`,
    `|${" --- |".repeat(names.length + windows.length + 10)}`,
  ];
  for (const point of record.points) {
    const sizes = names.map((name) => shown(point.sizes[name]));
    for (const reading of record.readings.filter((each) => each.point === point.id)) {
      const m = reading.measures;
      const cells = [`\`${point.id}\``, ...sizes, `\`${reading.arm}\``, shown(m.readiness), readOf(point.id, reading.arm, reading.round), shown(m.ready), shown(m.peak), shown(m.heapPeak), shown(m.live), shown(m.gc), shown(m.watchPeak)];
      cells.push(m.passes === null ? "no read" : String(m.passes.value));
      lines.push(`| ${cells.join(" | ")} |`);
    }
    for (const failure of record.failures.filter((each) => each.case === point.id)) {
      const cells = [`\`${point.id}\``, ...sizes, `\`${failure.arm}\``, `does not fit: ${failure.kind}`, readOf(point.id, failure.arm, failure.round), ...Array<string>(7).fill("")];
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
