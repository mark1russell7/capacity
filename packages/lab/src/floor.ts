import { mean, median, noiseFloor } from "@mark1russell7/rigor-statistics";
import type { Check, CheckProblem } from "./check.ts";
import { caseValue, countProblems, lagProblems, worstLag } from "./reads.ts";
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
 * The limits come from the 5 runs of the plan `floor` in the Lab run 44467543161, on four CPU models
 * (AMD EPYC 9V45 and 9V74, Intel Xeon 6975P-C and Xeon Platinum 8573C). Each limit is the worst
 * floor plus the spread of the floors (the highest less the lowest), rounded outward.
 */
export const FLOOR_LIMITS: Readonly<Record<FloorMeasure, number>> = {
  // the floors 0.011546 to 0.079390 ms, spread 0.067844: 0.147233
  "cpu.request": 0.148,
  // the floors 1137509 to 1414011 B, spread 276503: 1690514
  memory: 1_690_514,
  // the floors 1011498 to 1333040 B, spread 321542: 1654582.02
  "memory.high": 1_654_583,
  // the floors 0 to 0.096191 B, spread 0.096191: 0.192383. Two runs have the floor 0.
  "network.rx.request": 0.193,
  // the floor 0 in each run: each of the 50 cases sends 165.132 B for each request. Thus a floor above 0 is a change.
  "network.tx.request": 0,
  // the floors 0.021488 to 0.115659 ms, spread 0.094171: 0.209829
  "latency.p50": 0.21,
  // the floors 0.023403 to 0.364098 ms, spread 0.340695: 0.704793
  "latency.p90": 0.705,
  // the floors 0.116415 to 1.709008 ms, spread 1.592593: 3.301601
  "latency.p99": 3.302,
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
      const low = caseValue(a, name);
      const high = caseValue(b, name);
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
