import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Problem } from "@mark1russell7/capacity";
import { isRecord } from "@mark1russell7/optional/read";
import { valueIn } from "@mark1russell7/quantity";
import { errorMessage } from "@mark1russell7/text";
import { caseProblems, type Case } from "./case.ts";
import { windowOf } from "./cell.ts";
import { CHECKS } from "./check.ts";
import { lawSetProblems, type LawSet } from "./laws.ts";
import { isStartCase, startCaseProblems, startWindowOf, type StartCase } from "./start.ts";

/** This text is the format of a plan file. */
export const PLAN_FORMAT = "capacity-plan/1";

/**
 * These triggers are the events that start a plan with no selection by hand. A dispatch by hand can
 * start each plan by its id.
 *
 * - `pull_request`: a pull request that changes a law or a subject, and a push of such a change to the default branch.
 * - `schedule`: the timed runs of each night.
 */
export const PLAN_TRIGGERS = ["pull_request", "schedule"] as const;

/** A plan trigger is the name of an event that starts a plan. */
export type PlanTrigger = (typeof PLAN_TRIGGERS)[number];

/** This id rule is the rule of a plan id: lower-case words joined by `-`. The id is the name of its file, and a part of the name of an artifact. */
export const PLAN_ID: RegExp = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** This time is the margin of a job for its setup: the checkout, the install and the build of the image of the harness. */
export const SETUP_MINUTES = 20;

/** This time is the longest job of a runner of GitHub. A plan that needs more is too large for one job. */
export const MAX_JOB_MINUTES = 360;

/** This count is the most jobs of one matrix of GitHub. */
export const MAX_JOBS = 256;

/**
 * A plan is a set of cases that one job measures on one runner, and the check of their records. A
 * plan file is this record as JSON, in the folder `plans`, with the id of the plan as its name.
 *
 * The cases of one plan share one runner, thus one CPU model. Thus a check can compare two cases of
 * a plan, and the points of a law come from one machine. A case is a case of load (`capacity-case/1`)
 * or a start case (`capacity-start/1`). A check judges only the cases of load.
 *
 * The field `laws` tells the laws that the records of the plan give (`lawsOf`). A plan with no law set gives no law.
 */
export interface Plan {
  readonly format: typeof PLAN_FORMAT;
  readonly id: string;
  readonly title: string;
  /** This name is the name of a check of `CHECKS`, or null for a plan with no check. */
  readonly check: string | null;
  /** These triggers are the events that start the plan with no selection by hand. */
  readonly triggers: readonly PlanTrigger[];
  readonly cases: readonly (Case | StartCase)[];
  readonly laws?: LawSet;
}

/** A plan problem code names the part of a plan that is not correct. */
export type PlanProblemCode = "shape" | "format" | "id" | "check" | "trigger" | "case" | "time" | "laws";

/** A plan problem tells what is not correct, and where: `path` is the path of the field in the plan. */
export type PlanProblem = Problem<PlanProblemCode>;

const problem = (code: PlanProblemCode, path: string, message: string): PlanProblem => ({ code, path, message });

/**
 * This function gives the time limit of the job of a plan, in minutes. It is `SETUP_MINUTES` and the
 * window of each run of each case, with its warm-up run. The window of a run is the longest time of
 * the run (`windowOf`), thus a job in its limit cannot stop a run. A start case adds its longest time (`startWindowOf`).
 */
export const planMinutes = (plan: Plan): number => {
  const seconds = plan.cases.reduce((sum, value) => sum + (isStartCase(value) ? valueIn(startWindowOf(value), "s") : (value.runs + 1) * valueIn(windowOf(value), "s")), 0);
  return SETUP_MINUTES + Math.ceil(seconds / 60);
};

/**
 * This function examines a plan and gives each problem that it finds. A plan with no problem gives
 * an empty list.
 *
 * It examines the format, the id, the title, the check and the triggers. It examines each case with
 * `caseProblems`, or a start case with `startCaseProblems`. The ids of the cases must differ. Then the time limit of the job of the plan
 * (`planMinutes`) must be `MAX_JOB_MINUTES` or less. A plan with correct cases and a law set gets the problems of `lawSetProblems`.
 */
export const planProblems = (plan: Plan): readonly PlanProblem[] => {
  if (!isRecord(plan)) return [problem("shape", "", "The plan is not a record.")];
  const problems: PlanProblem[] = [];
  if (plan.format !== PLAN_FORMAT) problems.push(problem("format", "format", `The format is not "${PLAN_FORMAT}".`));
  if (typeof plan.id !== "string" || !PLAN_ID.test(plan.id)) problems.push(problem("id", "id", 'The id is not lower-case words joined by "-".'));
  if (typeof plan.title !== "string" || plan.title.trim() === "") problems.push(problem("id", "title", "The plan has no title."));
  if (plan.check !== null && (typeof plan.check !== "string" || !Object.hasOwn(CHECKS, plan.check))) {
    problems.push(problem("check", "check", `The check is not null or one of ${Object.keys(CHECKS).join(", ")}.`));
  }
  if (!Array.isArray(plan.triggers)) {
    problems.push(problem("trigger", "triggers", `The triggers are not a list of ${PLAN_TRIGGERS.join(", ")}.`));
  } else {
    plan.triggers.forEach((trigger: unknown, index) => {
      if (!(PLAN_TRIGGERS as readonly unknown[]).includes(trigger)) {
        problems.push(problem("trigger", `triggers[${index}]`, `The trigger is not one of ${PLAN_TRIGGERS.join(", ")}.`));
      } else if (plan.triggers.indexOf(trigger as PlanTrigger) !== index) {
        problems.push(problem("trigger", `triggers[${index}]`, `The trigger "${String(trigger)}" is in the list two times.`));
      }
    });
  }
  if (!Array.isArray(plan.cases) || plan.cases.length === 0) return [...problems, problem("case", "cases", "The plan has no case. A plan measures one case or more.")];
  const ids = new Set<string>();
  plan.cases.forEach((value, index) => {
    const path = `cases[${index}]`;
    const found = isStartCase(value) ? startCaseProblems(value) : caseProblems(value);
    problems.push(...found.map((each) => problem("case", each.path === "" ? path : `${path}.${each.path}`, each.message)));
    const id: unknown = isRecord(value) ? value["id"] : undefined;
    if (typeof id === "string") {
      if (ids.has(id)) problems.push(problem("case", `${path}.id`, `The case id "${id}" is in the plan two times.`));
      ids.add(id);
    }
  });
  if (problems.length === 0 && plan.laws !== undefined) problems.push(...lawSetProblems(plan.laws, plan.cases));
  if (problems.length === 0 && planMinutes(plan) > MAX_JOB_MINUTES) {
    problems.push(problem("time", "cases", `The job of the plan needs ${planMinutes(plan)} minutes. A job has at most ${MAX_JOB_MINUTES}. Put some cases in a second plan.`));
  }
  return problems;
};

/** The plans of a folder, and the problems of each plan file, with the name of the file in the path of each problem. */
export interface PlanFiles {
  readonly plans: readonly Plan[];
  readonly problems: readonly PlanProblem[];
}

/**
 * This function reads each plan file of a folder: each file with the extension `.json`. It examines
 * each plan with `planProblems`, and the id of each plan must be the name of its file. A plan with a
 * problem is not in `plans`.
 */
export const readPlans = (folder: string): PlanFiles => {
  const plans: Plan[] = [];
  const problems: PlanProblem[] = [];
  const files = readdirSync(folder)
    .filter((name) => name.endsWith(".json"))
    .sort();
  for (const name of files) {
    const at = (path: string): string => (path === "" ? name : `${name}: ${path}`);
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(join(folder, name), "utf8"));
    } catch (error) {
      problems.push(problem("shape", at(""), `The file is not JSON: ${errorMessage(error)}`));
      continue;
    }
    const found = planProblems(value as Plan).map((each) => ({ ...each, path: at(each.path) }));
    const id = basename(name, ".json");
    if (found.length === 0 && (value as Plan).id !== id) found.push(problem("id", at("id"), `The id "${(value as Plan).id}" is not the name of its file, "${id}".`));
    if (found.length === 0) plans.push(value as Plan);
    problems.push(...found);
  }
  return { plans, problems };
};

/** A selection tells the plans of a workflow run: its event, and the ids of a dispatch by hand. */
export interface Selection {
  /** This name is the event of the workflow run, for example `pull_request` or `schedule`. */
  readonly event: string;
  /** These ids are the plans of a dispatch by hand. An empty list selects by the event. */
  readonly ids: readonly string[];
}

/** This function gives the trigger of an event: a push and a dispatch with no ids are as a pull request. */
const triggerOf = (event: string): PlanTrigger => {
  if (event === "schedule") return "schedule";
  if (event === "pull_request" || event === "push" || event === "workflow_dispatch") return "pull_request";
  throw new RangeError(`The event "${event}" does not start a plan.`);
};

/**
 * This function gives the plans of a selection, in the order of `plans`. A selection with ids gives
 * the plans with those ids. A selection with no ids gives each plan with the trigger of the event.
 *
 * This function throws a `RangeError` for an id that no plan has, an event that starts no plan, and
 * a selection with no plan. A run that measures nothing is not a pass.
 */
export const selectPlans = (plans: readonly Plan[], selection: Selection): readonly Plan[] => {
  let chosen: readonly Plan[];
  if (selection.ids.length > 0) {
    const unknown = selection.ids.filter((id) => !plans.some((plan) => plan.id === id));
    if (unknown.length > 0) throw new RangeError(`No plan has the id ${unknown.map((id) => `"${id}"`).join(", ")}. The plans are ${plans.map((plan) => plan.id).join(", ")}.`);
    chosen = plans.filter((plan) => selection.ids.includes(plan.id));
  } else {
    const trigger = triggerOf(selection.event);
    chosen = plans.filter((plan) => plan.triggers.includes(trigger));
  }
  if (chosen.length === 0) throw new RangeError(`The event "${selection.event}" selects no plan.`);
  return chosen;
};

/** An entry of the matrix of the workflow: one run of one plan, with the time limit of its job. */
export interface MatrixEntry {
  readonly plan: string;
  readonly run: number;
  readonly minutes: number;
}

/**
 * This function gives the matrix of the workflow: one job for each run of each plan. Each run is a
 * job on its own runner, thus a limit can take the worst of many runners.
 *
 * This function throws a `RangeError` for a run that is not a whole number above 0, and for a run in
 * the list two times. It also throws for a matrix of more than `MAX_JOBS` jobs.
 */
export const matrixOf = (plans: readonly Plan[], runs: readonly number[]): { readonly include: readonly MatrixEntry[] } => {
  const bad = runs.filter((run, index) => !Number.isInteger(run) || run < 1 || runs.indexOf(run) !== index);
  if (runs.length === 0 || bad.length > 0) throw new RangeError(`The runs are not a list of different whole numbers above 0: ${JSON.stringify(runs)}.`);
  if (plans.length * runs.length > MAX_JOBS) throw new RangeError(`The matrix has ${plans.length * runs.length} jobs. GitHub starts at most ${MAX_JOBS}.`);
  return { include: plans.flatMap((plan) => runs.map((run) => ({ plan: plan.id, run, minutes: planMinutes(plan) }))) };
};
