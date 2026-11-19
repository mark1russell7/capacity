import { mean, median, noiseFloor } from "@mark1russell7/rigor-statistics";
import type { Check, CheckProblem } from "./check.ts";
import { countProblems, lagProblems, medianOf, worstLag } from "./reads.ts";
import type { CaseRecord } from "./record.ts";

/**
 * This count is the A/A pairs of the plan `floor`. It is the fewest values that give a noise floor:
 * the rule of 5 seeds of `noiseFloor` of `@mark1russell7/rigor-statistics`.
 */
export const FLOOR_PAIRS = 5;

/** This number is the count of standard deviations of a noise floor. */
export const FLOOR_K = 2;

/** A floor measure is the name of a measure that gets a noise floor: a measure of the laws. */
export type FloorMeasure =
  | "cpu.request"
  | "memory"
  | "memory.high"
  | "network.rx.request"
  | "network.tx.request"
  | "latency.p50"
  | "latency.p90"
  | "latency.p99";

/** These measures are the measures that get a noise floor, in the order of the summary. */
export const FLOOR_MEASURES: readonly FloorMeasure[] = [
  "cpu.request",
  "memory",
  "memory.high",
  "network.rx.request",
  "network.tx.request",
  "latency.p50",
  "latency.p90",
  "latency.p99",
];

/**
 * These limits are the highest noise floor of each measure that the check accepts. A higher floor
 * tells that the runners became noisier. Then a law cannot see a change of that size.
 *
 * PHASE 1: no limit. The 5 runs of the plan `floor` in CI give the limits before the pull request.
 */
export const FLOOR_LIMITS: Readonly<Record<FloorMeasure, number>> = {
  "cpu.request": Number.POSITIVE_INFINITY,
  memory: Number.POSITIVE_INFINITY,
  "memory.high": Number.POSITIVE_INFINITY,
  "network.rx.request": Number.POSITIVE_INFINITY,
  "network.tx.request": Number.POSITIVE_INFINITY,
  "latency.p50": Number.POSITIVE_INFINITY,
  "latency.p90": Number.POSITIVE_INFINITY,
  "latency.p99": Number.POSITIVE_INFINITY,
};

/** The ids of the two cases of one A/A pair. */
export interface FloorPair {
  readonly a: string;
  readonly b: string;
}

/** This function gives the ids of the cases of the A/A pair `pair`, from 1 to `FLOOR_PAIRS`, in the plan `plans/floor.json`. */
export const floorPair = (pair: number): FloorPair => ({ a: `floor/a${pair}`, b: `floor/b${pair}` });

/**
 * This check is the check of the noise floor. The plan `floor` has `FLOOR_PAIRS` A/A pairs. The two
 * cases of a pair are equal, and each one has its own container. Each case sends the load of `control/base`.
 *
 * - Each run must answer each request with no failure. Its driver must have a lag of `LAG_LIMIT` or less.
 * - The difference of a pair is the median of its case b less the median of its case a.
 * - `<measure>.floor` is the noise floor of the differences: `FLOOR_K` standard deviations. It must be inside its limit of `FLOOR_LIMITS`.
 * - `<measure>.level` is the median of the medians of the cases: the level of the measure at this load.
 * - `<measure>.bias` is the mean of the differences. A bias far from 0 is an effect of the order of the cases.
 * - `lag.max.worst` is the largest lag of the driver in a run.
 *
 * Each measure of `FLOOR_MEASURES` gets these values. A record that is not there, and a run with no
 * read of a measure, are problems. A measure with no read in a pair gets no value.
 */
export const floorCheck: Check = (records) => {
  const find = (id: string): CaseRecord | undefined => records.find((record) => record.case.id === id);
  const problems: CheckProblem[] = [];
  const pairs: { readonly a: CaseRecord; readonly b: CaseRecord }[] = [];
  for (let pair = 1; pair <= FLOOR_PAIRS; pair += 1) {
    const ids = floorPair(pair);
    const a = find(ids.a);
    const b = find(ids.b);
    if (a === undefined) problems.push({ code: "record", path: ids.a, message: `The plan has no record of the case ${ids.a}.` });
    if (b === undefined) problems.push({ code: "record", path: ids.b, message: `The plan has no record of the case ${ids.b}.` });
    if (a !== undefined && b !== undefined) pairs.push({ a, b });
  }
  if (problems.length > 0) return { values: {}, problems };
  const cases = pairs.flatMap(({ a, b }) => [a, b]);
  problems.push(...cases.flatMap((record) => [...countProblems(record), ...lagProblems(record)]));
  const values: Record<string, number> = {};
  for (const name of FLOOR_MEASURES) {
    const differences: number[] = [];
    const levels: number[] = [];
    for (const { a, b } of pairs) {
      const low = medianOf(a, name);
      const high = medianOf(b, name);
      if (typeof low !== "number") problems.push(low);
      if (typeof high !== "number") problems.push(high);
      if (typeof low === "number" && typeof high === "number") {
        differences.push(high - low);
        levels.push(low, high);
      }
    }
    if (differences.length < FLOOR_PAIRS) continue;
    const floor = noiseFloor(differences, { k: FLOOR_K, minimum: FLOOR_PAIRS });
    values[`${name}.floor`] = floor;
    values[`${name}.level`] = median(levels);
    values[`${name}.bias`] = mean(differences);
    const limit = FLOOR_LIMITS[name];
    if (!(floor <= limit)) problems.push({ code: "limit", path: `${name}.floor`, message: `The noise floor of ${name} is ${floor}. Its limit is ${limit}.` });
  }
  const lag = worstLag(cases);
  if (lag !== undefined) values["lag.max.worst"] = lag;
  return { values, problems };
};
