import type { KneeRule } from "@mark1russell7/capacity";

/**
 * The coverage of the goal of capacity: a law for each load variable, each measure, each subject and each CPU model.
 * This module has no browser code and reads no file. The page gives it the law files and the plans of the lab.
 */

/** A subject is one layer of the goal: bare Node, the service runner, or one app. It has the subject ids of the lab. */
export interface Subject {
  readonly id: string;
  readonly title: string;
  readonly note: string;
  /** These ids are the subjects of the lab that measure this layer, in the field `subject` of a case or a law. */
  readonly ids: readonly string[];
}

/** These subjects are the layers of the goal, in the order of the page. Each subject id of the lab is in one of them. */
export const SUBJECTS: readonly Subject[] = [
  { id: "node", title: "Bare Node", note: "A Node HTTP server with no framework.", ids: ["node-http"] },
  { id: "runner", title: "The service runner", note: "The same server on @mark1russell7/service. A law of this layer is the cost above bare Node.", ids: ["node-http-service"] },
  { id: "alerts", title: "alerts", note: "The alerts app, with fakes of its outside services.", ids: ["alerts", "alerts-runtime"] },
];

/** A row is one load variable of the goal, or a variable of one app. */
export interface Row {
  readonly id: string;
  readonly title: string;
}

/** These rows are the load variables of the goal, in the order of the grid of the lab (`LOAD_GRID`). A test holds the two lists equal. */
export const VARIABLES: readonly Row[] = [
  { id: "rate", title: "The rate of the requests" },
  { id: "body", title: "The bytes of the body of a request" },
  { id: "alloc", title: "The bytes that a request allocates and then drops" },
  { id: "work", title: "The CPU time of a request on the main thread" },
  { id: "wait", title: "The wait of a request with no CPU time" },
  { id: "reply", title: "The bytes of the body of a reply" },
  { id: "concurrency", title: "The connections of the pool, each with one request in flight" },
  { id: "heap", title: "The live heap that the subject holds" },
  { id: "age", title: "The duration of each run" },
];

/** A family is one column of the matrix: the measures of one resource. */
export interface Family {
  readonly id: string;
  readonly short: string;
  readonly title: string;
}

/** These families are the measures of the goal, in the order of the columns. */
export const FAMILIES: readonly Family[] = [
  { id: "cpu", short: "CPU", title: "CPU time" },
  { id: "memory", short: "Mem", title: "Memory" },
  { id: "gc", short: "GC", title: "Garbage collection time" },
  { id: "lag", short: "Lag", title: "Event-loop lag" },
  { id: "network", short: "Net", title: "Network bytes" },
  { id: "latency", short: "Lat", title: "Latency" },
];

/** This family is the start of an app: the time to ready and the other facts of a start that are not a cost. It is not a part of the goal. */
export const START: Family = { id: "start", short: "Start", title: "The start: the time and the memory to ready" };

/**
 * These measures are the measures of the subject that each run of the lab records (`RUN_MEASURES`, the latency
 * quantiles of `LOAD_MEASURES` and `LOOP_MEASURES` of the lab). A test holds this list equal to the lists of the lab.
 */
export const RECORD_MEASURES: readonly string[] = [
  "elapsed",
  "cpu",
  "cpu.user",
  "cpu.system",
  "cpu.throttled",
  "cpu.request",
  "memory",
  "memory.peak",
  "memory.high",
  "network.rx",
  "network.tx",
  "network.rx.request",
  "network.tx.request",
  "latency.p50",
  "latency.p90",
  "latency.p99",
  "latency.max",
  "loop.lag.mean",
  "loop.lag.max",
  "loop.busy",
];

/**
 * These families are the families of the measures of a start record of the lab (`START_MEASURES` of the lab). A test holds
 * the keys equal to the keys of the lab. The family `start` has the times to ready, the reads of the disk and the heap
 * limit of V8. It also has the counts and the times of the writes of a snapshot. The other measures are costs of the app.
 */
export const START_FAMILIES: Readonly<Record<string, string>> = {
  ready: "start",
  readiness: "start",
  firstPass: "start",
  copy: "start",
  ballast: "start",
  close: "start",
  end: "start",
  peak: "memory",
  rss: "memory",
  anon: "memory",
  file: "memory",
  heap: "memory",
  external: "memory",
  live: "memory",
  read: "start",
  faults: "start",
  heapPeak: "memory",
  livePeak: "memory",
  gc: "gc",
  fullGc: "gc",
  watchPeak: "memory",
  watchRss: "memory",
  watchAnon: "memory",
  watchHeap: "memory",
  watchHeapPeak: "memory",
  watchLive: "memory",
  watchGc: "gc",
  watchCpu: "cpu",
  watchCores: "cpu",
  startCpu: "cpu",
  startLongest: "lag",
  startBlocks: "lag",
  watchLongest: "lag",
  watchBlocks: "lag",
  passes: "start",
  limit: "start",
  writes: "start",
  writeLongest: "lag",
  writeStore: "start",
  writeRows: "start",
  writeWall: "start",
  writeCpu: "cpu",
};

/**
 * This function gives the family of a measure id, or undefined for a measure of no family (`elapsed`). The suffix
 * `.overhead` of a law of the service runner does not change the family. `start` gives the start measure of each law name
 * of a start plan, for example `watch-cores` to `watchCores`. Such a law name has the family of its start measure.
 */
export const familyOf = (measure: string, start: Readonly<Record<string, string>> = {}): string | undefined => {
  const id = measure.replace(/\.overhead$/, "");
  const startMeasure = Object.hasOwn(start, id) ? start[id] : undefined;
  if (startMeasure !== undefined) return START_FAMILIES[startMeasure] ?? START.id;
  const head = id.split(".")[0] ?? "";
  if (head === "loop") return "lag";
  return FAMILIES.some((each) => each.id === head) ? head : undefined;
};

/** A law entry is the part of a law file that the matrix reads. `path` finds the whole file. */
export interface LawEntry {
  readonly path: string;
  readonly id: string;
  readonly title: string;
  readonly subject: string;
  readonly variables: readonly string[];
  readonly measure: string;
  readonly unit: string;
  readonly cpu: string;
  /** This id is the class of the law (its condition `class`), or undefined for a law with no class. */
  readonly lawClass: string | undefined;
}

/** A plan entry is the part of a plan of the lab that the matrix reads. It has the subjects of the cases and the variable of the laws. */
export interface PlanEntry {
  readonly id: string;
  readonly title: string;
  readonly subjects: readonly string[];
  /** This id is the variable that the laws of the plan move, or undefined for a plan with no laws. */
  readonly variable: string | undefined;
  /** These ids are the start measures of the plan (its field `startLaws`), by the name of their law. A plan of requests has none. */
  readonly start: Readonly<Record<string, string>>;
  /** This id is the class of the law set of the plan, or undefined for a plan with no law set. */
  readonly lawClass: string | undefined;
  /** These rules are the knee rules of the law set of the plan, by the id of the measure. */
  readonly knees: Readonly<Record<string, KneeRule>>;
}

/** The state of a cell: a law, a measure with no law, or no measure. */
export type CellState = "law" | "measured" | "none";

/** A cell is one load variable, one family and one subject on one CPU model. */
export interface Cell {
  readonly subject: string;
  readonly row: string;
  readonly family: string;
  readonly state: CellState;
  /** This value is true for a cell of the goal: a variable of `VARIABLES` and a family of `FAMILIES`. */
  readonly goal: boolean;
  readonly laws: readonly LawEntry[];
  /** These plans of the lab measure the cell on each run of CI. */
  readonly plans: readonly PlanEntry[];
}

/** The matrix of one subject: its rows, its columns and its cells, row by row. */
export interface SubjectMatrix {
  readonly subject: Subject;
  readonly rows: readonly Row[];
  readonly families: readonly Family[];
  readonly cells: readonly (readonly Cell[])[];
}

/** This function gives the subject of a subject id of the lab, and throws a `RangeError` for an id of no subject. */
export const subjectOf = (id: string): Subject => {
  const found = SUBJECTS.find((each) => each.ids.includes(id));
  if (found === undefined) throw new RangeError(`The subject id "${id}" is in no subject of the page. Add it to SUBJECTS.`);
  return found;
};

/** This function gives the short name of a CPU model: the model with no trademark signs. */
export const cpuName = (model: string): string => model.replace(/\((R|TM)\)/g, "").replace(/\s+/g, " ").trim();

/**
 * This function gives the CPU models of the laws. The model with the most laws comes first, because the page opens on the
 * first model. Models with the same count of laws are in the order of their names.
 */
export const cpuModels = (laws: readonly LawEntry[]): readonly string[] => {
  const counts = new Map<string, number>();
  for (const each of laws) counts.set(each.cpu, (counts.get(each.cpu) ?? 0) + 1);
  return [...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)! || (a < b ? -1 : a > b ? 1 : 0));
};

/**
 * This function gives the matrix of each subject on one CPU model. A cell has the state `law` when a law of its subject,
 * variable and family is on the CPU model. Else it has the state `measured` when a plan of the lab moves its variable
 * for its subject and records its family. The plans have no CPU model, because each runner of CI has its own.
 */
export const coverage = (laws: readonly LawEntry[], plans: readonly PlanEntry[], cpu: string): readonly SubjectMatrix[] => {
  const start: Readonly<Record<string, string>> = Object.assign({}, ...plans.map((plan) => plan.start));
  const recorded = new Set(RECORD_MEASURES.map((each) => familyOf(each)).filter((each) => each !== undefined));
  // A start plan measures the families of the measures of its laws. A plan of requests records each family of RECORD_MEASURES.
  const familiesOf = (plan: PlanEntry): ReadonlySet<string> => {
    const measures = Object.values(plan.start);
    return measures.length > 0 ? new Set(measures.map((id) => START_FAMILIES[id] ?? START.id)) : recorded;
  };
  return SUBJECTS.map((subject) => {
    const mine = laws.filter((law) => law.cpu === cpu && subject.ids.includes(law.subject));
    const measuring = plans.filter((plan) => plan.variable !== undefined && plan.subjects.some((id) => subject.ids.includes(id)));
    const own = [...new Set([...mine.flatMap((law) => law.variables), ...measuring.map((plan) => plan.variable!)])]
      .filter((id) => !VARIABLES.some((each) => each.id === id))
      .map((id) => ({ id, title: `The ${id} of the app` }));
    const hasStart = measuring.some((plan) => familiesOf(plan).has(START.id)) || mine.some((law) => familyOf(law.measure, start) === START.id);
    const families = hasStart ? [...FAMILIES, START] : FAMILIES;
    const rows = [...VARIABLES, ...own];
    const cells = rows.map((row) =>
      families.map((family): Cell => {
        const cellLaws = mine.filter((law) => law.variables.includes(row.id) && familyOf(law.measure, start) === family.id);
        const cellPlans = measuring.filter((plan) => plan.variable === row.id && familiesOf(plan).has(family.id));
        const state: CellState = cellLaws.length > 0 ? "law" : cellPlans.length > 0 ? "measured" : "none";
        const goal = VARIABLES.some((each) => each.id === row.id) && FAMILIES.some((each) => each.id === family.id);
        return { subject: subject.id, row: row.id, family: family.id, state, goal, laws: cellLaws, plans: cellPlans };
      }),
    );
    return { subject, rows, families, cells };
  });
};

/**
 * This function gives the knee rule of a law. The rule comes from a plan with the class of the law and a case of its subject.
 * It is the rule of the measure of the law in the law set of that plan. A law with no such plan or rule gives undefined.
 */
export const kneeRuleOf = (law: LawEntry, plans: readonly PlanEntry[]): KneeRule | undefined =>
  plans.find((plan) => plan.lawClass !== undefined && plan.lawClass === law.lawClass && plan.subjects.includes(law.subject) && law.measure in plan.knees)?.knees[law.measure];

/** A tally counts the cells of each state. `percent` is the share of the cells with a law, from 0 to 100. */
export interface Tally {
  readonly cells: number;
  readonly law: number;
  readonly measured: number;
  readonly none: number;
  readonly percent: number;
}

/** This function counts the cells of each state. A list with no cell has the percent 0. */
export const tally = (cells: readonly Cell[]): Tally => {
  const count = (state: CellState): number => cells.filter((each) => each.state === state).length;
  const law = count("law");
  return { cells: cells.length, law, measured: count("measured"), none: count("none"), percent: cells.length === 0 ? 0 : (100 * law) / cells.length };
};

/** This function gives the cells of the goal of some matrices: the cells of each variable of the goal and each family of the goal. */
export const goalCells = (matrices: readonly SubjectMatrix[]): readonly Cell[] => matrices.flatMap((matrix) => matrix.cells.flat().filter((each) => each.goal));

/** A next item is the item of the roadmap that gives the law of a cell. */
export interface NextItem {
  readonly id: string;
  readonly title: string;
}

/** These items of the roadmap give the laws of each variable, of a family and of an app. A test finds each one in `docs/ROADMAP.md`. */
export const ITEMS: Readonly<Record<string, NextItem>> = {
  rate: { id: "CAP-20", title: "Laws of the request rate" },
  size: { id: "CAP-21", title: "Laws of the request size" },
  duration: { id: "CAP-22", title: "Laws of duration and concurrency" },
  heap: { id: "CAP-23", title: "Laws of the heap and garbage collection" },
  age: { id: "CAP-24", title: "Laws of the process age" },
  runner: { id: "CAP-29", title: "The overhead of the service runner" },
  lag: { id: "CAP-68", title: "The event-loop lag of a subject" },
  alerts: { id: "CAP-36", title: "The laws of alerts" },
};

const ITEM_OF_VARIABLE: Readonly<Record<string, string>> = {
  rate: "rate",
  body: "size",
  reply: "size",
  work: "duration",
  wait: "duration",
  concurrency: "duration",
  alloc: "heap",
  heap: "heap",
  age: "age",
};

/** This function gives the item of the roadmap that gives the law of a cell. An app has one item for all its laws. */
export const nextItem = (cell: Cell): NextItem => {
  if (cell.subject !== "node" && cell.subject !== "runner") return ITEMS[cell.subject] ?? ITEMS["alerts"]!;
  if (cell.family === "gc") return ITEMS["heap"]!;
  if (cell.family === "lag") return ITEMS["lag"]!;
  if (cell.subject === "runner" && cell.row === "rate") return ITEMS["runner"]!;
  return ITEMS[ITEM_OF_VARIABLE[cell.row] ?? "rate"]!;
};
