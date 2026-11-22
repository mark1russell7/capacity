import type { Problem } from "@mark1russell7/capacity";
import { controlCheck } from "./control.ts";
import { floorCheck } from "./floor.ts";
import { gateCheck } from "./gate.ts";
import { overheadCheck } from "./overhead.ts";
import { rateCheck } from "./rate.ts";
import type { CaseRecord } from "./record.ts";

/** A check problem code names the kind of a problem in the records of a plan. The code `observed` is a fact of a target that the record does not agree with. */
export type CheckProblemCode = "record" | "run" | "read" | "limit" | "observed";

/** A check problem tells what is not correct in the records, and where: `path` names the case and the run. */
export type CheckProblem = Problem<CheckProblemCode>;

/**
 * A verdict is the result of the check of the records of a plan. It has each value that the check
 * read, and each problem. A verdict with no problem passes. A value that the check cannot read is
 * not in `values`, and a problem of the code `read` tells it. Thus a verdict with no read does not pass.
 */
export interface Verdict {
  /** This name is the name of the check of `CHECKS`, or null for a plan with no check. */
  readonly check: string | null;
  readonly values: Readonly<Record<string, number>>;
  readonly problems: readonly CheckProblem[];
}

/** A check judges the records of a plan. It gives the values that it read and each problem. */
export type Check = (records: readonly CaseRecord[]) => Pick<Verdict, "values" | "problems">;

/** These checks are the checks that a plan can name, by their names. */
export const CHECKS: Readonly<Record<string, Check>> = { control: controlCheck, floor: floorCheck, rate: rateCheck, gate: gateCheck, overhead: overheadCheck };

/**
 * This function gives the problems of a record that each plan refuses:
 *
 * - The record has fewer or more runs than its case counts.
 * - The harness did not record a part of a run (`missing`).
 * - A counter went back between the two readings of a run (`resets`). Its measures are null.
 */
export const recordProblems = (record: CaseRecord): readonly CheckProblem[] => {
  const id = record.case.id;
  const problems: CheckProblem[] = [];
  if (record.runs.length !== record.case.runs) {
    problems.push({ code: "record", path: id, message: `The record has ${record.runs.length} runs. Its case counts ${record.case.runs}.` });
  }
  for (const run of record.runs) {
    const path = `${id} run ${run.index}`;
    if (run.missing !== null) problems.push({ code: "run", path, message: `The harness did not record a part of the run: ${run.missing}` });
    if (run.resets.length > 0) problems.push({ code: "run", path, message: `These counters went back in the run: ${run.resets.join(", ")}.` });
  }
  return problems;
};

/**
 * This function gives the verdict of the records of a plan. First it gives the problems of each
 * record (`recordProblems`). Then it gives the values and the problems of the check `check` of `CHECKS`. A plan
 * with no check (`null`) gets only the problems of each record.
 *
 * It throws a `RangeError` for a name that `CHECKS` does not have.
 */
export const verdictOf = (check: string | null, records: readonly CaseRecord[]): Verdict => {
  const own = records.flatMap(recordProblems);
  if (check === null) return { check, values: {}, problems: own };
  const judge = Object.hasOwn(CHECKS, check) ? CHECKS[check] : undefined;
  if (judge === undefined) throw new RangeError(`The lab has no check "${check}". It has ${Object.keys(CHECKS).join(", ")}.`);
  const { values, problems } = judge(records);
  return { check, values, problems: [...own, ...problems] };
};
