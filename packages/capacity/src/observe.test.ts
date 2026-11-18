import { describe, expect, it } from "vitest";
import { observedWorkload, type Observation } from "./observe.ts";
import { checkWorkload } from "./workload-check.ts";

/** This function gives the metrics of a shop in a window of 5 minutes. */
const observation = (): Observation => ({
  origin: "https://metrics.example/shop",
  from: "2026-11-18T14:00:00Z",
  to: "2026-11-18T14:05:00Z",
  classes: [
    { id: "read", count: { value: 270000, unit: "{request}" }, request: { reply: { value: 2, unit: "KiB" } } },
    { id: "write", count: { value: 30000, unit: "{request}" }, request: { reply: { value: 200, unit: "B" } } },
  ],
  levels: { connections: { value: 400, unit: "{connection}" } },
});

const NAME = { id: "shop/observed", title: "The shop from 14:00 to 14:05" };

describe("observedWorkload", () => {
  it("gives the mean rate of each class in the window", () => {
    const workload = observedWorkload(observation(), NAME);
    expect(workload).toEqual({
      tag: "ok",
      value: {
        format: "capacity-workload/1",
        id: "shop/observed",
        title: "The shop from 14:00 to 14:05",
        classes: [
          { id: "read", rate: { value: 900, unit: "{request}/s" }, request: { reply: { value: 2, unit: "KiB" } } },
          { id: "write", rate: { value: 100, unit: "{request}/s" }, request: { reply: { value: 200, unit: "B" } } },
        ],
        levels: { connections: { value: 400, unit: "{connection}" } },
        source: { kind: "metrics", origin: "https://metrics.example/shop", from: "2026-11-18T14:00:00Z", to: "2026-11-18T14:05:00Z" },
      },
    });
    expect(workload.tag === "ok" && checkWorkload(workload.value)).toEqual([]);
  });

  it("keeps the thing that a count counts in the unit of the rate", () => {
    const events = { ...observation(), classes: [{ id: "ingest", count: { value: 600, unit: "{event}" }, request: {} }] };
    expect(observedWorkload(events, NAME)).toMatchObject({ tag: "ok", value: { classes: [{ rate: { value: 2, unit: "{event}/s" } }] } });
  });

  it("gives a workload with no class for an app with no request class", () => {
    expect(observedWorkload({ ...observation(), classes: [] }, NAME)).toMatchObject({ tag: "ok", value: { classes: [] } });
  });

  it.each([
    ["a window that goes back", "2026-11-18T14:05:00Z", "2026-11-18T14:00:00Z"],
    ["a window of no time", "2026-11-18T14:00:00Z", "2026-11-18T14:00:00Z"],
    ["a time that is not a UTC time", "2026-11-18 14:00", "2026-11-18T14:05:00Z"],
  ])("refuses %s", (_, from, to) => {
    expect(observedWorkload({ ...observation(), from, to }, NAME)).toMatchObject({ tag: "err", error: [{ code: "source", path: "source" }] });
  });

  it.each([
    ["a size", { value: 5, unit: "B" }],
    ["a rate", { value: 5, unit: "{request}/s" }],
    ["a count below 0", { value: -5, unit: "{request}" }],
    ["a count that is not finite", { value: Number.NaN, unit: "{request}" }],
    ["a unit that is not canonical", { value: 5, unit: "requests" }],
  ])("refuses a count that is %s", (_, count) => {
    const bad = { ...observation(), classes: [observation().classes[0]!, { id: "write", count, request: {} }] };
    expect(observedWorkload(bad, NAME)).toMatchObject({ tag: "err", error: [{ code: "rate", path: "classes[1].count" }] });
  });

  it("gives each problem of the workload", () => {
    expect(observedWorkload({ ...observation(), origin: "" }, { id: "Shop", title: "" })).toMatchObject({
      tag: "err",
      error: [
        { code: "id", path: "id" },
        { code: "id", path: "title" },
        { code: "source", path: "source.origin" },
      ],
    });
  });
});
