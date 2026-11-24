import { existsSync, readFileSync } from "node:fs";
import { LIMITS_FORMAT, type Amounts, type LimitSet } from "@mark1russell7/capacity";
import { readLimits } from "@mark1russell7/capacity/schema";
import { isRecord } from "@mark1russell7/optional/read";
import { quantity, valueIn } from "@mark1russell7/quantity";
import { runLimit, type RunLimit } from "@mark1russell7/rigor-bench";
import { canonicalJson } from "@mark1russell7/rigor-generators";
import type { LawJob } from "./laws.ts";
import type { Plan } from "./plan.ts";
import { START_MEASURES, startRecordProblems, type StartMeasure, type StartRecord } from "./start-measure.ts";
import { isStartCase, type StartCase, type StartTarget } from "./start.ts";

/** This text is the format of a start limits file. */
export const START_LIMITS_FORMAT = "capacity-start-limits/1";

/** This count is the fewest CI jobs that give the limits of a start gate. Each job is one CI run of the plan. */
export const START_LIMIT_RUNS = 5;

/** A start limit measure is a measure of a start record that gets a limit, with the id of its limit and its title. */
export interface StartLimitMeasure {
  /** This id is the measure of the limit in each limit set of the file, for example `start.live`. */
  readonly id: string;
  /** This name is the measure of the start reading, for example `live`. */
  readonly reading: StartMeasure;
  readonly unit: string;
  readonly title: string;
}

/**
 * These measures get a limit in each start gate.
 *
 * - `start.live` is the used heap after a full GC at ready.
 * - `start.peak` is the peak of the resident set at ready (VmHWM).
 * - `start.readiness` is the time from the start of the process to the ready signal, less the copy of the store and the
 *   ballasts. The ready probe of a live start measures from the start of the process. Thus it sees this time, and not `ready`.
 */
export const START_LIMIT_MEASURES: readonly StartLimitMeasure[] = [
  { id: "start.live", reading: "live", unit: START_MEASURES.live, title: "The used heap after a full GC at ready" },
  { id: "start.peak", reading: "peak", unit: START_MEASURES.peak, title: "The peak of the resident set at ready (VmHWM)" },
  { id: "start.readiness", reading: "readiness", unit: START_MEASURES.readiness, title: "The time from the start of the process to the ready signal" },
];

/** A start limit run is one CI job of the plan: one runner, one start record. */
export interface StartLimitRun {
  /** This id is `<CI run>/<job>/<attempt>`, or `local/<job>/0` for a job outside CI. */
  readonly id: string;
  /** This URL is the URL of the CI run, or null outside CI. */
  readonly url: string | null;
  /** This text is the number of the job in the matrix of the plan. */
  readonly job: string;
  readonly attempt: number | null;
  /** This name is the CPU model of the runner. */
  readonly cpu: string;
}

/** A start limit derivation is the limit of one measure at one point. It is `runLimit` over the value of each run, in its unit. */
export interface StartLimitDerivation extends RunLimit {
  readonly unit: string;
}

/** A start limit point is one point of the case: its amounts, its limit set and the derivation of each limit. */
export interface StartLimitPoint {
  readonly id: string;
  readonly at: Amounts;
  /** This limit set has the format `capacity-limits/1`. Each limit has an amount ceiling and no headroom. */
  readonly limits: LimitSet;
  /** These derivations give the limit of each measure, by the id of the measure. Their values are in the order of the runs. */
  readonly derivations: Readonly<Record<string, StartLimitDerivation>>;
}

/**
 * A start limits file holds the limits of a start gate. One start case of a plan gives them, from the records of 5 or more
 * CI runs. Each limit is the worst value of the runs plus the spread of the values of the runs.
 */
export interface StartLimits {
  readonly format: typeof START_LIMITS_FORMAT;
  readonly plan: string;
  /** This id is the id of the start case. */
  readonly case: string;
  /** This name is the subject of the case: the id of the contract of the app. */
  readonly subject: string;
  /** This URL is the repository of the app, or null for a subject of the lab. */
  readonly app: string | null;
  /** This id is the first arm of the case. Its children and the children of its A/A copy give the values. */
  readonly arm: string;
  readonly commit: string;
  readonly seeder: string;
  readonly target: StartTarget;
  readonly runs: readonly StartLimitRun[];
  readonly measures: readonly StartLimitMeasure[];
  readonly points: readonly StartLimitPoint[];
}

/** The options of `startLimitsOf`. */
export interface StartLimitsOptions {
  /** This id is the start case. The default is the only start case of the plan. */
  readonly case?: string;
}

/** This function gives the start case of a plan for the limits. It throws an `Error` for a plan with no such case. */
const caseOf = (plan: Plan, id: string | undefined): StartCase => {
  const starts = plan.cases.filter(isStartCase);
  const found = id === undefined ? (starts.length === 1 ? starts[0] : undefined) : starts.find((each) => each.id === id);
  if (found === undefined) {
    const why = id === undefined ? `has ${starts.length} start cases. Give the id of one` : `has no start case "${id}"`;
    throw new Error(`The plan "${plan.id}" ${why}.`);
  }
  return found;
};

/** This function gives the run of a job and its start record. */
const runOf = (job: LawJob, record: StartRecord): StartLimitRun => {
  const url = job.timed.run?.url ?? null;
  const run = url === null ? "local" : (url.split("/").at(-1) ?? url);
  return { id: `${run}/${record.job}/${job.timed.attempt ?? 0}`, url, job: record.job, attempt: job.timed.attempt, cpu: record.machine.cpu };
};

/**
 * This function gives the limits of a start gate from the CI jobs of a plan, with `runLimit` of `@mark1russell7/rigor-bench`.
 * The jobs come from `readJobs`. The function ignores a job of another plan.
 *
 * - The value of a job at a point is the largest reading of the first arm and its A/A copy, over its rounds.
 * - The limit is the worst value of the jobs plus their spread. The function rounds it up to a whole number of its unit.
 *
 * It throws an `Error` for fewer than `START_LIMIT_RUNS` jobs, and for a record of another version of the case.
 * It also throws for a record with a problem, for a child that did not fit the target, and for a job with no value.
 */
export const startLimitsOf = (plan: Plan, jobs: readonly LawJob[], options: StartLimitsOptions = {}): StartLimits => {
  const value = caseOf(plan, options.case);
  const arm = value.arms[0]?.id ?? "";
  const children = new Set([arm, `${arm}~aa`]);
  const read: { readonly run: StartLimitRun; readonly record: StartRecord }[] = [];
  for (const job of jobs.filter((each) => each.timed.plan === plan.id)) {
    for (const record of (job.starts ?? []).filter((each) => each.case.id === value.id)) {
      const run = runOf(job, record);
      if (canonicalJson(record.case) !== canonicalJson(value)) {
        throw new Error(`The record of the run ${run.id} measures another version of the case "${value.id}". The limits come from the case of the plan file.`);
      }
      const problems = startRecordProblems(record);
      if (problems.length > 0) throw new Error(`The record of the run ${run.id} has problems: ${problems.map((each) => `${each.path}: ${each.message}`).join(" ")}`);
      if (record.failures.length > 0) {
        const what = record.failures.map((each) => `${each.arm} on ${each.case}, round ${each.round}: ${each.kind}`).join(", ");
        throw new Error(`In the run ${run.id}, these children did not fit the target: ${what}. A gate holds a start that fits.`);
      }
      if (read.some((each) => each.run.id === run.id)) throw new Error(`The run ${run.id} is in the records two times.`);
      read.push({ run, record });
    }
  }
  read.sort((a, b) => (a.run.id < b.run.id ? -1 : a.run.id > b.run.id ? 1 : 0));
  if (read.length < START_LIMIT_RUNS) throw new Error(`The limits need the records of ${START_LIMIT_RUNS} or more CI runs, and ${read.length} runs have a record of "${value.id}".`);
  const points = value.points.map((point): StartLimitPoint => {
    const derivations = Object.fromEntries(
      START_LIMIT_MEASURES.map((measure): [string, StartLimitDerivation] => {
        const values = read.map(({ run, record }) => {
          const each = record.readings.filter((reading) => reading.point === point.id && children.has(reading.arm)).map((reading) => reading.measures[measure.reading]);
          if (each.length === 0 || each.some((amount) => amount === null)) throw new Error(`The run ${run.id} has no reading of ${measure.reading} at the point "${point.id}".`);
          return Math.max(...each.map((amount) => valueIn(amount!, measure.unit)));
        });
        return [measure.id, { ...runLimit(values, { minimum: START_LIMIT_RUNS, digits: 0 }), unit: measure.unit }];
      }),
    );
    const limits: LimitSet = {
      format: LIMITS_FORMAT,
      id: `${value.id}/${point.id}`,
      title: `The start limits of ${value.subject} at the point ${point.id} of ${value.id}`,
      limits: START_LIMIT_MEASURES.map((measure) => ({
        id: measure.id,
        measure: measure.id,
        ceiling: { kind: "amount", amount: quantity(derivations[measure.id]!.limit, measure.unit) },
        headroom: 0,
      })),
    };
    return { id: point.id, at: point.at, limits, derivations };
  });
  return {
    format: START_LIMITS_FORMAT,
    plan: plan.id,
    case: value.id,
    subject: value.subject,
    app: value.app ?? null,
    arm,
    commit: value.arms[0]?.commit ?? "",
    seeder: value.seeder,
    target: value.target,
    runs: read.map((each) => each.run),
    measures: START_LIMIT_MEASURES,
    points,
  };
};

/**
 * This function reads a start limits file. It examines the format and the limit set of each point with `readLimits` of
 * `@mark1russell7/capacity`. It gives undefined when the file does not exist, and it throws an `Error` for a file with a problem.
 */
export const readStartLimits = (file: string): StartLimits | undefined => {
  if (!existsSync(file)) return undefined;
  const found: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!isRecord(found) || found["format"] !== START_LIMITS_FORMAT || !Array.isArray(found["points"])) {
    throw new Error(`The file ${file} is not a file of start limits of the format "${START_LIMITS_FORMAT}".`);
  }
  for (const point of found["points"] as readonly unknown[]) {
    const set = readLimits(isRecord(point) ? point["limits"] : undefined);
    if (set.tag === "err") throw new Error(`The file ${file} has a limit set with problems: ${set.error.map((each) => `${each.path}: ${each.message}`).join(" ")}`);
  }
  return found as unknown as StartLimits;
};

/** This function gives the summary of start limits: one line for each limit, with its worst value and its spread. */
export const startLimitsSummaryOf = (limits: StartLimits): string => {
  const lines = [`The limits of ${limits.case} on ${limits.commit.slice(0, 7)} come from ${limits.runs.length} runs.`];
  for (const point of limits.points) {
    for (const measure of limits.measures) {
      const each = point.derivations[measure.id];
      if (each !== undefined) lines.push(`- ${point.id} ${measure.id}: ${each.limit} ${each.unit}, the worst value ${each.worst} plus the spread ${each.spread}.`);
    }
  }
  return `${lines.join("\n")}\n`;
};
