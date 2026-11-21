import { app, lit, offset, ref, type Expr } from "@mark1russell7/vex";
import { describe, expect, it } from "vitest";
import { checkLaw } from "./check.ts";
import type { Law, Variable } from "./law.ts";
import { hinge, sampleLaw } from "./sample.fixture.ts";

type Change = (law: Law) => Law;

const withProgram = (program: unknown): Change => (law) => ({ ...law, form: { ...law.form, program: program as Expr } });
const withVariable = (change: Partial<Variable>): Change => (law) => ({
  ...law,
  variables: [{ ...(law.variables[0] as Variable), ...change }],
});
const withRun = (change: Partial<Law["evidence"]["runs"][number]>): Change => (law) => ({
  ...law,
  evidence: { runs: [{ ...(law.evidence.runs[0] as Law["evidence"]["runs"][number]), ...change }] },
});
const withNoise = (change: Partial<Law["noise"]>): Change => (law) => ({ ...law, noise: { ...law.noise, ...change } });
const withNoiseRun = (change: Partial<Law["noise"]["runs"][number]>): Change => (law) => ({
  ...law,
  noise: { ...law.noise, runs: [{ ...(law.noise.runs[0] as Law["noise"]["runs"][number]), ...change }] },
});

/** Each case breaks one rule of a law. The check must find the problem with this code at this path. */
const cases: readonly (readonly [name: string, change: Change, code: string, path: string])[] = [
  ["a different format", (law) => ({ ...law, format: "capacity-law/2" as Law["format"] }), "format", "format"],
  ["an id with a space", (law) => ({ ...law, id: "Node HTTP" }), "id", "id"],
  ["an empty title", (law) => ({ ...law, title: " " }), "id", "title"],
  ["a subject with a capital", (law) => ({ ...law, subject: "Node" }), "id", "subject"],
  ["a unit that is an alias", (law) => ({ ...law, measure: { id: "cpu", unit: "µs" } }), "unit", "measure.unit"],
  ["a unit that is no unit", withVariable({ unit: "requests each second" }), "unit", "variables[0].unit"],
  ["a range that does not move", withVariable({ min: 4000 }), "range", "variables[0]"],
  ["a range that is not finite", withVariable({ max: Number.POSITIVE_INFINITY }), "range", "variables[0]"],
  ["a log scale from 0", withVariable({ min: 0 }), "range", "variables[0]"],
  ["a variable with a bad name", withVariable({ id: "request rate" }), "id", "variables[0].id"],
  ["two variables with one name", (law) => ({ ...law, variables: [...law.variables, ...law.variables] }), "id", "variables"],
  [
    "more variables than the limit",
    (law) => ({
      ...law,
      variables: Array.from({ length: 9 }, (_, index) => ({ ...(law.variables[0] as Variable), id: `v${index}` })),
    }),
    "range",
    "variables",
  ],
  ["a condition that is not finite", (law) => ({ ...law, conditions: { cores: Number.NaN } }), "condition", "conditions.cores"],
  ["a condition with a bad unit", (law) => ({ ...law, conditions: { memory: { value: 1, unit: "megs" } } }), "condition", "conditions.memory"],
  ["a condition with a bad name", (law) => ({ ...law, conditions: { "CPU model": "x" } }), "id", "conditions.CPU model"],
  ["no constant", (law) => ({ ...law, constants: [], replicates: law.replicates.map(() => []) }), "constant", "constants"],
  [
    "a constant that is not finite",
    (law) => ({ ...law, constants: law.constants.map((constant, index) => (index === 1 ? { ...constant, value: Number.NaN } : constant)) }),
    "constant",
    "constants[1].value",
  ],
  [
    "a constant with the name of a variable",
    (law) => ({ ...law, constants: law.constants.map((constant, index) => (index === 0 ? { ...constant, id: "rate" } : constant)) }),
    "id",
    "constants[0].id",
  ],
  [
    "two constants with one name",
    (law) => ({ ...law, constants: law.constants.map((constant, index) => (index === 1 ? { ...constant, id: "c0" } : constant)) }),
    "id",
    "constants",
  ],
  ["too few replicates", (law) => ({ ...law, replicates: law.replicates.slice(0, 39) }), "replicates", "replicates"],
  [
    "a replicate with a missing number",
    (law) => ({ ...law, replicates: law.replicates.map((row, index) => (index === 5 ? row.slice(1) : row)) }),
    "replicates",
    "replicates[5]",
  ],
  [
    "a constant outside each of its replicates",
    (law) => ({ ...law, constants: law.constants.map((constant, index) => (index === 0 ? { ...constant, value: 8 } : constant)) }),
    "replicates",
    "constants[0].value",
  ],
  ["a program that is not an expression", withProgram({ tag: "what" }), "program", "form.program"],
  ["a program that is not there", withProgram(undefined), "program", "form.program"],
  ["a program that reads an unknown name", withProgram(app("add", hinge, ref("size"))), "read", "form.program"],
  ["a program that reads a nested name", withProgram(app("add", hinge, ref(["c0", "low"]))), "read", "form.program"],
  ["a program that reads a different record", withProgram(app("add", hinge, ref("rate", [offset(1)]))), "read", "form.program"],
  ["a program that does not read a constant", withProgram(app("add", ref("c0"), app("multiply", ref("c1"), ref("rate")))), "read", "form.program"],
  ["a program with an unknown op", withProgram(app("smooth", hinge)), "value", "form.program"],
  [
    "a program with no value at a corner",
    withProgram(app("add", hinge, app("divide", lit(1), app("subtract", ref("rate"), lit(100))))),
    "value",
    "form.program",
  ],
  [
    "a replicate with no value at the middle",
    (law) => ({
      ...withProgram(app("add", hinge, app("sqrt", app("subtract", ref("c0"), lit(0.0785)))))(law),
    }),
    "value",
    "replicates",
  ],
  ["a fit with no method", (law) => ({ ...law, fit: { ...law.fit, method: "" } }), "fit", "fit.method"],
  ["too few residuals", (law) => ({ ...law, fit: { ...law.fit, residuals: law.fit.residuals.slice(0, 39) } }), "fit", "fit.residuals"],
  [
    "a residual that is not finite",
    (law) => ({ ...law, fit: { ...law.fit, residuals: [...law.fit.residuals, Number.NaN] } }),
    "fit",
    "fit.residuals",
  ],
  [
    "a loser that is the form of the law",
    (law) => ({ ...law, fit: { ...law.fit, losers: [{ form: "hinge", error: { mae: 1, rmse: 2 } }] } }),
    "fit",
    "fit.losers[0].form",
  ],
  [
    "a loser with a mean error above its root mean square error",
    (law) => ({ ...law, fit: { ...law.fit, losers: [{ form: "linear", error: { mae: 2, rmse: 1 } }] } }),
    "fit",
    "fit.losers[0].error",
  ],
  [
    "two losers with one form",
    (law) => ({ ...law, fit: { ...law.fit, losers: [...law.fit.losers, ...law.fit.losers] } }),
    "fit",
    "fit.losers",
  ],
  ["no run", (law) => ({ ...law, evidence: { runs: [] } }), "evidence", "evidence.runs"],
  ["a run with no secure address", withRun({ url: "http://example.com/run" }), "evidence", "evidence.runs[0].url"],
  ["a run with a short commit", withRun({ commit: "0123456" }), "evidence", "evidence.runs[0].commit"],
  ["a run with a date and no time", withRun({ date: "2026-11-18" }), "evidence", "evidence.runs[0].date"],
  ["a run with a date that does not exist", withRun({ date: "2026-13-40T00:00:00Z" }), "evidence", "evidence.runs[0].date"],
  ["a noise floor below 0", withNoise({ floor: -0.001 }), "noise", "noise.floor"],
  ["a noise floor that is not finite", withNoise({ floor: Number.POSITIVE_INFINITY }), "noise", "noise.floor"],
  ["a noise with no CPU model", withNoise({ cpu: " " }), "noise", "noise.cpu"],
  ["a noise with no run", withNoise({ runs: [] }), "noise", "noise.runs"],
  ["a noise run with no secure address", withNoiseRun({ url: "http://example.com/run" }), "noise", "noise.runs[0].url"],
  ["a noise run with a short commit", withNoiseRun({ commit: "89abcde" }), "noise", "noise.runs[0].commit"],
  ["a noise run with a date and no time", withNoiseRun({ date: "2026-11-19" }), "noise", "noise.runs[0].date"],
];

describe("checkLaw", () => {
  it("finds no problem in the sample law", () => {
    expect(checkLaw(sampleLaw())).toEqual([]);
  });

  it("finds no problem in a law with no variable", () => {
    const law = sampleLaw();
    const constant: Law = {
      ...law,
      variables: [],
      form: { id: "constant", program: ref("c0") },
      constants: law.constants.slice(0, 1),
      replicates: law.replicates.map((row) => row.slice(0, 1)),
      fit: { ...law.fit, losers: [] },
    };
    expect(checkLaw(constant)).toEqual([]);
  });

  it.each(cases)("finds %s", (_name, change, code, path) => {
    const problems = checkLaw(change(sampleLaw()));
    expect(problems.map((problem) => `${problem.code} ${problem.path}`)).toContain(`${code} ${path}`);
  });

  it("gives each problem a message that is a sentence", () => {
    for (const [, change] of cases) {
      for (const problem of checkLaw(change(sampleLaw()))) {
        expect(problem.message).toMatch(/^[A-Z"].*\.$/);
      }
    }
  });
});
