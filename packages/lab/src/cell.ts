import type { Cell, LoadStream, Target } from "@mark1russell7/harness";
import { quantity, valueIn, type Quantity } from "@mark1russell7/quantity";
import { constant, type ScheduleOptions } from "@mark1russell7/rigor-chaos";
import { CASE_RATE, SUBJECTS, caseCost, caseLevel, caseProblems, requestClassOf, type Case } from "./case.ts";
import { requestOf } from "./subject/class.ts";
import { SUBJECT_FOLDER, subjectFiles, type LabSubject } from "./subjects.ts";

/** This number is the port of the listener of a subject in its container. */
export const SUBJECT_PORT = 8080;

/** This time is the period of the series of the readings of the subject in each run. */
export const READING_PERIOD: Quantity = { value: 250, unit: "ms" };

/**
 * This time is the margin of a run after its schedule and its drain. A run past the knee drains its
 * queue for up to one more duration. A request with no reply at the end is unfinished.
 */
export const DRAIN: Quantity = { value: 30, unit: "s" };

/** The options of a cell tell the host of the lab. */
export interface CellOptions {
  /** This count is the CPUs of the host of the lab, for example from `availableParallelism()` of `node:os`. */
  readonly cpus: number;
}

/** The CPU sets of a cell: the CPUs of the subject, and the other CPUs for the driver and the reader. */
export interface CpuSets {
  readonly subject: string;
  readonly others: string;
}

const span = (first: number, last: number): string => (first === last ? String(first) : `${first}-${last}`);

/**
 * This function gives the CPU sets of a subject with `cores` cores on a host with `cpus` CPUs. The
 * subject has the first CPUs, one for each started core. The driver and the reader have the other
 * CPUs. Thus they do not take the CPU time of the subject.
 *
 * It throws a `RangeError` when the host has no CPU for the driver.
 */
export const cpuSetsOf = (cores: number, cpus: number): CpuSets => {
  // a conversion factor is a binary float: 2.0000000001 cores are 2 cores
  const own = Math.max(1, Math.ceil(cores - 1e-9));
  if (!Number.isSafeInteger(cpus) || cpus < own + 1) {
    throw new RangeError(`A subject with ${cores} cores needs ${own + 1} CPUs: ${own} for the subject and 1 for the driver. The host has ${cpus}.`);
  }
  return { subject: span(0, own - 1), others: span(own, cpus - 1) };
};

/** This function gives the subject of a case. It throws a `RangeError` for a name that is not in `SUBJECTS`. */
export const subjectOf = (value: Case): LabSubject => {
  const subject = Object.hasOwn(SUBJECTS, value.subject) ? SUBJECTS[value.subject] : undefined;
  if (subject === undefined) throw new RangeError(`The subject "${value.subject}" is not one of ${Object.keys(SUBJECTS).join(", ")}.`);
  return subject;
};

/**
 * This function gives the command of the subject of a case. The subject keeps each connection
 * (`--keep-alive-timeout 0`), and the level `heap` of the demand is its ballast. A case with a cost (`caseCost`) gives the flag `--cost`.
 */
export const commandOf = (value: Case): readonly string[] => {
  const heap = caseLevel(value, "heap");
  const cost = caseCost(value);
  return [
    "node",
    `${SUBJECT_FOLDER}/${subjectOf(value).program}`,
    "--port",
    String(SUBJECT_PORT),
    "--keep-alive-timeout",
    "0",
    ...(heap > 0 ? ["--ballast", String(heap)] : []),
    ...(cost > 0 ? ["--cost", String(cost)] : []),
  ];
};

/**
 * This function gives the arrivals of the stream of one class. The Poisson seed of a stream is the
 * seed of the case, a slash and the id of the class. Thus two classes do not arrive together.
 */
export const streamArrivals = (arrivals: ScheduleOptions, key: string): ScheduleOptions =>
  arrivals.arrivals === "poisson" ? { arrivals: "poisson", seed: `${arrivals.seed}/${key}` } : arrivals;

/**
 * This function gives the streams of the driver for a case: one stream for each class. A stream
 * has the rate of its class for the duration of the case. Each request of a stream is the request of its class.
 * Each stream has the connections of the case. A case with no connections gives streams with no such field: a pipeline.
 */
export const streamsOf = (value: Case): readonly LoadStream[] =>
  value.demand.classes.map((entry) => ({
    key: entry.id,
    plan: { profile: constant(valueIn(entry.rate, CASE_RATE), valueIn(value.duration, "ms")), options: streamArrivals(value.arrivals, entry.id) },
    requests: [requestOf(requestClassOf(entry.request), `${value.subject}:${SUBJECT_PORT}`)],
    ...(value.connections === undefined ? {} : { connections: value.connections }),
  }));

/** This function gives the longest time of one run of a case: two durations and the drain. */
export const windowOf = (value: Case): Quantity => quantity(2 * valueIn(value.duration, "s") + valueIn(DRAIN, "s"), "s");

/**
 * This function gives the cell of `@mark1russell7/harness` that measures a case. A cell result gives
 * the record of the case with `recordOf`.
 *
 * - The subject has the CPU quota and the memory limit of the instance, on its own CPUs.
 * - The driver sends each class as one stream, and the reader reads the subject at `READING_PERIOD`.
 *   The two have the other CPUs of the host.
 * - The cell predicts no detection. Its verdict is a measure, and the record keeps each measure.
 * - The runs of the case go in one environment, after one warm-up run.
 *
 * It throws a `RangeError` for a case with a problem, and for a host with too few CPUs.
 */
export const cellOf = (value: Case, options: CellOptions): Cell => {
  const problems = caseProblems(value);
  if (problems.length > 0) throw new RangeError(`The case has problems: ${problems.map((each) => `${each.path}: ${each.message}`).join(" ")}`);
  const subject = subjectOf(value);
  const { cpu, memory } = value.instance.resources;
  if (cpu === undefined || memory === undefined) throw new RangeError("The instance of the case has no cpu or no memory.");
  const cores = valueIn(cpu, "{core}");
  const sets = cpuSetsOf(cores, options.cpus);
  const target: Target = {
    image: subject.image,
    subject: { kind: "pinned", image: subject.image },
    port: SUBJECT_PORT,
    ready: subject.ready,
    files: subjectFiles(subject),
    command: commandOf(value),
    lines: true,
    limits: { cpus: cores, cpuset: sets.subject, memory },
  };
  return {
    name: `${value.id}: ${value.title}`,
    target,
    sysctls: {},
    client: "load",
    probe: { mode: "schedule", keepalive: false, streams: streamsOf(value) },
    fault: "none",
    prediction: { detects: null, window: windowOf(value), why: `the measures of the case ${value.id}` },
    runs: value.runs,
    environments: 1,
    concurrency: 1,
    clientLimits: { cpuset: sets.others },
    resources: { period: READING_PERIOD, cpuset: sets.others },
  };
};
