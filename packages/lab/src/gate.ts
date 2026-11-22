import { lawGate, type GateJob, type GateRead, type Law, type LawGate, type LawGateOptions, type NoReadJob } from "@mark1russell7/capacity";
import { cpuEntry } from "@mark1russell7/rigor-bench";
import { escapeMarkdown } from "@mark1russell7/text";
import { caseCost } from "./case.ts";
import type { Check } from "./check.ts";
import { FLOOR_IDS, FLOOR_LIMITS, floorCheck } from "./floor.ts";
import { CPU_IDS, jobName, jobProblem, lawDifferences, lawPointOf, type CutPoint, type LawJob, type LawMeasure, type LawSet } from "./laws.ts";
import type { Plan } from "./plan.ts";
import { rateCheck } from "./rate.ts";
import { worstLag } from "./reads.ts";
import { RECORD_FORMAT, type CaseRecord } from "./record.ts";
import { isStartCase } from "./start.ts";
import type { Timed } from "./timed.ts";

/** This function tells if a record is a record of a case of the A/A pairs of the plan `floor`. */
const isFloor = (record: CaseRecord): boolean => FLOOR_IDS.includes(record.case.id);

/**
 * This check is the check of a gate plan. A gate plan has the A/A pairs of the plan `floor` and some cases of the plan of
 * its laws, on one runner.
 *
 * - The A/A pairs give the values and the problems of the check `floor`, other than its limits. A noise floor over its
 *   limit is not a problem of the job. The gate of the laws gives no read of the job for the laws of that measure (`planGate`).
 * - The other cases give the values and the problems of the check `rate`.
 * - `lag.max.worst` is the largest lag of the driver in a run of each case.
 */
export const gateCheck: Check = (records) => {
  const floor = floorCheck(records.filter(isFloor));
  const load = rateCheck(records.filter((record) => !isFloor(record)));
  const values: Record<string, number> = { ...floor.values, ...load.values };
  const lag = worstLag(records);
  if (lag === undefined) delete values["lag.max.worst"];
  else values["lag.max.worst"] = lag;
  return { values, problems: [...floor.problems.filter((each) => each.code !== "limit"), ...load.problems] };
};

/** The outcome that a gate plan expects. */
export type GateExpected = "pass" | "block";

/**
 * This function gives the outcome that a gate plan expects. A plan with an added cost in a case (`caseCost`) is a slower
 * subject, thus its gate must block. Each other plan measures the subject of its laws, thus its gate must pass.
 */
export const expectedOf = (plan: Plan): GateExpected => (plan.cases.some((value) => !isStartCase(value) && caseCost(value) > 0) ? "block" : "pass");

/** A plan gate is the gate of the laws of one gate plan, from the jobs of the plan. */
export interface PlanGate {
  readonly plan: string;
  /** This id is the id of the plan of the laws. */
  readonly laws: string;
  readonly expected: GateExpected;
  readonly gate: LawGate;
  /** These jobs are the jobs that no law reads: a job with a problem, or a job on a CPU model with no law. */
  readonly unread: readonly NoReadJob[];
  /** These names are the CPU model of each job of the plan with a machine, in the order of the jobs. */
  readonly cpus: readonly string[];
}

/** This function gives the order of two texts by their code units. It does not change with the locale. */
const order = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** This function gives the text of a number with at most 3 significant digits. */
const short = (value: number): string => (Number.isInteger(value) ? String(value) : value.toPrecision(3));

/** This function gives the text of a point that a rule of a law leaves out. */
const cutText = (cut: CutPoint, measure: LawMeasure): string =>
  cut.rule === "served"
    ? `${cut.case}: the subject served ${short(cut.served)} of the offered rate. The law reads only a point with ${measure.served ?? 0} or more.`
    : `${cut.case}: a run has ${cut.count} arrivals. The tail of the law needs ${cut.need} or more.`;

/** This function gives the measure of a law with the rules `served` and `tail` of the law file: the rules of its fit. */
const rulesOf = (measure: LawMeasure, law: Law): LawMeasure => {
  const served = law.conditions["served"];
  const tail = law.conditions["tail"];
  const rules = { ...(typeof served === "number" ? { served } : {}), ...(typeof tail === "number" ? { tail } : {}) };
  return { id: measure.id, title: measure.title, residual: measure.residual, ...rules };
};

/**
 * This function gives the job of one law: a read of each record in the conditions of the law, or the reason of no read.
 * A noise floor of the job over its limit (`FLOOR_LIMITS`), a job with no noise floor and an overhead law give no read.
 */
const gateJobOf = (set: LawSet, law: Law, job: string, timed: Timed, records: readonly CaseRecord[]): GateJob => {
  if (set.base !== undefined) return { job, reads: [], noRead: "The gate does not read an overhead law. The read of the two sides of each pair is CAP-33." };
  const measure = set.measures.find((each) => each.id === law.measure.id);
  if (measure === undefined) return { job, reads: [], noRead: `The law set of the plan has no measure "${law.measure.id}".` };
  const floor = timed.verdict.values[`${measure.id}.floor`];
  const limit = FLOOR_LIMITS[measure.id];
  if (floor === undefined || !Number.isFinite(floor)) return { job, reads: [], noRead: `The job has no noise floor of ${measure.id}. A job with no read of its noise gives no read.` };
  if (floor > limit) return { job, reads: [], noRead: `The noise floor of ${measure.id} in the job is ${short(floor)}. Its limit is ${limit}, thus the runner is too noisy.` };
  const rules = rulesOf(measure, law);
  const reads: GateRead[] = [];
  const unread: string[] = [];
  for (const record of records) {
    const changed = lawDifferences(law, record, set);
    if (changed.length > 0) {
      unread.push(`${record.case.id}: the case differs from the conditions of the law in ${changed.join(", ")}.`);
      continue;
    }
    const found = lawPointOf(set, rules, record, job);
    if ("rule" in found) unread.push(cutText(found, rules));
    else if ("code" in found) unread.push(`${found.path}: ${found.message}`);
    else reads.push({ point: { [set.variable.id]: found.x }, value: found.value });
  }
  return { job, reads, unread };
};

/**
 * This function gives the gate of the laws of a gate plan. The plan measures the subject again at some points of the laws
 * of the plan `lawPlan`. The gate compares each measured value with the run range of its law (`lawGate` of
 * `@mark1russell7/capacity`).
 *
 * - **The jobs:** each job of the plan with no problem (`jobProblem`) gives the reads of its cases of load. The A/A pairs
 *   give only the noise of the job.
 * - **The laws:** a job reads each law of its CPU model, with the id `<subject>/<plan of the laws>/<cpu>/<measure>`.
 *   A job on a CPU model with no law goes into `unread`. A law with no job is not a case of the gate.
 * - **The noise:** a job with a noise floor of a measure over its limit gives no read of the laws of that measure.
 * - **The reads:** a record must have the subject and the conditions of the law (`lawDifferences`). A point that the
 *   rules of the law leave out (`served`, `tail`) gives no read. Each such record goes into the list `unread` of its job.
 * - **No read:** a gate with no case, or with too few jobs for a case, is "no read". It does not pass (`lawGate`).
 *
 * The function throws a `RangeError` for a plan of the laws with no law set.
 */
export const planGate = (plan: Plan, lawPlan: Plan, jobs: readonly LawJob[], laws: readonly Law[], options: LawGateOptions = {}): PlanGate => {
  const set = lawPlan.laws;
  if (set === undefined) throw new RangeError(`The plan "${lawPlan.id}" has no law set.`);
  const own = jobs.filter((each) => each.timed.plan === plan.id).sort((a, b) => order(jobName(a.timed), jobName(b.timed)));
  const unread: NoReadJob[] = [];
  const cpus: string[] = [];
  const byLaw = new Map<string, GateJob[]>();
  for (const { timed, records: all } of own) {
    const job = jobName(timed);
    if (timed.machine !== null) cpus.push(timed.machine.cpu);
    const records = all.filter((record) => record.format === RECORD_FORMAT && !isFloor(record));
    const why = jobProblem(plan.id, timed, records);
    if (why !== null || timed.machine === null) {
      unread.push({ job, reason: why ?? "The manifest of the job has no machine." });
      continue;
    }
    const cpu = timed.machine.cpu;
    const model = cpuEntry(CPU_IDS, cpu).value;
    const base = `${records[0]?.case.subject ?? ""}/${lawPlan.id}/${model ?? ""}/`;
    const found = model === null ? [] : laws.filter((law) => law.id.startsWith(base));
    if (found.length === 0) {
      unread.push({ job, reason: `The plan "${lawPlan.id}" has no law on the CPU model "${cpu}".` });
      continue;
    }
    for (const law of found) byLaw.set(law.id, [...(byLaw.get(law.id) ?? []), gateJobOf(set, law, job, timed, records)]);
  }
  const cases = laws
    .filter((law) => byLaw.has(law.id))
    .sort((a, b) => order(a.id, b.id))
    .map((law) => ({ law, jobs: byLaw.get(law.id) ?? [] }));
  return { plan: plan.id, laws: lawPlan.id, expected: expectedOf(plan), gate: lawGate(cases, options), unread, cpus };
};

/** This count is the most reads of the summary that the laws left out. The summary tells the count of the others. */
export const SUMMARY_UNREAD = 12;

/** This function gives the text of a p in a cell of a table. */
const pText = (value: number | undefined): string => (value === undefined ? "" : value < 1e-4 ? value.toExponential(1) : short(value));

/**
 * This function gives the summary of the gate of a plan in Markdown. It tells the outcome and the expected outcome, with a
 * row for each law. It lists each job that no law reads, each job with no read of a law, and the first reads that the laws left out.
 */
export const gateSummaryOf = (result: PlanGate): string => {
  const { gate } = result;
  const good = gate.outcome === result.expected;
  const lines = [
    `## The gate of the plan ${result.plan}`,
    "",
    `The plan measures the subject again at points of the laws of the plan ${result.laws}. ${
      result.expected === "block" ? "It adds a cost to each request, thus the gate must block." : "It adds no cost, thus the gate must pass."
    } The gate gives **${gate.outcome}**${good ? "." : `, not **${result.expected}**.`}`,
    "",
    `The run range has the level ${gate.level}. The family of tests has the level ${gate.alpha}. A side needs ${gate.need} jobs or more.`,
    "",
  ];
  if (gate.cases.length > 0) {
    lines.push("| Law | Outcome | Jobs | Reads | Above | Below | Adjusted p above | Adjusted p below | Reason |", "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |");
    for (const each of gate.cases) {
      const sum = (pick: (job: (typeof each.jobs)[number]) => number): number => each.jobs.reduce((total, job) => total + pick(job), 0);
      const [high, low] = [each.sides.find((side) => side.side === "high"), each.sides.find((side) => side.side === "low")];
      const cells = [
        escapeMarkdown(each.case),
        each.outcome,
        String(each.jobs.length),
        String(sum((job) => job.reads)),
        String(sum((job) => job.high)),
        String(sum((job) => job.low)),
        pText(high?.adjusted),
        pText(low?.adjusted),
        escapeMarkdown(each.reason),
      ];
      lines.push(`| ${cells.join(" | ")} |`);
    }
    lines.push("");
  }
  if (result.unread.length > 0) {
    lines.push("Jobs that no law reads:", "", ...result.unread.map((each) => `- ${escapeMarkdown(each.job)}: ${escapeMarkdown(each.reason)}`), "");
  }
  const noRead = gate.cases.flatMap((each) => each.noRead.map((job) => `- ${escapeMarkdown(each.case)}, ${escapeMarkdown(job.job)}: ${escapeMarkdown(job.reason)}`));
  if (noRead.length > 0) lines.push("Jobs with no read of a law:", "", ...noRead, "");
  const left = gate.cases.flatMap((each) => each.jobs.flatMap((job) => job.unread.map((text) => `- ${escapeMarkdown(each.case)}, ${escapeMarkdown(job.job)}: ${escapeMarkdown(text)}`)));
  if (left.length > 0) {
    lines.push(`Reads that the laws left out: ${left.length}.`, "", ...left.slice(0, SUMMARY_UNREAD));
    if (left.length > SUMMARY_UNREAD) lines.push(`- and ${left.length - SUMMARY_UNREAD} more`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
};
