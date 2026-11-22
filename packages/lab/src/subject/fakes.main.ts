// node fakes.main.ts host --file FILE
// node fakes.main.ts ready
//
// The program of the sidecar of an app case with outside services. The lab starts the sidecar before each child, with
// `@mark1russell7/rigor-bench/fresh`. The child joins the network of the sidecar, thus it gets each fake on 127.0.0.1.
//
// `host` starts each fake of the fakes file (`AppFakesFile`), with its argv, its folder and its environment. Each line of
// a fake is a JSON line `out` of this program, with the service and the stream. At the ready signal of each fake, the
// program writes a line `ready`. When each fake is ready, it writes the line `fakes` and the file READY_FILE. A fake that
// ends stops the program with the exit code 1, thus the sidecar stops and the end of the child is a fault.
//
// `ready` ends with the code 0 when the file READY_FILE is there, in the temporary folder (TMPDIR). `docker exec` starts
// it in the sidecar, and the bench starts the child after it ends.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import type { AppFakesFile } from "../start-app.ts";
import { emit, fail } from "./lines.ts";
import { READY_POLL_MS, httpProbe, textWatch } from "./ready.ts";

/** This file tells that each fake is ready. It is in the temporary folder of the sidecar, thus each sidecar starts with no file. */
const READY_FILE = join(tmpdir(), "capacity-fakes.ready");

const { positionals, values } = parseArgs({ allowPositionals: true, options: { file: { type: "string" } } });
const [mode] = positionals;

if (mode === "ready") {
  while (!existsSync(READY_FILE)) await sleep(READY_POLL_MS);
  process.exit(0);
}
if (mode !== "host" || values.file === undefined) fail("The program needs the mode host with --file, or the mode ready.");

const file = JSON.parse(readFileSync(values.file!, "utf8")) as AppFakesFile;
const started = performance.now();
const children: ChildProcess[] = [];
let ended = false;

/** This function stops each fake and the program, because a fake ended or did not start. */
const stop = (why: string): void => {
  if (ended) return;
  ended = true;
  for (const child of children) child.kill("SIGKILL");
  fail(why);
};

// A SIGTERM stops each fake and the program. In a sidecar, the removal of the container stops each process.
process.on("SIGTERM", () => {
  ended = true;
  for (const child of children) child.kill("SIGKILL");
  process.exit(0);
});

const readies = file.fakes.map(
  (fake) =>
    new Promise<void>((resolve) => {
      const child = spawn(fake.argv[0]!, fake.argv.slice(1), { cwd: fake.cwd, env: { ...process.env, ...fake.env }, stdio: ["ignore", "pipe", "pipe"] });
      children.push(child);
      let ready = false;
      const mark = (): void => {
        if (ready) return;
        ready = true;
        emit("ready", { service: fake.service, ms: performance.now() - started });
        resolve();
      };
      for (const [name, stream] of [["stdout", child.stdout], ["stderr", child.stderr]] as const) {
        const seen = fake.ready.kind === "line" ? textWatch(fake.ready.text) : undefined;
        stream.setEncoding("utf8");
        stream.on("data", (chunk: string) => {
          if (seen?.(chunk) === true) mark();
        });
        createInterface({ input: stream }).on("line", (line) => emit("out", { service: fake.service, stream: name, line }));
      }
      child.on("error", (error) => stop(`The fake of "${fake.service}" did not start: ${error.message}`));
      child.on("exit", (code, signal) => stop(`The fake of "${fake.service}" ended with the code ${code} and the signal ${signal}.`));
      const { ready: signal } = fake;
      if (signal.kind === "http") {
        void (async () => {
          while (!ready && !ended) {
            if (await httpProbe(http, fake.port, signal.path)) mark();
            else await sleep(READY_POLL_MS);
          }
        })();
      }
    }),
);
await Promise.all(readies);
if (!ended) {
  emit("fakes", { services: file.fakes.map((fake) => fake.service), ms: performance.now() - started });
  writeFileSync(READY_FILE, "ready\n");
}
