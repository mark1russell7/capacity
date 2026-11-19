import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { CASE_FORMAT, type Case } from "./case.ts";
import { CONTROL_CASES } from "./control.ts";
import { MAX_JOB_MINUTES, MAX_JOBS, PLAN_FORMAT, SETUP_MINUTES, matrixOf, planMinutes, planProblems, readPlans, selectPlans, type Plan } from "./plan.ts";

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

  it("refuses a plan whose job needs more than the time of one job", () => {
    const long: Case = { ...CASE, duration: { value: 600, unit: "s" }, runs: 20 };
    expect(planMinutes(plan({ cases: [long] }))).toBeGreaterThan(MAX_JOB_MINUTES);
    expect(paths(plan({ cases: [long] }))).toEqual(["time cases"]);
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
        { plan: "idle", run: 1, minutes: planMinutes(PLAN) },
        { plan: "idle", run: 2, minutes: planMinutes(PLAN) },
        { plan: "other", run: 1, minutes: planMinutes(other) },
        { plan: "other", run: 2, minutes: planMinutes(other) },
      ],
    });
    expect(planMinutes(other)).toBeGreaterThan(planMinutes(PLAN));
  });

  it("refuses runs that are not different whole numbers above 0, and a matrix that GitHub does not start", () => {
    for (const runs of [[], [0], [1.5], [1, 1], [Number.NaN]]) expect(() => matrixOf([PLAN], runs)).toThrow(RangeError);
    const runs = Array.from({ length: MAX_JOBS + 1 }, (_, index) => index + 1);
    expect(() => matrixOf([PLAN], runs)).toThrow(/at most 256/);
    expect(matrixOf([PLAN], runs.slice(0, MAX_JOBS)).include).toHaveLength(MAX_JOBS);
  });
});
