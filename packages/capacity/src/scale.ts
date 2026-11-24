import { err, ok, type Result } from "@mark1russell7/optional";
import { convertible, factorOf, whyNotConvertible } from "@mark1russell7/quantity";
import {
  flatPartsOf,
  partsOutside,
  preparedOf,
  rowValueOf,
  rowValuesOf,
  type Catalog,
  type Composition,
  type CompositionProblemCode,
  type FlatPart,
  type Prepared,
} from "./composition.ts";
import { portionOf } from "./demand.ts";
import type { Instance, Limit, LimitProblemCode } from "./instance.ts";
import { MAX_STEPS, amountTest, openValueOf, rowOf, searchGrid, type Curve, type OpenValue } from "./knee.ts";
import { DEFAULT_LEVEL, type Problem } from "./law.ts";
import { limitAmount } from "./limit.ts";
import { repeated } from "./names.ts";
import type { LevelOptions, Range } from "./value.ts";
import { demandProblems } from "./workload-check.ts";
import type { Amounts, Demand } from "./workload.ts";

/** This number is the largest count of instances of a scale search when the options give none: 2 to the power 20. */
export const SCALE_MOST: number = 2 ** 20;

/** This number is the count of steps of the grid of a scale search when the options give none. */
export const SCALE_STEPS: number = 128;

/**
 * A scale model holds what the scale queries of a service read: the resources of one instance, the
 * limits of the service and the compositions. Each limit reads the composition of its measure. The
 * catalog gives each law and each nested composition that the compositions name.
 */
export interface ScaleModel {
  readonly instance: Instance;
  readonly limits: readonly Limit[];
  /** Each composition gives one measure, by the id of its measure. The list can hold compositions that no limit reads. */
  readonly compositions: readonly Composition[];
  readonly catalog: Catalog;
}

/**
 * These options set a scale query. The field `given` gives the state of each instance, for example
 * its heap. A level in `whole` does not divide between the instances, as in `shareOf`.
 *
 * The count search goes up to `most` instances. The load search goes from `1 / most` to `most`
 * times the demand. Each search has a grid of `steps` steps on a log scale. The level of the
 * intervals is 0.95 when the options give none.
 */
export interface ScaleOptions extends LevelOptions {
  readonly given?: Amounts;
  readonly whole?: readonly string[];
  readonly most?: number;
  readonly steps?: number;
}

/** A scale problem code names the part of a scale model, or of a scale query, that is not correct. */
export type ScaleProblemCode = CompositionProblemCode | LimitProblemCode;

/** A scale problem tells what is not correct, and where: `path` is the path of the field in the model or in the query. */
export type ScaleProblem = Problem<ScaleProblemCode>;

/**
 * A limit count is the lowest count of instances that holds one limit at a load. Each larger count
 * also holds the limit. A null count is more than the largest count of the search.
 */
export interface LimitCount {
  readonly limit: string;
  readonly measure: string;
  readonly count: OpenValue;
  /** This number is the share of the replicates where this limit needs more instances than each other limit. */
  readonly binds: number;
  /** This flag tells that the composition has no value past the share of the estimate. Then the edge of the composition sets the count. */
  readonly edge: boolean;
  /** This flag tells that a law of the composition reads a variable outside its range at the count of the estimate. */
  readonly extrapolated: boolean;
}

/**
 * A limit reach is the first load where one limit breaks at a count of instances, as a factor of
 * the demand. Below this factor, the limit holds. A null factor is past the end of the search.
 */
export interface LimitReach {
  readonly limit: string;
  readonly measure: string;
  readonly factor: OpenValue;
  /** This number is the share of the replicates where this limit breaks before each other limit. */
  readonly binds: number;
  /** This flag tells that the composition has no value past the factor of the estimate. Then the edge of the composition sets the factor. */
  readonly edge: boolean;
  /** This flag tells that a law of the composition reads a variable outside its range at the factor of the estimate. */
  readonly extrapolated: boolean;
}

/**
 * A count reach is the highest load that a count of instances holds, as a factor of the demand. The
 * demand at the factor `f` is `scaleDemand(demand, f)`. The `factor` is the first factor where a
 * limit breaks, and the `binding` limit breaks there in the estimate.
 *
 * The limits go from the first limit that breaks to the last. The flag `extrapolated` tells that a
 * law reads a variable outside its range at the factor of the estimate.
 */
export interface CountReach {
  readonly count: number;
  readonly level: number;
  readonly search: Range;
  readonly factor: OpenValue;
  readonly binding: string | null;
  readonly extrapolated: boolean;
  readonly limits: readonly LimitReach[];
}

/**
 * A scale rule is the lowest count of instances that holds each limit at a load, with its interval.
 * Each larger count also holds each limit. A null count is more than `most` instances.
 *
 * The `binding` limit needs the most instances in the estimate. It is null when one instance holds
 * each limit at each share of the search. The limits go from the largest count to the smallest. The
 * reach `next` is the highest load of the count of the estimate: there the service needs one more instance.
 */
export interface ScaleRule {
  readonly level: number;
  readonly most: number;
  readonly count: OpenValue;
  readonly binding: string | null;
  readonly extrapolated: boolean;
  readonly limits: readonly LimitCount[];
  readonly next: CountReach | null;
}

/** The setup of one limit: its composition, and the number that changes a value of the composition to a use of the limit. */
interface LimitSetup {
  readonly limit: Limit;
  readonly path: string;
  /** This index is the index of the composition in the model. */
  readonly at: number;
  readonly prepared: Prepared;
  /** This number times a value of the composition is the use of the limit. A use above 1 breaks the limit. */
  readonly per: number;
}

/** The setup of a scale query: each limit, the count of rows that the limits share, and the options. */
interface Setup {
  readonly limits: readonly LimitSetup[];
  readonly rows: number;
  readonly level: number;
  readonly given: Amounts;
  readonly whole: readonly string[];
  readonly most: number;
  readonly steps: number;
  readonly demand: Demand;
}

/** A path of demands gives the demand on one instance at each load of a search. */
type DemandAt = (load: number) => Demand | undefined;

/** The search of one limit: the first load where each row breaks the limit, and if the edge sets the load of the estimate. Row 0 is the estimate. */
interface LimitBreaks {
  readonly rows: readonly number[];
  readonly edge: boolean;
}

/**
 * The summary holds the rows of all limits: the first load where each row breaks a limit. It also holds the limit that
 * breaks first in the estimate, and the share of the rows where each limit is first.
 */
interface Summary {
  readonly rows: readonly number[];
  readonly binding: number | null;
  readonly binds: readonly number[];
  /** These indexes put the limits in the order of the load of the estimate, from the first limit that breaks. */
  readonly order: readonly number[];
}

const problem = (code: ScaleProblemCode, path: string, message: string): ScaleProblem => ({ code, path, message });

/** This function gives a problem with `owner` in front of its path. */
const under = (found: Problem<string>, owner: string): ScaleProblem => ({
  code: found.code as ScaleProblemCode,
  path: `${owner}.${found.path}`,
  message: found.message,
});

/**
 * This function gives a problem of a composition of the model, with the path in the model. A path of
 * the catalog starts with `laws` or `compositions`, and each other path is in the composition.
 */
const inComposition = (found: Problem<string>, at: number): ScaleProblem =>
  under(found, /^(laws|compositions)\./.test(found.path) ? "catalog" : `compositions[${at}]`);

/** This function gives the setup of a scale query, or the first problem of the model, the demand or the options. */
const setupOf = (model: ScaleModel, demand: Demand, options: ScaleOptions): Result<Setup, ScaleProblem> => {
  const level = options.level ?? DEFAULT_LEVEL;
  const most = options.most ?? SCALE_MOST;
  if (!Number.isSafeInteger(most) || most < 2) {
    return err(problem("factor", "most", `The largest count of the search, ${most}, is not a whole number of 2 or more.`));
  }
  const badDemand = demandProblems(demand)[0];
  if (badDemand !== undefined) return err(under(badDemand, "demand"));
  const whole = options.whole ?? [];
  const unknown = whole.find((name) => !Object.hasOwn(demand.levels, name));
  if (unknown !== undefined) return err(problem("variable", "whole", `The demand has no level "${unknown}".`));
  if (model.limits.length === 0) return err(problem("measure", "limits", "The model has no limit."));
  const twice = repeated(model.limits.map((limit) => limit.id));
  if (twice !== undefined) return err(problem("id", "limits", `Two limits have the id "${twice}".`));

  const byMeasure = new Map<string, number>();
  for (const [index, composition] of model.compositions.entries()) {
    const measure = composition.measure.id;
    if (byMeasure.has(measure)) return err(problem("measure", `compositions[${index}].measure.id`, `Two compositions give the measure "${measure}".`));
    byMeasure.set(measure, index);
  }
  const prepared = new Map<number, Prepared>();
  const limits: LimitSetup[] = [];
  for (const [index, limit] of model.limits.entries()) {
    const path = `limits[${index}]`;
    const amount = limitAmount(limit, model.instance);
    if (amount.tag === "err") return err(under(amount.error, amount.error.path.startsWith("resources.") ? "instance" : path));
    const at = byMeasure.get(limit.measure);
    if (at === undefined) {
      return err(problem("measure", `${path}.measure`, `The model has no composition of the measure "${limit.measure}" of the limit "${limit.id}".`));
    }
    const composition = model.compositions[at] as Composition;
    let ready = prepared.get(at);
    if (ready === undefined) {
      const found = preparedOf(composition, model.catalog, level);
      if (found.tag === "err") return err(inComposition(found.error, at));
      ready = found.value;
      prepared.set(at, ready);
    }
    const unit = composition.measure.unit;
    const ceiling = amount.value;
    if (!convertible(unit, ceiling.unit)) {
      const why = whyNotConvertible(unit, ceiling.unit) ?? "the units are different";
      const message = `The composition of the limit "${limit.id}" gives "${unit}", and the ceiling of the limit is in "${ceiling.unit}": ${why}.`;
      return err(problem("unit", `compositions[${at}].measure.unit`, message));
    }
    limits.push({ limit, path, at, prepared: ready, per: factorOf(unit, ceiling.unit) / ceiling.value });
  }
  const rows = Math.min(...limits.map((each) => each.prepared.rows));
  return ok({ limits, rows, level, given: options.given ?? {}, whole, most, steps: options.steps ?? SCALE_STEPS, demand });
};

/** This function gives the flat parts of the composition of a limit at one load of a path, or undefined when the load has none. */
const partsAt = (setup: Setup, each: LimitSetup, demandAt: DemandAt, load: number): readonly FlatPart[] | undefined => {
  const demand = demandAt(load);
  if (demand === undefined) return undefined;
  const parts = flatPartsOf(each.prepared, demand, setup.given);
  return parts.tag === "ok" ? parts.value : undefined;
};

/**
 * This function searches each limit along a path of demands. For each row of each limit, it gives the first load
 * where the use of the limit is above 1. A load where the composition has no value also breaks the row.
 * Infinity tells that the row holds the limit on all of the grid.
 *
 * A problem of the composition at the start of the search is a problem of the model, and not an edge.
 */
const breaksOf = (setup: Setup, grid: readonly number[], demandAt: DemandAt): Result<readonly LimitBreaks[], ScaleProblem> => {
  const found: LimitBreaks[] = [];
  const start = grid[0] as number;
  for (const each of setup.limits) {
    const demand = demandAt(start);
    if (demand !== undefined) {
      const first = flatPartsOf(each.prepared, demand, setup.given);
      if (first.tag === "err") return err(inComposition(first.error, each.at));
    }
    // The loads of the grid repeat in each row. Thus the parts of a load are kept for the next row.
    const known = new Map<number, readonly FlatPart[] | undefined>();
    const cached = (load: number): readonly FlatPart[] | undefined => {
      if (!known.has(load)) known.set(load, partsAt(setup, each, demandAt, load));
      return known.get(load);
    };
    // Each row reads each load of the grid. Thus the values of all the rows at a load of the grid come from one call.
    // The loads of a bisection differ for each row, so they give the value of one row.
    const onGrid = new Set(grid);
    const gridRows = new Map<number, readonly (number | undefined)[] | undefined>();
    const valueAt = (load: number, row: number): number | undefined => {
      if (onGrid.has(load)) {
        if (!gridRows.has(load)) {
          const parts = cached(load);
          gridRows.set(load, parts === undefined ? undefined : rowValuesOf(parts, 0, setup.rows));
        }
        return gridRows.get(load)?.[row];
      }
      const parts = cached(load);
      return parts === undefined ? undefined : rowValueOf(parts, row);
    };
    const rows: number[] = [];
    let edge = false;
    for (let row = 0; row <= setup.rows; row += 1) {
      const curve: Curve = (loads) =>
        loads.map((load) => {
          const value = valueAt(load, row);
          return value === undefined ? undefined : each.per * value;
        });
      const result = rowOf(curve, `${each.path}.rows[${row}]`, amountTest(1), grid, 0, "composition");
      if (result.tag === "err") return result;
      const crossing = result.value.crossing ?? Infinity;
      if (row === 0) edge = result.value.edge <= crossing && Number.isFinite(result.value.edge);
      rows.push(Math.min(crossing, result.value.edge));
    }
    found.push({ rows, edge });
  }
  return ok(found);
};

/** This function gives the index of the least finite value, the first on a tie, or null when no value is finite. */
const leastOf = (values: readonly number[]): number | null => {
  let best: number | null = null;
  for (const [index, value] of values.entries()) {
    if (Number.isFinite(value) && (best === null || value < (values[best] as number))) best = index;
  }
  return best;
};

/** This function joins the rows of the limits. Each row breaks at the first load where one of its limits breaks. */
const summaryOf = (breaks: readonly LimitBreaks[], rows: number): Summary => {
  const joined: number[] = [];
  const counts = new Array<number>(breaks.length).fill(0);
  for (let row = 0; row <= rows; row += 1) {
    const loads = breaks.map((each) => each.rows[row] as number);
    const first = leastOf(loads);
    joined.push(first === null ? Infinity : (loads[first] as number));
    if (row > 0 && first !== null) counts[first] = (counts[first] as number) + 1;
  }
  const estimate = breaks.map((each) => each.rows[0] as number);
  const order = estimate.map((_, index) => index).sort((a, b) => (estimate[a] as number) - (estimate[b] as number) || a - b);
  return { rows: joined, binding: leastOf(estimate), binds: counts.map((count) => count / rows), order };
};

/** This function tells if a law of the composition of a limit reads a variable outside its range at one load of a path. */
const outsideAt = (setup: Setup, each: LimitSetup, demandAt: DemandAt, load: number): boolean => {
  const parts = partsAt(setup, each, demandAt, load);
  return parts !== undefined && partsOutside(parts);
};

/** This function tells if a law of the composition of a limit reads a variable outside its range at one load. */
type OutsideAt = (each: LimitSetup, load: number) => boolean;

/** This function gives the reach of a count of instances from the breaks of each limit along the factor of the demand. */
const reachFrom = (setup: Setup, count: number, breaks: readonly LimitBreaks[], outside: OutsideAt): CountReach => {
  const { most, level } = setup;
  const summary = summaryOf(breaks, setup.rows);
  const at = (value: number | null): number => value ?? most;
  const limits = summary.order.map((index): LimitReach => {
    const each = setup.limits[index] as LimitSetup;
    const found = breaks[index] as LimitBreaks;
    const factor = openValueOf(found.rows, level, most);
    return {
      limit: each.limit.id,
      measure: each.limit.measure,
      factor,
      binds: summary.binds[index] as number,
      edge: found.edge,
      extrapolated: outside(each, at(factor.value)),
    };
  });
  const factor = openValueOf(summary.rows, level, most);
  return {
    count,
    level,
    search: { low: 1 / most, high: most },
    factor,
    binding: summary.binding === null ? null : (setup.limits[summary.binding] as LimitSetup).limit.id,
    extrapolated: setup.limits.some((each) => outside(each, at(factor.value))),
    limits,
  };
};

/** This function gives the reach of a count of instances, from a correct setup. */
const reachOf = (setup: Setup, count: number): Result<CountReach, ScaleProblem> => {
  const { most, whole } = setup;
  const grid = searchGrid(1 / most, most, setup.steps, true, "The factor of the demand");
  if (grid.tag === "err") return grid;
  const demandAt: DemandAt = (factor) => {
    const portion = portionOf(setup.demand, factor / count, factor, whole);
    return portion.tag === "ok" ? portion.value : undefined;
  };
  const breaks = breaksOf(setup, grid.value, demandAt);
  if (breaks.tag === "err") return breaks;
  return ok(reachFrom(setup, count, breaks.value, (each, factor) => outsideAt(setup, each, demandAt, factor)));
};

/**
 * This function gives the highest load that a count of instances holds, as a factor of the demand,
 * with an interval. Thus it is the inverse query of the scale rule. The demand divides between the
 * instances, as in `shareOf`, and the levels in `options.whole` do not divide.
 *
 * Each row of the doubt of the laws has its own search. Row `i` of each limit reads row `i` of each
 * law, thus the rows of the limits pair. The factor of a row is the first factor where one limit
 * of the row breaks, or where a composition has no value. The interval is the share `level` of the
 * factors of the replicates, made wider to hold the factor of the estimate.
 *
 * The search tests a grid of factors, then a bisection finds each crossing. A crossing between two
 * loads of the grid is found. Two crossings in one step of the grid can hide the first.
 *
 * The function gives a problem for a model, a demand or options that are not correct. It gives a
 * problem for a count that is not a whole number of 1 or more. It also gives a problem when a
 * composition has no value at the start of the search.
 */
export const countReach = (model: ScaleModel, count: number, demand: Demand, options: ScaleOptions = {}): Result<CountReach, ScaleProblem> => {
  const setup = setupOf(model, demand, options);
  if (setup.tag === "err") return setup;
  if (!Number.isSafeInteger(count) || count < 1) {
    return err(problem("factor", "count", `The count of instances ${count} is not a whole number of 1 or more.`));
  }
  return reachOf(setup.value, count);
};

/** This function gives the lowest count of instances for a share of one instance where a limit breaks. A null count is more than `most`. */
const countAt = (share: number | null, most: number): number | null => {
  if (share === null) return 1;
  const count = Math.floor(1 / share) + 1;
  return count > most ? null : count;
};

/** This function changes an open value of the share of one instance to an open value of the count. The ends change places. */
const countsOf = (share: OpenValue, most: number): OpenValue => ({
  value: countAt(share.value, most),
  interval: { low: countAt(share.interval.high, most), high: countAt(share.interval.low, most) },
});

/**
 * This function gives the scale rule of a service at a load: the lowest count of instances that
 * holds each limit, with an interval. It also gives the limit that binds first, and the load of the
 * next step: the highest load of that count, from `countReach`.
 *
 * The search goes along the share of the demand on one instance: the share of `n` instances is
 * `1 / n`. It starts at the share of `most` instances and goes up to the share of one instance. The
 * count of a row comes from the first share where one limit of the row breaks. Thus the count holds
 * each limit, and each larger count also holds each limit. A level in `options.whole` does not divide.
 *
 * Each row of the doubt of the laws has its own search, and the rows of the limits pair, as in
 * `countReach`. The interval of the count is the share `level` of the counts of the replicates, made
 * wider to hold the count of the estimate. The field `binds` of each limit is the share of the
 * replicates where that limit sets the count.
 *
 * The function gives each problem of `countReach` that is not about a count.
 */
export const scaleRule = (model: ScaleModel, demand: Demand, options: ScaleOptions = {}): Result<ScaleRule, ScaleProblem> => {
  const setup = setupOf(model, demand, options);
  if (setup.tag === "err") return setup;
  const { most, whole } = setup.value;
  const grid = searchGrid(1 / most, 1, setup.value.steps, true, "The share of one instance");
  if (grid.tag === "err") return grid;
  const demandAt: DemandAt = (share) => {
    const portion = portionOf(setup.value.demand, share, 1, whole);
    return portion.tag === "ok" ? portion.value : undefined;
  };
  const breaks = breaksOf(setup.value, grid.value, demandAt);
  if (breaks.tag === "err") return breaks;
  return ruleFrom(
    setup.value,
    breaks.value,
    (each, share) => outsideAt(setup.value, each, demandAt, share),
    (count) => reachOf(setup.value, count),
  );
};

/** This function gives the scale rule from the breaks of each limit along the share of one instance, and the reach of a count. */
const ruleFrom = (
  setup: Setup,
  breaks: readonly LimitBreaks[],
  outside: OutsideAt,
  reachAt: (count: number) => Result<CountReach, ScaleProblem>,
): Result<ScaleRule, ScaleProblem> => {
  const { most, level } = setup;
  const summary = summaryOf(breaks, setup.rows);
  const shareOfCount = (count: number | null): number => 1 / (count ?? most);
  const limits = summary.order.map((index): LimitCount => {
    const each = setup.limits[index] as LimitSetup;
    const found = breaks[index] as LimitBreaks;
    const count = countsOf(openValueOf(found.rows, level, 1), most);
    return {
      limit: each.limit.id,
      measure: each.limit.measure,
      count,
      binds: summary.binds[index] as number,
      edge: found.edge,
      extrapolated: outside(each, shareOfCount(count.value)),
    };
  });
  const count = countsOf(openValueOf(summary.rows, level, 1), most);
  let next: CountReach | null = null;
  if (count.value !== null) {
    const reach = reachAt(count.value);
    if (reach.tag === "err") return reach;
    next = reach.value;
  }
  return ok({
    level,
    most,
    count,
    binding: summary.binding === null ? null : (setup.limits[summary.binding] as LimitSetup).limit.id,
    extrapolated: setup.limits.some((each) => outside(each, shareOfCount(count.value))),
    limits,
    next,
  });
};

/** A limit ladder holds, for each row of one limit, the first load on one instance where the row breaks the limit. */
export interface LimitLadder {
  readonly limit: string;
  readonly measure: string;
  /**
   * Each value is the first load on one instance, as a factor of the demand, where one row breaks the limit. Row 0 is the
   * estimate. A load where the composition has no value also breaks the row. Infinity tells that the row holds on all of the search.
   */
  readonly rows: readonly number[];
  /** This flag tells that the edge of the composition sets the load of row 0. */
  readonly edge: boolean;
}

/**
 * A scale ladder is the scale rule of a service at each load of a range, from one search. With no level in `whole`, the
 * demand on one of `n` instances at `f` times the load is the demand at `f / n` times the load. Thus each row of each
 * limit breaks at one load on one instance, and a count needs only arithmetic.
 *
 * The function `ruleAt(f)` gives the value of `scaleRule` at the demand `scaleDemand(demand, f)`. The function
 * `reachAt(n, f)` gives the value of `countReach` for `n` instances at the same demand. Each of them reads the
 * compositions only for the flags `extrapolated`, one value for each limit.
 */
export interface ScaleLadder {
  readonly level: number;
  readonly most: number;
  /** This range holds the factors of the demand that the ladder answers. */
  readonly range: Range;
  /** This range holds the loads on one instance of the search, as factors of the demand. */
  readonly search: Range;
  /** The limits are in the order of the model. */
  readonly limits: readonly LimitLadder[];
  readonly ruleAt: (factor: number) => Result<ScaleRule, ScaleProblem>;
  readonly reachAt: (count: number, factor: number) => Result<CountReach, ScaleProblem>;
}

/**
 * This function changes the loads on one instance of a ladder to the loads of a search from `low` to `high`. A load
 * past `high` holds on all of that search, and a load before `low` breaks at its start, as in `rowOf`.
 */
const loadsIn = (rows: readonly number[], times: number, low: number, high: number): number[] =>
  rows.map((load) => {
    const found = load * times;
    return found > high ? Infinity : Math.max(found, low);
  });

/**
 * This function gives the scale ladder of a service over the factors of the demand from `range.low` to `range.high`.
 * The search covers the loads on one instance that `scaleRule` and `countReach` read at each factor of the range: from
 * `range.low / most` to `range.high * most`. Its grid has the density of the grid of `scaleRule`, up to the largest
 * count of steps.
 *
 * The values of the ladder agree with `scaleRule` and `countReach` to the precision of their bisections. They can differ
 * when two crossings are in one step of a grid, because the grids are different.
 *
 * The function gives each problem of `scaleRule`. It also gives a problem for a level in `options.whole`. With such a level,
 * the demand on one instance does not depend only on the load over the count. It gives a problem for a range that does not
 * go from a number above 0 to a larger finite number.
 */
export const scaleLadder = (model: ScaleModel, demand: Demand, range: Range, options: ScaleOptions = {}): Result<ScaleLadder, ScaleProblem> => {
  const found = setupOf(model, demand, options);
  if (found.tag === "err") return found;
  const setup = found.value;
  if (setup.whole.length > 0) {
    return err(problem("variable", "whole", "A ladder needs a demand that divides between the instances. Use scaleRule for a level in whole."));
  }
  if (!(range.low > 0 && Number.isFinite(range.high) && range.low < range.high)) {
    return err(problem("factor", "range", `The range goes from ${range.low} to ${range.high}. It must go from a number above 0 to a larger finite number.`));
  }
  const { most, level } = setup;
  const search: Range = { low: range.low / most, high: range.high * most };
  // The grid of scaleRule has `steps` steps over the factor `most`. This grid keeps that count of steps for each factor.
  const steps = Math.min(MAX_STEPS, Math.max(setup.steps, Math.ceil((setup.steps * Math.log(search.high / search.low)) / Math.log(most))));
  const grid = searchGrid(search.low, search.high, steps, true, "The load on one instance");
  if (grid.tag === "err") return grid;
  const demandAt: DemandAt = (load) => {
    const portion = portionOf(setup.demand, load, load, []);
    return portion.tag === "ok" ? portion.value : undefined;
  };
  const breaks = breaksOf(setup, grid.value, demandAt);
  if (breaks.tag === "err") return breaks;
  const ladder = breaks.value;
  const outsideOn = (each: LimitSetup, load: number): boolean => outsideAt(setup, each, demandAt, load);
  const inRange = (factor: number): Result<number, ScaleProblem> =>
    factor >= range.low && factor <= range.high
      ? ok(factor)
      : err(problem("factor", "factor", `The factor ${factor} is outside the range of the ladder, from ${range.low} to ${range.high}.`));
  /** This function gives the breaks of each limit along the factor of a search from `low` to `high`. The load on one instance is `times` the factor. */
  const breaksIn = (times: number, low: number, high: number): LimitBreaks[] =>
    ladder.map((each) => {
      const rows = loadsIn(each.rows, 1 / times, low, high);
      return { rows, edge: each.edge && Number.isFinite(rows[0] as number) };
    });
  const reachIn = (count: number, factor: number): CountReach =>
    reachFrom(setup, count, breaksIn(factor / count, 1 / most, most), (each, at) => outsideOn(each, (factor * at) / count));
  const reachAt = (count: number, factor: number): Result<CountReach, ScaleProblem> => {
    if (!Number.isSafeInteger(count) || count < 1) {
      return err(problem("factor", "count", `The count of instances ${count} is not a whole number of 1 or more.`));
    }
    const at = inRange(factor);
    return at.tag === "err" ? at : ok(reachIn(count, factor));
  };
  const ruleAt = (factor: number): Result<ScaleRule, ScaleProblem> => {
    const at = inRange(factor);
    if (at.tag === "err") return at;
    return ruleFrom(
      setup,
      breaksIn(factor, 1 / most, 1),
      (each, share) => outsideOn(each, factor * share),
      (count) => ok(reachIn(count, factor)),
    );
  };
  const limits = setup.limits.map((each, index): LimitLadder => ({ limit: each.limit.id, measure: each.limit.measure, ...(ladder[index] as LimitBreaks) }));
  return ok({ level, most, range, search, limits, ruleAt, reachAt });
};
