/**
 * This script is the app of the tests of the lab program `app-start`. It reads its store, and it is ready at a line or
 * at a path. The variable `FIXTURE_MODE` selects the end of the app:
 *
 * - `server`: the app serves the port, and it closes the server at `SIGTERM`.
 * - `exit`: the app ends with the code 3 before the end of the watch.
 * - `fail`: the app fails at its import.
 * - `lines`: the app writes a line `fixture-write` before its ready line, and one more in two chunks after it. Then it
 *   writes a line `fixture-pass` each 10 milliseconds. It also writes a line that is not JSON, a line of another event and
 *   one line `fixture-readings` with one reading and one item that is not a reading.
 * - With no mode, the app writes its ready line, and it has no listener of `SIGTERM`.
 */
import { readdirSync } from "node:fs";
import { createServer } from "node:http";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { store: { type: "string" }, port: { type: "string" } } });
const store = values.store;
if (store === undefined || store !== process.env["FIXTURE_STORE"]) throw new Error("The argument and the environment give different stores.");
const files = readdirSync(store).length;
const mode = process.env["FIXTURE_MODE"] ?? "";
if (mode === "fail") throw new Error("The fixture fails at its import.");
if (mode === "server") {
  const server = createServer((request, response) => {
    response.statusCode = request.url === "/ready" ? 200 : 404;
    response.end();
  });
  server.listen(Number(values.port), "127.0.0.1");
  process.once("SIGTERM", () => server.close());
} else if (mode === "lines") {
  console.log(JSON.stringify({ ev: "fixture-write", longestMs: 3, writeMs: 2, rowsMs: 1, wallMs: 4, cpuMs: 2 }));
  console.log(`fixture ready with ${files} files`);
  process.stdout.write('{"ev":"fixture-wr');
  process.stdout.write('ite","longestMs":7,"other":"x"}\n');
  console.log("not a JSON line");
  console.log(JSON.stringify({ ev: "fixture-other" }));
  console.log(JSON.stringify({ ev: "fixture-readings", readings: [{ series: "requests", at: "2026-11-24T12:00:00.000Z", value: 3 }, { series: "bad" }] }));
  setInterval(() => console.log(JSON.stringify({ ev: "fixture-pass" })), 10);
} else {
  console.log(`fixture ready with ${files} files`);
  if (mode === "exit") setTimeout(() => process.exit(3), 10);
  else setInterval(() => undefined, 1000);
}
