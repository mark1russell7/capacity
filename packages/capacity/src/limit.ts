import { err, ok, type Result } from "@mark1russell7/optional";
import { convertible, isQuantity, scale, valueIn, whyNotConvertible, type Quantity } from "@mark1russell7/quantity";
import { limitProblem, limitProblems } from "./instance-check.ts";
import type { Instance, Limit, LimitProblem } from "./instance.ts";
import { finite, repeated } from "./names.ts";
import type { Amounts } from "./workload.ts";

/**
 * A limit use tells how much of a limit one value of its measure takes. The `amount` is the amount
 * of the limit: its ceiling, less its headroom. The `use` is the value, divided by that amount.
 * The limit holds when the `use` is 1 or less.
 */
export interface LimitUse {
  /** This id is the id of the limit. */
  readonly limit: string;
  readonly measure: string;
  readonly value: Quantity;
  readonly amount: Quantity;
  readonly use: number;
  readonly holds: boolean;
}

/** This function gives the amount of a limit at the path `at`, or the problem that stops it. */
const amountAt = (limit: Limit, instance: Instance, at: string): Result<Quantity, LimitProblem> => {
  const bad = limitProblems(limit, at)[0];
  if (bad !== undefined) return err(bad);
  let ceiling: Quantity;
  if (limit.ceiling.kind === "amount") {
    ceiling = limit.ceiling.amount;
  } else {
    const name = limit.ceiling.resource;
    if (!Object.hasOwn(instance.resources, name)) {
      return err(limitProblem("resource", `resources.${name}`, `The instance has no resource "${name}" for the limit "${limit.id}".`));
    }
    const resource: unknown = instance.resources[name];
    if (!isQuantity(resource) || !(resource.value > 0)) {
      return err(limitProblem("resource", `resources.${name}`, `The resource "${name}" of the instance is not a finite amount above 0.`));
    }
    ceiling = resource;
  }
  const amount = scale(ceiling, 1 - limit.headroom);
  if (!(amount.value > 0) || !finite(amount.value)) {
    const field = at === "" ? "ceiling" : `${at}.ceiling`;
    return err(limitProblem("amount", field, `The ceiling of the limit "${limit.id}", less its headroom, is not a finite amount above 0.`));
  }
  return ok(amount);
};

/** This function gives the use of a limit, with the path of the limit and the path of the value for a problem. */
const useAt = (limit: Limit, instance: Instance, value: Quantity, at: string, valuePath: string): Result<LimitUse, LimitProblem> => {
  const amount = amountAt(limit, instance, at);
  if (amount.tag === "err") return amount;
  if (!isQuantity(value) || value.value < 0) {
    return err(limitProblem("amount", valuePath, `The value of the measure "${limit.measure}" is not a finite amount of 0 or more.`));
  }
  if (!convertible(value.unit, amount.value.unit)) {
    const why = whyNotConvertible(value.unit, amount.value.unit) ?? "the units are different";
    return err(
      limitProblem(
        "unit",
        valuePath,
        `The measure "${limit.measure}" is in "${value.unit}", and the ceiling of the limit "${limit.id}" is in "${amount.value.unit}": ${why}.`,
      ),
    );
  }
  const use = valueIn(value, amount.value.unit) / amount.value.value;
  if (!finite(use)) return err(limitProblem("amount", valuePath, `The value of the measure "${limit.measure}" has no finite use.`));
  return ok({ limit: limit.id, measure: limit.measure, value, amount: amount.value, use, holds: use <= 1 });
};

/**
 * This function gives the amount of a limit on an instance: the ceiling, less the headroom. It is
 * the largest value of the measure that holds the limit, in the unit of the ceiling.
 *
 * It gives a problem for a limit that is not correct. It gives a problem for a ceiling that names
 * a resource when the instance does not have that resource.
 */
export const limitAmount = (limit: Limit, instance: Instance): Result<Quantity, LimitProblem> => amountAt(limit, instance, "");

/**
 * This function gives the use of a limit on an instance by one value of its measure. The use is
 * the value, divided by the amount of the limit. Thus a use of 1 is exactly at the limit.
 *
 * It gives each problem of `limitAmount`. It gives a problem for a value that is not a finite
 * amount of 0 or more. It gives a problem for a value that does not convert to the unit of the ceiling.
 */
export const limitUse = (limit: Limit, instance: Instance, value: Quantity): Result<LimitUse, LimitProblem> =>
  useAt(limit, instance, value, "", "value");

/**
 * This function gives the use of each limit on an instance. The `values` give the value of each
 * measure, by the id of the measure. The uses go from the largest to the smallest. Thus the first
 * use is the limit that binds.
 *
 * A limit with no value is a problem, and not a limit that holds. The function also gives a
 * problem for two limits with one id, and each problem of `limitUse`.
 */
export const limitUses = (limits: readonly Limit[], instance: Instance, values: Amounts): Result<readonly LimitUse[], LimitProblem> => {
  const twice = repeated(limits.map((limit) => limit.id));
  if (twice !== undefined) return err(limitProblem("id", "limits", `Two limits have the id "${twice}".`));
  const uses: LimitUse[] = [];
  for (const [index, limit] of limits.entries()) {
    const at = `limits[${index}]`;
    if (!Object.hasOwn(values, limit.measure)) {
      return err(limitProblem("measure", `${at}.measure`, `The values give no amount for the measure "${limit.measure}" of the limit "${limit.id}".`));
    }
    const use = useAt(limit, instance, values[limit.measure] as Quantity, at, `values.${limit.measure}`);
    if (use.tag === "err") return use;
    uses.push(use.value);
  }
  return ok(uses.sort((a, b) => b.use - a.use));
};
