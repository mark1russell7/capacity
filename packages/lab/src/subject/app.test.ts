import { readFileSync } from "node:fs";
import { metricsGaps, requestPath, type AppContract } from "@mark1russell7/capacity";
import { readApp } from "@mark1russell7/capacity/schema";
import { describe, expect, it } from "vitest";
import { NODE_HTTP } from "../subjects.ts";
import { EMPTY, FIELDS, LIMITS, UNITS, classOf, type RequestClass } from "./class.ts";

/** This function reads the contract of the bare subject from its file, and throws for each problem. */
const contractOf = (): AppContract => {
  const read = readApp(JSON.parse(readFileSync(new URL("./node-http.app.json", import.meta.url), "utf8")));
  if (read.tag === "err") throw new Error(read.error.map((each) => `${each.path}: ${each.message}`).join("\n"));
  return read.value;
};

describe("the contract of the bare subject", () => {
  it("has no problem, and its variables are the fields of a request class, with their units and limits", () => {
    const app = contractOf();
    expect(app.id).toBe(NODE_HTTP.name);
    expect(app.variables.map((each) => [each.id, each.kind, each.unit, each.min, each.max])).toEqual(
      FIELDS.map((field) => [field, "request", UNITS[field], 0, LIMITS[field]]),
    );
    expect(app.classes.map((each) => each.request)).toEqual([FIELDS]);
  });

  it("starts the program of the subject from the folder of its files, and reads the ready line of the subject", () => {
    const { run } = contractOf().start;
    expect(run.argv.slice(0, 2)).toEqual(["node", NODE_HTTP.program]);
    expect(NODE_HTTP.files).toContain(run.argv[1]);
    const root = new URL("../../../../", import.meta.url);
    expect(new URL(`${run.cwd}/${NODE_HTTP.program}`, root).href).toBe(new URL(`./${NODE_HTTP.program}`, import.meta.url).href);
    expect(run.ready).toEqual({ kind: "line", text: NODE_HTTP.ready });
  });

  it("gives the path of a request that the subject reads as its class", () => {
    const entry = contractOf().classes[0]?.entry;
    if (entry?.kind !== "http") throw new Error("The class of the bare subject is not a class of HTTP.");
    const asked: readonly RequestClass[] = [EMPTY, { body: 1024, alloc: 4096, work: 500, wait: 2, reply: 65_536 }, LIMITS];
    for (const each of asked) expect(classOf(requestPath(entry, { ...each }) ?? "")).toEqual(each);
  });

  it("has no live metrics, thus each part of its demand is a gap", () => {
    expect(metricsGaps(contractOf()).map((gap) => `${gap.need} ${gap.variable ?? ""}`.trim())).toEqual(["rate", ...FIELDS.map((field) => `total ${field}`)]);
  });
});
