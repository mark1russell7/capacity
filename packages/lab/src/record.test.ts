import { loadPlanOf, type CellResult, type Manifest, type ProbeEvent, type ResourceReading, type Run, type RunCpus, type RunStream } from "@mark1russell7/harness";
import type { Quantity } from "@mark1russell7/quantity";
import { describe, expect, it } from "vitest";
import { CASE_FORMAT, type Case } from "./case.ts";
import { cellOf, streamsOf } from "./cell.ts";
import { measureCase } from "./measure.ts";
import { CPUSET_MEASURES, LOAD_MEASURES, RECORD_FORMAT, RUN_MEASURES, cpusetMeasures, loadMeasures, recordOf, runRecordOf } from "./record.ts";

const MIB = 1024 * 1024;

const CASE: Case = {
  format: CASE_FORMAT,
  id: "node-http/two-classes",
  title: "Two classes for one second",
  subject: "node-http",
  instance: { resources: { cpu: { value: 1, unit: "{core}" }, memory: { value: 256, unit: "MiB" } } },
  demand: {
    classes: [
      { id: "work", rate: { value: 10, unit: "{request}/s" }, request: { work: { value: 100, unit: "us" } } },
      { id: "post", rate: { value: 5, unit: "{request}/s" }, request: { body: { value: 64, unit: "B" } } },
    ],
    levels: {},
  },
  duration: { value: 1, unit: "s" },
  arrivals: { arrivals: "uniform" },
  runs: 2,
};

const STREAMS: readonly RunStream[] = loadPlanOf(streamsOf(CASE)).streams;

/** The schedule starts at 5 s on the clock of the lab. */
const START = 5e9;
const at = (ms: number): number => START + ms * 1e6;

/**
 * The lines of the driver: each send 0.2 ms after its time, each reply of `work` after 2 ms, and each
 * reply of `post` after 4 ms. The fourth `post` fails with 503, and the fifth has no reply.
 */
const LINES: readonly ProbeEvent[] = [
  { ev: "scheduled", t: START },
  ...STREAMS.flatMap((stream) =>
    stream.schedule.times.flatMap((planned, i): ProbeEvent[] => {
      const sent = { ev: "sent", t: at(planned + 0.2), i, k: stream.key };
      if (stream.key === "post" && i === 4) return [sent];
      const reply = { ev: "replied", t: at(planned + (stream.key === "work" ? 2 : 4)), i, k: stream.key, status: stream.key === "post" && i === 3 ? 503 : 200 };
      return [sent, reply];
    }),
  ),
  { ev: "done", t: at(1500) },
];

interface Counters {
  readonly t: number;
  readonly cgroup?: string;
  readonly user: number;
  readonly system: number;
  readonly throttled: number;
  readonly current: number;
  readonly peak: number;
  readonly rx: number;
  readonly tx: number;
}

/** A reading of the subject: CPU times in microseconds, as the control group gives them. */
const reading = (counters: Counters): ResourceReading => ({
  t0: counters.t,
  t1: counters.t + 1e6,
  cgroup: counters.cgroup ?? "/sys/fs/cgroup/subject",
  cpu: { usage: counters.user + counters.system, user: counters.user, system: counters.system, periods: 100, throttled: 2, throttledTime: counters.throttled },
  memory: { current: counters.current, peak: counters.peak, anon: null, file: null, kernel: null, sock: null, events: null },
  pids: 7,
  network: {
    devices: [{ name: "eth0", rx: { bytes: counters.rx, packets: 10 }, tx: { bytes: counters.tx, packets: 10 } }],
    rx: { bytes: counters.rx, packets: 10 },
    tx: { bytes: counters.tx, packets: 10 },
  },
  limits: { cpu: { quota: 100_000, period: 100_000 }, memory: 256 * MIB, cpuset: "0" },
});

const BEFORE: Counters = { t: 4e9, user: 750_000, system: 250_000, throttled: 0, current: 50 * MIB, peak: 60 * MIB, rx: 1_000, tx: 0 };
/** After the schedule: 70 ms of CPU, 3 ms throttled, a new peak of 80 MiB, 1400 bytes in and 14 KiB out. */
const AFTER: Counters = { t: 7e9, user: 802_500, system: 267_500, throttled: 3_000, current: 55 * MIB, peak: 80 * MIB, rx: 2_400, tx: 14_336 };

/** The CPU shares between the readings: CPU 0 of the subject is 90 % busy, and CPUs 1 to 3 of the others are 50 % busy. */
const CPUS: RunCpus = {
  target: { cpus: "0", count: 1, busy: 0.9, user: 0.5, nice: 0, system: 0.2, idle: 0.1, iowait: 0, irq: 0.01, softirq: 0.19, steal: 0 },
  client: { cpus: "1-3", count: 3, busy: 1.5, user: 0.3, nice: 0, system: 0.15, idle: 0.48, iowait: 0.02, irq: 0, softirq: 0.05, steal: 0 },
};

/** A run with the lines and the readings above. `drop` names the parts that the run does not have. */
const run = (index: number, more: Partial<Run> = {}, drop: readonly ("streams" | "resources")[] = []): Run => ({
  environment: 0,
  index,
  events: LINES,
  fault: null,
  kernel: [],
  netns: 1,
  targetNetns: 2,
  lost: 0,
  ...(drop.includes("streams") ? {} : { streams: STREAMS }),
  ...(drop.includes("resources")
    ? {}
    : {
        resources: {
          start: reading(BEFORE),
          end: reading(AFTER),
          series: [reading({ ...BEFORE, t: 5e9, current: 70 * MIB }), reading({ ...BEFORE, t: 6e9, current: 65 * MIB })],
          cpus: CPUS,
        },
      }),
  ...more,
});

const value = (amount: Quantity | null | undefined): number | null => (amount === null || amount === undefined ? null : amount.value);

describe("the record of one run", () => {
  it("gives the measures of the container from its readings, and each request from the replies", () => {
    const record = runRecordOf(run(0));
    const { measures } = record;
    // 15 arrivals: one with no reply, thus 14 answered, and one of them failed
    expect([measures.planned, measures.answered, measures.failed, measures.unsent, measures.unfinished]).toEqual(
      [15, 14, 1, 0, 1].map((count) => ({ value: count, unit: "{request}" })),
    );
    expect(measures.elapsed).toEqual({ value: 3, unit: "s" });
    expect(value(measures.cpu)).toBeCloseTo(0.07, 12);
    expect(measures.cpu?.unit).toBe("{core}·s");
    expect(value(measures["cpu.user"])).toBeCloseTo(0.0525, 12);
    expect(value(measures["cpu.system"])).toBeCloseTo(0.0175, 12);
    expect(measures["cpu.throttled"]).toEqual({ value: 0.003, unit: "s" });
    // 70 ms of CPU for 14 replies
    expect(value(measures["cpu.request"])).toBeCloseTo(5, 9);
    expect(measures["cpu.request"]?.unit).toBe("{core}·ms/{request}");
    expect(measures.memory).toEqual({ value: 55 * MIB, unit: "B" });
    expect(measures["memory.peak"]).toEqual({ value: 80 * MIB, unit: "B" });
    expect(measures["memory.high"]).toEqual({ value: 70 * MIB, unit: "B" });
    expect([measures["network.rx"], measures["network.tx"]]).toEqual([
      { value: 1_400, unit: "B" },
      { value: 14_336, unit: "B" },
    ]);
    expect([measures["network.rx.request"], measures["network.tx.request"]]).toEqual([
      { value: 100, unit: "B/{request}" },
      { value: 1_024, unit: "B/{request}" },
    ]);
    expect(value(measures["lag.max"])).toBeCloseTo(0.2, 6);
    expect(Object.keys(measures).sort()).toEqual([...Object.keys(RUN_MEASURES), ...Object.keys(LOAD_MEASURES), ...Object.keys(CPUSET_MEASURES)].sort());
    expect(record.resets).toEqual([]);
    expect(record.missing).toBeNull();
  });

  it("gives the use of the CPUs of each CPU set in cores, with the parts of the busy time", () => {
    const { measures } = runRecordOf(run(0));
    expect(measures["cpuset.busy"]).toEqual({ value: 0.9, unit: "{core}" });
    expect(value(measures["cpuset.softirq"])).toBeCloseTo(0.19, 12);
    expect(measures["others.cpuset.busy"]).toEqual({ value: 1.5, unit: "{core}" });
    // a share of the 3 CPUs of the others times 3 is in cores
    expect(value(measures["others.cpuset.user"])).toBeCloseTo(0.9, 12);
    for (const prefix of ["cpuset", "others.cpuset"] as const) {
      const parts = (["user", "nice", "system", "irq", "softirq", "steal"] as const).map((state) => value(measures[`${prefix}.${state}`]) ?? Number.NaN);
      expect(parts.reduce((sum, part) => sum + part, 0)).toBeCloseTo(value(measures[`${prefix}.busy`]) ?? Number.NaN, 12);
    }
    for (const name of Object.keys(CPUSET_MEASURES)) expect(measures[name as keyof typeof CPUSET_MEASURES]?.unit).toBe("{core}");
  });

  it("gives null for each cpuset measure of a CPU set with no shares", () => {
    const none = cpusetMeasures(undefined);
    expect(Object.values(none).every((amount) => amount === null)).toBe(true);
    const target = cpusetMeasures({ target: CPUS.target! });
    expect(target["cpuset.busy"]).toEqual({ value: 0.9, unit: "{core}" });
    expect(target["others.cpuset.busy"]).toBeNull();
    // a harness before 0.16.23 gives no shares in the readings
    const older = runRecordOf(run(5, { resources: { start: reading(BEFORE), end: reading(AFTER), series: [] } }));
    expect(older.measures["cpuset.busy"]).toBeNull();
    expect(value(older.measures.cpu)).toBeCloseTo(0.07, 12);
  });

  it("gives the latency of each class, with a request with no reply at its age at the end", () => {
    const { classes, measures } = runRecordOf(run(0));
    expect(Object.keys(classes)).toEqual(["work", "post"]);
    const work = classes["work"]!;
    expect([value(work["latency.p50"]), value(work["latency.max"])].map((ms) => Math.round((ms ?? 0) * 1e6) / 1e6)).toEqual([2, 2]);
    expect(work.answered).toEqual({ value: 10, unit: "{request}" });
    const post = classes["post"]!;
    expect([post.planned, post.failed, post.unfinished].map(value)).toEqual([5, 1, 1]);
    // the fifth post has no reply at the end (1500 ms): its latency is its age, a lower bound
    const fifth = STREAMS[1]!.schedule.times[4]!;
    expect(value(post["latency.max"])).toBeCloseTo(1500 - fifth, 6);
    expect(value(measures["latency.max"])).toBeCloseTo(1500 - fifth, 6);
    expect(value(measures["latency.p50"])).toBeCloseTo(2, 6);
  });

  it("gives null, never 0, for a measure that the run did not read", () => {
    const bare = runRecordOf(run(1, {}, ["resources"]));
    for (const name of Object.keys(RUN_MEASURES)) expect(bare.measures[name as keyof typeof RUN_MEASURES]).toBeNull();
    for (const name of Object.keys(CPUSET_MEASURES)) expect(bare.measures[name as keyof typeof CPUSET_MEASURES]).toBeNull();
    expect(bare.measures.answered).toEqual({ value: 14, unit: "{request}" });

    // no lines of a schedule: no load, thus no measure for each request
    const silent = runRecordOf(run(2, {}, ["streams"]));
    for (const name of Object.keys(LOAD_MEASURES)) expect(silent.measures[name as keyof typeof LOAD_MEASURES]).toBeNull();
    expect(silent.measures["cpu.request"]).toBeNull();
    expect(value(silent.measures.cpu)).toBeCloseTo(0.07, 12);
    expect(silent.classes).toEqual({});
  });

  it("keeps a peak only when it rose in the run, and the counters that went back", () => {
    const flat = runRecordOf(run(3, { resources: { start: reading({ ...BEFORE, peak: 90 * MIB }), end: reading({ ...AFTER, peak: 90 * MIB }), series: [] } }));
    expect(flat.measures["memory.peak"]).toBeNull();
    expect(flat.measures["memory.high"]).toEqual({ value: 55 * MIB, unit: "B" });

    // a new cgroup is a new container: no CPU time and no peak, and the old readings are not in the high reading
    const moved = runRecordOf(run(4, { resources: { start: reading({ ...BEFORE, current: 99 * MIB }), end: reading({ ...AFTER, cgroup: "/other" }), series: [] } }));
    expect(moved.resets).toContain("cgroup");
    expect(moved.measures.cpu).toBeNull();
    expect(moved.measures["cpu.request"]).toBeNull();
    expect(moved.measures["memory.high"]).toEqual({ value: 55 * MIB, unit: "B" });
  });

  it("gives null latencies for a load with no arrival", () => {
    const empty = loadMeasures({ planned: 0, unsent: 0, unfinished: 0, latency: [], service: [], lag: [], censored: [] });
    expect([empty.planned, empty.answered].map(value)).toEqual([0, 0]);
    expect([empty["latency.p50"], empty["latency.max"], empty["lag.max"]]).toEqual([null, null, null]);
  });
});

const MANIFEST = { kernel: "6.11.0-azure", architecture: "x86_64", docker: "28.1.1", harness: { image: "h", id: "i", packages: [], version: "0.16.16" } } as unknown as Manifest;

const resultOf = (runs: readonly Run[], manifests: readonly Manifest[] = [MANIFEST]): CellResult => ({
  cell: cellOf(CASE, { cpus: 4 }),
  manifests,
  warmups: [{ ...run(0), warmup: true }],
  runs,
  measured: [],
  // the record does not read the verdict of the harness
  verdict: { decision: "measured" } as unknown as CellResult["verdict"],
  at: { started: "2026-11-18T18:00:00.000Z", ended: "2026-11-18T18:01:00.000Z" },
});

describe("the record of a case", () => {
  it("gives the machine, the times and each counted run, with no warm-up run", () => {
    const record = recordOf(CASE, resultOf([run(0), run(1)]), { cpu: "AMD EPYC 7763 64-Core Processor", cores: 4, runner: "GitHub Actions 7" });
    expect(record).toMatchObject({
      format: RECORD_FORMAT,
      case: CASE,
      machine: { cpu: "AMD EPYC 7763 64-Core Processor", cores: 4, runner: "GitHub Actions 7", kernel: "6.11.0-azure", architecture: "x86_64", docker: "28.1.1", harness: "0.16.16" },
      at: { started: "2026-11-18T18:00:00.000Z", ended: "2026-11-18T18:01:00.000Z" },
      warmups: 1,
    });
    expect(record.runs.map((each) => each.index)).toEqual([0, 1]);
    expect(recordOf(CASE, resultOf([run(0)]), { cpu: "x", cores: 2 }).machine).not.toHaveProperty("runner");
  });

  it("refuses a result with no manifest", () => {
    expect(() => recordOf(CASE, resultOf([], []), { cpu: "x", cores: 2 })).toThrow(/has no manifest/);
  });

  it("measures a case through one path: the cell, the run and the record", async () => {
    const cells: string[] = [];
    const { record, result } = await measureCase(CASE, {
      cpus: 4,
      host: { cpu: "test CPU", cores: 4 },
      run: async (cell) => {
        cells.push(`${cell.name} ${cell.target.limits?.cpuset} ${cell.clientLimits?.cpuset}`);
        return resultOf([run(0)]);
      },
    });
    expect(cells).toEqual(["node-http/two-classes: Two classes for one second 0 1-3"]);
    expect(record.machine.cpu).toBe("test CPU");
    expect(record.runs).toHaveLength(1);
    expect(result.runs).toHaveLength(1);
    await expect(measureCase({ ...CASE, runs: 0 }, { cpus: 4, run: async () => resultOf([]) })).rejects.toThrow(RangeError);
  });
});
