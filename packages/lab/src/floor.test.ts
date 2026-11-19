import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { verdictOf } from "./check.ts";
import { FLOOR_LIMITS, FLOOR_MEASURES, FLOOR_PAIRS, floorCheck, floorPair, type FloorMeasure } from "./floor.ts";
import { LAG_LIMIT, medianOf, worstLag } from "./reads.ts";
import type { CaseRecord, LoadMeasure, RunMeasure, RunRecord } from "./record.ts";

/** The record of the case control/base of the Lab run 44453927945 on main. Each case of the plan floor has its load. */
const BASE = JSON.parse(readFileSync(new URL("../test/fixtures/control-base.record.json", import.meta.url), "utf8")) as CaseRecord;

/** This function gives a copy of a record with a change to each run. */
const eachRun = (record: CaseRecord, change: (run: RunRecord) => RunRecord): CaseRecord => ({ ...record, runs: record.runs.map(change) });

/** This function gives a copy of a run with new values of some measures. */
const withMeasures = (run: RunRecord, measures: Partial<RunRecord["measures"]>): RunRecord => ({ ...run, measures: { ...run.measures, ...measures } });

/** This function gives a copy of a record with `delta` added to the measure `name` in each run. */
const shifted = (record: CaseRecord, name: RunMeasure | LoadMeasure, delta: number): CaseRecord =>
  eachRun(record, (run) => {
    const amount = run.measures[name];
    return amount === null ? run : withMeasures(run, { [name]: { ...amount, value: amount.value + delta } } as Partial<RunRecord["measures"]>);
  });

/** This function gives the copy of the record `BASE` for the case `id`. */
const caseOf = (id: string): CaseRecord => ({ ...BASE, case: { ...BASE.case, id } });

/**
 * This function gives the 10 records of the plan floor. The case b of the pair p has the difference
 * `differences[name][p - 1]` in the measure `name`. Each other value is the value of `BASE`.
 */
const plan = (differences: Partial<Record<FloorMeasure, readonly number[]>> = {}): CaseRecord[] =>
  Array.from({ length: FLOOR_PAIRS }, (_, index) => floorPair(index + 1)).flatMap(({ a, b }, index) => {
    let more = caseOf(b);
    for (const [name, list] of Object.entries(differences)) more = shifted(more, name as FloorMeasure, list?.[index] ?? 0);
    return [caseOf(a), more];
  });

/** This function gives the run `index` of the case `id` of some records, with a change. */
const changeRun = (records: readonly CaseRecord[], id: string, index: number, change: (run: RunRecord) => RunRecord): CaseRecord[] =>
  records.map((record) => (record.case.id === id ? eachRun(record, (run) => (run.index === index ? change(run) : run)) : record));

/** This function gives 2 sample standard deviations of some values: the noise floor, with its own formula. */
const twoSd = (values: readonly number[]): number => {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return 2 * Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
};

const level = (name: FloorMeasure): number => medianOf(BASE, name) as number;

const CPU = [0.004, -0.002, 0.001, 0.003, -0.001];
const P99 = [0.05, -0.03, 0.02, 0.04, -0.01];

describe("the check of the noise floor", () => {
  it("gives the floor, the level and the bias of each measure from the A/A pairs", () => {
    const { values, problems } = floorCheck(plan({ "cpu.request": CPU, "latency.p99": P99 }));
    expect(problems).toEqual([]);
    expect(values["cpu.request.floor"]).toBeCloseTo(twoSd(CPU), 9);
    expect(values["cpu.request.bias"]).toBeCloseTo(0.001, 9);
    expect(values["cpu.request.level"]).toBeCloseTo(level("cpu.request"), 9);
    expect(values["latency.p99.floor"]).toBeCloseTo(twoSd(P99), 9);
    expect(values["latency.p99.bias"]).toBeCloseTo(0.014, 9);
    for (const name of FLOOR_MEASURES.filter((each) => each !== "cpu.request" && each !== "latency.p99")) {
      expect(values[`${name}.floor`]).toBe(0);
      expect(values[`${name}.bias`]).toBe(0);
      expect(values[`${name}.level`]).toBe(level(name));
    }
    expect(values["lag.max.worst"]).toBe(worstLag([BASE]));
    expect(Object.keys(values)).toHaveLength(3 * FLOOR_MEASURES.length + 1);
  });

  it("is the check floor of the plans", () => {
    const verdict = verdictOf("floor", plan({ "cpu.request": CPU }));
    expect(verdict.check).toBe("floor");
    expect(verdict.problems).toEqual([]);
    expect(verdict.values["cpu.request.floor"]).toBeCloseTo(twoSd(CPU), 9);
  });

  it("fails a floor above its limit", () => {
    const limit = FLOOR_LIMITS["cpu.request"];
    const noisy = [3 * limit, -3 * limit, 3 * limit, -3 * limit, 0];
    const { values, problems } = floorCheck(plan({ "cpu.request": noisy }));
    expect(values["cpu.request.floor"]).toBeCloseTo(6 * limit, 9);
    expect(problems.map((each) => `${each.code} ${each.path}`)).toEqual(["limit cpu.request.floor"]);
  });

  it("fails a run with a lag of the driver above its limit, and a run with no read of the lag", () => {
    let records = changeRun(plan(), "floor/b3", 0, (run) => withMeasures(run, { "lag.max": { value: LAG_LIMIT + 1, unit: "ms" } }));
    records = changeRun(records, "floor/a4", 2, (run) => withMeasures(run, { "lag.max": null }));
    const { values, problems } = floorCheck(records);
    expect(problems).toEqual([
      { code: "limit", path: "floor/b3 run 0", message: `The lag of the driver is ${LAG_LIMIT + 1} ms. Its limit is ${LAG_LIMIT} ms.` },
      { code: "read", path: "floor/a4 run 2", message: "The run has no read of lag.max." },
    ]);
    expect(values["lag.max.worst"]).toBe(LAG_LIMIT + 1);
  });

  it("gives a problem of the code read, and no value of the measure, for a run with no read of a measure", () => {
    const records = changeRun(plan(), "floor/a2", 1, (run) => withMeasures(run, { "memory.high": null }));
    const { values, problems } = floorCheck(records);
    expect(problems).toEqual([{ code: "read", path: "floor/a2 run 1", message: "The run has no read of memory.high." }]);
    expect(values).not.toHaveProperty("memory.high.floor");
    expect(values).not.toHaveProperty("memory.high.level");
    expect(values["cpu.request.floor"]).toBe(0);
  });

  it("fails a run with a request that has no reply", () => {
    const records = changeRun(plan(), "floor/a1", 0, (run) =>
      withMeasures(run, { answered: { value: 999, unit: "{request}" }, unfinished: { value: 1, unit: "{request}" } }),
    );
    expect(floorCheck(records).problems.map((each) => `${each.path}: ${each.message}`)).toEqual([
      "floor/a1 run 0: The run answered 999 of 1000 requests.",
      "floor/a1 run 0: The run has 1 unfinished requests, not 0.",
    ]);
  });

  it("fails a plan with a record that is not there, and gives no value", () => {
    const records = plan().filter((record) => record.case.id !== "floor/b5");
    expect(floorCheck(records)).toEqual({ values: {}, problems: [{ code: "record", path: "floor/b5", message: "The plan has no record of the case floor/b5." }] });
    expect(floorCheck([]).problems).toHaveLength(2 * FLOOR_PAIRS);
  });
});
