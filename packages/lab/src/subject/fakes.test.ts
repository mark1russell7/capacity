import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { containerStart } from "@mark1russell7/rigor-bench/fresh";
import { afterAll, describe, expect, it } from "vitest";
import { APP_CASE } from "../app-fixtures.ts";
import { FAKES_PROGRAM, FAKE_PORT, type AppFake, type AppFakesFile } from "../start-app.ts";

const PROGRAM = fileURLToPath(new URL(`./${FAKES_PROGRAM}`, import.meta.url));
/** This folder is the root of the repository. A container mounts it at the same path. */
const REPO = fileURLToPath(new URL("../../../../", import.meta.url)).replace(/[\\/]+$/, "");
const folders: string[] = [];
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

/** This function gives a new folder that the tests remove at the end. */
const folder = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "capacity-fakes-"));
  folders.push(dir);
  return dir;
};

/** This function gives a free port of the loopback. */
const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => (typeof address === "object" && address !== null ? resolve(address.port) : reject(new Error("no port"))));
    });
  });

/** This function gives the environment of the programs of a test: the temporary folder of the test, on each system. */
const envOf = (dir: string): NodeJS.ProcessEnv => ({ ...process.env, TMPDIR: dir, TEMP: dir, TMP: dir });

/** This function gives a fake of the tests: an inline program of Node. It ends after 20 seconds, thus a test leaves no process. */
const fakeOf = (service: string, port: number, program: string, ready: AppFake["ready"]): AppFake => ({
  service,
  argv: [process.execPath, "-e", `setTimeout(() => process.exit(0), 20000).unref(); ${program}`],
  cwd: ".",
  env: {},
  port,
  ready,
});

/** This function starts the program in the mode host, and gives its JSON lines at its exit. It stops the program at the line `fakes`. */
const host = (dir: string, fakes: readonly AppFake[]): Promise<{ readonly code: number | null; readonly lines: readonly Record<string, unknown>[] }> => {
  const file = join(dir, "fakes.json");
  writeFileSync(file, JSON.stringify({ app: "fixture-app", fakes } satisfies AppFakesFile));
  const child = spawn(process.execPath, [PROGRAM, "host", "--file", file], { env: envOf(dir), stdio: ["ignore", "pipe", "inherit"] });
  const lines: Record<string, unknown>[] = [];
  let text = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    text += chunk;
    const parts = text.split("\n");
    text = parts.pop() ?? "";
    for (const part of parts) {
      const line = JSON.parse(part) as Record<string, unknown>;
      lines.push(line);
      if (line["ev"] === "fakes") {
        // The mode ready ends at once, because the host wrote the file of the ready fakes.
        const ready = spawnSync(process.execPath, [PROGRAM, "ready"], { env: envOf(dir), timeout: 10_000 });
        lines.push({ ev: "ready-mode", code: ready.status });
        child.kill("SIGTERM");
      }
    }
  });
  return new Promise((resolve) => child.on("exit", (code) => resolve({ code, lines })));
};

describe("the program fakes", () => {
  it("starts each fake, waits for its ready line or its status 200, and tells when each fake is ready", async () => {
    const dir = folder();
    const port = await freePort();
    const feed = fakeOf("feed", 1, `console.log("feed starts"); setTimeout(() => console.log("feed up"), 50); setInterval(() => {}, 1000);`, { kind: "line", text: "feed up" });
    const server = `const http = require("node:http"); let up = false; setTimeout(() => (up = true), 100);
      http.createServer((q, s) => { s.statusCode = up && q.url === "/ready" ? 200 : 503; s.end(); }).listen(${port}, "127.0.0.1");`;
    const channel = fakeOf("channel", port, server, { kind: "http", path: "/ready" });
    const { lines } = await host(dir, [feed, channel]);
    const evs = lines.map((each) => `${String(each["ev"])} ${String(each["service"] ?? each["code"] ?? "")}`);
    expect(evs).toContain("out feed");
    expect(lines.find((each) => each["ev"] === "out")).toMatchObject({ service: "feed", stream: "stdout", line: "feed starts" });
    expect(evs.filter((each) => each.startsWith("ready "))).toEqual(expect.arrayContaining(["ready feed", "ready channel"]));
    expect(lines.find((each) => each["ev"] === "fakes")).toMatchObject({ services: ["feed", "channel"] });
    expect(evs.at(-1)).toBe("ready-mode 0");
  }, 30_000);

  it("stops with the code 1 and a line fail when a fake ends, and the mode ready waits with no file", async () => {
    const dir = folder();
    const ended = fakeOf("feed", 1, "process.exit(3);", { kind: "line", text: "never" });
    const { code, lines } = await host(dir, [ended]);
    expect(code).toBe(1);
    expect(lines.at(-1)).toMatchObject({ ev: "fail", why: 'The fake of "feed" ended with the code 3 and the signal null.' });
    const waits = spawnSync(process.execPath, [PROGRAM, "ready"], { env: envOf(dir), timeout: 500 });
    expect(waits.status).toBeNull();
  }, 30_000);

  it("stops with the code 1 for a call with no mode", () => {
    const child = spawnSync(process.execPath, [PROGRAM], { encoding: "utf8", timeout: 10_000 });
    expect(child.status).toBe(1);
    expect(child.stdout).toContain("The program needs the mode host");
  });
});

// This test starts real containers, thus it starts only in CI on Linux, where each runner has Docker.
describe.runIf(process.env["CI"] === "true" && process.platform === "linux")("the program fakes in a sidecar of a child (CI)", () => {
  it("starts the fakes before the child, and the child gets the fake on the loopback of the sidecar", async () => {
    // The bench starts each container with `--pull never`, thus the test pulls the image first.
    expect(spawnSync("docker", ["pull", "--quiet", APP_CASE.target.image], { encoding: "utf8", timeout: 240_000 }).status).toBe(0);
    const dir = folder();
    const file = join(dir, "fakes.json");
    const server = `require("node:http").createServer((q, s) => s.end(q.url === "/ready" ? "feed" : "no")).listen(${FAKE_PORT}, "127.0.0.1");`;
    const fake: AppFake = { service: "feed", argv: ["node", "-e", server], cwd: dir, env: {}, port: FAKE_PORT, ready: { kind: "http", path: "/ready" } };
    writeFileSync(file, JSON.stringify({ app: "fixture-app", fakes: [fake] } satisfies AppFakesFile));
    const program = ["node", PROGRAM];
    const start = containerStart({
      image: APP_CASE.target.image,
      memory: 512 * 1024 ** 2,
      mounts: [dir, REPO],
      sidecars: [{ argv: [...program, "host", "--file", file], memory: 256 * 1024 ** 2, mounts: [dir, REPO], ready: [...program, "ready"] }],
    });
    const child = `fetch("http://127.0.0.1:${FAKE_PORT}/ready").then(async (r) => console.log(r.status, await r.text()));`;
    const exit = await start(["node", "-e", child], { timeoutMs: 120_000, maxBuffer: 1 << 20 });
    expect(exit.error).toBeUndefined();
    expect(exit.stdout.trim()).toBe("200 feed");
    expect(exit.sidecars?.[0]?.stdout).toContain(`"ev":"fakes"`);
  }, 300_000);
});
