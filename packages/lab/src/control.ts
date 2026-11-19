import type { Check, CheckProblem } from "./check.ts";
import { countProblems, lagProblems, medianOf } from "./reads.ts";
import type { CaseRecord, LoadMeasure, RunMeasure } from "./record.ts";

/** A limit is the lowest and the highest value that a check accepts. */
export interface Limit {
  readonly low: number;
  readonly high: number;
}

/** These ids are the ids of the two cases of the positive control, in the plan `plans/control.json`. */
export const CONTROL_CASES = { base: "control/base", more: "control/more" } as const;

/** A control value is the name of a value of the positive control. */
export type ControlValue = "cpu.request" | "network.tx.request" | "memory" | "latency.p50";

/**
 * These limits are the limits of the positive control. The case `control/more` adds 1 ms of CPU
 * work, a reply of 16 KiB and a live heap of 64 MiB to each request of the case `control/base`.
 *
 * The limits come from 6 runs of `lab.yml` on two CPU models (AMD EPYC 9V74 and Intel Xeon 6975P-C):
 * the run 44448319523 and the 5 runs of 44449842625. Each limit is the worst run less or plus the
 * spread of the runs (the highest value less the lowest value), rounded outward.
 */
export const CONTROL_LIMITS: Readonly<Record<ControlValue, Limit>> = {
  // the changes 0.990243 to 1.024453 ms, spread 0.034210: 0.956033 to 1.058663
  "cpu.request": { low: 0.956, high: 1.059 },
  // the change 16388.198 B in each run, spread 0, rounded to whole bytes. It is more than the reply, 16384 B.
  "network.tx.request": { low: 16_388, high: 16_389 },
  // the changes 65683456 to 70078464 B, spread 4395008: 61288448 to 74473472
  memory: { low: 61_288_448, high: 74_473_472 },
  // the median latency of the second case, 1.224058 to 1.360200 ms, spread 0.136142: 1.087916 to 1.496342. It is more than the work, 1 ms.
  "latency.p50": { low: 1.08, high: 1.5 },
};

/**
 * This check is the check of the positive control. Each run of the two cases must answer each
 * request with no failure. Its driver must have a lag of `LAG_LIMIT` or less. Then each added cost
 * must show in its own measure, inside its limit of `CONTROL_LIMITS`:
 *
 * - `cpu.request`: the change of the median CPU time for each request, from 1 ms of CPU work.
 * - `network.tx.request`: the change of the median bytes out for each request, from 16 KiB more in each reply.
 * - `memory`: the change of the median memory, from 64 MiB of live heap.
 * - `latency.p50`: the median latency of `control/more`. A request with 1 ms of work has its reply 1 ms or more after its time.
 *
 * A record that is not there, and a run with no read of a measure, are problems.
 */
export const controlCheck: Check = (records) => {
  const find = (id: string): CaseRecord | undefined => records.find((record) => record.case.id === id);
  const base = find(CONTROL_CASES.base);
  const more = find(CONTROL_CASES.more);
  const absent = [base === undefined ? CONTROL_CASES.base : [], more === undefined ? CONTROL_CASES.more : []].flat();
  if (base === undefined || more === undefined) {
    return { values: {}, problems: absent.map((id) => ({ code: "record", path: id, message: `The plan has no record of the case ${id}.` })) };
  }
  const problems: CheckProblem[] = [base, more].flatMap((record) => [...countProblems(record), ...lagProblems(record)]);
  const values: Partial<Record<ControlValue, number>> = {};
  const read = (name: ControlValue, value: number | CheckProblem): void => {
    if (typeof value !== "number") {
      problems.push(value);
      return;
    }
    values[name] = value;
    const { low, high } = CONTROL_LIMITS[name];
    if (!(value >= low && value <= high)) problems.push({ code: "limit", path: name, message: `The value ${value} of ${name} is outside its limits ${low} to ${high}.` });
  };
  const change = (name: RunMeasure | LoadMeasure): number | CheckProblem => {
    const high = medianOf(more, name);
    const low = medianOf(base, name);
    if (typeof high !== "number") return high;
    return typeof low === "number" ? high - low : low;
  };
  // 1 ms of CPU work: the CPU time of the process, thus the control group counts it all
  read("cpu.request", change("cpu.request"));
  // 16 KiB more in each reply, and the headers of its packets
  read("network.tx.request", change("network.tx.request"));
  // 64 MiB of live heap: the pages of V8 hold it, with the young generation and fragmentation
  read("memory", change("memory"));
  // a request with 1 ms of CPU work has its reply 1 ms or more after its time
  read("latency.p50", medianOf(more, "latency.p50"));
  return { values, problems };
};
