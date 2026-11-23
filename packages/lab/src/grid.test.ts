import { readFileSync } from "node:fs";
import { canonicalJson } from "@mark1russell7/rigor-generators";
import { describe, expect, it } from "vitest";
import { MAX_ARRIVALS, caseProblems, type Case } from "./case.ts";
import { LOAD_GRID, LOAD_VARIABLE_IDS, designCases, designProblems, gridProblems, loadOfCase, type LoadDesign } from "./grid.ts";
import type { Plan } from "./plan.ts";

/** This case is the first case of the plan `rate`: 100 requests each second for 1 second, 3 runs, a pool of 64. */
const base = (JSON.parse(readFileSync(new URL("../plans/rate.json", import.meta.url), "utf8")) as Plan).cases[0] as Case;
const all: LoadDesign = { seed: "cap15", variables: LOAD_VARIABLE_IDS, alone: 4, together: 6 };

describe("the grid of load variables", () => {
  it("gives each load variable a range and a scale with no problem", () => {
    expect(LOAD_GRID.map((each) => each.id)).toEqual(LOAD_VARIABLE_IDS);
    expect(gridProblems(LOAD_GRID)).toEqual([]);
  });

  it("keeps the rate and the age of the grid in the limit of the arrivals of a case with 3 runs", () => {
    const top = (id: string): number => LOAD_GRID.find((each) => each.id === id)!.max;
    expect(top("rate") * (top("age") / 1000) * (3 + 1)).toBeLessThanOrEqual(MAX_ARRIVALS);
  });

  it("refuses an unknown variable, a variable two times, a range past its limit and a log range from 0", () => {
    const [rate, body] = LOAD_GRID;
    const messages = (grid: readonly unknown[]): string[] => gridProblems(grid as typeof LOAD_GRID).map((each) => `${each.path}: ${each.message}`);
    expect(messages([{ ...rate!, id: "speed" }])).toEqual([expect.stringMatching(/^grid\[0\]\.id: "speed" is not a load variable/)]);
    expect(messages([rate, rate])).toEqual([expect.stringMatching(/^grid\[1\]\.id: .*two times/)]);
    expect(messages([{ ...body!, max: 16_777_217 }])).toEqual([expect.stringMatching(/^grid\[0\]: The range of "body"/)]);
    expect(messages([{ ...body!, min: 0 }])).toEqual([expect.stringMatching(/^grid\[0\]\.min: .*scale log/)]);
    expect(messages([{ ...body!, min: 0, scale: "linear" }])).toEqual([]);
  });

  it("reads the amount of each load variable of a base case, with 0 for a field or a level that the case does not name", () => {
    expect(loadOfCase(base, LOAD_VARIABLE_IDS)).toEqual({ rate: 100, body: 0, alloc: 0, work: 0, wait: 0, reply: 0, concurrency: 64, heap: 0, age: 1000 });
    expect(() => loadOfCase({ ...base, connections: { mode: "pipeline" } }, ["concurrency"])).toThrow(/no pool of connections/);
    expect(() => loadOfCase({ ...base, demand: { ...base.demand, classes: [...base.demand.classes, ...base.demand.classes] } }, ["rate"])).toThrow(/2 classes/);
  });
});

describe("a load design", () => {
  const cases = designCases(base, all);

  it("gives the cases of each variable alone, then the cases of all the variables together, each with no problem", () => {
    expect(cases).toHaveLength(LOAD_VARIABLE_IDS.length * 4 + 6);
    expect(cases.slice(0, 5).map((each) => each.id)).toEqual(["rate/100/rate/1", "rate/100/rate/2", "rate/100/rate/3", "rate/100/rate/4", "rate/100/body/1"]);
    expect(cases.at(-1)?.id).toBe("rate/100/together/6");
    expect(new Set(cases.map((each) => each.id)).size).toBe(cases.length);
    expect(designProblems(base, all)).toEqual([]);
    for (const each of cases) expect(caseProblems(each)).toEqual([]);
  });

  it("changes only the variable of a case alone, and keeps each other variable at its amount in the base case", () => {
    const held = loadOfCase(base, LOAD_VARIABLE_IDS);
    LOAD_VARIABLE_IDS.forEach((id, block) => {
      const range = LOAD_GRID.find((each) => each.id === id)!;
      for (const each of cases.slice(block * 4, block * 4 + 4)) {
        const load = loadOfCase(each, LOAD_VARIABLE_IDS);
        for (const other of LOAD_VARIABLE_IDS) if (other !== id) expect(load[other]).toBe(held[other]);
        expect(Number.isInteger(load[id])).toBe(true);
        expect(load[id]).toBeGreaterThanOrEqual(range.min);
        expect(load[id]).toBeLessThanOrEqual(range.max);
        expect(each.title).toMatch(new RegExp(`with ${id} \\d+ `));
      }
    });
    expect(cases[0]?.connections).toEqual(base.connections);
    expect(cases[0]?.arrivals).toEqual(base.arrivals);
  });

  it("puts one case of all the variables together in each stratum of the log range of each variable", () => {
    const together = designCases(base, { ...all, alone: 0, together: 8 });
    expect(together).toHaveLength(8);
    // A whole amount v is the floor of a point in [v, v + 1). Thus the stratum of the k-th amount is from the stratum of v to the stratum of v + 1.
    for (const range of LOAD_GRID) {
      const stratum = (value: number): number => Math.min(7, Math.floor((Math.log(value / range.min) / Math.log((range.max + 1) / range.min)) * 8));
      const values = together.map((each) => loadOfCase(each, [range.id])[range.id]!).sort((a, b) => a - b);
      values.forEach((value, k) => {
        expect(stratum(value)).toBeLessThanOrEqual(k);
        expect(stratum(value + 1)).toBeGreaterThanOrEqual(k);
      });
    }
  });

  it("gives the same cases for the same seed, and other cases for another seed", () => {
    expect(canonicalJson(designCases(base, all))).toBe(canonicalJson(cases));
    expect(canonicalJson(designCases(base, { ...all, seed: "other" }))).not.toBe(canonicalJson(cases));
  });

  it("moves only the variables that the design names, in their order", () => {
    const sizes = designCases(base, { seed: "sizes", variables: ["reply", "body"], alone: 3, together: 0 });
    expect(sizes.map((each) => each.id)).toEqual(["rate/100/reply/1", "rate/100/reply/2", "rate/100/reply/3", "rate/100/body/1", "rate/100/body/2", "rate/100/body/3"]);
    expect(sizes.every((each) => each.demand.classes[0]?.rate.value === 100 && each.duration.value === 1)).toBe(true);
  });

  it("gives the problems of a design with a bad shape, and of each case that breaks a limit of the lab", () => {
    expect(designProblems(base, { seed: "", variables: ["rate", "rate", "speed" as "rate"], alone: -1, together: 1.5 }).map((each) => each.path)).toEqual([
      "seed",
      "variables[1]",
      "variables[2]",
      "alone",
      "together",
    ]);
    expect(() => designCases(base, { ...all, variables: [] })).toThrow(/moves no variable/);
    expect(designProblems({ ...base, connections: { mode: "pipeline" } }, all)).toEqual([{ path: "base", message: expect.stringMatching(/no pool of connections/) }]);
    // At 20 runs of 600 seconds, each rate from 12 requests each second breaks the limit. Thus the strata from 95 break it.
    const long = designProblems({ ...base, runs: 20, duration: { value: 600, unit: "s" } }, { seed: "long", variables: ["rate"], alone: 4, together: 0 });
    expect(long.length).toBeGreaterThanOrEqual(2);
    expect(long.every((each) => /^rate\/100\/rate\/\d\.demand$/.test(each.path))).toBe(true);
  });
});
