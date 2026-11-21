import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { verdictOf } from "./check.ts";
import { readPlans } from "./plan.ts";
import { RATE_MEASURES, coresOf, rateCheck } from "./rate.ts";
import { LAG_LIMIT, caseValue } from "./reads.ts";
import type { CaseRecord, RunRecord } from "./record.ts";
import { isStartCase } from "./start.ts";

/** The record of the case control/base of the Lab run 44453927945 on main: 3 runs of the bare request. */
const BASE = JSON.parse(readFileSync(new URL("../test/fixtures/control-base.record.json", import.meta.url), "utf8")) as CaseRecord;

const RATE = readPlans(fileURLToPath(new URL("../plans/", import.meta.url))).plans.find((each) => each.id === "rate");

/** This function gives a record of the case `index` of the plan `rate`, with the runs of `BASE`. */
const rateRecord = (index: number): CaseRecord => {
  const value = RATE?.cases[index];
  // A plan can hold start cases too. The plan rate holds only load cases.
  if (value === undefined || isStartCase(value)) throw new Error(`The plan rate has no load case ${index}.`);
  return { ...BASE, case: value };
};

/** This function gives a copy of a record with new values of some measures in its run `index`. */
const changed = (record: CaseRecord, index: number, measures: Partial<RunRecord["measures"]>): CaseRecord => ({
  ...record,
  runs: record.runs.map((run) => (run.index === index ? { ...run, measures: { ...run.measures, ...measures } } : run)),
});

/** This function gives the middle value of 3 values or more, an odd count, with its own sort. */
const middle = (values: readonly number[]): number => [...values].sort((a, b) => a - b)[(values.length - 1) / 2]!;

const LOW = rateRecord(0);
const HIGH = rateRecord(24);
const FIRST = BASE.runs[0]!.index;

describe("the check of the request rate", () => {
  it("gives the CPU use in cores and the median of each measure for each case", () => {
    const { values, problems } = rateCheck([LOW, HIGH]);
    expect(problems).toEqual([]);
    const cores = middle(BASE.runs.map((run) => run.measures.cpu!.value / run.measures.elapsed!.value));
    for (const id of ["rate/100", "rate/36000"]) {
      expect(values[`${id}.cores`]).toBeCloseTo(cores, 12);
      for (const name of RATE_MEASURES) expect(values[`${id}.${name}`]).toBe(caseValue(BASE, name));
    }
    expect(Object.keys(values)).toHaveLength(2 * (1 + RATE_MEASURES.length));
    expect(coresOf(LOW)).toBeCloseTo(cores, 12);
  });

  it("gives a problem for a failed request, an unfinished request and a driver with a lag above its limit", () => {
    const count = (value: number) => ({ value, unit: "{request}" });
    const failed = changed(LOW, FIRST, { failed: count(1) });
    const unfinished = changed(HIGH, FIRST, { answered: count(999), unfinished: count(1) });
    const late = changed(HIGH, FIRST, { "lag.max": { value: LAG_LIMIT + 1, unit: "ms" } });
    expect(rateCheck([failed]).problems.map((each) => `${each.code} ${each.path}`)).toEqual([`run rate/100 run ${FIRST}`]);
    expect(rateCheck([unfinished]).problems.map((each) => `${each.code} ${each.path}`)).toEqual([`run rate/36000 run ${FIRST}`, `run rate/36000 run ${FIRST}`]);
    expect(rateCheck([late]).problems).toEqual([{ code: "limit", path: `rate/36000 run ${FIRST}`, message: `The lag of the driver is ${LAG_LIMIT + 1} ms. Its limit is ${LAG_LIMIT} ms.` }]);
  });

  it("gives a problem for a run with no read, and for a plan with no record", () => {
    const { values, problems } = rateCheck([changed(LOW, FIRST, { cpu: null, "latency.p99": null })]);
    expect(problems.map((each) => `${each.code} ${each.path}`)).toEqual([`read rate/100 run ${FIRST}`, `read rate/100 run ${FIRST}`]);
    expect(values["rate/100.cores"]).toBeUndefined();
    expect(values["rate/100.latency.p99"]).toBeUndefined();
    expect(values["rate/100.latency.p50"]).toBe(caseValue(BASE, "latency.p50"));
    expect(coresOf({ ...LOW, runs: [] })).toEqual({ code: "read", path: "rate/100", message: "The record has no run, thus no read of cpu." });
    expect(rateCheck([]).problems).toEqual([{ code: "record", path: "", message: "The plan has no record." }]);
  });

  it("is the check rate of the verdict of a plan", () => {
    const verdict = verdictOf("rate", [LOW, HIGH]);
    expect(verdict.check).toBe("rate");
    expect(verdict.problems).toEqual([]);
    expect(verdict.values).toEqual(rateCheck([LOW, HIGH]).values);
  });
});
