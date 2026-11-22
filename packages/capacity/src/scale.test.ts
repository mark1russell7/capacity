import type { Result } from "@mark1russell7/optional";
import { uniformDouble } from "@mark1russell7/rigor-testkit/arbitrary";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { costLaw, cpuComposition, memoryLaw, rowsOf } from "./composition.fixture.ts";
import type { Composition } from "./composition.ts";
import { scaleDemand } from "./demand.ts";
import type { Limit } from "./instance.ts";
import { sampleInstance } from "./instance.fixture.ts";
import { countReach, scaleRule, type ScaleModel, type ScaleProblem } from "./scale.ts";
import type { Demand } from "./workload.ts";

// The model of the tests. The CPU of one request costs 0.5 core·ms, and the memory of an instance
// is 40 MiB + 0.05 MiB for each connection. The instance has 2 cores and 4 GiB. The CPU limit keeps
// half of the cores, and the memory limit keeps 20 % of the memory.
//
// At 9000 requests each second, the service needs 4.5 cores, and 1 core for each instance. Thus the
// share of one instance breaks the CPU limit above 1 / 4.5, and the service needs 5 instances. The
// memory of 200 000 connections breaks its limit above the share (3276.8 - 40) / 10 000, and needs 4.

const ROWS = 40;
const cost = costLaw("web/reply/cpu", 0.5, "{core}·ms/{request}", ROWS);
const memory = { ...memoryLaw(), replicates: rowsOf([40, 0.05], ROWS, 7) };
const cpuOf = cpuComposition("web/cpu", [{ law: cost.id, over: "each" }]);
const memoryOf: Composition = {
  ...cpuComposition("web/memory", [{ law: memory.id, over: "instance" }], "MiB"),
  measure: { id: "memory", unit: "MiB" },
};
const LIMITS: readonly Limit[] = [
  { id: "cpu", measure: "cpu", ceiling: { kind: "resource", resource: "cpu" }, headroom: 0.5 },
  { id: "memory", measure: "memory", ceiling: { kind: "resource", resource: "memory" }, headroom: 0.2 },
];
const MODEL: ScaleModel = { instance: sampleInstance(), limits: LIMITS, compositions: [cpuOf, memoryOf], catalog: { laws: [cost, memory] } };

const demandOf = (rate: number, connections: number): Demand => ({
  classes: [{ id: "read", rate: { value: rate, unit: "{request}/s" }, request: {} }],
  levels: { connections: { value: connections, unit: "{connection}" } },
});
const DEMAND = demandOf(9000, 200_000);
/** The share of one instance where the memory limit breaks, in the estimate. */
const MEMORY_SHARE = (4 * 1024 * 0.8 - 40) / (0.05 * 200_000);

/** This function gives the value of a result. It throws the problem of a result with none. */
const must = <T>(result: Result<T, ScaleProblem>): T => {
  if (result.tag === "err") throw new Error(`${result.error.code} at ${result.error.path}: ${result.error.message}`);
  return result.value;
};

describe("the scale rule", () => {
  it("gives the lowest count of instances that holds each limit, and the limit that binds", () => {
    const rule = must(scaleRule(MODEL, DEMAND));
    expect(rule).toMatchObject({ level: 0.95, most: 2 ** 20, count: { value: 5, interval: { low: 5, high: 5 } }, binding: "cpu" });
    expect(rule.limits.map(({ limit, count, binds, edge }) => ({ limit, count: count.value, binds, edge }))).toEqual([
      { limit: "cpu", count: 5, binds: 1, edge: false },
      { limit: "memory", count: Math.floor(1 / MEMORY_SHARE) + 1, binds: 0, edge: false },
    ]);
  });

  it("tells that a law reads a variable outside its range at the count", () => {
    const rule = must(scaleRule(MODEL, DEMAND));
    expect(rule.extrapolated).toBe(true);
    expect(rule.limits.map(({ limit, extrapolated }) => [limit, extrapolated])).toEqual([
      ["cpu", false],
      ["memory", true],
    ]);
  });

  it("gives the load of the next step: the highest load of the count", () => {
    const next = must(scaleRule(MODEL, DEMAND)).next;
    expect(next).toMatchObject({ count: 5, binding: "cpu" });
    expect(next?.factor.value).toBeCloseTo(5 / 4.5, 9);
    expect(next?.limits.map(({ limit }) => limit)).toEqual(["cpu", "memory"]);
    expect(next?.limits[1]?.factor.value).toBeCloseTo(5 * MEMORY_SHARE, 9);
  });

  it("gives one instance and no binding limit for a small load", () => {
    const rule = must(scaleRule(MODEL, demandOf(1, 100)));
    expect(rule).toMatchObject({ count: { value: 1, interval: { low: 1, high: 1 } }, binding: null });
    expect(rule.next).toMatchObject({ count: 1, binding: "memory" });
    expect(rule.next?.factor.value).toBeCloseTo((4 * 1024 * 0.8 - 40) / 5, 6);
  });

  it("does not divide a level that each instance holds whole", () => {
    const rule = must(scaleRule(MODEL, DEMAND, { whole: ["connections"] }));
    expect(rule).toMatchObject({ count: { value: null, interval: { low: null, high: null } }, binding: "memory", next: null });
    expect(rule.limits.map(({ limit, count }) => [limit, count.value])).toEqual([
      ["memory", null],
      ["cpu", 5],
    ]);
  });

  it("gives a null count past the largest count of the search", () => {
    const rule = must(scaleRule(MODEL, DEMAND, { most: 4 }));
    expect(rule).toMatchObject({ most: 4, count: { value: null }, binding: "cpu", next: null });
  });

  it("gives an interval from the doubt of the laws", () => {
    // At 8008 requests each second, the estimate needs 4.004 cores, thus 5 instances. The replicates of the cost change it by 2 %.
    const rule = must(scaleRule(MODEL, demandOf(8000 * 1.001, 100)));
    expect(rule.count.value).toBe(5);
    expect(rule.count.interval.low).toBeLessThanOrEqual(4);
    expect(rule.count.interval.high).toBe(5);
  });
});

describe("the reach of a count", () => {
  it("gives the first factor of the demand where a limit breaks", () => {
    const reach = must(countReach(MODEL, 4, DEMAND));
    expect(reach).toMatchObject({ count: 4, level: 0.95, search: { low: 2 ** -20, high: 2 ** 20 }, binding: "cpu", extrapolated: true });
    expect(reach.factor.value).toBeCloseTo(4 / 4.5, 9);
    expect(reach.factor.interval.low).toBeLessThan(4 / 4.5);
    expect(reach.factor.interval.high).toBeGreaterThan(4 / 4.5);
    expect(reach.limits.map(({ limit, binds }) => [limit, binds])).toEqual([
      ["cpu", 1],
      ["memory", 0],
    ]);
  });

  it("holds the whole level at each factor of the demand", () => {
    const reach = must(countReach(MODEL, 4, demandOf(9000, 2000), { whole: ["connections"] }));
    // The memory of one instance is 40 + 0.05 * 2000 * f, and the memory limit is 3276.8 MiB.
    expect(reach.limits.find(({ limit }) => limit === "memory")?.factor.value).toBeCloseTo((4 * 1024 * 0.8 - 40) / 100, 6);
  });

  it("agrees with the scale rule: the count holds the load, and one less instance does not", () => {
    fc.assert(
      fc.property(uniformDouble({ min: 0.05, max: 40 }), (factor) => {
        const demand = must(scaleDemand(DEMAND, factor));
        const rule = must(scaleRule(MODEL, demand, { steps: 32 }));
        const count = rule.count.value;
        if (count === null) return;
        // The reach `next` is the reach of the count, with the same options.
        expect(rule.next?.factor.value).toBeGreaterThan(1);
        if (count > 1) expect(must(countReach(MODEL, count - 1, demand, { steps: 32 })).factor.value).toBeLessThanOrEqual(1);
      }),
      { numRuns: 8, seed: 6 },
    );
  }, 120_000);
});

describe("the problems of a scale query", () => {
  const problemOf = (result: Result<unknown, ScaleProblem>): Pick<ScaleProblem, "code" | "path"> => {
    if (result.tag === "ok") throw new Error("The query has no problem.");
    return { code: result.error.code, path: result.error.path };
  };
  const cases: readonly [string, () => Result<unknown, ScaleProblem>, string, string][] = [
    ["a largest count below 2", () => scaleRule(MODEL, DEMAND, { most: 1 }), "factor", "most"],
    ["a largest count that is not whole", () => scaleRule(MODEL, DEMAND, { most: 2.5 }), "factor", "most"],
    ["a demand that is not correct", () => scaleRule(MODEL, demandOf(-1, 100)), "rate", "demand.classes[0].rate"],
    ["a whole level that the demand does not have", () => scaleRule(MODEL, DEMAND, { whole: ["heap"] }), "variable", "whole"],
    ["a model with no limit", () => scaleRule({ ...MODEL, limits: [] }, DEMAND), "measure", "limits"],
    ["two limits with one id", () => scaleRule({ ...MODEL, limits: [LIMITS[0] as Limit, { ...(LIMITS[1] as Limit), id: "cpu" }] }, DEMAND), "id", "limits"],
    ["two compositions of one measure", () => scaleRule({ ...MODEL, compositions: [cpuOf, { ...cpuOf, id: "web/cpu2" }] }, DEMAND), "measure", "compositions[1].measure.id"],
    ["a limit with no composition", () => scaleRule({ ...MODEL, compositions: [cpuOf] }, DEMAND), "measure", "limits[1].measure"],
    ["a limit with a bad headroom", () => scaleRule({ ...MODEL, limits: [{ ...(LIMITS[0] as Limit), headroom: 1.5 }] }, DEMAND), "headroom", "limits[0].headroom"],
    [
      "an instance with no resource for a limit",
      () => scaleRule({ ...MODEL, instance: { resources: { cpu: { value: 2, unit: "{core}" } } } }, DEMAND),
      "resource",
      "instance.resources.memory",
    ],
    [
      "a composition in a unit that does not convert to the ceiling",
      () => scaleRule({ ...MODEL, limits: [{ ...(LIMITS[1] as Limit), ceiling: { kind: "resource", resource: "cpu" } }] }, DEMAND),
      "unit",
      "compositions[1].measure.unit",
    ],
    ["a law that the catalog does not have", () => scaleRule({ ...MODEL, catalog: { laws: [memory] } }, DEMAND), "law", "compositions[0].terms[0].law"],
    [
      "a law with too few replicates for the level",
      () => scaleRule({ ...MODEL, catalog: { laws: [{ ...cost, replicates: rowsOf([0.5], 10) }, memory] } }, DEMAND),
      "level",
      "catalog.laws.web/reply/cpu.replicates",
    ],
    [
      "a level of the demand that a law needs",
      () => scaleRule(MODEL, { ...DEMAND, levels: {} }),
      "variable",
      "compositions[1].terms[0].instance.connections",
    ],
    ["a count of 0", () => countReach(MODEL, 0, DEMAND), "factor", "count"],
    ["a count that is not whole", () => countReach(MODEL, 1.5, DEMAND), "factor", "count"],
    ["a grid with too few steps", () => countReach(MODEL, 2, DEMAND, { steps: 1 }), "knee", "steps"],
  ];

  it.each(cases)("gives a problem for %s", (_, query, code, path) => {
    expect(problemOf(query())).toEqual({ code, path });
  });
});
