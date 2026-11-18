import type { Workload } from "./workload.ts";

/** This function gives a sample workload: the plan of a shop with two classes and one level. */
export const sampleWorkload = (): Workload => ({
  format: "capacity-workload/1",
  id: "shop/peak",
  title: "The peak hour of a shop",
  classes: [
    {
      id: "read",
      rate: { value: 900, unit: "{request}/s" },
      request: { body: { value: 0, unit: "B" }, reply: { value: 2, unit: "KiB" }, wait: { value: 5, unit: "ms" } },
    },
    {
      id: "write",
      rate: { value: 6000, unit: "{request}/min" },
      request: { body: { value: 4, unit: "KiB" }, reply: { value: 200, unit: "B" }, wait: { value: 20, unit: "ms" } },
    },
  ],
  levels: { connections: { value: 400, unit: "{connection}" } },
  source: { kind: "plan", note: "The forecast of the last week of November." },
});
