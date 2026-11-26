import { readFileSync } from "node:fs";
import type { Composition, Law } from "@mark1russell7/capacity";
import { describe, expect, it } from "vitest";
import { COMPOSITIONS, LAWS } from "./data.ts";
import { bandText, lawIdsOf, rateRangeOf, stackBaseOf, stackOf, stackSentence } from "./stack.ts";

const lawFile = (path: string): Law => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as Law;
const ALL_LAWS: readonly Law[] = LAWS.map((each) => lawFile(each.path));
const CATALOG = { laws: ALL_LAWS, compositions: COMPOSITIONS };
const byId = (id: string): Composition => COMPOSITIONS.find((each) => each.id === id)!;
const LAYERED = COMPOSITIONS.filter((each) => stackBaseOf(each, COMPOSITIONS) !== undefined);
const lawWith = (id: string, variable: Law["variables"][number] | undefined): Law => ({ ...ALL_LAWS[0]!, id, variables: variable === undefined ? [] : [variable] });
const rate = (min: number, max: number, scale: "log" | "linear" = "log"): Law["variables"][number] => ({ id: "rate", unit: "{request}/s", min, max, scale });

describe("the layers of a composition", () => {
  it("gives layer 2 of the runner its base layer 1, and gives layer 1 no base", () => {
    expect(LAYERED.map((each) => each.subject)).toEqual(LAYERED.map(() => "node-http-service"));
    expect(LAYERED.length).toBeGreaterThan(0);
    for (const layer2 of LAYERED) {
      const base = stackBaseOf(layer2, COMPOSITIONS)!;
      expect(base.subject).toBe("node-http");
      expect(stackBaseOf(base, COMPOSITIONS)).toBeUndefined();
    }
  });

  it("gives the laws of a composition and of its nested compositions, each one time", () => {
    const ids = lawIdsOf(byId("node-http-service/xeon-6975p-c/cpu"), COMPOSITIONS);
    expect([...ids].sort()).toEqual(["node-http-service/overhead/xeon-6975p-c/cpu.request.overhead", "node-http/rate/xeon-6975p-c/cpu.request"]);
  });

  it("gives the laws that move with the load, with no term of a base", () => {
    const memory = byId("alerts-runtime/xeon-6975p-c/memory");
    const all = lawIdsOf(memory, COMPOSITIONS);
    const load = lawIdsOf(memory, COMPOSITIONS, "load");
    // The events give the whole value. The persons, the feeds, the log and the open incidents are terms with a base.
    expect(all.length).toBe(5);
    expect(load).toEqual(["alerts-runtime/alerts-start-event/xeon-6975p-c/main/first/watch-peak"]);
  });

  it("gives the common range of the rate of the laws, or the reason for none", () => {
    expect(rateRangeOf([lawWith("a", rate(100, 36000)), lawWith("b", rate(50, 8000))])).toEqual({ min: 100, max: 8000, scale: "log" });
    expect(rateRangeOf([lawWith("a", rate(100, 200)), lawWith("b", rate(1, 300, "linear"))])).toEqual({ min: 100, max: 200, scale: "linear" });
    expect(rateRangeOf([])).toMatch(/no law/);
    expect(rateRangeOf([lawWith("a", undefined)])).toMatch(/no variable rate/);
    expect(rateRangeOf([lawWith("a", undefined)], "event")).toMatch(/no variable event/);
    expect(rateRangeOf([lawWith("a", rate(1, 10)), lawWith("b", rate(20, 30))])).toMatch(/no common range/);
  });
});

describe("the stack of each composition of the runner", () => {
  it.each(LAYERED.map((each) => each.id))("%s gives its total as bare Node plus the part of the runner, over the common range of its laws", (id) => {
    const stack = stackOf(byId(id), CATALOG);
    if (typeof stack === "string") throw new Error(stack);
    expect(stack.points.length).toBeGreaterThan(1);
    expect(stack.points[0]!.x).toBeCloseTo(stack.range.min);
    expect(stack.points.at(-1)!.x).toBeCloseTo(stack.range.max);
    for (const point of stack.points) {
      // The sum of the central values is exact. The intervals come from the rows of replicates, so they do not add.
      expect(point.total.value).toBeCloseTo(point.base.value + point.added.value, 6);
      for (const band of [point.base, point.added, point.total]) {
        expect(band.low).toBeLessThanOrEqual(band.value);
        expect(band.value).toBeLessThanOrEqual(band.high);
      }
    }
    // The runner adds CPU time and memory at each end of the range: the interval of its part is above 0.
    for (const point of [stack.points[0]!, stack.points.at(-1)!]) expect(point.added.low).toBeGreaterThan(0);
  }, 60_000);

  it("tells why a composition has no stack", () => {
    expect(stackOf(byId("node-http/xeon-6975p-c/cpu"), CATALOG)).toBe("The composition has no base layer.");
    expect(stackOf(LAYERED[0]!, { laws: [], compositions: COMPOSITIONS })).toBe("A law of the composition did not load.");
  });
});

describe("the words of a stack", () => {
  it("gives a band with the unit one time when the ends have the unit of the value, and each unit when they do not", () => {
    expect(bandText({ value: 0.106, low: 0.105, high: 0.108 }, "{core}")).toBe("0.106 cores (0.105 to 0.108)");
    expect(bandText({ value: 1153434, low: 792678, high: 1468006 }, "B")).toBe("1.1 MiB (774.1 KiB to 1.4 MiB)");
  });

  it("tells bare Node and the part of the runner at a rate", () => {
    const stack = stackOf(byId("node-http-service/xeon-6975p-c/cpu"), CATALOG);
    if (typeof stack === "string") throw new Error(stack);
    expect(stackSentence(stack, stack.points[0]!)).toMatch(/^At 100 requests\/s, bare Node uses [\d.]+ cores \([\d.]+ to [\d.]+\)\. The service runner adds [\d.]+ cores \([\d.]+ to [\d.]+\)\.$/);
  }, 60_000);
});
