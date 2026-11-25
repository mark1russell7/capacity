import { readFileSync } from "node:fs";
import { LOAD_GRID, LOAD_MEASURES, LOOP_MEASURES, RUN_MEASURES, START_MEASURES } from "@capacity/lab";
import { describe, expect, it } from "vitest";
import {
  FAMILIES,
  ITEMS,
  RECORD_MEASURES,
  START_FAMILIES,
  SUBJECTS,
  VARIABLES,
  coverage,
  cpuModels,
  cpuName,
  familyOf,
  goalCells,
  nextItem,
  subjectOf,
  tally,
  type Cell,
  type LawEntry,
  type PlanEntry,
  type SubjectMatrix,
} from "./coverage.ts";
import { LAWS, PLANS } from "./data.ts";

const cellOf = (matrices: readonly SubjectMatrix[], subject: string, row: string, family: string): Cell => {
  const found = matrices.flatMap((each) => each.cells.flat()).find((each) => each.subject === subject && each.row === row && each.family === family);
  if (found === undefined) throw new Error(`No cell ${subject} ${row} ${family}.`);
  return found;
};

const law = (subject: string, variable: string, measure: string, cpu = "CPU A"): LawEntry => ({
  path: `${subject}/${variable}/${measure}`,
  id: `${subject}/${variable}/${measure}`,
  title: measure,
  subject,
  variables: [variable],
  measure,
  unit: "1",
  cpu,
  lawClass: undefined,
});

const plan = (id: string, subjects: readonly string[], variable: string | undefined, start: readonly string[] = []): PlanEntry => ({
  id,
  title: id,
  subjects,
  variable,
  start: Object.fromEntries(start.map((each) => [each, each])),
  lawClass: undefined,
  knees: {},
});

describe("the lists of the page and of the lab", () => {
  it("has the load variables of the grid of the lab, in its order and with its titles", () => {
    expect(VARIABLES).toEqual(LOAD_GRID.map((each) => ({ id: each.id, title: each.title })));
  });

  it("has the measures of the subject that each run of the lab records", () => {
    expect(RECORD_MEASURES).toEqual([
      ...Object.keys(RUN_MEASURES),
      ...Object.keys(LOAD_MEASURES).filter((each) => each.startsWith("latency.")),
      ...Object.keys(LOOP_MEASURES),
    ]);
    expect(RECORD_MEASURES.filter((each) => familyOf(each) === undefined)).toEqual(["elapsed"]);
  });

  it("puts each subject of each law and each plan in one subject of the page", () => {
    const ids = [...LAWS.map((each) => each.subject), ...PLANS.flatMap((each) => each.subjects)];
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(SUBJECTS.filter((each) => each.ids.includes(id))).toHaveLength(1);
    expect(() => subjectOf("no-such-subject")).toThrow(/Add it to SUBJECTS/);
  });

  it("finds each item of the roadmap with its title in docs/ROADMAP.md", () => {
    const roadmap = readFileSync(new URL("../../../docs/ROADMAP.md", import.meta.url), "utf8");
    for (const item of Object.values(ITEMS)) expect(roadmap).toContain(`| ${item.id} | ${item.title} |`);
  });
});

describe("the family of a measure", () => {
  it("reads the family from the head of the id, with no change for the suffix overhead", () => {
    expect(familyOf("cpu.request")).toBe("cpu");
    expect(familyOf("memory.high.overhead")).toBe("memory");
    expect(familyOf("latency.p99")).toBe("latency");
    expect(familyOf("network.tx.request")).toBe("network");
    expect(familyOf("gc.time")).toBe("gc");
    expect(familyOf("loop.lag.p99")).toBe("lag");
    expect(familyOf("elapsed")).toBeUndefined();
    expect(familyOf("ready")).toBeUndefined();
    expect(familyOf("ready", { ready: "ready" })).toBe("start");
    expect(familyOf("watch-cores", { "watch-cores": "watchCores" })).toBe("cpu");
    expect(familyOf("watch-peak", { "watch-peak": "watchPeak" })).toBe("memory");
    expect(familyOf("heap-peak.overhead", { "heap-peak": "heapPeak" })).toBe("memory");
  });
});

describe("the coverage of the law files of the repository", () => {
  const models = cpuModels(LAWS);
  const matrices = coverage(LAWS, PLANS, models[0]!);

  it("has the laws of the request rate of bare Node and of the overhead of the service runner", () => {
    expect(models.length).toBeGreaterThan(0);
    for (const family of ["cpu", "memory", "latency"]) {
      expect(cellOf(matrices, "node", "rate", family).state).toBe("law");
      expect(cellOf(matrices, "runner", "rate", family).state).toBe("law");
    }
    expect(cellOf(matrices, "node", "rate", "memory").laws.map((each) => each.measure).sort()).toEqual(["memory", "memory.high"]);
  });

  it("marks the network bytes of the plan rate as measured with no law, and garbage collection as not measured", () => {
    expect(cellOf(matrices, "node", "rate", "network").state).toBe("measured");
    expect(cellOf(matrices, "node", "rate", "network").plans.map((each) => each.id)).toContain("rate");
    expect(cellOf(matrices, "node", "rate", "gc").state).toBe("none");
    expect(cellOf(matrices, "node", "body", "cpu").state).toBe("none");
  });

  it("gives a family to each measure of a start record of the lab, from the families of the page", () => {
    expect(Object.keys(START_FAMILIES).sort()).toEqual(Object.keys(START_MEASURES).sort());
    const ids = new Set([...FAMILIES.map((each) => each.id), "start"]);
    expect(Object.values(START_FAMILIES).filter((each) => !ids.has(each))).toEqual([]);
  });

  it("puts the CPU and the memory of a start plan in their families, not in the column start", () => {
    const event = PLANS.find((each) => each.id === "alerts-start-event");
    expect(event).toBeDefined();
    const row = event!.variable!;
    for (const family of ["cpu", "memory"]) expect(cellOf(matrices, "alerts", row, family).state).not.toBe("none");
    expect(cellOf(matrices, "alerts", row, "start").state).not.toBe("none");
  });

  it("gives the start plans of alerts as rows of the app, out of the goal", () => {
    const alerts = matrices.find((each) => each.subject.id === "alerts")!;
    expect(alerts.families.at(-1)?.id).toBe("start");
    expect(alerts.rows.map((each) => each.id)).toContain("feeds");
    const feeds = cellOf(matrices, "alerts", "feeds", "start");
    expect(feeds.state).toBe("law");
    expect(feeds.goal).toBe(false);
  });

  it("counts the percent as the cells of the goal with a law, over all the cells of the goal", () => {
    const goal = goalCells(matrices);
    expect(goal).toHaveLength(SUBJECTS.length * VARIABLES.length * FAMILIES.length);
    const counts = tally(goal);
    expect(counts.law + counts.measured + counts.none).toBe(counts.cells);
    expect(counts.percent).toBeCloseTo((100 * goal.filter((each) => each.laws.length > 0).length) / goal.length);
  });
});

describe("the coverage query", () => {
  const laws = [law("node-http", "rate", "cpu.request"), law("node-http", "body", "memory", "CPU B")];
  const plans = [plan("rate", ["node-http"], "rate"), plan("floor", ["node-http"], undefined), plan("feeds", ["alerts-runtime"], "feeds", ["ready"])];

  it("gives a law before a measure, and keeps the measures on each CPU model", () => {
    const onA = coverage(laws, plans, "CPU A");
    expect(cellOf(onA, "node", "rate", "cpu").state).toBe("law");
    expect(cellOf(onA, "node", "rate", "memory").state).toBe("measured");
    expect(cellOf(onA, "node", "body", "memory").state).toBe("none");
    const onB = coverage(laws, plans, "CPU B");
    expect(cellOf(onB, "node", "rate", "cpu").state).toBe("measured");
    expect(cellOf(onB, "node", "body", "memory").state).toBe("law");
  });

  it("measures nothing for a plan with no variable, and adds the column start only for a subject with start plans", () => {
    const matrices = coverage(laws, [plans[1]!], "CPU A");
    expect(tally(goalCells(matrices)).measured).toBe(0);
    expect(coverage(laws, plans, "CPU A").map((each) => each.families.length)).toEqual([6, 6, 7]);
  });

  it("gives each CPU model one time, in order, and its short name", () => {
    expect(cpuModels(laws)).toEqual(["CPU A", "CPU B"]);
    expect(cpuName("Intel(R) Xeon(R) 6975P-C")).toBe("Intel Xeon 6975P-C");
  });

  it("gives the percent 0 for no cell", () => {
    expect(tally([])).toEqual({ cells: 0, law: 0, measured: 0, none: 0, percent: 0 });
  });

  it("gives the item of the roadmap of each cell", () => {
    const matrices = coverage(laws, plans, "CPU A");
    expect(nextItem(cellOf(matrices, "node", "body", "cpu")).id).toBe("CAP-21");
    expect(nextItem(cellOf(matrices, "node", "concurrency", "latency")).id).toBe("CAP-22");
    expect(nextItem(cellOf(matrices, "node", "rate", "gc")).id).toBe("CAP-23");
    expect(nextItem(cellOf(matrices, "node", "age", "cpu")).id).toBe("CAP-24");
    expect(nextItem(cellOf(matrices, "runner", "rate", "cpu")).id).toBe("CAP-29");
    expect(nextItem(cellOf(matrices, "runner", "body", "lag")).id).toBe("CAP-68");
    expect(nextItem(cellOf(matrices, "alerts", "feeds", "start")).id).toBe("CAP-36");
  });
});
