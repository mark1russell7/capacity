import { err, ok, type Result } from "@mark1russell7/optional";
import { space, type AnyDomain, type Expr, type Program } from "@mark1russell7/vex";
import { tiered } from "@mark1russell7/vex-compiler";
import { NumDomain } from "@mark1russell7/vex-domains";

/** These domains give the ops of the program of a law: the ops of numbers. */
export const LAW_DOMAINS: readonly AnyDomain[] = [NumDomain];

/**
 * These programs are the compiled form of each expression that a law reads. A law keeps its expression, thus each expression
 * compiles one time. Tier 2 of the compiler runs generated code, with the results of the interpreter. A page that does not
 * permit generated code runs tier 1.
 */
const compiled = new WeakMap<Expr, Program>();

/** This function gives the compiled program of an expression: the program of the cache, or a new program that goes into the cache. */
const programFor = (expr: Expr): Program => {
  const known = compiled.get(expr);
  if (known !== undefined) return known;
  const made = tiered(expr, { domains: LAW_DOMAINS });
  compiled.set(expr, made);
  return made;
};

/** This function gives the result of a program at each record: a finite number, or the text of its error. */
const resultsOf = (expr: Expr, records: readonly Readonly<Record<string, number>>[]): readonly Result<number, string>[] => {
  const program = programFor(expr);
  const at = space.array(records);
  const results: Result<number, string>[] = [];
  for (const origin of at.keys) {
    const result = program.run({ space: at, origin });
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
