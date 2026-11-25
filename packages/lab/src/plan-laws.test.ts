import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { lawKnee, lawValue, type Law } from "@mark1russell7/capacity";
import { readLaw } from "@mark1russell7/capacity/schema";
import { describe, expect, it } from "vitest";
import { OVERHEAD_SUFFIX } from "./laws.ts";
import { readPlans, type Plan } from "./plan.ts";

/** This folder holds the law files of the plans. A pull request puts them into the package capacity: `<subject>/<plan>/<cpu>/<measure>.law.json`. */
const LAWS = fileURLToPath(new URL("../../capacity/laws/", import.meta.url));
const PLANS = readPlans(fileURLToPath(new URL("../plans/", import.meta.url))).plans;
const SUFFIX = ".law.json";

/**
 * These folders are the folders of the law files, each `<subject>/<plan>`. A folder that goes away fails the test,
 * because a folder with no file gives no read, not a pass.
 */
const FOLDERS = ["node-http-service/overhead", "node-http/rate"];

/**
 * These folders hold the laws of start plans, each `<subject>/<plan>`. Their files are
 * `<cpu>/<arm>/<start>/<law>.law.json`, and the start law set of the plan names each law.
 */
const START_FOLDERS = ["alerts-runtime/alerts-start-event", "alerts-runtime/alerts-start-feeds", "alerts-runtime/alerts-start-log", "alerts-runtime/alerts-start-persons", "alerts-runtime/alerts-start-routes"];

/**
 * This number is the largest root mean square of the relative held-out residuals of a law.
 * Before the cut, the latency laws had 1.60, 1.25 and 0.70. Thus a law of 1 or more is a regression.
 * For absolute residuals, the limit is this number times the largest value of the law at an end of its range.
 */
const HELD_OUT_LIMIT = 1;

const files = readdirSync(LAWS, { recursive: true, encoding: "utf8" })
  .filter((name) => name.endsWith(SUFFIX))
  .map((name) => name.split(sep).join("/"))
  .sort();

/** This function gives the folder `<subject>/<plan>` of a law file. */
const folderOf = (name: string): string => name.split("/").slice(0, 2).join("/");

/** These files are the law files of the plans with a law set. */
const rateFiles = files.filter((name) => FOLDERS.includes(folderOf(name)));
/** These files are the law files of the start plans. */
const startFiles = files.filter((name) => START_FOLDERS.includes(folderOf(name)));

/** This function reads one law file, or throws with each problem of the file. */
const lawOf = (name: string): Law => {
  const result = readLaw(JSON.parse(readFileSync(join(LAWS, name), "utf8")));
  if (result.tag === "err") throw new Error(result.error.map((each) => `${each.path}: ${each.message}`).join("\n"));
  return result.value;
};

/** This function gives the plan of a folder. It throws when no plan has a law set with the id of the folder. */
const planOf = (folder: string): Plan & { readonly laws: NonNullable<Plan["laws"]> } => {
  const plan = PLANS.find((each) => each.id === folder.split("/")[1]);
  if (plan?.laws === undefined) throw new Error(`No plan with a law set has the id of the folder "${folder}".`);
  return plan as Plan & { readonly laws: NonNullable<Plan["laws"]> };
};

/** This function gives the id of the measure of a law file of a plan: an overhead law has the suffix of an overhead. */
const lawMeasureOf = (plan: Plan & { readonly laws: NonNullable<Plan["laws"]> }, id: string): string => (plan.laws.base === undefined ? id : `${id}${OVERHEAD_SUFFIX}`);

describe("the law files of the plans", () => {
  it("has the law files of each folder, and each folder has a plan with a law set", () => {
    expect([...new Set(files.map(folderOf))].sort()).toEqual([...FOLDERS, ...START_FOLDERS].sort());
    for (const folder of FOLDERS) expect(planOf(folder).laws.measures.length).toBeGreaterThan(0);
  });

  it.each(FOLDERS)("%s has a law of each measure of its law set on each CPU model of the folder, except the measures with a known mark", (folder) => {
    const plan = planOf(folder);
    const inside = files.filter((name) => folderOf(name) === folder).map((name) => name.slice(folder.length + 1));
    const models = [...new Set(inside.map((name) => name.split("/")[0]!))];
    expect(models.length).toBeGreaterThan(0);
    // Each known code refuses the law, thus a measure with a known mark has no law file until its item removes the mark.
    const measures = plan.laws.measures
      .filter((measure) => measure.known === undefined)
      .map((measure) => `${lawMeasureOf(plan, measure.id)}${SUFFIX}`)
      .sort();
    for (const model of models) expect(inside.filter((name) => name.startsWith(`${model}/`)).map((name) => name.slice(model.length + 1))).toEqual(measures);
  });

  it.each(rateFiles)("%s has the rules of its measure, a finite value with an interval at each end of its range, and its knee in the range", (name) => {
    const law = lawOf(name);
    const plan = planOf(folderOf(name));
    const measure = plan.laws.measures.find((each) => lawMeasureOf(plan, each.id) === law.measure.id);
    expect(measure).toBeDefined();
    if (measure === undefined) return;
    expect([law.conditions["served"], law.conditions["tail"]]).toEqual([measure.served, measure.tail]);
    // An overhead law names the subject of its base side, and its residual is absolute: a difference can be 0 or less.
    if (plan.laws.base !== undefined) {
      const base = (plan.cases as readonly { readonly id: string; readonly subject: string }[]).find((each) => each.id.endsWith(`/${plan.laws.base}`));
      expect([law.conditions["base"], law.fit.residual]).toEqual([base?.subject, "absolute"]);
    }
    const variable = law.variables[0]!;
    const ends: number[] = [];
    for (const load of [variable.min, variable.max]) {
      const value = lawValue(law, { [variable.id]: load });
      expect(value.tag === "err" ? value.error : []).toEqual([]);
      if (value.tag !== "ok") continue;
      expect([value.value.value, value.value.interval.low, value.value.interval.high].every(Number.isFinite)).toBe(true);
      expect(value.value.outside).toEqual([]);
      ends.push(Math.abs(value.value.value));
    }
    const residuals = law.fit.residuals;
    const rms = Math.sqrt(residuals.reduce((sum, residual) => sum + residual * residual, 0) / residuals.length);
    expect(rms).toBeLessThan(law.fit.residual === "relative" ? HELD_OUT_LIMIT : HELD_OUT_LIMIT * Math.max(...ends));
    if (measure.knee === undefined) return;
    const knee = lawKnee(law, variable.id, measure.knee);
    expect(knee.tag === "err" ? knee.error : []).toEqual([]);
    if (knee.tag !== "ok") return;
    const { value, interval } = knee.value.knee;
    // The knee and its interval are in the range of the law, and the range has no pole. A knee at the start of the range is not a knee.
    for (const load of [value, interval.low, interval.high]) {
      expect(load).not.toBeNull();
      expect(load as number).toBeGreaterThan(variable.min);
      expect(load as number).toBeLessThanOrEqual(variable.max);
    }
    expect(knee.value.edge.value).toBeNull();
  });
});

describe("the law files of the start plans", () => {
  it.each(startFiles)("%s is a law of the start law set of its plan, with a finite value at each end of its range", (name) => {
    const law = lawOf(name);
    const plan = PLANS.find((each) => each.id === folderOf(name).split("/")[1]);
    expect(plan?.startLaws).toBeDefined();
    if (plan?.startLaws === undefined) return;
    const parts = name.split("/");
    // The path is `<subject>/<plan>/<cpu>/<arm>/<start>/<law>.law.json`.
    expect(parts.length).toBe(6);
    expect(["first", "second"]).toContain(parts[4]);
    const measure = plan.startLaws.measures.find((each) => `${each.law}${SUFFIX}` === parts[5]);
    expect(measure).toBeDefined();
    if (measure === undefined) return;
    expect(law.fit.residual).toBe(measure.residual);
    const variable = law.variables[0]!;
    expect([law.variables.length, variable.id]).toEqual([1, plan.startLaws.variable.id]);
    const ends: number[] = [];
    for (const load of [variable.min, variable.max]) {
      const value = lawValue(law, { [variable.id]: load });
      expect(value.tag === "err" ? value.error : []).toEqual([]);
      if (value.tag !== "ok") continue;
      expect([value.value.value, value.value.interval.low, value.value.interval.high].every(Number.isFinite)).toBe(true);
      ends.push(Math.abs(value.value.value));
    }
    const residuals = law.fit.residuals;
    const rms = Math.sqrt(residuals.reduce((sum, residual) => sum + residual * residual, 0) / residuals.length);
    expect(rms).toBeLessThan(law.fit.residual === "relative" ? HELD_OUT_LIMIT : HELD_OUT_LIMIT * Math.max(...ends));
  });
});
