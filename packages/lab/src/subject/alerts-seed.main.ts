// alerts-seed --tree DIR --out DIR --seed TEXT --log BYTES --shapes BYTES --transit BYTES
//
// The seed program of the start subject alerts. It writes the store of one point into the folder --out
// with `seedStore` of the testkit of the tree --tree. Then it writes the configuration of the measure,
// `alerts-config.json`, as `config.json`. A size of 0 for --shapes or --transit writes no such file.
//
// The last line of the program is one JSON line, as a child line of `@mark1russell7/rigor-bench/fresh`:
// - `ms` is the time of the seed.
// - `sizes` is the byte size of each file that the seed wrote, by the name of its variable.
// - `args` are the arguments of the start program for this store: `--end` and the time of the last event.
// - `logEvents` is the count of events of the log. It is not `events`, the GC events of a child line.
// - `types`, `start` and `end` come from the result of `seedStore`.

import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    tree: { type: "string" },
    out: { type: "string" },
    seed: { type: "string" },
    log: { type: "string" },
    shapes: { type: "string", default: "0" },
    transit: { type: "string", default: "0" },
  },
});

/** This function gives the whole number of a flag, or it stops the program. */
const whole = (name: string, text: string | undefined): number => {
  if (text === undefined || !/^\d+$/.test(text) || !Number.isSafeInteger(Number(text))) throw new RangeError(`--${name} is not a whole number, 0 or more.`);
  return Number(text);
};

if (values.tree === undefined || values.out === undefined || values.seed === undefined) throw new RangeError("The program needs --tree, --out and --seed.");
const log = whole("log", values.log);
const shapes = whole("shapes", values.shapes);
const transit = whole("transit", values.transit);

interface Seeded {
  readonly bytes: number;
  readonly events: number;
  readonly start: number;
  readonly end: number;
  readonly types: Readonly<Record<string, { readonly count: number; readonly bytes: number }>>;
  readonly shapes?: { readonly bytes: number };
  readonly transit?: { readonly bytes: number };
}

const started = performance.now();
const module = (await import(pathToFileURL(join(values.tree, "packages/testkit/src/seed-store.ts")).href)) as {
  readonly seedStore: (dir: string, options: Readonly<Record<string, unknown>>) => Promise<Seeded>;
};
const seeded = await module.seedStore(values.out, { log, seed: values.seed, ...(shapes > 0 ? { shapes } : {}), ...(transit > 0 ? { transit } : {}) });
copyFileSync(new URL("./alerts-config.json", import.meta.url), join(values.out, "config.json"));
const ms = performance.now() - started;

process.stdout.write(
  `${JSON.stringify({
    ms,
    sizes: { log: seeded.bytes, shapes: seeded.shapes?.bytes ?? 0, transit: seeded.transit?.bytes ?? 0 },
    args: ["--end", String(seeded.end)],
    logEvents: seeded.events,
    types: seeded.types,
    start: seeded.start,
    end: seeded.end,
  })}\n`,
);
