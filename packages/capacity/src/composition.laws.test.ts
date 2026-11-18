import type { Result } from "@mark1russell7/optional";
import type { Quantity } from "@mark1russell7/quantity";
import { uniformDouble } from "@mark1russell7/rigor-testkit/arbitrary";
import { checkRelations, composeRelations, equivariant, invariant, withinTolerance } from "@mark1russell7/rigor-testkit/metamorphic";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { catalogLaws, cpuComposition } from "./composition.fixture.ts";
import { compositionValue, type Composition, type CompositionTerm, type CompositionValue } from "./composition.ts";
import { mergeDemands, scaleDemand } from "./demand.ts";
import type { Range } from "./value.ts";
import { NO_DEMAND, type Demand } from "./workload.ts";

// The laws of the composition, as metamorphic relations on generated terms and demands.
//
// A sum of laws is linear in its weights. Thus a factor scales the value, the interval, the run and
// the replicates, and a factor less than 0 turns each range. The order of the terms does not change
// the sum. A nested composition gives the value of its terms in line. A composition of constant
// costs is linear in the demand: a scale of the demand scales the value, and a sum of two demands
// sums the values and the replicates.

const RATE_UNITS = ["{request}/s", "{request}/min", "{request}/h"] as const;
const CLASSES = ["read", "write", "admin/report"] as const;

const rates: fc.Arbitrary<Quantity> = fc.record({ value: uniformDouble({ min: 0, max: 4000 }), unit: fc.constantFrom(...RATE_UNITS) });

/** An arbitrary of demands: each class is there or not, with a rate in one of three units. Each demand has the level `connections` or not. */
const demands: fc.Arbitrary<Demand> = fc
  .tuple(fc.tuple(...CLASSES.map(() => fc.option(rates))), fc.option(uniformDouble({ min: 0, max: 1000 })))
  .map(([classRates, connections]) => ({
    classes: CLASSES.flatMap((id, index) => {
      const rate = classRates[index];
      return rate === null || rate === undefined ? [] : [{ id, rate, request: {} }];
    }),
    levels: connections === null ? {} : { connections: { value: connections, unit: "{connection}" } },
  }));

/** An arbitrary of factors other than 0, of the two signs. */
const factors: fc.Arbitrary<number> = fc
  .tuple(uniformDouble({ min: 0.01, max: 16 }), fc.boolean())
  .map(([size, negative]) => (negative ? -size : size));

const LAWS = catalogLaws();

/** The terms of the tests: the hinge law at the rate of each class and at the total rate, over the instance, and the constant cost of the runner. */
const TERMS: readonly CompositionTerm[] = [
  { law: "node-http/reply/cpu", over: "each" },
  { law: "node-http/reply/cpu", over: "each", load: "total" },
  { law: "runner/reply/cpu", over: ["read"] },
  { law: "node-http/reply/cpu", over: "instance" },
];

/** A case of the laws: the terms of the root, the nested compositions that the terms name, and the demand. */
interface Case {
  readonly terms: readonly CompositionTerm[];
  readonly compositions: readonly Composition[];
  readonly demand: Demand;
}

/** An arbitrary of terms: a subset of `TERMS` in an order, each with a factor. */
const termLists: fc.Arbitrary<CompositionTerm[]> = fc
  .uniqueArray(fc.integer({ min: 0, max: TERMS.length - 1 }), { minLength: 1, maxLength: TERMS.length })
  .chain((picks) => fc.tuple(fc.constant(picks), fc.array(factors, { minLength: picks.length, maxLength: picks.length })))
  .map(([picks, scale]) => picks.map((pick, index) => ({ ...(TERMS[pick] as CompositionTerm), factor: scale[index] as number })));

/** A demand without the class `read` gives no rate to the term over `["read"]`. Thus each demand of a case has the class `read`. */
const withRead = (demand: Demand): Demand =>
  demand.classes.some((entry) => entry.id === "read")
    ? demand
    : { ...demand, classes: [{ id: "read", rate: { value: 500, unit: "{request}/s" }, request: {} }, ...demand.classes] };

const cases: fc.Arbitrary<Case> = fc.record({ terms: termLists, compositions: fc.constant([]), demand: demands.map(withRead) });

/** The shape of a composition value: the numbers that the laws compare. */
interface Shape {
  readonly value: number;
  readonly interval: Range;
  readonly run: Range;
  readonly replicates: readonly number[];
}

const must = <T>(result: Result<T, { code: string; path: string; message: string }>): T => {
  if (result.tag === "err") throw new Error(`${result.error.code} at ${result.error.path}: ${result.error.message}`);
  return result.value;
};

const shapeOf = (found: CompositionValue): Shape => ({ value: found.value, interval: found.interval, run: found.run, replicates: found.replicates });

const valueOf = ({ terms, compositions, demand }: Case): CompositionValue =>
  must(compositionValue(cpuComposition("mix/cpu", terms), { laws: LAWS, compositions }, demand));

const times = (range: Range, by: number): Range => (by >= 0 ? { low: by * range.low, high: by * range.high } : { low: by * range.high, high: by * range.low });

const scaled = (shape: Shape, by: number): Shape => ({
  value: by * shape.value,
  interval: times(shape.interval, by),
  run: times(shape.run, by),
  replicates: shape.replicates.map((draw) => by * draw),
});

/** This function gives a term with its factor times `by`. */
const timesFactor = (term: CompositionTerm, by: number): CompositionTerm => ({ ...term, factor: by * (term.factor ?? 1) });

// A sum of a large part and a small part loses the last bits of a float, thus the comparison has a tolerance.
const near = withinTolerance({ relative: 1e-9, absolute: 1e-9 });

const factor = equivariant<Case, Shape, number>("a factor of each term", {
  param: factors,
  change: (input, by) => ({ ...input, terms: input.terms.map((term) => timesFactor(term, by)) }),
  map: scaled,
  equal: near,
});

const nest = equivariant<Case, Shape, number>("the terms in a nested composition, with a factor", {
  param: factors,
  change: (input, by) => {
    const id = `inner-${input.compositions.length}/cpu`;
    return { ...input, terms: [{ composition: id, factor: by }], compositions: [...input.compositions, cpuComposition(id, input.terms)] };
  },
  map: scaled,
  equal: near,
});

describe("the laws of a composition", () => {
  it("holds the laws of a factor, of the order of the terms and of a nested composition", () => {
    checkRelations<Case, Shape>(
      (input) => shapeOf(valueOf(input)),
      [
        factor,
        // A factor a, then a factor b, is a factor a times b.
        composeRelations(factor, factor, { equal: near }),
        invariant<Case, Shape, readonly number[]>("the order of the terms", {
          param: (input) => fc.shuffledSubarray([...input.terms.keys()], { minLength: input.terms.length, maxLength: input.terms.length }),
          change: (input, order) => ({ ...input, terms: order.map((index) => input.terms[index] as CompositionTerm) }),
          equal: near,
        }),
        nest,
        // A nested composition in a nested composition gives the terms in line, with the product of the factors.
        composeRelations(nest, nest, { equal: near }),
        composeRelations(nest, factor, { equal: near }),
      ],
      cases,
    );
  });

  it("gives the sum of its parts, and holds the value in its interval", () => {
    fc.assert(
      fc.property(cases, (input) => {
        const found = valueOf(input);
        const sum = found.parts.reduce((total, part) => total + part.value, 0);
        const size = found.parts.reduce((total, part) => total + Math.abs(part.value), 0);
        expect(Math.abs(found.value - sum)).toBeLessThanOrEqual(1e-12 * Math.max(1, size));
        expect(found.interval.low).toBeLessThanOrEqual(found.value);
        expect(found.interval.high).toBeGreaterThanOrEqual(found.value);
      }),
    );
  });
});

describe("the laws of a composition of constant costs", () => {
  const costs = (demand: Demand): Shape =>
    shapeOf(valueOf({ terms: [{ law: "runner/reply/cpu", over: "each" }], compositions: [], demand }));

  /** The interval of a sum is not the sum of the intervals. A sum of two demands keeps the sum of the values and of the replicates. */
  const sumNear = (a: Shape, b: Shape): boolean => near({ value: a.value, replicates: a.replicates }, { value: b.value, replicates: b.replicates });

  it("scales with the demand, and adds over a sum of two demands", () => {
    checkRelations<Demand, Shape>(
      costs,
      [
        equivariant<Demand, Shape, number>("a scale of the demand", {
          param: uniformDouble({ min: 0, max: 16 }),
          change: (demand, by) => must(scaleDemand(demand, by)),
          map: scaled,
          equal: near,
        }),
        equivariant<Demand, Shape, Demand>("the sum with a second demand", {
          param: demands,
          change: (demand, second) => must(mergeDemands(demand, second)),
          map: (shape, second) => {
            const more = costs(second);
            return { ...shape, value: shape.value + more.value, replicates: shape.replicates.map((draw, row) => draw + (more.replicates[row] as number)) };
          },
          equal: sumNear,
        }),
        invariant<Demand, Shape, null>("the sum with no demand", {
          param: fc.constant(null),
          change: (demand) => must(mergeDemands(demand, NO_DEMAND)),
          equal: near,
        }),
      ],
      demands,
    );
  });
});
