/**
 * The stack of a composition with layers: the value of its base layer and the value that its own laws add, over the request
 * rate. This module has no browser code. The function `compositionValue` of `@mark1russell7/capacity` gives each value,
 * thus the page and the lab add the laws with one rule.
 */
import { RATE, compositionValue, type Catalog, type Composition, type Demand, type Law } from "@mark1russell7/capacity";
import { CURVE_STEPS, amountText, stepsOf } from "./curves.ts";

/** A band is a value with the interval of its replicates. */
export interface Band {
  readonly value: number;
  readonly low: number;
  readonly high: number;
}

/** A stack point is the base layer, the part that the composition adds, and their sum, at one request rate. */
export interface StackPoint {
  readonly x: number;
  readonly base: Band;
  readonly added: Band;
  readonly total: Band;
}

/** A rate range is the range of the request rate that each law of a composition holds, and its scale. */
export interface RateRange {
  readonly min: number;
  readonly max: number;
  readonly scale: "log" | "linear";
}

/** A stack is the points of a composition over the request rate, with the composition of its base layer. */
export interface Stack {
  readonly composition: Composition;
  readonly base: Composition;
  readonly unit: string;
  readonly range: RateRange;
  readonly level: number;
  readonly points: readonly StackPoint[];
}

/** This unit is the unit of the request rate of a demand. */
export const RATE_UNIT = "{request}/s";

/**
 * This function gives the ids of the laws that a composition reads, in its terms and in its nested compositions, each
 * one time. With `load`, it gives only the laws that move with the load. A term with a base reads its own level, and
 * its change is 0 at the base point. Thus `load` leaves out each term with a base.
 */
export const lawIdsOf = (composition: Composition, compositions: readonly Composition[], which: "all" | "load" = "all"): readonly string[] => {
  const ids = new Set<string>();
  const seen = new Set<string>();
  const walk = (each: Composition): void => {
    if (seen.has(each.id)) return;
    seen.add(each.id);
    for (const term of each.terms) {
      if ("law" in term) {
        if (which === "all" || term.base === undefined) ids.add(term.law);
      }
      else {
        const nested = compositions.find((other) => other.id === term.composition);
        if (nested !== undefined) walk(nested);
      }
    }
  };
  walk(composition);
  return [...ids];
};

/**
 * This function gives the base layer of a composition: the composition of its one nested term. A composition with no
 * nested term, with two or more, or with no law term of its own gives undefined. Thus layer 2 has layer 1 as its base.
 */
export const stackBaseOf = (composition: Composition, compositions: readonly Composition[]): Composition | undefined => {
  const nested = composition.terms.flatMap((term) => ("composition" in term ? [term] : []));
  const own = composition.terms.filter((term) => "law" in term);
  if (nested.length !== 1 || own.length === 0 || (nested[0]!.factor ?? 1) !== 1) return undefined;
  return compositions.find((each) => each.id === nested[0]!.composition);
};

/**
 * This function gives the range of a variable that each law holds: the highest start and the lowest end. The variable is
 * the request rate when the caller gives no other variable.
 */
export const rateRangeOf = (laws: readonly Law[], variable = RATE): RateRange | string => {
  const variables = laws.map((law) => law.variables.find((each) => each.id === variable));
  if (laws.length === 0) return "The composition reads no law.";
  if (variables.some((each) => each === undefined)) return `A law of the composition has no variable ${variable}.`;
  const rates = variables.filter((each) => each !== undefined);
  const min = Math.max(...rates.map((each) => each.min));
  const max = Math.min(...rates.map((each) => each.max));
  if (!(min < max)) return `The laws of the composition hold no common range of the variable ${variable}.`;
  return { min, max, scale: rates.every((each) => each.scale === "log") ? "log" : "linear" };
};

/** This function gives a demand of one class at a rate, in requests each second. */
export const demandAt = (rate: number): Demand => ({ classes: [{ id: "request", rate: { value: rate, unit: RATE_UNIT }, request: {} }], levels: {} });

/**
 * This function gives the stack of a composition with a base layer, at `steps` rates over the common range of its laws.
 * The part that the composition adds is the value of its own law terms as one composition. Thus its interval comes from
 * the same rows of replicates as the total, and the page adds no interval by hand. A problem gives a text.
 */
export const stackOf = (composition: Composition, catalog: Catalog, steps = CURVE_STEPS): Stack | string => {
  const compositions = catalog.compositions ?? [];
  const base = stackBaseOf(composition, compositions);
  if (base === undefined) return "The composition has no base layer.";
  const laws = lawIdsOf(composition, compositions).map((id) => catalog.laws.find((law) => law.id === id));
  if (laws.some((law) => law === undefined)) return "A law of the composition did not load.";
  const range = rateRangeOf(laws.filter((law) => law !== undefined));
  if (typeof range === "string") return range;
  const added: Composition = { ...composition, id: `${composition.id}/added`, terms: composition.terms.filter((term) => "law" in term) };
  const points: StackPoint[] = [];
  let level = 0.95;
  for (const x of stepsOf(range.min, range.max, range.scale, steps)) {
    const demand = demandAt(x);
    const total = compositionValue(composition, catalog, demand);
    if (total.tag !== "ok") return total.error.message;
    const own = compositionValue(added, catalog, demand);
    if (own.tag !== "ok") return own.error.message;
    const nested = total.value.parts.find((part) => part.kind === "composition");
    if (nested === undefined) return "The value of the composition has no part of its base layer.";
    level = total.value.level;
    points.push({
      x,
      base: { value: nested.value, low: nested.interval.low, high: nested.interval.high },
      added: { value: own.value.value, low: own.value.interval.low, high: own.value.interval.high },
      total: { value: total.value.value, low: total.value.interval.low, high: total.value.interval.high },
    });
  }
  return { composition, base, unit: composition.measure.unit, range, level, points };
};

/** This function gives the text of a band: its value and its interval. The ends of the interval drop the unit of the value when they have it. */
export const bandText = (band: Band, unit: string): string => {
  const value = amountText(band.value, unit);
  const suffix = value.slice(value.lastIndexOf(" "));
  const [low, high] = [band.low, band.high].map((each) => amountText(each, unit));
  const same = suffix.length > 1 && low!.endsWith(suffix) && high!.endsWith(suffix);
  return same ? `${value} (${low!.slice(0, -suffix.length)} to ${high!.slice(0, -suffix.length)})` : `${value} (${low} to ${high})`;
};

/** These names are the names of the two layers of a stack in the legend, in the tip and in the table. */
export const STACK_NAMES = { base: "Bare Node", added: "The runner adds", total: "On the runner" } as const;

/** This function tells the two layers of a stack at one point in two sentences. */
export const stackSentence = (stack: Stack, point: StackPoint): string => {
  const at = amountText(point.x, RATE_UNIT);
  return `At ${at}, bare Node uses ${bandText(point.base, stack.unit)}. The service runner adds ${bandText(point.added, stack.unit)}.`;
};
