import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChildExit, ContainerOptions, FreshSkip, StartChild } from "@mark1russell7/rigor-bench/fresh";
import { afterEach, describe, expect, it } from "vitest";
import { START_FORMAT, type StartCase } from "./start.ts";
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
const GRAFT = "packages/runtime/src/measured-start.ts";
const SEED = fileURLToPath(new URL("./subject/alerts-seed.main.ts", import.meta.url));
const START = fileURLToPath(new URL("./subject/alerts-start.main.ts", import.meta.url));
const REPO = fileURLToPath(new URL("../../../", import.meta.url)).replace(/[\\/]+$/, "");
const OOM = "<--- Last few GCs --->\nFATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory\n";
const s = (value: number) => ({ value, unit: "s" });

const CASE: StartCase = {
  format: START_FORMAT,
  id: "alerts-start/test",
  title: "Two points",
  subject: "alerts",
  seeder: C,
  arms: [
    { id: "base", commit: A, graft: [{ path: GRAFT, commit: B }] },
    { id: "new", commit: B },
  ],
  points: [
    { id: "small", at: { log: { value: 16, unit: "MiB" } } },
    { id: "large", at: { log: { value: 64, unit: "MiB" }, shapes: { value: 2, unit: "MiB" } } },
  ],
  seed: "test-1",
  rounds: 2,
  watch: s(120),
  limit: { value: 5, unit: "min" },
  windows: [s(90), s(240)],
  probe: { value: 500, unit: "ms" },
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
const armOf = (argv: readonly string[]): string => basename(flagOf(argv, "tree"));

/** The peak of the resident set of each arm: the arm `new` uses less memory. */
const PEAK: Readonly<Record<string, number>> = { base: 200 * MIB, new: 150 * MIB };

/** The readiness of each child: the base on the large point ends its open after 2 minutes, and each other child after 4 seconds. */
const readinessOf = (arm: string, point: string): number => (arm === "base" && point === "large" ? 120_000 : 4000);

/** The samples of a child with the flag --samples: one sample, with a null for each value that the child cannot read. */
const SAMPLE = { ms: 5000, readBytes: 40 * MIB, writeBytes: MIB, majorFaults: 2000, rss: 100 * MIB, cgroup: { memory: 500 * MIB, swap: null, readBytes: 400 * MIB, writeBytes: null, reads: 1000, writes: null } };

/** This function gives the line of the start program for one child, as the real program prints it. */
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
    firstPass: 1500,
    peakRss: peak,
    ready,
    io: { at: 1, readBytes: 300 * MIB, writeBytes: 2 * MIB, majorFaults: 4000, rss: peak, cgroup: { memory: null, swap: null, readBytes: null, writeBytes: null, reads: null, writes: null } },
    live: 60 * MIB,
    startHeap,
    watch,
    watchHeap,
    passes: 10,
    stalled: false,
    limit: 556269568,
    copyMs: argv.includes("--home") ? 0 : 500,
    ballastMs: ballasts.filter((each) => each.at === "start").length * 300,
    closeMs: 20,
    ballasts,
    samples: argv.includes("--samples") ? [SAMPLE] : [],
    open: ["FSReqCallback"],
    endMs: readiness + 500 + 1500 + 120_000 + 20,
  };
  return `${JSON.stringify(line)}\n`;
};

/** This start answers each command of the host: the pull and the inspect of the image, git, the install and the seed program. */
const fakeStart = (calls: Call[], fails: (argv: readonly string[]) => ChildExit | undefined = () => undefined): StartChild =>
  async (argv, options) => {
    calls.push({ argv, cwd: options.cwd, timeoutMs: options.timeoutMs });
    const failed = fails(argv);
    if (failed !== undefined) return failed;
    if (argv[0] === "docker" && argv[1] === "image") return ok(`${ID} ${JSON.stringify([DIGEST])}\n`);
    if (argv[0] === "docker" && argv[1] === "info") return ok("/var/lib/docker\n");
    if (argv.includes(SEED)) {
      writeFileSync(join(flagOf(argv, "out"), "point.txt"), basename(flagOf(argv, "out")));
      const sizes = { log: Number(flagOf(argv, "log")), shapes: Number(flagOf(argv, "shapes")), transit: Number(flagOf(argv, "transit")) };
      return ok(`seeding\n${JSON.stringify({ ms: 12, sizes, args: ["--end", "1767227897200"], logEvents: 759 })}\n`);
    }
    return ok("");
  };

/** This container gives the check line to the check child and the start line to each child, and keeps its options and its calls. */
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
  it("pulls the image, checks the target, makes each tree, seeds each point once, and starts each child in a container of the target", async () => {
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

    const git = calls.filter((call) => call.argv[0] === "git").map((call) => call.argv.slice(1).join(" "));
    expect(git.slice(0, 6)).toEqual([
      `-C ${tree("base")} init -q`,
      `-C ${tree("base")} remote add origin https://github.com/metrograph-labs/alerts.git`,
      `-C ${tree("base")} fetch -q --depth 1 origin ${A}`,
      `-C ${tree("base")} checkout -q FETCH_HEAD`,
      `-C ${tree("base")} fetch -q --depth 1 origin ${B}`,
      `-C ${tree("base")} checkout ${B} -- ${GRAFT}`,
    ]);
    expect(git).toHaveLength(6 + 4 + 4);
    // Only the tree with a graft gets the type check.
    expect(calls.filter((call) => call.argv[0] === "pnpm").map((call) => [call.argv.join(" "), call.cwd])).toEqual([
      ["pnpm install --frozen-lockfile", tree("base")],
      ["pnpm --filter @mark1russell7/alerts-runtime run typecheck", tree("base")],
      ["pnpm install --frozen-lockfile", tree("new")],
      ["pnpm install --frozen-lockfile", tree("seeder")],
    ]);
    expect(record.trees.map((each) => [each.id, each.commit, each.graft.length])).toEqual([
      ["base", A, 1],
      ["new", B, 0],
      ["seeder", C, 0],
    ]);

    // The seed program starts on the host, with the Node of the lab.
    const seeds = calls.filter((call) => call.argv.includes(SEED));
    expect(seeds.map((call) => call.argv)).toEqual([
      [process.execPath, SEED, "--tree", tree("seeder"), "--out", store("small"), "--seed", "test-1", "--log", String(16 * MIB), "--shapes", "0", "--transit", "0"],
      [process.execPath, SEED, "--tree", tree("seeder"), "--out", store("large"), "--seed", "test-1", "--log", String(64 * MIB), "--shapes", String(2 * MIB), "--transit", "0"],
    ]);
    expect(seeds.map((call) => call.timeoutMs)).toEqual([(60 + 16) * 1000, (60 + 66) * 1000]);
    expect(record.points.map((point) => [point.id, point.sizes["log"], point.sizes["shapes"], point.events, point.args])).toEqual([
      ["small", { value: 16 * MIB, unit: "B" }, { value: 0, unit: "B" }, 759, ["--end", "1767227897200"]],
      ["large", { value: 64 * MIB, unit: "B" }, { value: 2 * MIB, unit: "B" }, 759, ["--end", "1767227897200"]],
    ]);

    // Each round starts one child of each arm and one A/A child of the base, on each point, with the Node of the image.
    const children = inside.filter((call) => call.argv.includes(START));
    expect(children).toHaveLength(2 * 2 * 3);
    const first = children.find((call) => call.cwd === tree("new"))!;
    expect(first.argv).toEqual(["node", "--expose-gc", START, "--tree", tree("new"), "--case", flagOf(first.argv, "case"), "--seeded", store(flagOf(first.argv, "case")), "--end", "1767227897200", "--watch", "120000"]);
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
    expect(startRecordProblems(record)).toEqual([]);
  });

  it("uses the tree of a plain arm for the seed", async () => {
    const calls: Call[] = [];
    const folder = work();
    await measureStart({ ...CASE, seeder: B, rounds: 1, points: [CASE.points[1]!] }, { work: folder, start: fakeStart(calls), container: fakeContainer([], []), host: HOST });
    expect(calls.filter((call) => call.argv[0] === "pnpm").map((call) => basename(call.cwd!))).toEqual(["base", "base", "new"]);
    expect(calls.find((call) => call.argv.includes(SEED))?.argv).toContain(join(folder, "trees", "new"));
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
      if (!argv.includes(START)) return undefined;
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
    // tsc prints its errors on stdout. Thus a type check with an empty stderr gives the tail of its stdout.
    const typed = (argv: readonly string[]): ChildExit | undefined =>
      argv.includes("typecheck") ? { stdout: "src/measured-start.ts(12,5): error TS2353: Object literal may only specify known properties.\n", stderr: "", code: 2 } : undefined;
    await expect(measureStart(CASE, { work: work(), start: fakeStart([], typed), container, host: HOST })).rejects.toThrow(
      /run typecheck exited with the code 2\. The tail of stdout: src\/measured-start\.ts\(12,5\): error TS2353/,
    );
    const check = (argv: readonly string[]): ChildExit | undefined => (argv[1] === "-e" ? { stdout: "", stderr: "exec format error", code: 1 } : undefined);
    await expect(measureStart(CASE, { work: work(), start: fakeStart([]), container: fakeContainer([], [], check), host: HOST })).rejects.toThrow(/check child .* failed\. The tail of stderr: exec format error/);

    const calls: Call[] = [];
    await expect(measureStart({ ...CASE, rounds: 0 }, { work: work(), start: fakeStart(calls), container, host: HOST })).rejects.toThrow(RangeError);
    await expect(measureStart(CASE, { work: work(), start: fakeStart(calls), container, host: HOST, run: 0 })).rejects.toThrow(RangeError);
    expect(calls).toEqual([]);
  });

  it("throws when the seed program skips a point or gives no sizes", async () => {
    const container = fakeContainer([], []);
    const skip = (argv: readonly string[]): ChildExit | undefined => (argv.includes(SEED) ? ok(`${JSON.stringify({ skipped: "no disk" })}\n`) : undefined);
    await expect(measureStart(CASE, { work: work(), start: fakeStart([], skip), container, host: HOST })).rejects.toThrow(/skipped the point "small": no disk/);
    const bare = (argv: readonly string[]): ChildExit | undefined => (argv.includes(SEED) ? ok(`${JSON.stringify({ ms: 1, args: [], logEvents: 1 })}\n`) : undefined);
    await expect(measureStart(CASE, { work: work(), start: fakeStart([], bare), container, host: HOST })).rejects.toThrow(/gave no sizes/);
  });
});

const MODEL: StartCase = {
  ...CASE,
  rounds: 1,
  arms: [
    { ...CASE.arms[0]!, snapshot: true },
    { ...CASE.arms[1]!, ballast: [{ bytes: { value: 69, unit: "MiB" }, at: "ready", models: "the bundle of the live start" }] },
  ],
  points: [...CASE.points, { id: "again", at: CASE.points[1]!.at, after: "large" }],
  samples: s(5),
  target: {
    ...CASE.target,
    disk: { readBytes: { value: 14, unit: "MiB/s" }, readOps: { value: 200, unit: "{read}/s" }, writeBytes: { value: 7, unit: "MiB/s" }, writeOps: { value: 100, unit: "{write}/s" }, source: "the study of the start" },
    cache: "cold",
    others: [{ bytes: { value: 322, unit: "MiB" }, at: "start", models: "the other processes of the machine" }],
  },
};

/** This disk of the host puts the data of Docker on `/dev/sda` and each other path on `/dev/sdb`, and it counts the drops of the page cache. */
const fakeDisk = (drops: string[]): HostDisk => ({
  of: (path) => (path === "/var/lib/docker" ? "/dev/sda" : "/dev/sdb"),
  drop: async () => {
    drops.push("drop");
  },
  swaps: () => ["/mnt/swapfile"],
});

/**
 * This container is the fake container, and it also writes the home of a first start: the id of the arm, and a snapshot for
 * an arm with the flag --snapshot. Each child of the case gives what its home holds: the point of the seed and the arm of the first start.
 */
const modelContainer = (seen: ContainerOptions[], calls: Call[], homes: string[]) => {
  const inner = fakeContainer(seen, calls);
  return (options: ContainerOptions): StartChild => {
    const child = inner(options);
    return async (argv, limits) => {
      const home = argv.includes("--home") ? flagOf(argv, "home") : undefined;
      if (home !== undefined && home.includes("firsts")) {
        writeFileSync(join(home, "first.txt"), armOf(argv));
        if (argv.includes("--snapshot")) writeFileSync(join(home, "snapshot.bin"), Buffer.alloc(1024));
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
      ["node", "--expose-gc", START, "--tree", tree("base"), "--snapshot", "--case", "large", "--home", join(folder, "firsts", "again", "base"), "--end", "1767227897200", "--watch", "120000"],
      ["node", "--expose-gc", START, "--tree", tree("new"), "--case", "large", "--home", join(folder, "firsts", "again", "new"), "--end", "1767227897200", "--watch", "120000"],
    ]);
    expect(firsts.every(({ options }) => options.disks === undefined)).toBe(true);
    expect(firsts.map(({ call }) => call.timeoutMs)).toEqual([480_000, 480_000]);
    expect(record.firsts.map((each) => [each.point, each.after, each.arm, each.passes, each.files])).toEqual([
      ["again", "large", "base", 10, { "first.txt": { value: 4, unit: "B" }, "point.txt": { value: 5, unit: "B" }, "snapshot.bin": { value: 1024, unit: "B" } }],
      ["again", "large", "new", 10, { "first.txt": { value: 3, unit: "B" }, "point.txt": { value: 5, unit: "B" } }],
    ]);

    // Each child opens its home in place, with the ballasts of the target and of its arm, the snapshot of its arm and the samples.
    const children = inside.filter((call, index) => call.argv.includes(START) && !firsts.some((each) => each.call === inside[index]));
    expect(children).toHaveLength(3 * 3);
    expect(children.find((call) => call.cwd === tree("new") && flagOf(call.argv, "case") === "again")?.argv).toEqual([
      "node", "--expose-gc", START, "--tree", tree("new"), "--ballast", `${322 * MIB}@start`, "--ballast", `${69 * MIB}@ready`,
      "--case", "again", "--home", home, "--end", "1767227897200", "--watch", "120000", "--samples", "5000",
    ]);
    expect(children.find((call) => call.cwd === tree("base"))?.argv.slice(0, 8)).toEqual(["node", "--expose-gc", START, "--tree", tree("base"), "--snapshot", "--ballast", `${322 * MIB}@start`]);
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
    expect(summary).toContain(", 10 passes, 3 files of 1 KiB.");
    // A point with the field after has the sizes of its seed point.
    expect(summary).toContain("| `again` | 64 MiB | 2 MiB | 0 B | `new` | 4 s | ready | ready | 5 s | 300 MiB | 4000 | 150 MiB |");
  });

  it("starts no first start, places no home and drops no cache for a warm case with no point after another", async () => {
    const drops: string[] = [];
    const homes: string[] = [];
    const inside: Call[] = [];
    const seen: ContainerOptions[] = [];
    const { record } = await measureStart({ ...CASE, rounds: 1 }, { work: work(), start: fakeStart([]), container: modelContainer(seen, inside, homes), host: HOST, disk: fakeDisk(drops) });
    expect([record.disks, record.firsts, drops, homes]).toEqual([[], [], [], []]);
    expect(seen.every((options) => options.disks === undefined)).toBe(true);
    expect(inside.filter((call) => call.argv.includes(START)).every((call) => call.argv.includes("--seeded"))).toBe(true);
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

  it("throws when the first start of an arm with a snapshot does no pass in its watch", async () => {
    const none = (argv: readonly string[]): ChildExit | undefined => (argv.some((each) => each.includes("firsts")) ? ok(`${JSON.stringify({ ...JSON.parse(startLine("base", "large")), passes: 0 })}\n`) : undefined);
    const run = measureStart(MODEL, { work: work(), start: fakeStart([]), container: fakeContainer([], [], none), host: HOST, disk: fakeDisk([]) });
    await expect(run).rejects.toThrow('The first start of the arm "base" on "large" did no pass in its watch. It wrote no snapshot.');
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
      "read alerts-start/test: base on large: The reading has no end, live.",
      "record alerts-start/test: small, round 0: The point has no child of new.",
      "observed alerts-start/test: base on large in 1 min 30 s: The children were late, late, and the machine was ready (the supervisor of the machine: 3 stops). The lab does not model the time of the machine.",
    ]);
    const none: StartRecord = { ...record, readings: record.readings.filter((reading) => reading.point !== "large" || reading.arm === "new"), failures: [{ arm: "base", case: "large", round: 0, reason: "passed the memory limit of its container", kind: "memory" }, { arm: "base~aa", case: "large", round: 0, reason: "passed the memory limit of its container", kind: "memory" }] };
    expect(startRecordProblems(none).map((each) => `${each.code} ${each.path}: ${each.message}`)).toEqual([
      "observed alerts-start/test: base on large in 1 min 30 s: The record has no read of each child, and the machine was not ready (the supervisor of the machine: 3 stops). The reads: no read, no read.",
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
    expect(summary).toContain("### The start case `alerts-start/test`, job 1");
    // The text of the target has an escape before each mark. The digest is in a code span with no escape.
    expect(summary).toContain("- The target: 2 CPUs\\, ");
    expect(summary).toContain(` of memory\\, 2 GiB of swap\\, Node v24\\.21\\.0. The image: \`${DIGEST}\`.`);
    expect(summary).toContain("- The check child: the heap limit of V8 is 530.5 MiB, and the container starts in 0 ms.");
    expect(summary).toContain(`\`base\` ${A.slice(0, 7)} with 1 graft in `);
    expect(summary).toContain("| Point | `log` | `shapes` | `transit` | Arm | Readiness | In 1 min 30 s | In 4 min | Ready | Read to ready | Major faults | VmHWM at ready | Heap peak | Live heap | GC | VmHWM of the watch | Passes |");
    expect(summary).toContain(`|${" --- |".repeat(17)}\n`);
    expect(summary).toContain("| `small` | 16 MiB | 0 B | 0 B | `new` | 4 s | ready | ready | 5 s | 300 MiB | 4000 | 150 MiB | 120 MiB | 60 MiB | 250 ms | 151 MiB | 10 |");
    expect(summary).not.toContain("- The disk ");
    expect(summary).not.toContain("- The cache is cold");
    expect(summary).toContain("| `large` | 64 MiB | 2 MiB | 0 B | `base` | 2 min | late | ready |");
    expect(summary).toContain("| `large` | 64 MiB | 2 MiB | 0 B | `new` | does not fit: heap | no read | no read |");
    expect(summary).toContain("- **stalled** `");
    expect(summary).toContain("- **heap** `large`, the arm `new`, round 0: reached the heap limit of V8\\: JavaScript heap out of memory");
    expect(summary).toContain("- **skip** `small`, the arm `base`, round 0: no store");
    expect(summary.split("\n").filter((line) => line.startsWith("| `"))).toHaveLength(6);
  });
});
