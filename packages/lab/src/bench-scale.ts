import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type * as Capacity from "@mark1russell7/capacity";
import type { Composition, Demand, KneeRule, Law, ScaleModel, ScaleOptions } from "@mark1russell7/capacity";
import { gateOf, limitVerdict, type Gate, type LimitVerdict, type PairedTime } from "@mark1russell7/rigor-bench";
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

/** The read of one case: the median time of each arm, the ratio of the head with its interval and its outcome. It also tells if the results are equal. */
export interface BenchCaseRead {
  readonly case: string;
  readonly baseMs: number;
  readonly headMs: number;
  readonly ratio: number;
  readonly low: number;
  readonly high: number;
  readonly outcome: LimitVerdict["outcome"];
  /** This flag tells that the base and the head give the same value. It is undefined when the bench did not compare them. */
  readonly same: boolean | undefined;
}

/** The read of a bench: the limit verdict, the gate and the read of each case. */
export interface BenchRead {
  readonly verdict: LimitVerdict;
  readonly gate: Gate;
  readonly cases: readonly BenchCaseRead[];
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
export const benchRead = (processes: readonly ArmProcess[], aa: readonly PairedTime[], options: BenchReadOptions = {}): BenchRead => {
  const records = pairedTimes(processes);
  const verdict = limitVerdict(records, aa, {
    limit: options.limit ?? BENCH_LIMIT,
    aaFrom: "rounds",
    ...(options.noiseCap === undefined ? {} : { noiseCap: options.noiseCap }),
  });
  const gate = gateOf(verdict.cases.map((each) => ({ case: each.case, outcome: each.outcome })));
  const ids = [...new Set(processes.map((each) => each.case))];
  const times = ids.flatMap((id) => armTimes(processes.filter((each) => each.case === id)));
  const timeOfArm = (arm: string, id: string): number => times.find((each) => each.arm === arm && each.case === id)?.median ?? Number.NaN;
  const cases = verdict.cases.map((each) => ({
    case: each.case,
    baseMs: timeOfArm(BASE_ARM, each.case),
    headMs: timeOfArm(HEAD_ARM, each.case),
    ratio: each.ratio,
    low: each.low,
    high: each.high,
    outcome: each.outcome,
    same: options.same?.get(each.case),
  }));
  return { verdict, gate, cases };
};

const fixed = (value: number, digits: number): string => (Number.isFinite(value) ? value.toFixed(digits) : "none");

/** This function gives the summary of a bench in Markdown: one row for each case, then the gate and its reason. */
export const benchSummaryOf = (read: BenchRead, commits: { readonly base: string; readonly head: string }): string => {
  const rows = read.cases.map((each) => {
    const same = each.same === undefined ? "not compared" : each.same ? "yes" : "**no**";
    return `| ${escapeMarkdown(each.case)} | ${fixed(each.baseMs, 1)} | ${fixed(each.headMs, 1)} | ${fixed(each.ratio, 3)} | ${fixed(each.low, 3)} to ${fixed(each.high, 3)} | ${each.outcome} | ${same} |`;
  });
  return [
    `## The bench of the scale query`,
    ``,
    `The base is \`${commits.base.slice(0, 12)}\` and the head is \`${commits.head.slice(0, 12)}\`. The limit of each case is ${read.verdict.limit} times the time of the base.`,
    ``,
    `| Case | Base (ms) | Head (ms) | Head / base | Interval | Outcome | Same result |`,
    `| --- | --- | --- | --- | --- | --- | --- |`,
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

/** The gate of the bench records of a run: the read of the cases, the cases with no record and the commits. */
export interface BenchGate {
  readonly read: BenchRead;
  /** The cases of the bench that have no record. A case with no record is no read, so the gate cannot pass. */
  readonly missing: readonly string[];
  /** The cases whose base and head give different values. */
  readonly changed: readonly string[];
  readonly commits: { readonly base: string; readonly head: string };
}

/**
 * This function gives the gate of the bench records of a run. The `cases` are the ids of the cases of the bench. It throws an
 * `Error` when the records have more than one base or head, or no record.
 */
export const benchGate = (records: readonly BenchRecord[], cases: readonly string[], options: Omit<BenchReadOptions, "same"> = {}): BenchGate => {
  const first = records[0];
  if (first === undefined) throw new Error("The run has no bench record. A gate with no read is not a pass.");
  const other = records.find((each) => each.commits.base !== first.commits.base || each.commits.head !== first.commits.head);
  if (other !== undefined) throw new Error(`The records have two pairs of commits: ${JSON.stringify(first.commits)} and ${JSON.stringify(other.commits)}.`);
  const same = new Map(records.map((each) => [each.case, each.same]));
  const read = benchRead(
    records.flatMap((each) => each.processes),
    records.flatMap((each) => each.aa),
    { ...options, same },
  );
  return {
    read,
    missing: cases.filter((id) => !same.has(id)),
    changed: records.filter((each) => !each.same).map((each) => each.case),
    commits: first.commits,
  };
};

/**
 * This function gives the cases of a gate that a fresh job measures again: each case that cannot decide, and each case
 * with no record. It gives no case when the gate passes or when a case is beyond the limit. A new job cannot change those
 * verdicts.
 */
export const benchAgainOf = (gate: BenchGate): readonly string[] => {
  if (gate.read.gate.outcome === "pass" && gate.missing.length === 0) return [];
  if (gate.read.cases.some((each) => each.outcome === "beyond")) return [];
  return [...gate.read.cases.filter((each) => each.outcome === "cannot decide").map((each) => each.case), ...gate.missing];
};

/**
 * This function gives the records of a run after its second try. A record of the second try replaces the record of its
 * case. Thus each case still has the verdict of one job, and a noisy job cannot pass.
 */
export const benchRecordsAgain = (first: readonly BenchRecord[], again: readonly BenchRecord[]): readonly BenchRecord[] => {
  const cases = new Set(again.map((each) => each.case));
  return [...first.filter((each) => !cases.has(each.case)), ...again];
};
