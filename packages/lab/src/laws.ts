import {
  DEFAULT_LEVEL,
  FORMS,
  LAW_FORMAT,
  NAME,
  SLUG,
  checkLaw,
  fitLaw,
  leastCount,
  loadPointOf,
  type ConditionValue,
  type FormRank,
  type Law,
  type Noise,
  type PointLaw,
  type Problem,
  type ResidualKind,
  type Run,
  type Scale,
} from "@mark1russell7/capacity";
import { isRecord } from "@mark1russell7/optional/read";
import { isCanonicalUnit, isQuantity } from "@mark1russell7/quantity";
import { cpuEntry } from "@mark1russell7/rigor-bench";
import { canonicalJson } from "@mark1russell7/rigor-generators";
import { escapeMarkdown } from "@mark1russell7/text";
import type { Case } from "./case.ts";
import { FLOOR_MEASURES, type FloorMeasure } from "./floor.ts";
import { caseValue } from "./reads.ts";
import { CPUSET_MEASURES, LOAD_MEASURES, RECORD_FORMAT, RUN_MEASURES, type CaseRecord } from "./record.ts";
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

/** This function gives the problems of one measure of a law set. */
const measureProblems = (value: unknown, path: string, seen: Set<string>): readonly LawSetProblem[] => {
  const problems: LawSetProblem[] = [];
  const add = (at: string, message: string): void => void problems.push({ code: "laws", path: `${path}${at}`, message });
  if (!isRecord(value)) return [{ code: "laws", path, message: "The measure is not a record." }];
  const { id, title, residual, forms } = value;
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

/** A laws problem code names the part of the input that gave no law. */
export type LawsProblemCode = "plan" | "job" | "cpu" | "case" | "read" | "noise" | "fit" | "law";

/** A laws problem tells why a job gave no point, or why a measure gave no law. `path` names the job or the law. */
export type LawsProblem = Problem<LawsProblemCode>;

/** A fitted law is a law and the rank of each form that competed for it, best first. */
export interface FittedLaw {
  readonly law: Law;
  readonly ranks: readonly FormRank[];
}

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

/** The points of the laws of one CPU model: the records, the value of the variable of each, and the facts that they share. */
interface Points {
  readonly records: readonly CaseRecord[];
  readonly x: readonly number[];
  readonly facts: Facts;
  readonly runs: readonly Run[];
}

/** This function gives the points of one CPU model, or the problems of its cases. */
const pointsOf = (set: LawSet, base: string, jobs: readonly LawJob[]): Points | readonly LawsProblem[] => {
  const problems: LawsProblem[] = [];
  const records: CaseRecord[] = [];
  const x: number[] = [];
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
    }
  }
  if (problems.length > 0) return problems;
  if (first === undefined) return [{ code: "case", path: base, message: "The jobs have no record." }];
  return { records, x, facts: first.facts, runs: uniqueRuns(jobs.flatMap(({ timed }) => (timed.run === null ? [] : [timed.run]))) };
};

/** This function gives the law of one measure from the points of one CPU model, or the problems of the law. */
const lawOf = (set: LawSet, measure: LawMeasure, id: string, points: Points, noise: Noise, options: LawsOptions): FittedLaw | readonly LawsProblem[] => {
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
    conditions: points.facts.conditions,
    form,
    constants,
    replicates,
    fit,
    evidence: { runs: points.runs },
    noise,
  };
  const found = checkLaw(law);
  return found.length > 0 ? found.map((each) => ({ code: "law" as const, path: id, message: `${each.path}: ${each.message}` })) : { law, ranks };
};

/**
 * This function gives the laws of a plan from the records of its jobs. Each CPU model gets one law
 * for each measure of the law set of the plan. The id of a law is `<subject>/<plan>/<cpu>/<measure>`.
 *
 * - **The points:** each record of a job gives one point. The variable comes from the demand of its
 *   case, and the value is the median over its runs (`caseValue`). All points share their subject and conditions.
 * - **The jobs:** a job with no CI run, or with a problem in its verdict, gives no point. A law needs
 *   40 points or more (`leastCount` of the level 0.95), thus two jobs of a plan of 25 cases. A CPU model
 *   with fewer points goes into `skipped`: the runners give random CPU models, thus few points are no read, not a problem.
 * - **The evidence:** the CI runs of the jobs of the CPU model.
 * - **The noise:** the largest floor of the floor jobs on the CPU model. With none, the model with the largest floor.
 * - **The fit:** `fitLaw` of `@mark1russell7/capacity`. The law keeps each form that lost. `checkLaw` examines each law.
 */
export const lawsOf = (plan: { readonly id: string; readonly laws?: LawSet }, jobs: readonly LawJob[], floors: readonly Timed[], options: LawsOptions = {}): Laws => {
  const set = plan.laws;
  if (set === undefined) return { laws: [], skipped: [], problems: [{ code: "plan", path: plan.id, message: `The plan "${plan.id}" has no law set.` }] };
  const skipped: LawsProblem[] = [];
  const problems: LawsProblem[] = [];
  const laws: FittedLaw[] = [];
  const floor = floorJobs(floors, skipped);
  const need = leastCount(DEFAULT_LEVEL);
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
    for (const measure of set.measures) {
      const id = `${base}/${measure.id}`;
      const noise = noiseOf(measure.id, cpu, floor);
      if (typeof noise === "string") {
        problems.push({ code: "noise", path: id, message: noise });
        continue;
      }
      const result = lawOf(set, measure, id, points, noise, options);
      if (isProblems(result)) problems.push(...result);
      else laws.push(result);
    }
  }
  return { laws, skipped, problems };
};

/** This function gives the text of a number with at most 4 significant digits. */
const short = (value: number): string => (Number.isInteger(value) ? String(value) : value.toPrecision(4));

/** This function gives the summary of the laws of a plan as Markdown: a table of the laws, then each problem and each skipped job. */
export const lawsSummaryOf = (plan: string, laws: Laws): string => {
  const lines = [`### The laws of the plan ${escapeMarkdown(plan)}`, ""];
  if (laws.laws.length > 0) {
    lines.push("| Law | Form | Constants | Held-out error | Points | Noise floor |", "| --- | --- | --- | --- | --- | --- |");
    for (const { law, ranks } of laws.laws) {
      const constants = law.constants.map((constant) => `${constant.id} = ${short(constant.value)}`).join(", ");
      const error = ranks[0] === undefined ? "" : `rmse ${short(ranks[0].error.rmse)}`;
      const cells = [law.id, law.form.id, constants, error, String(law.fit.residuals.length), `${short(law.noise.floor)} ${law.measure.unit}`];
      lines.push(`| ${cells.map((cell) => escapeMarkdown(cell)).join(" | ")} |`);
    }
    lines.push("");
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
