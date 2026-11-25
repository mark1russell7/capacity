import { readdirSync, readFileSync } from "node:fs";
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
  TREE_MARGIN,
  childrenOf,
  firstStartsOf,
  isStartCase,
  pointAmounts,
  pointBytes,
  startCaseProblems,
  startVariablesOf,
  startWindowOf,
  treesOf,
  type StartCase,
  type StartVariables,
} from "./start.ts";
import { APP_CASE } from "./app-fixtures.ts";

const MIB = 1024 * 1024;
const A = "a".repeat(40);
const C = "c".repeat(40);

/** This case is the app case of the tests with a seeder of its own, two rounds, two windows and one observation. */
const CASE: StartCase = {
  ...APP_CASE,
  seeder: C,
  rounds: 2,
  watch: { value: 120, unit: "s" },
  limit: { value: 5, unit: "min" },
  windows: [{ value: 90, unit: "s" }, { value: 4, unit: "min" }],
  target: { ...APP_CASE.target, heapLimit: { value: 556269568, unit: "B" } },
  observed: [{ point: "large", arm: "base", window: { value: 90, unit: "s" }, ready: false, source: "the supervisor of the machine: 3 stops" }],
};

const start = (more: Partial<StartCase> | Record<string, unknown>): StartCase => ({ ...CASE, ...more }) as StartCase;

/** This case has no observation, so a test of the arms or the points finds only their problems. */
const bare = (more: Partial<StartCase> | Record<string, unknown>): StartCase => start({ observed: [], ...more });
const paths = (value: StartCase): readonly string[] => startCaseProblems(value).map((each) => `${each.code} ${each.path}`);

describe("startCaseProblems", () => {
  it("gives no problem for a correct case, and for each case of each plan of the start of alerts in the folder of the plans", () => {
    expect(startCaseProblems(CASE)).toEqual([]);
    expect(startCaseProblems(APP_CASE)).toEqual([]);
    const folder = new URL("../plans/", import.meta.url);
    const plans = readdirSync(folder)
      .filter((name) => name.endsWith(".json"))
      .map((name) => ({ name, plan: JSON.parse(readFileSync(new URL(name, folder), "utf8")) as Plan }));
    // A plan with a start case has the name of a start plan, and a start plan has start cases only, each with no problem.
    const starts = plans.filter(({ plan }) => plan.cases.some(isStartCase));
    expect(starts.map(({ name }) => name)).toEqual(plans.map(({ name }) => name).filter((name) => name.startsWith("alerts-start")));
    expect(starts.map(({ name }) => name)).toContain("alerts-start-bytes-peak.json");
    for (const { plan } of starts) {
      expect(plan.cases.filter(isStartCase)).toHaveLength(plan.cases.length);
      expect(plan.cases.filter(isStartCase).flatMap((each) => startCaseProblems(each))).toEqual([]);
    }
  });

  it("refuses a value that is not a record, a wrong format, a bad id and no title", () => {
    expect(paths(null as unknown as StartCase)).toEqual(["shape "]);
    expect(paths(start({ format: "capacity-case/1" }))).toEqual(["format format"]);
    expect(paths(start({ id: "Bad Id" }))).toEqual(["id id"]);
    expect(paths(start({ title: " " }))).toEqual(["id title"]);
  });

  it("needs the HTTPS URL of the repository of an app, and the id of its contract as the subject", () => {
    const none: Record<string, unknown> = { ...CASE };
    delete none["app"];
    expect(paths(none as unknown as StartCase)).toEqual(["subject app"]);
    expect(startCaseProblems(none as unknown as StartCase)[0]?.message).toBe("The case has no app. Give the HTTPS URL of the repository of an app with a contract file.");
    expect(paths(start({ app: "git@github.com:example/fixture-app.git" }))).toEqual(["subject app"]);
    expect(paths(start({ app: 7 }))).toEqual(["subject app"]);
    expect(paths(start({ subject: "Fixture App" }))).toEqual(["subject subject"]);
    expect(paths(start({ subject: 7 }))).toEqual(["subject subject"]);
    expect(paths(start({ subject: "alerts" }))).toEqual([]);
  });

  it("refuses a seeder or a commit that is not 40 lower-case hexadecimal digits", () => {
    expect(paths(start({ seeder: "abc1234" }))).toEqual(["commit seeder"]);
    expect(paths(start({ arms: [{ id: "base", commit: A.toUpperCase() }, CASE.arms[1]!] }))).toEqual(["commit arms[0].commit"]);
  });

  it("needs 1 arm or more, each a record with a different id", () => {
    expect(paths(start({ arms: [], observed: [] }))).toEqual(["arm arms"]);
    // one arm is a ladder: it has the readings of its points and the A/A floor of its base, with no comparison
    expect(paths(start({ arms: [CASE.arms[0]!], observed: [] }))).toEqual([]);
    expect(paths(bare({ arms: [CASE.arms[1]!, CASE.arms[1]!] }))).toEqual(["id arms[1].id"]);
    expect(paths(bare({ arms: [{ id: "Base", commit: A }, CASE.arms[1]!] }))).toEqual(["id arms[0].id"]);
    // The tree of the seed has the id "seeder", thus an arm cannot have it.
    expect(paths(bare({ arms: [{ id: "seeder", commit: A }, CASE.arms[1]!] }))).toEqual(["id arms[0].id"]);
    expect(paths(bare({ arms: ["base", CASE.arms[1]!] }))).toEqual(["shape arms[0]"]);
  });

  it("needs 1 point or more, each with a different id, and each point names the variables of the first point in a unit of the same kind", () => {
    expect(paths(bare({ points: [] }))).toEqual(["point points"]);
    expect(paths(bare({ points: [CASE.points[0]!, CASE.points[0]!] }))).toEqual(["id points[1].id"]);
    expect(paths(bare({ points: [{ id: "p" }] }))).toEqual(["shape points[0]"]);
    // The case has no range of a variable: the measure reads the ranges from the contract of the app.
    const big = { id: "big", at: { log: { value: 64, unit: "GiB" } } };
    expect(paths(bare({ points: [...CASE.points, big] }))).toEqual([]);
    expect(paths(bare({ points: [...CASE.points, { id: "none", at: {} }] }))).toEqual(["point points[2].at"]);
    expect(paths(bare({ points: [...CASE.points, { id: "more", at: { ...big.at, shapes: { value: 1, unit: "KiB" } } }] }))).toEqual(["point points[2].at.shapes"]);
    expect(paths(bare({ points: [...CASE.points, { id: "time", at: { log: { value: 1, unit: "s" } } }] }))).toEqual(["point points[2].at.log"]);
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

  it("needs a disk with whole limits and a source, a known cache, and ballasts with bytes, a moment and what they model", () => {
    const disk = { readBytes: { value: 14, unit: "MiB/s" }, readOps: { value: 200, unit: "{read}/s" }, writeBytes: { value: 14, unit: "MiB/s" }, writeOps: { value: 200, unit: "{write}/s" }, source: "the study of the start" };
    const ballast = { bytes: { value: 322, unit: "MiB" }, at: "start", models: "the other processes of the machine" };
    const target = (more: Record<string, unknown>): StartCase => start({ target: { ...CASE.target, ...more } });
    expect(paths(target({ disk, cache: "cold", others: [ballast, { ...ballast, at: "ready" }] }))).toEqual([]);
    expect(paths(target({ cache: "warm" }))).toEqual([]);
    expect(paths(target({ disk: "fast" }))).toEqual(["target target.disk"]);
    const bad = { ...disk, readBytes: { value: 0.5, unit: "B/s" }, readOps: { value: 200, unit: "s" }, writeBytes: { value: 0, unit: "B/s" }, writeOps: 200, source: " " };
    expect(paths(target({ disk: bad }))).toEqual(["target target.disk.readBytes", "target target.disk.readOps", "target target.disk.writeBytes", "target target.disk.writeOps", "target target.disk.source"]);
    expect(paths(target({ cache: "hot" }))).toEqual(["target target.cache"]);
    expect(paths(target({ others: ballast }))).toEqual(["target target.others"]);
    const wrong = ["x", { bytes: { value: 0, unit: "B" }, at: "opened", models: " " }];
    expect(paths(target({ others: wrong }))).toEqual(["target target.others[0]", "target target.others[1].bytes", "target target.others[1].at", "target target.others[1].models"]);
  });

  it("needs the ballasts of an arm in the form of the target", () => {
    const arm = (more: Record<string, unknown>): StartCase => bare({ arms: [{ ...CASE.arms[0]!, ...more }, CASE.arms[1]!] });
    expect(paths(arm({ ballast: [{ bytes: { value: 69, unit: "MiB" }, at: "ready", models: "the bundle of the live start" }] }))).toEqual([]);
    expect(paths(arm({ ballast: [{ bytes: { value: 1, unit: "s" }, at: "ready", models: "x" }] }))).toEqual(["arm arms[0].ballast[0].bytes"]);
    expect(paths(arm({ ballast: {} }))).toEqual(["arm arms[0].ballast"]);
  });

  it("refuses the fields graft and snapshot of the old start subject on an arm", () => {
    const arm = (more: Record<string, unknown>): StartCase => bare({ arms: [{ ...CASE.arms[0]!, ...more }, CASE.arms[1]!] });
    expect(paths(arm({ graft: [] }))).toEqual(["arm arms[0].graft"]);
    expect(paths(arm({ snapshot: false }))).toEqual(["arm arms[0].snapshot"]);
  });

  it("needs the field after to name an earlier point with the same amounts, and a sample interval in its range", () => {
    const again = { id: "again", at: CASE.points[1]!.at, after: "large" };
    expect(paths(bare({ points: [...CASE.points, again] }))).toEqual([]);
    // A unit of the same kind gives the same amount.
    expect(paths(bare({ points: [...CASE.points, { ...again, at: { log: { value: 0.5, unit: "MiB" } } }] }))).toEqual([]);
    expect(paths(bare({ points: [again, ...CASE.points] }))).toEqual(["point points[0].after"]);
    expect(paths(bare({ points: [...CASE.points, { ...again, after: "again" }] }))).toEqual(["point points[2].after"]);
    expect(paths(bare({ points: [...CASE.points, { ...again, after: "none" }] }))).toEqual(["point points[2].after"]);
    expect(paths(bare({ points: [...CASE.points, { ...again, at: CASE.points[0]!.at }] }))).toEqual(["point points[2].at"]);
    expect(paths(start({ samples: { value: 5, unit: "s" } }))).toEqual([]);
    for (const samples of [{ value: 500, unit: "ms" }, { value: 2, unit: "min" }, { value: 1, unit: "B" }]) expect(paths(start({ samples }))).toEqual(["time samples"]);
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

  it("accepts the memory of the fakes as whole bytes of MIN_FAKES_MEMORY or more", () => {
    expect(paths(start({ fakes: { value: 256, unit: "MiB" } }))).toEqual([]);
    expect(paths(start({ fakes: { value: 32, unit: "MiB" } }))).toEqual(["target fakes"]);
    expect(paths(start({ fakes: { value: 1.5, unit: "B" } }))).toEqual(["target fakes"]);
    expect(paths(start({ fakes: { value: 1, unit: "s" } }))).toEqual(["target fakes"]);
  });
});

describe("the amounts and the time of a start case", () => {
  it("give the variables of the first point, the min of a variable that a point does not name, and the sum of the bytes of a point", () => {
    expect(startVariablesOf(CASE)).toEqual({ variables: { log: { unit: "KiB", min: 0, max: Infinity } } });
    expect(pointBytes(startVariablesOf(CASE), CASE.points[1]!)).toBe(512 * 1024);
    // A variable of a unit that is not a unit of data adds no bytes.
    const variables: StartVariables = { variables: { log: { unit: "MiB", min: 0, max: 4096 }, shapes: { unit: "MiB", min: 1, max: 64 }, days: { unit: "d", min: 1, max: 30 } } };
    const point = { id: "p", at: { log: { value: 64, unit: "MiB" }, days: { value: 2, unit: "d" } } };
    expect(pointAmounts(variables, point)).toEqual({ log: 64, shapes: 1, days: 2 });
    expect(pointBytes(variables, point)).toBe(65 * MIB);
  });

  it("count a tree for the seeder only when no arm has its commit", () => {
    expect(treesOf(CASE)).toBe(3);
    expect(treesOf(start({ seeder: A }))).toBe(2);
  });

  it("count one child of each arm and one A/A child, on each point, in each round, and one first start of each arm for each point with the field after", () => {
    expect(childrenOf(CASE)).toBe(2 * 2 * 3);
    expect(firstStartsOf(CASE)).toBe(0);
    const again = start({ points: [...CASE.points, { id: "again", at: CASE.points[1]!.at, after: "large" }] });
    expect(childrenOf(again)).toBe(3 * 2 * 3);
    expect(firstStartsOf(again)).toBe(2);
  });

  it("give the longest job: the margin of each step of the image and of each tree, the seeds at the lowest rate and the longest child", () => {
    const child = 300 + 120 + CHILD_MARGIN.value;
    expect(IMAGE_STEPS * IMAGE_MARGIN.value).toBe(900);
    expect(startWindowOf(CASE)).toEqual({ value: 900 + 3 * TREE_MARGIN.value + (513 * 1024) / SEED_RATE + 12 * child, unit: "s" });
    // A point with the field after has no seed, and it adds 6 children and 2 first starts.
    const again = start({ points: [...CASE.points, { id: "again", at: CASE.points[1]!.at, after: "large" }] });
    expect(startWindowOf(again)).toEqual({ value: 900 + 3 * TREE_MARGIN.value + (513 * 1024) / SEED_RATE + 20 * child, unit: "s" });
  });

  it("tell a start case from a case of load", () => {
    expect(isStartCase(CASE)).toBe(true);
    expect(isStartCase({ format: "capacity-case/1" })).toBe(false);
    expect(isStartCase(null)).toBe(false);
  });
});
