import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { checkLaw } from "./check.ts";
import {
  FORMS,
  FORM_VARIABLE,
  catalogForm,
  constantIdsOf,
  formOf,
  formSlopes,
  formValues,
  gridOf,
  programOf,
  separableOf,
  slopeOf,
  startOf,
  type CatalogForm,
  type Points,
} from "./forms.ts";
import type { Law } from "./law.ts";
import { NAME, SLUG } from "./names.ts";
import { sampleLaw, wave } from "./sample.fixture.ts";

const form = (id: string): CatalogForm => {
  const found = catalogForm(id);
  if (found === undefined) throw new Error(`no form ${id}`);
  return found;
};

/** These constants give each form a finite value over the range of the sample law, 100 to 4000 requests each second. */
const CONSTANTS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  constant: { base: 0.1 },
  linear: { base: 0.1, slope: 1e-5 },
  power: { base: 0.1, scale: 1e-3, exponent: 0.5 },
  "fall-power": { base: 0.1, excess: 10, scale: 1e-3, exponent: 0.5 },
  logarithm: { base: 0.1, scale: 0.01 },
  hinge: { base: 0.08, slope: 1e-5, bend: 5e-5, knee: 2500 },
  queue: { base: 0.1, scale: 0.05, capacity: 5000 },
  scalability: { unit: 1, contention: 0.05, coherency: 1e-7 },
  drift: { base: 0.1, drift: 1e-6, warm: 0.05, settle: 500 },
};

/** These functions are the forms in plain arithmetic. A test compares each program with its function. */
const PLAIN: Readonly<Record<string, (x: number, c: Readonly<Record<string, number>>) => number>> = {
  constant: (_, c) => c["base"]!,
  linear: (x, c) => c["base"]! + c["slope"]! * x,
  power: (x, c) => c["base"]! + c["scale"]! * x ** c["exponent"]!,
  "fall-power": (x, c) => c["base"]! + c["excess"]! / x + c["scale"]! * x ** c["exponent"]!,
  logarithm: (x, c) => c["base"]! + c["scale"]! * Math.log(x),
  hinge: (x, c) => c["base"]! + c["slope"]! * x + c["bend"]! * Math.max(0, x - c["knee"]!),
  queue: (x, c) => c["base"]! + (c["scale"]! * c["capacity"]!) / (c["capacity"]! - x),
  scalability: (x, c) => (c["unit"]! * x) / (1 + c["contention"]! * (x - 1) + c["coherency"]! * x * (x - 1)),
  drift: (x, c) => c["base"]! + c["drift"]! * x + c["warm"]! * (1 - Math.exp(-x / c["settle"]!)),
};

/** This function gives the sample law with the form of the catalog, its constants and replicates near them. */
const lawOf = (catalog: CatalogForm): Law => {
  const ids = constantIdsOf(catalog);
  const estimate = ids.map((id) => CONSTANTS[catalog.id]![id]!);
  const sample = sampleLaw();
  return {
    ...sample,
    form: formOf(catalog, { variable: "rate" }),
    constants: ids.map((id, column) => ({ id, value: estimate[column]! })),
    replicates: Array.from({ length: 200 }, (_, row) => estimate.map((value, column) => value * (1 + 0.02 * wave(row, column)))),
    fit: { ...sample.fit, losers: FORMS.filter((other) => other.id !== catalog.id).map((other) => ({ form: other.id, error: { mae: 0.3, rmse: 0.4 } })) },
  };
};

const values = (catalog: CatalogForm, xs: readonly number[], constants: Readonly<Record<string, number>>): readonly number[] => {
  const result = formValues(catalog, xs, constants);
  if (result.tag === "err") throw new Error(result.error);
  return result.value;
};

const slopes = (catalog: CatalogForm, xs: readonly number[], constants: Readonly<Record<string, number>>): readonly number[] => {
  const result = formSlopes(catalog, xs, constants);
  if (result.tag === "err") throw new Error(result.error);
  return result.value;
};

describe("FORMS", () => {
  it("has the eight forms of the roadmap, in its order", () => {
    expect(FORMS.map((each) => each.id)).toEqual(["constant", "linear", "power", "fall-power", "logarithm", "hinge", "queue", "scalability", "drift"]);
  });

  it("gives each form an id, and each constant a name that a law can read once", () => {
    for (const each of FORMS) {
      expect(each.id).toMatch(SLUG);
      const ids = constantIdsOf(each);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).not.toContain(FORM_VARIABLE);
      for (const id of ids) expect(id).toMatch(NAME);
    }
  });

  it("finds a form by its id", () => {
    expect(catalogForm("hinge")?.title).toBe("Two lines that join at a knee");
    expect(catalogForm("cubic")).toBeUndefined();
  });
});

describe("formOf", () => {
  it.each(FORMS.map((each) => [each.id, each] as const))("gives the form %s of a law that passes the check", (_, catalog) => {
    expect(checkLaw(lawOf(catalog))).toEqual([]);
  });

  it("reads the constants of a law by the ids of the binding", () => {
    const hinge = form("hinge");
    const law = lawOf(hinge);
    const named = { base: "c0", slope: "c1", bend: "c2" } as const;
    const renamed: Law = {
      ...law,
      form: formOf(hinge, { variable: "rate", constants: named }),
      constants: law.constants.map((constant) => ({ ...constant, id: named[constant.id as keyof typeof named] ?? constant.id })),
    };
    expect(checkLaw(renamed)).toEqual([]);
    expect(checkLaw({ ...renamed, form: law.form }).map((problem) => problem.code)).toContain("read");
  });
});

describe("formValues", () => {
  it.each(FORMS.map((each) => [each.id, each] as const))("gives the value of the form %s in plain arithmetic", (_, catalog) => {
    fc.assert(
      fc.property(fc.double({ min: 100, max: 4000, noNaN: true }), (x) => {
        const expected = PLAIN[catalog.id]!(x, CONSTANTS[catalog.id]!);
        const [actual] = values(catalog, [x], CONSTANTS[catalog.id]!);
        expect(actual).toBeCloseTo(expected, 12);
      }),
    );
  });

  it("gives the text of an error where a form has no finite value", () => {
    expect(formValues(form("queue"), [5000], CONSTANTS["queue"]!).tag).toBe("err");
    expect(formValues(form("logarithm"), [0], CONSTANTS["logarithm"]!).tag).toBe("err");
  });
});

describe("formSlopes", () => {
  it.each(FORMS.map((each) => [each.id, each] as const))("gives the slope of the form %s, as a central difference does", (_, catalog) => {
    const constants = CONSTANTS[catalog.id]!;
    fc.assert(
      fc.property(fc.double({ min: 100, max: 4000, noNaN: true }), (x) => {
        const h = 1e-3;
        // a difference across the knee of the hinge is not its slope
        fc.pre(catalog.id !== "hinge" || Math.abs(x - constants["knee"]!) > 2 * h);
        const [low, high] = values(catalog, [x - h, x + h], constants);
        const difference = (high! - low!) / (2 * h);
        const [slope] = slopes(catalog, [x], constants);
        expect(Math.abs(slope! - difference)).toBeLessThanOrEqual(1e-6 * Math.abs(slope!) + 1e-9);
      }),
    );
  });

  it("gives the slope of the hinge before and after its knee", () => {
    expect(slopes(form("hinge"), [2000, 3000], CONSTANTS["hinge"]!)).toEqual([1e-5, 1e-5 + 5e-5]);
  });

  it("gives a slope of 0 for the constant form", () => {
    expect(slopes(form("constant"), [100, 4000], CONSTANTS["constant"]!)).toEqual([0, 0]);
    expect(slopeOf(form("constant"), { variable: "rate" })).toEqual(expect.objectContaining({ tag: "let" }));
  });

  it("reads the variable of the binding", () => {
    expect(JSON.stringify(programOf(form("linear"), { variable: "rate" }))).toContain('"rate"');
  });
});

describe("gridOf", () => {
  it("gives the values inside the range of the variable and their middles", () => {
    expect(gridOf({ kind: "inside" }, [4, 1, 2, 2])).toEqual([1.5, 2, 3]);
    expect(gridOf({ kind: "inside" }, [3, 3])).toEqual([]);
  });

  it("scales the factors by the largest size of the variable", () => {
    expect(gridOf({ kind: "scaled", factors: [1, 2], power: 1 }, [-5, 2])).toEqual([5, 10]);
    expect(gridOf({ kind: "scaled", factors: [1, 4], power: -2 }, [1, 2])).toEqual([0.25, 1]);
    expect(gridOf({ kind: "scaled", factors: [0.5], power: 0 }, [])).toEqual([0.5]);
    expect(gridOf({ kind: "scaled", factors: [0.5], power: 1 }, [0])).toEqual([]);
  });
});

/** The values of the variable of the fits: distinct, positive, and spread over two decades. */
const XS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233];

/** This function gives a value of a grid of a form for the points `XS`. */
const onGrid = (catalog: CatalogForm, shape: string, index: number): number =>
  gridOf(catalog.shapes.find((each) => each.id === shape)!.grid, XS)[index]!;

/** These constants of each form have each shape constant on its grid for `XS`. Thus a start finds them. */
const TRUE: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  constant: { base: 3 },
  linear: { base: 3, slope: 0.5 },
  power: { base: 3, scale: 2, exponent: 0.5 },
  "fall-power": { base: 3, excess: 2, scale: 2, exponent: 0.5 },
  logarithm: { base: 3, scale: 2 },
  hinge: { base: 3, slope: 0.5, bend: 2, knee: 21 },
  queue: { base: 3, scale: 2, capacity: onGrid(form("queue"), "capacity", 5) },
  scalability: { unit: 4, contention: 0.1, coherency: onGrid(form("scalability"), "coherency", 3) },
  drift: { base: 3, drift: 0.01, warm: 5, settle: onGrid(form("drift"), "settle", 2) },
};

const start = (catalog: CatalogForm, points: Points) => {
  const result = startOf(catalog, points);
  if (result.tag === "err") throw new Error(result.error);
  return result.value;
};

describe("separableOf", () => {
  it("gives a column for each term and a shape for each shape constant", () => {
    const model = separableOf(form("hinge"), XS);
    expect(model.terms).toEqual(["base", "slope", "bend"]);
    expect(model.shapes.map((shape) => shape.id)).toEqual(["knee"]);
    expect(model.shapes[0]!.candidates).toEqual(gridOf({ kind: "inside" }, XS));
    expect(model.design([21], [13, 34])).toEqual([
      [1, 13, 0],
      [1, 34, 13],
    ]);
  });

  it("gives no design when a basis has no finite value at a point", () => {
    expect(separableOf(form("logarithm"), XS).design([], [0, 1])).toBeNull();
    expect(separableOf(form("queue"), XS).design([34], [34])).toBeNull();
  });

  it("starts each shape constant inside its bounds", () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.double({ min: 0.5, max: 1e6, noNaN: true }), { minLength: 3, maxLength: 30 }), (xs) => {
        for (const catalog of FORMS) {
          for (const shape of separableOf(catalog, xs).shapes) {
            for (const candidate of shape.candidates) {
              expect(candidate).toBeGreaterThanOrEqual(shape.min ?? Number.NEGATIVE_INFINITY);
              expect(candidate).toBeLessThanOrEqual(shape.max ?? Number.POSITIVE_INFINITY);
            }
          }
        }
      }),
      { numRuns: 60 },
    );
  });
});

describe("startOf", () => {
  it.each(FORMS.map((each) => [each.id, each] as const))("finds the constants of the form %s from its exact values", (_, catalog) => {
    const truth = TRUE[catalog.id]!;
    const found = start(catalog, { x: XS, y: values(catalog, XS, truth) });
    expect(found.constants.map((constant) => constant.id)).toEqual(constantIdsOf(catalog));
    for (const constant of found.constants) expect(constant.value).toBeCloseTo(truth[constant.id]!, 6);
    expect(found.rss).toBeLessThan(1e-12);
  });

  it("refines the knee of the hinge between the values of its grid", () => {
    const found = start(form("hinge"), { x: XS, y: XS.map((x) => (x < 30 ? 1 : 1 + 2 * (x - 30))) });
    const knee = found.constants.find((constant) => constant.id === "knee")!.value;
    // 30 is not on the grid: the grid has 21, 27.5 and 34 near it
    expect(gridOf({ kind: "inside" }, XS)).not.toContain(30);
    expect(knee).toBeCloseTo(30, 6);
    expect(found.rss).toBeLessThan(1e-12);
  });

  it("refines the capacity of a queue between the values of its grid, past the largest load", () => {
    const truth = { base: 3, scale: 2, capacity: 250 };
    const found = start(form("queue"), { x: XS, y: values(form("queue"), XS, truth) });
    for (const constant of found.constants) expect(constant.value).toBeCloseTo(truth[constant.id as keyof typeof truth], 4);
  });

  it("refuses a form with no start value of a shape constant", () => {
    const result = startOf(form("queue"), { x: [0, 0, 0, 0], y: [1, 2, 3, 4] });
    expect(result.tag === "err" && result.error).toContain('shape constant "capacity"');
  });

  it("refuses points that a fit cannot use", () => {
    expect(startOf(form("linear"), { x: [], y: [] }).tag).toBe("err");
    expect(startOf(form("linear"), { x: [1, 2], y: [1] }).tag).toBe("err");
    expect(startOf(form("linear"), { x: [1, 2], y: [1, Number.NaN] }).tag).toBe("err");
    // two terms need more than two points: with two, no residual is left
    expect(startOf(form("linear"), { x: [1, 2], y: [1, 2] }).tag).toBe("err");
    expect(startOf(form("logarithm"), { x: [-1, 0, 1, 2], y: [1, 2, 3, 4] }).tag).toBe("err");
  });

  // A form that holds another form as a special case fits at least as well. Least squares finds the
  // best constants of the terms, the grid of each larger form holds the smaller form, and the refine
  // does not increase the sum of the squared residuals.
  it("orders the residuals of nested forms", () => {
    const nested: readonly (readonly [string, string])[] = [
      ["linear", "constant"],
      ["power", "linear"],
      ["fall-power", "linear"],
      ["logarithm", "constant"],
      ["hinge", "linear"],
      ["queue", "constant"],
      ["drift", "linear"],
    ];
    fc.assert(
      fc.property(fc.array(fc.double({ min: -100, max: 100, noNaN: true }), { minLength: XS.length, maxLength: XS.length }), (ys) => {
        const scale = ys.reduce((sum, y) => sum + y * y, 0);
        for (const [larger, smaller] of nested) {
          expect(start(form(larger), { x: XS, y: ys }).rss).toBeLessThanOrEqual(start(form(smaller), { x: XS, y: ys }).rss + 1e-9 * (1 + scale));
        }
      }),
      { numRuns: 40 },
    );
  });
});
