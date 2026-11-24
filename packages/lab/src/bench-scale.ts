import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type * as Capacity from "@mark1russell7/capacity";
import type { Composition, Demand, KneeRule, Law, ScaleModel, ScaleOptions } from "@mark1russell7/capacity";
import { aaLimits, aaStats, gateOf, limitVerdict, pooledLimitVerdict, type Gate, type LimitVerdict, type PairedTime, type RunLimit } from "@mark1russell7/rigor-bench";
import { armTimes, type ArmProcess, type BenchEnv } from "@mark1russell7/rigor-bench/fresh";
import { canonicalJson, sha256Hex } from "@mark1russell7/rigor-generators";
import { escapeMarkdown } from "@mark1russell7/text";

/** This text is the format of the record of a bench of the scale query. */
export const BENCH_FORMAT = "capacity-bench-scale/1";

/** This id is the id of the arm of the base commit. The A/A pair is this arm and the arm `main-aa`, on the same checkout. */
export const BASE_ARM = "main";

/** This id is the second arm of the A/A pair: the same child on the checkout of the base commit. */
export const AA_ARM = "main-aa";

/** This id is the id of the arm of the commit under test. */
export const HEAD_ARM = "head";

/** This rate is the load of each case, in requests per second. It is in the measured range of the laws, 100 to 8000. */
export const BENCH_RATE = 4000;

/** These options are the options of each scale query of the bench. A slider move of the site sends one such query. */
export const BENCH_OPTIONS: ScaleOptions = { steps: 16, most: 64 };

/** This ratio is the largest time of the head over the time of the base that the gate permits for each case. */
export const BENCH_LIMIT = 1.1;

/**
 * The functions of the package capacity that the bench times. The arm of the base imports them from its own checkout. A base
 * before CAP-77 has no `scaleLadder`.
 */
export type BenchApi = Pick<typeof Capacity, "scaleRule" | "countReach" | "lawKnee" | "scaleDemand"> & Partial<Pick<typeof Capacity, "scaleLadder">>;

/** These factors of the demand are the moves of the slider case. */
export const SLIDER_FACTORS: readonly number[] = [0.25, 0.5, 2, 4];

/** This range of the demand holds each move of the slider case. */
const SLIDER_RANGE = { low: 0.25, high: 4 };

/** The laws and the compositions of a bench. Both arms read the same files. */
export interface BenchCatalog {
  readonly laws: readonly Law[];
  readonly compositions: readonly Composition[];
}

/** A bench case: its id and the work of one call. The work gives a value that the bench hashes. */
export interface BenchCase {
  readonly id: string;
  readonly run: (api: BenchApi) => unknown;
}

/** These knee rules are the rules of the knee case. Each law gets each rule. */
const KNEE_RULES: readonly KneeRule[] = [
  { kind: "rise", share: 0.5 },
  { kind: "slope", factor: 2 },
  { kind: "floor", share: 0.5 },
];

/** This function gives a demand of one class of requests at a rate, with no levels. */
export const demandAt = (rate: number): Demand => ({ classes: [{ id: "request", rate: { value: rate, unit: "{request}/s" }, request: {} }], levels: {} });

/** This function gives a scale model with one limit: the processors of an instance of 2 cores, with a headroom of 0.3. */
export const cpuModel = (composition: Composition, catalog: BenchCatalog): ScaleModel => ({
  instance: { resources: { cpu: { value: 2, unit: "{core}" } } },
  limits: [{ id: "cpu", measure: composition.measure.id, ceiling: { kind: "resource", resource: "cpu" }, headroom: 0.3 }],
  compositions: [composition],
  catalog: { laws: catalog.laws, compositions: catalog.compositions },
});

/** This function gives the value of a result, or throws an `Error` with the problem. A bench times no failed query. */
const valueOf = <T>(id: string, result: { readonly tag: "ok"; readonly value: T } | { readonly tag: "err"; readonly error: unknown }): T => {
  if (result.tag === "err") throw new Error(`The case ${id} has a problem: ${JSON.stringify(result.error)}`);
  return result.value;
};

/**
 * This function gives the scale rule at each move of the slider case. With a ladder, the work is one search and then
 * arithmetic for each move. A base with no ladder sends one query of the scale rule for each move. This branch ends
 * when the base of each bench has `scaleLadder`: the PR of CAP-74 removes it.
 */
const sliderOf = (id: string, api: BenchApi, model: ScaleModel, demand: Demand): unknown => {
  if (api.scaleLadder === undefined) {
    return SLIDER_FACTORS.map((factor) => valueOf(id, api.scaleRule(model, valueOf(id, api.scaleDemand(demand, factor)), BENCH_OPTIONS)));
  }
  const ladder = valueOf(id, api.scaleLadder(model, demand, SLIDER_RANGE, BENCH_OPTIONS));
  return SLIDER_FACTORS.map((factor) => valueOf(id, ladder.ruleAt(factor)));
};

/**
 * This function gives the cases of the bench. Each composition of the processor time gives a scale case, a reach case and a slider case. The
 * case `knee` gives the knee of each law by each rule. The order of the cases is the order of the compositions.
 */
export const benchCases = (catalog: BenchCatalog): readonly BenchCase[] => {
  const cpus = catalog.compositions.filter((composition) => composition.measure.id === "cpu");
  const demand = demandAt(BENCH_RATE);
  const scales = cpus.flatMap((composition): BenchCase[] => {
    const model = cpuModel(composition, catalog);
    const scaleId = `scale:${composition.id}`;
    const reachId = `reach:${composition.id}`;
    return [
      { id: scaleId, run: (api) => valueOf(scaleId, api.scaleRule(model, demand, BENCH_OPTIONS)) },
      { id: reachId, run: (api) => valueOf(reachId, api.countReach(model, 3, demand, BENCH_OPTIONS)) },
      { id: `slider:${composition.id}`, run: (api) => sliderOf(`slider:${composition.id}`, api, model, demand) },
    ];
  });
  const knee: BenchCase = {
    id: "knee",
    run: (api) => catalog.laws.flatMap((law) => KNEE_RULES.map((rule) => api.lawKnee(law, law.variables[0]?.id ?? "", rule))),
  };
  return [...scales, knee];
};

/**
 * This number is the count of significant digits of each number that the hash of a result reads. A faster path can add
 * the same terms in a different order and change the last bit of a float. That is the same result.
 */
export const RESULT_DIGITS = 12;

/** This function gives a copy of a value with each finite number rounded to `RESULT_DIGITS` significant digits. */
const roundedOf = (value: unknown): unknown => {
  if (typeof value === "number") return Number.isFinite(value) ? Number(value.toPrecision(RESULT_DIGITS)) : value;
  if (Array.isArray(value)) return value.map(roundedOf);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, each]) => [key, roundedOf(each)]));
  return value;
};

/**
 * This function gives the hash of the value of one call: the SHA-256 of its canonical JSON, with each number rounded to
 * `RESULT_DIGITS` significant digits. Infinite numbers become null.
 */
export const resultHash = (value: unknown): string => sha256Hex(canonicalJson(roundedOf(value), { form: "json" }));

/**
 * This function gives the paired times of the base and the head from the processes of a run of arms. Each round of each
 * case gives one record. The arm that started first in the round is the field `first`. A round without the two arms gives no record.
 */
export const pairedTimes = (processes: readonly ArmProcess[], base: string = BASE_ARM, head: string = HEAD_ARM): PairedTime[] => {
  const byRound = new Map<string, { a?: ArmProcess; b?: ArmProcess }>();
  for (const each of processes) {
    if (each.arm !== base && each.arm !== head) continue;
    const key = JSON.stringify([each.case, each.round]);
    const pair = byRound.get(key) ?? {};
    byRound.set(key, each.arm === base ? { ...pair, a: each } : { ...pair, b: each });
  }
  return [...byRound.values()].flatMap(({ a, b }) =>
    a === undefined || b === undefined ? [] : [{ case: a.case, round: a.round, first: a.position < b.position ? ("a" as const) : ("b" as const), a: a.ms, b: b.ms }],
  );
};

/**
 * The read of one case: the median time of each arm, the ratio of the head with its interval, its bound and its outcome. It
 * also tells if the results are equal.
 */
export interface BenchCaseRead {
  readonly case: string;
  readonly baseMs: number;
  readonly headMs: number;
  readonly ratio: number;
  readonly low: number;
  readonly high: number;
  /** This number is the noise of the A/A rounds of the case, on a log scale. */
  readonly noise: number;
  /** This number is the high end of the interval, widened by the A/A noise. The case is `within` when it is at most the limit. */
  readonly bound: number;
  readonly outcome: LimitVerdict["outcome"];
  /** This number is the count of the tries of the case. The read of a case with more than one try pools their rounds. */
  readonly tries: number;
  /** These labels name the tries whose own outcome is the opposite of the pooled outcome. Each one makes the case `cannot decide`. */
  readonly opposed: readonly string[];
  /** This flag tells that the base and the head give the same value. It is undefined when the bench did not compare them. */
  readonly same: boolean | undefined;
}

/** The read of a bench: the limit, the gate and the read of each case. */
export interface BenchRead {
  /** This ratio is the largest time of the head over the time of the base that the gate permits for each case. */
  readonly limit: number;
  readonly gate: Gate;
  readonly cases: readonly BenchCaseRead[];
}

/** One try of a bench: the children of its arms and its A/A rounds, for one case or more. */
export interface BenchTry {
  readonly processes: readonly ArmProcess[];
  readonly aa: readonly PairedTime[];
}

/** The options of the read of a bench. */
export interface BenchReadOptions {
  /** The largest ratio of the head over the base. The default is `BENCH_LIMIT`. */
  readonly limit?: number;
  /** The noise cap of `limitVerdict` of `@mark1russell7/rigor-bench`. A case with a noisier A/A arm cannot decide. */
  readonly noiseCap?: number;
  /** This map tells, for each case, if the base and the head give the same value. */
  readonly same?: ReadonlyMap<string, boolean>;
}

/**
 * This function gives the read of a bench. The claim of each case is "the head takes at most `limit` times the time of the
 * base". The A/A rounds of each case give its noise. The gate passes only when each case is `within`.
 */
export const benchRead = (processes: readonly ArmProcess[], aa: readonly PairedTime[], options: BenchReadOptions = {}): BenchRead =>
  benchReadOfTries([{ processes, aa }], options);

/** This function gives the round after the last round of the records. The next try of a pool starts at this round. */
const nextRound = (records: readonly PairedTime[]): number => records.reduce((most, each) => Math.max(most, each.round + 1), 0);

/**
 * This function gives the read of the tries of a bench. A case with one try has the limit verdict of its rounds. A case with
 * more tries has the pooled limit verdict of `@mark1russell7/rigor-bench`: the merged rounds of all its tries decide. A try
 * whose own outcome is the opposite of the pooled outcome makes the case `cannot decide`. Thus a noisy try cannot pass.
 */
export const benchReadOfTries = (tries: readonly BenchTry[], options: BenchReadOptions = {}): BenchRead => {
  const limit = options.limit ?? BENCH_LIMIT;
  const verdictOptions = { limit, aaFrom: "rounds" as const, ...(options.noiseCap === undefined ? {} : { noiseCap: options.noiseCap }) };
  const processes = tries.flatMap((each) => each.processes);
  const ids = [...new Set(processes.map((each) => each.case))];
  const times = ids.flatMap((id) => armTimes(processes.filter((each) => each.case === id)));
  const timeOfArm = (arm: string, id: string): number => times.find((each) => each.arm === arm && each.case === id)?.median ?? Number.NaN;
  const cases = ids.flatMap((id): BenchCaseRead[] => {
    const own = tries
      .filter((each) => each.processes.some((child) => child.case === id))
      .map((each) => ({ candidate: pairedTimes(each.processes.filter((child) => child.case === id)), aa: each.aa.filter((record) => record.case === id) }));
    let read: { verdict: LimitVerdict; outcome: LimitVerdict["outcome"]; opposed: readonly string[] };
    const [only] = own;
    if (only !== undefined && own.length === 1) {
      const verdict = limitVerdict(only.candidate, only.aa, verdictOptions);
      read = { verdict, outcome: verdict.cases[0]?.outcome ?? "cannot decide", opposed: [] };
    } else {
      // Each try gets its own label and its own rounds, so that the pool has one record of each round of each case.
      let start = 0;
      const jobs = own.map((each, index) => {
        const job = `try ${index + 1}`;
        const tag = (records: readonly PairedTime[]): PairedTime[] => records.map((record) => ({ ...record, job, round: record.round + start }));
        const tagged = { job, candidate: tag(each.candidate), aa: tag(each.aa) };
        start += Math.max(nextRound(each.candidate), nextRound(each.aa));
        return tagged;
      });
      const pooled = pooledLimitVerdict(jobs, verdictOptions);
      read = { verdict: pooled.pooled, outcome: pooled.outcome, opposed: pooled.opposed };
    }
    const each = read.verdict.cases[0];
    if (each === undefined) return [];
    return [
      {
        case: id,
        baseMs: timeOfArm(BASE_ARM, id),
        headMs: timeOfArm(HEAD_ARM, id),
        ratio: each.ratio,
        low: each.low,
        high: each.high,
        noise: each.noise,
        bound: each.bound,
        outcome: read.outcome,
        tries: own.length,
        opposed: read.opposed,
        same: options.same?.get(id),
      },
    ];
  });
  const gate = gateOf(cases.map((each) => ({ case: each.case, outcome: each.outcome })));
  return { limit, gate, cases };
};

const fixed = (value: number, digits: number): string => (Number.isFinite(value) ? value.toFixed(digits) : "none");

/** This function gives the summary of a bench in Markdown: one row for each case, then the gate and its reason. */
export const benchSummaryOf = (read: BenchRead, commits: { readonly base: string; readonly head: string }): string => {
  const rows = read.cases.map((each) => {
    const same = each.same === undefined ? "not compared" : each.same ? "yes" : "**no**";
    return `| ${escapeMarkdown(each.case)} | ${fixed(each.baseMs, 1)} | ${fixed(each.headMs, 1)} | ${fixed(each.ratio, 3)} | ${fixed(each.low, 3)} to ${fixed(each.high, 3)} | ${fixed(each.noise, 3)} | ${fixed(each.bound, 3)} | ${each.outcome} | ${each.tries} | ${same} |`;
  });
  return [
    `## The bench of the scale query`,
    ``,
    `The base is \`${commits.base.slice(0, 12)}\` and the head is \`${commits.head.slice(0, 12)}\`. The limit of each case is ${read.limit} times the time of the base. The bound is the high end of the interval times the A/A noise of the case, as a ratio. A case is within the limit only when its bound is at most the limit. A case with more than one try pools the rounds of its tries, and a try with the opposite outcome makes it cannot decide.`,
    ``,
    `| Case | Base (ms) | Head (ms) | Head / base | Interval | A/A noise | Bound | Outcome | Tries | Same result |`,
    `| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`,
    ...rows,
    ``,
    `The gate gives **${read.gate.outcome}**: ${read.gate.reason}`,
    ``,
  ].join("\n");
};

/** This name is the name of the file of the record of one bench job, in the folder of its records. */
export const BENCH_RECORD = "bench.json";

/** The record of one bench job: one case, timed on one runner, with the base, the head and the A/A pair. */
export interface BenchRecord {
  readonly format: typeof BENCH_FORMAT;
  readonly case: string;
  /** The full hashes of the commits of the base and of the head. */
  readonly commits: { readonly base: string; readonly head: string };
  readonly env: BenchEnv;
  readonly rounds: number;
  /** The record of each child of the arms, in the order of the starts. */
  readonly processes: readonly ArmProcess[];
  /** The A/A record of each round. */
  readonly aa: readonly PairedTime[];
  /** This flag tells that the base and the head give the same value for the case. */
  readonly same: boolean;
  /** The hashes of the values of the case on the base and on the head, from `resultHash`. */
  readonly hashes: { readonly base: string; readonly head: string };
}

/**
 * This function gives each bench record of a folder: each file `bench.json` in the folder or in a subfolder, in the order
 * of their paths. It throws an `Error` for a file of another format.
 */
export const readBenchRecords = (folder: string): readonly BenchRecord[] =>
  readdirSync(folder, { recursive: true, encoding: "utf8" })
    .filter((name) => basename(name) === BENCH_RECORD)
    .sort()
    .map((name) => {
      const file = join(folder, name);
      const record = JSON.parse(readFileSync(file, "utf8")) as BenchRecord;
      if (record.format !== BENCH_FORMAT) throw new Error(`The file ${file} is not a bench record of the format "${BENCH_FORMAT}".`);
      return record;
    });

/** This text is the format of the file of the changes of value that the head makes on purpose. */
export const BENCH_CHANGES_FORMAT = "capacity-bench-changes/1";

/** This name is the name of the file of the changes of value, in the folder of the package lab. */
export const BENCH_CHANGES = "bench-changes.json";

/**
 * A change of value is a case whose value the head changes on purpose, with its reason. The hashes of the value on the base
 * and on the head pin the change. When the base has the change, the two values are equal, and the change has no use.
 */
export interface BenchChange {
  readonly case: string;
  readonly base: string;
  readonly head: string;
  readonly reason: string;
}

/** The file of the changes of value. */
export interface BenchChanges {
  readonly format: typeof BENCH_CHANGES_FORMAT;
  readonly changes: readonly BenchChange[];
}

/** This function gives the changes of value of a file, or no change when the file does not exist. It throws an `Error` for a file of another format. */
export const readBenchChanges = (file: string): readonly BenchChange[] => {
  if (!existsSync(file)) return [];
  const found = JSON.parse(readFileSync(file, "utf8")) as Partial<BenchChanges>;
  if (found.format !== BENCH_CHANGES_FORMAT || !Array.isArray(found.changes)) {
    throw new Error(`The file ${file} is not a file of changes of the format "${BENCH_CHANGES_FORMAT}".`);
  }
  return found.changes;
};

/** A case that the head changes on purpose: the median time of each arm and the reason of the change. */
export interface BenchIntended {
  readonly case: string;
  readonly baseMs: number;
  readonly headMs: number;
  readonly reason: string;
}

/** The options of a gate: the options of the read, and the changes of value that the head makes on purpose. */
export interface BenchGateOptions extends Omit<BenchReadOptions, "same"> {
  readonly changes?: readonly BenchChange[];
}

/** The gate of the bench records of a run: the read of the cases, the cases with no record and the commits. */
export interface BenchGate {
  readonly read: BenchRead;
  /** The cases of the bench that have no record. A case with no record is no read, so the gate cannot pass. */
  readonly missing: readonly string[];
  /** The cases whose base and head give different values. */
  readonly changed: readonly string[];
  /** The changed cases that a change of value names with their two hashes. The gate does not compare their times with the base. */
  readonly intended: readonly BenchIntended[];
  /** The changed cases that no change of value names. A change of value with no reason stops the gate. */
  readonly unexplained: readonly string[];
  /** The cases of the changes of value that name no changed case with their two hashes. Remove these changes. */
  readonly unused: readonly string[];
  readonly commits: { readonly base: string; readonly head: string };
}

/**
 * This function gives the gate of the bench records of a run. The `cases` are the ids of the cases of the bench. A changed case
 * that a change of value names is not timed against the base, because its times compare different work. A case can have a
 * record of each try. Its read pools the tries, and it is the same only when each try gives the same value. It throws an
 * `Error` when the records have more than one base or head, or no record.
 */
export const benchGate = (records: readonly BenchRecord[], cases: readonly string[], options: BenchGateOptions = {}): BenchGate => {
  const first = records[0];
  if (first === undefined) throw new Error("The run has no bench record. A gate with no read is not a pass.");
  const other = records.find((each) => each.commits.base !== first.commits.base || each.commits.head !== first.commits.head);
  if (other !== undefined) throw new Error(`The records have two pairs of commits: ${JSON.stringify(first.commits)} and ${JSON.stringify(other.commits)}.`);
  const { changes = [], ...readOptions } = options;
  const changeOf = (record: BenchRecord): BenchChange | undefined =>
    changes.find((each) => each.case === record.case && each.base === record.hashes.base && each.head === record.hashes.head);
  // One record of each changed case: a case with more tries is one case of the gate.
  const changed = records.filter((each, index) => !each.same && records.findIndex((other) => other.case === each.case && !other.same) === index);
  const intended = changed.filter((each) => changeOf(each) !== undefined);
  const skipped = new Set(intended.map((each) => each.case));
  const timed = records.filter((each) => !skipped.has(each.case));
  const same = new Map<string, boolean>();
  for (const each of records) same.set(each.case, (same.get(each.case) ?? true) && each.same);
  const read = benchReadOfTries(
    timed.map((each) => ({ processes: each.processes, aa: each.aa })),
    { ...readOptions, same },
  );
  const used = new Set(intended.map((each) => changeOf(each)));
  return {
    read,
    missing: cases.filter((id) => !same.has(id)),
    changed: changed.map((each) => each.case),
    intended: intended.map((each) => {
      const times = armTimes(each.processes);
      const timeOfArm = (arm: string): number => times.find((time) => time.arm === arm)?.median ?? Number.NaN;
      return { case: each.case, baseMs: timeOfArm(BASE_ARM), headMs: timeOfArm(HEAD_ARM), reason: (changeOf(each) as BenchChange).reason };
    }),
    unexplained: changed.filter((each) => changeOf(each) === undefined).map((each) => each.case),
    unused: changes.filter((each) => !used.has(each)).map((each) => each.case),
    commits: first.commits,
  };
};

/** This count is the count of the fresh jobs that measure each case of the second try. The read pools them with the first try. */
export const BENCH_AGAIN_TRIES = 2;

/** One job of the second try: the case, the index of the job and the number of its try. */
export interface BenchAgainJob {
  readonly case: string;
  readonly index: number;
  readonly try: number;
}

/**
 * This function gives the jobs of the second try: `tries` fresh jobs for each case of `again`, in the order of `ids`. Each job
 * has its own index, so each job has its own artifact.
 */
export const benchAgainJobs = (ids: readonly string[], again: readonly string[], tries: number = BENCH_AGAIN_TRIES): readonly BenchAgainJob[] => {
  if (!Number.isInteger(tries) || tries < 1) throw new RangeError(`The count of the tries must be a positive integer, not ${tries}.`);
  const chosen = ids.filter((id) => again.includes(id));
  return chosen.flatMap((id, position) => Array.from({ length: tries }, (_, index) => ({ case: id, index: position * tries + index, try: index + 2 })));
};

/**
 * This function gives the cases of a gate that a fresh job measures again: each case that cannot decide, and each case
 * with no record. It gives no case when the gate passes, when a case is beyond the limit, or when a change of value has no
 * reason. A new job cannot change those verdicts.
 */
export const benchAgainOf = (gate: BenchGate): readonly string[] => {
  if (gate.read.gate.outcome === "pass" && gate.missing.length === 0) return [];
  if (gate.unexplained.length > 0 || gate.read.cases.some((each) => each.outcome === "beyond")) return [];
  return [...gate.read.cases.filter((each) => each.outcome === "cannot decide").map((each) => each.case), ...gate.missing];
};

/** This function gives the notes of a gate after its table: the changes of value, and the cases with no record. */
export const benchNotesOf = (gate: BenchGate): string => {
  const lines: string[] = [];
  if (gate.intended.length > 0) {
    lines.push(
      "The head changes the value of these cases on purpose. Their times compare different work, so the gate does not compare them with the base.",
      "",
      "| Case | Base (ms) | Head (ms) | Reason |",
      "| --- | --- | --- | --- |",
      ...gate.intended.map((each) => `| ${escapeMarkdown(each.case)} | ${fixed(each.baseMs, 1)} | ${fixed(each.headMs, 1)} | ${escapeMarkdown(each.reason)} |`),
      "",
    );
  }
  if (gate.unexplained.length > 0) {
    lines.push(`The head changes the value of these cases, and \`${BENCH_CHANGES}\` gives no reason with their two hashes. The gate stops: ${gate.unexplained.join(", ")}.`, "");
  }
  if (gate.unused.length > 0) lines.push(`These changes of \`${BENCH_CHANGES}\` name no changed case with their two hashes. Remove them: ${gate.unused.join(", ")}.`, "");
  if (gate.missing.length > 0) lines.push(`These cases have no record, so the gate has no read of them: ${gate.missing.join(", ")}.`, "");
  return lines.join("\n");
};

/** This text is the format of the file of the limits of the bench gate. */
export const BENCH_LIMITS_FORMAT = "capacity-bench-limits/1";

/** This name is the name of the file of the limits of the bench gate, in the folder of the package lab. */
export const BENCH_LIMITS = "bench-limits.json";

/** This number is the fewest CI runs that give the limits of the gate. */
export const BENCH_LIMIT_RUNS = 5;

/**
 * The limits of the bench gate, from the A/A pairs of earlier CI runs. The noise cap is the worst A/A spread of a job
 * plus the spread of those values, on a log scale. A job whose spread is an outlier goes out.
 */
export interface BenchLimits {
  readonly format: typeof BENCH_LIMITS_FORMAT;
  /** The ids of the CI runs of the records. */
  readonly runs: readonly string[];
  /** The count of the bench jobs of the runs. Each job is one case on one runner. */
  readonly jobs: number;
  readonly noiseCap: RunLimit;
  /** The jobs that went out of the limits, each as `<run>/<case>`. */
  readonly dropped: readonly string[];
}

/**
 * This function gives the limits of the bench gate from the bench records of each CI run, with `aaLimits` of
 * `@mark1russell7/rigor-bench`. It throws an `Error` for fewer than `BENCH_LIMIT_RUNS` runs.
 */
export const benchLimitsOf = (runs: ReadonlyMap<string, readonly BenchRecord[]>): BenchLimits => {
  const ids = [...runs.keys()].filter((run) => (runs.get(run) ?? []).length > 0).sort();
  if (ids.length < BENCH_LIMIT_RUNS) {
    throw new Error(`The limits need the records of ${BENCH_LIMIT_RUNS} or more CI runs, and ${ids.length} runs have records.`);
  }
  const jobs = ids.flatMap((run) => (runs.get(run) ?? []).map((record) => ({ job: `${run}/${record.case}`, cases: aaStats(record.aa) })));
  const limits = aaLimits(jobs);
  return {
    format: BENCH_LIMITS_FORMAT,
    runs: ids,
    jobs: jobs.length,
    noiseCap: limits.fallback.noiseCap,
    dropped: limits.fallback.dropped.map((each) => each.job),
  };
};

/** This function gives the limits of a file, or undefined when the file does not exist. It throws an `Error` for a file of another format. */
export const readBenchLimits = (file: string): BenchLimits | undefined => {
  if (!existsSync(file)) return undefined;
  const found = JSON.parse(readFileSync(file, "utf8")) as Partial<BenchLimits>;
  if (found.format !== BENCH_LIMITS_FORMAT || typeof found.noiseCap?.limit !== "number") {
    throw new Error(`The file ${file} is not a file of limits of the format "${BENCH_LIMITS_FORMAT}".`);
  }
  return found as BenchLimits;
};
