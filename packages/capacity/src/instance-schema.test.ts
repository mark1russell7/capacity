import { describe, expect, it } from "vitest";
import { sampleInstance, sampleLimits } from "./instance.fixture.ts";
import { instanceSchema, limitSchema, limitsSchema, readInstance, readLimits } from "./schema.ts";

/** This function gives a record as the data of a file: the record after a turn through JSON text. */
const fileData = (record: object): Record<string, unknown> => JSON.parse(JSON.stringify(record)) as Record<string, unknown>;

describe("readInstance", () => {
  it("reads the sample instance type from the data of a file", () => {
    expect(readInstance(fileData(sampleInstance()))).toEqual({ tag: "ok", value: sampleInstance() });
  });

  it("gives a shape problem for a field that an instance type does not have", () => {
    expect(readInstance({ ...fileData(sampleInstance()), price: { value: 0.04, unit: "USD/h" } })).toMatchObject({
      tag: "err",
      error: [{ code: "shape", path: "" }],
    });
  });

  it("gives a shape problem with the path of a field of the wrong type", () => {
    const data = fileData(sampleInstance());
    expect(readInstance({ ...data, format: "capacity-instance/2" })).toMatchObject({ tag: "err", error: [{ code: "shape", path: "format" }] });
    expect(readInstance({ ...data, resources: { cpu: 2 } })).toMatchObject({ tag: "err", error: [{ code: "shape", path: "resources.cpu" }] });
    expect(readInstance({ ...data, resources: [] })).toMatchObject({ tag: "err", error: [{ code: "shape", path: "resources" }] });
  });

  it("gives the problems of the check for data with the shape of an instance type", () => {
    const data = fileData(sampleInstance());
    expect(readInstance({ ...data, resources: { cpu: { value: 2, unit: "cores" } } })).toMatchObject({
      tag: "err",
      error: [{ code: "amount", path: "resources.cpu" }],
    });
    expect(readInstance({ ...data, resources: {} })).toMatchObject({ tag: "err", error: [{ code: "resource", path: "resources" }] });
  });

  it("refuses data that is not an object", () => {
    for (const data of [null, undefined, 5, "instance", []]) {
      expect(readInstance(data)).toMatchObject({ tag: "err", error: [{ code: "shape" }] });
    }
  });
});

describe("readLimits", () => {
  it("reads the sample limit set from the data of a file", () => {
    expect(readLimits(fileData(sampleLimits()))).toEqual({ tag: "ok", value: sampleLimits() });
  });

  it("gives a shape problem for a ceiling that is an amount and a resource", () => {
    const data = fileData(sampleLimits());
    const both = { id: "cpu", measure: "cpu", ceiling: { kind: "resource", resource: "cpu", amount: { value: 2, unit: "{core}" } }, headroom: 0.3 };
    expect(readLimits({ ...data, limits: [both] })).toMatchObject({ tag: "err", error: [{ code: "shape", path: "limits.0.ceiling" }] });
  });

  it("gives a shape problem with the path of a field of the wrong type", () => {
    const data = fileData(sampleLimits());
    const [first] = sampleLimits().limits;
    expect(readLimits({ ...data, format: "capacity-limits/2" })).toMatchObject({ tag: "err", error: [{ code: "shape", path: "format" }] });
    expect(readLimits({ ...data, limits: [{ ...first, headroom: "30 %" }] })).toMatchObject({
      tag: "err",
      error: [{ code: "shape", path: "limits.0.headroom" }],
    });
    expect(readLimits({ ...data, limits: [{ ...first, ceiling: { kind: "share" } }] })).toMatchObject({
      tag: "err",
      error: [{ code: "shape", path: "limits.0.ceiling.kind" }],
    });
    expect(readLimits({ ...data, limits: [{ ...first, class: "read" }] })).toMatchObject({ tag: "err", error: [{ code: "shape", path: "limits.0" }] });
  });

  it("gives the problems of the check for data with the shape of a limit set", () => {
    const data = fileData(sampleLimits());
    const [first] = sampleLimits().limits;
    expect(readLimits({ ...data, limits: [{ ...first, headroom: 1 }] })).toMatchObject({
      tag: "err",
      error: [{ code: "headroom", path: "limits[0].headroom" }],
    });
    expect(readLimits({ ...data, limits: [first, first] })).toMatchObject({ tag: "err", error: [{ code: "id", path: "limits" }] });
  });

  it("refuses data that is not an object", () => {
    for (const data of [null, undefined, 5, "limits", []]) {
      expect(readLimits(data)).toMatchObject({ tag: "err", error: [{ code: "shape" }] });
    }
  });
});

describe("the schemas", () => {
  it("accept a shape that the check then refuses", () => {
    expect(instanceSchema.safeParse({ ...fileData(sampleInstance()), id: "Small Container" }).success).toBe(true);
    expect(limitsSchema.safeParse({ ...fileData(sampleLimits()), id: "Web Default" }).success).toBe(true);
    expect(limitSchema.safeParse({ ...sampleLimits().limits[0], headroom: 5 }).success).toBe(true);
  });
});
