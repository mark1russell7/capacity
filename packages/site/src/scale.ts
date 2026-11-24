/**
 * The load slider of the page: the scale rule of a subject at each request rate, for one instance that the reader sets.
 * This module has no browser code. The function `scaleLadder` of `@mark1russell7/capacity` searches one time for each
 * setting of the instance. After that search, each move of the slider needs only arithmetic.
 */
import { compositionValue, limitUse, scaleDemand, scaleLadder, type Catalog, type Composition, type Law, type Limit, type OpenValue, type ScaleLadder, type ScaleModel, type ScaleOptions } from "@mark1russell7/capacity";
import { amountText, stepsOf } from "./curves.ts";
import { RATE_UNIT, STACK_NAMES, demandAt, lawIdsOf, rateRangeOf, type RateRange } from "./stack.ts";

/** An instance setting is what the reader sets: the cores and the memory of one instance, and the headroom of each limit. */
export interface InstanceSetting {
  readonly cores: number;
  /** This number is the memory of one instance, in MiB. */
  readonly memory: number;
  /** This number is the share of each resource that the service keeps free, from 0 to 1. */
  readonly headroom: number;
}

/** This setting is the instance of the page before the reader changes it. */
export const DEFAULT_SETTING: InstanceSetting = { cores: 2, memory: 512, headroom: 0.3 };

/** These choices are the settings of an instance that the page offers. */
export const SETTING_CHOICES = { cores: [1, 2, 4, 8, 16], memory: [256, 512, 1024, 2048, 4096], headroom: [0.1, 0.2, 0.3, 0.5] } as const;

/** The slider moves the request rate from `min` to `max`, in requests each second, on a log scale. */
export const RATES = { min: 100, max: 1_000_000 } as const;

/** This rate is the demand of the ladder. Each rate of the slider is a factor of it. */
const BASE_RATE = 1000;

/** These options set the search. The count goes up to `most` instances. */
export const SLIDER_OPTIONS: ScaleOptions = { steps: 16, most: 256 };

/** These measures are resources of an instance. The page sets a limit on each one that a composition gives. */
const RESOURCES: Readonly<Record<string, { readonly unit: string; readonly amount: (setting: InstanceSetting) => number }>> = {
  cpu: { unit: "{core}", amount: (setting) => setting.cores },
  memory: { unit: "MiB", amount: (setting) => setting.memory },
};

/** These names are the names of the limits in the text of the page. */
export const LIMIT_NAMES: Readonly<Record<string, string>> = { cpu: "CPU", memory: "memory" };

/**
 * This function gives the scale model of the compositions of one subject on an instance. Each composition of a resource
 * gives one limit on the whole of that resource, with the headroom of the setting.
 */
export const scaleModelOf = (compositions: readonly Composition[], setting: InstanceSetting, catalog: Catalog): ScaleModel => {
  const limits: Limit[] = compositions
    .filter((composition) => RESOURCES[composition.measure.id] !== undefined)
    .map((composition) => ({
      id: composition.measure.id,
      measure: composition.measure.id,
      ceiling: { kind: "resource", resource: composition.measure.id },
      headroom: setting.headroom,
    }));
  const resources = Object.fromEntries(Object.entries(RESOURCES).map(([id, resource]) => [id, { value: resource.amount(setting), unit: resource.unit }]));
  return { instance: { resources }, limits, compositions, catalog };
};

/** A fill is the use of one limit on each instance at the count: the value of its composition over the amount of the limit. A use of 1 is at the headroom. */
export interface Fill {
  readonly limit: string;
  /** A null use tells that the count is more than the largest count of the search. */
  readonly use: number | null;
}

/** A slider point is the scale rule at one request rate. */
export interface SliderPoint {
  readonly rate: number;
  readonly count: OpenValue;
  /** This id is the limit that needs the most instances. It is null when one instance holds each limit. */
  readonly binding: string | null;
  /** This value is the highest rate of the count: past it, one more instance is necessary. */
  readonly next: OpenValue | null;
  readonly fills: readonly Fill[];
  /** This flag tells that a law reads a rate past its measures at this point. */
  readonly extrapolated: boolean;
}

/** A slider is the scale rule of a subject at each rate of the slider, for one instance setting. */
export interface Slider {
  readonly ladder: ScaleLadder;
  /** This range holds the rates that each law of the subject measured. Past it, a value is an extrapolation. */
  readonly measured: RateRange;
  readonly at: (rate: number) => SliderPoint | string;
}

/** This function changes an open value of a factor of the demand at a rate to an open value of a rate. */
const rateOf = (value: OpenValue, rate: number): OpenValue => ({
  value: value.value === null ? null : value.value * rate,
  interval: {
    low: value.interval.low === null ? null : value.interval.low * rate,
    high: value.interval.high === null ? null : value.interval.high * rate,
  },
});

/** This function gives the laws of some compositions that a catalog holds, each one time, in their nested compositions too. */
const lawsOf = (compositions: readonly Composition[], catalog: Catalog): readonly Law[] => {
  const ids = new Set(compositions.flatMap((composition) => lawIdsOf(composition, catalog.compositions ?? [])));
  return catalog.laws.filter((law) => ids.has(law.id));
};

/**
 * This function gives the slider of the compositions of one subject on an instance. It searches one time. A problem
 * of the model or of the search gives a text.
 */
export const sliderOf = (compositions: readonly Composition[], setting: InstanceSetting, catalog: Catalog): Slider | string => {
  const model = scaleModelOf(compositions, setting, catalog);
  if (model.limits.length === 0) return "The subject has no composition of a resource of an instance.";
  const measured = rateRangeOf(lawsOf(model.compositions, catalog));
  if (typeof measured === "string") return measured;
  const demand = demandAt(BASE_RATE);
  const built = scaleLadder(model, demand, { low: RATES.min / BASE_RATE, high: RATES.max / BASE_RATE }, SLIDER_OPTIONS);
  if (built.tag === "err") return built.error.message;
  const ladder = built.value;
  const at = (rate: number): SliderPoint | string => {
    const factor = rate / BASE_RATE;
    const rule = ladder.ruleAt(factor);
    if (rule.tag === "err") return rule.error.message;
    const { count, binding, next, extrapolated } = rule.value;
    const instances = count.value;
    const fills: Fill[] = [];
    for (const limit of model.limits) {
      if (instances === null) {
        fills.push({ limit: limit.id, use: null });
        continue;
      }
      // The use comes from the value of the composition at the load on one instance, as the search reads it.
      const composition = model.compositions.find((each) => each.measure.id === limit.measure)!;
      const load = scaleDemand(demand, factor / instances);
      if (load.tag === "err") return load.error.message;
      const value = compositionValue(composition, catalog, load.value);
      if (value.tag === "err") return value.error.message;
      const use = limitUse(limit, model.instance, { value: value.value.value, unit: value.value.unit });
      if (use.tag === "err") return use.error.message;
      fills.push({ limit: limit.id, use: use.value.use });
    }
    // The next rate is a factor of the demand at this rate, not of the demand of the ladder.
    return { rate, count, binding, next: next === null ? null : rateOf(next.factor, rate), fills, extrapolated };
  };
  return { ladder, measured, at };
};

/** A step is the count of instances at one rate, with its interval. A null count is more than the largest count of the search. */
export interface Step {
  readonly rate: number;
  readonly count: OpenValue;
  readonly extrapolated: boolean;
}

/** This function gives the count of instances at `steps` rates of the slider, for the chart of the steps. */
export const stepsOfSlider = (slider: Slider, steps = 160): readonly Step[] =>
  stepsOf(RATES.min, RATES.max, "log", steps).flatMap((rate) => {
    const point = slider.at(rate);
    return typeof point === "string" ? [] : [{ rate, count: point.count, extrapolated: point.extrapolated }];
  });

/** This function gives the rate of a position of the slider from 0 to 1, on a log scale. */
export const rateAt = (position: number): number => RATES.min * (RATES.max / RATES.min) ** Math.min(1, Math.max(0, position));

/** This function gives the position of a rate on the slider, from 0 to 1. */
export const positionOf = (rate: number): number => Math.log(rate / RATES.min) / Math.log(RATES.max / RATES.min);

/** These names are the names of the subjects of the slider in the text of the page. */
export const SUBJECT_NAMES: Readonly<Record<string, string>> = { "node-http": STACK_NAMES.base, "node-http-service": STACK_NAMES.total };

/** A scale subject is one subject with its compositions of the resources of an instance, on one CPU model. */
export interface ScaleSubject {
  readonly subject: string;
  readonly compositions: readonly Composition[];
  /** These ids are the laws of the compositions, each one time. */
  readonly laws: readonly string[];
}

/**
 * This function gives each subject that has a composition of a resource on one CPU model. A composition is on a CPU
 * model when each of its laws is on it. The slider moves the request rate, thus each law of a composition reads the
 * variable `rate`. The laws of alerts read a level of events, and the slider does not show them (CAP-93). The subjects
 * of the slider come first, in the order of `SUBJECT_NAMES`.
 */
export const scaleSubjects = (
  compositions: readonly Composition[],
  laws: readonly { readonly id: string; readonly cpu: string; readonly variables: readonly string[] }[],
  cpu: string,
): readonly ScaleSubject[] => {
  const cpuOf = new Map(laws.map((law) => [law.id, law.cpu]));
  const readsRate = new Set(laws.filter((law) => law.variables.includes("rate")).map((law) => law.id));
  const order = Object.keys(SUBJECT_NAMES);
  const rank = (subject: string): number => (order.includes(subject) ? order.indexOf(subject) : order.length);
  const groups = new Map<string, { compositions: Composition[]; laws: Set<string> }>();
  for (const composition of compositions) {
    if (RESOURCES[composition.measure.id] === undefined) continue;
    const ids = lawIdsOf(composition, compositions);
    if (ids.length === 0 || !ids.every((id) => cpuOf.get(id) === cpu && readsRate.has(id))) continue;
    const group = groups.get(composition.subject) ?? { compositions: [], laws: new Set<string>() };
    group.compositions.push(composition);
    for (const id of ids) group.laws.add(id);
    groups.set(composition.subject, group);
  }
  return [...groups]
    .map(([subject, group]) => ({ subject, compositions: group.compositions, laws: [...group.laws] }))
    .sort((a, b) => rank(a.subject) - rank(b.subject) || a.subject.localeCompare(b.subject));
};

/** This function gives the text of a count of instances, for example "3 instances" or "more than 256 instances". */
export const countText = (count: number | null, most: number): string =>
  count === null ? `more than ${most} instances` : `${count} ${count === 1 ? "instance" : "instances"}`;

/** This function tells a slider point in plain sentences: the count, the limit that sets it, the next step and the measures. */
export const pointSentences = (point: SliderPoint, measured: RateRange, most: number): readonly string[] => {
  const at = amountText(point.rate, RATE_UNIT);
  const { low, high } = point.count.interval;
  const range = low === high ? "" : ` The interval is ${low ?? `more than ${most}`} to ${high ?? `more than ${most}`}.`;
  const sentences = [`At ${at}, the service needs ${countText(point.count.value, most)}.${range}`];
  if (point.binding === null) sentences.push("One instance holds each limit.");
  else sentences.push(`The ${LIMIT_NAMES[point.binding] ?? point.binding} limit sets the count.`);
  const next = point.next?.value;
  if (next != null && point.count.value !== null) sentences.push(`One more instance is necessary past ${amountText(next, RATE_UNIT)}.`);
  if (point.extrapolated || point.rate > measured.max)
    sentences.push(`No run measured a rate past ${amountText(measured.max, RATE_UNIT)}. Past it, the laws extend their measures, and a falling cost stays at its last measured value.`);
  return sentences;
};
