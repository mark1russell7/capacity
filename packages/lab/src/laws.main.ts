/**
 * The command of the laws. The workflow `laws.yml` starts it in CI, because the fit of the laws of a
 * plan takes minutes.
 *
 * ```text
 * node src/laws.main.ts fit --records <folder> [--records <folder>] --out <folder> [--runs <count>] [--seed <number>]
 * ```
 *
 * - `fit` reads each manifest `timed.json` in each folder `--records` and in its subfolders, and the
 *   records of each manifest. The jobs of each plan with a law set give the laws of the plan
 *   (`lawsOf`). The jobs of the check `floor` give the noise of each law.
 * - It writes each law into `<out>/<id>.law.json`, then it reads each file again with `readLaw`.
 * - It writes a summary into `GITHUB_STEP_SUMMARY`. A problem, or no law, gives the exit code 1.
 * - `--runs` is the count of the bootstrap runs of each fit, and `--seed` is the seed of each fit.
 *   The defaults are the defaults of `fitLaw`.
 */
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { readLaw } from "@mark1russell7/capacity/schema";
import { errorMessage } from "@mark1russell7/text";
import { lawsOf, lawsSummaryOf, type LawJob, type LawsOptions } from "./laws.ts";
import { readPlans } from "./plan.ts";
import { RECORD_FORMAT, type CaseRecord } from "./record.ts";
import { MANIFEST, TIMED_FORMAT, type Timed } from "./timed.ts";

/** This folder holds the plan files of the lab. */
const PLANS = fileURLToPath(new URL("../plans/", import.meta.url));

const USAGE = "node src/laws.main.ts fit --records <folder> [--records <folder>] --out <folder> [--runs <count>] [--seed <number>]";

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, "utf8"));

/** This function gives each job of a folder: each manifest in the folder or in a subfolder, with the records of its cases of load. */
const jobsOf = (folder: string): readonly LawJob[] =>
  readdirSync(folder, { recursive: true, encoding: "utf8" })
    .filter((name) => basename(name) === MANIFEST)
    .sort()
    .map((name) => {
      const file = join(folder, name);
      const timed = readJson(file) as Timed;
      if (timed.format !== TIMED_FORMAT) throw new Error(`The file ${file} is not a manifest of the format "${TIMED_FORMAT}".`);
      const records = timed.files
        .map((each) => readJson(join(dirname(file), each.record)) as { readonly format?: unknown })
        .filter((record): record is CaseRecord => record.format === RECORD_FORMAT);
      return { timed, records };
    });

/** This function gives a whole number from an option, or it throws. */
const wholeOf = (name: string, text: string | undefined): number | undefined => {
  if (text === undefined) return undefined;
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`--${name} is not a whole number of 1 or more: ${text}`);
  return value;
};

const fit = (args: readonly string[]): void => {
  const { values } = parseArgs({
    args: [...args],
    options: { records: { type: "string", multiple: true }, out: { type: "string" }, runs: { type: "string" }, seed: { type: "string" } },
  });
  const { records: folders, out } = values;
  if (folders === undefined || folders.length === 0 || out === undefined) throw new Error(`The command needs --records and --out.\n${USAGE}`);
  const runs = wholeOf("runs", values.runs);
  const seed = wholeOf("seed", values.seed);
  const options: LawsOptions = { ...(runs === undefined ? {} : { runs }), ...(seed === undefined ? {} : { seed }) };
  const { plans, problems } = readPlans(PLANS);
  if (problems.length > 0) throw new Error(`The plan files have problems:\n${problems.map((each) => `  ${each.path}: ${each.message}`).join("\n")}`);
  const jobs = folders.flatMap(jobsOf);
  const floors = jobs.map((job) => job.timed);
  const summaries: string[] = [];
  let count = 0;
  let failed = false;
  for (const plan of plans) {
    const own = jobs.filter((job) => job.timed.plan === plan.id);
    if (plan.laws === undefined || own.length === 0) continue;
    const result = lawsOf(plan, own, floors, options);
    for (const { law } of result.laws) {
      const file = join(out, `${law.id}.law.json`);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify(law, null, 2)}\n`);
      const again = readLaw(readJson(file));
      if (again.tag === "err") throw new Error(`The file ${file} is not a correct law:\n${again.error.map((each) => `  ${each.path}: ${each.message}`).join("\n")}`);
    }
    count += result.laws.length;
    failed ||= result.problems.length > 0;
    summaries.push(lawsSummaryOf(plan.id, result));
  }
  if (summaries.length === 0) summaries.push(`No job of the ${jobs.length} jobs of the records is a job of a plan with a law set.\n`);
  const summary = summaries.join("\n");
  process.stdout.write(summary);
  const file = process.env["GITHUB_STEP_SUMMARY"];
  if (file) appendFileSync(file, summary);
  if (failed || count === 0) process.exitCode = 1;
};

const main = (): void => {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "fit") return fit(rest);
  throw new Error(`The command "${command ?? ""}" is not fit.\n${USAGE}`);
};

try {
  main();
} catch (error: unknown) {
  process.stderr.write(`${errorMessage(error)}\n`);
  process.exitCode = 1;
}
