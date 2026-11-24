/**
 * The load slider of the page: the scale rule of a subject at each value of its load, for one instance that the reader
 * sets. The load is the request rate, or a level of the demand, for example the events each second of alerts.
 * This module has no browser code. The function `scaleLadder` of `@mark1russell7/capacity` searches one time for each
 * setting of the instance. After that search, each move of the slider needs only arithmetic.
 */
import { RATE, compositionValue, limitUse, scaleDemand, scaleLadder, type Catalog, type Composition, type Demand, type Law, type Limit, type OpenValue, type ScaleLadder, type ScaleModel, type ScaleOptions } from "@mark1russell7/capacity";
import { amountText, stepsOf, unitWords } from "./curves.ts";
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

/**
 * A load is the variable that the slider moves: the request rate of the one class of the demand, or a level of the demand.
 * The slider moves it from `min` to `max` on a log scale, and starts at `start`.
 */
export interface Load {
  readonly id: string;
  readonly unit: string;
  /** This text names the load on the axis of the chart, for example "rate, requests/s". */
  readonly axis: string;
  readonly min: number;
  readonly max: number;
  readonly start: number;
  /** This function gives the demand at a value of the load. */
  readonly demandAt: (value: number) => Demand;
}

/** The load of a law with the variable `rate`: the request rate of one class. */
export const RATE_LOAD: Load = { id: RATE, unit: RATE_UNIT, axis: "rate, requests/s", min: RATES.min, max: RATES.max, start: 5000, demandAt };

/**
 * This function gives the load of the laws of a subject. When each law reads the rate, the load is the rate. When each
 * law reads one variable, and each law reads the same variable in the same unit, that variable is a level of the demand.
 * Its slider starts at the end of the measures. It goes from a tenth of the power of 10 under that end to 10 times the
 * power of 10 over it. Other laws give a text.
 */
export const loadOf = (laws: readonly Law[]): Load | string => {
  if (laws.length === 0) return "The subject reads no law.";
  if (laws.every((law) => law.variables.some((variable) => variable.id === RATE))) return RATE_LOAD;
  const first = laws[0]!.variables[0];
  if (first === undefined || !laws.every((law) => law.variables.length === 1 && law.variables[0]!.id === first.id && law.variables[0]!.unit === first.unit))
    return "The laws of the subject read more than one variable, or not the same variable. The slider moves one load.";
  const range = rateRangeOf(laws, first.id);
  if (typeof range === "string") return range;
  const power = Math.log10(range.max);
  const min = 10 ** (Math.floor(power) - 1);
  const max = 10 ** (Math.ceil(power) + 1);
  const demand = (value: number): Demand => ({ classes: [], levels: { [first.id]: { value, unit: first.unit } } });
  return { id: first.id, unit: first.unit, axis: `${first.id}, ${unitWords(first.unit)}`, min, max, start: range.max, demandAt: demand };
};

/** The value of the load at the demand of the ladder is 10 times the start of the slider. Each value of the slider is a factor of it. */
const baseOf = (load: Load): number => load.min * 10;

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

/** A slider point is the scale rule at one value of the load. */
export interface SliderPoint {
  readonly value: number;
  readonly count: OpenValue;
  /** This id is the limit that needs the most instances. It is null when one instance holds each limit. */
  readonly binding: string | null;
  /** This value is the highest load of the count: past it, one more instance is necessary. */
  readonly next: OpenValue | null;
  readonly fills: readonly Fill[];
  /** This flag tells that a law reads a load past its measures at this point. */
  readonly extrapolated: boolean;
}

/** A slider is the scale rule of a subject at each value of its load, for one instance setting. */
export interface Slider {
  readonly load: Load;
  readonly ladder: ScaleLadder;
  /** This range holds the values of the load that each law of the subject measured. Past it, a value is an extrapolation. */
  readonly measured: RateRange;
  readonly at: (value: number) => SliderPoint | string;
}

/** This function changes an open value of a factor of the demand at a load to an open value of the load. */
const loadValueOf = (factor: OpenValue, load: number): OpenValue => ({
  value: factor.value === null ? null : factor.value * load,
  interval: {
    low: factor.interval.low === null ? null : factor.interval.low * load,
    high: factor.interval.high === null ? null : factor.interval.high * load,
  },
});

/** This function gives the laws of some compositions that a catalog holds, each one time, in their nested compositions too. */
const lawsOf = (compositions: readonly Composition[], catalog: Catalog): readonly Law[] => {
  const ids = new Set(compositions.flatMap((composition) => lawIdsOf(composition, catalog.compositions ?? [])));
  return catalog.laws.filter((law) => ids.has(law.id));
};

/** This function gives the model, the laws and the load of the slider of some compositions on an instance, or a text. */
const basisOf = (compositions: readonly Composition[], setting: InstanceSetting, catalog: Catalog) => {
  const model = scaleModelOf(compositions, setting, catalog);
  if (model.limits.length === 0) return "The subject has no composition of a resource of an instance.";
  const laws = lawsOf(model.compositions, catalog);
  const load = loadOf(laws);
  return typeof load === "string" ? load : { model, laws, load };
};

/**
 * This function gives the load of the slider of some compositions on an instance. It is the load of `sliderOf`. The page
 * reads it also when `sliderOf` gives a text, thus the ends of the slider show the unit of the subject.
 */
export const sliderLoadOf = (compositions: readonly Composition[], setting: InstanceSetting, catalog: Catalog): Load | string => {
  const basis = basisOf(compositions, setting, catalog);
  return typeof basis === "string" ? basis : basis.load;
};

/**
 * This function gives the slider of the compositions of one subject on an instance. It searches one time. A problem
 * of the model or of the search gives a text.
 */
export const sliderOf = (compositions: readonly Composition[], setting: InstanceSetting, catalog: Catalog): Slider | string => {
  const basis = basisOf(compositions, setting, catalog);
  if (typeof basis === "string") return basis;
  const { model, laws, load } = basis;
  const measured = rateRangeOf(laws, load.id);
  if (typeof measured === "string") return measured;
  const base = baseOf(load);
  const demand = load.demandAt(base);
  const built = scaleLadder(model, demand, { low: load.min / base, high: load.max / base }, SLIDER_OPTIONS);
  if (built.tag === "err") return built.error.message;
  const ladder = built.value;
  // A cost with no load past the limit of one instance gives no count at each load. The page tells that, not a count past the search.
  const lowest = ladder.ruleAt(load.min / base);
  if (lowest.tag === "ok" && lowest.value.count.value === null)
    return `At the lowest load of the slider, ${amountText(load.min, load.unit)}, the subject needs more than ${ladder.most} instances of this size. Choose a larger instance.`;
  const at = (x: number): SliderPoint | string => {
    const factor = x / base;
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
      const share = scaleDemand(demand, factor / instances);
      if (share.tag === "err") return share.error.message;
      const value = compositionValue(composition, catalog, share.value);
      if (value.tag === "err") return value.error.message;
      const use = limitUse(limit, model.instance, { value: value.value.value, unit: value.value.unit });
      if (use.tag === "err") return use.error.message;
      fills.push({ limit: limit.id, use: use.value.use });
    }
    // The next load is a factor of the demand at this load, not of the demand of the ladder.
    return { value: x, count, binding, next: next === null ? null : loadValueOf(next.factor, x), fills, extrapolated };
  };
  return { load, ladder, measured, at };
};

/** A step is the count of instances at one value of the load, with its interval. A null count is more than the largest count of the search. */
export interface Step {
  readonly value: number;
  readonly count: OpenValue;
  readonly extrapolated: boolean;
}

/** This function gives the count of instances at `steps` values of the load of the slider, for the chart of the steps. */
export const stepsOfSlider = (slider: Slider, steps = 160): readonly Step[] =>
  stepsOf(slider.load.min, slider.load.max, "log", steps).flatMap((value) => {
    const point = slider.at(value);
    return typeof point === "string" ? [] : [{ value, count: point.count, extrapolated: point.extrapolated }];
  });

/** This function gives the value of a load at a position of the slider from 0 to 1, on a log scale. */
export const valueAt = (load: Pick<Load, "min" | "max">, position: number): number => load.min * (load.max / load.min) ** Math.min(1, Math.max(0, position));

/** This function gives the position of a value of a load on the slider, from 0 to 1. */
export const positionOf = (load: Pick<Load, "min" | "max">, value: number): number => Math.log(value / load.min) / Math.log(load.max / load.min);

/** These names are the names of the subjects of the slider in the text of the page. */
export const SUBJECT_NAMES: Readonly<Record<string, string>> = { "node-http": STACK_NAMES.base, "node-http-service": STACK_NAMES.total, "alerts-runtime": "alerts" };

/** A scale subject is one subject with its compositions of the resources of an instance, on one CPU model. */
export interface ScaleSubject {
  readonly subject: string;
  readonly compositions: readonly Composition[];
  /** These ids are the laws of the compositions, each one time. */
  readonly laws: readonly string[];
  /** These ids are the measures of the other compositions of the subject on the CPU model. The page sets no limit on them. */
  readonly unlimited: readonly string[];
}

/**
 * This function gives each subject that has a composition of a resource on one CPU model. A composition is on a CPU
 * model when each of its laws is on it. The slider moves one load, thus each law of the compositions of a subject reads
 * the rate, or each law reads the same one variable. The laws of alerts read the level `event`. The subjects of
 * `SUBJECT_NAMES` come first, in its order.
 */
export const scaleSubjects = (
  compositions: readonly Composition[],
  laws: readonly { readonly id: string; readonly cpu: string; readonly variables: readonly string[] }[],
  cpu: string,
): readonly ScaleSubject[] => {
  const cpuOf = new Map(laws.map((law) => [law.id, law.cpu]));
  const variablesOf = new Map(laws.map((law) => [law.id, law.variables]));
  // The load of some laws: the rate when each law reads the rate, the one variable of each law, or null.
  const loadKey = (ids: readonly string[]): string | null => {
    const lists = ids.map((id) => variablesOf.get(id) ?? []);
    if (lists.every((list) => list.includes(RATE))) return RATE;
    const first = lists[0]?.[0];
    return first !== undefined && lists.every((list) => list.length === 1 && list[0] === first) ? first : null;
  };
  const order = Object.keys(SUBJECT_NAMES);
  const rank = (subject: string): number => (order.includes(subject) ? order.indexOf(subject) : order.length);
  const groups = new Map<string, { load: string; compositions: Composition[]; laws: Set<string>; unlimited: string[] }>();
  const others: Composition[] = [];
  for (const composition of compositions) {
    const ids = lawIdsOf(composition, compositions);
    if (ids.length === 0 || !ids.every((id) => cpuOf.get(id) === cpu)) continue;
    if (RESOURCES[composition.measure.id] === undefined) {
      others.push(composition);
      continue;
    }
    const load = loadKey(ids);
    if (load === null) continue;
    const group = groups.get(composition.subject) ?? { load, compositions: [], laws: new Set<string>(), unlimited: [] };
    // Each composition of a subject moves with the one load of the slider.
    if (group.load !== load) continue;
    group.compositions.push(composition);
    for (const id of ids) group.laws.add(id);
    groups.set(composition.subject, group);
  }
  for (const other of others) groups.get(other.subject)?.unlimited.push(other.measure.id);
  return [...groups]
    .map(([subject, group]) => ({ subject, compositions: group.compositions, laws: [...group.laws], unlimited: group.unlimited }))
    .sort((a, b) => rank(a.subject) - rank(b.subject) || a.subject.localeCompare(b.subject));
};

/** This function gives the text of a count of instances, for example "3 instances" or "more than 256 instances". */
export const countText = (count: number | null, most: number): string =>
  count === null ? `more than ${most} instances` : `${count} ${count === 1 ? "instance" : "instances"}`;

/**
 * This function tells a slider point in plain sentences: the count, the limit that sets it, the next step and the measures.
 * It also names each measure of the subject that the instance does not limit.
 */
export const pointSentences = (point: SliderPoint, slider: Pick<Slider, "load" | "measured">, most: number, unlimited: readonly string[] = []): readonly string[] => {
  const { load, measured } = slider;
  const at = amountText(point.value, load.unit);
  const { low, high } = point.count.interval;
  const range = low === high ? "" : ` The interval is ${low ?? `more than ${most}`} to ${high ?? `more than ${most}`}.`;
  const sentences = [`At ${at}, the service needs ${countText(point.count.value, most)}.${range}`];
  if (point.binding === null) sentences.push("One instance holds each limit.");
  else sentences.push(`The ${LIMIT_NAMES[point.binding] ?? point.binding} limit sets the count.`);
  const next = point.next?.value;
  if (next != null && point.count.value !== null) sentences.push(`One more instance is necessary past ${amountText(next, load.unit)}.`);
  if (point.extrapolated || point.value > measured.max)
    sentences.push(`No run measured a load past ${amountText(measured.max, load.unit)}. Past it, the laws extend their measures, and a falling cost stays at its last measured value.`);
  if (unlimited.length > 0)
    sentences.push(`The subject also has a law of ${unlimited.join(" and ")}. The instance of this page has no limit of it, thus the count does not read it.`);
  return sentences;
};
