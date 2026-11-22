import { convertible, divideUnits, isCanonicalUnit, isQuantity, kindOf, valueIn, type Quantity } from "@mark1russell7/quantity";
import {
  APP_FORMAT,
  type AppClass,
  type AppContract,
  type AppProblem,
  type AppSeries,
  type AppVariable,
  type AppCommand,
  type HttpEntry,
  type MetricsGap,
  type AppRange,
  type AppReady,
} from "./app.ts";
import { NAME, SLUG, finite } from "./names.ts";
import { RATE, type Workload } from "./workload.ts";

/** An HTTPS URL: the scheme `https`, a host, and then a path, a query or a fragment with no space. */
const HTTPS = /^https:\/\/[^\s/?#@]+(?:[/?#]\S*)?$/i;

/** This function tells if a text is an HTTPS URL. The package uses no global of a browser or of Node.js. */
const isHttps = (text: string): boolean => HTTPS.test(text);

/** This function makes a problem of a contract or of a workload against a contract. */
const appProblem = (code: AppProblem["code"], path: string, message: string): AppProblem => ({ code, path, message });

/** The name of a series: letters, digits, `_`, `.`, `/` and `-`, that start with a letter. */
const METRIC = /^[A-Za-z][A-Za-z0-9_./-]*$/;

/** The name of an environment variable: upper-case letters, digits and `_`, that start with a letter or `_`. */
const ENV = /^[A-Z_][A-Z0-9_]*$/;

const PLACEHOLDER = /\{([^{}]*)\}/g;

/** A place is a command of the contract. Each place accepts its own placeholders. */
type Place = "install" | "check" | "seed" | "run" | "fake";

/** These names are the plain placeholders that each place accepts. `service` and `variable` take an id after a `.`. */
const PLAIN: Readonly<Record<Place, readonly string[]>> = {
  install: [],
  check: [],
  seed: ["store"],
  run: ["port", "store"],
  fake: ["port", "workload"],
};

/** This function gives the names of the placeholders in a text, in their order. */
export const placeholdersOf = (text: string): readonly string[] => [...text.matchAll(PLACEHOLDER)].map((match) => match[1] ?? "");

/**
 * This function puts the value of each placeholder into a text. It gives undefined when the text holds a
 * placeholder that `values` does not give.
 */
export const fillPlaceholders = (text: string, values: Readonly<Record<string, string>>): string | undefined => {
  if (placeholdersOf(text).some((name) => !Object.hasOwn(values, name))) return undefined;
  return text.replace(PLACEHOLDER, (_match, name: string) => values[name] ?? "");
};

/**
 * This function gives the path of a request of a class of HTTP at some amounts. Each amount is a number in
 * the unit of its variable. It gives undefined when `values` does not give each variable of the path.
 */
export const requestPath = (entry: HttpEntry, values: Readonly<Record<string, number>>): string | undefined =>
  fillPlaceholders(entry.path, Object.fromEntries(Object.entries(values).map(([name, value]) => [name, encodeURIComponent(String(value))])));

/** This function gives the problems of a range: its unit, its two ends and its scale. */
const rangeProblems = (range: AppRange, path: string, owner: string): readonly AppProblem[] => {
  const problems: AppProblem[] = [];
  if (!isCanonicalUnit(range.unit)) problems.push(appProblem("unit", `${path}.unit`, `The unit "${range.unit}" of ${owner} is not a canonical unit.`));
  if (!finite(range.min) || !finite(range.max) || range.min > range.max) {
    problems.push(appProblem("range", path, `The range of ${owner} does not go from a finite amount to the same or a larger amount.`));
  } else if (range.scale === "log" && !(range.min > 0)) {
    problems.push(appProblem("range", `${path}.min`, `The range of ${owner} is on the scale "log", thus it starts above 0.`));
  }
  return problems;
};

/** This function gives the problems of the variables: the id, the title and the range of each. */
const variableProblems = (variables: readonly AppVariable[]): readonly AppProblem[] => {
  const problems: AppProblem[] = [];
  const ids = new Set<string>();
  variables.forEach((variable, index) => {
    const path = `variables[${index}]`;
    if (!NAME.test(variable.id)) {
      problems.push(appProblem("id", `${path}.id`, `The id "${variable.id}" is not letters and digits that start with a lower-case letter.`));
    } else if (variable.id === RATE) {
      problems.push(appProblem("id", `${path}.id`, `The id "${RATE}" is the rate of a class. A variable cannot use it.`));
    } else if (ids.has(variable.id)) {
      problems.push(appProblem("id", `${path}.id`, `Two variables have the id "${variable.id}".`));
    }
    ids.add(variable.id);
    if (variable.title.trim() === "") problems.push(appProblem("id", `${path}.title`, `The title of the variable "${variable.id}" is empty.`));
    problems.push(...rangeProblems(variable, path, `the variable "${variable.id}"`));
  });
  return problems;
};

/** This function gives the problems of the entry of a class. An entry of HTTP sets each request variable of the class. */
const entryProblems = (app: AppContract, entry: AppClass, path: string): readonly AppProblem[] => {
  const problems: AppProblem[] = [];
  const at = `${path}.entry`;
  if (entry.entry.kind === "service") {
    const { service } = entry.entry;
    if (!app.services.some((each) => each.id === service)) {
      problems.push(appProblem("service", `${at}.service`, `The class "${entry.id}" names the service "${service}", and the app has no service with that id.`));
    }
    return problems;
  }
  const { path: template, body } = entry.entry;
  if (!template.startsWith("/")) problems.push(appProblem("entry", `${at}.path`, `The path of the class "${entry.id}" does not start with "/".`));
  const named = placeholdersOf(template);
  for (const name of named) {
    if (!entry.request.includes(name)) {
      problems.push(appProblem("placeholder", `${at}.path`, `The path of the class "${entry.id}" holds "{${name}}", and "${name}" is not a request variable of the class.`));
    }
  }
  if (body !== undefined) {
    const variable = app.variables.find((each) => each.id === body);
    if (!entry.request.includes(body)) {
      problems.push(appProblem("entry", `${at}.body`, `The body of the class "${entry.id}" is the variable "${body}", and it is not a request variable of the class.`));
    } else if (variable !== undefined && isCanonicalUnit(variable.unit) && !convertible(variable.unit, "B")) {
      problems.push(appProblem("unit", `${at}.body`, `The body of the class "${entry.id}" is the variable "${body}" in "${variable.unit}", not in bytes.`));
    }
  }
  for (const name of entry.request) {
    if (!named.includes(name) && name !== body) {
      problems.push(appProblem("entry", at, `A request of the class "${entry.id}" cannot set the variable "${name}": neither the path nor the body holds it.`));
    }
  }
  return problems;
};

/** This function gives the problems of the classes: the id, the rate, the request variables and the entry of each. */
const classProblems = (app: AppContract): readonly AppProblem[] => {
  const problems: AppProblem[] = [];
  const ids = new Set<string>();
  app.classes.forEach((entry, index) => {
    const path = `classes[${index}]`;
    if (!SLUG.test(entry.id)) {
      problems.push(appProblem("id", `${path}.id`, `The id "${entry.id}" is not lower-case words joined by ".", "-" or "/".`));
    } else if (ids.has(entry.id)) {
      problems.push(appProblem("id", `${path}.id`, `Two classes have the id "${entry.id}".`));
    }
    ids.add(entry.id);
    if (entry.title.trim() === "") problems.push(appProblem("id", `${path}.title`, `The title of the class "${entry.id}" is empty.`));
    problems.push(...rangeProblems(entry.rate, `${path}.rate`, `the rate of the class "${entry.id}"`));
    if (isCanonicalUnit(entry.rate.unit) && kindOf(entry.rate.unit) !== "frequency") {
      problems.push(appProblem("unit", `${path}.rate.unit`, `The rate of the class "${entry.id}" is in "${entry.rate.unit}". A rate is a count in a unit of time, for example "{request}/s".`));
    }
    entry.request.forEach((name, place) => {
      const variable = app.variables.find((each) => each.id === name);
      if (variable === undefined) {
        problems.push(appProblem("variable", `${path}.request[${place}]`, `The class "${entry.id}" names the variable "${name}", and the app has no variable with that id.`));
      } else if (variable.kind !== "request") {
        problems.push(appProblem("variable", `${path}.request[${place}]`, `The variable "${name}" is a ${variable.kind} variable, not a request variable.`));
      } else if (entry.request.indexOf(name) !== place) {
        problems.push(appProblem("variable", `${path}.request[${place}]`, `The class "${entry.id}" names the variable "${name}" two times.`));
      }
    });
    problems.push(...entryProblems(app, entry, path));
  });
  app.variables.forEach((variable, index) => {
    if (variable.kind === "request" && !app.classes.some((entry) => entry.request.includes(variable.id))) {
      problems.push(appProblem("variable", `variables[${index}]`, `No class has the request variable "${variable.id}".`));
    }
  });
  return problems;
};

/** This function gives the problems of the placeholders of a command at its place in the contract. */
const placeholderProblems = (app: AppContract, command: AppCommand, path: string, place: Place): readonly AppProblem[] => {
  const problems: AppProblem[] = [];
  const texts: (readonly [string, string])[] = [
    ...command.argv.map((text, index) => [`${path}.argv[${index}]`, text] as const),
    ...Object.entries(command.env).map(([name, text]) => [`${path}.env.${name}`, text] as const),
  ];
  for (const [at, text] of texts) {
    for (const name of placeholdersOf(text)) {
      const [head, ...rest] = name.split(".");
      const id = rest.join(".");
      if (rest.length === 0 && PLAIN[place].includes(name)) continue;
      if (head === "service" && place === "run" && id !== "") {
        if (!app.services.some((each) => each.id === id)) {
          problems.push(appProblem("placeholder", at, `The placeholder "{${name}}" names the service "${id}", and the app has no service with that id.`));
        }
        continue;
      }
      if (head === "variable" && place === "seed" && id !== "") {
        if (!app.variables.some((each) => each.id === id && each.kind === "store")) {
          problems.push(appProblem("placeholder", at, `The placeholder "{${name}}" names "${id}", and the app has no store variable with that id.`));
        }
        continue;
      }
      problems.push(appProblem("placeholder", at, `The command ${place} cannot hold the placeholder "{${name}}".`));
    }
  }
  return problems;
};

/** This function gives the problems of a ready signal. */
const readyProblems = (ready: AppReady, path: string): readonly AppProblem[] => {
  if (ready.kind === "line") return ready.text.trim() === "" ? [appProblem("command", `${path}.text`, "The text of the ready line is empty.")] : [];
  return ready.path.startsWith("/") ? [] : [appProblem("command", `${path}.path`, `The ready path "${ready.path}" does not start with "/".`)];
};

/** This function gives the problems of a command: its program, its folder, the names of its variables and its placeholders. */
const commandProblems = (app: AppContract, command: AppCommand, path: string, place: Place): readonly AppProblem[] => {
  const problems: AppProblem[] = [];
  if (command.argv.length === 0 || (command.argv[0] ?? "").trim() === "") {
    problems.push(appProblem("command", `${path}.argv`, `The command ${place} has no program.`));
  }
  const parts = command.cwd.split("/");
  if (command.cwd.startsWith("/") || command.cwd.includes("\\") || parts.some((part) => part === "..") || command.cwd === "") {
    problems.push(appProblem("command", `${path}.cwd`, `The folder "${command.cwd}" is not a path in the repository, with "/" and no "..". The root is ".".`));
  }
  for (const name of Object.keys(command.env)) {
    if (!ENV.test(name)) problems.push(appProblem("command", `${path}.env.${name}`, `The name "${name}" is not an environment variable: upper-case letters, digits and "_".`));
  }
  problems.push(...placeholderProblems(app, command, path, place));
  return problems;
};

/** This function tells if a command holds a placeholder. */
const holds = (command: AppCommand, placeholder: string): boolean =>
  [...command.argv, ...Object.values(command.env)].some((text) => placeholdersOf(text).includes(placeholder));

/**
 * This function gives the problems of the start and of the outside services. Each process gets its port, the
 * seed and the run get the store, and the run gets the URL of each service. The seed sets each store variable.
 */
const startProblems = (app: AppContract): readonly AppProblem[] => {
  const problems: AppProblem[] = [];
  const { install, check, seed, run } = app.start;
  if (install !== undefined) problems.push(...commandProblems(app, install, "start.install", "install"));
  if (check !== undefined) problems.push(...commandProblems(app, check, "start.check", "check"));
  problems.push(...commandProblems(app, run, "start.run", "run"), ...readyProblems(run.ready, "start.run.ready"));
  const listens = run.ready.kind === "http" || app.classes.some((entry) => entry.entry.kind === "http");
  if (listens && !holds(run, "port")) problems.push(appProblem("command", "start.run", `The run does not get its port: it does not hold "{port}".`));

  const stores = app.variables.filter((variable) => variable.kind === "store");
  if (stores.length > 0 && !holds(run, "store")) {
    problems.push(appProblem("command", "start.run", `The app has a store, and the run does not get its folder: the run does not hold "{store}".`));
  }
  if (seed === undefined) {
    if (stores.length > 0) problems.push(appProblem("command", "start", `The app has the store variables ${stores.map((each) => `"${each.id}"`).join(", ")}, and no seed.`));
  } else {
    problems.push(...commandProblems(app, seed, "start.seed", "seed"));
    if (stores.length === 0) problems.push(appProblem("command", "start.seed", "The app has a seed, and no store variable for it to set."));
    else if (!holds(seed, "store")) problems.push(appProblem("command", "start.seed", `The seed does not get the folder of the store: it does not hold "{store}".`));
    for (const variable of stores) {
      if (!holds(seed, `variable.${variable.id}`)) {
        problems.push(appProblem("command", "start.seed", `The seed cannot set the store variable "${variable.id}": it does not hold "{variable.${variable.id}}".`));
      }
    }
  }

  const ids = new Set<string>();
  app.services.forEach((service, index) => {
    const path = `services[${index}]`;
    if (!SLUG.test(service.id)) {
      problems.push(appProblem("id", `${path}.id`, `The id "${service.id}" is not lower-case words joined by ".", "-" or "/".`));
    } else if (ids.has(service.id)) {
      problems.push(appProblem("id", `${path}.id`, `Two services have the id "${service.id}".`));
    }
    ids.add(service.id);
    if (service.title.trim() === "") problems.push(appProblem("id", `${path}.title`, `The title of the service "${service.id}" is empty.`));
    problems.push(...commandProblems(app, service.fake, `${path}.fake`, "fake"), ...readyProblems(service.fake.ready, `${path}.fake.ready`));
    if (!holds(service.fake, "port")) problems.push(appProblem("command", `${path}.fake`, `The fake of "${service.id}" does not get its port: it does not hold "{port}".`));
    const feeds = app.classes.some((entry) => entry.entry.kind === "service" && entry.entry.service === service.id);
    if (feeds && !holds(service.fake, "workload")) {
      problems.push(appProblem("command", `${path}.fake`, `A class comes from "${service.id}", and its fake does not get the rates: it does not hold "{workload}".`));
    }
    if (!holds(run, `service.${service.id}`)) {
      problems.push(appProblem("service", path, `The app does not get the URL of the fake of "${service.id}": the run does not hold "{service.${service.id}}".`));
    }
  });
  return problems;
};

/** This function gives the key of the target of a series. Two series with one key measure the same thing. */
const targetKey = (series: AppSeries): string => JSON.stringify(Object.entries(series.of).sort(([a], [b]) => a.localeCompare(b)));

/** This function gives the problems of one series: its target, its kind and its unit. */
const seriesProblems = (app: AppContract, series: AppSeries, path: string): readonly AppProblem[] => {
  const problems: AppProblem[] = [];
  const at = `${path}.of`;
  const target = series.of;
  const kind = (wanted: AppSeries["kind"], what: string): void => {
    if (series.kind !== wanted) problems.push(appProblem("series", `${path}.kind`, `The series "${series.id}" gives ${what}, thus it is a ${wanted}.`));
  };
  const unit = (wanted: string, what: string): void => {
    if (isCanonicalUnit(series.unit) && isCanonicalUnit(wanted) && !convertible(series.unit, wanted)) {
      problems.push(appProblem("unit", `${path}.unit`, `The series "${series.id}" is in "${series.unit}". ${what} is in "${wanted}".`));
    }
  };
  if ("rate" in target) {
    const entry = app.classes.find((each) => each.id === target.rate);
    kind("counter", "the rate of a class");
    if (entry === undefined) return [...problems, appProblem("series", at, `The series "${series.id}" names the class "${target.rate}", and the app has no class with that id.`)];
    const perSecond = isCanonicalUnit(series.unit) ? divideUnits(series.unit, "s") : undefined;
    if (perSecond !== undefined && isCanonicalUnit(entry.rate.unit) && kindOf(entry.rate.unit) === "frequency" && !convertible(perSecond, entry.rate.unit)) {
      problems.push(appProblem("unit", `${path}.unit`, `The series "${series.id}" gives a rate in "${perSecond}". The rate of the class "${entry.id}" is in "${entry.rate.unit}".`));
    }
    return problems;
  }
  if ("level" in target) {
    const variable = app.variables.find((each) => each.id === target.level);
    kind("gauge", "a level");
    if (variable === undefined || variable.kind !== "level") {
      return [...problems, appProblem("series", at, `The series "${series.id}" names "${target.level}", and the app has no level variable with that id.`)];
    }
    unit(variable.unit, `The level "${variable.id}"`);
    return problems;
  }
  if ("total" in target) {
    const entry = app.classes.find((each) => each.id === target.class);
    const variable = app.variables.find((each) => each.id === target.total);
    kind("counter", "a total over the requests of a class");
    if (entry === undefined) return [...problems, appProblem("series", at, `The series "${series.id}" names the class "${target.class}", and the app has no class with that id.`)];
    if (variable === undefined || !entry.request.includes(variable.id)) {
      return [...problems, appProblem("series", at, `The series "${series.id}" names "${target.total}", and it is not a request variable of the class "${entry.id}".`)];
    }
    unit(variable.unit, `The variable "${variable.id}"`);
    return problems;
  }
  if (!SLUG.test(target.measure)) problems.push(appProblem("series", `${at}.measure`, `The measure "${target.measure}" is not lower-case words joined by ".", "-" or "/".`));
  return problems;
};

/** This function gives the problems of the live metrics: the id, the unit and the target of each series. */
const metricsProblems = (app: AppContract): readonly AppProblem[] => {
  const problems: AppProblem[] = [];
  const ids = new Set<string>();
  const targets = new Map<string, string>();
  app.metrics.forEach((series, index) => {
    const path = `metrics[${index}]`;
    if (!METRIC.test(series.id)) {
      problems.push(appProblem("id", `${path}.id`, `The id "${series.id}" is not a name of a metric: letters, digits, "_", ".", "/" and "-".`));
    } else if (ids.has(series.id)) {
      problems.push(appProblem("id", `${path}.id`, `Two series have the id "${series.id}".`));
    }
    ids.add(series.id);
    if (!isCanonicalUnit(series.unit)) problems.push(appProblem("unit", `${path}.unit`, `The unit "${series.unit}" of the series "${series.id}" is not a canonical unit.`));
    const key = targetKey(series);
    const before = targets.get(key);
    if (before !== undefined) problems.push(appProblem("series", `${path}.of`, `The series "${series.id}" and "${before}" measure the same thing.`));
    else targets.set(key, series.id);
    problems.push(...seriesProblems(app, series, path));
  });
  return problems;
};

/**
 * This function examines the contract of an app and gives each problem that it finds. A contract with no
 * problem gives an empty list.
 *
 * It examines the format, the id, the title and the repository. It examines each variable, each class and
 * its entry, each command and its placeholders, each outside service and each series of the live metrics.
 */
export const checkApp = (app: AppContract): readonly AppProblem[] => {
  const problems: AppProblem[] = [];
  if (app.format !== APP_FORMAT) problems.push(appProblem("format", "format", `The format is "${String(app.format)}", not "${APP_FORMAT}".`));
  if (!SLUG.test(app.id)) problems.push(appProblem("id", "id", `The id "${app.id}" is not lower-case words joined by ".", "-" or "/".`));
  if (app.title.trim() === "") problems.push(appProblem("id", "title", "The title is empty."));
  if (!isHttps(app.repository)) {
    problems.push(appProblem("id", "repository", `The repository "${app.repository}" is not an HTTPS URL.`));
  }
  return [...problems, ...variableProblems(app.variables), ...classProblems(app), ...startProblems(app), ...metricsProblems(app)];
};

/**
 * This function gives each part of the demand of an app that its live metrics cannot give. A contract whose
 * metrics give its whole demand gives an empty list. The live check of a law reads a demand with no gap.
 */
export const metricsGaps = (app: AppContract): readonly MetricsGap[] => {
  const has = (test: (series: AppSeries) => boolean): boolean => app.metrics.some(test);
  const gaps: MetricsGap[] = [];
  for (const entry of app.classes) {
    if (!has((series) => "rate" in series.of && series.of.rate === entry.id)) {
      gaps.push({ need: "rate", class: entry.id, message: `No counter gives the rate of the class "${entry.id}".` });
    }
    for (const name of entry.request) {
      if (!has((series) => "total" in series.of && series.of.total === name && series.of.class === entry.id)) {
        gaps.push({ need: "total", class: entry.id, variable: name, message: `No counter gives the total of "${name}" over the requests of the class "${entry.id}".` });
      }
    }
  }
  for (const variable of app.variables) {
    if (variable.kind === "level" && !has((series) => "level" in series.of && series.of.level === variable.id)) {
      gaps.push({ need: "level", variable: variable.id, message: `No gauge gives the level "${variable.id}".` });
    }
  }
  return gaps;
};

/** This function gives the problem of an amount against the range of its variable: its unit, then its value. */
const amountProblem = (amount: Quantity, range: AppRange, path: string, owner: string): AppProblem | undefined => {
  if (!isQuantity(amount)) return undefined;
  if (!convertible(amount.unit, range.unit)) return appProblem("unit", path, `${owner} is in "${amount.unit}", and the app gives it in "${range.unit}".`);
  const value = valueIn(amount, range.unit);
  if (value < range.min || value > range.max) {
    return appProblem("range", path, `${owner} is ${value} ${range.unit}. The app accepts ${range.min} to ${range.max} ${range.unit}.`);
  }
  return undefined;
};

/**
 * This function examines a workload against the contract of its app, and gives each problem that it finds.
 * The workload is a workload that `checkWorkload` accepts.
 *
 * Each class of the workload is a class of the app: the class that its field `of` names, or else its id. Its
 * rate and each variable of its request are in the range of the app, and it gives each request variable of
 * its class. Each level of the workload is a level variable of the app, in its range. A class or a level that
 * the workload does not give is 0.
 */
export const appWorkloadProblems = (app: AppContract, workload: Workload): readonly AppProblem[] => {
  const problems: AppProblem[] = [];
  workload.classes.forEach((entry, index) => {
    const path = `classes[${index}]`;
    const id = entry.of ?? entry.id;
    const known = app.classes.find((each) => each.id === id);
    if (known === undefined) {
      problems.push(appProblem("class", entry.of === undefined ? `${path}.id` : `${path}.of`, `The app "${app.id}" has no class "${id}".`));
      return;
    }
    const rate = amountProblem(entry.rate, known.rate, `${path}.rate`, `The rate of the class "${entry.id}"`);
    if (rate !== undefined) problems.push(rate);
    for (const [name, amount] of Object.entries(entry.request)) {
      const variable = app.variables.find((each) => each.id === name);
      if (variable === undefined || !known.request.includes(name)) {
        problems.push(appProblem("variable", `${path}.request.${name}`, `"${name}" is not a request variable of the class "${known.id}" of the app.`));
        continue;
      }
      const found = amountProblem(amount, variable, `${path}.request.${name}`, `The variable "${name}" of the class "${entry.id}"`);
      if (found !== undefined) problems.push(found);
    }
    for (const name of known.request) {
      if (!Object.hasOwn(entry.request, name)) {
        problems.push(appProblem("variable", `${path}.request`, `The class "${entry.id}" does not give the request variable "${name}" of the class "${known.id}".`));
      }
    }
  });
  for (const [name, amount] of Object.entries(workload.levels)) {
    const variable = app.variables.find((each) => each.id === name);
    if (variable === undefined || variable.kind !== "level") {
      problems.push(appProblem("variable", `levels.${name}`, `"${name}" is not a level variable of the app "${app.id}".`));
      continue;
    }
    const found = amountProblem(amount, variable, `levels.${name}`, `The level "${name}"`);
    if (found !== undefined) problems.push(found);
  }
  return problems;
};
