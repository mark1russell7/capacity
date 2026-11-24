import { readFileSync } from "node:fs";
import { compositionValue, limitUse, scaleDemand, scaleRule, type Composition, type Law } from "@mark1russell7/capacity";
import { describe, expect, it } from "vitest";
import { COMPOSITIONS, LAWS } from "./data.ts";
import { DEFAULT_SETTING, RATES, RATE_LOAD, SLIDER_OPTIONS, countText, loadOf, pointSentences, positionOf, scaleModelOf, scaleSubjects, sliderLoadOf, sliderOf, stepsOfSlider, valueAt, type InstanceSetting, type Slider, type SliderPoint } from "./scale.ts";

const lawFile = (path: string): Law => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as Law;
const CATALOG = { laws: LAWS.map((each) => lawFile(each.path)), compositions: COMPOSITIONS };

/** These subjects are the subjects of the slider on the CPU model of the laws of the bare server. */
const CPU = LAWS.find((law) => law.subject === "node-http")!.cpu;
const SUBJECTS = scaleSubjects(COMPOSITIONS, LAWS, CPU);

/** One copy of alerts needs approximately 400 MB with no load, thus its tests use an instance of 1 GiB. */
const settingOf = (subject: string): InstanceSetting => (subject === "alerts-runtime" ? { ...DEFAULT_SETTING, memory: 1024 } : DEFAULT_SETTING);

/** These positions of the slider are the loads of the tests of each subject. */
const POSITIONS = [0.05, 0.3, 0.6, 0.95];

const sliderFor = (compositions: readonly Composition[], setting = DEFAULT_SETTING): Slider => {
  const slider = sliderOf(compositions, setting, CATALOG);
  if (typeof slider === "string") throw new Error(slider);
  return slider;
};

const pointAt = (slider: Slider, value: number): SliderPoint => {
  const point = slider.at(value);
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
  it("has the two subjects of the runner stack and alerts, in the order of the names", () => {
    expect(SUBJECTS.map((each) => each.subject)).toEqual(["node-http", "node-http-service", "alerts-runtime"]);
  });

  it("gives alerts with its compositions of the CPU and the memory, and its heap as a measure with no limit", () => {
    const alerts = SUBJECTS.find((each) => each.subject === "alerts-runtime")!;
    expect(alerts.compositions.map((each) => each.measure.id).sort()).toEqual(["cpu", "memory"]);
    expect(alerts.unlimited).toEqual(["heap"]);
    expect(SUBJECTS.find((each) => each.subject === "node-http-service")!.unlimited).toEqual([]);
  });

  it("moves the events each second of alerts, from the measures to 10 times the power of 10 over them", () => {
    const alerts = SUBJECTS.find((each) => each.subject === "alerts-runtime")!;
    const slider = sliderFor(alerts.compositions, settingOf("alerts-runtime"));
    expect(slider.load).toMatchObject({ id: "event", unit: "{event}/s", min: 1, max: 1000, start: 30 });
    expect(slider.measured).toMatchObject({ min: 0, max: 30 });
    expect(slider.load.demandAt(4)).toEqual({ classes: [], levels: { event: { value: 4, unit: "{event}/s" } } });
  }, 120_000);

  it("tells that an instance of 512 MiB is too small for alerts, not a count past the search", () => {
    // The memory law of alerts gives about 393 MiB with no load. 512 MiB less 30 % of headroom is 358 MiB.
    const alerts = SUBJECTS.find((each) => each.subject === "alerts-runtime")!;
    expect(sliderOf(alerts.compositions, DEFAULT_SETTING, CATALOG)).toBe(
      "At the lowest load of the slider, 1 event/s, the subject needs more than 256 instances of this size. Choose a larger instance.",
    );
    // The page shows the ends of this load with the text: events each second, not requests each second.
    expect(sliderLoadOf(alerts.compositions, DEFAULT_SETTING, CATALOG)).toMatchObject({ id: "event", unit: "{event}/s", min: 1, max: 1000 });
  }, 120_000);

  it("gives no subject on a CPU model with no laws, and the laws of each composition of a subject", () => {
    expect(scaleSubjects(COMPOSITIONS, LAWS, "no-such-cpu")).toEqual([]);
    const runner = SUBJECTS.find((each) => each.subject === "node-http-service")!;
    expect(runner.compositions.map((each) => each.measure.id).sort()).toEqual(["cpu", "memory"]);
    expect(runner.laws).toContain("node-http/rate/xeon-6975p-c/cpu.request");
    expect(new Set(runner.laws).size).toBe(runner.laws.length);
  });

  it.each(SUBJECTS.map((each) => [each.subject, each.compositions] as const))(
    "gives the count, the binding limit and the next step of the scale rule for %s",
    (subject, compositions) => {
      const slider = sliderFor(compositions, settingOf(subject));
      const model = scaleModelOf(compositions, settingOf(subject), CATALOG);
      for (const rate of POSITIONS.map((each) => Number(valueAt(slider.load, each).toPrecision(2)))) {
        const demand = scaleDemand(slider.load.demandAt(1), rate);
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
    (subject, compositions) => {
      const slider = sliderFor(compositions, settingOf(subject));
      const model = scaleModelOf(compositions, settingOf(subject), CATALOG);
      // This function gives the use of a limit with the load of a rate on each of some instances.
      const useOf = (id: string, rate: number, instances: number): number => {
        const limit = model.limits.find((each) => each.id === id)!;
        const composition = compositions.find((each) => each.measure.id === limit.measure)!;
        const demand = scaleDemand(slider.load.demandAt(rate), 1 / instances);
        if (demand.tag === "err") throw new Error(demand.error.message);
        const value = compositionValue(composition, CATALOG, demand.value);
        if (value.tag === "err") throw new Error(value.error.message);
        const use = limitUse(limit, model.instance, { value: value.value.value, unit: value.value.unit });
        if (use.tag === "err") throw new Error(use.error.message);
        return use.value.use;
      };
      for (const rate of POSITIONS.map((each) => valueAt(slider.load, each + 0.02))) {
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

  it.each(SUBJECTS.map((each) => [each.subject, each.compositions] as const))("gives counts that do not fall as the load grows for %s", (subject, compositions) => {
    const counts = stepsOfSlider(sliderFor(compositions, settingOf(subject)), 60).map((step) => step.count.value ?? Number.POSITIVE_INFINITY);
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
    expect(sliderFor(runner).load).toBe(RATE_LOAD);
  }, 120_000);
});

describe("the load of the laws of a subject", () => {
  const law = (id: string, variables: Law["variables"]): Law => ({ ...CATALOG.laws[0]!, id, variables });
  const event = { id: "event", unit: "{event}/s", min: 0, max: 30, scale: "linear" as const };

  it("gives the rate when each law reads the rate, and the one variable of each law in the other case", () => {
    const rate = CATALOG.laws.find((each) => each.variables.some((variable) => variable.id === "rate"))!;
    expect(loadOf([rate])).toBe(RATE_LOAD);
    expect(loadOf([law("a", [event]), law("b", [{ ...event, max: 50 }])])).toMatchObject({ id: "event", min: 1, max: 1000, start: 30 });
  });

  it("gives a text for no law, two variables, or laws of two variables", () => {
    expect(loadOf([])).toMatch(/no law/);
    expect(loadOf([law("a", [event, { ...event, id: "size" }])])).toMatch(/one load/);
    expect(loadOf([law("a", [event]), law("b", [{ ...event, id: "size" }])])).toMatch(/one load/);
    expect(loadOf([law("a", [event]), law("b", [{ ...event, unit: "{event}/min" }])])).toMatch(/one load/);
  });
});

describe("the position of the slider", () => {
  it("gives the load of each position on a log scale, and the position of each load", () => {
    expect(valueAt(RATE_LOAD, 0)).toBe(RATES.min);
    expect(valueAt(RATE_LOAD, 1)).toBeCloseTo(RATES.max, 6);
    expect(valueAt(RATE_LOAD, 0.5)).toBeCloseTo(10_000, 6);
    expect(valueAt(RATE_LOAD, -1)).toBe(RATES.min);
    for (const rate of [100, 777, 36_000, 1e6]) expect(valueAt(RATE_LOAD, positionOf(RATE_LOAD, rate))).toBeCloseTo(rate, 6);
  });
});

describe("the text of a slider point", () => {
  const point = (over: Partial<SliderPoint>): SliderPoint => ({
    value: 20_000,
    count: { value: 2, interval: { low: 2, high: 3 } },
    binding: "cpu",
    next: { value: 31_000, interval: { low: 29_000, high: 33_000 } },
    fills: [],
    extrapolated: true,
    ...over,
  });
  const slider = { load: RATE_LOAD, measured: { min: 100, max: 8000, scale: "log" as const } };

  it("tells the count, its interval, the limit that sets it, the next step and the end of the measures", () => {
    const text = pointSentences(point({}), slider, 256).join(" ");
    expect(text).toContain("needs 2 instances");
    expect(text).toContain("The interval is 2 to 3.");
    expect(text).toContain("The CPU limit sets the count.");
    expect(text).toContain("One more instance is necessary past");
    expect(text).toContain("No run measured a load past 8000 requests/s.");
  });

  it("tells one instance with no limit, and no note inside the measures", () => {
    const text = pointSentences(point({ value: 500, count: { value: 1, interval: { low: 1, high: 1 } }, binding: null, next: null, extrapolated: false }), slider, 256);
    expect(text).toEqual(["At 500 requests/s, the service needs 1 instance.", "One instance holds each limit."]);
  });

  it("tells a count past the search", () => {
    expect(countText(null, 256)).toBe("more than 256 instances");
    const text = pointSentences(point({ count: { value: null, interval: { low: 200, high: null } }, next: null }), slider, 256).join(" ");
    expect(text).toContain("more than 256 instances");
    expect(text).toContain("The interval is 200 to more than 256.");
  });

  it("tells the load in the unit of a level, and each measure with no limit", () => {
    const event = { load: { ...RATE_LOAD, id: "event", unit: "{event}/s" }, measured: { min: 0, max: 30, scale: "linear" as const } };
    const text = pointSentences(point({ value: 12, extrapolated: false, next: null }), event, 256, ["heap"]);
    expect(text[0]).toBe("At 12 events/s, the service needs 2 instances. The interval is 2 to 3.");
    expect(text.at(-1)).toBe("The subject also has a law of heap. The instance of this page has no limit of it, thus the count does not read it.");
  });
});
