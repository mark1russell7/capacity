import { err, ok, type Result } from "@mark1russell7/optional";
import { convertible, isQuantity, type Quantity, valueIn, whyNotConvertible } from "@mark1russell7/quantity";
import type { Expr } from "@mark1russell7/vex";
import { DEFAULT_LEVEL, leastCount, type Law, type LawProblem, type Variable } from "./law.ts";
import { recordOf, valuesAt } from "./program.ts";
import { intervalOf, levelProblem, type LevelOptions, type LoadPoint, type Range } from "./value.ts";

/** This number is the count of steps of the grid of a knee search when the options give none. */
export const KNEE_STEPS = 64;

/** This number is the largest count of steps of the grid of a knee search. It sets a limit on the work of one search. */
export const MAX_STEPS = 4096;

/**
 * A knee rule tells where a law leaves its cheap region.
 *
 * - `rise`: the value is more than `1 + share` times the value at the start of the search.
 * - `slope`: the slope is more than `factor` times the slope at the start of the search.
 * - `floor`: the value is more than `1 + share` times the floor of the row. The floor of a row is its
 *   least value on the grid of the search, before its edge. The search of a row starts at its floor.
 */
export type KneeRule =
  | { readonly kind: "rise"; readonly share: number }
  | { readonly kind: "slope"; readonly factor: number }
  | { readonly kind: "floor"; readonly share: number };

/** The floor of a law is its least value with its constants on the grid of a search, and the load of that value. */
export interface Floor {
  readonly load: number;
  readonly value: number;
}

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
 * The list `outside` names each other variable whose value is outside its range. Only a knee of the
 * rule `floor` has the fields `floor` and `noFloor`.
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
  /** This floor is the floor of the law with its constants. */
  readonly floor?: Floor;
  /** This number is the count of replicates with no floor above 0. The rule cannot apply to them, thus the interval of the knee leaves them out. */
  readonly noFloor?: number;
}

/** A curve gives the value of one row of a law or of a composition at each load. A load with no finite value gives undefined. */
export type Curve = (loads: readonly number[]) => readonly (number | undefined)[];

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
 * A test tells if the law passes a mark at one load. The value at the load is optional: without
 * it, the test reads the curve. A load with no finite value does not pass.
 */
export type Test = (load: number, value?: number) => boolean;

/**
 * The context of the test of one row: its curve, its start value, its path, its start load and its
 * step unit. It also has the grid, the values of the row on the grid and the edge of the row.
 */
export interface TestContext {
  readonly curve: Curve;
  readonly start: number;
  readonly path: string;
  readonly from: number;
  readonly unit: number;
  readonly grid: readonly number[];
  readonly values: readonly (number | undefined)[];
  readonly edge: number;
}

/**
 * A test maker gives the test of one row, or the problem that stops the test at the start of the
 * search. An undefined test tells that the rule cannot apply to the row. Then the row has no crossing.
 */
export type TestOf = (context: TestContext) => Result<Test | undefined, LawProblem>;

/**
 * This function gives the first load before the edge where the test holds. It gives Infinity when
 * the test does not hold before the edge or the end of the grid.
 *
 * The search tests the loads of the grid before the edge, and one load near the edge. A bisection
 * then finds the load between the last load that fails the test and the first load that passes it.
 */
const firstHolds = (holds: Test, grid: readonly number[], values: readonly (number | undefined)[], edge: number): number => {
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

/** The crossing and the edge of one row of a law. An undefined crossing tells that the rule cannot apply to the row. */
export interface RowResult {
  readonly crossing: number | undefined;
  readonly edge: number;
}

/** This function gives the first load where one row passes its test, and the edge of the row. The text `what` names the owner of the row in a problem. */
export const rowOf = (
  curve: Curve,
  path: string,
  testOf: TestOf,
  grid: readonly number[],
  unit: number,
  what = "law",
): Result<RowResult, LawProblem> => {
  const values = curve(grid);
  const start = values[0];
  const from = grid[0] as number;
  if (start === undefined) return err(problem("value", path, `The ${what} has no value at the start of the search, ${from}.`));
  const edge = edgeOf(curve, grid, values, start);
  const test = testOf({ curve, start, path, from, unit, grid, values, edge });
  if (test.tag === "err") return test;
  return ok({ crossing: test.value === undefined ? undefined : firstHolds(test.value, grid, values, edge), edge });
};

/** This function gives the test of a knee rule: the value or the slope is above its mark from the start of the search. */
const ruleTest =
  (rule: Exclude<KneeRule, { readonly kind: "floor" }>): TestOf =>
  ({ curve, start, path, from, unit }) => {
    if (rule.kind === "rise") {
      if (!(start > 0)) {
        return err(problem("knee", path, `The rule "rise" needs a value above 0 at the start of the search. The value is ${start}.`));
      }
      const limit = (1 + rule.share) * start;
      return ok((load, value = valueOf(curve, load)) => value !== undefined && value > limit);
    }
    const slopeAt = (load: number, value: number | undefined): number | undefined => {
      const step = stepAt(load, unit);
      const before = valueOf(curve, load - step);
      return value === undefined || before === undefined ? undefined : (value - before) / step;
    };
    const step = stepAt(from, unit);
    const after = valueOf(curve, from + step);
    const first = after === undefined ? undefined : (after - start) / step;
    if (first === undefined || !(first > 0)) {
      return err(problem("knee", path, `The rule "slope" needs a slope above 0 at the start of the search. The slope is ${String(first)}.`));
    }
    const limit = rule.factor * first;
    return ok((load, value) => {
      const slope = slopeAt(load, value ?? valueOf(curve, load));
      return slope !== undefined && slope > limit;
    });
  };

/** This function gives the test of an amount: the value is above the amount. */
export const amountTest =
  (amount: number): TestOf =>
  ({ curve }) =>
    ok((load, value = valueOf(curve, load)) => value !== undefined && value > amount);

/** These kinds name the knee rules. */
const KNEE_KINDS: readonly KneeRule["kind"][] = ["rise", "slope", "floor"];

/**
 * This function gives the problem of a knee rule, or undefined for a correct rule. The rule can come
 * from data, thus the function also examines its shape. The path of a problem starts with `path`.
 */
export const kneeRuleProblem = (rule: unknown, path = "rule"): LawProblem | undefined => {
  if (typeof rule !== "object" || rule === null || Array.isArray(rule)) return problem("knee", path, "The rule is not a record.");
  const { kind, share, factor } = rule as Readonly<Record<string, unknown>>;
  if (kind === "rise" || kind === "floor") {
    if (typeof share === "number" && Number.isFinite(share) && share > 0) return undefined;
    return problem("knee", `${path}.share`, `The share of the rule "${kind}" is ${String(share)}. It must be a finite number above 0.`);
  }
  if (kind === "slope") {
    if (typeof factor === "number" && Number.isFinite(factor) && factor > 1) return undefined;
    return problem("knee", `${path}.factor`, `The factor of the rule "slope" is ${String(factor)}. It must be a finite number above 1.`);
  }
  return problem("knee", `${path}.kind`, `The kind of the rule is ${JSON.stringify(kind) ?? "undefined"}. It must be one of ${KNEE_KINDS.join(", ")}.`);
};

/** An open value is a value of a search with the interval of its replicates. A null value or end is past the end of the search. */
export interface OpenValue {
  readonly value: number | null;
  readonly interval: OpenRange;
}

/**
 * This function gives the open value of the values of the rows. The first value is the value of the
 * estimate. A value past `end` is past the end of the search, and an infinite value is too.
 */
export const openValueOf = (values: readonly number[], level: number, end: number): OpenValue => {
  // The quantiles interpolate. A large finite number keeps each interpolation finite, and each end past the search becomes null.
  const [value, ...spread] = values.map((entry) => (Number.isFinite(entry) ? entry : Number.MAX_VALUE));
  const interval = intervalOf(value as number, spread, level);
  const open = (entry: number): number | null => (entry > end ? null : entry);
  return { value: open(value as number), interval: { low: open(interval.low), high: open(interval.high) } };
};

/** This function gives the crossing of the values of the rows. The flag `outside` tells that the value is outside `range`. */
const crossingFrom = (values: readonly number[], level: number, range: Range, end: number): Crossing => {
  const found = openValueOf(values, level, end);
  return { ...found, outside: found.value !== null && (found.value < range.low || found.value > range.high) };
};

/**
 * A search is the setup of a search along one variable of a law. It holds the target variable, the level,
 * the range and the grid, and the variables outside their range. The function `curveOf` gives the curve
 * of one row of constants.
 */
interface Search {
  readonly target: Variable;
  readonly level: number;
  readonly search: Range;
  readonly grid: readonly number[];
  readonly unit: number;
  readonly curveOf: (values: readonly number[]) => Curve;
  readonly outside: readonly string[];
}

/**
 * The result of a search along one variable of a law: the first load that passes the test, and the
 * edge. The count `skipped` tells the replicates where the rule cannot apply. The crossing leaves them out.
 */
interface Along {
  readonly crossing: Crossing;
  readonly edge: Crossing;
  readonly skipped: number;
}

/**
 * This function gives the grid of a search from `from` to `to` in `steps` steps, or its problem. A
 * grid on the scale `log` starts above 0. The text `owner` names the variable of the search in a problem.
 */
export const searchGrid = (from: number, to: number, steps: number, log: boolean, owner: string): Result<readonly number[], LawProblem> => {
  if (!(Number.isFinite(from) && Number.isFinite(to) && from < to)) {
    return err(problem("range", "from", `The search goes from ${from} to ${to}. It must go from a finite number to a larger finite number.`));
  }
  if (log && !(from > 0)) return err(problem("range", "from", `${owner} has the scale "log", thus the search starts above 0.`));
  if (!(Number.isInteger(steps) && steps >= 2 && steps <= MAX_STEPS)) {
    return err(problem("knee", "steps", `The search has ${steps} steps. It must have a whole number of steps from 2 to ${MAX_STEPS}.`));
  }
  return ok(
    Array.from({ length: steps + 1 }, (_, index) =>
      index === steps ? to : log ? from * (to / from) ** (index / steps) : from + ((to - from) * index) / steps,
    ),
  );
};

/**
 * This function gives the setup of a search along one variable of a law, or its problem. The function
 * `check` gives the problem of the test before the setup.
 */
const searchOf = (law: Law, variable: string, options: KneeOptions, check: () => LawProblem | undefined): Result<Search, LawProblem> => {
  const level = options.level ?? DEFAULT_LEVEL;
  const noLevel = levelProblem(law, level, false);
  if (noLevel !== undefined) return err(noLevel);
  const target = law.variables.find((entry) => entry.id === variable);
  if (target === undefined) return err(problem("point", "variable", `The law has no variable "${variable}".`));
  const badTest = check();
  if (badTest !== undefined) return err(badTest);

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
  const log = target.scale === "log";
  const grid = searchGrid(from, to, options.steps ?? KNEE_STEPS, log, `The variable "${variable}"`);
  if (grid.tag === "err") return grid;
  const names = law.constants.map((constant) => constant.id);
  const program: Expr = law.form.program;
  const curveOf =
    (values: readonly number[]): Curve =>
    (loads) =>
      valuesAt(program, loads.map((load) => recordOf(names, values, { ...base, [variable]: load })));
  const outside = law.variables
    .filter((entry) => entry.id !== variable && ((base[entry.id] as number) < entry.min || (base[entry.id] as number) > entry.max))
    .map((entry) => entry.id);
  return ok({ target, level, search: { low: from, high: to }, grid: grid.value, unit: log ? 0 : to - from, curveOf, outside });
};

/** This function searches a law for the first load that passes a test, in the constants and in each replicate. */
const along = (law: Law, setup: Search, testOf: TestOf): Result<Along, LawProblem> => {
  const rows = [
    { path: "constants", values: law.constants.map((constant) => constant.value) },
    ...law.replicates.map((row, index) => ({ path: `replicates[${index}]`, values: row })),
  ];
  const crossings: number[] = [];
  const edges: number[] = [];
  let skipped = 0;
  for (const row of rows) {
    const result = rowOf(setup.curveOf(row.values), row.path, testOf, setup.grid, setup.unit);
    if (result.tag === "err") return result;
    edges.push(result.value.edge);
    const { crossing } = result.value;
    if (crossing === undefined) {
      // The first crossing is the crossing of the estimate. Thus the rule must apply to the constants.
      if (row.path === "constants") return err(problem("knee", row.path, "The rule cannot apply to the constants of the law."));
      skipped += 1;
    } else {
      crossings.push(crossing);
    }
  }
  const range: Range = { low: setup.target.min, high: setup.target.max };
  return ok({
    crossing: crossingFrom(crossings, setup.level, range, setup.search.high),
    edge: crossingFrom(edges, setup.level, range, setup.search.high),
    skipped,
  });
};

/** This function gives the floor of one row: its least value on the grid, at the loads before its edge. */
const rowFloor = (grid: readonly number[], values: readonly (number | undefined)[], edge: number, start: number): Floor => {
  let floor: Floor = { load: grid[0] as number, value: start };
  grid.forEach((load, index) => {
    const value = values[index];
    if (load < edge && value !== undefined && value < floor.value) floor = { load, value };
  });
  return floor;
};

/**
 * This function gives the floor of a law on the grid of a search. The floor is the least value of the
 * law with its constants, at the loads before its edge. The rule `floor` needs a floor above 0.
 */
const floorOf = (law: Law, setup: Search): Result<Floor, LawProblem> => {
  const curve = setup.curveOf(law.constants.map((constant) => constant.value));
  const values = curve(setup.grid);
  const start = values[0];
  if (start === undefined) return err(problem("value", "constants", `The law has no value at the start of the search, ${setup.grid[0]}.`));
  const floor = rowFloor(setup.grid, values, edgeOf(curve, setup.grid, values, start), start);
  if (!(floor.value > 0)) {
    return err(problem("knee", "constants", `The rule "floor" needs a floor above 0. The floor is ${floor.value} at ${floor.load}.`));
  }
  return ok(floor);
};

/**
 * This function gives the test of the rule `floor` for one row. From the load of the floor of the
 * row, the value is above `1 + share` times that floor. A row with no floor above 0 has no test.
 */
const floorTest =
  (share: number): TestOf =>
  ({ curve, start, grid, values, edge }) => {
    const floor = rowFloor(grid, values, edge, start);
    if (!(floor.value > 0)) return ok(undefined);
    const limit = (1 + share) * floor.value;
    return ok((load, value = valueOf(curve, load)) => load >= floor.load && value !== undefined && value > limit);
  };

/**
 * This function gives the largest count of replicates that a knee interval can leave out. The count is
 * at most the replicates of one tail of the level, and at least `leastCount` replicates stay.
 */
const mostSkipped = (replicates: number, level: number): number =>
  Math.min(Math.floor((replicates * (1 - level)) / 2 + 1e-9), replicates - leastCount(level));

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
 * The rule `floor` gives each row its own floor. Thus the knee of a row is always after its floor,
 * and the uncertainty of the floor is in the interval. A replicate with no floor above 0 has no knee:
 * the field `noFloor` counts these replicates, and the interval leaves them out. When they are more
 * than one tail of the level, the function gives a problem.
 *
 * The function gives a problem for a variable or a point that the law cannot read. A bad search
 * range, rule or count of steps, and a level that the law cannot show, also give a problem. The last
 * problems are a law with no value at the start of the search, and a rule that cannot apply there.
 */
export const lawKnee = (law: Law, variable: string, rule: KneeRule, options: KneeOptions = {}): Result<Knee, LawProblem> => {
  const setup = searchOf(law, variable, options, () => kneeRuleProblem(rule));
  if (setup.tag === "err") return setup;
  let floor: Floor | undefined;
  if (rule.kind === "floor") {
    const least = floorOf(law, setup.value);
    if (least.tag === "err") return least;
    floor = least.value;
  }
  const found = along(law, setup.value, rule.kind === "floor" ? floorTest(rule.share) : ruleTest(rule));
  if (found.tag === "err") return found;
  const { target, level, search, outside } = setup.value;
  const knee: Knee = { variable, unit: target.unit, rule, level, search, knee: found.value.crossing, edge: found.value.edge, outside };
  if (floor === undefined) return ok(knee);
  const { skipped } = found.value;
  const most = mostSkipped(law.replicates.length, level);
  if (skipped > most) {
    const message = `The rule "floor" needs a floor above 0. ${skipped} of ${law.replicates.length} replicates have a floor of 0 or less. The interval of the level ${level} can leave out at most ${most}.`;
    return err(problem("knee", "replicates", message));
  }
  return ok({ ...knee, floor, noFloor: skipped });
};

/**
 * A reach is the result of a search along one variable for the first load where a law is above an
 * amount. The loads are in the unit of the variable. Before the `crossing`, the law holds the amount.
 *
 * Thus for a law that grows along the variable, the crossing is the largest load that holds the
 * amount. The `edge` and the list `outside` are as in a knee.
 */
export interface Reach {
  readonly variable: string;
  readonly unit: string;
  /** This amount is the amount of the search, in the unit of the measure of the law. */
  readonly amount: number;
  readonly level: number;
  readonly search: Range;
  readonly crossing: Crossing;
  readonly edge: Crossing;
  readonly outside: readonly string[];
}

/**
 * This function gives the first load along one variable where a law is above an amount, with an
 * interval. This is the inverse query of one law: the largest load that one limit holds.
 *
 * The options are the options of `lawKnee`. When the law is above the amount at the start of the
 * search, the crossing is the start. When the law holds the amount on all of the search, the
 * crossing is null. A pole is above each amount, so the crossing is before the pole.
 *
 * The function gives each problem of `lawKnee` that is not about a rule. An amount that is not finite
 * gives a problem. An amount that does not convert to the unit of the measure also gives a problem.
 */
export const lawReach = (law: Law, variable: string, amount: Quantity, options: KneeOptions = {}): Result<Reach, LawProblem> => {
  if (!isQuantity(amount) || !Number.isFinite(amount.value)) {
    return err(problem("value", "amount", "The amount is not a finite quantity."));
  }
  if (!convertible(amount.unit, law.measure.unit)) {
    const why = whyNotConvertible(amount.unit, law.measure.unit) ?? "the units are different";
    return err(problem("unit", "amount", `The amount is in "${amount.unit}", and the measure of the law is in "${law.measure.unit}": ${why}.`));
  }
  const value = valueIn(amount, law.measure.unit);
  const setup = searchOf(law, variable, options, () => undefined);
  if (setup.tag === "err") return setup;
  const found = along(law, setup.value, amountTest(value));
  if (found.tag === "err") return found;
  const { target, level, search, outside } = setup.value;
  return ok({ variable, unit: target.unit, amount: value, level, search, crossing: found.value.crossing, edge: found.value.edge, outside });
};
