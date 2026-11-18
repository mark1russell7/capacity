/**
 * Performance and capacity models. A law gives one measure of a subject, for example the CPU time
 * of one request, as a function of its load variables. A workload gives the load: the classes of
 * requests with their rates. The package examines a law and a workload, and it gives the value of
 * a law at a load point, with an interval.
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
  Problem,
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
export type {
  Amounts,
  Demand,
  MetricsSource,
  PlanSource,
  Workload,
  WorkloadClass,
  WorkloadProblem,
  WorkloadProblemCode,
  WorkloadSource,
} from "./workload.ts";
export { NO_DEMAND, RATE, WORKLOAD_FORMAT } from "./workload.ts";
export { checkWorkload, demandProblems } from "./workload-check.ts";
export type { ShareOptions } from "./demand.ts";
export { loadPointOf, mergeDemands, scaleDemand, shareOf, totalRate } from "./demand.ts";
export type { Observation, ObservedClass, WorkloadName } from "./observe.ts";
export { observedWorkload } from "./observe.ts";
