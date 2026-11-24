import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluate, space, type Expr } from "@mark1russell7/vex";
import { tiered } from "@mark1russell7/vex-compiler";
import { LAW_DOMAINS, recordOf, valuesAt } from "./program.ts";
import { readLaw } from "./schema.ts";

/** This folder holds the law files that the workflow `laws.yml` gives. A pull request puts them here. */
const LAWS = fileURLToPath(new URL("../laws/", import.meta.url));
const SUFFIX = ".law.json";
/** This pattern accepts the URL of a run of GitHub Actions. A timed run starts only in CI. */
const CI_RUN = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+$/;

const files = readdirSync(LAWS, { recursive: true, encoding: "utf8" })
  .filter((name) => name.endsWith(SUFFIX))
  .map((name) => name.split(sep).join("/"))
  .sort();

/** This function gives the value of a program at each record from the interpreter of Vex, with no compiler. */
const interpretedValues = (program: Expr, records: readonly Readonly<Record<string, number>>[]): readonly (number | undefined)[] => {
  const at = space.array(records);
  return at.keys.map((origin) => {
    const found = evaluate(program, { space: at, origin, domains: LAW_DOMAINS });
    return found.ok && typeof found.value === "number" && Number.isFinite(found.value) ? found.value : undefined;
  });
};

describe("the law files", () => {
  it("has a law file or more", () => {
    // A folder with no file gives no read, not a pass.
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s is a law with the id of its path and runs of CI", (name) => {
    const result = readLaw(JSON.parse(readFileSync(join(LAWS, name), "utf8")));
    // The diff of a failure shows each problem of the file.
    expect(result.tag === "err" ? result.error : []).toEqual([]);
    if (result.tag !== "ok") return;
    const law = result.value;
    expect(law.id).toBe(name.slice(0, -SUFFIX.length));
    expect(law.evidence.runs.length).toBeGreaterThan(0);
    for (const run of [...law.evidence.runs, ...law.noise.runs]) expect(run.url).toMatch(CI_RUN);
  });
});

describe("the compiled programs of the law files", () => {
  it.each(files)("%s compiles to tier 2, and tier 2 gives the values of the interpreter at each row", (name) => {
    const result = readLaw(JSON.parse(readFileSync(join(LAWS, name), "utf8")));
    if (result.tag !== "ok") throw new Error(`${name} is not a law.`);
    const law = result.value;
    const program = tiered(law.form.program, { domains: LAW_DOMAINS });
    // A form with no generated code runs on tier 1, about 5 times slower. The reason tells which part of the form stops it.
    expect(program.reason).toBeUndefined();
    expect(program.tier).toBe(2);
    const middle = Object.fromEntries(law.variables.map((variable) => [variable.id, (variable.min + variable.max) / 2]));
    const names = law.constants.map((constant) => constant.id);
    const rows = [law.constants.map((constant) => constant.value), ...law.replicates];
    const records = rows.map((row) => recordOf(names, row, middle));
    const interpreted = interpretedValues(law.form.program, records);
    const at = space.array(records);
    const compiled = at.keys.map((origin) => {
      const found = program.run({ space: at, origin });
      return found.ok && typeof found.value === "number" && Number.isFinite(found.value) ? found.value : undefined;
    });
    expect(compiled).toEqual(interpreted);
    expect(program.stats.fallbacks).toBe(0);
    // The values of the package come from the same programs.
    expect(valuesAt(law.form.program, records)).toEqual(interpreted);
  });
});
