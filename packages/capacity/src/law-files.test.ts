import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
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
