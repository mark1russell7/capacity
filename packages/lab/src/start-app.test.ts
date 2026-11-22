import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appWorkloadProblems, checkApp, checkWorkload, type AppContract, type AppProcess, type AppReady } from "@mark1russell7/capacity";
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
  serviceValues,
  startWorkloadOf,
  variableValues,
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
const withRun = (run: Partial<AppProcess>): TreeApp => {
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

  it("gives the fakes a workload with no load, and the workload has no problem against the contract", () => {
    const { app } = served();
    const workload = startWorkloadOf(app);
    expect(workload).toMatchObject({ id: "fixture-app/start", classes: [], levels: {} });
    expect(checkWorkload(workload)).toEqual([]);
    expect(appWorkloadProblems(app, workload)).toEqual([]);
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
      slots: { store: RUN_SLOTS.store },
    });
  });

  it("gives a slot of the port to a run with {port} or with a ready signal http, and throws for a run with no script", () => {
    expect(appRunOf(withRun({ argv: ["node", "app.ts", "--port", "{port}"] }), FIXTURE).file.args).toEqual(["--port", RUN_SLOTS.port]);
    expect(appRunOf(withRun({ ready: { kind: "http", path: "/ready" }, argv: ["node", "app.ts", "--port={port}"] }), FIXTURE).file.slots).toEqual(RUN_SLOTS);
    expect(() => appRunOf(withRun({ argv: ["node"] }), FIXTURE)).toThrow(RangeError);
  });
});
