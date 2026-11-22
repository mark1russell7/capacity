/**
 * These fixtures are the app of the tests of the app cases: a tree with a contract, and a start case of the app. The tree
 * is the folder `test/fixtures/app-tree`, with a seed and an app that need only Node.
 */
import { fileURLToPath } from "node:url";
import { START_FORMAT, type StartCase } from "./start.ts";

/** This folder is the tree of the app of the tests: a contract, a `package.json`, a seed and an app. */
export const FIXTURE: string = fileURLToPath(new URL("../test/fixtures/app-tree/", import.meta.url));

const A = "a".repeat(40);
const B = "b".repeat(40);

/** This case starts the app of the tests at two stores. */
export const APP_CASE: StartCase = {
  format: START_FORMAT,
  id: "fixture-start/test",
  title: "Two logs",
  subject: "fixture-app",
  app: "https://github.com/example/fixture-app.git",
  seeder: A,
  arms: [
    { id: "base", commit: A },
    { id: "new", commit: B },
  ],
  points: [
    { id: "small", at: { log: { value: 1, unit: "KiB" } } },
    { id: "large", at: { log: { value: 512, unit: "KiB" } } },
  ],
  seed: "test-1",
  rounds: 1,
  watch: { value: 2, unit: "s" },
  limit: { value: 1, unit: "min" },
  windows: [{ value: 30, unit: "s" }],
  probe: { value: 500, unit: "ms" },
  target: {
    image: "node:24.21.0-bookworm-slim",
    node: "v24.21.0",
    memory: { value: 1011425280, unit: "B" },
    swap: { value: 2, unit: "GiB" },
    cpus: 2,
    heapLimit: null,
  },
  observed: [],
};
