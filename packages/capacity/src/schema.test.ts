import { describe, expect, it } from "vitest";
import { leastCount } from "./law.ts";
import { sampleLaw, samplePoints } from "./sample.fixture.ts";
import { lawSchema, readLaw } from "./schema.ts";

/** This function gives the sample law as the data of a file: the law after a turn through JSON text. */
const fileData = (): Record<string, unknown> => JSON.parse(JSON.stringify(sampleLaw())) as Record<string, unknown>;

describe("readLaw", () => {
  it("reads the sample law from the data of a file", () => {
    expect(readLaw(fileData())).toEqual({ tag: "ok", value: sampleLaw() });
  });

  it("reads a law with the points of its fit, and a law file with no points", () => {
    const law = { ...sampleLaw(), points: samplePoints() };
    expect(readLaw(JSON.parse(JSON.stringify(law)))).toEqual({ tag: "ok", value: law });
    expect(readLaw(fileData())).toMatchObject({ tag: "ok" });
  });

  it("gives a shape problem with the path of a point of the wrong type", () => {
    const points = samplePoints().map((point, index) => (index === 2 ? { ...point, run: "first" } : point));
    expect(readLaw({ ...fileData(), points })).toMatchObject({ tag: "err", error: [{ code: "shape", path: "points.2.run" }] });
  });

  it("gives a shape problem for a field that a law does not have", () => {
    expect(readLaw({ ...fileData(), owner: "me" })).toMatchObject({ tag: "err", error: [{ code: "shape", path: "" }] });
  });

  it("gives a shape problem with the path of a field of the wrong type", () => {
    const data = fileData();
    expect(readLaw({ ...data, measure: { id: "cpu", unit: 5 } })).toMatchObject({ tag: "err", error: [{ code: "shape", path: "measure.unit" }] });
    expect(readLaw({ ...data, replicates: [["a"]] })).toMatchObject({ tag: "err", error: [{ code: "shape", path: "replicates.0.0" }] });
    expect(readLaw({ ...data, format: "capacity-law/2" })).toMatchObject({ tag: "err", error: [{ code: "shape", path: "format" }] });
  });

  it("gives a shape problem for a program that is not a Vex expression", () => {
    const data = fileData();
    const result = readLaw({ ...data, form: { id: "hinge", program: { tag: "what" } } });
    expect(result).toMatchObject({ tag: "err", error: [{ code: "shape", path: "form.program", message: "The program is not a Vex expression." }] });
  });

  it("gives the problems of the check for data with the shape of a law", () => {
    const data = fileData();
    expect(readLaw({ ...data, measure: { id: "cpu", unit: "µs" } })).toMatchObject({ tag: "err", error: [{ code: "unit", path: "measure.unit" }] });
  });

  it("refuses data that is not an object", () => {
    for (const data of [null, undefined, 5, "law", []]) {
      expect(readLaw(data)).toMatchObject({ tag: "err", error: [{ code: "shape" }] });
    }
  });
});

describe("lawSchema", () => {
  it("accepts a shape that the check then refuses", () => {
    expect(lawSchema.safeParse({ ...fileData(), replicates: [] }).success).toBe(true);
  });
});

describe("leastCount", () => {
  it("gives the count that puts one value beyond each end of an interval", () => {
    expect(leastCount(0.95)).toBe(40);
    expect(leastCount(0.9)).toBe(20);
    expect(leastCount(0.99)).toBe(200);
    expect(leastCount(0.5)).toBe(4);
  });
});
