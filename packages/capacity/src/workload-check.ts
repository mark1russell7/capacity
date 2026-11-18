import { convertible, isQuantity, kindOf } from "@mark1russell7/quantity";
import { NAME, SLUG, isUtc } from "./names.ts";
import { RATE, WORKLOAD_FORMAT, type Amounts, type Demand, type Workload, type WorkloadProblem } from "./workload.ts";

/** This function makes a problem of a workload. */
export const workloadProblem = (code: WorkloadProblem["code"], path: string, message: string): WorkloadProblem => ({
  code,
  path,
  message,
});

/** This function gives the problems of some amounts: the name and the amount of each. */
const amountProblems = (amounts: Amounts, path: string, owner: string): readonly WorkloadProblem[] => {
  const problems: WorkloadProblem[] = [];
  for (const [name, amount] of Object.entries(amounts)) {
    const at = `${path}.${name}`;
    if (!NAME.test(name)) {
      problems.push(workloadProblem("id", at, `The name "${name}" is not letters and digits that start with a lower-case letter.`));
    }
    if (name === RATE) problems.push(workloadProblem("id", at, `The name "${RATE}" is the rate of a class. ${owner} cannot use it.`));
    if (!isQuantity(amount)) problems.push(workloadProblem("amount", at, `"${name}" is not a finite amount in a canonical unit.`));
  }
  return problems;
};

/**
 * This function examines a demand and gives each problem that it finds. A demand with no problem
 * gives an empty list.
 *
 * It examines the id and the rate of each class, and the name and the amount of each variable and
 * each level. It examines that a variable has one kind of unit in each class, and that no name is
 * a level and a variable.
 */
export const demandProblems = (demand: Demand): readonly WorkloadProblem[] => {
  const problems: WorkloadProblem[] = [];
  /** The class that first gives each variable of a request, and the unit of the variable there. */
  const first = new Map<string, { readonly class: string; readonly unit: string | undefined }>();
  const ids = new Set<string>();
  let twice: string | undefined;

  demand.classes.forEach((entry, index) => {
    const path = `classes[${index}]`;
    if (ids.has(entry.id)) twice ??= entry.id;
    ids.add(entry.id);
    if (!SLUG.test(entry.id)) {
      problems.push(workloadProblem("id", `${path}.id`, `The id "${entry.id}" is not lower-case words joined by ".", "-" or "/".`));
    }
    if (!isQuantity(entry.rate)) {
      problems.push(workloadProblem("rate", `${path}.rate`, `The rate of the class "${entry.id}" is not a finite amount in a canonical unit.`));
    } else if (kindOf(entry.rate.unit) !== "frequency") {
      problems.push(
        workloadProblem(
          "rate",
          `${path}.rate`,
          `The rate of the class "${entry.id}" is in "${entry.rate.unit}". A rate is a count in a unit of time, for example in "{request}/s".`,
        ),
      );
    } else if (entry.rate.value < 0) {
      problems.push(workloadProblem("rate", `${path}.rate`, `The rate of the class "${entry.id}" is below 0.`));
    }

    problems.push(...amountProblems(entry.request, `${path}.request`, "A variable of a request"));
    for (const [name, amount] of Object.entries(entry.request)) {
      const unit = isQuantity(amount) ? amount.unit : undefined;
      const before = first.get(name);
      if (before === undefined) {
        first.set(name, { class: entry.id, unit });
      } else if (unit !== undefined && before.unit !== undefined && !convertible(before.unit, unit)) {
        problems.push(
          workloadProblem(
            "unit",
            `${path}.request.${name}`,
            `The variable "${name}" is in "${unit}" here, and it is in "${before.unit}" in the class "${before.class}".`,
          ),
        );
      }
    }
  });
  if (twice !== undefined) problems.push(workloadProblem("id", "classes", `Two classes have the id "${twice}".`));

  problems.push(...amountProblems(demand.levels, "levels", "A level"));
  for (const name of Object.keys(demand.levels)) {
    const before = first.get(name);
    if (before !== undefined) {
      problems.push(workloadProblem("id", `levels.${name}`, `"${name}" names a level and a variable of the class "${before.class}".`));
    }
  }
  return problems;
};

/**
 * This function examines a workload and gives each problem that it finds. A workload with no
 * problem gives an empty list.
 *
 * It examines the format, the id and the title. It examines the demand with `demandProblems`. It
 * examines that a plan has a note. It examines that the window of a metrics source goes from a UTC
 * time to a later UTC time.
 */
export const checkWorkload = (workload: Workload): readonly WorkloadProblem[] => {
  const problems: WorkloadProblem[] = [];
  if (workload.format !== WORKLOAD_FORMAT) {
    problems.push(workloadProblem("format", "format", `The format is "${String(workload.format)}", not "${WORKLOAD_FORMAT}".`));
  }
  if (!SLUG.test(workload.id)) {
    problems.push(workloadProblem("id", "id", `The id "${workload.id}" is not lower-case words joined by ".", "-" or "/".`));
  }
  if (workload.title.trim() === "") problems.push(workloadProblem("id", "title", "The title is empty."));
  problems.push(...demandProblems(workload));

  const source = workload.source;
  if (source.kind === "plan") {
    if (source.note.trim() === "") problems.push(workloadProblem("source", "source.note", "The note of the plan is empty."));
    return problems;
  }
  if (source.origin.trim() === "") problems.push(workloadProblem("source", "source.origin", "The origin of the metrics is empty."));
  for (const end of ["from", "to"] as const) {
    if (!isUtc(source[end])) {
      problems.push(
        workloadProblem("source", `source.${end}`, `The time "${source[end]}" is not a UTC time, for example "2026-11-18T14:00:00Z".`),
      );
    }
  }
  if (isUtc(source.from) && isUtc(source.to) && !(Date.parse(source.from) < Date.parse(source.to))) {
    problems.push(workloadProblem("source", "source", "The window of the metrics does not go from a time to a later time."));
  }
  return problems;
};
