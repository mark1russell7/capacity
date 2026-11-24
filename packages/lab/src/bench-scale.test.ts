import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { PairedTime } from "@mark1russell7/rigor-bench";
import type { ArmProcess } from "@mark1russell7/rigor-bench/fresh";
import {
  AA_ARM,
  BASE_ARM,
  BENCH_CHANGES_FORMAT,
  BENCH_FORMAT,
  BENCH_RECORD,
  HEAD_ARM,
  benchCases,
  benchAgainOf,
  benchGate,
  benchNotesOf,
  benchRecordsAgain,
  benchRead,
  benchSummaryOf,
  pairedTimes,
  readBenchChanges,
  readBenchRecords,
  resultHash,
  type BenchChange,
  type BenchRecord,
} from "./bench-scale.ts";
import { readCompositions, readLaws } from "./jobs.ts";

/** This folder holds the files of the package capacity. */
const CAPACITY = fileURLToPath(new URL("../../capacity/", import.meta.url));

const ROUNDS = 6;

/**
 * This function gives the children of a run of 3 arms on one case: the base, the A/A base and the head. The head takes
 * `factor` times the time of the base. The order of the arms turns each round, and the times have a small seeded spread.
 */
const processesOf = (id: string, factor: number): { processes: ArmProcess[]; aa: PairedTime[] } => {
  const processes: ArmProcess[] = [];
  const aa: PairedTime[] = [];
  for (let round = 0; round < ROUNDS; round += 1) {
    const wobble = 1 + 0.002 * ((round % 3) - 1);
    const order = round % 2 === 0 ? [BASE_ARM, AA_ARM, HEAD_ARM] : [HEAD_ARM, AA_ARM, BASE_ARM];
    const ms: Record<string, number> = { [BASE_ARM]: 100 * wobble, [AA_ARM]: 100 / wobble, [HEAD_ARM]: 100 * factor * wobble };
    for (const [position, arm] of order.entries()) processes.push({ arm, case: id, round, position, ms: ms[arm] as number });
    aa.push({ case: id, round, first: order.indexOf(BASE_ARM) < order.indexOf(AA_ARM) ? "a" : "b", a: ms[BASE_ARM] as number, b: ms[AA_ARM] as number });
  }
  return { processes, aa };
};

const ENV = { cpu: "Test CPU", cores: 4, os: "linux", arch: "x64", node: "v26.0.0" };

const recordOf = (id: string, factor: number, same = true, commits = { base: "a".repeat(40), head: "b".repeat(40) }): BenchRecord => ({
  format: BENCH_FORMAT,
  case: id,
  commits,
  env: ENV,
  rounds: ROUNDS,
  ...processesOf(id, factor),
  same,
  // A changed case has a different hash on the head.
  hashes: { base: `base-${id}`, head: same ? `base-${id}` : `head-${id}` },
});

let folder = "";
afterEach(() => {
  if (folder !== "") rmSync(folder, { recursive: true, force: true });
  folder = "";
});

describe("benchCases", () => {
  const catalog = { laws: readLaws(join(CAPACITY, "laws")), compositions: readCompositions(join(CAPACITY, "compositions")) };
  const cases = benchCases(catalog);

  it("gives a scale case, a reach case and a slider case for each composition of the processor time, and the case knee", () => {
    const cpus = catalog.compositions.filter((each) => each.measure.id === "cpu").map((each) => each.id);
    expect(cpus.length).toBeGreaterThan(0);
    expect(cases.map((each) => each.id)).toEqual([...cpus.flatMap((id) => [`scale:${id}`, `reach:${id}`, `slider:${id}`]), "knee"]);
  });

  it("gives the same hash for two calls of a case, so a child of each arm has one hash", async () => {
    const api = await import("@mark1russell7/capacity");
    const fast = cases.find((each) => each.id.startsWith("reach:node-http/"));
    expect(fast).toBeDefined();
    if (fast === undefined) return;
    expect(resultHash(fast.run(api))).toBe(resultHash(fast.run(api)));
  });
});

describe("resultHash", () => {
  it("gives the same hash for two orders of the keys, and writes an infinite number as null", () => {
    expect(resultHash({ a: 1, b: [2, Infinity] })).toBe(resultHash({ b: [2, null], a: 1 }));
    expect(resultHash({ a: 1 })).not.toBe(resultHash({ a: 2 }));
  });

  it("gives the same hash when a number changes only past its 12th significant digit", () => {
    // These two values are the reach of the case scale:node-http on the base and on the head of CAP-76: one bit apart.
    expect(resultHash({ factor: 33.77034684862871 })).toBe(resultHash({ factor: 33.7703468486287 }));
    expect(resultHash({ factor: 33.77034684862871 })).not.toBe(resultHash({ factor: 33.7703468487 }));
    expect(resultHash({ zero: -0, small: 1e-300 })).toBe(resultHash({ zero: 0, small: 1.0000000000001e-300 }));
  });
});

describe("pairedTimes", () => {
  it("gives one record for each round, with the base as a, the head as b and the arm that started first", () => {
    const { processes } = processesOf("x", 0.5);
    const records = pairedTimes(processes);
    expect(records).toHaveLength(ROUNDS);
    expect(records[0]).toEqual({ case: "x", round: 0, first: "a", a: processes[0]?.ms, b: processes[2]?.ms });
    expect(records[1]?.first).toBe("b");
  });

  it("gives no record for a round without the head", () => {
    const { processes } = processesOf("x", 0.5);
    expect(pairedTimes(processes.filter((each) => !(each.arm === HEAD_ARM && each.round === 0)))).toHaveLength(ROUNDS - 1);
  });
});

describe("benchRead", () => {
  it("passes a head that takes half the time of the base", () => {
    const { processes, aa } = processesOf("x", 0.5);
    const read = benchRead(processes, aa, { limit: 1.1 });
    expect(read.gate.outcome).toBe("pass");
    expect(read.cases[0]?.ratio).toBeCloseTo(0.5, 2);
    expect(read.cases[0]?.headMs).toBeLessThan(read.cases[0]?.baseMs ?? 0);
  });

  it("blocks a head that takes twice the time of the base", () => {
    const { processes, aa } = processesOf("x", 2);
    expect(benchRead(processes, aa, { limit: 1.1 }).gate.outcome).toBe("block");
  });

  it("cannot pass when the A/A spread is above the noise cap", () => {
    const { processes, aa } = processesOf("x", 0.5);
    const noisy = aa.map((each, index) => ({ ...each, b: each.b * (index % 2 === 0 ? 1.5 : 0.7) }));
    expect(benchRead(processes, noisy, { limit: 1.1, noiseCap: 0.05 }).gate.outcome).toBe("no read");
  });
});

describe("benchAgainOf", () => {
  it("gives the cases that cannot decide and the cases with no record, and no case for a pass", () => {
    expect(benchAgainOf(benchGate([recordOf("x", 0.5), recordOf("y", 0.5)], ["x", "y"]))).toEqual([]);
    expect(benchAgainOf(benchGate([recordOf("x", 0.5)], ["x", "y"]))).toContain("y");
  });

  it("gives no case when a case is beyond the limit", () => {
    expect(benchAgainOf(benchGate([recordOf("x", 0.5), recordOf("y", 3)], ["x", "y", "z"]))).toEqual([]);
  });

  it("replaces the record of a case with the record of the second try", () => {
    const again = recordOf("y", 2);
    const records = benchRecordsAgain([recordOf("x", 0.5), recordOf("y", 0.5)], [again]);
    expect(records).toHaveLength(2);
    expect(records.find((each) => each.case === "y")).toBe(again);
  });
});

describe("benchGate", () => {
  it("reads the records of all the cases, and names the cases with no record and the changed cases", () => {
    const result = benchGate([recordOf("x", 0.5), recordOf("y", 0.6, false)], ["x", "y", "z"]);
    expect(result.read.cases.map((each) => each.case)).toEqual(["x", "y"]);
    expect(result.missing).toEqual(["z"]);
    expect(result.changed).toEqual(["y"]);
    expect(result.unexplained).toEqual(["y"]);
    expect(benchSummaryOf(result.read, result.commits)).toContain("| y |");
    expect(benchNotesOf(result)).toContain("The gate stops: y.");
  });

  it("does not time a case that the head changes on purpose, and names a change of value with other hashes as unused", () => {
    const change: BenchChange = { case: "y", base: "base-y", head: "head-y", reason: "The base gave no value." };
    const result = benchGate([recordOf("x", 0.5), recordOf("y", 3, false)], ["x", "y"], { changes: [change] });
    expect(result.read.cases.map((each) => each.case)).toEqual(["x"]);
    expect(result.read.gate.outcome).toBe("pass");
    expect(result.intended.map((each) => [each.case, each.reason])).toEqual([["y", "The base gave no value."]]);
    expect(result.intended[0]?.headMs).toBeGreaterThan(result.intended[0]?.baseMs ?? Infinity);
    expect(result.unexplained).toEqual([]);
    expect(result.unused).toEqual([]);
    expect(benchNotesOf(result)).toContain("| y |");
    const old = benchGate([recordOf("x", 0.5), recordOf("y", 3, false)], ["x", "y"], { changes: [{ ...change, head: "head-old" }] });
    expect(old.unexplained).toEqual(["y"]);
    expect(old.unused).toEqual(["y"]);
    expect(old.read.gate.outcome).toBe("block");
  });

  it("refuses records of two pairs of commits, and a run with no record", () => {
    expect(() => benchGate([recordOf("x", 0.5), recordOf("y", 0.5, true, { base: "c".repeat(40), head: "b".repeat(40) })], ["x", "y"])).toThrow(/two pairs/);
    expect(() => benchGate([], ["x"])).toThrow(/no bench record/);
  });
});

describe("readBenchChanges", () => {
  it("gives no change for a file that does not exist, and refuses a file of another format", () => {
    folder = mkdtempSync(join(tmpdir(), "bench-changes-"));
    const file = join(folder, "changes.json");
    expect(readBenchChanges(file)).toEqual([]);
    const changes = [{ case: "x", base: "a", head: "b", reason: "A fix." }];
    writeFileSync(file, JSON.stringify({ format: BENCH_CHANGES_FORMAT, changes }));
    expect(readBenchChanges(file)).toEqual(changes);
    writeFileSync(file, JSON.stringify({ format: "other", changes }));
    expect(() => readBenchChanges(file)).toThrow(/not a file of changes/);
  });
});

describe("readBenchRecords", () => {
  it("reads each record in the subfolders, and refuses a file of another format", () => {
    folder = mkdtempSync(join(tmpdir(), "bench-records-"));
    for (const [name, record] of [["bench-0-1", recordOf("x", 0.5)], ["bench-1-1", recordOf("y", 0.5)]] as const) {
      mkdirSync(join(folder, name));
      writeFileSync(join(folder, name, BENCH_RECORD), JSON.stringify(record));
    }
    expect(readBenchRecords(folder).map((each) => each.case)).toEqual(["x", "y"]);
    writeFileSync(join(folder, "bench-0-1", BENCH_RECORD), JSON.stringify({ format: "other" }));
    expect(() => readBenchRecords(folder)).toThrow(/not a bench record/);
  });
});
