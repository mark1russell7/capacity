import { valueIn } from "@mark1russell7/quantity";
import { familyPoints, latinHypercube, oneAtATimePoints, random, type InputFamily, type Point } from "@mark1russell7/rigor-generators";
import { errorMessage } from "@mark1russell7/text";
import { CASE_RATE, MAX_ARRIVALS, MAX_DURATION, caseLevel, caseProblems, requestClassOf, type Case, type CaseProblem } from "./case.ts";
import { FIELDS, LIMITS, UNITS, type Field } from "./subject/class.ts";

/**
 * A load variable is one amount of a case of load that a design moves. `rate` is the rate of the class. The fields of a
 * request class are the amounts of each request. `concurrency` is the size of the pool of connections. `heap` is the
 * level of the live heap. `age` is the duration of each run, thus the age of the process at the end of a run.
 */
export type LoadVariableId = "rate" | Field | "concurrency" | "heap" | "age";

/** These ids are the load variables, in the order of the grid. */
export const LOAD_VARIABLE_IDS: readonly LoadVariableId[] = ["rate", ...FIELDS, "concurrency", "heap", "age"];

/** These units are the unit of each load variable. Each amount of a design is a whole number in its unit. */
export const LOAD_UNITS: Readonly<Record<LoadVariableId, string>> = { rate: CASE_RATE, ...UNITS, concurrency: "{connection}", heap: "B", age: "ms" };

/**
 * A grid variable gives the range and the scale of one load variable in a design. On the scale `log`, the logarithm of
 * the amount is uniform, and the range starts above 0. Each amount is a whole number from `min` to `max` in the unit of
 * the variable (`LOAD_UNITS`).
 */
export interface GridVariable {
  readonly id: LoadVariableId;
  readonly title: string;
  readonly min: number;
  readonly max: number;
  readonly scale: "linear" | "log";
}

/**
 * This grid is the default range and scale of each load variable of a case of load. Each scale is `log`, because a law
 * of a load variable spans orders of magnitude. The rate and the age together fit `MAX_ARRIVALS` for 3 runs and the
 * warm-up run. Thus 9000 requests each second for 4 seconds in 4 runs are 144000 arrivals. A design with other needs gives its own grid.
 */
export const LOAD_GRID: readonly GridVariable[] = [
  { id: "rate", title: "The rate of the requests", min: 1, max: 9000, scale: "log" },
  { id: "body", title: "The bytes of the body of a request", min: 1, max: 1_048_576, scale: "log" },
  { id: "alloc", title: "The bytes that a request allocates and then drops", min: 1, max: 16_777_216, scale: "log" },
  { id: "work", title: "The CPU time of a request on the main thread", min: 1, max: 10_000, scale: "log" },
  { id: "wait", title: "The wait of a request with no CPU time", min: 1, max: 1000, scale: "log" },
  { id: "reply", title: "The bytes of the body of a reply", min: 1, max: 1_048_576, scale: "log" },
  { id: "concurrency", title: "The connections of the pool, each with one request in flight", min: 1, max: 256, scale: "log" },
  { id: "heap", title: "The live heap that the subject holds", min: 1_048_576, max: 268_435_456, scale: "log" },
  { id: "age", title: "The duration of each run", min: 1000, max: 4000, scale: "log" },
];

/** These amounts are the largest amount of each load variable that a case can have, in the unit of the variable. */
const LOAD_LIMITS: Readonly<Record<LoadVariableId, number>> = {
  rate: MAX_ARRIVALS,
  ...LIMITS,
  concurrency: 1024,
  heap: Number.MAX_SAFE_INTEGER,
  age: valueIn(MAX_DURATION, "ms"),
};

/**
 * A load design moves the load variables of a base case. With the seed, the same design gives the same cases. `alone` is
 * the count of points of each variable alone, with the others at their values in the base case. `together` is the count
 * of points of a Latin hypercube of all the variables together. A count of 0 gives no point.
 */
export interface LoadDesign {
  readonly seed: string;
  /** These ids are the variables that the design moves, in the order of the blocks of `alone`. */
  readonly variables: readonly LoadVariableId[];
  readonly alone: number;
  readonly together: number;
}

/** A grid problem tells what is not correct in a grid or a design, and where. */
export interface GridProblem {
  readonly path: string;
  readonly message: string;
}

/**
 * This function examines a grid and gives each problem that it finds. Each id is a load variable and is in the grid one
 * time. Each range has whole ends from 0 up to the limit of the variable, and a range on the scale `log` starts above 0.
 */
export const gridProblems = (grid: readonly GridVariable[]): readonly GridProblem[] =>
  grid.flatMap((variable, index) => {
    const path = `grid[${index}]`;
    if (!LOAD_VARIABLE_IDS.includes(variable.id)) return [{ path: `${path}.id`, message: `"${variable.id}" is not a load variable. The load variables are ${LOAD_VARIABLE_IDS.join(", ")}.` }];
    if (grid.findIndex((each) => each.id === variable.id) !== index) return [{ path: `${path}.id`, message: `The grid has the variable "${variable.id}" two times.` }];
    const limit = LOAD_LIMITS[variable.id];
    const whole = Number.isSafeInteger(variable.min) && Number.isSafeInteger(variable.max);
    if (!whole || variable.min < 0 || variable.min > variable.max || variable.max > limit) {
      return [{ path, message: `The range of "${variable.id}" is not whole numbers of ${LOAD_UNITS[variable.id]} from 0 to ${limit}, with min up to max.` }];
    }
    if (variable.scale === "log" && variable.min < 1) return [{ path: `${path}.min`, message: `The range of "${variable.id}" is on the scale log, thus it starts at 1 or more.` }];
    return [];
  });

/** This function gives the one class of a base case, and throws a `RangeError` for a case with more classes. */
const onlyClass = (base: Case): Case["demand"]["classes"][number] => {
  const [entry, ...rest] = base.demand.classes;
  if (entry === undefined || rest.length > 0) throw new RangeError(`The base case "${base.id}" has ${base.demand.classes.length} classes. A load design moves a case of one class.`);
  return entry;
};

/**
 * This function gives the amount of each load variable in a base case, in the unit of the variable. A field that the
 * request does not name is 0, and a level that the demand does not hold is 0. The function throws a `RangeError` when
 * the design moves the concurrency of a case with no pool of connections.
 */
export const loadOfCase = (base: Case, ids: readonly LoadVariableId[]): Point => {
  const entry = onlyClass(base);
  const request = requestClassOf(entry.request);
  const amountOf = (id: LoadVariableId): number => {
    if (id === "rate") return valueIn(entry.rate, CASE_RATE);
    if (id === "concurrency") {
      if (base.connections?.mode !== "pool") throw new RangeError(`The base case "${base.id}" has no pool of connections, thus a design cannot move its concurrency.`);
      return base.connections.size;
    }
    if (id === "heap") return caseLevel(base, "heap");
    if (id === "age") return valueIn(base.duration, "ms");
    return request[id];
  };
  return Object.fromEntries(ids.map((id) => [id, amountOf(id)]));
};

/** This function gives the case of a point: the base case with the amount of each variable of the point. */
const caseAt = (base: Case, id: string, title: string, point: Point): Case => {
  const entry = onlyClass(base);
  let { connections, duration } = base;
  let rate = entry.rate;
  const request = { ...entry.request };
  const levels = { ...base.demand.levels };
  for (const [name, value] of Object.entries(point)) {
    if (name === "rate") rate = { value, unit: CASE_RATE };
    else if (name === "concurrency") connections = { mode: "pool", size: value };
    else if (name === "heap") levels["heap"] = { value, unit: LOAD_UNITS.heap };
    else if (name === "age") duration = { value, unit: LOAD_UNITS.age };
    else request[name] = { value, unit: LOAD_UNITS[name as Field] };
  }
  return { ...base, id, title, ...(connections === undefined ? {} : { connections }), duration, demand: { ...base.demand, classes: [{ ...entry, rate, request }], levels } };
};

/** This function gives the text of the amounts of a point, for the title of a case. */
const amountsText = (point: Point): string =>
  Object.entries(point)
    .map(([name, value]) => `${name} ${value} ${LOAD_UNITS[name as LoadVariableId]}`)
    .join(", ");

/**
 * This function gives the cases of a load design over a base case. The cases of each variable alone come first, in the
 * order of `design.variables`, from `oneAtATimePoints` of `@mark1russell7/rigor-generators`. The id of the case `k` of
 * a variable is `<base id>/<variable>/<k>`, from 1. Then the cases of all the variables together come from a Latin
 * hypercube, with the ids `<base id>/together/<k>`. A case of a variable alone changes only that variable of the base case.
 * The function throws a `RangeError` for a design with a problem (`designProblems`).
 */
export const designCases = (base: Case, design: LoadDesign, grid: readonly GridVariable[] = LOAD_GRID): readonly Case[] => {
  const found = designShapeProblems(design, grid);
  if (found.length > 0) throw new RangeError(found.map((each) => `${each.path}: ${each.message}`).join(" "));
  const family: InputFamily = {
    name: "load",
    dimensions: design.variables.map((id) => {
      const variable = grid.find((each) => each.id === id)!;
      return { name: id, min: variable.min, max: variable.max, scale: variable.scale, integer: true };
    }),
  };
  const r = random(design.seed);
  const alone =
    design.alone === 0
      ? []
      : oneAtATimePoints(family, design.alone, loadOfCase(base, design.variables), r.fork("alone")).map((point, index) => {
          const name = design.variables[Math.floor(index / design.alone)]!;
          const moved = { [name]: point[name]! };
          return caseAt(base, `${base.id}/${name}/${(index % design.alone) + 1}`, `${base.title}, with ${amountsText(moved)}`, moved);
        });
  const together =
    design.together === 0
      ? []
      : familyPoints(family, latinHypercube(design.together, family.dimensions.length, r.fork("together")), r.fork("together-map")).map((point, index) =>
          caseAt(base, `${base.id}/together/${index + 1}`, `${base.title}, with ${amountsText(point)}`, point),
        );
  return [...alone, ...together];
};

/** This function gives the problems of the shape of a design: its seed, its variables and its counts. */
const designShapeProblems = (design: LoadDesign, grid: readonly GridVariable[]): readonly GridProblem[] => {
  const problems: GridProblem[] = [...gridProblems(grid)];
  if (design.seed.length === 0) problems.push({ path: "seed", message: "The design has no seed." });
  if (design.variables.length === 0) problems.push({ path: "variables", message: "The design moves no variable." });
  design.variables.forEach((id, index) => {
    if (!grid.some((each) => each.id === id)) problems.push({ path: `variables[${index}]`, message: `The grid has no variable "${id}".` });
    else if (design.variables.indexOf(id) !== index) problems.push({ path: `variables[${index}]`, message: `The design moves "${id}" two times.` });
  });
  for (const count of ["alone", "together"] as const) {
    if (!Number.isSafeInteger(design[count]) || design[count] < 0) problems.push({ path: count, message: `The count "${count}" is not a whole number, 0 or more.` });
  }
  return problems;
};

/**
 * This function examines a design over a base case and gives each problem that it finds. First it gives the problems of
 * its grid and its shape. Then it gives the problems of each case (`caseProblems`), with the id of the case in the path.
 * A design with no problem gives an empty list.
 */
export const designProblems = (base: Case, design: LoadDesign, grid: readonly GridVariable[] = LOAD_GRID): readonly GridProblem[] => {
  const shape = designShapeProblems(design, grid);
  if (shape.length > 0) return shape;
  let cases: readonly Case[];
  try {
    cases = designCases(base, design, grid);
  } catch (error) {
    return [{ path: "base", message: errorMessage(error) }];
  }
  return cases.flatMap((each) => caseProblems(each).map((found: CaseProblem) => ({ path: `${each.id}.${found.path}`, message: found.message })));
};

