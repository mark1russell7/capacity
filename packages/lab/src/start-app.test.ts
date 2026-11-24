import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appWorkloadProblems, checkApp, checkWorkload, type AppContract, type AppProcess, type AppReady, type AppRun } from "@mark1russell7/capacity";
import { afterAll, describe, expect, it } from "vitest";
import { APP_CASE, FIXTURE } from "./app-fixtures.ts";
import { startCaseProblems, type StartCase } from "./start.ts";
import {
  FAKE_PORT,
  RUN_SLOTS,
  appCaseProblems,
  appFakesOf,
  appRunOf,
  appVariables,
  fillCommand,
  hostCommand,
  levelsOf,
  readTreeApp,
  runParts,
  seedAmountsOf,
  loadOf,
  loadVariables,
  serviceValues,
  variableValues,
  workloadOf,
  type TreeApp,
} from "./start-app.ts";

const folders: string[] = [];
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

/** This function gives a new folder that the tests remove at the end. */
const folder = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "capacity-app-"));
  folders.push(dir);
  return dir;
};

const tree = (): TreeApp => readTreeApp("base", FIXTURE);

/** This function gives the tree of the tests with other fields in its contract. */
const changed = (more: Partial<AppContract>, engines: string | undefined = ">=24"): TreeApp => ({ tree: "base", app: { ...tree().app, ...more }, engines });

/** This function gives the tree of the tests with another run. */
const withRun = (run: Partial<AppRun>): TreeApp => {
  const { app } = tree();
  return changed({ start: { ...app.start, run: { ...app.start.run, ...run } } });
};

const codes = (problems: readonly { readonly code: string; readonly path: string }[]): readonly string[] => problems.map((each) => `${each.code} ${each.path}`);

describe("the contract of a tree", () => {
  it("reads the contract and the range of Node of a tree, and gives its store variables", () => {
    const { app, engines } = tree();
    expect(app.id).toBe("fixture-app");
    expect(engines).toBe(">=24");
    expect(appVariables(app)).toEqual({ variables: { log: { unit: "B", min: 0, max: 1048576 } } });
  });

  it("throws for a tree with no contract file, with a file that is not JSON, and with a contract with problems", () => {
    const empty = folder();
    expect(() => readTreeApp("base", empty)).toThrow(/no contract file capacity-app.json/);
    writeFileSync(join(empty, "capacity-app.json"), "{ not json");
    expect(() => readTreeApp("base", empty)).toThrow(/is not JSON/);
    const contract = JSON.parse(readFileSync(join(FIXTURE, "capacity-app.json"), "utf8")) as Record<string, unknown>;
    writeFileSync(join(empty, "capacity-app.json"), JSON.stringify({ ...contract, format: "capacity-app/0" }));
    expect(() => readTreeApp("base", empty)).toThrow(/has problems/);
  });

  it("gives no range of Node for a tree with no package.json", () => {
    const dir = folder();
    writeFileSync(join(dir, "capacity-app.json"), readFileSync(join(FIXTURE, "capacity-app.json")));
    expect(readTreeApp("seeder", dir)).toMatchObject({ tree: "seeder", engines: undefined });
  });
});

describe("appCaseProblems", () => {
  it("gives no problem for the case of the tests and the contract of its tree, and the case has no problem of its shape", () => {
    expect(startCaseProblems(APP_CASE)).toEqual([]);
    expect(appCaseProblems(APP_CASE, [tree()])).toEqual([]);
  });

  it("refuses a contract with another id or repository, and a run that does not start node", () => {
    expect(codes(appCaseProblems(APP_CASE, [changed({ id: "other" })]))).toEqual(["subject subject"]);
    expect(codes(appCaseProblems(APP_CASE, [changed({ repository: "https://github.com/example/other.git" })]))).toEqual(["subject app"]);
    expect(codes(appCaseProblems(APP_CASE, [withRun({ argv: ["bun", "app.ts"] })]))).toEqual(["subject subject"]);
  });

  it("refuses a run with no script, a placeholder in an option of Node or in the script, and NODE_OPTIONS in its environment", () => {
    const messages = (run: Partial<AppProcess>): readonly string[] => appCaseProblems(APP_CASE, [withRun(run)]).map((each) => each.message);
    expect(messages({ argv: ["node", "--max-semi-space-size=1"] })).toEqual([expect.stringContaining("no script")]);
    expect(messages({ argv: ["node", "--title={store}", "app.ts"] })).toEqual([expect.stringContaining("placeholder in the script")]);
    expect(messages({ argv: ["node", "{store}/app.ts"] })).toEqual([expect.stringContaining("placeholder in the script")]);
    expect(messages({ env: { NODE_OPTIONS: "--max-old-space-size=100" } })).toEqual([expect.stringContaining("NODE_OPTIONS")]);
  });

  it("refuses a target with a Node that is not in engines.node, and a field engines.node that is not a range", () => {
    expect(codes(appCaseProblems(APP_CASE, [changed({}, ">=26")]))).toEqual(["target target.node"]);
    expect(codes(appCaseProblems(APP_CASE, [changed({}, "a newer one")]))).toEqual(["target target.node"]);
    expect(appCaseProblems(APP_CASE, [changed({}, undefined)])).toEqual([]);
  });

  it("refuses points that do not name each store variable, name another variable, or have an amount out of the range of the contract", () => {
    const at = (points: StartCase["points"]): readonly string[] => codes(appCaseProblems({ ...APP_CASE, points }, [tree()]));
    expect(at([{ id: "none", at: {} }])).toEqual(["point points[0].at"]);
    expect(at([{ id: "more", at: { log: { value: 1, unit: "KiB" }, shapes: { value: 1, unit: "KiB" } } }])).toEqual(["point points[0].at.shapes"]);
    expect(at([{ id: "big", at: { log: { value: 2, unit: "MiB" } } }])).toEqual(["point points[0].at.log"]);
    expect(at([{ id: "count", at: { log: { value: 2, unit: "s" } } }])).toEqual(["point points[0].at.log"]);
  });

  it("gives the points the level variables of the seed, and gives the amounts of the seed only the store variables", () => {
    const { app } = tree();
    const level = (id: string) => ({ id, title: `The ${id} of the configuration`, kind: "level", unit: "{route}", min: 1, max: 100, scale: "log" }) as const;
    const seed = { ...app.start.seed!, argv: [...app.start.seed!.argv, "--routes", "{variable.routes}"] };
    const leveled = changed({ variables: [...app.variables, level("routes"), level("quiet")], start: { ...app.start, seed } });
    expect(appVariables(leveled.app)).toEqual({ variables: { log: { unit: "B", min: 0, max: 1048576 }, routes: { unit: "{route}", min: 1, max: 100 } } });
    const point = { id: "routed", at: { log: { value: 1, unit: "KiB" }, routes: { value: 10, unit: "{route}" } } };
    expect(variableValues(leveled.app, point)).toEqual({ "variable.log": "1024", "variable.routes": "10" });
    expect(levelsOf(leveled.app, point)).toEqual({ routes: { value: 10, unit: "{route}" } });
    expect(seedAmountsOf('{"amounts":{"log":1024}}', leveled.app)).toEqual({ log: { value: 1024, unit: "B" } });
    const at = (points: StartCase["points"]): readonly string[] => codes(appCaseProblems({ ...APP_CASE, points }, [leveled]));
    expect(at([point])).toEqual([]);
    expect(at([{ id: "unrouted", at: { log: { value: 1, unit: "KiB" } } }])).toEqual(["point points[0].at"]);
    expect(at([{ id: "quiet", at: { ...point.at, quiet: { value: 1, unit: "{route}" } } }])).toEqual(["point points[0].at.quiet"]);
    expect(at([{ id: "far", at: { ...point.at, routes: { value: 1000, unit: "{route}" } } }])).toEqual(["point points[0].at.routes"]);
  });

  it("examines each tree: a problem of the seeder tree has its id", () => {
    const problems = appCaseProblems(APP_CASE, [tree(), { ...changed({ id: "other" }), tree: "seeder" }]);
    expect(problems.map((each) => each.message)).toEqual([expect.stringContaining('tree "seeder"')]);
  });
});

describe("the commands of a contract", () => {
  it("split a run into the options of Node, the script and its arguments", () => {
    expect(runParts(["node", "--expose-gc", "--max-semi-space-size=1", "app.ts", "--store", "x"])).toEqual({
      options: ["--expose-gc", "--max-semi-space-size=1"],
      script: "app.ts",
      args: ["--store", "x"],
    });
    expect(runParts(["node", "--expose-gc"])).toEqual({ options: ["--expose-gc"], script: undefined, args: [] });
  });

  it("fill each placeholder of the argv and of the environment, and throw for a placeholder with no value", () => {
    const { seed } = tree().app.start;
    const values = { store: "/work/stores/small", ...variableValues(tree().app, APP_CASE.points[0]!) };
    expect(values).toEqual({ store: "/work/stores/small", "variable.log": "1024" });
    expect(fillCommand(seed!, values)).toEqual({ argv: ["node", "seed.ts", "--out", "/work/stores/small", "--log", "1024"], cwd: ".", env: { FIXTURE_SEED: "1" } });
    expect(() => fillCommand(seed!, { store: "/work" })).toThrow(RangeError);
  });

  it("start a command with an environment through env, in its folder of the tree", () => {
    expect(hostCommand({ argv: ["node", "seed.ts"], cwd: "tools", env: { A: "1", B: "x y" } }, "/work/trees/base")).toEqual({
      argv: ["env", "A=1", "B=x y", "node", "seed.ts"],
      cwd: join("/work/trees/base", "tools"),
    });
    expect(hostCommand({ argv: ["pnpm", "install"], cwd: ".", env: {} }, "/work/trees/base").argv).toEqual(["pnpm", "install"]);
  });

  it("read the amounts of the last line of a seed, in the unit of each store variable", () => {
    const { app } = tree();
    expect(seedAmountsOf('The seed wrote the log.\n{"amounts":{"log":1024}}\n', app)).toEqual({ log: { value: 1024, unit: "B" } });
    expect(() => seedAmountsOf("The seed wrote the log.", app)).toThrow(/is not JSON/);
    expect(() => seedAmountsOf('{"log":1024}', app)).toThrow(/no record "amounts"/);
    expect(() => seedAmountsOf('{"amounts":{"log":-1}}', app)).toThrow(/no amount of 0 or more/);
    expect(() => seedAmountsOf('{"amounts":{}}', app)).toThrow(/"log"/);
  });
});

describe("the fakes of the services of a contract", () => {
  const fake = (script: string, ready: AppReady): AppProcess => ({ argv: ["node", script, "--port", "{port}", "--rates", "{workload}"], cwd: "fakes", env: { FAKE_PORT: "{port}" }, ready });
  /** This function gives the tree of the tests with a feed and a channel, and a run that gets the URL of each. */
  const served = (): TreeApp => {
    const { app } = tree();
    const run = { ...app.start.run, argv: [...app.start.run.argv, "--feed", "{service.feed}"], env: { ...app.start.run.env, CHANNEL: "{service.channel}/send" } };
    const services = [
      { id: "feed", title: "A feed of events", fake: fake("feed.ts", { kind: "line", text: "feed up" }) },
      { id: "channel", title: "A channel of messages", fake: fake("channel.ts", { kind: "http", path: "/ready" }) },
    ];
    return changed({ services, start: { ...app.start, run } });
  };

  it("accepts a contract with services in an app case, and the contract has no problem", () => {
    expect(checkApp(served().app)).toEqual([]);
    expect(appCaseProblems(APP_CASE, [served()])).toEqual([]);
  });

  it("gives each fake a port from FAKE_PORT, and gives the run the URL of each fake on the loopback", () => {
    expect(serviceValues(served().app)).toEqual({ "service.feed": `http://127.0.0.1:${FAKE_PORT}`, "service.channel": `http://127.0.0.1:${FAKE_PORT + 1}` });
    const { file } = appRunOf(served(), FIXTURE);
    expect(file.args).toEqual(["--store", RUN_SLOTS.store, "--feed", "http://127.0.0.1:4100"]);
    expect(file.env).toEqual({ FIXTURE_STORE: RUN_SLOTS.store, CHANNEL: "http://127.0.0.1:4101/send" });
    expect(serviceValues(tree().app)).toEqual({});
  });

  it("gives the fakes file of an arm: the filled command of each fake, its absolute folder, its port and its ready signal", () => {
    const dir = folder();
    expect(appFakesOf(served(), dir, "/work/fakes/base.workload.json")).toEqual({
      app: "fixture-app",
      fakes: [
        { service: "feed", argv: ["node", "feed.ts", "--port", "4100", "--rates", "/work/fakes/base.workload.json"], cwd: join(dir, "fakes"), env: { FAKE_PORT: "4100" }, port: 4100, ready: { kind: "line", text: "feed up" } },
        { service: "channel", argv: ["node", "channel.ts", "--port", "4101", "--rates", "/work/fakes/base.workload.json"], cwd: join(dir, "fakes"), env: { FAKE_PORT: "4101" }, port: 4101, ready: { kind: "http", path: "/ready" } },
      ],
    });
  });

  it("gives the fakes a workload with no load at a point with no rate, and the workload has no problem against the contract", () => {
    const { app } = served();
    const workload = workloadOf(app, APP_CASE.points[0]!);
    expect(workload).toMatchObject({ id: `fixture-app/${APP_CASE.points[0]!.id}`, classes: [], levels: {} });
    expect(checkWorkload(workload)).toEqual([]);
    expect(appWorkloadProblems(app, workload)).toEqual([]);
  });
});

describe("the load of a point", () => {
  const bytes = { id: "eventBytes", title: "The bytes of one event", kind: "request", unit: "B", min: 200, max: 100000, scale: "linear" } as const;
  const rate = (max: number) => ({ unit: "{event}/s", min: 0, max, scale: "linear" }) as const;
  /** This function gives the tree of the tests with a feed and a request variable. It has a class of the feed and a class of HTTP. */
  const loaded = (): TreeApp => {
    const { app } = tree();
    const fake: AppProcess = { argv: ["node", "feed.ts", "--port", "{port}", "--rates", "{workload}"], cwd: "fakes", env: {}, ready: { kind: "line", text: "feed up" } };
    return changed({
      variables: [...app.variables, bytes],
      classes: [
        { id: "event", title: "An event of the feed", rate: rate(100), request: ["eventBytes"], entry: { kind: "service", service: "feed" } },
        { id: "hit", title: "A request of HTTP", rate: rate(50), request: [], entry: { kind: "http", method: "GET", path: "/" } },
      ],
      services: [{ id: "feed", title: "A feed of events", fake }],
      start: { ...app.start, run: { ...app.start.run, argv: [...app.start.run.argv, "--feed", "{service.feed}", "--port", "{port}"] } },
    });
  };
  const log = { value: 1, unit: "KiB" };
  const at = (more: Record<string, { value: number; unit: string }>) => ({ id: "load", at: { log, ...more } });

  it("gives the load variables of a contract: the rate of each class and each request variable, with their ranges", () => {
    const { app } = loaded();
    expect(checkApp(app)).toEqual([]);
    expect(loadVariables(app)).toEqual({
      variables: { event: { unit: "{event}/s", min: 0, max: 100 }, hit: { unit: "{event}/s", min: 0, max: 50 }, eventBytes: { unit: "B", min: 200, max: 100000 } },
    });
    expect(loadVariables(tree().app)).toEqual({ variables: {} });
    // A class with the id of a variable has no load variable.
    expect(Object.keys(loadVariables({ ...app, classes: [{ ...app.classes[0]!, id: "log" }] }).variables)).toEqual(["eventBytes"]);
  });

  it("gives the fakes the rate of each class above 0 and the amounts of its requests, and keeps the load out of the levels", () => {
    const { app } = loaded();
    const point = at({ event: { value: 30, unit: "{event}/s" }, eventBytes: { value: 2000, unit: "B" }, hit: { value: 0, unit: "{event}/s" } });
    expect(loadOf(app, point)).toEqual({ event: { value: 30, unit: "{event}/s" }, eventBytes: { value: 2000, unit: "B" }, hit: { value: 0, unit: "{event}/s" } });
    const workload = workloadOf(app, point);
    expect(workload).toMatchObject({ id: "fixture-app/load", classes: [{ id: "event", rate: { value: 30, unit: "{event}/s" }, request: { eventBytes: { value: 2000, unit: "B" } } }], levels: {} });
    expect(checkWorkload(workload)).toEqual([]);
    expect(appWorkloadProblems(app, workload)).toEqual([]);
    expect(workloadOf(app, at({ eventBytes: { value: 2000, unit: "B" } })).classes).toEqual([]);
  });

  it("accepts a point with a load, and refuses a rate with no request variable, a rate of HTTP, and a load out of its range", () => {
    const points = (more: Record<string, { value: number; unit: string }>): readonly string[] => appCaseProblems({ ...APP_CASE, points: [at(more)] }, [loaded()]).map((each) => `${each.code} ${each.path}: ${each.message}`);
    expect(points({ event: { value: 30, unit: "{event}/s" }, eventBytes: { value: 2000, unit: "B" } })).toEqual([]);
    expect(points({ event: { value: 0, unit: "{event}/s" } })).toEqual([]);
    expect(points({ event: { value: 30, unit: "{event}/s" } })).toEqual(['point points[0].at: The point gives the class "event" a rate, and it does not name its request variable "eventBytes".']);
    expect(points({ hit: { value: 5, unit: "{event}/s" } })).toEqual(['point points[0].at.hit: The class "hit" of the contract of the tree "base" comes from HTTP. The lab sends no request of HTTP yet (CAP-71).']);
    expect(codes(appCaseProblems({ ...APP_CASE, points: [at({ event: { value: 300, unit: "{event}/s" }, eventBytes: { value: 2000, unit: "B" } })] }, [loaded()]))).toEqual(["point points[0].at.event"]);
    expect(codes(appCaseProblems({ ...APP_CASE, points: [at({ event: { value: 3, unit: "B" }, eventBytes: { value: 2000, unit: "B" } })] }, [loaded()]))).toEqual(["point points[0].at.event"]);
  });
});

describe("appRunOf", () => {
  it("gives the run file of an arm: the absolute script and folder, and the tokens of the lab in place of {store}", () => {
    const dir = folder();
    const { file, options } = appRunOf(tree(), dir);
    expect(options).toEqual(["--max-semi-space-size=1"]);
    expect(file).toEqual({
      app: "fixture-app",
      script: join(dir, "app.ts"),
      cwd: join(dir, "."),
      args: ["--store", RUN_SLOTS.store],
      env: { FIXTURE_STORE: RUN_SLOTS.store },
      ready: { kind: "line", text: "fixture ready" },
      lines: [],
      slots: { store: RUN_SLOTS.store },
    });
  });

  it("gives a slot of the port to a run with {port} or with a ready signal http, and throws for a run with no script", () => {
    expect(appRunOf(withRun({ argv: ["node", "app.ts", "--port", "{port}"] }), FIXTURE).file.args).toEqual(["--port", RUN_SLOTS.port]);
    expect(appRunOf(withRun({ ready: { kind: "http", path: "/ready" }, argv: ["node", "app.ts", "--port={port}"] }), FIXTURE).file.slots).toEqual(RUN_SLOTS);
    expect(() => appRunOf(withRun({ argv: ["node"] }), FIXTURE)).toThrow(RangeError);
    const lines = [{ kind: "pass", ev: "lab-pass", title: "The end of a pass" }] as const;
    expect(appRunOf(withRun({ lines }), FIXTURE).file.lines).toEqual(lines);
  });
});
