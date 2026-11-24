// node-http-service --port N [--ballast BYTES] [--keep-alive-timeout MS] [--cost US]
//
// The program of the service subject. It has the flags and the lines of the bare subject
// (node-http.main.ts). The lab starts the bundle of this program (`subjectFiles`), because the
// stock image has no packages.
//
// The readiness of the subject is the line `listening`, at the end of the startup of the service.
// The service owns SIGTERM and SIGINT: it drains and closes in the phases of its declaration. The
// program writes `stopping` at the signal. Each 100 ms, the program writes the line `loop` with the lag
// of its event loop (loop.ts).

import { emit, fail, numberFlag } from "./lines.ts";
import { watchLoop } from "./loop.ts";
import { nodeHttpService } from "./node-http-service.ts";
import { BALLAST_PIECE, ballastOf, usedHeap } from "./perform.ts";

const port = numberFlag("--port") ?? fail("no --port. Usage: node-http-service --port N [--ballast BYTES] [--keep-alive-timeout MS] [--cost US]");
const keepAlive = numberFlag("--keep-alive-timeout");
const ballast = numberFlag("--ballast") ?? 0;
const cost = numberFlag("--cost") ?? 0;
const held = ballastOf(ballast);
const stopLoop = watchLoop();

const subject = nodeHttpService({ port, cost, ...(keepAlive === undefined ? {} : { keepAliveTimeout: keepAlive }) });
const stopping = (signal: string): void => {
  emit("stopping", { signal });
  stopLoop();
};
process.once("SIGTERM", () => stopping("SIGTERM"));
process.once("SIGINT", () => stopping("SIGINT"));

const life = await subject.service.run();
const address = subject.server.address();
emit("listening", {
  port: typeof address === "object" && address !== null ? address.port : port,
  node: process.version,
  pid: process.pid,
  keepAliveTimeout: subject.server.keepAliveTimeout,
  ballast,
  cost,
  objects: held.length * BALLAST_PIECE,
  heap: usedHeap(),
  state: life.state,
});
