import { describe, expect, it } from "vitest";
import { CASE_FORMAT, IDLE_MIN_HOLD, MAX_ARRIVALS, arrivalsOf, caseCost, caseLevel, caseProblems, isIdleCase, requestClassOf, type Case } from "./case.ts";

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
    // a rate of events is a frequency for the capacity package, but the driver sends requests
    expect(caseProblems({ ...CASE, demand: { ...CASE.demand, classes: [{ ...one, rate: { value: 200, unit: "{event}/s" } }] } }).map((each) => each.message)).toEqual([
      'The rate of the class "work" does not convert to "{request}/s".',
    ]);
    expect(caseProblems({ ...CASE, demand: { ...CASE.demand, classes: [{ ...one, rate: { value: 6000, unit: "{request}/min" } }] } })).toEqual([]);
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

  it("takes a cost of the subject: a whole number of us up to the limit of the field work", () => {
    expect(caseProblems({ ...CASE, cost: { value: 10, unit: "us" } })).toEqual([]);
    expect(caseProblems({ ...CASE, cost: { value: 0.5, unit: "ms" } })).toEqual([]);
    expect(caseCost({ ...CASE, cost: { value: 0.5, unit: "ms" } })).toBe(500);
    expect(caseCost(CASE)).toBe(0);
    expect(codes({ ...CASE, cost: { value: 0.5, unit: "us" } })).toEqual(["cost cost"]);
    expect(codes({ ...CASE, cost: { value: -1, unit: "us" } })).toEqual(["cost cost"]);
    expect(codes({ ...CASE, cost: { value: 11, unit: "s" } })).toEqual(["cost cost"]);
    expect(codes({ ...CASE, cost: { value: 10, unit: "B" } })).toEqual(["cost cost"]);
    expect(codes({ ...CASE, cost: 10 } as unknown as Case)).toEqual(["cost cost"]);
  });

  it("takes the connections of the harness: a pipeline, a pool of 1 to 1024 connections, or a new connection for each arrival", () => {
    for (const connections of [{ mode: "pipeline" }, { mode: "pool", size: 1 }, { mode: "pool", size: 1024 }, { mode: "fresh" }] as const) {
      expect(caseProblems({ ...CASE, connections })).toEqual([]);
    }
    expect(codes({ ...CASE, connections: { mode: "pool", size: 0 } })).toEqual(["connections connections"]);
    expect(caseProblems({ ...CASE, connections: { mode: "pool", size: 1025 } }).map((each) => each.message)).toEqual([
      "The connections are not correct: the pool has the size 1025: a whole number from 1 to 1024.",
    ]);
    expect(codes({ ...CASE, connections: { mode: "keep" } } as unknown as Case)).toEqual(["connections connections"]);
    expect(codes({ ...CASE, connections: null } as unknown as Case)).toEqual(["connections connections"]);
    expect(codes({ ...CASE, connections: "pool" } as unknown as Case)).toEqual(["connections connections"]);
  });

  it("takes an idle case: each class at the rate 0, no cost and a hold of IDLE_MIN_HOLD or more", () => {
    const one = CASE.demand.classes[0]!;
    const idle: Case = { ...CASE, idle: true, demand: { ...CASE.demand, classes: [{ ...one, rate: { value: 0, unit: "{request}/s" } }] } };
    expect(isIdleCase(idle)).toBe(true);
    expect(isIdleCase(CASE)).toBe(false);
    expect(isIdleCase({ ...idle, idle: false })).toBe(false);
    expect(caseProblems(idle)).toEqual([]);
    expect(arrivalsOf(idle)).toBe(0);
    expect(caseProblems({ ...idle, duration: IDLE_MIN_HOLD })).toEqual([]);
    // a case of load keeps its rule: a rate above 0
    expect(codes({ ...idle, idle: false })).toEqual(["demand demand.classes[0].rate"]);
    expect(caseProblems({ ...idle, demand: CASE.demand }).map((each) => each.message)).toEqual(['The rate of the class "work" is not 0. An idle case sends no request.']);
    expect(caseProblems({ ...idle, duration: { value: 9.5, unit: "s" } }).map((each) => each.message)).toEqual([
      "The hold of the idle case is 9.5 s. An idle case holds for 10 s or more.",
    ]);
    expect(codes({ ...idle, cost: { value: 10, unit: "us" } })).toEqual(["idle cost"]);
    expect(codes({ ...idle, idle: "yes" } as unknown as Case)).toEqual(["demand demand.classes[0].rate", "idle idle"]);
  });

  it("refuses a case that plans more than MAX_ARRIVALS arrivals in its runs and its warm-up run", () => {
    const rate = (value: number, runs: number): Case => ({
      ...CASE,
      demand: { ...CASE.demand, classes: [{ ...CASE.demand.classes[0]!, rate: { value, unit: "{request}/s" } }] },
      duration: { value: 1, unit: "s" },
      runs,
    });
    expect(arrivalsOf(CASE)).toBe(200 * 30);
    expect(arrivalsOf(rate(36_000, 3))).toBe(36_000);
    // 4 runs of 36000 arrivals are 144000, and 4 runs of 37500 are the limit
    expect(caseProblems(rate(36_000, 3))).toEqual([]);
    expect(caseProblems(rate(MAX_ARRIVALS / 4, 3))).toEqual([]);
    expect(caseProblems(rate(40_000, 3))).toEqual([
      { code: "load", path: "demand", message: `The case plans 160000 arrivals in its 4 runs, with the warm-up run. A case plans at most ${MAX_ARRIVALS}.` },
    ]);
    // two classes add their arrivals
    const two = rate(20_000, 3);
    expect(codes({ ...two, demand: { ...two.demand, classes: [...two.demand.classes, { ...two.demand.classes[0]!, id: "more" }] } })).toEqual(["load demand"]);
    // a case with another problem gets no count of its arrivals
    expect(codes({ ...rate(40_000, 3), title: " " })).toEqual(["id title"]);
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
