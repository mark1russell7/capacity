import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { APP_START_PROGRAM, FAKES_PROGRAM } from "./start-app.ts";
import { ALERTS } from "./subject/alerts.ts";
import { NODE_HTTP, NODE_HTTP_SERVICE, SUBJECT_FOLDER, packageFiles, subjectFiles, type LabSubject } from "./subjects.ts";

type Line = { readonly ev: string; readonly t: number } & Readonly<Record<string, unknown>>;

const folders: string[] = [];
const children: ChildProcess[] = [];

afterAll(() => {
  for (const child of children) child.kill("SIGKILL");
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

/** This function writes the files of a subject to a new folder, as a container gets them, and gives the folder. */
const copyOf = (subject: LabSubject): string => {
  const folder = mkdtempSync(join(tmpdir(), "capacity-subject-"));
  folders.push(folder);
  for (const [path, content] of Object.entries(subjectFiles(subject))) {
    const file = join(folder, path.slice(SUBJECT_FOLDER.length + 1));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return folder;
};

type Kind = "loop" | "other";

/**
 * This function starts the program of a subject from a copy of its files. It gives the process, its next line and its end.
 * The lines `loop` of the watch of the event loop go to `loop`, not to `next`.
 */
const start = (
  args: readonly string[],
  subject: LabSubject = NODE_HTTP,
): { child: ChildProcess; next: () => Promise<Line>; loop: () => Promise<Line>; ended: Promise<number | null> } => {
  const child = spawn(process.execPath, [join(copyOf(subject), subject.program), ...args], { stdio: ["ignore", "pipe", "inherit"] });
  children.push(child);
  const queues: Record<Kind, Line[]> = { loop: [], other: [] };
  const waiters: Record<Kind, ((line: Line | undefined) => void)[]> = { loop: [], other: [] };
  let closed = false;
  const lines = createInterface({ input: child.stdout as NodeJS.ReadableStream });
  lines.on("line", (text) => {
    const line = JSON.parse(text) as Line;
    const kind: Kind = line.ev === "loop" ? "loop" : "other";
    const waiter = waiters[kind].shift();
    if (waiter === undefined) queues[kind].push(line);
    else waiter(line);
  });
  lines.on("close", () => {
    closed = true;
    for (const waiter of [...waiters.loop.splice(0), ...waiters.other.splice(0)]) waiter(undefined);
  });
  const take = async (kind: Kind): Promise<Line> => {
    const queued = queues[kind].shift();
    if (queued !== undefined) return queued;
    const line = closed ? undefined : await new Promise<Line | undefined>((resolve) => waiters[kind].push(resolve));
    if (line === undefined) throw new Error(`the program ended before its next line (${kind})`);
    return line;
  };
  return { child, next: () => take("other"), loop: () => take("loop"), ended: new Promise((resolve) => child.once("exit", resolve)) };
};

/** This function checks a line `loop` of the watch of the event loop of a subject (`subject/loop.ts`). */
const expectLoop = (line: Line): void => {
  expect(line).toMatchObject({ ev: "loop", resolution: 10 });
  expect(line["ms"]).toBeGreaterThan(0);
  expect(Number.isSafeInteger(line["count"])).toBe(true);
  for (const name of ["active", "idle"]) expect(typeof line[name]).toBe("number");
  if (Number(line["count"]) > 0) expect(Number(line["max"])).toBeGreaterThanOrEqual(Number(line["mean"]));
};

describe("NODE_HTTP", () => {
  it("names each file of the folder of the subjects in one subject or as the start program of an app, and its program is one of them", () => {
    const folder = fileURLToPath(new URL("./subject/", import.meta.url));
    const programs = readdirSync(folder).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
    // The folder holds three subjects and the programs of the app cases. The service subject has its program and its
    // server, and the files of the bare subject that it uses. The subject of alerts has its declaration and its two
    // programs. The app cases have the start program, the program of the sidecar of the fakes, and their ready checks.
    const service = NODE_HTTP_SERVICE.files.filter((name) => !NODE_HTTP.files.includes(name));
    expect(service).toEqual(["node-http-service.main.ts", "node-http-service.ts"]);
    const alerts = ["alerts.ts", ALERTS.seed, ALERTS.start];
    expect([...NODE_HTTP.files, ...service, ...alerts, APP_START_PROGRAM, FAKES_PROGRAM, "ready.ts"].sort()).toEqual(programs.sort());
    expect(NODE_HTTP.files).toContain(NODE_HTTP.program);
    expect(NODE_HTTP.image).toMatch(/^node:\d+\.\d+\.\d+-alpine@sha256:[0-9a-f]{64}$/);
  });

  it("has files that import only Node, the watch of the event loop and each other", () => {
    const files = subjectFiles(NODE_HTTP);
    const modules = `${SUBJECT_FOLDER}/node_modules/`;
    expect(Object.keys(files).filter((path) => !path.startsWith(modules))).toEqual(NODE_HTTP.files.map((name) => `${SUBJECT_FOLDER}/${name}`));
    expect(NODE_HTTP.packages).toEqual(["@mark1russell7/lag/node"]);
    const packages = new Set(NODE_HTTP.packages);
    for (const name of NODE_HTTP.files) {
      const content = files[`${SUBJECT_FOLDER}/${name}`] as string;
      const imports = [...content.matchAll(/^import .* from "([^"]+)";$/gm)].map((match) => match[1] as string);
      for (const each of imports) {
        expect(each.startsWith("node:") || packages.has(each) || (NODE_HTTP.files as readonly string[]).includes(each.replace(/^\.\//, ""))).toBe(true);
      }
    }
  });

  it("starts from a copy of its files, serves a class and stops at a signal", async () => {
    const { child, next, loop, ended } = start(["--port", "0", "--ballast", "1048576", "--keep-alive-timeout", "0"]);
    const listening = await next();
    expect(JSON.stringify(listening)).toContain(NODE_HTTP.ready);
    expect(listening).toMatchObject({ ev: "listening", node: process.version, keepAliveTimeout: 0, ballast: 1_048_576 });
    expect(Number(listening["objects"]) % 1024).toBe(0);
    expect(listening["objects"]).toBeGreaterThanOrEqual(1_048_576 / 256);
    expect(listening["heap"]).toBeGreaterThan(1_048_576);

    const response = await fetch(`http://127.0.0.1:${String(listening["port"])}/?reply=10`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("xxxxxxxxxx");
    expectLoop(await loop());

    if (process.platform === "win32") {
      // Windows has no signals: a kill ends the process at once, and the program writes no line.
      child.kill();
      await ended;
      return;
    }
    child.kill("SIGTERM");
    expect(await next()).toMatchObject({ ev: "stopping", signal: "SIGTERM" });
    expect(await ended).toBe(0);
  });

  it("fails with a line when the command line has no port", async () => {
    const { next, ended } = start([]);
    expect(await next()).toMatchObject({ ev: "fail" });
    expect(await ended).toBe(1);
  });

  it("fails with a line for a flag that is not a whole number", async () => {
    const { next, ended } = start(["--port", "80a"]);
    const line = await next();
    expect(line).toMatchObject({ ev: "fail" });
    expect(String(line["why"])).toContain("--port");
    expect(await ended).toBe(1);
  });
});

describe("NODE_HTTP_SERVICE", () => {
  it("goes into its container as its own TypeScript files and its packages as JavaScript, on the image of the bare subject", () => {
    const files = subjectFiles(NODE_HTTP_SERVICE);
    const modules = `${SUBJECT_FOLDER}/node_modules/`;
    expect(Object.keys(files).filter((path) => !path.startsWith(modules))).toEqual(NODE_HTTP_SERVICE.files.map((name) => `${SUBJECT_FOLDER}/${name}`));
    expect(NODE_HTTP_SERVICE.files).toContain(NODE_HTTP_SERVICE.program);
    // Node strips no types in node_modules, thus each module of a package is JavaScript
    const packed = Object.keys(files).filter((path) => path.startsWith(modules) && !path.endsWith("/package.json"));
    expect(packed.length).toBeGreaterThan(1);
    expect(packed.every((path) => path.endsWith(".mjs"))).toBe(true);
    expect(JSON.parse(files[`${modules}@mark1russell7/service/package.json`] as string)).toEqual({
      name: "@mark1russell7/service",
      type: "module",
      exports: { ".": "./index.mjs", "./http": "./http.mjs" },
    });
    // the lab makes the files of one list of exports one time
    expect(packageFiles([...(NODE_HTTP_SERVICE.packages ?? [])])).toBe(packageFiles(NODE_HTTP_SERVICE.packages ?? []));
    expect(NODE_HTTP_SERVICE.image).toBe(NODE_HTTP.image);
    expect(NODE_HTTP_SERVICE.ready).toBe(NODE_HTTP.ready);
  });

  it("has files that import only Node, its packages and each other", () => {
    const folder = fileURLToPath(new URL("./subject/", import.meta.url));
    const own = new Set(NODE_HTTP_SERVICE.files);
    const packages = new Set(NODE_HTTP_SERVICE.packages);
    for (const name of NODE_HTTP_SERVICE.files) {
      const content = readFileSync(join(folder, name), "utf8");
      const imports = [...content.matchAll(/^import .* from "([^"]+)";$/gm)].map((match) => match[1] as string);
      for (const each of imports) expect(each.startsWith("node:") || packages.has(each) || own.has(each.replace(/^\.\//, ""))).toBe(true);
    }
  });

  it("starts from its files and its packages, gives the reply of the bare subject to each class, answers its probes and stops at a signal", async () => {
    const { child, next, loop, ended } = start(["--port", "0", "--ballast", "1048576", "--keep-alive-timeout", "0"], NODE_HTTP_SERVICE);
    const listening = await next();
    expect(JSON.stringify(listening)).toContain(NODE_HTTP_SERVICE.ready);
    expect(listening).toMatchObject({ ev: "listening", node: process.version, keepAliveTimeout: 0, ballast: 1_048_576, state: "running" });
    const base = `http://127.0.0.1:${String(listening["port"])}`;

    const reply = await fetch(`${base}/?work=100&reply=10`);
    expect(reply.status).toBe(200);
    expect(await reply.text()).toBe("xxxxxxxxxx");
    const posted = await fetch(`${base}/?body=5&reply=3`, { method: "POST", body: "xxxxx" });
    expect([posted.status, await posted.text()]).toEqual([200, "xxx"]);
    const other = await fetch(`${base}/other`);
    expect(other.status).toBe(404);
    await other.text();
    const ready = await fetch(`${base}/health/readiness`);
    expect([ready.status, (await ready.json()) as unknown]).toMatchObject([200, { status: "pass", service: NODE_HTTP_SERVICE.name }]);
    expectLoop(await loop());

    if (process.platform === "win32") {
      child.kill();
      await ended;
      return;
    }
    child.kill("SIGTERM");
    expect(await next()).toMatchObject({ ev: "stopping", signal: "SIGTERM" });
    expect(await ended).toBe(0);
  }, 60_000);
});
