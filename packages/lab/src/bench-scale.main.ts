/**
 * The command of the bench of the scale query. The workflow `lab.yml` starts it. Only CI times a bench.
 *
 * ```text
 * node src/bench-scale.main.ts cases
 * node src/bench-scale.main.ts measure --case <id> --base <commit> --out <folder> [--slot <n>] [--try <n>] [--rounds <count>]
 * node src/bench-scale.main.ts gate --records <folder> [--limit <ratio>] [--noise-cap <log ratio>] [--changes <file>]
 *   [--again-out <file>] [--again <folder>] [--latest]
 * node src/bench-scale.main.ts limits --runs <folder> [--out <file>]
 * ```
 *
 * - `cases` prints the matrix of the bench jobs as JSON: `BENCH_SLOTS` entries for each case, each with its slot and its index.
 * - `measure` makes a git worktree of the base commit and installs it. Then it times one case with `freshArms` of
 *   `@mark1russell7/rigor-bench`. Each round starts one fresh child for the base, the head and a second base child.
 *   The two base children are the A/A pair. The command also operates the case once in this process on each commit, and compares the hashes of the two values.
 *   It writes the record `bench.json` into the folder `--out`, with the slot and the try of the job. The default rounds are `BENCH_ROUNDS`.
 * - `gate` reads each record in the folder `--records` and its subfolders. It gives the verdict of the claim "the head is not
 *   slower than the A/A arm by more than `--limit` times" for each case with `benchRead`, and writes a summary into
 *   `GITHUB_STEP_SUMMARY`. The exit code is 1 when the gate does not pass or when a case has no record. The summary names
 *   each case whose value the head changes.
 * - The file `--changes` gives the changes of value that the head makes on purpose. The default is `packages/lab/bench-changes.json`.
 *   The gate does not time such a case against the base. A change of value that the file does not name gives the exit code 1.
 * - With `--again-out`, a gate with no read of some cases does not decide. It writes the matrix `again` of `benchAgainOf` into the
 *   file of the outputs of the job. Its fresh jobs take each slot of these cases to their next look.
 *   A case beyond the limit is not measured again.
 * - With `--again`, the gate adds the records of that folder to the rounds of their slots.
 * - With `--latest`, the gate reads only the latest try of each artifact folder `<name>-<attempt>` (`latestAttempts`).
 *   This gate decides.
 * - The noise cap of the gate comes from `packages/lab/bench-limits.json`. The option `--noise-cap` replaces it.
 * - `limits` reads the records of each subfolder of `--runs`. Each subfolder holds the records of one CI run, from
 *   `gh run download <run> -p "bench-*"`. The command writes the limits of 5 or more runs into the file `--out`.
 */
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
  BENCH_CHANGES,
  BENCH_LIMIT,
  BENCH_LIMITS,
  BENCH_RECORD,
  BENCH_ROUNDS,
  BENCH_SLOTS,
  HEAD_ARM,
  benchCases,
  benchAgainOf,
  benchGate,
  benchLimitsOf,
  benchNotesOf,
  benchSummaryOf,
  readBenchChanges,
  readBenchLimits,
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
  "node src/bench-scale.main.ts measure --case <id> --base <commit> --out <folder> [--slot <n>] [--try <n>] [--rounds <count>]",
  "node src/bench-scale.main.ts gate --records <folder> [--limit <ratio>] [--noise-cap <log ratio>] [--changes <file>] [--again-out <file>] [--again <folder>] [--latest]",
  "node src/bench-scale.main.ts limits --runs <folder> [--out <file>]",
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
  const matrix = benchCases(catalogOf()).flatMap((each, position) =>
    Array.from({ length: BENCH_SLOTS }, (_, index) => ({ case: each.id, slot: index + 1, index: position * BENCH_SLOTS + index })),
  );
  process.stdout.write(`${JSON.stringify(matrix)}\n`);
};

const measure = async (args: readonly string[]): Promise<void> => {
  const { values } = parseArgs({ args: [...args], options: { case: { type: "string" }, base: { type: "string" }, out: { type: "string" }, slot: { type: "string" }, try: { type: "string" }, rounds: { type: "string" } } });
  if (values.case === undefined || values.base === undefined || values.out === undefined) throw new Error(`The command needs --case, --base and --out.\n${USAGE}`);
  const rounds = positive(values.rounds, "--rounds") ?? BENCH_ROUNDS;
  const slot = positive(values.slot, "--slot") ?? 1;
  const tried = positive(values.try, "--try") ?? 1;
  if (!Number.isInteger(slot) || slot > BENCH_SLOTS) throw new Error(`The slot ${slot} is not a whole number from 1 to ${BENCH_SLOTS}.`);
  const found = benchCases(catalogOf()).find((each) => each.id === values.case);
  if (found === undefined) throw new Error(`The bench has no case "${values.case}".`);
  const head = await repoCommit("HEAD", { repo: ROOT });
  const scratch = mkdtempSync(join(tmpdir(), "bench-scale-"));
  const command = ["node", CHILD];
  const base = await checkoutArm({ id: BASE_ARM, commit: values.base, dir: join(scratch, "base"), command, setup: [["pnpm", "install", "--frozen-lockfile"]], repo: ROOT });
  try {
    const hashes = { base: resultHash(found.run(await apiAt(base.cwd))), head: resultHash(found.run(await apiAt(ROOT))) };
    const same = hashes.base === hashes.head;
    const arms: CaseArm[] = [
      { id: BASE_ARM, case: found.id, command, cwd: base.cwd },
      { id: AA_ARM, case: found.id, command, cwd: base.cwd },
      { id: HEAD_ARM, case: found.id, command, cwd: ROOT },
    ];
    const run = await freshArms({
      arms,
      aa: [BASE_ARM, AA_ARM],
      rounds,
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
      hashes,
      slot,
      try: tried,
    };
    mkdirSync(values.out, { recursive: true });
    writeFileSync(join(values.out, BENCH_RECORD), `${JSON.stringify(record, null, 1)}\n`);
    process.stdout.write(`The case ${found.id} has ${run.processes.length} children on ${run.env.cpu}. The base and the head give ${same ? "the same value" : "different values"}: ${hashes.base} and ${hashes.head}.\n`);
  } finally {
    await base.remove();
    rmSync(scratch, { recursive: true, force: true });
  }
};

const gate = (args: readonly string[]): void => {
  const { values } = parseArgs({ args: [...args], options: { records: { type: "string" }, limit: { type: "string" }, "noise-cap": { type: "string" }, changes: { type: "string" }, again: { type: "string" }, "again-out": { type: "string" }, latest: { type: "boolean" } } });
  if (values.records === undefined) throw new Error(`The command needs --records.\n${USAGE}`);
  const limit = positive(values.limit, "--limit") ?? BENCH_LIMIT;
  const noiseCap = positive(values["noise-cap"], "--noise-cap") ?? readBenchLimits(join(ROOT, "packages", "lab", BENCH_LIMITS))?.noiseCap.limit;
  const latest = { latest: values.latest === true };
  const first = readBenchRecords(values.records, latest);
  const records = values.again === undefined ? first : [...first, ...readBenchRecords(values.again, latest)];
  const ids = benchCases(catalogOf()).map((each) => each.id);
  const changes = readBenchChanges(values.changes ?? join(ROOT, "packages", "lab", BENCH_CHANGES));
  const result = benchGate(records, ids, { limit, changes, ...(noiseCap === undefined ? {} : { noiseCap }) });
  const againOut = values["again-out"];
  const again = againOut === undefined ? [] : benchAgainOf(result, ids);
  const againCases = [...new Set(again.map((each) => each.case))];
  const againNote = again.length === 0 ? [] : [`The gate has no read of ${againCases.length} cases yet, so ${again.length} fresh jobs take their slots to the next look: ${againCases.join(", ")}.`, ""];
  const text = [benchSummaryOf(result.read, result.commits), benchNotesOf(result), ...againNote].join("\n");
  process.stdout.write(text);
  const summary = process.env["GITHUB_STEP_SUMMARY"];
  if (summary) appendFileSync(summary, text);
  if (againOut !== undefined) {
    appendFileSync(againOut, `again=${JSON.stringify(again)}\n`);
  }
  // The second try decides, so the first try writes no gate line and does not fail.
  if (again.length > 0) return;
  const line = gateLine(result.read.cases, {
    title: "The bench of the scale query",
    enforced: true,
    models: jobModels(records.map((each) => ({ cpu: each.env.cpu }))),
  });
  writeGateLine(line, { summary: undefined });
  if (result.read.gate.outcome !== "pass" || result.missing.length > 0 || result.unexplained.length > 0) process.exitCode = 1;
};

/** The command `limits`: the limits of the gate from the records of earlier CI runs. */
const limits = (args: readonly string[]): void => {
  const { values } = parseArgs({ args: [...args], options: { runs: { type: "string" }, out: { type: "string" } } });
  if (values.runs === undefined) throw new Error(`The command needs --runs.\n${USAGE}`);
  const folder = values.runs;
  const runs = new Map(
    readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => [entry.name, readBenchRecords(join(folder, entry.name))] as const),
  );
  const found = benchLimitsOf(runs);
  const out = values.out ?? join(ROOT, "packages", "lab", BENCH_LIMITS);
  writeFileSync(out, `${JSON.stringify(found, null, 2)}\n`);
  process.stdout.write(
    `The noise cap is ${found.noiseCap.limit}: the worst A/A spread ${found.noiseCap.worst.toFixed(4)} plus the spread ${found.noiseCap.spread.toFixed(4)}, from ${found.jobs} jobs of ${found.runs.length} runs.\n`,
  );
};

const main = async (): Promise<void> => {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "cases") return cases();
  if (command === "measure") return measure(rest);
  if (command === "gate") return gate(rest);
  if (command === "limits") return limits(rest);
  throw new Error(`The command "${command ?? ""}" is not a command of the bench.\n${USAGE}`);
};

try {
  await main();
} catch (error: unknown) {
  process.stderr.write(`${errorMessage(error)}\n`);
  process.exitCode = 1;
}
