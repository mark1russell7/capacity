import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CellResult } from "@mark1russell7/harness";
import { escapeMarkdown } from "@mark1russell7/text";
import { afterEach, describe, expect, it } from "vitest";
import type { Case } from "./case.ts";
import type { Measurement } from "./measure.ts";
import { readPlans, type Plan } from "./plan.ts";
import type { CaseRecord } from "./record.ts";
import type { StartCase } from "./start.ts";
import { START_RECORD_FORMAT, type StartMeasurement, type StartRecord } from "./start-measure.ts";
import { MANIFEST, TIMED_FORMAT, filesOf, runOf, summaryOf, timePlan, utcOf, type Timed } from "./timed.ts";

/** The two records of the Lab run 44453927945 on main, on an Intel Xeon 6975P-C. */
const fixture = (name: string): CaseRecord => JSON.parse(readFileSync(new URL(`../test/fixtures/${name}.record.json`, import.meta.url), "utf8")) as CaseRecord;
const RECORDS: Readonly<Record<string, CaseRecord>> = { "control/base": fixture("control-base"), "control/more": fixture("control-more") };

const CONTROL: Plan = readPlans(fileURLToPath(new URL("../plans/", import.meta.url))).plans.find((each) => each.id === "control")!;

const ENV = {
  GITHUB_SERVER_URL: "https://github.com",
  GITHUB_REPOSITORY: "mark1russell7/capacity",
  GITHUB_RUN_ID: "44453927945",
  GITHUB_RUN_ATTEMPT: "2",
  GITHUB_SHA: "e7897a9e7897a9e7897a9e7897a9e7897a9e789",
};

/** A clock that gives 14:00:00.250 UTC, then one minute later at each call. */
const clock = (): (() => Date) => {
  let calls = 0;
  return () => new Date(Date.UTC(2026, 10, 18, 14, calls++, 0, 250));
};

/** A measurement with no Docker: the fixture record of the case, and an empty raw result. */
const fake = async (value: Case): Promise<Measurement> => {
  const record = RECORDS[value.id];
  if (record === undefined) throw new Error(`no fixture for ${value.id}`);
  return { record, result: { cell: { name: value.id } } as unknown as CellResult };
};

describe("the CI run of a job", () => {
  it("gives the run of GitHub Actions in the form of the evidence of a law: an https address, the commit and a UTC time", () => {
    const run = runOf(ENV, new Date(Date.UTC(2026, 10, 18, 14, 0, 0, 250)));
    expect(run).toEqual({ url: "https://github.com/mark1russell7/capacity/actions/runs/44453927945", commit: ENV.GITHUB_SHA, date: "2026-11-18T14:00:00Z" });
  });

  it("gives null outside GitHub Actions", () => {
    expect(runOf({}, new Date())).toBeNull();
    expect(runOf({ ...ENV, GITHUB_RUN_ID: "" }, new Date())).toBeNull();
  });

  it("gives a UTC time with whole seconds", () => {
    expect(utcOf(new Date(Date.UTC(2026, 10, 18, 9, 5, 7, 999)))).toBe("2026-11-18T09:05:07Z");
  });

  it("names the files of a case by its id", () => {
    expect(filesOf("control/base")).toEqual({ case: "control/base", record: "control-base.record.json", result: "control-base.result.json" });
  });
});

describe("a timed run of a plan", () => {
  let out: string | undefined;
  afterEach(() => {
    if (out !== undefined) rmSync(out, { recursive: true, force: true });
    out = undefined;
  });

  it("measures each case, writes its record and its raw result, and writes the manifest with the verdict", async () => {
    out = join(mkdtempSync(join(tmpdir(), "capacity-timed-")), "records");
    const timed = await timePlan(CONTROL, { out, measure: fake, env: ENV, now: clock() });
    expect(timed).toEqual({
      format: TIMED_FORMAT,
      plan: "control",
      run: { url: "https://github.com/mark1russell7/capacity/actions/runs/44453927945", commit: ENV.GITHUB_SHA, date: "2026-11-18T14:00:00Z" },
      attempt: 2,
      machine: RECORDS["control/base"]!.machine,
      at: { started: "2026-11-18T14:00:00.250Z", ended: "2026-11-18T14:01:00.250Z" },
      files: [filesOf("control/base"), filesOf("control/more")],
      verdict: { check: "control", values: expect.any(Object), problems: [] },
    } satisfies Timed);
    expect(timed.machine?.cpu).toBe("Intel(R) Xeon(R) 6975P-C");
    expect(JSON.parse(readFileSync(join(out, MANIFEST), "utf8"))).toEqual(timed);
    expect(JSON.parse(readFileSync(join(out, "control-more.record.json"), "utf8"))).toEqual(RECORDS["control/more"]);
    expect(JSON.parse(readFileSync(join(out, "control-more.result.json"), "utf8"))).toEqual({ cell: { name: "control/more" } });
  });

  it("gives no run and no attempt outside CI", async () => {
    out = mkdtempSync(join(tmpdir(), "capacity-timed-"));
    const timed = await timePlan(CONTROL, { out, measure: fake, env: {}, now: clock() });
    expect(timed.run).toBeNull();
    expect(timed.attempt).toBeNull();
  });

  it("measures a start case with the option start in the run of the job, and judges each start record", async () => {
    out = mkdtempSync(join(tmpdir(), "capacity-timed-"));
    const value = readPlans(fileURLToPath(new URL("../plans/", import.meta.url))).plans.find((each) => each.id === "alerts-start")!.cases[0] as StartCase;
    const plan: Plan = { ...CONTROL, id: "alerts-start", check: null, cases: [value] };
    const machine = { cpu: "Test CPU", cores: 4, kernel: "6.8.0", architecture: "x64", node: "v26.13.1", memory: { value: 16, unit: "GiB" } };
    const env = { cpu: "Test CPU", cores: 4, os: "linux", arch: "x64", node: "v26.13.1" };
    const record: StartRecord = {
      format: START_RECORD_FORMAT,
      case: value,
      machine,
      at: { started: "2026-11-18T14:00:00.250Z", ended: "2026-11-18T14:00:00.250Z" },
      job: "3",
      image: { name: value.target.image, id: `sha256:${"d".repeat(64)}`, digest: null },
      check: { node: value.target.node, memoryMax: "1011425280", swapMax: "2147483648", hostSwap: { value: 4, unit: "GiB" }, heapLimit: { value: 556269568, unit: "B" }, cpus: 2, start: { value: 700, unit: "ms" } },
      trees: [],
      pairs: ["new", "base~aa"],
      points: [],
      readings: [],
      orders: [],
      failures: [],
      skipped: [],
      firsts: [],
      disks: [],
    };
    const runs: number[] = [];
    const start = async (each: StartCase, run: number): Promise<StartMeasurement> => {
      runs.push(run);
      return { record: { ...record, case: each }, result: { env, job: String(run), pairs: {}, skipped: [], orders: [] } };
    };
    const timed = await timePlan(plan, { out, measure: fake, start, run: 3, env: ENV, now: clock() });
    expect(runs).toEqual([3]);
    expect(timed.machine).toEqual(machine);
    expect(timed.files).toEqual([filesOf(value.id)]);
    expect(JSON.parse(readFileSync(join(out, filesOf(value.id).record), "utf8"))).toEqual(record);
    // The record has no round and no reading. Thus the record and each observation of the machine are problems of the verdict.
    expect(timed.verdict.check).toBeNull();
    expect(timed.verdict.problems.map((each) => each.code)).toEqual(["record", ...value.observed.map(() => "observed")]);
  });

  it("stops at a case that throws, with no manifest, and keeps the files of the cases before it", async () => {
    out = mkdtempSync(join(tmpdir(), "capacity-timed-"));
    const broken = async (value: Case): Promise<Measurement> => (value.id === "control/more" ? Promise.reject(new Error("no Docker")) : fake(value));
    await expect(timePlan(CONTROL, { out, measure: broken, env: ENV, now: clock() })).rejects.toThrow("no Docker");
    expect(existsSync(join(out, "control-base.record.json"))).toBe(true);
    expect(existsSync(join(out, MANIFEST))).toBe(false);
  });
});

describe("the summary of a timed run", () => {
  const TIMED: Timed = {
    format: TIMED_FORMAT,
    plan: "control",
    run: null,
    attempt: null,
    machine: RECORDS["control/base"]!.machine,
    at: { started: "2026-11-18T14:00:00.250Z", ended: "2026-11-18T14:01:00.250Z" },
    files: [filesOf("control/base"), filesOf("control/more")],
    verdict: { check: "control", values: { "cpu.request": 1.006427 }, problems: [] },
  };

  it("tells the verdict, the CPU model, the check, the cases and each value", () => {
    const summary = summaryOf(TIMED);
    expect(summary).toContain("### The plan `control`: pass");
    expect(summary).toContain(`- The CPU model: ${escapeMarkdown("Intel(R) Xeon(R) 6975P-C, 4 CPUs, x86_64")}`);
    expect(summary).toContain("- The cases: `control/base`, `control/more`");
    expect(summary).toContain("| `cpu.request` | 1.006427 |");
  });

  it("tells each problem of a failed verdict", () => {
    const failed: Timed = { ...TIMED, machine: null, verdict: { check: null, values: {}, problems: [{ code: "run", path: "control/base run 0", message: "The run has 1 unfinished requests, not 0." }] } };
    const summary = summaryOf(failed);
    expect(summary).toContain("### The plan `control`: fail");
    expect(summary).toContain("- The CPU model: no record");
    expect(summary).toContain("- The check: none");
    expect(summary).not.toContain("| Value |");
    expect(summary).toContain(`- **run** ${escapeMarkdown("control/base run 0")}: ${escapeMarkdown("The run has 1 unfinished requests, not 0.")}`);
  });
});
