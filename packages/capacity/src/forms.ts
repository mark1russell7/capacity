import { err, ok, type Result } from "@mark1russell7/optional";
import { fitSeparable, SEPARABLE_MAX_COMBINATIONS, type SeparableFit, type SeparableModel } from "@mark1russell7/rigor-statistics";
import { app, let_, lit, ref, v, type Expr } from "@mark1russell7/vex";
import type { Constant, Form } from "./law.ts";
import { valuesOf } from "./program.ts";

/** This name is the name of the load variable in the programs of the catalog. A binding gives its id in a law. */
export const FORM_VARIABLE = "x";

/**
 * A term is one part of a form: its constant times its basis. The basis and its slope read the
 * variable and the shape constants of the form with `v(name)`. The slope is the change of the basis
 * for each unit of the variable.
 */
export interface Term {
  readonly constant: string;
  readonly basis: Expr;
  readonly slope: Expr;
}

/**
 * A grid gives the start candidates of one shape constant from the points of a fit.
 *
 * - `inside` gives each distinct value of the variable inside its range, and each middle of two
 *   values that follow. A knee starts at these values.
 * - `scaled` gives each factor times the largest size of the variable to the `power`. With the power
 *   0, the candidates are the factors.
 */
export type Grid =
  | { readonly kind: "inside" }
  | { readonly kind: "scaled"; readonly factors: readonly number[]; readonly power: number };

/**
 * The bounds tell where the refine of a fit can move a shape constant. They come from the points of the fit.
 *
 * - `range` is from the least value of the variable to its largest value. A knee is inside the range.
 * - `size` is from the largest size of the variable up. The capacity of a queue is past each load.
 * - `least` is from `value` up.
 */
export type Bounds = { readonly kind: "range" } | { readonly kind: "size" } | { readonly kind: "least"; readonly value: number };

/**
 * A shape constant changes the shape of a form, not its size. A fit starts it at each value of its grid. Then the fit
 * refines it inside its bounds. A shape with no bounds has no limit.
 */
export interface Shape {
  readonly id: string;
  readonly grid: Grid;
  readonly bounds?: Bounds;
}

/**
 * A catalog form is the math of a law of one variable, as data. Its value is the sum of its terms.
 * Thus, with fixed shape constants, a fit of a form is linear in the constants of its terms.
 */
export interface CatalogForm {
  readonly id: string;
  readonly title: string;
  readonly terms: readonly Term[];
  readonly shapes: readonly Shape[];
}

/**
 * A binding puts a catalog form into a law. It gives the id of the variable in the law, and the id
 * in the law of each constant. A constant with no entry keeps its id from the catalog.
 */
export interface Binding {
  readonly variable: string;
  readonly constants?: Readonly<Record<string, string>>;
}

/** The points of a fit: the value of the variable and the measured value of each point, in the same order. */
export interface Points {
  readonly x: readonly number[];
  readonly y: readonly number[];
}

/** A start is the start values of the constants of a form, and the sum of the squared residuals at these values. */
export interface Start {
  readonly constants: readonly Constant[];
  readonly rss: number;
}

const x = v(FORM_VARIABLE);
const one = lit(1);
const zero = lit(0);
const add = (...parts: readonly Expr[]): Expr => parts.reduce((sum, part) => app("add", sum, part));
const times = (a: Expr, b: Expr): Expr => app("multiply", a, b);
const over = (a: Expr, b: Expr): Expr => app("divide", a, b);
const less = (a: Expr, b: Expr): Expr => app("subtract", a, b);
const square = (a: Expr): Expr => app("pow", a, lit(2));
const scaled = (factors: readonly number[], power: number): Grid => ({ kind: "scaled", factors, power });
const positive: Bounds = { kind: "least", value: 0 };

/** The base term: a constant amount. Its slope is 0. */
const base: Term = { constant: "base", basis: one, slope: zero };

/** The denominator of the scalability law: `1 + contention·(x − 1) + coherency·x·(x − 1)`. */
const contention = add(one, times(v("contention"), less(x, one)), times(times(v("coherency"), x), less(x, one)));

/**
 * The catalog of the forms of a law, in the order of the roadmap. Each form is a sum of terms.
 *
 * - `constant`: `base`.
 * - `linear`: `base + slope·x`.
 * - `power`: `base + scale·x^exponent`.
 * - `logarithm`: `base + scale·ln(x)`.
 * - `hinge`: `base + slope·x + bend·max(0, x − knee)`. After the knee the slope is `slope + bend`.
 * - `queue`: `base + scale·capacity / (capacity − x)`. This is the delay of a queue. The form has no
 *   finite value at the capacity.
 * - `scalability`: `unit·x / (1 + contention·(x − 1) + coherency·x·(x − 1))`. This is the
 *   universal scalability law of the throughput at a concurrency `x`.
 * - `drift`: `base + drift·x + warm·(1 − e^(−x / settle))`. This is a measure over the age of a
 *   process: a warm-up that settles, and a steady drift.
 */
export const FORMS: readonly CatalogForm[] = [
  { id: "constant", title: "A constant", terms: [base], shapes: [] },
  { id: "linear", title: "A line", terms: [base, { constant: "slope", basis: x, slope: one }], shapes: [] },
  {
    id: "power",
    title: "A power of the variable",
    terms: [
      base,
      {
        constant: "scale",
        basis: app("pow", x, v("exponent")),
        slope: times(v("exponent"), app("pow", x, less(v("exponent"), one))),
      },
    ],
    shapes: [{ id: "exponent", grid: scaled([-1, -0.5, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3], 0) }],
  },
  {
    id: "logarithm",
    title: "A logarithm of the variable",
    terms: [base, { constant: "scale", basis: app("ln", x), slope: over(one, x) }],
    shapes: [],
  },
  {
    id: "hinge",
    title: "Two lines that join at a knee",
    terms: [
      base,
      { constant: "slope", basis: x, slope: one },
      {
        constant: "bend",
        basis: app("max", zero, less(x, v("knee"))),
        slope: app("if", app("gt", x, v("knee")), one, zero),
      },
    ],
    shapes: [{ id: "knee", grid: { kind: "inside" }, bounds: { kind: "range" } }],
  },
  {
    id: "queue",
    title: "The delay of a queue",
    terms: [
      base,
      {
        constant: "scale",
        basis: over(v("capacity"), less(v("capacity"), x)),
        slope: over(v("capacity"), square(less(v("capacity"), x))),
      },
    ],
    shapes: [{ id: "capacity", grid: scaled([1.02, 1.05, 1.1, 1.2, 1.5, 2, 3, 5, 10], 1), bounds: { kind: "size" } }],
  },
  {
    id: "scalability",
    title: "The universal scalability law",
    terms: [
      {
        constant: "unit",
        basis: over(x, contention),
        // (D − x·D′) / D², with D′ = contention + coherency·(2x − 1): this is (1 − contention − coherency·x²) / D²
        slope: over(less(less(one, v("contention")), times(v("coherency"), square(x))), square(contention)),
      },
    ],
    shapes: [
      { id: "contention", grid: scaled([0, 0.01, 0.03, 0.1, 0.2, 0.4, 0.7], 0), bounds: positive },
      { id: "coherency", grid: scaled([0, 0.1, 0.3, 1, 3, 10], -2), bounds: positive },
    ],
  },
  {
    id: "drift",
    title: "A warm-up and a drift with age",
    terms: [
      base,
      { constant: "drift", basis: x, slope: one },
      {
        constant: "warm",
        basis: less(one, app("exp", app("negate", over(x, v("settle"))))),
        slope: over(app("exp", app("negate", over(x, v("settle")))), v("settle")),
      },
    ],
    shapes: [{ id: "settle", grid: scaled([0.01, 0.03, 0.1, 0.3, 1, 3], 1), bounds: positive }],
  },
];

/** This function gives the form of the catalog with the id, or undefined. */
export const catalogForm = (id: string): CatalogForm | undefined => FORMS.find((form) => form.id === id);

/** This function gives the ids of the constants of a form: the constant of each term, then each shape constant. */
export const constantIdsOf = (form: CatalogForm): readonly string[] => [
  ...form.terms.map((term) => term.constant),
  ...form.shapes.map((shape) => shape.id),
];

/** This function gives the sum of the terms of a form, with `part` for each term. A term of 0 does not count. */
const sumOf = (form: CatalogForm, part: (term: Term) => Expr): Expr => {
  const parts = form.terms
    .map((term) => ({ term, expr: part(term) }))
    .filter(({ expr }) => !(expr.tag === "lit" && expr.value === 0))
    .map(({ term, expr }) => (expr.tag === "lit" && expr.value === 1 ? v(term.constant) : times(v(term.constant), expr)));
  return parts.length === 0 ? zero : add(...parts);
};

/** This function binds the names `ids` of a form and its variable to the reads of a law. */
const bind = (ids: readonly string[], binding: Binding, body: Expr): Expr =>
  let_(Object.fromEntries([[FORM_VARIABLE, ref(binding.variable)], ...ids.map((id) => [id, ref(binding.constants?.[id] ?? id)])]), body);

/** This function binds each name of a form to the reads of a law: the variable and each constant. */
const bound = (form: CatalogForm, binding: Binding, body: Expr): Expr => bind(constantIdsOf(form), binding, body);

/** This function gives the program of the value of a form in a law. It reads the variable and each constant of the binding. */
export const programOf = (form: CatalogForm, binding: Binding): Expr => bound(form, binding, sumOf(form, (term) => term.basis));

/** This function gives the program of the slope of a form in a law: the change of its value for each unit of the variable. */
export const slopeOf = (form: CatalogForm, binding: Binding): Expr => bound(form, binding, sumOf(form, (term) => term.slope));

/** This function gives the form of a law from a form of the catalog. */
export const formOf = (form: CatalogForm, binding: Binding): Form => ({ id: form.id, program: programOf(form, binding) });

const records = (xs: readonly number[], constants: Readonly<Record<string, number>>): Readonly<Record<string, number>>[] =>
  xs.map((value) => ({ ...constants, [FORM_VARIABLE]: value }));

/** This function gives the value of a form at each value of its variable, or the text of the first error. */
export const formValues = (
  form: CatalogForm,
  xs: readonly number[],
  constants: Readonly<Record<string, number>>,
): Result<readonly number[], string> => valuesOf(programOf(form, { variable: FORM_VARIABLE }), records(xs, constants));

/** This function gives the slope of a form at each value of its variable, or the text of the first error. */
export const formSlopes = (
  form: CatalogForm,
  xs: readonly number[],
  constants: Readonly<Record<string, number>>,
): Result<readonly number[], string> => valuesOf(slopeOf(form, { variable: FORM_VARIABLE }), records(xs, constants));

/** This function gives the largest size of the values of a variable. */
const sizeOf = (xs: readonly number[]): number => xs.reduce((most, value) => Math.max(most, Math.abs(value)), 0);

/** This function gives the candidates of a grid for the values of a variable. */
export const gridOf = (grid: Grid, xs: readonly number[]): readonly number[] => {
  if (grid.kind === "scaled") {
    const size = sizeOf(xs);
    return grid.power === 0 ? grid.factors : size === 0 ? [] : grid.factors.map((factor) => factor * size ** grid.power);
  }
  const distinct = [...new Set(xs)].sort((a, b) => a - b);
  const middles = distinct.slice(1).map((value, index) => (value + (distinct[index] as number)) / 2);
  const low = distinct[0] ?? 0;
  const high = distinct.at(-1) ?? 0;
  return [...distinct, ...middles].filter((value) => value > low && value < high).sort((a, b) => a - b);
};

/** This function gives the bounds of the refine of a shape constant for the values of a variable. */
const boundsOf = (bounds: Bounds | undefined, xs: readonly number[]): { readonly min?: number; readonly max?: number } => {
  if (bounds === undefined) return {};
  if (bounds.kind === "least") return { min: bounds.value };
  if (bounds.kind === "size") return { min: sizeOf(xs) };
  return {
    min: xs.reduce((least, value) => Math.min(least, value), Number.POSITIVE_INFINITY),
    max: xs.reduce((most, value) => Math.max(most, value), Number.NEGATIVE_INFINITY),
  };
};

/**
 * This function gives a form of the catalog as a separable model of `@mark1russell7/rigor-statistics`. Each term is
 * one column of the design: the basis of the term at each point. The candidates and the bounds of each shape constant
 * come from the values `xs` of the variable. The design is null when a basis has no finite value at a point.
 */
export const separableOf = (form: CatalogForm, xs: readonly number[]): SeparableModel<number> => {
  const ids = form.shapes.map((shape) => shape.id);
  // a basis reads the variable and the shape constants, not the constants of the terms
  const bases = form.terms.map((term) => bind(ids, { variable: FORM_VARIABLE }, term.basis));
  return {
    terms: form.terms.map((term) => term.constant),
    shapes: form.shapes.map((shape) => ({ id: shape.id, candidates: gridOf(shape.grid, xs), ...boundsOf(shape.bounds, xs) })),
    design: (values, points) => {
      const at = Object.fromEntries(ids.map((id, index) => [id, values[index] as number]));
      const columns: (readonly number[])[] = [];
      for (const basis of bases) {
        const column = valuesOf(basis, records(points, at));
        if (column.tag === "err") return null;
        columns.push(column.value);
      }
      return points.map((_, row) => columns.map((column) => column[row] as number));
    },
  };
};

/** This function gives the constants of a form from a separable fit: the constant of each term, then each shape constant. */
export const constantsOf = (form: CatalogForm, fit: Pick<SeparableFit, "coefficients" | "shapes">): readonly Constant[] => [
  ...form.terms.map((term, index) => ({ id: term.constant, value: fit.coefficients[index] as number })),
  ...form.shapes.map((shape, index) => ({ id: shape.id, value: fit.shapes[index] as number })),
];

/** This function gives the text of the first fault of the points of a fit, or undefined. */
export const pointsProblem = (points: Points): string | undefined => {
  if (points.x.length === 0) return "The fit has no points.";
  if (points.x.length !== points.y.length) return `The points have ${points.x.length} values of x and ${points.y.length} values of y.`;
  if (![...points.x, ...points.y].every(Number.isFinite)) return "A point has a value that is not a finite number.";
  return undefined;
};

/** This function gives the text of the reason that the model of a form has no start, or undefined. */
export const modelProblem = (form: CatalogForm, model: SeparableModel<number>): string | undefined => {
  const empty = model.shapes.find((shape) => shape.candidates.length === 0);
  if (empty !== undefined) return `The form "${form.id}" has no start value of its shape constant "${empty.id}" for these points.`;
  const count = model.shapes.reduce((product, shape) => product * new Set(shape.candidates).size, 1);
  if (count > SEPARABLE_MAX_COMBINATIONS) {
    return `The form "${form.id}" has ${count} combinations of start values. The limit is ${SEPARABLE_MAX_COMBINATIONS}.`;
  }
  return undefined;
};

/**
 * This function gives the least-squares fit of a form to some points, as the start values of its constants.
 *
 * The fit is `fitSeparable` of `@mark1russell7/rigor-statistics`. For each combination of the grids of the shape
 * constants, the least-squares fit gives the constants of the terms. Then a golden-section search refines each shape
 * constant inside its bounds. A form with no shape constant has one combination, thus its start is its least-squares fit.
 *
 * The function gives an error when no combination has a fit, for example with fewer points than terms.
 */
export const startOf = (form: CatalogForm, points: Points): Result<Start, string> => {
  const fault = pointsProblem(points);
  if (fault !== undefined) return err(fault);
  const model = separableOf(form, points.x);
  const reason = modelProblem(form, model);
  if (reason !== undefined) return err(reason);
  const fit = fitSeparable(model, points.x, points.y);
  if (fit === null) return err(`The form "${form.id}" has no least-squares fit to ${points.x.length} points.`);
  return ok({ constants: constantsOf(form, fit), rss: fit.rss });
};
