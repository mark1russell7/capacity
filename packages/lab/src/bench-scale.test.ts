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
  BENCH_LIMITS_FORMAT,
  BENCH_LIMIT_RUNS,
  BENCH_RECORD,
  BENCH_ROUNDS,
  BENCH_SLOTS,
  HEAD_ARM,
  benchCases, kneeLaws,
  benchAgainOf,
  benchGate,
  benchLimitsOf,
  benchNotesOf,
  benchRead,
  benchSummaryOf,
  pairedTimes,
  readBenchChanges,
  readBenchLimits,
  readBenchRecords,
  readsRate,
  resultHash,
  slotJobs,
  type BenchJob,
  type BenchChange,
  type BenchRecord,
} from "./bench-scale.ts";
import { latestAttempts, readCompositions, readLaws } from "./jobs.ts";

/** This folder holds the files of the package capacity. */
const CAPACITY = fileURLToPath(new URL("../../capacity/", import.meta.url));

const ROUNDS = BENCH_ROUNDS;

/**
 * This function gives the children of a run of 3 arms on one case: the base, the A/A base and the head. The head takes
 * `factor` times the time of the base. The order of the arms turns each round, and the times have a small seeded spread.
 */
const processesOf = (id: string, factor: number, rounds: number = ROUNDS): { processes: ArmProcess[]; aa: PairedTime[] } => {
  const processes: ArmProcess[] = [];
  const aa: PairedTime[] = [];
  for (let round = 0; round < rounds; round += 1) {
    const wobble = 1 + 0.002 * ((round % 3) - 1);
    const order = round % 2 === 0 ? [BASE_ARM, AA_ARM, HEAD_ARM] : [HEAD_ARM, AA_ARM, BASE_ARM];
    const ms: Record<string, number> = { [BASE_ARM]: 100 * wobble, [AA_ARM]: 100 / wobble, [HEAD_ARM]: 100 * factor * wobble };
    for (const [position, arm] of order.entries()) processes.push({ arm, case: id, round, position, ms: ms[arm] as number });
    aa.push({ case: id, round, first: order.indexOf(BASE_ARM) < order.indexOf(AA_ARM) ? "a" : "b", a: ms[BASE_ARM] as number, b: ms[AA_ARM] as number });
  }
  return { processes, aa };
};

const ENV = { cpu: "Test CPU", cores: 4, os: "linux", arch: "x64", node: "v26.0.0" };

/** This function gives one bench job of a case in a slot: the children of `processesOf` with the slot and the try. */
const jobOf = (id: string, factor: number, slot: number, tried = 1): BenchJob => ({ slot, try: tried, ...processesOf(id, factor) });

const recordOf = (id: string, factor: number, same = true, commits = { base: "a".repeat(40), head: "b".repeat(40) }, slot = 1, tried = 1): BenchRecord => ({
  format: BENCH_FORMAT,
  case: id,
  commits,
  env: ENV,
  rounds: ROUNDS,
  ...processesOf(id, factor),
  same,
  // A changed case has a different hash on the head.
  hashes: { base: `base-${id}`, head: same ? `base-${id}` : `head-${id}` },
  slot,
  try: tried,
});

/** This function gives the records of the first try of a case: one record for each slot. */
const pairOf = (id: string, factor: number, same = true): BenchRecord[] => Array.from({ length: BENCH_SLOTS }, (_, index) => recordOf(id, factor, same, undefined, index + 1));

let folder = "";
afterEach(() => {
  if (folder !== "") rmSync(folder, { recursive: true, force: true });
  folder = "";
});

describe("benchCases", () => {
  const catalog = { laws: readLaws(join(CAPACITY, "laws")), compositions: readCompositions(join(CAPACITY, "compositions")) };
  const cases = benchCases(catalog);

  it("gives a scale case, a reach case and a slider case for each composition of the processor time over the rate, and the case knee", () => {
    const cpus = catalog.compositions.filter((each) => each.measure.id === "cpu" && readsRate(each, catalog)).map((each) => each.id);
    expect(cpus.length).toBeGreaterThan(0);
    // The compositions of alerts read a level of events, not the rate of a class. The bench has no case for them.
    expect(catalog.compositions.filter((each) => each.measure.id === "cpu" && !readsRate(each, catalog)).map((each) => each.id)).toEqual(["alerts-runtime/xeon-6975p-c/cpu"]);
    expect(cases.map((each) => each.id)).toEqual([...cpus.flatMap((id) => [`scale:${id}`, `reach:${id}`, `slider:${id}`]), "knee"]);
  });

  it("gives the case knee the first law of each form, and the same laws for a larger catalog", () => {
    const laws = kneeLaws(catalog.laws);
    const forms = new Set(catalog.laws.map((each) => each.form.id));
    expect(laws.map((each) => each.form.id).sort()).toEqual([...forms].sort());
    for (const law of laws) expect(catalog.laws.filter((each) => each.form.id === law.form.id && each.id < law.id)).toEqual([]);
    // A copy of each law with an id after each id of the catalog adds no form, thus the case keeps its laws.
    const larger = [...catalog.laws, ...catalog.laws.map((each) => ({ ...each, id: `zz/${each.id}` }))];
    expect(kneeLaws(larger).map((each) => each.id)).toEqual(laws.map((each) => each.id));
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
  const COMMITS = { base: "a".repeat(40), head: "b".repeat(40) };

  it("passes a head that takes half the time of the base when each of the two jobs reads it at the first look", () => {
    const read = benchRead([jobOf("x", 0.5, 1), jobOf("x", 0.5, 2)], { limit: 1.1 });
    expect(read.gate.outcome).toBe("pass");
    expect(read.margin).toBeCloseTo(Math.log(1.1), 12);
    expect(read.more).toEqual([]);
    const [x] = read.cases;
    expect(x?.ratio).toBeCloseTo(0.5, 2);
    expect([x?.outcome, x?.look, x?.slots]).toEqual(["within", BENCH_ROUNDS, [BENCH_ROUNDS, BENCH_ROUNDS]]);
    expect(x?.jobs.map((each) => [each.below, each.rounds])).toEqual([
      [BENCH_ROUNDS, BENCH_ROUNDS],
      [BENCH_ROUNDS, BENCH_ROUNDS],
    ]);
    const summary = benchSummaryOf(read, COMMITS);
    expect(summary).toContain("| Pairs below the margin, each job | Look |");
    expect(summary).toContain(`| ${BENCH_ROUNDS} of ${BENCH_ROUNDS}, ${BENCH_ROUNDS} of ${BENCH_ROUNDS} | ${BENCH_ROUNDS} |`);
  });

  it("blocks a head that takes twice the time of the base", () => {
    const read = benchRead([jobOf("x", 2, 1), jobOf("x", 2, 2)], { limit: 1.1 });
    expect(read.gate.outcome).toBe("block");
    expect(read.cases[0]?.outcome).toBe("beyond");
  });

  it("asks for the next look of a case with a read in one job only, and gives the rounds of each slot", () => {
    const read = benchRead([jobOf("x", 0.5, 1), jobOf("y", 0.5, 1), jobOf("y", 0.5, 2)], { limit: 1.1 });
    expect(read.gate.outcome).toBe("no read");
    expect(read.more).toEqual([{ case: "x", rounds: BENCH_ROUNDS }]);
    expect(read.cases.map((each) => [each.case, each.outcome, each.slots])).toEqual([
      ["x", "cannot decide", [BENCH_ROUNDS, 0]],
      ["y", "within", [BENCH_ROUNDS, BENCH_ROUNDS]],
    ]);
    expect(benchSummaryOf(read, COMMITS)).toContain("| none |");
  });

  it("cannot decide a case when the A/A noise of a job is above the noise cap, and more rounds do not change it", () => {
    const job = jobOf("x", 0.5, 1);
    const noisy = job.aa.map((each, index) => ({ ...each, b: each.b * (index % 2 === 0 ? 1.5 : 0.7) }));
    const read = benchRead([{ ...job, aa: noisy }, jobOf("x", 0.5, 2)], { limit: 1.1, noiseCap: 0.05 });
    expect(read.gate.outcome).toBe("no read");
    expect([read.cases[0]?.outcome, read.cases[0]?.capped]).toEqual(["cannot decide", true]);
    expect(read.cases[0]?.reason).toContain("noise cap 0.05");
    expect(read.more).toEqual([]);
  });
});

describe("slotJobs", () => {
  it("gives one job for each slot, and the rounds of a later try of a slot continue after the rounds of the earlier try", () => {
    const pool = slotJobs([jobOf("x", 0.5, 2, 2), jobOf("x", 0.5, 1), jobOf("y", 0.5, 1), jobOf("x", 0.5, 1, 2)]);
    expect(pool.map((each) => each.job)).toEqual(["slot 1", "slot 2"]);
    const [one, two] = pool;
    const roundsOf = (records: readonly PairedTime[] | undefined, id: string): number[] => (records ?? []).filter((each) => each.case === id).map((each) => each.round);
    expect(roundsOf(one?.candidate, "x")).toEqual(Array.from({ length: 2 * BENCH_ROUNDS }, (_, round) => round));
    expect(roundsOf(one?.aa, "x")).toEqual(Array.from({ length: 2 * BENCH_ROUNDS }, (_, round) => round));
    expect(roundsOf(one?.candidate, "y")).toEqual(Array.from({ length: BENCH_ROUNDS }, (_, round) => round));
    expect(roundsOf(two?.candidate, "x")).toEqual(Array.from({ length: BENCH_ROUNDS }, (_, round) => round));
    expect([...(one?.candidate ?? []), ...(one?.aa ?? [])].every((each) => (each as { job?: string }).job === "slot 1")).toBe(true);
  });
});

describe("benchAgainOf", () => {
  const IDS = ["x", "y", "z"];

  it("gives no job for a pass, and two jobs of the first look for a case with no record", () => {
    expect(benchAgainOf(benchGate(pairOf("x", 0.5), ["x"]), ["x"])).toEqual([]);
    expect(benchAgainOf(benchGate([...pairOf("x", 0.5), ...pairOf("y", 0.5)], IDS), IDS)).toEqual(
      Array.from({ length: BENCH_SLOTS }, (_, index) => ({ case: "z", index, slot: index + 1, try: 2, rounds: BENCH_ROUNDS })),
    );
  });

  it("gives a job only for each slot with fewer rounds than the next look, in the order of the cases", () => {
    const gate = benchGate([recordOf("z", 0.5), ...pairOf("y", 0.5), recordOf("x", 0.5, true, undefined, 2)], IDS);
    expect(benchAgainOf(gate, IDS)).toEqual([
      { case: "x", index: 0, slot: 1, try: 2, rounds: BENCH_ROUNDS },
      { case: "z", index: 1, slot: 2, try: 2, rounds: BENCH_ROUNDS },
    ]);
  });

  it("gives no job when a change of value has no reason", () => {
    const changed = benchGate([...pairOf("x", 0.5, false), ...pairOf("y", 0.5)], IDS);
    expect(changed.unexplained).toEqual(["x"]);
    expect(benchAgainOf(changed, IDS)).toEqual([]);
  });

  it("gives no job when a case is beyond the limit or above the noise cap", () => {
    expect(benchAgainOf(benchGate([...pairOf("x", 0.5), ...pairOf("y", 3)], IDS), IDS)).toEqual([]);
    const [first, second] = pairOf("x", 0.5);
    const noisy = { ...(first as BenchRecord), aa: (first as BenchRecord).aa.map((each, index) => ({ ...each, b: each.b * (index % 2 === 0 ? 1.5 : 0.7) })) };
    expect(benchAgainOf(benchGate([noisy, second as BenchRecord], IDS, { noiseCap: 0.05 }), IDS)).toEqual([]);
  });
});

describe("benchGate", () => {
  it("joins the records of the slots and the tries of a case, and a case is the same only when each job gives the same value", () => {
    const tries = [...pairOf("x", 0.5), recordOf("x", 0.5, true, undefined, 1, 2), recordOf("x", 0.5, true, undefined, 2, 2)];
    const result = benchGate([...tries, ...pairOf("y", 0.5)], ["x", "y"]);
    expect(result.read.cases.map((each) => [each.case, each.slots])).toEqual([
      ["x", [2 * BENCH_ROUNDS, 2 * BENCH_ROUNDS]],
      ["y", [BENCH_ROUNDS, BENCH_ROUNDS]],
    ]);
    expect(result.read.gate.outcome).toBe("pass");
    const changed = benchGate([recordOf("x", 0.5), recordOf("x", 0.5, false, undefined, 2)], ["x"]);
    expect(changed.changed).toEqual(["x"]);
    expect(changed.read.cases[0]?.same).toBe(false);
  });

  it("reads a record with no slot and no try as a job of slot 1 of the first try", () => {
    const { slot: _slot, try: _try, ...old } = recordOf("x", 0.5);
    const result = benchGate([old, recordOf("x", 0.5, true, undefined, 2)], ["x"]);
    expect(result.read.cases[0]?.slots).toEqual([BENCH_ROUNDS, BENCH_ROUNDS]);
    expect(result.read.gate.outcome).toBe("pass");
  });

  it("reads the records of all the cases, and names the cases with no record and the changed cases", () => {
    const result = benchGate([...pairOf("x", 0.5), ...pairOf("y", 0.6, false)], ["x", "y", "z"]);
    expect(result.read.cases.map((each) => each.case)).toEqual(["x", "y"]);
    expect(result.missing).toEqual(["z"]);
    expect(result.changed).toEqual(["y"]);
    expect(result.unexplained).toEqual(["y"]);
    expect(benchSummaryOf(result.read, result.commits)).toContain("| y |");
    expect(benchNotesOf(result)).toContain("The gate stops: y.");
  });

  it("does not time a case that the head changes on purpose, and names a change of value with other hashes as unused", () => {
    const change: BenchChange = { case: "y", base: "base-y", head: "head-y", reason: "The base gave no value." };
    const result = benchGate([...pairOf("x", 0.5), ...pairOf("y", 3, false)], ["x", "y"], { changes: [change] });
    expect(result.read.cases.map((each) => each.case)).toEqual(["x"]);
    expect(result.read.gate.outcome).toBe("pass");
    expect(result.intended.map((each) => [each.case, each.reason])).toEqual([["y", "The base gave no value."]]);
    expect(result.intended[0]?.headMs).toBeGreaterThan(result.intended[0]?.baseMs ?? Infinity);
    expect(result.unexplained).toEqual([]);
    expect(result.unused).toEqual([]);
    expect(benchNotesOf(result)).toContain("| y |");
    const old = benchGate([...pairOf("x", 0.5), ...pairOf("y", 3, false)], ["x", "y"], { changes: [{ ...change, head: "head-old" }] });
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

describe("benchLimitsOf", () => {
  it("gives the noise cap of the A/A pairs of 5 runs or more, and refuses fewer runs", () => {
    const runs = new Map(Array.from({ length: BENCH_LIMIT_RUNS }, (_, run) => [`run-${run}`, [recordOf("x", 1), recordOf("y", 1)]] as const));
    const limits = benchLimitsOf(runs);
    expect(limits.format).toBe(BENCH_LIMITS_FORMAT);
    expect(limits.runs).toHaveLength(BENCH_LIMIT_RUNS);
    expect(limits.jobs).toBe(2 * BENCH_LIMIT_RUNS);
    expect(limits.noiseCap.limit).toBeGreaterThanOrEqual(limits.noiseCap.worst);
    runs.delete("run-0");
    expect(() => benchLimitsOf(runs)).toThrow(/5 or more CI runs/);
  });

  it("reads the limits of a file, gives undefined for no file, and refuses a file of another format", () => {
    folder = mkdtempSync(join(tmpdir(), "bench-limits-"));
    const file = join(folder, "limits.json");
    expect(readBenchLimits(file)).toBeUndefined();
    const limits = benchLimitsOf(new Map(Array.from({ length: BENCH_LIMIT_RUNS }, (_, run) => [`run-${run}`, [recordOf("x", 1)]] as const)));
    writeFileSync(file, JSON.stringify(limits));
    expect(readBenchLimits(file)?.noiseCap.limit).toBe(limits.noiseCap.limit);
    writeFileSync(file, JSON.stringify({ format: "other" }));
    expect(() => readBenchLimits(file)).toThrow(/not a file of limits/);
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

  it("reads the records of the first attempt after a rerun of only the last job, with the option latest", () => {
    folder = mkdtempSync(join(tmpdir(), "bench-records-"));
    for (const [name, record] of [["bench-0-1", recordOf("x", 0.5)], ["bench-1-1", recordOf("y", 0.5)], ["bench-1-2", recordOf("z", 0.5)]] as const) {
      mkdirSync(join(folder, name));
      writeFileSync(join(folder, name, BENCH_RECORD), JSON.stringify(record));
    }
    expect(readBenchRecords(folder, { latest: true }).map((each) => each.case)).toEqual(["x", "z"]);
  });
});

describe("latestAttempts", () => {
  it("keeps the highest attempt of each artifact stem, on each separator, and each path with no artifact folder", () => {
    const paths = ["bench-0-1/bench.json", "bench-1-1\\bench.json", "bench-1-3\\bench.json", "bench-1-2/bench.json", "bench-again-1-2/bench.json", "top.json", "plain/bench.json"];
    expect(latestAttempts(paths)).toEqual(["bench-0-1/bench.json", "bench-1-3\\bench.json", "bench-again-1-2/bench.json", "top.json", "plain/bench.json"]);
    // a stem with ten attempts compares them as numbers
    expect(latestAttempts(["lab-gate-1-9/t.json", "lab-gate-1-10/t.json"])).toEqual(["lab-gate-1-10/t.json"]);
  });
});
