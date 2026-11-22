import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkLaw, type Run } from "@mark1russell7/capacity";
import { readLaw } from "@mark1russell7/capacity/schema";
import { escapeMarkdown } from "@mark1russell7/text";
import { describe, expect, it } from "vitest";
import type { Case } from "./case.ts";
import { CPU_IDS, conditionsOf, lawSetProblems, lawsOf, lawsSummaryOf, servedShare, tailNeed, type KnownMark, type LawJob, type LawSet } from "./laws.ts";
import { readPlans } from "./plan.ts";
import type { CaseRecord, RunRecord } from "./record.ts";
import { isStartCase } from "./start.ts";
import type { Timed } from "./timed.ts";
import { BASE, RATE, CASES, EPYC, XEON, OTHER, KNEE, SET, PLAN, FAST, FAST_PLAN, SERVED, recordOf, runOf, timedOf, jobOf, jobsOf, TAIL, tailJobs, floorOf, FLOORS, OPTIONS } from "./law-fixtures.ts";

describe("the laws of a plan", () => {
  it("gives a law of each measure on each CPU model, with its evidence, its noise and the forms that lost", () => {
    const jobs = [...jobsOf(runOf(1), EPYC, 1), ...jobsOf(runOf(2), XEON, 6)];
    const { laws, skipped, problems } = lawsOf(FAST_PLAN, jobs, FLOORS, OPTIONS);
    expect(problems).toEqual([]);
    expect(skipped).toEqual([]);
    expect(laws.map(({ law }) => law.id)).toEqual([
      "node-http/rate/epyc-7763/cpu.request",
      "node-http/rate/epyc-7763/memory",
      "node-http/rate/xeon-6975p-c/cpu.request",
      "node-http/rate/xeon-6975p-c/memory",
    ]);
    for (const { law, ranks } of laws) {
      expect(checkLaw(law)).toEqual([]);
      expect(ranks[0]?.form).toBe(law.form.id);
      expect(law.variables).toEqual([{ id: "rate", unit: "{request}/s", min: 100, max: 36000, scale: "log" }]);
      expect(law.fit.losers).toHaveLength(1);
      expect(law.replicates).toHaveLength(40);
      // the bootstrap draws whole jobs, and the held-out fit holds out whole rates
      expect(law.fit.method).toContain(`of ${CASES.length} groups`);
      expect(law.fit.method).toContain("of 5 whole groups");
    }
    const [epyc, , xeon] = laws.map(({ law }) => law);
    // five jobs of one CI run give one run of the evidence, and five times the points
    expect(epyc!.evidence.runs).toEqual([runOf(1)]);
    expect(epyc!.fit.residuals).toHaveLength(5 * CASES.length);
    expect(xeon!.evidence.runs).toEqual([runOf(2)]);
    expect(xeon!.fit.residuals).toHaveLength(5 * CASES.length);
    // the floor of the same CPU model, and else the model with the largest floor
    expect(epyc!.noise).toEqual({ floor: 0.01, cpu: EPYC, runs: [runOf(10)] });
    expect(xeon!.noise).toEqual({ floor: 0.03, cpu: "AMD EPYC 9V45 96-Core Processor", runs: [runOf(11)] });
    expect(laws[1]!.law.measure).toEqual({ id: "memory", unit: "B" });
    expect(epyc!.title).toBe(`The CPU time of one request, on the CPU ${EPYC}`);
  });

  it("fits the hinge of the CPU time, with its knee near the true knee", () => {
    // The 8 lowest rates of 5 jobs give 40 points, the least count of a law. The rates go from 100 to 7000.
    const jobs = jobsOf(runOf(1), EPYC, 1).map((job) => ({ ...job, records: job.records.slice(0, 8) }));
    const { laws, problems } = lawsOf(PLAN, jobs, FLOORS, OPTIONS);
    expect(problems).toEqual([]);
    const { law, ranks } = laws[0]!;
    expect(checkLaw(law)).toEqual([]);
    expect(law.fit.residuals).toHaveLength(40);
    expect([law.form.id, ranks.map((rank) => rank.form)]).toEqual(["hinge", ["hinge", "linear"]]);
    const knee = law.constants.find((constant) => constant.id === "knee")!.value;
    expect(Math.abs(knee - KNEE) / KNEE).toBeLessThan(0.1);
  });

  it("gives the conditions of a law from a record", () => {
    expect(conditionsOf(recordOf(0, 1, EPYC), { ...SET, conditions: { keepalive: true } })).toEqual({
      class: "rate",
      "cpu.model": EPYC,
      "cpu.limit": { value: 1, unit: "{core}" },
      "memory.limit": { value: 512, unit: "MiB" },
      duration: { value: 1, unit: "s" },
      arrivals: "poisson",
      connections: "pool",
      "connections.size": 64,
      harness: BASE.machine.harness,
      keepalive: true,
    });
  });

  it("skips a job of another plan, with no CI run, with a problem in its verdict or with no record", () => {
    const problem = { code: "limit" as const, path: "rate/100.lag.max", message: "The lag is above its limit." };
    const jobs: LawJob[] = [
      jobOf(runOf(1), EPYC, 1),
      ...jobsOf(runOf(1), EPYC, 7, 4),
      { ...jobOf(runOf(3), EPYC, 2), timed: timedOf("control", runOf(3), EPYC, "2026-11-20T06:02:00Z") },
      jobOf(null, EPYC, 3),
      jobOf(runOf(4), EPYC, 4, { problems: [problem] }),
      { timed: timedOf("rate", runOf(5), EPYC, "2026-11-20T06:05:00Z"), records: [] },
      { ...jobOf(runOf(6), EPYC, 6), records: [recordOf(0, 6, XEON)] },
    ];
    const { laws, skipped, problems } = lawsOf(FAST_PLAN, jobs, FLOORS, OPTIONS);
    expect(problems).toEqual([]);
    expect(laws).toHaveLength(2);
    expect(laws[0]!.law.evidence.runs).toEqual([runOf(1)]);
    // the jobs are in the order of their names, and a job with no CI run has the name "a local run"
    expect(skipped.map((each) => [each.code, each.message])).toEqual([
      ["job", "The job has no CI run. The evidence of a law is a CI run."],
      ["job", 'The job measured the plan "control", not the plan "rate".'],
      ["job", "The verdict of the job has 1 problems. A law uses only a job with no problem."],
      ["job", "The job has no record of a case of load."],
      ["job", `The record of the case "rate/100" has the CPU model "${XEON}", not "${EPYC}".`],
    ]);
  });

  it("skips a CPU model with fewer than 40 points, and fits the laws of the other models", () => {
    const { laws, skipped, problems } = lawsOf(FAST_PLAN, [jobOf(runOf(1), EPYC, 1), ...jobsOf(runOf(2), XEON, 2)], FLOORS, OPTIONS);
    expect(problems).toEqual([]);
    expect(laws.map(({ law }) => law.id)).toEqual(["node-http/rate/xeon-6975p-c/cpu.request", "node-http/rate/xeon-6975p-c/memory"]);
    expect(skipped).toEqual([{ code: "case", path: "node-http/rate/epyc-7763", message: "The jobs on the CPU model give 25 points. A law needs 40 points or more." }]);
  });

  it("skips a CPU model with fewer jobs than the bootstrap of whole jobs needs", () => {
    // Four jobs give 100 points, but only 35 different draws of whole jobs. The level 0.95 needs 40.
    const { laws, skipped, problems } = lawsOf(FAST_PLAN, [...jobsOf(runOf(1), EPYC, 1, 4), ...jobsOf(runOf(2), XEON, 5)], FLOORS, OPTIONS);
    expect(problems).toEqual([]);
    expect(laws.map(({ law }) => law.id)).toEqual(["node-http/rate/xeon-6975p-c/cpu.request", "node-http/rate/xeon-6975p-c/memory"]);
    expect(skipped).toEqual([
      { code: "case", path: "node-http/rate/epyc-7763", message: "The count of jobs on the CPU model is 4. The bootstrap of a law draws whole jobs, thus a law needs 5 jobs or more." },
    ]);
  });

  it("gives no law for a CPU model with no id, and no law with no job", () => {
    expect(CPU_IDS.other).toBeNull();
    const { laws, problems } = lawsOf(FAST_PLAN, [jobOf(runOf(1), OTHER, 1)], FLOORS, OPTIONS);
    expect(laws).toEqual([]);
    expect(problems).toEqual([{ code: "cpu", path: OTHER, message: `The lab has no id for the CPU model "${OTHER}". Add a part of its name to CPU_IDS.` }]);
    expect(lawsOf(FAST_PLAN, [], FLOORS, OPTIONS).problems).toEqual([{ code: "job", path: "rate", message: 'No job of the plan "rate" gave points.' }]);
    expect(lawsOf({ id: "rate" }, [], FLOORS).problems).toEqual([{ code: "plan", path: "rate", message: 'The plan "rate" has no law set.' }]);
  });

  it("gives no law of a measure with no read in a run, and the laws of the other measures", () => {
    const [job, ...rest] = jobsOf(runOf(1), EPYC, 1);
    const records = job!.records.map((record, index) =>
      index === 3 ? { ...record, runs: record.runs.map((run): RunRecord => (run.index === record.runs[1]!.index ? { ...run, measures: { ...run.measures, memory: null } } : run)) } : record,
    );
    const { laws, problems } = lawsOf(FAST_PLAN, [{ ...job!, records }, ...rest], FLOORS, OPTIONS);
    expect(laws.map(({ law }) => law.id)).toEqual(["node-http/rate/epyc-7763/cpu.request"]);
    expect(problems).toEqual([{ code: "read", path: "node-http/rate/epyc-7763/memory", message: `${CASES[3]!.id} run ${BASE.runs[1]!.index}: The run has no read of memory.` }]);
  });

  it("gives no law of a measure with no noise floor, and uses only the floor jobs with no problem", () => {
    const floors = [
      floorOf(runOf(10), EPYC, 0.5, [{ code: "limit", path: "memory.floor", message: "The floor is above its limit." }]),
      { ...floorOf(runOf(11), EPYC, 1), verdict: { check: "floor", values: { "cpu.request.floor": 0.02 }, problems: [] } },
    ];
    const { laws, skipped, problems } = lawsOf(FAST_PLAN, jobsOf(runOf(1), EPYC, 1), floors, OPTIONS);
    expect(laws.map(({ law }) => [law.id, law.noise.floor])).toEqual([["node-http/rate/epyc-7763/cpu.request", 0.02]]);
    expect(problems).toEqual([{ code: "noise", path: "node-http/rate/epyc-7763/memory", message: "No floor job with no problem has a noise floor of memory." }]);
    expect(skipped.map((each) => each.code)).toEqual(["noise"]);
  });

  it("gives no law when two cases differ in a condition", () => {
    const [job, ...rest] = jobsOf(runOf(1), EPYC, 1);
    const small = { ...job!.records[5]!, case: { ...job!.records[5]!.case, instance: { resources: { cpu: { value: 1, unit: "{core}" }, memory: { value: 256, unit: "MiB" } } } } };
    const { laws, problems } = lawsOf(FAST_PLAN, [{ ...job!, records: job!.records.map((record, index) => (index === 5 ? small : record)) }, ...rest], FLOORS, OPTIONS);
    expect(laws).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ code: "case", path: "node-http/rate/epyc-7763" });
    expect(problems[0]!.message).toContain('differs from the case "rate/100" in memory.limit.');
  });

  it("gives the least served share of a case from its largest latency and its duration", () => {
    // Each run of the plan rate lasts 1 s. A largest latency of 3 ms gives 1000 / 1003.
    expect(servedShare(recordOf(0, 1, EPYC))).toBeCloseTo(1000 / 1003, 12);
    expect(servedShare(recordOf(24, 1, EPYC))).toBeCloseTo(1000 / 1060, 12);
    const lost = recordOf(0, 1, EPYC);
    const noRead = { ...lost, runs: lost.runs.map((run): RunRecord => ({ ...run, measures: { ...run.measures, "latency.max": null } })) };
    expect(servedShare(noRead)).toMatchObject({ code: "read", path: `rate/100 run ${BASE.runs[0]!.index}` });
  });

  it("keeps only the points where the subject served the share of the measure, and gives the knee of its rule", () => {
    const { laws, skipped, problems } = lawsOf({ id: "rate", laws: SERVED }, jobsOf(runOf(1), EPYC, 1), FLOORS, OPTIONS);
    expect(problems).toEqual([]);
    expect(skipped).toEqual([]);
    expect(laws).toHaveLength(1);
    const { law, cut, knee } = laws[0]!;
    // The rates 33000 and 36000 of each job are out: 115 of the 125 points stay.
    expect(law.fit.residuals).toHaveLength(115);
    expect(law.variables).toEqual([{ id: "rate", unit: "{request}/s", min: 100, max: 30000, scale: "log" }]);
    expect(law.conditions["served"]).toBe(0.97);
    expect(checkLaw(law)).toEqual([]);
    expect(cut.map((point) => point.case)).toEqual(Array.from({ length: 5 }, () => ["rate/33000", "rate/36000"]).flat());
    expect(cut[0]).toMatchObject({ rule: "served", job: `${runOf(1).url} at 2026-11-20T06:01:00Z`, max: 60, served: expect.closeTo(1000 / 1060, 12) });
    // 0.3 (1 + x / 36000) is 1.5 times its floor, at 100, where x = 18150.
    expect(knee?.floor?.load).toBe(100);
    expect(Math.abs((knee!.knee.value as number) - 18_150) / 18_150).toBeLessThan(0.1);
    expect(knee?.edge.value).toBeNull();
  });

  it("skips a law of a measure with fewer than 40 points where the subject served its share", () => {
    // Above 5000, the subject did not keep up: 7 points of each job stay.
    const { laws, skipped, problems } = lawsOf({ id: "rate", laws: SERVED }, jobsOf(runOf(1), EPYC, 1, 5, 5000), FLOORS, OPTIONS);
    expect([laws, problems]).toEqual([[], []]);
    expect(skipped).toEqual([{ code: "case", path: "node-http/rate/epyc-7763/latency.p50", message: "35 of 125 points are in the range of the measure (served share 0.97). A law needs 40 points or more." }]);
  });

  it("gives the count of arrivals that the tail of a quantile needs", () => {
    expect([tailNeed(10, 0.5), tailNeed(10, 0.9), tailNeed(10, 0.99), tailNeed(1, 0.99)]).toEqual([20, 100, 1000, 100]);
  });

  it("keeps only the points where each run has the arrivals that the tail of the quantile needs", () => {
    const { laws, skipped, problems } = lawsOf({ id: "rate", laws: TAIL }, tailJobs(), FLOORS, OPTIONS);
    expect([problems, skipped]).toEqual([[], []]);
    const { law, cut } = laws[0]!;
    // The served share cuts 33000 and 36000 of each job. The tail cuts 100 and 300 of each job, and 1000 of the first job: one of its runs has 999 arrivals.
    expect(law.fit.residuals).toHaveLength(5 * 21 - 1);
    expect(law.variables[0]).toMatchObject({ min: 1000, max: 30000 });
    expect([law.conditions["served"], law.conditions["tail"]]).toEqual([0.97, 10]);
    expect(checkLaw(law)).toEqual([]);
    const tails = cut.filter((point) => point.rule === "tail");
    const low = [
      ["rate/100", 101, 1000],
      ["rate/300", 303, 1000],
    ];
    expect(tails.map((point) => [point.case, point.count, point.need])).toEqual([...low, ["rate/1000", 999, 1000], ...low, ...low, ...low, ...low]);
    expect(cut.filter((point) => point.rule === "served")).toHaveLength(10);
  });

  it("gives a problem of a read for a point with no count of arrivals, and a skip for too few points in the range", () => {
    const [first, ...rest] = tailJobs();
    const lost = { ...first!, records: first!.records.map((record, index) => (index > 0 ? record : { ...record, runs: record.runs.map((run): RunRecord => ({ ...run, measures: { ...run.measures, planned: null } })) })) };
    expect(lawsOf({ id: "rate", laws: TAIL }, [lost, ...rest], FLOORS, OPTIONS).problems).toEqual([
      { code: "read", path: "node-http/rate/epyc-7763/latency.p99", message: `rate/100 run ${BASE.runs[0]!.index}: The run has no read of planned.` },
    ]);
    // The tail count 200 needs 20 000 arrivals: the rates from 20000 to 30000 stay, 5 of each job.
    const few: LawSet = { ...TAIL, measures: [{ ...TAIL.measures[0]!, tail: 200 }] };
    expect(lawsOf({ id: "rate", laws: few }, tailJobs(), FLOORS, OPTIONS).skipped).toEqual([
      { code: "case", path: "node-http/rate/epyc-7763/latency.p99", message: "25 of 125 points are in the range of the measure (served share 0.97, tail 200). A law needs 40 points or more." },
    ]);
  });

  it("keeps a law with a knee search that cannot apply, and gives the problem of the search", () => {
    const set: LawSet = { ...SERVED, measures: [{ ...SERVED.measures[0]!, knee: { kind: "rise", share: 0 } }] };
    const { laws, problems } = lawsOf({ id: "rate", laws: set }, jobsOf(runOf(1), EPYC, 1), FLOORS, OPTIONS);
    expect(laws.map(({ law, knee }) => [law.id, knee])).toEqual([["node-http/rate/epyc-7763/latency.p50", undefined]]);
    expect(problems).toEqual([
      { code: "knee", path: "node-http/rate/epyc-7763/latency.p50", message: 'rule.share: The share of the rule "rise" is 0. It must be a finite number above 0.' },
    ]);
  });

  it("gives a summary with a row for each law, each problem and each skipped job", () => {
    const result = lawsOf(FAST_PLAN, [...jobsOf(runOf(1), EPYC, 1), jobOf(null, EPYC, 6), jobOf(runOf(2), OTHER, 7)], FLOORS, OPTIONS);
    const summary = lawsSummaryOf("rate", result);
    expect(summary).toContain("| Law | Form | Constants | Held-out error | Points | Noise floor |");
    expect(summary).toContain(escapeMarkdown("node-http/rate/epyc-7763/cpu.request"));
    expect(summary).toContain("The problems:");
    expect(summary).toContain("The jobs and the CPU models that gave no law, and the floor jobs that gave no noise:");
    expect(lawsSummaryOf("rate", { laws: [], skipped: [], problems: [], known: [] })).toContain("The plan gave no law.");
  });

  it("gives the intervals, the range, the values at its ends, the knee and the points out of each law in the summary", () => {
    const summary = lawsSummaryOf("rate", lawsOf({ id: "rate", laws: SERVED }, jobsOf(runOf(1), EPYC, 1), FLOORS, OPTIONS));
    expect(summary).toContain("Each interval holds the share 0.95 of the bootstrap replicates.");
    expect(summary).toContain("| Law | Range | Value at the start | Value at the end | Knee |");
    expect(summary).toContain(escapeMarkdown("100 to 30000 {request}/s"));
    expect(summary).toContain(escapeMarkdown("(rule floor, share 0.5, floor "));
    expect(summary).toContain("The points that a law leaves out, because the subject served a smaller share than the field `served` of the measure:");
    expect(summary).toContain(escapeMarkdown("rate/33000 (latency.max 60 ms, served 0.9434) of "));
    const tails = lawsSummaryOf("rate", lawsOf({ id: "rate", laws: TAIL }, tailJobs(), FLOORS, OPTIONS));
    expect(tails).toContain("The points that a law leaves out, because a run has fewer arrivals than the field `tail` of the measure needs:");
    expect(tails).toContain(escapeMarkdown("rate/100 (101 arrivals, 1000 needed) of "));
  });
});

/** This function gives five jobs of the plan rate where the measure `memory` has the same value in each run. Its law has a flat column. */
const flatJobs = (): readonly LawJob[] =>
  jobsOf(runOf(1), EPYC, 1).map((job) => ({
    ...job,
    records: job.records.map((record) => ({ ...record, runs: record.runs.map((run): RunRecord => ({ ...run, measures: { ...run.measures, memory: { value: 30_000_000, unit: "B" } } })) })),
  }));

/** This function gives the set `FAST` with the known mark `known` on the measure `memory`. */
const markedPlan = (known: KnownMark): { readonly id: string; readonly laws: LawSet } => ({
  id: "rate",
  laws: { ...FAST, measures: FAST.measures.map((measure) => (measure.id === "memory" ? { ...measure, known } : measure)) },
});

const MARK: KnownMark = { item: "CAP-57", code: "flat" };
const MEMORY = "node-http/rate/epyc-7763/memory";

describe("the known mark of a measure", () => {
  it("gives the flat column of a measure with no mark as a problem", () => {
    const { laws, problems, known } = lawsOf(FAST_PLAN, flatJobs(), FLOORS, OPTIONS);
    expect(laws.map(({ law }) => law.id)).toEqual(["node-http/rate/epyc-7763/cpu.request"]);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.every((problem) => problem.code === "law" && problem.check === "flat" && problem.path === MEMORY)).toBe(true);
    expect(known).toEqual([]);
  });

  it("gives a known problem as known, with its item, and not as a problem", () => {
    const result = lawsOf(markedPlan(MARK), flatJobs(), FLOORS, OPTIONS);
    expect(result.problems).toEqual([]);
    expect(result.laws.map(({ law }) => law.id)).toEqual(["node-http/rate/epyc-7763/cpu.request"]);
    expect(result.known.length).toBeGreaterThan(0);
    for (const each of result.known) expect(each).toMatchObject({ code: "law", check: "flat", path: MEMORY, item: "CAP-57" });
    const summary = lawsSummaryOf("rate", result);
    expect(summary).toContain("The known problems, each with the item of the roadmap that removes it. They do not fail the fit:");
    expect(summary).toContain(escapeMarkdown("thus its interval has a width of 0. A shape at the edge of its search in each fit gives this. (known until CAP-57)"));
  });

  it("gives each other problem of a measure with a mark as a problem", () => {
    const [job, ...rest] = flatJobs();
    const records = job!.records.map((record, index) =>
      index === 3 ? { ...record, runs: record.runs.map((run): RunRecord => (run.index === record.runs[1]!.index ? { ...run, measures: { ...run.measures, memory: null } } : run)) } : record,
    );
    const { problems, known } = lawsOf(markedPlan(MARK), [{ ...job!, records }, ...rest], FLOORS, OPTIONS);
    expect(problems).toEqual([{ code: "read", path: MEMORY, message: `${CASES[3]!.id} run ${BASE.runs[1]!.index}: The run has no read of memory.` }]);
    expect(known).toEqual([]);
  });

  it("gives a problem when the fit of a measure with a mark gives a law, because the item must remove the mark", () => {
    const { laws, problems, known } = lawsOf(markedPlan(MARK), jobsOf(runOf(1), EPYC, 1), FLOORS, OPTIONS);
    expect(laws.map(({ law }) => law.id)).toEqual(["node-http/rate/epyc-7763/cpu.request", MEMORY]);
    expect(problems).toEqual([
      { code: "known", path: MEMORY, message: 'The plan marks the problem "flat" of the measure as known until CAP-57, but the fit gave a law. Remove the mark.' },
    ]);
    expect(known).toEqual([]);
  });

  it("gives no read of a mark on a CPU model with too few jobs", () => {
    const { problems, known, skipped } = lawsOf(markedPlan(MARK), flatJobs().slice(0, 4), FLOORS, OPTIONS);
    expect([problems, known]).toEqual([[], []]);
    expect(skipped.map((each) => each.path)).toEqual(["node-http/rate/epyc-7763"]);
  });
});

describe("the law set of a plan", () => {
  it("finds no problem in the law set of the plan rate", () => {
    expect(RATE.laws?.measures.map((measure) => measure.id)).toEqual(["cpu.request", "memory", "memory.high", "latency.p50", "latency.p90", "latency.p99"]);
    expect(lawSetProblems(RATE.laws, RATE.cases)).toEqual([]);
  });

  it("gives a problem for each part that is not correct", () => {
    const bad = {
      class: "Rate",
      variable: { id: "Rate", unit: "requests", scale: "square" },
      measures: [
        { id: "lag.max", title: "", residual: "square", forms: ["hinge", "hinge", "spline"] },
        { id: "memory", title: "The memory", residual: "absolute", forms: [] },
        { id: "memory", title: "The memory", residual: "absolute" },
        3,
      ],
      conditions: { "cpu.model": "AMD", Node: "26", "memory.limit": { value: 1, unit: "parsecs" } },
    };
    expect(lawSetProblems(bad, RATE.cases).map((each) => each.path)).toEqual([
      "laws.class",
      "laws.variable.id",
      "laws.variable.unit",
      "laws.variable.scale",
      "laws.measures[0].id",
      "laws.measures[0].title",
      "laws.measures[0].residual",
      "laws.measures[0].forms[1]",
      "laws.measures[0].forms[2]",
      "laws.measures[1].forms",
      "laws.measures[2].id",
      "laws.measures[3]",
      "laws.conditions.cpu.model",
      "laws.conditions.Node",
      "laws.conditions.memory.limit",
      "laws.conditions.memory.limit",
    ]);
    const shares = {
      ...SET,
      measures: [
        { ...SERVED.measures[0]!, served: 1, tail: 2.5 },
        { ...SET.measures[0]!, served: "0.97", tail: 10, knee: { kind: "peak" } },
        { ...SET.measures[1]!, knee: { kind: "floor" } },
      ],
    };
    const found = lawSetProblems(shares, RATE.cases);
    expect(found.map((each) => each.path)).toEqual([
      "laws.measures[0].served",
      "laws.measures[0].tail",
      "laws.measures[1].served",
      "laws.measures[1].tail",
      "laws.measures[1].knee.kind",
      "laws.measures[2].knee.share",
    ]);
    expect(found[1]!.message).toBe("The tail count is not a whole number above 0.");
    expect(found[3]!.message).toBe('The measure "cpu.request" is not a quantile. Only latency.p50, latency.p90, latency.p99 have a tail.');
    const marks = {
      ...SET,
      measures: [
        { ...SET.measures[0]!, known: "CAP-57" },
        { ...SET.measures[1]!, known: { item: "cap 57", code: "replicates" } },
        { ...SERVED.measures[0]!, known: { code: "flat" } },
      ],
    };
    expect(lawSetProblems(marks, RATE.cases)).toEqual([
      { code: "laws", path: "laws.measures[0].known", message: "The known mark is not a record." },
      { code: "laws", path: "laws.measures[1].known.item", message: 'The item is not the id of an item of the roadmap, for example "CAP-57".' },
      { code: "laws", path: "laws.measures[1].known.code", message: "The code is not one of flat." },
      { code: "laws", path: "laws.measures[2].known.item", message: 'The item is not the id of an item of the roadmap, for example "CAP-57".' },
    ]);
    expect(lawSetProblems([], RATE.cases)).toEqual([{ code: "laws", path: "laws", message: "The law set is not a record." }]);
    expect(lawSetProblems({ ...SET, measures: [] }, RATE.cases).map((each) => each.path)).toEqual(["laws.measures"]);
  });

  it("gives a problem for a case with another class, with no amount of the variable, or a start case", () => {
    const [first, second] = CASES;
    const other: Case = { ...first!, demand: { ...first!.demand, classes: [{ ...first!.demand.classes[0]!, id: "other" }] } };
    const sized = lawSetProblems({ ...SET, variable: { id: "size", unit: "B", scale: "linear" } }, [second!]);
    expect(lawSetProblems(SET, [other, second!]).map((each) => each.path)).toEqual(["cases[0].demand.classes"]);
    expect(sized).toEqual([{ code: "laws", path: "cases[0].demand", message: 'The demand gives no amount for the variable "size" of the law "rate/300".' }]);
    const start = readPlans(fileURLToPath(new URL("../plans/", import.meta.url))).plans.flatMap((plan) => plan.cases).find(isStartCase);
    expect(start).toBeDefined();
    expect(lawSetProblems(SET, [start!]).map((each) => each.path)).toEqual(["cases[0]"]);
  });
});

const COMMAND = fileURLToPath(new URL("./laws.main.ts", import.meta.url));

/** This function writes the folder of one job, as the artifact of a timed run holds it. */
const writeJob = (folder: string, name: string, timed: Timed, records: readonly CaseRecord[]): void => {
  mkdirSync(join(folder, name));
  records.forEach((record, index) => writeFileSync(join(folder, name, `record-${index}.json`), JSON.stringify(record)));
  const files = records.map((record, index) => ({ case: record.case.id, record: `record-${index}.json`, result: `result-${index}.json` }));
  writeFileSync(join(folder, name, "timed.json"), JSON.stringify({ ...timed, files }));
};

describe("the command of the laws", () => {
  // The plan rate has 39 forms of 6 laws, and their fits on the Vex interpreter are slow (CAP-55 compiles the bases).
  // Thus the test fits 40 points, the least count of a law: the 8 lowest rates of 5 jobs, the least count of jobs.
  // The median of the plan has a known mark of a flat column (CAP-57). Thus the median of the jobs has one value in each run.
  it("writes a correct law file of each measure of the plan rate from the folders of the jobs, and exits 0 for a known problem", () => {
    const folder = mkdtempSync(join(tmpdir(), "capacity-laws-"));
    try {
      const flat = (record: CaseRecord): CaseRecord => ({ ...record, runs: record.runs.map((run): RunRecord => ({ ...run, measures: { ...run.measures, "latency.p50": { value: 0.3, unit: "ms" } } })) });
      jobsOf(runOf(1), EPYC, 1).forEach((job, index) => writeJob(folder, `lab-rate-${index + 1}-1`, job.timed, job.records.slice(0, 8).map(flat)));
      writeJob(folder, "lab-floor-1-1", FLOORS[0]!, []);
      const out = join(folder, "out");
      const result = spawnSync(process.execPath, [COMMAND, "fit", "--records", folder, "--out", out, "--runs", "40"], { encoding: "utf8" });
      expect(result.stderr).toBe("");
      expect(result.stdout).not.toContain("The problems:");
      expect(result.stdout).toContain(escapeMarkdown("node-http/rate/epyc-7763/latency.p50: constants["));
      expect(result.stdout).toContain(escapeMarkdown("(known until CAP-57)"));
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("### The laws of the plan rate");
      const files = readdirSync(join(out, "node-http", "rate", "epyc-7763")).sort();
      expect(RATE.laws!.measures.filter((measure) => measure.known !== undefined).map((measure) => measure.id)).toEqual(["latency.p50"]);
      expect(files).toEqual(RATE.laws!.measures.filter((measure) => measure.known === undefined).map((measure) => `${measure.id}.law.json`).sort());
      for (const name of files) {
        const law = readLaw(JSON.parse(readFileSync(join(out, "node-http", "rate", "epyc-7763", name), "utf8")));
        expect(law.tag).toBe("ok");
      }
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  }, 60_000);

  it("gives the exit code 1 for records with no job of a plan with a law set", () => {
    const folder = mkdtempSync(join(tmpdir(), "capacity-laws-"));
    try {
      writeJob(folder, "lab-floor-1-1", FLOORS[0]!, []);
      const result = spawnSync(process.execPath, [COMMAND, "fit", "--records", folder, "--out", join(folder, "out")], { encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("No job of the 1 jobs of the records is a job of a plan with a law set.\n");
      const usage = spawnSync(process.execPath, [COMMAND, "fit", "--out", folder], { encoding: "utf8" });
      expect(usage.status).toBe(1);
      expect(usage.stderr).toContain("The command needs --records and --out.");
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
