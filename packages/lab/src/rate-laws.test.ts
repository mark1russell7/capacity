import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { lawKnee, lawValue, type Law } from "@mark1russell7/capacity";
import { readLaw } from "@mark1russell7/capacity/schema";
import { describe, expect, it } from "vitest";
import { readPlans } from "./plan.ts";

/** This folder holds the law files of the plan `rate`. A pull request puts them into the package capacity. */
const LAWS = fileURLToPath(new URL("../../capacity/laws/node-http/rate/", import.meta.url));
const RATE = readPlans(fileURLToPath(new URL("../plans/", import.meta.url))).plans.find((each) => each.id === "rate");
const SUFFIX = ".law.json";

/**
 * This number is the largest root mean square of the relative held-out residuals of a law with a served share.
 * Before the cut, the latency laws had 1.60, 1.25 and 0.70. Thus a law of 1 or more is a regression.
 */
const HELD_OUT_LIMIT = 1;

const files = readdirSync(LAWS, { recursive: true, encoding: "utf8" })
  .filter((name) => name.endsWith(SUFFIX))
  .map((name) => name.split(sep).join("/"))
  .sort();

/** This function reads one law file, or throws with each problem of the file. */
const lawOf = (name: string): Law => {
  const result = readLaw(JSON.parse(readFileSync(join(LAWS, name), "utf8")));
  if (result.tag === "err") throw new Error(result.error.map((each) => `${each.path}: ${each.message}`).join("\n"));
  return result.value;
};

describe("the law files of the plan rate", () => {
  it("has a law of each measure of the law set on each CPU model of the folder, except the measures with a known mark", () => {
    // A folder with no file gives no read, not a pass.
    expect(RATE?.laws).toBeDefined();
    const models = [...new Set(files.map((name) => name.split("/")[0]!))];
    expect(models.length).toBeGreaterThan(0);
    // Each known code refuses the law, thus a measure with a known mark has no law file until its item removes the mark.
    const measures = (RATE?.laws?.measures ?? [])
      .filter((measure) => measure.known === undefined)
      .map((measure) => `${measure.id}${SUFFIX}`)
      .sort();
    for (const model of models) expect(files.filter((name) => name.startsWith(`${model}/`)).map((name) => name.slice(model.length + 1))).toEqual(measures);
  });

  it.each(files)("%s has the rules of its measure, a finite value with an interval at each end of its range, and its knee in the range", (name) => {
    const law = lawOf(name);
    const measure = RATE?.laws?.measures.find((each) => each.id === law.measure.id);
    expect(measure).toBeDefined();
    if (measure === undefined) return;
    expect([law.conditions["served"], law.conditions["tail"]]).toEqual([measure.served, measure.tail]);
    const variable = law.variables[0]!;
    for (const load of [variable.min, variable.max]) {
      const value = lawValue(law, { [variable.id]: load });
      expect(value.tag === "err" ? value.error : []).toEqual([]);
      if (value.tag !== "ok") continue;
      expect([value.value.value, value.value.interval.low, value.value.interval.high].every(Number.isFinite)).toBe(true);
      expect(value.value.outside).toEqual([]);
    }
    if (measure.served !== undefined) {
      const residuals = law.fit.residuals;
      const rms = Math.sqrt(residuals.reduce((sum, residual) => sum + residual * residual, 0) / residuals.length);
      expect(rms).toBeLessThan(HELD_OUT_LIMIT);
    }
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
