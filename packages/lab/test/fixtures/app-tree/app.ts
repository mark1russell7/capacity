/**
 * This script is the app of the tests of the lab program `app-start`. It reads its store, and it is ready at a line or
 * at a path. The variable `FIXTURE_MODE` selects the end of the app:
 *
 * - `server`: the app serves the port, and it closes the server at `SIGTERM`.
 * - `exit`: the app ends with the code 3 before the end of the watch.
 * - `fail`: the app fails at its import.
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
} else {
  console.log(`fixture ready with ${files} files`);
  if (mode === "exit") setTimeout(() => process.exit(3), 10);
  else setInterval(() => undefined, 1000);
}
