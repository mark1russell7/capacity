import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Case } from "./case.ts";
import { verdictOf } from "./check.ts";
import { IDLE_MEASURES, idleBaseOf, idleBasesOf, idleCheck, idleProblems, idleRunMeasures, netRequestCpu, type IdleBase } from "./idle.ts";
import type { LawJob } from "./laws.ts";
import type { Plan } from "./plan.ts";
import type { CaseRecord, RunRecord } from "./record.ts";
import { TIMED_FORMAT, type Timed } from "./timed.ts";

/** The record of the case control/base of the Lab run 44453927945 on main: 3 runs of 1000 requests in 10 s. */
const LOAD = JSON.parse(readFileSync(new URL("../test/fixtures/control-base.record.json", import.meta.url), "utf8")) as CaseRecord;

/** The plan `idle`, as its file has it. */
const PLAN = JSON.parse(readFileSync(new URL("../plans/idle.json", import.meta.url), "utf8")) as Plan;
const [BARE, SERVICE] = PLAN.cases as readonly Case[];

/** This function gives an idle run: `cpu` core seconds in `elapsed` seconds, at the end `memory` bytes, at the highest `high` bytes. */
const runOf = (index: number, cpu: number, elapsed: number, memory: number, high: number): RunRecord => ({
  ...LOAD.runs[0]!,
  index,
  measures: {
    ...LOAD.runs[0]!.measures,
    elapsed: { value: elapsed, unit: "s" },
    cpu: { value: cpu, unit: "{core}·s" },
    memory: { value: memory, unit: "B" },
    "memory.high": { value: high, unit: "B" },
    planned: { value: 0, unit: "{request}" },
    answered: { value: 0, unit: "{request}" },
    "cpu.request": null,
  },
});

/** This function gives a record of an idle case with three runs of 60.25 s. The CPU rates are 0.001, 0.002 and 0.003 times `scale` cores. */
const idleOf = (value: Case, scale = 1): CaseRecord => ({
  ...LOAD,
  case: value,
  runs: [1, 3, 2].map((step, index) => runOf(index, 0.06025 * step * scale, 60.25, 20_000_000 * scale + index, 21_000_000 * scale + index)),
});

describe("the idle measures of a run", () => {
  it("gives the CPU rate as the CPU time over the elapsed time, and the memory of the run", () => {
    const run = runOf(0, 0.5, 50, 30_000_000, 31_000_000);
    expect(idleRunMeasures(run)).toEqual({
      "cpu.rate": { value: 0.01, unit: "{core}" },
      memory: { value: 30_000_000, unit: "B" },
      "memory.high": { value: 31_000_000, unit: "B" },
    });
    expect(Object.keys(idleRunMeasures(run))).toEqual(Object.keys(IDLE_MEASURES));
    // an elapsed time in ms converts to s
    expect(idleRunMeasures({ ...run, measures: { ...run.measures, elapsed: { value: 50_000, unit: "ms" } } })["cpu.rate"]?.value).toBeCloseTo(0.01, 12);
  });

  it("gives null for a measure with no read, and for a run with no elapsed time", () => {
    const run = runOf(0, 0.5, 50, 1, 1);
    expect(idleRunMeasures({ ...run, measures: { ...run.measures, cpu: null } })["cpu.rate"]).toBeNull();
    expect(idleRunMeasures({ ...run, measures: { ...run.measures, elapsed: { value: 0, unit: "s" } } })["cpu.rate"]).toBeNull();
    expect(idleRunMeasures({ ...run, measures: { ...run.measures, memory: null } }).memory).toBeNull();
  });
});

describe("the idle base of a record", () => {
  it("gives the median of each idle measure over the runs", () => {
    const base = idleBaseOf(idleOf(BARE!)) as IdleBase;
    expect(base.subject).toBe("node-http");
    expect(base.case).toBe("idle/bare");
    expect(base.runs).toBe(3);
    expect(base.measures["cpu.rate"].value).toBeCloseTo(0.002, 12);
    expect(base.measures.memory).toEqual({ value: 20_000_001, unit: "B" });
    expect(base.measures["memory.high"]).toEqual({ value: 21_000_001, unit: "B" });
  });

  it("refuses a record of load, a record with no run, a run with a request, a run shorter than the hold and a run with no read", () => {
    expect(idleProblems(LOAD).map((each) => each.code)).toEqual(["record"]);
    expect(idleBaseOf({ ...idleOf(BARE!), runs: [] })).toEqual([{ code: "read", path: "idle/bare", message: "The record has no run, thus no idle base." }]);
    const record = idleOf(BARE!);
    const [first, second, third] = record.runs as [RunRecord, RunRecord, RunRecord];
    const bad: CaseRecord = {
      ...record,
      runs: [
        { ...first, measures: { ...first.measures, planned: { value: 5, unit: "{request}" } } },
        { ...second, measures: { ...second.measures, elapsed: { value: 30, unit: "s" } } },
        { ...third, measures: { ...third.measures, "memory.high": null } },
      ],
    };
    expect(idleProblems(bad).map((each) => `${each.code} ${each.path}: ${each.message}`)).toEqual([
      "run idle/bare run 0: The run planned 5 requests. An idle run sends no request.",
      "run idle/bare run 1: The run lasted 30 s, less than the hold of 60 s. The harness did not hold the run.",
      "read idle/bare run 2: The run has no read of memory.high.",
    ]);
    expect(idleBaseOf(bad)).toHaveLength(3);
  });
});

describe("idleCheck", () => {
  it("gives the base of each case and the overhead of the service side over the bare side", () => {
    const { values, problems } = idleCheck([idleOf(BARE!), idleOf(SERVICE!, 2)]);
    expect(problems).toEqual([]);
    expect(values["idle/bare.cpu.rate"]).toBeCloseTo(0.002, 12);
    expect(values["idle/service.cpu.rate"]).toBeCloseTo(0.004, 12);
    expect(values["idle/bare.memory"]).toBe(20_000_001);
    expect(values["idle.cpu.rate.overhead"]).toBeCloseTo(0.002, 12);
    expect(values["idle.memory.overhead"]).toBe(20_000_000);
    expect(values["idle.memory.high.overhead"]).toBe(21_000_000);
  });

  it("gives no overhead for a case with no partner or with the wrong subject, and the problems of a record", () => {
    expect(Object.keys(idleCheck([idleOf(SERVICE!)]).values).filter((name) => name.endsWith(".overhead"))).toEqual([]);
    const swapped = idleCheck([idleOf({ ...BARE!, subject: "node-http-service" }), idleOf(SERVICE!)]);
    expect(Object.keys(swapped.values).filter((name) => name.endsWith(".overhead"))).toEqual([]);
    const { values, problems } = idleCheck([LOAD, idleOf(BARE!)]);
    expect(problems.map((each) => `${each.code} ${each.path}`)).toEqual(["record control/base"]);
    expect(values["idle/bare.cpu.rate"]).toBeCloseTo(0.002, 12);
  });

  it("is the check of the plan idle, for the verdict of its records", () => {
    expect(PLAN.check).toBe("idle");
    const verdict = verdictOf("idle", [idleOf(BARE!), idleOf(SERVICE!)].map((record) => ({ ...record, case: { ...record.case, runs: 3 } })));
    expect(verdict.problems).toEqual([]);
    expect(verdict.values["idle.cpu.rate.overhead"]).toBeCloseTo(0, 12);
  });
});

/** This function gives a job with the records `records` and `problems` problems in its verdict. */
const jobOf = (records: readonly CaseRecord[], problems = 0, started = "2026-11-24T06:00:00.000Z"): LawJob => {
  const timed: Timed = {
    format: TIMED_FORMAT,
    plan: "idle",
    run: { url: "https://github.com/owner/repo/actions/runs/1", commit: "0".repeat(40), date: "2026-11-24T06:00:00Z" },
    attempt: 1,
    machine: records[0]?.machine ?? null,
    at: { started, ended: started },
    files: [],
    verdict: { check: "idle", values: {}, problems: Array.from({ length: problems }, () => ({ code: "run" as const, path: "x", message: "x" })) },
  };
  return { timed, records };
};

describe("idleBasesOf", () => {
  it("gives the base of each idle record of each good job, with the name of the job and the CPU model", () => {
    const { bases, problems } = idleBasesOf([jobOf([idleOf(BARE!), idleOf(SERVICE!, 2), LOAD])]);
    expect(problems).toEqual([]);
    expect(bases.map((each) => [each.case, each.cpu, each.job])).toEqual([
      ["idle/bare", LOAD.machine.cpu, "https://github.com/owner/repo/actions/runs/1 at 2026-11-24T06:00:00.000Z"],
      ["idle/service", LOAD.machine.cpu, "https://github.com/owner/repo/actions/runs/1 at 2026-11-24T06:00:00.000Z"],
    ]);
  });

  it("ignores a job with no idle record, and gives a problem for a job with a bad verdict and for a bad record", () => {
    expect(idleBasesOf([jobOf([LOAD], 2)])).toEqual({ bases: [], problems: [] });
    const { bases, problems } = idleBasesOf([jobOf([idleOf(BARE!)], 1), jobOf([{ ...idleOf(BARE!), runs: [] }])]);
    expect(bases).toEqual([]);
    expect(problems.map((each) => each.message)).toEqual([
      "The verdict of the job has 1 problems. An idle base comes only from a job with no problem.",
      "The record has no run, thus no idle base.",
    ]);
    expect(problems[1]?.path).toBe("https://github.com/owner/repo/actions/runs/1 at 2026-11-24T06:00:00.000Z: idle/bare");
  });
});

describe("netRequestCpu", () => {
  const base = idleBaseOf(idleOf(BARE!)) as IdleBase;

  it("gives the CPU time of one request less the idle CPU time of each run", () => {
    const values = netRequestCpu(LOAD, base) as readonly number[];
    expect(values).toHaveLength(LOAD.runs.length);
    LOAD.runs.forEach((run, index) => {
      const cpu = run.measures.cpu!.value;
      const elapsed = run.measures.elapsed!.value;
      const answered = run.measures.answered!.value;
      expect(values[index]).toBeCloseTo(((cpu - 0.002 * elapsed) * 1000) / answered, 12);
      // the net value is below the gross value of the record by the idle part
      expect(values[index]).toBeLessThan(run.measures["cpu.request"]!.value);
    });
  });

  it("refuses an idle record, another subject, a run with no read and a run with no answered request", () => {
    expect(netRequestCpu(idleOf(BARE!), base)).toMatchObject({ code: "record", path: "idle/bare" });
    expect(netRequestCpu({ ...LOAD, case: { ...LOAD.case, subject: "node-http-service" } }, base)).toMatchObject({ code: "record" });
    expect(netRequestCpu({ ...LOAD, runs: [] }, base)).toMatchObject({ code: "read", path: "control/base" });
    const [first] = LOAD.runs as [RunRecord];
    expect(netRequestCpu({ ...LOAD, runs: [{ ...first, measures: { ...first.measures, cpu: null } }] }, base)).toMatchObject({ code: "read", path: "control/base run 0" });
    expect(netRequestCpu({ ...LOAD, runs: [{ ...first, measures: { ...first.measures, answered: { value: 0, unit: "{request}" } } }] }, base)).toMatchObject({
      message: "The run answered no request.",
    });
  });
});
