/**
 * The command of the gate of the laws. The job `gate` of the workflow `lab.yml` starts it after the jobs of the plans.
 *
 * ```text
 * node src/gate.main.ts --records <folder> [--records <folder>] [--laws <folder>]
 * ```
 *
 * - It reads each manifest `timed.json` in each folder `--records` and in its subfolders, and the records of each manifest.
 * - Each gate plan with a job in the records gets its gate (`planGate`). The laws are the law files of the folder
 *   `--laws`. The default folder is the folder `laws` of the package capacity.
 * - It writes a summary into `GITHUB_STEP_SUMMARY` (`gateSummaryOf`), and a gate line with `writeGateLine` of
 *   `@mark1russell7/rigor-bench`. The gate line of a plan that must pass is an error, and of a plan that must block a warning.
 * - The exit code is 1 when a gate does not give the outcome that its plan expects (`expectedOf`). No job of a gate plan
 *   also gives the exit code 1, because a gate with no read is not a pass.
 */
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { gateLine, jobModels, writeGateLine } from "@mark1russell7/rigor-bench";
import { errorMessage } from "@mark1russell7/text";
import { gateSummaryOf, planGate } from "./gate.ts";
import { readJobs, readLaws } from "./jobs.ts";
import { readPlans } from "./plan.ts";

/** This folder holds the plan files of the lab. */
const PLANS = fileURLToPath(new URL("../plans/", import.meta.url));

/** This folder holds the law files of the package capacity. */
const LAWS = fileURLToPath(new URL("../../capacity/laws/", import.meta.url));

const USAGE = "node src/gate.main.ts --records <folder> [--records <folder>] [--laws <folder>]";

const main = (): void => {
  const { values } = parseArgs({ args: process.argv.slice(2), options: { records: { type: "string", multiple: true }, laws: { type: "string" } } });
  const folders = values.records;
  if (folders === undefined || folders.length === 0) throw new Error(`The command needs --records.\n${USAGE}`);
  const { plans, problems } = readPlans(PLANS);
  if (problems.length > 0) throw new Error(`The plan files have problems:\n${problems.map((each) => `  ${each.path}: ${each.message}`).join("\n")}`);
  const jobs = folders.flatMap(readJobs);
  const laws = readLaws(values.laws ?? LAWS);
  const summary = process.env["GITHUB_STEP_SUMMARY"];
  const write = (text: string): void => {
    process.stdout.write(text);
    if (summary) appendFileSync(summary, text);
  };
  const gates = plans.filter((plan) => plan.gate !== undefined && jobs.some((job) => job.timed.plan === plan.id));
  if (gates.length === 0) {
    write(`No job of the ${jobs.length} jobs of the records is a job of a gate plan. A gate with no read is not a pass.\n`);
    process.exitCode = 1;
    return;
  }
  for (const plan of gates) {
    const lawPlan = plans.find((each) => each.id === plan.gate?.laws);
    if (lawPlan === undefined) throw new Error(`The plan "${plan.id}" names the plan "${plan.gate?.laws ?? ""}" of its laws, and no plan has that id.`);
    const result = planGate(plan, lawPlan, jobs, laws);
    write(gateSummaryOf(result));
    const line = gateLine(result.gate.cases, {
      title: `The gate of the plan ${plan.id} (it must ${result.expected})`,
      enforced: result.expected === "pass",
      ...(result.gate.cases.length === 0 && result.unread.length > 0 ? { reason: result.unread[0]!.reason } : {}),
      models: jobModels(result.cpus.map((cpu) => ({ cpu }))),
    });
    writeGateLine(line, { summary: undefined });
    if (result.gate.outcome !== result.expected) {
      process.stderr.write(`The gate of the plan ${plan.id} gives "${result.gate.outcome}". The plan expects "${result.expected}".\n`);
      process.exitCode = 1;
    }
  }
};

try {
  main();
} catch (error: unknown) {
  process.stderr.write(`${errorMessage(error)}\n`);
  process.exitCode = 1;
}
