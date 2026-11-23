/**
 * This package has the subjects of the measurement: the programs that a run measures, and the
 * request classes that a run sends to them. It also has the cases: each case is one measurement as
 * data. The cell of a case operates it in the lab of `@mark1russell7/harness`, and the record keeps its measures.
 * A plan is a set of cases that one CI job measures, and the check of their records.
 *
 * @packageDocumentation
 */
export { EMPTY, FIELDS, LIMITS, UNITS, classOf, classProblems, pathOf, requestOf, type Field, type RequestClass } from "./subject/class.ts";
export { NODE_HTTP, NODE_HTTP_SERVICE, SUBJECT_FOLDER, packageFiles, subjectFiles, type LabSubject } from "./subjects.ts";
export {
  CASE_FORMAT,
  CASE_LEVELS,
  CASE_RATE,
  CASE_RESOURCES,
  MAX_ARRIVALS,
  MAX_DURATION,
  MAX_RUNS,
  SUBJECTS,
  arrivalsOf,
  caseLevel,
  caseProblems,
  requestClassOf,
  type Case,
  type CaseProblem,
  type CaseProblemCode,
} from "./case.ts";
export {
  LOAD_GRID,
  LOAD_UNITS,
  LOAD_VARIABLE_IDS,
  designCases,
  designProblems,
  gridProblems,
  loadOfCase,
  type GridProblem,
  type GridVariable,
  type LoadDesign,
  type LoadVariableId,
} from "./grid.ts";
export {
  DRAIN,
  READING_PERIOD,
  SUBJECT_PORT,
  cellOf,
  commandOf,
  cpuSetsOf,
  streamArrivals,
  streamsOf,
  subjectOf,
  windowOf,
  type CellOptions,
  type CpuSets,
} from "./cell.ts";
export {
  CPUSET_MEASURES,
  LOAD_MEASURES,
  RECORD_FORMAT,
  RUN_MEASURES,
  cpusetMeasures,
  loadMeasures,
  recordOf,
  runMeasures,
  runRecordOf,
  type CaseRecord,
  type CpusetMeasure,
  type Host,
  type LoadMeasure,
  type Machine,
  type Measures,
  type RunMeasure,
  type RunRecord,
} from "./record.ts";
export { measureCase, type MeasureOptions, type Measurement } from "./measure.ts";
export { CHECKS, recordProblems, verdictOf, type Check, type CheckProblem, type CheckProblemCode, type Verdict } from "./check.ts";
export { CONTROL_CASES, CONTROL_LIMITS, controlCheck, type ControlValue, type Limit } from "./control.ts";
export { FLOOR_K, FLOOR_LIMITS, FLOOR_MEASURES, FLOOR_PAIRS, floorCheck, floorPair, type FloorMeasure, type FloorPair } from "./floor.ts";
export { RATE_LAG_LIMIT, RATE_MEASURES, coresOf, rateCheck, type RateMeasure } from "./rate.ts";
export { OVERHEAD_MEASURES, OVERHEAD_SIDES, overheadCheck, type OverheadMeasure } from "./overhead.ts";
export { LAG_LIMIT, caseValue, countProblems, lagProblems, worstLag } from "./reads.ts";
export {
  CPU_IDS,
  RECORD_CONDITIONS,
  conditionsOf,
  lawSetProblems,
  lawsOf,
  lawsSummaryOf,
  type FittedLaw,
  type LawJob,
  type LawMeasure,
  type Laws,
  type LawSet,
  type LawSetProblem,
  type LawsOptions,
  type LawsProblem,
  type LawsProblemCode,
  type LawVariable,
} from "./laws.ts";
export {
  MAX_JOB_MINUTES,
  MAX_JOBS,
  PLAN_FORMAT,
  PLAN_ID,
  PLAN_TRIGGERS,
  SETUP_MINUTES,
  matrixOf,
  planMinutes,
  planProblems,
  planSwap,
  readPlans,
  selectPlans,
  type MatrixEntry,
  type Plan,
  type PlanFiles,
  type PlanProblem,
  type PlanProblemCode,
  type PlanTrigger,
  type Selection,
} from "./plan.ts";
export {
  MANIFEST,
  TIMED_FORMAT,
  filesOf,
  runOf,
  summaryOf,
  timePlan,
  utcOf,
  type Environment,
  type TimeOptions,
  type Timed,
  type TimedFiles,
} from "./timed.ts";
