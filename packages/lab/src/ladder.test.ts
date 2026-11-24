import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as Capacity from "@mark1russell7/capacity";
import { scaleDemand, scaleLadder, scaleRule, type ScaleRule } from "@mark1russell7/capacity";
import { describe, expect, it } from "vitest";
import { BENCH_OPTIONS, BENCH_RATE, SLIDER_FACTORS, benchCases, cpuModel, demandAt } from "./bench-scale.ts";
import { readCompositions, readLaws } from "./jobs.ts";

/** This folder holds the files of the package capacity. */
const CAPACITY = fileURLToPath(new URL("../../capacity/", import.meta.url));

/** The range of the ladder. A slider of the site moves the load in a range of this size. */
const RANGE = { low: 0.05, high: 20 };

/** These factors are in the range. Each one is a slider move that the gate compares with one query of the scale rule. */
const FACTORS = [0.05, 0.37, 1, 4.2, 20];

/** This function gives the value of a result, or throws the problem. */
const must = <T>(result: { readonly tag: "ok"; readonly value: T } | { readonly tag: "err"; readonly error: unknown }): T => {
  if (result.tag === "err") throw new Error(JSON.stringify(result.error));
  return result.value;
};

/** This function gives the parts of a scale rule that a reader of the slider sees: each count, the binding limit and the next step. */
const seen = (rule: ScaleRule) => ({
  count: rule.count,
  binding: rule.binding,
  extrapolated: rule.extrapolated,
  limits: rule.limits.map(({ limit, count, edge, extrapolated }) => ({ limit, count, edge, extrapolated })),
  next: rule.next === null ? null : { count: rule.next.count, binding: rule.next.binding, factor: rule.next.factor.value },
});

describe("the scale ladder on the real compositions", () => {
  const laws = readLaws(join(CAPACITY, "laws"));
  const compositions = readCompositions(join(CAPACITY, "compositions"));
  const cpus = compositions.filter((composition) => composition.measure.id === "cpu");
  const demand = demandAt(BENCH_RATE);

  it("has a composition of the processor time to compare", () => {
    expect(cpus.length).toBeGreaterThan(0);
  });

  it.each(cpus.map((composition) => [composition.id, composition] as const))(
    "gives the counts, the binding limit and the next step of the scale rule for %s",
    (_, composition) => {
      const model = cpuModel(composition, { laws, compositions });
      const ladder = must(scaleLadder(model, demand, RANGE, BENCH_OPTIONS));
      for (const factor of FACTORS) {
        const expected = seen(must(scaleRule(model, must(scaleDemand(demand, factor)), BENCH_OPTIONS)));
        const found = seen(must(ladder.ruleAt(factor)));
        expect({ ...found, next: found.next && { ...found.next, factor: null } }, `factor ${factor}`).toEqual({
          ...expected,
          next: expected.next && { ...expected.next, factor: null },
        });
        if (expected.next !== null && expected.next.factor !== null) expect(found.next?.factor).toBeCloseTo(expected.next.factor, 6);
      }
    },
    120_000,
  );

  it("gives the same counts in the slider case of a base with no ladder and of a head with the ladder", () => {
    const slider = benchCases({ laws, compositions }).find((each) => each.id.startsWith("slider:node-http/"));
    expect(slider).toBeDefined();
    if (slider === undefined) return;
    const { scaleLadder: _, ...base } = Capacity;
    const counts = (rules: unknown): unknown => (rules as readonly ScaleRule[]).map((rule) => [rule.count, rule.binding, rule.next?.count ?? null]);
    const head = slider.run(Capacity) as readonly ScaleRule[];
    expect(head).toHaveLength(SLIDER_FACTORS.length);
    expect(counts(slider.run(base))).toEqual(counts(head));
  }, 120_000);
});
