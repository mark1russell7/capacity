import { readFileSync } from "node:fs";

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
  /** These names are the files of the subject, in the folder `src/subject` of this package. */
  readonly files: readonly string[];
  /** This name is the file that Node starts. */
  readonly program: string;
  /** This text is in the line that tells that the subject serves. */
  readonly ready: string;
}

/**
 * This subject is the bare subject of layer 1: a server of `node:http` on the stock image of Node.
 * The image is the Node image of the lab clients of `@mark1russell7/harness`, by the same digest.
 */
export const NODE_HTTP: LabSubject = {
  name: "node-http",
  image: "node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1",
  files: ["class.ts", "lines.ts", "node-http.main.ts", "node-http.ts", "perform.ts"],
  program: "node-http.main.ts",
  ready: '"ev":"listening"',
};

/**
 * This function gives the files of a subject for its container: the path of each file in the
 * container, and its content. Node starts the program of the subject from this folder.
 */
export const subjectFiles = (subject: LabSubject): Readonly<Record<string, string>> =>
  Object.fromEntries(
    subject.files.map((name) => [`${SUBJECT_FOLDER}/${name}`, readFileSync(new URL(`./subject/${name}`, import.meta.url), "utf8")]),
  );
