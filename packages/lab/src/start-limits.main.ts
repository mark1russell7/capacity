/**
 * The command of the start limits. It writes the limits of a start gate from the records of 5 or more CI runs.
 *
 * ```text
 * node src/start-limits.main.ts limits --runs <folder> [--runs <folder>] --out <file> [--plan <id>] [--case <id>]
 * ```
 *
 * - Each folder `--runs` holds the artifacts of the jobs, as `gh run download <run>` writes them: one subfolder for each job.
 *   The command reads each manifest `timed.json` in each folder and in its subfolders, with `readJobs`.
 * - `--plan` is the plan of the start case. The default is the only plan of the jobs. `--case` is the start case. The
 *   default is the only start case of the plan.
 * - The command writes the start limits (`startLimitsOf`) into the file `--out`. Then it reads the file again with `readStartLimits`.
 * - It writes a summary into `GITHUB_STEP_SUMMARY`. A problem gives the exit code 1 and no file.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { errorMessage } from "@mark1russell7/text";
import { readJobs } from "./jobs.ts";
import { readPlans } from "./plan.ts";
import { readStartLimits, startLimitsOf, startLimitsSummaryOf } from "./start-limits.ts";

/** This folder holds the plan files of the lab. */
const PLANS = fileURLToPath(new URL("../plans/", import.meta.url));

const USAGE = "node src/start-limits.main.ts limits --runs <folder> [--runs <folder>] --out <file> [--plan <id>] [--case <id>]";

const limits = (args: readonly string[]): void => {
  const { values } = parseArgs({
    args: [...args],
    options: { runs: { type: "string", multiple: true }, out: { type: "string" }, plan: { type: "string" }, case: { type: "string" } },
  });
  const { runs: folders, out } = values;
  if (folders === undefined || folders.length === 0 || out === undefined) throw new Error(`The command needs --runs and --out.\n${USAGE}`);
  const { plans, problems } = readPlans(PLANS);
  if (problems.length > 0) throw new Error(`The plan files have problems:\n${problems.map((each) => `  ${each.path}: ${each.message}`).join("\n")}`);
  const jobs = folders.flatMap(readJobs);
  const ids = [...new Set(jobs.map((job) => job.timed.plan))].sort();
  const id = values.plan ?? (ids.length === 1 ? ids[0] : undefined);
  if (id === undefined) throw new Error(`The jobs are of the plans ${ids.join(", ") || "(none)"}. Give one with --plan.\n${USAGE}`);
  const plan = plans.find((each) => each.id === id);
  if (plan === undefined) throw new Error(`The plan "${id}" has no plan file.`);
  const result = startLimitsOf(plan, jobs, values.case === undefined ? {} : { case: values.case });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
  readStartLimits(out);
  const summary = startLimitsSummaryOf(result);
  process.stdout.write(summary);
  const file = process.env["GITHUB_STEP_SUMMARY"];
  if (file) appendFileSync(file, summary);
};

const main = (): void => {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "limits") return limits(rest);
  throw new Error(`The command "${command ?? ""}" is not limits.\n${USAGE}`);
};

try {
  main();
} catch (error: unknown) {
  process.stderr.write(`${errorMessage(error)}\n`);
  process.exitCode = 1;
}
