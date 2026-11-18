import { app, ref } from "@mark1russell7/vex";
import type { Composition } from "./composition.ts";
import type { Law } from "./law.ts";
import { sampleLaw, wave } from "./sample.fixture.ts";

/** This function gives `count` rows of replicates near the values of `estimate`, with no random source. */
export const rowsOf = (estimate: readonly number[], count: number, seed = 0): number[][] =>
  Array.from({ length: count }, (_, row) => estimate.map((value, column) => value * (1 + 0.02 * wave(row + seed, column))));

/** This function gives a law of a constant cost of one request in `unit`, with absolute residuals. */
export const costLaw = (id: string, cost: number, unit = "{core}·ms/{request}", count = 200): Law => ({
  ...sampleLaw(),
  id,
  title: `The cost ${id}`,
  subject: id.split("/")[0] as string,
  measure: { id: "cpu", unit },
  variables: [],
  form: { id: "constant", program: ref("c0") },
  constants: [{ id: "c0", value: cost }],
  replicates: rowsOf([cost], count, 31),
  fit: { method: "least-squares", residual: "absolute", residuals: Array.from({ length: 60 }, (_, row) => 0.1 * cost * wave(row, 3)), losers: [] },
});

/** This function gives a law of the memory of an instance against its open connections: `m0 + m1 * connections`. */
export const memoryLaw = (unit = "MiB"): Law => ({
  ...sampleLaw(),
  id: "node-http/memory",
  title: "The memory of a bare Node HTTP server",
  measure: { id: "memory", unit },
  variables: [{ id: "connections", unit: "{connection}", min: 0, max: 1000, scale: "linear" }],
  form: { id: "linear", program: app("add", ref("m0"), app("multiply", ref("m1"), ref("connections"))) },
  constants: [
    { id: "m0", value: 40 },
    { id: "m1", value: 0.05 },
  ],
  replicates: rowsOf([40, 0.05], 200, 7),
});

/** The laws of the tests: the CPU time of one request (a hinge), the cost of the runner, and the memory. */
export const catalogLaws = (): Law[] => [sampleLaw(), costLaw("runner/reply/cpu", 0.02), memoryLaw()];

/** This function gives a composition of the CPU of an instance, in `{core}`, with these terms. */
export const cpuComposition = (id: string, terms: Composition["terms"], unit = "{core}"): Composition => ({
  format: "capacity-composition/1",
  id,
  title: `The CPU of ${id}`,
  subject: id.split("/")[0] as string,
  measure: { id: "cpu", unit },
  terms,
});

/** Layer 1: the CPU of a bare Node server, the cost of each request times the rate of its class. */
export const layer1 = (): Composition => cpuComposition("node-http/cpu", [{ law: "node-http/reply/cpu", over: "each" }]);

/** Layer 2: layer 1 plus the cost of the service runner for each request. */
export const layer2 = (): Composition =>
  cpuComposition("runner/cpu", [{ composition: "node-http/cpu" }, { law: "runner/reply/cpu", over: "each" }]);
