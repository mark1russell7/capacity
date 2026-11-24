import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Composition } from "./composition.ts";
import type { InstanceType, Limit } from "./instance.ts";
import type { Law } from "./law.ts";
import { countReach, type ScaleModel } from "./scale.ts";
import { readComposition, readInstance, readLaw, readLimits } from "./schema.ts";
import type { Demand } from "./workload.ts";

/** This folder holds the instance files: one size of a machine or a container in each file. */
const INSTANCES = fileURLToPath(new URL("../instances/", import.meta.url));
const COMPOSITIONS = fileURLToPath(new URL("../compositions/", import.meta.url));
const LAWS = fileURLToPath(new URL("../laws/", import.meta.url));
const LIMITS = fileURLToPath(new URL("../limits/alerts-scale.limits.json", import.meta.url));

/** This function gives the paths of the files with the suffix in a folder, with forward slashes, in order. */
const filesOf = (folder: string, suffix: string): readonly string[] =>
  readdirSync(folder, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(suffix))
    .map((name) => name.split(sep).join("/"))
    .sort();

/** This function reads a file with a reader, or throws with each problem of the file. */
const readWith = <T>(read: (data: unknown) => { tag: "ok"; value: T } | { tag: "err"; error: readonly { path: string; message: string }[] }, path: string): T => {
  const result = read(JSON.parse(readFileSync(path, "utf8")));
  if (result.tag === "err") throw new Error(result.error.map((each) => `${each.path}: ${each.message}`).join("\n"));
  return result.value;
};

const instanceFiles = filesOf(INSTANCES, ".instance.json");
const instances: readonly InstanceType[] = instanceFiles.map((name) => readWith(readInstance, join(INSTANCES, name)));
const laws: readonly Law[] = filesOf(LAWS, ".law.json").map((name) => readWith(readLaw, join(LAWS, name)));
const compositions: readonly Composition[] = filesOf(COMPOSITIONS, ".composition.json").map((name) => readWith(readComposition, join(COMPOSITIONS, name)));
const limits = readWith(readLimits, LIMITS);

/** The compositions of alerts on the CPU model of its laws. */
const ALERTS = compositions.filter((composition) => composition.id.startsWith("alerts-runtime/xeon-6975p-c/"));
/** One event each second. A reach is a factor of this demand, thus it is in events each second. */
const ONE_EVENT: Demand = { classes: [], levels: { event: { value: 1, unit: "{event}/s" } } };

/** This function gives the scale model of alerts on an instance type, with the limits of the file or other limits. */
const alertsOn = (id: string, with_: readonly Limit[] = limits.limits): ScaleModel => ({
  instance: instances.find((each) => each.id === id)!,
  limits: with_,
  compositions: ALERTS,
  catalog: { laws, compositions },
});

/** This function gives the reach of one copy of alerts, or throws with the problem. */
const reachOf = (model: ScaleModel) => {
  const reach = countReach(model, 1, ONE_EVENT, { most: 1000 });
  if (reach.tag !== "ok") throw new Error(reach.error.message);
  return reach.value;
};

/** This function gives the factor of a reach, or throws when the reach is past the end of the search. */
const factorOf = (factor: { readonly value: number | null }): number => {
  if (factor.value === null) throw new Error("The reach is past the end of the search.");
  return factor.value;
};

/** One query reads 1000 replicates of 3 laws, and it takes approximately 7 s (CAP-92). */
const QUERY_TIME = 60_000;

describe("the instance files", () => {
  it("has an instance file or more", () => {
    // A folder with no file gives no read, not a pass.
    expect(instanceFiles.length).toBeGreaterThan(0);
  });

  it.each(instanceFiles)("%s is an instance type with the id of its path", (name) => {
    expect(instances[instanceFiles.indexOf(name)]!.id).toBe(name.slice(0, -".instance.json".length));
  });
});

describe("the scale rule of alerts", () => {
  it("has a composition for each limit of the limits file", () => {
    expect(ALERTS.map((composition) => composition.measure.id).sort()).toEqual(limits.limits.map((limit) => limit.measure).sort());
  });

  it("gives the reach of the README on the lab target with no headroom: the heap at 64 events each second", () => {
    // The laws reach the heap limit of V8 at 64 [50, 109] events each second. Each job of the lab reached it at the rung 60.
    const reach = reachOf(alertsOn("lab-target-1gb", limits.limits.map((limit) => ({ ...limit, headroom: 0 }))));
    expect(reach.binding).toBe("heap");
    expect(factorOf(reach.factor)).toBeCloseTo(64.0, 1);
    expect(reach.factor.interval.low).toBeLessThan(60);
    expect(reach.factor.interval.high).toBeGreaterThan(60);
    const memory = reach.limits.find((each) => each.limit === "memory")!;
    expect(factorOf(memory.factor)).toBeGreaterThan(factorOf(reach.factor));
  }, QUERY_TIME);

  it("gives the memory as the first limit of one copy on the small cloud machine, at 7.9 events each second", () => {
    // 676 MB free for the app, less 20 % of headroom, is 541 MB. The memory law gives 401 MB and 17.8 MB for each event each second.
    const reach = reachOf(alertsOn("small-cloud-1gb"));
    expect(reach.binding).toBe("memory");
    expect(factorOf(reach.factor)).toBeCloseTo(7.86, 1);
    expect(reach.factor.interval.low).toBeGreaterThan(7.1);
    expect(reach.factor.interval.high).toBeLessThan(8.7);
    // The CPU of 0.25 core binds much later. That law is of the lab CPU, thus the value is an extrapolation.
    const cpu = reach.limits.find((each) => each.limit === "cpu")!;
    expect(factorOf(cpu.factor)).toBeGreaterThan(2 * factorOf(reach.factor));
    expect(reach.limits[0]!.binds).toBe(1);
  }, QUERY_TIME);
});
