// The JSON lines and the command line of the programs of a subject. Each line has `ev` and `t`,
// as the programs of the lab write them. `t` is process.hrtime, which reads CLOCK_MONOTONIC: the
// clock of each container of one kernel.

/** This function gives the time of its call, in nanoseconds on CLOCK_MONOTONIC. */
export const now = (): bigint => process.hrtime.bigint();

/** This function writes one line, with the time of the call. */
export const emit = (ev: string, fields: Readonly<Record<string, unknown>> = {}): boolean =>
  process.stdout.write(`${JSON.stringify({ ev, t: Number(now()), ...fields })}\n`);

/** This function writes a `fail` line and stops the process with the exit code 1. */
export const fail = (why: string): never => {
  emit("fail", { why });
  process.exit(1);
};

/**
 * This function reads the whole number of the flag `name` of the command line, for example
 * `--port 8080`. It gives undefined when the command line does not have the flag. It stops the
 * process for a value that is not a whole number, 0 or more.
 */
export const numberFlag = (name: string, argv: readonly string[] = process.argv.slice(2)): number | undefined => {
  const at = argv.indexOf(name);
  if (at === -1) return undefined;
  const text = argv[at + 1] ?? "";
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text))) return fail(`${name} is not a whole number, 0 or more`);
  return Number(text);
};
