import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { quantity } from "@mark1russell7/quantity";
import { escapeMarkdown } from "@mark1russell7/text";
import { describe, expect, it } from "vitest";
import { armCommitOf, matrixOf, planMinutes, withArmCommit } from "./plan.ts";
import { START_GATE_CASE as CASE, START_GATE_PLAN as PLAN, startJobsOf, startLimitJobsOf, writeStartJobs } from "./start-fixtures.ts";
import { startGateOf, startGateSummaryOf } from "./start-gate.ts";
import { START_LIMIT_MEASURES, startCaseOf, startLimitsOf } from "./start-limits.ts";
import type { StartRecord } from "./start-measure.ts";

// The limits come from 5 jobs of the CI runs 50 and 51 at the commit of the arm of the plan. The gate reads jobs of the CI run 60, with
// the arm main at the commit HEAD. The jobs of the run 60 have the values of the run 50, thus each value holds its limit.

const HEAD = "a".repeat(40);
const ARM = CASE.arms[0]!.commit;
const LIMITS = startLimitsOf(PLAN, startLimitJobsOf());
const ARMED = startCaseOf(withArmCommit(PLAN, { arm: "main", commit: HEAD }), CASE.id);
const COMMAND = fileURLToPath(new URL("./start-gate.main.ts", import.meta.url));

/** This function gives `count` jobs of the CI run 60 at the commit HEAD. The function `change` changes the record of each job. */
const headJobsOf = (count = 5, change: (record: StartRecord, job: number) => StartRecord = (record) => record) =>
  startJobsOf(count, 60, (record, job) => change({ ...record, case: ARMED }, job));

/** This function gives the record with the reading `measure` of the arm main at the point `point` in round 0 at `value`. */
const withReading = (record: StartRecord, point: string, measure: "live" | "readiness", value: ReturnType<typeof quantity> | null): StartRecord => ({
  ...record,
  readings: record.readings.map((each) => (each.point === point && each.arm === "main" && each.round === 0 ? { ...each, measures: { ...each.measures, [measure]: value } } : each)),
});

describe("the arm commit of a plan", () => {
  it("reads <arm>=<commit>, and refuses another shape", () => {
    expect(armCommitOf(`main=${HEAD}`)).toEqual({ arm: "main", commit: HEAD });
    for (const bad of ["main", `=${HEAD}`, "main=abc", `main=${"A".repeat(40)}`]) expect(() => armCommitOf(bad)).toThrow(RangeError);
  });

  it("gives the arm a new commit, keeps the seeder, and adds the tree of the commit to the time of a job", () => {
    const armed = withArmCommit(PLAN, { arm: "main", commit: HEAD });
    const value = startCaseOf(armed, CASE.id);
    expect(value.arms).toEqual([{ id: "main", commit: HEAD }]);
    expect(value.seeder).toBe(CASE.seeder);
    expect(PLAN.cases[0]).toBe(CASE);
    expect(planMinutes(armed)).toBeGreaterThan(planMinutes(withArmCommit(PLAN, { arm: "main", commit: CASE.seeder })));
    expect(matrixOf([armed]).include.map((each) => each.minutes)).toEqual(Array.from({ length: 5 }, () => planMinutes(armed)));
    expect(withArmCommit(PLAN, { arm: "main", commit: ARM })).toEqual(PLAN);
    expect(() => withArmCommit(PLAN, { arm: "other", commit: HEAD })).toThrow('The plan "alerts-start-gate" has no start case with the arm "other".');
  });
});

describe("the start gate", () => {
  it("passes when each run holds each limit at each point, with the use of each limit", () => {
    const gate = startGateOf(LIMITS, PLAN, headJobsOf(), { commit: HEAD });
    expect(gate).toMatchObject({ case: CASE.id, arm: "main", commit: HEAD, limitsCommit: ARM, outcome: "pass", findings: [] });
    expect(gate.runs.map((each) => each.id)).toEqual(["60/1/1", "60/2/1", "60/3/1", "60/4/1", "60/5/1"]);
    expect(gate.uses).toHaveLength(5 * CASE.points.length * START_LIMIT_MEASURES.length);
    expect(gate.uses.every((each) => each.use.holds)).toBe(true);
    const worst = gate.uses.find((each) => each.run === "60/5/1" && each.point === "live-1844" && each.use.measure === "start.live");
    expect(worst?.use).toMatchObject({ value: quantity(104_002_500, "B"), amount: quantity(108_002_500, "B") });
    const summary = startGateSummaryOf(gate);
    expect(summary).toContain("The arm main at aaaaaaa, against the limits of bfb3dae, in 5 runs: pass: each run holds each limit at each point.");
    expect(summary).toContain(`| ${escapeMarkdown("60/5/1")} | ${escapeMarkdown("live-1844")} | ${escapeMarkdown("start.live")} | 104002500 B | 108002500 B | 0.963 |`);
  });

  it("blocks on a value above its ceiling, and on a child that did not fit the target", () => {
    const high = startGateOf(LIMITS, PLAN, headJobsOf(5, (record, job) => (job === 2 ? withReading(record, "live-1844", "live", quantity(200_000_000, "B")) : record)), { commit: HEAD });
    expect(high.outcome).toBe("block");
    expect(high.findings).toEqual([{ kind: "block", run: "60/3/1", point: "live-1844", message: "start.live is 200000000 B, above its ceiling 108002500 B (use 1.852)." }]);
    expect(startGateSummaryOf(high)).toContain(`- Block (${escapeMarkdown("60/3/1 at live-1844")}): ${escapeMarkdown("start.live is 200000000 B, above its ceiling 108002500 B (use 1.852).")}`);
    const failed = startGateOf(
      LIMITS,
      PLAN,
      headJobsOf(5, (record, job) => (job === 0 ? { ...record, failures: [{ arm: "main~aa", case: "knee-192", round: 1, reason: "passed the memory limit of its container", kind: "memory" }] } : record)),
      { commit: HEAD },
    );
    expect(failed.outcome).toBe("block");
    expect(failed.findings.map((each) => each.message)).toContain("The child of main~aa on knee-192, round 1, did not fit the target: memory.");
  });

  it("gives no read for a run of another commit, for a run two times, and for fewer runs than the count", () => {
    const other = startGateOf(LIMITS, PLAN, [...headJobsOf(4), ...startJobsOf(1, 61)], { commit: HEAD });
    expect(other.outcome).toBe("no-read");
    expect(other.findings).toEqual([
      { kind: "no-read", run: "61/1/1", point: null, message: `The record measures another version of the case, or the arm "main" at another commit than ${HEAD}.` },
      { kind: "no-read", run: null, point: null, message: "The gate needs the records of 5 or more runs, and 4 runs have a record that it reads." },
    ]);
    const twice = startGateOf(LIMITS, PLAN, [...headJobsOf(), ...headJobsOf(1)], { commit: HEAD });
    expect(twice.findings).toEqual([{ kind: "no-read", run: "60/1/1", point: null, message: "The run 60/1/1 is in the records two times." }]);
    expect(startGateOf(LIMITS, PLAN, headJobsOf(3), { commit: HEAD, runs: 3 }).outcome).toBe("pass");
    expect(startGateOf(LIMITS, PLAN, [], { commit: HEAD }).outcome).toBe("no-read");
    expect(() => startGateOf(LIMITS, PLAN, [], { commit: HEAD, runs: 0 })).toThrow(RangeError);
  });

  it("gives no read for a point with no value, and a block wins over a no read", () => {
    const lost = startGateOf(LIMITS, PLAN, headJobsOf(5, (record, job) => (job === 1 ? withReading(record, "knee-192", "readiness", null) : record)), { commit: HEAD });
    expect(lost.outcome).toBe("no-read");
    expect(lost.findings.filter((each) => each.run === "60/2/1").length).toBe(1);
    const both = startGateOf(
      LIMITS,
      PLAN,
      headJobsOf(5, (record, job) => (job === 1 ? withReading(record, "knee-192", "readiness", null) : job === 3 ? withReading(record, "knee-192", "readiness", quantity(60_000, "ms")) : record)),
      { commit: HEAD },
    );
    expect(both.outcome).toBe("block");
  });

  it("refuses limits of another plan or of another version of the case", () => {
    expect(() => startGateOf({ ...LIMITS, plan: "other" }, PLAN, [], { commit: HEAD })).toThrow('The limits are the limits of the plan "other", not of the plan "alerts-start-gate".');
    expect(() => startGateOf({ ...LIMITS, seeder: HEAD }, PLAN, [], { commit: HEAD })).toThrow('The case "alerts-start-gate/main" of the plan is not the case of the limits.');
    expect(() => startGateOf({ ...LIMITS, points: LIMITS.points.slice(1) }, PLAN, [], { commit: HEAD })).toThrow("Derive the limits again with start-limits.main.ts.");
  });
});

describe("the command of the start gate", () => {
  it("passes on the runs of a folder that hold the limits, and fails on a block and on a missing argument", () => {
    const folder = mkdtempSync(join(tmpdir(), "capacity-start-gate-"));
    try {
      const limits = join(folder, "limits.json");
      writeFileSync(limits, JSON.stringify(LIMITS));
      writeStartJobs(join(folder, "pass"), headJobsOf());
      const run = (runs: string) =>
        spawnSync(process.execPath, [COMMAND, "gate", "--limits", limits, "--runs", join(folder, runs), "--commit", HEAD], { encoding: "utf8", env: { ...process.env, GITHUB_STEP_SUMMARY: "" } });
      const pass = run("pass");
      expect(pass.stderr).toBe("");
      expect(pass.status).toBe(0);
      expect(pass.stdout).toContain("in 5 runs: pass");
      writeStartJobs(join(folder, "block"), headJobsOf(5, (record, job) => (job === 4 ? withReading(record, "live-1844", "live", quantity(200_000_000, "B")) : record)));
      const block = run("block");
      expect(block.status).toBe(1);
      expect(block.stdout).toContain("in 5 runs: block");
      const usage = spawnSync(process.execPath, [COMMAND, "gate", "--limits", limits], { encoding: "utf8" });
      expect(usage.status).toBe(1);
      expect(usage.stderr).toContain("The command needs --limits, --runs and --commit.");
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
