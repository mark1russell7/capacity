/**
 * The command of the timed runs. The workflow `lab.yml` starts it. Only CI starts `measure`, because
 * it needs Docker and a quiet machine.
 *
 * ```text
 * node src/timed.main.ts plan --event <event> [--plans <id,id>] [--runs <JSON list>] [--gates true|false]
 * node src/timed.main.ts gates --event <event> [--plans <id,id>] [--gates true|false]
 * node src/timed.main.ts measure --plan <id> --out <folder> [--run <number>]
 * ```
 *
 * - `plan` reads each plan file of `plans` and examines it. It writes the matrix of the workflow as
 *   JSON on its standard output: one entry for each run of each plan of the selection. With no `--runs`, each plan has
 *   its count of jobs (`Plan.jobs`).
 * - `gates` writes the ids of the gate plans of the same selection as a JSON list. The job `gate` of the workflow starts
 *   only for a list that is not empty.
 * - `--gates false` leaves the gate plans out of a selection by the event. The workflow gives it for a pull request that
 *   changes no file of the gate. The default is true.
 * - `measure` measures each case of one plan (`timePlan`) in the run `--run` of the matrix. The default
 *   run is 1. It writes the records, the raw results and the manifest into the folder. It writes a
 *   summary into `GITHUB_STEP_SUMMARY`, with a table for each start record. A verdict with a problem
 *   gives the exit code 1.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { errorMessage } from "@mark1russell7/text";
import { matrixOf, readPlans, selectPlans } from "./plan.ts";
import { START_RECORD_FORMAT, startSummaryOf, type StartRecord } from "./start-measure.ts";
import { summaryOf, timePlan } from "./timed.ts";

/** This folder holds the plan files of the lab. */
const PLANS = fileURLToPath(new URL("../plans/", import.meta.url));

const USAGE = `node src/timed.main.ts plan --event <event> [--plans <id,id>] [--runs <JSON list>] [--gates true|false]
node src/timed.main.ts gates --event <event> [--plans <id,id>] [--gates true|false]
node src/timed.main.ts measure --plan <id> --out <folder> [--run <number>]`;

/** This function gives the plans of the folder, or it throws with each problem of a plan file. */
const plans = () => {
  const { plans: found, problems } = readPlans(PLANS);
  if (problems.length > 0) throw new Error(`The plan files have problems:\n${problems.map((each) => `  ${each.path}: ${each.message}`).join("\n")}`);
  return found;
};

/** This function gives the ids of the option `--plans`: the ids separated by commas, with no empty id. */
const idsOf = (text: string): readonly string[] =>
  text
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "");

/** This function gives the flag of the option `--gates`: true or false, with true as the default. */
const gatesOf = (text: string): boolean => {
  if (text !== "true" && text !== "false") throw new Error(`--gates is not true or false: ${text}
${USAGE}`);
  return text === "true";
};

const plan = (args: readonly string[]): void => {
  const { values } = parseArgs({ args: [...args], options: { event: { type: "string" }, plans: { type: "string", default: "" }, runs: { type: "string", default: "" }, gates: { type: "string", default: "true" } } });
  if (values.event === undefined) throw new Error(`The command needs --event.\n${USAGE}`);
  const parsed: unknown = values.runs.trim() === "" ? undefined : JSON.parse(values.runs);
  if (parsed !== undefined && !Array.isArray(parsed)) throw new Error(`--runs is not a JSON list: ${values.runs}`);
  const runs = Array.isArray(parsed) ? parsed.map(Number) : undefined;
  const chosen = selectPlans(plans(), { event: values.event, ids: idsOf(values.plans), gates: gatesOf(values.gates) });
  process.stdout.write(`${JSON.stringify(matrixOf(chosen, runs))}\n`);
};

const gates = (args: readonly string[]): void => {
  const { values } = parseArgs({ args: [...args], options: { event: { type: "string" }, plans: { type: "string", default: "" }, gates: { type: "string", default: "true" } } });
  if (values.event === undefined) throw new Error(`The command needs --event.\n${USAGE}`);
  const chosen = selectPlans(plans(), { event: values.event, ids: idsOf(values.plans), gates: gatesOf(values.gates) });
  process.stdout.write(`${JSON.stringify(chosen.filter((each) => each.gate !== undefined).map((each) => each.id))}\n`);
};

const measure = async (args: readonly string[]): Promise<void> => {
  const { values } = parseArgs({ args: [...args], options: { plan: { type: "string" }, out: { type: "string" }, run: { type: "string", default: "1" } } });
  const { out } = values;
  if (values.plan === undefined || out === undefined) throw new Error(`The command needs --plan and --out.\n${USAGE}`);
  const run = Number(values.run);
  if (!Number.isSafeInteger(run) || run < 1) throw new Error(`--run is not a whole number of 1 or more: ${values.run}`);
  const [chosen] = selectPlans(plans(), { event: "workflow_dispatch", ids: [values.plan] });
  if (chosen === undefined) throw new Error(`No plan has the id "${values.plan}".`);
  const timed = await timePlan(chosen, { out, run });
  const starts = timed.files
    .map((each) => JSON.parse(readFileSync(join(out, each.record), "utf8")) as { readonly format?: unknown })
    .filter((record): record is StartRecord => record.format === START_RECORD_FORMAT);
  const summary = [summaryOf(timed), ...starts.map(startSummaryOf)].join("\n");
  process.stdout.write(summary);
  const file = process.env["GITHUB_STEP_SUMMARY"];
  if (file) appendFileSync(file, summary);
  if (timed.verdict.problems.length > 0) process.exitCode = 1;
};

const main = async (): Promise<void> => {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "plan") return plan(rest);
  if (command === "gates") return gates(rest);
  if (command === "measure") return measure(rest);
  throw new Error(`The command "${command ?? ""}" is not plan, gates or measure.\n${USAGE}`);
};

main().catch((error: unknown) => {
  process.stderr.write(`${errorMessage(error)}\n`);
  process.exitCode = 1;
});
