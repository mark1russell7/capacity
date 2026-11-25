import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { LAW_SUFFIX, readJobs, readLawFile, readLaws } from "./jobs.ts";
import { BASE, EPYC, runOf, timedOf } from "./law-fixtures.ts";
import { MANIFEST, type Timed } from "./timed.ts";

/** This folder holds the law files of the package capacity. */
const LAWS = fileURLToPath(new URL("../../capacity/laws/", import.meta.url));
const CPU_LAW = join(LAWS, "node-http/rate/xeon-6975p-c/cpu.request.law.json");

let folder = "";
afterEach(() => {
  if (folder !== "") rmSync(folder, { recursive: true, force: true });
  folder = "";
});

const json = (file: string, value: unknown): void => writeFileSync(file, `${JSON.stringify(value)}\n`);

/** This function writes the manifest of a job into the folder `name`, with a record of the case control/base and a start record. */
const writeJob = (name: string, started: string, more: Partial<Timed> = {}): void => {
  const dir = join(folder, name);
  mkdirSync(dir, { recursive: true });
  json(join(dir, "base.record.json"), BASE);
  json(join(dir, "start.record.json"), { format: "capacity-start-record/1" });
  const files = [
    { case: BASE.case.id, record: "base.record.json", result: "base.result.json" },
    { case: "start", record: "start.record.json", result: "start.result.json" },
  ];
  json(join(dir, MANIFEST), { ...timedOf("rate", runOf(1), EPYC, started), files, ...more });
};

describe("the reader of the jobs of a folder", () => {
  it("reads each manifest of the folder and of its subfolders, in the order of their paths, with its records of load and its start records", () => {
    folder = mkdtempSync(join(tmpdir(), "capacity-jobs-"));
    writeJob("lab-rate-2-1", "2026-11-22T06:02:00Z");
    writeJob("lab-rate-1-1/deep", "2026-11-22T06:01:00Z");
    writeFileSync(join(folder, "other.json"), "{}\n");
    const jobs = readJobs(folder);
    expect(jobs.map((each) => each.timed.at.started)).toEqual(["2026-11-22T06:01:00Z", "2026-11-22T06:02:00Z"]);
    expect(jobs.map((each) => each.records.map((record) => record.case.id))).toEqual([[BASE.case.id], [BASE.case.id]]);
    expect(jobs.map((each) => each.starts?.map((record) => record.format))).toEqual([["capacity-start-record/1"], ["capacity-start-record/1"]]);
  });

  it("keeps the latest attempt of each artifact with the option latest, as after a rerun of failed jobs", () => {
    folder = mkdtempSync(join(tmpdir(), "capacity-jobs-"));
    writeJob("lab-gate-1-1", "2026-11-22T06:01:00Z");
    writeJob("lab-gate-2-1", "2026-11-22T06:02:00Z");
    writeJob("lab-gate-2-2", "2026-11-22T07:02:00Z");
    expect(readJobs(folder).map((each) => each.timed.at.started)).toHaveLength(3);
    expect(readJobs(folder, { latest: true }).map((each) => each.timed.at.started)).toEqual(["2026-11-22T06:01:00Z", "2026-11-22T07:02:00Z"]);
  });

  it("gives no job for a folder with no manifest, and throws for a manifest of another format", () => {
    folder = mkdtempSync(join(tmpdir(), "capacity-jobs-"));
    expect(readJobs(folder)).toEqual([]);
    writeJob("bad", "2026-11-22T06:01:00Z", { format: "capacity-timed/0" as Timed["format"] });
    expect(() => readJobs(folder)).toThrow(/is not a manifest of the format/);
  });
});

describe("the reader of the law files", () => {
  it("reads each law file of the laws of the package capacity", () => {
    const ids = readLaws(LAWS).map((law) => law.id);
    expect(ids).toContain("node-http/rate/xeon-6975p-c/cpu.request");
    expect(ids).toContain("node-http-service/overhead/xeon-6975p-c/cpu.request.overhead");
    // Each id is in the folder `<subject>/<plan>` of a plan with a law set: the plan `rate` of the bare server, the plan `overhead` of the runner, or the events, the feeds and the persons of alerts.
    const folders = ["node-http/rate/", "node-http-service/overhead/", "alerts-runtime/alerts-start-event/", "alerts-runtime/alerts-start-feeds/", "alerts-runtime/alerts-start-log/", "alerts-runtime/alerts-start-persons/"];
    expect(ids.filter((id) => !folders.some((folder) => id.startsWith(folder)))).toEqual([]);
  });

  it("reads only the files with the end of a law file, in the order of their paths, and throws for a law file with a problem", () => {
    folder = mkdtempSync(join(tmpdir(), "capacity-laws-"));
    const law = JSON.parse(readFileSync(CPU_LAW, "utf8")) as Record<string, unknown>;
    const memory = JSON.parse(readFileSync(CPU_LAW.replace("cpu.request", "memory"), "utf8")) as Record<string, unknown>;
    json(join(folder, `cpu${LAW_SUFFIX}`), law);
    mkdirSync(join(folder, "a"));
    json(join(folder, "a", `memory${LAW_SUFFIX}`), memory);
    json(join(folder, "notes.json"), { format: "other" });
    expect(readLaws(folder).map((each) => each.id)).toEqual([memory["id"], law["id"]]);
    const bad = join(folder, `bad${LAW_SUFFIX}`);
    json(bad, { ...law, constants: "none" });
    expect(() => readLawFile(bad)).toThrow(/bad\.law\.json is not a correct law:\n.*constants/);
    expect(() => readLaws(folder)).toThrow(/is not a correct law/);
  });
});
