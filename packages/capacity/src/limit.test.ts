import type { Quantity } from "@mark1russell7/quantity";
import { describe, expect, it } from "vitest";
import { loadPointOf } from "./demand.ts";
import { sampleInstance, sampleLimits } from "./instance.fixture.ts";
import type { Instance, Limit } from "./instance.ts";
import type { Law } from "./law.ts";
import { limitAmount, limitUse, limitUses } from "./limit.ts";
import { sampleLaw } from "./sample.fixture.ts";
import { sampleWorkload } from "./workload.fixture.ts";

const instance = sampleInstance();
const [cpu, memory, sent, latency] = sampleLimits().limits as [Limit, Limit, Limit, Limit];

describe("limitAmount", () => {
  it("gives a resource of the instance, less the headroom, in the unit of the resource", () => {
    expect(limitAmount(cpu, instance)).toEqual({ tag: "ok", value: { value: 1.4, unit: "{core}" } });
    expect(limitAmount(memory, instance)).toEqual({ tag: "ok", value: { value: 3.2, unit: "GiB" } });
    expect(limitAmount(sent, instance)).toEqual({ tag: "ok", value: { value: 0.5, unit: "Gbit/s" } });
  });

  it("gives a fixed amount, less the headroom, on each instance", () => {
    expect(limitAmount(latency, instance)).toEqual({ tag: "ok", value: { value: 180, unit: "ms" } });
    expect(limitAmount(latency, { resources: {} })).toEqual({ tag: "ok", value: { value: 180, unit: "ms" } });
  });

  it("gives the whole ceiling for a headroom of 0", () => {
    expect(limitAmount({ ...cpu, headroom: 0 }, instance)).toEqual({ tag: "ok", value: { value: 2, unit: "{core}" } });
  });

  it("grows with the resource of the instance", () => {
    const large: Instance = { resources: { ...instance.resources, cpu: { value: 8, unit: "{core}" } } };
    expect(limitAmount(cpu, large)).toMatchObject({ tag: "ok", value: { value: 5.6, unit: "{core}" } });
  });

  it("gives a problem for a limit that is not correct", () => {
    expect(limitAmount({ ...cpu, headroom: 1 }, instance)).toMatchObject({ tag: "err", error: { code: "headroom", path: "headroom" } });
    expect(limitAmount({ ...latency, ceiling: { kind: "amount", amount: { value: 0, unit: "ms" } } }, instance)).toMatchObject({
      tag: "err",
      error: { code: "amount", path: "ceiling.amount" },
    });
  });

  it("gives a problem for a resource that the instance does not have", () => {
    const limit: Limit = { id: "disk", measure: "disk", ceiling: { kind: "resource", resource: "disk" }, headroom: 0.1 };
    expect(limitAmount(limit, instance)).toMatchObject({ tag: "err", error: { code: "resource", path: "resources.disk" } });
    expect(limitAmount({ ...limit, ceiling: { kind: "resource", resource: "toString" } }, instance)).toMatchObject({
      tag: "err",
      error: { code: "resource", path: "resources.toString" },
    });
  });

  it.each([
    ["0", { value: 0, unit: "{core}" }],
    ["a value that is not finite", { value: Number.NaN, unit: "{core}" }],
    ["a unit that is not canonical", { value: 2, unit: "cores" }],
  ])("gives a problem for a resource of %s", (_, amount) => {
    const broken: Instance = { resources: { ...instance.resources, cpu: amount } };
    expect(limitAmount(cpu, broken)).toMatchObject({ tag: "err", error: { code: "resource", path: "resources.cpu" } });
  });

  it("gives a problem for a ceiling that the headroom makes 0", () => {
    const tiny: Limit = { ...latency, ceiling: { kind: "amount", amount: { value: Number.MIN_VALUE, unit: "ms" } }, headroom: 0.9 };
    expect(limitAmount(tiny, instance)).toMatchObject({ tag: "err", error: { code: "amount", path: "ceiling" } });
  });
});

describe("limitUse", () => {
  it("gives the share of the amount of the limit that a value takes", () => {
    expect(limitUse(cpu, instance, { value: 0.7, unit: "{core}" })).toEqual({
      tag: "ok",
      value: { limit: "cpu", measure: "cpu", value: { value: 0.7, unit: "{core}" }, amount: { value: 1.4, unit: "{core}" }, use: 0.5, holds: true },
    });
  });

  it("holds a value at the amount of the limit, and not a value above it", () => {
    expect(limitUse(latency, instance, { value: 180, unit: "ms" })).toMatchObject({ tag: "ok", value: { use: 1, holds: true } });
    expect(limitUse(latency, instance, { value: 190, unit: "ms" })).toMatchObject({ tag: "ok", value: { holds: false } });
    // The value is below the ceiling of 200 ms, and it is in the headroom.
    expect(limitUse({ ...latency, headroom: 0 }, instance, { value: 190, unit: "ms" })).toMatchObject({ tag: "ok", value: { holds: true } });
  });

  it("gives a use of 0 for a value of 0", () => {
    expect(limitUse(memory, instance, { value: 0, unit: "B" })).toMatchObject({ tag: "ok", value: { use: 0, holds: true } });
  });

  it("converts the value to the unit of the ceiling", () => {
    expect(limitUse(memory, instance, { value: 1638.4, unit: "MiB" })).toMatchObject({ tag: "ok", value: { use: 0.5 } });
    expect(limitUse(latency, instance, { value: 0.09, unit: "s" })).toMatchObject({ tag: "ok", value: { use: 0.5 } });
    expect(limitUse(sent, instance, { value: 31.25, unit: "MB/s" })).toMatchObject({ tag: "ok", value: { use: 0.5 } });
  });

  it("reads the CPU time of each second as cores", () => {
    // 900 requests in each second, with 0.5 core-milliseconds for each request, keep 0.45 cores busy.
    const busy: Quantity = { value: 900 * 0.5, unit: "{core}·ms/s" };
    const use = limitUse(cpu, instance, busy);
    expect(use).toMatchObject({ tag: "ok", value: { amount: { value: 1.4, unit: "{core}" }, holds: true } });
    expect(use.tag === "ok" ? use.value.use : Number.NaN).toBeCloseTo(0.45 / 1.4, 12);
  });

  it("gives a problem for a value in a unit of a different thing", () => {
    expect(limitUse(cpu, instance, { value: 450, unit: "ms/s" })).toMatchObject({
      tag: "err",
      error: { code: "unit", path: "value", message: expect.stringContaining('"ms/s"') as string },
    });
    expect(limitUse(memory, instance, { value: 2, unit: "{core}" })).toMatchObject({ tag: "err", error: { code: "unit", path: "value" } });
  });

  it.each([
    ["below 0", { value: -1, unit: "{core}" }],
    ["that is not finite", { value: Number.POSITIVE_INFINITY, unit: "{core}" }],
    ["in a unit that is not canonical", { value: 1, unit: "cores" }],
  ])("gives a problem for a value %s", (_, value) => {
    expect(limitUse(cpu, instance, value)).toMatchObject({ tag: "err", error: { code: "amount", path: "value" } });
  });

  it("gives a problem for a use that is not finite", () => {
    const small: Limit = { ...latency, ceiling: { kind: "amount", amount: { value: 1e-300, unit: "ms" } }, headroom: 0 };
    expect(limitUse(small, instance, { value: 1e300, unit: "ms" })).toMatchObject({ tag: "err", error: { code: "amount", path: "value" } });
  });

  it("gives the problem of the limit before the problem of the value", () => {
    expect(limitUse({ ...cpu, headroom: -1 }, instance, { value: -1, unit: "{core}" })).toMatchObject({
      tag: "err",
      error: { code: "headroom", path: "headroom" },
    });
  });
});

describe("the resources of an instance at a load point", () => {
  /** A law that reads the request rate, and the memory and the CPU of the instance. */
  const law: Law = {
    ...sampleLaw(),
    variables: [
      { id: "rate", unit: "{request}/s", min: 1, max: 1e6, scale: "log" },
      { id: "memory", unit: "MiB", min: 64, max: 65536, scale: "log" },
      { id: "cpu", unit: "{core}", min: 0.1, max: 64, scale: "log" },
    ],
  };

  it("gives each resource that a law reads, in the unit of the variable", () => {
    expect(loadPointOf(sampleWorkload(), "read", law, instance.resources)).toEqual({ tag: "ok", value: { rate: 900, memory: 4096, cpu: 2 } });
  });

  it("gives the same point for the resources in different units", () => {
    const resources = { cpu: { value: 2000, unit: "{core}·ms/s" }, memory: { value: 4096, unit: "MiB" } };
    expect(loadPointOf(sampleWorkload(), "read", law, resources)).toEqual({ tag: "ok", value: { rate: 900, memory: 4096, cpu: 2 } });
  });
});

describe("limitUses", () => {
  const limits = sampleLimits().limits;
  const values = {
    cpu: { value: 0.7, unit: "{core}" },
    memory: { value: 2.88, unit: "GiB" },
    "network.tx": { value: 50, unit: "Mbit/s" },
    "latency.p99": { value: 45, unit: "ms" },
  };

  it("gives the use of each limit, from the largest to the smallest", () => {
    const uses = limitUses(limits, instance, values);
    expect(uses.tag === "ok" ? uses.value.map((use) => [use.limit, use.holds]) : uses.error).toEqual([
      ["memory", true],
      ["cpu", true],
      ["latency", true],
      ["sent", true],
    ]);
    const numbers = uses.tag === "ok" ? uses.value.map((use) => use.use) : [];
    [0.9, 0.5, 0.25, 0.1].forEach((use, index) => expect(numbers[index]).toBeCloseTo(use, 12));
  });

  it("puts the limit that binds first", () => {
    const busy = { ...values, cpu: { value: 1.75, unit: "{core}" } };
    expect(limitUses(limits, instance, busy)).toMatchObject({ tag: "ok", value: [{ limit: "cpu", use: 1.25, holds: false }, { limit: "memory" }, {}, {}] });
  });

  it("keeps the order of the limits for equal uses", () => {
    const level = {
      cpu: { value: 0.7, unit: "{core}" },
      memory: { value: 1.6, unit: "GiB" },
      "network.tx": { value: 250, unit: "Mbit/s" },
      "latency.p99": { value: 90, unit: "ms" },
    };
    const order = (list: readonly Limit[]): readonly string[] => {
      const uses = limitUses(list, instance, level);
      return uses.tag === "ok" ? uses.value.map((use) => use.limit) : [];
    };
    expect(order(limits)).toEqual(["cpu", "memory", "sent", "latency"]);
    expect(order([...limits].reverse())).toEqual(["latency", "sent", "memory", "cpu"]);
  });

  it("does not change the list of the limits", () => {
    const before = JSON.stringify(limits);
    limitUses(limits, instance, values);
    expect(JSON.stringify(limits)).toBe(before);
  });

  it("gives no use for no limit, and ignores a value with no limit", () => {
    expect(limitUses([], instance, values)).toEqual({ tag: "ok", value: [] });
    expect(limitUses([cpu], instance, values)).toMatchObject({ tag: "ok", value: [{ limit: "cpu" }] });
  });

  it("gives a problem for a limit with no value, and not a limit that holds", () => {
    const { memory: _, ...rest } = values;
    expect(limitUses(limits, instance, rest)).toMatchObject({
      tag: "err",
      error: { code: "measure", path: "limits[1].measure", message: expect.stringContaining('"memory"') as string },
    });
    expect(limitUses([{ ...cpu, measure: "constructor" }], instance, values)).toMatchObject({ tag: "err", error: { code: "measure" } });
  });

  it("gives a problem for two limits with one id", () => {
    expect(limitUses([cpu, { ...memory, id: "cpu" }], instance, values)).toMatchObject({ tag: "err", error: { code: "id", path: "limits" } });
  });

  it("names the place of a limit, of a value and of a resource in a problem", () => {
    expect(limitUses([cpu, { ...memory, headroom: 1 }], instance, values)).toMatchObject({
      tag: "err",
      error: { code: "headroom", path: "limits[1].headroom" },
    });
    expect(limitUses(limits, instance, { ...values, "network.tx": { value: 50, unit: "MiB" } })).toMatchObject({
      tag: "err",
      error: { code: "unit", path: "values.network.tx" },
    });
    expect(limitUses(limits, { resources: { cpu: { value: 2, unit: "{core}" } } }, values)).toMatchObject({
      tag: "err",
      error: { code: "resource", path: "resources.memory" },
    });
  });
});
