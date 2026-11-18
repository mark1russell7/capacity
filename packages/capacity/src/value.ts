import { err, ok, type Result } from "@mark1russell7/optional";
import { quantile } from "@mark1russell7/rigor-statistics";
import { DEFAULT_LEVEL, leastCount, type Law, type LawProblem } from "./law.ts";
import { recordOf, valuesOf } from "./program.ts";

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
const rangeOf = (values: readonly number[], level: number): Range => ({
  low: quantile(values, (1 - level) / 2),
  high: quantile(values, (1 + level) / 2),
});

/** This function gives the problem of a level that the law cannot show, or undefined. */
const levelProblem = (law: Law, level: number, residuals: boolean): LawProblem | undefined => {
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
const runOf = (law: Law, interval: Range, level: number): Range => {
  const band = rangeOf(law.fit.residuals, level);
  if (law.fit.residual === "absolute") return { low: interval.low + band.low, high: interval.high + band.high };
  const corners = [interval.low, interval.high].flatMap((end) => [end * (1 + band.low), end * (1 + band.high)]);
  return { low: Math.min(...corners), high: Math.max(...corners) };
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
  const estimate = recordOf(names, law.constants.map((constant) => constant.value), load);
  const records = [estimate, ...law.replicates.map((row) => recordOf(names, row, load))];
  const values = valuesOf(law.form.program, records);
  if (values.tag === "err") return err(problem("value", "form.program", `The law has no value at this point: ${values.error}.`));

  const [value, ...spread] = values.value as readonly [number, ...number[]];
  // At a bend of a form, each replicate can be on one side of the value. The interval then starts at the value.
  const share = rangeOf(spread, level);
  const interval = { low: Math.min(share.low, value), high: Math.max(share.high, value) };
  const outside = law.variables
    .filter((variable) => (load[variable.id] as number) < variable.min || (load[variable.id] as number) > variable.max)
    .map((variable) => variable.id);
  return ok({ value, unit: law.measure.unit, level, interval, run: runOf(law, interval, level), outside });
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
