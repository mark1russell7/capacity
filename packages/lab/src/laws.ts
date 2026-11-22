import {
  DEFAULT_LEVEL,
  FORMS,
  LAW_FORMAT,
  NAME,
  SLUG,
  checkLaw,
  constantIntervals,
  fitLaw,
  kneeRuleProblem,
  lawKnee,
  lawValue,
  leastCount,
  leastGroups,
  loadPointOf,
  type ConditionValue,
  type FormRank,
  type Knee,
  type KneeRule,
  type Law,
  type Noise,
  type PointLaw,
  type Problem,
  type ResidualKind,
  type Run,
  type Scale,
} from "@mark1russell7/capacity";
import { isRecord } from "@mark1russell7/optional/read";
import { isCanonicalUnit, isQuantity, valueIn } from "@mark1russell7/quantity";
import { cpuEntry } from "@mark1russell7/rigor-bench";
import { canonicalJson } from "@mark1russell7/rigor-generators";
import { escapeMarkdown } from "@mark1russell7/text";
import type { Case } from "./case.ts";
import { FLOOR_MEASURES, type FloorMeasure } from "./floor.ts";
import { caseValue, runValues } from "./reads.ts";
import { CPUSET_MEASURES, LOAD_MEASURES, QUANTILE_MEASURES, RECORD_FORMAT, RUN_MEASURES, type CaseRecord, type QuantileMeasure } from "./record.ts";
import { isStartCase, type StartCase } from "./start.ts";
import type { Timed } from "./timed.ts";

/**
 * A law measure is one measure of the records that gets a law. The measure must have a noise floor
 * (`FLOOR_MEASURES`), because each law keeps the noise of its measure.
 */
export interface LawMeasure {
  readonly id: FloorMeasure;
  /** This text is the start of the title of each law of the measure, for example "The CPU time of one request". */
  readonly title: string;
  /** This kind tells how the fit compares a measured value with the law. */
  readonly residual: ResidualKind;
  /** These ids name the forms of `FORMS` that compete. With no value, each form of `FORMS` competes. */
  readonly forms?: readonly string[];
  /**
   * This share is the least share of the offered rate that the subject serves at each point of the law,
   * from 0 to 1. A point with a smaller share stays out of the law (`servedShare`). With no value, each point is in the law.
   */
  readonly served?: number;
  /**
   * This count `k` is the least count of requests in the tail of a quantile measure, in each run of each point of the law.
   * A quantile `q` needs `k / (1 − q)` arrivals or more in each run (`tailNeed`). A point with fewer stays out of the law.
   * With no value, each point is in the law.
   */
  readonly tail?: number;
  /** This rule gives the knee of each law of the measure, with `lawKnee` of `@mark1russell7/capacity`. */
  readonly knee?: KneeRule;
}

/** A law variable is the load variable of the laws of a plan: its id, its unit and its scale. The points give its range. */
export interface LawVariable {
  readonly id: string;
  readonly unit: string;
  readonly scale: Scale;
}

/**
 * A law set tells the laws that the records of a plan give: one law for each measure on each CPU
 * model. The field `laws` of a plan holds it.
 *
 * Each case of the plan is a case of load with one class, the class `class`. The demand of each case
 * gives the value of the variable (`loadPointOf`). The records give the conditions of each law. The
 * field `conditions` adds the facts that the records do not hold.
 */
export interface LawSet {
  readonly class: string;
  readonly variable: LawVariable;
  readonly measures: readonly LawMeasure[];
  readonly conditions?: Readonly<Record<string, ConditionValue>>;
}

/**
 * These ids name the CPU models of the runners, for the id of a law. A key is a part of the name of a
 * model (`cpuEntry` of `@mark1russell7/rigor-bench`). A model with no key gets no law. Add a key for it.
 */
export const CPU_IDS: Readonly<Record<string, string | null>> & { readonly other: null } = {
  "EPYC 7763": "epyc-7763",
  "EPYC 9V45": "epyc-9v45",
  "EPYC 9V74": "epyc-9v74",
  "6975P-C": "xeon-6975p-c",
  "8370C": "xeon-8370c",
  "8573C": "xeon-8573c",
  other: null,
};

/** These names are the conditions that come from the records. The conditions of a law set cannot have them. */
export const RECORD_CONDITIONS: readonly string[] = ["class", "cpu.model", "duration", "arrivals", "connections", "connections.size", "harness"];

/** These starts of a name are the conditions of the resources, the request and the levels of a case. */
const CONDITION_STARTS = ["request.", "level."] as const;

/** A law set problem tells what is not correct in the field `laws` of a plan. */
export type LawSetProblem = Problem<"laws">;

/** The units of the measures of a record, by name. */
const UNITS: Readonly<Record<string, string>> = { ...RUN_MEASURES, ...LOAD_MEASURES, ...CPUSET_MEASURES };

const RESIDUALS: readonly ResidualKind[] = ["absolute", "relative"];
const SCALES: readonly Scale[] = ["linear", "log"];

/** This function tells if a value is a condition value: a text, a finite number, a flag or an amount in a canonical unit. */
const isCondition = (value: unknown): value is ConditionValue =>
  typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)) || (isQuantity(value) && isCanonicalUnit(value.unit));

/** This function tells if a condition name is a name that the records give. */
const isRecordCondition = (name: string): boolean =>
  RECORD_CONDITIONS.includes(name) || name.endsWith(".limit") || CONDITION_STARTS.some((start) => name.startsWith(start));

/** This function gives the part of a law that a load point reads, for the variable of a law set. */
const pointLawOf = (id: string, variable: LawVariable): PointLaw => ({ id, variables: [{ id: variable.id, unit: variable.unit }] });

/** This function tells if a measure name is the name of a quantile measure of the driver. */
const isQuantile = (id: string): id is QuantileMeasure => Object.hasOwn(QUANTILE_MEASURES, id);

/**
 * This function gives the least count of arrivals in a run for `tail` requests in the tail of the
 * quantile `level`. The count is `tail / (1 − level)`, up to a whole count. The tail 10 gives 20 for the median, 100 for the level 0.9 and 1000 for the level 0.99.
 */
export const tailNeed = (tail: number, level: number): number => Math.ceil(tail / (1 - level) - 1e-9);

/** This function gives the problems of one measure of a law set. */
const measureProblems =(value: unknown, path: string, seen: Set<string>): readonly LawSetProblem[] => {
  const problems: LawSetProblem[] = [];
  const add = (at: string, message: string): void => void problems.push({ code: "laws", path: `${path}${at}`, message });
  if (!isRecord(value)) return [{ code: "laws", path, message: "The measure is not a record." }];
  const { id, title, residual, forms, served, tail, knee } = value;
  if (typeof id !== "string" || !(FLOOR_MEASURES as readonly string[]).includes(id)) add(".id", `The measure is not one of ${FLOOR_MEASURES.join(", ")}. A law needs the noise floor of its measure.`);
  else if (seen.has(id)) add(".id", `The measure "${id}" is in the set two times.`);
  else seen.add(id);
  if (typeof title !== "string" || title.trim() === "") add(".title", "The measure has no title.");
  if (!(RESIDUALS as readonly unknown[]).includes(residual)) add(".residual", `The residual is not one of ${RESIDUALS.join(", ")}.`);
  if (forms !== undefined) {
    if (!Array.isArray(forms) || forms.length === 0) add(".forms", "The forms are not a list of one form or more.");
    else {
      forms.forEach((form: unknown, index) => {
        if (typeof form !== "string" || !FORMS.some((each) => each.id === form)) add(`.forms[${index}]`, `The form is not one of ${FORMS.map((each) => each.id).join(", ")}.`);
        else if (forms.indexOf(form) !== index) add(`.forms[${index}]`, `The form "${form}" is in the list two times.`);
      });
    }
  }
  if (served !== undefined && !(typeof served === "number" && served > 0 && served < 1)) add(".served", "The served share is not a number above 0 and below 1.");
  if (tail !== undefined) {
    if (!(typeof tail === "number" && Number.isInteger(tail) && tail > 0)) add(".tail", "The tail count is not a whole number above 0.");
    else if (typeof id === "string" && !isQuantile(id)) add(".tail", `The measure "${id}" is not a quantile. Only ${Object.keys(QUANTILE_MEASURES).join(", ")} have a tail.`);
  }
  if (knee !== undefined) {
    const bad = kneeRuleProblem(knee, `${path}.knee`);
    if (bad !== undefined) problems.push({ code: "laws", path: bad.path, message: bad.message });
  }
  return problems;
};

/**
 * This function examines the law set of a plan and gives each problem that it finds. It examines the
 * class, the variable, each measure and the conditions. Each case must be a case of load with one
 * class, the class of the set, and its demand must give the variable. A correct set gives an empty list.
 */
export const lawSetProblems = (laws: unknown, cases: readonly (Case | StartCase)[]): readonly LawSetProblem[] => {
  if (!isRecord(laws)) return [{ code: "laws", path: "laws", message: "The law set is not a record." }];
  const problems: LawSetProblem[] = [];
  const add = (path: string, message: string): void => void problems.push({ code: "laws", path: `laws.${path}`, message });
  const { class: id, variable, measures, conditions } = laws;
  if (typeof id !== "string" || !SLUG.test(id)) add("class", 'The class is not lower-case words joined by ".", "-" or "/".');
  if (!isRecord(variable)) add("variable", "The variable is not a record.");
  else {
    if (typeof variable["id"] !== "string" || !NAME.test(variable["id"])) add("variable.id", "The id of the variable is not a lower-case letter, then letters and digits.");
    if (typeof variable["unit"] !== "string" || !isCanonicalUnit(variable["unit"])) add("variable.unit", "The unit of the variable is not a canonical unit.");
    if (!(SCALES as readonly unknown[]).includes(variable["scale"])) add("variable.scale", `The scale is not one of ${SCALES.join(", ")}.`);
  }
  if (!Array.isArray(measures) || measures.length === 0) add("measures", "The set has no measure. A law set gives a law for one measure or more.");
  else {
    const seen = new Set<string>();
    measures.forEach((value: unknown, index) => problems.push(...measureProblems(value, `laws.measures[${index}]`, seen)));
  }
  if (conditions !== undefined) {
    if (!isRecord(conditions)) add("conditions", "The conditions are not a record.");
    else {
      for (const [name, value] of Object.entries(conditions)) {
        if (!SLUG.test(name)) add(`conditions.${name}`, `The name "${name}" is not lower-case words joined by ".", "-" or "/".`);
        else if (isRecordCondition(name)) add(`conditions.${name}`, `The records give the condition "${name}". The set cannot give it.`);
        if (!isCondition(value)) add(`conditions.${name}`, `The condition "${name}" is not a text, a finite number, a flag or an amount in a canonical unit.`);
      }
    }
  }
  if (problems.length > 0) return problems;
  const set = laws as unknown as LawSet;
  cases.forEach((value, index) => {
    const path = `cases[${index}]`;
    if (isStartCase(value)) return void problems.push({ code: "laws", path, message: `The case "${value.id}" is a start case. A plan with laws has only cases of load.` });
    const classes = value.demand.classes.map((entry) => entry.id);
    if (classes.length !== 1 || classes[0] !== set.class) {
      return void problems.push({ code: "laws", path: `${path}.demand.classes`, message: `The case "${value.id}" has the classes ${classes.join(", ")}. A case of a law set has one class, "${set.class}".` });
    }
    const point = loadPointOf(value.demand, set.class, pointLawOf(value.id, set.variable));
    if (point.tag === "err") problems.push({ code: "laws", path: `${path}.demand`, message: point.error.message });
  });
  return problems;
};

/** A law job is one job of a timed run: its manifest and the records of its cases of load. */
export interface LawJob {
  readonly timed: Timed;
  readonly records: readonly CaseRecord[];
}

/** These options go to `fitLaw`: the count of the bootstrap runs and the seed of each fit. */
export interface LawsOptions {
  readonly runs?: number;
  readonly seed?: number;
}

/** A laws problem code names the part of the input that gave no law, or the law that gave no knee. */
export type LawsProblemCode = "plan" | "job" | "cpu" | "case" | "read" | "noise" | "fit" | "law" | "knee";

/** A laws problem tells why a job gave no point, why a measure gave no law, or why a law gave no knee. `path` names the job or the law. */
export type LawsProblem = Problem<LawsProblemCode>;

/** A cut point is a point that a law leaves out, with its case, its job and the rule that cuts it. */
export type CutPoint = ServedCut | TailCut;

/**
 * A served cut is a point where the subject served too small a share (the field `served` of the measure).
 * It has the largest latency in ms and the least share that the latency gives (`servedShare`).
 */
export interface ServedCut {
  readonly rule: "served";
  readonly case: string;
  readonly job: string;
  readonly max: number;
  readonly served: number;
}

/**
 * A tail cut is a point with a run that has too few arrivals for the tail of the quantile (the field `tail` of the measure).
 * It has the least count of arrivals of its runs, and the count that the quantile needs (`tailNeed`).
 */
export interface TailCut {
  readonly rule: "tail";
  readonly case: string;
  readonly job: string;
  readonly count: number;
  readonly need: number;
}

/**
 * A fitted law is a law and the rank of each form that competed for it, best first. The list `cut`
 * tells each point that the law leaves out. A measure with a knee rule gives the knee of the law.
 */
export interface FittedLaw {
  readonly law: Law;
  readonly ranks: readonly FormRank[];
  readonly cut: readonly CutPoint[];
  readonly knee?: Knee;
}

/**
 * This function gives the least share of the offered rate that the subject served in a case. Each
 * planned time of a request is in the duration `T` of a run, and each reply comes at most `latency.max`
 * after its planned time. Thus the subject served the requests of `T` in `T + latency.max` or less, and
 * the share is `T / (T + latency.max)` or more. The latency is the median over the runs (`caseValue`).
 */
export const servedShare = (record: CaseRecord): number | Problem<"read"> => {
  const max = caseValue(record, "latency.max");
  if (typeof max !== "number") return { code: "read", path: max.path, message: max.message };
  const duration = valueIn(record.case.duration, "ms");
  return duration / (duration + max);
};

/**
 * The laws of a plan are the laws that its records gave. `skipped` tells each job that gave no point,
 * each CPU model with too few points and each floor job that gave no noise. `problems` tells each law
 * that the records did not give.
 */
export interface Laws {
  readonly laws: readonly FittedLaw[];
  readonly skipped: readonly LawsProblem[];
  readonly problems: readonly LawsProblem[];
}

/** This function tells if a result is a list of problems. `Array.isArray` does not narrow a union with a readonly list. */
const isProblems = <T extends object>(value: T | readonly LawsProblem[]): value is readonly LawsProblem[] => Array.isArray(value);

/** This function gives the name of a job: the address of its CI run and its start. */
const jobName = (timed: Timed): string => `${timed.run?.url ?? "a local run"} at ${timed.at.started}`;

/** This function gives the reason that a job of a plan cannot give points, or null for a good job. */
const jobProblem = (plan: string, timed: Timed, records: readonly CaseRecord[]): string | null => {
  if (timed.plan !== plan) return `The job measured the plan "${timed.plan}", not the plan "${plan}".`;
  if (timed.run === null) return "The job has no CI run. The evidence of a law is a CI run.";
  if (timed.machine === null) return "The manifest of the job has no machine.";
  if (timed.verdict.problems.length > 0) return `The verdict of the job has ${timed.verdict.problems.length} problems. A law uses only a job with no problem.`;
  if (records.length === 0) return "The job has no record of a case of load.";
  const cpu = timed.machine.cpu;
  const other = records.find((record) => record.machine.cpu !== cpu);
  if (other !== undefined) return `The record of the case "${other.case.id}" has the CPU model "${other.machine.cpu}", not "${cpu}".`;
  return null;
};

/**
 * This function gives the conditions of a law from one record. They are the class, the CPU model, the
 * limit of each resource of the instance, and the time and the arrivals of each run. The connections
 * and the version of the harness are conditions too. Each amount of the request and each level of the demand, other than
 * the variable, is a condition too.
 */
export const conditionsOf = (record: CaseRecord, set: LawSet): Readonly<Record<string, ConditionValue>> => {
  const value = record.case;
  const conditions: Record<string, ConditionValue> = { class: set.class, "cpu.model": record.machine.cpu };
  for (const [name, amount] of Object.entries(value.instance.resources)) conditions[`${name}.limit`] = amount;
  conditions["duration"] = value.duration;
  conditions["arrivals"] = value.arrivals.arrivals;
  const connections = value.connections ?? { mode: "pipeline" };
  conditions["connections"] = connections.mode;
  if (connections.mode === "pool") conditions["connections.size"] = connections.size;
  if (record.machine.harness !== null) conditions["harness"] = record.machine.harness;
  const request = value.demand.classes.find((entry) => entry.id === set.class)?.request ?? {};
  for (const [name, amount] of Object.entries(request)) if (name !== set.variable.id) conditions[`request.${name}`] = amount;
  for (const [name, amount] of Object.entries(value.demand.levels)) if (name !== set.variable.id) conditions[`level.${name}`] = amount;
  return { ...conditions, ...set.conditions };
};

/** The facts of one record that each point of a law must share: the subject and the conditions. */
interface Facts {
  readonly subject: string;
  readonly conditions: Readonly<Record<string, ConditionValue>>;
}

/** This function gives the names of the facts that differ between two records. */
const differences = (a: Facts, b: Facts): readonly string[] => {
  const names = new Set(["subject", ...Object.keys(a.conditions), ...Object.keys(b.conditions)]);
  const of = (facts: Facts, name: string): string => canonicalJson(name === "subject" ? facts.subject : (facts.conditions[name] ?? null));
  return [...names].filter((name) => of(a, name) !== of(b, name));
};

/** This function gives each run once, in the order of their addresses. */
const uniqueRuns = (runs: readonly Run[]): readonly Run[] => {
  const map = new Map<string, Run>();
  for (const run of runs) if (!map.has(run.url)) map.set(run.url, run);
  return [...map.values()].sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
};

/** A floor job is a job of the plan `floor` with no problem: its CPU model, its run and its values. */
interface FloorJob {
  readonly cpu: string;
  readonly run: Run;
  readonly values: Readonly<Record<string, number>>;
}

/** This function gives the jobs of the check `floor` with no problem. Each other floor job goes into `skipped`. */
const floorJobs = (floors: readonly Timed[], skipped: LawsProblem[]): readonly FloorJob[] => {
  const jobs: FloorJob[] = [];
  for (const timed of floors) {
    if (timed.verdict.check !== "floor") continue;
    const why =
      timed.run === null
        ? "The floor job has no CI run."
        : timed.machine === null
          ? "The manifest of the floor job has no machine."
          : timed.verdict.problems.length > 0
            ? `The verdict of the floor job has ${timed.verdict.problems.length} problems. A noise floor comes only from a job with no problem.`
            : null;
    if (why !== null || timed.run === null || timed.machine === null) skipped.push({ code: "noise", path: jobName(timed), message: why ?? "" });
    else jobs.push({ cpu: timed.machine.cpu, run: timed.run, values: timed.verdict.values });
  }
  return jobs;
};

/**
 * This function gives the noise of a measure on a CPU model. It uses the floor jobs of the same model.
 * With none, it uses the model with the largest floor. The floor is the largest floor of the jobs of the model.
 */
const noiseOf = (measure: FloorMeasure, cpu: string, jobs: readonly FloorJob[]): Noise | string => {
  const name = `${measure}.floor`;
  const usable = jobs.filter((job) => Number.isFinite(job.values[name]));
  if (usable.length === 0) return `No floor job with no problem has a noise floor of ${measure}.`;
  const largest = (cpus: readonly FloorJob[]): number => Math.max(...cpus.map((job) => job.values[name]!));
  const models = [...new Set(usable.map((job) => job.cpu))].map((model) => usable.filter((job) => job.cpu === model));
  const same = models.find((group) => group[0]!.cpu === cpu);
  const chosen = same ?? models.reduce((best, group) => (largest(group) > largest(best) ? group : best));
  return { floor: largest(chosen), cpu: chosen[0]!.cpu, runs: uniqueRuns(chosen.map((job) => job.run)) };
};

/**
 * The points of the laws of one CPU model hold the records and the facts that the records share. They
 * also hold the value of the variable and the job of each record.
 */
interface Points {
  readonly records: readonly CaseRecord[];
  readonly x: readonly number[];
  readonly jobs: readonly Timed[];
  readonly facts: Facts;
}

/** This function gives each CI run of the jobs of some points once. */
const runsOf = (points: Points): readonly Run[] => uniqueRuns(points.jobs.flatMap((timed) => (timed.run === null ? [] : [timed.run])));

/** The points of one measure: the points in the range of the measure, and the points that its rules left out. */
interface RangePoints {
  readonly points: Points;
  readonly cut: readonly CutPoint[];
}

/** This function gives the cut of one point by the rule `served`, nothing, or the problem of its read. */
const servedCut = (least: number, record: CaseRecord, job: string): ServedCut | undefined | Problem<"read"> => {
  const share = servedShare(record);
  if (typeof share !== "number") return share;
  return share >= least ? undefined : { rule: "served", case: record.case.id, job, max: caseValue(record, "latency.max") as number, served: share };
};

/** This function gives the cut of one point by the rule `tail`, nothing, or the problem of its read. The least count of the runs decides. */
const tailCut = (tail: number, level: number, record: CaseRecord, job: string): TailCut | undefined | Problem<"read"> => {
  const counts = runValues(record, "planned");
  if ("code" in counts) return { code: "read", path: counts.path, message: counts.message };
  const count = Math.min(...counts);
  const need = tailNeed(tail, level);
  return count >= need ? undefined : { rule: "tail", case: record.case.id, job, count, need };
};

/**
 * This function gives the points in the range of one measure, or the problems of the reads of its rules.
 * A point stays when no rule cuts it. The list `cut` has each cut of each rule.
 */
const rangeOf = (measure: LawMeasure, id: string, points: Points): RangePoints | readonly LawsProblem[] => {
  const { served, tail } = measure;
  const level = isQuantile(measure.id) ? QUANTILE_MEASURES[measure.id] : undefined;
  const kept: number[] = [];
  const cut: CutPoint[] = [];
  const reads: LawsProblem[] = [];
  points.records.forEach((record, index) => {
    const job = jobName(points.jobs[index]!);
    const found = [served === undefined ? undefined : servedCut(served, record, job), tail === undefined || level === undefined ? undefined : tailCut(tail, level, record, job)];
    let out = false;
    for (const each of found) {
      if (each === undefined) continue;
      if ("code" in each) reads.push({ code: "read", path: id, message: `${each.path}: ${each.message}` });
      else cut.push(each);
      out = true;
    }
    if (!out) kept.push(index);
  });
  if (reads.length > 0) return reads;
  const pick = <T>(list: readonly T[]): T[] => kept.map((index) => list[index]!);
  return { points: { ...points, records: pick(points.records), x: pick(points.x), jobs: pick(points.jobs) }, cut };
};

/** This function gives the text of the rules of the range of a measure, for example "served share 0.97, tail 10". */
const rangeText = (measure: LawMeasure): string =>
  [measure.served === undefined ? [] : [`served share ${measure.served}`], measure.tail === undefined ? [] : [`tail ${measure.tail}`]].flat().join(", ");

/** This function gives the points of one CPU model, or the problems of its cases. */
const pointsOf = (set: LawSet, base: string, jobs: readonly LawJob[]): Points | readonly LawsProblem[] => {
  const problems: LawsProblem[] = [];
  const records: CaseRecord[] = [];
  const x: number[] = [];
  const timeds: Timed[] = [];
  let first: { readonly facts: Facts; readonly id: string } | undefined;
  for (const { timed, records: found } of jobs) {
    for (const record of found) {
      const facts: Facts = { subject: record.case.subject, conditions: conditionsOf(record, set) };
      if (first === undefined) first = { facts, id: record.case.id };
      const changed = differences(first.facts, facts);
      if (changed.length > 0) {
        problems.push({ code: "case", path: base, message: `The case "${record.case.id}" of ${jobName(timed)} differs from the case "${first.id}" in ${changed.join(", ")}.` });
        continue;
      }
      const point = loadPointOf(record.case.demand, set.class, pointLawOf(base, set.variable));
      if (point.tag === "err") {
        problems.push({ code: "case", path: base, message: `The case "${record.case.id}" of ${jobName(timed)}: ${point.error.message}` });
        continue;
      }
      records.push(record);
      x.push(point.value[set.variable.id]!);
      timeds.push(timed);
    }
  }
  if (problems.length > 0) return problems;
  if (first === undefined) return [{ code: "case", path: base, message: "The jobs have no record." }];
  return { records, x, jobs: timeds, facts: first.facts };
};

/**
 * This function gives the law of one measure from its points on one CPU model, or the problems of the
 * law. A measure with a served share gives the condition `served`, and a measure with a tail count gives the condition `tail`.
 */
const lawOf = (set: LawSet, measure: LawMeasure, id: string, range: RangePoints, noise: Noise, options: LawsOptions): FittedLaw | readonly LawsProblem[] => {
  const { points, cut } = range;
  const y: number[] = [];
  const reads: LawsProblem[] = [];
  for (const record of points.records) {
    const value = caseValue(record, measure.id);
    if (typeof value === "number") y.push(value);
    else reads.push({ code: "read", path: id, message: `${value.path}: ${value.message}` });
  }
  if (reads.length > 0) return reads;
  const forms = measure.forms === undefined ? undefined : FORMS.filter((form) => measure.forms?.includes(form.id));
  const fitted = fitLaw(
    { x: points.x, y },
    {
      binding: { variable: set.variable.id },
      residual: measure.residual,
      bootstrapGroups: points.jobs.map(jobName),
      ...(forms === undefined ? {} : { forms }),
      ...(options.runs === undefined ? {} : { runs: options.runs }),
      ...(options.seed === undefined ? {} : { seed: options.seed }),
    },
  );
  if (fitted.tag === "err") return [{ code: "fit", path: id, message: fitted.error }];
  const { form, constants, replicates, fit, ranks } = fitted.value;
  const cpu = points.facts.conditions["cpu.model"];
  const law: Law = {
    format: LAW_FORMAT,
    id,
    title: `${measure.title}, on the CPU ${String(cpu)}`,
    subject: points.facts.subject,
    measure: { id: measure.id, unit: UNITS[measure.id] ?? "" },
    variables: [{ id: set.variable.id, unit: set.variable.unit, min: Math.min(...points.x), max: Math.max(...points.x), scale: set.variable.scale }],
    conditions: {
      ...points.facts.conditions,
      ...(measure.served === undefined ? {} : { served: measure.served }),
      ...(measure.tail === undefined ? {} : { tail: measure.tail }),
    },
    form,
    constants,
    replicates,
    fit,
    evidence: { runs: runsOf(points) },
    noise,
  };
  const found = checkLaw(law);
  return found.length > 0 ? found.map((each) => ({ code: "law" as const, path: id, message: `${each.path}: ${each.message}` })) : { law, ranks, cut };
};

/** This function gives the knee of a fitted law with the knee rule of its measure, or the problem of the search. */
const kneeOf = (set: LawSet, measure: LawMeasure, fitted: FittedLaw): FittedLaw | LawsProblem => {
  if (measure.knee === undefined) return fitted;
  const knee = lawKnee(fitted.law, set.variable.id, measure.knee);
  if (knee.tag === "err") return { code: "knee", path: fitted.law.id, message: `${knee.error.path}: ${knee.error.message}` };
  return { ...fitted, knee: knee.value };
};

/**
 * This function gives the laws of a plan from the records of its jobs. Each CPU model gets one law
 * for each measure of the law set of the plan. The id of a law is `<subject>/<plan>/<cpu>/<measure>`.
 *
 * - **The points:** each record of a job gives one point. The variable comes from the demand of its
 *   case, and the value is the median over its runs (`caseValue`). All points share their subject and conditions.
 * - **The jobs:** a job with no CI run, or with a problem in its verdict, gives no point. A law needs
 *   40 points or more (`leastCount` of the level 0.95). It also needs 5 jobs or more (`leastGroups` of the level 0.95),
 *   because the bootstrap draws whole jobs. A CPU model with fewer points or jobs goes into `skipped`. The runners give
 *   random CPU models, thus few points are no read, not a problem.
 * - **The served share:** a measure with the field `served` keeps only the points where the subject
 *   served that share of the offered rate (`servedShare`). The range of its law is the range of these
 *   points. With fewer than 40 of them, the law goes into `skipped`.
 * - **The tail count:** a quantile measure with the field `tail` keeps only some points. Each run of these points
 *   has enough arrivals for that count of requests in the tail of the quantile (`tailNeed`). A quantile of fewer
 *   arrivals is an estimate of a few slow requests, not of the subject. The cut and the skip are the same as for the served share.
 * - **The evidence:** the CI runs of the jobs of the points.
 * - **The noise:** the largest floor of the floor jobs on the CPU model. With none, the model with the largest floor.
 * - **The fit:** `fitLaw` of `@mark1russell7/capacity`. The law keeps each form that lost. `checkLaw` examines each law.
 *   The bootstrap draws whole jobs, because the plan fixes its rates. The held-out fit holds out whole rates.
 * - **The knee:** a measure with the field `knee` gives the knee of each law in its range (`lawKnee`).
 *   A search that cannot apply gives a problem, and the law stays.
 */
export const lawsOf = (plan: { readonly id: string; readonly laws?: LawSet }, jobs: readonly LawJob[], floors: readonly Timed[], options: LawsOptions = {}): Laws => {
  const set = plan.laws;
  if (set === undefined) return { laws: [], skipped: [], problems: [{ code: "plan", path: plan.id, message: `The plan "${plan.id}" has no law set.` }] };
  const skipped: LawsProblem[] = [];
  const problems: LawsProblem[] = [];
  const laws: FittedLaw[] = [];
  const floor = floorJobs(floors, skipped);
  const need = leastCount(DEFAULT_LEVEL);
  const needJobs = leastGroups(DEFAULT_LEVEL);
  const byCpu = new Map<string, LawJob[]>();
  const ordered = [...jobs].sort((a, b) => (jobName(a.timed) < jobName(b.timed) ? -1 : jobName(a.timed) > jobName(b.timed) ? 1 : 0));
  for (const job of ordered) {
    const records = job.records.filter((record) => record.format === RECORD_FORMAT);
    const why = jobProblem(plan.id, job.timed, records);
    if (why !== null || job.timed.machine === null) {
      skipped.push({ code: "job", path: jobName(job.timed), message: why ?? "" });
      continue;
    }
    const cpu = job.timed.machine.cpu;
    byCpu.set(cpu, [...(byCpu.get(cpu) ?? []), { timed: job.timed, records }]);
  }
  if (byCpu.size === 0) problems.push({ code: "job", path: plan.id, message: `No job of the plan "${plan.id}" gave points.` });
  for (const [cpu, group] of [...byCpu].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const model = cpuEntry(CPU_IDS, cpu).value;
    if (model === null) {
      problems.push({ code: "cpu", path: cpu, message: `The lab has no id for the CPU model "${cpu}". Add a part of its name to CPU_IDS.` });
      continue;
    }
    const subject = group[0]?.records[0]?.case.subject ?? "";
    const base = `${subject}/${plan.id}/${model}`;
    const points = pointsOf(set, base, group);
    if (isProblems(points)) {
      problems.push(...points);
      continue;
    }
    if (points.records.length < need) {
      skipped.push({ code: "case", path: base, message: `The jobs on the CPU model give ${points.records.length} points. A law needs ${need} points or more.` });
      continue;
    }
    if (group.length < needJobs) {
      const message = `The count of jobs on the CPU model is ${group.length}. The bootstrap of a law draws whole jobs, thus a law needs ${needJobs} jobs or more.`;
      skipped.push({ code: "case", path: base, message });
      continue;
    }
    for (const measure of set.measures) {
      const id = `${base}/${measure.id}`;
      const noise = noiseOf(measure.id, cpu, floor);
      if (typeof noise === "string") {
        problems.push({ code: "noise", path: id, message: noise });
        continue;
      }
      const range = rangeOf(measure, id, points);
      if (isProblems(range)) {
        problems.push(...range);
        continue;
      }
      const kept = range.points.records.length;
      if (kept < need) {
        const message = `${kept} of ${points.records.length} points are in the range of the measure (${rangeText(measure)}). A law needs ${need} points or more.`;
        skipped.push({ code: "case", path: id, message });
        continue;
      }
      const result = lawOf(set, measure, id, range, noise, options);
      if (isProblems(result)) {
        problems.push(...result);
        continue;
      }
      const knee = kneeOf(set, measure, result);
      if ("law" in knee) laws.push(knee);
      else {
        laws.push(result);
        problems.push(knee);
      }
    }
  }
  return { laws, skipped, problems };
};

/** This function gives the text of a number with at most 4 significant digits. */
const short = (value: number): string => (Number.isInteger(value) ? String(value) : value.toPrecision(4));

/** This function gives the text of an interval. A null end is past the end of the search. */
const intervalText = (low: number | null, high: number | null): string => {
  const end = (value: number | null): string => (value === null ? "past the end" : short(value));
  return `[${end(low)}, ${end(high)}]`;
};

/** This function gives the text of each constant of a law, with its interval. */
const constantsText = (law: Law): string => {
  const intervals = constantIntervals(law);
  if (intervals.tag === "err") return law.constants.map((constant) => `${constant.id} = ${short(constant.value)}`).join(", ");
  return intervals.value.map((each) => `${each.id} = ${short(each.value)} ${intervalText(each.interval.low, each.interval.high)}`).join(", ");
};

/** This function gives the text of the value of a law at one end of its range, with its interval. */
const endText = (law: Law, load: number): string => {
  const variable = law.variables[0];
  if (variable === undefined) return "";
  const value = lawValue(law, { [variable.id]: load });
  if (value.tag === "err") return value.error.message;
  return `${short(value.value.value)} ${intervalText(value.value.interval.low, value.value.interval.high)} ${law.measure.unit}`;
};

/**
 * This function gives the text of the knee of a law. The text holds the knee, its interval and the floor
 * of the rule `floor`. It also holds the count of replicates with no floor and an edge in the range.
 */
const kneeText = (law: Law, knee: Knee | undefined): string => {
  if (knee === undefined) return "";
  // A rule is data of the plan: its text is the number as the plan gives it.
  const share = knee.rule.kind === "slope" ? `factor ${knee.rule.factor}` : `share ${knee.rule.share}`;
  const rule = `rule ${knee.rule.kind}, ${share}`;
  const found = knee.knee.value === null ? "no knee in the range" : `${short(knee.knee.value)} ${intervalText(knee.knee.interval.low, knee.knee.interval.high)} ${knee.unit}`;
  const floor = knee.floor === undefined ? "" : `, floor ${short(knee.floor.value)} ${law.measure.unit} at ${short(knee.floor.load)}`;
  const noFloor = knee.noFloor === undefined || knee.noFloor === 0 ? "" : `, ${knee.noFloor} replicates with no floor above 0 left out`;
  const edge = knee.edge.value === null ? "" : `, edge at ${short(knee.edge.value)} ${intervalText(knee.edge.interval.low, knee.edge.interval.high)}`;
  return `${found} (${rule}${floor}${noFloor}${edge})`;
};

/** This function adds the list of the points that the rule `rule` cuts from each law, with the text `read` of each cut. */
const cutList = <Rule extends CutPoint["rule"]>(
  lines: string[],
  laws: readonly FittedLaw[],
  rule: Rule,
  title: string,
  read: (point: Extract<CutPoint, { readonly rule: Rule }>) => string,
): void => {
  const each = laws.flatMap(({ law, cut }) => {
    const points = cut.filter((point): point is Extract<CutPoint, { readonly rule: Rule }> => point.rule === rule);
    return points.length === 0 ? [] : [`- ${escapeMarkdown(`${law.id}: ${points.map((point) => `${point.case} (${read(point)}) of ${point.job}`).join("; ")}`)}`];
  });
  if (each.length > 0) lines.push(title, "", ...each, "");
};

/**
 * This function gives the summary of the laws of a plan as Markdown. It gives a table of the laws, with
 * the interval of each constant. A second table gives the range of each law, the values at its ends
 * and its knee, with their intervals. Then it gives each point that a law leaves out, each problem and each skipped job.
 */
export const lawsSummaryOf = (plan: string, laws: Laws): string => {
  const lines = [`### The laws of the plan ${escapeMarkdown(plan)}`, ""];
  const row = (cells: readonly string[]): void => void lines.push(`| ${cells.map((cell) => escapeMarkdown(cell)).join(" | ")} |`);
  if (laws.laws.length > 0) {
    lines.push(`Each interval holds the share ${DEFAULT_LEVEL} of the bootstrap replicates.`, "");
    lines.push("| Law | Form | Constants | Held-out error | Points | Noise floor |", "| --- | --- | --- | --- | --- | --- |");
    for (const { law, ranks } of laws.laws) {
      const error = ranks[0] === undefined ? "" : `rmse ${short(ranks[0].error.rmse)}`;
      row([law.id, law.form.id, constantsText(law), error, String(law.fit.residuals.length), `${short(law.noise.floor)} ${law.measure.unit}`]);
    }
    lines.push("", "| Law | Range | Value at the start | Value at the end | Knee |", "| --- | --- | --- | --- | --- |");
    for (const { law, knee } of laws.laws) {
      const variable = law.variables[0];
      if (variable === undefined) continue;
      row([law.id, `${short(variable.min)} to ${short(variable.max)} ${variable.unit}`, endText(law, variable.min), endText(law, variable.max), kneeText(law, knee)]);
    }
    lines.push("");
    cutList(lines, laws.laws, "served", "The points that a law leaves out, because the subject served a smaller share than the field `served` of the measure:", (point) =>
      `latency.max ${short(point.max)} ms, served ${short(point.served)}`,
    );
    cutList(lines, laws.laws, "tail", "The points that a law leaves out, because a run has fewer arrivals than the field `tail` of the measure needs:", (point) =>
      `${point.count} arrivals, ${point.need} needed`,
    );
  }
  const list = (title: string, items: readonly LawsProblem[]): void => {
    if (items.length === 0) return;
    lines.push(`${title}:`, "", ...items.map((each) => `- ${escapeMarkdown(`${each.path}: ${each.message}`)}`), "");
  };
  list("The problems", laws.problems);
  list("The jobs and the CPU models that gave no law, and the floor jobs that gave no noise", laws.skipped);
  if (laws.laws.length === 0 && laws.problems.length === 0) lines.push("The plan gave no law.", "");
  return `${lines.join("\n")}\n`;
};
