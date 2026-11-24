import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppContract } from "@mark1russell7/capacity";
import type { ChildExit, ContainerOptions, FreshSkip, StartChild } from "@mark1russell7/rigor-bench/fresh";
import { afterEach, describe, expect, it } from "vitest";
import { APP_CASE, FIXTURE } from "./app-fixtures.ts";
import type { StartCase } from "./start.ts";
import { APP_START_PROGRAM, RUN_SLOTS, type AppRunFile } from "./start-app.ts";
import {
  CHECK_PROGRAM,
  START_RECORD_FORMAT,
  ballastsOf,
  childLimitOf,
  measureStart,
  observationReads,
  samplesOf,
  seedPointOf,
  startMeasures,
  startRecordProblems,
  startSummaryOf,
  targetCheckOf,
  targetMismatches,
  windowReads,
  writeMeasures,
  type HostDisk,
  type StartReading,
  type StartRecord,
} from "./start-measure.ts";

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;
const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const ID = `sha256:${"d".repeat(64)}`;
const DIGEST = `node@sha256:${"e".repeat(64)}`;
const APP_START = fileURLToPath(new URL(`./subject/${APP_START_PROGRAM}`, import.meta.url));
const REPO = fileURLToPath(new URL("../../../", import.meta.url)).replace(/[\\/]+$/, "");
const OOM = "<--- Last few GCs --->\nFATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory\n";
const s = (value: number) => ({ value, unit: "s" });

/** This case starts the app of the tests at two stores, with a seeder of its own, two rounds, two windows and one observation. */
const CASE: StartCase = {
  ...APP_CASE,
  seeder: C,
  rounds: 2,
  watch: s(120),
  limit: { value: 5, unit: "min" },
  windows: [s(90), s(240)],
  target: { image: "node:24.21.0-bookworm-slim", node: "v24.21.0", memory: { value: 1011425280, unit: "B" }, swap: { value: 2, unit: "GiB" }, cpus: 2, heapLimit: { value: 556269568, unit: "B" } },
  observed: [{ point: "large", arm: "base", window: s(90), ready: false, source: "the supervisor of the machine: 3 stops" }],
};

/** The line of the check child in a container of the target of `CASE`. */
const CHECK = { uptime: 60_000, node: "v24.21.0", memoryMax: "1011425280", swapMax: String(2 * GIB), hostSwap: 4 * GIB, heapLimit: 556269568, cpus: 2 };

interface Call {
  readonly argv: readonly string[];
  readonly cwd: string | undefined;
  readonly timeoutMs: number;
}

const ok = (stdout: string): ChildExit => ({ stdout, stderr: "", code: 0 });
const flagOf = (argv: readonly string[], name: string): string => argv[argv.indexOf(`--${name}`) + 1]!;
/** This function gives the arm of a child from the run file of its command. */
const armOf = (argv: readonly string[]): string => basename(flagOf(argv, "run"), ".json");

/** This function gives the command of the program `app-start` for an arm, with the option of Node of its run. */
const programOf = (folder: string, arm: string): readonly string[] => ["node", "--expose-gc", "--max-semi-space-size=1", APP_START, "--run", join(folder, "runs", `${arm}.json`)];

/** The peak of the resident set of each arm: the arm `new` uses less memory. */
const PEAK: Readonly<Record<string, number>> = { base: 200 * MIB, new: 150 * MIB };

/** The readiness of each child: the base on the large point ends its open after 2 minutes, and each other child after 4 seconds. */
const readinessOf = (arm: string, point: string): number => (arm === "base" && point === "large" ? 120_000 : 4000);

/** This write is the record of one line `write` of a run: one write of the snapshot of the start. */
const WRITE = { at: 1, rows: 2000, chars: 31_000_000, rowsMs: 900, writeMs: 1400, cpuMs: 2500, wallMs: 3100, longestMs: 45, chunks: 64 };
/** The samples of a child with the flag --samples: one sample, with a null for each value that the child cannot read. */
const SAMPLE = { ms: 5000, readBytes: 40 * MIB, writeBytes: MIB, majorFaults: 2000, rss: 100 * MIB, cgroup: { memory: 500 * MIB, swap: null, readBytes: 400 * MIB, writeBytes: null, reads: 1000, writes: null } };

/** This function gives the line of the program app-start for one child, as the real program prints it. An app has no first pass. */
const startLine = (arm: string, point: string, argv: readonly string[] = []): string => {
  const peak = PEAK[arm]!;
  const flags = argv.flatMap((each, index) => (argv[index - 1] === "--ballast" ? [each.split("@")] : []));
  const ballasts = flags.map(([bytes, at]) => ({ bytes: Number(bytes), at, rss: Number(bytes) + MIB, ms: 300 }));
  const readiness = readinessOf(arm, point);
  const ready = { rss: peak - MIB, peakRss: peak, anon: peak / 2, file: null, heapUsed: 80 * MIB, external: 8 * MIB };
  const watch = { rss: peak, peakRss: peak + MIB, anon: peak / 2, file: null, heapUsed: 70 * MIB, external: 8 * MIB };
  const startHeap = { used: 120 * MIB, live: 60 * MIB, gc: 30, fullGc: 2, gcMs: 250, limit: 556269568 };
  const watchHeap = { used: 90 * MIB, live: 58 * MIB, gc: 12, fullGc: 1, gcMs: 40, limit: 556269568 };
  const line = {
    ms: readiness + 1000,
    readiness,
    firstPass: null,
    peakRss: peak,
    ready,
    io: { at: 1, readBytes: 300 * MIB, writeBytes: 2 * MIB, majorFaults: 4000, rss: peak, cgroup: { memory: null, swap: null, readBytes: null, writeBytes: null, reads: null, writes: null } },
    live: 60 * MIB,
    startHeap,
    watch,
    watchHeap,
    watchCpu: 500,
    watchMs: argv.includes("--watch") ? Number(flagOf(argv, "watch")) : 120_000,
    passes: 10,
    stalled: false,
    limit: 556269568,
    copyMs: argv.includes("--home") ? 0 : 500,
    ballastMs: ballasts.filter((each) => each.at === "start").length * 300,
    closeMs: 20,
    closeCode: 0,
    ballasts,
    samples: argv.includes("--samples") ? [SAMPLE] : [],
    // The run of the base has a line write, thus a child of the base gives one write. The run of the arm new has no record of the writes.
    ...(arm === "base" ? { writes: [WRITE] } : {}),
    open: ["FSReqCallback"],
    endMs: readiness + 500 + 1500 + 120_000 + 20,
  };
  return `${JSON.stringify(line)}\n`;
};

/**
 * This start answers each command of the host: the pull and the inspect of the image, git, the install and the seed of the
 * contract. The checkout of a tree gives the files of the app of the tests, and `contract` can change its contract.
 */
const fakeStart =
  (calls: Call[], fails: (argv: readonly string[]) => ChildExit | undefined = () => undefined, contract: (text: string) => string = (text) => text): StartChild =>
  async (argv, options) => {
    calls.push({ argv, cwd: options.cwd, timeoutMs: options.timeoutMs });
    const failed = fails(argv);
    if (failed !== undefined) return failed;
    if (argv[0] === "docker" && argv[1] === "image") return ok(`${ID} ${JSON.stringify([DIGEST])}\n`);
    if (argv[0] === "docker" && argv[1] === "info") return ok("/var/lib/docker\n");
    if (argv[0] === "git" && argv.includes("FETCH_HEAD")) {
      const tree = argv[2]!;
      cpSync(FIXTURE, tree, { recursive: true });
      writeFileSync(join(tree, "capacity-app.json"), contract(readFileSync(join(tree, "capacity-app.json"), "utf8")));
    }
    if (argv.includes("seed.ts")) {
      writeFileSync(join(flagOf(argv, "out"), "point.txt"), basename(flagOf(argv, "out")));
      return ok(`The seed wrote the log.\n${JSON.stringify({ amounts: { log: Number(flagOf(argv, "log")) } })}\n`);
    }
    return ok("");
  };

/** This container gives the check line to the check child and the line of `app-start` to each child. It keeps its options and its calls. */
const fakeContainer = (seen: ContainerOptions[], calls: Call[], fails: (argv: readonly string[]) => ChildExit | undefined = () => undefined, check: object = CHECK) =>
  (options: ContainerOptions): StartChild =>
    async (argv, limits) => {
      seen.push(options);
      calls.push({ argv, cwd: limits.cwd, timeoutMs: limits.timeoutMs });
      const failed = fails(argv);
      if (failed !== undefined) return failed;
      if (argv[1] === "-e") return ok(`${JSON.stringify(check)}\n`);
      return ok(startLine(armOf(argv), flagOf(argv, "case"), argv));
    };

const folders: string[] = [];
const work = (): string => {
  const folder = mkdtempSync(join(tmpdir(), "start-measure-"));
  folders.push(folder);
  return folder;
};
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

const HOST = { cpu: "Test CPU", cores: 4 };
const clock = (): (() => Date) => {
  let calls = 0;
  return () => new Date(Date.UTC(2026, 10, 21, 14, calls++));
};

/** This function measures a case with the fake host and the fake container, and gives the record. */
const recorded = async (value: StartCase = CASE, fails?: (argv: readonly string[]) => ChildExit | undefined): Promise<StartRecord> =>
  (await measureStart(value, { work: work(), start: fakeStart([]), container: fakeContainer([], [], fails), host: HOST })).record;

describe("measureStart", () => {
  it("pulls the image, checks the target, installs each tree and seeds each point from the contract, and starts the program app-start in a container of the target", async () => {
    const calls: Call[] = [];
    const inside: Call[] = [];
    const seen: ContainerOptions[] = [];
    const folder = work();
    const { record, result } = await measureStart(CASE, { work: folder, start: fakeStart(calls), container: fakeContainer(seen, inside), host: HOST, now: clock() });
    const tree = (id: string): string => join(folder, "trees", id);
    const store = (id: string): string => join(folder, "stores", id);

    expect(calls.slice(0, 2).map((call) => call.argv.join(" "))).toEqual([
      "docker pull --quiet node:24.21.0-bookworm-slim",
      "docker image inspect --format {{.Id}} {{json .RepoDigests}} node:24.21.0-bookworm-slim",
    ]);
    expect(record.image).toEqual({ name: "node:24.21.0-bookworm-slim", id: ID, digest: DIGEST });
    // Each child of the case starts in a container with the memory, the swap and 2 CPUs of the target, and the two mounts.
    expect(seen[0]).toEqual({ image: "node:24.21.0-bookworm-slim", memory: 1011425280, swap: 2 * GIB, cpuset: "0-1", mounts: [folder, REPO] });
    expect(inside[0]?.argv).toEqual(["node", "-e", CHECK_PROGRAM]);
    expect(record.check).toMatchObject({ node: "v24.21.0", memoryMax: "1011425280", heapLimit: { value: 556269568, unit: "B" }, cpus: 2 });

    // No arm has the commit of the seeder, thus the case has one more tree.
    const git = calls.filter((call) => call.argv[0] === "git").map((call) => call.argv.slice(1).join(" "));
    expect(git.slice(0, 4)).toEqual([`-C ${tree("base")} init -q`, `-C ${tree("base")} remote add origin ${CASE.app}`, `-C ${tree("base")} fetch -q --depth 1 origin ${A}`, `-C ${tree("base")} checkout -q FETCH_HEAD`]);
    expect(git).toHaveLength(3 * 4);
    expect(record.trees.map((each) => [each.id, each.commit])).toEqual([
      ["base", A],
      ["new", B],
      ["seeder", C],
    ]);
    // The install of the contract starts on the host, in each tree.
    expect(calls.filter((call) => call.argv.join(" ") === "node --version").map((call) => call.cwd)).toEqual([tree("base"), tree("new"), tree("seeder")]);

    // The seed of the contract starts on the host, in the tree of the seeder. Its last line gives the amounts that it wrote.
    const seeds = calls.filter((call) => call.argv.includes("seed.ts"));
    expect(seeds.map((call) => [call.argv, call.cwd])).toEqual([
      [["env", "FIXTURE_SEED=1", "node", "seed.ts", "--out", store("small"), "--log", "1024"], tree("seeder")],
      [["env", "FIXTURE_SEED=1", "node", "seed.ts", "--out", store("large"), "--log", String(512 * 1024)], tree("seeder")],
    ]);
    expect(seeds.map((call) => call.timeoutMs)).toEqual([(60 + 1 / 1024) * 1000, (60 + 0.5) * 1000]);
    expect(record.points.map((point) => [point.id, point.sizes, point.args])).toEqual([
      ["small", { log: { value: 1024, unit: "B" } }, []],
      ["large", { log: { value: 512 * 1024, unit: "B" } }, []],
    ]);

    const run = JSON.parse(readFileSync(join(folder, "runs", "new.json"), "utf8")) as AppRunFile;
    expect(run).toMatchObject({ app: "fixture-app", script: join(tree("new"), "app.ts"), args: ["--store", RUN_SLOTS.store], slots: { store: RUN_SLOTS.store } });
    // Each round starts one child of each arm and one A/A child of the base, on each point, with the Node of the image.
    const children = inside.filter((call) => call.argv.includes(APP_START));
    expect(children).toHaveLength(2 * 2 * 3);
    const first = children.find((call) => call.cwd === tree("new"))!;
    const point = flagOf(first.argv, "case");
    expect(first.argv).toEqual([...programOf(folder, "new"), "--case", point, "--seeded", store(point), "--watch", "120000"]);
    expect(first.timeoutMs).toBe((300 + 120 + 60) * 1000);
    expect(childLimitOf(CASE)).toEqual({ value: 480_000, unit: "ms" });

    expect(record.format).toBe(START_RECORD_FORMAT);
    expect(record.job).toBe("1");
    expect(record.pairs).toEqual(["new", "base~aa"]);
    expect(Object.keys(result.pairs)).toEqual(["new", "base~aa"]);
    expect(record.readings).toHaveLength(12);
    const peaks = Object.fromEntries(record.readings.map((reading) => [reading.arm, reading.measures.peak]));
    expect(peaks).toEqual({ base: { value: 200 * MIB, unit: "B" }, new: { value: 150 * MIB, unit: "B" }, "base~aa": { value: 200 * MIB, unit: "B" } });
    expect([...new Set(record.readings.map((reading) => reading.round))]).toEqual([0, 1]);
    // The place of each child is its place in the order of its point and round.
    for (const order of record.orders) {
      const mine = record.readings.filter((reading) => reading.point === order.case && reading.round === order.round);
      expect(mine.map((reading) => order.arms[reading.position])).toEqual(mine.map((reading) => reading.arm));
    }
    expect(record.readings.every((reading) => reading.open.length === 1 && !reading.stalled)).toBe(true);
    expect(record.machine).toMatchObject({ cpu: "Test CPU", cores: 4, node: process.version });
    expect(record.at).toEqual({ started: "2026-11-21T14:00:00.000Z", ended: "2026-11-21T14:01:00.000Z" });
    expect(record.orders).toHaveLength(4);
    expect(record.failures).toEqual([]);
    expect(record.skipped).toEqual([]);
    // A reading of an app has no first pass, and the record needs none. The CPU of the watch is a needed measure.
    expect(record.readings.every((reading) => reading.measures.firstPass === null)).toBe(true);
    expect(record.readings[0]!.measures).toMatchObject({ watchCpu: { value: 500, unit: "ms" }, watchCores: { value: 500 / 120_000, unit: "{core}" } });
    expect(startRecordProblems({ ...record, readings: record.readings.map((reading) => ({ ...reading, measures: { ...reading.measures, watchCores: null } })) })).toHaveLength(record.readings.length);
    expect(startRecordProblems(record)).toEqual([]);
  });

  it("uses the tree of the arm with the commit of the seeder for the seed", async () => {
    const calls: Call[] = [];
    const folder = work();
    const { record } = await measureStart({ ...CASE, seeder: B, rounds: 1 }, { work: folder, start: fakeStart(calls), container: fakeContainer([], []), host: HOST });
    expect(record.trees.map((each) => each.id)).toEqual(["base", "new"]);
    expect(calls.filter((call) => call.argv.includes("seed.ts")).map((call) => call.cwd)).toEqual([join(folder, "trees", "new"), join(folder, "trees", "new")]);
  });

  it("keeps a digest of the image only in its form, and throws for an inspect with no id", async () => {
    const inspect = (stdout: string) => (argv: readonly string[]): ChildExit | undefined => (argv[1] === "image" ? ok(stdout) : undefined);
    const imageOf = async (stdout: string) => (await measureStart({ ...CASE, rounds: 1 }, { work: work(), start: fakeStart([], inspect(stdout)), container: fakeContainer([], []), host: HOST })).record.image;
    expect(await imageOf(`${ID} []\n`)).toEqual({ name: CASE.target.image, id: ID, digest: null });
    expect((await imageOf(`${ID} ${JSON.stringify([`node\`x@sha256:${"e".repeat(64)}`])}\n`)).digest).toBeNull();
    expect((await imageOf(`${ID} ${JSON.stringify(["node@sha256:short"])}\n`)).digest).toBeNull();
    await expect(imageOf("sha256:abc []\n")).rejects.toThrow("The inspect of the image node:24.21.0-bookworm-slim gave no id: sha256:abc []");
  });

  it("turns the rounds by the run: the run 2 of 2 rounds has the rounds 2 and 3, and the job 2", async () => {
    const { record } = await measureStart(CASE, { work: work(), start: fakeStart([]), container: fakeContainer([], []), host: HOST, run: 2 });
    expect(record.job).toBe("2");
    expect([...new Set(record.readings.map((reading) => reading.round))]).toEqual([2, 3]);
  });

  it("records a child over a limit of the target as a failure of its kind, and the other arms still start", async () => {
    // The A/A child has the command of the base. Thus only the first child of the base on the small point passes the memory limit.
    let baseSmall = 0;
    const over = (argv: readonly string[]): ChildExit | undefined => {
      if (!argv.includes(APP_START)) return undefined;
      const at = `${armOf(argv)} ${flagOf(argv, "case")}`;
      if (at === "new large") return { stdout: "", stderr: OOM, code: 134 };
      if (at === "base small" && baseSmall++ === 0) return { stdout: "", stderr: "", code: 137, oomKilled: true };
      if (at === "new small") return { stdout: "", stderr: "", code: null, timedOut: true };
      return undefined;
    };
    const record = await recorded({ ...CASE, rounds: 1 }, over);
    expect(record.failures.map((each) => `${each.arm.replace("~aa", "")} ${each.case} ${each.kind}`).sort()).toEqual(["base small memory", "new large heap", "new small time"]);
    expect(record.failures.find((each) => each.kind === "heap")?.reason).toMatch(/^reached the heap limit of V8: .*JavaScript heap out of memory$/);
    expect(record.failures.find((each) => each.kind === "memory")?.reason).toBe("passed the memory limit of its container");
    expect(record.skipped).toEqual([]);
    expect(record.readings.map((reading) => `${reading.arm.replace("~aa", "")} ${reading.point}`).sort()).toEqual(["base large", "base large", "base small"]);
    expect(startRecordProblems(record)).toEqual([]);
  });

  it("stops before the trees when the container does not model the target", async () => {
    const calls: Call[] = [];
    const other = { ...CHECK, heapLimit: 2181038080, cpus: 4, swapMax: "max", hostSwap: 0 };
    await expect(measureStart(CASE, { work: work(), start: fakeStart(calls), container: fakeContainer([], [], undefined, other), host: HOST })).rejects.toThrow(
      `The container does not model the target: the swap limit of the cgroup is max, not ${2 * GIB}, the host has 0 bytes of swap, less than ${2 * GIB}, the heap limit of V8 is 2181038080, not 556269568, the child has 4 CPUs, not 2.`,
    );
    expect(calls.filter((call) => call.argv[0] === "git")).toEqual([]);
  });

  it("throws with the tail of stderr (or of stdout when stderr is empty) when a command fails, and before each command for a case with a problem", async () => {
    const refused = (argv: readonly string[]): ChildExit | undefined =>
      argv[0] === "git" && argv.includes("fetch") ? { stdout: "", stderr: "fatal: could not read from the remote", code: 128 } : undefined;
    const container = fakeContainer([], []);
    await expect(measureStart(CASE, { work: work(), start: fakeStart([], refused), container, host: HOST })).rejects.toThrow(/fetch .* exited with the code 128\. The tail of stderr: fatal: could not read from the remote/);
    const pull = (argv: readonly string[]): ChildExit | undefined => (argv[1] === "pull" ? { stdout: "", stderr: "toomanyrequests", code: 1 } : undefined);
    await expect(measureStart(CASE, { work: work(), start: fakeStart([], pull), container, host: HOST })).rejects.toThrow(/docker pull .* exited with the code 1\. The tail of stderr: toomanyrequests/);
    // tsc prints its errors on stdout. Thus a command with an empty stderr gives the tail of its stdout.
    const typed = (argv: readonly string[]): ChildExit | undefined =>
      argv.join(" ") === "node --version" ? { stdout: "src/app.ts(12,5): error TS2353: Object literal may only specify known properties.\n", stderr: "", code: 2 } : undefined;
    await expect(measureStart(CASE, { work: work(), start: fakeStart([], typed), container, host: HOST })).rejects.toThrow(/node --version exited with the code 2\. The tail of stdout: src\/app\.ts\(12,5\): error TS2353/);
    const check = (argv: readonly string[]): ChildExit | undefined => (argv[1] === "-e" ? { stdout: "", stderr: "exec format error", code: 1 } : undefined);
    await expect(measureStart(CASE, { work: work(), start: fakeStart([]), container: fakeContainer([], [], check), host: HOST })).rejects.toThrow(/check child .* failed\. The tail of stderr: exec format error/);

    const calls: Call[] = [];
    await expect(measureStart({ ...CASE, rounds: 0 }, { work: work(), start: fakeStart(calls), container, host: HOST })).rejects.toThrow(RangeError);
    await expect(measureStart(CASE, { work: work(), start: fakeStart(calls), container, host: HOST, run: 0 })).rejects.toThrow(RangeError);
    // A case with no app has a problem: the lab starts only an app from its contract.
    const none: Record<string, unknown> = { ...CASE };
    delete none["app"];
    await expect(measureStart(none as unknown as StartCase, { work: work(), start: fakeStart(calls), container, host: HOST })).rejects.toThrow(/app: The case has no app\./);
    expect(calls).toEqual([]);
  });

  it("gives the sidecar of each child the fakes of its point: the workload of the rate of the point, and the memory of the case", async () => {
    // The contract of the tree gets a feed, a class of events from the feed, and the bytes of one event.
    const loaded = (text: string): string => {
      const app = JSON.parse(text) as AppContract;
      const fake = { argv: ["node", "feed.ts", "--port", "{port}", "--rates", "{workload}"], cwd: ".", env: {}, ready: { kind: "line", text: "feed up" } };
      return JSON.stringify({
        ...app,
        variables: [...app.variables, { id: "eventBytes", title: "The bytes of one event", kind: "request", unit: "B", min: 200, max: 100000, scale: "linear" }],
        classes: [{ id: "event", title: "An event of the feed", rate: { unit: "{event}/s", min: 0, max: 100, scale: "linear" }, request: ["eventBytes"], entry: { kind: "service", service: "feed" } }],
        services: [{ id: "feed", title: "A feed of events", fake }],
        start: { ...app.start, run: { ...app.start.run, argv: [...app.start.run.argv, "--feed", "{service.feed}"] } },
      });
    };
    const bytes = { value: 2000, unit: "B" };
    const points = [
      { id: "idle", at: { log: { value: 1, unit: "KiB" }, event: { value: 0, unit: "{event}/s" }, eventBytes: bytes } },
      { id: "busy", at: { log: { value: 1, unit: "KiB" }, event: { value: 30, unit: "{event}/s" }, eventBytes: bytes } },
    ];
    const loadCase: StartCase = { ...CASE, seeder: A, rounds: 1, observed: [], points, fakes: { value: 256, unit: "MiB" } };
    const placed: string[] = [];
    const inner = fakeContainer([], []);
    const container = (options: ContainerOptions): StartChild => {
      const child = inner(options);
      return async (argv, limits) => {
        const sidecars = (options.sidecars ?? []).map((each) => `${basename(each.argv.at(-1) ?? "")} ${each.memory}`);
        if (argv.includes(APP_START)) placed.push(`${armOf(argv)} ${flagOf(argv, "case")}: ${sidecars.join(", ") || "none"}`);
        return child(argv, limits);
      };
    };
    const folder = work();
    const { record } = await measureStart(loadCase, { work: folder, start: fakeStart([], undefined, loaded), container, host: HOST, now: clock() });

    expect([...new Set(placed)].sort()).toEqual([`base busy: base.busy.json ${256 * MIB}`, `base idle: base.idle.json ${256 * MIB}`, `new busy: new.busy.json ${256 * MIB}`, `new idle: new.idle.json ${256 * MIB}`]);
    const workload = (name: string): unknown => JSON.parse(readFileSync(join(folder, "fakes", `${name}.workload.json`), "utf8"));
    expect(workload("new.busy")).toMatchObject({ id: "fixture-app/busy", classes: [{ id: "event", rate: { value: 30, unit: "{event}/s" }, request: { eventBytes: bytes } }], levels: {} });
    expect(workload("new.idle")).toMatchObject({ id: "fixture-app/idle", classes: [] });
    // The load of a point is in its sizes, thus a start law can have the rate of a class as its variable.
    expect(record.points.map((point) => [point.id, point.sizes])).toEqual([
      ["idle", { log: { value: 1024, unit: "B" }, event: { value: 0, unit: "{event}/s" }, eventBytes: bytes }],
      ["busy", { log: { value: 1024, unit: "B" }, event: { value: 30, unit: "{event}/s" }, eventBytes: bytes }],
    ]);
    expect(startRecordProblems(record)).toEqual([]);
  });

  it("throws before the seed for a tree whose contract does not fit the case", async () => {
    const calls: Call[] = [];
    const other = (text: string): string => text.replace('"id": "fixture-app"', '"id": "other-app"');
    await expect(measureStart(CASE, { work: work(), start: fakeStart(calls, undefined, other), container: fakeContainer([], []), host: HOST })).rejects.toThrow(/has the id "other-app"/);
    expect(calls.some((call) => call.argv.includes("seed.ts"))).toBe(false);
  });
});

const MODEL: StartCase = {
  ...CASE,
  rounds: 1,
  arms: [CASE.arms[0]!, { ...CASE.arms[1]!, ballast: [{ bytes: { value: 69, unit: "MiB" }, at: "ready", models: "the bundle of the live start" }] }],
  points: [...CASE.points, { id: "again", at: CASE.points[1]!.at, after: "large" }],
  samples: s(5),
  target: {
    ...CASE.target,
    disk: { readBytes: { value: 14, unit: "MiB/s" }, readOps: { value: 200, unit: "{read}/s" }, writeBytes: { value: 7, unit: "MiB/s" }, writeOps: { value: 100, unit: "{write}/s" }, source: "the study of the start" },
    cache: "cold",
    others: [{ bytes: { value: 322, unit: "MiB" }, at: "start", models: "the other processes of the machine" }],
  },
};

/** This disk of the host puts the data of Docker on `/dev/sda` and each other path on `/dev/sdb`. It counts the drops of the page cache. */
const fakeDisk = (drops: string[]): HostDisk => ({
  of: (path) => (path === "/var/lib/docker" ? "/dev/sda" : "/dev/sdb"),
  drop: async () => {
    drops.push("drop");
  },
  swaps: () => ["/mnt/swapfile"],
});

/**
 * This container is the fake container. It also writes the home of a first start: the id of the arm, and a snapshot for
 * the arm base. Each child of the case gives what its home holds: the point of the seed and the arm of the first start.
 */
const modelContainer = (seen: ContainerOptions[], calls: Call[], homes: string[]) => {
  const inner = fakeContainer(seen, calls);
  return (options: ContainerOptions): StartChild => {
    const child = inner(options);
    return async (argv, limits) => {
      const home = argv.includes("--home") ? flagOf(argv, "home") : undefined;
      if (home !== undefined && home.includes("firsts")) {
        writeFileSync(join(home, "first.txt"), armOf(argv));
        if (armOf(argv) === "base") writeFileSync(join(home, "snapshot.bin"), Buffer.alloc(1024));
      } else if (home !== undefined) {
        const first = join(home, "first.txt");
        homes.push(`${armOf(argv)} ${flagOf(argv, "case")}: ${readFileSync(join(home, "point.txt"), "utf8")} ${existsSync(first) ? readFileSync(first, "utf8") : "-"}`);
      }
      return child(argv, limits);
    };
  };
};

describe("the machine model of measureStart", () => {
  it("limits the disks of each child, drops the page cache before each child, starts the ballasts and places the home of a second start", async () => {
    const calls: Call[] = [];
    const inside: Call[] = [];
    const seen: ContainerOptions[] = [];
    const homes: string[] = [];
    const drops: string[] = [];
    const folder = work();
    const { record } = await measureStart(MODEL, { work: folder, start: fakeStart(calls), container: modelContainer(seen, inside, homes), host: HOST, disk: fakeDisk(drops) });
    const tree = (id: string): string => join(folder, "trees", id);
    const home = join(folder, "home");

    // The work folder and the swap file are on one disk, and the data of Docker is on the other disk.
    const limit = { readBytes: 14 * MIB, readOps: 200, writeBytes: 7 * MIB, writeOps: 100 };
    expect(record.disks).toEqual([
      { device: "/dev/sdb", paths: [folder, "/mnt/swapfile"], limit: { device: "/dev/sdb", ...limit } },
      { device: "/dev/sda", paths: ["/var/lib/docker"], limit: { device: "/dev/sda", ...limit } },
    ]);
    expect(calls.some((call) => call.argv.join(" ") === "docker info --format {{.DockerRootDir}}")).toBe(true);
    expect(seen[0]?.disks).toEqual([{ device: "/dev/sdb", ...limit }, { device: "/dev/sda", ...limit }]);

    // The point again has no seed. Each arm starts once on the point large, with no limit of the disk and no ballast.
    expect(record.points.map((point) => point.id)).toEqual(["small", "large"]);
    const firsts = inside.flatMap((call, index) => (call.argv.some((each) => each.includes("firsts")) ? [{ call, options: seen[index]! }] : []));
    expect(firsts.map(({ call }) => call.argv)).toEqual([
      [...programOf(folder, "base"), "--case", "large", "--home", join(folder, "firsts", "again", "base"), "--watch", "120000"],
      [...programOf(folder, "new"), "--case", "large", "--home", join(folder, "firsts", "again", "new"), "--watch", "120000"],
    ]);
    expect(firsts.every(({ options }) => options.disks === undefined)).toBe(true);
    expect(firsts.map(({ call }) => call.timeoutMs)).toEqual([480_000, 480_000]);
    expect(record.firsts.map((each) => [each.point, each.after, each.arm, each.passes, each.writes?.value ?? null, each.writeLongest?.value ?? null, each.files])).toEqual([
      ["again", "large", "base", 10, 1, 45, { "first.txt": { value: 4, unit: "B" }, "point.txt": { value: 5, unit: "B" }, "snapshot.bin": { value: 1024, unit: "B" } }],
      ["again", "large", "new", 10, null, null, { "first.txt": { value: 3, unit: "B" }, "point.txt": { value: 5, unit: "B" } }],
    ]);

    // Each child opens its home in place, with the ballasts of the target and of its arm, and the samples.
    const children = inside.filter((call, index) => call.argv.includes(APP_START) && !firsts.some((each) => each.call === inside[index]));
    expect(children).toHaveLength(3 * 3);
    expect(children.find((call) => call.cwd === tree("new") && flagOf(call.argv, "case") === "again")?.argv).toEqual([
      ...programOf(folder, "new"), "--ballast", `${322 * MIB}@start`, "--ballast", `${69 * MIB}@ready`,
      "--case", "again", "--home", home, "--watch", "120000", "--samples", "5000",
    ]);
    expect(children.find((call) => call.cwd === tree("base"))?.argv.slice(0, 8)).toEqual([...programOf(folder, "base"), "--ballast", `${322 * MIB}@start`]);
    expect(children.every((call) => (seen[inside.indexOf(call)]?.disks ?? []).length === 2)).toBe(true);
    // The lab places the store of the point before each child. A child of the point again gets the home of the first start of its arm, and the A/A copy gets the home of the base.
    expect(drops).toHaveLength(9);
    expect([...homes].sort()).toEqual(["base again: large base", "base again: large base", "base large: large -", "base large: large -", "base small: small -", "base small: small -", "new again: large new", "new large: large -", "new small: small -"]);

    const reading = record.readings.find((each) => each.arm === "new" && each.point === "again")!;
    expect(reading.measures).toMatchObject({ copy: { value: 0, unit: "ms" }, ballast: { value: 300, unit: "ms" }, read: { value: 300 * MIB, unit: "B" }, faults: { value: 4000, unit: "{fault}" } });
    expect(reading.ballasts).toEqual([
      { bytes: { value: 322 * MIB, unit: "B" }, at: "start", rss: { value: 323 * MIB, unit: "B" }, time: { value: 300, unit: "ms" } },
      { bytes: { value: 69 * MIB, unit: "B" }, at: "ready", rss: { value: 70 * MIB, unit: "B" }, time: { value: 300, unit: "ms" } },
    ]);
    expect(reading.samples).toEqual([SAMPLE]);
    expect(startRecordProblems(record)).toEqual([]);

    const summary = startSummaryOf(record);
    expect(summary).toContain(`- The disk \`/dev/sdb\` (\`${folder}\`, \`/mnt/swapfile\`): each child reads at 14 MiB/s and 200 reads/s, and writes at 7 MiB/s and 100 writes/s.`);
    expect(summary).toContain("- The cache is cold: the lab drops the page cache of the host before each child, and the child opens its home in place.");
    expect(summary).toContain("- The other processes of the target: 322 MiB at start.");
    expect(summary).toContain("- The ballasts of the arm `new`: 69 MiB at ready.");
    expect(summary).toContain("- The first start of `base` on `large` for `again`: ");
    expect(summary).toContain(", 10 passes, 1 write, the longest block 45 ms, 3 files of 1 KiB.");
    expect(summary).toContain(", 10 passes, no read of the writes, 2 files of ");
    expect(summary).toMatch(/\| `base` \|[^\n]* \| 10 \| 1 write, the longest block 45 ms \|\n/);
    // A point with the field after has the sizes of its seed point.
    expect(summary).toContain("| `again` | 512 KiB | `new` | 4 s | ready | ready | 5 s | 300 MiB | 4000 | 150 MiB |");
  });

  it("starts no first start, places no home and drops no cache for a warm case with no point after another", async () => {
    const drops: string[] = [];
    const homes: string[] = [];
    const inside: Call[] = [];
    const seen: ContainerOptions[] = [];
    const { record } = await measureStart({ ...CASE, rounds: 1 }, { work: work(), start: fakeStart([]), container: modelContainer(seen, inside, homes), host: HOST, disk: fakeDisk(drops) });
    expect([record.disks, record.firsts, drops, homes]).toEqual([[], [], [], []]);
    expect(seen.every((options) => options.disks === undefined)).toBe(true);
    expect(inside.filter((call) => call.argv.includes(APP_START)).every((call) => call.argv.includes("--seeded"))).toBe(true);
  });

  it("copies the home of a warm second start before the child, and the child copies it again", async () => {
    const homes: string[] = [];
    const inside: Call[] = [];
    const folder = work();
    const warm: StartCase = { ...MODEL, target: { ...CASE.target } };
    const { record } = await measureStart(warm, { work: folder, start: fakeStart([]), container: modelContainer([], inside, homes), host: HOST, disk: fakeDisk([]) });
    const children = inside.filter((call) => call.argv.includes("--seeded"));
    expect(children).toHaveLength(9);
    expect(children.every((call) => flagOf(call.argv, "seeded") === join(folder, "home"))).toBe(true);
    expect(record.readings.every((reading) => reading.measures.copy?.value === 500)).toBe(true);
  });
});

describe("seedPointOf, ballastsOf and samplesOf", () => {
  it("give the seed point of a point, through each point after another", () => {
    const points = [{ id: "a", at: {} }, { id: "b", at: {}, after: "a" }, { id: "c", at: {}, after: "b" }];
    expect(points.map((point) => seedPointOf(points, point.id))).toEqual(["a", "a", "a"]);
    expect(seedPointOf(points, "none")).toBeUndefined();
  });

  it("keep each ballast and each sample with fields of the right type, and null for each value of a sample that the child cannot read", () => {
    const fields = {
      extra: {
        ballasts: [{ bytes: 10, at: "start", rss: 12, ms: 3 }, { bytes: 10, at: "opened", rss: 12, ms: 3 }, { bytes: "10", at: "ready", rss: 12, ms: 3 }, null],
        samples: [{ ms: 1000, readBytes: 5, cgroup: { reads: 2 } }, { readBytes: 5 }, 7],
      },
    };
    expect(ballastsOf(fields)).toEqual([{ bytes: { value: 10, unit: "B" }, at: "start", rss: { value: 12, unit: "B" }, time: { value: 3, unit: "ms" } }]);
    expect(samplesOf(fields)).toEqual([
      { ms: 1000, readBytes: 5, writeBytes: null, majorFaults: null, rss: null, cgroup: { memory: null, swap: null, readBytes: null, writeBytes: null, reads: 2, writes: null } },
    ]);
    expect([ballastsOf({}), samplesOf({ extra: { samples: "x" } })]).toEqual([[], []]);
  });
});

describe("targetCheckOf and targetMismatches", () => {
  it("read the last line of the check child, and give the start of the container from the time of the command", () => {
    const check = targetCheckOf(`warning\n${JSON.stringify(CHECK)}\n`, 60_900);
    expect(check).toEqual({
      node: "v24.21.0",
      memoryMax: "1011425280",
      swapMax: String(2 * GIB),
      hostSwap: { value: 4 * GIB, unit: "B" },
      heapLimit: { value: 556269568, unit: "B" },
      cpus: 2,
      start: { value: 900, unit: "ms" },
    });
    expect(targetCheckOf(JSON.stringify({ ...CHECK, hostSwap: null, memoryMax: null }), 10)).toMatchObject({ hostSwap: null, memoryMax: null, start: { value: 0, unit: "ms" } });
    expect(targetMismatches(CASE.target, check)).toEqual([]);
  });

  it("throw for a line that is not JSON, not a record, or with a field of a wrong type", () => {
    expect(() => targetCheckOf("Segmentation fault", 1)).toThrow(/printed no JSON line: Segmentation fault/);
    expect(() => targetCheckOf("[1]", 1)).toThrow(/printed no record/);
    for (const wrong of [{ cpus: 2.5 }, { heapLimit: "556269568" }, { node: 24 }, { swapMax: 0 }, { uptime: -1 }]) {
      expect(() => targetCheckOf(JSON.stringify({ ...CHECK, ...wrong }), 1)).toThrow(/a field of a wrong type/);
    }
  });

  it("give each fact that is not the fact of the target, and need no swap of the host for a target with no swap", () => {
    const check = targetCheckOf(JSON.stringify({ ...CHECK, node: "v26.13.1", memoryMax: "max", swapMax: "0", hostSwap: null }), 100);
    expect(targetMismatches(CASE.target, check)).toEqual([
      "the Node version is v26.13.1, not v24.21.0",
      "the memory limit of the cgroup is max, not 1011425280",
      `the swap limit of the cgroup is 0, not ${2 * GIB}`,
      `the host has no readable bytes of swap, less than ${2 * GIB}`,
    ]);
    const none = { ...CASE.target, swap: { value: 0, unit: "B" }, heapLimit: null };
    expect(targetMismatches(none, targetCheckOf(JSON.stringify({ ...CHECK, swapMax: "0", hostSwap: null, heapLimit: 1 }), 100))).toEqual([]);
  });
});

describe("startMeasures", () => {
  it("gives each measure in its unit, and null for each field that the child did not give", () => {
    const measures = startMeasures(1500, {
      peakRss: 100,
      extra: { ready: { rss: 90, peakRss: 80, anon: null, heapUsed: 40 }, live: 30, passes: 2, watch: { peakRss: 120 }, readiness: 1200, startHeap: { used: 50, live: null, gcMs: 7, fullGc: 0 }, endMs: 9000 },
    });
    expect(measures).toMatchObject({
      ready: { value: 1500, unit: "ms" },
      readiness: { value: 1200, unit: "ms" },
      firstPass: null,
      end: { value: 9000, unit: "ms" },
      peak: { value: 100, unit: "B" },
      rss: { value: 90, unit: "B" },
      anon: null,
      file: null,
      heap: { value: 40, unit: "B" },
      live: { value: 30, unit: "B" },
      heapPeak: { value: 50, unit: "B" },
      livePeak: null,
      gc: { value: 7, unit: "ms" },
      fullGc: { value: 0, unit: "{gc}" },
      watchPeak: { value: 120, unit: "B" },
      watchRss: null,
      watchHeapPeak: null,
      passes: { value: 2, unit: "{pass}" },
      limit: null,
      copy: null,
      ballast: null,
      close: null,
      read: null,
      faults: null,
    });
    expect(startMeasures(1, { extra: { ballastMs: 300, io: { readBytes: 7, majorFaults: 2 } } })).toMatchObject({ ballast: { value: 300, unit: "ms" }, read: { value: 7, unit: "B" }, faults: { value: 2, unit: "{fault}" } });
    expect(startMeasures(1, { extra: { ready: { peakRss: 80 } } }).peak).toEqual({ value: 80, unit: "B" });
  });

  it("gives the count of the writes of the snapshot and the longest time of each kind, and null for a tree with no record", () => {
    const writes = [WRITE, { ...WRITE, at: 2, rowsMs: 1200, writeMs: 900, cpuMs: 2000, wallMs: 3500, longestMs: 80 }];
    expect(writeMeasures({ extra: { writes } })).toEqual({
      writes: { value: 2, unit: "{write}" },
      writeLongest: { value: 80, unit: "ms" },
      writeStore: { value: 1400, unit: "ms" },
      writeRows: { value: 1200, unit: "ms" },
      writeWall: { value: 3500, unit: "ms" },
      writeCpu: { value: 2500, unit: "ms" },
    });
    expect(startMeasures(1, { extra: { writes } })).toMatchObject({ writes: { value: 2, unit: "{write}" }, writeLongest: { value: 80, unit: "ms" } });
    // A start with no write gives a count of 0 and no time.
    expect(writeMeasures({ extra: { writes: [] } })).toEqual({ writes: { value: 0, unit: "{write}" }, writeLongest: null, writeStore: null, writeRows: null, writeWall: null, writeCpu: null });
    // A run with no line write gives null for each measure. A field of a wrong type gives no value.
    for (const extra of [{}, { writes: null }, { writes: { longestMs: 1 } }]) expect(Object.values(writeMeasures({ extra }))).toEqual(Array<null>(6).fill(null));
    expect(writeMeasures({ extra: { writes: [{ longestMs: "9" }, { longestMs: 3 }] } }).writeLongest).toEqual({ value: 3, unit: "ms" });
  });
});

describe("windowReads and observationReads", () => {
  it("give ready for a child whose readiness and one probe are in the window, and late for each other child with a reading", async () => {
    const record = await recorded({ ...CASE, rounds: 1, windows: [s(4.5), s(90), s(121)] });
    const reads = windowReads(record);
    const of = (arm: string, point: string): string[] => reads.filter((each) => each.arm === arm && each.point === point).map((each) => each.read);
    expect(of("new", "small")).toEqual(["ready", "ready", "ready"]);
    expect(of("base", "large")).toEqual(["late", "late", "ready"]);
    expect(of("base~aa", "large")).toEqual(["late", "late", "ready"]);
    // The readiness is 120 s and the probe is 500 ms: thus the window of 120.4 s is late, and the window of 120.5 s is ready.
    const edge = windowReads(await recorded({ ...CASE, rounds: 1, windows: [{ value: 120_499, unit: "ms" }, { value: 120_500, unit: "ms" }], observed: [] }));
    expect(edge.filter((each) => each.arm === "base" && each.point === "large").map((each) => each.read)).toEqual(["late", "ready"]);
  });

  it("give late for a child over the time limit only when the window and the late margin of its point are in its limit", async () => {
    const record = await recorded({ ...CASE, rounds: 1 });
    // The longest copy of the point is 500 ms, and the longest time of a child after its open is 121.52 s.
    const late: FreshSkip = { arm: "new", case: "large", round: 0, reason: "took more than 480000 ms", kind: "time" };
    const at = (ms: number, failure: FreshSkip, base: StartRecord = record): string | undefined =>
      windowReads({ ...base, case: { ...base.case, windows: [{ value: ms, unit: "ms" }] }, failures: [failure] }).find((each) => each.failure !== undefined)?.read;
    // With a container start of 1 s, the late margin is 123.02 s. The limit of 480 s less the margin is 356.98 s.
    const check = { ...record.check, start: { value: 1000, unit: "ms" } };
    expect(at(356_980, late, { ...record, check })).toBe("late");
    expect(at(356_981, late, { ...record, check })).toBe("no read");
    expect(at(90_000, late)).toBe("late");
    expect(at(90_000, { ...late, kind: "memory" })).toBe("no read");
    expect(at(90_000, { ...late, kind: "heap" })).toBe("no read");
    expect(at(90_000, { ...late, case: "none" })).toBe("no read");
    // The ballasts of the moment start are a part of the preparation, as the copy is. A ballast of 1 s on the point large adds 1 s to its longest preparation, and the longest time after the open comes from the point small.
    const ballasted: StartRecord = { ...record, check, readings: record.readings.map((reading) => (reading.point === "large" ? { ...reading, measures: { ...reading.measures, ballast: { value: 1000, unit: "ms" } } } : reading)) };
    expect(at(355_980, late, ballasted)).toBe("late");
    expect(at(355_981, late, ballasted)).toBe("no read");
  });

  it("tell if each observation agrees with the reads of the children of its arm and its A/A copy", async () => {
    const record = await recorded({ ...CASE, rounds: 1 });
    expect(observationReads(record).map((each) => [each.reads, each.agrees])).toEqual([[["late", "late"], true]]);
    const ready = { ...record, case: { ...record.case, observed: [{ ...record.case.observed[0]!, ready: true }] } };
    expect(observationReads(ready)[0]?.agrees).toBe(false);
    const failed = { ...record, readings: record.readings.filter((reading) => !(reading.arm === "base~aa" && reading.point === "large")), failures: [{ arm: "base~aa", case: "large", round: 0, reason: "passed the memory limit of its container", kind: "memory" as const }] };
    expect(observationReads(failed).map((each) => [each.reads, each.agrees])).toEqual([[["late", "no read"], null]]);
  });
});

describe("startRecordProblems and startSummaryOf", () => {
  it("find a reading with no needed measure, an arm with no child in a round, and each observation that the record does not agree with", async () => {
    const record = await recorded({ ...CASE, rounds: 1 });
    const fewer: StartReading[] = record.readings
      .filter((reading) => reading.arm !== "new" || reading.point !== "small")
      .map((reading) => (reading.arm === "base" && reading.point === "large" ? { ...reading, measures: { ...reading.measures, live: null, end: null } } : reading));
    const broken: StartRecord = { ...record, readings: fewer, case: { ...record.case, observed: [{ ...record.case.observed[0]!, ready: true }] } };
    expect(startRecordProblems(broken).map((each) => `${each.code} ${each.path}: ${each.message}`)).toEqual([
      "read fixture-start/test: base on large: The reading has no end, live.",
      "record fixture-start/test: small, round 0: The point has no child of new.",
      "observed fixture-start/test: base on large in 1 min 30 s: The children were late, late, and the machine was ready (the supervisor of the machine: 3 stops). The lab does not model the time of the machine.",
    ]);
    const none: StartRecord = { ...record, readings: record.readings.filter((reading) => reading.point !== "large" || reading.arm === "new"), failures: [{ arm: "base", case: "large", round: 0, reason: "passed the memory limit of its container", kind: "memory" }, { arm: "base~aa", case: "large", round: 0, reason: "passed the memory limit of its container", kind: "memory" }] };
    expect(startRecordProblems(none).map((each) => `${each.code} ${each.path}: ${each.message}`)).toEqual([
      "observed fixture-start/test: base on large in 1 min 30 s: The record has no read of each child, and the machine was not ready (the supervisor of the machine: 3 stops). The reads: no read, no read.",
    ]);
  });

  it("give the host, the target, the image, the check, the trees, one row for each child with the read of each window, and each failure", async () => {
    const record = await recorded({ ...CASE, rounds: 1 });
    const failed: StartRecord = {
      ...record,
      readings: record.readings.map((reading, index) => (index === 0 ? { ...reading, stalled: true } : reading)).filter((reading) => reading.arm !== "new" || reading.point !== "large"),
      failures: [{ arm: "new", case: "large", round: 0, reason: "reached the heap limit of V8: JavaScript heap out of memory", kind: "heap" }],
      skipped: [{ arm: "base", case: "small", round: 0, reason: "no store", kind: "line" }],
    };
    const summary = startSummaryOf(failed);
    expect(summary).toContain("### The start case `fixture-start/test`, job 1");
    // The text of the target has an escape before each mark. The digest is in a code span with no escape.
    expect(summary).toContain("- The target: 2 CPUs\\, ");
    expect(summary).toContain(` of memory\\, 2 GiB of swap\\, Node v24\\.21\\.0. The image: \`${DIGEST}\`.`);
    expect(summary).toContain("- The check child: the heap limit of V8 is 530.5 MiB, and the container starts in 0 ms.");
    expect(summary).toContain(`\`base\` ${A.slice(0, 7)} in `);
    expect(summary).toContain("| Point | `log` | Arm | Readiness | In 1 min 30 s | In 4 min | Ready | Read to ready | Major faults | VmHWM at ready | Heap peak | Live heap | GC | VmHWM of the watch | Passes | Writes of the snapshot |");
    expect(summary).toContain(`\n|${" --- |".repeat(16)}\n`);
    expect(summary).toContain("| `small` | 1 KiB | `new` | 4 s | ready | ready | 5 s | 300 MiB | 4000 | 150 MiB | 120 MiB | 60 MiB | 250 ms | 151 MiB | 10 | no read of the writes |");
    expect(summary).not.toContain("- The disk ");
    expect(summary).not.toContain("- The cache is cold");
    expect(summary).toContain("| `large` | 512 KiB | `base` | 2 min | late | ready |");
    expect(summary).toContain("| `large` | 512 KiB | `new` | does not fit: heap | no read | no read |");
    expect(summary).toContain("- **stalled** `");
    expect(summary).toContain("- **heap** `large`, the arm `new`, round 0: reached the heap limit of V8\\: JavaScript heap out of memory");
    expect(summary).toContain("- **skip** `small`, the arm `base`, round 0: no store");
    expect(summary.split("\n").filter((line) => line.startsWith("| `"))).toHaveLength(6);
  });
});
