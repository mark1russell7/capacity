import { err, ok, type Result } from "@mark1russell7/optional";
import { quantity, valueIn, type Quantity } from "@mark1russell7/quantity";
import { mean } from "@mark1russell7/rigor-statistics";
import { metricsGaps } from "./app-check.ts";
import type { AppContract, AppProblem, AppSeries } from "./app.ts";
import { isUtc } from "./names.ts";
import type { Observation, ObservedClass } from "./observe.ts";

/** A reading is one value of one series of an app at one time. `series` is the id of the series, and `at` is a UTC time. */
export interface SeriesReading {
  readonly series: string;
  readonly at: string;
  readonly value: number;
}

/** A window of the live metrics goes from `from` to `to`, two UTC times. Its `origin` names the place of the metrics. */
export interface MetricsWindow {
  readonly origin: string;
  readonly from: string;
  readonly to: string;
}

/**
 * This function gives the increase of a counter from its values in the order of their times. A value below
 * the value before it is a new start of the process. The counter starts again at 0, thus the increase adds
 * the whole value.
 */
export const counterIncrease = (values: readonly number[]): number =>
  values.reduce((total, value, index) => {
    if (index === 0) return total;
    const before = values[index - 1] ?? 0;
    return total + (value >= before ? value - before : value);
  }, 0);

/** This function makes a problem of the readings of an app. */
const readingProblem = (path: string, message: string): AppProblem => ({ code: "series", path, message });

/**
 * This function gives the observation of an app in a window. The observation has the count of the requests of
 * each class, the mean of each request variable and each level. It reads only the readings in the window.
 *
 * - The count of a class is the increase of its counter. A class with no request in the window is not in the observation.
 * - The mean of a request variable is the increase of the counter of its total, over the count of its class.
 * - A level is the mean of the readings of its gauge, with the same weight for each reading. Item CAP-63 adds a weight for the time of each reading.
 *
 * It gives a problem for each gap of the metrics of the app (`metricsGaps`). It also gives a problem for a
 * counter with fewer than 2 readings, and for a gauge with no reading. `observedWorkload` gives the workload
 * of the observation.
 */
export const observationOf = (app: AppContract, window: MetricsWindow, readings: readonly SeriesReading[]): Result<Observation, readonly AppProblem[]> => {
  const { origin, from, to } = window;
  if (!isUtc(from) || !isUtc(to) || !(Date.parse(from) < Date.parse(to))) {
    return err([readingProblem("window", "The window does not go from a UTC time to a later UTC time.")]);
  }
  const problems: AppProblem[] = metricsGaps(app).map((gap) => readingProblem("metrics", gap.message));
  const start = Date.parse(from);
  const end = Date.parse(to);

  /** This function gives the values of a series in the window, in the order of their times. */
  const valuesOf = (series: AppSeries): readonly number[] =>
    readings
      .filter((reading) => reading.series === series.id && isUtc(reading.at) && Date.parse(reading.at) >= start && Date.parse(reading.at) <= end)
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
      .map((reading) => reading.value)
      .filter((value) => Number.isFinite(value));

  /** This function gives the increase of a counter in the window, in the unit of the series, or a problem. */
  const increaseOf = (series: AppSeries): number | undefined => {
    const values = valuesOf(series);
    if (values.length >= 2) return counterIncrease(values);
    problems.push(readingProblem(`readings.${series.id}`, `The counter "${series.id}" has ${values.length} readings in the window. Its increase needs 2 or more.`));
    return undefined;
  };

  const classes: ObservedClass[] = [];
  for (const entry of app.classes) {
    const counter = app.metrics.find((series) => "rate" in series.of && series.of.rate === entry.id);
    if (counter === undefined) continue;
    const count = increaseOf(counter);
    if (count === undefined || count === 0) continue;
    const request: Record<string, Quantity> = {};
    for (const name of entry.request) {
      const total = app.metrics.find((series) => "total" in series.of && series.of.total === name && series.of.class === entry.id);
      const variable = app.variables.find((each) => each.id === name);
      if (total === undefined || variable === undefined) continue;
      const sum = increaseOf(total);
      if (sum !== undefined) request[name] = quantity(valueIn(quantity(sum, total.unit), variable.unit) / count, variable.unit);
    }
    classes.push({ id: entry.id, count: quantity(count, counter.unit), request });
  }

  const levels: Record<string, Quantity> = {};
  for (const variable of app.variables) {
    if (variable.kind !== "level") continue;
    const gauge = app.metrics.find((series) => "level" in series.of && series.of.level === variable.id);
    if (gauge === undefined) continue;
    const values = valuesOf(gauge);
    if (values.length === 0) {
      problems.push(readingProblem(`readings.${gauge.id}`, `The gauge "${gauge.id}" has no reading in the window.`));
      continue;
    }
    levels[variable.id] = quantity(valueIn(quantity(mean(values), gauge.unit), variable.unit), variable.unit);
  }
  return problems.length > 0 ? err(problems) : ok({ origin, from, to, classes, levels });
};
