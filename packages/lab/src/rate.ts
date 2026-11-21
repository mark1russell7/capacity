import { median } from "@mark1russell7/rigor-statistics";
import type { Check, CheckProblem } from "./check.ts";
import { caseValue, countProblems, lagProblems } from "./reads.ts";
import type { CaseRecord } from "./record.ts";

/** A rate measure is the name of a measure that the check `rate` gives for each case. Each one is a measure of a law of the rate. */
export type RateMeasure = "cpu.request" | "memory" | "memory.high" | "latency.p50" | "latency.p90" | "latency.p99" | "lag.max";

/** These measures are the measures that the check `rate` gives for each case, in the order of the summary. */
export const RATE_MEASURES: readonly RateMeasure[] = ["cpu.request", "memory", "memory.high", "latency.p50", "latency.p90", "latency.p99", "lag.max"];

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
 * the laws of the request rate, and the problems that make a point void.
 *
 * - Each run must answer each request with no failure. Its driver must have a lag of `LAG_LIMIT` or
 *   less, else the latencies are of the driver.
 * - `<case>.cores` is the CPU use of the case in cores (`coresOf`). At the limit of one core it is near 1.
 * - `<case>.<measure>` is the median over the runs of each measure of `RATE_MEASURES`.
 *
 * A plan with no record, and a run with no read of a measure, are problems.
 */
export const rateCheck: Check = (records) => {
  if (records.length === 0) return { values: {}, problems: [{ code: "record", path: "", message: "The plan has no record." }] };
  const problems: CheckProblem[] = records.flatMap((record) => [...countProblems(record), ...lagProblems(record)]);
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
  return { values, problems };
};
