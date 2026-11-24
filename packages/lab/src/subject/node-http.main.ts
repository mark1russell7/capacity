// node-http --port N [--ballast BYTES] [--keep-alive-timeout MS] [--cost US]
//
// The program of the bare subject. The server is at the defaults of Node, and each flag sets one
// value over them.
//
// --port is the port of the listener. With 0, the system gives a free port, and the line
// `listening` names it.
// --ballast is the live heap of the process, in bytes: small objects that stay for its life. It
// is a setting, not a reading: the line `listening` gives the count of the objects and the used heap.
// --keep-alive-timeout is the time that Node keeps an idle connection, in ms. The default of Node
// is 5000, which closes the connection of a stream with a low rate. 0 keeps each connection.
// --cost is an added CPU time for each request, in us: a busy wait. It makes a slower subject, for
// the proof of a gate. The line `listening` gives it.
//
// Each 100 ms, the program writes the line `loop` with the lag of its event loop (loop.ts).
//
// The readiness of the subject is the line `listening`. At SIGTERM or SIGINT, the program writes
// `stopping`, closes its listener and each connection, and ends.

import { emit, fail, numberFlag } from "./lines.ts";
import { watchLoop } from "./loop.ts";
import { nodeHttp } from "./node-http.ts";
import { BALLAST_PIECE, ballastOf, usedHeap } from "./perform.ts";

const port = numberFlag("--port") ?? fail("no --port. Usage: node-http --port N [--ballast BYTES] [--keep-alive-timeout MS] [--cost US]");
const keepAlive = numberFlag("--keep-alive-timeout");
const ballast = numberFlag("--ballast") ?? 0;
const cost = numberFlag("--cost") ?? 0;
const held = ballastOf(ballast);
const stopLoop = watchLoop();

const server = nodeHttp({ cost });
if (keepAlive !== undefined) server.keepAliveTimeout = keepAlive;

server.listen(port, "0.0.0.0", () => {
  const address = server.address();
  emit("listening", {
    port: typeof address === "object" && address !== null ? address.port : port,
    node: process.version,
    pid: process.pid,
    keepAliveTimeout: server.keepAliveTimeout,
    ballast,
    cost,
    objects: held.length * BALLAST_PIECE,
    heap: usedHeap(),
  });
});

const stop = (signal: string): void => {
  emit("stopping", { signal });
  stopLoop();
  server.close();
  server.closeAllConnections();
};
process.once("SIGTERM", () => stop("SIGTERM"));
process.once("SIGINT", () => stop("SIGINT"));
