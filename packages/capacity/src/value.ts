import { err, ok, type Result } from "@mark1russell7/optional";
import { quantile } from "@mark1russell7/rigor-statistics";
import { DEFAULT_LEVEL, leastCount, type Law, type LawProblem } from "./law.ts";
import { recordOf, valuesAt, valuesOf } from "./program.ts";

/** A load point gives one value for each variable of a law, in the unit of the variable. */
export type LoadPoint = Readonly<Record<string, number>>;

/** A range goes from `low` to `high`. */
export interface Range {
  readonly low: number;
  readonly high: number;
}

/** These options set the level of the intervals of a query. The level is 0.95 when a query gives none. */
export interface LevelOptions {
  readonly level?: number;
}

/**
 * A law value is the answer of a law at one load point, in the unit of the measure.
 *
 * The `interval` is the doubt of the law: the spread of its replicates at the point. It always
 * holds the value. The range `run` is where one measured run falls: the interval, made wider by
 * the residuals of the fit. The list `outside` names each variable whose value is outside its
 * range. With a name in this list, the value is an extrapolation.
 */
export interface LawValue {
  readonly value: number;
  readonly unit: string;
  readonly level: number;
  readonly interval: Range;
  readonly run: Range;
  readonly outside: readonly string[];
}

/** A constant interval is the value of one constant of a law and the interval of its replicates. */
export interface ConstantInterval {
  readonly id: string;
  readonly value: number;
  readonly level: number;
  readonly interval: Range;
}

const problem = (code: LawProblem["code"], path: string, message: string): LawProblem => ({ code, path, message });

/** This function gives the two ends of the share `level` of some values. */
export const rangeOf = (values: readonly number[], level: number): Range => ({
  low: quantile(values, (1 - level) / 2),
  high: quantile(values, (1 + level) / 2),
});

/** This function gives the problem of a level that the law cannot show, or undefined. */
export const levelProblem = (law: Law, level: number, residuals: boolean): LawProblem | undefined => {
  if (!(level > 0 && level < 1)) return problem("level", "level", `The level ${level} is not between 0 and 1.`);
  const least = leastCount(level);
  if (law.replicates.length < least) {
    return problem("level", "replicates", `The level ${level} needs ${least} replicates. The law has ${law.replicates.length}.`);
  }
  if (residuals && law.fit.residuals.length < least) {
    return problem("level", "fit.residuals", `The level ${level} needs ${least} residuals. The law has ${law.fit.residuals.length}.`);
  }
  return undefined;
};

/** This function gives the range of one measured run: the interval of the law, made wider by the residuals. */
export const runOf = (law: Law, interval: Range, level: number): Range => {
  const band = rangeOf(law.fit.residuals, level);
  if (law.fit.residual === "absolute") return { low: interval.low + band.low, high: interval.high + band.high };
  const corners = [interval.low, interval.high].flatMap((end) => [end * (1 + band.low), end * (1 + band.high)]);
  return { low: Math.min(...corners), high: Math.max(...corners) };
};

/**
 * This function gives the nearest point of a load point in the ranges of the variables of a law. A point in each range
 * gives undefined. A name that is not a variable of the law, or a value that is not a number, does not change.
 */
export const edgePointOf = (law: Law, point: LoadPoint): LoadPoint | undefined => {
  let edge: Record<string, number> | undefined;
  for (const variable of law.variables) {
    const value = point[variable.id];
    if (typeof value !== "number" || Number.isNaN(value)) continue;
    const held = Math.min(variable.max, Math.max(variable.min, value));
    if (held !== value) (edge ??= { ...point })[variable.id] = held;
  }
  return edge;
};

/**
 * This function holds a value of a law past its measures. Each measure of a law is a cost, and no run measured the
 * cost past the edge. Thus the value is the higher of the value of the law and its value at the nearest edge. A
 * cost that falls with the load then stays flat past the edge, and a cost that rises keeps its law. A missing value
 * stays missing, and a missing value at the edge keeps the value of the law.
 */
export const heldValue = (value: number | undefined, edge: number | undefined): number | undefined =>
  value === undefined || edge === undefined || !Number.isFinite(edge) ? value : Math.max(value, edge);

/** These values are the value of a law at a point with its constants, then with each replicate, and the variables outside their ranges. */
export interface PointValues {
  readonly values: readonly [number, ...number[]];
  readonly outside: readonly string[];
}

/**
 * This function evaluates a law at a load point with its constants, then with each replicate. The
 * point gives each variable of the law, and no other name.
 *
 * Past the range of a variable, each value holds, as heldValue tells.
 * It gives a problem for a point that the law cannot read, and for a value that is not finite.
 */
export const pointValuesOf = (law: Law, point: LoadPoint): Result<PointValues, LawProblem> => {
  const variables = law.variables.map((variable) => variable.id);
  const unknown = Object.keys(point).find((name) => !variables.includes(name));
  if (unknown !== undefined) return err(problem("point", unknown, `The law has no variable "${unknown}".`));
  const load: Record<string, number> = {};
  for (const name of variables) {
    const value = point[name];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return err(problem("point", name, `The point gives no finite value for the variable "${name}".`));
    }
    load[name] = value;
  }

  const names = law.constants.map((constant) => constant.id);
  const constants = law.constants.map((constant) => constant.value);
  const recordsAt = (at: LoadPoint): Readonly<Record<string, number>>[] => [
    recordOf(names, constants, at),
    ...law.replicates.map((row) => recordOf(names, row, at)),
  ];
  const values = valuesOf(law.form.program, recordsAt(load));
  if (values.tag === "err") return err(problem("value", "form.program", `The law has no value at this point: ${values.error}.`));
  const outside = law.variables
    .filter((variable) => (load[variable.id] as number) < variable.min || (load[variable.id] as number) > variable.max)
    .map((variable) => variable.id);
  const edge = outside.length === 0 ? undefined : edgePointOf(law, load);
  if (edge === undefined) return ok({ values: values.value as readonly [number, ...number[]], outside });
  const atEdge = valuesAt(law.form.program, recordsAt(edge));
  const held = values.value.map((value, row) => heldValue(value, atEdge[row]) ?? value);
  return ok({ values: held as readonly number[] as readonly [number, ...number[]], outside });
};

/** This function gives the interval of some replicate values at the share `level`, made wider to hold `value`. */
export const intervalOf = (value: number, spread: readonly number[], level: number): Range => {
  // At a bend of a form, each replicate can be on one side of the value. The interval then starts at the value.
  const share = rangeOf(spread, level);
  return { low: Math.min(share.low, value), high: Math.max(share.high, value) };
};

/**
 * This function gives the value of a law at a load point, with its interval. The point gives each
 * variable of the law, and no other name.
 *
 * The function evaluates the program with the constants, then with each replicate. The interval is
 * the share `level` of the values of the replicates, made wider to hold the value.
 *
 * The function gives a problem for a point that the law cannot read. It also gives a problem for a
 * level that the law cannot show, and for a value that is not finite.
 */
export const lawValue = (law: Law, point: LoadPoint, options: LevelOptions = {}): Result<LawValue, LawProblem> => {
  const level = options.level ?? DEFAULT_LEVEL;
  const noLevel = levelProblem(law, level, true);
  if (noLevel !== undefined) return err(noLevel);
  const evaluated = pointValuesOf(law, point);
  if (evaluated.tag === "err") return evaluated;
  const [value, ...spread] = evaluated.value.values;
  const interval = intervalOf(value, spread, level);
  return ok({ value, unit: law.measure.unit, level, interval, run: runOf(law, interval, level), outside: evaluated.value.outside });
};

/**
 * This function gives each constant of a law with the interval of its replicates. It gives a
 * problem for a level that the law cannot show.
 */
export const constantIntervals = (law: Law, options: LevelOptions = {}): Result<readonly ConstantInterval[], LawProblem> => {
  const level = options.level ?? DEFAULT_LEVEL;
  const noLevel = levelProblem(law, level, false);
  if (noLevel !== undefined) return err(noLevel);
  return ok(
    law.constants.map((constant, index) => ({
      id: constant.id,
      value: constant.value,
      level,
      interval: rangeOf(law.replicates.map((row) => row[index] as number), level),
    })),
  );
};
