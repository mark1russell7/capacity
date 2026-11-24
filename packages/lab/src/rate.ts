import { median } from "@mark1russell7/rigor-statistics";
import type { Check, CheckProblem } from "./check.ts";
import { caseValue, countProblems, lagProblems, worstLag } from "./reads.ts";
import type { CaseRecord } from "./record.ts";

/** A rate measure is the name of a measure that the check `rate` gives for each case. Each one is a measure of a law of the rate. */
export type RateMeasure =
  | "cpu.request"
  | "memory"
  | "memory.high"
  | "latency.p50"
  | "latency.p90"
  | "latency.p99"
  | "lag.max"
  | "cpuset.busy"
  | "cpuset.user"
  | "cpuset.system"
  | "cpuset.irq"
  | "cpuset.softirq"
  | "others.cpuset.busy";

/**
 * These measures are the measures that the check `rate` gives for each case, in the order of the summary. The
 * cpuset measures tell if the CPU of the subject is full, and which work fills it.
 */
export const RATE_MEASURES: readonly RateMeasure[] = [
  "cpu.request",
  "memory",
  "memory.high",
  "latency.p50",
  "latency.p90",
  "latency.p99",
  "lag.max",
  "cpuset.busy",
  "cpuset.user",
  "cpuset.system",
  "cpuset.irq",
  "cpuset.softirq",
  "others.cpuset.busy",
];

/**
 * This time is the most lag of the driver in one run of the plan `rate`, in ms. The plan sends loads up to
 * past the limit of the subject. Thus the driver has more work than in the light plans, and more lag than `LAG_LIMIT`.
 *
 * The limit comes from the 5 jobs of the Lab run 44948617847. The worst lag of each job is 9.909 to 20.383 ms,
 * spread 10.474: 30.857, rounded outward. The worst lag is at `rate/33000`, past the limit of the subject.
 * There, the latency of the run is 329 ms at p50.
 */
export const RATE_LAG_LIMIT: number = 30.9;

/**
 * This function gives the CPU use of a case in cores: the median over its runs of the CPU time over
 * the elapsed time. A run with no read of the CPU time or of the elapsed time gives a problem.
 */
export const coresOf = (record: CaseRecord): number | CheckProblem => {
  const uses: number[] = [];
  for (const run of record.runs) {
    const cpu = run.measures.cpu;
    const elapsed = run.measures.elapsed;
    if (cpu === null || elapsed === null || !(elapsed.value > 0)) {
      return { code: "read", path: `${record.case.id} run ${run.index}`, message: "The run has no read of cpu or of elapsed." };
    }
    uses.push(cpu.value / elapsed.value);
  }
  return uses.length === 0 ? { code: "read", path: record.case.id, message: "The record has no run, thus no read of cpu." } : median(uses);
};

/**
 * This check is the check of the plan `rate`. The cases of the plan send the bare request at a
 * sweep of rates, from a light load to past the limit of one core. The check gives the points of
 * the laws of the request rate, and the problems that make a point void. The plans `size-body`,
 * `size-reply`, `connections`, `inflight`, `block-work` and `block-rate` also use this check, below the limit of the core.
 *
 * - Each run must answer each request with no failure. Its driver must have a lag of `RATE_LAG_LIMIT` or
 *   less, else the driver is not the driver of the 5 runs of the limit.
 * - `<case>.cores` is the CPU use of the case in cores (`coresOf`). At the limit of one core it is near 1.
 * - `<case>.<measure>` is the median over the runs of each measure of `RATE_MEASURES`.
 * - `<case>.cpuset.busy` less `<case>.cores` is the use of the CPU of the subject outside its control group.
 * - `lag.max.worst` is the largest lag of the driver in a run of the plan.
 *
 * A plan with no record, and a run with no read of a measure, are problems.
 */
export const rateCheck: Check = (records) => {
  if (records.length === 0) return { values: {}, problems: [{ code: "record", path: "", message: "The plan has no record." }] };
  const problems: CheckProblem[] = records.flatMap((record) => [...countProblems(record), ...lagProblems(record, RATE_LAG_LIMIT)]);
  const values: Record<string, number> = {};
  const read = (name: string, value: number | CheckProblem): void => {
    if (typeof value === "number") values[name] = value;
    else problems.push(value);
  };
  for (const record of records) {
    const id = record.case.id;
    read(`${id}.cores`, coresOf(record));
    for (const name of RATE_MEASURES) read(`${id}.${name}`, caseValue(record, name));
  }
  const lag = worstLag(records);
  if (lag !== undefined) values["lag.max.worst"] = lag;
  return { values, problems };
};
