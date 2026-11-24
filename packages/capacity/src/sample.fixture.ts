import { app, lit, ref, type Expr } from "@mark1russell7/vex";
import type { Law, RunPoint } from "./law.ts";

/** This function gives a number from -1 to 1 for a row and a column. It needs no random source. */
export const wave = (row: number, column: number): number => ((row * 7919 + column * 104_729) % 2001) / 1000 - 1;

/** The hinge: `c0 + c1 * rate + c2 * max(0, rate - knee)`. The cost goes up faster after the knee. */
export const hinge: Expr = app(
  "add",
  app("add", ref("c0"), app("multiply", ref("c1"), ref("rate"))),
  app("multiply", ref("c2"), app("max", lit(0), app("subtract", ref("rate"), ref("knee")))),
);

/** This function is the same hinge in plain arithmetic. A test compares the program with it. */
export const hingeOf = (c0: number, c1: number, c2: number, knee: number, rate: number): number =>
  c0 + c1 * rate + c2 * Math.max(0, rate - knee);

const ESTIMATE = [0.08, 0.000_01, 0.000_05, 2500] as const;

/**
 * This function gives the points of the fit of the sample law, one for each residual. The rates go from 100 to 4000 at
 * equal ratios. Each point comes from the run of the evidence.
 */
export const samplePoints = (): RunPoint[] =>
  Array.from({ length: 60 }, (_, row) => {
    const rate = 100 * 40 ** (row / 59);
    const value = hingeOf(ESTIMATE[0], ESTIMATE[1], ESTIMATE[2], ESTIMATE[3], rate) * (1 + 0.05 * wave(row, 7));
    return { load: { rate: Math.min(4000, rate) }, value, run: 0, job: `2026-11-18T14:0${row % 6}:00.000Z` };
  });

/** This function gives a sample law: the CPU time of one request against the request rate, as a hinge. */
export const sampleLaw = (): Law => ({
  format: "capacity-law/1",
  id: "node-http/reply/cpu",
  title: "The CPU time of one request of a bare Node HTTP server",
  subject: "node-http",
  measure: { id: "cpu", unit: "{core}·ms/{request}" },
  variables: [{ id: "rate", unit: "{request}/s", min: 100, max: 4000, scale: "log" }],
  conditions: {
    class: "reply",
    node: "24.11.0",
    "cpu.model": "AMD EPYC 7763",
    "cpu.limit": { value: 1, unit: "{core}" },
    "memory.limit": { value: 512, unit: "MiB" },
    keepalive: true,
    connections: 16,
  },
  form: { id: "hinge", program: hinge },
  constants: [
    { id: "c0", value: ESTIMATE[0] },
    { id: "c1", value: ESTIMATE[1] },
    { id: "c2", value: ESTIMATE[2] },
    { id: "knee", value: ESTIMATE[3] },
  ],
  replicates: Array.from({ length: 200 }, (_, row) => ESTIMATE.map((value, column) => value * (1 + 0.02 * wave(row, column)))),
  fit: {
    method: "least-squares",
    residual: "relative",
    residuals: Array.from({ length: 60 }, (_, row) => 0.05 * wave(row, 7)),
    losers: [
      { form: "constant", error: { mae: 0.3, rmse: 0.4 } },
      { form: "linear", error: { mae: 0.05, rmse: 0.07 } },
    ],
  },
  evidence: {
    runs: [
      {
        url: "https://github.com/mark1russell7/capacity/actions/runs/1",
        commit: "0123456789abcdef0123456789abcdef01234567",
        date: "2026-11-18T14:00:00Z",
      },
    ],
  },
  noise: {
    floor: 0.012,
    cpu: "Intel(R) Xeon(R) Platinum 8370C CPU @ 2.80GHz",
    runs: [
      {
        url: "https://github.com/mark1russell7/capacity/actions/runs/2",
        commit: "89abcdef0123456789abcdef0123456789abcdef",
        date: "2026-11-19T06:00:00Z",
      },
    ],
  },
});
