import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type * as Capacity from "@mark1russell7/capacity";
import type { Composition, Demand, KneeRule, Law, ScaleModel, ScaleOptions } from "@mark1russell7/capacity";
import {
  aaLimits,
  aaStats,
  gateOf,
  GATE_LOOKS,
  notSlowerVerdict,
  type BudgetMore,
  type Gate,
  type GateJobRead,
  type JobRecords,
  type LimitOutcome,
  type PairedTime,
  type RunLimit,
} from "@mark1russell7/rigor-bench";
import { armTimes, type ArmProcess, type BenchEnv } from "@mark1russell7/rigor-bench/fresh";
import { canonicalJson, sha256Hex } from "@mark1russell7/rigor-generators";
import { escapeMarkdown } from "@mark1russell7/text";
import { recordPaths, type ReadOptions } from "./jobs.ts";

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
 * The functions of the package capacity that the bench times. The arm of the base imports them from its own checkout.
 */
export type BenchApi = Pick<typeof Capacity, "scaleRule" | "countReach" | "lawKnee" | "scaleLadder">;

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

/** This function gives the scale rule at each move of the slider case: one search of the ladder, then arithmetic for each move. */
const sliderOf = (id: string, api: BenchApi, model: ScaleModel, demand: Demand): unknown => {
  const ladder = valueOf(id, api.scaleLadder(model, demand, SLIDER_RANGE, BENCH_OPTIONS));
  return SLIDER_FACTORS.map((factor) => valueOf(id, ladder.ruleAt(factor)));
};

/**
 * This function tells if each law of a composition, and of each composition that it names, reads the rate of a class. The
 * bench gives a demand of requests, thus it reads only these compositions. The laws of alerts read a level of events.
 * The site has the same walk in `lawIdsOf`. This file imports only the types of `@mark1russell7/capacity`. Thus each
 * child of the bench loads only the package of the checkout of its arm.
 */
export const readsRate = (composition: Composition, catalog: BenchCatalog): boolean =>
  composition.terms.every((term) => {
    if ("law" in term) return catalog.laws.find((law) => law.id === term.law)?.variables.some((variable) => variable.id === "rate") === true;
    const nested = catalog.compositions.find((each) => each.id === term.composition);
    return nested !== undefined && readsRate(nested, catalog);
  });

/**
 * This function gives the cases of the bench. Each composition of the processor time over the rate gives a scale case, a reach case and a slider case. The
 * case `knee` gives the knee of each law by each rule. The order of the cases is the order of the compositions.
 */
export const benchCases = (catalog: BenchCatalog): readonly BenchCase[] => {
  const cpus = catalog.compositions.filter((composition) => composition.measure.id === "cpu" && readsRate(composition, catalog));
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

/** This count is the count of the jobs that measure each case in the first try. Each job runs on its own runner, and the gate needs a read in each job. */
export const BENCH_SLOTS = 2;

/** This count is the rounds of each job of the first try: the first look of `notSlowerVerdict` of `@mark1russell7/rigor-bench`. */
export const BENCH_ROUNDS: number = GATE_LOOKS[0] ?? 12;

/**
 * The read of one case: the median time of each arm, the reads of its jobs and the look that decides it.
 * It also has the A/A noise, the outcome, and if the results are equal.
 */
export interface BenchCaseRead {
  readonly case: string;
  readonly baseMs: number;
  readonly headMs: number;
  /** This number is the median time of the head over the median time of the base. The gate does not read it. */
  readonly ratio: number;
  /** These reads are the sign tests of each job of the case. They are at the look that decides the case, or at the last look that a job reached. */
  readonly jobs: readonly GateJobRead[];
  /** This number is the rounds of the look that decides the case. It is undefined when no look decides the case. */
  readonly look: number | undefined;
  /** This number is the largest A/A noise of a job of the case, on a log scale. */
  readonly noise: number;
  /** These numbers are the rounds of the case in each slot, from slot 1 to `BENCH_SLOTS`. */
  readonly slots: readonly number[];
  /** This flag tells that the A/A noise of a job is above the noise cap, so the case cannot decide. More rounds do not lower it. */
  readonly capped: boolean;
  readonly outcome: LimitOutcome;
  /** This text is the reason of the outcome, in one sentence. */
  readonly reason: string;
  /** This flag tells that the base and the head give the same value. It is undefined when the bench did not compare them. */
  readonly same: boolean | undefined;
}

/** The read of a bench: the limit and its margin, the level and the looks of the gate, and the read of each case. */
export interface BenchRead {
  /** This ratio is the largest time of the head over the time of the A/A arm that the gate permits for each case. */
  readonly limit: number;
  readonly margin: number;
  /** This number is the chance of a false pass over all cases and all looks. */
  readonly level: number;
  readonly looks: readonly number[];
  readonly gate: Gate;
  readonly cases: readonly BenchCaseRead[];
  /** These cases have no outcome yet, each with the rounds of its next look. The list is empty when the read is final. */
  readonly more: readonly BudgetMore[];
}

/** One bench job of one case: the slot of the job in its case, its try, the children of its arms and its A/A rounds. */
export interface BenchJob {
  /** This number is the slot of the job in its case, from 1 to `BENCH_SLOTS`. A job of the second try continues the rounds of its slot. */
  readonly slot: number;
  /** This number is the try of the job: 1 for the first try and 2 for the second try. */
  readonly try: number;
  readonly processes: readonly ArmProcess[];
  readonly aa: readonly PairedTime[];
}

/** The options of the read of a bench. */
export interface BenchReadOptions {
  /** The largest ratio of the head over the A/A arm. The default is `BENCH_LIMIT`. */
  readonly limit?: number;
  /** The largest A/A noise of a job, on a log scale. A case with more noise cannot decide. */
  readonly noiseCap?: number;
  /** This map tells, for each case, if the base and the head give the same value. */
  readonly same?: ReadonlyMap<string, boolean>;
}

/** This function gives the round after the last round of the records. The next job of a slot starts at this round. */
const nextRound = (records: readonly PairedTime[]): number => records.reduce((most, each) => Math.max(most, each.round + 1), 0);

/** This function gives the label of the jobs of a slot. */
const slotLabel = (slot: number): string => `slot ${slot}`;

/**
 * This function gives the records of each slot as one job of `@mark1russell7/rigor-bench`. The label of a job is its slot.
 * Thus each case has `BENCH_SLOTS` jobs, and the count of the jobs does not grow with the count of the cases.
 * `notSlowerVerdict` counts each job in its joint p, also a job with no record of the case.
 * The jobs of a slot follow their tries. The rounds of each later job of a case continue after the rounds of the earlier jobs.
 */
export const slotJobs = (jobs: readonly BenchJob[]): readonly JobRecords[] => {
  const slots = new Map<number, { job: string; candidate: PairedTime[]; aa: PairedTime[] }>();
  const next = new Map<string, number>();
  for (const each of [...jobs].sort((a, b) => a.slot - b.slot || a.try - b.try)) {
    const job = slotLabel(each.slot);
    const into = slots.get(each.slot) ?? { job, candidate: [], aa: [] };
    slots.set(each.slot, into);
    const candidate = pairedTimes(each.processes);
    for (const id of new Set([...candidate, ...each.aa].map((record) => record.case))) {
      const key = JSON.stringify([id, each.slot]);
      const start = next.get(key) ?? 0;
      const own = candidate.filter((record) => record.case === id);
      const ownAa = each.aa.filter((record) => record.case === id);
      into.candidate.push(...own.map((record) => ({ ...record, job, round: record.round + start })));
      into.aa.push(...ownAa.map((record) => ({ ...record, job, round: record.round + start })));
      next.set(key, start + Math.max(nextRound(own), nextRound(ownAa)));
    }
  }
  return [...slots.values()];
};

/** This function gives the rounds of each slot of a case, from slot 1 to `BENCH_SLOTS`. A slot with no job has 0 rounds. */
export const slotRounds = (jobs: readonly BenchJob[], id: string): readonly number[] =>
  Array.from({ length: BENCH_SLOTS }, (_, index) =>
    jobs.filter((each) => each.slot === index + 1).reduce((sum, each) => sum + nextRound(pairedTimes(each.processes.filter((child) => child.case === id))), 0),
  );

/**
 * This function gives the read of the jobs of a bench. The claim of each case is "the head is not slower than the A/A arm by
 * more than the limit". `notSlowerVerdict` of `@mark1russell7/rigor-bench` answers it with a one-sided sign test in each job.
 * The case needs a read in each of its `BENCH_SLOTS` jobs. The gate reads at the looks of `GATE_LOOKS`, with Holm over the cases. A job with an A/A noise above
 * the noise cap makes its case `cannot decide`. The gate passes only when each case is `within`.
 */
export const benchRead = (jobs: readonly BenchJob[], options: BenchReadOptions = {}): BenchRead => {
  const limit = options.limit ?? BENCH_LIMIT;
  const margin = Math.log(limit);
  const slots = slotJobs(jobs);
  const verdict = notSlowerVerdict(slots, { margin, jobs: BENCH_SLOTS });
  const processes = jobs.flatMap((each) => each.processes);
  const ids = [...new Set(processes.map((each) => each.case))];
  const times = ids.flatMap((id) => armTimes(processes.filter((each) => each.case === id)));
  const timeOfArm = (arm: string, id: string): number => times.find((each) => each.arm === arm && each.case === id)?.median ?? Number.NaN;
  const cases = ids.flatMap((id): BenchCaseRead[] => {
    const found = verdict.cases.find((each) => each.case === id);
    if (found === undefined) return [];
    // The A/A statistics of each job: one runner gives the noise of its own rounds.
    const stats = jobs.flatMap((job) => {
      const own = job.aa.filter((record) => record.case === id);
      return own.length === 0 ? [] : aaStats(own);
    });
    const noise = Math.max(0, ...stats.map((each) => each.spread));
    const cap = options.noiseCap;
    const capped = cap !== undefined && found.outcome === "within" && noise > cap;
    const baseMs = timeOfArm(BASE_ARM, id);
    const headMs = timeOfArm(HEAD_ARM, id);
    return [
      {
        case: id,
        baseMs,
        headMs,
        ratio: headMs / baseMs,
        jobs: found.jobs,
        look: found.look,
        noise,
        slots: slotRounds(jobs, id),
        capped,
        outcome: capped ? "cannot decide" : found.outcome,
        reason: capped ? `The case "${id}" cannot decide: the A/A noise ${noise.toFixed(4)} of a job is above the noise cap ${cap}.` : found.reason,
        same: options.same?.get(id),
      },
    ];
  });
  const gate = gateOf(cases.map((each) => ({ case: each.case, outcome: each.outcome })));
  return { limit, margin, level: verdict.level, looks: verdict.looks, gate, cases, more: verdict.more };
};

const fixed = (value: number, digits: number): string => (Number.isFinite(value) ? value.toFixed(digits) : "none");

/** This function gives the text of the jobs of a case read: the pairs below the margin and the pairs of each job. */
const jobsText = (jobs: readonly GateJobRead[]): string => jobs.map((each) => (each.centre === undefined ? `${each.rounds} pairs` : `${each.below} of ${each.rounds}`)).join(", ");

/** This function gives the summary of a bench in Markdown: one row for each case, then the gate and its reason. */
export const benchSummaryOf = (read: BenchRead, commits: { readonly base: string; readonly head: string }): string => {
  const rows = read.cases.map((each) => {
    const same = each.same === undefined ? "not compared" : each.same ? "yes" : "**no**";
    const look = each.look === undefined ? "none" : String(each.look);
    return `| ${escapeMarkdown(each.case)} | ${fixed(each.baseMs, 1)} | ${fixed(each.headMs, 1)} | ${fixed(each.ratio, 3)} | ${jobsText(each.jobs)} | ${look} | ${fixed(each.noise, 3)} | ${each.outcome} | ${same} |`;
  });
  return [
    `## The bench of the scale query`,
    ``,
    `The base is \`${commits.base.slice(0, 12)}\` and the head is \`${commits.head.slice(0, 12)}\`. The claim of each case is "the head is not slower than the A/A arm by more than ${read.limit} times".`,
    `Each pair is one round: the log ratio of the head over the base, less the log ratio of the A/A arm. A sign test in each job compares the pairs with the margin.`,
    `A case is within the limit when each of its ${BENCH_SLOTS} jobs reads it at one look of ${read.looks.join(", ")} rounds. The chance of a false pass is ${read.level} over all cases and looks.`,
    ``,
    `| Case | Base (ms) | Head (ms) | Head / base | Pairs below the margin, each job | Look | A/A noise | Outcome | Same result |`,
    `| --- | --- | --- | --- | --- | --- | --- | --- | --- |`,
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
  /** This number is the slot of the job in its case, from 1 to `BENCH_SLOTS`. A record with no slot is in slot 1. */
  readonly slot?: number;
  /** This number is the try of the job: 1 or 2. A record with no try is of the first try. */
  readonly try?: number;
}

/**
 * This function gives each bench record of a folder: each file `bench.json` in the folder or in a subfolder, in the order
 * of their paths. With the option `latest`, each artifact gives only its latest try. It throws an `Error` for a file of another format.
 */
export const readBenchRecords = (folder: string, options: ReadOptions = {}): readonly BenchRecord[] =>
  recordPaths(folder, options)
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
 * record of each slot and each try. Its read joins them with `benchRead`, and it is the same only when each job gives the same value. It throws an
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
  const read = benchRead(
    timed.map((each) => ({ slot: each.slot ?? 1, try: each.try ?? 1, processes: each.processes, aa: each.aa })),
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

/** One job of the second try: the case, the index of the job, its slot, its try and its rounds. */
export interface BenchAgainJob {
  readonly case: string;
  readonly index: number;
  readonly slot: number;
  readonly try: number;
  readonly rounds: number;
}

/**
 * This function gives the jobs of the second try, in the order of `ids`. Each job has its own index, so each job has its own artifact.
 *
 * - A case with no outcome gets one fresh job for each slot with fewer rounds than the next look of the case. The job measures the rounds that the slot lacks.
 * - A case with no record gets `BENCH_SLOTS` jobs of `BENCH_ROUNDS` rounds.
 * - The function gives no job when the gate passes or when a case is beyond the limit or above the noise cap.
 * - It gives no job when a change of value has no reason. A new job cannot change those verdicts.
 */
export const benchAgainOf = (gate: BenchGate, ids: readonly string[]): readonly BenchAgainJob[] => {
  if (gate.read.gate.outcome === "pass" && gate.missing.length === 0) return [];
  if (gate.unexplained.length > 0 || gate.read.cases.some((each) => each.outcome === "beyond" || each.capped)) return [];
  const lacking = (id: string): readonly number[] => {
    if (gate.missing.includes(id)) return Array.from({ length: BENCH_SLOTS }, () => BENCH_ROUNDS);
    const more = gate.read.more.find((each) => each.case === id);
    if (more === undefined) return [];
    const slots = gate.read.cases.find((each) => each.case === id)?.slots ?? [];
    return Array.from({ length: BENCH_SLOTS }, (_, index) => more.rounds - (slots[index] ?? 0));
  };
  const jobs: BenchAgainJob[] = [];
  for (const id of ids) {
    for (const [index, rounds] of lacking(id).entries()) if (rounds > 0) jobs.push({ case: id, index: jobs.length, slot: index + 1, try: 2, rounds });
  }
  return jobs;
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
