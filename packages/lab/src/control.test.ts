import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { recordProblems, verdictOf } from "./check.ts";
import { CONTROL_CASES, CONTROL_LIMITS } from "./control.ts";
import type { CaseRecord, RunRecord } from "./record.ts";

/** The two records of the Lab run 44453927945 on main, on an Intel Xeon 6975P-C. */
const fixture = (name: string): CaseRecord => JSON.parse(readFileSync(new URL(`../test/fixtures/${name}.record.json`, import.meta.url), "utf8")) as CaseRecord;
const BASE = fixture("control-base");
const MORE = fixture("control-more");

/** This function gives a copy of a record with a change to each run. */
const eachRun = (record: CaseRecord, change: (run: RunRecord) => RunRecord): CaseRecord => ({ ...record, runs: record.runs.map(change) });

/** This function gives a copy of a run with new values of some measures. */
const withMeasures = (run: RunRecord, measures: Partial<RunRecord["measures"]>): RunRecord => ({ ...run, measures: { ...run.measures, ...measures } });

describe("the check of the positive control", () => {
  it("passes the records of a CI run, with each value inside its limit", () => {
    const verdict = verdictOf("control", [BASE, MORE]);
    expect(verdict.problems).toEqual([]);
    expect(verdict.check).toBe("control");
    expect(verdict.values["cpu.request"]).toBeCloseTo(1.006427, 5);
    expect(verdict.values["network.tx.request"]).toBeCloseTo(16388.198, 2);
    expect(verdict.values["memory"]).toBe(70_107_136);
    expect(verdict.values["latency.p50"]).toBeCloseTo(1.3622, 3);
    for (const [name, value] of Object.entries(verdict.values)) {
      const { low, high } = CONTROL_LIMITS[name as keyof typeof CONTROL_LIMITS];
      expect(value).toBeGreaterThanOrEqual(low);
      expect(value).toBeLessThanOrEqual(high);
    }
  });

  it("fails a subject with no added cost: each change leaves its limit", () => {
    const same: CaseRecord = { ...BASE, case: { ...BASE.case, id: CONTROL_CASES.more } };
    const verdict = verdictOf("control", [BASE, same]);
    expect(verdict.values["cpu.request"]).toBe(0);
    expect(verdict.problems.filter((each) => each.code === "limit").map((each) => each.path)).toEqual(["cpu.request", "network.tx.request", "memory", "latency.p50"]);
  });

  it("gives a problem of the code read, and no value, for a run with no read of a measure", () => {
    const blind = eachRun(MORE, (run) => (run.index === 1 ? withMeasures(run, { "cpu.request": null }) : run));
    const verdict = verdictOf("control", [BASE, blind]);
    expect(verdict.values).not.toHaveProperty("cpu.request");
    expect(verdict.problems).toEqual([{ code: "read", path: "control/more run 1", message: "The run has no read of cpu.request." }]);
  });

  it("fails a run with a request that has no reply", () => {
    const lost = eachRun(BASE, (run) => (run.index === 0 ? withMeasures(run, { answered: { value: 999, unit: "{request}" }, unfinished: { value: 1, unit: "{request}" } }) : run));
    const messages = verdictOf("control", [lost, MORE]).problems.map((each) => `${each.path}: ${each.message}`);
    expect(messages).toEqual(["control/base run 0: The run answered 999 of 1000 requests.", "control/base run 0: The run has 1 unfinished requests, not 0."]);
  });

  it("fails a run that planned fewer requests than its case", () => {
    const short = eachRun(BASE, (run) => withMeasures(run, { planned: { value: 900, unit: "{request}" }, answered: { value: 900, unit: "{request}" } }));
    const problems = verdictOf("control", [short, MORE]).problems;
    expect(problems).toHaveLength(3);
    expect(problems[0]?.message).toBe("The run planned 900 requests. Its case plans 1000.");
  });

  it("fails a plan with a record that is not there", () => {
    expect(verdictOf("control", [BASE]).problems).toEqual([{ code: "record", path: "control/more", message: "The plan has no record of the case control/more." }]);
    expect(verdictOf("control", []).problems.map((each) => each.path)).toEqual(["control/base", "control/more"]);
  });
});

describe("the problems of each record", () => {
  it("passes a complete record", () => {
    expect(recordProblems(BASE)).toEqual([]);
  });

  it("refuses a record with fewer runs than its case, a run with a missing part, and a counter that went back", () => {
    const broken: CaseRecord = {
      ...BASE,
      runs: [{ ...BASE.runs[0]!, missing: "the readings of the end", resets: ["network.tx"] }, BASE.runs[1]!],
    };
    expect(recordProblems(broken).map((each) => `${each.code} ${each.path}: ${each.message}`)).toEqual([
      "record control/base: The record has 2 runs. Its case counts 3.",
      "run control/base run 0: The harness did not record a part of the run: the readings of the end",
      "run control/base run 0: These counters went back in the run: network.tx.",
    ]);
  });

  it("gives only the problems of each record for a plan with no check", () => {
    const verdict = verdictOf(null, [BASE, { ...MORE, runs: MORE.runs.slice(1) }]);
    expect(verdict).toEqual({ check: null, values: {}, problems: [{ code: "record", path: "control/more", message: "The record has 2 runs. Its case counts 3." }] });
  });

  it("refuses a check that the lab does not have", () => {
    expect(() => verdictOf("nope", [BASE])).toThrow(RangeError);
    expect(() => verdictOf("toString", [BASE])).toThrow(RangeError);
  });
});
