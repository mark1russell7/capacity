import type { Law } from "@mark1russell7/capacity";
import { escapeMarkdown } from "@mark1russell7/text";
import { describe, expect, it } from "vitest";
import type { Case } from "./case.ts";
import { expectedOf, gateSummaryOf, planGate, SUMMARY_UNREAD } from "./gate.ts";
import { CASES, EPYC, FAST_PLAN, FLOORS, OPTIONS, OTHER, OVERHEAD, OVERHEAD_SET, jobsOf, overheadJobsOf, overheadRecordOf, recordOf, runOf, timedOf } from "./law-fixtures.ts";
import { lawsOf, type LawJob } from "./laws.ts";
import type { Plan } from "./plan.ts";
import type { CaseRecord } from "./record.ts";

/** These laws are the laws of the plan rate on the AMD EPYC 7763, from five jobs of one CI run. */
const LAWS: readonly Law[] = lawsOf(FAST_PLAN, jobsOf(runOf(1), EPYC, 1), FLOORS, OPTIONS).laws.map((each) => each.law);
const CPU = "node-http/rate/epyc-7763/cpu.request";
const MEMORY = "node-http/rate/epyc-7763/memory";

const LAW_PLAN = FAST_PLAN as unknown as Plan;
const GATE = "gate";
const COST: NonNullable<Case["cost"]> = { value: 100, unit: "us" };

/** This function gives a gate plan with each case of the plan rate. With `cost`, each case adds 100 us to each request. */
const planOf = (cost = false): Plan => ({ id: GATE, cases: CASES.map((value) => (cost ? { ...value, cost: COST } : value)) }) as unknown as Plan;

/** These noise floors are inside their limits. */
const QUIET: Readonly<Record<string, number>> = { "cpu.request.floor": 0.02, "memory.floor": 1_200_000 };

/** This function gives a record of a subject that spends `ms` more CPU time on each request, with the cost of its case. The fixtures fit a line to a hinge, thus the run range is wide. */
const slowerOf = (record: CaseRecord, ms: number): CaseRecord =>
  ms === 0
    ? record
    : {
        ...record,
        case: { ...record.case, cost: { value: ms * 1000, unit: "us" } },
        runs: record.runs.map((run) => {
          const cpu = run.measures["cpu.request"]!;
          return { ...run, measures: { ...run.measures, "cpu.request": { ...cpu, value: cpu.value + ms } } };
        }),
      };

interface JobOptions {
  readonly cpu?: string;
  readonly plan?: string;
  readonly run?: boolean;
  readonly values?: Readonly<Record<string, number>>;
  readonly slower?: number;
}

/** This function gives a job of the gate plan with a record of each case of the plan rate. */
const jobAt = (job: number, options: JobOptions = {}): LawJob => {
  const cpu = options.cpu ?? EPYC;
  const run = options.run === false ? null : runOf(100 + job);
  const timed = timedOf(options.plan ?? GATE, run, cpu, `2026-11-21T06:${String(job).padStart(2, "0")}:00Z`, { values: { ...(options.values ?? QUIET) } });
  return { timed, records: CASES.map((_, index) => slowerOf(recordOf(index, job, cpu), options.slower ?? 0)) };
};

const outcomes = (result: ReturnType<typeof planGate>): readonly (readonly [string, string])[] => result.gate.cases.map((each) => [each.case, each.outcome] as const);

describe("the gate of the laws of a plan", () => {
  it("finds a law of each measure of the fixtures on the AMD EPYC 7763", () => {
    expect(LAWS.map((law) => law.id).sort()).toEqual([CPU, MEMORY]);
  });

  it("passes a gate plan that measures the subject of its laws again", () => {
    const result = planGate(planOf(), LAW_PLAN, [51, 52, 53].map((job) => jobAt(job)), LAWS);
    expect(result.expected).toBe("pass");
    expect(result.gate.outcome).toBe("pass");
    expect(outcomes(result)).toEqual([
      [CPU, "within"],
      [MEMORY, "within"],
    ]);
    expect(result.gate.cases.map((each) => each.jobs.map((job) => job.reads))).toEqual([Array(3).fill(CASES.length), Array(3).fill(CASES.length)]);
    expect(result.unread).toEqual([]);
    expect(result.cpus).toEqual([EPYC, EPYC, EPYC]);
  });

  it("blocks a gate plan with an added cost, and the plan expects the block", () => {
    const result = planGate(planOf(true), LAW_PLAN, [51, 52, 53].map((job) => jobAt(job, { slower: 5 })), LAWS);
    expect(result.expected).toBe("block");
    expect(result.gate.outcome).toBe("block");
    expect(outcomes(result)).toEqual([
      [CPU, "beyond"],
      [MEMORY, "within"],
    ]);
    const cpu = result.gate.cases.find((each) => each.case === CPU)!;
    expect(cpu.jobs.every((job) => job.high === job.reads && job.reads === CASES.length)).toBe(true);
  });

  it("reads no job on a CPU model with no law, no job with a problem, and no job of another plan", () => {
    const jobs = [jobAt(51), jobAt(52), jobAt(53, { cpu: OTHER }), jobAt(54, { run: false }), jobAt(55, { plan: "rate" })];
    const result = planGate(planOf(), LAW_PLAN, jobs, LAWS);
    expect(result.unread.map((each) => each.reason)).toEqual(["The job has no CI run. The evidence of a law is a CI run.", `The plan "rate" has no law on the CPU model "${OTHER}".`]);
    expect(result.cpus).toHaveLength(4);
    expect(result.gate.cases.map((each) => each.jobs.length)).toEqual([2, 2]);
    expect(result.gate.outcome).toBe("pass");
  });

  it("gives no read of the laws of a measure in a job with a noise floor over its limit or with no noise floor", () => {
    const noisy = jobAt(53, { values: { ...QUIET, "cpu.request.floor": 0.2 } });
    const result = planGate(planOf(), LAW_PLAN, [jobAt(51), jobAt(52), noisy, jobAt(54, { values: {} })], LAWS);
    const cpu = result.gate.cases.find((each) => each.case === CPU)!;
    const memory = result.gate.cases.find((each) => each.case === MEMORY)!;
    expect(cpu.jobs).toHaveLength(2);
    expect(cpu.noRead.map((each) => each.reason)).toEqual([
      "The noise floor of cpu.request in the job is 0.200. Its limit is 0.148, thus the runner is too noisy.",
      "The job has no noise floor of cpu.request. A job with no read of its noise gives no read.",
    ]);
    expect(memory.jobs).toHaveLength(3);
    expect(memory.noRead.map((each) => each.reason)).toEqual(["The job has no noise floor of memory. A job with no read of its noise gives no read."]);
  });

  it("gives no read with no job, and with one job for each law", () => {
    const none = planGate(planOf(), LAW_PLAN, [], LAWS);
    expect(none.gate.outcome).toBe("no read");
    expect(none.gate.cases).toEqual([]);
    const one = planGate(planOf(), LAW_PLAN, [jobAt(51)], LAWS);
    expect(one.gate.outcome).toBe("no read");
    expect(outcomes(one)).toEqual([
      [CPU, "cannot decide"],
      [MEMORY, "cannot decide"],
    ]);
  });

  it("leaves out a record with a subject that differs from the subject of the law", () => {
    const job = jobAt(51);
    const last = job.records.at(-1)!;
    const changed = { ...job, records: [...job.records.slice(0, -1), { ...last, case: { ...last.case, subject: "other" } }] };
    const result = planGate(planOf(), LAW_PLAN, [changed, jobAt(52)], LAWS);
    const cpu = result.gate.cases.find((each) => each.case === CPU)!;
    expect(cpu.jobs.map((each) => each.reads)).toEqual([CASES.length - 1, CASES.length]);
    expect(cpu.jobs[0]!.unread).toEqual([`${last.case.id}: the case differs from the conditions of the law in subject.`]);
  });

  it("throws for a plan of the laws with no law set", () => {
    expect(() => planGate(planOf(), { id: "floor" } as unknown as Plan, [], LAWS)).toThrow(RangeError);
  });
});

describe("the outcome that a gate plan expects", () => {
  it("expects a pass with no cost and a block with a cost", () => {
    expect(expectedOf(planOf())).toBe("pass");
    expect(expectedOf(planOf(true))).toBe("block");
  });
});

describe("the summary of the gate of a plan", () => {
  it("tells the outcome against the expected outcome, each law and each job that no law reads", () => {
    const pass = gateSummaryOf(planGate(planOf(), LAW_PLAN, [jobAt(51), jobAt(52), jobAt(53, { cpu: OTHER })], LAWS));
    expect(pass).toContain("## The gate of the plan gate\n");
    expect(pass).toContain("It adds no cost, thus the gate must pass. The gate gives **pass**.");
    expect(pass).toContain(`| ${escapeMarkdown(CPU)} | within | 2 | ${2 * CASES.length} | `);
    expect(pass).toContain(escapeMarkdown(`no law on the CPU model "${OTHER}".`));
    const wrong = gateSummaryOf(planGate(planOf(true), LAW_PLAN, [jobAt(51), jobAt(52)], LAWS));
    expect(wrong).toContain("thus the gate must block. The gate gives **pass**, not **block**.");
  });

  it(`shows at most ${SUMMARY_UNREAD} reads that the laws left out, and the count of the others`, () => {
    const other = (job: LawJob): LawJob => ({ ...job, records: job.records.map((record, index) => (index === 0 ? record : { ...record, case: { ...record.case, subject: "other" } })) });
    const summary = gateSummaryOf(planGate(planOf(), LAW_PLAN, [other(jobAt(51)), other(jobAt(52))], LAWS));
    const left = 2 * 2 * (CASES.length - 1);
    expect(summary).toContain(`Reads that the laws left out: ${left}.`);
    expect(summary).toContain(`- and ${left - SUMMARY_UNREAD} more`);
  });
});

describe("the gate of the overhead laws of the service runner", () => {
  const PLAN_OVERHEAD = { id: "overhead", laws: OVERHEAD_SET };
  const OVERHEAD_LAWS: readonly Law[] = lawsOf(PLAN_OVERHEAD, overheadJobsOf(EPYC), FLOORS, OPTIONS).laws.map((each) => each.law);
  const LAW_PLAN_OVERHEAD = PLAN_OVERHEAD as unknown as Plan;
  const OVERHEAD_CASES = OVERHEAD.cases as readonly Case[];
  const ID = (measure: string): string => `node-http-service/overhead/epyc-7763/${measure}.overhead`;
  const QUIET_ALL = { ...QUIET, "memory.high.floor": 1_200_000 };

  /** This function gives the gate plan with each pair of the plan overhead. With `cost`, each case of the service side adds 100 µs to each request. */
  const overheadPlanOf = (cost = false): Plan =>
    ({ id: GATE, cases: OVERHEAD_CASES.map((value) => (cost && value.subject === "node-http-service" ? { ...value, cost: COST } : value)) }) as unknown as Plan;

  /** This function gives a job of the gate plan with a record of each case of the plan overhead. The service side spends `slower` ms more on each request. */
  const overheadJobAt = (job: number, slower = 0, edit: (records: readonly CaseRecord[]) => readonly CaseRecord[] = (records) => records): LawJob => ({
    timed: timedOf(GATE, runOf(200 + job), EPYC, `2026-11-24T06:${String(job).padStart(2, "0")}:00Z`, { values: QUIET_ALL }),
    records: edit(OVERHEAD_CASES.map((value, index) => {
      const record = overheadRecordOf(value, index, job, EPYC);
      return value.subject === "node-http-service" ? slowerOf(record, slower) : record;
    })),
  });

  it("reads each pair of a job as the value of the service side less the value of the bare side, and passes the runner of the laws", () => {
    const result = planGate(overheadPlanOf(), LAW_PLAN_OVERHEAD, [1, 2, 3].map((job) => overheadJobAt(job)), OVERHEAD_LAWS);
    expect(result.expected).toBe("pass");
    expect(result.unread).toEqual([]);
    expect(outcomes(result)).toEqual([
      [ID("cpu.request"), "within"],
      [ID("memory.high"), "within"],
      [ID("memory"), "within"],
    ]);
    expect(result.gate.cases.map((each) => each.jobs.map((job) => job.reads))).toEqual(Array(3).fill(Array(3).fill(OVERHEAD_CASES.length / 2)));
    expect(result.gate.cases.every((each) => each.jobs.every((job) => job.unread.length === 0))).toBe(true);
    expect(result.gate.outcome).toBe("pass");
  });

  it("blocks a runner with an added cost on the service side, and the plan expects the block", () => {
    const result = planGate(overheadPlanOf(true), LAW_PLAN_OVERHEAD, [1, 2, 3].map((job) => overheadJobAt(job, 5)), OVERHEAD_LAWS);
    expect(result.expected).toBe("block");
    expect(result.gate.cases.find((each) => each.case === ID("cpu.request"))?.outcome).toBe("beyond");
    expect(result.gate.outcome).toBe("block");
  });

  it("gives no read of a pair with no base side, with another base subject or with another load", () => {
    const at = (id: string, records: readonly CaseRecord[]): CaseRecord => records.find((record) => record.case.id === id)!;
    const edit = (records: readonly CaseRecord[]): readonly CaseRecord[] =>
      records
        .filter((record) => record.case.id !== "overhead/100/bare")
        .map((record) => (record.case.id === "overhead/500/bare" ? { ...record, case: { ...record.case, subject: "other" } } : record))
        .map((record) => (record.case.id === "overhead/1000/bare" ? { ...record, case: { ...at("overhead/1000/bare", records).case, duration: { value: 2, unit: "s" } } } : record));
    const result = planGate(overheadPlanOf(), LAW_PLAN_OVERHEAD, [overheadJobAt(1, 0, edit), overheadJobAt(2)], OVERHEAD_LAWS);
    const cpu = result.gate.cases.find((each) => each.case === ID("cpu.request"))!;
    expect(cpu.jobs.map((each) => each.reads)).toEqual([OVERHEAD_CASES.length / 2 - 3, OVERHEAD_CASES.length / 2]);
    expect(cpu.jobs[0]!.unread).toEqual([
      'overhead/100/service: the job has no record of its base side "overhead/100/bare".',
      "overhead/500/bare: the base side has the subject other. The law is an overhead over node-http.",
      "overhead/1000/bare: the base side differs from the case overhead/1000/service in duration.",
    ]);
  });
});
