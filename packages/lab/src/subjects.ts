import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

/** This folder is where the files of a subject are in its container. */
export const SUBJECT_FOLDER = "/opt/subject";

/**
 * A lab subject is a program that a run measures, as data. Its image is a stock image, pinned by
 * its digest, and its files go into the container before it starts. Thus the image stays stock.
 */
export interface LabSubject {
  /** This name is the id of the subject in a law and in a record, for example `node-http`. */
  readonly name: string;
  /** This image is the stock image of the subject: `name@sha256:<64 hex digits>`. */
  readonly image: string;
  /** These names are the files of the subject, in the folder `src/subject` of this package. They go into the container as they are. */
  readonly files: readonly string[];
  /** This name is the file that Node starts. */
  readonly program: string;
  /** This text is in the line that tells that the subject serves. */
  readonly ready: string;
  /**
   * This name is a program in the folder `src/subject` that imports packages. The stock image has no packages.
   * Thus `esbuild` bundles the program with its packages, and the bundle goes into the container as `program`.
   */
  readonly bundle?: string;
}

/** This image is the stock image of Node of each subject: the Node image of the lab clients of `@mark1russell7/harness`, by the same digest. */
const NODE_IMAGE = "node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1";

/** This subject is the bare subject of layer 1: a server of `node:http` on the stock image of Node. */
export const NODE_HTTP: LabSubject = {
  name: "node-http",
  image: NODE_IMAGE,
  files: ["class.ts", "lines.ts", "node-http.main.ts", "node-http.ts", "perform.ts"],
  program: "node-http.main.ts",
  ready: '"ev":"listening"',
};

/**
 * This subject is the service subject of layer 2: the work of the bare subject through the service runner of
 * `@mark1russell7/service`. It has the flags and the lines of the bare subject. Thus a case can name either subject.
 */
export const NODE_HTTP_SERVICE: LabSubject = {
  name: "node-http-service",
  image: NODE_IMAGE,
  files: [],
  program: "node-http-service.mjs",
  ready: '"ev":"listening"',
  bundle: "node-http-service.main.ts",
};

const bundles = new Map<string, string>();

/**
 * This function gives the bundle of a program of the folder `src/subject`, with each package that it imports.
 * The bundle keeps each module of the imports, as Node loads them without a bundle (`treeShaking: false`).
 * Thus the code in memory is the code of the program and its packages. The function makes each bundle one time.
 */
export const bundleOf = (program: string): string => {
  const known = bundles.get(program);
  if (known !== undefined) return known;
  const result = buildSync({
    entryPoints: [fileURLToPath(new URL(`./subject/${program}`, import.meta.url))],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    treeShaking: false,
    write: false,
    logLevel: "silent",
  });
  const text = result.outputFiles[0]?.text;
  if (text === undefined) throw new Error(`esbuild gave no bundle of ${program}.`);
  bundles.set(program, text);
  return text;
};

/**
 * This function gives the files of a subject for its container: the path of each file in the
 * container, and its content. Node starts the program of the subject from this folder. A subject
 * with a bundle also gets its bundle as its program.
 */
export const subjectFiles = (subject: LabSubject): Readonly<Record<string, string>> => ({
  ...Object.fromEntries(
    subject.files.map((name) => [`${SUBJECT_FOLDER}/${name}`, readFileSync(new URL(`./subject/${name}`, import.meta.url), "utf8")]),
  ),
  ...(subject.bundle === undefined ? {} : { [`${SUBJECT_FOLDER}/${subject.program}`]: bundleOf(subject.bundle) }),
});
