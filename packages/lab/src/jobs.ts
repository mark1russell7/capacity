import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Composition, Law } from "@mark1russell7/capacity";
import { readComposition, readLaw } from "@mark1russell7/capacity/schema";
import type { LawJob } from "./laws.ts";
import { RECORD_FORMAT, type CaseRecord } from "./record.ts";
import { START_RECORD_FORMAT, type StartRecord } from "./start-measure.ts";
import { MANIFEST, TIMED_FORMAT, type Timed } from "./timed.ts";

/** This text is the end of the name of a law file. */
export const LAW_SUFFIX = ".law.json";

/** This text is the end of the name of a composition file. */
export const COMPOSITION_SUFFIX = ".composition.json";

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, "utf8"));

/** The options of a reader of the records of a CI run. */
export interface ReadOptions {
  /** This flag keeps only the files of the latest try of each artifact (`latestAttempts`). The default is false: each file. */
  readonly latest?: boolean;
}

/** This pattern splits the name of an artifact of a CI run into its stem and its try: `<stem>-<attempt>`. */
const ATTEMPT = /^(.+)-(\d+)$/;

/**
 * This function keeps the paths of the latest try of each artifact. The first folder of each path is the name of an artifact,
 * `<stem>-<attempt>`. A rerun of failed jobs uploads only the artifacts of those jobs, with the next try. The other artifacts
 * keep the try of their job. Thus each stem keeps the folder of its highest try. A path with no such folder stays.
 */
export const latestAttempts = (paths: readonly string[]): readonly string[] => {
  const topOf = (path: string): string | undefined => {
    const parts = path.split(/[\\/]/);
    return parts.length > 1 ? parts[0] : undefined;
  };
  const highest = new Map<string, number>();
  for (const path of paths) {
    const match = ATTEMPT.exec(topOf(path) ?? "");
    if (match !== null) highest.set(match[1]!, Math.max(highest.get(match[1]!) ?? 0, Number(match[2])));
  }
  return paths.filter((path) => {
    const match = ATTEMPT.exec(topOf(path) ?? "");
    return match === null || highest.get(match[1]!) === Number(match[2]);
  });
};

/** This function gives the paths of the files of a folder and of its subfolders, with the option `latest`. */
export const recordPaths = (folder: string, options: ReadOptions = {}): readonly string[] => {
  const paths = readdirSync(folder, { recursive: true, encoding: "utf8" });
  return options.latest === true ? latestAttempts(paths) : paths;
};

/**
 * This function gives each job of a folder. A job is a manifest `timed.json` in the folder or in a subfolder. The job
 * also has the records of its cases of load and of its start cases. The order of the jobs is the order of the paths of their manifests.
 * With the option `latest`, each artifact gives only its latest try.
 *
 * It throws an `Error` for a manifest of another format.
 */
export const readJobs = (folder: string, options: ReadOptions = {}): readonly LawJob[] =>
  recordPaths(folder, options)
    .filter((name) => basename(name) === MANIFEST)
    .sort()
    .map((name) => {
      const file = join(folder, name);
      const timed = readJson(file) as Timed;
      if (timed.format !== TIMED_FORMAT) throw new Error(`The file ${file} is not a manifest of the format "${TIMED_FORMAT}".`);
      const all = timed.files.map((each) => readJson(join(dirname(file), each.record)) as { readonly format?: unknown });
      const records = all.filter((record): record is CaseRecord => record.format === RECORD_FORMAT);
      const starts = all.filter((record): record is StartRecord => record.format === START_RECORD_FORMAT);
      return { timed, records, starts };
    });

/**
 * This function reads one law file with `readLaw` of `@mark1russell7/capacity`. It throws an `Error` for a file that is not a
 * correct law, with each problem of the file.
 */
export const readLawFile = (file: string): Law => {
  const result = readLaw(readJson(file));
  if (result.tag === "err") throw new Error(`The file ${file} is not a correct law:\n${result.error.map((each) => `  ${each.path}: ${each.message}`).join("\n")}`);
  return result.value;
};

/**
 * This function gives each law of a folder: each file `<id>.law.json` in the folder or in a subfolder (`readLawFile`).
 * The order of the laws is the order of their paths. It throws an `Error` for a file that is not a correct law.
 */
export const readLaws = (folder: string): readonly Law[] =>
  readdirSync(folder, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(LAW_SUFFIX))
    .sort()
    .map((name) => readLawFile(join(folder, name)));

/**
 * This function gives each composition of a folder: each file `<id>.composition.json` in the folder or in a subfolder. It
 * reads each file with `readComposition` of `@mark1russell7/capacity`. The order of the compositions is the order of their paths.
 * It throws an `Error` for a file that is not a correct composition, with each problem of the file.
 */
export const readCompositions = (folder: string): readonly Composition[] =>
  readdirSync(folder, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(COMPOSITION_SUFFIX))
    .sort()
    .map((name) => {
      const file = join(folder, name);
      const result = readComposition(readJson(file));
      if (result.tag === "err") throw new Error(`The file ${file} is not a correct composition:\n${result.error.map((each) => `  ${each.path}: ${each.message}`).join("\n")}`);
      return result.value;
    });
