import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppProcess } from "@mark1russell7/capacity";
import { afterAll, describe, expect, it } from "vitest";
import { FIXTURE } from "../app-fixtures.ts";
import { APP_START_PROGRAM, appRunOf, readTreeApp, type TreeApp } from "../start-app.ts";

const PROGRAM = fileURLToPath(new URL(`./${APP_START_PROGRAM}`, import.meta.url));

const folders: string[] = [];
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

/** This function gives the tree of the tests with another run. */
const treeWith = (run: Partial<AppProcess> = {}): TreeApp => {
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

  it("opens the store in place with --home, with no copy", () => {
    const end = launch(treeWith(), true);
    expect(end.code).toBe(0);
    expect(end.line).toMatchObject({ copyMs: 0, closeMs: null });
  });

  // Windows has no signals: a SIGTERM to the process ends it at once, with no listener and no line.
  it.skipIf(process.platform === "win32")("waits for the ready path of an app on a free port, and it measures the close of the listener of SIGTERM", () => {
    const end = launch(
      treeWith({
        argv: ["node", "app.mjs", "--store", "{store}", "--port", "{port}"],
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
