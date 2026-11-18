import { describe, expect, it } from "vitest";
import { loadPointOf, mergeDemands, scaleDemand, shareOf, totalRate } from "./demand.ts";
import type { Law, Variable } from "./law.ts";
import { sampleLaw } from "./sample.fixture.ts";
import { lawValue } from "./value.ts";
import { sampleWorkload } from "./workload.fixture.ts";
import { NO_DEMAND, type Demand } from "./workload.ts";

/** This function gives the demand of the sample workload: its classes and its levels. */
const sample = (): Demand => {
  const { classes, levels } = sampleWorkload();
  return { classes, levels };
};

/** This function gives the sample law with other variables. Only `loadPointOf` reads such a law. */
const lawOf = (...variables: readonly (readonly [id: string, unit: string])[]): Law => ({
  ...sampleLaw(),
  variables: variables.map(([id, unit]): Variable => ({ id, unit, min: 0, max: 1e9, scale: "linear" })),
});

/** A demand that is not correct: its class has a rate that is a size. */
const BAD: Demand = { classes: [{ id: "read", rate: { value: 1, unit: "B" }, request: {} }], levels: {} };

describe("scaleDemand", () => {
  it("multiplies each rate and each level, and keeps each request", () => {
    expect(scaleDemand(sample(), 2.5)).toEqual({
      tag: "ok",
      value: {
        classes: [
          { ...sample().classes[0], rate: { value: 2250, unit: "{request}/s" } },
          { ...sample().classes[1], rate: { value: 15000, unit: "{request}/min" } },
        ],
        levels: { connections: { value: 1000, unit: "{connection}" } },
      },
    });
  });

  it("gives a demand of rate 0 for the factor 0", () => {
    expect(scaleDemand(sample(), 0)).toMatchObject({
      tag: "ok",
      value: { classes: [{ rate: { value: 0 } }, { rate: { value: 0 } }], levels: { connections: { value: 0 } } },
    });
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])("refuses the factor %s", (by) => {
    expect(scaleDemand(sample(), by)).toMatchObject({ tag: "err", error: { code: "factor", path: "by" } });
  });

  it("refuses a product that is not finite", () => {
    const large: Demand = { classes: [{ id: "read", rate: { value: 1e308, unit: "{request}/s" }, request: {} }], levels: {} };
    expect(scaleDemand(large, 10)).toMatchObject({ tag: "err", error: { code: "amount", path: "classes[0].rate" } });
    const level: Demand = { classes: [], levels: { connections: { value: 1e308, unit: "{connection}" } } };
    expect(scaleDemand(level, 10)).toMatchObject({ tag: "err", error: { code: "amount", path: "levels.connections" } });
  });

  it("gives the problem of a demand that is not correct", () => {
    expect(scaleDemand(BAD, 2)).toMatchObject({ tag: "err", error: { code: "rate", path: "classes[0].rate" } });
  });
});

describe("shareOf", () => {
  it("divides each rate and each level by the count of instances", () => {
    expect(shareOf(sample(), 4)).toEqual({
      tag: "ok",
      value: {
        classes: [
          { ...sample().classes[0], rate: { value: 225, unit: "{request}/s" } },
          { ...sample().classes[1], rate: { value: 1500, unit: "{request}/min" } },
        ],
        levels: { connections: { value: 100, unit: "{connection}" } },
      },
    });
  });

  it("gives the demand for one instance", () => {
    expect(shareOf(sample(), 1)).toEqual({ tag: "ok", value: sample() });
  });

  it("divides by 3 with no error of a decimal product", () => {
    const six: Demand = { classes: [{ id: "read", rate: { value: 6, unit: "{request}/s" }, request: {} }], levels: {} };
    expect(shareOf(six, 3)).toMatchObject({ tag: "ok", value: { classes: [{ rate: { value: 2 } }] } });
  });

  it("keeps the whole of a level that does not divide", () => {
    expect(shareOf(sample(), 4, { whole: ["connections"] })).toMatchObject({
      tag: "ok",
      value: { classes: [{ rate: { value: 225 } }, { rate: { value: 1500 } }], levels: { connections: { value: 400 } } },
    });
  });

  it("refuses a whole level that the demand does not have", () => {
    expect(shareOf(sample(), 4, { whole: ["incidents"] })).toMatchObject({ tag: "err", error: { code: "variable", path: "whole" } });
    expect(shareOf(sample(), 4, { whole: ["constructor"] })).toMatchObject({ tag: "err", error: { code: "variable", path: "whole" } });
  });

  it.each([0, -2, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("refuses the count %s", (instances) => {
    expect(shareOf(sample(), instances)).toMatchObject({ tag: "err", error: { code: "factor", path: "instances" } });
  });

  it("gives the problem of a demand that is not correct", () => {
    expect(shareOf(BAD, 2)).toMatchObject({ tag: "err", error: { code: "rate", path: "classes[0].rate" } });
  });
});

describe("mergeDemands", () => {
  it("adds the rates of a class of the two demands, and the levels", () => {
    const more: Demand = {
      classes: [{ ...sample().classes[0]!, rate: { value: 6000, unit: "{request}/min" } }],
      levels: { connections: { value: 100, unit: "{connection}" } },
    };
    expect(mergeDemands(sample(), more)).toEqual({
      tag: "ok",
      value: {
        classes: [{ ...sample().classes[0], rate: { value: 1000, unit: "{request}/s" } }, sample().classes[1]],
        levels: { connections: { value: 500, unit: "{connection}" } },
      },
    });
  });

  it("keeps a class and a level of one demand, in the order of the names", () => {
    const other: Demand = {
      classes: [{ id: "admin", rate: { value: 1, unit: "{request}/s" }, request: {} }],
      levels: { clients: { value: 7, unit: "{connection}" } },
    };
    const merged = mergeDemands(sample(), other);
    expect(merged).toMatchObject({ tag: "ok", value: { classes: [{ id: "admin" }, { id: "read" }, { id: "write" }] } });
    expect(merged.tag === "ok" && Object.keys(merged.value.levels)).toEqual(["clients", "connections"]);
  });

  it("has the demand with no class as its zero", () => {
    expect(mergeDemands(sample(), NO_DEMAND)).toEqual({ tag: "ok", value: sample() });
    expect(mergeDemands(NO_DEMAND, sample())).toEqual({ tag: "ok", value: sample() });
    expect(mergeDemands(NO_DEMAND, NO_DEMAND)).toEqual({ tag: "ok", value: NO_DEMAND });
  });

  it("accepts an equal request in a different unit", () => {
    const read = sample().classes[0]!;
    const same: Demand = { classes: [{ ...read, request: { ...read.request, reply: { value: 2048, unit: "B" } } }], levels: {} };
    expect(mergeDemands(sample(), same)).toMatchObject({ tag: "ok", value: { classes: [{ id: "read", rate: { value: 1800 } }, { id: "write" }] } });
  });

  it("refuses a class with a different request in the two demands", () => {
    const read = sample().classes[0]!;
    const larger: Demand = { classes: [{ ...read, request: { ...read.request, reply: { value: 3, unit: "KiB" } } }], levels: {} };
    expect(mergeDemands(sample(), larger)).toMatchObject({ tag: "err", error: { code: "class", path: "second.classes[0].request" } });
    const fewer: Demand = { classes: [{ ...read, request: { body: read.request["body"]! } }], levels: {} };
    expect(mergeDemands(sample(), fewer)).toMatchObject({ tag: "err", error: { code: "class", path: "second.classes[0].request" } });
    const renamed: Demand = { classes: [{ ...read, request: { body: read.request["body"]!, reply: read.request["reply"]!, hold: read.request["wait"]! } }], levels: {} };
    expect(mergeDemands(sample(), renamed)).toMatchObject({ tag: "err", error: { code: "class", path: "second.classes[0].request" } });
  });

  it("refuses rates that count different things", () => {
    const events: Demand = { classes: [{ ...sample().classes[0]!, rate: { value: 5, unit: "{event}/s" } }], levels: {} };
    expect(mergeDemands(sample(), events)).toMatchObject({ tag: "err", error: { code: "unit", path: "second.classes[0].rate" } });
  });

  it("refuses levels in units of different kinds", () => {
    const bytes: Demand = { classes: [], levels: { connections: { value: 5, unit: "MiB" } } };
    expect(mergeDemands(sample(), bytes)).toMatchObject({ tag: "err", error: { code: "unit", path: "second.levels.connections" } });
  });

  it("refuses a sum that is not finite", () => {
    const large: Demand = { classes: [{ id: "read", rate: { value: 1.5e308, unit: "{request}/s" }, request: {} }], levels: {} };
    expect(mergeDemands(large, large)).toMatchObject({ tag: "err", error: { code: "amount", path: "second.classes[0].rate" } });
  });

  it("refuses a level of one demand with the name of a variable of the other demand", () => {
    const level: Demand = { classes: [], levels: { body: { value: 1, unit: "B" } } };
    expect(mergeDemands(sample(), level)).toMatchObject({ tag: "err", error: { code: "id", path: "levels.body" } });
  });

  it("names the demand that is not correct", () => {
    expect(mergeDemands(BAD, sample())).toMatchObject({ tag: "err", error: { code: "rate", path: "first.classes[0].rate" } });
    expect(mergeDemands(sample(), BAD)).toMatchObject({ tag: "err", error: { code: "rate", path: "second.classes[0].rate" } });
  });
});

describe("totalRate", () => {
  it("gives the sum of the rates in the unit", () => {
    expect(totalRate(sample(), "{request}/s")).toEqual({ tag: "ok", value: { value: 1000, unit: "{request}/s" } });
    expect(totalRate(sample(), "{request}/min")).toEqual({ tag: "ok", value: { value: 60000, unit: "{request}/min" } });
  });

  it("gives 0 for a demand with no class", () => {
    expect(totalRate(NO_DEMAND, "{request}/s")).toEqual({ tag: "ok", value: { value: 0, unit: "{request}/s" } });
  });

  it.each(["B", "req/s", "{request}"])("refuses the unit %s", (unit) => {
    expect(totalRate(sample(), unit)).toMatchObject({ tag: "err", error: { code: "unit", path: "unit" } });
  });

  it("refuses a class whose rate counts a different thing", () => {
    expect(totalRate(sample(), "{event}/s")).toMatchObject({ tag: "err", error: { code: "unit", path: "classes[0].rate" } });
  });

  it("gives the problem of a demand that is not correct", () => {
    expect(totalRate(BAD, "{request}/s")).toMatchObject({ tag: "err", error: { code: "rate", path: "classes[0].rate" } });
  });
});

describe("loadPointOf", () => {
  it("gives the rate of the class in the unit of the law", () => {
    expect(loadPointOf(sample(), "read", sampleLaw())).toEqual({ tag: "ok", value: { rate: 900 } });
    expect(loadPointOf(sample(), "write", sampleLaw())).toEqual({ tag: "ok", value: { rate: 100 } });
  });

  it("gives a point that the law can read", () => {
    const law = sampleLaw();
    const point = loadPointOf(sample(), "write", law);
    expect(point.tag === "ok" && lawValue(law, point.value)).toMatchObject({ tag: "ok", value: { unit: law.measure.unit, outside: [] } });
    // One instance of four has a quarter of the rate. That rate is below the range of the law.
    const share = shareOf(sample(), 4);
    const quarter = share.tag === "ok" ? loadPointOf(share.value, "write", law) : share;
    expect(quarter).toEqual({ tag: "ok", value: { rate: 25 } });
    expect(quarter.tag === "ok" && lawValue(law, quarter.value)).toMatchObject({ tag: "ok", value: { outside: ["rate"] } });
  });

  it("reads a variable of the request, a level and an amount of the caller", () => {
    const law = lawOf(["rate", "{request}/min"], ["reply", "B"], ["wait", "s"], ["connections", "{connection}"], ["heap", "MiB"]);
    expect(loadPointOf(sample(), "read", law, { heap: { value: 1, unit: "GiB" } })).toEqual({
      tag: "ok",
      value: { rate: 54000, reply: 2048, wait: 0.005, connections: 400, heap: 1024 },
    });
  });

  it("gives an empty point for a law with no variable", () => {
    expect(loadPointOf(sample(), "read", lawOf())).toEqual({ tag: "ok", value: {} });
  });

  it("refuses a class that the demand does not have", () => {
    expect(loadPointOf(sample(), "delete", sampleLaw())).toMatchObject({ tag: "err", error: { code: "class", path: "classes" } });
  });

  it("refuses a variable with no amount", () => {
    expect(loadPointOf(sample(), "read", lawOf(["rate", "{request}/s"], ["heap", "MiB"]))).toMatchObject({
      tag: "err",
      error: { code: "variable", path: "heap", message: 'The demand gives no amount for the variable "heap" of the law "node-http/reply/cpu".' },
    });
    // A name of each object, for example "constructor", is not an amount of the demand.
    expect(loadPointOf(sample(), "read", lawOf(["constructor", "B"]))).toMatchObject({ tag: "err", error: { code: "variable", path: "constructor" } });
  });

  it("refuses an amount of the caller for a variable that the demand gives", () => {
    const law = lawOf(["rate", "{request}/s"], ["reply", "B"], ["connections", "{connection}"]);
    for (const [name, amount] of [
      ["rate", { value: 5, unit: "{request}/s" }],
      ["reply", { value: 5, unit: "B" }],
      ["connections", { value: 5, unit: "{connection}" }],
    ] as const) {
      expect(loadPointOf(sample(), "read", law, { [name]: amount })).toMatchObject({ tag: "err", error: { code: "variable", path: name } });
    }
  });

  it("ignores an amount of the caller that the law does not read", () => {
    expect(loadPointOf(sample(), "read", sampleLaw(), { heap: { value: 1, unit: "GiB" } })).toEqual({ tag: "ok", value: { rate: 900 } });
  });

  it("refuses an amount of the caller that is not an amount", () => {
    const law = lawOf(["heap", "MiB"]);
    expect(loadPointOf(sample(), "read", law, { heap: { value: 1, unit: "megs" } })).toMatchObject({ tag: "err", error: { code: "amount", path: "heap" } });
  });

  it("refuses an amount that does not convert to the unit of the variable", () => {
    expect(loadPointOf(sample(), "read", lawOf(["rate", "{event}/s"]))).toMatchObject({ tag: "err", error: { code: "unit", path: "rate" } });
    expect(loadPointOf(sample(), "read", lawOf(["wait", "B"]))).toMatchObject({ tag: "err", error: { code: "unit", path: "wait" } });
    expect(loadPointOf(sample(), "read", lawOf(["wait", "millis"]))).toMatchObject({ tag: "err", error: { code: "unit", path: "wait" } });
  });

  it("gives the problem of a demand that is not correct", () => {
    expect(loadPointOf(BAD, "read", sampleLaw())).toMatchObject({ tag: "err", error: { code: "rate", path: "classes[0].rate" } });
  });
});
