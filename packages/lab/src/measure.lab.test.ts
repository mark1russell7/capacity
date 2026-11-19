import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { median } from "@mark1russell7/rigor-statistics";
import { describe, expect, it } from "vitest";
import { CASE_FORMAT, type Case } from "./case.ts";
import { measureCase } from "./measure.ts";
import type { CaseRecord, LoadMeasure, RunMeasure } from "./record.ts";

/**
 * The positive control of the lab: two cases that differ by known costs. The second case adds 1 ms
 * of CPU work, a reply of 16 KiB and a live heap of 64 MiB to each request of the first case. The
 * record of each case must show each cost in its own measure, inside its limits.
 *
 * The test needs Docker, thus it runs only with `CAPACITY_LAB=1`, in the workflow `lab.yml`.
 * `CAPACITY_LAB_OUT` names a folder for the records and the raw results.
 */
const RUN = process.env["CAPACITY_LAB"] === "1";
const OUT = process.env["CAPACITY_LAB_OUT"] || undefined;

const MIB = 1024 * 1024;
const REPLY = 16_384;
const HEAP = 64 * MIB;

const caseOf = (id: string, title: string, request: Case["demand"]["classes"][number]["request"], heap: number): Case => ({
  format: CASE_FORMAT,
  id: `control/${id}`,
  title,
  subject: "node-http",
  instance: { resources: { cpu: { value: 1, unit: "{core}" }, memory: { value: 512, unit: "MiB" } } },
  demand: {
    classes: [{ id: "control", rate: { value: 100, unit: "{request}/s" }, request }],
    levels: heap > 0 ? { heap: { value: heap, unit: "B" } } : {},
  },
  duration: { value: 10, unit: "s" },
  arrivals: { arrivals: "uniform" },
  runs: 3,
});

/** A limit is the lowest and the highest value that the test accepts. */
interface Limit {
  readonly low: number;
  readonly high: number;
}

/**
 * The limits come from 6 runs of `lab.yml` on two CPU models (AMD EPYC 9V74 and Intel Xeon 6975P-C):
 * the run 44448319523 and the 5 runs of 44449842625. Each limit is the worst run less or plus the
 * spread of the runs (the highest value less the lowest value), rounded outward.
 */
const LIMITS = {
  // the changes 0.990243 to 1.024453 ms, spread 0.034210: 0.956033 to 1.058663
  "cpu.request": { low: 0.956, high: 1.059 },
  // the change 16388.198 B in each run, spread 0, rounded to whole bytes. It is more than the reply, 16384 B.
  "network.tx.request": { low: 16_388, high: 16_389 },
  // the changes 65683456 to 70078464 B, spread 4395008: 61288448 to 74473472
  memory: { low: 61_288_448, high: 74_473_472 },
  // the median latency of the second case, 1.224058 to 1.360200 ms, spread 0.136142: 1.087916 to 1.496342. It is more than the work, 1 ms.
  "latency.p50": { low: 1.08, high: 1.5 },
} as const satisfies Record<string, Limit>;

const BASE = caseOf("base", "No work, no reply and no heap", {}, 0);
const MORE = caseOf("more", "1 ms of work, a reply of 16 KiB and 64 MiB of heap", { work: { value: 1, unit: "ms" }, reply: { value: REPLY, unit: "B" } }, HEAP);

/** This function gives the median of a measure over the runs of a record. A run with no read of the measure fails the test. */
const middle = (record: CaseRecord, name: RunMeasure | LoadMeasure): number => {
  const values = record.runs.map((run) => {
    const amount = run.measures[name];
    if (amount === null) throw new Error(`${record.case.id}: run ${run.index} has no read of ${name}`);
    return amount.value;
  });
  return median(values);
};

describe.skipIf(!RUN)("the positive control of the lab (CAPACITY_LAB=1)", () => {
  it("shows each added cost of a request in its own measure", async () => {
    const records: CaseRecord[] = [];
    for (const value of [BASE, MORE]) {
      const { record, result } = await measureCase(value);
      if (OUT !== undefined) {
        mkdirSync(OUT, { recursive: true });
        const name = value.id.replaceAll("/", "-");
        writeFileSync(join(OUT, `${name}.record.json`), `${JSON.stringify(record, null, 2)}\n`);
        writeFileSync(join(OUT, `${name}.result.json`), `${JSON.stringify(result)}\n`);
      }
      records.push(record);
    }
    const [base, more] = records as [CaseRecord, CaseRecord];

    // each run answers each request, with no failure, and each counter goes up
    for (const record of records) {
      expect(record.runs).toHaveLength(3);
      for (const run of record.runs) {
        expect(run.resets).toEqual([]);
        expect(run.missing).toBeNull();
        expect(run.measures.planned?.value).toBe(1000);
        expect(run.measures.answered?.value).toBe(1000);
        expect(run.measures.failed?.value).toBe(0);
        expect(run.measures.unfinished?.value).toBe(0);
      }
    }

    const change = (name: RunMeasure | LoadMeasure): number => middle(more, name) - middle(base, name);
    const within = (name: keyof typeof LIMITS, value: number): void => {
      expect(value, name).toBeGreaterThanOrEqual(LIMITS[name].low);
      expect(value, name).toBeLessThanOrEqual(LIMITS[name].high);
    };
    // 1 ms of CPU work: the CPU time of the process, thus the control group counts it all
    within("cpu.request", change("cpu.request"));
    // 16 KiB more in each reply, and the headers of its packets
    within("network.tx.request", change("network.tx.request"));
    // 64 MiB of live heap: the pages of V8 hold it, with the young generation and fragmentation
    within("memory", change("memory"));
    // a request with 1 ms of CPU work has its reply 1 ms or more after its time
    within("latency.p50", middle(more, "latency.p50"));
  }, 1_200_000);
});
