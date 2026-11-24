import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compositionValue, scaleDemand, scaleLadder, scaleRule, type Composition, type CompositionValue, type ScaleRule } from "@mark1russell7/capacity";
import { describe, expect, it } from "vitest";
import { BENCH_OPTIONS, BENCH_RATE, cpuModel, demandAt, readsRate } from "./bench-scale.ts";
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
  const cpus = compositions.filter((composition) => composition.measure.id === "cpu" && readsRate(composition, { laws, compositions }));
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
});

describe("the real compositions past their measures", () => {
  const laws = readLaws(join(CAPACITY, "laws"));
  const compositions = readCompositions(join(CAPACITY, "compositions"));
  const catalog = { laws, compositions };
  const cpus = compositions.filter((composition) => composition.measure.id === "cpu" && readsRate(composition, catalog));

  /** This function gives the id of each law in the parts of a composition value, in its nested parts too. */
  const lawsIn = (parts: CompositionValue["parts"]): readonly string[] => parts.flatMap((part) => (part.kind === "law" ? [part.law] : lawsIn(part.parts)));

  /** This function gives the highest rate that any law of a composition measured. Past it, each law of the composition holds. */
  const measuredTop = (composition: Composition): number => {
    const parts = must(compositionValue(composition, catalog, demandAt(BENCH_RATE))).parts;
    return Math.max(...lawsIn(parts).map((id) => laws.find((law) => law.id === id)?.variables.find((each) => each.id === "rate")?.max ?? Infinity));
  };

  it.each(cpus.map((composition) => [composition.id, composition] as const))(
    "never gives a cost of one request below its cost at the end of all the measures for %s",
    (_, composition) => {
      const top = measuredTop(composition);
      expect(Number.isFinite(top)).toBe(true);
      const perRequest = (rate: number): number => must(compositionValue(composition, catalog, demandAt(rate))).value / rate;
      for (const times of [2, 10, 100, 1000]) expect(perRequest(top * times), `${times} times the top`).toBeGreaterThanOrEqual(perRequest(top) * (1 - 1e-12));
    },
  );

  it.each(cpus.map((composition) => [composition.id, composition] as const))("fills one instance at a finite load for %s", (_, composition) => {
    const ladder = must(scaleLadder(cpuModel(composition, catalog), demandAt(BENCH_RATE), RANGE, BENCH_OPTIONS));
    expect(Number.isFinite(ladder.limits[0]?.rows[0] ?? Infinity)).toBe(true);
  }, 120_000);
});
