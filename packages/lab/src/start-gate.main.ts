/**
 * The command of the start gate. It compares the records of the runs of a start case with the limits of the case.
 *
 * ```text
 * node src/start-gate.main.ts gate --limits <file> --runs <folder> [--runs <folder>] --commit <commit> [--count <number>]
 * ```
 *
 * - `--limits` is a start limits file of the package `capacity`, for example `limits/alerts-start-gate.limits.json`.
 * - Each folder `--runs` holds the artifacts of the jobs, as `gh run download <run>` writes them. The command reads them with `readJobs`.
 *   It reads the latest try of each job, as the gate of the laws does. Thus a rerun of a lost runner gives a read.
 * - `--commit` is the commit of the arm of the limits that the runs measured. `--count` is the fewest runs. The default is 5.
 * - The command writes the summary into `GITHUB_STEP_SUMMARY`. A block, a no read or a problem gives the exit code 1.
 */
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { errorMessage } from "@mark1russell7/text";
import { readJobs } from "./jobs.ts";
import { readPlans } from "./plan.ts";
import { startGateOf, startGateSummaryOf } from "./start-gate.ts";
import { readStartLimits } from "./start-limits.ts";

/** This folder holds the plan files of the lab. */
const PLANS = fileURLToPath(new URL("../plans/", import.meta.url));

const USAGE = "node src/start-gate.main.ts gate --limits <file> --runs <folder> [--runs <folder>] --commit <commit> [--count <number>]";

const gate = (args: readonly string[]): void => {
  const { values } = parseArgs({
    args: [...args],
    options: { limits: { type: "string" }, runs: { type: "string", multiple: true }, commit: { type: "string" }, count: { type: "string" } },
  });
  const { limits: file, runs: folders, commit } = values;
  if (file === undefined || folders === undefined || folders.length === 0 || commit === undefined) {
    throw new Error(`The command needs --limits, --runs and --commit.\n${USAGE}`);
  }
  const limits = readStartLimits(file);
  if (limits === undefined) throw new Error(`The limits file ${file} does not exist.`);
  const { plans, problems } = readPlans(PLANS);
  if (problems.length > 0) throw new Error(`The plan files have problems:\n${problems.map((each) => `  ${each.path}: ${each.message}`).join("\n")}`);
  const plan = plans.find((each) => each.id === limits.plan);
  if (plan === undefined) throw new Error(`The plan "${limits.plan}" of the limits has no plan file.`);
  const count = values.count === undefined ? undefined : Number(values.count);
  const result = startGateOf(limits, plan, folders.flatMap((folder) => readJobs(folder, { latest: true })), count === undefined ? { commit } : { commit, runs: count });
  const summary = startGateSummaryOf(result);
  process.stdout.write(summary);
  const out = process.env["GITHUB_STEP_SUMMARY"];
  if (out) appendFileSync(out, summary);
  if (result.outcome !== "pass") process.exitCode = 1;
};

const main = (): void => {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "gate") return gate(rest);
  throw new Error(`The command "${command ?? ""}" is not gate.\n${USAGE}`);
};

try {
  main();
} catch (error: unknown) {
  process.stderr.write(`${errorMessage(error)}\n`);
  process.exitCode = 1;
}
