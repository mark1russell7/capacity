import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compositionValue, type Composition } from "./composition.ts";
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

  it("gives no reach on the lab target with no headroom inside the event laws, which end at 70 events each second", () => {
    // A start that reaches the heap limit of V8 gives no reading. 5 starts of 2 Lab runs did at the rungs 60 and 70, thus the
    // heap laws of the events see only the starts that fit. The reach of the laws is past 70: it is no value (CAP-103).
    const reach = reachOf(alertsOn("lab-target-1gb", limits.limits.map((limit) => ({ ...limit, headroom: 0 }))));
    expect(reach.factor.interval.low).toBeGreaterThan(70);
  }, QUERY_TIME);

  it("gives the memory as the first limit of one copy on the small cloud machine, at 18.4 events each second", () => {
    // 676 MB free for the app, less 20 % of headroom, is 541 MB. The memory law gives 289 MB and 13.7 MB for each event each second.
    const reach = reachOf(alertsOn("small-cloud-1gb"));
    expect(reach.binding).toBe("memory");
    expect(factorOf(reach.factor)).toBeCloseTo(18.36, 1);
    expect(reach.factor.interval.low).toBeGreaterThan(15.9);
    expect(reach.factor.interval.high).toBeLessThan(21.6);
    // The CPU of 0.25 core binds much later. That law is of the lab CPU, thus the value is an extrapolation.
    const cpu = reach.limits.find((each) => each.limit === "cpu")!;
    expect(factorOf(cpu.factor)).toBeGreaterThan(2 * factorOf(reach.factor));
    expect(reach.limits[0]!.binds).toBe(1);
  }, QUERY_TIME);

  it("gives more events to the live setup of 2 persons and 5 feeds than to the base of 10 and 10", () => {
    // A level that does not grow with the load is a state of the instance, thus it is in given.
    const reach = reachOf(alertsOn("small-cloud-1gb"), ONE_EVENT, { persons: { value: 2, unit: "{person}" }, feeds: { value: 5, unit: "{feed}" } });
    expect(reach.binding).toBe("memory");
    expect(factorOf(reach.factor)).toBeCloseTo(18.91, 1);
    expect(factorOf(reach.factor)).toBeGreaterThan(factorOf(reachOf(alertsOn("small-cloud-1gb")).factor));
  }, 2 * QUERY_TIME);

  it("gives fewer events at the log of the live store, 197,156,864 B, than at the base log of 16 MiB", () => {
    // The memory of the watch grows as the logarithm of the log: 43 MB more at 188 MiB than at 16 MiB, thus 3.1 events each second less.
    const live = { persons: { value: 2, unit: "{person}" }, feeds: { value: 5, unit: "{feed}" } };
    const reach = reachOf(alertsOn("small-cloud-1gb"), ONE_EVENT, { ...live, log: { value: 197_156_864, unit: "B" } });
    expect(reach.binding).toBe("memory");
    expect(factorOf(reach.factor)).toBeCloseTo(15.81, 1);
    expect(reach.factor.interval.low).toBeGreaterThan(13.6);
    expect(reach.factor.interval.high).toBeLessThan(18.6);
    expect(factorOf(reach.factor)).toBeLessThan(factorOf(reachOf(alertsOn("small-cloud-1gb"), ONE_EVENT, live).factor) - 2.5);
  }, 2 * QUERY_TIME);

  it("gives 324 MB of memory and 122 MB of used heap to the live setup at 0.01 event each second", () => {
    // The cloud copy on a build after AL-172 had a resident set of 312 to 406 MB in 12 h of the 24 h series (AL-190).
    const live: Amounts = { persons: { value: 2, unit: "{person}" }, feeds: { value: 5, unit: "{feed}" }, log: { value: 197_156_864, unit: "B" } };
    const demand: Demand = { classes: [], levels: { event: { value: 0.01, unit: "{event}/s" } } };
    const valueOf = (measure: string) => {
      const value = compositionValue(ALERTS.find((each) => each.measure.id === measure)!, { laws, compositions }, demand, { given: live });
      if (value.tag !== "ok") throw new Error(value.error.message);
      return value.value;
    };
    const memory = valueOf("memory");
    expect(Math.round(memory.value / 1e6)).toBe(324);
    expect(memory.interval.low / 1e6).toBeGreaterThan(315);
    expect(memory.interval.high / 1e6).toBeLessThan(332);
    expect(memory.extrapolated).toBe(false);
    expect(Math.round(valueOf("heap").value / 1e6)).toBe(122);
  }, QUERY_TIME);

  it("holds each log of the contract with no events on the small cloud machine", () => {
    // The log law ends at 382 MiB, the largest log of the contract. The memory there is 336 MB, below the limit of 541 MB.
    const given: Amounts = { persons: { value: 2, unit: "{person}" }, feeds: { value: 5, unit: "{feed}" }, log: { value: 382.1875, unit: "MiB" } };
    const memory = compositionValue(ALERTS.find((each) => each.measure.id === "memory")!, { laws, compositions }, { classes: [], levels: { event: { value: 0, unit: "{event}/s" } } }, { given });
    if (memory.tag !== "ok") throw new Error(memory.error.message);
    expect(memory.value.extrapolated).toBe(false);
    expect(memory.value.interval.high / 1e6).toBeLessThan(345);
  }, QUERY_TIME);

  it("holds 1000 open incidents at the live setup with no events on the small cloud machine", () => {
    // The incidents law ends at 1000. The memory there is 408 MB. The CPU of the watch binds first, past the end of the law.
    const live: Amounts = { persons: { value: 2, unit: "{person}" }, feeds: { value: 5, unit: "{feed}" }, log: { value: 197_156_864, unit: "B" }, event: { value: 0, unit: "{event}/s" } };
    const reach = reachOf(alertsOn("small-cloud-1gb"), { classes: [], levels: { incidents: { value: 1, unit: "{incident}" } } }, live, 100_000);
    expect(reach.factor.interval.low).toBeGreaterThan(1000);
  }, QUERY_TIME);

  it("gives the CPU as the first limit of the persons on the small cloud machine, at 287 persons with no events", () => {
    // The CPU of the watch grows with the persons: 0.96 core at 3000 persons. 0.25 core, less 30 % of headroom, is 0.175 core.
    const reach = reachOf(alertsOn("small-cloud-1gb"), { classes: [], levels: { persons: { value: 1, unit: "{person}" } } }, { event: { value: 0, unit: "{event}/s" } }, 100_000);
    expect(reach.binding).toBe("cpu");
    expect(factorOf(reach.factor)).toBeGreaterThan(280);
    expect(factorOf(reach.factor)).toBeLessThan(295);
    expect(reach.factor.interval.low).toBeGreaterThan(275);
    expect(reach.factor.interval.high).toBeLessThan(300);
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
