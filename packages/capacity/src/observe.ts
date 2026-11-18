import { err, ok, type Result } from "@mark1russell7/optional";
import { isCanonicalUnit, isQuantity, kindOf, quantity, type Quantity } from "@mark1russell7/quantity";
import { isUtc } from "./names.ts";
import { checkWorkload, workloadProblem } from "./workload-check.ts";
import { WORKLOAD_FORMAT, type Amounts, type Workload, type WorkloadClass, type WorkloadProblem } from "./workload.ts";

/**
 * An observed class is the count of the requests of one class in a window of the live metrics, for
 * example `{ value: 1200, unit: "{request}" }`. Its `request` gives each variable of one request.
 */
export interface ObservedClass {
  readonly id: string;
  readonly count: Quantity;
  readonly request: Amounts;
}

/**
 * An observation is the live metrics of an app in one window, from `from` to `to`. Its `origin`
 * names the place of the metrics. Each level is the level in the window.
 */
export interface Observation {
  readonly origin: string;
  readonly from: string;
  readonly to: string;
  readonly classes: readonly ObservedClass[];
  readonly levels: Amounts;
}

/** A workload name is the id and the title of a workload. */
export interface WorkloadName {
  readonly id: string;
  readonly title: string;
}

/**
 * This function gives the workload of an observation. The rate of a class is its count, divided by
 * the seconds of the window. Thus the rate is the mean rate of the window. For the load at a peak,
 * give the window of the peak.
 *
 * It gives each problem of an observation that is not correct, and each problem of the workload.
 */
export const observedWorkload = (observation: Observation, name: WorkloadName): Result<Workload, readonly WorkloadProblem[]> => {
  const { origin, from, to } = observation;
  const seconds = isUtc(from) && isUtc(to) ? (Date.parse(to) - Date.parse(from)) / 1000 : Number.NaN;
  if (!(seconds > 0)) {
    return err([workloadProblem("source", "source", "The window does not go from a UTC time to a later UTC time.")]);
  }

  const problems: WorkloadProblem[] = [];
  const classes: WorkloadClass[] = [];
  observation.classes.forEach((entry, index) => {
    const { count } = entry;
    const unit = isQuantity(count) && kindOf(count.unit) === "count" ? `${count.unit}/s` : undefined;
    if (unit === undefined || !isCanonicalUnit(unit) || kindOf(unit) !== "frequency" || count.value < 0) {
      problems.push(
        workloadProblem("rate", `classes[${index}].count`, `The count of the class "${entry.id}" is not a count of 0 or more, for example in "{request}".`),
      );
      return;
    }
    classes.push({ id: entry.id, rate: quantity(count.value / seconds, unit), request: entry.request });
  });
  if (problems.length > 0) return err(problems);

  const workload: Workload = {
    format: WORKLOAD_FORMAT,
    id: name.id,
    title: name.title,
    classes,
    levels: observation.levels,
    source: { kind: "metrics", origin, from, to },
  };
  const found = checkWorkload(workload);
  return found.length > 0 ? err(found) : ok(workload);
};
