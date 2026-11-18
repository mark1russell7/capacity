import { describe, expect, it } from "vitest";
import { readWorkload, workloadSchema } from "./schema.ts";
import { sampleWorkload } from "./workload.fixture.ts";

/** This function gives the sample workload as the data of a file: the workload after a turn through JSON text. */
const fileData = (): Record<string, unknown> => JSON.parse(JSON.stringify(sampleWorkload())) as Record<string, unknown>;

const METRICS = { kind: "metrics", origin: "https://metrics.example/shop", from: "2026-11-18T14:00:00Z", to: "2026-11-18T14:05:00Z" };

describe("readWorkload", () => {
  it("reads the sample workload from the data of a file", () => {
    expect(readWorkload(fileData())).toEqual({ tag: "ok", value: sampleWorkload() });
  });

  it("reads a workload from the metrics of an app", () => {
    expect(readWorkload({ ...fileData(), source: METRICS })).toEqual({ tag: "ok", value: { ...sampleWorkload(), source: METRICS } });
  });

  it("gives a shape problem for a field that a workload does not have", () => {
    expect(readWorkload({ ...fileData(), owner: "me" })).toMatchObject({ tag: "err", error: [{ code: "shape", path: "" }] });
    expect(readWorkload({ ...fileData(), source: { ...METRICS, note: "a plan also" } })).toMatchObject({ tag: "err", error: [{ code: "shape", path: "source" }] });
  });

  it("gives a shape problem with the path of a field of the wrong type", () => {
    const data = fileData();
    expect(readWorkload({ ...data, format: "capacity-workload/2" })).toMatchObject({ tag: "err", error: [{ code: "shape", path: "format" }] });
    expect(readWorkload({ ...data, levels: { connections: 400 } })).toMatchObject({ tag: "err", error: [{ code: "shape", path: "levels.connections" }] });
    expect(readWorkload({ ...data, classes: [{ id: "read", rate: { value: "900", unit: "{request}/s" }, request: {} }] })).toMatchObject({
      tag: "err",
      error: [{ code: "shape", path: "classes.0.rate.value" }],
    });
    expect(readWorkload({ ...data, source: { kind: "guess" } })).toMatchObject({ tag: "err", error: [{ code: "shape", path: "source.kind" }] });
  });

  it("gives the problems of the check for data with the shape of a workload", () => {
    const data = fileData();
    expect(readWorkload({ ...data, levels: { connections: { value: 400, unit: "sockets" } } })).toMatchObject({
      tag: "err",
      error: [{ code: "amount", path: "levels.connections" }],
    });
    expect(readWorkload({ ...data, source: { ...METRICS, to: METRICS.from } })).toMatchObject({ tag: "err", error: [{ code: "source", path: "source" }] });
  });

  it("refuses data that is not an object", () => {
    for (const data of [null, undefined, 5, "workload", []]) {
      expect(readWorkload(data)).toMatchObject({ tag: "err", error: [{ code: "shape" }] });
    }
  });
});

describe("workloadSchema", () => {
  it("accepts a shape that the check then refuses", () => {
    expect(workloadSchema.safeParse({ ...fileData(), id: "Shop Peak" }).success).toBe(true);
  });
});
