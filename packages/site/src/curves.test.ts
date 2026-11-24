import { readFileSync } from "node:fs";
import type { Law } from "@mark1russell7/capacity";
import { describe, expect, it } from "vitest";
import { kneeRuleOf } from "./coverage.ts";
import { amountText, axisUnit, curveOf, kneeSentence, linearTicks, logTicks, ruleText, runsOf, runsSentence, stepsOf, unitWords, type Curve } from "./curves.ts";
import { LAWS, PLANS } from "./data.ts";

const lawFile = (path: string): Law => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as Law;
const entry = (subject: string, measure: string) => {
  const found = LAWS.find((each) => each.subject === subject && each.measure === measure);
  if (found === undefined) throw new Error(`No law of ${subject} ${measure}.`);
  return found;
};
const curve = (subject: string, measure: string): Curve => {
  const found = entry(subject, measure);
  const result = curveOf(lawFile(found.path), kneeRuleOf(found, PLANS));
  if (typeof result === "string") throw new Error(result);
  return result;
};

describe("the steps of a variable", () => {
  it("gives equal ratios on the scale log and equal distances on the scale linear", () => {
    expect(stepsOf(1, 100, "log", 3).map((each) => Math.round(each))).toEqual([1, 10, 100]);
    expect(stepsOf(0, 10, "linear", 3)).toEqual([0, 5, 10]);
    expect(stepsOf(0, 100, "log", 3)).toEqual([0, 50, 100]);
    expect(stepsOf(5, 5, "linear")).toEqual([5]);
  });
});

describe("the curve of each law file of the repository", () => {
  it("gives each law with one variable a curve, with each value in its interval, in the range of the variable", () => {
    for (const each of LAWS) {
      const law = lawFile(each.path);
      const result = curveOf(law, kneeRuleOf(each, PLANS));
      if (typeof result === "string") throw new Error(`${each.id}: ${result}`);
      expect(result.points.length).toBeGreaterThan(1);
      for (const point of result.points) {
        expect(point.low).toBeLessThanOrEqual(point.value);
        expect(point.value).toBeLessThanOrEqual(point.high);
      }
      expect(result.points[0]!.x).toBeCloseTo(law.variables[0]!.min);
      expect(result.points.at(-1)!.x).toBeCloseTo(law.variables[0]!.max);
    }
  }, 60_000);

  it("gives the latency of bare Node the knee rule floor of the plan rate, and a knee in the range", () => {
    const found = entry("node-http", "latency.p99");
    expect(kneeRuleOf(found, PLANS)).toEqual({ kind: "floor", share: 1 });
    const knee = curve("node-http", "latency.p99").knee;
    expect(knee).toBeDefined();
    if (knee?.value != null) {
      expect(knee.value).toBeGreaterThanOrEqual(100);
      expect(knee.value).toBeLessThanOrEqual(36000);
    }
  });

  it("gives no knee rule to a measure with no rule in its plan, and tells why", () => {
    const result = curve("node-http", "cpu.request");
    expect(result.knee).toBeUndefined();
    expect(result.noKnee).toMatch(/no knee rule/);
  });
});

describe("the run points of a curve", () => {
  it("gives each point of the fit with the date of its run, and tells them in one sentence", () => {
    const found = entry("node-http", "cpu.request");
    const law = lawFile(found.path);
    const run = law.evidence.runs.length - 1;
    const points = [
      { load: { rate: 100 }, value: 0.02, run: 0, job: "2026-11-20T06:00:00.000Z" },
      { load: { rate: 1000 }, value: 0.03, run, job: "2026-11-20T07:00:00.000Z" },
      { load: { size: 5 }, value: 0.04, run: 0, job: "2026-11-20T07:00:00.000Z" },
    ];
    const result = curveOf({ ...law, points }, undefined);
    if (typeof result === "string") throw new Error(result);
    expect(result.runs).toEqual([
      { x: 100, value: 0.02, run: 0, date: law.evidence.runs[0]!.date },
      { x: 1000, value: 0.03, run, date: law.evidence.runs[run]!.date },
    ]);
    expect(runsSentence(result)).toBe(`The dots are the 2 points of the fit, from ${run === 0 ? "1 run" : "2 runs"}.`);
    expect(runsOf({ ...law, points: [{ ...points[0]!, run: 99 }] }, "rate")).toEqual([{ x: 100, value: 0.02, run: 99, date: undefined }]);
  });

  it("gives a law file with no points a curve with no run points and no sentence of them", () => {
    const { points: _points, ...old } = lawFile(entry("node-http", "cpu.request").path);
    const result = curveOf(old, undefined);
    if (typeof result === "string") throw new Error(result);
    expect(result.runs).toEqual([]);
    expect(runsSentence(result)).toBe("");
  });
});

describe("the words of a knee rule", () => {
  it("tells each kind of rule", () => {
    expect(ruleText({ kind: "floor", share: 1 })).toBe("the value is more than 2 times its floor, the least value of the law");
    expect(ruleText({ kind: "rise", share: 0.5 })).toMatch(/1\.5 times its value at the start/);
    expect(ruleText({ kind: "slope", factor: 3 })).toMatch(/3 times its slope/);
  });
});

describe("the text of an amount and the unit of an axis", () => {
  it("prints bytes and milliseconds on the scales of quantity, and other units with 3 significant digits", () => {
    expect(amountText(31470962, "B")).toBe("30 MiB");
    expect(amountText(-1246500, "B")).toBe("-1.2 MiB");
    expect(amountText(0.238, "ms")).toBe("0.24 ms");
    expect(amountText(6840.16, "{request}/s")).toBe("6840 requests/s");
    expect(amountText(0.01778, "{core}·ms/{request}")).toBe("0.0178 cores·ms/request");
  });

  it("gives an axis of bytes the largest binary unit that its top fills, and keeps other units", () => {
    expect(axisUnit("B", 32_000_000)).toEqual({ unit: "MiB", factor: 1024 ** 2 });
    expect(axisUnit("B", 900)).toEqual({ unit: "B", factor: 1 });
    expect(axisUnit("ms", 16)).toEqual({ unit: "ms", factor: 1 });
    expect(axisUnit("ms", 2500)).toEqual({ unit: "s", factor: 1000 });
    expect(axisUnit("{request}/s", 5)).toEqual({ unit: "{request}/s", factor: 1 });
    expect(unitWords("{request}/s")).toBe("requests/s");
  });
});

describe("the ticks of an axis", () => {
  it("gives round linear ticks inside the range", () => {
    expect(linearTicks(0, 31, 4)).toEqual([0, 10, 20, 30]);
    expect(linearTicks(-0.2, 11.4, 4)).toEqual([0, 5, 10]);
    expect(linearTicks(0, 0.27, 4)).toEqual([0, 0.1, 0.2]);
    expect(linearTicks(3, 3)).toEqual([3]);
  });

  it("gives each power of 10 on a long log axis, and 1, 2 and 5 on a short one", () => {
    expect(logTicks(100, 36000)).toEqual([100, 200, 500, 1000, 2000, 5000, 10000, 20000]);
    expect(logTicks(100, 1_000_000)).toEqual([100, 1000, 10000, 100000, 1000000]);
    expect(logTicks(0, 10)).toEqual([0]);
  });
});

describe("the sentence of a knee", () => {
  it("tells the knee of the latency of bare Node with its interval and its rule, and the reason for no knee", () => {
    expect(kneeSentence(curve("node-http", "latency.p99"))).toMatch(/^The knee is at [\d.]+ requests\/s \(95 % interval [\d.]+ requests\/s to [\d.]+ requests\/s\)\. There the value is more than 2 times its floor/);
    expect(kneeSentence(curve("node-http", "cpu.request"))).toBe("The lab gives no knee rule for this measure.");
  });
});
