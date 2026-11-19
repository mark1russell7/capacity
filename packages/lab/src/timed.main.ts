/**
 * The command of the timed runs. The workflow `lab.yml` starts it. Only CI starts `measure`, because
 * it needs Docker and a quiet machine.
 *
 * ```text
 * node src/timed.main.ts plan --event <event> [--plans <id,id>] [--runs <JSON list>]
 * node src/timed.main.ts measure --plan <id> --out <folder>
 * ```
 *
 * - `plan` reads each plan file of `plans` and examines it. It writes the matrix of the workflow as
 *   JSON on its standard output: one entry for each run of each plan of the selection.
 * - `measure` measures each case of one plan (`timePlan`). It writes the records, the raw results and
 *   the manifest into the folder, and a summary into `GITHUB_STEP_SUMMARY`. A verdict with a problem
 *   gives the exit code 1.
 */
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { errorMessage } from "@mark1russell7/text";
import { matrixOf, readPlans, selectPlans } from "./plan.ts";
import { summaryOf, timePlan } from "./timed.ts";

/** This folder holds the plan files of the lab. */
const PLANS = fileURLToPath(new URL("../plans/", import.meta.url));

const USAGE = `node src/timed.main.ts plan --event <event> [--plans <id,id>] [--runs <JSON list>]
node src/timed.main.ts measure --plan <id> --out <folder>`;

/** This function gives the plans of the folder, or it throws with each problem of a plan file. */
const plans = () => {
  const { plans: found, problems } = readPlans(PLANS);
  if (problems.length > 0) throw new Error(`The plan files have problems:\n${problems.map((each) => `  ${each.path}: ${each.message}`).join("\n")}`);
  return found;
};

const plan = (args: readonly string[]): void => {
  const { values } = parseArgs({ args: [...args], options: { event: { type: "string" }, plans: { type: "string", default: "" }, runs: { type: "string", default: "[1]" } } });
  if (values.event === undefined) throw new Error(`The command needs --event.\n${USAGE}`);
  const ids = values.plans
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "");
  const runs: unknown = JSON.parse(values.runs);
  if (!Array.isArray(runs)) throw new Error(`--runs is not a JSON list: ${values.runs}`);
  const chosen = selectPlans(plans(), { event: values.event, ids });
  process.stdout.write(`${JSON.stringify(matrixOf(chosen, runs.map(Number)))}\n`);
};

const measure = async (args: readonly string[]): Promise<void> => {
  const { values } = parseArgs({ args: [...args], options: { plan: { type: "string" }, out: { type: "string" } } });
  if (values.plan === undefined || values.out === undefined) throw new Error(`The command needs --plan and --out.\n${USAGE}`);
  const [chosen] = selectPlans(plans(), { event: "workflow_dispatch", ids: [values.plan] });
  if (chosen === undefined) throw new Error(`No plan has the id "${values.plan}".`);
  const timed = await timePlan(chosen, { out: values.out });
  const summary = summaryOf(timed);
  process.stdout.write(summary);
  const file = process.env["GITHUB_STEP_SUMMARY"];
  if (file) appendFileSync(file, summary);
  if (timed.verdict.problems.length > 0) process.exitCode = 1;
};

const main = async (): Promise<void> => {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "plan") return plan(rest);
  if (command === "measure") return measure(rest);
  throw new Error(`The command "${command ?? ""}" is not plan or measure.\n${USAGE}`);
};

main().catch((error: unknown) => {
  process.stderr.write(`${errorMessage(error)}\n`);
  process.exitCode = 1;
});
