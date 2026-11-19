import { valueIn } from "@mark1russell7/quantity";
import { median } from "@mark1russell7/rigor-statistics";
import type { CheckProblem } from "./check.ts";
import type { CaseRecord, LoadMeasure, RunMeasure } from "./record.ts";

/**
 * This time is the most lag of the driver in one run of the plans `control` and `floor`, in ms.
 * These plans send a light load. A run with more lag has latencies of the driver, not of the subject.
 *
 * PHASE 1: no limit. The 5 runs of the plan `floor` in CI give the limit before the pull request.
 */
export const LAG_LIMIT: number = Number.POSITIVE_INFINITY;

/** This function gives the planned requests of one run of a case with uniform arrivals: each rate times the duration. */
const plannedOf = (record: CaseRecord): number =>
  Math.round(record.case.demand.classes.reduce((sum, entry) => sum + valueIn(entry.rate, "{request}/s") * valueIn(record.case.duration, "s"), 0));

/** This function gives the problems of the counts of each run: each planned request has a reply with a status from 200 to 299. */
export const countProblems = (record: CaseRecord): readonly CheckProblem[] => {
  const planned = record.case.arrivals.arrivals === "uniform" ? plannedOf(record) : undefined;
  return record.runs.flatMap((run) => {
    const path = `${record.case.id} run ${run.index}`;
    const count = (name: LoadMeasure): number | undefined => run.measures[name]?.value;
    const problems: CheckProblem[] = [];
    if (planned !== undefined && count("planned") !== planned) {
      problems.push({ code: "run", path, message: `The run planned ${count("planned")} requests. Its case plans ${planned}.` });
    }
    if (count("answered") !== count("planned")) problems.push({ code: "run", path, message: `The run answered ${count("answered")} of ${count("planned")} requests.` });
    for (const name of ["failed", "unsent", "unfinished"] as const) {
      if (count(name) !== 0) problems.push({ code: "run", path, message: `The run has ${count(name)} ${name} requests, not 0.` });
    }
    return problems;
  });
};

/**
 * This function gives the median of a measure over the runs of a record. A run with no read of the
 * measure gives a problem.
 */
export const medianOf = (record: CaseRecord, name: RunMeasure | LoadMeasure): number | CheckProblem => {
  const values: number[] = [];
  for (const run of record.runs) {
    const amount = run.measures[name];
    if (amount === null) return { code: "read", path: `${record.case.id} run ${run.index}`, message: `The run has no read of ${name}.` };
    values.push(amount.value);
  }
  return values.length === 0 ? { code: "read", path: record.case.id, message: `The record has no run, thus no read of ${name}.` } : median(values);
};

/** This function gives the lag of the driver in each run of a record, in ms. A run with no read gives null. */
const lagsOf = (record: CaseRecord): readonly (number | null)[] =>
  record.runs.map((run) => {
    const lag = run.measures["lag.max"];
    return lag === null ? null : valueIn(lag, "ms");
  });

/**
 * This function gives the problems of the lag of the driver in each run of a record. Each run must
 * have a lag of `LAG_LIMIT` or less. A run with no read of the lag is a problem.
 */
export const lagProblems = (record: CaseRecord): readonly CheckProblem[] =>
  lagsOf(record).flatMap((lag, index): CheckProblem[] => {
    const path = `${record.case.id} run ${record.runs[index]?.index ?? index}`;
    if (lag === null) return [{ code: "read", path, message: "The run has no read of lag.max." }];
    return lag <= LAG_LIMIT ? [] : [{ code: "limit", path, message: `The lag of the driver is ${lag} ms. Its limit is ${LAG_LIMIT} ms.` }];
  });

/** This function gives the largest lag of the driver in a run of some records, in ms, or undefined when no run has a read. */
export const worstLag = (records: readonly CaseRecord[]): number | undefined => {
  const lags = records.flatMap(lagsOf).filter((lag): lag is number => lag !== null);
  return lags.length === 0 ? undefined : lags.reduce((most, lag) => Math.max(most, lag), Number.NEGATIVE_INFINITY);
};
