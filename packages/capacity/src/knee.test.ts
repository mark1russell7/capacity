import type { Result } from "@mark1russell7/optional";
import { quantity, type Quantity } from "@mark1russell7/quantity";
import { quantile } from "@mark1russell7/rigor-statistics";
import { app, ref, type Expr } from "@mark1russell7/vex";
import { describe, expect, it } from "vitest";
import { checkLaw } from "./check.ts";
import { catalogForm, constantIdsOf, formOf } from "./forms.ts";
import { kneeRuleProblem, lawKnee, lawReach, type Knee, type KneeOptions, type KneeRule, type Reach } from "./knee.ts";
import type { Law, LawProblem, Variable } from "./law.ts";
import { hinge, sampleLaw, wave } from "./sample.fixture.ts";

const must = <T>(result: Result<T, LawProblem>): T => {
  if (result.tag === "err") throw new Error(`${result.error.code} at ${result.error.path}: ${result.error.message}`);
  return result.value;
};

const problemOf = (result: Result<Knee, LawProblem>): LawProblem => {
  if (result.tag === "ok") throw new Error("The search gave a knee, not a problem.");
  return result.error;
};

/**
 * This function gives a law of one variable `rate` from a form of the catalog. Each replicate is the
 * estimate, with the share `spread` of a wave added to each named constant.
 */
const lawOf = (
  formId: string,
  constants: Readonly<Record<string, number>>,
  variable: Partial<Variable> = {},
  spread: Readonly<Record<string, number>> = {},
): Law => {
  const form = catalogForm(formId);
  if (form === undefined) throw new Error(`The catalog has no form "${formId}".`);
  const ids = constantIdsOf(form);
  const estimate = ids.map((id) => constants[id] as number);
  return {
    ...sampleLaw(),
    id: `test/${formId}`,
    variables: [{ id: "rate", unit: "{request}/s", min: 0, max: 100, scale: "linear", ...variable }],
    form: formOf(form, { variable: "rate" }),
    constants: ids.map((id, index) => ({ id, value: estimate[index] as number })),
    replicates: Array.from({ length: 40 }, (_, row) =>
      estimate.map((value, column) => value * (1 + (spread[ids[column] as string] ?? 0) * wave(row, column))),
    ),
  };
};

/** This function gives a law with its own program, and its constants and replicates as `lawOf` makes them. */
const programLaw = (program: Expr, constants: Readonly<Record<string, number>>, variables: readonly Variable[]): Law => {
  const ids = Object.keys(constants);
  const estimate = ids.map((id) => constants[id] as number);
  return {
    ...sampleLaw(),
    id: "test/program",
    variables,
    form: { id: "program", program },
    constants: ids.map((id, index) => ({ id, value: estimate[index] as number })),
    replicates: Array.from({ length: 40 }, () => estimate),
  };
};

const kneeOf = (law: Law, rule: KneeRule, options: KneeOptions = {}): Knee => must(lawKnee(law, "rate", rule, options));

const HINGE = { base: 1, slope: 1, bend: 3, knee: 50 };
const QUEUE = { base: 0.5, scale: 1, capacity: 100 };
const QUEUE_RANGE = { min: 1, max: 99 };
const SCALABILITY = { unit: 1, contention: 0.1, coherency: 0.01 };

/** The load where the queue of `QUEUE` on `QUEUE_RANGE` is `1 + share` times its value at 1: the algebra of the form. */
const queueRise = (share: number): number => 100 - 100 / ((1 + share) * (0.5 + 100 / 99) - 0.5);

/** The base, then the logarithm of the capacity less the rate: the law has no value from the capacity up. */
const lostValue: Expr = app("subtract", ref("base"), app("ln", app("subtract", ref("capacity"), ref("rate"))));

const NO_CROSSING = { value: null, interval: { low: null, high: null }, outside: false };

describe("the laws of the tests", () => {
  it("have no problem", () => {
    const rate: Variable = { id: "rate", unit: "{request}/s", min: 0, max: 99, scale: "linear" };
    for (const law of [
      lawOf("hinge", HINGE),
      lawOf("queue", QUEUE, QUEUE_RANGE),
      lawOf("scalability", SCALABILITY, { min: 1 }),
      programLaw(lostValue, { base: 10, capacity: 100 }, [rate]),
    ]) {
      expect(checkLaw(law)).toEqual([]);
    }
  });
});

describe("lawKnee", () => {
  it("finds the knee of a hinge with the rule slope", () => {
    const found = kneeOf(lawOf("hinge", HINGE), { kind: "slope", factor: 2 });
    expect(found.knee.value).toBeCloseTo(50, 4);
    expect(found.knee.interval).toEqual({ low: found.knee.value, high: found.knee.value });
    expect(found.knee.outside).toBe(false);
    expect(found.edge).toEqual(NO_CROSSING);
    expect(found).toMatchObject({ variable: "rate", unit: "{request}/s", level: 0.95, search: { low: 0, high: 100 }, outside: [] });
  });

  it("gives no knee when the law does not obey the rule in the search", () => {
    // After the knee the slope is 4 times the first slope, thus never 5 times.
    expect(kneeOf(lawOf("hinge", HINGE), { kind: "slope", factor: 5 }).knee).toEqual(NO_CROSSING);
    expect(kneeOf(lawOf("hinge", HINGE), { kind: "rise", share: 1000 }).knee).toEqual(NO_CROSSING);
  });

  it("finds the knee of a queue with each rule, as the algebra of the form gives it", () => {
    const law = lawOf("queue", QUEUE, QUEUE_RANGE);
    // The slope of the queue is capacity / (capacity - x)^2. It is 4 times the slope at 1 where 100 - x = 99 / 2.
    expect(kneeOf(law, { kind: "slope", factor: 4 }).knee.value).toBeCloseTo(50.5, 4);
    for (const share of [0.1, 0.5, 1, 3]) {
      expect(kneeOf(law, { kind: "rise", share }).knee.value).toBeCloseTo(queueRise(share), 6);
    }
    expect(kneeOf(law, { kind: "rise", share: 1 }).edge).toEqual(NO_CROSSING);
  });

  it("finds the edge of a queue at its capacity, after the knee", () => {
    const found = kneeOf(lawOf("queue", QUEUE, QUEUE_RANGE), { kind: "rise", share: 1 }, { to: 150 });
    expect(found.edge.value).toBeCloseTo(100, 9);
    expect(found.edge.outside).toBe(true);
    expect(found.knee.value).toBeCloseTo(queueRise(1), 6);
    expect(found.knee.outside).toBe(false);
  });

  it("finds a knee near the edge, before the edge", () => {
    // The queue is 1e6 times its start value only in the last 1e-4 before its capacity.
    const found = kneeOf(lawOf("queue", QUEUE, QUEUE_RANGE), { kind: "rise", share: 1e6 }, { to: 150 });
    expect(found.knee.value).toBeCloseTo(queueRise(1e6), 6);
    expect(found.knee.value as number).toBeLessThan(found.edge.value as number);
  });

  it("finds the edge when a load of the grid is the pole", () => {
    // From 0 to 200 in 64 steps, the load of step 32 is 100, the capacity.
    const found = kneeOf(lawOf("queue", QUEUE, QUEUE_RANGE), { kind: "slope", factor: 4 }, { from: 0, to: 200 });
    expect(found.edge.value).toBeCloseTo(100, 9);
  });

  it("finds a pole that no load reaches exactly", () => {
    // The square of each float near the root of 2 is not 2. Thus the law has a finite value at each load, and only the size test finds the pole.
    const rate: Variable = { id: "rate", unit: "{request}/s", min: 0, max: 1.4, scale: "linear" };
    const program = app("divide", ref("scale"), app("subtract", ref("capacity"), app("multiply", ref("rate"), ref("rate"))));
    const law = programLaw(program, { scale: 1, capacity: 2 }, [rate]);
    expect(checkLaw(law)).toEqual([]);
    const found = kneeOf(law, { kind: "rise", share: 1 }, { to: 3 });
    expect(found.edge.value).toBeCloseTo(Math.SQRT2, 9);
    // 1 / (2 - x^2) is 2 times its start value, 1 / 2, at x = 1.
    expect(found.knee.value).toBeCloseTo(1, 6);
  });

  it("finds a pole that grows as a logarithm and that no load reaches exactly", () => {
    // Near the root of 2, the size of 10 - ln((2 - x^2)^2) at the float limit is only 2 to 3 times its size at 1e-6 of a step.
    const rate: Variable = { id: "rate", unit: "{request}/s", min: 0, max: 3, scale: "linear" };
    const distance = app("subtract", ref("capacity"), app("multiply", ref("rate"), ref("rate")));
    const law = programLaw(app("subtract", ref("base"), app("ln", app("multiply", distance, distance))), { base: 10, capacity: 2 }, [rate]);
    expect(checkLaw(law)).toEqual([]);
    const found = kneeOf(law, { kind: "rise", share: 1 });
    expect(found.edge.value).toBeCloseTo(Math.SQRT2, 9);
    expect(found.edge.outside).toBe(false);
    // 10 - 2 ln(2 - x^2) is 2 times 10 - 2 ln(2) where ln(2 - x^2) = 2 ln(2) - 5.
    expect(found.knee.value).toBeCloseTo(Math.sqrt(2 - Math.exp(2 * Math.log(2) - 5)), 6);
  });

  it("gives no edge for a finite peak, also a narrow peak or a flat peak at the limit of the floats", () => {
    const rate: Variable = { id: "rate", unit: "{request}/s", min: 0, max: 3, scale: "linear" };
    const offset = app("subtract", ref("rate"), ref("center"));
    const square = app("multiply", offset, offset);
    // A peak 1e-6 wide, between two loads of the grid: its size changes at the far distance of the pole test, and much less nearer.
    const narrow = programLaw(app("add", ref("base"), app("divide", ref("scale"), app("add", square, ref("width")))), { base: 1, scale: 1, center: 1.3, width: 1e-12 }, [rate]);
    // At 1e8, the floats near the top round to one value: the gains of the pole test are 0.
    const flat = programLaw(app("subtract", ref("base"), square), { base: 1e8, center: 1.5 }, [rate]);
    for (const law of [narrow, flat]) {
      expect(checkLaw(law)).toEqual([]);
      expect(kneeOf(law, { kind: "rise", share: 1 }).edge).toEqual(NO_CROSSING);
    }
  });

  it("finds the edge where a region with no value starts", () => {
    const rate: Variable = { id: "rate", unit: "{request}/s", min: 0, max: 99, scale: "linear" };
    const found = kneeOf(programLaw(lostValue, { base: 10, capacity: 100 }, [rate]), { kind: "rise", share: 1 }, { to: 150 });
    expect(found.edge.value).toBeCloseTo(100, 9);
    // 10 - ln(100 - x) is 2 times its start value, 10 - ln(100), where ln(100 - x) = 2 ln(100) - 10.
    expect(found.knee.value).toBeCloseTo(100 - Math.exp(2 * Math.log(100) - 10), 6);
  });

  it("gives no edge for the peak of the scalability law, and finds its first knee", () => {
    const law = lawOf("scalability", SCALABILITY, { min: 1 });
    const found = kneeOf(law, { kind: "rise", share: 1 });
    expect(found.edge).toEqual(NO_CROSSING);
    // x / (1 + 0.1 (x - 1) + 0.01 x (x - 1)) = 2 where 0.02 x^2 - 0.82 x + 1.8 = 0.
    expect(found.knee.value).toBeCloseTo((0.82 - Math.sqrt(0.82 ** 2 - 4 * 0.02 * 1.8)) / 0.04, 6);
    // The slope of the throughput falls after the start, thus it is never 2 times the first slope.
    expect(kneeOf(law, { kind: "slope", factor: 2 }).knee).toEqual(NO_CROSSING);
  });

  it("gives the interval of the replicates for the edge and for the knee", () => {
    const queue = lawOf("queue", QUEUE, QUEUE_RANGE, { capacity: 0.02 });
    const capacities = queue.replicates.map((row) => row[2] as number);
    const edge = kneeOf(queue, { kind: "rise", share: 1 }, { to: 150 }).edge;
    expect(edge.value).toBeCloseTo(100, 9);
    expect(edge.interval.low).toBeCloseTo(quantile(capacities, 0.025), 9);
    expect(edge.interval.high).toBeCloseTo(quantile(capacities, 0.975), 9);

    const hinged = lawOf("hinge", HINGE, {}, { knee: 0.02 });
    const knees = hinged.replicates.map((row) => row[3] as number);
    const knee = kneeOf(hinged, { kind: "slope", factor: 2 }).knee;
    expect(knee.interval.low).toBeCloseTo(quantile(knees, 0.025), 4);
    expect(knee.interval.high).toBeCloseTo(quantile(knees, 0.975), 4);
  });

  it("gives a null end of an interval past the end of the search", () => {
    // The knees of the replicates go from 85.5 to 104.5, thus some are past the end, 100.
    const found = kneeOf(lawOf("hinge", { ...HINGE, knee: 95 }, {}, { knee: 0.1 }), { kind: "slope", factor: 2 });
    expect(found.knee.value).toBeCloseTo(95, 4);
    expect(found.knee.interval.low as number).toBeLessThan(95);
    expect(found.knee.interval.high).toBeNull();
  });

  it("marks a knee outside the range of the variable", () => {
    const found = kneeOf(lawOf("hinge", HINGE, { max: 40 }), { kind: "slope", factor: 2 }, { to: 100 });
    expect(found.knee.value).toBeCloseTo(50, 4);
    expect(found.knee.outside).toBe(true);
  });

  it("finds the knee of the sample law on its log scale, with an interval", () => {
    const law = sampleLaw();
    const slope = must(lawKnee(law, "rate", { kind: "slope", factor: 2 }));
    expect(slope.knee.value).toBeCloseTo(2500, 3);
    expect(slope.knee.interval.low as number).toBeGreaterThan(2400);
    expect(slope.knee.interval.low as number).toBeLessThan(2500);
    expect(slope.knee.interval.high as number).toBeGreaterThan(2500);
    expect(slope.knee.interval.high as number).toBeLessThan(2600);
    // 0.08 + 1e-5 x + 5e-5 (x - 2500) is 1.5 times 0.081, its value at 100, at x = 2775.
    expect(must(lawKnee(law, "rate", { kind: "rise", share: 0.5 })).knee.value).toBeCloseTo(2775, 6);
  });

  it("finds the knee of the rule floor after the least value of a law that falls, then grows", () => {
    // 1 + 100 / x + x has its least value, 21, at x = 10. A cold start is high, so the rule "rise" finds no knee.
    const rate: Variable = { id: "rate", unit: "{request}/s", min: 1, max: 100, scale: "linear" };
    const program = app("add", app("add", ref("base"), app("divide", ref("cold"), ref("rate"))), app("multiply", ref("slope"), ref("rate")));
    const law = programLaw(program, { base: 1, cold: 100, slope: 1 }, [rate]);
    expect(checkLaw(law)).toEqual([]);
    expect(kneeOf(law, { kind: "rise", share: 1 }).knee).toEqual(NO_CROSSING);
    const found = kneeOf(law, { kind: "floor", share: 1 });
    const floor = found.floor as { load: number; value: number };
    // The floor is the least value on the grid of 64 steps, thus near the least value of the curve.
    expect(Math.abs(floor.load - 10)).toBeLessThan(99 / 64);
    expect(floor.value).toBeCloseTo(1 + 100 / floor.load + floor.load, 9);
    expect(floor.value).toBeGreaterThanOrEqual(21);
    expect(floor.value).toBeLessThan(21.01);
    // After the floor, 1 + 100 / x + x = 2 floor where x^2 - (2 floor - 1) x + 100 = 0.
    const b = 2 * floor.value - 1;
    expect(found.knee.value).toBeCloseTo((b + Math.sqrt(b * b - 400)) / 2, 6);
    expect(found).toMatchObject({ rule: { kind: "floor", share: 1 }, edge: NO_CROSSING });
  });

  it("gives each replicate its own floor, thus no knee of a replicate is at the start of the search", () => {
    // The floor of each row is its base at 0. A row is two times its floor where base + x = 2 base, at x = base.
    const spread = lawOf("linear", { base: 1, slope: 1 }, {}, { base: 0.5 });
    const found = kneeOf(spread, { kind: "floor", share: 1 });
    expect(found.floor).toEqual({ load: 0, value: 1 });
    expect(found.noFloor).toBe(0);
    expect(found.knee.value).toBeCloseTo(1, 9);
    // With the floor of the estimate as one amount, a replicate with a base above 2 has its knee at 0.
    const bases = spread.replicates.map((row) => row[0] as number);
    expect(found.knee.interval.low as number).toBeGreaterThan(0);
    expect(found.knee.interval.low).toBeCloseTo(Math.min(1, quantile(bases, 0.025)), 6);
    expect(found.knee.interval.high).toBeCloseTo(Math.max(1, quantile(bases, 0.975)), 6);
  });

  it("counts a replicate with no floor above 0 and leaves it out of the interval", () => {
    // Of 80 replicates, one has the base -1: its floor is below 0. The level 0.95 can leave out 2.
    const base = lawOf("linear", { base: 1, slope: 1 }, {}, { base: 0.5 });
    const rows = Array.from({ length: 80 }, (_, row) => [1 + 0.5 * wave(row, 0), 1]);
    rows[7] = [-1, 1];
    const found = kneeOf({ ...base, replicates: rows }, { kind: "floor", share: 1 });
    expect(found.noFloor).toBe(1);
    const kept = rows.filter((row) => (row[0] as number) > 0).map((row) => row[0] as number);
    expect(found.knee.interval.low).toBeCloseTo(Math.min(1, quantile(kept, 0.025)), 6);
    expect(found.knee.interval.high).toBeCloseTo(Math.max(1, quantile(kept, 0.975)), 6);
  });

  it("takes the floor before the edge of a law", () => {
    // Past its capacity, 100, the queue has values below 0. They are not the floor.
    const found = kneeOf(lawOf("queue", QUEUE, QUEUE_RANGE), { kind: "floor", share: 1 }, { to: 150 });
    expect(found.floor).toEqual({ load: 1, value: 0.5 + 100 / 99 });
    expect(found.knee.value).toBeCloseTo(queueRise(1), 6);
    expect(found.edge.value).toBeCloseTo(100, 9);
  });

  it("holds the other variables at the point at", () => {
    const law = sampleLaw();
    const sized: Law = {
      ...law,
      variables: [...law.variables, { id: "size", unit: "B", min: 0, max: 65_536, scale: "linear" }],
      form: { id: "hinge-size", program: app("add", hinge, app("multiply", ref("c4"), ref("size"))) },
      constants: [...law.constants, { id: "c4", value: 1e-6 }],
      replicates: law.replicates.map((row) => [...row, 1e-6]),
    };
    expect(checkLaw(sized)).toEqual([]);
    const found = must(lawKnee(sized, "rate", { kind: "slope", factor: 2 }, { at: { size: 1024 } }));
    expect(found.knee.value).toBeCloseTo(2500, 3);
    expect(found.outside).toEqual([]);
    expect(must(lawKnee(sized, "rate", { kind: "slope", factor: 2 }, { at: { size: 1e6 } })).outside).toEqual(["size"]);
    expect(problemOf(lawKnee(sized, "rate", { kind: "slope", factor: 2 }))).toMatchObject({ code: "point", path: "at.size" });
  });
});

describe("the problems of lawKnee", () => {
  const law = lawOf("hinge", HINGE);
  const slope: KneeRule = { kind: "slope", factor: 2 };

  it("names the variable or the point that the law cannot read", () => {
    expect(problemOf(lawKnee(law, "speed", slope))).toMatchObject({ code: "point", path: "variable" });
    expect(problemOf(lawKnee(law, "rate", slope, { at: { rate: 5 } }))).toMatchObject({ code: "point", path: "at.rate" });
    expect(problemOf(lawKnee(law, "rate", slope, { at: { speed: 5 } }))).toMatchObject({ code: "point", path: "at.speed" });
  });

  it("names a bad search range, rule, count of steps or level", () => {
    expect(problemOf(lawKnee(law, "rate", slope, { from: 50, to: 50 }))).toMatchObject({ code: "range", path: "from" });
    expect(problemOf(lawKnee(law, "rate", slope, { to: Number.NaN }))).toMatchObject({ code: "range", path: "from" });
    expect(problemOf(lawKnee(sampleLaw(), "rate", slope, { from: 0 }))).toMatchObject({ code: "range", path: "from" });
    for (const steps of [1, 2.5, 5000]) {
      expect(problemOf(lawKnee(law, "rate", slope, { steps }))).toMatchObject({ code: "knee", path: "steps" });
    }
    expect(problemOf(lawKnee(law, "rate", { kind: "rise", share: 0 }))).toMatchObject({ code: "knee", path: "rule.share" });
    expect(problemOf(lawKnee(law, "rate", { kind: "rise", share: Number.NaN }))).toMatchObject({ code: "knee", path: "rule.share" });
    expect(problemOf(lawKnee(law, "rate", { kind: "slope", factor: 1 }))).toMatchObject({ code: "knee", path: "rule.factor" });
    expect(problemOf(lawKnee(law, "rate", { kind: "floor", share: -1 }))).toMatchObject({ code: "knee", path: "rule.share" });
    expect(problemOf(lawKnee(law, "rate", slope, { level: 0.99 }))).toMatchObject({ code: "level", path: "replicates" });
  });

  it("names a rule from data with a bad shape", () => {
    expect(kneeRuleProblem({ kind: "floor", share: 1 })).toBeUndefined();
    expect(kneeRuleProblem({ kind: "slope", factor: 2 }, "knee")).toBeUndefined();
    expect(kneeRuleProblem([], "knee")).toMatchObject({ code: "knee", path: "knee" });
    expect(kneeRuleProblem(null)).toMatchObject({ code: "knee", path: "rule" });
    expect(kneeRuleProblem({ kind: "peak" }, "knee")).toMatchObject({ code: "knee", path: "knee.kind" });
    expect(kneeRuleProblem({ kind: "rise", share: "1" }, "knee")).toMatchObject({ code: "knee", path: "knee.share" });
    expect(kneeRuleProblem({ kind: "slope" })).toMatchObject({ code: "knee", path: "rule.factor" });
  });

  it("names a floor at 0 or below, or a law with no value at the start of the floor search", () => {
    const negative = lawOf("linear", { base: -1, slope: 1 });
    expect(problemOf(lawKnee(negative, "rate", { kind: "floor", share: 1 }))).toMatchObject({ code: "knee", path: "constants" });
    // Of 40 replicates, many have a base of 0 or less. The level 0.95 needs all 40, thus it can leave out none.
    const spread = lawOf("linear", { base: 0.5, slope: 1 }, {}, { base: 3 });
    const count = spread.replicates.filter((row) => (row[0] as number) <= 0).length;
    expect(count).toBeGreaterThan(0);
    expect(problemOf(lawKnee(spread, "rate", { kind: "floor", share: 1 }))).toEqual({
      code: "knee",
      path: "replicates",
      message: `The rule "floor" needs a floor above 0. ${count} of 40 replicates have a floor of 0 or less. The interval of the level 0.95 can leave out at most 0.`,
    });
    expect(problemOf(lawKnee(lawOf("logarithm", { base: 1, scale: 1 }), "rate", { kind: "floor", share: 1 }))).toMatchObject({ code: "value", path: "constants" });
  });

  it("names the row with no value or no cheap region at the start of the search", () => {
    // ln(0) is not a finite number.
    expect(problemOf(lawKnee(lawOf("logarithm", { base: 1, scale: 1 }), "rate", slope))).toMatchObject({ code: "value", path: "constants" });
    const falling = lawOf("linear", { base: 10, slope: -1 });
    expect(problemOf(lawKnee(falling, "rate", slope))).toMatchObject({ code: "knee", path: "constants" });
    const negative = lawOf("linear", { base: -1, slope: 1 });
    expect(problemOf(lawKnee(negative, "rate", { kind: "rise", share: 1 }))).toMatchObject({ code: "knee", path: "constants" });
    // Some replicates of the base are below 0: the first of them has the problem.
    const spread = lawOf("linear", { base: 0.5, slope: 1 }, {}, { base: 3 });
    const first = spread.replicates.findIndex((row) => (row[0] as number) <= 0);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(problemOf(lawKnee(spread, "rate", { kind: "rise", share: 1 }))).toMatchObject({ code: "knee", path: `replicates[${first}]` });
  });
});

/** The start memory of a service: a base, a cost for each day of its log, and a cost for each live report. */
const startMemory: Expr = app("add", ref("base"), app("add", app("multiply", ref("perDay"), ref("days")), app("multiply", ref("perReport"), ref("reports"))));
const MEMORY = { base: 200e6, perDay: 40e6, perReport: 50e3 };

/** This function gives a law of the start memory in bytes. The cost of each day of each replicate is in 10 % of the estimate. */
const memoryLaw = (): Law => ({
  ...programLaw(startMemory, MEMORY, [
    { id: "days", unit: "d", min: 0, max: 30, scale: "linear" },
    { id: "reports", unit: "{report}", min: 0, max: 20_000, scale: "linear" },
  ]),
  measure: { id: "memory", unit: "B" },
  replicates: Array.from({ length: 40 }, (_, row) => [MEMORY.base, MEMORY.perDay * (1 + 0.1 * wave(row, 1)), MEMORY.perReport]),
});

/** The amount of a limit of 1 GiB with a headroom of 10 %, in bytes. */
const AMOUNT = 0.9 * 2 ** 30;

const reachOf = (law: Law, variable: string, amount: Quantity, options: KneeOptions = {}): Reach => must(lawReach(law, variable, amount, options));

const reachProblem = (result: Result<Reach, LawProblem>): LawProblem => {
  if (result.tag === "ok") throw new Error("The search gave a reach, not a problem.");
  return result.error;
};

describe("lawReach", () => {
  it("gives the largest age of the log that holds an amount, as the algebra of the law gives it", () => {
    const law = memoryLaw();
    expect(checkLaw(law)).toEqual([]);
    const found = reachOf(law, "days", quantity(AMOUNT, "B"), { at: { reports: 2000 } });
    const free = AMOUNT - MEMORY.base - MEMORY.perReport * 2000;
    expect(found.crossing.value).toBeCloseTo(free / MEMORY.perDay, 6);
    expect(found).toMatchObject({ variable: "days", unit: "d", amount: AMOUNT, level: 0.95, search: { low: 0, high: 30 }, outside: [] });
    expect(found.edge).toEqual(NO_CROSSING);
    // The interval comes from the cost of each day of the replicates: a larger cost gives a smaller age.
    const ages = law.replicates.map((row) => free / (row[1] as number));
    const { low, high } = found.crossing.interval;
    expect(low as number).toBeLessThan(found.crossing.value as number);
    expect(high as number).toBeGreaterThan(found.crossing.value as number);
    expect(low as number).toBeCloseTo(Math.min(found.crossing.value as number, quantile(ages, 0.025)), 4);
    expect(high as number).toBeCloseTo(Math.max(found.crossing.value as number, quantile(ages, 0.975)), 4);
  });

  it("converts the amount to the unit of the measure of the law", () => {
    const law = memoryLaw();
    const inBytes = reachOf(law, "days", quantity(AMOUNT, "B"), { at: { reports: 2000 } });
    const inMebibytes = reachOf(law, "days", quantity(AMOUNT / 2 ** 20, "MiB"), { at: { reports: 2000 } });
    expect(inMebibytes.amount).toBeCloseTo(AMOUNT, 3);
    expect(inMebibytes.crossing.value).toBeCloseTo(inBytes.crossing.value as number, 9);
  });

  it("goes along each variable of the law", () => {
    const found = reachOf(memoryLaw(), "reports", quantity(AMOUNT, "B"), { at: { days: 10 } });
    expect(found.crossing.value).toBeCloseTo((AMOUNT - MEMORY.base - MEMORY.perDay * 10) / MEMORY.perReport, 4);
    expect(found.unit).toBe("{report}");
  });

  it("gives the start when the law is above the amount at the start, and no crossing when the law holds it on all of the search", () => {
    const law = memoryLaw();
    expect(reachOf(law, "days", quantity(100e6, "B"), { at: { reports: 0 } }).crossing.value).toBe(0);
    expect(reachOf(law, "days", quantity(10 * 2 ** 30, "B"), { at: { reports: 0 } }).crossing).toEqual(NO_CROSSING);
  });

  it("marks a crossing outside the range of the variable, and each other variable outside its range", () => {
    const found = reachOf(memoryLaw(), "days", quantity(4 * 2 ** 30, "B"), { at: { reports: 30_000 }, to: 200 });
    expect(found.crossing.outside).toBe(true);
    expect(found.crossing.value as number).toBeGreaterThan(30);
    expect(found.outside).toEqual(["reports"]);
  });

  it("gives the knee of the rule rise at an amount of 1 + share times the start value", () => {
    const law = lawOf("queue", QUEUE, QUEUE_RANGE);
    const start = 0.5 + 100 / 99;
    for (const share of [0.1, 1, 3]) {
      const found = reachOf(law, "rate", quantity(start * (1 + share), law.measure.unit));
      expect(found.crossing.value).toBeCloseTo(kneeOf(law, { kind: "rise", share }).knee.value as number, 9);
    }
  });

  it("finds the crossing before a pole, for an amount of any size", () => {
    const rate: Variable = { id: "rate", unit: "{request}/s", min: 0, max: 99, scale: "linear" };
    const law = programLaw(lostValue, { base: 10, capacity: 100 }, [rate]);
    // The law is 10 - ln(100 - rate). It is 20 where 100 - rate is e^-10.
    const found = reachOf(law, "rate", quantity(20, law.measure.unit), { to: 150 });
    expect(found.crossing.value).toBeCloseTo(100 - Math.exp(-10), 9);
    expect(found.crossing.value as number).toBeLessThan(found.edge.value as number);
    expect(found.edge.value).toBeCloseTo(100, 9);
  });

  it("gives a problem for an amount in another kind of unit, for an amount that is not finite, and for the problems of a search", () => {
    const law = memoryLaw();
    const at = { reports: 2000 };
    expect(reachProblem(lawReach(law, "days", quantity(1, "s"), { at }))).toMatchObject({ code: "unit", path: "amount" });
    expect(reachProblem(lawReach(law, "days", { value: Number.NaN, unit: "B" } as Quantity, { at }))).toMatchObject({ code: "value", path: "amount" });
    expect(reachProblem(lawReach(law, "hours", quantity(AMOUNT, "B"), { at }))).toMatchObject({ code: "point", path: "variable" });
    expect(reachProblem(lawReach(law, "days", quantity(AMOUNT, "B")))).toMatchObject({ code: "point", path: "at.reports" });
    expect(reachProblem(lawReach(law, "days", quantity(AMOUNT, "B"), { at, from: 5, to: 5 }))).toMatchObject({ code: "range", path: "from" });
    expect(reachProblem(lawReach(law, "days", quantity(AMOUNT, "B"), { at, level: 0.999 }))).toMatchObject({ code: "level" });
  });
});
