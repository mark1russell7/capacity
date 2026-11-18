import type { Result } from "@mark1russell7/optional";
import { valueIn, type Quantity } from "@mark1russell7/quantity";
import { uniformDouble } from "@mark1russell7/rigor-testkit/arbitrary";
import {
  checkRelations,
  composeRelations,
  equivariant,
  invariant,
  permutationInvariant,
  withinTolerance,
} from "@mark1russell7/rigor-testkit/metamorphic";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { loadPointOf, mergeDemands, scaleDemand, shareOf, totalRate } from "./demand.ts";
import type { Law } from "./law.ts";
import { sampleLaw } from "./sample.fixture.ts";
import { NO_DEMAND, type Amounts, type Demand, type WorkloadClass, type WorkloadProblem } from "./workload.ts";

// The laws of the algebra of demands, as properties on generated demands.
//
// Each demand comes from one set of classes, thus a class has one request in each demand and each
// two demands add. The rates and the levels have different units of one kind, thus each law holds
// across units. A comparison is in one unit, with a tolerance for the error of a float.

const RATE_UNIT = "{request}/s";
const RATE_UNITS = [RATE_UNIT, "{request}/min", "{request}/h"] as const;

/** The classes of the generated demands: the id and the request of each. */
const CLASSES: readonly Pick<WorkloadClass, "id" | "request">[] = [
  { id: "read", request: { reply: { value: 2, unit: "KiB" } } },
  { id: "write", request: { body: { value: 4, unit: "KiB" }, reply: { value: 200, unit: "B" } } },
  { id: "admin/report", request: {} },
];

/** The levels of the generated demands: the units that a level can have. The first unit is the unit of a comparison. */
const LEVELS: Readonly<Record<string, readonly [string, ...string[]]>> = {
  connections: ["{connection}"],
  store: ["B", "KiB", "MiB"],
};

const amountIn = (units: readonly string[], max: number): fc.Arbitrary<Quantity> =>
  fc.record({ value: uniformDouble({ min: 0, max }), unit: fc.constantFrom(...units) });

/** An arbitrary of demands: each class and each level is there or not. */
const demands: fc.Arbitrary<Demand> = fc
  .tuple(
    fc.tuple(...CLASSES.map(() => fc.option(amountIn(RATE_UNITS, 1e6)))),
    fc.tuple(...Object.values(LEVELS).map((units) => fc.option(amountIn(units, 1e6)))),
  )
  .map(([rates, levels]) => ({
    classes: CLASSES.flatMap((entry, index) => {
      const rate = rates[index];
      return rate === null || rate === undefined ? [] : [{ ...entry, rate }];
    }),
    levels: Object.fromEntries(
      Object.keys(LEVELS).flatMap((name, index) => {
        const level = levels[index];
        return level === null || level === undefined ? [] : [[name, level] as const];
      }),
    ),
  }));

/** This function gives the value of a result. It throws the problem of a result with none. */
const must = <T>(result: Result<T, WorkloadProblem>): T => {
  if (result.tag === "err") throw new Error(`${result.error.code} at ${result.error.path}: ${result.error.message}`);
  return result.value;
};

/** The shape of a demand is each of its amounts as a number in one unit. It does not have the order of the classes. */
interface Shape {
  readonly rates: Readonly<Record<string, number>>;
  readonly levels: Readonly<Record<string, number>>;
  readonly requests: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

const bytes = (amounts: Amounts): Record<string, number> =>
  Object.fromEntries(Object.entries(amounts).map(([name, amount]) => [name, valueIn(amount, "B")]));

const shapeOf = (demand: Demand): Shape => ({
  rates: Object.fromEntries(demand.classes.map((entry) => [entry.id, valueIn(entry.rate, RATE_UNIT)])),
  levels: Object.fromEntries(
    Object.entries(demand.levels).map(([name, amount]) => [name, valueIn(amount, (LEVELS[name] as readonly [string])[0])]),
  ),
  requests: Object.fromEntries(demand.classes.map((entry) => [entry.id, bytes(entry.request)])),
});

const times = (values: Readonly<Record<string, number>>, by: number): Record<string, number> =>
  Object.fromEntries(Object.entries(values).map(([name, value]) => [name, value * by]));

/** This function gives the shape of a demand that is `by` times as large: the rates and the levels, and not the requests. */
const scaled = (shape: Shape, by: number): Shape => ({ rates: times(shape.rates, by), levels: times(shape.levels, by), requests: shape.requests });

const near = withinTolerance({ relative: 1e-9, absolute: 1e-9 });
const factors = uniformDouble({ min: 0, max: 16 });
const counts = fc.integer({ min: 1, max: 64 });

/** This function gives the sum of some demands, from the first to the last. */
const sumOf = (parts: readonly Demand[]): Demand => parts.reduce((sum, part) => must(mergeDemands(sum, part)), NO_DEMAND);

const scale = equivariant<Demand, Shape, number>("scale by a factor", {
  param: factors,
  change: (demand, by) => must(scaleDemand(demand, by)),
  map: scaled,
  equal: near,
});

describe("the laws of one demand", () => {
  it("holds each law of the scale, the share and the sum with itself", () => {
    checkRelations<Demand, Shape>(
      shapeOf,
      [
        scale,
        // A scale by a, then by b, is a scale by a times b.
        composeRelations(scale, scale, { equal: near }),
        equivariant<Demand, Shape, number>("the share of one of n instances", {
          param: counts,
          change: (demand, instances) => must(shareOf(demand, instances)),
          map: (shape, instances) => scaled(shape, 1 / instances),
          equal: near,
        }),
        invariant<Demand, Shape, boolean>("the sum with no demand", {
          param: fc.boolean(),
          change: (demand, left) => must(left ? mergeDemands(NO_DEMAND, demand) : mergeDemands(demand, NO_DEMAND)),
          equal: near,
        }),
        equivariant<Demand, Shape, null>("the sum with itself", {
          param: fc.constant(null),
          change: (demand) => must(mergeDemands(demand, demand)),
          map: (shape) => scaled(shape, 2),
          equal: near,
        }),
      ],
      demands,
    );
  });

  it("gives one demand for a scale by two factors and for a scale by their product", () => {
    fc.assert(
      fc.property(demands, factors, factors, (demand, a, b) => {
        const steps = shapeOf(must(scaleDemand(must(scaleDemand(demand, a)), b)));
        return near(steps, shapeOf(must(scaleDemand(demand, a * b))));
      }),
    );
  });

  it("gives the whole demand for n times the share of one of n instances", () => {
    fc.assert(
      fc.property(demands, counts, (demand, instances) =>
        near(shapeOf(must(scaleDemand(must(shareOf(demand, instances)), instances))), shapeOf(demand)),
      ),
    );
  });

  it("keeps a whole level in the share, and divides the other amounts", () => {
    fc.assert(
      fc.property(demands, counts, (demand, instances) => {
        const whole = Object.keys(demand.levels).filter((name) => name === "store");
        const share = shapeOf(must(shareOf(demand, instances, { whole })));
        const divided = scaled(shapeOf(demand), 1 / instances);
        const store = shapeOf(demand).levels["store"];
        return near(share, store === undefined ? divided : { ...divided, levels: { ...divided.levels, store } });
      }),
    );
  });

  it("has a total rate that follows the scale", () => {
    const total = (demand: Demand): number => must(totalRate(demand, RATE_UNIT)).value;
    checkRelations<Demand, number>(
      total,
      [
        equivariant<Demand, number, number>("scale by a factor", {
          param: factors,
          change: (demand, by) => must(scaleDemand(demand, by)),
          map: (rate, by) => rate * by,
          equal: near,
        }),
        equivariant<Demand, number, number>("the share of one of n instances", {
          param: counts,
          change: (demand, instances) => must(shareOf(demand, instances)),
          map: (rate, instances) => rate / instances,
          equal: near,
        }),
      ],
      demands,
    );
  });

  it("gives the same total rate in each unit", () => {
    fc.assert(
      fc.property(demands, (demand) =>
        near(valueIn(must(totalRate(demand, "{request}/h")), RATE_UNIT), must(totalRate(demand, RATE_UNIT)).value),
      ),
    );
  });
});

describe("the laws of a sum of demands", () => {
  const parts = fc.array(demands, { maxLength: 5 });
  const sumShape = (list: readonly Demand[]): Shape => shapeOf(sumOf(list));

  it("does not change with the order or the groups of its parts, and follows the scale", () => {
    checkRelations<readonly Demand[], Shape>(
      sumShape,
      [
        // The order of the parts: the sum is commutative.
        permutationInvariant<Demand, Shape>({ name: "the order of the parts", equal: near }),
        // The sum of the last parts first: with the order, the sum is associative.
        invariant<readonly Demand[], Shape, number>("the sum of the last parts first", {
          param: (list) => fc.integer({ min: 0, max: list.length }),
          change: (list, from) => [...list.slice(0, from), sumOf(list.slice(from))],
          equal: near,
        }),
        // The scale of each part: the scale distributes over the sum.
        equivariant<readonly Demand[], Shape, number>("the scale of each part", {
          param: factors,
          change: (list, by) => list.map((part) => must(scaleDemand(part, by))),
          map: scaled,
          equal: near,
        }),
      ],
      parts,
    );
  });

  it("has a total rate that is the sum of the total rates of its parts", () => {
    fc.assert(
      fc.property(parts, (list) => {
        const each = list.reduce((total, part) => total + must(totalRate(part, RATE_UNIT)).value, 0);
        return near(must(totalRate(sumOf(list), RATE_UNIT)).value, each);
      }),
    );
  });

  it("gives its classes and its levels in the order of their names", () => {
    fc.assert(
      fc.property(parts, (list) => {
        const sum = sumOf(list);
        const ids = sum.classes.map((entry) => entry.id);
        const names = Object.keys(sum.levels);
        expect(ids).toEqual([...ids].sort());
        expect(names).toEqual([...names].sort());
      }),
    );
  });
});

describe("the load point of a share", () => {
  /** This function gives a law that reads the rate and each variable of the request of a class. */
  const lawOf = (entry: WorkloadClass): Law => ({
    ...sampleLaw(),
    variables: [
      { id: "rate", unit: RATE_UNIT, min: 0, max: 1e9, scale: "linear" },
      ...Object.keys(entry.request).map((id) => ({ id, unit: "B", min: 0, max: 1e9, scale: "linear" as const })),
    ],
  });

  it("has the rate divided by the count of instances, and the same request", () => {
    fc.assert(
      fc.property(demands, counts, (demand, instances) => {
        const share = must(shareOf(demand, instances));
        for (const entry of demand.classes) {
          const law = lawOf(entry);
          const whole = must(loadPointOf(demand, entry.id, law));
          const one = must(loadPointOf(share, entry.id, law));
          expect(near(one, { ...whole, rate: (whole["rate"] as number) / instances })).toBe(true);
        }
      }),
    );
  });
});

describe("the control of the laws", () => {
  it("finds a scale that changes the size of a request", () => {
    // A wrong scale: it also multiplies each variable of each request.
    const wrong = (demand: Demand, by: number): Demand => ({
      ...must(scaleDemand(demand, by)),
      classes: must(scaleDemand(demand, by)).classes.map((entry) => ({
        ...entry,
        request: Object.fromEntries(Object.entries(entry.request).map(([name, amount]) => [name, { ...amount, value: amount.value * by }])),
      })),
    });
    const relation = equivariant<Demand, Shape, number>("a wrong scale", { param: factors, change: wrong, map: scaled, equal: near });
    expect(() => checkRelations<Demand, Shape>(shapeOf, [relation], demands)).toThrow(/a wrong scale/);
  });

  it("finds a sum that keeps the rate of the first demand", () => {
    // A wrong sum: a class of the two demands keeps the rate of the first.
    const wrong = (list: readonly Demand[]): Shape => {
      const rates: Record<string, number> = {};
      for (const part of list) {
        for (const entry of part.classes) rates[entry.id] ??= valueIn(entry.rate, RATE_UNIT);
      }
      return { ...shapeOf(sumOf(list)), rates };
    };
    const order = permutationInvariant<Demand, Shape>({ name: "the order of the parts", equal: near });
    expect(() => checkRelations<readonly Demand[], Shape>(wrong, [order], fc.array(demands, { maxLength: 5 }))).toThrow(/the order of the parts/);
  });
});
