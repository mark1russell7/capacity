import type { Quantity } from "@mark1russell7/quantity";
import type { Expr } from "@mark1russell7/vex";

/** This text is the format of a law file. */
export const LAW_FORMAT = "capacity-law/1";

/** This number is the most variables that a law can have. The check reads each corner of their ranges. */
export const MAX_VARIABLES = 8;

/** A scale tells how a variable moves through its range: in equal steps or in equal ratios. */
export type Scale = "linear" | "log";

/**
 * A measure is the quantity that a law gives. Its unit is a canonical unit of
 * `@mark1russell7/quantity`, for example `{core}·ms/{request}` or `MiB`.
 *
 * CPU time is in core-seconds. Thus a request rate times a CPU cost of one request converts to
 * `{core}`. That unit is the unit of the CPU of an instance.
 */
export interface Measure {
  readonly id: string;
  readonly unit: string;
}

/**
 * A variable is one load variable of a law. The law holds from `min` to `max`, in the unit of the
 * variable. A value outside this range is an extrapolation.
 */
export interface Variable {
  readonly id: string;
  readonly unit: string;
  readonly min: number;
  readonly max: number;
  readonly scale: Scale;
}

/** A constant is one fitted number of a law. The program of the form reads it by its `id`. */
export interface Constant {
  readonly id: string;
  readonly value: number;
}

/**
 * A form is the math of a law. Its program is a Vex expression that reads each variable and each
 * constant by its id. Its `id` names the form, for example `hinge`.
 */
export interface Form {
  readonly id: string;
  readonly program: Expr;
}

/** A condition value is a fact that a law holds constant: a name, a number, a flag or an amount with a unit. */
export type ConditionValue = string | number | boolean | Quantity;

/**
 * A residual kind tells how a fit compares a measured value with a law. An absolute residual is
 * their difference. A relative residual is their ratio less 1.
 */
export type ResidualKind = "absolute" | "relative";

/** A fit error sums the residuals of a form: the mean of their sizes, and the root of the mean of their squares. */
export interface FitError {
  readonly mae: number;
  readonly rmse: number;
}

/** A loser is a form that the fit also tried and did not keep, with its error. */
export interface Loser {
  readonly form: string;
  readonly error: FitError;
}

/**
 * A fit tells how well a law agrees with its points. Each residual compares one measured point
 * with a fit that did not use that point. The list `losers` keeps each form that lost.
 */
export interface Fit {
  readonly method: string;
  readonly residual: ResidualKind;
  readonly residuals: readonly number[];
  readonly losers: readonly Loser[];
}

/** A run is one CI run that measured points of a law: its address, its commit and its time. */
export interface Run {
  readonly url: string;
  readonly commit: string;
  readonly date: string;
}

/** The evidence of a law is the list of the runs that measured its points. */
export interface Evidence {
  readonly runs: readonly Run[];
}

/**
 * A law gives one measure of a subject as a function of its load variables. It holds for the
 * ranges of its variables and for its conditions.
 *
 * Each row of `replicates` is one more fit of the constants, in the order of `constants`. The rows
 * come from resamples of the points. Thus the spread of the rows is the doubt of the constants
 * together, and each query gets its interval from them.
 */
export interface Law {
  readonly format: typeof LAW_FORMAT;
  readonly id: string;
  readonly title: string;
  readonly subject: string;
  readonly measure: Measure;
  readonly variables: readonly Variable[];
  readonly conditions: Readonly<Record<string, ConditionValue>>;
  readonly form: Form;
  readonly constants: readonly Constant[];
  readonly replicates: readonly (readonly number[])[];
  readonly fit: Fit;
  readonly evidence: Evidence;
}

/** A problem code names the part of a law, or of a query, that is not correct. */
export type ProblemCode =
  | "shape"
  | "format"
  | "id"
  | "unit"
  | "range"
  | "condition"
  | "program"
  | "read"
  | "constant"
  | "replicates"
  | "value"
  | "fit"
  | "evidence"
  | "point"
  | "level"
  | "knee";

/** A problem tells what is not correct, and where: `path` is the path of the field in the record. */
export interface Problem<Code extends string> {
  readonly code: Code;
  readonly path: string;
  readonly message: string;
}

/** A law problem tells what is not correct in a law, or in a query of a law. */
export type LawProblem = Problem<ProblemCode>;

/** This number is the level of an interval when a query gives none. */
export const DEFAULT_LEVEL = 0.95;

/**
 * This function gives the least count of values that can show an interval of a level. An end of
 * the interval needs one value beyond it. Thus the level 0.95 needs 40 values.
 */
export const leastCount = (level: number): number => Math.ceil(2 / (1 - level) - 1e-9);
