import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
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
   * These names are the packages that the files import, each with its export, for example `@mark1russell7/service/http`.
   * The stock image has no packages. Thus `packageFiles` puts each one into `node_modules` as JavaScript, as npm installs it.
   */
  readonly packages?: readonly string[];
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
 * Its files start from TypeScript, as the files of the bare subject and of an app do. Its package is JavaScript in `node_modules`.
 */
export const NODE_HTTP_SERVICE: LabSubject = {
  name: "node-http-service",
  image: NODE_IMAGE,
  files: ["class.ts", "lines.ts", "node-http-service.main.ts", "node-http-service.ts", "perform.ts"],
  program: "node-http-service.main.ts",
  ready: '"ev":"listening"',
  packages: ["@mark1russell7/service", "@mark1russell7/service/http"],
};

/** This function gives the package and the export of an import: `@a/b/c` gives `@a/b` and `./c`, and `a` gives `a` and `.`. */
const exportOf = (entry: string): { readonly name: string; readonly path: string; readonly file: string } => {
  const parts = entry.split("/");
  const size = entry.startsWith("@") ? 2 : 1;
  const rest = parts.slice(size).join("/");
  return { name: parts.slice(0, size).join("/"), path: rest === "" ? "." : `./${rest}`, file: rest === "" ? "index" : rest };
};

const installs = new Map<string, Readonly<Record<string, string>>>();

/**
 * This function gives the files of the packages that a subject imports, in its folder `node_modules`. It gives the
 * path of each file in the container, and its content.
 *
 * - `esbuild` bundles each export with the packages that it imports, as JavaScript modules. Node strips no types in `node_modules`.
 * - The exports share their common modules, as Node loads one copy of each module.
 * - The modules keep each module of the imports (`treeShaking: false`). Thus the code in memory is the code of the packages.
 * - Each package gets a `package.json` with its exports.
 *
 * The function makes the files of one list of exports one time.
 */
export const packageFiles = (entries: readonly string[]): Readonly<Record<string, string>> => {
  const key = entries.join(" ");
  const known = installs.get(key);
  if (known !== undefined) return known;
  const folder = fileURLToPath(new URL("./subject/", import.meta.url));
  // esbuild writes no file (`write: false`). This folder only gives the relative path of each output.
  const out = join(folder, "node_modules");
  const exports = entries.map(exportOf);
  const result = buildSync({
    entryPoints: exports.map((each, index) => ({ in: entries[index] as string, out: `${each.name}/${each.file}` })),
    absWorkingDir: folder,
    bundle: true,
    splitting: true,
    platform: "node",
    format: "esm",
    target: "node24",
    treeShaking: false,
    outdir: out,
    outExtension: { ".js": ".mjs" },
    chunkNames: ".chunks/[name]-[hash]",
    write: false,
    logLevel: "silent",
  });
  const files: Record<string, string> = {};
  for (const file of result.outputFiles) files[`${SUBJECT_FOLDER}/node_modules/${relative(out, file.path).split(sep).join("/")}`] = file.text;
  for (const name of new Set(exports.map((each) => each.name))) {
    const map = Object.fromEntries(exports.filter((each) => each.name === name).map((each) => [each.path, `./${each.file}.mjs`]));
    files[`${SUBJECT_FOLDER}/node_modules/${name}/package.json`] = `${JSON.stringify({ name, type: "module", exports: map }, null, 2)}\n`;
  }
  installs.set(key, files);
  return files;
};

/**
 * This function gives the files of a subject for its container: the path of each file in the
 * container, and its content. Node starts the program of the subject from this folder. A subject
 * with packages also gets the files of its packages (`packageFiles`).
 */
export const subjectFiles = (subject: LabSubject): Readonly<Record<string, string>> => ({
  ...Object.fromEntries(
    subject.files.map((name) => [`${SUBJECT_FOLDER}/${name}`, readFileSync(new URL(`./subject/${name}`, import.meta.url), "utf8")]),
  ),
  ...(subject.packages === undefined ? {} : packageFiles(subject.packages)),
});
