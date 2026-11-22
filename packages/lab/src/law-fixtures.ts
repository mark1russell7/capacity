/**
 * These fixtures are the jobs of the plan rate for the tests of the laws and of the gate of the laws. They have a known
 * law of each measure and a small noise from `wave`. They need no random source.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Run } from "@mark1russell7/capacity";
import type { Quantity } from "@mark1russell7/quantity";
import type { Case } from "./case.ts";
import { FLOOR_MEASURES } from "./floor.ts";
import type { LawJob, LawSet } from "./laws.ts";
import { readPlans, type Plan } from "./plan.ts";
import type { CaseRecord, RunRecord } from "./record.ts";
import { TIMED_FORMAT, type Timed } from "./timed.ts";

/** The record of the case control/base of the Lab run 44453927945 on main: 3 runs of the bare request. */
export const BASE = JSON.parse(readFileSync(new URL("../test/fixtures/control-base.record.json", import.meta.url), "utf8")) as CaseRecord;

export const RATE: Plan = readPlans(fileURLToPath(new URL("../plans/", import.meta.url))).plans.find((each) => each.id === "rate")!;
export const CASES = RATE.cases as readonly Case[];

export const EPYC = "AMD EPYC 7763 64-Core Processor";
export const XEON = "Intel(R) Xeon(R) 6975P-C";
export const OTHER = "AMD Ryzen 9 7950X 16-Core Processor";

/** The true law of the CPU time of one request: a hinge with its knee at 2100 requests each second. */
export const KNEE = 2100;
export const cpuOf = (rate: number): number => 0.2 + 0.000_01 * rate + 0.000_05 * Math.max(0, rate - KNEE);

/** This function gives a number from -1 to 1 for three counts. It needs no random source. */
export const wave = (a: number, b: number, c: number): number => ((a * 7919 + b * 104_729 + c * 1_299_709) % 2001) / 1000 - 1;

/**
 * The forms of the tests that do not examine a form. Their fit has no grid search of a shape constant. A fit of
 * the hinge or the power searches a grid in each held-out fit and in each bootstrap run, on each of 125 points.
 */
export const FAST_FORMS: readonly string[] = ["constant", "linear"];

/** A set of two measures. Only the test of the hinge fits it, on 40 points: that test examines the knee of the CPU time. */
export const SET: LawSet = {
  ...RATE.laws!,
  measures: [
    { id: "cpu.request", title: "The CPU time of one request", residual: "relative", forms: ["linear", "hinge"] },
    { id: "memory", title: "The memory of the subject at the end of a run", residual: "relative", forms: FAST_FORMS },
  ],
};
export const PLAN: { readonly id: string; readonly laws: LawSet } = { id: "rate", laws: SET };

/** The set of the two measures of `SET` with the fast forms, for the tests of the jobs, the reads, the noise and the summary. */
export const FAST: LawSet = { ...SET, measures: SET.measures.map((measure) => ({ ...measure, forms: FAST_FORMS })) };
export const FAST_PLAN: { readonly id: string; readonly laws: LawSet } = { id: "rate", laws: FAST };

/** A set of one latency measure with a served share and the knee rule `floor`. */
export const SERVED: LawSet = {
  ...RATE.laws!,
  measures: [{ id: "latency.p50", title: "The median latency of a request", residual: "relative", forms: FAST_FORMS, served: 0.97, knee: { kind: "floor", share: 0.5 } }],
};

/**
 * This function gives the record of the case `index` of the plan rate in the job `job`, on the CPU model `cpu`.
 * Above the rate `slow`, the largest latency is 60 ms: the subject served less than 0.97 of the offered rate.
 */
export const recordOf = (index: number, job: number, cpu: string, slow = 30_000): CaseRecord => recordFor(CASES[index]!, index, job, cpu, slow);

/** This function gives the record of the case `value` of a plan in the job `job`, with the measures of `recordOf`. The count `index` changes the noise. */
export const recordFor = (value: Case, index: number, job: number, cpu: string, slow = 30_000): CaseRecord => {
  const rate = value.demand.classes[0]!.rate.value;
  return {
    ...BASE,
    case: value,
    machine: { ...BASE.machine, cpu },
    runs: BASE.runs.map((run, r) => ({
      ...run,
      measures: {
        ...run.measures,
        "cpu.request": { value: cpuOf(rate) * (1 + 0.01 * wave(index, job, r)), unit: "{core}·ms/{request}" },
        memory: { value: 30_000_000 * (1 + 0.001 * wave(index, job, r + 3)), unit: "B" },
        "memory.high": { value: 31_000_000 * (1 + 0.001 * wave(index, job, r + 6)), unit: "B" },
        "latency.p50": { value: 0.3 * (1 + rate / 36_000) * (1 + 0.02 * wave(index, job, r + 9)), unit: "ms" },
        "latency.p90": { value: 0.5 * (1 + rate / 18_000) * (1 + 0.02 * wave(index, job, r + 12)), unit: "ms" },
        "latency.p99": { value: 0.9 * (1 + rate / 9_000) * (1 + 0.02 * wave(index, job, r + 15)), unit: "ms" },
        "latency.max": { value: rate > slow ? 60 : 3, unit: "ms" },
      },
    })),
  };
};

export const runOf = (id: number): Run => ({ url: `https://github.com/mark1russell7/capacity/actions/runs/${id}`, commit: "0123456789abcdef0123456789abcdef01234567", date: "2026-11-20T06:00:00Z" });

/** This function gives the manifest of a job. */
export const timedOf = (plan: string, run: Run | null, cpu: string, started: string, verdict: Partial<Timed["verdict"]> = {}): Timed => ({
  format: TIMED_FORMAT,
  plan,
  run,
  attempt: run === null ? null : 1,
  machine: { ...BASE.machine, cpu },
  at: { started, ended: started },
  files: [],
  verdict: { check: plan === "floor" ? "floor" : "rate", values: {}, problems: [], ...verdict },
});

/** This function gives a job of the plan rate with a record of each case. Above the rate `slow`, the subject did not keep up. */
export const jobOf = (run: Run | null, cpu: string, job: number, verdict: Partial<Timed["verdict"]> = {}, slow = 30_000): LawJob => ({
  timed: timedOf("rate", run, cpu, `2026-11-20T06:${String(job).padStart(2, "0")}:00Z`, verdict),
  records: CASES.map((_, index) => recordOf(index, job, cpu, slow)),
});

/**
 * This function gives `count` jobs of the plan rate in one CI run, on one CPU model. The default is 5, the least count of
 * jobs of a law (`leastGroups` of the level 0.95), because the bootstrap draws whole jobs.
 */
export const jobsOf = (run: Run, cpu: string, first: number, count = 5, slow = 30_000): readonly LawJob[] =>
  Array.from({ length: count }, (_, k) => jobOf(run, cpu, first + k, {}, slow));

/** A set of the 99th percentile with a served share and the tail count 10: a point needs 1000 arrivals in each run. */
export const TAIL: LawSet = {
  ...RATE.laws!,
  measures: [{ id: "latency.p99", title: "The 99th percentile of the latency of a request", residual: "relative", forms: FAST_FORMS, served: 0.97, tail: 10 }],
};

/**
 * This function gives five jobs of the plan rate with runs of 1.01 s: each run plans 1.01 times the rate.
 * In the first job, the second run of the rate 1000 plans 999 requests.
 */
export const tailJobs = (): readonly LawJob[] =>
  jobsOf(runOf(1), EPYC, 1).map((job, which) => ({
    ...job,
    records: job.records.map((record) => {
      const rate = record.case.demand.classes[0]!.rate.value;
      const runs = record.runs.map((run, r): RunRecord => {
        const planned = which === 0 && rate === 1000 && r === 1 ? 999 : Math.round(rate * 1.01);
        return { ...run, measures: { ...run.measures, planned: { value: planned, unit: "{request}" } } };
      });
      return { ...record, runs };
    }),
  }));

/** This function gives a floor job with the floor `scale` times a base floor for each measure. */
export const floorOf = (run: Run, cpu: string, scale: number, problems: Timed["verdict"]["problems"] = []): Timed =>
  timedOf("floor", run, cpu, "2026-11-20T05:00:00Z", {
    values: Object.fromEntries(FLOOR_MEASURES.map((name) => [`${name}.floor`, name === "memory" ? 1_000_000 * scale : 0.01 * scale])),
    problems,
  });

/** The plan `overhead` has 8 pairs, from 100 to 8000 requests each second. Each pair has a case of the bare subject and a case of the service subject. */
export const OVERHEAD: Plan = readPlans(fileURLToPath(new URL("../plans/", import.meta.url))).plans.find((each) => each.id === "overhead")!;

/** The overhead law set with the fast forms, for three measures. */
export const OVERHEAD_SET: LawSet = {
  ...OVERHEAD.laws!,
  measures: OVERHEAD.laws!.measures.filter((measure) => ["cpu.request", "memory", "memory.high"].includes(measure.id)).map((measure) => ({ ...measure, forms: FAST_FORMS })),
};

/**
 * This function gives the record of a case of the plan overhead in the job `job`. Each side has the measures of `recordOf`,
 * with its own noise. The service side adds `0.05 + 0.000002 · rate` ms of CPU time to each request and 2 MB of memory.
 * It adds nothing to the highest memory. Thus the overhead of the highest memory is only noise.
 */
export const overheadRecordOf = (value: Case, index: number, job: number, cpu: string): CaseRecord => {
  const record = recordFor(value, index, job, cpu);
  if (value.subject !== "node-http-service") return record;
  const rate = value.demand.classes[0]!.rate.value;
  const plus = (run: RunRecord, measure: "cpu.request" | "memory", amount: number): Quantity | null => {
    const found = run.measures[measure];
    return found === null ? null : { ...found, value: found.value + amount };
  };
  const runs = record.runs.map((run): RunRecord => ({
    ...run,
    measures: { ...run.measures, "cpu.request": plus(run, "cpu.request", 0.05 + 0.000_002 * rate), memory: plus(run, "memory", 2_000_000) },
  }));
  return { ...record, runs };
};

/** This function gives `count` jobs of the plan overhead, each in its own CI run, on one CPU model. */
export const overheadJobsOf = (cpu: string, count = 5): readonly LawJob[] =>
  Array.from({ length: count }, (_, job) => ({
    timed: timedOf("overhead", runOf(40 + job), cpu, `2026-11-22T06:${String(job).padStart(2, "0")}:00Z`),
    records: (OVERHEAD.cases as readonly Case[]).map((value, index) => overheadRecordOf(value, index, job, cpu)),
  }));

export const FLOORS: readonly Timed[] =[floorOf(runOf(10), EPYC, 1), floorOf(runOf(11), "AMD EPYC 9V45 96-Core Processor", 3), floorOf(runOf(12), XEON.replace("6975P-C", "Platinum 8573C"), 2)];
export const OPTIONS = { runs: 40, seed: 1 };
