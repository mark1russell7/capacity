import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkLaw, type Run } from "@mark1russell7/capacity";
import { readLaw } from "@mark1russell7/capacity/schema";
import { escapeMarkdown } from "@mark1russell7/text";
import { describe, expect, it } from "vitest";
import type { Case } from "./case.ts";
import { FLOOR_MEASURES } from "./floor.ts";
import { CPU_IDS, conditionsOf, lawSetProblems, lawsOf, lawsSummaryOf, type LawJob, type LawSet } from "./laws.ts";
import { readPlans } from "./plan.ts";
import type { CaseRecord, RunRecord } from "./record.ts";
import { isStartCase } from "./start.ts";
import { TIMED_FORMAT, type Timed } from "./timed.ts";

/** The record of the case control/base of the Lab run 44453927945 on main: 3 runs of the bare request. */
const BASE = JSON.parse(readFileSync(new URL("../test/fixtures/control-base.record.json", import.meta.url), "utf8")) as CaseRecord;

const RATE = readPlans(fileURLToPath(new URL("../plans/", import.meta.url))).plans.find((each) => each.id === "rate")!;
const CASES = RATE.cases as readonly Case[];

const EPYC = "AMD EPYC 7763 64-Core Processor";
const XEON = "Intel(R) Xeon(R) 6975P-C";
const OTHER = "AMD Ryzen 9 7950X 16-Core Processor";

/** The true law of the CPU time of one request: a hinge with its knee at 2100 requests each second. */
const KNEE = 2100;
const cpuOf = (rate: number): number => 0.2 + 0.000_01 * rate + 0.000_05 * Math.max(0, rate - KNEE);

/** This function gives a number from -1 to 1 for three counts. It needs no random source. */
const wave = (a: number, b: number, c: number): number => ((a * 7919 + b * 104_729 + c * 1_299_709) % 2001) / 1000 - 1;

/** A set of two measures with two forms, so that each test fits fast. */
const SET: LawSet = {
  ...RATE.laws!,
  measures: [
    { id: "cpu.request", title: "The CPU time of one request", residual: "relative", forms: ["linear", "hinge"] },
    { id: "memory", title: "The memory of the subject at the end of a run", residual: "relative", forms: ["constant", "linear"] },
  ],
};
const PLAN = { id: "rate", laws: SET };

/** This function gives the record of the case `index` of the plan rate in the job `job`, on the CPU model `cpu`. */
const recordOf = (index: number, job: number, cpu: string): CaseRecord => {
  const value = CASES[index]!;
  const rate = value.demand.classes[0]!.rate.value;
  return {
    ...BASE,
    case: value,
    machine: { ...BASE.machine, cpu },
    runs: BASE.runs.map((run, r) => ({
      ...run,
      measures: {
        ...run.measures,
        "cpu.request": { value: cpuOf(rate) * (1 + 0.01 * wave(index, job, r)), unit: "{core}·ms/{request}" },
        memory: { value: 30_000_000 * (1 + 0.001 * wave(index, job, r + 3)), unit: "B" },
        "memory.high": { value: 31_000_000 * (1 + 0.001 * wave(index, job, r + 6)), unit: "B" },
        "latency.p50": { value: 0.3 * (1 + rate / 36_000) * (1 + 0.02 * wave(index, job, r + 9)), unit: "ms" },
        "latency.p90": { value: 0.5 * (1 + rate / 18_000) * (1 + 0.02 * wave(index, job, r + 12)), unit: "ms" },
        "latency.p99": { value: 0.9 * (1 + rate / 9_000) * (1 + 0.02 * wave(index, job, r + 15)), unit: "ms" },
      },
    })),
  };
};

const runOf = (id: number): Run => ({ url: `https://github.com/mark1russell7/capacity/actions/runs/${id}`, commit: "0123456789abcdef0123456789abcdef01234567", date: "2026-11-20T06:00:00Z" });

/** This function gives the manifest of a job. */
const timedOf = (plan: string, run: Run | null, cpu: string, started: string, verdict: Partial<Timed["verdict"]> = {}): Timed => ({
  format: TIMED_FORMAT,
  plan,
  run,
  attempt: run === null ? null : 1,
  machine: { ...BASE.machine, cpu },
  at: { started, ended: started },
  files: [],
  verdict: { check: plan === "floor" ? "floor" : "rate", values: {}, problems: [], ...verdict },
});

/** This function gives a job of the plan rate with a record of each case. */
const jobOf = (run: Run | null, cpu: string, job: number, verdict: Partial<Timed["verdict"]> = {}): LawJob => ({
  timed: timedOf("rate", run, cpu, `2026-11-20T06:0${job}:00Z`, verdict),
  records: CASES.map((_, index) => recordOf(index, job, cpu)),
});

/** This function gives two jobs of the plan rate in one CI run, on one CPU model. */
const twoJobs = (run: Run, cpu: string, first: number): readonly LawJob[] => [jobOf(run, cpu, first), jobOf(run, cpu, first + 1)];

/** This function gives a floor job with the floor `scale` times a base floor for each measure. */
const floorOf = (run: Run, cpu: string, scale: number, problems: Timed["verdict"]["problems"] = []): Timed =>
  timedOf("floor", run, cpu, "2026-11-20T05:00:00Z", {
    values: Object.fromEntries(FLOOR_MEASURES.map((name) => [`${name}.floor`, name === "memory" ? 1_000_000 * scale : 0.01 * scale])),
    problems,
  });

const FLOORS = [floorOf(runOf(10), EPYC, 1), floorOf(runOf(11), "AMD EPYC 9V45 96-Core Processor", 3), floorOf(runOf(12), XEON.replace("6975P-C", "Platinum 8573C"), 2)];
const OPTIONS = { runs: 40, seed: 1 };

describe("the laws of a plan", () => {
  it("gives a law of each measure on each CPU model, with its evidence, its noise and the forms that lost", () => {
    const jobs = [...twoJobs(runOf(1), EPYC, 1), ...twoJobs(runOf(2), XEON, 3)];
    const { laws, skipped, problems } = lawsOf(PLAN, jobs, FLOORS, OPTIONS);
    expect(problems).toEqual([]);
    expect(skipped).toEqual([]);
    expect(laws.map(({ law }) => law.id)).toEqual([
      "node-http/rate/epyc-7763/cpu.request",
      "node-http/rate/epyc-7763/memory",
      "node-http/rate/xeon-6975p-c/cpu.request",
      "node-http/rate/xeon-6975p-c/memory",
    ]);
    for (const { law, ranks } of laws) {
      expect(checkLaw(law)).toEqual([]);
      expect(ranks[0]?.form).toBe(law.form.id);
      expect(law.variables).toEqual([{ id: "rate", unit: "{request}/s", min: 100, max: 36000, scale: "log" }]);
      expect(law.fit.losers).toHaveLength(1);
      expect(law.replicates).toHaveLength(40);
    }
    const [epyc, , xeon] = laws.map(({ law }) => law);
    // two jobs of one CI run give one run of the evidence, and twice the points
    expect(epyc!.evidence.runs).toEqual([runOf(1)]);
    expect(epyc!.fit.residuals).toHaveLength(2 * CASES.length);
    expect(xeon!.evidence.runs).toEqual([runOf(2)]);
    expect(xeon!.fit.residuals).toHaveLength(2 * CASES.length);
    expect(epyc!.form.id).toBe("hinge");
    const knee = epyc!.constants.find((constant) => constant.id === "knee")!.value;
    expect(Math.abs(knee - KNEE) / KNEE).toBeLessThan(0.1);
    // the floor of the same CPU model, and else the model with the largest floor
    expect(epyc!.noise).toEqual({ floor: 0.01, cpu: EPYC, runs: [runOf(10)] });
    expect(xeon!.noise).toEqual({ floor: 0.03, cpu: "AMD EPYC 9V45 96-Core Processor", runs: [runOf(11)] });
    expect(laws[1]!.law.measure).toEqual({ id: "memory", unit: "B" });
    expect(epyc!.title).toBe(`The CPU time of one request, on the CPU ${EPYC}`);
  });

  it("gives the conditions of a law from a record", () => {
    expect(conditionsOf(recordOf(0, 1, EPYC), { ...SET, conditions: { keepalive: true } })).toEqual({
      class: "rate",
      "cpu.model": EPYC,
      "cpu.limit": { value: 1, unit: "{core}" },
      "memory.limit": { value: 512, unit: "MiB" },
      duration: { value: 1, unit: "s" },
      arrivals: "poisson",
      connections: "pool",
      "connections.size": 64,
      harness: BASE.machine.harness,
      keepalive: true,
    });
  });

  it("skips a job of another plan, with no CI run, with a problem in its verdict or with no record", () => {
    const problem = { code: "limit" as const, path: "rate/100.lag.max", message: "The lag is above its limit." };
    const jobs: LawJob[] = [
      jobOf(runOf(1), EPYC, 1),
      jobOf(runOf(1), EPYC, 7),
      { ...jobOf(runOf(3), EPYC, 2), timed: timedOf("control", runOf(3), EPYC, "2026-11-20T06:02:00Z") },
      jobOf(null, EPYC, 3),
      jobOf(runOf(4), EPYC, 4, { problems: [problem] }),
      { timed: timedOf("rate", runOf(5), EPYC, "2026-11-20T06:05:00Z"), records: [] },
      { ...jobOf(runOf(6), EPYC, 6), records: [recordOf(0, 6, XEON)] },
    ];
    const { laws, skipped, problems } = lawsOf(PLAN, jobs, FLOORS, OPTIONS);
    expect(problems).toEqual([]);
    expect(laws).toHaveLength(2);
    expect(laws[0]!.law.evidence.runs).toEqual([runOf(1)]);
    // the jobs are in the order of their names, and a job with no CI run has the name "a local run"
    expect(skipped.map((each) => [each.code, each.message])).toEqual([
      ["job", "The job has no CI run. The evidence of a law is a CI run."],
      ["job", 'The job measured the plan "control", not the plan "rate".'],
      ["job", "The verdict of the job has 1 problems. A law uses only a job with no problem."],
      ["job", "The job has no record of a case of load."],
      ["job", `The record of the case "rate/100" has the CPU model "${XEON}", not "${EPYC}".`],
    ]);
  });

  it("skips a CPU model with fewer than 40 points, and fits the laws of the other models", () => {
    const { laws, skipped, problems } = lawsOf(PLAN, [jobOf(runOf(1), EPYC, 1), ...twoJobs(runOf(2), XEON, 2)], FLOORS, OPTIONS);
    expect(problems).toEqual([]);
    expect(laws.map(({ law }) => law.id)).toEqual(["node-http/rate/xeon-6975p-c/cpu.request", "node-http/rate/xeon-6975p-c/memory"]);
    expect(skipped).toEqual([{ code: "case", path: "node-http/rate/epyc-7763", message: "The jobs on the CPU model give 25 points. A law needs 40 points or more." }]);
  });

  it("gives no law for a CPU model with no id, and no law with no job", () => {
    expect(CPU_IDS.other).toBeNull();
    const { laws, problems } = lawsOf(PLAN, [jobOf(runOf(1), OTHER, 1)], FLOORS, OPTIONS);
    expect(laws).toEqual([]);
    expect(problems).toEqual([{ code: "cpu", path: OTHER, message: `The lab has no id for the CPU model "${OTHER}". Add a part of its name to CPU_IDS.` }]);
    expect(lawsOf(PLAN, [], FLOORS, OPTIONS).problems).toEqual([{ code: "job", path: "rate", message: 'No job of the plan "rate" gave points.' }]);
    expect(lawsOf({ id: "rate" }, [], FLOORS).problems).toEqual([{ code: "plan", path: "rate", message: 'The plan "rate" has no law set.' }]);
  });

  it("gives no law of a measure with no read in a run, and the laws of the other measures", () => {
    const [job, second] = twoJobs(runOf(1), EPYC, 1);
    const records = job!.records.map((record, index) =>
      index === 3 ? { ...record, runs: record.runs.map((run): RunRecord => (run.index === record.runs[1]!.index ? { ...run, measures: { ...run.measures, memory: null } } : run)) } : record,
    );
    const { laws, problems } = lawsOf(PLAN, [{ ...job!, records }, second!], FLOORS, OPTIONS);
    expect(laws.map(({ law }) => law.id)).toEqual(["node-http/rate/epyc-7763/cpu.request"]);
    expect(problems).toEqual([{ code: "read", path: "node-http/rate/epyc-7763/memory", message: `${CASES[3]!.id} run ${BASE.runs[1]!.index}: The run has no read of memory.` }]);
  });

  it("gives no law of a measure with no noise floor, and uses only the floor jobs with no problem", () => {
    const floors = [
      floorOf(runOf(10), EPYC, 0.5, [{ code: "limit", path: "memory.floor", message: "The floor is above its limit." }]),
      { ...floorOf(runOf(11), EPYC, 1), verdict: { check: "floor", values: { "cpu.request.floor": 0.02 }, problems: [] } },
    ];
    const { laws, skipped, problems } = lawsOf(PLAN, twoJobs(runOf(1), EPYC, 1), floors, OPTIONS);
    expect(laws.map(({ law }) => [law.id, law.noise.floor])).toEqual([["node-http/rate/epyc-7763/cpu.request", 0.02]]);
    expect(problems).toEqual([{ code: "noise", path: "node-http/rate/epyc-7763/memory", message: "No floor job with no problem has a noise floor of memory." }]);
    expect(skipped.map((each) => each.code)).toEqual(["noise"]);
  });

  it("gives no law when two cases differ in a condition", () => {
    const [job, second] = twoJobs(runOf(1), EPYC, 1);
    const small = { ...job!.records[5]!, case: { ...job!.records[5]!.case, instance: { resources: { cpu: { value: 1, unit: "{core}" }, memory: { value: 256, unit: "MiB" } } } } };
    const { laws, problems } = lawsOf(PLAN, [{ ...job!, records: job!.records.map((record, index) => (index === 5 ? small : record)) }, second!], FLOORS, OPTIONS);
    expect(laws).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ code: "case", path: "node-http/rate/epyc-7763" });
    expect(problems[0]!.message).toContain('differs from the case "rate/100" in memory.limit.');
  });

  it("gives a summary with a row for each law, each problem and each skipped job", () => {
    const result = lawsOf(PLAN, [...twoJobs(runOf(1), EPYC, 1), jobOf(null, EPYC, 3), jobOf(runOf(2), OTHER, 4)], FLOORS, OPTIONS);
    const summary = lawsSummaryOf("rate", result);
    expect(summary).toContain("| Law | Form | Constants | Held-out error | Points | Noise floor |");
    expect(summary).toContain(escapeMarkdown("node-http/rate/epyc-7763/cpu.request"));
    expect(summary).toContain("The problems:");
    expect(summary).toContain("The jobs and the CPU models that gave no law, and the floor jobs that gave no noise:");
    expect(lawsSummaryOf("rate", { laws: [], skipped: [], problems: [] })).toContain("The plan gave no law.");
  });
});

describe("the law set of a plan", () => {
  it("finds no problem in the law set of the plan rate", () => {
    expect(RATE.laws?.measures.map((measure) => measure.id)).toEqual(["cpu.request", "memory", "memory.high", "latency.p50", "latency.p90", "latency.p99"]);
    expect(lawSetProblems(RATE.laws, RATE.cases)).toEqual([]);
  });

  it("gives a problem for each part that is not correct", () => {
    const bad = {
      class: "Rate",
      variable: { id: "Rate", unit: "requests", scale: "square" },
      measures: [
        { id: "lag.max", title: "", residual: "square", forms: ["hinge", "hinge", "spline"] },
        { id: "memory", title: "The memory", residual: "absolute", forms: [] },
        { id: "memory", title: "The memory", residual: "absolute" },
        3,
      ],
      conditions: { "cpu.model": "AMD", Node: "26", "memory.limit": { value: 1, unit: "parsecs" } },
    };
    expect(lawSetProblems(bad, RATE.cases).map((each) => each.path)).toEqual([
      "laws.class",
      "laws.variable.id",
      "laws.variable.unit",
      "laws.variable.scale",
      "laws.measures[0].id",
      "laws.measures[0].title",
      "laws.measures[0].residual",
      "laws.measures[0].forms[1]",
      "laws.measures[0].forms[2]",
      "laws.measures[1].forms",
      "laws.measures[2].id",
      "laws.measures[3]",
      "laws.conditions.cpu.model",
      "laws.conditions.Node",
      "laws.conditions.memory.limit",
      "laws.conditions.memory.limit",
    ]);
    expect(lawSetProblems([], RATE.cases)).toEqual([{ code: "laws", path: "laws", message: "The law set is not a record." }]);
    expect(lawSetProblems({ ...SET, measures: [] }, RATE.cases).map((each) => each.path)).toEqual(["laws.measures"]);
  });

  it("gives a problem for a case with another class, with no amount of the variable, or a start case", () => {
    const [first, second] = CASES;
    const other: Case = { ...first!, demand: { ...first!.demand, classes: [{ ...first!.demand.classes[0]!, id: "other" }] } };
    const sized = lawSetProblems({ ...SET, variable: { id: "size", unit: "B", scale: "linear" } }, [second!]);
    expect(lawSetProblems(SET, [other, second!]).map((each) => each.path)).toEqual(["cases[0].demand.classes"]);
    expect(sized).toEqual([{ code: "laws", path: "cases[0].demand", message: 'The demand gives no amount for the variable "size" of the law "rate/300".' }]);
    const start = readPlans(fileURLToPath(new URL("../plans/", import.meta.url))).plans.flatMap((plan) => plan.cases).find(isStartCase);
    expect(start).toBeDefined();
    expect(lawSetProblems(SET, [start!]).map((each) => each.path)).toEqual(["cases[0]"]);
  });
});

const COMMAND = fileURLToPath(new URL("./laws.main.ts", import.meta.url));

/** This function writes the folder of one job, as the artifact of a timed run holds it. */
const writeJob = (folder: string, name: string, timed: Timed, records: readonly CaseRecord[]): void => {
  mkdirSync(join(folder, name));
  records.forEach((record, index) => writeFileSync(join(folder, name, `record-${index}.json`), JSON.stringify(record)));
  const files = records.map((record, index) => ({ case: record.case.id, record: `record-${index}.json`, result: `result-${index}.json` }));
  writeFileSync(join(folder, name, "timed.json"), JSON.stringify({ ...timed, files }));
};

describe("the command of the laws", () => {
  // 36 fits on the Vex interpreter take approximately 10 s (CAP-55 compiles the bases)
  it("writes a correct law file of each measure of the plan rate from the folders of the jobs", () => {
    const folder = mkdtempSync(join(tmpdir(), "capacity-laws-"));
    try {
      twoJobs(runOf(1), EPYC, 1).forEach((job, index) => writeJob(folder, `lab-rate-${index + 1}-1`, job.timed, job.records));
      writeJob(folder, "lab-floor-1-1", FLOORS[0]!, []);
      const out = join(folder, "out");
      const result = spawnSync(process.execPath, [COMMAND, "fit", "--records", folder, "--out", out, "--runs", "40"], { encoding: "utf8" });
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("### The laws of the plan rate");
      const files = readdirSync(join(out, "node-http", "rate", "epyc-7763")).sort();
      expect(files).toEqual(RATE.laws!.measures.map((measure) => `${measure.id}.law.json`).sort());
      for (const name of files) {
        const law = readLaw(JSON.parse(readFileSync(join(out, "node-http", "rate", "epyc-7763", name), "utf8")));
        expect(law.tag).toBe("ok");
      }
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
    }, 60_000);

  it("gives the exit code 1 for records with no job of a plan with a law set", () => {
    const folder = mkdtempSync(join(tmpdir(), "capacity-laws-"));
    try {
      writeJob(folder, "lab-floor-1-1", FLOORS[0]!, []);
      const result = spawnSync(process.execPath, [COMMAND, "fit", "--records", folder, "--out", join(folder, "out")], { encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("No job of the 1 jobs of the records is a job of a plan with a law set.\n");
      const usage = spawnSync(process.execPath, [COMMAND, "fit", "--out", folder], { encoding: "utf8" });
      expect(usage.status).toBe(1);
      expect(usage.stderr).toContain("The command needs --records and --out.");
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
