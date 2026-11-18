import { isCanonicalUnit } from "@mark1russell7/quantity";
import { describe, expect, it } from "vitest";
import { EMPTY, FIELDS, LIMITS, UNITS, classOf, classProblems, pathOf, requestOf, type RequestClass } from "./class.ts";

const classes: readonly RequestClass[] = [
  EMPTY,
  { ...EMPTY, reply: 1024 },
  { ...EMPTY, work: 500 },
  { ...EMPTY, wait: 20 },
  { ...EMPTY, body: 4096 },
  { ...EMPTY, alloc: 65_536 },
  { body: 1, alloc: 2, work: 3, wait: 4, reply: 5 },
  { ...LIMITS },
];

describe("pathOf and classOf", () => {
  it("gives the path / for the class that asks no work", () => {
    expect(pathOf(EMPTY)).toBe("/");
    expect(classOf("/")).toEqual(EMPTY);
  });

  it("names each field that is not 0, in the order of the fields", () => {
    expect(pathOf({ ...EMPTY, reply: 1024, work: 500 })).toBe("/?work=500&reply=1024");
    expect(pathOf({ body: 1, alloc: 2, work: 3, wait: 4, reply: 5 })).toBe("/?body=1&alloc=2&work=3&wait=4&reply=5");
  });

  it.each(classes)("reads the class back from its path: %j", (asked) => {
    expect(classOf(pathOf(asked))).toEqual(asked);
  });

  it("reads the fields in each order, and 0 for a field that the path does not name", () => {
    expect(classOf("/?reply=7&body=3")).toEqual({ ...EMPTY, body: 3, reply: 7 });
    expect(classOf("/?wait=0")).toEqual(EMPTY);
  });

  it.each([
    "",
    "/x",
    "/x?work=1",
    "?work=1",
    "/?",
    "/?work",
    "/?work=",
    "/?=1",
    "/?work=-1",
    "/?work=1.5",
    "/?work=01",
    "/?work=1e3",
    "/?work= 1",
    "/?work=1&",
    "/?work=1&work=2",
    "/?size=1",
    "/?Work=1",
    "/?work=12345678901",
    `/?reply=${LIMITS.reply + 1}`,
  ])("gives undefined for the path %j", (path) => {
    expect(classOf(path)).toBeUndefined();
  });
});

describe("classProblems", () => {
  it("finds no problem in a class at its limits", () => {
    expect(classProblems({ ...LIMITS })).toEqual([]);
    expect(classProblems(EMPTY)).toEqual([]);
  });

  it.each([
    ["a fraction", { ...EMPTY, work: 1.5 }, "work"],
    ["a number below 0", { ...EMPTY, wait: -1 }, "wait"],
    ["a value that is not a number", { ...EMPTY, body: Number.NaN }, "body"],
    ["a value above the limit", { ...EMPTY, reply: LIMITS.reply + 1 }, "reply"],
  ])("finds %s", (_name, asked, field) => {
    const problems = classProblems(asked);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`The field ${field} `);
    expect(() => pathOf(asked)).toThrow(RangeError);
  });
});

describe("UNITS", () => {
  it("gives a canonical unit of quantity for each field", () => {
    expect(Object.keys(UNITS).sort()).toEqual([...FIELDS].sort());
    for (const field of FIELDS) expect(isCanonicalUnit(UNITS[field])).toBe(true);
  });
});

describe("requestOf", () => {
  it("gives a GET with no body for a class with no body", () => {
    expect(requestOf({ ...EMPTY, reply: 10 }, "subject:8080")).toBe("GET /?reply=10 HTTP/1.1\r\nhost: subject:8080\r\n\r\n");
  });

  it("gives a POST whose body has the bytes of the class", () => {
    const text = requestOf({ ...EMPTY, body: 5, work: 2 }, "subject");
    expect(text).toBe("POST /?body=5&work=2 HTTP/1.1\r\nhost: subject\r\ncontent-length: 5\r\n\r\nxxxxx");
    const large = requestOf({ ...EMPTY, body: 70_000 }, "subject");
    expect(Buffer.byteLength(large.slice(large.indexOf("\r\n\r\n") + 4))).toBe(70_000);
  });
});
