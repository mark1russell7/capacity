import { limitUses, type LimitUse } from "@mark1russell7/capacity";
import { quantity, type Quantity } from "@mark1russell7/quantity";
import { canonicalJson } from "@mark1russell7/rigor-generators";
import { escapeMarkdown } from "@mark1russell7/text";
import type { LawJob } from "./laws.ts";
import { withArmCommit, type Plan } from "./plan.ts";
import { startRecordProblems } from "./start-measure.ts";
import { START_LIMIT_RUNS, startCaseOf, startLimitRunOf, startValueOf, type StartLimitRun, type StartLimits } from "./start-limits.ts";

/**
 * The outcome of a start gate. `pass` tells that each run holds each limit at each point. `block` tells that a run passed a
 * ceiling, or that a child did not fit the target. `no-read` tells that the records cannot decide. A no read is not a pass.
 */
export type StartGateOutcome = "pass" | "block" | "no-read";

/** A start gate use is the use of one limit by one run at one point. */
export interface StartGateUse {
  /** This id is the id of the run, `<CI run>/<job>/<attempt>`. */
  readonly run: string;
  readonly point: string;
  readonly use: LimitUse;
}

/** A start gate finding is one reason of a block or of a no read. A finding of the whole gate has no run and no point. */
export interface StartGateFinding {
  readonly kind: "block" | "no-read";
  readonly run: string | null;
  readonly point: string | null;
  readonly message: string;
}

/** A start gate is the verdict of the runs of one start case at one commit of its arm, against the limits of the case. */
export interface StartGate {
  /** This id is the id of the start case. */
  readonly case: string;
  readonly arm: string;
  /** This commit is the commit of the arm that the runs measured. */
  readonly commit: string;
  /** This commit is the commit of the arm that gave the limits. */
  readonly limitsCommit: string;
  readonly outcome: StartGateOutcome;
  /** These runs are the runs with a record that the gate read, in the order of their ids. */
  readonly runs: readonly StartLimitRun[];
  /** These uses are the use of each limit by each run at each point. */
  readonly uses: readonly StartGateUse[];
  readonly findings: readonly StartGateFinding[];
}

/** The options of `startGateOf`. */
export interface StartGateOptions {
  /** This commit is the commit of the arm of the limits that the runs measured. */
  readonly commit: string;
  /** This count is the fewest runs with a record that decide the gate. The default is `START_LIMIT_RUNS`. */
  readonly runs?: number;
}

/** The ceilings of the limits are amounts, thus the instance of the gate has no resource. */
const NO_RESOURCES = { resources: {} };

/**
 * This function gives the verdict of a start gate. It compares the runs of the start case of the limits with the limits of each
 * point. The arm of the limits has the commit `commit` in the runs. The jobs come from `readJobs`. The function ignores a job of another plan.
 *
 * - The value of a run at a point is the value of `startValueOf`, the same value as the value of the limits.
 * - A use above 1 blocks the gate. A child that did not fit the target also blocks it.
 * - These give no read: a record of another version of the case, a record with a problem and a point with no value.
 *   Fewer runs than `runs` also give no read.
 *
 * It throws an `Error` when the case of the plan is not the case of the limits. Then the limits need a new derivation.
 */
export const startGateOf = (limits: StartLimits, plan: Plan, jobs: readonly LawJob[], options: StartGateOptions): StartGate => {
  const need = options.runs ?? START_LIMIT_RUNS;
  if (!Number.isSafeInteger(need) || need < 1) throw new RangeError(`The count of runs is not a whole number above 0: ${need}.`);
  if (plan.id !== limits.plan) throw new Error(`The limits are the limits of the plan "${limits.plan}", not of the plan "${plan.id}".`);
  const base = startCaseOf(plan, limits.case);
  const first = base.arms[0];
  const same =
    first?.id === limits.arm &&
    first.commit === limits.commit &&
    base.seeder === limits.seeder &&
    canonicalJson(base.target) === canonicalJson(limits.target) &&
    canonicalJson(base.points.map((point) => point.id)) === canonicalJson(limits.points.map((point) => point.id));
  if (!same) throw new Error(`The case "${limits.case}" of the plan is not the case of the limits. Derive the limits again with start-limits.main.ts.`);
  const expected = canonicalJson(startCaseOf(withArmCommit(plan, { arm: limits.arm, commit: options.commit }), limits.case));
  const findings: StartGateFinding[] = [];
  const uses: StartGateUse[] = [];
  const runs: StartLimitRun[] = [];
  const add = (kind: StartGateFinding["kind"], run: string | null, point: string | null, message: string): void => void findings.push({ kind, run, point, message });
  for (const job of jobs.filter((each) => each.timed.plan === plan.id)) {
    for (const record of (job.starts ?? []).filter((each) => each.case.id === limits.case)) {
      const run = startLimitRunOf(job, record);
      if (runs.some((each) => each.id === run.id)) {
        add("no-read", run.id, null, `The run ${run.id} is in the records two times.`);
        continue;
      }
      if (canonicalJson(record.case) !== expected) {
        add("no-read", run.id, null, `The record measures another version of the case, or the arm "${limits.arm}" at another commit than ${options.commit}.`);
        continue;
      }
      const problems = startRecordProblems(record);
      if (problems.length > 0) {
        add("no-read", run.id, null, `The record has problems: ${problems.map((each) => `${each.path}: ${each.message}`).join(" ")}`);
        continue;
      }
      runs.push(run);
      for (const failure of record.failures) {
        add("block", run.id, null, `The child of ${failure.arm} on ${failure.case}, round ${failure.round}, did not fit the target: ${failure.kind}.`);
      }
      for (const point of limits.points) {
        const values: Record<string, Quantity> = {};
        const missing: string[] = [];
        for (const measure of limits.measures) {
          const value = startValueOf(record, point.id, limits.arm, measure);
          if (value === undefined) missing.push(measure.reading);
          else values[measure.id] = quantity(value, measure.unit);
        }
        if (missing.length > 0) {
          add("no-read", run.id, point.id, `The run has no reading of ${missing.join(", ")}.`);
          continue;
        }
        const found = limitUses(point.limits.limits, NO_RESOURCES, values);
        if (found.tag === "err") {
          add("no-read", run.id, point.id, `${found.error.path}: ${found.error.message}`);
          continue;
        }
        for (const use of found.value) {
          uses.push({ run: run.id, point: point.id, use });
          if (!use.holds) add("block", run.id, point.id, `${use.measure} is ${use.value.value} ${use.value.unit}, above its ceiling ${use.amount.value} ${use.amount.unit} (use ${use.use.toFixed(3)}).`);
        }
      }
    }
  }
  if (runs.length < need) add("no-read", null, null, `The gate needs the records of ${need} or more runs, and ${runs.length} runs have a record that it reads.`);
  runs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const outcome: StartGateOutcome = findings.some((each) => each.kind === "block") ? "block" : findings.length > 0 ? "no-read" : "pass";
  return { case: limits.case, arm: limits.arm, commit: options.commit, limitsCommit: limits.commit, outcome, runs, uses, findings };
};

/** These words tell each outcome in the summary. */
const OUTCOME_WORDS: Readonly<Record<StartGateOutcome, string>> = {
  pass: "pass: each run holds each limit at each point",
  block: "block: a run passed a limit",
  "no-read": "no read: the records cannot decide, and a no read is not a pass",
};

/** This function gives the summary of a start gate: the outcome, the use of each limit by each run, and each finding. */
export const startGateSummaryOf = (gate: StartGate): string => {
  const lines = [
    `### The start gate of ${escapeMarkdown(gate.case)}`,
    "",
    `The arm ${escapeMarkdown(gate.arm)} at ${gate.commit.slice(0, 7)}, against the limits of ${gate.limitsCommit.slice(0, 7)}, in ${gate.runs.length} runs: ${OUTCOME_WORDS[gate.outcome]}.`,
    "",
  ];
  if (gate.uses.length > 0) {
    lines.push("| Run | Point | Measure | Value | Ceiling | Use |", "| --- | --- | --- | --- | --- | --- |");
    for (const { run, point, use } of gate.uses) {
      lines.push(`| ${escapeMarkdown(run)} | ${escapeMarkdown(point)} | ${escapeMarkdown(use.measure)} | ${use.value.value} ${escapeMarkdown(use.value.unit)} | ${use.amount.value} ${escapeMarkdown(use.amount.unit)} | ${use.use.toFixed(3)} |`);
    }
    lines.push("");
  }
  for (const finding of gate.findings) {
    const where = [finding.run, finding.point].filter((each) => each !== null).join(" at ");
    lines.push(`- ${finding.kind === "block" ? "Block" : "No read"}${where === "" ? "" : ` (${escapeMarkdown(where)})`}: ${escapeMarkdown(finding.message)}`);
  }
  return `${lines.join("\n")}\n`;
};
