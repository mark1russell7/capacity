import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");

describe("the home page", () => {
  it("names the package and gives the install command", () => {
    expect(page).toContain("<title>capacity</title>");
    expect(page).toContain("git clone https://github.com/mark1russell7/capacity.git");
  });

  it("has an icon link, so the browser does not ask for /favicon.ico", () => {
    expect(page).toMatch(/<link rel="icon" href="[^"]+">/);
  });

  it("links to the pages of site-pages and to the repository", () => {
    expect(page).toContain('href="./releases/"');
    expect(page).toContain('href="./status/"');
    expect(page).toContain('href="https://github.com/mark1russell7/capacity"');
  });

  it("has the parts of the coverage view: the percent, the CPU model, the bars, the legend and the matrices", () => {
    for (const id of ["percent", "done-text", "cpu", "bars", "matrices"]) expect(page).toContain(`id="${id}"`);
    expect(page).toContain("How much of the goal is done");
    expect(page).toContain("Measured in CI, no law yet");
  });
});
