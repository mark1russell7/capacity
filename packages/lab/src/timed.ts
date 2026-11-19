import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Run } from "@mark1russell7/capacity";
import { escapeMarkdown } from "@mark1russell7/text";
import type { Case } from "./case.ts";
import { verdictOf, type Verdict } from "./check.ts";
import { measureCase, type Measurement } from "./measure.ts";
import type { Plan } from "./plan.ts";
import type { CaseRecord, Machine } from "./record.ts";

/** This text is the format of the manifest of a timed run. */
export const TIMED_FORMAT = "capacity-timed/1";

/** This name is the name of the file of the manifest, in the folder of the records. */
export const MANIFEST = "timed.json";

/** The files of one case of a timed run, by their names in the folder of the records. */
export interface TimedFiles {
  readonly case: string;
  /** This name is the file of the record of the case, with the format `capacity-record/1`. */
  readonly record: string;
  /** This name is the file of the raw result of the cell of the case. A later analysis can judge it again. */
  readonly result: string;
}

/**
 * The manifest of a timed run tells what one job measured. It has the plan, the CI run, the machine,
 * the file of each case and the verdict of the check. A law gets its evidence from it: `run` has the
 * form of a run of the evidence of a law.
 */
export interface Timed {
  readonly format: typeof TIMED_FORMAT;
  readonly plan: string;
  /** This run is the CI run of the job, or null outside CI. Its date is the start of the measurement. */
  readonly run: Run | null;
  /** This count is `GITHUB_RUN_ATTEMPT` of the CI run, or null outside CI. A run that starts again gets the next count. */
  readonly attempt: number | null;
  /** This machine is the machine of the first record: it names the CPU model. All cases of a plan have one runner. */
  readonly machine: Machine | null;
  readonly at: { readonly started: string; readonly ended: string };
  readonly files: readonly TimedFiles[];
  readonly verdict: Verdict;
}

/** The variables of the environment of a process. */
export type Environment = Readonly<Record<string, string | undefined>>;

/** This function gives a time as a UTC text with whole seconds, for example `2026-11-18T14:00:00Z`. */
export const utcOf = (time: Date): string => `${time.toISOString().slice(0, 19)}Z`;

/**
 * This function gives the CI run of a GitHub Actions job from its variables, at the time `date`. It
 * gives null outside GitHub Actions: a variable of the run is not there.
 *
 * The commit is `GITHUB_SHA`. For a pull request it is the merge commit, because the job measures
 * the code of that commit.
 */
export const runOf = (env: Environment, date: Date): Run | null => {
  const server = env["GITHUB_SERVER_URL"];
  const repository = env["GITHUB_REPOSITORY"];
  const id = env["GITHUB_RUN_ID"];
  const commit = env["GITHUB_SHA"];
  if (!server || !repository || !id || !commit) return null;
  return { url: `${server}/${repository}/actions/runs/${id}`, commit, date: utcOf(date) };
};

/** This function gives the count `GITHUB_RUN_ATTEMPT` of the CI run, or null. */
const attemptOf = (env: Environment): number | null => {
  const attempt = Number(env["GITHUB_RUN_ATTEMPT"]);
  return Number.isInteger(attempt) && attempt > 0 ? attempt : null;
};

/** This function gives the name of the files of a case: its id with `-` for each `/`. */
export const filesOf = (id: string): TimedFiles => {
  const name = id.replaceAll("/", "-");
  return { case: id, record: `${name}.record.json`, result: `${name}.result.json` };
};

/** The options of a timed run. Each one has a default for a real run, and a test gives its own. */
export interface TimeOptions {
  /** This folder gets the record and the raw result of each case, and the manifest `timed.json`. */
  readonly out: string;
  /** This function measures a case. The default is `measureCase`, which needs Docker. */
  readonly measure?: (value: Case) => Promise<Measurement>;
  /** These variables give the CI run. The default is `process.env`. */
  readonly env?: Environment;
  /** This function gives the time. The default is the clock of the system. */
  readonly now?: () => Date;
}

/**
 * This function measures each case of a plan, in the order of the plan, on this machine. It writes
 * the record and the raw result of each case into `out` when the case ends. Then it judges the
 * records with the check of the plan (`verdictOf`), and it writes the manifest `timed.json`.
 *
 * It gives the manifest. A case that throws stops the plan with no manifest, and the files of the
 * cases before it stay in `out`.
 */
export const timePlan = async (plan: Plan, options: TimeOptions): Promise<Timed> => {
  const measure = options.measure ?? measureCase;
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  mkdirSync(options.out, { recursive: true });
  const started = now();
  const records: CaseRecord[] = [];
  const files: TimedFiles[] = [];
  for (const value of plan.cases) {
    const { record, result } = await measure(value);
    const names = filesOf(value.id);
    writeFileSync(join(options.out, names.record), `${JSON.stringify(record, null, 2)}\n`);
    writeFileSync(join(options.out, names.result), `${JSON.stringify(result)}\n`);
    records.push(record);
    files.push(names);
  }
  const ended = now();
  const timed: Timed = {
    format: TIMED_FORMAT,
    plan: plan.id,
    run: runOf(env, started),
    attempt: attemptOf(env),
    machine: records[0]?.machine ?? null,
    at: { started: started.toISOString(), ended: ended.toISOString() },
    files,
    verdict: verdictOf(plan.check, records),
  };
  writeFileSync(join(options.out, MANIFEST), `${JSON.stringify(timed, null, 2)}\n`);
  return timed;
};

/**
 * This function gives the summary of a timed run as Markdown, for the summary of a job. The summary
 * has the verdict, the CPU model, the check and the cases. It also has each value and each problem.
 */
export const summaryOf = (timed: Timed): string => {
  const pass = timed.verdict.problems.length === 0;
  const machine = timed.machine === null ? "no record" : `${timed.machine.cpu}, ${timed.machine.cores} CPUs, ${timed.machine.architecture}`;
  const lines = [
    `### The plan \`${timed.plan}\`: ${pass ? "pass" : "fail"}`,
    "",
    `- The CPU model: ${escapeMarkdown(machine)}`,
    `- The check: ${timed.verdict.check === null ? "none" : `\`${timed.verdict.check}\``}`,
    `- The cases: ${timed.files.map((each) => `\`${each.case}\``).join(", ")}`,
    "",
  ];
  const values = Object.entries(timed.verdict.values);
  if (values.length > 0) lines.push("| Value | Read |", "| --- | --- |", ...values.map(([name, value]) => `| \`${name}\` | ${value} |`), "");
  for (const each of timed.verdict.problems) lines.push(`- **${each.code}** ${escapeMarkdown(each.path)}: ${escapeMarkdown(each.message)}`);
  return `${lines.join("\n")}\n`;
};
