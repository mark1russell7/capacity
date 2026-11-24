import { valueIn } from "@mark1russell7/quantity";
import { median } from "@mark1russell7/rigor-statistics";
import { arrivalsOf } from "./case.ts";
import type { CheckProblem } from "./check.ts";
import { LOOP_MEASURES, type CaseRecord, type CpusetMeasure, type LoadMeasure, type LoopMeasure, type RunMeasure } from "./record.ts";

/**
 * This time is the most lag of the driver in one run of the plans `control` and `floor`, in ms.
 * These plans send a light load. A run with more lag has latencies of the driver, not of the subject.
 *
 * The limit comes from 27 jobs of `lab.yml` on five CPU models. The jobs are the 22 runs of the plan
 * `control` from 44448319523 to 44892024907, and the 5 runs of the plan `floor` in 44467543161.
 * The worst lag of each job is 0.626 to 10.004 ms, spread 9.379: 19.383, rounded outward.
 */
export const LAG_LIMIT: number = 19.4;

/**
 * This function gives the problems of the counts of each run: each planned request has a reply with a status from 200 to 299.
 * With uniform arrivals, each run plans the arrivals of its case (`arrivalsOf`).
 */
export const countProblems = (record: CaseRecord): readonly CheckProblem[] => {
  const planned = record.case.arrivals.arrivals === "uniform" ? arrivalsOf(record.case) : undefined;
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
 * This function gives the value of a measure in each run of a record. A run with no read of the
 * measure gives a problem, and a record with no run gives a problem.
 */
export const runValues = (record: CaseRecord, name: RunMeasure | LoadMeasure | CpusetMeasure | LoopMeasure): readonly number[] | CheckProblem => {
  const values: number[] = [];
  for (const run of record.runs) {
    // a record of an older lab has no key for a newer measure
    const amount = run.measures[name] ?? null;
    if (amount === null) return { code: "read", path: `${record.case.id} run ${run.index}`, message: `The run has no read of ${name}.` };
    values.push(amount.value);
  }
  return values.length === 0 ? { code: "read", path: record.case.id, message: `The record has no run, thus no read of ${name}.` } : values;
};

/**
 * This function tells if the lab of a record gives a measure. A lab before CAP-68 gives no loop measures, thus its records
 * have no key for them. The checks skip such a measure, with no problem. A key with the value null is a run with no read.
 */
export const measured = (record: CaseRecord, name: string): boolean =>
  !Object.hasOwn(LOOP_MEASURES, name) || record.runs.some((run) => Object.hasOwn(run.measures, name));

/**
 * This function gives the value of a measure for a case: the median over the runs of its record. A run
 * with no read of the measure gives a problem.
 */
export const caseValue = (record: CaseRecord, name: RunMeasure | LoadMeasure | CpusetMeasure | LoopMeasure): number | CheckProblem => {
  const values = runValues(record, name);
  return "code" in values ? values : median(values);
};

/** This function gives the lag of the driver in each run of a record, in ms. A run with no read gives null. */
const lagsOf = (record: CaseRecord): readonly (number | null)[] =>
  record.runs.map((run) => {
    const lag = run.measures["lag.max"];
    return lag === null ? null : valueIn(lag, "ms");
  });

/**
 * This function gives the problems of the lag of the driver in each run of a record. Each run must
 * have a lag of `limit` or less, in ms. The default is `LAG_LIMIT`. A run with no read of the lag is a problem.
 */
export const lagProblems = (record: CaseRecord, limit: number = LAG_LIMIT): readonly CheckProblem[] =>
  lagsOf(record).flatMap((lag, index): CheckProblem[] => {
    const path = `${record.case.id} run ${record.runs[index]?.index ?? index}`;
    if (lag === null) return [{ code: "read", path, message: "The run has no read of lag.max." }];
    return lag <= limit ? [] : [{ code: "limit", path, message: `The lag of the driver is ${lag} ms. Its limit is ${limit} ms.` }];
  });

/** This function gives the largest lag of the driver in a run of some records, in ms, or undefined when no run has a read. */
export const worstLag = (records: readonly CaseRecord[]): number | undefined => {
  const lags = records.flatMap(lagsOf).filter((lag): lag is number => lag !== null);
  return lags.length === 0 ? undefined : lags.reduce((most, lag) => Math.max(most, lag), Number.NEGATIVE_INFINITY);
};
