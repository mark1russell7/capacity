import { fileURLToPath } from "node:url";
import { cpuEntry } from "@mark1russell7/rigor-bench";
import { describe, expect, it } from "vitest";
import { EPYC, runOf, timedOf, wave } from "./law-fixtures.ts";
import { CPU_IDS, type LawJob } from "./laws.ts";
import { readPlans } from "./plan.ts";
import { START_CONDITIONS, startLawSetProblems, startLawsOf, type StartLawSet } from "./start-laws.ts";
import { START_RECORD_FORMAT, type StartReading, type StartRecord } from "./start-measure.ts";
import type { StartCase } from "./start.ts";

// The start records of the tests. Each job starts each arm of the case of the log at each of its 6
// points, in 2 rounds. The time to ready is 100 ms + 3 ms for each MiB of the log. The A/A copy of the
// base has the same law, with a different small noise. Thus the laws are linear, and the noise floor is small.

const PLANS = fileURLToPath(new URL("../plans/", import.meta.url));
const CASE = { ...(readPlans(PLANS).plans.find((each) => each.id === "alerts-start")!.cases[0] as StartCase), rounds: 2 };
const SET: StartLawSet = {
  variable: { id: "log", unit: "MiB", scale: "log" },
  measures: [{ id: "ready", law: "ready", title: "The time to ready", residual: "absolute", forms: ["constant", "linear"] }],
};
const PLAN = { id: "alerts-start", startLaws: SET };
const OPTIONS = { runs: 40, seed: 1 };
const ARMS = ["cloud", "new", "cloud~aa"] as const;

/** This function gives the time to ready of a start, in ms, on a log of `mib` MiB. */
const readyOf = (mib: number, job: number, arm: number, round: number): number => 100 + 3 * mib + 2 * wave(job, arm * 7 + round, Math.round(mib));

/**
 * This function gives the start record of one job. The record has only the fields that the fit of the laws reads, thus the
 * cast. The other fields are the fields of the run, and the tests of `start-measure.ts` examine them.
 */
const recordOf = (job: number, cpu: string, drop: (reading: StartReading) => boolean = () => false): StartRecord => {
  const readings: StartReading[] = [];
  CASE.points.forEach((point, place) => {
    const mib = (point.at["log"]?.value ?? 0) / 2 ** 20;
    for (let round = 0; round < CASE.rounds; round += 1) {
      ARMS.forEach((arm, index) => {
        const reading = {
          arm,
          point: point.id,
          round,
          position: place * CASE.rounds + round,
          measures: { ready: { value: readyOf(mib, job, index, round), unit: "ms" } },
          open: [],
          stalled: false,
          ballasts: [],
          samples: [],
        } as unknown as StartReading;
        if (!drop(reading)) readings.push(reading);
      });
    }
  });
  const points = CASE.points.map((point) => ({ id: point.id, sizes: { log: point.at["log"] }, events: 0, time: { value: 1, unit: "s" }, args: [] }));
  return { format: START_RECORD_FORMAT, case: CASE, machine: { cpu }, readings, points, failures: [] } as unknown as StartRecord;
};

/** This function gives `count` jobs of the plan, each in its own CI run, with one start record. */
const jobsOf = (count: number, cpu = EPYC, change: (record: StartRecord, job: number) => StartRecord = (record) => record): LawJob[] =>
  Array.from({ length: count }, (_, job) => ({
    timed: timedOf(PLAN.id, runOf(30 + job), cpu, `2026-11-22T07:${String(job).padStart(2, "0")}:00Z`),
    records: [],
    starts: [change(recordOf(job, cpu), job)],
  }));

const MODEL = cpuEntry(CPU_IDS, EPYC).value;

describe("the laws of the start records", () => {
  it("gives one law for each arm and each kind of start, with the conditions of the records", () => {
    const result = startLawsOf(PLAN, jobsOf(5), OPTIONS);
    expect(result.problems).toEqual([]);
    expect(result.laws.map(({ law }) => law.id)).toEqual([`alerts/alerts-start/${MODEL}/cloud/first/ready`, `alerts/alerts-start/${MODEL}/new/first/ready`]);
    for (const { law } of result.laws) {
      expect(law.form.id).toBe("linear");
      expect(law.measure).toEqual({ id: "ready", unit: "ms" });
      expect(law.variables[0]).toMatchObject({ id: "log", unit: "MiB", scale: "log", min: 16, max: 512 });
      expect(Object.keys(law.conditions)).toEqual(expect.arrayContaining([...START_CONDITIONS]));
      expect(law.conditions).toMatchObject({ "cpu.model": EPYC, start: "first", seeder: CASE.seeder, watch: CASE.watch });
    }
  });

  it("gives a problem for a plan with no start law set, and no law for too few jobs", () => {
    expect(startLawsOf({ id: "alerts-start" }, jobsOf(5), OPTIONS).problems.map((each) => each.code)).toEqual(["plan"]);
    const few = startLawsOf(PLAN, jobsOf(4), OPTIONS);
    expect(few.laws).toEqual([]);
    expect(few.skipped.map((each) => each.path)).toEqual([`alerts/alerts-start/${MODEL}/cloud/first`, `alerts/alerts-start/${MODEL}/new/first`]);
  });

  it("skips a job of another plan, and tells each failure of a start", () => {
    const other = { ...jobsOf(1)[0]!, timed: timedOf("alerts-start-files", runOf(99), EPYC, "2026-11-22T08:00:00Z") };
    const failed = jobsOf(5, EPYC, (record, job) =>
      job === 0 ? { ...record, failures: [{ arm: "new", case: "log-512", round: 1, reason: "passed the memory limit of its container.", kind: "memory" }] } : record,
    );
    const result = startLawsOf(PLAN, [...failed, other], OPTIONS);
    expect(result.skipped.map((each) => each.code)).toEqual(["job", "case"]);
    expect(result.skipped[1]?.path).toBe(`alerts/alerts-start/${MODEL}/new/first`);
    expect(result.laws).toHaveLength(2);
  });

  it("gives a problem for a reading of an arm that the case does not have, and for a base with too few A/A pairs", () => {
    const strange = jobsOf(5, EPYC, (record, job) => (job === 0 ? { ...record, readings: [...record.readings, { ...record.readings[0]!, arm: "old" }] } : record));
    expect(startLawsOf(PLAN, strange, OPTIONS).problems.map((each) => each.code)).toEqual(["read"]);
    const lonely = jobsOf(5, EPYC, (record) => ({ ...record, readings: record.readings.filter((reading) => reading.arm !== "cloud~aa" || reading.round > 0 || reading.point !== "log-16") }));
    expect(startLawsOf(PLAN, lonely, OPTIONS).problems).toEqual([]);
    const none = jobsOf(5, EPYC, (record) => ({ ...record, readings: record.readings.filter((reading) => reading.arm !== "cloud~aa") }));
    const result = startLawsOf(PLAN, none, OPTIONS);
    expect(result.problems.map((each) => each.code)).toEqual(["noise", "noise"]);
    expect(result.laws).toEqual([]);
  });

  it("gives a problem for two jobs whose records differ in a condition", () => {
    const moved = jobsOf(5, EPYC, (record, job) => (job === 4 ? { ...record, case: { ...record.case, seeder: "0".repeat(40) } } : record));
    const problems = startLawsOf(PLAN, moved, OPTIONS).problems;
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.every((each) => each.code === "case" && each.message.includes("seeder"))).toBe(true);
  });
});

describe("the problems of a start law set", () => {
  it("examines the variable, each measure and the conditions, then the cases", () => {
    expect(startLawSetProblems(SET, [CASE])).toEqual([]);
    expect(startLawSetProblems(null, [CASE]).map((each) => each.path)).toEqual(["startLaws"]);
    const twice = { ...SET, measures: [SET.measures[0], { ...SET.measures[0], law: "ready-2" }] };
    expect(startLawSetProblems(twice, [CASE]).map((each) => each.path)).toEqual(["startLaws.measures[1].id"]);
    expect(startLawSetProblems({ ...SET, measures: [{ ...SET.measures[0], id: "speed" }] }, [CASE]).map((each) => each.path)).toEqual(["startLaws.measures[0].id"]);
    expect(startLawSetProblems({ ...SET, conditions: { start: "warm" } }, [CASE]).map((each) => each.path)).toEqual(["startLaws.conditions.start"]);
    const point = { ...CASE.points[0]!, at: {} };
    expect(startLawSetProblems(SET, [{ ...CASE, points: [point] }]).map((each) => each.path)).toEqual(["cases[0].points[0].at"]);
  });
});
