import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Composition } from "./composition.ts";
import type { InstanceType, Limit } from "./instance.ts";
import type { Law } from "./law.ts";
import { countReach, type ScaleModel } from "./scale.ts";
import { readComposition, readInstance, readLaw, readLimits } from "./schema.ts";
import type { Amounts, Demand } from "./workload.ts";

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

/** This function gives the reach of one copy of alerts over a demand and a state of the instance, or throws with the problem. */
const reachOf = (model: ScaleModel, demand: Demand = ONE_EVENT, given: Amounts = {}, most = 1000) => {
  const reach = countReach(model, 1, demand, { most, given });
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

  it("gives more events to the live setup of 2 persons and 5 feeds than to the base of 10 and 10", () => {
    // A level that does not grow with the load is a state of the instance, thus it is in given.
    const reach = reachOf(alertsOn("small-cloud-1gb"), ONE_EVENT, { persons: { value: 2, unit: "{person}" }, feeds: { value: 5, unit: "{feed}" } });
    expect(reach.binding).toBe("memory");
    expect(factorOf(reach.factor)).toBeCloseTo(8.57, 1);
    expect(factorOf(reach.factor)).toBeGreaterThan(factorOf(reachOf(alertsOn("small-cloud-1gb")).factor));
  }, 2 * QUERY_TIME);

  it("gives fewer events at the log of the live store, 197,156,864 B, than at the base log of 16 MiB", () => {
    // The memory of the watch grows with the log: 371 MB at 16 MiB, and approximately 455 MB at 188 MiB.
    const live = { persons: { value: 2, unit: "{person}" }, feeds: { value: 5, unit: "{feed}" } };
    const reach = reachOf(alertsOn("small-cloud-1gb"), ONE_EVENT, { ...live, log: { value: 197_156_864, unit: "B" } });
    expect(reach.binding).toBe("memory");
    expect(factorOf(reach.factor)).toBeCloseTo(3.82, 1);
    expect(reach.factor.interval.low).toBeGreaterThan(3.1);
    expect(reach.factor.interval.high).toBeLessThan(4.7);
    expect(factorOf(reach.factor)).toBeLessThan(factorOf(reachOf(alertsOn("small-cloud-1gb"), ONE_EVENT, live).factor) / 2);
  }, 2 * QUERY_TIME);

  it("holds each log of the contract with no events on the small cloud machine", () => {
    // The log law ends at 382 MiB, the largest log of the contract. The reach is past it, thus each log of the range fits.
    const reach = reachOf(alertsOn("small-cloud-1gb"), { classes: [], levels: { log: { value: 1, unit: "MiB" } } }, { event: { value: 0, unit: "{event}/s" }, persons: { value: 2, unit: "{person}" }, feeds: { value: 5, unit: "{feed}" } });
    expect(reach.binding).toBe("memory");
    expect(reach.factor.interval.low).toBeGreaterThan(382.1875);
  }, QUERY_TIME);

  it("gives the CPU as the first limit of the persons on the small cloud machine, at 469 persons with no events", () => {
    // The CPU of the watch grows as a power of the persons: 0.57 core at 3000 persons. 0.25 core, less 30 % of headroom, is 0.175 core.
    const reach = reachOf(alertsOn("small-cloud-1gb"), { classes: [], levels: { persons: { value: 1, unit: "{person}" } } }, { event: { value: 0, unit: "{event}/s" } }, 100_000);
    expect(reach.binding).toBe("cpu");
    expect(factorOf(reach.factor)).toBeGreaterThan(460);
    expect(factorOf(reach.factor)).toBeLessThan(480);
    expect(reach.factor.interval.low).toBeGreaterThan(380);
    expect(reach.factor.interval.high).toBeLessThan(580);
  }, QUERY_TIME);

  it("holds 3000 persons and not 10000 on the lab target with no headroom, as the lab found", () => {
    // Each job of the lab started with 3000 persons, and each job reached the heap limit of V8 with 10000.
    const bare = limits.limits.map((limit) => ({ ...limit, headroom: 0 }));
    const reach = reachOf(alertsOn("lab-target-1gb", bare), { classes: [], levels: { persons: { value: 1, unit: "{person}" } } }, { event: { value: 0, unit: "{event}/s" } }, 100_000);
    expect(reach.binding).toBe("heap");
    expect(reach.factor.interval.low).toBeGreaterThan(3000);
    expect(reach.factor.interval.high).toBeLessThan(10_000);
  }, QUERY_TIME);
});
