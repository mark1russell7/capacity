import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkLimits, LIMITS_FORMAT } from "@mark1russell7/capacity";
import { readLimits } from "@mark1russell7/capacity/schema";
import { quantity } from "@mark1russell7/quantity";
import { describe, expect, it } from "vitest";
import { EPYC, runOf, timedOf } from "./law-fixtures.ts";
import type { LawJob } from "./laws.ts";
import { planMinutes, readPlans, type Plan } from "./plan.ts";
import { START_LIMITS_FORMAT, START_LIMIT_RUNS, readStartLimits, startLimitsOf, startLimitsSummaryOf } from "./start-limits.ts";
import { START_MEASURES, START_RECORD_FORMAT, startRecordProblems, type StartMeasure, type StartReading, type StartRecord } from "./start-measure.ts";
import type { StartCase } from "./start.ts";

// The jobs of the tests are 5 jobs of one CI run of the plan alerts-start-gate. Each job starts the arm main and its A/A
// copy at each point in each round. The value of a job at a point is its largest reading:
// - live: 100 MB + 1 MB for each job + 10 MB for each point, + 1 kB for each round, + 500 B for the A/A copy.
// - peak: 300 MB + 2 MB for each job, + 1 B for each round.
// - readiness: 20000.4 ms + 100 ms for each job, + 10 ms for each round.

const PLANS = fileURLToPath(new URL("../plans/", import.meta.url));
const PLAN: Plan = readPlans(PLANS).plans.find((each) => each.id === "alerts-start-gate")!;
const CASE = PLAN.cases[0] as StartCase;
const ARMS = ["main", "main~aa"] as const;
const COMMAND = fileURLToPath(new URL("./start-limits.main.ts", import.meta.url));

/** This function gives the measures of one reading. Each measure that the test does not set is 1 in its unit. */
const measuresOf = (job: number, point: number, arm: number, round: number): Readonly<Record<StartMeasure, ReturnType<typeof quantity> | null>> => {
  const base = Object.fromEntries(Object.entries(START_MEASURES).map(([name, unit]) => [name, quantity(1, unit)])) as Record<StartMeasure, ReturnType<typeof quantity>>;
  return {
    ...base,
    live: quantity(100_000_000 + 1_000_000 * job + 10_000_000 * point + 1000 * round + 500 * arm, "B"),
    peak: quantity(300_000_000 + 2_000_000 * job + round, "B"),
    readiness: quantity(20_000.4 + 100 * job + 10 * round, "ms"),
  };
};

/** This function gives the start record of one job. The record has the fields that the limits and the check read, thus the cast. */
const recordOf = (job: number, value: StartCase = CASE): StartRecord => {
  const readings: StartReading[] = [];
  value.points.forEach((point, place) => {
    for (let round = 0; round < value.rounds; round += 1) {
      ARMS.forEach((arm, index) => {
        readings.push({ arm, point: point.id, round, position: index, measures: measuresOf(job, place, index, round), open: [], stalled: false, ballasts: [], samples: [] } as unknown as StartReading);
      });
    }
  });
  const orders = value.points.flatMap((point) => Array.from({ length: value.rounds }, (_, round) => ({ case: point.id, round, arms: ["main", "main"] })));
  return {
    format: START_RECORD_FORMAT,
    case: value,
    machine: { cpu: EPYC },
    job: String(job + 1),
    pairs: ["main~aa"],
    readings,
    orders,
    failures: [],
    skipped: [],
  } as unknown as StartRecord;
};

/** This function gives `count` jobs of the plan in the CI run `run`. */
const jobsOf = (count = START_LIMIT_RUNS, run = 50, change: (record: StartRecord, job: number) => StartRecord = (record) => record): LawJob[] =>
  Array.from({ length: count }, (_, job) => ({
    timed: timedOf(PLAN.id, runOf(run), EPYC, `2026-11-24T07:${String(job).padStart(2, "0")}:00Z`),
    records: [],
    starts: [change(recordOf(job), job)],
  }));

describe("the plan of the start gate of alerts", () => {
  it("starts alerts main from its contract at the live log and at the knee, on the 1 GB target, in 5 jobs", () => {
    expect(PLAN.jobs).toBe(5);
    expect(CASE.app).toBe("https://github.com/metrograph-labs/alerts.git");
    expect(CASE.arms).toEqual([{ id: "main", commit: CASE.seeder }]);
    expect(CASE.points.map((each) => [each.id, each.at["log"]?.value])).toEqual([["live-1844", 197_156_864], ["knee-192", 192 * 2 ** 20]]);
    expect(CASE.target.memory).toEqual({ value: 1_011_425_280, unit: "B" });
    expect(planMinutes(PLAN)).toBeLessThanOrEqual(180);
  });
});

describe("the limits of a start gate", () => {
  it("gives the worst value of the runs plus their spread for each measure at each point, as a limit set of each point", () => {
    expect(startRecordProblems(recordOf(0))).toEqual([]);
    const limits = startLimitsOf(PLAN, jobsOf());
    expect(limits).toMatchObject({ format: START_LIMITS_FORMAT, plan: PLAN.id, case: CASE.id, subject: "alerts-runtime", app: CASE.app, arm: "main", commit: CASE.seeder });
    expect(limits.runs.map((each) => each.id)).toEqual(["50/1/1", "50/2/1", "50/3/1", "50/4/1", "50/5/1"]);
    expect(limits.runs[0]).toEqual({ id: "50/1/1", url: runOf(50).url, job: "1", attempt: 1, cpu: EPYC });
    const [live, knee] = limits.points;
    expect(live?.derivations["start.live"]).toEqual({ limit: 108_002_500, worst: 104_002_500, spread: 4_000_000, values: [100_002_500, 101_002_500, 102_002_500, 103_002_500, 104_002_500], unit: "B" });
    expect(knee?.derivations["start.live"]?.limit).toBe(118_002_500);
    expect(live?.derivations["start.peak"]).toMatchObject({ limit: 316_000_002, worst: 308_000_002, spread: 8_000_000 });
    // The time rounds up to a whole ms: 20420.4 + 400 is 20820.4, and the limit is 20821.
    expect(live?.derivations["start.readiness"]).toMatchObject({ limit: 20_821, worst: 20_420.4, unit: "ms" });
    expect(live?.derivations["start.readiness"]?.spread).toBeCloseTo(400, 6);
    for (const point of limits.points) {
      expect(readLimits(point.limits).tag).toBe("ok");
      expect(checkLimits(point.limits)).toEqual([]);
      expect(point.limits).toMatchObject({ format: LIMITS_FORMAT, id: `${CASE.id}/${point.id}` });
      expect(point.limits.limits.map((each) => [each.id, each.ceiling, each.headroom])).toEqual(
        limits.measures.map((measure) => [measure.id, { kind: "amount", amount: quantity(point.derivations[measure.id]!.limit, measure.unit) }, 0]),
      );
    }
    expect(startLimitsSummaryOf(limits)).toContain("- live-1844 start.live: 108002500 B, the worst value 104002500 plus the spread 4000000.");
  });

  it("reads only the jobs of the plan, and refuses fewer than 5 runs or one run two times", () => {
    const other = { ...jobsOf(1)[0]!, timed: { ...jobsOf(1)[0]!.timed, plan: "alerts-start-log" } };
    expect(() => startLimitsOf(PLAN, [...jobsOf(4), other])).toThrow('The limits need the records of 5 or more CI runs, and 4 runs have a record of "alerts-start-gate/main".');
    expect(startLimitsOf(PLAN, [...jobsOf(4), ...jobsOf(2, 51)]).runs.map((each) => each.id)).toEqual(["50/1/1", "50/2/1", "50/3/1", "50/4/1", "51/1/1", "51/2/1"]);
    expect(() => startLimitsOf(PLAN, [...jobsOf(), ...jobsOf(1)])).toThrow("The run 50/1/1 is in the records two times.");
  });

  it("refuses a child that did not fit the target, a record of another case and a record with a problem", () => {
    const failed = jobsOf(5, 50, (record, job) =>
      job === 2 ? { ...record, readings: record.readings.filter((each) => each.point !== "knee-192" || each.arm !== "main~aa" || each.round !== 1), failures: [{ arm: "main~aa", case: "knee-192", round: 1, reason: "passed the memory limit of its container", kind: "memory" }] } : record,
    );
    expect(() => startLimitsOf(PLAN, failed)).toThrow("In the run 50/3/1, these children did not fit the target: main~aa on knee-192, round 1: memory. A gate holds a start that fits.");
    const moved = jobsOf(5, 50, (record) => ({ ...record, case: { ...record.case, rounds: 1 } }));
    expect(() => startLimitsOf(PLAN, moved)).toThrow('The record of the run 50/1/1 measures another version of the case "alerts-start-gate/main".');
    const lost = jobsOf(5, 50, (record, job) => (job === 4 ? { ...record, readings: record.readings.slice(1) } : record));
    expect(() => startLimitsOf(PLAN, lost)).toThrow("The record of the run 50/5/1 has problems: alerts-start-gate/main: live-1844, round 0: The point has no child of main.");
    expect(() => startLimitsOf(PLAN, jobsOf(), { case: "other" })).toThrow('The plan "alerts-start-gate" has no start case "other".');
  });
});

describe("the limits file of the start gate of alerts", () => {
  const LIMITS = fileURLToPath(new URL("../../capacity/limits/alerts-start-gate.limits.json", import.meta.url));

  it("reads, comes from 5 runs of the plan at the commit of its arm, and has a limit for each measure at each point", () => {
    const limits = readStartLimits(LIMITS);
    expect(limits).toBeDefined();
    if (limits === undefined) return;
    expect([limits.plan, limits.case, limits.arm, limits.commit]).toEqual([PLAN.id, CASE.id, "main", CASE.seeder]);
    expect(new Set(limits.runs.map((each) => each.id)).size).toBeGreaterThanOrEqual(START_LIMIT_RUNS);
    expect(limits.points.map((each) => each.id)).toEqual(CASE.points.map((each) => each.id));
    for (const point of limits.points) {
      expect(point.limits.limits.map((each) => each.measure).sort()).toEqual(limits.measures.map((each) => each.id).sort());
      for (const [measure, derivation] of Object.entries(point.derivations)) {
        expect(derivation.values, `${point.id} ${measure}`).toHaveLength(limits.runs.length);
        expect(derivation.limit, `${point.id} ${measure}`).toBeGreaterThanOrEqual(derivation.worst);
      }
    }
  });
});

describe("the command of the start limits", () => {
  /** This function writes the jobs into a folder, one subfolder for each job, as `gh run download` writes the artifacts of a run. */
  const writeJobs = (folder: string, jobs: readonly LawJob[]): void =>
    jobs.forEach((job, index) => {
      const name = join(folder, `lab-${PLAN.id}-${index + 1}-1`);
      mkdirSync(name, { recursive: true });
      const record = `${CASE.id.replace("/", "-")}.record.json`;
      writeFileSync(join(name, record), JSON.stringify(job.starts![0]));
      writeFileSync(join(name, "timed.json"), JSON.stringify({ ...job.timed, files: [{ case: CASE.id, record, result: "none.json" }] }));
    });

  it("writes the limits file of the runs of a folder and reads it again", () => {
    const folder = mkdtempSync(join(tmpdir(), "capacity-start-limits-"));
    try {
      writeJobs(join(folder, "runs"), jobsOf());
      const out = join(folder, "out", "alerts-start-gate.limits.json");
      const result = spawnSync(process.execPath, [COMMAND, "limits", "--runs", join(folder, "runs"), "--out", out], { encoding: "utf8", env: { ...process.env, GITHUB_STEP_SUMMARY: "" } });
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("The limits of alerts-start-gate/main on d23377d come from 5 runs.");
      const written = readStartLimits(out);
      expect(written).toEqual(JSON.parse(JSON.stringify(startLimitsOf(PLAN, jobsOf()))));
      expect(readStartLimits(join(folder, "none.json"))).toBeUndefined();
      writeFileSync(join(folder, "bad.json"), JSON.stringify({ ...written, points: [{ ...written!.points[0], limits: { ...written!.points[0]!.limits, format: "other" } }] }));
      expect(() => readStartLimits(join(folder, "bad.json"))).toThrow("has a limit set with problems");
      writeFileSync(join(folder, "other.json"), JSON.stringify({ format: "other" }));
      expect(() => readStartLimits(join(folder, "other.json"))).toThrow(`is not a file of start limits of the format "${START_LIMITS_FORMAT}"`);
      const few = spawnSync(process.execPath, [COMMAND, "limits", "--runs", join(folder, "out"), "--out", join(folder, "few.json")], { encoding: "utf8" });
      expect(few.status).toBe(1);
      expect(few.stderr).toContain("Give one with --plan.");
      const usage = spawnSync(process.execPath, [COMMAND, "limits", "--out", out], { encoding: "utf8" });
      expect(usage.status).toBe(1);
      expect(usage.stderr).toContain("The command needs --runs and --out.");
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
