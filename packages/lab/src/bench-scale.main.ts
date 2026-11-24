/**
 * The command of the bench of the scale query. The workflow `lab.yml` starts it. Only CI times a bench.
 *
 * ```text
 * node src/bench-scale.main.ts cases
 * node src/bench-scale.main.ts measure --case <id> --base <commit> --out <folder> [--rounds <count>]
 * node src/bench-scale.main.ts gate --records <folder> [--limit <ratio>] [--noise-cap <log ratio>]
 * ```
 *
 * - `cases` prints the matrix of the bench jobs as JSON: one entry for each case, with its index.
 * - `measure` makes a git worktree of the base commit and installs it. Then it times one case with `freshArms` of
 *   `@mark1russell7/rigor-bench`. Each round starts one fresh child for the base, the head and a second base child.
 *   The two base children are the A/A pair. The command also operates the case once in this process on each commit, and compares the hashes of the two values.
 *   It writes the record `bench.json` into the folder `--out`.
 * - `gate` reads each record in the folder `--records` and its subfolders. It gives the verdict of the claim "the head takes at
 *   most `--limit` times the time of the base" for each case, and writes a summary into `GITHUB_STEP_SUMMARY`. The exit code is 1
 *   when the gate does not pass or when a case has no record. The summary names each case whose value the head changes.
 */
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { gateLine, jobModels, writeGateLine } from "@mark1russell7/rigor-bench";
import { checkoutArm, freshArms, repoCommit, type CaseArm } from "@mark1russell7/rigor-bench/fresh";
import { errorMessage } from "@mark1russell7/text";
import {
  AA_ARM,
  BASE_ARM,
  BENCH_FORMAT,
  BENCH_LIMIT,
  BENCH_RECORD,
  HEAD_ARM,
  benchCases,
  benchGate,
  benchSummaryOf,
  readBenchRecords,
  resultHash,
  type BenchApi,
  type BenchRecord,
} from "./bench-scale.ts";
import { readCompositions, readLaws } from "./jobs.ts";

/** This folder is the root of the repository of this command. */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** This file is the child of each arm. */
const CHILD = fileURLToPath(new URL("./bench-scale.child.ts", import.meta.url));

/** This folder holds the files of the package capacity. Each arm reads its laws and its compositions. */
const CAPACITY = fileURLToPath(new URL("../../capacity/", import.meta.url));

const USAGE = [
  "node src/bench-scale.main.ts cases",
  "node src/bench-scale.main.ts measure --case <id> --base <commit> --out <folder> [--rounds <count>]",
  "node src/bench-scale.main.ts gate --records <folder> [--limit <ratio>] [--noise-cap <log ratio>]",
].join("\n");

const catalogOf = () => ({ laws: readLaws(join(CAPACITY, "laws")), compositions: readCompositions(join(CAPACITY, "compositions")) });

/** This function imports the package capacity of the checkout at `root`. */
const apiAt = async (root: string): Promise<BenchApi> => (await import(pathToFileURL(join(root, "packages", "capacity", "src", "index.ts")).href)) as BenchApi;

const positive = (text: string | undefined, name: string): number | undefined => {
  if (text === undefined) return undefined;
  const value = Number(text);
  if (!(Number.isFinite(value) && value > 0)) throw new Error(`The value of ${name}, "${text}", is not a number above 0.`);
  return value;
};

const cases = (): void => {
  const matrix = benchCases(catalogOf()).map((each, index) => ({ case: each.id, index }));
  process.stdout.write(`${JSON.stringify(matrix)}\n`);
};

const measure = async (args: readonly string[]): Promise<void> => {
  const { values } = parseArgs({ args: [...args], options: { case: { type: "string" }, base: { type: "string" }, out: { type: "string" }, rounds: { type: "string" } } });
  if (values.case === undefined || values.base === undefined || values.out === undefined) throw new Error(`The command needs --case, --base and --out.\n${USAGE}`);
  const rounds = positive(values.rounds, "--rounds");
  const found = benchCases(catalogOf()).find((each) => each.id === values.case);
  if (found === undefined) throw new Error(`The bench has no case "${values.case}".`);
  const head = await repoCommit("HEAD", { repo: ROOT });
  const scratch = mkdtempSync(join(tmpdir(), "bench-scale-"));
  const command = ["node", CHILD];
  const base = await checkoutArm({ id: BASE_ARM, commit: values.base, dir: join(scratch, "base"), command, setup: [["pnpm", "install", "--frozen-lockfile"]], repo: ROOT });
  try {
    const same = resultHash(found.run(await apiAt(base.cwd))) === resultHash(found.run(await apiAt(ROOT)));
    const arms: CaseArm[] = [
      { id: BASE_ARM, case: found.id, command, cwd: base.cwd },
      { id: AA_ARM, case: found.id, command, cwd: base.cwd },
      { id: HEAD_ARM, case: found.id, command, cwd: ROOT },
    ];
    const run = await freshArms({
      arms,
      aa: [BASE_ARM, AA_ARM],
      ...(rounds === undefined ? {} : { rounds }),
      warmUp: 1,
      job: found.id,
      onProcess: (each) => process.stdout.write(`round ${each.round}, ${each.arm}: ${each.ms.toFixed(2)} ms\n`),
    });
    for (const warning of run.warnings) process.stdout.write(`${warning}\n`);
    const record: BenchRecord = {
      format: BENCH_FORMAT,
      case: found.id,
      commits: { base: base.commit, head },
      env: run.env,
      rounds: run.rounds,
      processes: run.processes,
      aa: run.aa,
      same,
    };
    mkdirSync(values.out, { recursive: true });
    writeFileSync(join(values.out, BENCH_RECORD), `${JSON.stringify(record, null, 1)}\n`);
    process.stdout.write(`The case ${found.id} has ${run.processes.length} children on ${run.env.cpu}. The base and the head give ${same ? "the same value" : "different values"}.\n`);
  } finally {
    await base.remove();
    rmSync(scratch, { recursive: true, force: true });
  }
};

const gate = (args: readonly string[]): void => {
  const { values } = parseArgs({ args: [...args], options: { records: { type: "string" }, limit: { type: "string" }, "noise-cap": { type: "string" } } });
  if (values.records === undefined) throw new Error(`The command needs --records.\n${USAGE}`);
  const limit = positive(values.limit, "--limit") ?? BENCH_LIMIT;
  const noiseCap = positive(values["noise-cap"], "--noise-cap");
  const records = readBenchRecords(values.records);
  const ids = benchCases(catalogOf()).map((each) => each.id);
  const result = benchGate(records, ids, { limit, ...(noiseCap === undefined ? {} : { noiseCap }) });
  const lines = [benchSummaryOf(result.read, result.commits)];
  if (result.missing.length > 0) lines.push(`These cases have no record, so the gate has no read of them: ${result.missing.join(", ")}.\n`);
  if (result.changed.length > 0) lines.push(`The head changes the value of these cases, so their times compare different results: ${result.changed.join(", ")}.\n`);
  const text = lines.join("\n");
  process.stdout.write(text);
  const summary = process.env["GITHUB_STEP_SUMMARY"];
  if (summary) appendFileSync(summary, text);
  const line = gateLine(result.read.verdict.cases, {
    title: "The bench of the scale query",
    enforced: true,
    models: jobModels(records.map((each) => ({ cpu: each.env.cpu }))),
  });
  writeGateLine(line, { summary: undefined });
  if (result.read.gate.outcome !== "pass" || result.missing.length > 0) process.exitCode = 1;
};

const main = async (): Promise<void> => {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "cases") return cases();
  if (command === "measure") return measure(rest);
  if (command === "gate") return gate(rest);
  throw new Error(`The command "${command ?? ""}" is not a command of the bench.\n${USAGE}`);
};

try {
  await main();
} catch (error: unknown) {
  process.stderr.write(`${errorMessage(error)}\n`);
  process.exitCode = 1;
}
