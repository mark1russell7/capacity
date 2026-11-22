import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { verdictOf } from "./check.ts";
import { OVERHEAD_MEASURES, OVERHEAD_SIDES, overheadCheck } from "./overhead.ts";
import { planProblems, type Plan } from "./plan.ts";
import { caseValue } from "./reads.ts";
import { CPUSET_MEASURES, type CaseRecord, type RunRecord } from "./record.ts";
import { NODE_HTTP, NODE_HTTP_SERVICE } from "./subjects.ts";

/** The record of the case control/base of the Lab run 44453927945 on main. Its lab had no cpuset measures. */
const OLDER = JSON.parse(readFileSync(new URL("../test/fixtures/control-base.record.json", import.meta.url), "utf8")) as CaseRecord;

/** The record `OLDER` with cpuset measures, as in the tests of the check rate. Each case of these tests has its runs. */
const BASE: CaseRecord = {
  ...OLDER,
  runs: OLDER.runs.map((run, i) => ({
    ...run,
    measures: { ...run.measures, ...Object.fromEntries(Object.keys(CPUSET_MEASURES).map((name, j) => [name, { value: (j + 1) / 10 + i / 100, unit: "{core}" }])) },
  })),
};

/** The plan `overhead`, as its file has it. */
const PLAN = JSON.parse(readFileSync(new URL("../plans/overhead.json", import.meta.url), "utf8")) as Plan;

/** This function gives a copy of `BASE` for the case `id` of the subject `subject`. Each run has `delta` more CPU time for each request. */
const caseOf = (id: string, subject: string, delta = 0): CaseRecord => ({
  ...BASE,
  case: { ...BASE.case, id, subject },
  runs: BASE.runs.map((run): RunRecord => {
    const cpu = run.measures["cpu.request"];
    return cpu === null ? run : { ...run, measures: { ...run.measures, "cpu.request": { ...cpu, value: cpu.value + delta } } };
  }),
});

/** This function gives the two records of the pair `name`. The service case has `delta` more CPU time in each run. */
const pairOf = (name: string, delta = 0): CaseRecord[] => [caseOf(`${name}/bare`, NODE_HTTP.name), caseOf(`${name}/service`, NODE_HTTP_SERVICE.name, delta)];

describe("overheadCheck", () => {
  it("gives the overhead of each pair, the median of the pairs, and each value of the check rate", () => {
    const records = [...pairOf("overhead/100", 0), ...pairOf("overhead/500", 0.5), ...pairOf("overhead/1000", 2)];
    const { values, problems } = overheadCheck(records);
    expect(problems).toEqual([]);
    const bare = caseValue(records[0] as CaseRecord, "cpu.request") as number;
    const more = caseValue(records[3] as CaseRecord, "cpu.request") as number;
    expect(values["overhead/100.cpu.request"]).toBe(0);
    expect(values["overhead/500.cpu.request"]).toBeCloseTo(more - bare, 12);
    expect(values["overhead/500.cpu.request"]).toBeGreaterThan(0);
    // the median of the three overheads is the overhead of the middle pair
    expect(values["cpu.request.overhead"]).toBe(values["overhead/500.cpu.request"]);
    for (const measure of OVERHEAD_MEASURES) expect(values[`${measure}.overhead`]).toBeTypeOf("number");
    expect(values["overhead/100/bare.cpu.request"]).toBe(bare);
    expect(values["lag.max.worst"]).toBeTypeOf("number");
  });

  it("gives a problem for a case with no partner, a case of another subject, a case that is not a side, and a pair of two loads", () => {
    const larger = { ...BASE.case, id: "overhead/2000/service", subject: NODE_HTTP_SERVICE.name, instance: { resources: { cpu: { value: 1, unit: "{core}" }, memory: { value: 1, unit: "GiB" } } } };
    const records: CaseRecord[] = [
      caseOf("overhead/100/bare", NODE_HTTP.name),
      caseOf("overhead/500/bare", NODE_HTTP_SERVICE.name),
      caseOf("overhead/500/service", NODE_HTTP_SERVICE.name),
      caseOf("overhead/1000/other", NODE_HTTP.name),
      caseOf("overhead/2000/bare", NODE_HTTP.name),
      { ...BASE, case: larger },
    ];
    const paths = overheadCheck(records).problems.map((problem) => problem.path);
    expect(paths).toEqual(["overhead/500/bare", "overhead/1000/other", "overhead/100", "overhead/2000"]);
    expect(verdictOf("overhead", records).problems.length).toBe(4);
  });
});

describe("the plan overhead", () => {
  it("has a pair of one load for each rate, the two sides in alternate order, and no problem", () => {
    expect(planProblems(PLAN)).toEqual([]);
    expect(PLAN.check).toBe("overhead");
    const ids = PLAN.cases.map((each) => each.id);
    const sides = ids.map((id) => id.slice(id.lastIndexOf("/") + 1));
    expect(sides).toEqual(["bare", "service", "service", "bare", "bare", "service", "service", "bare", "bare", "service", "service", "bare", "bare", "service", "service", "bare"]);
    for (const each of PLAN.cases) {
      const side = each.id.slice(each.id.lastIndexOf("/") + 1) as keyof typeof OVERHEAD_SIDES;
      expect("subject" in each && each.subject).toBe(OVERHEAD_SIDES[side]);
    }
    // a law needs 40 points or more from 5 jobs: 8 rates in each job
    expect(new Set(ids.map((id) => id.slice(0, id.lastIndexOf("/")))).size).toBe(8);
  });
});
