import { SLUG, demandProblems, instanceProblems, type Amounts, type Demand, type Instance, type Problem } from "@mark1russell7/capacity";
import { isRecord } from "@mark1russell7/optional/read";
import { convertible, isQuantity, kindOf, valueIn, type Quantity } from "@mark1russell7/quantity";
import type { ScheduleOptions } from "@mark1russell7/rigor-chaos";
import { FIELDS, LIMITS, UNITS, type Field, type RequestClass } from "./subject/class.ts";
import { NODE_HTTP, type LabSubject } from "./subjects.ts";

/** This text is the format of a case file. */
export const CASE_FORMAT = "capacity-case/1";

/** These subjects are the subjects that a case can name, by their names. */
export const SUBJECTS: Readonly<Record<string, LabSubject>> = { [NODE_HTTP.name]: NODE_HTTP };

/**
 * These resources are the resources of an instance that the lab limits, with the unit of each. A
 * container has a CPU quota and a memory limit. The lab has no limit for the network.
 */
export const CASE_RESOURCES: Readonly<Record<string, string>> = { cpu: "{core}", memory: "B" };

/** These levels are the levels of a demand that a subject holds, with the unit of each. `heap` is the live heap of the subject. */
export const CASE_LEVELS: Readonly<Record<string, string>> = { heap: "B" };

/** This unit is the unit of the rate of a class: the driver sends requests. */
export const CASE_RATE = "{request}/s";

/** This number is the most runs that a case can count. */
export const MAX_RUNS = 20;

/** This time is the longest schedule of one run. */
export const MAX_DURATION: Quantity = { value: 600, unit: "s" };

/**
 * A case is one measurement as data: a subject, the resources of its container, and the demand that
 * the driver sends to it. A case file is this record as JSON.
 *
 * The demand is a demand of `@mark1russell7/capacity`. Each class is one stream of the driver, at
 * the rate of the class. The variables of its request are the fields of a request class (`body`,
 * `alloc`, `work`, `wait` and `reply`). A field that the request does not name is 0.
 */
export interface Case {
  readonly format: typeof CASE_FORMAT;
  readonly id: string;
  readonly title: string;
  /** This name is the name of a subject of `SUBJECTS`. */
  readonly subject: string;
  /** This instance gives the CPU and the memory of the container of the subject. */
  readonly instance: Instance;
  readonly demand: Demand;
  /** This time is the time of the schedule of each run. */
  readonly duration: Quantity;
  /** These options select the arrivals of each stream: in equal steps, or a Poisson process with a seed. */
  readonly arrivals: ScheduleOptions;
  /** This count is the runs that the record counts. One warm-up run comes before them. */
  readonly runs: number;
}

/** A case problem code names the part of a case that is not correct. */
export type CaseProblemCode =
  | "shape"
  | "format"
  | "id"
  | "subject"
  | "instance"
  | "demand"
  | "request"
  | "level"
  | "duration"
  | "arrivals"
  | "runs";

/** A case problem tells what is not correct, and where: `path` is the path of the field in the case. */
export type CaseProblem = Problem<CaseProblemCode>;

const problem = (code: CaseProblemCode, path: string, message: string): CaseProblem => ({ code, path, message });

const isField = (name: string): name is Field => (FIELDS as readonly string[]).includes(name);

/**
 * This function gives an amount as a whole number in a unit, or undefined. The factor of a
 * conversion is a binary float, thus a value within one part in 10^9 of a whole number is that number.
 */
const wholeIn = (amount: Quantity, unit: string): number | undefined => {
  const value = valueIn(amount, unit);
  const whole = Math.round(value);
  return Math.abs(value - whole) <= 1e-9 * Math.max(1, Math.abs(value)) ? whole : undefined;
};

/** This function gives the problems of the request of one class: each variable must be a field of a request class. */
const requestProblems = (request: Amounts, path: string): readonly CaseProblem[] =>
  Object.entries(request).flatMap(([name, amount]) => {
    const at = `${path}.${name}`;
    if (!isField(name)) return [problem("request", at, `The lab has no variable "${name}". The variables of a request are ${FIELDS.join(", ")}.`)];
    const unit = UNITS[name];
    if (!isQuantity(amount) || !convertible(amount.unit, unit)) return [problem("request", at, `"${name}" is not an amount in a unit that converts to "${unit}".`)];
    const value = wholeIn(amount, unit);
    if (value === undefined || value < 0 || value > LIMITS[name]) {
      return [problem("request", at, `"${name}" is ${valueIn(amount, unit)} ${unit}. It must be a whole number of ${unit} from 0 to ${LIMITS[name]}.`)];
    }
    return [];
  });

/** This function gives the problems of the instance of a case: a CPU and a memory, and no other resource. */
const resourceProblems = (instance: Instance): readonly CaseProblem[] => {
  const found = instanceProblems(instance).map((each) => problem("instance", `instance.${each.path}`, each.message));
  if (found.length > 0) return found;
  const missing = Object.keys(CASE_RESOURCES)
    .filter((name) => !Object.hasOwn(instance.resources, name))
    .map((name) => problem("instance", `instance.resources.${name}`, `The instance has no "${name}". A case gives the ${name} of its container.`));
  const extra = Object.keys(instance.resources)
    .filter((name) => !Object.hasOwn(CASE_RESOURCES, name))
    .map((name) => problem("instance", `instance.resources.${name}`, `The lab cannot limit "${name}". It limits ${Object.keys(CASE_RESOURCES).join(" and ")}.`));
  return [...missing, ...extra];
};

/** This function gives the problems of the demand of a case: a demand with a class, each class at a rate above 0. */
const caseDemandProblems = (demand: Demand): readonly CaseProblem[] => {
  const found = demandProblems(demand).map((each) => problem("demand", `demand.${each.path}`, each.message));
  if (found.length > 0) return found;
  const problems: CaseProblem[] = [];
  if (demand.classes.length === 0) problems.push(problem("demand", "demand.classes", "The demand has no class. A case sends one class or more."));
  demand.classes.forEach((entry, index) => {
    const path = `demand.classes[${index}]`;
    if (!convertible(entry.rate.unit, CASE_RATE)) {
      problems.push(problem("demand", `${path}.rate`, `The rate of the class "${entry.id}" does not convert to "${CASE_RATE}".`));
    } else if (!(entry.rate.value > 0)) {
      problems.push(problem("demand", `${path}.rate`, `The rate of the class "${entry.id}" is not above 0.`));
    }
    problems.push(...requestProblems(entry.request, `${path}.request`));
  });
  for (const [name, amount] of Object.entries(demand.levels)) {
    const at = `demand.levels.${name}`;
    const unit = Object.hasOwn(CASE_LEVELS, name) ? CASE_LEVELS[name] : undefined;
    if (unit === undefined) {
      problems.push(problem("level", at, `A subject cannot hold the level "${name}". It holds ${Object.keys(CASE_LEVELS).join(", ")}.`));
    } else if (!convertible(amount.unit, unit) || (wholeIn(amount, unit) ?? -1) < 0) {
      problems.push(problem("level", at, `The level "${name}" is not a whole number of ${unit}, 0 or more.`));
    }
  }
  return problems;
};

/** This function gives the problems of the arrivals of a case. */
const arrivalProblems = (arrivals: ScheduleOptions): readonly CaseProblem[] => {
  if (!isRecord(arrivals)) return [problem("arrivals", "arrivals", 'The arrivals are not a record, for example { "arrivals": "uniform" }.')];
  if (arrivals.arrivals === "uniform") return [];
  if (arrivals.arrivals !== "poisson") return [problem("arrivals", "arrivals.arrivals", 'The arrivals are not "uniform" or "poisson".')];
  const { seed } = arrivals;
  return (typeof seed === "string" && seed.length > 0) || (typeof seed === "number" && Number.isInteger(seed))
    ? []
    : [problem("arrivals", "arrivals.seed", "The Poisson arrivals have no seed: a text or a whole number.")];
};

/**
 * This function examines a case and gives each problem that it finds. A case with no problem gives
 * an empty list.
 *
 * It examines the format, the id, the title and the subject. It examines the instance and the
 * demand with `instanceProblems` and `demandProblems` of `@mark1russell7/capacity`. Then it
 * examines what the lab can do: the resources that it limits, the request variables and the levels.
 */
export const caseProblems = (value: Case): readonly CaseProblem[] => {
  if (!isRecord(value)) return [problem("shape", "", "The case is not a record.")];
  const problems: CaseProblem[] = [];
  if (value.format !== CASE_FORMAT) problems.push(problem("format", "format", `The format is not "${CASE_FORMAT}".`));
  if (typeof value.id !== "string" || !SLUG.test(value.id)) {
    problems.push(problem("id", "id", 'The id is not lower-case words joined by ".", "-" or "/".'));
  }
  if (typeof value.title !== "string" || value.title.trim() === "") problems.push(problem("id", "title", "The case has no title."));
  if (typeof value.subject !== "string" || !Object.hasOwn(SUBJECTS, value.subject)) {
    problems.push(problem("subject", "subject", `The subject is not one of ${Object.keys(SUBJECTS).join(", ")}.`));
  }
  problems.push(
    ...(isRecord(value.instance) && isRecord(value.instance.resources)
      ? resourceProblems(value.instance)
      : [problem("shape", "instance", "The instance is not a record with resources.")]),
  );
  problems.push(
    ...(isRecord(value.demand) && Array.isArray(value.demand.classes) && isRecord(value.demand.levels)
      ? caseDemandProblems(value.demand)
      : [problem("shape", "demand", "The demand is not a record with classes and levels.")]),
  );
  const { duration } = value;
  if (!isQuantity(duration) || kindOf(duration.unit) !== "time" || !(duration.value > 0) || valueIn(duration, "s") > valueIn(MAX_DURATION, "s")) {
    problems.push(problem("duration", "duration", `The duration is not a time above 0 and up to ${MAX_DURATION.value} ${MAX_DURATION.unit}.`));
  }
  problems.push(...arrivalProblems(value.arrivals));
  if (!Number.isInteger(value.runs) || value.runs < 1 || value.runs > MAX_RUNS) {
    problems.push(problem("runs", "runs", `The count of runs is not a whole number from 1 to ${MAX_RUNS}.`));
  }
  return problems;
};

/**
 * This function gives the request class of the request of one class of a case. Each field is the
 * amount of its variable, in the unit of the field. A field that the request does not name is 0.
 * The function throws a `RangeError` for a request with a problem.
 */
export const requestClassOf = (request: Amounts): RequestClass => {
  const problems = requestProblems(request, "request");
  if (problems.length > 0) throw new RangeError(problems.map((each) => each.message).join(" "));
  const fields = FIELDS.map((field): [Field, number] => {
    const amount = request[field];
    return [field, amount === undefined ? 0 : (wholeIn(amount, UNITS[field]) ?? 0)];
  });
  return Object.fromEntries(fields) as Record<Field, number> as RequestClass;
};

/** This function gives a level of a case in the unit of the level of `CASE_LEVELS`, or 0 when the demand does not hold it. */
export const caseLevel = (value: Case, name: string): number => {
  const amount = value.demand.levels[name];
  const unit = Object.hasOwn(CASE_LEVELS, name) ? CASE_LEVELS[name] : undefined;
  return amount === undefined || unit === undefined ? 0 : (wholeIn(amount, unit) ?? 0);
};
