import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkComposition, compositionValue, type Catalog, type Composition } from "./composition.ts";
import type { Law } from "./law.ts";
import { readComposition, readLaw } from "./schema.ts";
import type { Demand } from "./workload.ts";

/** This folder holds the composition files: `<subject>/<cpu>/<measure>.composition.json`. Their terms name the law files of the folder `laws`. */
const COMPOSITIONS = fileURLToPath(new URL("../compositions/", import.meta.url));
const LAWS = fileURLToPath(new URL("../laws/", import.meta.url));

/** This function gives the paths of the files with the suffix in a folder, with forward slashes, in order. */
const filesOf = (folder: string, suffix: string): readonly string[] =>
  readdirSync(folder, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(suffix))
    .map((name) => name.split(sep).join("/"))
    .sort();

/** This function reads a file with a reader, or throws with each problem of the file. */
const readWith = <T>(read: (data: unknown) => { tag: "ok"; value: T } | { tag: "err"; error: readonly { path: string; message: string }[] }, path: string): T => {
  const result = read(JSON.parse(readFileSync(path, "utf8")));
  if (result.tag === "err") throw new Error(result.error.map((each) => `${each.path}: ${each.message}`).join("\n"));
  return result.value;
};

const files = filesOf(COMPOSITIONS, ".composition.json");
const laws: readonly Law[] = filesOf(LAWS, ".law.json").map((name) => readWith(readLaw, join(LAWS, name)));
const compositions: readonly Composition[] = files.map((name) => readWith(readComposition, join(COMPOSITIONS, name)));
const CATALOG: Catalog = { laws, compositions };

/** This function gives the laws that a composition reads, in its terms and in its nested compositions. */
const lawsOf = (composition: Composition): readonly Law[] =>
  composition.terms.flatMap((term) => {
    if ("law" in term) return laws.filter((law) => law.id === term.law);
    const nested = compositions.find((each) => each.id === term.composition);
    return nested === undefined ? [] : lawsOf(nested);
  });

/** This function gives the range of the rate that each law of a composition holds: the highest start and the lowest end. */
const rangeOf = (composition: Composition): { readonly min: number; readonly max: number } => {
  const variables = lawsOf(composition).map((law) => law.variables.find((variable) => variable.id === "rate")!);
  return { min: Math.max(...variables.map((each) => each.min)), max: Math.min(...variables.map((each) => each.max)) };
};

/** This function gives a demand of one class at a rate, in requests each second. */
const demandAt = (rate: number): Demand => ({ classes: [{ id: "request", rate: { value: rate, unit: "{request}/s" }, request: {} }], levels: {} });

/** This function gives the conditions of a law with no `base`. */
const withoutBase = (law: Law): Law["conditions"] => Object.fromEntries(Object.entries(law.conditions).filter(([key]) => key !== "base"));

describe("the composition files", () => {
  it("has a composition file or more", () => {
    // A folder with no file gives no read, not a pass.
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s is a correct composition with the id of its path", (name) => {
    const composition = compositions[files.indexOf(name)]!;
    expect(checkComposition(composition)).toEqual([]);
    expect(composition.id).toBe(name.slice(0, -".composition.json".length));
  });

  it.each(files)("%s reads laws of a rate, and it has a finite value at each end of their range", (name) => {
    const composition = compositions[files.indexOf(name)]!;
    expect(lawsOf(composition).every((law) => law.variables.some((variable) => variable.id === "rate"))).toBe(true);
    const { min, max } = rangeOf(composition);
    expect(min).toBeLessThan(max);
    for (const rate of [min, max]) {
      const result = compositionValue(composition, CATALOG, demandAt(rate));
      expect(result.tag === "err" ? result.error : null).toBeNull();
      if (result.tag !== "ok") continue;
      expect([result.value.value, result.value.interval.low, result.value.interval.high].every(Number.isFinite)).toBe(true);
      expect(result.value.extrapolated).toBe(false);
    }
  });

  it.each(files)("%s adds each overhead law to a composition of its base subject, with the same conditions", (name) => {
    // An overhead law is the value of a subject less the value of its base subject, in the same job. Thus the sum holds only over laws of the base with the same conditions.
    const composition = compositions[files.indexOf(name)]!;
    const overheads = composition.terms.flatMap((term) => ("law" in term ? laws.filter((law) => law.id === term.law && law.conditions["base"] !== undefined) : []));
    for (const overhead of overheads) {
      const bases = composition.terms.flatMap((term) => ("composition" in term ? lawsOf(compositions.find((each) => each.id === term.composition)!) : []));
      expect(bases.length).toBeGreaterThan(0);
      for (const base of bases) expect([base.subject, base.conditions]).toEqual([overhead.conditions["base"], withoutBase(overhead)]);
    }
  });
});

describe("the compositions of the service runner", () => {
  const layer2 = compositions.filter((composition) => composition.subject === "node-http-service");

  it("has the CPU and the memory on each CPU model of the overhead laws", () => {
    const models = [...new Set(laws.filter((law) => law.conditions["base"] !== undefined).map((law) => law.id.split("/")[2]!))];
    expect(models.length).toBeGreaterThan(0);
    const expected = models.flatMap((model) => ["cpu", "memory"].map((measure) => `node-http-service/${model}/${measure}`)).sort();
    expect(layer2.map((composition) => composition.id).sort()).toEqual(expected);
  });

  it.each(layer2.map((composition) => composition.id))("%s gets a part above 0 from its overhead law at each end of the range", (id) => {
    // The interval of each overhead part is above 0: the runner adds CPU time and memory at each load of the range.
    const composition = layer2.find((each) => each.id === id)!;
    const { min, max } = rangeOf(composition);
    for (const rate of [min, max]) {
      const result = compositionValue(composition, CATALOG, demandAt(rate));
      if (result.tag !== "ok") throw new Error(result.error.message);
      const overhead = result.value.parts.filter((part) => part.kind === "law");
      expect(overhead.length).toBe(1);
      expect(overhead[0]!.interval.low).toBeGreaterThan(0);
    }
  });
});
