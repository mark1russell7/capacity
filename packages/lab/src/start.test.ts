import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Plan } from "./plan.ts";
import {
  CHILD_MARGIN,
  IMAGE_MARGIN,
  IMAGE_STEPS,
  MAX_START,
  MAX_START_ROUNDS,
  MAX_WATCH,
  SEED_RATE,
  START_FORMAT,
  START_SUBJECTS,
  TREE_MARGIN,
  checksOf,
  childrenOf,
  isStartCase,
  pointAmounts,
  pointBytes,
  startCaseProblems,
  startSubjectOf,
  startWindowOf,
  treesOf,
  type StartCase,
} from "./start.ts";
import { ALERTS } from "./subject/alerts.ts";

const MIB = 1024 * 1024;
const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);

const CASE: StartCase = {
  format: START_FORMAT,
  id: "alerts-start/test",
  title: "Two points",
  subject: "alerts",
  seeder: C,
  arms: [
    { id: "base", commit: A, graft: [{ path: "packages/runtime/src/measured-start.ts", commit: B }] },
    { id: "new", commit: B },
  ],
  points: [
    { id: "small", at: { log: { value: 16, unit: "MiB" } } },
    { id: "large", at: { log: { value: 64, unit: "MiB" }, shapes: { value: 2, unit: "MiB" }, transit: { value: 1024, unit: "KiB" } } },
  ],
  seed: "test-1",
  rounds: 2,
  watch: { value: 120, unit: "s" },
  limit: { value: 5, unit: "min" },
  windows: [{ value: 90, unit: "s" }, { value: 4, unit: "min" }],
  probe: { value: 500, unit: "ms" },
  target: {
    image: "node:24.21.0-bookworm-slim",
    node: "v24.21.0",
    memory: { value: 1011425280, unit: "B" },
    swap: { value: 2, unit: "GiB" },
    cpus: 2,
    heapLimit: { value: 556269568, unit: "B" },
  },
  observed: [{ point: "large", arm: "base", window: { value: 90, unit: "s" }, ready: false, source: "the supervisor of the machine: 3 stops" }],
};

const start = (more: Partial<StartCase> | Record<string, unknown>): StartCase => ({ ...CASE, ...more }) as StartCase;

/** This case has no observation, so a test of the arms or the points finds only their problems. */
const bare = (more: Partial<StartCase> | Record<string, unknown>): StartCase => start({ observed: [], ...more });
const paths = (value: StartCase): readonly string[] => startCaseProblems(value).map((each) => `${each.code} ${each.path}`);

describe("startCaseProblems", () => {
  it("gives no problem for a correct case, and for the cases of the three plans of the start of alerts", () => {
    expect(startCaseProblems(CASE)).toEqual([]);
    for (const name of ["alerts-start", "alerts-start-files", "alerts-start-horizon"]) {
      const plan = JSON.parse(readFileSync(new URL(`../plans/${name}.json`, import.meta.url), "utf8")) as Plan;
      expect(plan.cases.filter(isStartCase)).toHaveLength(plan.cases.length);
      expect(plan.cases.filter(isStartCase).flatMap((each) => startCaseProblems(each))).toEqual([]);
    }
  });

  it("refuses a value that is not a record, a wrong format, a bad id, no title and an unknown subject", () => {
    expect(paths(null as unknown as StartCase)).toEqual(["shape "]);
    expect(paths(start({ format: "capacity-case/1" }))).toEqual(["format format"]);
    expect(paths(start({ id: "Bad Id" }))).toEqual(["id id"]);
    expect(paths(start({ title: " " }))).toEqual(["id title"]);
    expect(paths(start({ subject: "nothing" }))).toEqual(["subject subject"]);
  });

  it("refuses a seeder or a commit that is not 40 lower-case hexadecimal digits", () => {
    expect(paths(start({ seeder: "abc1234" }))).toEqual(["commit seeder"]);
    expect(paths(start({ arms: [{ id: "base", commit: A.toUpperCase() }, CASE.arms[1]!] }))).toEqual(["commit arms[0].commit"]);
  });

  it("needs 2 arms or more, each with a different id, and each graft with a relative path and a commit", () => {
    expect(paths(start({ arms: [CASE.arms[0]!] }))).toEqual(["arm arms"]);
    expect(paths(bare({ arms: [CASE.arms[1]!, CASE.arms[1]!] }))).toEqual(["id arms[1].id"]);
    expect(paths(bare({ arms: [{ id: "Base", commit: A }, CASE.arms[1]!] }))).toEqual(["id arms[0].id"]);
    expect(paths(bare({ arms: ["base", CASE.arms[1]!] }))).toEqual(["shape arms[0]"]);
    expect(paths(start({ arms: [{ id: "base", commit: A, graft: "x" }, CASE.arms[1]!] }))).toEqual(["arm arms[0].graft"]);
    for (const path of ["../x.ts", "/x.ts", "a//b.ts", "a/./b.ts", "a\\b.ts", ""]) {
      expect(paths(start({ arms: [{ id: "base", commit: A, graft: [{ path, commit: B }] }, CASE.arms[1]!] }))).toEqual(["arm arms[0].graft[0].path"]);
    }
    expect(paths(start({ arms: [{ id: "base", commit: A, graft: [{ path: "a.ts", commit: "b" }] }, CASE.arms[1]!] }))).toEqual(["commit arms[0].graft[0].commit"]);
  });

  it("needs 1 point or more, each with a different id and amounts in the range of the variables of the subject", () => {
    expect(paths(bare({ points: [] }))).toEqual(["point points"]);
    expect(paths(bare({ points: [CASE.points[0]!, CASE.points[0]!] }))).toEqual(["id points[1].id"]);
    expect(paths(bare({ points: [{ id: "p" }] }))).toEqual(["shape points[0]"]);
    expect(paths(bare({ points: [{ id: "p", at: { days: { value: 1, unit: "d" } } }] }))).toEqual(["point points[0].at.days"]);
    expect(paths(bare({ points: [{ id: "p", at: { log: { value: 1, unit: "s" } } }] }))).toEqual(["point points[0].at.log"]);
    expect(paths(bare({ points: [{ id: "p", at: { log: { value: 8, unit: "GiB" } } }] }))).toEqual(["point points[0].at.log"]);
    expect(paths(bare({ points: [{ id: "p", at: { log: { value: 1, unit: "KiB" } } }] }))).toEqual(["point points[0].at.log"]);
    expect(paths(bare({ points: [{ id: "p", at: { log: { value: 1, unit: "MiB" } } }] }))).toEqual([]);
  });

  it("needs a seed, whole rounds from 1 to the most, and times above 0 and up to their limits", () => {
    expect(paths(start({ seed: "" }))).toEqual(["seed seed"]);
    for (const rounds of [0, 1.5, MAX_START_ROUNDS + 1]) expect(paths(start({ rounds }))).toEqual(["rounds rounds"]);
    expect(paths(start({ rounds: MAX_START_ROUNDS }))).toEqual([]);
    expect(paths(start({ watch: { value: 0, unit: "s" } }))).toEqual(["time watch"]);
    expect(paths(start({ watch: { value: MAX_WATCH.value + 1, unit: MAX_WATCH.unit } }))).toEqual(["time watch"]);
    expect(paths(start({ watch: { value: 1, unit: "B" } }))).toEqual(["time watch"]);
    expect(paths(start({ limit: { value: MAX_START.value + 1, unit: MAX_START.unit } }))).toEqual(["time limit"]);
  });

  it("needs a probe interval above 0 and up to its limit, and ready windows up to the limit in ascending order", () => {
    for (const probe of [{ value: 0, unit: "ms" }, { value: 2, unit: "min" }, { value: 1, unit: "B" }, 500]) expect(paths(start({ probe }))).toEqual(["time probe"]);
    expect(paths(start({ windows: [], observed: [] }))).toEqual(["time windows"]);
    expect(paths(start({ windows: "90 s", observed: [] }))).toEqual(["time windows"]);
    // An observation needs a window of the case.
    expect(paths(start({ windows: [] }))).toEqual(["time windows", "observed observed[0].window"]);
    expect(paths(start({ windows: [{ value: 6, unit: "min" }], observed: [] }))).toEqual(["time windows[0]"]);
    expect(paths(start({ windows: [{ value: 90, unit: "s" }, { value: 1.5, unit: "min" }] }))).toEqual(["time windows[1]"]);
    expect(paths(start({ windows: [{ value: 90, unit: "s" }, { value: 60, unit: "s" }] }))).toEqual(["time windows[1]"]);
    expect(paths(start({ windows: [{ value: 5, unit: "min" }], observed: [] }))).toEqual([]);
  });

  it("needs a target with an image, a Node version, memory of 6 MiB or more, swap, CPUs and a heap limit or null", () => {
    const target = (more: Record<string, unknown>): StartCase => start({ target: { ...CASE.target, ...more } });
    expect(paths(start({ target: null }))).toEqual(["target target"]);
    expect(paths(target({ heapLimit: null }))).toEqual([]);
    expect(paths(target({ swap: { value: 0, unit: "B" } }))).toEqual([]);
    for (const image of ["", "node 24", "-node", 24]) expect(paths(target({ image }))).toEqual(["target target.image"]);
    for (const node of ["24.21.0", "v24.21", "v24.21.0-rc.1"]) expect(paths(target({ node }))).toEqual(["target target.node"]);
    for (const memory of [{ value: 5, unit: "MiB" }, { value: 7340032.5, unit: "B" }, { value: 1, unit: "s" }]) expect(paths(target({ memory }))).toEqual(["target target.memory"]);
    for (const swap of [{ value: -1, unit: "B" }, { value: 0.5, unit: "B" }, null]) expect(paths(target({ swap }))).toEqual(["target target.swap"]);
    for (const cpus of [0, 1.5, 65, "2"]) expect(paths(target({ cpus }))).toEqual(["target target.cpus"]);
    for (const heapLimit of [{ value: 0, unit: "B" }, { value: 1, unit: "s" }, 556269568]) expect(paths(target({ heapLimit }))).toEqual(["target target.heapLimit"]);
  });

  it("needs each observation to name a point, an arm and a window of the case, with ready true or false and a source", () => {
    const observed = (more: Record<string, unknown>): StartCase => start({ observed: [{ ...CASE.observed[0]!, ...more }] });
    expect(paths(start({ observed: [] }))).toEqual([]);
    expect(paths(start({ observed: null }))).toEqual(["observed observed"]);
    expect(paths(start({ observed: ["x"] }))).toEqual(["observed observed[0]"]);
    expect(paths(observed({ point: "none" }))).toEqual(["observed observed[0].point"]);
    expect(paths(observed({ arm: "new~aa" }))).toEqual(["observed observed[0].arm"]);
    expect(paths(observed({ window: { value: 91, unit: "s" } }))).toEqual(["observed observed[0].window"]);
    expect(paths(observed({ window: { value: 1.5, unit: "min" } }))).toEqual([]);
    expect(paths(observed({ ready: "no" }))).toEqual(["observed observed[0].ready"]);
    expect(paths(observed({ source: " " }))).toEqual(["observed observed[0].source"]);
  });
});

describe("the amounts and the time of a start case", () => {
  it("give the min of a variable that a point does not name, and the sum of the bytes of a point", () => {
    expect(pointAmounts(ALERTS, CASE.points[0]!)).toEqual({ log: 16 * MIB, shapes: 0, transit: 0 });
    expect(pointAmounts(ALERTS, CASE.points[1]!)).toEqual({ log: 64 * MIB, shapes: 2 * MIB, transit: MIB });
    expect(pointBytes(ALERTS, CASE.points[1]!)).toBe(67 * MIB);
  });

  it("count a tree for the seeder only when no arm without a graft has its commit", () => {
    expect(treesOf(CASE)).toBe(3);
    expect(treesOf(start({ seeder: B }))).toBe(2);
    expect(treesOf(start({ seeder: A }))).toBe(3);
  });

  it("count a type check for each arm with a graft", () => {
    expect(checksOf(CASE)).toBe(1);
    expect(checksOf(start({ arms: [{ id: "base", commit: A }, CASE.arms[1]!] }))).toBe(0);
  });

  it("count one child of each arm and one A/A child, on each point, in each round", () => {
    expect(childrenOf(CASE)).toBe(2 * 2 * 3);
  });

  it("give the longest job: the margin of each step of the image, of each tree and of each type check, the seeds at the lowest rate and the longest child", () => {
    const child = 300 + 120 + CHILD_MARGIN.value;
    expect(IMAGE_STEPS * IMAGE_MARGIN.value).toBe(900);
    expect(startWindowOf(CASE)).toEqual({ value: 900 + (3 + 1) * TREE_MARGIN.value + (83 * MIB) / SEED_RATE + 12 * child, unit: "s" });
  });

  it("find the subject of a case, and tell a start case from a case of load", () => {
    expect(startSubjectOf(CASE)).toBe(START_SUBJECTS["alerts"]);
    expect(() => startSubjectOf(start({ subject: "nothing" }))).toThrow(RangeError);
    expect(isStartCase(CASE)).toBe(true);
    expect(isStartCase({ format: "capacity-case/1" })).toBe(false);
    expect(isStartCase(null)).toBe(false);
  });
});
