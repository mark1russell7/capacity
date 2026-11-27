import { limitUses, type LimitUse } from "@mark1russell7/capacity";
import { quantity, valueIn, type Quantity } from "@mark1russell7/quantity";
import { pooledLimitVerdict, type JobRecords, type LimitOutcome, type PairedTime, type PooledLimitVerdict } from "@mark1russell7/rigor-bench";
import { canonicalJson } from "@mark1russell7/rigor-generators";
import { errorMessage, escapeMarkdown } from "@mark1russell7/text";
import type { LawJob } from "./laws.ts";
import { withArmCommit, type Plan } from "./plan.ts";
import { startRecordProblems, type StartReading, type StartRecord } from "./start-measure.ts";
import { START_LIMIT_MEASURES, START_LIMIT_RUNS, startCaseOf, startLimitRunOf, startValueOf, type StartLimitMeasure, type StartLimitRun, type StartLimits } from "./start-limits.ts";

/**
 * This id is the arm of the base in the case of a start gate. Each job of the gate starts the head of a pull request in
 * the arm of the limits. The same job starts the base of the pull request in this arm (CAP-105).
 */
export const START_BASE_ARM = "base";

/**
 * These limits are the paired claims of a start gate, by the id of the measure. Each limit is the largest ratio of the head
 * to its base at each point, over the rounds of all runs. `pooledLimitVerdict` of `@mark1russell7/rigor-bench` decides it,
 * with the A/A pairs of the head as its noise.
 *
 * - `start.live` has the limit 1.02. In 30 A/A runs at alerts `4615e74`, the SD of the ratio of two equal builds is 0.4 to
 *   0.6 %. In 1000 draws of 5 of these runs, the claim is `within` at 1.02 in each draw. At 1.01 it is `within` in 54 %.
 * - `start.peak` and `start.readiness` have no claim. Their SD is 6 to 10 %, and 5 runs cannot decide a ratio of 1.1.
 */
export const START_PAIRED_LIMITS: Readonly<Record<string, number>> = { "start.live": 1.02 };

/**
 * The outcome of a start gate. `pass` tells that the head holds each limit at each point, and each paired claim.
 * `block` tells that the head passed a ceiling that its base holds, or a paired limit. A child that did not fit the target
 * also gives `block`. `no-read` tells that the records cannot decide. A no read is not a pass.
 */
export type StartGateOutcome = "pass" | "block" | "no-read";

/** A start gate use is the use of one limit by one arm of one run at one point. */
export interface StartGateUse {
  /** This id is the id of the run, `<CI run>/<job>/<attempt>`. */
  readonly run: string;
  /** This id is the arm of the limits for the head, or `START_BASE_ARM` for the base. */
  readonly arm: string;
  readonly point: string;
  readonly use: LimitUse;
}

/**
 * A start gate finding is one fact of the verdict. A finding of the whole gate has no run and no point.
 *
 * - `block` and `no-read` give the outcome.
 * - `drift` tells that the base also passes a ceiling. Then the ceiling cannot tell the change of the head, and the limits
 *   need a new derivation at the new main. A drift does not block, and a paired claim still holds the change of the head.
 * - `accepted` tells a block that the option `accept` removed: the app accepts this change of its start.
 */
export interface StartGateFinding {
  readonly kind: "block" | "no-read" | "drift" | "accepted";
  readonly run: string | null;
  readonly point: string | null;
  readonly message: string;
}

/** A start gate pair point is the paired claim of one measure at one point. */
export interface StartGatePairPoint {
  readonly point: string;
  /** This ratio is the median ratio of the head to its base over the rounds of all runs. */
  readonly ratio: number;
  /** This bound is the high end of the interval of the ratio, times the high end of the A/A band. */
  readonly bound: number;
  readonly outcome: LimitOutcome;
}

/** A start gate pair is the paired claim of one measure: its limit, its outcome and the claim at each point. */
export interface StartGatePair {
  /** This id is the id of the measure, for example `start.live`. */
  readonly measure: string;
  readonly limit: number;
  readonly outcome: LimitOutcome;
  readonly reason: string;
  readonly points: readonly StartGatePairPoint[];
}

/** A start gate is the verdict of the runs of one start case at one head and its base, against the limits of the case. */
export interface StartGate {
  /** This id is the id of the start case. */
  readonly case: string;
  readonly arm: string;
  /** This commit is the commit of the arm that the runs measured: the head. */
  readonly commit: string;
  /** This commit is the commit of the arm `START_BASE_ARM` that the runs measured: the base of the head. */
  readonly base: string;
  /** This commit is the commit of the arm that gave the limits. */
  readonly limitsCommit: string;
  readonly outcome: StartGateOutcome;
  /** This flag tells that the option `accept` removed the blocks of the change of the head. */
  readonly accept: boolean;
  /** These runs are the runs with a record that the gate read, in the order of their ids. */
  readonly runs: readonly StartLimitRun[];
  /** These uses are the use of each limit by each arm of each run at each point. */
  readonly uses: readonly StartGateUse[];
  /** These pairs are the paired claims of `START_PAIRED_LIMITS`. A gate with too few runs has no pair. */
  readonly pairs: readonly StartGatePair[];
  readonly findings: readonly StartGateFinding[];
}

/** The options of `startGateOf`. */
export interface StartGateOptions {
  /** This commit is the commit of the arm of the limits that the runs measured: the head. */
  readonly commit: string;
  /** This commit is the commit of the arm `START_BASE_ARM` that the runs measured. The default is the commit of the arm in the plan. */
  readonly base?: string;
  /** This count is the fewest runs with a record that decide the gate. The default is `START_LIMIT_RUNS`. */
  readonly runs?: number;
  /** This flag accepts a change of the start: a ceiling or a paired limit that the head passes does not block. The default is false. */
  readonly accept?: boolean;
}

/** The ceilings of the limits are amounts, thus the instance of the gate has no resource. */
const NO_RESOURCES = { resources: {} };

/**
 * This function gives the records of one paired claim of one run. Each candidate record is the base (`a`) and the head (`b`)
 * in one round at one point. Each A/A record is the head and its A/A copy. The rounds start at `offset`, thus each run of
 * the pool has its own rounds.
 */
const pairedRecordsOf = (record: StartRecord, run: string, arm: string, measure: StartLimitMeasure, offset: number): JobRecords => {
  const candidate: PairedTime[] = [];
  const aa: PairedTime[] = [];
  const readingOf = (child: string, head: StartReading): StartReading | undefined => record.readings.find((each) => each.arm === child && each.point === head.point && each.round === head.round);
  const value = (reading: StartReading | undefined): number | undefined => {
    const found = reading?.measures[measure.reading];
    return found === null || found === undefined ? undefined : valueIn(found, measure.unit);
  };
  // A pair with a reading that has no value is not in the records. The uses of the limits give the no read of that reading.
  const pairOf = (first: StartReading, second: StartReading | undefined): PairedTime | undefined => {
    const a = value(first);
    const b = value(second);
    return second === undefined || a === undefined || b === undefined ? undefined : { case: first.point, round: offset + first.round, first: first.position < second.position ? "a" : "b", a, b };
  };
  for (const head of record.readings.filter((each) => each.arm === arm)) {
    const base = readingOf(START_BASE_ARM, head);
    const pair = base === undefined ? undefined : pairOf(base, head);
    const copy = pairOf(head, readingOf(`${arm}~aa`, head));
    if (pair !== undefined) candidate.push(pair);
    if (copy !== undefined) aa.push(copy);
  }
  return { job: run, candidate, aa };
};

/**
 * This function gives the verdict of a start gate. The arm of the limits has the commit `commit` in the runs: the head. The
 * arm `START_BASE_ARM` has the commit `base`. The jobs come from `readJobs`. The function ignores a job of another plan.
 *
 * - The value of an arm at a point is the value of `startValueOf`. The head has the same value as the value of the limits.
 * - A use of the head above 1 blocks the gate when the base holds that limit in each run. When the base passes it in a run,
 *   the use is a drift, and it does not block. Thus a change of main does not block the next heads.
 * - A paired claim of `START_PAIRED_LIMITS` that is `beyond` blocks the gate. A claim that cannot decide gives no read.
 * - A child that did not fit the target blocks the gate.
 * - With `accept`, a ceiling or a paired limit that the head passes does not block. The finding `accepted` tells it.
 * - These give no read: a record of another version of the case, a record with a problem and a point with no value.
 *   Fewer runs than `runs` also give no read.
 *
 * It throws an `Error` when the case of the plan is not the case of the limits, or has no arm `START_BASE_ARM`.
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
  const baseArm = base.arms.find((each) => each.id === START_BASE_ARM);
  if (baseArm === undefined) throw new Error(`The case "${limits.case}" has no arm "${START_BASE_ARM}". A start gate compares the head with its base in the same job.`);
  const baseCommit = options.base ?? baseArm.commit;
  const accept = options.accept ?? false;
  const armed = withArmCommit(withArmCommit(plan, { arm: limits.arm, commit: options.commit }), { arm: START_BASE_ARM, commit: baseCommit });
  const value = startCaseOf(armed, limits.case);
  const expected = canonicalJson(value);
  const findings: StartGateFinding[] = [];
  const uses: StartGateUse[] = [];
  const read: { readonly run: StartLimitRun; readonly record: StartRecord }[] = [];
  const add = (kind: StartGateFinding["kind"], run: string | null, point: string | null, message: string): void => void findings.push({ kind, run, point, message });
  for (const job of jobs.filter((each) => each.timed.plan === plan.id)) {
    for (const record of (job.starts ?? []).filter((each) => each.case.id === limits.case)) {
      const run = startLimitRunOf(job, record);
      if (read.some((each) => each.run.id === run.id)) {
        add("no-read", run.id, null, `The run ${run.id} is in the records two times.`);
        continue;
      }
      if (canonicalJson(record.case) !== expected) {
        add("no-read", run.id, null, `The record measures another version of the case, the arm "${limits.arm}" at another commit than ${options.commit}, or the arm "${START_BASE_ARM}" at another commit than ${baseCommit}.`);
        continue;
      }
      const problems = startRecordProblems(record);
      if (problems.length > 0) {
        add("no-read", run.id, null, `The record has problems: ${problems.map((each) => `${each.path}: ${each.message}`).join(" ")}`);
        continue;
      }
      read.push({ run, record });
      for (const failure of record.failures) {
        add("block", run.id, null, `The child of ${failure.arm} on ${failure.case}, round ${failure.round}, did not fit the target: ${failure.kind}.`);
      }
      for (const point of limits.points) {
        for (const arm of [limits.arm, START_BASE_ARM]) {
          const values: Record<string, Quantity> = {};
          const missing: string[] = [];
          for (const measure of limits.measures) {
            const found = startValueOf(record, point.id, arm, measure);
            if (found === undefined) missing.push(measure.reading);
            else values[measure.id] = quantity(found, measure.unit);
          }
          if (missing.length > 0) {
            add("no-read", run.id, point.id, `The arm ${arm} has no reading of ${missing.join(", ")}.`);
            continue;
          }
          const found = limitUses(point.limits.limits, NO_RESOURCES, values);
          if (found.tag === "err") add("no-read", run.id, point.id, `${found.error.path}: ${found.error.message}`);
          else for (const use of found.value) uses.push({ run: run.id, arm, point: point.id, use });
        }
      }
    }
  }
  if (read.length < need) add("no-read", null, null, `The gate needs the records of ${need} or more runs, and ${read.length} runs have a record that it reads.`);
  // A ceiling that the base passes in a run cannot tell the change of the head: main moved, and the limits need a new derivation.
  const over = (arm: string): readonly StartGateUse[] => uses.filter((each) => each.arm === arm && !each.use.holds);
  const keyOf = (each: StartGateUse): string => `${each.point} ${each.use.measure}`;
  const drifts = new Map(over(START_BASE_ARM).map((each) => [keyOf(each), each]));
  for (const { run, point, use } of drifts.values()) {
    add("drift", run, point, `The base passes the ceiling of ${use.measure} too: ${use.value.value} ${use.value.unit} (use ${use.use.toFixed(3)}). Thus the head does not block on it. Derive the limits again at the new main.`);
  }
  for (const { run, point, use } of over(limits.arm).filter((each) => !drifts.has(keyOf(each)))) {
    add(accept ? "accepted" : "block", run, point, `${use.measure} is ${use.value.value} ${use.value.unit}, above its ceiling ${use.amount.value} ${use.amount.unit} (use ${use.use.toFixed(3)}), and the base holds it.`);
  }
  const pairs: StartGatePair[] = [];
  if (read.length >= need) {
    for (const [id, limit] of Object.entries(START_PAIRED_LIMITS)) {
      const measure = START_LIMIT_MEASURES.find((each) => each.id === id)!;
      const records = read.map(({ run, record }, place) => pairedRecordsOf(record, run.id, limits.arm, measure, place * value.rounds));
      let verdict: PooledLimitVerdict;
      try {
        verdict = pooledLimitVerdict(records, { limit, aaFrom: "rounds" });
      } catch (error) {
        add("no-read", null, null, `The paired claim of ${id} cannot read the records: ${errorMessage(error)}`);
        continue;
      }
      const points = verdict.pooled.cases.map((each): StartGatePairPoint => ({ point: each.case, ratio: each.ratio, bound: each.bound, outcome: each.outcome }));
      pairs.push({ measure: id, limit, outcome: verdict.outcome, reason: verdict.reason, points });
      if (verdict.outcome === "beyond") add(accept ? "accepted" : "block", null, null, `The head passes the paired limit ${limit} of ${id} against its base. ${verdict.reason}`);
      if (verdict.outcome === "cannot decide") add("no-read", null, null, `The paired claim of ${id} cannot decide. ${verdict.reason}`);
    }
  }
  const runs = read.map((each) => each.run).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const outcome: StartGateOutcome = findings.some((each) => each.kind === "block") ? "block" : findings.some((each) => each.kind === "no-read") ? "no-read" : "pass";
  return { case: limits.case, arm: limits.arm, commit: options.commit, base: baseCommit, limitsCommit: limits.commit, outcome, accept, runs, uses, pairs, findings };
};

/** These words tell each outcome in the summary. */
const OUTCOME_WORDS: Readonly<Record<StartGateOutcome, string>> = {
  pass: "pass: the head holds each limit at each point, and each paired claim",
  block: "block: the head passed a limit",
  "no-read": "no read: the records cannot decide, and a no read is not a pass",
};

/** These words start the line of each kind of finding in the summary. */
const FINDING_WORDS: Readonly<Record<StartGateFinding["kind"], string>> = { block: "Block", "no-read": "No read", drift: "Drift", accepted: "Accepted" };

/**
 * This function gives the summary of a start gate: the outcome, the paired claims, the use of each limit and each finding.
 * The table of the uses has a line for each arm of each run at each point.
 */
export const startGateSummaryOf = (gate: StartGate): string => {
  const lines = [
    `### The start gate of ${escapeMarkdown(gate.case)}`,
    "",
    `The head ${gate.commit.slice(0, 7)} in the arm ${escapeMarkdown(gate.arm)} and its base ${gate.base.slice(0, 7)}, against the limits of ${gate.limitsCommit.slice(0, 7)}, in ${gate.runs.length} runs: ${OUTCOME_WORDS[gate.outcome]}.`,
    "",
  ];
  if (gate.accept) lines.push("The app accepts a change of its start in this head. Thus a limit that the head passes does not block.", "");
  if (gate.pairs.length > 0) {
    lines.push("| Measure | Point | Head / base | Bound | Limit | Outcome |", "| --- | --- | --- | --- | --- | --- |");
    for (const pair of gate.pairs) {
      for (const each of pair.points) lines.push(`| ${escapeMarkdown(pair.measure)} | ${escapeMarkdown(each.point)} | ${each.ratio.toFixed(4)} | ${each.bound.toFixed(4)} | ${pair.limit} | ${each.outcome} |`);
    }
    lines.push("");
  }
  if (gate.uses.length > 0) {
    lines.push("| Run | Arm | Point | Measure | Value | Ceiling | Use |", "| --- | --- | --- | --- | --- | --- | --- |");
    for (const { run, arm, point, use } of gate.uses) {
      lines.push(`| ${escapeMarkdown(run)} | ${escapeMarkdown(arm)} | ${escapeMarkdown(point)} | ${escapeMarkdown(use.measure)} | ${use.value.value} ${escapeMarkdown(use.value.unit)} | ${use.amount.value} ${escapeMarkdown(use.amount.unit)} | ${use.use.toFixed(3)} |`);
    }
    lines.push("");
  }
  for (const finding of gate.findings) {
    const where = [finding.run, finding.point].filter((each) => each !== null).join(" at ");
    lines.push(`- ${FINDING_WORDS[finding.kind]}${where === "" ? "" : ` (${escapeMarkdown(where)})`}: ${escapeMarkdown(finding.message)}`);
  }
  return `${lines.join("\n")}\n`;
};
