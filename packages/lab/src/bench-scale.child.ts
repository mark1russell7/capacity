/**
 * The child of the bench of the scale query. The command `bench-scale.main.ts` starts one fresh child for each arm, case and round.
 *
 * ```text
 * node src/bench-scale.child.ts --case <id>
 * ```
 *
 * - The folder of the child is the root of the checkout of its arm. The child imports the package capacity of that checkout.
 * - The laws and the compositions come from the files next to this child, so each arm reads the same files.
 * - The child times the case with `timeArm` of `@mark1russell7/rigor-bench`. It prints one JSON line: the time of one call,
 *   the hash of the value of the case and the memory peak of the process.
 */
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { timeArm } from "@mark1russell7/rigor-bench";
import { peakRss } from "@mark1russell7/rigor-bench/fresh";
import { benchCases, resultHash, type BenchApi } from "./bench-scale.ts";
import { readCompositions, readLaws } from "./jobs.ts";

/** This count is the count of the timed samples of each child. */
const SAMPLES = 3;

/** This folder holds the files of the package capacity next to this child. */
const CAPACITY = fileURLToPath(new URL("../../capacity/", import.meta.url));

const main = async (): Promise<void> => {
  const { values } = parseArgs({ args: process.argv.slice(2), options: { case: { type: "string" } } });
  const catalog = { laws: readLaws(join(CAPACITY, "laws")), compositions: readCompositions(join(CAPACITY, "compositions")) };
  const found = benchCases(catalog).find((each) => each.id === values.case);
  if (found === undefined) throw new Error(`The bench has no case "${values.case ?? ""}".`);
  const api = (await import(pathToFileURL(join(process.cwd(), "packages", "capacity", "src", "index.ts")).href)) as BenchApi;
  const hash = resultHash(found.run(api));
  const time = timeArm(() => found.run(api), { samples: SAMPLES });
  process.stdout.write(`${JSON.stringify({ ms: time.ms, hash, peakRss: peakRss() })}\n`);
};

await main();
