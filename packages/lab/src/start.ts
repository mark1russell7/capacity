import { SLUG, isHttps, type Amounts, type Problem } from "@mark1russell7/capacity";
import { isRecord } from "@mark1russell7/optional/read";
import { convertible, isQuantity, kindOf, quantity, valueIn, type Quantity } from "@mark1russell7/quantity";
import { MIN_CONTAINER_MEMORY } from "@mark1russell7/rigor-bench/fresh";
import { ALERTS } from "./subject/alerts.ts";

/** This text is the format of a start case. */
export const START_FORMAT = "capacity-start/1";

/** This rule is the rule of a commit: 40 lower-case hexadecimal digits. A start case pins each tree by its full commit. */
export const COMMIT: RegExp = /^[0-9a-f]{40}$/;

/** This rule is the rule of the id of an arm or of a point: lower-case words joined by `-`. */
export const START_ID: RegExp = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** This count is the most rounds of a start case in one job. */
export const MAX_START_ROUNDS: number = 10;

/** This time is the longest watch after the ready time of a start. */
export const MAX_WATCH: Quantity = { value: 600, unit: "s" };

/** This time is the largest time limit of one start. */
export const MAX_START: Quantity = { value: 1800, unit: "s" };

/** This time is the margin of one child for its copy of the store and its close, after its start and its watch. */
export const CHILD_MARGIN: Quantity = { value: 60, unit: "s" };

/** This time is the longest interval of the ready probe of a supervisor. */
export const MAX_PROBE: Quantity = { value: 60, unit: "s" };

/** This time is the shortest interval of the samples of a child. Thus a child of the longest start keeps 2400 samples or fewer. */
export const MIN_SAMPLES: Quantity = { value: 1, unit: "s" };

/** This time is the longest interval of the samples of a child. */
export const MAX_SAMPLES: Quantity = { value: 60, unit: "s" };

/** These moments are the moments of the start of a ballast. */
export const BALLAST_MOMENTS: readonly BallastMoment[] = ["start", "ready"];

/** These texts are the states of the page cache at the start of each child. */
export const START_CACHES: readonly StartCache[] = ["warm", "cold"];

/** This time is the margin of each of the 3 steps of the image of the target. The steps are the pull, the inspect and the check child. */
export const IMAGE_MARGIN: Quantity = { value: 300, unit: "s" };

/** This count is the steps of the image of the target, each in `IMAGE_MARGIN`: the pull, the inspect and the check child. */
export const IMAGE_STEPS: number = 3;

/** This count is the most CPUs of a target. A runner of the lab has fewer. */
export const MAX_TARGET_CPUS: number = 64;

/** This rule is the rule of an image of Docker: a name, and a tag or a digest, with no space. */
export const IMAGE: RegExp = /^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/;

/** This rule is the rule of a version of Node, as `process.version` gives it. */
export const NODE_VERSION: RegExp = /^v\d+\.\d+\.\d+$/;

/**
 * This time is the margin of the clone and the install of one tree. The first timed run records the real
 * time of each step. Then this margin changes to the worst real time and its spread.
 */
export const TREE_MARGIN: Quantity = { value: 300, unit: "s" };

/**
 * This rate is the lowest rate of a seed program, in bytes each second. The plan uses it for the time of the
 * seeds. The first timed run records the real rate.
 */
export const SEED_RATE: number = 1024 * 1024;

/** A variable of a start subject: the unit of its amounts, and the range that the subject can seed. */
export interface StartVariable {
  readonly unit: string;
  readonly min: number;
  readonly max: number;
}

/**
 * A start subject is an application that a start case measures, as data. The case clones its repository
 * at each commit. Two programs in the folder `src/subject` of this package do the work.
 *
 * - The seed program writes the store of one point into a folder, at the amounts of the point. It gives
 *   the amounts that it wrote and the arguments of the start program for that store.
 * - The start program opens a copy of a store in a fresh process. It gives the time to ready and the
 *   memory of the process, as one line of `@mark1russell7/rigor-bench/fresh`.
 */
export interface StartSubject {
  /** This name is the id of the subject in a law and in a record, for example `alerts`. */
  readonly name: string;
  /** This URL is the public HTTPS URL of the repository of the subject. */
  readonly repository: string;
  /** This command installs the dependencies of a tree, in the folder of the tree. */
  readonly install: readonly string[];
  /**
   * This command type-checks a tree with a graft, in the folder of the tree, after the install. The start program
   * strips the types. Thus a graft that does not fit its tree stops the case here, and not in a child.
   */
  readonly check: readonly string[];
  /** These variables are the variables of a store, by their names. A point that does not name a variable gets its `min`. */
  readonly variables: Readonly<Record<string, StartVariable>>;
  /** This name is the file of the seed program, in the folder `src/subject`. */
  readonly seed: string;
  /** This name is the file of the start program, in the folder `src/subject`. */
  readonly start: string;
}

/** The variables of a store, by their names: the variables of a subject, or the store variables of the contract of an app. */
export type StartVariables = Pick<StartSubject, "variables">;

/** These subjects are the start subjects that a start case can name, by their names. */
export const START_SUBJECTS: Readonly<Record<string, StartSubject>> = { [ALERTS.name]: ALERTS };

/** A graft puts one file of another commit into the tree of an arm, after the checkout. */
export interface Graft {
  /** This path is the path of the file in the repository, with `/` and no `..`. */
  readonly path: string;
  readonly commit: string;
}

/**
 * This moment is the start of a ballast: `start`, before the import of the runtime, or `ready`, at the end of the first pass.
 * The measured runtime gives control back only at ready. Thus a ballast cannot start between the open and the end of the first pass.
 */
export type BallastMoment = "start" | "ready";

/**
 * A ballast is a process in the container of a child that holds memory and does nothing more. It models a
 * process of the target that the start program does not run. That is another process of the machine, or a step of
 * the live start, for example a bundler.
 */
export interface StartBallast {
  /** This amount is the resident set of the ballast process, its Node included. */
  readonly bytes: Quantity;
  readonly at: BallastMoment;
  /** This text tells what the ballast models, and the source of its size. */
  readonly models: string;
}

/** An arm of a start case is one tree of the subject: a commit, and the files that it takes from other commits. */
export interface StartArm {
  readonly id: string;
  readonly commit: string;
  /** These grafts give a file to an old commit, for example the entry of the measure. The default is no graft. */
  readonly graft?: readonly Graft[];
  /** These ballasts model the steps of the live start of this tree that the start program does not run. The default is none. */
  readonly ballast?: readonly StartBallast[];
  /** This flag tells that the start reads and writes the snapshot of the start in its home, as the live start of this tree does. The default is false. */
  readonly snapshot?: boolean;
}

/**
 * The disk of a target is the limits of the reads and writes of each child on each disk that the child uses.
 * These disks are the disks of the host with the work folder, the data of Docker and the swap. The rates are each second.
 */
export interface StartDisk {
  /** This rate is the most bytes that a child reads each second, in a unit of bytes each second, for example `MiB/s`. */
  readonly readBytes: Quantity;
  /** This rate is the most reads of a child each second, in the unit `{read}/s`. */
  readonly readOps: Quantity;
  /** This rate is the most bytes that a child writes each second. */
  readonly writeBytes: Quantity;
  /** This rate is the most writes of a child each second, in the unit `{write}/s`. */
  readonly writeOps: Quantity;
  /** This text tells the source of the limits: the facts of the target and their time. */
  readonly source: string;
}

/**
 * This text is the state of the page cache at the start of each child. With `warm`, the start program copies the
 * store, and the open reads the copy from the page cache. With `cold`, the lab copies the store before the child,
 * and it drops the page cache of the host. Then the child opens the copy in place, and each read goes to the disk.
 */
export type StartCache = "warm" | "cold";

/**
 * The target of a start case is the machine whose start the case models. Each child of the case starts in a
 * container of Docker with the image, the memory, the swap and the CPUs of the target. Node sizes the heap of
 * V8 from the memory of the container, as it does on the target.
 *
 * Before the trees, a check child in the container reads the Node version, the memory and the heap limit. A
 * value that is not the value of the target stops the case. Thus a record cannot model another machine.
 */
export interface StartTarget {
  /** This name is the image of each child, with the Node of the target, for example `node:24.21.0-bookworm-slim`. */
  readonly image: string;
  /** This text is the Node version of the target, for example `v24.21.0`. The check child must give it. */
  readonly node: string;
  /** This amount is the memory of the target: `MemTotal`, or the memory limit of its unit when it is lower. */
  readonly memory: Quantity;
  /** This amount is the swap of the target. */
  readonly swap: Quantity;
  /** This count is the CPUs of the target. The host of the lab gives the child this count of its CPUs. */
  readonly cpus: number;
  /** This amount is the heap size limit of V8 on the target, or null when it is not known. The check child must give it. */
  readonly heapLimit: Quantity | null;
  /** This disk is the disk of the target. The default is the disk of the host, with no limit. */
  readonly disk?: StartDisk;
  /** This text is the state of the page cache at the start of each child. The default is `warm`. */
  readonly cache?: StartCache;
  /** These ballasts are the other processes of the target. The default is none. */
  readonly others?: readonly StartBallast[];
}

/**
 * An observation is a fact of the target machine at one point. The fact is that the start of an arm was ready in a
 * window, or that it was not. The record compares each observation with the children of the case. A case that says "ready" where the
 * machine says "not ready" does not model the machine.
 */
export interface StartObservation {
  readonly point: string;
  readonly arm: string;
  /** This time is the ready window of the observation. */
  readonly window: Quantity;
  /** This flag tells that the start on the machine was ready in the window. */
  readonly ready: boolean;
  /** This text tells the source of the fact: the machine, the time and the count of the starts. */
  readonly source: string;
}

/** A point of a start case is one store: the amount of each variable of the subject. */
export interface StartPoint {
  readonly id: string;
  readonly at: Amounts;
  /**
   * This id names an earlier point of the case. Then the store of this point is the home after one start of each
   * arm on that point. The `at` of this point is the `at` of that point. Thus a second start reads what a first start wrote, for
   * example its snapshot. The default is the store of the seed program.
   */
  readonly after?: string;
}

/**
 * A start case is the measure of the start of an application as data. One seed program writes the store of
 * each point. Then each arm opens a copy of each store in a fresh process, in each round. A start case file
 * is this record as JSON, in a plan.
 *
 * The first arm is the base. A run of `@mark1russell7/rigor-bench/fresh` compares each other arm with it,
 * and the A/A pair of the base gives the noise of each measure.
 */
export interface StartCase {
  readonly format: typeof START_FORMAT;
  readonly id: string;
  readonly title: string;
  /** This name is the name of a subject of `START_SUBJECTS`, or the id of the contract of the app of the field `app`. */
  readonly subject: string;
  /**
   * This URL is the public HTTPS URL of the repository of an app with a contract file, `capacity-app.json`. Then the contract
   * at each arm gives the steps of the start, and the lab program `app-start` starts the app. The default is no app: the
   * subject is a subject of `START_SUBJECTS`.
   */
  readonly app?: string;
  /** This commit is the tree of the seed program. Each arm opens the same stores. */
  readonly seeder: string;
  readonly arms: readonly StartArm[];
  readonly points: readonly StartPoint[];
  /** This text is the seed of the draws of each store. */
  readonly seed: string;
  /** This count is the rounds of one job. Each round starts one child of each arm on each point, and one A/A child. */
  readonly rounds: number;
  /** This time is the watch after the ready time. The child does the passes of a live loop in it. */
  readonly watch: Quantity;
  /** This time is the longest start, to the end of the first pass. A start that does not end in this time fails with the kind `time`. */
  readonly limit: Quantity;
  /**
   * These times are the ready windows of the supervisor of the subject, from the start of the process to the first
   * ready probe. The record tells for each child if it was ready in each window. Each window is up to the limit.
   */
  readonly windows: readonly Quantity[];
  /** This time is the interval of the ready probe of the supervisor. A start is ready at the first probe after the end of its open. */
  readonly probe: Quantity;
  /**
   * This time is the interval of the samples of each child: its reads, its major faults and its resident set. A sample
   * also has the memory and the reads of its container. The samples continue while the open blocks the main thread. The default is no samples.
   */
  readonly samples?: Quantity;
  readonly target: StartTarget;
  /** These facts of the target machine are the observations that the record compares with the children. */
  readonly observed: readonly StartObservation[];
}

/** A start problem code names the part of a start case that is not correct. */
export type StartProblemCode = "shape" | "format" | "id" | "subject" | "commit" | "arm" | "point" | "seed" | "rounds" | "time" | "target" | "observed";

/** A start problem tells what is not correct, and where: `path` is the path of the field in the case. */
export type StartProblem = Problem<StartProblemCode>;

const problem = (code: StartProblemCode, path: string, message: string): StartProblem => ({ code, path, message });

/** This function tells if a value is a time above 0 and up to a limit. */
const isTimeUpTo = (value: unknown, limit: Quantity): value is Quantity =>
  isQuantity(value) && kindOf(value.unit) === "time" && value.value > 0 && valueIn(value, "s") <= valueIn(limit, "s");

/** This function tells if a path is a relative path in a repository, with `/` and no part `..` or `.`. */
const isRepositoryPath = (path: unknown): path is string =>
  typeof path === "string" && path !== "" && !path.startsWith("/") && path.split("/").every((part) => part !== "" && part !== "." && part !== ".." && !part.includes("\\"));

/** This function gives the problems of the arms of a start case. */
const armProblems = (arms: unknown, app: boolean): readonly StartProblem[] => {
  if (!Array.isArray(arms) || arms.length < 2) return [problem("arm", "arms", "The case has fewer than 2 arms. The first arm is the base, and each other arm is compared with it.")];
  const problems: StartProblem[] = [];
  const ids = new Set<string>();
  arms.forEach((arm: unknown, index) => {
    const path = `arms[${index}]`;
    if (!isRecord(arm)) {
      problems.push(problem("shape", path, "The arm is not a record."));
      return;
    }
    const { id, commit, graft, ballast, snapshot } = arm as Partial<StartArm>;
    if (typeof id !== "string" || !START_ID.test(id)) problems.push(problem("id", `${path}.id`, 'The id of the arm is not lower-case words joined by "-".'));
    else if (ids.has(id)) problems.push(problem("id", `${path}.id`, `The arm id "${id}" is in the case two times.`));
    else ids.add(id);
    if (typeof commit !== "string" || !COMMIT.test(commit)) problems.push(problem("commit", `${path}.commit`, "The commit is not 40 lower-case hexadecimal digits."));
    problems.push(...ballastProblems(ballast, `${path}.ballast`, "arm"));
    if (app && snapshot !== undefined) {
      problems.push(problem("arm", `${path}.snapshot`, "An arm of an app case has no field snapshot. The run of the contract of the app tells if it reads a snapshot."));
    } else if (snapshot !== undefined && typeof snapshot !== "boolean") {
      problems.push(problem("arm", `${path}.snapshot`, "The field snapshot is not true or false."));
    }
    if (graft === undefined) return;
    if (!Array.isArray(graft)) {
      problems.push(problem("arm", `${path}.graft`, "The graft is not a list."));
      return;
    }
    graft.forEach((entry: unknown, at) => {
      const where = `${path}.graft[${at}]`;
      if (!isRecord(entry) || !isRepositoryPath(entry["path"])) problems.push(problem("arm", `${where}.path`, 'The path is not a relative path with "/" and no "." or "..".'));
      if (!isRecord(entry) || typeof entry["commit"] !== "string" || !COMMIT.test(entry["commit"])) {
        problems.push(problem("commit", `${where}.commit`, "The commit is not 40 lower-case hexadecimal digits."));
      }
    });
  });
  return problems;
};

/**
 * The scope of the points of a start case: the name of the subject and its variables. The variables of an app case are
 * the variables that its first point names, with no range. The measure reads the ranges from the contract of the app.
 */
interface PointScope extends StartVariables {
  readonly name: string;
  readonly ranged: boolean;
}

/** This function gives the variables that the first point of an app case names: each amount, in its unit. The range starts at 0 and has no end. */
const appVariablesOf = (points: unknown): Readonly<Record<string, StartVariable>> => {
  const first: unknown = Array.isArray(points) ? points[0] : undefined;
  const at = isRecord(first) ? first["at"] : undefined;
  if (!isRecord(at)) return {};
  return Object.fromEntries(Object.entries(at).flatMap(([name, amount]) => (isQuantity(amount) ? [[name, { unit: amount.unit, min: 0, max: Infinity }]] : [])));
};

/** This function gives the problems of the points of a start case for its subject. */
const pointProblems = (points: unknown, subject: PointScope | undefined): readonly StartProblem[] => {
  if (!Array.isArray(points) || points.length === 0) return [problem("point", "points", "The case has no point. A case measures one store or more.")];
  const problems: StartProblem[] = [];
  const ids = new Set<string>();
  points.forEach((point: unknown, index) => {
    const path = `points[${index}]`;
    if (!isRecord(point) || !isRecord(point["at"])) {
      problems.push(problem("shape", path, "The point is not a record with the record at."));
      return;
    }
    const { id, at, after } = point as unknown as StartPoint;
    if (typeof id !== "string" || !START_ID.test(id)) problems.push(problem("id", `${path}.id`, 'The id of the point is not lower-case words joined by "-".'));
    else if (ids.has(id)) problems.push(problem("id", `${path}.id`, `The point id "${id}" is in the case two times.`));
    else ids.add(id);
    if (after !== undefined) {
      // The store of the point comes from the starts on an earlier point. Thus the order of the points is the order of their stores.
      const earlier: unknown = points.slice(0, index).find((each: unknown) => isRecord(each) && each["id"] === after);
      if (!isRecord(earlier)) problems.push(problem("point", `${path}.after`, "The field after is not the id of an earlier point of the case."));
      else if (subject !== undefined && !sameAmounts(subject, at, earlier["at"])) {
        problems.push(problem("point", `${path}.at`, `The amounts of the point are not the amounts of the point "${String(after)}". Its store is the home of a start on that point.`));
      }
    }
    if (subject === undefined) return;
    if (!subject.ranged) {
      // Each point of an app case names the same variables: the store variables of the app.
      for (const name of Object.keys(subject.variables).filter((each) => !Object.hasOwn(at, each))) {
        problems.push(problem("point", `${path}.at`, `The point does not name "${name}". Each point of an app case names the variables of its first point.`));
      }
    }
    for (const [name, amount] of Object.entries(at)) {
      const where = `${path}.at.${name}`;
      const variable = Object.hasOwn(subject.variables, name) ? subject.variables[name] : undefined;
      if (variable === undefined) {
        const known = Object.keys(subject.variables).join(", ");
        const why = subject.ranged ? `The subject "${subject.name}" has no variable "${name}". Its variables are ${known}.` : `The first point of the app case does not name "${name}". It names ${known}.`;
        problems.push(problem("point", where, why));
      } else if (!isQuantity(amount) || !convertible(amount.unit, variable.unit)) {
        problems.push(problem("point", where, `"${name}" is not an amount in a unit that converts to "${variable.unit}".`));
      } else if (subject.ranged) {
        const value = valueIn(amount, variable.unit);
        if (!(value >= variable.min && value <= variable.max)) {
          problems.push(problem("point", where, `"${name}" is ${value} ${variable.unit}. It must be from ${variable.min} to ${variable.max} ${variable.unit}.`));
        }
      }
    }
  });
  return problems;
};

/**
 * This function examines a start case and gives each problem that it finds. A case with no problem gives
 * an empty list.
 *
 * It examines the format, the id, the title, the subject and each commit. It examines the arms and the
 * points: each id is different, and each amount is in the range of a variable of the subject. Then it
 * examines the seed, the rounds, the times, the ready windows, the target and the observations.
 */
export const startCaseProblems = (value: StartCase): readonly StartProblem[] => {
  if (!isRecord(value)) return [problem("shape", "", "The start case is not a record.")];
  const problems: StartProblem[] = [];
  if (value.format !== START_FORMAT) problems.push(problem("format", "format", `The format is not "${START_FORMAT}".`));
  if (typeof value.id !== "string" || !SLUG.test(value.id)) problems.push(problem("id", "id", 'The id is not lower-case words joined by ".", "-" or "/".'));
  if (typeof value.title !== "string" || value.title.trim() === "") problems.push(problem("id", "title", "The case has no title."));
  const app = value.app !== undefined;
  let scope: PointScope | undefined;
  if (app) {
    if (typeof value.app !== "string" || !isHttps(value.app)) problems.push(problem("subject", "app", "The app is not the HTTPS URL of a repository."));
    if (typeof value.subject !== "string" || !SLUG.test(value.subject)) {
      problems.push(problem("subject", "subject", 'The subject of an app case is the id of its contract: lower-case words joined by ".", "-" or "/".'));
    }
    scope = { name: String(value.subject), variables: appVariablesOf(value.points), ranged: false };
  } else {
    const subject = typeof value.subject === "string" && Object.hasOwn(START_SUBJECTS, value.subject) ? START_SUBJECTS[value.subject] : undefined;
    if (subject === undefined) problems.push(problem("subject", "subject", `The subject is not one of ${Object.keys(START_SUBJECTS).join(", ")}.`));
    else scope = { ...subject, ranged: true };
  }
  if (typeof value.seeder !== "string" || !COMMIT.test(value.seeder)) problems.push(problem("commit", "seeder", "The seeder is not a commit of 40 lower-case hexadecimal digits."));
  problems.push(...armProblems(value.arms, app), ...pointProblems(value.points, scope));
  if (typeof value.seed !== "string" || value.seed.trim() === "") problems.push(problem("seed", "seed", "The case has no seed: a text that is not empty."));
  if (!Number.isInteger(value.rounds) || value.rounds < 1 || value.rounds > MAX_START_ROUNDS) {
    problems.push(problem("rounds", "rounds", `The count of rounds is not a whole number from 1 to ${MAX_START_ROUNDS}.`));
  }
  if (!isTimeUpTo(value.watch, MAX_WATCH)) problems.push(problem("time", "watch", `The watch is not a time above 0 and up to ${MAX_WATCH.value} ${MAX_WATCH.unit}.`));
  if (!isTimeUpTo(value.limit, MAX_START)) problems.push(problem("time", "limit", `The limit is not a time above 0 and up to ${MAX_START.value} ${MAX_START.unit}.`));
  if (!isTimeUpTo(value.probe, MAX_PROBE)) problems.push(problem("time", "probe", `The probe interval is not a time above 0 and up to ${MAX_PROBE.value} ${MAX_PROBE.unit}.`));
  if (value.samples !== undefined && !(isTimeUpTo(value.samples, MAX_SAMPLES) && valueIn(value.samples, "s") >= valueIn(MIN_SAMPLES, "s"))) {
    problems.push(problem("time", "samples", `The sample interval is not a time from ${MIN_SAMPLES.value} ${MIN_SAMPLES.unit} to ${MAX_SAMPLES.value} ${MAX_SAMPLES.unit}.`));
  }
  problems.push(...windowProblems(value.windows, isTimeUpTo(value.limit, MAX_START) ? value.limit : MAX_START), ...targetProblems(value.target), ...observedProblems(value));
  return problems;
};

/** This function tells if a value is an amount of data with a whole count of bytes, `min` or more. */
const isBytesFrom = (value: unknown, min: number): value is Quantity => {
  if (!isQuantity(value) || !convertible(value.unit, "B")) return false;
  const bytes = valueIn(value, "B");
  return Number.isSafeInteger(bytes) && bytes >= min;
};

/** This function gives the problems of the ready windows of a start case: each window is a time up to the limit, in ascending order. */
const windowProblems = (windows: unknown, limit: Quantity): readonly StartProblem[] => {
  if (!Array.isArray(windows) || windows.length === 0) return [problem("time", "windows", "The case has no ready window. A window is the time of the supervisor to the first ready probe.")];
  const problems: StartProblem[] = [];
  windows.forEach((window: unknown, index) => {
    if (!isTimeUpTo(window, limit)) problems.push(problem("time", `windows[${index}]`, `The window is not a time above 0 and up to the limit, ${limit.value} ${limit.unit}.`));
    else if (index > 0 && isTimeUpTo(windows[index - 1], limit) && !(valueIn(window, "s") > valueIn(windows[index - 1] as Quantity, "s"))) {
      problems.push(problem("time", `windows[${index}]`, "The windows are not in ascending order with no repeat."));
    }
  });
  return problems;
};

/** This function gives the problems of the target of a start case. */
const targetProblems = (target: unknown): readonly StartProblem[] => {
  if (!isRecord(target)) return [problem("target", "target", "The target is not a record.")];
  const { image, node, memory, swap, cpus, heapLimit } = target as Partial<StartTarget>;
  const problems: StartProblem[] = [];
  if (typeof image !== "string" || !IMAGE.test(image)) problems.push(problem("target", "target.image", "The image is not a name of Docker with a tag or a digest and no space."));
  if (typeof node !== "string" || !NODE_VERSION.test(node)) problems.push(problem("target", "target.node", 'The Node version is not "v" and three whole numbers, for example "v24.21.0".'));
  if (!isBytesFrom(memory, MIN_CONTAINER_MEMORY)) problems.push(problem("target", "target.memory", `The memory is not a whole number of bytes, ${MIN_CONTAINER_MEMORY} or more.`));
  if (!isBytesFrom(swap, 0)) problems.push(problem("target", "target.swap", "The swap is not a whole number of bytes, 0 or more."));
  if (!(Number.isInteger(cpus) && (cpus as number) >= 1 && (cpus as number) <= MAX_TARGET_CPUS)) {
    problems.push(problem("target", "target.cpus", `The count of CPUs is not a whole number from 1 to ${MAX_TARGET_CPUS}.`));
  }
  if (heapLimit !== null && !isBytesFrom(heapLimit, 1)) problems.push(problem("target", "target.heapLimit", "The heap limit is not null or a whole number of bytes above 0."));
  const { disk, cache, others } = target as Partial<StartTarget>;
  if (disk !== undefined) problems.push(...diskProblems(disk));
  if (cache !== undefined && !START_CACHES.includes(cache)) problems.push(problem("target", "target.cache", `The cache is not one of ${START_CACHES.join(", ")}.`));
  problems.push(...ballastProblems(others, "target.others", "target"));
  return problems;
};

/** These units are the units of the limits of a disk. Each limit converts to its unit. */
export const DISK_UNITS: Readonly<Record<Exclude<keyof StartDisk, "source">, string>> = { readBytes: "B/s", readOps: "{read}/s", writeBytes: "B/s", writeOps: "{write}/s" };

/** This function gives the problems of the disk of a target. Each limit is a whole rate of 1 or more in its unit, and the disk has a source. */
const diskProblems = (disk: unknown): readonly StartProblem[] => {
  if (!isRecord(disk)) return [problem("target", "target.disk", "The disk is not a record.")];
  const problems: StartProblem[] = [];
  for (const [name, unit] of Object.entries(DISK_UNITS)) {
    const rate = disk[name];
    const value = isQuantity(rate) && convertible(rate.unit, unit) ? valueIn(rate, unit) : Number.NaN;
    if (!(Number.isSafeInteger(value) && value >= 1)) problems.push(problem("target", `target.disk.${name}`, `The limit is not a whole number of "${unit}", 1 or more.`));
  }
  if (typeof disk["source"] !== "string" || disk["source"].trim() === "") problems.push(problem("target", "target.disk.source", "The disk has no source."));
  return problems;
};

/** This function gives the problems of a list of ballasts. Each one has a whole number of bytes above 0, a moment and a text of what it models. */
const ballastProblems = (list: unknown, path: string, code: StartProblemCode): readonly StartProblem[] => {
  if (list === undefined) return [];
  if (!Array.isArray(list)) return [problem(code, path, "The ballasts are not a list.")];
  const problems: StartProblem[] = [];
  list.forEach((each: unknown, index) => {
    const where = `${path}[${index}]`;
    if (!isRecord(each)) {
      problems.push(problem(code, where, "The ballast is not a record."));
      return;
    }
    if (!isBytesFrom(each["bytes"], 1)) problems.push(problem(code, `${where}.bytes`, "The ballast is not a whole number of bytes above 0."));
    if (!BALLAST_MOMENTS.includes(each["at"] as BallastMoment)) problems.push(problem(code, `${where}.at`, `The moment is not one of ${BALLAST_MOMENTS.join(", ")}.`));
    if (typeof each["models"] !== "string" || each["models"].trim() === "") problems.push(problem(code, `${where}.models`, "The ballast does not tell what it models."));
  });
  return problems;
};

/** This function gives the problems of the observations of a start case: each one names a point, an arm and a window of the case. */
const observedProblems = (value: StartCase): readonly StartProblem[] => {
  if (!Array.isArray(value.observed)) return [problem("observed", "observed", "The observations are not a list.")];
  const points = new Set(Array.isArray(value.points) ? value.points.map((point) => point?.id) : []);
  const arms = new Set(Array.isArray(value.arms) ? value.arms.map((arm) => arm?.id) : []);
  const windows = Array.isArray(value.windows) ? value.windows.filter((window) => isTimeUpTo(window, MAX_START)).map((window) => valueIn(window, "s")) : [];
  const problems: StartProblem[] = [];
  value.observed.forEach((each: unknown, index) => {
    const path = `observed[${index}]`;
    if (!isRecord(each)) {
      problems.push(problem("observed", path, "The observation is not a record."));
      return;
    }
    const { point, arm, window, ready, source } = each as Partial<StartObservation>;
    if (!points.has(point)) problems.push(problem("observed", `${path}.point`, "The point is not a point of the case."));
    if (!arms.has(arm)) problems.push(problem("observed", `${path}.arm`, "The arm is not an arm of the case."));
    if (!(isTimeUpTo(window, MAX_START) && windows.includes(valueIn(window, "s")))) problems.push(problem("observed", `${path}.window`, "The window is not a window of the case."));
    if (typeof ready !== "boolean") problems.push(problem("observed", `${path}.ready`, "The field ready is not true or false."));
    if (typeof source !== "string" || source.trim() === "") problems.push(problem("observed", `${path}.source`, "The observation has no source."));
  });
  return problems;
};

/**
 * This function gives the amount of a variable in a record of amounts, in the unit of the variable. It is the amount
 * of the record, or the `min` of the variable when the record does not name it. An amount of a wrong kind gives NaN.
 */
const amountOf = (at: Readonly<Record<string, unknown>>, name: string, variable: StartVariable): number => {
  const amount = at[name];
  if (amount === undefined) return variable.min;
  return isQuantity(amount) && convertible(amount.unit, variable.unit) ? valueIn(amount, variable.unit) : Number.NaN;
};

/** This function gives the amount of each variable of the subject at a point: the amount of the point, or the `min` of the variable. */
export const pointAmounts = (subject: StartVariables, point: StartPoint): Readonly<Record<string, number>> =>
  Object.fromEntries(Object.entries(subject.variables).map(([name, variable]) => [name, amountOf(point.at, name, variable)]));

/** This function tells if two records of amounts give the same amount of each variable of a subject. A variable that a record does not name has its `min`. */
const sameAmounts = (subject: StartVariables, a: unknown, b: unknown): boolean =>
  isRecord(a) && isRecord(b) && Object.entries(subject.variables).every(([name, variable]) => amountOf(a, name, variable) === amountOf(b, name, variable));

/** This function gives the byte size of a point: the sum of the amounts of the variables in a unit of data. */
export const pointBytes = (subject: StartVariables, point: StartPoint): number =>
  Object.entries(pointAmounts(subject, point)).reduce((sum, [name, amount]) => {
    const { unit } = subject.variables[name]!;
    return sum + (convertible(unit, "B") ? valueIn(quantity(amount, unit), "B") : 0);
  }, 0);

/** This function tells if a case of a plan is a start case: a record with the format `capacity-start/1`. */
export const isStartCase = (value: unknown): value is StartCase => isRecord(value) && value["format"] === START_FORMAT;

/** This function gives the subject of a start case. It throws a `RangeError` for a subject that `START_SUBJECTS` does not have. */
export const startSubjectOf = (value: StartCase): StartSubject => {
  const subject = Object.hasOwn(START_SUBJECTS, value.subject) ? START_SUBJECTS[value.subject] : undefined;
  if (subject === undefined) throw new RangeError(`The lab has no start subject "${value.subject}".`);
  return subject;
};

/** This function gives the variables of the points of a start case. For an app case, they are the variables that its first point names. */
export const startVariablesOf = (value: StartCase): StartVariables => (value.app === undefined ? startSubjectOf(value) : { variables: appVariablesOf(value.points) });

/** This function gives the count of the trees of a start case: one for each arm. The seeder gets one more tree when no arm without a graft has its commit. */
export const treesOf = (value: StartCase): number => value.arms.length + (value.arms.some((arm) => arm.commit === value.seeder && (arm.graft ?? []).length === 0) ? 0 : 1);

/** This function gives the count of the type checks of a start case: one for each arm with a graft. */
export const checksOf = (value: StartCase): number => value.arms.filter((arm) => (arm.graft ?? []).length > 0).length;

/** This function gives the count of the children of a start case in one job. Each point has one child of each arm and one A/A child in each round. */
export const childrenOf = (value: StartCase): number => value.points.length * value.rounds * (value.arms.length + 1);

/** This function gives the count of the first starts of a start case. Each arm starts one time on the earlier point of each point with the field `after`. */
export const firstStartsOf = (value: StartCase): number => value.points.filter((point) => point.after !== undefined).length * value.arms.length;

/**
 * This function gives the longest time of one job of a start case. It is the margin of each step of the image, of each tree
 * and of each type check. It also has the time of the seeds at `SEED_RATE`, and the longest time of each child and of each first start.
 * The longest child is the limit, the watch and `CHILD_MARGIN`. A job in this time cannot stop a child. A point with the field `after` has no seed.
 */
export const startWindowOf = (value: StartCase): Quantity => {
  const subject = startVariablesOf(value);
  const bytes = value.points.filter((point) => point.after === undefined).reduce((sum, point) => sum + pointBytes(subject, point), 0);
  const child = valueIn(value.limit, "s") + valueIn(value.watch, "s") + valueIn(CHILD_MARGIN, "s");
  const steps = IMAGE_STEPS * valueIn(IMAGE_MARGIN, "s") + (treesOf(value) + checksOf(value)) * valueIn(TREE_MARGIN, "s");
  return quantity(steps + bytes / SEED_RATE + (childrenOf(value) + firstStartsOf(value)) * child, "s");
};
