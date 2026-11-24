import { err, ok, type Result } from "@mark1russell7/optional";
import {
  add,
  compare,
  convertible,
  isCanonicalUnit,
  isQuantity,
  kindOf,
  factorOf,
  quantity,
  scale,
  whyNotConvertible,
  type Quantity,
} from "@mark1russell7/quantity";
import type { Law, Variable } from "./law.ts";
import { finite } from "./names.ts";
import type { LoadPoint } from "./value.ts";
import { demandProblems, workloadProblem } from "./workload-check.ts";
import { RATE, type Amounts, type Demand, type WorkloadClass, type WorkloadProblem } from "./workload.ts";

/** This function gives the first problem of a demand, or undefined. The text `owner` goes before the path of the problem. */
const firstProblem = (demand: Demand, owner = ""): WorkloadProblem | undefined => {
  const found = demandProblems(demand)[0];
  return found === undefined || owner === "" ? found : { ...found, path: `${owner}.${found.path}` };
};

/**
 * This function gives a demand with a change of each rate and each level. The variables of the
 * requests stay. The function `change` gets the name of a level, and no name for a rate. It gives
 * undefined for an amount that it cannot change.
 */
const changed = (
  demand: Demand,
  change: (amount: Quantity, level?: string) => Quantity | undefined,
): Result<Demand, WorkloadProblem> => {
  const classes: WorkloadClass[] = [];
  for (const [index, entry] of demand.classes.entries()) {
    const rate = change(entry.rate);
    if (rate === undefined) {
      return err(workloadProblem("amount", `classes[${index}].rate`, `The rate of the class "${entry.id}" is not finite after the change.`));
    }
    classes.push({ id: entry.id, rate, request: entry.request });
  }
  const levels: Record<string, Quantity> = {};
  for (const [name, amount] of Object.entries(demand.levels)) {
    const level = change(amount, name);
    if (level === undefined) return err(workloadProblem("amount", `levels.${name}`, `The level "${name}" is not finite after the change.`));
    levels[name] = level;
  }
  return ok({ classes, levels });
};

/**
 * This function gives a demand that is `by` times as large: each rate and each level, times `by`.
 * The variables of the requests stay, because more clients do not make a request larger.
 *
 * It gives a problem for a demand that is not correct, and for a factor that is not a finite number
 * of 0 or more.
 */
export const scaleDemand = (demand: Demand, by: number): Result<Demand, WorkloadProblem> => {
  const bad = firstProblem(demand);
  if (bad !== undefined) return err(bad);
  if (!finite(by) || by < 0) return err(workloadProblem("factor", "by", `The factor ${by} is not a finite number of 0 or more.`));
  return changed(demand, (amount) => {
    const product = scale(amount, by);
    return finite(product.value) ? product : undefined;
  });
};

/** These options name the levels that do not divide between instances. Each instance has the whole of such a level. */
export interface ShareOptions {
  readonly whole?: readonly string[];
}

/**
 * This function gives the demand on one instance when `instances` equal instances serve a demand:
 * each rate and each level, divided by the count. The variables of the requests stay.
 *
 * A level in `options.whole` does not divide. For example, each instance of an app that keeps all
 * open incidents in memory has the whole level.
 *
 * It gives a problem for a demand that is not correct. It gives a problem for a count that is not
 * a whole number of 1 or more. It gives a problem for a name in `options.whole` that is not a level.
 */
export const shareOf = (demand: Demand, instances: number, options: ShareOptions = {}): Result<Demand, WorkloadProblem> => {
  const bad = firstProblem(demand);
  if (bad !== undefined) return err(bad);
  if (!Number.isSafeInteger(instances) || instances < 1) {
    return err(workloadProblem("factor", "instances", `The count of instances ${instances} is not a whole number of 1 or more.`));
  }
  const whole = options.whole ?? [];
  const unknown = whole.find((name) => !Object.hasOwn(demand.levels, name));
  if (unknown !== undefined) return err(workloadProblem("variable", "whole", `The demand has no level "${unknown}".`));
  return changed(demand, (amount, level) =>
    level !== undefined && whole.includes(level) ? amount : quantity(amount.value / instances, amount.unit),
  );
};

/**
 * This function gives a portion of a demand for a search. Each rate and each level is times
 * `shared`, and each level in `whole` is times `kept`. It does not examine the demand or the names.
 *
 * The demand on one of `n` instances at `s` times the load is the portion with `shared` equal to
 * `s / n` and `kept` equal to `s`.
 */
export const portionOf = (demand: Demand, shared: number, kept: number, whole: readonly string[]): Result<Demand, WorkloadProblem> =>
  changed(demand, (amount, level) => {
    const product = scale(amount, level !== undefined && whole.includes(level) ? kept : shared);
    return finite(product.value) ? product : undefined;
  });

/** This function gives the sum of two amounts, or the problem that stops it. */
const plus = (a: Quantity, b: Quantity, path: string, what: string): Result<Quantity, WorkloadProblem> => {
  if (!convertible(a.unit, b.unit)) {
    return err(workloadProblem("unit", path, `${what} do not add: ${whyNotConvertible(a.unit, b.unit) ?? "the units are different"}.`));
  }
  const total = add(a, b);
  return finite(total.value) ? ok(total) : err(workloadProblem("amount", path, `${what} do not have a finite sum.`));
};

/** This function tells if two sets of amounts have the same names and equal amounts. */
const sameAmounts = (a: Amounts, b: Amounts): boolean => {
  const names = Object.keys(a);
  return (
    names.length === Object.keys(b).length &&
    names.every((name) => {
      const other = b[name];
      const amount = a[name] as Quantity;
      return Object.hasOwn(b, name) && other !== undefined && convertible(amount.unit, other.unit) && compare(amount, other) === 0;
    })
  );
};

const inOrder = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * This function gives the sum of two demands. A class of one demand stays. A class of the two
 * demands has the sum of its rates, and its request must be equal in the two. The levels add, and a
 * level of one demand stays. The classes and the levels of the sum are in the order of their names.
 *
 * The sum has the laws of addition: the order of the demands does not change it, and `NO_DEMAND`
 * is its zero. An amount of the sum is in the unit of the first demand that gives it. Thus the
 * order can change the unit of an amount, and not the amount.
 *
 * It gives a problem for a demand that is not correct, and for amounts that do not add. A path of
 * a problem starts with `first` or `second`, or with neither for a problem of the sum.
 */
export const mergeDemands = (first: Demand, second: Demand): Result<Demand, WorkloadProblem> => {
  const bad = firstProblem(first, "first") ?? firstProblem(second, "second");
  if (bad !== undefined) return err(bad);

  const classes = new Map<string, WorkloadClass>(first.classes.map((entry) => [entry.id, entry]));
  for (const [index, entry] of second.classes.entries()) {
    const same = classes.get(entry.id);
    if (same === undefined) {
      classes.set(entry.id, entry);
      continue;
    }
    const path = `second.classes[${index}]`;
    if (!sameAmounts(same.request, entry.request)) {
      return err(workloadProblem("class", `${path}.request`, `The class "${entry.id}" has a different request in the two demands.`));
    }
    const rate = plus(same.rate, entry.rate, `${path}.rate`, `The rates of the class "${entry.id}"`);
    if (rate.tag === "err") return rate;
    classes.set(entry.id, { id: same.id, rate: rate.value, request: same.request });
  }

  const levels = new Map<string, Quantity>(Object.entries(first.levels));
  for (const [name, amount] of Object.entries(second.levels)) {
    const same = levels.get(name);
    if (same === undefined) {
      levels.set(name, amount);
      continue;
    }
    const level = plus(same, amount, `second.levels.${name}`, `The levels "${name}"`);
    if (level.tag === "err") return level;
    levels.set(name, level.value);
  }

  const total: Demand = {
    classes: [...classes.values()].sort((a, b) => inOrder(a.id, b.id)),
    levels: Object.fromEntries([...levels].sort(([a], [b]) => inOrder(a, b))),
  };
  // The sum can have a problem that no part has: a level of one demand with the name of a variable of the other.
  const together = firstProblem(total);
  return together === undefined ? ok(total) : err(together);
};

/**
 * This function gives the sum of the rates of the classes of a demand, in `unit`. A demand with no
 * class has a rate of 0.
 *
 * It gives a problem for a demand that is not correct, and for a unit that is not a unit of a
 * rate. It gives a problem for a class whose rate counts a different thing, for example events.
 */
export const totalRate = (demand: Demand, unit: string): Result<Quantity, WorkloadProblem> => {
  const bad = firstProblem(demand);
  if (bad !== undefined) return err(bad);
  if (!isCanonicalUnit(unit) || kindOf(unit) !== "frequency") {
    return err(workloadProblem("unit", "unit", `"${unit}" is not a canonical unit of a rate, for example "{request}/s".`));
  }
  for (const [index, entry] of demand.classes.entries()) {
    if (!convertible(entry.rate.unit, unit)) {
      const why = whyNotConvertible(entry.rate.unit, unit) ?? "the units are different";
      return err(workloadProblem("unit", `classes[${index}].rate`, `The rate of the class "${entry.id}" is not in "${unit}": ${why}.`));
    }
  }
  // One cached factor for each pair of units: the search calls this function at each load.
  let value = 0;
  for (const entry of demand.classes) value += entry.rate.value * factorOf(entry.rate.unit, unit);
  const total = quantity(value, unit);
  return finite(total.value) ? ok(total) : err(workloadProblem("amount", "classes", "The rates do not have a finite sum."));
};

/**
 * A load tells which rate the variable `rate` of a law reads. The load `class` is the rate of one
 * class. The load `total` is the sum of the rates of all classes, the load of the whole instance.
 */
export type Load = "class" | "total";

/** These options tell which rate the variable `rate` of a law reads. The load is `class` when the options give none. */
export interface PointOptions {
  readonly load?: Load;
}

/**
 * A point law is the part of a law that a load point reads: its id, and the id and the unit of each
 * variable. Thus a caller can get the points of a law before the fit of the law.
 */
export interface PointLaw extends Pick<Law, "id"> {
  readonly variables: readonly Pick<Variable, "id" | "unit">[];
}

/** This function gives the point of a law from a rate, the variables of one request, the levels of a demand and `given`. */
const pointOf = (demand: Demand, law: PointLaw, rate: Quantity | "total", request: Amounts, given: Amounts): Result<LoadPoint, WorkloadProblem> => {
  const point: Record<string, number> = {};
  for (const variable of law.variables) {
    const name = variable.id;
    const found: unknown[] = [];
    if (name === RATE) {
      if (rate === "total") {
        const total = totalRate(demand, variable.unit);
        if (total.tag === "err") return err({ ...total.error, path: name, message: `The variable "${name}" of the law "${law.id}" reads the total rate. ${total.error.message}` });
        found.push(total.value);
      } else found.push(rate);
    }
    for (const amounts of [request, demand.levels, given]) {
      if (Object.hasOwn(amounts, name)) found.push(amounts[name]);
    }
    const [amount] = found;
    if (found.length === 0) {
      return err(workloadProblem("variable", name, `The demand gives no amount for the variable "${name}" of the law "${law.id}".`));
    }
    if (found.length > 1) {
      return err(workloadProblem("variable", name, `The demand gives the variable "${name}", and the caller gives it also.`));
    }
    if (!isQuantity(amount)) {
      return err(workloadProblem("amount", name, `The amount of "${name}" from the caller is not a finite amount in a canonical unit.`));
    }
    if (!isCanonicalUnit(variable.unit)) {
      return err(workloadProblem("unit", name, `The unit "${variable.unit}" of the variable "${name}" of the law "${law.id}" is not canonical.`));
    }
    if (!convertible(amount.unit, variable.unit)) {
      const why = whyNotConvertible(amount.unit, variable.unit) ?? "the units are different";
      return err(
        workloadProblem("unit", name, `The variable "${name}" of the law "${law.id}" is in "${variable.unit}", not in "${amount.unit}": ${why}.`),
      );
    }
    point[name] = amount.value * factorOf(amount.unit, variable.unit);
  }
  return ok(point);
};

/**
 * This function gives the load point of one class of a demand for a law. The point has one number
 * for each variable of the law, in the unit of that variable.
 *
 * The variable `rate` is the rate of the class, or the total rate with the load `total`. Each other
 * variable is a variable of the request of the class, a level of the demand, or an amount of
 * `given`. The amounts of `given` are the state of an instance, for example the size of its heap
 * and its age. No workload gives that state.
 *
 * It gives a problem for a demand that is not correct and for a class that the demand does not
 * have. It gives a problem for a variable with no amount or with two amounts. It gives a problem
 * for an amount that does not convert to the unit of the variable.
 */
export const loadPointOf = (
  demand: Demand,
  id: string,
  law: PointLaw,
  given: Amounts = {},
  options: PointOptions = {},
): Result<LoadPoint, WorkloadProblem> => {
  const bad = firstProblem(demand);
  if (bad !== undefined) return err(bad);
  const entry = demand.classes.find((candidate) => candidate.id === id);
  if (entry === undefined) return err(workloadProblem("class", "classes", `The demand has no class "${id}".`));
  return pointOf(demand, law, (options.load ?? "class") === "class" ? entry.rate : "total", entry.request, given);
};

/**
 * This function gives the load point of a whole instance for a law: a point with no class. The
 * variable `rate` is the total rate of the demand. Each other variable is a level of the demand or
 * an amount of `given`. A variable of a request has no amount here.
 *
 * It gives the problems of `loadPointOf`, with no problem of a class.
 */
export const instancePointOf = (demand: Demand, law: PointLaw, given: Amounts = {}): Result<LoadPoint, WorkloadProblem> => {
  const bad = firstProblem(demand);
  if (bad !== undefined) return err(bad);
  return pointOf(demand, law, "total", {}, given);
};
