import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { valueIn } from "@mark1russell7/quantity";
import { afterEach, describe, expect, it } from "vitest";
import { CASE_FORMAT, MAX_ARRIVALS, arrivalsOf, type Case } from "./case.ts";
import { windowOf } from "./cell.ts";
import { CONTROL_CASES } from "./control.ts";
import { FLOOR_IDS, FLOOR_PAIRS, floorPair } from "./floor.ts";
import { expectedOf } from "./gate.ts";
import { MAX_JOB_MINUTES, MAX_JOBS, PLAN_FORMAT, SETUP_MINUTES, gatePlanProblems, matrixOf, planMinutes, planProblems, planSwap, readPlans, selectPlans, type Plan } from "./plan.ts";
import type { StartLawSet } from "./start-laws.ts";
import { isStartCase, startWindowOf, type StartCase } from "./start.ts";

const PLANS = fileURLToPath(new URL("../plans/", import.meta.url));

const CASE: Case = {
  format: CASE_FORMAT,
  id: "node-http/idle",
  title: "One request each second",
  subject: "node-http",
  instance: { resources: { cpu: { value: 1, unit: "{core}" }, memory: { value: 256, unit: "MiB" } } },
  demand: { classes: [{ id: "idle", rate: { value: 1, unit: "{request}/s" }, request: {} }], levels: {} },
  duration: { value: 10, unit: "s" },
  arrivals: { arrivals: "uniform" },
  runs: 2,
};

const PLAN: Plan = { format: PLAN_FORMAT, id: "idle", title: "An idle subject", check: null, triggers: ["schedule"], cases: [CASE] };

/** A start law set of the time to ready over the size of the log. */
const START_SET: StartLawSet = {
  variable: { id: "log", unit: "MiB", scale: "log" },
  measures: [{ id: "ready", law: "ready", title: "The time to ready", residual: "absolute" }],
};

const plan = (more: Partial<Plan>): Plan => ({ ...PLAN, ...more });
const paths = (value: unknown): readonly string[] => planProblems(value as Plan).map((each) => `${each.code} ${each.path}`);

describe("the plan files of the lab", () => {
  it("have no problem, and the id of each plan is the name of its file", () => {
    const { plans, problems } = readPlans(PLANS);
    expect(problems).toEqual([]);
    expect(plans.map((each) => each.id)).toContain("control");
  });

  it("have the plan of the positive control, with its check and its two cases, on each pull request and each night", () => {
    const control = readPlans(PLANS).plans.find((each) => each.id === "control");
    expect(control?.check).toBe("control");
    expect(control?.triggers).toEqual(["pull_request", "schedule"]);
    expect(control?.cases.map((each) => each.id)).toEqual([CONTROL_CASES.base, CONTROL_CASES.more]);
    // each case: 4 runs with the warm-up, each run in a window of 2 x 10 s and a drain of 30 s
    expect(planMinutes(control!)).toBe(SETUP_MINUTES + Math.ceil((2 * 4 * 50) / 60));
  });

  it("have the plan of the noise floor, with its check and its A/A pairs of the case control/base, each night", () => {
    const { plans } = readPlans(PLANS);
    const floor = plans.find((each) => each.id === "floor");
    const base = plans.find((each) => each.id === "control")?.cases.find((each) => each.id === CONTROL_CASES.base);
    expect(floor?.check).toBe("floor");
    expect(floor?.triggers).toEqual(["schedule"]);
    const ids = Array.from({ length: FLOOR_PAIRS }, (_, index) => floorPair(index + 1)).flatMap((pair) => [pair.a, pair.b]);
    expect(floor?.cases.map((each) => each.id)).toEqual(ids);
    for (const each of floor?.cases ?? []) expect({ ...each, id: base?.id, title: base?.title }).toEqual(base);
    // 10 cases: each one 4 runs with the warm-up, each run in a window of 2 x 10 s and a drain of 30 s
    expect(planMinutes(floor!)).toBe(SETUP_MINUTES + Math.ceil((10 * 4 * 50) / 60));
  });

  it("have the two gate plans of the laws of the request rate, in 12 jobs each night: the second adds a cost and must block", () => {
    const { plans } = readPlans(PLANS);
    const [pass, block] = ["gate-rate", "gate-rate-cost"].map((id) => plans.find((each) => each.id === id)!);
    for (const each of [pass!, block!]) {
      expect([each.check, each.gate, each.jobs, each.triggers]).toEqual(["gate", { laws: "rate" }, 12, ["schedule"]]);
      expect(each.cases.map((value) => value.id)).toEqual([...FLOOR_IDS, "rate/300", "rate/1000", "rate/2000", "rate/3000"]);
      expect(gatePlanProblems(each, plans)).toEqual([]);
    }
    expect([expectedOf(pass!), expectedOf(block!)]).toEqual(["pass", "block"]);
  });

  it("have the plan of the request rate, with its check, by hand only: the bare request at a sweep of rates", () => {
    const rate = readPlans(PLANS).plans.find((each) => each.id === "rate");
    expect(rate?.check).toBe("rate");
    expect(rate?.triggers).toEqual([]);
    const cases = (rate?.cases ?? []) as readonly Case[];
    const rates = cases.map((each) => valueIn(each.demand.classes[0]!.rate, "{request}/s"));
    expect(rates).toHaveLength(25);
    expect([rates[0], rates.at(-1)]).toEqual([100, 36_000]);
    // the rates rise, and from 4000 each step is 25 % of its rate or less: points on each side of the knee
    rates.slice(1).forEach((value, index) => {
      expect(value).toBeGreaterThan(rates[index]!);
      if (rates[index]! >= 4000) expect(value / rates[index]!).toBeLessThanOrEqual(1.25);
    });
    // each case is the first case at its own rate: one class of the bare request, on a pool of 64 connections
    const first = cases[0]!;
    expect(first.connections).toEqual({ mode: "pool", size: 64 });
    expect(first.arrivals).toEqual({ arrivals: "poisson", seed: "rate" });
    cases.forEach((each, index) => {
      expect(each.id).toBe(`rate/${rates[index]}`);
      expect(each.demand.classes.map((entry) => [entry.id, entry.request])).toEqual([["rate", {}]]);
      expect({ ...each, id: first.id, title: first.title, demand: first.demand }).toEqual(first);
    });
    // the case with the most arrivals: 4 runs of 36000 arrivals, with the warm-up run
    expect(Math.max(...cases.map((each) => (each.runs + 1) * arrivalsOf(each)))).toBe(144_000);
    expect(144_000).toBeLessThanOrEqual(MAX_ARRIVALS);
    // 25 cases: each one 4 runs with the warm-up, each run in a window of 2 x 1 s and a drain of 30 s
    expect(planMinutes(rate!)).toBe(SETUP_MINUTES + Math.ceil((25 * 4 * 32) / 60));
    expect(planMinutes(rate!)).toBeLessThanOrEqual(MAX_JOB_MINUTES);
  });

  it("have the plan of the start of alerts: no check, no trigger, only start cases, in the time of one job", () => {
    // CAP-62 retired the plans alerts-start-files, alerts-start-horizon, alerts-start-disk-mean and alerts-start-disk-peak. The README of the lab keeps their results.
    const plans = [["alerts-start", ["alerts-start/log"], ["cloud", "new"]]] as const;
    for (const [id, cases, arms] of plans) {
      const start = readPlans(PLANS).plans.find((each) => each.id === id);
      expect(start?.check).toBeNull();
      expect(start?.triggers).toEqual([]);
      const values = (start?.cases ?? []).filter(isStartCase);
      expect(values.map((value) => value.id)).toEqual(cases);
      for (const value of values) expect(value.arms.map((arm) => arm.id)).toEqual(arms);
      const seconds = values.reduce((sum, value) => sum + valueIn(startWindowOf(value), "s"), 0);
      expect(planMinutes(start!)).toBe(SETUP_MINUTES + Math.ceil(seconds / 60));
      expect(planMinutes(start!)).toBeLessThanOrEqual(MAX_JOB_MINUTES);
    }
  });

  it("have the plan of the start of alerts from its contract: the arms on the commit of the seeder, the seed of the contract", () => {
    // The run 45044576905 compared this case with the same start through the start subject of the lab. The two agreed, thus CAP-62 deleted the subject case.
    const plan = readPlans(PLANS).plans.find((each) => each.id === "alerts-start-app");
    expect(plan?.check).toBeNull();
    expect(plan?.triggers).toEqual([]);
    const [contract, ...more] = (plan?.cases ?? []).filter(isStartCase);
    expect(more).toEqual([]);
    expect([contract?.id, contract?.app, contract?.subject]).toEqual(["alerts-start-app/contract", "https://github.com/metrograph-labs/alerts.git", "alerts-runtime"]);
    // The seed script of the contract gives seedStore the seed al124, the log and the sizes of the cache files of one live copy.
    expect(contract!.seed).toBe("al124");
    expect(new Set(contract!.arms.map((arm) => arm.commit))).toEqual(new Set([contract!.seeder]));
    expect(planMinutes(plan!)).toBeLessThanOrEqual(MAX_JOB_MINUTES);
  });

  it("bracket the knee of the cloud log with one ready fact and one late fact of the cloud arm", () => {
    // The two plans of the bytes of the disk keep the points of the knee, and the start after the start of file-1844.
    for (const id of ["alerts-start-bytes-mean", "alerts-start-bytes-peak"]) {
      const [knee] = readPlans(PLANS).plans.find((each) => each.id === id)?.cases ?? [];
      if (!isStartCase(knee)) throw new Error(`The plan ${id} has no start case.`);
      // The cut point is the file of 18:44Z times the share of the body characters up to the last good start.
      expect(knee.points.map((point) => [point.id, point.at["log"]?.value, point.after])).toEqual([
        ["cut-1030", Math.round((197156864 * 154047519) / 158938576), undefined],
        ["file-1844", 197156864, undefined],
        ["file-1844-again", 197156864, "file-1844"],
      ]);
      expect(knee.observed.map((each) => [each.point, each.arm, each.ready])).toEqual([
        ["cut-1030", "cloud", true],
        ["file-1844", "cloud", false],
      ]);
    }
  });
});

describe("the problems of a plan", () => {
  it("gives no problem for a correct plan", () => {
    expect(planProblems(PLAN)).toEqual([]);
  });

  it("refuses a plan that is not a record, and a plan with no case", () => {
    expect(paths(null)).toEqual(["shape "]);
    expect(paths([])).toEqual(["shape "]);
    expect(paths(plan({ cases: [] }))).toEqual(["case cases"]);
  });

  it("examines the format, the id, the title, the check and the triggers", () => {
    expect(paths(plan({ format: "capacity-plan/2" as typeof PLAN_FORMAT }))).toEqual(["format format"]);
    expect(paths(plan({ id: "control/base" }))).toEqual(["id id"]);
    expect(paths(plan({ id: "Control" }))).toEqual(["id id"]);
    expect(paths(plan({ title: " " }))).toEqual(["id title"]);
    expect(paths(plan({ check: "nope" }))).toEqual(["check check"]);
    expect(paths(plan({ check: "toString" }))).toEqual(["check check"]);
    expect(paths(plan({ check: "control" }))).toEqual([]);
    expect(paths(plan({ triggers: ["push"] as unknown as Plan["triggers"] }))).toEqual(["trigger triggers[0]"]);
    expect(paths(plan({ triggers: ["schedule", "schedule"] }))).toEqual(["trigger triggers[1]"]);
    expect(paths(plan({ triggers: "schedule" as unknown as Plan["triggers"] }))).toEqual(["trigger triggers"]);
    expect(paths(plan({ triggers: [] }))).toEqual([]);
  });

  it("examines each case, with the path of the case, and refuses a case id two times", () => {
    expect(paths(plan({ cases: [CASE, { ...CASE, runs: 0 }] }))).toEqual(["case cases[1].runs", "case cases[1].id"]);
    expect(paths(plan({ cases: [null as unknown as Case] }))).toEqual(["case cases[0]"]);
  });

  it("examines a start case with the rules of a start case, and puts its time in the time of the job", () => {
    const start = readPlans(PLANS).plans.find((each) => each.id === "alerts-start")!.cases[0] as StartCase;
    expect(paths(plan({ cases: [CASE, { ...start, rounds: 0 }] }))).toEqual(["case cases[1].rounds"]);
    const seconds = valueIn(startWindowOf(start), "s") + (CASE.runs + 1) * valueIn(windowOf(CASE), "s");
    expect(planMinutes(plan({ cases: [CASE, start] }))).toBe(SETUP_MINUTES + Math.ceil(seconds / 60));
  });

  it("examines the count of jobs: a whole number from 1 to the most jobs of a matrix", () => {
    for (const jobs of [0, 1.5, MAX_JOBS + 1, Number.NaN]) expect(paths(plan({ jobs }))).toEqual(["jobs jobs"]);
    expect(paths(plan({ jobs: "2" as unknown as number }))).toEqual(["jobs jobs"]);
    expect(paths(plan({ jobs: 1 }))).toEqual([]);
    expect(paths(plan({ jobs: MAX_JOBS }))).toEqual([]);
  });

  it("examines the shape of a gate plan: its id, the id of the plan of its laws, the check gate, no law set and 2 jobs or more", () => {
    const gate = plan({ id: "gate-idle", check: "gate", gate: { laws: "rate" }, jobs: 2 });
    expect(paths(gate)).toEqual([]);
    expect(paths({ ...gate, id: "idle" })).toEqual(["gate id"]);
    expect(paths({ ...gate, gate: {} })).toEqual(["gate gate"]);
    expect(paths({ ...gate, gate: { laws: "Rate" } })).toEqual(["gate gate"]);
    expect(paths({ ...gate, check: "rate" })).toEqual(["gate check"]);
    expect(paths({ ...gate, jobs: 1 })).toEqual(["gate jobs"]);
    expect(paths({ ...gate, jobs: undefined })).toEqual(["gate jobs"]);
    const rate = readPlans(PLANS).plans.find((each) => each.id === "rate")!;
    expect(paths({ ...gate, laws: rate.laws })).toContain("gate laws");
    expect(paths({ ...gate, startLaws: START_SET })).toContain("gate startLaws");
  });

  it("examines a start law set: only start cases, and no law set with it", () => {
    const start = readPlans(PLANS).plans.find((each) => each.id === "alerts-start")!.cases[0] as StartCase;
    expect(paths(plan({ cases: [start], startLaws: START_SET }))).toEqual([]);
    expect(paths(plan({ cases: [CASE, start], startLaws: START_SET }))).toEqual(["laws cases[0]"]);
    expect(paths(plan({ cases: [start], startLaws: { ...START_SET, measures: [] } }))).toEqual(["laws startLaws.measures"]);
    const rate = readPlans(PLANS).plans.find((each) => each.id === "rate")!;
    expect(paths(plan({ cases: [start], laws: rate.laws!, startLaws: START_SET }))).toEqual(["laws startLaws"]);
  });

  it("refuses a plan whose job needs more than the time of one job", () => {
    const long: Case = { ...CASE, duration: { value: 600, unit: "s" }, runs: 20 };
    expect(planMinutes(plan({ cases: [long] }))).toBeGreaterThan(MAX_JOB_MINUTES);
    expect(paths(plan({ cases: [long] }))).toEqual(["time cases"]);
  });
});

describe("the problems of a gate plan against the other plans", () => {
  const { plans } = readPlans(PLANS);
  const gate = plans.find((each) => each.id === "gate-rate")!;
  const codes = (value: Plan, others: readonly Plan[] = plans): readonly string[] => gatePlanProblems(value, others).map((each) => `${each.code} ${each.path}`);
  const load = gate.cases.findIndex((value) => !FLOOR_IDS.includes(value.id));

  it("gives no problem for a case of the plan of the laws with a cost", () => {
    const cases = gate.cases.map((value, index) => (index === load ? { ...value, cost: { value: 50, unit: "us" } } : value));
    expect(codes({ ...gate, cases })).toEqual([]);
  });

  it("refuses a plan of the laws with no law set, and a folder with no plan floor", () => {
    expect(codes({ ...gate, gate: { laws: "floor" } })).toEqual(["gate gate.laws"]);
    expect(codes(gate, plans.filter((each) => each.id !== "floor"))).toEqual(["gate cases"]);
  });

  it("refuses a plan with an A/A pair that is not the pair of the plan floor, or with no such pair", () => {
    expect(codes({ ...gate, cases: gate.cases.slice(1) })).toEqual(["gate cases"]);
    const cases = gate.cases.map((value, index) => (index === 0 ? { ...value, runs: 4 } : value));
    expect(codes({ ...gate, cases })).toEqual(["gate cases"]);
  });

  it("refuses a case that differs from the case of the plan of the laws in more than its cost, and a case with no such case", () => {
    const runs = gate.cases.map((value, index) => (index === load ? { ...value, runs: 4 } : value));
    expect(codes({ ...gate, cases: runs })).toEqual([`gate cases[${load}]`]);
    const other = gate.cases.map((value, index) => (index === load ? { ...value, id: "rate/350" } : value));
    expect(codes({ ...gate, cases: other })).toEqual([`gate cases[${load}]`]);
  });
});

describe("the reader of the plan files", () => {
  let folder: string | undefined;
  afterEach(() => {
    if (folder !== undefined) rmSync(folder, { recursive: true, force: true });
    folder = undefined;
  });

  it("names the file of each problem, and keeps only the plans with no problem", () => {
    folder = mkdtempSync(join(tmpdir(), "capacity-plans-"));
    writeFileSync(join(folder, "idle.json"), JSON.stringify(PLAN));
    writeFileSync(join(folder, "other.json"), JSON.stringify(PLAN));
    writeFileSync(join(folder, "broken.json"), "{");
    writeFileSync(join(folder, "bad.json"), JSON.stringify(plan({ id: "bad", cases: [] })));
    writeFileSync(join(folder, "notes.txt"), "not a plan");
    const { plans, problems } = readPlans(folder);
    expect(plans.map((each) => each.id)).toEqual(["idle"]);
    expect(problems.map((each) => `${each.code} ${each.path}`)).toEqual(["case bad.json: cases", "shape broken.json", "id other.json: id"]);
  });
});

describe("the selection of the plans", () => {
  const CONTROL = plan({ id: "control", triggers: ["pull_request", "schedule"] });
  const NIGHT = plan({ id: "night", triggers: ["schedule"] });
  const HAND = plan({ id: "hand", triggers: [] });
  const ALL = [CONTROL, NIGHT, HAND];
  const ids = (event: string, chosen: readonly string[] = []): readonly string[] => selectPlans(ALL, { event, ids: chosen }).map((each) => each.id);

  it("gives the plans of the trigger of the event: a push and a dispatch with no ids are as a pull request", () => {
    expect(ids("pull_request")).toEqual(["control"]);
    expect(ids("push")).toEqual(["control"]);
    expect(ids("workflow_dispatch")).toEqual(["control"]);
    expect(ids("schedule")).toEqual(["control", "night"]);
  });

  it("gives the plans of the ids of a dispatch, in the order of the plans, also a plan with no trigger", () => {
    expect(ids("workflow_dispatch", ["hand", "control"])).toEqual(["control", "hand"]);
  });

  it("refuses an id that no plan has, an event that starts no plan, and a selection with no plan", () => {
    expect(() => ids("workflow_dispatch", ["nope"])).toThrow(/No plan has the id "nope"/);
    expect(() => ids("issues")).toThrow(RangeError);
    expect(() => selectPlans([HAND], { event: "schedule", ids: [] })).toThrow(/selects no plan/);
  });
});

describe("the matrix of the workflow", () => {
  it("gives one job for each run of each plan, with the time limit of the plan", () => {
    const other = plan({ id: "other", cases: [CASE, { ...CASE, id: "node-http/idle-2" }] });
    expect(matrixOf([PLAN, other], [1, 2])).toEqual({
      include: [
        { plan: "idle", run: 1, minutes: planMinutes(PLAN), swap: 0 },
        { plan: "idle", run: 2, minutes: planMinutes(PLAN), swap: 0 },
        { plan: "other", run: 1, minutes: planMinutes(other), swap: 0 },
        { plan: "other", run: 2, minutes: planMinutes(other), swap: 0 },
      ],
    });
    expect(planMinutes(other)).toBeGreaterThan(planMinutes(PLAN));
  });

  it("gives each plan its count of jobs with no list of runs, and 1 job to a plan with no count", () => {
    const three = plan({ id: "three", jobs: 3 });
    expect(matrixOf([PLAN, three]).include.map((each) => `${each.plan} ${each.run}`)).toEqual(["idle 1", "three 1", "three 2", "three 3"]);
    expect(matrixOf([three], [2]).include.map((each) => each.run)).toEqual([2]);
    expect(() => matrixOf([plan({ jobs: MAX_JOBS }), three])).toThrow(/at most 256/);
  });

  it("gives each job of a plan the most swap of a target of its start cases, and 0 to a plan with no start case", () => {
    const app = readPlans(PLANS).plans.find((each) => each.id === "alerts-start-app");
    if (app === undefined) throw new Error("The plan alerts-start-app is not in the folder of the plans.");
    const most = Math.max(...app.cases.filter(isStartCase).map((value) => valueIn(value.target.swap, "B")));
    expect(most).toBeGreaterThan(0);
    expect(matrixOf([app], [1]).include[0]?.swap).toBe(most);
    const [first] = app.cases.filter(isStartCase);
    if (first === undefined) throw new Error("The plan alerts-start-app has no start case.");
    const more: StartCase = { ...first, id: `${first.id}-more`, target: { ...first.target, swap: { value: 5, unit: "GiB" } } };
    expect(planSwap({ ...app, cases: [...app.cases, more] })).toBe(5 * 1024 ** 3);
    expect(planSwap(PLAN)).toBe(0);
  });

  it("refuses runs that are not different whole numbers above 0, and a matrix that GitHub does not start", () => {
    for (const runs of [[], [0], [1.5], [1, 1], [Number.NaN]]) expect(() => matrixOf([PLAN], runs)).toThrow(RangeError);
    const runs = Array.from({ length: MAX_JOBS + 1 }, (_, index) => index + 1);
    expect(() => matrixOf([PLAN], runs)).toThrow(/at most 256/);
    expect(matrixOf([PLAN], runs.slice(0, MAX_JOBS)).include).toHaveLength(MAX_JOBS);
  });
});
