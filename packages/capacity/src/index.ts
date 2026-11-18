/**
 * Performance and capacity models. A law gives one measure of a subject, for example the CPU time
 * of one request, as a function of its load variables. The package examines a law and gives its
 * value at a load point, with an interval.
 *
 * @packageDocumentation
 */
export type {
  ConditionValue,
  Constant,
  Evidence,
  Fit,
  FitError,
  Form,
  Law,
  LawProblem,
  Loser,
  Measure,
  ProblemCode,
  ResidualKind,
  Run,
  Scale,
  Variable,
} from "./law.ts";
export { DEFAULT_LEVEL, LAW_FORMAT, MAX_VARIABLES, leastCount } from "./law.ts";
export { checkLaw } from "./check.ts";
export type { ConstantInterval, LawValue, LevelOptions, LoadPoint, Range } from "./value.ts";
export { constantIntervals, lawValue } from "./value.ts";
