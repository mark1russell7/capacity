import { err, ok, type Result } from "@mark1russell7/optional";
import { gateOf, type Gate, type GateCaseOutcome, type LimitOutcome } from "@mark1russell7/rigor-bench";
import { binomialTest, holm, partialConjunction } from "@mark1russell7/rigor-statistics";
import { DEFAULT_LEVEL, type Law, type LawProblem } from "./law.ts";
import { lawValue, type LevelOptions, type LoadPoint, type Range } from "./value.ts";

/** This level is the level of the family of tests of a gate: the chance of one false block or more in one run of the gate. */
export const GATE_ALPHA = 0.01;

/**
 * This count is the jobs that each must show the same side before the gate blocks. One job on a slow runner
 * cannot block alone. It is the default of `jobs` of `notSlowerVerdict` of `@mark1russell7/rigor-bench`.
 */
export const GATE_JOBS = 2;

/** The side of a measured value against the run range of its law. */
export type ReadSide = "within" | "high" | "low";

/** A law read tells where one measured value falls against the run range of its law at one load point. */
export interface LawRead {
  readonly value: number;
  /** This range is the range `run` of `lawValue`: where one measured run falls. */
  readonly run: Range;
  readonly side: ReadSide;
}

const problem = (code: LawProblem["code"], path: string, message: string): LawProblem => ({ code, path, message });

/**
 * This function tells where one measured value falls against the run range of a law at a load point. The range is
 * the range `run` of `lawValue`. A value above the range is `high`, and a value below it is `low`.
 *
 * The function gives a problem for a point outside the range of a variable, because there the law has no value to
 * compare. It also gives each problem of `lawValue`, and a problem for a value that is not finite.
 */
export const lawRead = (law: Law, point: LoadPoint, value: number, options: LevelOptions = {}): Result<LawRead, LawProblem> => {
  if (!Number.isFinite(value)) return err(problem("value", "value", `The measured value ${value} is not finite.`));
  const found = lawValue(law, point, options);
  if (found.tag === "err") return found;
  const [outside] = found.value.outside;
  if (outside !== undefined) {
    const variable = law.variables.find((each) => each.id === outside);
    const range = variable === undefined ? "" : ` from ${variable.min} to ${variable.max}`;
    return err(problem("point", outside, `The point is outside the range of the variable "${outside}"${range}. The law has no value there to compare.`));
  }
  const { run } = found.value;
  return ok({ value, run, side: value > run.high ? "high" : value < run.low ? "low" : "within" });
};

/** A gate read is one measured value of one job at one load point. */
export interface GateRead {
  readonly point: LoadPoint;
  readonly value: number;
}

/**
 * A gate job is the reads of one job for one law. A job with a reason in `noRead` gives no read, for example a job with a
 * noise floor over its limit. The caller gives only the reads in the conditions of the law.
 */
export interface GateJob {
  /** This name is the name of the job, for example the address of its CI run and its start. */
  readonly job: string;
  readonly reads: readonly GateRead[];
  readonly noRead?: string;
  /** These texts tell each read that the caller left out, for example a point that the law leaves out. The counts do not use them. */
  readonly unread?: readonly string[];
}

/** A gate case is one law and the jobs that measured its subject in its conditions. */
export interface GateCase {
  readonly law: Law;
  readonly jobs: readonly GateJob[];
}

/** These options set the level of the run range, the level of the family of tests and the count of jobs of a side. */
export interface LawGateOptions extends LevelOptions {
  /** This level is the level of the family of tests. The default is `GATE_ALPHA`. */
  readonly alpha?: number;
  /** This count is the jobs that each must show a side. The default is `GATE_JOBS`. */
  readonly jobs?: number;
}

/** A job count tells the reads of one job for one law, and the p of the count of each side. */
export interface JobCount {
  readonly job: string;
  /** This count is the reads in the range of the law. */
  readonly reads: number;
  readonly high: number;
  readonly low: number;
  /** This p is the p of the binomial test of the count `high`, with the chance of one side under the claim. */
  readonly pHigh: number;
  readonly pLow: number;
  /** These texts tell each read that the caller left out (`GateJob.unread`), and each read that the law cannot compare. */
  readonly unread: readonly string[];
}

/** A side test is the test of one side of one law over the jobs, after the Holm correction of the family. */
export interface SideTest {
  readonly side: "high" | "low";
  /** This p is the p of the claim "`jobs` jobs or more show this side" (`partialConjunction`). */
  readonly p: number;
  /** This p is the p after the Holm correction of the family. */
  readonly adjusted: number;
  readonly reject: boolean;
}

/** A job with no read tells the job and the reason. */
export interface NoReadJob {
  readonly job: string;
  readonly reason: string;
}

/** A law gate case is the outcome of one law, with the counts of each job and the test of each side. */
export interface LawGateCase extends GateCaseOutcome {
  /** This name is the id of the law. */
  readonly case: string;
  readonly outcome: LimitOutcome;
  /** This text tells the reason of the outcome, in one sentence. */
  readonly reason: string;
  readonly jobs: readonly JobCount[];
  readonly noRead: readonly NoReadJob[];
  /** These tests are the two sides, or an empty list for a case with too few jobs. */
  readonly sides: readonly SideTest[];
}

/** A law gate is the gate of `@mark1russell7/rigor-bench` over the laws, with the facts that it uses. */
export interface LawGate extends Gate {
  readonly level: number;
  readonly alpha: number;
  /** This count is the jobs that each must show a side. */
  readonly need: number;
  /** This chance is the chance of one side for one read of a job that agrees with its law: `(1 - level) / 2`. */
  readonly share: number;
  readonly cases: readonly LawGateCase[];
}

/** This function gives the text of a number with at most 3 significant digits. */
const short = (value: number): string => (Number.isInteger(value) ? String(value) : value.toPrecision(3));

/** This function gives the counts of one job for one law, or the reason that the job gives no read. */
const countOf = (law: Law, job: GateJob, level: number, share: number): JobCount | NoReadJob => {
  if (job.noRead !== undefined) return { job: job.job, reason: job.noRead };
  let high = 0;
  let low = 0;
  let reads = 0;
  const unread: string[] = [...(job.unread ?? [])];
  for (const each of job.reads) {
    const found = lawRead(law, each.point, each.value, { level });
    if (found.tag === "err") {
      unread.push(`${JSON.stringify(each.point)}: ${found.error.message}`);
      continue;
    }
    reads += 1;
    if (found.value.side === "high") high += 1;
    if (found.value.side === "low") low += 1;
  }
  if (reads === 0) return { job: job.job, reason: `The job has no read in the range of the law. ${unread[0] ?? "The job has no read."}` };
  return { job: job.job, reads, high, low, pHigh: binomialTest(high, reads, share, "greater"), pLow: binomialTest(low, reads, share, "greater"), unread };
};

/** The counts of one case before the family test. */
interface Counted {
  readonly law: Law;
  readonly jobs: readonly JobCount[];
  readonly noRead: readonly NoReadJob[];
}

/**
 * This function gives the gate of some laws: for each law, do the measured values of the jobs stay in the run range of
 * the law? It is the rule of a gate of the laws of a subject, for example on a pull request.
 *
 * - **A read:** each value of a job falls `within`, `high` or `low` against the run range of its law (`lawRead`).
 *   A read of a job that agrees with its law falls on one side with a chance of `share`, `(1 - level) / 2`, or less.
 * - **A job:** for each side, the binomial test of the count of reads on that side gives the p of the job.
 *   A job with `noRead`, or with no read in the range of the law, gives no read.
 * - **A side:** `partialConjunction` joins the p of the jobs for the claim "`jobs` jobs or more show this side". Thus one
 *   job on an odd runner cannot block alone. The claim has no condition on how the reads of one job depend on each other.
 * - **The family:** `holm` corrects the tests of the two sides of each law at the level `alpha`. A rejected side makes the
 *   case `beyond`. A low side is a block too: the law is no longer the law of the subject, and a new fit must replace it.
 * - **No read:** a case with fewer than `jobs` jobs that read is `cannot decide`. So is a case whose reads are too few to
 *   reject a side, also with each read on that side. The gate of `@mark1russell7/rigor-bench` (`gateOf`) joins the cases.
 *   A gate with no case, or with a case that cannot decide and no block, is "no read", never a pass.
 *
 * The function throws a `RangeError` for a level, an alpha or a count of jobs that is not valid.
 */
export const lawGate = (cases: readonly GateCase[], options: LawGateOptions = {}): LawGate => {
  const level = options.level ?? DEFAULT_LEVEL;
  const alpha = options.alpha ?? GATE_ALPHA;
  const need = options.jobs ?? GATE_JOBS;
  if (!(level > 0 && level < 1)) throw new RangeError(`The level ${level} is not between 0 and 1.`);
  if (!(alpha > 0 && alpha < 1)) throw new RangeError(`The alpha ${alpha} is not between 0 and 1.`);
  if (!Number.isInteger(need) || need < 1) throw new RangeError(`The count of jobs ${need} is not a whole number above 0.`);
  const share = (1 - level) / 2;

  const counted: Counted[] = cases.map(({ law, jobs }) => {
    const found = jobs.map((job) => countOf(law, job, level, share));
    return { law, jobs: found.filter((each): each is JobCount => "reads" in each), noRead: found.filter((each): each is NoReadJob => "reason" in each) };
  });
  const decidable = counted.filter((each) => each.jobs.length >= need);
  const tests = decidable.length * 2;
  const pOf = (jobs: readonly JobCount[], side: "high" | "low"): number => partialConjunction(jobs.map((job) => (side === "high" ? job.pHigh : job.pLow)), need);
  const corrected = holm(
    decidable.flatMap((each) => [pOf(each.jobs, "high"), pOf(each.jobs, "low")]),
    alpha,
  );

  let next = 0;
  const outcomes: LawGateCase[] = counted.map(({ law, jobs, noRead }) => {
    const base = { case: law.id, jobs, noRead };
    if (jobs.length < need) {
      const reason = `${jobs.length} jobs read the law. The gate needs ${need} jobs or more.${noRead.length > 0 ? ` ${noRead[0]!.reason}` : ""}`;
      return { ...base, outcome: "cannot decide", reason, sides: [] };
    }
    const sides: SideTest[] = (["high", "low"] as const).map((side) => {
      const test = corrected[next];
      next += 1;
      return { side, p: test?.p ?? 1, adjusted: test?.adjusted ?? 1, reject: test?.reject ?? false };
    });
    // The best p of a side is the p with each read on that side. Above the first step of Holm, no count can reject the side.
    const best = partialConjunction(jobs.map((job) => binomialTest(job.reads, job.reads, share, "greater")), need);
    const reads = jobs.reduce((sum, job) => sum + job.reads, 0);
    const high = jobs.reduce((sum, job) => sum + job.high, 0);
    const low = jobs.reduce((sum, job) => sum + job.low, 0);
    const counts = `${high} of ${reads} reads in ${jobs.length} jobs are above the run range and ${low} are below`;
    const rejected = sides.find((side) => side.reject);
    if (rejected !== undefined) {
      const what = rejected.side === "high" ? "The measure is above its law" : "The measure is below its law: the law is out of date, and a new fit must replace it";
      return { ...base, outcome: "beyond", reason: `${what}. ${counts}. The adjusted p is ${short(rejected.adjusted)}, below ${alpha}.`, sides };
    }
    if (best > alpha / tests) {
      const reason = `The reads are too few to reject a side: with each read on one side, the p is ${short(best)}, above ${short(alpha / tests)}.`;
      return { ...base, outcome: "cannot decide", reason, sides };
    }
    return { ...base, outcome: "within", reason: `${counts}, as the chance ${short(share)} of each side gives.`, sides };
  });
  return { ...gateOf(outcomes), level, alpha, need, share, cases: outcomes };
};
