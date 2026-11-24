import { quantity, valueIn, type Quantity } from "@mark1russell7/quantity";
import { median } from "@mark1russell7/rigor-statistics";
import { isIdleCase } from "./case.ts";
import type { Check, CheckProblem } from "./check.ts";
import { jobName, sideOf, type LawJob } from "./laws.ts";
import { OVERHEAD_SIDES } from "./overhead.ts";
import type { CaseRecord, Measures, RunRecord } from "./record.ts";

/**
 * These measures are the idle base of a subject, with the unit of each. They come from the runs of an idle case.
 *
 * - `cpu.rate` is the CPU time of the container over the elapsed time of the run: the cores that the idle process uses.
 * - `memory` is the usage at the end of the run. `memory.high` is the highest reading of the series of the run.
 * - An idle run answers no request. Thus it has no measure for each request.
 */
export const IDLE_MEASURES = { "cpu.rate": "{core}", memory: "B", "memory.high": "B" } as const;

/** An idle measure is the name of a measure of the idle base. */
export type IdleMeasure = keyof typeof IDLE_MEASURES;

/** These names are the idle measures, in the order of `IDLE_MEASURES`. */
const NAMES = Object.keys(IDLE_MEASURES) as IdleMeasure[];

/**
 * The idle base of a subject is the median of each idle measure over the runs of one record of an idle case. A
 * later fit subtracts it from the totals of a record of load of the same subject (`netRequestCpu`).
 */
export interface IdleBase {
  readonly subject: string;
  /** This id is the id of the idle case. */
  readonly case: string;
  /** This count is the runs of the record. */
  readonly runs: number;
  readonly measures: Readonly<Record<IdleMeasure, Quantity>>;
}

/**
 * This function gives the idle measures of one run. The CPU rate is the CPU time over the elapsed time. A run with no
 * read of the CPU time or of the elapsed time, or with no elapsed time, gives null for the CPU rate.
 */
export const idleRunMeasures = (run: RunRecord): Measures<IdleMeasure> => {
  const cpu = run.measures.cpu ?? null;
  const elapsed = run.measures.elapsed ?? null;
  const seconds = elapsed === null ? 0 : valueIn(elapsed, "s");
  return {
    "cpu.rate": cpu === null || !(seconds > 0) ? null : quantity(valueIn(cpu, "{core}·s") / seconds, IDLE_MEASURES["cpu.rate"]),
    memory: run.measures.memory ?? null,
    "memory.high": run.measures["memory.high"] ?? null,
  };
};

/**
 * This function gives the problems of a record of an idle case. The case is idle. Each run sends no request and lasts
 * the hold of the case or more. Each run has a read of each idle measure. A record with no run is a problem.
 */
export const idleProblems = (record: CaseRecord): readonly CheckProblem[] => {
  const id = record.case.id;
  if (!isIdleCase(record.case)) return [{ code: "record", path: id, message: `The case ${id} is not an idle case. An idle base comes only from an idle case.` }];
  if (record.runs.length === 0) return [{ code: "read", path: id, message: "The record has no run, thus no idle base." }];
  const hold = valueIn(record.case.duration, "s");
  return record.runs.flatMap((run) => {
    const path = `${id} run ${run.index}`;
    const problems: CheckProblem[] = [];
    const planned = run.measures.planned?.value ?? 0;
    if (planned > 0) problems.push({ code: "run", path, message: `The run planned ${planned} requests. An idle run sends no request.` });
    const elapsed = run.measures.elapsed ?? null;
    if (elapsed !== null && valueIn(elapsed, "s") < hold) {
      problems.push({ code: "run", path, message: `The run lasted ${valueIn(elapsed, "s")} s, less than the hold of ${hold} s. The harness did not hold the run.` });
    }
    const measures = idleRunMeasures(run);
    for (const name of NAMES) if (measures[name] === null) problems.push({ code: "read", path, message: `The run has no read of ${name}.` });
    return problems;
  });
};

/**
 * This function gives the idle base of a record of an idle case: the median of each idle measure over its runs. A
 * record with a problem of `idleProblems` gives its problems.
 */
export const idleBaseOf = (record: CaseRecord): IdleBase | readonly CheckProblem[] => {
  const problems = idleProblems(record);
  if (problems.length > 0) return problems;
  const runs = record.runs.map(idleRunMeasures);
  const measures = Object.fromEntries(
    NAMES.map((name) => [name, quantity(median(runs.map((each) => (each[name] as Quantity).value)), IDLE_MEASURES[name])]),
  ) as Record<IdleMeasure, Quantity>;
  return { subject: record.case.subject, case: record.case.id, runs: record.runs.length, measures };
};

/**
 * This check is the check of the plan `idle`. Each case of the plan is an idle case.
 *
 * - `<case>.<measure>` is the idle base of the case, for each measure of `IDLE_MEASURES`, in the unit of the measure.
 * - A pair is the cases `<pair>/bare` and `<pair>/service`, as in the plan `overhead`. `<pair>.<measure>.overhead` is the
 *   base of the service side less the base of the bare side. A case with no partner gives no overhead.
 * - A record with a problem of `idleProblems` gives its problems and no value.
 */
export const idleCheck: Check = (records) => {
  const values: Record<string, number> = {};
  const problems: CheckProblem[] = [];
  const bases = new Map<string, IdleBase>();
  for (const record of records) {
    const base = idleBaseOf(record);
    if (Array.isArray(base)) {
      problems.push(...base);
      continue;
    }
    const found = base as IdleBase;
    bases.set(found.case, found);
    for (const name of NAMES) values[`${found.case}.${name}`] = found.measures[name].value;
  }
  for (const [id, service] of bases) {
    const { pair, side } = sideOf(id);
    if (pair === "" || side !== "service") continue;
    const bare = bases.get(`${pair}/bare`);
    if (bare === undefined || bare.subject !== OVERHEAD_SIDES.bare || service.subject !== OVERHEAD_SIDES.service) continue;
    for (const name of NAMES) values[`${pair}.${name}.overhead`] = service.measures[name].value - bare.measures[name].value;
  }
  return { values, problems };
};

/** A job idle base is the idle base of one record of a job. It has the name of the job and the CPU model of the record. */
export interface JobIdleBase extends IdleBase {
  /** This name is the name of the job (`jobName`). */
  readonly job: string;
  readonly cpu: string;
}

/** The idle bases of some jobs, and the problems of the records and the jobs that gave no base. */
export interface IdleBases {
  readonly bases: readonly JobIdleBase[];
  readonly problems: readonly CheckProblem[];
}

/**
 * This function gives the idle base of each record of an idle case in some jobs (`readJobs`), in the order of the jobs.
 * It ignores the records of load. A job with a problem in its verdict gives a problem and no base. Thus a fit reads only
 * the bases of good jobs. The path of each problem starts with the name of its job.
 */
export const idleBasesOf = (jobs: readonly LawJob[]): IdleBases => {
  const bases: JobIdleBase[] = [];
  const problems: CheckProblem[] = [];
  for (const { timed, records } of jobs) {
    const job = jobName(timed);
    const idle = records.filter((record) => isIdleCase(record.case));
    if (idle.length === 0) continue;
    if (timed.verdict.problems.length > 0) {
      problems.push({ code: "record", path: job, message: `The verdict of the job has ${timed.verdict.problems.length} problems. An idle base comes only from a job with no problem.` });
      continue;
    }
    for (const record of idle) {
      const base = idleBaseOf(record);
      if (Array.isArray(base)) problems.push(...base.map((each) => ({ ...each, path: `${job}: ${each.path}` })));
      else bases.push({ ...(base as IdleBase), job, cpu: record.machine.cpu });
    }
  }
  return { bases, problems };
};

/**
 * This function gives the CPU time of one request less the idle base, in each run of a record of load, in
 * `{core}·ms/{request}`. The value of a run is its CPU time less the base CPU rate times its elapsed time, over its answered requests.
 *
 * The CPU time of a request (`cpu.request`) includes the idle CPU time of the run. At a low rate, that part is large. This
 * value removes it. The record and the base must have one subject. Use a base of the same job, or of the same CPU model.
 * An idle record, another subject, and a run with no read or no answered request give a problem.
 */
export const netRequestCpu = (record: CaseRecord, base: IdleBase): readonly number[] | CheckProblem => {
  const id = record.case.id;
  if (isIdleCase(record.case)) return { code: "record", path: id, message: `The case ${id} is an idle case. It has no request.` };
  if (record.case.subject !== base.subject) {
    return { code: "record", path: id, message: `The case ${id} has the subject ${record.case.subject}. The idle base ${base.case} has the subject ${base.subject}.` };
  }
  if (record.runs.length === 0) return { code: "read", path: id, message: "The record has no run, thus no CPU time of a request." };
  const rate = valueIn(base.measures["cpu.rate"], IDLE_MEASURES["cpu.rate"]);
  const values: number[] = [];
  for (const run of record.runs) {
    const path = `${id} run ${run.index}`;
    const cpu = run.measures.cpu ?? null;
    const elapsed = run.measures.elapsed ?? null;
    const answered = run.measures.answered?.value ?? null;
    if (cpu === null || elapsed === null || answered === null) return { code: "read", path, message: "The run has no read of cpu, elapsed or answered." };
    if (answered === 0) return { code: "read", path, message: "The run answered no request." };
    values.push(((valueIn(cpu, "{core}·s") - rate * valueIn(elapsed, "s")) * 1000) / answered);
  }
  return values;
};
