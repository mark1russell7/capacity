// The app of the tests of the lab program app-start. It reads its store, and it is ready at a line or at a path.
// FIXTURE_MODE selects the end: "server" serves the port and closes at SIGTERM, "exit" ends before the watch,
// "fail" fails at its import. With no mode, the app writes its ready line and has no listener of SIGTERM.
import { readdirSync } from "node:fs";
import { createServer } from "node:http";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { store: { type: "string" }, port: { type: "string" } } });
if (values.store !== process.env.FIXTURE_STORE) throw new Error("The argument and the environment give different stores.");
const files = readdirSync(values.store).length;
const mode = process.env.FIXTURE_MODE ?? "";
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
