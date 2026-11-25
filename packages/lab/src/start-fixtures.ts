/**
 * These fixtures are the jobs of the plan `alerts-start-gate` for the tests of the start limits and of the start gate.
 * Each job starts the arm main and its A/A copy at each point in each round. The value of a job at a point is its largest reading:
 *
 * - live: 100 MB + 1 MB for each job + 10 MB for each point, + 1 kB for each round, + 500 B for the A/A copy.
 * - peak: 300 MB + 2 MB for each job, + 1 B for each round.
 * - readiness: 20000.4 ms + 100 ms for each job, + 10 ms for each round.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { quantity, type Quantity } from "@mark1russell7/quantity";
import { EPYC, runOf, timedOf } from "./law-fixtures.ts";
import type { LawJob } from "./laws.ts";
import { readPlans, type Plan } from "./plan.ts";
import { START_LIMIT_RUNS } from "./start-limits.ts";
import { START_MEASURES, START_RECORD_FORMAT, type StartMeasure, type StartReading, type StartRecord } from "./start-measure.ts";
import type { StartCase } from "./start.ts";

export const START_GATE_PLAN: Plan = readPlans(fileURLToPath(new URL("../plans/", import.meta.url))).plans.find((each) => each.id === "alerts-start-gate")!;
export const START_GATE_CASE = START_GATE_PLAN.cases[0] as StartCase;
const ARMS = ["main", "main~aa"] as const;

/** This function gives the measures of one reading. Each measure that the fixture does not set is 1 in its unit. */
const measuresOf = (job: number, point: number, arm: number, round: number): Readonly<Record<StartMeasure, Quantity | null>> => {
  const base = Object.fromEntries(Object.entries(START_MEASURES).map(([name, unit]) => [name, quantity(1, unit)])) as Record<StartMeasure, Quantity>;
  return {
    ...base,
    live: quantity(100_000_000 + 1_000_000 * job + 10_000_000 * point + 1000 * round + 500 * arm, "B"),
    peak: quantity(300_000_000 + 2_000_000 * job + round, "B"),
    readiness: quantity(20_000.4 + 100 * job + 10 * round, "ms"),
  };
};

/** This function gives the start record of one job. The record has the fields that the limits, the gate and the check read, thus the cast. */
export const startRecordOf = (job: number, value: StartCase = START_GATE_CASE): StartRecord => {
  const readings: StartReading[] = [];
  value.points.forEach((point, place) => {
    for (let round = 0; round < value.rounds; round += 1) {
      ARMS.forEach((arm, index) => {
        readings.push({ arm, point: point.id, round, position: index, measures: measuresOf(job, place, index, round), open: [], stalled: false, ballasts: [], samples: [] } as unknown as StartReading);
      });
    }
  });
  const orders = value.points.flatMap((point) => Array.from({ length: value.rounds }, (_, round) => ({ case: point.id, round, arms: ["main", "main"] })));
  return {
    format: START_RECORD_FORMAT,
    case: value,
    machine: { cpu: EPYC },
    job: String(job + 1),
    pairs: ["main~aa"],
    readings,
    orders,
    failures: [],
    skipped: [],
  } as unknown as StartRecord;
};

/** This function gives `count` jobs of the plan in the CI run `run`. The function `change` changes the record of each job. */
export const startJobsOf = (count = START_LIMIT_RUNS, run = 50, change: (record: StartRecord, job: number) => StartRecord = (record) => record): LawJob[] =>
  Array.from({ length: count }, (_, job) => ({
    timed: timedOf(START_GATE_PLAN.id, runOf(run), EPYC, `2026-11-24T07:${String(job).padStart(2, "0")}:00Z`),
    records: [],
    starts: [change(startRecordOf(job), job)],
  }));

/** This function writes the jobs into a folder, one subfolder for each job, as `gh run download` writes the artifacts of a run. */
export const writeStartJobs = (folder: string, jobs: readonly LawJob[]): void =>
  jobs.forEach((job, index) => {
    const name = join(folder, `lab-${START_GATE_PLAN.id}-${index + 1}-1`);
    mkdirSync(name, { recursive: true });
    const record = `${START_GATE_CASE.id.replace("/", "-")}.record.json`;
    writeFileSync(join(name, record), JSON.stringify(job.starts![0]));
    writeFileSync(join(name, "timed.json"), JSON.stringify({ ...job.timed, files: [{ case: START_GATE_CASE.id, record, result: "none.json" }] }));
  });
