import { describe, expect, it } from "vitest";
import { CASE_FORMAT, caseLevel, caseProblems, requestClassOf, type Case } from "./case.ts";

const CASE: Case = {
  format: CASE_FORMAT,
  id: "node-http/work-500us",
  title: "500 us of work at 200 requests each second",
  subject: "node-http",
  instance: { resources: { cpu: { value: 1, unit: "{core}" }, memory: { value: 268_435_456, unit: "B" } } },
  demand: {
    classes: [{ id: "work", rate: { value: 200, unit: "{request}/s" }, request: { work: { value: 0.5, unit: "ms" }, reply: { value: 1024, unit: "B" } } }],
    levels: { heap: { value: 67_108_864, unit: "B" } },
  },
  duration: { value: 30, unit: "s" },
  arrivals: { arrivals: "poisson", seed: "work-500us" },
  keepAlive: true,
  runs: 5,
};

const codes = (value: Case): readonly string[] => caseProblems(value).map((each) => `${each.code} ${each.path}`);

describe("the check of a case", () => {
  it("gives no problem for a correct case", () => {
    expect(caseProblems(CASE)).toEqual([]);
    expect(caseProblems({ ...CASE, arrivals: { arrivals: "uniform" }, demand: { ...CASE.demand, levels: {} } })).toEqual([]);
  });

  it("refuses a record that is not a case", () => {
    expect(codes(null as unknown as Case)).toEqual(["shape "]);
    expect(codes({ ...CASE, format: "capacity-case/0" } as unknown as Case)).toEqual(["format format"]);
    expect(codes({ ...CASE, id: "Work 500" })).toEqual(["id id"]);
    expect(codes({ ...CASE, title: " " })).toEqual(["id title"]);
    expect(codes({ ...CASE, subject: "deno-http" })).toEqual(["subject subject"]);
    expect(codes({ ...CASE, keepAlive: "yes" } as unknown as Case)).toEqual(["shape keepAlive"]);
  });

  it("gives the problems of the instance from the capacity package, and the resources that the lab cannot limit", () => {
    expect(codes({ ...CASE, instance: { resources: { cpu: { value: 0, unit: "{core}" }, memory: CASE.instance.resources["memory"]! } } })).toEqual([
      "instance instance.resources.cpu",
    ]);
    expect(codes({ ...CASE, instance: { resources: { cpu: CASE.instance.resources["cpu"]! } } })).toEqual(["instance instance.resources.memory"]);
    expect(
      caseProblems({ ...CASE, instance: { resources: { ...CASE.instance.resources, network: { value: 1e9, unit: "bit/s" } } } }).map((each) => each.message),
    ).toEqual(['The lab cannot limit "network". It limits cpu and memory.']);
  });

  it("gives the problems of the demand from the capacity package, then what a subject cannot do", () => {
    const one = CASE.demand.classes[0]!;
    expect(codes({ ...CASE, demand: { ...CASE.demand, classes: [] } })).toEqual(["demand demand.classes"]);
    expect(codes({ ...CASE, demand: { ...CASE.demand, classes: [{ ...one, rate: { value: 200, unit: "B" } }] } })).toEqual(["demand demand.classes[0].rate"]);
    expect(codes({ ...CASE, demand: { ...CASE.demand, classes: [{ ...one, rate: { value: 0, unit: "{request}/s" } }] } })).toEqual([
      "demand demand.classes[0].rate",
    ]);
    const request = (amounts: Case["demand"]["classes"][number]["request"]): Case => ({ ...CASE, demand: { ...CASE.demand, classes: [{ ...one, request: amounts }] } });
    expect(caseProblems(request({ sleep: { value: 1, unit: "ms" } })).map((each) => each.message)).toEqual([
      'The lab has no variable "sleep". The variables of a request are body, alloc, work, wait, reply.',
    ]);
    expect(codes(request({ work: { value: 1, unit: "B" } }))).toEqual(["request demand.classes[0].request.work"]);
    expect(caseProblems(request({ work: { value: 0.0005, unit: "us" } })).map((each) => each.message)).toEqual([
      '"work" is 0.0005 us. It must be a whole number of us from 0 to 10000000.',
    ]);
    expect(codes(request({ reply: { value: 17 * 1024 * 1024, unit: "B" } }))).toEqual(["request demand.classes[0].request.reply"]);
    expect(codes({ ...CASE, demand: { ...CASE.demand, levels: { connections: { value: 100, unit: "{connection}" } } } })).toEqual([
      "level demand.levels.connections",
    ]);
    expect(codes({ ...CASE, demand: { ...CASE.demand, levels: { heap: { value: 1, unit: "s" } } } })).toEqual(["level demand.levels.heap"]);
  });

  it("refuses a duration, arrivals and runs that a run cannot take", () => {
    expect(codes({ ...CASE, duration: { value: 0, unit: "s" } })).toEqual(["duration duration"]);
    expect(codes({ ...CASE, duration: { value: 601, unit: "s" } })).toEqual(["duration duration"]);
    expect(codes({ ...CASE, duration: { value: 30, unit: "B" } })).toEqual(["duration duration"]);
    expect(codes({ ...CASE, arrivals: { arrivals: "poisson" } } as unknown as Case)).toEqual(["arrivals arrivals.seed"]);
    expect(codes({ ...CASE, arrivals: { arrivals: "bursts" } } as unknown as Case)).toEqual(["arrivals arrivals.arrivals"]);
    expect(codes({ ...CASE, runs: 0 })).toEqual(["runs runs"]);
    expect(codes({ ...CASE, runs: 2.5 })).toEqual(["runs runs"]);
    expect(codes({ ...CASE, runs: 21 })).toEqual(["runs runs"]);
  });
});

describe("the request class and the levels of a case", () => {
  it("gives each field of a request class in its unit, and 0 for a field that the request does not name", () => {
    expect(requestClassOf(CASE.demand.classes[0]!.request)).toEqual({ body: 0, alloc: 0, work: 500, wait: 0, reply: 1024 });
    // a conversion factor is a floating number: 1.1 ms is 1100.0000000000002 us before the round
    expect(requestClassOf({ work: { value: 1.1, unit: "ms" }, wait: { value: 2, unit: "s" } })).toEqual({ body: 0, alloc: 0, work: 1100, wait: 2000, reply: 0 });
    expect(() => requestClassOf({ work: { value: 1.5, unit: "us" } })).toThrow(RangeError);
  });

  it("gives a level in its unit, and 0 for a level that the demand does not hold", () => {
    expect(caseLevel(CASE, "heap")).toBe(67_108_864);
    expect(caseLevel({ ...CASE, demand: { ...CASE.demand, levels: {} } }, "heap")).toBe(0);
    expect(caseLevel(CASE, "connections")).toBe(0);
  });
});
