/**
 * The curve of a law: its value with an interval at each step of its variable, and its knee. This module has no browser code.
 * The functions `lawValue` and `lawKnee` of `@mark1russell7/capacity` give the values, thus the page and the lab use one rule.
 */
import { lawKnee, lawValue, type KneeRule, type Law } from "@mark1russell7/capacity";
import { BYTES_1024, DURATION_MS, formatOnScale, formatUnit, quantity, valueIn, type Scale } from "@mark1russell7/quantity";

/** These scales of `@mark1russell7/quantity` print the amounts of the units of the laws that have a scale. */
const SCALES: Readonly<Record<string, Scale>> = { B: BYTES_1024, ms: DURATION_MS };

/** This function gives a number with 3 significant digits, in the plain form for a number from 0.001 to 1000000. */
export const significant = (value: number): string => {
  const size = Math.abs(value);
  return size !== 0 && (size < 1e-3 || size >= 1e6) ? value.toExponential(2) : Number(value.toPrecision(3)).toString();
};

/**
 * This function gives the text of an amount in a unit of a law. A unit with a scale shows in the step of the scale that
 * fits the amount, for example "30 MiB". Another unit shows with 3 significant digits and the words of the unit.
 */
export const amountText = (value: number, unit: string): string => {
  const scale = SCALES[unit];
  if (scale !== undefined) return formatOnScale(quantity(value, unit), scale);
  return `${significant(value)} ${formatUnit(unit, Math.abs(value) !== 1)}`;
};

/** An axis unit is the unit of the labels of an axis, and the amount of the unit of the law in one of it. */
export interface AxisUnit {
  readonly unit: string;
  readonly factor: number;
}

/** This function gives the unit of an axis: the largest step of the scale of the unit that the top of the axis fills. */
export const axisUnit = (unit: string, top: number): AxisUnit => {
  const scale = SCALES[unit];
  let best: AxisUnit = { unit, factor: 1 };
  for (const step of scale?.steps ?? []) {
    const factor = valueIn(quantity(1, step.unit), unit);
    if (Math.abs(top) >= factor) best = { unit: step.unit, factor };
  }
  return best;
};

/** This function gives the words of a unit for the title of an axis, for example "requests/s". */
export const unitWords = (unit: string): string => formatUnit(unit, true);

/** This function gives about `count` round ticks from `low` to `high`, at steps of 1, 2 or 5 times a power of 10. */
export const linearTicks = (low: number, high: number, count = 5): readonly number[] => {
  if (!(high > low)) return [low];
  const rough = (high - low) / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 5, 10].find((each) => each * power >= rough) ?? 10) * power;
  const ticks: number[] = [];
  for (let tick = Math.ceil(low / step - 1e-9) * step; tick <= high + step * 1e-9; tick += step) ticks.push(Number(tick.toPrecision(12)));
  return ticks;
};

/** This function gives the ticks of a log axis from `low` to `high`. They are each power of 10, and 2 and 5 times it on a short axis of 3 decades or fewer. */
export const logTicks = (low: number, high: number): readonly number[] => {
  if (!(low > 0 && high > low)) return [low];
  const decades = Math.log10(high / low);
  const marks = decades <= 3 ? [1, 2, 5] : [1];
  const ticks: number[] = [];
  for (let power = Math.floor(Math.log10(low)); power <= Math.ceil(Math.log10(high)); power++) {
    for (const mark of marks) {
      const tick = Number((mark * 10 ** power).toPrecision(12));
      if (tick >= low * (1 - 1e-9) && tick <= high * (1 + 1e-9)) ticks.push(tick);
    }
  }
  return ticks;
};

/** A curve point is the value of a law at one amount of its variable, with the interval of the replicates. */
export interface CurvePoint {
  readonly x: number;
  readonly value: number;
  readonly low: number;
  readonly high: number;
}

/** A curve knee is the amount of the variable where the knee rule of the measure applies, with its interval. */
export interface CurveKnee {
  readonly rule: KneeRule;
  readonly value: number | null;
  readonly low: number | null;
  readonly high: number | null;
}

/**
 * A curve run is one point of the fit of a law: the amount of the variable and the value of the measure. `run` is the
 * index of its run in the evidence of the law, and `date` is the date of that run.
 */
export interface CurveRun {
  readonly x: number;
  readonly value: number;
  readonly run: number;
  readonly date: string | undefined;
}

/**
 * A curve is the points of a law over its variable, its knee or the reason for no knee, and the level of its intervals.
 * The list `runs` has the points of the fit of the law. A law file with no points gives an empty list.
 */
export interface Curve {
  readonly variable: Law["variables"][number];
  readonly unit: string;
  readonly level: number;
  readonly points: readonly CurvePoint[];
  readonly runs: readonly CurveRun[];
  readonly knee: CurveKnee | undefined;
  /** This text tells why the curve has no knee: no rule for the measure, or a problem of the rule. */
  readonly noKnee: string | undefined;
}

/** This count is the steps of a curve. It is sufficient for a smooth line in a width of 640 px. */
export const CURVE_STEPS = 48;

/** This function gives `steps` amounts from `min` to `max`, at equal ratios for the scale `log` and at equal distances for the scale `linear`. */
export const stepsOf = (min: number, max: number, scale: "log" | "linear", steps = CURVE_STEPS): readonly number[] => {
  if (steps < 2 || max <= min) return [min];
  const log = scale === "log" && min > 0;
  return Array.from({ length: steps }, (_, index) => {
    const share = index / (steps - 1);
    return log ? Math.exp(Math.log(min) + share * (Math.log(max) - Math.log(min))) : min + share * (max - min);
  });
};

/** This function gives the points of the fit of a law at its variable `variable`, with the date of the run of each point. */
export const runsOf = (law: Law, variable: string): readonly CurveRun[] =>
  (law.points ?? []).flatMap((point) => {
    const x = point.load[variable];
    if (x === undefined || !Number.isFinite(x) || !Number.isFinite(point.value)) return [];
    return [{ x, value: point.value, run: point.run, date: law.evidence.runs[point.run]?.date }];
  });

/** This function tells the points of the fit of a curve in one sentence. A curve with no points gives an empty text. */
export const runsSentence = (curve: Curve): string => {
  const count = curve.runs.length;
  if (count === 0) return "";
  const runs = new Set(curve.runs.map((each) => each.run)).size;
  return `The dots are the ${count} points of the fit, from ${runs} ${runs === 1 ? "run" : "runs"}.`;
};

/**
 * This function gives the curve of a law with one variable. A law with more variables gives a text, because its curve
 * needs an amount of each other variable. A step where the law has no value is not in the points. The curve also has
 * the points of the fit of the law (`runsOf`).
 */
export const curveOf = (law: Law, rule: KneeRule | undefined, steps = CURVE_STEPS): Curve | string => {
  const [variable, ...others] = law.variables;
  if (variable === undefined) return "The law has no variable.";
  if (others.length > 0) return `The law has ${law.variables.length} variables. The page draws the curve of a law with one variable only.`;
  const scale = variable.scale === "log" ? "log" : "linear";
  let level = 0.95;
  const points: CurvePoint[] = [];
  for (const x of stepsOf(variable.min, variable.max, scale, steps)) {
    const read = lawValue(law, { [variable.id]: x });
    if (read.tag !== "ok") continue;
    level = read.value.level;
    points.push({ x, value: read.value.value, low: read.value.interval.low, high: read.value.interval.high });
  }
  if (points.length === 0) return "The law has no value in the range of its variable.";
  const runs = runsOf(law, variable.id);
  if (rule === undefined) return { variable, unit: law.measure.unit, level, points, runs, knee: undefined, noKnee: "The lab gives no knee rule for this measure." };
  const knee = lawKnee(law, variable.id, rule);
  if (knee.tag !== "ok") return { variable, unit: law.measure.unit, level, points, runs, knee: undefined, noKnee: knee.error.message };
  const found = knee.value.knee;
  return { variable, unit: law.measure.unit, level, points, runs, knee: { rule, value: found.value, low: found.interval.low, high: found.interval.high }, noKnee: undefined };
};

/** This function tells a knee rule in words, with the words of `lawKnee` of capacity. */
export const ruleText = (rule: KneeRule): string => {
  const times = (share: number): string => String(Number((1 + share).toPrecision(3)));
  if (rule.kind === "rise") return `the value is more than ${times(rule.share)} times its value at the start of the range`;
  if (rule.kind === "slope") return `the slope is more than ${rule.factor} times its slope at the start of the range`;
  return `the value is more than ${times(rule.share)} times its floor, the least value of the law`;
};

/** This function tells the knee of a curve in one sentence, or why the curve has no knee. */
export const kneeSentence = (curve: Curve): string => {
  const unit = curve.variable.unit;
  if (curve.knee === undefined) return curve.noKnee ?? "The curve has no knee.";
  const { value, low, high, rule } = curve.knee;
  if (value === null) return `The curve has no knee in the range of ${curve.variable.id}. The rule of a knee: ${ruleText(rule)}.`;
  const from = low === null ? "the start of the range" : amountText(low, unit);
  const to = high === null ? "past the end of the range" : amountText(high, unit);
  return `The knee is at ${amountText(value, unit)} (${Math.round(curve.level * 100)} % interval ${from} to ${to}). There ${ruleText(rule)}.`;
};
