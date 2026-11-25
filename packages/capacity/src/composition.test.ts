import type { Result } from "@mark1russell7/optional";
import { app, ref } from "@mark1russell7/vex";
import { describe, expect, it } from "vitest";
import { catalogLaws, costLaw, cpuComposition, layer1, layer2, memoryLaw, rowsOf } from "./composition.fixture.ts";
import {
  checkComposition,
  compositionValue,
  flatPartsOf,
  preparedOf,
  rowValuesOf,
  type Catalog,
  type Composition,
  type CompositionProblem,
  type CompositionValue,
  type LawPart,
  type NestedPart,
} from "./composition.ts";
import { instancePointOf, loadPointOf } from "./demand.ts";
import type { Law } from "./law.ts";
import { fallingLaw, hingeOf, sampleLaw } from "./sample.fixture.ts";
import { intervalOf, lawValue, rangeOf } from "./value.ts";
import { sampleWorkload } from "./workload.fixture.ts";
import { NO_DEMAND, type Demand } from "./workload.ts";

const CATALOG: Catalog = { laws: catalogLaws(), compositions: [layer1(), layer2()] };
const DEMAND: Demand = sampleWorkload();
const [C0, C1, C2, KNEE] = sampleLaw().constants.map((constant) => constant.value) as [number, number, number, number];

/** This function gives the value of a result. It throws the problem of a result with none. */
const must = <T>(result: Result<T, CompositionProblem | { code: string; path: string; message: string }>): T => {
  if (result.tag === "err") throw new Error(`${result.error.code} at ${result.error.path}: ${result.error.message}`);
  return result.value;
};

/** This function gives the problem of a result. It throws for a result with a value. */
const problemOf = <T>(result: Result<T, CompositionProblem>): CompositionProblem => {
  if (result.tag === "ok") throw new Error("The result has a value.");
  return result.error;
};

const value = (composition: Composition, demand: Demand = DEMAND, catalog: Catalog = CATALOG, level?: number): CompositionValue =>
  must(compositionValue(composition, catalog, demand, level === undefined ? {} : { level }));

describe("checkComposition", () => {
  it("finds no problem in a correct composition", () => {
    expect(checkComposition(layer1())).toEqual([]);
    expect(checkComposition(layer2())).toEqual([]);
  });

  const broken: readonly [string, Partial<Composition> | Record<string, unknown>, string, string][] = [
    ["the format", { format: "capacity-composition/2" }, "format", "format"],
    ["the id", { id: "Node HTTP" }, "id", "id"],
    ["the subject", { subject: "" }, "id", "subject"],
    ["the id of the measure", { measure: { id: "CPU", unit: "{core}" } }, "id", "measure.id"],
    ["the title", { title: " " }, "id", "title"],
    ["a unit that is not canonical", { measure: { id: "cpu", unit: "cores" } }, "unit", "measure.unit"],
    ["a level", { measure: { id: "noise", unit: "dB" } }, "unit", "measure.unit"],
    ["an absolute temperature", { measure: { id: "heat", unit: "degC" } }, "unit", "measure.unit"],
    ["no term", { terms: [] }, "term", "terms"],
    ["a factor of 0", { terms: [{ law: "a", over: "each", factor: 0 }] }, "factor", "terms[0].factor"],
    ["a factor that is not finite", { terms: [{ law: "a", over: "each", factor: Number.NaN }] }, "factor", "terms[0].factor"],
    ["the id of a law", { terms: [{ law: "A b", over: "each" }] }, "id", "terms[0].law"],
    ["an empty list of classes", { terms: [{ law: "a", over: [] }] }, "class", "terms[0].over"],
    ["a class id", { terms: [{ law: "a", over: ["Read"] }] }, "id", "terms[0].over[0]"],
    ["a class two times", { terms: [{ law: "a", over: ["read", "read"] }] }, "class", "terms[0].over"],
    ["a scope that is not known", { terms: [{ law: "a", over: "all" }] }, "term", "terms[0].over"],
    ["a class load over the instance", { terms: [{ law: "a", over: "instance", load: "class" }] }, "term", "terms[0].load"],
    ["the id of a composition", { terms: [{ composition: "B c" }] }, "id", "terms[0].composition"],
    ["a composition that names itself", { terms: [{ composition: "node-http/cpu" }] }, "composition", "terms[0].composition"],
  ];

  it.each(broken)("finds %s", (_, change, code, path) => {
    const problems = checkComposition({ ...layer1(), ...change } as Composition);
    expect(problems).toContainEqual(expect.objectContaining({ code, path }));
  });
});

describe("compositionValue", () => {
  it("gives the value of one law at one class, as lawValue does", () => {
    const law = sampleLaw();
    const one = value(cpuComposition("node-http/read", [{ law: law.id, over: ["read"] }], law.measure.unit));
    const alone = must(lawValue(law, must(loadPointOf(DEMAND, "read", law))));
    expect(one.value).toBe(alone.value);
    expect(one.interval).toEqual(alone.interval);
    expect(one.run.low).toBeCloseTo(alone.run.low, 12);
    expect(one.run.high).toBeCloseTo(alone.run.high, 12);
    expect(one.parts).toEqual([expect.objectContaining({ kind: "law", law: law.id, class: "read", weight: 1, value: alone.value })]);
  });

  it("multiplies the cost of one request by the rate of its class", () => {
    // read: 900 requests a second. write: 6000 a minute, thus 100 a second. Each class reads its own rate.
    const cpu = value(layer1());
    expect(cpu.unit).toBe("{core}");
    expect(cpu.value).toBeCloseTo(0.9 * hingeOf(C0, C1, C2, KNEE, 900) + 0.1 * hingeOf(C0, C1, C2, KNEE, 100), 12);
    expect(cpu.parts.map((part) => [(part as LawPart).class, part.weight])).toEqual([
      ["read", expect.closeTo(0.9, 12)],
      ["write", expect.closeTo(0.1, 12)],
    ]);
    expect(cpu.interval.low).toBeLessThanOrEqual(cpu.value);
    expect(cpu.interval.high).toBeGreaterThanOrEqual(cpu.value);
  });

  it("reads the total rate with the load total, and over the instance", () => {
    const total = 0.9 * hingeOf(C0, C1, C2, KNEE, 1000) + 0.1 * hingeOf(C0, C1, C2, KNEE, 1000);
    const each = value(cpuComposition("node-http/cpu", [{ law: "node-http/reply/cpu", over: "each", load: "total" }]));
    const instance = value(cpuComposition("node-http/cpu", [{ law: "node-http/reply/cpu", over: "instance" }]));
    expect(each.value).toBeCloseTo(total, 12);
    expect(instance.value).toBeCloseTo(total, 12);
    expect(instance.parts).toEqual([expect.objectContaining({ class: null, weight: expect.closeTo(1, 12) })]);
    for (const [row, draw] of each.replicates.entries()) expect(instance.replicates[row]).toBeCloseTo(draw, 12);
  });

  it("gives a law of the instance with no rate, and converts its unit", () => {
    const memory = value({ ...cpuComposition("node-http/memory", [{ law: "node-http/memory", over: "instance" }], "GiB") });
    // 40 MiB + 0.05 MiB for each of 400 connections is 60 MiB.
    expect(memory.value).toBeCloseTo(60 / 1024, 12);
    expect(memory.parts[0]?.weight).toBeCloseTo(1 / 1024, 15);
    expect(must(instancePointOf(DEMAND, memoryLaw()))).toEqual({ connections: 400 });
  });

  it("adds the terms, and adds their replicates row by row", () => {
    const flat = value(
      cpuComposition("runner/cpu", [
        { law: "node-http/reply/cpu", over: "each" },
        { law: "runner/reply/cpu", over: "each" },
      ]),
    );
    const node = value(layer1());
    const runner = value(cpuComposition("runner/only", [{ law: "runner/reply/cpu", over: "each" }]));
    expect(flat.value).toBeCloseTo(node.value + runner.value, 12);
    expect(flat.value).toBeCloseTo(
      flat.parts.reduce((sum, part) => sum + part.value, 0),
      12,
    );
    for (const [row, draw] of flat.replicates.entries()) {
      expect(draw).toBeCloseTo((node.replicates[row] as number) + (runner.replicates[row] as number), 12);
    }
  });

  it("scales a term by its factor, and turns its range for a factor less than 0", () => {
    const once = value(layer1());
    const thrice = value(cpuComposition("node-http/cpu", [{ law: "node-http/reply/cpu", over: "each", factor: 3 }]));
    const less = value(cpuComposition("node-http/cpu", [{ law: "node-http/reply/cpu", over: "each", factor: -1 }]));
    expect(thrice.value).toBeCloseTo(3 * once.value, 12);
    expect(thrice.interval.low).toBeCloseTo(3 * once.interval.low, 12);
    expect(thrice.interval.high).toBeCloseTo(3 * once.interval.high, 12);
    expect(less.value).toBeCloseTo(-once.value, 12);
    expect(less.interval.low).toBeCloseTo(-once.interval.high, 12);
    expect(less.interval.high).toBeCloseTo(-once.interval.low, 12);
    expect(less.run.low).toBeCloseTo(-once.run.high, 12);
    expect(less.run.high).toBeCloseTo(-once.run.low, 12);
  });

  it("gives a nested composition the value of its terms in line", () => {
    const nested = value(layer2());
    const inline = value(
      cpuComposition("runner/cpu", [
        { law: "node-http/reply/cpu", over: "each" },
        { law: "runner/reply/cpu", over: "each" },
      ]),
    );
    expect(nested.value).toBeCloseTo(inline.value, 12);
    expect(nested.interval.low).toBeCloseTo(inline.interval.low, 12);
    expect(nested.interval.high).toBeCloseTo(inline.interval.high, 12);
    expect(nested.run.low).toBeCloseTo(inline.run.low, 12);
    expect(nested.run.high).toBeCloseTo(inline.run.high, 12);
    const [first] = nested.parts as [NestedPart];
    expect(first).toEqual(expect.objectContaining({ kind: "composition", composition: "node-http/cpu", weight: 1 }));
    expect(first.parts.map((part) => (part as LawPart).class)).toEqual(["read", "write"]);
  });

  it("converts the unit of a nested composition", () => {
    const milli = cpuComposition("node-http/millicores", [{ composition: "node-http/cpu" }], "{core}·ms/s");
    expect(value(milli).value).toBeCloseTo(1000 * value(layer1()).value, 9);
  });

  it("pairs the rows over the least count of the laws", () => {
    const short = costLaw("runner/reply/cpu", 0.02, "{core}·ms/{request}", 50);
    const laws = [sampleLaw(), short];
    const two = value(
      cpuComposition("runner/cpu", [
        { law: "node-http/reply/cpu", over: "each" },
        { law: "runner/reply/cpu", over: "each" },
      ]),
      DEMAND,
      { laws },
    );
    expect(two.replicates).toHaveLength(50);
  });

  it("gives 0, with no doubt, for a demand with no class", () => {
    const none = value(layer1(), NO_DEMAND);
    expect(none.value).toBe(0);
    expect(none.interval).toEqual({ low: 0, high: 0 });
    expect(none.run).toEqual({ low: 0, high: 0 });
    expect(none.parts).toEqual([]);
    expect(none.replicates).toEqual(new Array(200).fill(0));
  });

  it("tells when a part reads a variable outside its range", () => {
    const busy: Demand = { ...DEMAND, classes: [{ id: "read", rate: { value: 5000, unit: "{request}/s" }, request: {} }] };
    const far = value(layer1(), busy);
    expect(far.extrapolated).toBe(true);
    expect(far.parts).toEqual([expect.objectContaining({ outside: ["rate"] })]);
    expect(value(layer1()).extrapolated).toBe(false);
    expect(value(layer2(), busy).extrapolated).toBe(true);
  });

  it("widens the run by the band of the residuals of each part", () => {
    // Two constant laws with absolute residuals: each run is its interval plus the band of its residuals, times its weight.
    const a = costLaw("a/cost", 0.5);
    const b = costLaw("b/cost", 0.25);
    const sum = value(
      cpuComposition("a/sum", [
        { law: "a/cost", over: ["read"] },
        { law: "b/cost", over: ["read"], factor: -2 },
      ]),
      DEMAND,
      { laws: [a, b] },
    );
    const bandA = rangeOf(a.fit.residuals, 0.95);
    const bandB = rangeOf(b.fit.residuals, 0.95);
    // The rate of read is 0.9 requests a millisecond. The factor -2 turns the band of b.
    expect(sum.run.low).toBeCloseTo(sum.interval.low + 0.9 * bandA.low - 1.8 * bandB.high, 12);
    expect(sum.run.high).toBeCloseTo(sum.interval.high + 0.9 * bandA.high - 1.8 * bandB.low, 12);
  });

  it("gives the interval at the level of the query", () => {
    const wide = value(layer1(), DEMAND, CATALOG, 0.9);
    const narrow = value(layer1(), DEMAND, CATALOG, 0.5);
    expect(wide.level).toBe(0.9);
    expect(wide.interval.high - wide.interval.low).toBeGreaterThan(narrow.interval.high - narrow.interval.low);
  });
});

describe("the problems of compositionValue", () => {
  const cases: readonly [string, () => Result<CompositionValue, CompositionProblem>, string, string][] = [
    ["a composition that is not correct", () => compositionValue({ ...layer1(), terms: [] }, CATALOG, DEMAND), "term", "terms"],
    ["a demand that is not correct", () => compositionValue(layer1(), CATALOG, { classes: [], levels: { rate: { value: 1, unit: "count" } } }), "id", "demand.levels.rate"],
    ["two laws with one id", () => compositionValue(layer1(), { laws: [sampleLaw(), sampleLaw()] }, DEMAND), "law", "laws[1].id"],
    [
      "two compositions with one id",
      () => compositionValue(layer2(), { laws: catalogLaws(), compositions: [layer1(), layer1()] }, DEMAND),
      "composition",
      "compositions[1].id",
    ],
    ["a missing law", () => compositionValue(layer1(), { laws: [] }, DEMAND), "law", "terms[0].law"],
    ["a missing composition", () => compositionValue(layer2(), { laws: catalogLaws() }, DEMAND), "composition", "terms[0].composition"],
    [
      "a cycle of compositions",
      () =>
        compositionValue(
          cpuComposition("a/cpu", [{ composition: "b/cpu" }]),
          { laws: [], compositions: [cpuComposition("b/cpu", [{ composition: "a/cpu" }])] },
          DEMAND,
        ),
      "composition",
      "compositions.b/cpu.terms[0].composition",
    ],
    [
      "a nested composition that is not correct",
      () => compositionValue(layer2(), { laws: catalogLaws(), compositions: [{ ...layer1(), title: "" }] }, DEMAND),
      "id",
      "compositions.node-http/cpu.title",
    ],
    [
      "a law with too few replicates for the level",
      () => compositionValue(layer1(), { laws: [{ ...sampleLaw(), replicates: rowsOf([1, 1, 1, 1], 10) }] }, DEMAND),
      "level",
      "laws.node-http/reply/cpu.replicates",
    ],
    [
      "a law whose unit does not give the unit of the composition",
      () => compositionValue(cpuComposition("node-http/memory", [{ law: "node-http/reply/cpu", over: "each" }], "MiB"), CATALOG, DEMAND),
      "unit",
      "terms[0].law",
    ],
    [
      "a law of a level",
      () => compositionValue(layer1(), { laws: [{ ...sampleLaw(), measure: { id: "noise", unit: "dB" } }] }, DEMAND),
      "unit",
      "terms[0].law",
    ],
    [
      "a rate that counts a different thing",
      () =>
        compositionValue(layer1(), CATALOG, {
          ...DEMAND,
          classes: [{ id: "tick", rate: { value: 10, unit: "{event}/s" }, request: {} }],
        }),
      "unit",
      "terms[0].tick.rate",
    ],
    [
      "a class that the demand does not have",
      () => compositionValue(cpuComposition("node-http/cpu", [{ law: "node-http/reply/cpu", over: ["search"] }]), CATALOG, DEMAND),
      "class",
      "terms[0].search.classes",
    ],
    [
      "a variable that no amount gives",
      () => compositionValue(cpuComposition("node-http/memory", [{ law: "node-http/memory", over: "instance" }], "MiB"), CATALOG, { classes: [], levels: {} }),
      "variable",
      "terms[0].instance.connections",
    ],
    [
      "a nested composition in a unit that does not convert",
      () =>
        compositionValue(
          cpuComposition("runner/memory", [{ composition: "node-http/cpu" }], "MiB"),
          CATALOG,
          DEMAND,
        ),
      "unit",
      "terms[0].composition",
    ],
  ];

  it.each(cases)("gives a problem for %s", (_, query, code, path) => {
    expect(problemOf(query())).toEqual(expect.objectContaining({ code, path }));
  });

  it("gives the total rate of the instance only when each rate counts one thing", () => {
    const mixed: Demand = {
      classes: [
        { id: "read", rate: { value: 10, unit: "{request}/s" }, request: {} },
        { id: "tick", rate: { value: 10, unit: "{event}/s" }, request: {} },
      ],
      levels: {},
    };
    const law: Law = sampleLaw();
    const problem = problemOf(compositionValue(cpuComposition("node-http/cpu", [{ law: law.id, over: "instance" }]), { laws: [law] }, mixed));
    expect(problem).toEqual(expect.objectContaining({ code: "unit", path: "terms[0].instance.rate" }));
  });
});

describe("a composition past the measures", () => {
  const falling = fallingLaw();
  const catalog: Catalog = { laws: [falling], compositions: [] };
  const composition = cpuComposition("falling/cpu", [{ law: falling.id, over: "each" }]);
  const at = (rate: number): Demand => ({ classes: [{ id: "reply", rate: { value: rate, unit: "{request}/s" }, request: {} }], levels: {} });

  it("holds the cost of each request at its value at the edge of the range", () => {
    // At 10000 requests each second, each request costs 0.04 ms, the cost at the edge of 4000. That is 0.4 core.
    const past = value(composition, at(10_000), catalog);
    expect(past.value).toBeCloseTo(0.4, 12);
    expect(past.extrapolated).toBe(true);
  });

  it("gives the same rows on the path of the scale query and in compositionValue", () => {
    const prepared = must(preparedOf(composition, catalog, 0.95));
    for (const rate of [50, 1000, 10_000, 1e6]) {
      const rows = rowValuesOf(must(flatPartsOf(prepared, at(rate))), 0, prepared.rows);
      const found = value(composition, at(rate), catalog);
      const estimate = rows[0] as number;
      const spread = rows.slice(1) as number[];
      expect(estimate, `rate ${rate}`).toBeCloseTo(found.value, 12);
      const interval = intervalOf(estimate, spread, 0.95);
      expect(interval.low, `rate ${rate}`).toBeCloseTo(found.interval.low, 12);
      expect(interval.high, `rate ${rate}`).toBeCloseTo(found.interval.high, 12);
    }
  });
});

describe("a term with a base", () => {
  const memoryOf = (term: Record<string, unknown>): Composition =>
    cpuComposition("node-http/memory", [{ law: "node-http/memory", over: "instance", ...term } as Composition["terms"][number]], "MiB");
  const BASE = { connections: { value: 100, unit: "{connection}" } };
  const ROWS = memoryLaw().replicates;

  it("gives the change of its law from the base point, row by row", () => {
    const change = value(memoryOf({ base: BASE }));
    // 0.05 MiB for each of the 300 connections past the base of 100 is 15 MiB. The constant 40 MiB cancels.
    expect(change.value).toBeCloseTo(15, 12);
    for (const [row, draw] of change.replicates.entries()) expect(draw).toBeCloseTo((ROWS[row]?.[1] as number) * 300, 9);
    const parts = change.parts as readonly LawPart[];
    expect(parts.map((part) => [part.base, part.weight])).toEqual([
      [false, 1],
      [true, -1],
    ]);
  });

  it("gives the value with no base, less the value at the base point", () => {
    const whole = value(memoryOf({}));
    const atBase = value(memoryOf({}), { ...DEMAND, levels: { connections: BASE.connections } });
    expect(value(memoryOf({ base: BASE })).value).toBeCloseTo(whole.value - atBase.value, 12);
  });

  it("gives 0 in each row for a demand with no amount of the variable of the base", () => {
    const none = value(memoryOf({ base: BASE }), NO_DEMAND);
    expect(none.value).toBe(0);
    expect(none.replicates.every((draw) => draw === 0)).toBe(true);
    expect(none.interval).toEqual({ low: 0, high: 0 });
  });

  it("reads the variable from the state of the instance", () => {
    const given = must(compositionValue(memoryOf({ base: BASE }), CATALOG, NO_DEMAND, { given: { connections: { value: 300, unit: "{connection}" } } }));
    expect(given.value).toBeCloseTo(10, 12);
  });

  it("converts the unit of the base to the unit of the variable", () => {
    // A law of the memory over the age of the process in seconds: 40 MiB + 0.05 MiB for each second.
    const aged: Law = {
      ...memoryLaw(),
      id: "node-http/age",
      variables: [{ id: "age", unit: "s", min: 0, max: 1000, scale: "linear" }],
      form: { id: "linear", program: app("add", ref("m0"), app("multiply", ref("m1"), ref("age"))) },
    };
    const composition = cpuComposition("node-http/memory", [{ law: "node-http/age", over: "instance", base: { age: { value: 1, unit: "min" } } }], "MiB");
    const found = must(compositionValue(composition, { laws: [aged] }, NO_DEMAND, { given: { age: { value: 400, unit: "s" } } }));
    // The base of 1 minute is 60 seconds. Thus the change is 0.05 MiB for each of 340 seconds, 17 MiB.
    expect(found.value).toBeCloseTo(17, 12);
  });

  it("scales the change by the factor of the term", () => {
    expect(value(memoryOf({ base: BASE, factor: 2 })).value).toBeCloseTo(30, 12);
  });

  it("gives the same rows on the path of the scale query and in compositionValue", () => {
    const composition = memoryOf({ base: BASE });
    const prepared = must(preparedOf(composition, CATALOG, 0.95));
    const rows = rowValuesOf(must(flatPartsOf(prepared, DEMAND)), 0, prepared.rows);
    const found = value(composition);
    expect(rows[0]).toBeCloseTo(found.value, 12);
    for (const [row, draw] of found.replicates.entries()) expect(rows[row + 1]).toBeCloseTo(draw, 9);
  });

  const broken: readonly [string, Record<string, unknown>, string, string][] = [
    ["an empty base", {}, "term", "terms[0].base"],
    ["a name that is not a name", { Connections: BASE.connections }, "variable", "terms[0].base.Connections"],
    ["the rate", { rate: { value: 1, unit: "{request}/s" } }, "variable", "terms[0].base.rate"],
    ["an amount that is not finite", { connections: { value: Number.NaN, unit: "{connection}" } }, "amount", "terms[0].base.connections"],
  ];

  it.each(broken)("finds %s", (_, base, code, path) => {
    expect(checkComposition(memoryOf({ base }))).toContainEqual(expect.objectContaining({ code, path }));
  });

  it("finds a base that names no variable of the law, or a unit that does not convert", () => {
    expect(problemOf(compositionValue(memoryOf({ base: { persons: { value: 1, unit: "{person}" } } }), CATALOG, DEMAND))).toMatchObject({
      code: "variable",
      path: "terms[0].base.persons",
    });
    expect(problemOf(compositionValue(memoryOf({ base: { connections: { value: 1, unit: "s" } } }), CATALOG, DEMAND))).toMatchObject({
      code: "unit",
      path: "terms[0].base.connections",
    });
  });
});
