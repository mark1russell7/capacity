import { quantile } from "@mark1russell7/rigor-statistics";
import { app, lit, ref } from "@mark1russell7/vex";
import { describe, expect, it } from "vitest";
import type { Law } from "./law.ts";
import { hinge, hingeOf, sampleLaw } from "./sample.fixture.ts";
import { constantIntervals, lawValue, type LawValue } from "./value.ts";

const valueOf = (law: Law, rate: number, level?: number): LawValue => {
  const result = lawValue(law, { rate }, level === undefined ? {} : { level });
  if (result.tag === "err") throw new Error(result.error.message);
  return result.value;
};

describe("lawValue", () => {
  it("gives the value of the program with the constants, below and above the knee", () => {
    const law = sampleLaw();
    expect(valueOf(law, 1000).value).toBeCloseTo(0.09, 12);
    expect(valueOf(law, 3000).value).toBeCloseTo(0.135, 12);
    expect(valueOf(law, 1000).unit).toBe("ms/{request}");
  });

  it("gives the interval of the values of the replicates, as plain arithmetic gives them", () => {
    const law = sampleLaw();
    for (const rate of [100, 1000, 3000, 4000]) {
      const spread = law.replicates.map(([c0, c1, c2, knee]) => hingeOf(c0 as number, c1 as number, c2 as number, knee as number, rate));
      const answer = valueOf(law, rate);
      expect(answer.interval.low).toBeCloseTo(quantile(spread, 0.025), 12);
      expect(answer.interval.high).toBeCloseTo(quantile(spread, 0.975), 12);
      expect(answer.interval.low).toBeLessThan(answer.value);
      expect(answer.interval.high).toBeGreaterThan(answer.value);
      expect(answer.level).toBe(0.95);
    }
  });

  it("holds the value in the interval at the knee, where the replicates are above the value", () => {
    // At the knee, a replicate with a lower knee adds cost and a replicate with a higher knee adds none.
    const law = sampleLaw();
    const spread = law.replicates.map(([c0, c1, c2, knee]) => hingeOf(c0 as number, c1 as number, c2 as number, knee as number, 2500));
    const answer = valueOf(law, 2500);
    expect(answer.value).toBeCloseTo(0.105, 12);
    expect(quantile(spread, 0.025)).toBeGreaterThan(answer.value);
    expect(answer.interval.low).toBe(answer.value);
    expect(answer.interval.high).toBeCloseTo(quantile(spread, 0.975), 12);
  });

  it("gives a wider interval for a higher level", () => {
    const law = sampleLaw();
    const narrow = valueOf(law, 3000, 0.8).interval;
    const wide = valueOf(law, 3000, 0.95).interval;
    expect(wide.low).toBeLessThan(narrow.low);
    expect(wide.high).toBeGreaterThan(narrow.high);
  });

  it("gives an interval of no width when each replicate is the estimate", () => {
    const law = sampleLaw();
    const exact: Law = { ...law, replicates: law.replicates.map(() => law.constants.map((constant) => constant.value)) };
    const answer = valueOf(exact, 3000);
    expect(answer.interval).toEqual({ low: answer.value, high: answer.value });
  });

  it("makes the range of a run wider by the relative residuals", () => {
    const law = sampleLaw();
    const answer = valueOf(law, 3000);
    const low = quantile(law.fit.residuals, 0.025);
    const high = quantile(law.fit.residuals, 0.975);
    expect(low).toBeLessThan(0);
    expect(high).toBeGreaterThan(0);
    expect(answer.run.low).toBeCloseTo(answer.interval.low * (1 + low), 12);
    expect(answer.run.high).toBeCloseTo(answer.interval.high * (1 + high), 12);
  });

  it("makes the range of a run wider by the absolute residuals", () => {
    const law = sampleLaw();
    const absolute: Law = { ...law, fit: { ...law.fit, residual: "absolute", residuals: law.fit.residuals.map((value) => value / 10) } };
    const answer = valueOf(absolute, 3000);
    expect(answer.run.low).toBeCloseTo(answer.interval.low + quantile(absolute.fit.residuals, 0.025), 12);
    expect(answer.run.high).toBeCloseTo(answer.interval.high + quantile(absolute.fit.residuals, 0.975), 12);
  });

  it("keeps the range of a run in order for a law with values below 0", () => {
    const law = sampleLaw();
    const below: Law = { ...law, form: { id: "hinge", program: app("subtract", hinge, lit(1)) } };
    const answer = valueOf(below, 1000);
    expect(answer.value).toBeCloseTo(-0.91, 12);
    expect(answer.run.low).toBeLessThan(answer.interval.low);
    expect(answer.run.high).toBeGreaterThan(answer.interval.high);
  });

  it("names each variable outside its range", () => {
    const law = sampleLaw();
    expect(valueOf(law, 100).outside).toEqual([]);
    expect(valueOf(law, 4000).outside).toEqual([]);
    expect(valueOf(law, 99).outside).toEqual(["rate"]);
    expect(valueOf(law, 5000).outside).toEqual(["rate"]);
  });

  it("gives the value of a law with no variable", () => {
    const law = sampleLaw();
    const constant: Law = {
      ...law,
      variables: [],
      form: { id: "constant", program: ref("c0") },
      constants: law.constants.slice(0, 1),
      replicates: law.replicates.map((row) => row.slice(0, 1)),
    };
    const answer = lawValue(constant, {});
    expect(answer).toMatchObject({ tag: "ok", value: { value: 0.08, outside: [] } });
  });

  it("gives a problem for a point that the law cannot read", () => {
    const law = sampleLaw();
    expect(lawValue(law, {})).toMatchObject({ tag: "err", error: { code: "point", path: "rate" } });
    expect(lawValue(law, { rate: Number.NaN })).toMatchObject({ tag: "err", error: { code: "point", path: "rate" } });
    expect(lawValue(law, { rate: 1000, size: 10 })).toMatchObject({ tag: "err", error: { code: "point", path: "size" } });
    expect(lawValue(law, { rate: 1000, c0: 10 })).toMatchObject({ tag: "err", error: { code: "point", path: "c0" } });
  });

  it("gives a problem for a level that the law cannot show", () => {
    const law = sampleLaw();
    expect(lawValue(law, { rate: 1000 }, { level: 1 })).toMatchObject({ tag: "err", error: { code: "level", path: "level" } });
    expect(lawValue(law, { rate: 1000 }, { level: 0 })).toMatchObject({ tag: "err", error: { code: "level", path: "level" } });
    // The level 0.99 needs 200 values: the law has 200 replicates and 60 residuals.
    expect(lawValue(law, { rate: 1000 }, { level: 0.99 })).toMatchObject({ tag: "err", error: { code: "level", path: "fit.residuals" } });
    expect(lawValue(law, { rate: 1000 }, { level: 0.999 })).toMatchObject({ tag: "err", error: { code: "level", path: "replicates" } });
  });

  it("gives a problem where the program has no finite value", () => {
    const law = sampleLaw();
    const pole: Law = {
      ...law,
      form: { id: "pole", program: app("add", hinge, app("divide", lit(1), app("subtract", ref("rate"), lit(50)))) },
    };
    expect(lawValue(pole, { rate: 1000 })).toMatchObject({ tag: "ok" });
    expect(lawValue(pole, { rate: 50 })).toMatchObject({ tag: "err", error: { code: "value", path: "form.program" } });
  });
});

describe("constantIntervals", () => {
  it("gives each constant with the interval of its column of the replicates", () => {
    const law = sampleLaw();
    const result = constantIntervals(law);
    if (result.tag === "err") throw new Error(result.error.message);
    expect(result.value.map((constant) => constant.id)).toEqual(["c0", "c1", "c2", "knee"]);
    result.value.forEach((constant, index) => {
      const column = law.replicates.map((row) => row[index] as number);
      expect(constant.interval).toEqual({ low: quantile(column, 0.025), high: quantile(column, 0.975) });
      expect(constant.interval.low).toBeLessThan(constant.value);
      expect(constant.interval.high).toBeGreaterThan(constant.value);
    });
  });

  it("needs replicates for the level, and no residuals", () => {
    const law = sampleLaw();
    expect(constantIntervals(law, { level: 0.99 })).toMatchObject({ tag: "ok" });
    expect(constantIntervals(law, { level: 0.999 })).toMatchObject({ tag: "err", error: { code: "level", path: "replicates" } });
  });
});
