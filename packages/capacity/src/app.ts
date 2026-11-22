// The contract of an app: the one record that tells the lab and the models how to load an app, how to
// start it, and how to read its live metrics. Each app gives the same contract, from the bare subjects
// of layer 1 to the apps of layer 3.

import type { Problem, Scale } from "./law.ts";

/** This text is the format of the contract file of an app. */
export const APP_FORMAT = "capacity-app/1";

/** This name is the contract file of an app, at the root of its repository. */
export const APP_FILE = "capacity-app.json";

/**
 * The kind of a load variable tells where the amount is.
 *
 * - `request`: an amount of one request of a class, for example the bytes of its body.
 * - `level`: an amount that stays in the app and does not come with each request, for example the open incidents.
 * - `store`: an amount of a store at the start of the app, for example the bytes of its log.
 */
export type VariableKind = "request" | "level" | "store";

/**
 * A range tells the amounts of a variable that the app accepts and that a run can measure. The unit
 * is a canonical unit of `@mark1russell7/quantity`. A range on the scale `log` starts above 0.
 */
export interface AppRange {
  readonly unit: string;
  readonly min: number;
  readonly max: number;
  readonly scale: Scale;
}

/** A load variable of an app is one amount that a workload or a start case sets. A program of a law reads it by its id. */
export interface AppVariable extends AppRange {
  readonly id: string;
  readonly title: string;
  readonly kind: VariableKind;
}

/**
 * A request of HTTP comes from a client of the app. The path is a template: each `{id}` in it is a request
 * variable of the class. The variable `body`, when it is there, gives the bytes of the body of the request.
 */
export interface HttpEntry {
  readonly kind: "http";
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly path: string;
  readonly body?: string | undefined;
}

/**
 * A service entry tells that the load of a class comes from an outside service that the app calls. The
 * fake of the service reads the workload, and it gives the app the requests of the class at their rates.
 */
export interface ServiceEntry {
  readonly kind: "service";
  readonly service: string;
}

/** An entry tells how the requests of a class get to the app: from a client of HTTP, or from an outside service. */
export type AppEntry = HttpEntry | ServiceEntry;

/**
 * A class of an app is one kind of request. `rate` is the range of its rate, in a count in a unit of
 * time. `request` names the request variables of one request, by their ids.
 */
export interface AppClass {
  readonly id: string;
  readonly title: string;
  readonly rate: AppRange;
  readonly request: readonly string[];
  readonly entry: AppEntry;
}

/**
 * A command is a program and its arguments, with no shell. `cwd` is the folder of the command, relative to
 * the root of the repository. `env` gives the environment variables that the command adds.
 *
 * Each text of `argv` and of `env` can hold placeholders. The lab puts in their values before the start:
 *
 * - `{port}`: the port of the listener of the process.
 * - `{store}`: the folder of the store of the app.
 * - `{workload}`: the path of the workload file of the run.
 * - `{service.<id>}`: the base URL of the fake of the service `<id>`.
 * - `{variable.<id>}`: the amount of the store or level variable `<id>` at the point, in the unit of the variable.
 *
 * The run holds `{port}` when a class comes from HTTP or the ready signal is `http`. The seed and the run hold
 * `{store}` when the app has a store variable. The seed can hold `{variable.<id>}` of a store or a level variable,
 * for example the routes of a configuration. The fake of each service holds `{port}`, and `{workload}` when a class comes from the service.
 */
export interface AppCommand {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}

/**
 * The ready signal tells that a process serves. `line` is a text in a line of the output of the process.
 * `http` is a path of the process that gives a status of 200.
 */
export type AppReady = { readonly kind: "line"; readonly text: string } | { readonly kind: "http"; readonly path: string };

/** A process is a command that runs until the lab stops it, and its ready signal. */
export interface AppProcess extends AppCommand {
  readonly ready: AppReady;
}

/**
 * The start of an app tells how to make it run in a tree of its repository.
 *
 * - `install` installs the dependencies of the tree. An app with no dependencies has no install.
 * - `check` examines the tree after the install, for example with a typecheck.
 * - `seed` writes the store of a start case at the amounts of the store variables. An app with no store variable has no seed.
 *   The last line of the output of the seed is a JSON record. Its field `amounts` gives the amount of each store variable
 *   that the seed wrote, by its id, in the unit of the variable.
 * - `run` is the process of the app.
 */
export interface AppStart {
  readonly install?: AppCommand | undefined;
  readonly check?: AppCommand | undefined;
  readonly seed?: AppCommand | undefined;
  readonly run: AppProcess;
}

/**
 * An outside service of an app is a service of others that the app calls, for example a feed or a channel
 * of messages. The lab starts the fake of the service in place of the service, and the app gets its URL.
 */
export interface AppService {
  readonly id: string;
  readonly title: string;
  readonly fake: AppProcess;
}

/**
 * The target of a series tells what the series measures.
 *
 * - `rate`: a counter of the requests of a class. Its rate is the rate of the class.
 * - `level`: a gauge of a level variable.
 * - `total`: a counter of the sum of a request variable over the requests of a class. Its increase over
 *   the increase of the counter of the class is the mean of the variable.
 * - `measure`: a counter or a gauge of a measure of the laws of the app, for example its CPU time.
 */
export type SeriesTarget =
  | { readonly rate: string }
  | { readonly level: string }
  | { readonly total: string; readonly class: string }
  | { readonly measure: string };

/**
 * A series is one live metric of an app. Its `id` is the name of the metric in the readings of the app.
 * A counter only goes up, until the process starts again. A gauge is an amount at the time of its reading.
 */
export interface AppSeries {
  readonly id: string;
  readonly kind: "counter" | "gauge";
  readonly unit: string;
  readonly of: SeriesTarget;
}

/**
 * The contract of an app is the record that each app gives to the lab and to the models. A contract file
 * is this record as JSON. The `id` is the subject of the laws of the app.
 */
export interface AppContract {
  readonly format: typeof APP_FORMAT;
  readonly id: string;
  readonly title: string;
  /** This URL is the public HTTPS URL of the repository of the app. */
  readonly repository: string;
  readonly variables: readonly AppVariable[];
  readonly classes: readonly AppClass[];
  readonly start: AppStart;
  readonly services: readonly AppService[];
  readonly metrics: readonly AppSeries[];
}

/** An app problem code names the part of a contract, or of a workload against a contract, that is not correct. */
export type AppProblemCode =
  | "shape"
  | "format"
  | "id"
  | "range"
  | "unit"
  | "variable"
  | "class"
  | "entry"
  | "command"
  | "placeholder"
  | "service"
  | "series"
  | "workload";

/** An app problem tells what is not correct, and where: `path` is the path of the field in the contract or in the workload. */
export type AppProblem = Problem<AppProblemCode>;

/**
 * A gap is one part of the demand of an app that its live metrics cannot give. `need` names the series that
 * is not there. It is the counter of a class, the gauge of a level, or the counter of a total.
 */
export interface MetricsGap {
  readonly need: "rate" | "level" | "total";
  readonly class?: string | undefined;
  readonly variable?: string | undefined;
  readonly message: string;
}
