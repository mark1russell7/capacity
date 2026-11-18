/**
 * Performance and capacity models. A law gives one measure of a subject, for example the CPU time
 * of one request, as a function of its load variables. A workload gives the load: the classes of
 * requests with their rates. The package examines a law and a workload, and it gives the value of
 * a law at a load point, with an interval.
 *
 * An instance type gives the resources of one copy of a service. A limit is a ceiling on one
 * measure, with headroom. The package gives the share of each limit that a value takes.
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
export { SLUG } from "./names.ts";
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
export type {
  AmountCeiling,
  Ceiling,
  Instance,
  InstanceProblem,
  InstanceProblemCode,
  InstanceType,
  Limit,
  LimitProblem,
  LimitProblemCode,
  LimitSet,
  ResourceCeiling,
} from "./instance.ts";
export { INSTANCE_FORMAT, LIMITS_FORMAT, RESOURCE_UNITS } from "./instance.ts";
export { checkInstance, checkLimits, instanceProblems, limitProblems } from "./instance-check.ts";
export type { LimitUse } from "./limit.ts";
export { limitAmount, limitUse, limitUses } from "./limit.ts";
