// The request classes of the synthetic subjects. This file imports nothing, thus a subject in a
// container and the cell on the host read the same file.

/**
 * A request class is the work that one request asks of a synthetic subject. Each field is one
 * load variable, thus a run can move one variable alone. Each field is a whole number, 0 or more.
 */
export interface RequestClass {
  /** This count is the bytes of the body of the request. */
  readonly body: number;
  /** This count is the bytes of memory that the request allocates and then drops. */
  readonly alloc: number;
  /** This time is the CPU time of the request on the main thread, in microseconds. It blocks the event loop. */
  readonly work: number;
  /** This time is the wait of the request with no CPU time, in milliseconds. */
  readonly wait: number;
  /** This count is the bytes of the body of the reply. */
  readonly reply: number;
}

/** A field is the name of one field of a request class. */
export type Field = keyof RequestClass;

/** These names are the fields of a request class, in the order of the work of a request. */
export const FIELDS: readonly Field[] = ["body", "alloc", "work", "wait", "reply"];

/**
 * These units are the unit of each field, as canonical units of `@mark1russell7/quantity`. Each
 * unit is the resolution of its mechanism: the CPU clock of a thread, and a timer of Node.
 */
export const UNITS: Readonly<Record<Field, string>> = { body: "B", alloc: "B", work: "us", wait: "ms", reply: "B" };

const MIB = 1024 * 1024;

/** These numbers are the largest value of each field. */
export const LIMITS: Readonly<Record<Field, number>> = {
  body: 16 * MIB,
  alloc: 256 * MIB,
  work: 10_000_000,
  wait: 600_000,
  reply: 16 * MIB,
};

/** This class asks no work: a request with no body, and a reply with no body. */
export const EMPTY: RequestClass = { body: 0, alloc: 0, work: 0, wait: 0, reply: 0 };

const DIGITS = /^(?:0|[1-9]\d{0,9})$/;

const isField = (name: string): name is Field => (FIELDS as readonly string[]).includes(name);

/** This function gives each problem of a request class. A class with no problem gives an empty list. */
export const classProblems = (asked: RequestClass): readonly string[] =>
  FIELDS.flatMap((field) => {
    const value: unknown = asked[field];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return [`The field ${field} is not a whole number, 0 or more.`];
    if (value > LIMITS[field]) return [`The field ${field} is ${value}. The limit is ${LIMITS[field]}.`];
    return [];
  });

/**
 * This function gives the path of the request of a class, for example `/?work=500&reply=1024`. The
 * path names each field that is not 0. The function throws for a class with a problem.
 */
export const pathOf = (asked: RequestClass): string => {
  const problems = classProblems(asked);
  if (problems.length > 0) throw new RangeError(problems.join(" "));
  const pairs = FIELDS.filter((field) => asked[field] !== 0).map((field) => `${field}=${asked[field]}`);
  return pairs.length === 0 ? "/" : `/?${pairs.join("&")}`;
};

/**
 * This function reads the class of a request from its path. A field that the path does not name
 * is 0. The function gives undefined for a path that is not the path of a class.
 */
export const classOf = (path: string): RequestClass | undefined => {
  if (path === "/") return EMPTY;
  if (!path.startsWith("/?")) return undefined;
  const values: Record<Field, number> = { ...EMPTY };
  const seen = new Set<Field>();
  for (const pair of path.slice(2).split("&")) {
    const at = pair.indexOf("=");
    const name = pair.slice(0, Math.max(at, 0));
    const text = pair.slice(at + 1);
    if (!isField(name) || seen.has(name) || !DIGITS.test(text)) return undefined;
    const value = Number(text);
    if (value > LIMITS[name]) return undefined;
    seen.add(name);
    values[name] = value;
  }
  return values;
};

/**
 * This function gives the whole HTTP/1.1 request of a class, with its head and its body. A class
 * with a body is a `POST`, and each byte of the body is the letter `x`. The connection stays open.
 */
export const requestOf = (asked: RequestClass, host: string): string => {
  const path = pathOf(asked);
  if (asked.body === 0) return `GET ${path} HTTP/1.1\r\nhost: ${host}\r\n\r\n`;
  return `POST ${path} HTTP/1.1\r\nhost: ${host}\r\ncontent-length: ${asked.body}\r\n\r\n${"x".repeat(asked.body)}`;
};
