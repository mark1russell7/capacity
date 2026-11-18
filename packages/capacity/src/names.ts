// The rules of the names and the times that a law file and a workload file share.

/** An id is lower-case words joined by `.`, `-` or `/`. A law, a subject, a measure, a form, a condition, a workload and a class each have an id. */
export const SLUG: RegExp = /^[a-z0-9]+(?:[./-][a-z0-9]+)*$/;

/** A name that a program reads: a variable, a constant or a level. */
export const NAME: RegExp = /^[a-z][A-Za-z0-9]*$/;

const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

/** This function tells if a text is a UTC time, for example `2026-11-18T14:00:00Z`. */
export const isUtc = (text: string): boolean => UTC.test(text) && Number.isFinite(Date.parse(text));

/** This function tells if a value is a finite number. */
export const finite = (value: number): boolean => typeof value === "number" && Number.isFinite(value);

/** This function gives the first value that a list has two times, or undefined. */
export const repeated = (values: readonly string[]): string | undefined =>
  values.find((value, index) => values.indexOf(value) !== index);
