import { readFileSync } from "node:fs";
import { compositionValue, limitUse, scaleDemand, scaleRule, type Composition, type Law } from "@mark1russell7/capacity";
import { describe, expect, it } from "vitest";
import { COMPOSITIONS, LAWS } from "./data.ts";
import { DEFAULT_SETTING, RATES, SLIDER_OPTIONS, countText, pointSentences, positionOf, rateAt, scaleModelOf, scaleSubjects, sliderOf, stepsOfSlider, type Slider, type SliderPoint } from "./scale.ts";
import { demandAt } from "./stack.ts";

const lawFile = (path: string): Law => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as Law;
const CATALOG = { laws: LAWS.map((each) => lawFile(each.path)), compositions: COMPOSITIONS };

/** These subjects are the subjects of the slider on the CPU model of the laws of the bare server. */
const CPU = LAWS.find((law) => law.subject === "node-http")!.cpu;
const SUBJECTS = scaleSubjects(COMPOSITIONS, LAWS, CPU);

const sliderFor = (compositions: readonly Composition[], setting = DEFAULT_SETTING): Slider => {
  const slider = sliderOf(compositions, setting, CATALOG);
  if (typeof slider === "string") throw new Error(slider);
  return slider;
};

const pointAt = (slider: Slider, rate: number): SliderPoint => {
  const point = slider.at(rate);
  if (typeof point === "string") throw new Error(point);
  return point;
};

describe("the scale model of the slider", () => {
  it("gives a limit with the headroom of the setting on each resource that a composition gives", () => {
    const model = scaleModelOf(SUBJECTS[0]!.compositions, { cores: 4, memory: 1024, headroom: 0.2 }, CATALOG);
    expect(model.limits.map((each) => each.id).sort()).toEqual(["cpu", "memory"]);
    expect(model.limits.every((each) => each.headroom === 0.2)).toBe(true);
    expect(model.instance.resources).toEqual({ cpu: { value: 4, unit: "{core}" }, memory: { value: 1024, unit: "MiB" } });
  });
});

describe("the slider on the real compositions", () => {
  it("has the two subjects of the runner stack", () => {
    expect(SUBJECTS.map((each) => each.subject)).toEqual(["node-http", "node-http-service"]);
  });

  it("gives no subject for the compositions of alerts, because their laws read a level of events and not the rate", () => {
    const alerts = COMPOSITIONS.filter((each) => each.subject === "alerts-runtime");
    expect(alerts.length).toBeGreaterThan(0);
    expect(SUBJECTS.some((each) => each.subject === "alerts-runtime")).toBe(false);
  });

  it("gives no subject on a CPU model with no laws, and the laws of each composition of a subject", () => {
    expect(scaleSubjects(COMPOSITIONS, LAWS, "no-such-cpu")).toEqual([]);
    const runner = SUBJECTS.find((each) => each.subject === "node-http-service")!;
    expect(runner.compositions.map((each) => each.measure.id).sort()).toEqual(["cpu", "memory"]);
    expect(runner.laws).toContain("node-http/rate/xeon-6975p-c/cpu.request");
    expect(new Set(runner.laws).size).toBe(runner.laws.length);
  });

  it.each(SUBJECTS.map((each) => [each.subject, each.compositions] as const))(
    "gives the count, the binding limit and the next step of the scale rule for %s",
    (_, compositions) => {
      const slider = sliderFor(compositions);
      const model = scaleModelOf(compositions, DEFAULT_SETTING, CATALOG);
      for (const rate of [150, 3000, 20_000, 400_000]) {
        const demand = scaleDemand(demandAt(1000), rate / 1000);
        if (demand.tag === "err") throw new Error(demand.error.message);
        const rule = scaleRule(model, demand.value, SLIDER_OPTIONS);
        if (rule.tag === "err") throw new Error(rule.error.message);
        const point = pointAt(slider, rate);
        expect(point.count, `rate ${rate}`).toEqual(rule.value.count);
        expect(point.binding, `rate ${rate}`).toBe(rule.value.binding);
        expect(point.extrapolated, `rate ${rate}`).toBe(rule.value.extrapolated);
        const next = rule.value.next?.factor.value;
        if (next != null) expect(point.next?.value, `rate ${rate}`).toBeCloseTo(next * rate, 6);
      }
    },
    120_000,
  );

  it.each(SUBJECTS.map((each) => [each.subject, each.compositions] as const))(
    "gives the use of each limit below 1 at the count, and the binding limit above 1 with one instance less, for %s",
    (_, compositions) => {
      const slider = sliderFor(compositions);
      const model = scaleModelOf(compositions, DEFAULT_SETTING, CATALOG);
      // This function gives the use of a limit with the load of a rate on each of some instances.
      const useOf = (id: string, rate: number, instances: number): number => {
        const limit = model.limits.find((each) => each.id === id)!;
        const composition = compositions.find((each) => each.measure.id === limit.measure)!;
        const demand = scaleDemand(demandAt(rate), 1 / instances);
        if (demand.tag === "err") throw new Error(demand.error.message);
        const value = compositionValue(composition, CATALOG, demand.value);
        if (value.tag === "err") throw new Error(value.error.message);
        const use = limitUse(limit, model.instance, { value: value.value.value, unit: value.value.unit });
        if (use.tag === "err") throw new Error(use.error.message);
        return use.value.use;
      };
      for (const rate of [500, 9000, 60_000, 700_000]) {
        const point = pointAt(slider, rate);
        const count = point.count.value;
        if (count === null) continue;
        for (const fill of point.fills) {
          expect(fill.use!, `${fill.limit} at ${rate}`).toBeLessThanOrEqual(1);
          expect(fill.use!, `${fill.limit} at ${rate}`).toBeGreaterThan(0);
          expect(fill.use!, `${fill.limit} at ${rate}`).toBeCloseTo(useOf(fill.limit, rate, count), 9);
        }
        if (point.binding !== null) expect(useOf(point.binding, rate, count - 1), `rate ${rate}`).toBeGreaterThan(1);
      }
    },
    120_000,
  );

  it.each(SUBJECTS.map((each) => [each.subject, each.compositions] as const))("gives counts that do not fall as the rate grows for %s", (_, compositions) => {
    const counts = stepsOfSlider(sliderFor(compositions), 60).map((step) => step.count.value ?? Number.POSITIVE_INFINITY);
    expect(counts.length).toBe(60);
    counts.forEach((count, index) => expect(count).toBeGreaterThanOrEqual(counts[index - 1] ?? 1));
  }, 120_000);

  it("needs no more instances of a larger instance", () => {
    const runner = SUBJECTS.find((each) => each.subject === "node-http-service")!.compositions;
    const small = sliderFor(runner);
    const large = sliderFor(runner, { ...DEFAULT_SETTING, cores: 8 });
    for (const rate of [20_000, 200_000]) expect(pointAt(large, rate).count.value!).toBeLessThanOrEqual(pointAt(small, rate).count.value!);
    expect(pointAt(small, 200_000).count.value!).toBeGreaterThan(pointAt(large, 200_000).count.value!);
  }, 120_000);

  it("gives the range of the rate that each law of the runner measured", () => {
    const runner = SUBJECTS.find((each) => each.subject === "node-http-service")!.compositions;
    expect(sliderFor(runner).measured).toMatchObject({ min: 100, max: 8000 });
  }, 120_000);
});

describe("the position of the slider", () => {
  it("gives the rate of each position on a log scale, and the position of each rate", () => {
    expect(rateAt(0)).toBe(RATES.min);
    expect(rateAt(1)).toBeCloseTo(RATES.max, 6);
    expect(rateAt(0.5)).toBeCloseTo(10_000, 6);
    expect(rateAt(-1)).toBe(RATES.min);
    for (const rate of [100, 777, 36_000, 1e6]) expect(rateAt(positionOf(rate))).toBeCloseTo(rate, 6);
  });
});

describe("the text of a slider point", () => {
  const point = (over: Partial<SliderPoint>): SliderPoint => ({
    rate: 20_000,
    count: { value: 2, interval: { low: 2, high: 3 } },
    binding: "cpu",
    next: { value: 31_000, interval: { low: 29_000, high: 33_000 } },
    fills: [],
    extrapolated: true,
    ...over,
  });
  const measured = { min: 100, max: 8000, scale: "log" as const };

  it("tells the count, its interval, the limit that sets it, the next step and the end of the measures", () => {
    const text = pointSentences(point({}), measured, 256).join(" ");
    expect(text).toContain("needs 2 instances");
    expect(text).toContain("The interval is 2 to 3.");
    expect(text).toContain("The CPU limit sets the count.");
    expect(text).toContain("One more instance is necessary past");
    expect(text).toContain("No run measured a rate past");
  });

  it("tells one instance with no limit, and no note inside the measures", () => {
    const text = pointSentences(point({ rate: 500, count: { value: 1, interval: { low: 1, high: 1 } }, binding: null, next: null, extrapolated: false }), measured, 256);
    expect(text).toEqual(["At 500 requests/s, the service needs 1 instance.", "One instance holds each limit."]);
  });

  it("tells a count past the search", () => {
    expect(countText(null, 256)).toBe("more than 256 instances");
    const text = pointSentences(point({ count: { value: null, interval: { low: 200, high: null } }, next: null }), measured, 256).join(" ");
    expect(text).toContain("more than 256 instances");
    expect(text).toContain("The interval is 200 to more than 256.");
  });
});
