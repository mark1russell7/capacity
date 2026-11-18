import type { Result } from "@mark1russell7/optional";
import { convert, scale as times, valueIn, type Quantity } from "@mark1russell7/quantity";
import { uniformDouble } from "@mark1russell7/rigor-testkit/arbitrary";
import { checkRelations, equivariant, invariant, permutationInvariant, withinTolerance } from "@mark1russell7/rigor-testkit/metamorphic";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Instance, Limit, LimitProblem } from "./instance.ts";
import { limitAmount, limitUse, limitUses } from "./limit.ts";

// The laws of the use of a limit, as properties on generated limits, instances and values.
//
// Each kind of limit has units of one kind, thus each law holds across units. A comparison has a
// tolerance for the error of a float.

/** A kind of limit: its measure, the resource of its ceiling (or none for a fixed amount), and the units of its amounts. */
interface Kind {
  readonly measure: string;
  readonly resource: string | undefined;
  readonly units: readonly [string, ...string[]];
}

const KINDS: readonly Kind[] = [
  { measure: "cpu", resource: "cpu", units: ["{core}", "{core}·ms/s"] },
  { measure: "memory", resource: "memory", units: ["B", "MiB", "GiB"] },
  { measure: "network.tx", resource: "network", units: ["bit/s", "Mbit/s", "MiB/s"] },
  { measure: "latency.p99", resource: undefined, units: ["us", "ms", "s"] },
];

/** A case is one limit on one instance, with one value of its measure. */
interface Case {
  readonly kind: Kind;
  readonly limit: Limit;
  readonly instance: Instance;
  readonly value: Quantity;
}

const amountIn = (units: readonly string[], min: number, max: number): fc.Arbitrary<Quantity> =>
  fc.record({ value: uniformDouble({ min, max }), unit: fc.constantFrom(...units) });

const headrooms = uniformDouble({ min: 0, max: 0.95 });

/** This function gives the case of a kind: the ceiling is a resource of the instance, or a fixed amount. */
const caseOf = (kind: Kind, id: string, ceiling: Quantity, headroom: number, value: Quantity): Case => ({
  kind,
  limit: {
    id,
    measure: kind.measure,
    ceiling: kind.resource === undefined ? { kind: "amount", amount: ceiling } : { kind: "resource", resource: kind.resource },
    headroom,
  },
  instance: { resources: kind.resource === undefined ? {} : { [kind.resource]: ceiling } },
  value,
});

const casesOf = (kind: Kind, id: string = kind.measure): fc.Arbitrary<Case> =>
  fc
    .tuple(amountIn(kind.units, 1e-3, 1e6), headrooms, amountIn(kind.units, 0, 1e6))
    .map(([ceiling, headroom, value]) => caseOf(kind, id, ceiling, headroom, value));

const cases: fc.Arbitrary<Case> = fc.constantFrom(...KINDS).chain((kind) => casesOf(kind));

/** This function gives the value of a result. It throws the problem of a result with none. */
const must = <T>(result: Result<T, LimitProblem>): T => {
  if (result.tag === "err") throw new Error(`${result.error.code} at ${result.error.path}: ${result.error.message}`);
  return result.value;
};

/** This function gives the ceiling of a case: the resource of its instance, or its fixed amount. */
const ceilingOf = (given: Case): Quantity =>
  given.limit.ceiling.kind === "amount" ? given.limit.ceiling.amount : (given.instance.resources[given.limit.ceiling.resource] as Quantity);

/** This function gives a case with a different ceiling. */
const withCeiling = (given: Case, ceiling: Quantity): Case => caseOf(given.kind, given.limit.id, ceiling, given.limit.headroom, given.value);

const useOf = (given: Case): number => must(limitUse(given.limit, given.instance, given.value)).use;

const near = withinTolerance({ relative: 1e-9, absolute: 1e-12 });
const factors = uniformDouble({ min: 0.01, max: 100 });
const unitOf = (given: Case): fc.Arbitrary<string> => fc.constantFrom(...given.kind.units);

/** These relations are the laws of the use of one limit. Each one holds for a function that gives the use of a case. */
const valueScale = equivariant<Case, number, number>("the value times a factor", {
  param: factors,
  change: (given, by) => ({ ...given, value: times(given.value, by) }),
  map: (use, by) => use * by,
  equal: near,
});
const valueUnit = invariant<Case, number, string>("the value in a different unit", {
  param: unitOf,
  change: (given, unit) => ({ ...given, value: convert(given.value, unit) }),
  equal: near,
});
const ceilingScale = equivariant<Case, number, number>("the ceiling times a factor", {
  param: factors,
  change: (given, by) => withCeiling(given, times(ceilingOf(given), by)),
  map: (use, by) => use / by,
  equal: near,
});
const ceilingUnit = invariant<Case, number, string>("the ceiling in a different unit", {
  param: unitOf,
  change: (given, unit) => withCeiling(given, convert(ceilingOf(given), unit)),
  equal: near,
});

/** This function tells if the use of a case, times the share that is not headroom, is the value divided by the ceiling. */
const followsHeadroom = (use: (given: Case) => number, given: Case): boolean => {
  const ceiling = ceilingOf(given);
  return near(use(given) * (1 - given.limit.headroom), valueIn(given.value, ceiling.unit) / ceiling.value);
};

describe("the laws of the use of one limit", () => {
  it("follows the value and the ceiling, in each unit", () => {
    checkRelations<Case, number>(useOf, [valueScale, valueUnit, ceilingScale, ceilingUnit], cases);
  });

  it("is the value divided by the ceiling, divided by the share that is not headroom", () => {
    fc.assert(fc.property(cases, (given) => followsHeadroom(useOf, given)));
  });

  it("does not go down when the headroom goes up", () => {
    fc.assert(
      fc.property(cases, headrooms, (given, headroom) => {
        const other = useOf({ ...given, limit: { ...given.limit, headroom } });
        return headroom >= given.limit.headroom ? other >= useOf(given) : other <= useOf(given);
      }),
    );
  });

  it("holds exactly when the use is 1 or less", () => {
    fc.assert(
      fc.property(cases, (given) => {
        const use = must(limitUse(given.limit, given.instance, given.value));
        return use.holds === use.use <= 1 && use.use >= 0;
      }),
    );
  });

  it("has a use of 1 at the amount of the limit, and holds there", () => {
    fc.assert(
      fc.property(cases, (given) => {
        const amount = must(limitAmount(given.limit, given.instance));
        expect(must(limitUse(given.limit, given.instance, amount))).toMatchObject({ use: 1, holds: true, amount });
      }),
    );
  });

  it("does not hold a value above the amount of the limit", () => {
    fc.assert(
      fc.property(cases, uniformDouble({ min: 1.001, max: 100 }), (given, by) => {
        const amount = must(limitAmount(given.limit, given.instance));
        return !must(limitUse(given.limit, given.instance, times(amount, by))).holds;
      }),
    );
  });
});

describe("the laws of the uses of some limits", () => {
  /** One case for each kind in a random order, thus the limits have different ids. */
  const lists: fc.Arbitrary<readonly Case[]> = fc
    .shuffledSubarray([...KINDS])
    .chain((kinds): fc.Arbitrary<readonly Case[]> => (kinds.length === 0 ? fc.constant([]) : fc.tuple(...kinds.map((kind) => casesOf(kind)))));

  const usesOf = (list: readonly Case[]): readonly { readonly limit: string; readonly use: number }[] => {
    const instance: Instance = { resources: Object.assign({}, ...list.map((given) => given.instance.resources)) as Instance["resources"] };
    const values = Object.fromEntries(list.map((given) => [given.limit.measure, given.value]));
    return must(limitUses(list.map((given) => given.limit), instance, values)).map(({ limit, use }) => ({ limit, use }));
  };

  /** This function gives the use of each limit of a list, by the id of the limit. */
  const byLimit = (list: readonly Case[]): Readonly<Record<string, number>> => Object.fromEntries(usesOf(list).map((use) => [use.limit, use.use]));

  it("gives the use of each limit alone, from the largest to the smallest", () => {
    fc.assert(
      fc.property(lists, (list) => {
        const uses = usesOf(list);
        const alone = Object.fromEntries(list.map((given) => [given.limit.id, useOf(given)]));
        expect(uses.map((use) => use.limit).sort()).toEqual(Object.keys(alone).sort());
        for (const use of uses) expect(use.use).toBe(alone[use.limit]);
        uses.forEach((use, index) => expect(index === 0 || use.use <= (uses[index - 1] as { use: number }).use).toBe(true));
        if (uses.length > 0) expect((uses[0] as { use: number }).use).toBe(Math.max(...Object.values(alone)));
      }),
    );
  });

  it("gives the same use of each limit for each order of the limits", () => {
    checkRelations<readonly Case[], Readonly<Record<string, number>>>(
      byLimit,
      [permutationInvariant<Case, Readonly<Record<string, number>>>({ name: "the order of the limits", equal: near })],
      lists,
    );
  });

  it("gives the limits in one order for each order of the list, when no two uses are equal", () => {
    fc.assert(
      fc.property(lists, (list) => {
        const uses = usesOf(list);
        fc.pre(new Set(uses.map((use) => use.use)).size === uses.length);
        expect(usesOf([...list].reverse()).map((use) => use.limit)).toEqual(uses.map((use) => use.limit));
      }),
    );
  });

  it("divides the use of each resource by the factor of a larger instance, and keeps the use of a fixed amount", () => {
    fc.assert(
      fc.property(lists, factors, (list, by) => {
        const before = byLimit(list);
        const larger = list.map((given) => (given.kind.resource === undefined ? given : withCeiling(given, times(ceilingOf(given), by))));
        for (const [limit, use] of Object.entries(byLimit(larger))) {
          const fixed = list.find((given) => given.limit.id === limit)?.kind.resource === undefined;
          expect(near(use, (before[limit] as number) / (fixed ? 1 : by))).toBe(true);
        }
      }),
    );
  });
});

describe("the control of the laws", () => {
  it("finds a use that does not read the unit of the value", () => {
    // A wrong use: the number of the value, divided by the number of the amount of the limit.
    const wrong = (given: Case): number => given.value.value / must(limitAmount(given.limit, given.instance)).value;
    expect(() => checkRelations<Case, number>(wrong, [valueUnit], cases)).toThrow(/the value in a different unit/);
    expect(() => checkRelations<Case, number>(wrong, [ceilingUnit], cases)).toThrow(/the ceiling in a different unit/);
  });

  it("finds a use that keeps no headroom", () => {
    // A wrong use: the value divided by the whole ceiling.
    const wrong = (given: Case): number => useOf({ ...given, limit: { ...given.limit, headroom: 0 } });
    expect(() => fc.assert(fc.property(cases, (given) => followsHeadroom(wrong, given)))).toThrow(/Property failed/);
  });
});
