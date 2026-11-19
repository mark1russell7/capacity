import { err, ok, type Result } from "@mark1russell7/optional";
import type { Expr } from "@mark1russell7/vex";
import { DEFAULT_LEVEL, type Law, type LawProblem } from "./law.ts";
import { recordOf, valuesAt } from "./program.ts";
import { intervalOf, levelProblem, type LevelOptions, type LoadPoint, type Range } from "./value.ts";

/** This number is the count of steps of the grid of a knee search when the options give none. */
export const KNEE_STEPS = 64;

/** This number is the largest count of steps of the grid of a knee search. It sets a limit on the work of one search. */
const MAX_STEPS = 4096;

/**
 * A knee rule tells where a law leaves its cheap region.
 *
 * - `rise`: the value is more than `1 + share` times the value at the start of the search.
 * - `slope`: the slope is more than `factor` times the slope at the start of the search.
 */
export type KneeRule = { readonly kind: "rise"; readonly share: number } | { readonly kind: "slope"; readonly factor: number };

/**
 * These options set a knee search. The search goes along one variable, from `from` to `to`, on a
 * grid of `steps` steps. The point `at` gives the value of each other variable of the law.
 *
 * The search goes from the minimum to the maximum of the variable, on 64 steps, when the options
 * give no value. The level of the intervals is 0.95 when the options give none.
 */
export interface KneeOptions extends LevelOptions {
  readonly at?: LoadPoint;
  readonly from?: number;
  readonly to?: number;
  readonly steps?: number;
}

/** An open range goes from `low` to `high`. A null end is past the end of the search. */
export interface OpenRange {
  readonly low: number | null;
  readonly high: number | null;
}

/**
 * A crossing is a load on the variable of a search, with the interval of its replicates. A null
 * value tells that the crossing is not in the search. The flag `outside` tells that the value is
 * outside the range of the variable. Then the value is an extrapolation.
 */
export interface Crossing {
  readonly value: number | null;
  readonly interval: OpenRange;
  readonly outside: boolean;
}

/**
 * A knee is the result of a knee search along one variable of a law, in the unit of the variable.
 *
 * The `knee` is the first load where the law obeys the rule: there the law leaves its cheap region.
 * The `edge` is the first load where the law has no finite value. This is a pole, where the value
 * grows with no limit, or the start of a region with no value. The knee is always before the edge.
 * The list `outside` names each other variable whose value is outside its range.
 */
export interface Knee {
  readonly variable: string;
  readonly unit: string;
  readonly rule: KneeRule;
  readonly level: number;
  readonly search: Range;
  readonly knee: Crossing;
  readonly edge: Crossing;
  readonly outside: readonly string[];
}

/** A curve gives the value of one row of a law at each load of the variable. A load with no finite value gives undefined. */
type Curve = (loads: readonly number[]) => readonly (number | undefined)[];

/** This number sets the farthest distance from a peak where the pole test reads the size of the law. It is a share of the width of the bracket. */
const NEAR = 1e-6;

/** Each distance of the pole test is this share of the distance before it. */
const CLOSER = 1e-3;

/** At a pole, the gain of size in the second step nearer is at least this share of the gain in the first step. */
const POLE_GAIN = 0.9;

/** A gain of size less than this share of the size is the noise of the floats, not a pole. */
const NOISE = 1e-9;

/** The step of a difference quotient, for each unit of the load. */
const STEP = 1e-7;

/** The most rounds of a bisection or of a golden-section search. Each search stops before, when its bracket has no middle. */
const ROUNDS = 400;

const INVERSE_PHI = (Math.sqrt(5) - 1) / 2;

const problem = (code: LawProblem["code"], path: string, message: string): LawProblem => ({ code, path, message });

/** This function gives the value of a curve at one load. */
const valueOf = (curve: Curve, load: number): number | undefined => curve([load])[0];

/**
 * This function gives the load where a test changes from false to true, with a bisection. The test
 * is false at `low` and true at `high`. The function gives the end of the last bracket where the test is true.
 */
const crossingOf = (test: (load: number) => boolean, low: number, high: number): number => {
  let [a, b] = [low, high];
  for (let round = 0; round < ROUNDS; round += 1) {
    const middle = a + (b - a) / 2;
    if (middle <= a || middle >= b) break;
    if (test(middle)) b = middle;
    else a = middle;
  }
  return b;
};

/** This function gives the load of the largest size in a bracket, with a golden-section search. */
const peakOf = (size: (load: number) => number, low: number, high: number): number => {
  let [a, b] = [low, high];
  let c = b - INVERSE_PHI * (b - a);
  let d = a + INVERSE_PHI * (b - a);
  let [sizeC, sizeD] = [size(c), size(d)];
  for (let round = 0; round < ROUNDS && a < c && c < d && d < b; round += 1) {
    if (sizeC >= sizeD) {
      [b, d, sizeD] = [d, c, sizeC];
      c = b - INVERSE_PHI * (b - a);
      sizeC = size(c);
    } else {
      [a, c, sizeC] = [c, d, sizeD];
      d = a + INVERSE_PHI * (b - a);
      sizeD = size(d);
    }
  }
  return sizeC >= sizeD ? c : d;
};

/**
 * This function tells if the size of a law grows with no bound near the top of a peak. It reads the
 * size at three distances from the top, each 1000 times nearer than the distance before it.
 *
 * At a pole, each step nearer adds as much size as the step before, or more. A power pole adds more,
 * and a logarithm pole adds the same. Near a finite peak, the second step adds about a millionth of
 * the first. A load with no value at one of the distances is an edge near the top.
 */
const diverges = (size: (load: number) => number, top: number, near: number): boolean => {
  const sizeAt = (distance: number): number => Math.max(size(top - distance), size(top + distance));
  const [far, middle, close] = [near, near * CLOSER, near * CLOSER * CLOSER].map(sizeAt) as [number, number, number];
  if (!Number.isFinite(close) || !Number.isFinite(middle) || !Number.isFinite(far)) return true;
  const first = middle - far;
  return first > NOISE * middle && close - middle >= POLE_GAIN * first;
};

/**
 * This function gives the edge of one row of a law: the first load of the grid where the law has
 * no finite value. It gives Infinity when the law has a finite value on all of the grid.
 *
 * The size of a law at a load is the distance of its value from the start value. A load with no
 * value has an infinite size. The search examines each peak of the size on the grid, in order. A
 * golden-section search finds the top of the peak, and the pole test examines it. A peak with no
 * value at its top starts a region with no value.
 */
const edgeOf = (curve: Curve, grid: readonly number[], values: readonly (number | undefined)[], start: number): number => {
  const sizeOf = (value: number | undefined): number => (value === undefined ? Infinity : Math.abs(value - start));
  const size = (load: number): number => sizeOf(valueOf(curve, load));
  const noValue = (load: number): boolean => valueOf(curve, load) === undefined;
  const sizes = values.map(sizeOf);
  const last = grid.length - 1;
  for (let index = 1; index <= last; index += 1) {
    const here = sizes[index] as number;
    const missing = values[index] === undefined;
    const peak = here > (sizes[index - 1] as number) && (index === last || missing || here >= (sizes[index + 1] as number));
    if (!peak) continue;
    const low = grid[index - 1] as number;
    const high = grid[missing ? index : Math.min(index + 1, last)] as number;
    const top = peakOf(size, low, high);
    if (noValue(top)) return crossingOf(noValue, low, top);
    if (diverges(size, top, NEAR * (high - low))) return top;
    if (missing) return crossingOf(noValue, low, grid[index] as number);
  }
  return Infinity;
};

/** This function gives the step of a difference quotient at a load. The unit is the width of the search on a linear scale, and 0 on a log scale. */
const stepAt = (load: number, unit: number): number => STEP * Math.max(Math.abs(load), unit);

/**
 * This function gives the knee of one row of a law: the first load before the edge where the law
 * obeys the rule. It gives Infinity when the law does not obey the rule before the edge or the end of the grid.
 *
 * The search tests the loads of the grid before the edge, and one load near the edge. A bisection
 * then finds the load between the last load that fails the test and the first load that passes it.
 */
const kneeOf = (
  holds: (load: number, value?: number) => boolean,
  grid: readonly number[],
  values: readonly (number | undefined)[],
  edge: number,
): number => {
  const loads = grid.map((load, index) => ({ load, value: values[index] })).filter(({ load }) => load < edge);
  if (Number.isFinite(edge)) {
    const before = loads.at(-1)?.load ?? (grid[0] as number);
    loads.push({ load: edge - NEAR * (edge - before), value: undefined });
  }
  let previous: number | undefined;
  for (const { load, value } of loads) {
    if (holds(load, value)) return previous === undefined ? load : crossingOf((x) => holds(x), previous, load);
    previous = load;
  }
  return Infinity;
};

/** The knee and the edge of one row of a law, or the problem of the row. */
interface RowResult {
  readonly knee: number;
  readonly edge: number;
}

const rowOf = (
  curve: Curve,
  path: string,
  rule: KneeRule,
  grid: readonly number[],
  unit: number,
): Result<RowResult, LawProblem> => {
  const values = curve(grid);
  const start = values[0];
  const from = grid[0] as number;
  if (start === undefined) return err(problem("value", path, `The law has no value at the start of the search, ${from}.`));
  const slopeAt = (load: number, value: number | undefined = valueOf(curve, load)): number | undefined => {
    const step = stepAt(load, unit);
    const before = valueOf(curve, load - step);
    return value === undefined || before === undefined ? undefined : (value - before) / step;
  };
  let holds: (load: number, value?: number) => boolean;
  if (rule.kind === "rise") {
    if (!(start > 0)) {
      return err(problem("knee", path, `The rule "rise" needs a value above 0 at the start of the search. The value is ${start}.`));
    }
    const limit = (1 + rule.share) * start;
    holds = (load, value = valueOf(curve, load)) => value !== undefined && value > limit;
  } else {
    const step = stepAt(from, unit);
    const after = valueOf(curve, from + step);
    const first = after === undefined ? undefined : (after - start) / step;
    if (first === undefined || !(first > 0)) {
      return err(problem("knee", path, `The rule "slope" needs a slope above 0 at the start of the search. The slope is ${String(first)}.`));
    }
    const limit = rule.factor * first;
    holds = (load, value) => {
      const slope = slopeAt(load, value ?? valueOf(curve, load));
      return slope !== undefined && slope > limit;
    };
  }
  const edge = edgeOf(curve, grid, values, start);
  return ok({ knee: kneeOf(holds, grid, values, edge), edge });
};

/** This function gives the problem of a knee rule, or undefined. */
const ruleProblem = (rule: KneeRule): LawProblem | undefined => {
  if (rule.kind === "rise" && !(Number.isFinite(rule.share) && rule.share > 0)) {
    return problem("knee", "rule.share", `The share of the rule "rise" is ${rule.share}. It must be a finite number above 0.`);
  }
  if (rule.kind === "slope" && !(Number.isFinite(rule.factor) && rule.factor > 1)) {
    return problem("knee", "rule.factor", `The factor of the rule "slope" is ${rule.factor}. It must be a finite number above 1.`);
  }
  return undefined;
};

/**
 * This function gives the crossing of the values of the rows. The first value is the value of the
 * estimate. An infinite value is past the end of the search.
 */
const crossingFrom = (values: readonly number[], level: number, range: Range, end: number): Crossing => {
  // The quantiles interpolate. A large finite number keeps each interpolation finite, and each end past the search becomes null.
  const [value, ...spread] = values.map((entry) => (Number.isFinite(entry) ? entry : Number.MAX_VALUE));
  const interval = intervalOf(value as number, spread, level);
  const open = (entry: number): number | null => (entry > end ? null : entry);
  const found = open(value as number);
  return {
    value: found,
    interval: { low: open(interval.low), high: open(interval.high) },
    outside: found !== null && (found < range.low || found > range.high),
  };
};

/**
 * This function gives the knee of a law along one variable, with an interval. It also gives the
 * edge: the first load where the law has no finite value.
 *
 * The point `at` of the options gives each other variable of the law. The function evaluates the
 * law with its constants, then with each replicate. The interval of the knee and of the edge is the
 * share `level` of the values of the replicates, made wider to hold the value.
 *
 * The search tests a grid of loads, then a bisection finds each crossing. A crossing between two
 * loads of the grid is found. Two edges in one step of the grid can hide the first edge.
 *
 * The function gives a problem for a variable or a point that the law cannot read. A bad search
 * range, rule or count of steps, and a level that the law cannot show, also give a problem. The last
 * problems are a law with no value at the start of the search, and a rule that cannot apply there.
 */
export const lawKnee = (law: Law, variable: string, rule: KneeRule, options: KneeOptions = {}): Result<Knee, LawProblem> => {
  const level = options.level ?? DEFAULT_LEVEL;
  const noLevel = levelProblem(law, level, false);
  if (noLevel !== undefined) return err(noLevel);
  const target = law.variables.find((entry) => entry.id === variable);
  if (target === undefined) return err(problem("point", "variable", `The law has no variable "${variable}".`));
  const badRule = ruleProblem(rule);
  if (badRule !== undefined) return err(badRule);

  const at = options.at ?? {};
  for (const name of Object.keys(at)) {
    if (name === variable) return err(problem("point", `at.${name}`, `The point "at" gives "${name}", the variable of the search.`));
    if (!law.variables.some((entry) => entry.id === name)) return err(problem("point", `at.${name}`, `The law has no variable "${name}".`));
  }
  const base: Record<string, number> = {};
  for (const other of law.variables) {
    if (other.id === variable) continue;
    const value = at[other.id];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return err(problem("point", `at.${other.id}`, `The point "at" gives no finite value for the variable "${other.id}".`));
    }
    base[other.id] = value;
  }

  const from = options.from ?? target.min;
  const to = options.to ?? target.max;
  if (!(Number.isFinite(from) && Number.isFinite(to) && from < to)) {
    return err(problem("range", "from", `The search goes from ${from} to ${to}. It must go from a finite number to a larger finite number.`));
  }
  const log = target.scale === "log";
  if (log && !(from > 0)) {
    return err(problem("range", "from", `The variable "${variable}" has the scale "log", thus the search starts above 0.`));
  }
  const steps = options.steps ?? KNEE_STEPS;
  if (!(Number.isInteger(steps) && steps >= 2 && steps <= MAX_STEPS)) {
    return err(problem("knee", "steps", `The search has ${steps} steps. It must have a whole number of steps from 2 to ${MAX_STEPS}.`));
  }

  const grid = Array.from({ length: steps + 1 }, (_, index) =>
    index === steps ? to : log ? from * (to / from) ** (index / steps) : from + ((to - from) * index) / steps,
  );
  const unit = log ? 0 : to - from;
  const names = law.constants.map((constant) => constant.id);
  const program: Expr = law.form.program;
  const rows = [
    { path: "constants", values: law.constants.map((constant) => constant.value) },
    ...law.replicates.map((row, index) => ({ path: `replicates[${index}]`, values: row })),
  ];
  const knees: number[] = [];
  const edges: number[] = [];
  for (const row of rows) {
    const curve: Curve = (loads) => valuesAt(program, loads.map((load) => recordOf(names, row.values, { ...base, [variable]: load })));
    const result = rowOf(curve, row.path, rule, grid, unit);
    if (result.tag === "err") return result;
    knees.push(result.value.knee);
    edges.push(result.value.edge);
  }

  const range: Range = { low: target.min, high: target.max };
  const outside = law.variables
    .filter((entry) => entry.id !== variable && ((base[entry.id] as number) < entry.min || (base[entry.id] as number) > entry.max))
    .map((entry) => entry.id);
  return ok({
    variable,
    unit: target.unit,
    rule,
    level,
    search: { low: from, high: to },
    knee: crossingFrom(knees, level, range, to),
    edge: crossingFrom(edges, level, range, to),
    outside,
  });
};
