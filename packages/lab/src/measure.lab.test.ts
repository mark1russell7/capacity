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
 * record of each case must show each cost in its own measure, inside its tolerance.
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
    // 1 ms of CPU work: the CPU time of the process, thus the control group counts it all
    expect(change("cpu.request")).toBeGreaterThanOrEqual(0.95);
    expect(change("cpu.request")).toBeLessThanOrEqual(1.3);
    // 16 KiB more in each reply, and the headers of its segments
    expect(change("network.tx.request")).toBeGreaterThanOrEqual(REPLY);
    expect(change("network.tx.request")).toBeLessThanOrEqual(1.08 * REPLY);
    // 64 MiB of live heap: the pages of V8 hold it, and the young generation and fragmentation add less than it
    expect(change("memory")).toBeGreaterThanOrEqual(0.95 * HEAP);
    expect(change("memory")).toBeLessThanOrEqual(2 * HEAP);
    // a request with 1 ms of CPU work has its reply 1 ms or more after its time
    expect(middle(more, "latency.p50")).toBeGreaterThanOrEqual(1);
  }, 1_200_000);
});
