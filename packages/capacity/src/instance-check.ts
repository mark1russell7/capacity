import { convertible, isQuantity } from "@mark1russell7/quantity";
import {
  INSTANCE_FORMAT,
  LIMITS_FORMAT,
  RESOURCE_UNITS,
  type Instance,
  type InstanceProblem,
  type InstanceType,
  type Limit,
  type LimitProblem,
  type LimitSet,
} from "./instance.ts";
import { NAME, SLUG, finite, repeated } from "./names.ts";

/** This function makes a problem of an instance. */
export const instanceProblem = (code: InstanceProblem["code"], path: string, message: string): InstanceProblem => ({
  code,
  path,
  message,
});

/** This function makes a problem of a limit. */
export const limitProblem = (code: LimitProblem["code"], path: string, message: string): LimitProblem => ({ code, path, message });

/**
 * This function examines the resources of an instance and gives each problem that it finds. An
 * instance with no problem gives an empty list.
 *
 * It examines that the instance has a resource. It examines the name and the amount of each
 * resource. It examines the unit of each resource of `RESOURCE_UNITS`.
 */
export const instanceProblems = (instance: Instance): readonly InstanceProblem[] => {
  const problems: InstanceProblem[] = [];
  const entries = Object.entries(instance.resources);
  if (entries.length === 0) problems.push(instanceProblem("resource", "resources", "The instance has no resource."));
  for (const [name, amount] of entries) {
    const at = `resources.${name}`;
    if (!NAME.test(name)) {
      problems.push(instanceProblem("id", at, `The name "${name}" is not letters and digits that start with a lower-case letter.`));
    }
    if (!isQuantity(amount)) {
      problems.push(instanceProblem("amount", at, `"${name}" is not a finite amount in a canonical unit.`));
      continue;
    }
    if (!(amount.value > 0)) problems.push(instanceProblem("amount", at, `The resource "${name}" is not above 0.`));
    const unit = Object.hasOwn(RESOURCE_UNITS, name) ? RESOURCE_UNITS[name] : undefined;
    if (unit !== undefined && !convertible(amount.unit, unit)) {
      problems.push(instanceProblem("unit", at, `The resource "${name}" is in "${amount.unit}". Its unit converts to "${unit}".`));
    }
  }
  return problems;
};

/**
 * This function examines an instance type and gives each problem that it finds. An instance type
 * with no problem gives an empty list.
 *
 * It examines the format, the id and the title. It examines the resources with `instanceProblems`.
 */
export const checkInstance = (type: InstanceType): readonly InstanceProblem[] => {
  const problems: InstanceProblem[] = [];
  if (type.format !== INSTANCE_FORMAT) {
    problems.push(instanceProblem("format", "format", `The format is "${String(type.format)}", not "${INSTANCE_FORMAT}".`));
  }
  if (!SLUG.test(type.id)) {
    problems.push(instanceProblem("id", "id", `The id "${type.id}" is not lower-case words joined by ".", "-" or "/".`));
  }
  if (type.title.trim() === "") problems.push(instanceProblem("id", "title", "The title is empty."));
  problems.push(...instanceProblems(type));
  return problems;
};

/**
 * This function examines one limit and gives each problem that it finds. The text `path` is the
 * path of the limit, and it goes before the path of each problem.
 */
export const limitProblems = (limit: Limit, path = ""): readonly LimitProblem[] => {
  const problems: LimitProblem[] = [];
  const at = (field: string): string => (path === "" ? field : `${path}.${field}`);
  if (!SLUG.test(limit.id)) {
    problems.push(limitProblem("id", at("id"), `The id "${limit.id}" is not lower-case words joined by ".", "-" or "/".`));
  }
  if (!SLUG.test(limit.measure)) {
    problems.push(limitProblem("measure", at("measure"), `The measure "${limit.measure}" is not lower-case words joined by ".", "-" or "/".`));
  }
  if (!finite(limit.headroom) || limit.headroom < 0 || limit.headroom >= 1) {
    problems.push(limitProblem("headroom", at("headroom"), `The headroom ${limit.headroom} is not a number from 0 to below 1.`));
  }
  const ceiling = limit.ceiling;
  if (ceiling.kind === "resource") {
    if (!NAME.test(ceiling.resource)) {
      problems.push(
        limitProblem("resource", at("ceiling.resource"), `The name "${ceiling.resource}" is not letters and digits that start with a lower-case letter.`),
      );
    }
  } else if (!isQuantity(ceiling.amount)) {
    problems.push(limitProblem("amount", at("ceiling.amount"), "The ceiling is not a finite amount in a canonical unit."));
  } else if (!(ceiling.amount.value > 0)) {
    problems.push(limitProblem("amount", at("ceiling.amount"), "The ceiling is not above 0."));
  }
  return problems;
};

/**
 * This function examines a limit set and gives each problem that it finds. A limit set with no
 * problem gives an empty list.
 *
 * It examines the format, the id and the title. It examines each limit with `limitProblems`. It
 * examines that two limits do not have one id.
 */
export const checkLimits = (set: LimitSet): readonly LimitProblem[] => {
  const problems: LimitProblem[] = [];
  if (set.format !== LIMITS_FORMAT) {
    problems.push(limitProblem("format", "format", `The format is "${String(set.format)}", not "${LIMITS_FORMAT}".`));
  }
  if (!SLUG.test(set.id)) problems.push(limitProblem("id", "id", `The id "${set.id}" is not lower-case words joined by ".", "-" or "/".`));
  if (set.title.trim() === "") problems.push(limitProblem("id", "title", "The title is empty."));
  set.limits.forEach((limit, index) => problems.push(...limitProblems(limit, `limits[${index}]`)));
  const twice = repeated(set.limits.map((limit) => limit.id));
  if (twice !== undefined) problems.push(limitProblem("id", "limits", `Two limits have the id "${twice}".`));
  return problems;
};
