/**
 * This package has the subjects of the measurement: the programs that a run measures, and the
 * request classes that a run sends to them. It also has the cases: each case is one measurement as data.
 *
 * @packageDocumentation
 */
export { EMPTY, FIELDS, LIMITS, UNITS, classOf, classProblems, pathOf, requestOf, type Field, type RequestClass } from "./subject/class.ts";
export { NODE_HTTP, SUBJECT_FOLDER, subjectFiles, type LabSubject } from "./subjects.ts";
export {
  CASE_FORMAT,
  CASE_LEVELS,
  CASE_RESOURCES,
  MAX_DURATION,
  MAX_RUNS,
  SUBJECTS,
  caseLevel,
  caseProblems,
  requestClassOf,
  type Case,
  type CaseProblem,
  type CaseProblemCode,
} from "./case.ts";
