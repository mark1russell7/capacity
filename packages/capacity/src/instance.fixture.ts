import type { InstanceType, LimitSet } from "./instance.ts";

/** This function gives a sample instance type: a container with 2 cores, 4 GiB of memory and a network of 1 Gbit/s. */
export const sampleInstance = (): InstanceType => ({
  format: "capacity-instance/1",
  id: "container/small",
  title: "A container with 2 cores and 4 GiB of memory",
  resources: {
    cpu: { value: 2, unit: "{core}" },
    memory: { value: 4, unit: "GiB" },
    network: { value: 1, unit: "Gbit/s" },
  },
});

/** This function gives a sample limit set: three limits on the resources of an instance, and one on a latency. */
export const sampleLimits = (): LimitSet => ({
  format: "capacity-limits/1",
  id: "web/default",
  title: "The limits of a web service",
  limits: [
    { id: "cpu", measure: "cpu", ceiling: { kind: "resource", resource: "cpu" }, headroom: 0.3 },
    { id: "memory", measure: "memory", ceiling: { kind: "resource", resource: "memory" }, headroom: 0.2 },
    { id: "sent", measure: "network.tx", ceiling: { kind: "resource", resource: "network" }, headroom: 0.5 },
    { id: "latency", measure: "latency.p99", ceiling: { kind: "amount", amount: { value: 200, unit: "ms" } }, headroom: 0.1 },
  ],
});
