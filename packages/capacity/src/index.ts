/**
 * Performance and capacity models. A law gives one measure of a subject, for example the CPU time
 * of one request, as a function of its load variables. A workload gives the load: the classes of
 * requests with their rates. The package examines a law and a workload, and it gives the value of
 * a law at a load point, with an interval. The catalog of forms gives the math of a law as data,
 * with its slope and the start values of its fit. The knee of a law is the first load where its
 * cost starts to grow fast. Its edge is the first load with no value.
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
  Noise,
  Problem,
  ProblemCode,
  ResidualKind,
  Run,
  Scale,
  Variable,
} from "./law.ts";
export { DEFAULT_LEVEL, LAW_FORMAT, MAX_VARIABLES, bootstrapDraws, leastCount, leastGroups } from "./law.ts";
export { NAME, SLUG } from "./names.ts";
export { checkLaw } from "./check.ts";
export type { Binding, Bounds, CatalogForm, Grid, Points, Shape, Start, Term } from "./forms.ts";
export {
  FORMS,
  FORM_VARIABLE,
  catalogForm,
  constantIdsOf,
  formOf,
  formSlopes,
  formValues,
  gridOf,
  programOf,
  separableOf,
  slopeOf,
  startOf,
} from "./forms.ts";
export type { FormRank, LawFit, LawFitOptions } from "./fit.ts";
export { fitLaw } from "./fit.ts";
export type { ConstantInterval, LawValue, LevelOptions, LoadPoint, Range } from "./value.ts";
export { constantIntervals, lawValue } from "./value.ts";
export type { Crossing, Floor, Knee, KneeOptions, KneeRule, OpenRange, Reach } from "./knee.ts";
export { KNEE_STEPS, kneeRuleProblem, lawKnee, lawReach } from "./knee.ts";
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
export type { Load, PointLaw, PointOptions, ShareOptions } from "./demand.ts";
export { instancePointOf, loadPointOf, mergeDemands, scaleDemand, shareOf, totalRate } from "./demand.ts";
export type {
  Catalog,
  Composition,
  CompositionOptions,
  CompositionProblem,
  CompositionProblemCode,
  CompositionTerm,
  CompositionValue,
  LawPart,
  LawTerm,
  NestedPart,
  NestedTerm,
  Over,
  PartValue,
} from "./composition.ts";
export { COMPOSITION_FORMAT, checkComposition, compositionValue, isLawTerm } from "./composition.ts";
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
