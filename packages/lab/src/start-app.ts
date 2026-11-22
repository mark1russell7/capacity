import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { APP_FILE, fillPlaceholders, placeholdersOf, type AppCommand, type AppContract, type AppReady } from "@mark1russell7/capacity";
import { readApp } from "@mark1russell7/capacity/schema";
import { isRecord } from "@mark1russell7/optional/read";
import { convertible, isQuantity, quantity, valueIn, type Quantity } from "@mark1russell7/quantity";
import { errorMessage } from "@mark1russell7/text";
import { satisfies, validRange } from "semver";
import type { StartCase, StartPoint, StartProblem, StartVariable, StartVariables } from "./start.ts";

/** This name is the file of the child program of an app case, in the folder `src/subject`. It starts the run of the contract. */
export const APP_START_PROGRAM = "app-start.main.ts";

/** The contract of one tree of an app case: the id of the tree, its contract, and the range of Node in its `package.json`. */
export interface TreeApp {
  /** This id is the id of an arm, or `seeder` for the tree of the seed. */
  readonly tree: string;
  readonly app: AppContract;
  /** This range is the field `engines.node` of the `package.json` at the root of the tree, or undefined when it is not there. */
  readonly engines: string | undefined;
}

/**
 * The run file of an arm is the run of its contract for the program `app-start`. The texts of the arguments and of the
 * environment hold the tokens of `slots` in place of `{store}` and `{port}`. The program puts the folder of the store
 * and a free port in place of the tokens.
 */
export interface AppRunFile {
  readonly app: string;
  /** This path is the absolute path of the script of the run: the first argument after `node` and its options. */
  readonly script: string;
  /** This folder is the absolute folder of the run in the tree. */
  readonly cwd: string;
  /** These arguments come after the script. */
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly ready: AppReady;
  readonly slots: { readonly store: string; readonly port?: string | undefined };
}

/** These tokens are the tokens of `{store}` and `{port}` in a run file. An argument of a process cannot hold the character 0. */
export const RUN_SLOTS = { store: "\u0000store\u0000", port: "\u0000port\u0000" } as const;

/** A run of a contract in three parts: the options of Node, the script, and the arguments after the script. */
export interface RunParts {
  readonly options: readonly string[];
  readonly script: string | undefined;
  readonly args: readonly string[];
}

/**
 * This function gives the parts of the argv of a run that starts `node`. The options are the arguments that start
 * with `-`, before the first argument that does not. That argument is the script. Thus an option with a value uses
 * the form `--name=value`.
 */
export const runParts = (argv: readonly string[]): RunParts => {
  const rest = argv.slice(1);
  const at = rest.findIndex((each) => !each.startsWith("-"));
  return at === -1 ? { options: rest, script: undefined, args: [] } : { options: rest.slice(0, at), script: rest[at], args: rest.slice(at + 1) };
};

/** This function gives the values of the placeholders `{variable.<id>}` of a point: each amount in the unit of its store variable. */
export const variableValues = (app: AppContract, point: StartPoint): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Object.entries(appVariables(app).variables).flatMap(([id, variable]) => {
      const amount = point.at[id];
      return amount === undefined ? [] : [[`variable.${id}`, String(valueIn(amount, variable.unit))]];
    }),
  );

/** This function gives the placeholders of the argv and of the environment of a command. */
const commandPlaceholders = (command: AppCommand): readonly string[] => [...command.argv, ...Object.values(command.env)].flatMap(placeholdersOf);

/**
 * This function gives the run file of an arm from the contract of its tree in `dir`, and the options of Node of the run.
 * It throws a `RangeError` for a run with no script, which `appCaseProblems` refuses.
 */
export const appRunOf = (tree: TreeApp, dir: string): { readonly file: AppRunFile; readonly options: readonly string[] } => {
  const { run } = tree.app.start;
  const { options, script, args } = runParts(run.argv);
  if (script === undefined) throw new RangeError(`The run of the tree "${tree.tree}" has no script.`);
  const cwd = join(dir, run.cwd);
  const port = run.ready.kind === "http" || commandPlaceholders(run).includes("port");
  const slots = { store: RUN_SLOTS.store, ...(port ? { port: RUN_SLOTS.port } : {}) };
  const filled = fillCommand({ argv: args, cwd: run.cwd, env: run.env }, slots);
  return { file: { app: tree.app.id, script: resolve(cwd, script), cwd, args: filled.argv, env: filled.env, ready: run.ready, slots }, options };
};

/** A host command is an argv with no shell and the folder where it starts. */
export interface HostCommand {
  readonly argv: readonly string[];
  readonly cwd: string;
}

/**
 * This function reads the contract of a tree: the file `capacity-app.json` at its root, with `readApp`. It also reads the
 * field `engines.node` of the `package.json` at the root. It throws an `Error` with each problem of the contract.
 */
export const readTreeApp = (tree: string, dir: string): TreeApp => {
  const file = join(dir, APP_FILE);
  if (!existsSync(file)) throw new Error(`The tree "${tree}" has no contract file ${APP_FILE} at its root.`);
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`The contract file of the tree "${tree}" is not JSON: ${errorMessage(error)}`);
  }
  const read = readApp(data);
  if (!read.ok) throw new Error(`The contract of the tree "${tree}" has problems: ${read.error.map((each) => `${each.path}: ${each.message}`).join(" ")}`);
  const manifest = join(dir, "package.json");
  const json: unknown = existsSync(manifest) ? JSON.parse(readFileSync(manifest, "utf8")) : undefined;
  const engines = isRecord(json) && isRecord(json["engines"]) && typeof json["engines"]["node"] === "string" ? json["engines"]["node"] : undefined;
  return { tree, app: read.value, engines };
};

/** This function gives the store variables of a contract by their ids, with their units and their ranges. */
export const appVariables = (app: AppContract): StartVariables => ({
  variables: Object.fromEntries(app.variables.filter((each) => each.kind === "store").map((each): [string, StartVariable] => [each.id, { unit: each.unit, min: each.min, max: each.max }])),
});

const problem = (code: StartProblem["code"], path: string, message: string): StartProblem => ({ code, path, message });

/**
 * This function gives the problems of the run of a contract for the program `app-start`. The check of the contract
 * gives the placeholders of each command. The script and the options of Node of the run hold no placeholder. The
 * environment of the run does not set `NODE_OPTIONS`, because the process has started when the program sets it.
 */
const runProblems = (tree: string, app: AppContract): readonly StartProblem[] => {
  const problems: StartProblem[] = [];
  const of = `The contract of the tree "${tree}"`;
  const { run } = app.start;
  const { options, script } = runParts(run.argv);
  if (script === undefined) problems.push(problem("subject", "subject", `${of} has a run with no script after "node" and its options.`));
  if ([...options, script ?? ""].some((text) => placeholdersOf(text).length > 0)) problems.push(problem("subject", "subject", `${of} has a placeholder in the script of its run or in an option of Node.`));
  if (Object.hasOwn(run.env, "NODE_OPTIONS")) problems.push(problem("subject", "subject", `${of} sets NODE_OPTIONS in its run. Put the options of Node before the script of the run.`));
  return problems;
};

/**
 * This function examines an app case with the contract of each of its trees. A case with no problem gives an empty list.
 *
 * - Each contract has the id of the subject and the repository of the field `app`.
 * - The run starts `node`, because the program `app-start` imports the script of the run in its own process.
 * - The run has a script, and its options of Node hold no placeholder.
 * - The contract has no outside service. The lab does not start the fakes of services yet (CAP-64).
 * - The store variables of each contract are the variables of the points. Each amount is in the range of each contract.
 * - The Node of the target is in the range `engines.node` of each tree that has the field.
 */
export const appCaseProblems = (value: StartCase, trees: readonly TreeApp[]): readonly StartProblem[] => {
  const problems: StartProblem[] = [];
  for (const { tree, app, engines } of trees) {
    const of = `The contract of the tree "${tree}"`;
    if (app.id !== value.subject) problems.push(problem("subject", "subject", `${of} has the id "${app.id}", not the subject "${value.subject}".`));
    if (app.repository !== value.app) problems.push(problem("subject", "app", `${of} has the repository "${app.repository}", not "${String(value.app)}".`));
    if (app.start.run.argv[0] !== "node") problems.push(problem("subject", "subject", `${of} has a run that does not start "node". The lab measures the heap of the process of the run.`));
    if (app.services.length > 0) {
      problems.push(problem("subject", "subject", `${of} has the services ${app.services.map((each) => `"${each.id}"`).join(", ")}. The lab does not start the fakes of services yet (CAP-64).`));
    }
    if (engines !== undefined) {
      if (validRange(engines) === null) problems.push(problem("target", "target.node", `The field engines.node of the tree "${tree}" is "${engines}", not a range of versions.`));
      else if (!satisfies(value.target.node, engines)) problems.push(problem("target", "target.node", `The tree "${tree}" needs Node "${engines}". The target has ${value.target.node}.`));
    }
    problems.push(...runProblems(tree, app));
    const { variables } = appVariables(app);
    value.points.forEach((point, index) => {
      const path = `points[${index}].at`;
      for (const name of Object.keys(variables).filter((each) => !Object.hasOwn(point.at, each))) {
        problems.push(problem("point", path, `The point does not name the store variable "${name}" of the contract of the tree "${tree}".`));
      }
      for (const [name, amount] of Object.entries(point.at)) {
        const variable = Object.hasOwn(variables, name) ? variables[name] : undefined;
        if (variable === undefined) {
          problems.push(problem("point", `${path}.${name}`, `${of} has no store variable "${name}".`));
        } else if (!isQuantity(amount) || !convertible(amount.unit, variable.unit)) {
          problems.push(problem("point", `${path}.${name}`, `"${name}" is not an amount in a unit that converts to "${variable.unit}".`));
        } else {
          const each = valueIn(amount, variable.unit);
          if (!(each >= variable.min && each <= variable.max)) {
            problems.push(problem("point", `${path}.${name}`, `"${name}" is ${each} ${variable.unit}. ${of} accepts ${variable.min} to ${variable.max} ${variable.unit}.`));
          }
        }
      }
    });
  }
  return problems;
};

/**
 * This function puts the values of the placeholders into each text of the argv and of the environment of a command.
 * It throws a `RangeError` for a placeholder with no value.
 */
export const fillCommand = (command: AppCommand, values: Readonly<Record<string, string>>): AppCommand => {
  const fill = (text: string): string => {
    const filled = fillPlaceholders(text, values);
    if (filled === undefined) throw new RangeError(`The text "${text}" of the command has a placeholder with no value.`);
    return filled;
  };
  return { argv: command.argv.map(fill), cwd: command.cwd, env: Object.fromEntries(Object.entries(command.env).map(([name, text]) => [name, fill(text)])) };
};

/**
 * This function gives the command of a host for a filled command of a contract in a tree. A command with variables of the
 * environment starts with the POSIX program `env`, because a command of the host has no field for them.
 */
export const hostCommand = (command: AppCommand, tree: string): HostCommand => {
  const env = Object.entries(command.env).map(([name, text]) => `${name}=${text}`);
  return { argv: env.length === 0 ? command.argv : ["env", ...env, ...command.argv], cwd: join(tree, command.cwd) };
};

/**
 * This function reads the amounts of the last line of the output of a seed. The field `amounts` of the line has an amount of
 * 0 or more for each store variable, in the unit of the variable. The function throws an `Error` for a line that does not give them.
 */
export const seedAmountsOf = (stdout: string, app: AppContract): Readonly<Record<string, Quantity>> => {
  const last = stdout.trim().split("\n").at(-1) ?? "";
  let line: unknown;
  try {
    line = JSON.parse(last);
  } catch {
    throw new Error(`The last line of the seed of "${app.id}" is not JSON: ${last.slice(-200)}`);
  }
  const amounts = isRecord(line) ? line["amounts"] : undefined;
  if (!isRecord(amounts)) throw new Error(`The last line of the seed of "${app.id}" has no record "amounts".`);
  const out: Record<string, Quantity> = {};
  for (const [id, variable] of Object.entries(appVariables(app).variables)) {
    const amount = amounts[id];
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) throw new Error(`The seed of "${app.id}" gave no amount of 0 or more for the store variable "${id}".`);
    out[id] = quantity(amount, variable.unit);
  }
  return out;
};
