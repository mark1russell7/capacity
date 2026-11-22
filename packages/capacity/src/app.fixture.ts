import type { AppContract, AppSeries } from "./app.ts";

const MIB = 1024 * 1024;

/** This function gives the series of the total of each request variable of a class: a counter in the unit of the variable. */
const totals = (id: string, units: Readonly<Record<string, string>>): readonly AppSeries[] =>
  Object.entries(units).map(([name, unit]): AppSeries => ({ id: `shop_${id}_${name}_total`, kind: "counter", unit, of: { total: name, class: id } }));

/**
 * This function gives a sample contract: the contract of a shop. The classes `read` and `write` come from
 * clients of HTTP, and the class `settle` comes from the outside service `payments`. The store `catalog` has
 * a seed. The live metrics give the whole demand of the shop.
 */
export const sampleApp = (): AppContract => ({
  format: "capacity-app/1",
  id: "shop",
  title: "A shop",
  repository: "https://example.org/shop.git",
  variables: [
    { id: "body", title: "The bytes of the body of a request", kind: "request", unit: "B", min: 0, max: 16 * MIB, scale: "linear" },
    { id: "reply", title: "The bytes of the body of a reply", kind: "request", unit: "B", min: 0, max: 16 * MIB, scale: "linear" },
    { id: "wait", title: "The time that a request waits for the store", kind: "request", unit: "ms", min: 0, max: 60_000, scale: "linear" },
    { id: "connections", title: "The open connections", kind: "level", unit: "{connection}", min: 0, max: 100_000, scale: "linear" },
    { id: "catalog", title: "The bytes of the catalog at the start", kind: "store", unit: "B", min: MIB, max: 1024 * MIB, scale: "log" },
  ],
  classes: [
    {
      id: "read",
      title: "A read of the items",
      rate: { unit: "{request}/s", min: 0, max: 100_000, scale: "linear" },
      request: ["body", "reply", "wait"],
      entry: { kind: "http", method: "GET", path: "/items?reply={reply}&wait={wait}", body: "body" },
    },
    {
      id: "write",
      title: "A write of an item",
      rate: { unit: "{request}/s", min: 0, max: 10_000, scale: "linear" },
      request: ["body", "reply", "wait"],
      entry: { kind: "http", method: "POST", path: "/items?reply={reply}&wait={wait}", body: "body" },
    },
    {
      id: "settle",
      title: "A settled payment that the shop reads from the payments service",
      rate: { unit: "{event}/s", min: 0, max: 1000, scale: "linear" },
      request: [],
      entry: { kind: "service", service: "payments" },
    },
  ],
  start: {
    install: { argv: ["pnpm", "install", "--frozen-lockfile"], cwd: ".", env: {} },
    check: { argv: ["pnpm", "run", "typecheck"], cwd: ".", env: {} },
    seed: { argv: ["node", "seed.ts", "--bytes", "{variable.catalog}", "--into", "{store}"], cwd: "scripts", env: {} },
    run: {
      argv: ["node", "server.ts", "--port", "{port}", "--data", "{store}"],
      cwd: "packages/server",
      env: { PAYMENTS_URL: "{service.payments}" },
      ready: { kind: "http", path: "/health" },
    },
  },
  services: [
    {
      id: "payments",
      title: "The payments service",
      fake: { argv: ["node", "payments.ts", "--port", "{port}", "--workload", "{workload}"], cwd: "fakes", env: {}, ready: { kind: "line", text: "listening" } },
    },
  ],
  metrics: [
    { id: "shop_read_total", kind: "counter", unit: "{request}", of: { rate: "read" } },
    { id: "shop_write_total", kind: "counter", unit: "{request}", of: { rate: "write" } },
    { id: "shop_settle_total", kind: "counter", unit: "{event}", of: { rate: "settle" } },
    ...totals("read", { body: "B", reply: "B", wait: "ms" }),
    ...totals("write", { body: "B", reply: "B", wait: "ms" }),
    { id: "shop_connections", kind: "gauge", unit: "{connection}", of: { level: "connections" } },
    { id: "process_cpu_seconds_total", kind: "counter", unit: "s", of: { measure: "cpu" } },
  ],
});
