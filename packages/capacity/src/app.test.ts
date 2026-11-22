import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { appWorkloadProblems, checkApp, fillPlaceholders, metricsGaps, placeholdersOf, requestPath } from "./app-check.ts";
import { counterIncrease, observationOf, type SeriesReading } from "./app-metrics.ts";
import type { AppContract } from "./app.ts";
import { sampleApp } from "./app.fixture.ts";
import { observedWorkload } from "./observe.ts";
import { readApp } from "./schema.ts";
import { sampleWorkload } from "./workload.fixture.ts";
import type { Workload } from "./workload.ts";

type Mutable<T> = T extends readonly (infer U)[] ? Mutable<U>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;

/** This function gives the code and the path of each problem of the sample contract after a change. */
const problemsOf = (change: (app: Mutable<AppContract>) => void): readonly string[] => {
  const app = structuredClone(sampleApp()) as Mutable<AppContract>;
  change(app);
  return checkApp(app as AppContract).map((each) => `${each.code} ${each.path}`);
};

/** This function gives the code and the path of each problem of the sample workload against the sample contract, after a change. */
const workloadProblemsOf = (change: (workload: Mutable<Workload>) => void): readonly string[] => {
  const workload = structuredClone(sampleWorkload()) as Mutable<Workload>;
  change(workload);
  return appWorkloadProblems(sampleApp(), workload as Workload).map((each) => `${each.code} ${each.path}`);
};

describe("the contract of an app", () => {
  it("reads the sample contract from the data of a file, with no problem and no gap", () => {
    expect(checkApp(sampleApp())).toEqual([]);
    expect(readApp(JSON.parse(JSON.stringify(sampleApp())))).toEqual({ tag: "ok", value: sampleApp() });
    expect(metricsGaps(sampleApp())).toEqual([]);
  });

  it("gives a shape problem for a field that a contract does not have", () => {
    expect(readApp({ ...sampleApp(), owner: "me" })).toMatchObject({ tag: "err", error: [{ code: "shape", path: "" }] });
  });

  it("gives the placeholders of a text in their order, and puts their values in", () => {
    expect(placeholdersOf("--port={port} --to {service.payments}/v1")).toEqual(["port", "service.payments"]);
    expect(placeholdersOf("no placeholder")).toEqual([]);
    expect(fillPlaceholders("--to {service.payments}/v1", { "service.payments": "http://127.0.0.1:9000" })).toBe("--to http://127.0.0.1:9000/v1");
    expect(fillPlaceholders("--port={port}", {})).toBeUndefined();
    const read = sampleApp().classes[0]!.entry;
    expect(read.kind === "http" ? requestPath(read, { body: 0, reply: 2048, wait: 5 }) : undefined).toBe("/items?reply=2048&wait=5");
  });

  it("examines the format, the id, the repository and each variable", () => {
    expect(problemsOf((app) => void (app.format = "capacity-app/2" as never))).toEqual(["format format"]);
    expect(problemsOf((app) => void (app.repository = "http://example.org/shop.git"))).toEqual(["id repository"]);
    expect(problemsOf((app) => void (app.repository = "https://"))).toEqual(["id repository"]);
    expect(problemsOf((app) => void (app.repository = "https://example.org/my shop.git"))).toEqual(["id repository"]);
    expect(problemsOf((app) => void (app.variables[0]!.unit = "bytes"))).toEqual(["unit variables[0].unit"]);
    expect(problemsOf((app) => void (app.variables[4]!.min = 0))).toEqual(["range variables[4].min"]);
    expect(problemsOf((app) => void (app.variables[3]!.id = "rate"))).toContain("id variables[3].id");
    expect(problemsOf((app) => void (app.variables[1]!.id = "body"))).toContain("id variables[1].id");
  });

  it("examines each class: its rate, its request variables and its entry", () => {
    expect(problemsOf((app) => void (app.classes[0]!.rate.unit = "B"))).toEqual(["unit classes[0].rate.unit"]);
    expect(problemsOf((app) => void (app.classes[0]!.request[0] = "connections"))).toContain("variable classes[0].request[0]");
    expect(problemsOf((app) => void (app.classes[0]!.entry = { kind: "http", method: "GET", path: "items?reply={reply}&wait={wait}", body: "body" }))).toEqual([
      "entry classes[0].entry.path",
    ]);
    expect(problemsOf((app) => void (app.classes[0]!.entry = { kind: "http", method: "GET", path: "/items?reply={reply}&wait={wait}&n={count}", body: "body" }))).toEqual([
      "placeholder classes[0].entry.path",
    ]);
    expect(problemsOf((app) => void (app.classes[0]!.entry = { kind: "http", method: "GET", path: "/items?reply={reply}", body: "body" }))).toEqual(["entry classes[0].entry"]);
    expect(problemsOf((app) => void (app.classes[0]!.entry = { kind: "http", method: "GET", path: "/items?reply={reply}&body={body}", body: "wait" }))).toEqual([
      "unit classes[0].entry.body",
    ]);
    expect(problemsOf((app) => void (app.classes[2]!.entry = { kind: "service", service: "bank" }))).toEqual(["service classes[2].entry.service"]);
  });

  it("gives a problem for a request variable that no class has", () => {
    expect(
      problemsOf((app) => {
        for (const entry of app.classes.slice(0, 2)) {
          entry.request = ["body", "reply"];
          entry.entry = { kind: "http", method: "GET", path: "/items?reply={reply}", body: "body" };
        }
        app.metrics = app.metrics.filter((series) => !("total" in series.of && series.of.total === "wait"));
      }),
    ).toEqual(["variable variables[2]"]);
  });

  it("examines each command, its placeholders, its port, its store, the seed of each store variable and the URL of each service", () => {
    expect(problemsOf((app) => void (app.start.run.argv[3] = "{workload}"))).toEqual(["placeholder start.run.argv[3]", "command start.run"]);
    expect(problemsOf((app) => void (app.start.run.argv[5] = "data"))).toEqual(["command start.run"]);
    expect(problemsOf((app) => void (app.start.seed!.argv[5] = "data"))).toEqual(["command start.seed"]);
    expect(problemsOf((app) => void (app.services[0]!.fake.argv[3] = "9000"))).toEqual(["command services[0].fake"]);
    expect(problemsOf((app) => void (app.services[0]!.fake.argv[5] = "workload.json"))).toEqual(["command services[0].fake"]);
    expect(problemsOf((app) => void (app.start.run.env["PAYMENTS_URL"] = "{service.bank}"))).toEqual(["placeholder start.run.env.PAYMENTS_URL", "service services[0]"]);
    expect(problemsOf((app) => void (app.start.install!.argv = ["pnpm", "install", "{store}"]))).toEqual(["placeholder start.install.argv[2]"]);
    expect(problemsOf((app) => void delete app.start.seed)).toEqual(["command start"]);
    expect(problemsOf((app) => void (app.start.seed!.argv[3] = "1048576"))).toEqual(["command start.seed"]);
    expect(problemsOf((app) => void (app.start.seed!.cwd = "../scripts"))).toEqual(["command start.seed.cwd"]);
    expect(problemsOf((app) => void (app.start.run.env = { payments: "{service.payments}" }))).toEqual(["command start.run.env.payments"]);
    expect(problemsOf((app) => void (app.start.run.ready = { kind: "http", path: "health" }))).toEqual(["command start.run.ready.path"]);
    expect(problemsOf((app) => void (app.start.run.env = {}))).toEqual(["service services[0]"]);
  });

  it("examines each series: its kind, its unit and its target", () => {
    expect(problemsOf((app) => void (app.metrics[0]!.kind = "gauge"))).toEqual(["series metrics[0].kind"]);
    expect(problemsOf((app) => void (app.metrics[0]!.unit = "B"))).toEqual(["unit metrics[0].unit"]);
    expect(problemsOf((app) => void (app.metrics[9]!.of = { level: "wait" }))).toEqual(["series metrics[9].of"]);
    expect(problemsOf((app) => void (app.metrics[3]!.of = { total: "wait", class: "settle" }))).toEqual(["series metrics[3].of"]);
    expect(problemsOf((app) => void (app.metrics[1]!.of = { rate: "read" }))).toEqual(["series metrics[1].of"]);
    expect(problemsOf((app) => void (app.metrics[1]!.id = "shop_read_total"))).toContain("id metrics[1].id");
  });

  it("gives each gap of the live metrics", () => {
    const app = sampleApp();
    const fewer = { ...app, metrics: app.metrics.filter((series) => series.id !== "shop_read_wait_total" && series.id !== "shop_connections" && series.id !== "shop_settle_total") };
    expect(metricsGaps(fewer).map((gap) => [gap.need, gap.class, gap.variable])).toEqual([
      ["total", "read", "wait"],
      ["rate", "settle", undefined],
      ["level", undefined, "connections"],
    ]);
  });
});

describe("a workload against the contract of its app", () => {
  it("accepts the sample workload, and a class that names the class of the app with `of`", () => {
    expect(workloadProblemsOf(() => undefined)).toEqual([]);
    expect(workloadProblemsOf((workload) => void Object.assign(workload.classes[0]!, { id: "read-small", of: "read" }))).toEqual([]);
  });

  it("gives a problem for a class, a variable or a level that the app does not have", () => {
    expect(workloadProblemsOf((workload) => void (workload.classes[0]!.id = "search"))).toEqual(["class classes[0].id"]);
    expect(workloadProblemsOf((workload) => void Object.assign(workload.classes[0]!, { of: "search" }))).toEqual(["class classes[0].of"]);
    expect(workloadProblemsOf((workload) => void (workload.classes[0]!.request["size"] = { value: 1, unit: "B" }))).toEqual(["variable classes[0].request.size"]);
    expect(workloadProblemsOf((workload) => void delete workload.classes[0]!.request["wait"])).toEqual(["variable classes[0].request"]);
    expect(workloadProblemsOf((workload) => void (workload.levels["catalog"] = { value: 1, unit: "MiB" }))).toEqual(["variable levels.catalog"]);
  });

  it("gives a problem for an amount out of the range of the app, or in a unit of a different kind", () => {
    expect(workloadProblemsOf((workload) => void (workload.classes[1]!.rate = { value: 20_000, unit: "{request}/s" }))).toEqual(["range classes[1].rate"]);
    expect(workloadProblemsOf((workload) => void (workload.classes[0]!.request["wait"] = { value: 2, unit: "min" }))).toEqual(["range classes[0].request.wait"]);
    expect(workloadProblemsOf((workload) => void (workload.classes[0]!.request["reply"] = { value: 2, unit: "ms" }))).toEqual(["unit classes[0].request.reply"]);
    expect(workloadProblemsOf((workload) => void (workload.levels["connections"] = { value: 400, unit: "B" }))).toEqual(["unit levels.connections"]);
  });
});

describe("the increase of a counter", () => {
  it("adds each rise, and the whole value after a new start of the process", () => {
    expect(counterIncrease([])).toBe(0);
    expect(counterIncrease([7])).toBe(0);
    expect(counterIncrease([5, 8, 2, 4])).toBe(7);
  });

  it("is the last value less the first for a counter with no new start, and it adds over a split of the readings (property test)", () => {
    const values = fc.array(fc.nat({ max: 1_000_000 }), { minLength: 1, maxLength: 40 });
    fc.assert(
      fc.property(values, (steps) => {
        const rising = steps.reduce<number[]>((all, step) => [...all, (all.at(-1) ?? 0) + step], []);
        return counterIncrease(rising) === (rising.at(-1) ?? 0) - (rising[0] ?? 0);
      }),
    );
    fc.assert(
      fc.property(values, fc.nat(), (counts, cut) => {
        const at = cut % counts.length;
        return counterIncrease(counts) === counterIncrease(counts.slice(0, at + 1)) + counterIncrease(counts.slice(at));
      }),
    );
  });
});

describe("the observation of the live metrics", () => {
  const WINDOW = { origin: "https://metrics.example/shop", from: "2026-11-22T14:00:00Z", to: "2026-11-22T14:01:00Z" };
  const AT = ["2026-11-22T14:00:00Z", "2026-11-22T14:00:30Z", "2026-11-22T14:01:00Z"];

  /** This function gives the readings of a series at the three times of the window. */
  const series = (id: string, values: readonly number[]): readonly SeriesReading[] => values.map((value, index) => ({ series: id, at: AT[index] ?? "", value }));

  /** The readings of the sample workload in the window: 900 reads and 100 writes in each second, and no settled payment. */
  const READINGS: readonly SeriesReading[] = [
    ...series("shop_read_total", [0, 30_000, 24_000]),
    ...series("shop_read_body_total", [0, 0, 0]),
    ...series("shop_read_reply_total", [0, 30_000 * 2048, 24_000 * 2048]),
    ...series("shop_read_wait_total", [0, 30_000 * 5, 24_000 * 5]),
    ...series("shop_write_total", [100, 3100, 6100]),
    ...series("shop_write_body_total", [0, 3000 * 4096, 6000 * 4096]),
    ...series("shop_write_reply_total", [0, 3000 * 200, 6000 * 200]),
    ...series("shop_write_wait_total", [0, 3000 * 20, 6000 * 20]),
    ...series("shop_settle_total", [12, 12, 12]),
    ...series("shop_connections", [380, 400, 420]),
    { series: "shop_read_total", at: "2026-11-22T14:05:00Z", value: 99_999_999 },
  ];

  it("gives the workload of the window, through a new start of the process, and the app accepts it", () => {
    const observation = observationOf(sampleApp(), WINDOW, READINGS);
    expect(observation.tag).toBe("ok");
    if (observation.tag !== "ok") return;
    expect(observation.value.classes.map((entry) => entry.id)).toEqual(["read", "write"]);
    const workload = observedWorkload(observation.value, { id: "shop/live", title: "The shop in one minute" });
    expect(workload.tag).toBe("ok");
    if (workload.tag !== "ok") return;
    const [read, write] = workload.value.classes;
    expect(read?.rate).toEqual({ value: 900, unit: "{request}/s" });
    expect(read?.request).toEqual({ body: { value: 0, unit: "B" }, reply: { value: 2048, unit: "B" }, wait: { value: 5, unit: "ms" } });
    expect(write?.rate).toEqual({ value: 100, unit: "{request}/s" });
    expect(workload.value.levels).toEqual({ connections: { value: 400, unit: "{connection}" } });
    expect(appWorkloadProblems(sampleApp(), workload.value)).toEqual([]);
  });

  it("gives a problem for each gap, for a counter with one reading, for a gauge with none and for a window that is not correct", () => {
    const app = sampleApp();
    const fewer = { ...app, metrics: app.metrics.filter((each) => each.id !== "shop_read_wait_total") };
    const paths = (result: ReturnType<typeof observationOf>): readonly string[] => (result.tag === "err" ? result.error.map((each) => each.path) : []);
    expect(paths(observationOf(fewer, WINDOW, READINGS))).toEqual(["metrics"]);
    const lonely = READINGS.filter((reading) => reading.series !== "shop_write_total" || reading.at === AT[0]);
    expect(paths(observationOf(app, WINDOW, lonely))).toEqual(["readings.shop_write_total"]);
    expect(paths(observationOf(app, WINDOW, READINGS.filter((reading) => reading.series !== "shop_connections")))).toEqual(["readings.shop_connections"]);
    expect(paths(observationOf(app, { ...WINDOW, to: WINDOW.from }, READINGS))).toEqual(["window"]);
  });
});
