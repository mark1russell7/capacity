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
import { START_BASE_ARM, START_PAIRED_LIMITS, startGateOf, startGateSummaryOf } from "./start-gate.ts";
import { START_LIMIT_MEASURES, startCaseOf, startLimitsOf } from "./start-limits.ts";
import type { StartRecord } from "./start-measure.ts";

// The limits come from 5 jobs of the CI runs 50 and 51 at the commit of the arm of the plan. The gate reads jobs of the CI run 60, with
// the arm main at the commit HEAD and the arm base at the commit of the plan. The jobs of the run 60 have the values of the run 50, thus
// each value holds its limit. The base has the readings of main, thus the head is equal to its base.

const HEAD = "a".repeat(40);
const ARM = CASE.arms[0]!.commit;
const LIMITS = startLimitsOf(PLAN, startLimitJobsOf());
const OTHER = "b".repeat(40);
const ARMED = startCaseOf(withArmCommit(PLAN, { arm: "main", commit: HEAD }), CASE.id);
const COMMAND = fileURLToPath(new URL("./start-gate.main.ts", import.meta.url));

/** This function gives `count` jobs of the CI run 60 at the commit HEAD. The function `change` changes the record of each job. */
const headJobsOf = (count = 5, change: (record: StartRecord, job: number) => StartRecord = (record) => record, value = ARMED) =>
  startJobsOf(count, 60, (record, job) => change({ ...record, case: value }, job));

/** This function gives the record with the reading `measure` of each child of the arms `arms` at the point `point` times `factor` of the child. */
const scaled = (record: StartRecord, arms: readonly string[], point: string | null, measure: "live" | "peak", factor: (round: number, arm: string) => number): StartRecord => ({
  ...record,
  readings: record.readings.map((each) => {
    const found = each.measures[measure];
    if (!arms.includes(each.arm) || (point !== null && each.point !== point) || found === null) return each;
    return { ...each, measures: { ...each.measures, [measure]: quantity(found.value * factor(each.round, each.arm), found.unit) } };
  }),
});

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
    expect(value.arms).toEqual([{ id: "main", commit: HEAD }, { id: START_BASE_ARM, commit: ARM }]);
    expect(value.seeder).toBe(CASE.seeder);
    expect(PLAN.cases[0]).toBe(CASE);
    expect(planMinutes(armed)).toBeGreaterThan(planMinutes(withArmCommit(PLAN, { arm: "main", commit: CASE.seeder })));
    expect(matrixOf([armed]).include.map((each) => each.minutes)).toEqual(Array.from({ length: 5 }, () => planMinutes(armed)));
    expect(withArmCommit(PLAN, { arm: "main", commit: ARM })).toEqual(PLAN);
    expect(() => withArmCommit(PLAN, { arm: "other", commit: HEAD })).toThrow('The plan "alerts-start-gate" has no start case with the arm "other".');
  });
});

describe("the start gate", () => {
  it("passes when each run holds each limit at each point and the head holds each paired claim, with the use of each limit by each arm", () => {
    const gate = startGateOf(LIMITS, PLAN, headJobsOf(), { commit: HEAD });
    expect(gate).toMatchObject({ case: CASE.id, arm: "main", commit: HEAD, base: ARM, limitsCommit: ARM, outcome: "pass", accept: false, findings: [] });
    expect(gate.runs.map((each) => each.id)).toEqual(["60/1/1", "60/2/1", "60/3/1", "60/4/1", "60/5/1"]);
    expect(gate.uses).toHaveLength(5 * CASE.points.length * 2 * START_LIMIT_MEASURES.length);
    expect(gate.uses.every((each) => each.use.holds)).toBe(true);
    const worst = gate.uses.find((each) => each.run === "60/5/1" && each.arm === "main" && each.point === "live-1844" && each.use.measure === "start.live");
    expect(worst?.use).toMatchObject({ value: quantity(104_002_500, "B"), amount: quantity(108_002_500, "B") });
    expect(START_PAIRED_LIMITS).toEqual({ "start.live": 1.02 });
    expect(gate.pairs).toHaveLength(1);
    expect(gate.pairs[0]).toMatchObject({ measure: "start.live", limit: 1.02, outcome: "within" });
    expect(gate.pairs[0]?.points.map((each) => [each.point, each.outcome])).toEqual(CASE.points.map((point) => [point.id, "within"]));
    for (const each of gate.pairs[0]?.points ?? []) expect(each.ratio).toBeCloseTo(1, 9);
    const summary = startGateSummaryOf(gate);
    expect(summary).toContain("The head aaaaaaa in the arm main and its base 4615e74, against the limits of 4615e74, in 5 runs: pass: the head holds each limit at each point, and each paired claim.");
    expect(summary).toContain(`| ${escapeMarkdown("start.live")} | ${escapeMarkdown("live-1844")} | 1.0000 | 1.0000 | 1.02 | within |`);
    expect(summary).toContain(`| ${escapeMarkdown("60/5/1")} | main | ${escapeMarkdown("live-1844")} | ${escapeMarkdown("start.live")} | 104002500 B | 108002500 B | 0.963 |`);
    expect(summary).toContain(`| ${escapeMarkdown("60/5/1")} | base | ${escapeMarkdown("live-1844")} | ${escapeMarkdown("start.live")} | 104002000 B | 108002500 B | 0.963 |`);
  });

  it("gives a drift and no block for a ceiling that the base passes too, and blocks when the base holds it", () => {
    const drift = startGateOf(LIMITS, PLAN, headJobsOf(5, (record) => scaled(record, ["main", "main~aa", START_BASE_ARM], "knee-192", "peak", () => 1.05)), { commit: HEAD });
    expect(drift.outcome).toBe("pass");
    expect(drift.findings).toEqual([
      {
        kind: "drift",
        run: "60/5/1",
        point: "knee-192",
        message: "The base passes the ceiling of start.peak too: 323400002.1 B (use 1.023). Thus the head does not block on it. Derive the limits again at the new main.",
      },
    ]);
    expect(startGateSummaryOf(drift)).toContain(`- Drift (${escapeMarkdown("60/5/1 at knee-192")}): `);
    const block = startGateOf(LIMITS, PLAN, headJobsOf(5, (record) => scaled(record, ["main", "main~aa"], "knee-192", "peak", () => 1.05)), { commit: HEAD });
    expect(block.outcome).toBe("block");
    expect(block.findings.map((each) => `${each.kind} ${each.run}`)).toEqual(["block 60/2/1", "block 60/3/1", "block 60/4/1", "block 60/5/1"]);
    expect(block.findings[3]?.message).toBe("start.peak is 323400002.1 B, above its ceiling 316000002 B (use 1.023), and the base holds it.");
  });

  it("blocks on a head beyond the paired limit against its base, and gives no read for a paired claim that cannot decide", () => {
    // The head is 3 % above its base at routes-40000, and it still holds the ceiling there: only the paired claim sees the change.
    const beyond = startGateOf(LIMITS, PLAN, headJobsOf(5, (record) => scaled(record, ["main", "main~aa"], "routes-40000", "live", () => 1.03)), { commit: HEAD });
    expect(beyond.outcome).toBe("block");
    expect(beyond.uses.every((each) => each.use.holds)).toBe(true);
    expect(beyond.pairs[0]?.outcome).toBe("beyond");
    expect(beyond.pairs[0]?.points.map((each) => each.outcome)).toEqual(["within", "within", "beyond"]);
    expect(beyond.findings).toEqual([
      { kind: "block", run: null, point: null, message: 'The head passes the paired limit 1.02 of start.live against its base. 1 of 3 cases are above the limit 1.02. The first is "routes-40000".' },
    ]);
    // The A/A copy is 3 % above or below the head in turn. Thus the noise band is too wide to decide a ratio of 1.02.
    const noisy = startGateOf(LIMITS, PLAN, headJobsOf(5, (record) => scaled(record, ["main~aa"], null, "live", (round) => (round % 2 === 0 ? 1.03 : 0.97))), { commit: HEAD });
    expect(noisy.outcome).toBe("no-read");
    expect(noisy.pairs[0]?.outcome).toBe("cannot decide");
    expect(noisy.findings.map((each) => each.message)).toEqual([`The paired claim of start.live cannot decide. ${noisy.pairs[0]?.reason}`]);
    expect(startGateOf(LIMITS, PLAN, headJobsOf(3), { commit: HEAD }).pairs).toEqual([]);
  });

  it("accepts a change of the start with the option accept, and keeps each other finding", () => {
    const peak = startGateOf(LIMITS, PLAN, headJobsOf(5, (record) => scaled(record, ["main", "main~aa"], "knee-192", "peak", () => 1.05)), { commit: HEAD, accept: true });
    expect(peak).toMatchObject({ outcome: "pass", accept: true });
    expect(peak.findings.map((each) => each.kind)).toEqual(["accepted", "accepted", "accepted", "accepted"]);
    const summary = startGateSummaryOf(peak);
    expect(summary).toContain("The app accepts a change of its start in this head. Thus a limit that the head passes does not block.");
    expect(summary).toContain(`- Accepted (${escapeMarkdown("60/5/1 at knee-192")}): `);
    const live = startGateOf(LIMITS, PLAN, headJobsOf(5, (record) => scaled(record, ["main", "main~aa"], "routes-40000", "live", () => 1.03)), { commit: HEAD, accept: true });
    expect(live.outcome).toBe("pass");
    expect(live.findings.map((each) => each.kind)).toEqual(["accepted"]);
    const failed = startGateOf(
      LIMITS,
      PLAN,
      headJobsOf(5, (record, job) => (job === 0 ? { ...record, failures: [{ arm: "base", case: "knee-192", round: 1, reason: "passed the memory limit of its container", kind: "memory" }] } : record)),
      { commit: HEAD, accept: true },
    );
    expect(failed.outcome).toBe("block");
  });

  it("reads the base at the commit of the option base, and gives no read for a base at another commit", () => {
    const both = startCaseOf(withArmCommit(withArmCommit(PLAN, { arm: "main", commit: HEAD }), { arm: START_BASE_ARM, commit: OTHER }), CASE.id);
    const gate = startGateOf(LIMITS, PLAN, headJobsOf(5, (record) => record, both), { commit: HEAD, base: OTHER });
    expect(gate).toMatchObject({ base: OTHER, outcome: "pass" });
    expect(startGateSummaryOf(gate)).toContain("The head aaaaaaa in the arm main and its base bbbbbbb,");
    const wrong = startGateOf(LIMITS, PLAN, headJobsOf(), { commit: HEAD, base: OTHER });
    expect(wrong.outcome).toBe("no-read");
    expect(wrong.findings[0]?.message).toBe(`The record measures another version of the case, the arm "main" at another commit than ${HEAD}, or the arm "base" at another commit than ${OTHER}.`);
  });

  it("blocks on a value above its ceiling, and on a child that did not fit the target", () => {
    const high = startGateOf(LIMITS, PLAN, headJobsOf(5, (record, job) => (job === 2 ? withReading(record, "live-1844", "live", quantity(200_000_000, "B")) : record)), { commit: HEAD });
    expect(high.outcome).toBe("block");
    expect(high.findings).toEqual([{ kind: "block", run: "60/3/1", point: "live-1844", message: "start.live is 200000000 B, above its ceiling 108002500 B (use 1.852), and the base holds it." }]);
    expect(startGateSummaryOf(high)).toContain(`- Block (${escapeMarkdown("60/3/1 at live-1844")}): ${escapeMarkdown("start.live is 200000000 B, above its ceiling 108002500 B (use 1.852), and the base holds it.")}`);
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
      { kind: "no-read", run: "61/1/1", point: null, message: `The record measures another version of the case, the arm "main" at another commit than ${HEAD}, or the arm "base" at another commit than ${ARM}.` },
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
    expect(lost.findings.filter((each) => each.run === "60/2/1")).toEqual([{ kind: "no-read", run: "60/2/1", point: null, message: "The record has problems: alerts-start-gate/main: main on knee-192: The reading has no readiness." }]);
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
    const alone = { ...PLAN, cases: [{ ...CASE, arms: CASE.arms.slice(0, 1) }] };
    expect(() => startGateOf(LIMITS, alone, [], { commit: HEAD })).toThrow('The case "alerts-start-gate/main" has no arm "base". A start gate compares the head with its base in the same job.');
  });
});

describe("the command of the start gate", () => {
  it("passes on the runs of a folder that hold the limits, and fails on a block and on a missing argument", () => {
    const folder = mkdtempSync(join(tmpdir(), "capacity-start-gate-"));
    try {
      const limits = join(folder, "limits.json");
      writeFileSync(limits, JSON.stringify(LIMITS));
      writeStartJobs(join(folder, "pass"), headJobsOf());
      const run = (runs: string, ...more: string[]) =>
        spawnSync(process.execPath, [COMMAND, "gate", "--limits", limits, "--runs", join(folder, runs), "--commit", HEAD, ...more], { encoding: "utf8", env: { ...process.env, GITHUB_STEP_SUMMARY: "" } });
      const pass = run("pass");
      expect(pass.stderr).toBe("");
      expect(pass.status).toBe(0);
      expect(pass.stdout).toContain("in 5 runs: pass");
      writeStartJobs(join(folder, "block"), headJobsOf(5, (record, job) => (job === 4 ? withReading(record, "live-1844", "live", quantity(200_000_000, "B")) : record)));
      const block = run("block");
      expect(block.status).toBe(1);
      expect(block.stdout).toContain("in 5 runs: block");
      const accepted = run("block", "--accept", "true");
      expect(accepted.status).toBe(0);
      expect(accepted.stdout).toContain("The app accepts a change of its start in this head.");
      expect(run("pass", "--base", OTHER).status).toBe(1);
      expect(run("pass", "--base", "", "--accept", "false").status).toBe(0);
      const bad = run("pass", "--accept", "yes");
      expect(bad.status).toBe(1);
      expect(bad.stderr).toContain("--accept is not true or false: yes");
      const usage = spawnSync(process.execPath, [COMMAND, "gate", "--limits", limits], { encoding: "utf8" });
      expect(usage.status).toBe(1);
      expect(usage.stderr).toContain("The command needs --limits, --runs and --commit.");
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
