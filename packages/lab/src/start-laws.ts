/**
 * This module gives the laws of the start cases. Each law gives a start measure over the size of a store, for one arm,
 * one kind of start and one CPU model. The fit, the knee and the examination of each law are the fit of the laws of load (`fitLawFrom`).
 */
import { DEFAULT_LEVEL, SLUG, leastCount, leastGroups, type ConditionValue, type KneeRule, type Noise, type ResidualKind, type Run } from "@mark1russell7/capacity";
import { isRecord } from "@mark1russell7/optional/read";
import { valueIn } from "@mark1russell7/quantity";
import { cpuEntry } from "@mark1russell7/rigor-bench";
import { canonicalHash } from "@mark1russell7/rigor-generators";
import { noiseFloor } from "@mark1russell7/rigor-statistics";
import type { Case } from "./case.ts";
import { FLOOR_K, FLOOR_PAIRS } from "./floor.ts";
import {
  CPU_IDS,
  conditionProblems,
  differences,
  fitFieldProblems,
  fitLawFrom,
  isProblems,
  jobName,
  jobProblem,
  kneeFieldProblems,
  kneeOf,
  uniqueRuns,
  variableProblems,
  type Facts,
  type FittedLaw,
  type LawJob,
  type Laws,
  type LawSetProblem,
  type LawsOptions,
  type LawsProblem,
  type LawVariable,
} from "./laws.ts";
import { START_MEASURES, START_RECORD_FORMAT, type StartMeasure, type StartReading, type StartRecord } from "./start-measure.ts";
import { isStartCase, type StartArm, type StartCase } from "./start.ts";
import type { Timed } from "./timed.ts";

/** A start law measure is one measure of the start readings that gets a law. The A/A pair of the base gives its noise. */
export interface StartLawMeasure {
  readonly id: StartMeasure;
  /** This slug is the last part of the id of each law of the measure, for example `live-peak` for `livePeak`. */
  readonly law: string;
  /** This text is the start of the title of each law of the measure, for example "The peak memory of a start". */
  readonly title: string;
  readonly residual: ResidualKind;
  /** These ids name the forms of `FORMS` that compete. With no value, each form of `FORMS` competes. */
  readonly forms?: readonly string[];
  /** This rule gives the knee of each law of the measure, with `lawKnee` of `@mark1russell7/capacity`. */
  readonly knee?: KneeRule;
}

/**
 * A start law set tells the laws that the start records of a plan give. The field `startLaws` of a plan holds it.
 * The variable is a variable of the subject. The size of its file in each seeded store is the value of the variable.
 */
export interface StartLawSet {
  readonly variable: LawVariable;
  readonly measures: readonly StartLawMeasure[];
  readonly conditions?: Readonly<Record<string, ConditionValue>>;
}

/** A start kind tells if a start opens the store of the seed (`first`) or the store after an earlier start (`second`). */
export type StartKind = "first" | "second";

/**
 * These names are the conditions of a start law that come from the records. The hash `target` holds each fact of the target,
 * and the hash `arm` holds each fact of the arm. The other names show the main facts in plain values.
 */
export const START_CONDITIONS: readonly string[] = ["cpu.model", "node", "image", "memory.limit", "swap.limit", "cpus.limit", "heap.limit", "target", "seeder", "commit", "arm", "start", "watch"];

/** This function gives the problems of one measure of a start law set. `seen` holds the ids and `laws` holds the slugs. */
const startMeasureProblems = (value: unknown, path: string, seen: Set<string>, laws: Set<string>): readonly LawSetProblem[] => {
  if (!isRecord(value)) return [{ code: "laws", path, message: "The measure is not a record." }];
  const problems: LawSetProblem[] = [];
  const add = (at: string, message: string): void => void problems.push({ code: "laws", path: `${path}${at}`, message });
  const { id, law } = value;
  if (typeof id !== "string" || !Object.hasOwn(START_MEASURES, id)) add(".id", `The measure is not one of ${Object.keys(START_MEASURES).join(", ")}.`);
  else if (seen.has(id)) add(".id", `The measure "${id}" is in the set two times.`);
  else seen.add(id);
  if (typeof law !== "string" || !SLUG.test(law)) add(".law", 'The law slug is not lower-case words joined by ".", "-" or "/".');
  else if (laws.has(law)) add(".law", `The law slug "${law}" is in the set two times.`);
  else laws.add(law);
  problems.push(...fitFieldProblems(value, path), ...kneeFieldProblems(value["knee"], path));
  return problems;
};

/**
 * This function examines the start law set of a plan and gives each problem that it finds. Each case must be a start case,
 * and each point of each case must have an amount of the variable. The points of a case have one amount of each other
 * variable. Otherwise a law of the variable also holds the effect of another variable. A correct set gives an empty list.
 */
export const startLawSetProblems = (laws: unknown, cases: readonly (Case | StartCase)[]): readonly LawSetProblem[] => {
  if (!isRecord(laws)) return [{ code: "laws", path: "startLaws", message: "The start law set is not a record." }];
  const problems: LawSetProblem[] = [];
  const { variable, measures, conditions } = laws;
  problems.push(...variableProblems(variable, "startLaws.variable"));
  if (!Array.isArray(measures) || measures.length === 0) {
    problems.push({ code: "laws", path: "startLaws.measures", message: "The set has no measure. A start law set gives a law for one measure or more." });
  } else {
    const seen = new Set<string>();
    const slugs = new Set<string>();
    measures.forEach((value: unknown, index) => problems.push(...startMeasureProblems(value, `startLaws.measures[${index}]`, seen, slugs)));
  }
  problems.push(...conditionProblems(conditions, "startLaws.conditions", (name) => START_CONDITIONS.includes(name)));
  if (problems.length > 0) return problems;
  const id = (variable as LawVariable).id;
  cases.forEach((value, index) => {
    const path = `cases[${index}]`;
    if (!isStartCase(value)) return void problems.push({ code: "laws", path, message: `The case "${value.id}" is a case of load. A plan with start laws has only start cases.` });
    value.points.forEach((point, at) => {
      if (point.at[id] === undefined) problems.push({ code: "laws", path: `${path}.points[${at}].at`, message: `The point "${point.id}" has no amount of the variable "${id}".` });
    });
    const others = new Set(value.points.flatMap((point) => Object.keys(point.at)).filter((name) => name !== id));
    for (const name of others) {
      const amounts = new Set(value.points.map((point) => (point.at[name] === undefined ? "none" : canonicalHash(point.at[name]))));
      if (amounts.size > 1) {
        problems.push({ code: "laws", path: `${path}.points`, message: `The points have more than one amount of the variable "${name}". A start law moves only "${id}", thus each other variable stays at one amount.` });
      }
    }
  });
  return problems;
};

/** This function gives the conditions of a start law from one record, one arm and one kind of start (`START_CONDITIONS`). */
export const startConditionsOf = (record: StartRecord, arm: StartArm, start: StartKind, set: StartLawSet): Readonly<Record<string, ConditionValue>> => {
  const { target } = record.case;
  return {
    "cpu.model": record.machine.cpu,
    node: target.node,
    image: target.image,
    "memory.limit": target.memory,
    "swap.limit": target.swap,
    "cpus.limit": target.cpus,
    "heap.limit": target.heapLimit ?? "none",
    target: canonicalHash(target),
    seeder: record.case.seeder,
    commit: arm.commit,
    arm: canonicalHash(arm),
    start,
    watch: record.case.watch,
    ...set.conditions,
  };
};

/** A start law point is one reading of an arm, with the value of the variable and its job. */
interface StartLawPoint {
  readonly reading: StartReading;
  readonly x: number;
  readonly timed: Timed;
}

/** A start group holds the points of one arm and one kind of start on one CPU model, and the facts that they share. */
interface StartGroup {
  readonly arm: string;
  readonly start: StartKind;
  readonly facts: Facts;
  readonly first: string;
  readonly points: StartLawPoint[];
}

/** An A/A pair is the reading of the base and the reading of its A/A copy, on one point in one round of one job. */
interface AaPair {
  readonly base: StartReading;
  readonly aa: StartReading;
  readonly timed: Timed;
}

/**
 * The start groups of one CPU model hold the group of each arm and kind of start. They also hold the A/A pairs of
 * each kind of start, each failure and each problem of the records.
 */
interface StartGroups {
  readonly groups: readonly StartGroup[];
  readonly pairs: ReadonlyMap<StartKind, readonly AaPair[]>;
  readonly failures: readonly LawsProblem[];
  readonly problems: readonly LawsProblem[];
}

/** This function gives the value of a measure in a reading, in the unit of `START_MEASURES`, or null for a reading with no value. */
const readingValue = (reading: StartReading, measure: StartMeasure): number | null => {
  const amount = reading.measures[measure];
  return amount === null || amount === undefined ? null : valueIn(amount, START_MEASURES[measure]);
};

/**
 * This function gives the noise of a start measure from the A/A pairs of a group. It applies `noiseFloor` of
 * `@mark1russell7/rigor-statistics` to the differences of the A/A copy and the base. It uses `FLOOR_K` and `FLOOR_PAIRS` pairs or more.
 */
const startNoiseOf = (measure: StartMeasure, cpu: string, pairs: readonly AaPair[]): Noise | string => {
  const differences: number[] = [];
  const runs: Run[] = [];
  for (const { base, aa, timed } of pairs) {
    const low = readingValue(base, measure);
    const high = readingValue(aa, measure);
    if (low === null || high === null) continue;
    differences.push(high - low);
    if (timed.run !== null) runs.push(timed.run);
  }
  if (differences.length < FLOOR_PAIRS) return `The A/A pairs of the base give ${differences.length} differences of ${measure}. A noise floor needs ${FLOOR_PAIRS} or more.`;
  return { floor: noiseFloor(differences, { k: FLOOR_K, minimum: FLOOR_PAIRS }), cpu, runs: uniqueRuns(runs) };
};

/** This function gives the groups of the start records of one CPU model, by arm and kind of start, or the problems of the records. */
const groupsOf = (set: StartLawSet, base: string, jobs: readonly { readonly timed: Timed; readonly starts: readonly StartRecord[] }[]): StartGroups => {
  const problems: LawsProblem[] = [];
  const failures: LawsProblem[] = [];
  const groups = new Map<string, StartGroup>();
  const pairs = new Map<StartKind, AaPair[]>();
  for (const { timed, starts } of jobs) {
    const job = jobName(timed);
    for (const record of starts) {
      const kinds = new Map(record.case.points.map((point) => [point.id, point.after === undefined ? ("first" as const) : ("second" as const)]));
      const baseArm = record.case.arms[0]?.id;
      for (const reading of record.readings) {
        const arm = record.case.arms.find((each) => each.id === reading.arm);
        const start = kinds.get(reading.point);
        if (start === undefined) {
          problems.push({ code: "read", path: base, message: `The reading of the arm "${reading.arm}" in ${job} has the point "${reading.point}". The case has no such point.` });
          continue;
        }
        if (arm === undefined) {
          if (reading.arm !== `${baseArm}~aa`) problems.push({ code: "read", path: base, message: `The reading of the point "${reading.point}" in ${job} has the arm "${reading.arm}". The case has no such arm.` });
          continue;
        }
        const key = `${arm.id}/${start}`;
        const facts: Facts = { subject: record.case.subject, conditions: startConditionsOf(record, arm, start, set) };
        const group = groups.get(key) ?? { arm: arm.id, start, facts, first: job, points: [] };
        groups.set(key, group);
        const changed = differences(group.facts, facts);
        if (changed.length > 0) {
          problems.push({ code: "case", path: `${base}/${key}`, message: `The record of ${job} differs from the record of ${group.first} in ${changed.join(", ")}.` });
          continue;
        }
        const casePoint = record.case.points.find((point) => point.id === reading.point);
        const seeded = record.points.find((point) => point.id === reading.point) ?? record.points.find((point) => point.id === casePoint?.after);
        const size = seeded?.sizes[set.variable.id];
        if (size === undefined) {
          problems.push({ code: "read", path: `${base}/${key}`, message: `The store of the point "${reading.point}" in ${job} has no size of the variable "${set.variable.id}".` });
          continue;
        }
        group.points.push({ reading, x: valueIn(size, set.variable.unit), timed });
        if (arm.id === baseArm) {
          const aa = record.readings.find((each) => each.arm === `${baseArm}~aa` && each.point === reading.point && each.round === reading.round);
          if (aa !== undefined) pairs.set(start, [...(pairs.get(start) ?? []), { base: reading, aa, timed }]);
        }
      }
      for (const failure of record.failures) {
        const start = kinds.get(failure.case) ?? "first";
        failures.push({ code: "case", path: `${base}/${failure.arm}/${start}`, message: `The start on the point "${failure.case}" in round ${failure.round} of ${job} failed with the kind ${failure.kind}: ${failure.reason} A failure has no reading.` });
      }
    }
  }
  const sorted = [...groups.values()].sort((a, b) => (a.arm === b.arm ? (a.start < b.start ? -1 : 1) : a.arm < b.arm ? -1 : 1));
  return { groups: sorted, pairs, failures, problems };
};

/**
 * This function gives the laws of a plan from the start records of its jobs. Each CPU model gets one law for each arm, each kind
 * of start and each measure of the start law set. The id of a law is `<subject>/<plan>/<cpu>/<arm>/<start>/<law>`.
 *
 * - **The points:** each reading of an arm gives one point. The variable is the size of its file in the seeded store of the point.
 *   A point with the field `after` is a second start. Its laws are the laws with the start `second`.
 * - **The jobs:** a job with no CI run, or with a problem in its verdict, gives no point. A law needs 40 points or more and
 *   5 jobs or more (`leastCount` and `leastGroups` of the level 0.95), because the bootstrap draws whole jobs.
 * - **The noise:** the A/A pairs of the base on the CPU model and the kind of start give the noise floor of each measure.
 * - **The failures:** a start that passed a limit of the target has no reading. The result tells it in `skipped`.
 * - **The fit and the knee:** the same as for the laws of load (`fitLawFrom`, `kneeOf`).
 */
export const startLawsOf = (plan: { readonly id: string; readonly startLaws?: StartLawSet }, jobs: readonly LawJob[], options: LawsOptions = {}): Laws => {
  const set = plan.startLaws;
  if (set === undefined) return { laws: [], skipped: [], problems: [{ code: "plan", path: plan.id, message: `The plan "${plan.id}" has no start law set.` }], known: [] };
  const skipped: LawsProblem[] = [];
  const problems: LawsProblem[] = [];
  const laws: FittedLaw[] = [];
  const need = leastCount(DEFAULT_LEVEL);
  const needJobs = leastGroups(DEFAULT_LEVEL);
  const byCpu = new Map<string, { readonly timed: Timed; readonly starts: readonly StartRecord[] }[]>();
  const ordered = [...jobs].sort((a, b) => (jobName(a.timed) < jobName(b.timed) ? -1 : jobName(a.timed) > jobName(b.timed) ? 1 : 0));
  for (const job of ordered) {
    const starts = (job.starts ?? []).filter((record) => record.format === START_RECORD_FORMAT);
    const why = jobProblem(plan.id, job.timed, starts, "a start case");
    if (why !== null || job.timed.machine === null) {
      skipped.push({ code: "job", path: jobName(job.timed), message: why ?? "" });
      continue;
    }
    const cpu = job.timed.machine.cpu;
    byCpu.set(cpu, [...(byCpu.get(cpu) ?? []), { timed: job.timed, starts }]);
  }
  if (byCpu.size === 0) problems.push({ code: "job", path: plan.id, message: `No job of the plan "${plan.id}" gave points.` });
  for (const [cpu, group] of [...byCpu].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const model = cpuEntry(CPU_IDS, cpu).value;
    if (model === null) {
      problems.push({ code: "cpu", path: cpu, message: `The lab has no id for the CPU model "${cpu}". Add a part of its name to CPU_IDS.` });
      continue;
    }
    const subject = group[0]?.starts[0]?.case.subject ?? "";
    const base = `${subject}/${plan.id}/${model}`;
    const found = groupsOf(set, base, group);
    skipped.push(...found.failures);
    if (found.problems.length > 0) {
      problems.push(...found.problems);
      continue;
    }
    for (const each of found.groups) {
      const path = `${base}/${each.arm}/${each.start}`;
      const count = new Set(each.points.map((point) => jobName(point.timed))).size;
      if (each.points.length < need) {
        skipped.push({ code: "case", path, message: `The jobs on the CPU model give ${each.points.length} points. A law needs ${need} points or more.` });
        continue;
      }
      if (count < needJobs) {
        skipped.push({ code: "case", path, message: `The count of jobs on the CPU model is ${count}. The bootstrap of a law draws whole jobs, thus a law needs ${needJobs} jobs or more.` });
        continue;
      }
      for (const measure of set.measures) {
        const id = `${path}/${measure.law}`;
        const noise = startNoiseOf(measure.id, cpu, found.pairs.get(each.start) ?? []);
        if (typeof noise === "string") {
          problems.push({ code: "noise", path: id, message: noise });
          continue;
        }
        const y: number[] = [];
        const missing = each.points.filter((point) => {
          const value = readingValue(point.reading, measure.id);
          if (value !== null) y.push(value);
          return value === null;
        });
        if (missing.length > 0) {
          problems.push({ code: "read", path: id, message: `${missing.length} readings have no value of ${measure.id}.` });
          continue;
        }
        const runs = uniqueRuns(each.points.flatMap((point) => (point.timed.run === null ? [] : [point.timed.run])));
        const result = fitLawFrom(
          {
            id,
            title: `${measure.title}, of the arm ${each.arm} at the ${each.start} start, on the CPU ${cpu}`,
            subject: each.facts.subject,
            measure: { id: measure.law, unit: START_MEASURES[measure.id] },
            residual: measure.residual,
            ...(measure.forms === undefined ? {} : { forms: measure.forms }),
            variable: set.variable,
            x: each.points.map((point) => point.x),
            y,
            groups: each.points.map((point) => jobName(point.timed)),
            conditions: each.facts.conditions,
            runs,
            noise,
          },
          options,
        );
        if (isProblems(result)) {
          problems.push(...result);
          continue;
        }
        const fitted: FittedLaw = { ...result, cut: [] };
        const knee = kneeOf(set.variable.id, measure.knee, fitted);
        if ("law" in knee) laws.push(knee);
        else {
          laws.push(fitted);
          problems.push(knee);
        }
      }
    }
  }
  return { laws, skipped, problems, known: [] };
};
