import {
  resourceChange,
  streamsLoadOf,
  type CellResult,
  type CpuShares,
  type CpuState,
  type ResourceChange,
  type Run,
  type RunCpus,
  type RunLoad,
  type RunResources,
} from "@mark1russell7/harness";
import { quantity, valueIn, type Quantity } from "@mark1russell7/quantity";
import { latencyQuantile } from "@mark1russell7/rigor-chaos";
import type { Case } from "./case.ts";

/** This text is the format of the record of a case. */
export const RECORD_FORMAT = "capacity-record/1";

/**
 * These measures are the measures of the container of the subject in one run, with the unit of
 * each. They come from the readings of the control group before and after the schedule.
 *
 * - The control group adds the CPU time of each core. Thus a CPU time is in `{core}·s`.
 * - `cpu.throttled` is the time that the CPU quota stopped the subject.
 * - `memory` is the usage at the end. `memory.peak` is the peak of the control group, only when it
 *   rose in the run. `memory.high` is the highest reading of the series of the run.
 * - A measure for each request divides by the answered requests of the run.
 */
export const RUN_MEASURES = {
  elapsed: "s",
  cpu: "{core}·s",
  "cpu.user": "{core}·s",
  "cpu.system": "{core}·s",
  "cpu.throttled": "s",
  "cpu.request": "{core}·ms/{request}",
  memory: "B",
  "memory.peak": "B",
  "memory.high": "B",
  "network.rx": "B",
  "network.tx": "B",
  "network.rx.request": "B/{request}",
  "network.tx.request": "B/{request}",
} as const;

/**
 * These measures are the measures of the driver in one run, with the unit of each. A record gives
 * them for all classes together, and for each class.
 *
 * - An answered request has a reply. A failed request has a reply with a status outside 200 to 299.
 * - A latency is the reply less the planned time. A request with no reply counts at its age at the
 *   end. Thus a quantile of a run with an unfinished request is a lower bound.
 * - `lag.max` is the largest delay of a send after its planned time.
 */
export const LOAD_MEASURES = {
  planned: "{request}",
  answered: "{request}",
  failed: "{request}",
  unsent: "{request}",
  unfinished: "{request}",
  "latency.p50": "ms",
  "latency.p90": "ms",
  "latency.p99": "ms",
  "latency.max": "ms",
  "lag.max": "ms",
} as const;

/**
 * These measures are the use of the CPUs of the CPU sets of one run, in cores, with the unit of each. They
 * come from `/proc/stat` between the readings of the resources, in the window of `elapsed`.
 *
 * - `cpuset.*` are the CPUs of the subject. `others.cpuset.*` are the CPUs of the driver and of the reader.
 * - The time of each process and of each interrupt on the CPUs counts, also the time outside the control group.
 * - `busy` is the CPUs less their idle time and their wait for the disk. The other measures are the parts of `busy`.
 */
export const CPUSET_MEASURES = {
  "cpuset.busy": "{core}",
  "cpuset.user": "{core}",
  "cpuset.nice": "{core}",
  "cpuset.system": "{core}",
  "cpuset.irq": "{core}",
  "cpuset.softirq": "{core}",
  "cpuset.steal": "{core}",
  "others.cpuset.busy": "{core}",
  "others.cpuset.user": "{core}",
  "others.cpuset.nice": "{core}",
  "others.cpuset.system": "{core}",
  "others.cpuset.irq": "{core}",
  "others.cpuset.softirq": "{core}",
  "others.cpuset.steal": "{core}",
} as const;

/** A run measure is the name of a measure of the container. */
export type RunMeasure = keyof typeof RUN_MEASURES;

/** A load measure is the name of a measure of the driver. */
export type LoadMeasure = keyof typeof LOAD_MEASURES;

/**
 * These levels are the levels of the quantile measures of the driver, by name. The quantile of a run
 * comes from each arrival of the run (`planned`), with the nearest rank.
 */
export const QUANTILE_MEASURES = {
  "latency.p50": 0.5,
  "latency.p90": 0.9,
  "latency.p99": 0.99,
} as const satisfies Partial<Record<LoadMeasure, number>>;

/** A quantile measure is the name of a quantile measure of the driver. */
export type QuantileMeasure = keyof typeof QUANTILE_MEASURES;

/** A cpuset measure is the name of a measure of the CPUs of a CPU set. */
export type CpusetMeasure = keyof typeof CPUSET_MEASURES;

/** These measures are the values of a set of measures. A measure that the run did not read is `null`, not 0. */
export type Measures<Name extends string> = Readonly<Record<Name, Quantity | null>>;

/** The machine of a record: the host of the lab and its software. */
export interface Machine {
  /** This name is the CPU model of the host. */
  readonly cpu: string;
  /** This count is the CPUs of the host. */
  readonly cores: number;
  readonly runner?: string;
  readonly kernel: string;
  readonly architecture: string;
  readonly docker: string;
  /** This text is the version of `@mark1russell7/harness`, or null when its manifest has none. */
  readonly harness: string | null;
}

/** The host of a record gives the CPU model, for example from `benchEnv()` of `@mark1russell7/rigor-bench/fresh`. */
export interface Host {
  readonly cpu: string;
  readonly cores: number;
  readonly runner?: string;
}

/**
 * The record of one run: the measures of the container, of the driver and of the CPUs of the CPU sets. A record of
 * an older lab has no cpuset measures.
 */
export interface RunRecord {
  readonly environment: number;
  readonly index: number;
  readonly measures: Measures<RunMeasure | LoadMeasure | CpusetMeasure>;
  /** These measures are the measures of the driver for each class, by the id of the class. */
  readonly classes: Readonly<Record<string, Measures<LoadMeasure>>>;
  /** These names are the counters that went back between the two readings. Their measures are null. */
  readonly resets: readonly string[];
  /** This text tells a part of the run that the harness did not record, or null. */
  readonly missing: string | null;
}

/**
 * The record of a case is the measures of each counted run of its cell. It has no warm-up run. The
 * case gives the load of each run, thus a law gets its load points from the demand of the case.
 */
export interface CaseRecord {
  readonly format: typeof RECORD_FORMAT;
  readonly case: Case;
  readonly machine: Machine;
  readonly at: { readonly started: string; readonly ended: string };
  /** This count is the number of warm-up runs before the counted runs. */
  readonly warmups: number;
  readonly runs: readonly RunRecord[];
}

const none = <Name extends string>(units: Readonly<Record<Name, string>>): Measures<Name> =>
  Object.fromEntries(Object.keys(units).map((name) => [name, null])) as Record<Name, null>;

const count = (value: number): Quantity => quantity(value, "{request}");

/** This function gives an amount for each request, or null when no request has a reply. */
const each = (total: number | null, answered: number | null, unit: string): Quantity | null =>
  total === null || answered === null || answered === 0 ? null : quantity(total / answered, unit);

/** This function gives the measures of the driver from the load of one stream, or of all streams. */
export const loadMeasures = (load: RunLoad | null): Measures<LoadMeasure> => {
  if (load === null) return none(LOAD_MEASURES);
  const answered = load.planned - load.unsent - load.unfinished;
  const late = (p: number): Quantity | null => (load.planned === 0 ? null : quantity(latencyQuantile(load, p), "ms"));
  return {
    planned: count(load.planned),
    answered: count(answered),
    failed: count(load.failed ?? 0),
    unsent: count(load.unsent),
    unfinished: count(load.unfinished),
    "latency.p50": late(QUANTILE_MEASURES["latency.p50"]),
    "latency.p90": late(QUANTILE_MEASURES["latency.p90"]),
    "latency.p99": late(QUANTILE_MEASURES["latency.p99"]),
    "latency.max": late(1),
    // a reduce, not a spread: a run of 600 s at 10000 requests each second has 6 million lags
    "lag.max": load.lag.length === 0 ? null : quantity(load.lag.reduce((most, lag) => Math.max(most, lag), Number.NEGATIVE_INFINITY), "ms"),
  };
};

/**
 * This function gives the measures of the container in one run from its readings and their change,
 * with `answered` requests. A run with no readings gives null for each measure.
 */
export const runMeasures = (readings: RunResources | undefined, change: ResourceChange | null, answered: number | null): Measures<RunMeasure> => {
  if (readings === undefined || change === null) return none(RUN_MEASURES);
  const seconds = (amount: Quantity | null | undefined): number | null => (amount === null || amount === undefined ? null : valueIn(amount, "s"));
  const cores = (amount: Quantity | null | undefined): Quantity | null => {
    const value = seconds(amount);
    return value === null ? null : quantity(value, "{core}·s");
  };
  const cpu = seconds(change.cpu?.total);
  // a reading of a different cgroup is of a different container
  const currents = [readings.start, ...readings.series, readings.end]
    .filter((reading) => reading.cgroup === readings.end.cgroup)
    .flatMap((reading) => (reading.memory.current === null ? [] : [reading.memory.current]));
  const bytes = (value: number | null | undefined): Quantity | null => (value === null || value === undefined ? null : quantity(value, "B"));
  const rx = change.network?.rx.bytes ?? null;
  const tx = change.network?.tx.bytes ?? null;
  return {
    elapsed: change.elapsed,
    cpu: cores(change.cpu?.total),
    "cpu.user": cores(change.cpu?.user),
    "cpu.system": cores(change.cpu?.system),
    "cpu.throttled": change.cpu?.throttled ?? null,
    "cpu.request": each(cpu === null ? null : cpu * 1000, answered, "{core}·ms/{request}"),
    memory: bytes(change.memory.last),
    "memory.peak": change.memory.peakBetween === true ? bytes(change.memory.peak) : null,
    "memory.high": currents.length === 0 ? null : bytes(currents.reduce((most, current) => Math.max(most, current), 0)),
    "network.rx": bytes(rx),
    "network.tx": bytes(tx),
    "network.rx.request": each(rx, answered, "B/{request}"),
    "network.tx.request": each(tx, answered, "B/{request}"),
  };
};

/** These states are the parts of the busy time of a CPU. The idle time and the wait for the disk are not busy. */
const BUSY_STATES = ["user", "nice", "system", "irq", "softirq", "steal"] as const satisfies readonly CpuState[];

/** This function gives the cpuset measures of one CPU set with the prefix of its names, or null for each measure without shares. */
const setMeasures = (prefix: "cpuset" | "others.cpuset", shares: CpuShares | undefined): [string, Quantity | null][] => [
  [`${prefix}.busy`, shares === undefined ? null : quantity(shares.busy, "{core}")],
  ...BUSY_STATES.map((state): [string, Quantity | null] => [`${prefix}.${state}`, shares === undefined ? null : quantity(shares[state] * shares.count, "{core}")]),
];

/**
 * This function gives the cpuset measures of one run from the CPU shares of the target and of the client
 * (`RunResources.cpus`). A share times the count of the CPUs of its set is in cores.
 */
export const cpusetMeasures = (cpus: RunCpus | undefined): Measures<CpusetMeasure> =>
  Object.fromEntries([...setMeasures("cpuset", cpus?.target), ...setMeasures("others.cpuset", cpus?.client)]) as Record<CpusetMeasure, Quantity | null>;

/** This function gives the record of one run: the load of each stream from its lines, and the readings of the container. */
export const runRecordOf = (run: Run): RunRecord => {
  const loads = run.streams === undefined ? null : streamsLoadOf(run.events, run.streams);
  const pool = loadMeasures(loads?.pool ?? null);
  const answered = pool.answered === null ? null : pool.answered.value;
  const change = run.resources === undefined ? null : resourceChange(run.resources.start, run.resources.end);
  return {
    environment: run.environment,
    index: run.index,
    measures: { ...runMeasures(run.resources, change, answered), ...pool, ...cpusetMeasures(run.resources?.cpus) },
    classes: Object.fromEntries(Object.entries(loads?.streams ?? {}).map(([key, load]) => [key, loadMeasures(load)])),
    resets: change?.resets ?? [],
    missing: run.missing ?? null,
  };
};

/**
 * This function gives the record of a case from the result of its cell (`cellOf`), on `host`. The
 * manifest of the first environment gives the kernel, the architecture, Docker and the harness.
 *
 * It throws a `RangeError` for a result with no manifest: no environment opened.
 */
export const recordOf = (value: Case, result: CellResult, host: Host): CaseRecord => {
  const manifest = result.manifests[0];
  if (manifest === undefined) throw new RangeError(`The result of the cell "${result.cell.name}" has no manifest.`);
  return {
    format: RECORD_FORMAT,
    case: value,
    machine: {
      cpu: host.cpu,
      cores: host.cores,
      ...(host.runner === undefined ? {} : { runner: host.runner }),
      kernel: manifest.kernel,
      architecture: manifest.architecture,
      docker: manifest.docker,
      harness: manifest.harness.version ?? null,
    },
    at: result.at,
    warmups: result.warmups.length,
    runs: result.runs.map(runRecordOf),
  };
};
