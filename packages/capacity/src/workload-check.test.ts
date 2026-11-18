import { describe, expect, it } from "vitest";
import { checkWorkload, demandProblems } from "./workload-check.ts";
import { sampleWorkload } from "./workload.fixture.ts";
import { NO_DEMAND, type Workload, type WorkloadClass } from "./workload.ts";

/** This function gives the sample workload with a change of its first class. */
const withClass = (change: Partial<WorkloadClass>): Workload => {
  const sample = sampleWorkload();
  const [first, ...rest] = sample.classes as [WorkloadClass, ...WorkloadClass[]];
  return { ...sample, classes: [{ ...first, ...change }, ...rest] };
};

describe("checkWorkload", () => {
  it("finds no problem in the sample workload", () => {
    expect(checkWorkload(sampleWorkload())).toEqual([]);
  });

  it("accepts a workload with no class and no level", () => {
    expect(checkWorkload({ ...sampleWorkload(), ...NO_DEMAND })).toEqual([]);
  });

  it("names the format, the id and the title", () => {
    const workload = { ...sampleWorkload(), format: "capacity-workload/2", id: "Shop Peak", title: " " } as unknown as Workload;
    expect(checkWorkload(workload).map((found) => [found.code, found.path])).toEqual([
      ["format", "format"],
      ["id", "id"],
      ["id", "title"],
    ]);
  });

  it("names a class with an id that is not lower-case words", () => {
    expect(checkWorkload(withClass({ id: "Read All" }))).toMatchObject([{ code: "id", path: "classes[0].id" }]);
  });

  it("names two classes with one id", () => {
    expect(checkWorkload(withClass({ id: "write" }))).toMatchObject([{ code: "id", path: "classes", message: 'Two classes have the id "write".' }]);
  });

  it.each([
    ["a unit that is not canonical", { value: 5, unit: "req/s" }],
    ["a value that is not finite", { value: Number.NaN, unit: "{request}/s" }],
    ["a unit that is not a rate", { value: 5, unit: "B" }],
    ["a value below 0", { value: -1, unit: "{request}/s" }],
  ])("names a rate with %s", (_, rate) => {
    expect(checkWorkload(withClass({ rate }))).toMatchObject([{ code: "rate", path: "classes[0].rate" }]);
  });

  it("accepts a rate of 0, and a rate in each unit of time", () => {
    expect(checkWorkload(withClass({ rate: { value: 0, unit: "{request}/h" } }))).toEqual([]);
  });

  it("names a variable of a request with a bad name, the name of the rate, or a bad amount", () => {
    const request = {
      "Body-Size": { value: 1, unit: "B" },
      rate: { value: 1, unit: "{request}/s" },
      wait: { value: Number.POSITIVE_INFINITY, unit: "ms" },
      reply: { value: 1, unit: "bytes" },
    };
    expect(checkWorkload(withClass({ request })).map((found) => [found.code, found.path])).toEqual([
      ["id", "classes[0].request.Body-Size"],
      ["id", "classes[0].request.rate"],
      ["amount", "classes[0].request.wait"],
      ["amount", "classes[0].request.reply"],
    ]);
  });

  it("names a variable that is a size in one class and a time in a different class", () => {
    const sample = sampleWorkload();
    const [read, write] = sample.classes as [WorkloadClass, WorkloadClass];
    const workload = { ...sample, classes: [read, { ...write, request: { ...write.request, body: { value: 4, unit: "ms" } } }] };
    expect(checkWorkload(workload)).toMatchObject([
      { code: "unit", path: "classes[1].request.body", message: 'The variable "body" is in "ms" here, and it is in "B" in the class "read".' },
    ]);
  });

  it("accepts one variable in two units of one kind", () => {
    // The sample has the body in B and in KiB, and the reply in KiB and in B.
    expect(demandProblems(sampleWorkload())).toEqual([]);
  });

  it("names a level with a bad name, the name of the rate, a bad amount, or the name of a variable", () => {
    const levels = {
      open_sockets: { value: 1, unit: "{connection}" },
      rate: { value: 1, unit: "{request}/s" },
      incidents: { value: 1, unit: "incidents" },
      body: { value: 1, unit: "B" },
    };
    expect(checkWorkload({ ...sampleWorkload(), levels }).map((found) => [found.code, found.path])).toEqual([
      ["id", "levels.open_sockets"],
      ["id", "levels.rate"],
      ["amount", "levels.incidents"],
      ["id", "levels.body"],
    ]);
  });

  it("names a level that has the name of a variable with a bad amount", () => {
    const workload = { ...withClass({ request: { heap: { value: 1, unit: "what" } } }), levels: { heap: { value: 1, unit: "MiB" } } };
    expect(checkWorkload(workload).map((found) => [found.code, found.path])).toEqual([
      ["amount", "classes[0].request.heap"],
      ["id", "levels.heap"],
    ]);
  });

  it("names a plan with no note", () => {
    expect(checkWorkload({ ...sampleWorkload(), source: { kind: "plan", note: "" } })).toMatchObject([{ code: "source", path: "source.note" }]);
  });

  it("accepts a metrics source with a window", () => {
    const source = { kind: "metrics", origin: "https://metrics.example/shop", from: "2026-11-18T14:00:00Z", to: "2026-11-18T14:05:00Z" } as const;
    expect(checkWorkload({ ...sampleWorkload(), source })).toEqual([]);
  });

  it("names the origin and each time of a metrics source", () => {
    const source = { kind: "metrics", origin: "", from: "yesterday", to: "2026-11-18 14:05" } as const;
    expect(checkWorkload({ ...sampleWorkload(), source }).map((found) => [found.code, found.path])).toEqual([
      ["source", "source.origin"],
      ["source", "source.from"],
      ["source", "source.to"],
    ]);
  });

  it("names a window that does not go to a later time", () => {
    const source = { kind: "metrics", origin: "shop", from: "2026-11-18T14:05:00Z", to: "2026-11-18T14:05:00Z" } as const;
    expect(checkWorkload({ ...sampleWorkload(), source })).toMatchObject([{ code: "source", path: "source" }]);
  });
});
