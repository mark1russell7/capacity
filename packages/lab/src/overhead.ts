import { median } from "@mark1russell7/rigor-statistics";
import type { Check, CheckProblem } from "./check.ts";
import { RATE_MEASURES, rateCheck } from "./rate.ts";
import { caseValue, measured } from "./reads.ts";
import type { CaseRecord, LoadMeasure, LoopMeasure, RunMeasure } from "./record.ts";
import { NODE_HTTP, NODE_HTTP_SERVICE } from "./subjects.ts";

/** These are the two sides of a pair of the plan `overhead`: the last part of the id of each case, and its subject. */
export const OVERHEAD_SIDES: { readonly bare: string; readonly service: string } = {
  bare: NODE_HTTP.name,
  service: NODE_HTTP_SERVICE.name,
};

/** An overhead measure is the name of a measure that the check `overhead` compares in each pair. */
export type OverheadMeasure =
  | Extract<RunMeasure | LoadMeasure, "cpu.request" | "memory" | "memory.high" | "network.rx.request" | "network.tx.request" | "latency.p50" | "latency.p90" | "latency.p99">
  | LoopMeasure;

/**
 * These measures are the measures of the overhead of the runner. They are the CPU time, the memory, the bytes and the latency
 * of a request. They are also the lag and the busy part of the event loop.
 */
export const OVERHEAD_MEASURES: readonly OverheadMeasure[] = [
  "cpu.request",
  "memory",
  "memory.high",
  "network.rx.request",
  "network.tx.request",
  "latency.p50",
  "latency.p90",
  "latency.p99",
  "loop.lag.mean",
  "loop.lag.max",
  "loop.busy",
];

/** This function gives the load of a case: the case with no id, no title and no subject. The two cases of a pair have one load. */
const loadOf = (record: CaseRecord): string => JSON.stringify({ ...record.case, id: undefined, title: undefined, subject: undefined });

/**
 * This check is the check of the plan `overhead`. Each pair of the plan sends one load to the bare subject and
 * to the service subject, on one runner. Thus the difference of a pair is the cost of the service runner at that load.
 *
 * - The check gives each value and each problem of the check `rate`. Thus each run must answer each request,
 *   and its driver must have a lag of `RATE_LAG_LIMIT` or less.
 * - A pair is the cases `<pair>/bare` and `<pair>/service`, with the subjects of `OVERHEAD_SIDES` and one load.
 *   A case with no partner, another subject or another load is a problem.
 * - `<pair>.<measure>` is the overhead at the load of the pair: the median of the case service less the median of the case bare.
 * - `<measure>.overhead` is the median of the overheads of the pairs, for each measure of `OVERHEAD_MEASURES`.
 */
export const overheadCheck: Check = (records) => {
  const rate = rateCheck(records);
  const values: Record<string, number> = { ...rate.values };
  const problems: CheckProblem[] = [...rate.problems];
  const byId = new Map(records.map((record) => [record.case.id, record]));
  const names = new Set<string>();
  for (const record of records) {
    const id = record.case.id;
    const cut = id.lastIndexOf("/");
    const side = id.slice(cut + 1);
    if (!Object.hasOwn(OVERHEAD_SIDES, side)) {
      problems.push({ code: "record", path: id, message: `The case ${id} is not a side of a pair. The id of a side ends with /bare or /service.` });
      continue;
    }
    const subject = OVERHEAD_SIDES[side as keyof typeof OVERHEAD_SIDES];
    if (record.case.subject !== subject) {
      problems.push({ code: "record", path: id, message: `The case ${id} has the subject ${record.case.subject}. The ${side} side of a pair has the subject ${subject}.` });
    }
    names.add(id.slice(0, cut));
  }
  const pairs: { readonly name: string; readonly bare: CaseRecord; readonly service: CaseRecord }[] = [];
  for (const name of names) {
    const bare = byId.get(`${name}/bare`);
    const service = byId.get(`${name}/service`);
    if (bare === undefined || service === undefined) {
      const absent = bare === undefined ? "bare" : "service";
      problems.push({ code: "record", path: name, message: `The pair ${name} has no record of the case ${name}/${absent}.` });
    } else if (loadOf(bare) !== loadOf(service)) {
      problems.push({ code: "record", path: name, message: `The two cases of the pair ${name} have different loads. Thus their difference is not the cost of the runner.` });
    } else pairs.push({ name, bare, service });
  }
  for (const measure of OVERHEAD_MEASURES) {
    const overheads: number[] = [];
    for (const { name, bare, service } of pairs) {
      if (!measured(bare, measure) || !measured(service, measure)) continue;
      const low = caseValue(bare, measure);
      const high = caseValue(service, measure);
      // the check rate gives the problem of each measure of RATE_MEASURES
      const own = !(RATE_MEASURES as readonly string[]).includes(measure);
      if (typeof low !== "number" && own) problems.push(low);
      if (typeof high !== "number" && own) problems.push(high);
      if (typeof low !== "number" || typeof high !== "number") continue;
      values[`${name}.${measure}`] = high - low;
      overheads.push(high - low);
    }
    if (overheads.length > 0 && overheads.length === pairs.length) values[`${measure}.overhead`] = median(overheads);
  }
  return { values, problems };
};
