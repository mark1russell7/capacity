import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppRun } from "@mark1russell7/capacity";
import { afterAll, describe, expect, it } from "vitest";
import { FIXTURE } from "../app-fixtures.ts";
import { APP_START_PROGRAM, appRunOf, readTreeApp, type TreeApp } from "../start-app.ts";
import { lineRecorder, runLineFields } from "./ready.ts";

const PROGRAM = fileURLToPath(new URL(`./${APP_START_PROGRAM}`, import.meta.url));

const folders: string[] = [];
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

/** This function gives the tree of the tests with another run. */
const treeWith = (run: Partial<AppRun> = {}): TreeApp => {
  const tree = readTreeApp("base", FIXTURE);
  return { ...tree, app: { ...tree.app, start: { ...tree.app.start, run: { ...tree.app.start.run, ...run } } } };
};

/** The end of a child of the program: its exit code, its output, and its last line as JSON when it has one. */
interface End {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly line: Readonly<Record<string, unknown>> | undefined;
}

/**
 * This function writes the run file of a tree and a store of one file, and it starts the program as the lab does. With
 * `home`, the app opens the store in place. Else the program copies the store first.
 */
const launch = (tree: TreeApp, home = false): End => {
  const work = mkdtempSync(join(tmpdir(), "capacity-app-start-"));
  folders.push(work);
  const store = join(work, "store");
  mkdirSync(store);
  writeFileSync(join(store, "log"), "x");
  const { file, options } = appRunOf(tree, FIXTURE);
  const run = join(work, "run.json");
  writeFileSync(run, JSON.stringify(file));
  const args = ["--expose-gc", ...options, PROGRAM, "--run", run, "--case", "small", home ? "--home" : "--seeded", store, "--watch", "100"];
  const child = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 60_000 });
  const last = child.stdout.trim().split("\n").at(-1) ?? "";
  return { code: child.status, stdout: child.stdout, stderr: child.stderr, line: last.startsWith("{") ? (JSON.parse(last) as Record<string, unknown>) : undefined };
};

describe("the program app-start", () => {
  it("starts the run of a contract in its own process, with its store, and it ends at once when the app has no listener of SIGTERM", () => {
    const end = launch(treeWith());
    expect(end.stderr).toBe("");
    expect(end.code).toBe(0);
    // The app read the copy of the store: the argument and the environment got the same folder.
    expect(end.stdout).toContain("fixture ready with 1 files");
    expect(end.line).toMatchObject({ firstPass: null, passes: null, stalled: false, writes: null, closeMs: null, closeCode: null, ballasts: [], samples: [] });
    expect(end.line?.["ms"]).toBeGreaterThan(0);
    expect(end.line?.["readiness"]).toBeGreaterThanOrEqual(end.line?.["ms"] as number);
    expect(end.line?.["copyMs"]).toBeGreaterThan(0);
    expect(end.line?.["limit"]).toBeGreaterThan(0);
  });

  it("records the lines of the run that the contract names: the passes in the watch, and each write with its times", () => {
    const end = launch(
      treeWith({
        env: { FIXTURE_STORE: "{store}", FIXTURE_MODE: "lines" },
        lines: [
          { kind: "pass", ev: "fixture-pass", title: "The end of a pass" },
          { kind: "write", ev: "fixture-write", title: "A write of the snapshot" },
          { kind: "readings", ev: "fixture-readings", title: "A collection of the live metrics" },
        ],
      }),
    );
    expect(end.stderr).toBe("");
    expect(end.code).toBe(0);
    expect(end.line?.["passes"]).toBeGreaterThan(0);
    const writes = end.line?.["writes"] as readonly Record<string, number>[];
    expect(writes).toHaveLength(2);
    expect(writes[0]).toMatchObject({ longestMs: 3, writeMs: 2, rowsMs: 1, wallMs: 4, cpuMs: 2 });
    expect(writes[1]).toEqual({ ms: writes[1]!["ms"], longestMs: 7 });
    expect(writes[0]!["ms"]).toBeLessThanOrEqual(writes[1]!["ms"]!);
    const readings = end.line?.["readings"] as readonly { ms: number; readings: unknown }[];
    expect(readings).toHaveLength(1);
    expect(readings[0]).toEqual({ ms: readings[0]!.ms, readings: [{ series: "requests", at: "2026-11-24T12:00:00.000Z", value: 3 }] });
  });

  it("opens the store in place with --home, with no copy", () => {
    const end = launch(treeWith(), true);
    expect(end.code).toBe(0);
    expect(end.line).toMatchObject({ copyMs: 0, closeMs: null });
  });

  // Windows has no signals: a SIGTERM to the process ends it at once, with no listener and no line.
  it.skipIf(process.platform === "win32")("waits for the ready path of an app on a free port, and it measures the close of the listener of SIGTERM", () => {
    const end = launch(
      treeWith({
        argv: ["node", "app.ts", "--store", "{store}", "--port", "{port}"],
        env: { FIXTURE_STORE: "{store}", FIXTURE_MODE: "server" },
        ready: { kind: "http", path: "/ready" },
      }),
    );
    expect(end.stderr).toBe("");
    expect(end.code).toBe(0);
    expect(end.line).toMatchObject({ closeCode: 0, firstPass: null });
    expect(end.line?.["closeMs"]).toBeGreaterThanOrEqual(0);
  });

  it("fails with the code 1 for an app that ends before the end of the watch, and for an app whose import fails", () => {
    const early = launch(treeWith({ env: { FIXTURE_STORE: "{store}", FIXTURE_MODE: "exit" } }));
    expect(early.code).toBe(1);
    expect(early.stderr).toContain('The app "fixture-app" ended with the code 3 before the end of the watch.');
    expect(early.line).toBeUndefined();

    const broken = launch(treeWith({ env: { FIXTURE_STORE: "{store}", FIXTURE_MODE: "fail" } }));
    expect(broken.code).toBe(1);
    expect(broken.stderr).toContain('The import of the app "fixture-app" failed');
    expect(broken.stderr).toContain("The fixture fails at its import.");
  });
});

describe("the recorder of the lines of a run", () => {
  const kinds = [
    { kind: "pass", ev: "p" },
    { kind: "write", ev: "w" },
    { kind: "readings", ev: "r" },
  ];

  it("keeps the JSON lines of the named events, also a line in two chunks, with the time of its last chunk", () => {
    const recorder = lineRecorder(kinds);
    recorder.write('{"ev":"w","writeMs":5}\nnot JSON\n{"ev":"x"}\n{"ev":"p"', 1);
    recorder.write('}\n[1]\n{"ev":', 2);
    expect(recorder.lines()).toEqual([
      { kind: "write", ms: 1, fields: { ev: "w", writeMs: 5 } },
      { kind: "pass", ms: 2, fields: { ev: "p" } },
    ]);
  });

  it("keeps at most the limit of lines of each kind, and keeps nothing with no named line", () => {
    const recorder = lineRecorder(kinds, 2);
    recorder.write('{"ev":"p"}\n{"ev":"p"}\n{"ev":"p"}\n{"ev":"w"}\n', 0);
    expect(recorder.lines().map((line) => line.kind)).toEqual(["pass", "pass", "write"]);
    const none = lineRecorder([]);
    none.write('{"ev":"p"}\n', 0);
    expect(none.lines()).toEqual([]);
  });

  it("counts the passes from ready to the end of the watch, keeps the writes to the end with their times, and keeps the readings to the end, and gives null for a kind with no line", () => {
    const lines = [
      { kind: "write", ms: 1, fields: { ev: "w", writeMs: 4, longestMs: "slow", other: 1 } },
      { kind: "pass", ms: 1, fields: { ev: "p" } },
      { kind: "pass", ms: 5, fields: { ev: "p" } },
      { kind: "pass", ms: 9, fields: { ev: "p" } },
      { kind: "write", ms: 12, fields: { ev: "w", writeMs: 6 } },
      { kind: "readings", ms: 3, fields: { ev: "r", readings: [{ series: "rows", at: "2026-11-24T12:00:00.000Z", value: 7 }, { series: "rows", value: 8 }, null] } },
      { kind: "readings", ms: 11, fields: { ev: "r", readings: [] } },
    ];
    expect(runLineFields(kinds, lines, 2, 10)).toEqual({
      passes: 2,
      writes: [{ ms: 1, writeMs: 4 }],
      readings: [{ ms: 3, readings: [{ series: "rows", at: "2026-11-24T12:00:00.000Z", value: 7 }] }],
      amounts: null,
    });
    expect(runLineFields([{ kind: "pass" }], lines, 0, 20)).toEqual({ passes: 3, writes: null, readings: null, amounts: null });
    expect(runLineFields([], lines, 0, 20)).toEqual({ passes: null, writes: null, readings: null, amounts: null });
  });

  it("keeps the amounts of the last line amounts to the end of the watch, only for the run variables, in their units", () => {
    const lines = [
      { kind: "amounts", ms: 2, fields: { ev: "a", amounts: { routes: 10, holds: 3 } } },
      { kind: "amounts", ms: 8, fields: { ev: "a", amounts: { routes: 1001, holds: Number.NaN, other: 4 } } },
      { kind: "amounts", ms: 30, fields: { ev: "a", amounts: { routes: 5 } } },
    ];
    const units = { routes: "{route}", holds: "{hold}" };
    expect(runLineFields([{ kind: "amounts" }], lines, 0, 20, units).amounts).toEqual({ routes: { value: 1001, unit: "{route}" } });
    expect(runLineFields([{ kind: "amounts" }], lines, 0, 1, units).amounts).toEqual({});
    expect(runLineFields([{ kind: "amounts" }], [{ kind: "amounts", ms: 1, fields: { ev: "a", amounts: [1] } }], 0, 20, units).amounts).toEqual({});
    expect(runLineFields([{ kind: "pass" }], lines, 0, 20, units).amounts).toBeNull();
  });
});
