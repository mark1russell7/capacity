import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { GATE_JOBS, type Problem } from "@mark1russell7/capacity";
import { isRecord } from "@mark1russell7/optional/read";
import { valueIn } from "@mark1russell7/quantity";
import { canonicalJson } from "@mark1russell7/rigor-generators";
import { errorMessage } from "@mark1russell7/text";
import { caseCost, caseProblems, type Case } from "./case.ts";
import { windowOf } from "./cell.ts";
import { CHECKS } from "./check.ts";
import { FLOOR_IDS } from "./floor.ts";
import { lawSetProblems, type LawSet } from "./laws.ts";
import { startLawSetProblems, type StartLawSet } from "./start-laws.ts";
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
 * The field `startLaws` tells the laws that the start records of the plan give (`startLawsOf`). A plan has one of the two sets, or none.
 * The field `gate` makes a gate plan: the plan measures the subject again at points of the laws of another plan (`planGate`).
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
  /**
   * This count is the jobs of the plan when the workflow gives no list of runs. The default is 1. Each job is a job on its
   * own runner (`matrixOf`).
   */
  readonly jobs?: number;
  readonly laws?: LawSet;
  readonly startLaws?: StartLawSet;
  readonly gate?: GateSet;
}

/** This text is the id of the plan of the A/A pairs. A gate plan has each of its cases, for the noise floor of its job. */
export const FLOOR_PLAN = "floor";

/**
 * A gate set tells the plan of the laws of a gate plan. A gate plan has the check `gate` and each case of the plan
 * `FLOOR_PLAN`. It also has some cases of the plan of the laws, each with the same id. A case of the laws can add a cost
 * (`Case.cost`): a slower subject, thus a gate that must block.
 */
export interface GateSet {
  /** This id is the id of a plan with a law set. */
  readonly laws: string;
}

/** A plan problem code names the part of a plan that is not correct. */
export type PlanProblemCode = "shape" | "format" | "id" | "check" | "trigger" | "jobs" | "case" | "time" | "laws" | "gate";

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
 * It examines the format, the id, the title, the check, the triggers and the count of jobs. It examines each case with
 * `caseProblems`, or a start case with `startCaseProblems`. The ids of the cases must differ. Then the time limit of the job of the plan
 * (`planMinutes`) must be `MAX_JOB_MINUTES` or less. A plan with correct cases and a law set gets the problems of `lawSetProblems`.
 * A plan with a law set has no case with a cost. A plan with a start law set gets the problems of `startLawSetProblems`.
 * A plan has no law set and start law set together. A gate plan has the check `gate`, a plan id in `gate.laws` and no law set.
 * `readPlans` compares the cases of a gate plan with the cases of its plans.
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
  if (plan.jobs !== undefined && !(Number.isInteger(plan.jobs) && plan.jobs >= 1 && plan.jobs <= MAX_JOBS)) {
    problems.push(problem("jobs", "jobs", `The count of jobs is not a whole number from 1 to ${MAX_JOBS}.`));
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
  if (plan.laws !== undefined && plan.startLaws !== undefined) {
    problems.push(problem("laws", "startLaws", "A plan has a law set or a start law set, not the two. The laws of one plan come from one kind of record."));
  } else if (problems.length === 0 && plan.startLaws !== undefined) {
    problems.push(...startLawSetProblems(plan.startLaws, plan.cases));
  } else if (problems.length === 0 && plan.laws !== undefined) {
    problems.push(...lawSetProblems(plan.laws, plan.cases));
    plan.cases.forEach((value, index) => {
      if (!isStartCase(value) && caseCost(value) > 0) {
        problems.push(problem("laws", `cases[${index}].cost`, "A plan with a law set has no case with a cost. A law is a law of the subject with no added cost."));
      }
    });
  }
  if (plan.gate !== undefined) problems.push(...gateShapeProblems(plan));
  if (problems.length === 0 && planMinutes(plan) > MAX_JOB_MINUTES) {
    problems.push(problem("time", "cases", `The job of the plan needs ${planMinutes(plan)} minutes. A job has at most ${MAX_JOB_MINUTES}. Put some cases in a second plan.`));
  }
  return problems;
};

/**
 * This text is the start of the id of each gate plan. The job `gate` of the workflow `lab.yml` downloads only the artifacts
 * `lab-gate-*`. A job of the plan `rate` has approximately 3 GB of raw results, and the gate does not read them.
 */
export const GATE_PREFIX = "gate-";

/** This function gives the problems of a gate plan alone: its id, the shape of its field `gate`, its check and no law set. */
const gateShapeProblems = (plan: Plan): readonly PlanProblem[] => {
  const problems: PlanProblem[] = [];
  if (!isRecord(plan.gate) || typeof plan.gate.laws !== "string" || !PLAN_ID.test(plan.gate.laws)) {
    problems.push(problem("gate", "gate", `The gate is not a record with the id of a plan in "laws", for example { "laws": "rate" }.`));
  }
  if (typeof plan.id === "string" && !plan.id.startsWith(GATE_PREFIX)) {
    problems.push(problem("gate", "id", `The id of a gate plan starts with "${GATE_PREFIX}". The job gate of the workflow reads only the artifacts of such plans.`));
  }
  if (plan.check !== "gate") problems.push(problem("gate", "check", `A gate plan has the check "gate", not ${JSON.stringify(plan.check)}.`));
  if (plan.laws !== undefined) problems.push(problem("gate", "laws", "A gate plan has no law set. It compares the records with the laws of another plan."));
  if (plan.startLaws !== undefined) problems.push(problem("gate", "startLaws", "A gate plan has no start law set. It compares the records with the laws of another plan."));
  if ((plan.jobs ?? 1) < GATE_JOBS) problems.push(problem("gate", "jobs", `A gate plan has ${GATE_JOBS} jobs or more. A side of a law needs ${GATE_JOBS} jobs.`));
  return problems;
};

/** This function gives the text of a case with no cost, to compare two cases. */
const plainText = (value: Case | StartCase): string => canonicalJson(Object.fromEntries(Object.entries(value).filter(([name]) => name !== "cost")));

/**
 * This function gives the problems of a gate plan against the other plans. The plan of its laws must have a law set. The gate
 * plan has each case of the plan `FLOOR_PLAN`, equal to it. Each other case is a case of the plan of the laws, with
 * the same id, equal to it apart from its cost.
 */
export const gatePlanProblems = (plan: Plan, plans: readonly Plan[]): readonly PlanProblem[] => {
  const laws = plans.find((each) => each.id === plan.gate?.laws);
  if (laws?.laws === undefined) return [problem("gate", "gate.laws", `No plan with a law set has the id "${plan.gate?.laws ?? ""}".`)];
  const floor = plans.find((each) => each.id === FLOOR_PLAN);
  if (floor === undefined) return [problem("gate", "cases", `No plan has the id "${FLOOR_PLAN}". A gate plan has each of its cases.`)];
  const problems: PlanProblem[] = [];
  for (const id of FLOOR_IDS) {
    const own = plan.cases.find((each) => each.id === id);
    const base = floor.cases.find((each) => each.id === id);
    if (own === undefined || base === undefined || canonicalJson(own) !== canonicalJson(base)) {
      problems.push(problem("gate", "cases", `The case "${id}" is not the case of the plan ${FLOOR_PLAN}. A gate plan has each A/A pair of that plan, for the noise floor of its job.`));
    }
  }
  plan.cases.forEach((value, index) => {
    if (FLOOR_IDS.includes(value.id)) return;
    const base = laws.cases.find((each) => each.id === value.id);
    if (base === undefined || plainText(value) !== plainText(base)) {
      problems.push(problem("gate", `cases[${index}]`, `The case "${value.id}" is not a case of the plan ${laws.id}, apart from its cost.`));
    }
  });
  return problems;
};

/** The plans of a folder, and the problems of each plan file, with the name of the file in the path of each problem. */
export interface PlanFiles {
  readonly plans: readonly Plan[];
  readonly problems: readonly PlanProblem[];
}

/**
 * This function reads each plan file of a folder: each file with the extension `.json`. It examines
 * each plan with `planProblems`, and the id of each plan must be the name of its file. Then it examines each gate plan
 * with `gatePlanProblems`. A plan with a problem is not in `plans`.
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
  const gates = plans.flatMap((plan) => (plan.gate === undefined ? [] : [{ plan, found: gatePlanProblems(plan, plans) }]));
  const bad = new Set(gates.filter((each) => each.found.length > 0).map((each) => each.plan.id));
  for (const { plan, found } of gates) problems.push(...found.map((each) => ({ ...each, path: `${plan.id}.json: ${each.path}` })));
  return { plans: plans.filter((plan) => !bad.has(plan.id)), problems };
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
 * job on its own runner, thus a limit can take the worst of many runners. With no list of runs, each
 * plan has the runs 1 to its count of jobs (`Plan.jobs`).
 *
 * This function throws a `RangeError` for a run that is not a whole number above 0, and for a run in
 * the list two times. It also throws for a matrix of more than `MAX_JOBS` jobs.
 */
export const matrixOf = (plans: readonly Plan[], runs?: readonly number[]): { readonly include: readonly MatrixEntry[] } => {
  if (runs !== undefined) {
    const bad = runs.filter((run, index) => !Number.isInteger(run) || run < 1 || runs.indexOf(run) !== index);
    if (runs.length === 0 || bad.length > 0) throw new RangeError(`The runs are not a list of different whole numbers above 0: ${JSON.stringify(runs)}.`);
  }
  const include = plans.flatMap((plan) =>
    (runs ?? Array.from({ length: plan.jobs ?? 1 }, (_, index) => index + 1)).map((run) => ({ plan: plan.id, run, minutes: planMinutes(plan) })),
  );
  if (include.length > MAX_JOBS) throw new RangeError(`The matrix has ${include.length} jobs. GitHub starts at most ${MAX_JOBS}.`);
  return { include };
};
