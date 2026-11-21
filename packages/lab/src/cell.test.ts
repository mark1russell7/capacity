import { environmentProblems, imageProblems, loadPlanOf } from "@mark1russell7/harness";
import { constant } from "@mark1russell7/rigor-chaos";
import { describe, expect, it } from "vitest";
import { CASE_FORMAT, type Case } from "./case.ts";
import { DRAIN, READING_PERIOD, SUBJECT_PORT, cellOf, commandOf, cpuSetsOf, streamArrivals, streamsOf, windowOf } from "./cell.ts";
import { NODE_HTTP, subjectFiles } from "./subjects.ts";

const MEMORY = { value: 268_435_456, unit: "B" };

const CASE: Case = {
  format: CASE_FORMAT,
  id: "node-http/work-500us",
  title: "500 us of work at 200 requests each second",
  subject: "node-http",
  instance: { resources: { cpu: { value: 1, unit: "{core}" }, memory: MEMORY } },
  demand: {
    classes: [{ id: "work", rate: { value: 200, unit: "{request}/s" }, request: { work: { value: 0.5, unit: "ms" }, reply: { value: 1024, unit: "B" } } }],
    levels: { heap: { value: 67_108_864, unit: "B" } },
  },
  duration: { value: 30, unit: "s" },
  arrivals: { arrivals: "poisson", seed: "work-500us" },
  runs: 5,
};

describe("the CPU sets of a cell", () => {
  it("gives the subject one CPU for each started core, and the other CPUs to the driver", () => {
    expect(cpuSetsOf(1, 4)).toEqual({ subject: "0", others: "1-3" });
    expect(cpuSetsOf(2, 4)).toEqual({ subject: "0-1", others: "2-3" });
    expect(cpuSetsOf(3, 4)).toEqual({ subject: "0-2", others: "3" });
    expect(cpuSetsOf(0.5, 2)).toEqual({ subject: "0", others: "1" });
    expect(cpuSetsOf(1.5, 4)).toEqual({ subject: "0-1", others: "2-3" });
    // a conversion factor is a binary float: it does not start one more core
    expect(cpuSetsOf(2.0000000001, 4)).toEqual({ subject: "0-1", others: "2-3" });
  });

  it("refuses a host with no CPU for the driver", () => {
    expect(() => cpuSetsOf(1, 1)).toThrow(/needs 2 CPUs/);
    expect(() => cpuSetsOf(4, 4)).toThrow(RangeError);
    expect(() => cpuSetsOf(1, 2.5)).toThrow(RangeError);
  });
});

describe("the parts of a cell", () => {
  it("gives the command of the subject, with the heap of the demand as its ballast", () => {
    expect(commandOf(CASE)).toEqual(["node", `/opt/subject/${NODE_HTTP.program}`, "--port", "8080", "--keep-alive-timeout", "0", "--ballast", "67108864"]);
    expect(commandOf({ ...CASE, demand: { ...CASE.demand, levels: {} } })).toEqual(["node", "/opt/subject/node-http.main.ts", "--port", "8080", "--keep-alive-timeout", "0"]);
  });

  it("gives each stream its own Poisson seed, and keeps uniform arrivals", () => {
    expect(streamArrivals({ arrivals: "poisson", seed: "case" }, "work")).toEqual({ arrivals: "poisson", seed: "case/work" });
    expect(streamArrivals({ arrivals: "poisson", seed: 7 }, "work")).toEqual({ arrivals: "poisson", seed: "7/work" });
    expect(streamArrivals({ arrivals: "uniform" }, "work")).toEqual({ arrivals: "uniform" });
  });

  it("gives one stream for each class, at the rate of the class for the duration of the case", () => {
    expect(streamsOf(CASE)).toEqual([
      {
        key: "work",
        plan: { profile: constant(200, 30_000), options: { arrivals: "poisson", seed: "work-500us/work" } },
        requests: [`GET /?work=500&reply=1024 HTTP/1.1\r\nhost: node-http:${SUBJECT_PORT}\r\n\r\n`],
      },
    ]);
    const two: Case = {
      ...CASE,
      demand: {
        ...CASE.demand,
        classes: [...CASE.demand.classes, { id: "post", rate: { value: 600, unit: "{request}/min" }, request: { body: { value: 2, unit: "KiB" } } }],
      },
    };
    const [, post] = streamsOf(two);
    expect(post?.plan.profile).toEqual(constant(10, 30_000));
    expect(post?.requests).toEqual([`POST /?body=2048 HTTP/1.1\r\nhost: node-http:8080\r\ncontent-length: 2048\r\n\r\n${"x".repeat(2048)}`]);
    // the plan of the driver takes the streams, and each schedule has the arrivals of its rate: all of them when they are uniform
    const counts = (value: Case): (string | number)[][] => loadPlanOf(streamsOf(value)).streams.map((stream) => [stream.key, stream.schedule.times.length]);
    expect(counts({ ...two, arrivals: { arrivals: "uniform" } })).toEqual([
      ["work", 6000],
      ["post", 300],
    ]);
    // a Poisson count has its mean as its variance: each count is inside 4 standard deviations
    const [[, work], [, posts]] = counts(two) as [[string, number], [string, number]];
    expect(Math.abs(work - 6000)).toBeLessThanOrEqual(4 * Math.sqrt(6000));
    expect(Math.abs(posts - 300)).toBeLessThanOrEqual(4 * Math.sqrt(300));
  });

  it("gives each stream the connections of the case, and no field of connections for a case with none", () => {
    expect(streamsOf(CASE).map((stream) => "connections" in stream)).toEqual([false]);
    const pool: Case = { ...CASE, connections: { mode: "pool", size: 64 } };
    expect(streamsOf(pool).map((stream) => stream.connections)).toEqual([{ mode: "pool", size: 64 }]);
    expect(streamsOf({ ...CASE, connections: { mode: "fresh" } }).map((stream) => stream.connections)).toEqual([{ mode: "fresh" }]);
    // the plan of the driver takes the pool, and the harness finds no problem in the cell
    expect(loadPlanOf(streamsOf(pool)).content).toContain('"connections":{"mode":"pool","size":64}');
    const cell = cellOf(pool, { cpus: 4 });
    expect(cell.probe.streams?.map((stream) => stream.connections)).toEqual([{ mode: "pool", size: 64 }]);
    expect(environmentProblems(cell)).toEqual([]);
  });

  it("gives a window of two durations and the drain", () => {
    expect(windowOf(CASE)).toEqual({ value: 60 + 30, unit: "s" });
    expect(DRAIN).toEqual({ value: 30, unit: "s" });
  });
});

describe("the cell of a case", () => {
  it("gives a cell that the harness can operate", () => {
    const cell = cellOf(CASE, { cpus: 4 });
    expect(cell.target).toEqual({
      image: NODE_HTTP.image,
      subject: { kind: "pinned", image: NODE_HTTP.image },
      port: 8080,
      ready: NODE_HTTP.ready,
      files: subjectFiles(NODE_HTTP),
      command: commandOf(CASE),
      lines: true,
      limits: { cpus: 1, cpuset: "0", memory: MEMORY },
    });
    expect(cell).toMatchObject({
      name: "node-http/work-500us: 500 us of work at 200 requests each second",
      client: "load",
      fault: "none",
      probe: { mode: "schedule", keepalive: false, streams: streamsOf(CASE) },
      prediction: { detects: null, window: windowOf(CASE) },
      runs: 5,
      environments: 1,
      concurrency: 1,
      clientLimits: { cpuset: "1-3" },
      resources: { period: READING_PERIOD, cpuset: "1-3" },
    });
    // the checks of the harness: the limits of the two containers and the image of the subject
    expect(environmentProblems(cell)).toEqual([]);
    expect(imageProblems({ kind: "pinned", image: NODE_HTTP.image })).toEqual([]);
  });

  it("gives the quota of a part of a core, on one CPU", () => {
    const half = cellOf({ ...CASE, instance: { resources: { cpu: { value: 0.5, unit: "{core}" }, memory: MEMORY } } }, { cpus: 2 });
    expect(half.target.limits).toEqual({ cpus: 0.5, cpuset: "0", memory: MEMORY });
    expect(half.clientLimits).toEqual({ cpuset: "1" });
    expect(environmentProblems(half)).toEqual([]);
  });

  it("refuses a case with a problem, and a host with too few CPUs", () => {
    expect(() => cellOf({ ...CASE, runs: 0 }, { cpus: 4 })).toThrow(/runs: The count of runs/);
    expect(() => cellOf(CASE, { cpus: 1 })).toThrow(/needs 2 CPUs/);
  });
});
