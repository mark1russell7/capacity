import type { Quantity } from "@mark1russell7/quantity";
import { describe, expect, it } from "vitest";
import { checkInstance, checkLimits, instanceProblems, limitProblems } from "./instance-check.ts";
import { sampleInstance, sampleLimits } from "./instance.fixture.ts";
import { RESOURCE_UNITS, type InstanceType, type Limit, type LimitSet } from "./instance.ts";

/** This function gives the sample instance type with one resource more, or with a change of one. */
const withResource = (name: string, amount: unknown): InstanceType => {
  const sample = sampleInstance();
  return { ...sample, resources: { ...sample.resources, [name]: amount as Quantity } };
};

/** This function gives the first limit of the sample, with a change. */
const withLimit = (change: Partial<Limit>): Limit => ({ ...(sampleLimits().limits[0] as Limit), ...change });

const pairs = (problems: readonly { readonly code: string; readonly path: string }[]): readonly (readonly [string, string])[] =>
  problems.map((found) => [found.code, found.path]);

describe("checkInstance", () => {
  it("finds no problem in the sample instance type", () => {
    expect(checkInstance(sampleInstance())).toEqual([]);
  });

  it("names the format, the id and the title", () => {
    const type = { ...sampleInstance(), format: "capacity-instance/2", id: "Small Container", title: " " } as unknown as InstanceType;
    expect(pairs(checkInstance(type))).toEqual([
      ["format", "format"],
      ["id", "id"],
      ["id", "title"],
    ]);
  });

  it("names an instance with no resource", () => {
    expect(checkInstance({ ...sampleInstance(), resources: {} })).toMatchObject([{ code: "resource", path: "resources" }]);
  });

  it("names a resource with a name that a program cannot read", () => {
    expect(checkInstance(withResource("disk-space", { value: 20, unit: "GiB" }))).toMatchObject([{ code: "id", path: "resources.disk-space" }]);
  });

  it.each([
    ["a unit that is not canonical", { value: 4, unit: "gigs" }],
    ["a value that is not finite", { value: Number.POSITIVE_INFINITY, unit: "GiB" }],
    ["no unit", { value: 4 }],
    ["a bare number", 4],
  ])("names a resource with %s", (_, amount) => {
    expect(checkInstance(withResource("memory", amount))).toMatchObject([{ code: "amount", path: "resources.memory" }]);
  });

  it.each([
    ["0", 0],
    ["a value below 0", -2],
  ])("names a resource of %s", (_, value) => {
    expect(checkInstance(withResource("cpu", { value, unit: "{core}" }))).toMatchObject([
      { code: "amount", path: "resources.cpu", message: 'The resource "cpu" is not above 0.' },
    ]);
  });

  it.each([
    ["cpu", { value: 2, unit: "s/s" }],
    ["cpu", { value: 2, unit: "{request}/s" }],
    ["memory", { value: 4, unit: "{core}" }],
    ["network", { value: 1, unit: "GiB" }],
  ])("names the resource %s in a unit of a different thing", (name, amount) => {
    expect(checkInstance(withResource(name, amount))).toMatchObject([{ code: "unit", path: `resources.${name}` }]);
  });

  it("accepts each unit that converts to the unit of the resource", () => {
    const type: InstanceType = {
      ...sampleInstance(),
      resources: {
        cpu: { value: 500, unit: "{core}·ms/s" },
        memory: { value: 512, unit: "MiB" },
        network: { value: 100, unit: "MiB/s" },
      },
    };
    expect(checkInstance(type)).toEqual([]);
  });

  it("accepts a resource with a new name, in the unit that the instance gives", () => {
    expect(checkInstance(withResource("disk", { value: 20, unit: "GiB" }))).toEqual([]);
    expect(checkInstance(withResource("descriptors", { value: 1024, unit: "{file}" }))).toEqual([]);
  });

  it("gives a unit for each resource with one meaning", () => {
    expect(RESOURCE_UNITS).toEqual({ cpu: "{core}", memory: "B", network: "bit/s" });
    expect(Object.keys(sampleInstance().resources)).toEqual(Object.keys(RESOURCE_UNITS));
  });

  it("does not read the name of a resource from the prototype of an object", () => {
    expect(checkInstance(withResource("constructor", { value: 1, unit: "{core}" }))).toEqual([]);
  });
});

describe("instanceProblems", () => {
  it("examines the resources of an instance with no name", () => {
    expect(instanceProblems({ resources: sampleInstance().resources })).toEqual([]);
    expect(instanceProblems({ resources: {} })).toMatchObject([{ code: "resource", path: "resources" }]);
  });

  it("gives each problem, and not only the first", () => {
    const resources = { cpu: { value: 0, unit: "{core}" }, memory: { value: 4, unit: "s" } };
    expect(pairs(instanceProblems({ resources }))).toEqual([
      ["amount", "resources.cpu"],
      ["unit", "resources.memory"],
    ]);
  });
});

describe("limitProblems", () => {
  it("finds no problem in each limit of the sample", () => {
    for (const limit of sampleLimits().limits) expect(limitProblems(limit)).toEqual([]);
  });

  it("names the id and the measure", () => {
    expect(pairs(limitProblems(withLimit({ id: "CPU", measure: "cpu time" })))).toEqual([
      ["id", "id"],
      ["measure", "measure"],
    ]);
  });

  it.each([
    ["below 0", -0.1],
    ["of 1", 1],
    ["above 1", 1.5],
    ["that is not a number", Number.NaN],
  ])("names a headroom %s", (_, headroom) => {
    expect(limitProblems(withLimit({ headroom }))).toMatchObject([{ code: "headroom", path: "headroom" }]);
  });

  it("accepts a headroom of 0, and a headroom near 1", () => {
    expect(limitProblems(withLimit({ headroom: 0 }))).toEqual([]);
    expect(limitProblems(withLimit({ headroom: 0.99 }))).toEqual([]);
  });

  it("names a resource with a name that an instance cannot have", () => {
    expect(limitProblems(withLimit({ ceiling: { kind: "resource", resource: "Disk Space" } }))).toMatchObject([
      { code: "resource", path: "ceiling.resource" },
    ]);
  });

  it.each([
    ["a unit that is not canonical", { value: 200, unit: "millis" }],
    ["a value that is not finite", { value: Number.NaN, unit: "ms" }],
    ["0", { value: 0, unit: "ms" }],
    ["a value below 0", { value: -200, unit: "ms" }],
  ])("names a ceiling of %s", (_, amount) => {
    expect(limitProblems(withLimit({ ceiling: { kind: "amount", amount } }))).toMatchObject([{ code: "amount", path: "ceiling.amount" }]);
  });

  it("puts the path of the limit before the path of each problem", () => {
    expect(pairs(limitProblems(withLimit({ id: "CPU", headroom: 2 }), "limits[3]"))).toEqual([
      ["id", "limits[3].id"],
      ["headroom", "limits[3].headroom"],
    ]);
  });
});

describe("checkLimits", () => {
  it("finds no problem in the sample limit set", () => {
    expect(checkLimits(sampleLimits())).toEqual([]);
  });

  it("accepts a limit set with no limit", () => {
    expect(checkLimits({ ...sampleLimits(), limits: [] })).toEqual([]);
  });

  it("names the format, the id and the title", () => {
    const set = { ...sampleLimits(), format: "capacity-limits/2", id: "Web Default", title: "" } as unknown as LimitSet;
    expect(pairs(checkLimits(set))).toEqual([
      ["format", "format"],
      ["id", "id"],
      ["id", "title"],
    ]);
  });

  it("names each limit with a problem by its place", () => {
    const sample = sampleLimits();
    const limits = sample.limits.map((limit, index) => (index === 2 ? { ...limit, headroom: 1 } : limit));
    expect(checkLimits({ ...sample, limits })).toMatchObject([{ code: "headroom", path: "limits[2].headroom" }]);
  });

  it("names two limits with one id", () => {
    const sample = sampleLimits();
    const limits = [...sample.limits, { ...(sample.limits[0] as Limit), measure: "cpu.user" }];
    expect(checkLimits({ ...sample, limits })).toMatchObject([{ code: "id", path: "limits", message: 'Two limits have the id "cpu".' }]);
  });

  it("accepts two limits on one measure, and two limits on one resource", () => {
    const sample = sampleLimits();
    const limits: Limit[] = [
      ...sample.limits,
      { id: "received", measure: "network.rx", ceiling: { kind: "resource", resource: "network" }, headroom: 0.5 },
      { id: "latency-hard", measure: "latency.p99", ceiling: { kind: "amount", amount: { value: 1, unit: "s" } }, headroom: 0 },
    ];
    expect(checkLimits({ ...sample, limits })).toEqual([]);
  });
});
