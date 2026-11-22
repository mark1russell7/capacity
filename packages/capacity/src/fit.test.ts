import { describe, expect, it } from "vitest";
import { checkLaw } from "./check.ts";
import { fitLaw, type LawFit, type LawFitOptions } from "./fit.ts";
import { FORMS, catalogForm, formOf, gridOf, type CatalogForm, type Points } from "./forms.ts";
import type { Law } from "./law.ts";
import { sampleLaw, wave } from "./sample.fixture.ts";
import { constantIntervals } from "./value.ts";

const form = (id: string): CatalogForm => {
  const found = catalogForm(id);
  if (found === undefined) throw new Error(`no form ${id}`);
  return found;
};

/** The loads of the points: 12 rates in the range of the sample law, each with 4 runs. */
const RATES = [100, 200, 400, 700, 1000, 1400, 1800, 2200, 2600, 3000, 3500, 4000];
const RUNS = 4;
const X = RATES.flatMap((rate) => Array.from({ length: RUNS }, () => rate));

/** The true hinge. Its knee 2100 is not on the grid of the rates. */
const KNEE = 2100;
const hinge = (x: number): number => 0.2 + 0.0001 * x + 0.0005 * Math.max(0, x - KNEE);

/** The points of a law: the value of `truth` at each load, with a fixed noise of `noise` at each run. */
const pointsOf = (truth: (x: number) => number, noise: number, relative = false): Points => ({
  x: X,
  y: X.map((x, row) => (relative ? truth(x) * (1 + noise * wave(row, 1)) : truth(x) + noise * wave(row, 1))),
});

const fitted = (points: Points, options: LawFitOptions = {}): LawFit => {
  const result = fitLaw(points, { runs: 60, ...options });
  if (result.tag === "err") throw new Error(result.error);
  return result.value;
};

/** This function puts the parts of a fit into the sample law. Its variable is the rate. */
const lawOf = (fit: LawFit): Law => ({ ...sampleLaw(), form: fit.form, constants: fit.constants, replicates: fit.replicates, fit: fit.fit });

describe("fitLaw", () => {
  it("fits a hinge, ranks each form of the catalog, and the interval of the knee holds the knee", () => {
    const fit = fitted(pointsOf(hinge, 0.01), { binding: { variable: "rate" } });
    expect(gridOf({ kind: "inside" }, RATES)).not.toContain(KNEE);
    expect(fit.form).toEqual(formOf(form("hinge"), { variable: "rate" }));
    expect(fit.ranks.map((rank) => rank.form).sort()).toEqual(FORMS.map((each) => each.id).sort());
    expect(fit.ranks[0]!.form).toBe("hinge");
    const knee = fit.constants.find((constant) => constant.id === "knee")!.value;
    expect(Math.abs(knee - KNEE)).toBeLessThan(100);
    // the losers are the other forms with a held-out prediction at each point
    expect(fit.fit.losers.map((loser) => loser.form)).not.toContain("hinge");
    for (const loser of fit.fit.losers) expect(loser.error.rmse).toBeGreaterThanOrEqual(fit.ranks[0]!.error.rmse);
    expect(fit.fit.residuals).toHaveLength(X.length);
    expect(fit.replicates.length).toBeGreaterThanOrEqual(40);
    for (const row of fit.replicates) expect(row).toHaveLength(fit.constants.length);

    const law = lawOf(fit);
    expect(checkLaw(law)).toEqual([]);
    const intervals = constantIntervals(law);
    if (intervals.tag === "err") throw new Error(intervals.error.message);
    const { interval } = intervals.value.find((each) => each.id === "knee")!;
    expect(interval.low).toBeLessThanOrEqual(KNEE);
    expect(interval.high).toBeGreaterThanOrEqual(KNEE);
  });

  it("ranks the true form first", () => {
    const fit = fitted(pointsOf((x) => 0.3 + 0.0002 * x, 0.01), { forms: [form("constant"), form("linear")] });
    expect(fit.form.id).toBe("linear");
    expect(fit.fit.losers).toEqual([{ form: "constant", error: fit.ranks[1]!.error }]);
  });

  it("fits relative residuals with the weights 1 / y^2", () => {
    const fit = fitted(pointsOf((x) => 0.3 + 0.0002 * x, 0.02, true), { forms: [form("constant"), form("linear")], residual: "relative" });
    expect(fit.fit.residual).toBe("relative");
    for (const residual of fit.fit.residuals) expect(Math.abs(residual)).toBeLessThan(0.05);
    expect(fitLaw({ x: [1, 2, 3], y: [1, 0, 3] }, { residual: "relative" })).toEqual({ tag: "err", error: "A relative fit needs values that are not 0." });
  });

  it("renames the constants and the variable with the binding", () => {
    const binding = { variable: "rate", constants: { base: "c0", slope: "c1" } };
    const fit = fitted(pointsOf((x) => 0.3 + 0.0002 * x, 0.01), { forms: [form("linear")], binding });
    expect(fit.constants.map((constant) => constant.id)).toEqual(["c0", "c1"]);
    expect(fit.form).toEqual(formOf(form("linear"), binding));
    expect(fit.constants[1]!.value).toBeCloseTo(0.0002, 5);
  });

  it("keeps a form with no fit in the ranks, with its reason, and not in the losers", () => {
    // two loads: the grid of the knee has one value, 1.5, and three terms have no fit to two loads
    const x = [...Array.from({ length: 20 }, () => 1), ...Array.from({ length: 20 }, () => 2)];
    const fit = fitted({ x, y: x.map((value, row) => value + 0.01 * wave(row, 2)) }, { forms: [form("constant"), form("hinge")] });
    expect(fit.ranks.map((rank) => rank.form)).toEqual(["constant", "hinge"]);
    expect(fit.ranks[1]!.reason).toBe('The form "hinge" has no least-squares fit to 40 points.');
    expect(fit.ranks[1]!.missing).toBe(40);
    expect(fit.fit.losers).toEqual([]);
  });

  it("keeps a form that cannot start in the ranks, with its reason, and not in the losers", () => {
    // each load is 0: the grid of the capacity of a queue scales with the largest load, thus it has no value
    const x = Array.from({ length: 40 }, () => 0);
    const groups = x.map((_, row) => row % 4);
    const fit = fitted({ x, y: x.map((_, row) => 1 + 0.01 * wave(row, 2)) }, { forms: [form("constant"), form("queue")], groups });
    expect(fit.ranks.map((rank) => rank.form)).toEqual(["constant", "queue"]);
    expect(fit.ranks[1]!.reason).toBe('The form "queue" has no start value of its shape constant "capacity" for these points.');
    expect(fit.fit.losers).toEqual([]);
  });

  it("gives the same replicates for the same seed, and other replicates for another seed", () => {
    const points = pointsOf((x) => 0.3 + 0.0002 * x, 0.01);
    const forms = [form("linear")];
    expect(fitted(points, { forms, seed: 7 }).replicates).toEqual(fitted(points, { forms, seed: 7 }).replicates);
    expect(fitted(points, { forms, seed: 7 }).replicates).not.toEqual(fitted(points, { forms, seed: 8 }).replicates);
  });

  it("puts the points of one load into one group by default", () => {
    const points = pointsOf((x) => 0.3 + 0.0002 * x, 0.01);
    const forms = [form("constant"), form("linear")];
    expect(fitted(points, { forms })).toEqual(fitted(points, { forms, groups: X }));
    expect(fitted(points, { forms }).fit.method).toContain(`of ${RATES.length} groups`);
  });

  it("refuses points and options that a fit cannot use", () => {
    const points = pointsOf((x) => 0.3 + 0.0002 * x, 0.01);
    expect(fitLaw({ x: [], y: [] }).tag).toBe("err");
    expect(fitLaw(points, { forms: [] })).toEqual({ tag: "err", error: "The fit has no form." });
    expect(fitLaw(points, { forms: [form("linear"), form("linear")] }).tag).toBe("err");
    expect(fitLaw(points, { groups: [1, 2] }).tag).toBe("err");
    expect(fitLaw(points, { groups: X.map(() => "one") }).tag).toBe("err");
    const few = fitLaw(points, { forms: [form("linear")], runs: 10 });
    expect(few.tag === "err" && few.error).toContain("needs 40");
  });
});
