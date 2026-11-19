import { err, ok, type Result } from "@mark1russell7/optional";
import { evaluate, space, type AnyDomain, type Expr } from "@mark1russell7/vex";
import { NumDomain } from "@mark1russell7/vex-domains";

/** These domains give the ops of the program of a law: the ops of numbers. */
export const LAW_DOMAINS: readonly AnyDomain[] = [NumDomain];

/** This function gives the result of a program at each record: a finite number, or the text of its error. */
const resultsOf = (program: Expr, records: readonly Readonly<Record<string, number>>[]): readonly Result<number, string>[] => {
  const at = space.array(records);
  const results: Result<number, string>[] = [];
  for (const origin of at.keys) {
    const result = evaluate(program, { space: at, origin, domains: LAW_DOMAINS });
    if (!result.ok) results.push(err(`${result.error.code} ${result.error.message}`));
    else if (typeof result.value !== "number" || !Number.isFinite(result.value)) {
      results.push(err("the program gave a value that is not a finite number"));
    } else results.push(ok(result.value));
  }
  return results;
};

/**
 * This function gives the value of a program at each record, in the order of the records. It gives
 * the text of the first error when a record has no finite value.
 */
export const valuesOf = (
  program: Expr,
  records: readonly Readonly<Record<string, number>>[],
): Result<readonly number[], string> => {
  const values: number[] = [];
  for (const result of resultsOf(program, records)) {
    if (result.tag === "err") return result;
    values.push(result.value);
  }
  return ok(values);
};

/**
 * This function gives the value of a program at each record, in the order of the records. A record
 * with no finite value gives undefined.
 */
export const valuesAt = (program: Expr, records: readonly Readonly<Record<string, number>>[]): readonly (number | undefined)[] =>
  resultsOf(program, records).map((result) => (result.tag === "ok" ? result.value : undefined));

/** This function gives the record that a program reads: the values of the variables and the constants. */
export const recordOf = (
  names: readonly string[],
  values: readonly number[],
  base: Readonly<Record<string, number>> = {},
): Readonly<Record<string, number>> => {
  const record: Record<string, number> = { ...base };
  names.forEach((name, index) => {
    record[name] = values[index] as number;
  });
  return record;
};
