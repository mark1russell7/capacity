import { isCanonicalUnit, isQuantity } from "@mark1russell7/quantity";
import { deps, parse } from "@mark1russell7/vex";
import { DEFAULT_LEVEL, LAW_FORMAT, MAX_VARIABLES, leastCount, type Law, type LawProblem, type Run, type Variable } from "./law.ts";
import { NAME, SLUG, finite, isUtc, repeated } from "./names.ts";
import { LAW_DOMAINS, recordOf, valuesOf } from "./program.ts";

const COMMIT = /^[0-9a-f]{40}$/;

/**
 * A column of replicates is flat when its width is this share of its largest size or less. The search of a shape
 * stops at a bracket of `SEPARABLE_SEARCH_TOLERANCE` (1e-10) of its start width. Thus a shape at the same edge of its
 * search in each fit gives a flat column. A bootstrap of measured values gives a much wider column.
 */
const FLAT_SHARE = 1e-9;

/** This function gives the middle of the range of a variable, on its scale. */
const middleOf = (variable: Variable): number =>
  variable.scale === "log" ? Math.sqrt(variable.min * variable.max) : (variable.min + variable.max) / 2;

/** This function gives each corner of the ranges of some variables, and their middle. */
const cornersOf = (variables: readonly Variable[]): readonly (readonly number[])[] => {
  const corners: number[][] = [];
  for (let mask = 0; mask < 2 ** variables.length; mask += 1) {
    corners.push(variables.map((variable, index) => ((mask >> index) & 1) === 1 ? variable.max : variable.min));
  }
  return [...corners, variables.map(middleOf)];
};

/**
 * This function examines a law and gives each problem that it finds. A law with no problem gives
 * an empty list.
 *
 * It examines the ids, the units and the ranges. It examines that the program reads each variable
 * and each constant, and no other name. It examines that the law has a finite value at each corner
 * and at the middle of its ranges. It examines that the replicates and the residuals can show an
 * interval of the level 0.95, and that the evidence names its runs. It examines that the noise
 * has a floor of 0 or more, a CPU model and its runs.
 *
 * A law with points must have one point for each residual. Each point must be in the ranges of the
 * variables and name a run of the evidence.
 *
 * The interval of each constant must have a width above 0. A constant with the same value in each
 * replicate is a bound of a search, not a measured value. For example, a shape at the edge of its
 * search in each fit of the bootstrap gives this.
 */
export const checkLaw = (law: Law): readonly LawProblem[] => {
  const problems: LawProblem[] = [];
  const add = (code: LawProblem["code"], path: string, message: string): void => {
    problems.push({ code, path, message });
  };
  const slug = (path: string, value: string): void => {
    if (!SLUG.test(value)) add("id", path, `The id "${value}" is not lower-case words joined by ".", "-" or "/".`);
  };

  if (law.format !== LAW_FORMAT) add("format", "format", `The format is "${String(law.format)}", not "${LAW_FORMAT}".`);
  slug("id", law.id);
  slug("subject", law.subject);
  slug("measure.id", law.measure.id);
  slug("form.id", law.form.id);
  if (law.title.trim() === "") add("id", "title", "The title is empty.");
  if (!isCanonicalUnit(law.measure.unit)) add("unit", "measure.unit", `"${law.measure.unit}" is not a canonical unit.`);

  // The variables: a name, a unit and a range that moves.
  if (law.variables.length > MAX_VARIABLES) {
    add("range", "variables", `The law has ${law.variables.length} variables. The most is ${MAX_VARIABLES}.`);
  }
  law.variables.forEach((variable, index) => {
    const path = `variables[${index}]`;
    if (!NAME.test(variable.id)) add("id", `${path}.id`, `The name "${variable.id}" is not letters and digits that start with a lower-case letter.`);
    if (!isCanonicalUnit(variable.unit)) add("unit", `${path}.unit`, `"${variable.unit}" is not a canonical unit.`);
    if (!finite(variable.min) || !finite(variable.max) || !(variable.min < variable.max)) {
      add("range", path, `The range of "${variable.id}" does not go from a finite number to a larger finite number.`);
    } else if (variable.scale === "log" && !(variable.min > 0)) {
      add("range", path, `The variable "${variable.id}" has the scale "log", thus its range starts above 0.`);
    }
  });
  const variables = law.variables.map((variable) => variable.id);
  const twoVariables = repeated(variables);
  if (twoVariables !== undefined) add("id", "variables", `Two variables have the name "${twoVariables}".`);

  // The conditions: each is a name with a plain value or a quantity.
  for (const [name, value] of Object.entries(law.conditions)) {
    slug(`conditions.${name}`, name);
    if (typeof value === "number" && !finite(value)) add("condition", `conditions.${name}`, `The condition "${name}" is not a finite number.`);
    if (typeof value === "object" && !isQuantity(value)) {
      add("condition", `conditions.${name}`, `The condition "${name}" is not a finite amount in a canonical unit.`);
    }
  }

  // The constants and their replicates.
  const constants = law.constants.map((constant) => constant.id);
  if (constants.length === 0) add("constant", "constants", "The law has no constant.");
  law.constants.forEach((constant, index) => {
    const path = `constants[${index}]`;
    if (!NAME.test(constant.id)) add("id", `${path}.id`, `The name "${constant.id}" is not letters and digits that start with a lower-case letter.`);
    if (!finite(constant.value)) add("constant", `${path}.value`, `The constant "${constant.id}" is not a finite number.`);
    if (variables.includes(constant.id)) add("id", `${path}.id`, `"${constant.id}" names a variable and a constant.`);
  });
  const twoConstants = repeated(constants);
  if (twoConstants !== undefined) add("id", "constants", `Two constants have the name "${twoConstants}".`);

  const least = leastCount(DEFAULT_LEVEL);
  if (law.replicates.length < least) {
    add("replicates", "replicates", `The law has ${law.replicates.length} replicates. The level ${DEFAULT_LEVEL} needs ${least}.`);
  }
  const badRow = law.replicates.findIndex((row) => row.length !== constants.length || !row.every(finite));
  const rowsAreGood = badRow === -1;
  if (!rowsAreGood) {
    add("replicates", `replicates[${badRow}]`, `The replicate ${badRow} does not have one finite number for each constant.`);
  } else if (law.replicates.length > 0) {
    law.constants.forEach((constant, index) => {
      const column = law.replicates.map((row) => row[index] as number);
      const low = Math.min(...column);
      const high = Math.max(...column);
      if (finite(constant.value) && (constant.value < low || constant.value > high)) {
        add("replicates", `constants[${index}].value`, `The constant "${constant.id}" is outside each of its replicates.`);
      }
      if (high - low <= FLAT_SHARE * Math.max(Math.abs(low), Math.abs(high))) {
        add(
          "flat",
          `constants[${index}]`,
          `Each replicate of the constant "${constant.id}" has the value ${low}, thus its interval has a width of 0. ` +
            "A shape at the edge of its search in each fit gives this.",
        );
      }
    });
  }

  // The program: a Vex expression that reads each variable and each constant of this law, and no other name.
  const text = JSON.stringify(law.form.program);
  const parsed = text === undefined ? undefined : parse(text, LAW_DOMAINS);
  if (parsed === undefined || !parsed.ok) {
    add("program", "form.program", "The program is not a Vex expression.");
  } else {
    const names = [...variables, ...constants];
    const reads = new Set<string>();
    for (const read of deps(parsed.value)) {
      const name = read.path.join(".");
      if (read.at.length > 0 || read.axes.length > 0) {
        add("read", "form.program", `The program reads "${name}" at a different record. A law has one record.`);
      } else if (read.path.length !== 1 || !names.includes(name)) {
        add("read", "form.program", `The program reads "${name}". The law has no variable and no constant with this name.`);
      } else {
        reads.add(name);
      }
    }
    for (const name of names) {
      if (!reads.has(name)) add("read", "form.program", `The program does not read "${name}".`);
    }

    // The value: a finite number at each corner and at the middle of the ranges, and for each replicate at the middle.
    const rangesAreGood = !problems.some((found) => found.code === "range" || found.code === "id" || found.code === "constant");
    if (rangesAreGood && rowsAreGood && !problems.some((found) => found.code === "read")) {
      const estimate = law.constants.map((constant) => constant.value);
      const corners = cornersOf(law.variables).map((corner) => recordOf(constants, estimate, recordOf(variables, corner)));
      const atCorners = valuesOf(parsed.value, corners);
      if (atCorners.tag === "err") {
        add("value", "form.program", `The law has no value at a corner or at the middle of its ranges: ${atCorners.error}.`);
      }
      const middle = recordOf(variables, law.variables.map(middleOf));
      const atMiddle = valuesOf(parsed.value, law.replicates.map((row) => recordOf(constants, row, middle)));
      if (atMiddle.tag === "err") {
        add("value", "replicates", `A replicate has no value at the middle of the ranges: ${atMiddle.error}.`);
      }
    }
  }

  // The fit: its residuals and each form that lost.
  if (law.fit.method.trim() === "") add("fit", "fit.method", "The method of the fit is empty.");
  if (law.fit.residuals.length < least) {
    add("fit", "fit.residuals", `The fit has ${law.fit.residuals.length} residuals. The level ${DEFAULT_LEVEL} needs ${least}.`);
  }
  if (!law.fit.residuals.every(finite)) add("fit", "fit.residuals", "A residual is not a finite number.");
  law.fit.losers.forEach((loser, index) => {
    const path = `fit.losers[${index}]`;
    slug(`${path}.form`, loser.form);
    if (loser.form === law.form.id) add("fit", `${path}.form`, `The form "${loser.form}" is the form of the law, thus it did not lose.`);
    const { mae, rmse } = loser.error;
    if (!finite(mae) || !finite(rmse) || mae < 0 || rmse < mae) {
      add("fit", `${path}.error`, `The error of the form "${loser.form}" is not correct: 0 <= mae <= rmse.`);
    }
  });
  const twoLosers = repeated(law.fit.losers.map((loser) => loser.form));
  if (twoLosers !== undefined) add("fit", "fit.losers", `Two losers have the form "${twoLosers}".`);

  // The runs of the evidence and of the noise: each one names its address, its commit and its time.
  const runs = (code: "evidence" | "noise", path: string, list: readonly Run[]): void => {
    if (list.length === 0) add(code, path, "The law names no run.");
    list.forEach((run, index) => {
      const at = `${path}[${index}]`;
      if (!run.url.startsWith("https://")) add(code, `${at}.url`, `The address "${run.url}" does not start with "https://".`);
      if (!COMMIT.test(run.commit)) add(code, `${at}.commit`, `The commit "${run.commit}" is not 40 hexadecimal digits.`);
      if (!isUtc(run.date)) add(code, `${at}.date`, `The date "${run.date}" is not a UTC time, for example "2026-11-18T14:00:00Z".`);
    });
  };
  // The evidence: the runs that measured the points.
  runs("evidence", "evidence.runs", law.evidence.runs);

  // The points of the fit: one for each residual, each in the ranges of the variables, each from a run of the evidence.
  if (law.points !== undefined) {
    if (law.points.length !== law.fit.residuals.length) {
      add("point", "points", `The law has ${law.points.length} points and ${law.fit.residuals.length} residuals. Each point has one residual.`);
    }
    law.points.forEach((point, index) => {
      const path = `points[${index}]`;
      const names = Object.keys(point.load);
      const other = names.find((name) => !variables.includes(name));
      if (other !== undefined) add("point", `${path}.load.${other}`, `The law has no variable "${other}".`);
      for (const variable of law.variables) {
        const load = point.load[variable.id];
        if (load === undefined || !finite(load)) add("point", `${path}.load.${variable.id}`, `The point gives no finite value for the variable "${variable.id}".`);
        else if (load < variable.min || load > variable.max) add("point", `${path}.load.${variable.id}`, `The value ${load} is outside the range of "${variable.id}".`);
      }
      if (!finite(point.value)) add("point", `${path}.value`, "The value is not a finite number.");
      if (!Number.isInteger(point.run) || point.run < 0 || point.run >= law.evidence.runs.length) {
        add("point", `${path}.run`, `The run ${point.run} is not an index of the ${law.evidence.runs.length} runs of the evidence.`);
      }
      if (!Number.isFinite(Date.parse(point.job))) add("point", `${path}.job`, `The job "${point.job}" is not a time.`);
    });
  }

  // The noise: the floor of the measure on one CPU model, and the runs that measured it.
  if (!finite(law.noise.floor) || law.noise.floor < 0) add("noise", "noise.floor", "The noise floor is not a finite number, 0 or more.");
  if (law.noise.cpu.trim() === "") add("noise", "noise.cpu", "The noise names no CPU model.");
  runs("noise", "noise.runs", law.noise.runs);

  return problems;
};
